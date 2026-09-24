import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Task = {
  id: string;
  title: string;
  category?: string | null;
  difficulty?: string | null;
  estimated_duration?: number | null;
  due_date?: string | null;
  start_time?: string | null;
  priority_score?: number | null;
  status?: string | null;
  archived?: boolean | null;
};

type Block = {
  task_id: string;
  title: string;
  start: string;
  end: string;
  category: string;
  kind: "task" | "break";
};

type BreakStyle =
  | "pomodoro"
  | "long-focus"
  | "flexible";

type BreakBlock = {
  start: number;
  dur: number;
  title: string;
};

type CSPResult = {
  blocks: Block[];
  scheduledTaskIds: string[];
};

type PSOResult = {
  order: number[];
  best: number;
};

function parseHHMM(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);

  return (
    (Number.isFinite(hours) ? hours : 0) * 60 +
    (Number.isFinite(minutes) ? minutes : 0)
  );
}

function toHHMM(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));

  const hours = Math.floor(safe / 60);
  const mins = safe % 60;

  return `${String(hours).padStart(2, "0")}:${String(
    mins
  ).padStart(2, "0")}`;
}

function durationOf(task: Task): number {
  return Math.max(
    5,
    Math.min(
      480,
      Number(task.estimated_duration) || 30
    )
  );
}

/* =========================================================
   BREAK STYLE
   ========================================================= */

const BREAK_STYLES: Record<
  BreakStyle,
  BreakBlock[]
> = {
  pomodoro: [
    {
      start: 9 * 60,
      dur: 15,
      title: "Morning Break (Snack)",
    },
    {
      start: 12 * 60,
      dur: 60,
      title: "Lunch Break",
    },
    {
      start: 15 * 60,
      dur: 15,
      title: "Afternoon Break (Snack)",
    },
  ],

  "long-focus": [
    {
      start: 12 * 60,
      dur: 60,
      title: "Lunch Break",
    },
  ],

  flexible: [
    {
      start: 12 * 60,
      dur: 45,
      title: "Lunch Break",
    },
  ],
};

function getBreakBlocks(
  breakStyle?: string
): BreakBlock[] {
  const style =
    (breakStyle || "pomodoro") as BreakStyle;

  return BREAK_STYLES[style] ??
    BREAK_STYLES.pomodoro;
}

/* =========================================================
   TASK CLEANUP
   ========================================================= */

/*
 * A task should enter PSO/CSP only once.
 */
function uniqueTasks(tasks: Task[]): Task[] {
  const seen = new Set<string>();
  const result: Task[] = [];

  for (const task of tasks) {
    if (!task?.id) continue;

    if (seen.has(task.id)) {
      continue;
    }

    seen.add(task.id);
    result.push(task);
  }

  return result;
}

/* =========================================================
   CSP
   ========================================================= */

function csp(
  tasks: Task[],
  startMin: number,
  endMin: number,
  breakStyle: string
): CSPResult {
  const blocks: Block[] = [];
  const scheduledTaskIds: string[] = [];

  const unique = uniqueTasks(tasks);

  const breaks = getBreakBlocks(breakStyle)
    .filter(
      (breakBlock) =>
        breakBlock.start >= startMin &&
        breakBlock.start + breakBlock.dur <=
          endMin
    )
    .sort(
      (a, b) => a.start - b.start
    );

  let cursor = startMin;
  let breakIndex = 0;

  const usedTaskIds = new Set<string>();
  const usedBreakIds = new Set<string>();

  /*
   * Adds a break exactly once.
   */
  const addBreak = (
    breakBlock: BreakBlock
  ) => {
    const id = `break-${breakBlock.start}`;

    if (usedBreakIds.has(id)) {
      return;
    }

    blocks.push({
      task_id: id,
      title: breakBlock.title,
      start: toHHMM(
        breakBlock.start
      ),
      end: toHHMM(
        breakBlock.start +
          breakBlock.dur
      ),
      category: "Break",
      kind: "break",
    });

    usedBreakIds.add(id);
  };

  /*
   * Move cursor through breaks that have
   * already been reached.
   */
  const movePastReachedBreaks = () => {
    while (
      breakIndex < breaks.length
    ) {
      const current =
        breaks[breakIndex];

      /*
       * Break is completely before cursor.
       */
      if (
        cursor >=
        current.start +
          current.dur
      ) {
        breakIndex++;
        continue;
      }

      /*
       * Cursor is inside a break.
       */
      if (
        cursor >= current.start &&
        cursor <
          current.start +
            current.dur
      ) {
        addBreak(current);

        cursor =
          current.start +
          current.dur;

        breakIndex++;
        continue;
      }

      break;
    }
  };

  for (const task of unique) {
    if (usedTaskIds.has(task.id)) {
      continue;
    }

    const duration =
      durationOf(task);

    /*
     * Move past breaks that have already
     * been reached.
     */
    movePastReachedBreaks();

    /*
     * Repeatedly move the task after any
     * break that it would cross.
     */
    let placed = false;

    while (!placed) {
      movePastReachedBreaks();

      const nextBreak =
        breakIndex < breaks.length
          ? breaks[breakIndex]
          : null;

      /*
       * No remaining break.
       */
      if (!nextBreak) {
        if (
          cursor + duration <=
          endMin
        ) {
          blocks.push({
            task_id: task.id,
            title: task.title,
            start: toHHMM(cursor),
            end: toHHMM(
              cursor + duration
            ),
            category:
              task.category ||
              "General",
            kind: "task",
          });

          usedTaskIds.add(
            task.id
          );

          scheduledTaskIds.push(
            task.id
          );

          cursor += duration;
          placed = true;
        }

        /*
         * No room left.
         */
        break;
      }

      /*
       * There is enough room before the break.
       */
      if (
        cursor <
          nextBreak.start &&
        cursor + duration <=
          nextBreak.start
      ) {
        blocks.push({
          task_id: task.id,
          title: task.title,
          start: toHHMM(cursor),
          end: toHHMM(
            cursor + duration
          ),
          category:
            task.category ||
            "General",
          kind: "task",
        });

        usedTaskIds.add(
          task.id
        );

        scheduledTaskIds.push(
          task.id
        );

        cursor += duration;
        placed = true;
        break;
      }

      /*
       * The task would cross the break.
       *
       * Move the task after the break.
       */
      addBreak(nextBreak);

      cursor =
        nextBreak.start +
        nextBreak.dur;

      breakIndex++;

      /*
       * Loop again and check the next break.
       */
    }
  }

  /*
   * Chronological ordering.
   */
  blocks.sort((a, b) => {
    const startDiff =
      parseHHMM(a.start) -
      parseHHMM(b.start);

    if (startDiff !== 0) {
      return startDiff;
    }

    return (
      parseHHMM(a.end) -
      parseHHMM(b.end)
    );
  });

  /*
   * FINAL SAFETY VALIDATION
   *
   * Never return overlapping blocks.
   */
  const validBlocks: Block[] = [];
  const validTaskIds: string[] = [];

  for (const block of blocks) {
    const start =
      parseHHMM(block.start);

    const end =
      parseHHMM(block.end);

    if (
      start < startMin ||
      end > endMin ||
      end <= start
    ) {
      continue;
    }

    const duplicateTask =
      block.kind === "task" &&
      validTaskIds.includes(
        block.task_id
      );

    if (duplicateTask) {
      continue;
    }

    const previous =
      validBlocks.length > 0
        ? validBlocks[
            validBlocks.length - 1
          ]
        : null;

    if (previous) {
      const previousEnd =
        parseHHMM(
          previous.end
        );

      if (
        start <
        previousEnd
      ) {
        continue;
      }
    }

    validBlocks.push(
      block
    );

    if (
      block.kind === "task"
    ) {
      validTaskIds.push(
        block.task_id
      );
    }
  }

  return {
    blocks: validBlocks,
    scheduledTaskIds:
      validTaskIds,
  };
}

/* =========================================================
   FITNESS
   ========================================================= */

function fitness(
  tasks: Task[],
  startMin: number,
  endMin: number,
  peakStart: number,
  peakEnd: number,
  breakStyle: string,
  scheduleDate: string
): number {
  const result = csp(
    tasks,
    startMin,
    endMin,
    breakStyle
  );

  /*
   * Strong penalty for every task
   * that was not scheduled.
   */
  let score =
    (tasks.length -
      result.scheduledTaskIds
        .length) *
    1000;

  const taskMap = new Map(
    tasks.map((task) => [
      task.id,
      task,
    ])
  );

  const placedTasks =
    result.blocks.filter(
      (block) =>
        block.kind === "task"
    );

  /*
   * Evaluate each actual placed task.
   */
  for (const block of placedTasks) {
    const task =
      taskMap.get(
        block.task_id
      );

    if (!task) {
      continue;
    }

    const start =
      parseHHMM(block.start);

    const end =
      parseHHMM(block.end);

    const difficulty =
      (
        task.difficulty ||
        ""
      ).toLowerCase();

    const diffWeight =
      difficulty === "hard"
        ? 3
        : difficulty === "medium"
        ? 1
        : 0.3;

    const insidePeak =
      start >= peakStart &&
      end <= peakEnd;

    /*
     * Hard tasks outside peak.
     */
    if (
      difficulty === "hard" &&
      !insidePeak
    ) {
      score += 25;
    }

    /*
     * Easy tasks inside peak.
     */
    if (
      difficulty === "easy" &&
      insidePeak
    ) {
      score += 8;
    }

    /*
     * Later placement penalty.
     */
    const windowSize =
      Math.max(
        1,
        endMin - startMin
      );

    const startFraction =
      (start - startMin) /
      windowSize;

    score +=
      diffWeight *
      startFraction *
      6;

    /*
     * Deadline penalty.
     */
    if (task.due_date) {
      const scheduledEnd =
        new Date(
          `${scheduleDate}T${block.end}:00`
        ).getTime();

      const due =
        new Date(
          task.due_date
        ).getTime();

      if (
        Number.isFinite(
          scheduledEnd
        ) &&
        Number.isFinite(due) &&
        scheduledEnd > due
      ) {
        score += 50;
      }
    }
  }

  /*
   * Context/category switching penalty.
   */
  for (
    let i = 1;
    i < placedTasks.length;
    i++
  ) {
    const previous =
      taskMap.get(
        placedTasks[
          i - 1
        ].task_id
      );

    const current =
      taskMap.get(
        placedTasks[i]
          .task_id
      );

    if (
      previous &&
      current &&
      (
        previous.category ||
        "General"
      ) !==
        (
          current.category ||
          "General"
        )
    ) {
      score += 2;
    }
  }

  return score;
}

/* =========================================================
   PSO
   ========================================================= */

function decode(
  keys: number[]
): number[] {
  return keys
    .map((key, index) => ({
      key,
      index,
    }))
    .sort(
      (a, b) =>
        a.key - b.key
    )
    .map(
      (item) =>
        item.index
    );
}

function pso(
  tasks: Task[],
  startMin: number,
  endMin: number,
  peakStart: number,
  peakEnd: number,
  breakStyle: string,
  scheduleDate: string,
  options = {
    swarm: 25,
    iters: 60,
    w: 0.7,
    c1: 1.5,
    c2: 1.5,
  }
): PSOResult {
  const n = tasks.length;

  if (n === 0) {
    return {
      order: [],
      best: 0,
    };
  }

  const rng = () =>
    Math.random();

  const swarm =
    Array.from(
      {
        length:
          options.swarm,
      },
      () =>
        Array.from(
          {
            length: n,
          },
          rng
        )
    );

  const velocity =
    Array.from(
      {
        length:
          options.swarm,
      },
      () =>
        Array.from(
          {
            length: n,
          },
          () =>
            (rng() - 0.5) *
            0.2
        )
    );

  const pbest =
    swarm.map(
      (particle) => [
        ...particle,
      ]
    );

  const pbestScore =
    swarm.map(
      (particle) =>
        fitness(
          decode(
            particle
          ).map(
            (index) =>
              tasks[index]
          ),
          startMin,
          endMin,
          peakStart,
          peakEnd,
          breakStyle,
          scheduleDate
        )
    );

  let gIdx =
    pbestScore.indexOf(
      Math.min(
        ...pbestScore
      )
    );

  let gbest =
    pbest[gIdx]
      ? [...pbest[gIdx]]
      : [...swarm[0]];

  let gbestScore =
    pbestScore[gIdx] ??
    Number.POSITIVE_INFINITY;

  for (
    let iteration = 0;
    iteration <
    options.iters;
    iteration++
  ) {
    for (
      let particleIndex = 0;
      particleIndex <
      options.swarm;
      particleIndex++
    ) {
      for (
        let dimension = 0;
        dimension < n;
        dimension++
      ) {
        const r1 = rng();
        const r2 = rng();

        velocity[
          particleIndex
        ][dimension] =
          options.w *
            velocity[
              particleIndex
            ][dimension] +
          options.c1 *
            r1 *
            (
              pbest[
                particleIndex
              ][dimension] -
              swarm[
                particleIndex
              ][dimension]
            ) +
          options.c2 *
            r2 *
            (
              gbest[dimension] -
              swarm[
                particleIndex
              ][dimension]
            );

        swarm[
          particleIndex
        ][dimension] =
          Math.max(
            0,
            Math.min(
              1,
              swarm[
                particleIndex
              ][dimension] +
                velocity[
                  particleIndex
                ][dimension]
            )
          );
      }

      const currentScore =
        fitness(
          decode(
            swarm[
              particleIndex
            ]
          ).map(
            (index) =>
              tasks[index]
          ),
          startMin,
          endMin,
          peakStart,
          peakEnd,
          breakStyle,
          scheduleDate
        );

      if (
        currentScore <
        pbestScore[
          particleIndex
        ]
      ) {
        pbestScore[
          particleIndex
        ] = currentScore;

        pbest[
          particleIndex
        ] = [
          ...swarm[
            particleIndex
          ],
        ];
      }

      if (
        currentScore <
        gbestScore
      ) {
        gbestScore =
          currentScore;

        gbest = [
          ...swarm[
            particleIndex
          ],
        ];
      }
    }
  }

  return {
    order: decode(
      gbest
    ),
    best: gbestScore,
  };
}

/* =========================================================
   PERSIST SCHEDULE
   ========================================================= */

async function persistSchedule(
  supabase: any,
  userId: string,
  tasks: Task[],
  blocks: Block[],
  scheduleDate: string
) {
  /*
   * Only task blocks are persisted to
   * tasks.start_time.
   */
  const taskBlocks =
    blocks.filter(
      (block) =>
        block.kind === "task"
    );

  /*
   * Clear previous active task start times
   * belonging to this schedule date.
   *
   * We identify the date from the stored
   * timestamp prefix so future schedules
   * are not accidentally cleared.
   */
  const oldScheduledTasks =
    tasks.filter((task) => {
      if (!task.start_time) {
        return false;
      }

      return (
        String(
          task.start_time
        ).slice(0, 10) ===
        scheduleDate
      );
    });

  for (
    const task of oldScheduledTasks
  ) {
    const { error } =
      await supabase
        .from("tasks")
        .update({
          start_time: null,
        })
        .eq(
          "id",
          task.id
        )
        .eq(
          "user_id",
          userId
        );

    if (error) {
      throw new Error(
        `Failed to clear old schedule for ${task.title}: ${error.message}`
      );
    }
  }

  /*
   * Save the new task start times.
   */
  for (
    const block of taskBlocks
  ) {
    const startTime =
      `${scheduleDate}T${block.start}:00`;

    const { error } =
      await supabase
        .from("tasks")
        .update({
          start_time:
            startTime,
        })
        .eq(
          "id",
          block.task_id
        )
        .eq(
          "user_id",
          userId
        );

    if (error) {
      throw new Error(
        `Failed to save schedule for ${block.title}: ${error.message}`
      );
    }
  }

  /*
   * The schedules table becomes the authoritative
   * generated timeline for the Schedule page.
   *
   * The project already contains this table.
   */
  const { data: existingSchedules, error: findError } =
    await supabase
      .from("schedules")
      .select("id")
      .eq(
        "user_id",
        userId
      )
      .eq(
        "schedule_date",
        scheduleDate
      );

  if (findError) {
    throw new Error(
      `Failed to read existing schedule: ${findError.message}`
    );
  }

  if (
    existingSchedules &&
    existingSchedules.length > 0
  ) {
    /*
     * Update all existing rows for the date.
     *
     * This also repairs duplicate schedule
     * rows left by older versions.
     */
    const { error: updateError } =
      await supabase
        .from("schedules")
        .update({
          timeline: blocks,
        })
        .eq(
          "user_id",
          userId
        )
        .eq(
          "schedule_date",
          scheduleDate
        );

    if (updateError) {
      throw new Error(
        `Failed to update saved schedule: ${updateError.message}`
      );
    }
  } else {
    const { error: insertError } =
      await supabase
        .from("schedules")
        .insert({
          user_id:
            userId,
          schedule_date:
            scheduleDate,
          timeline:
            blocks,
        });

    if (insertError) {
      throw new Error(
        `Failed to save generated schedule: ${insertError.message}`
      );
    }
  }
}

/* =========================================================
   FINAL VALIDATION
   ========================================================= */

function validateBlocks(
  blocks: Block[],
  startMin: number,
  endMin: number
): Block[] {
  const sorted = [...blocks].sort(
    (a, b) => {
      const startDiff =
        parseHHMM(a.start) -
        parseHHMM(b.start);

      if (startDiff !== 0) {
        return startDiff;
      }

      return (
        parseHHMM(a.end) -
        parseHHMM(b.end)
      );
    }
  );

  const result: Block[] = [];
  const seenTaskIds =
    new Set<string>();

  for (const block of sorted) {
    const start =
      parseHHMM(block.start);

    const end =
      parseHHMM(block.end);

    if (
      start < startMin ||
      end > endMin ||
      end <= start
    ) {
      throw new Error(
        `Invalid block outside work window: ${block.title}`
      );
    }

    if (
      block.kind === "task"
    ) {
      if (
        seenTaskIds.has(
          block.task_id
        )
      ) {
        throw new Error(
          `Duplicate task in generated schedule: ${block.title}`
        );
      }

      seenTaskIds.add(
        block.task_id
      );
    }

    const previous =
      result.length > 0
        ? result[
            result.length - 1
          ]
        : null;

    if (previous) {
      const previousEnd =
        parseHHMM(
          previous.end
        );

      if (
        start <
        previousEnd
      ) {
        throw new Error(
          `Overlapping schedule detected between "${previous.title}" and "${block.title}".`
        );
      }
    }

    result.push(
      block
    );
  }

  return result;
}

/* =========================================================
   MAIN EDGE FUNCTION
   ========================================================= */


/* =========================================================
   ADAPTIVE: unfinished detection + local reschedule
   ========================================================= */

type Occupied = { start: number; end: number; taskId?: string };

function buildOccupiedFromTasks(
  tasks: Task[],
  scheduleDate: string,
  excludeIds: Set<string>,
  breakStyle: string,
  startMin: number,
  endMin: number,
): Occupied[] {
  const occ: Occupied[] = [];
  for (const b of getBreakBlocks(breakStyle)) {
    if (b.start >= startMin && b.start + b.dur <= endMin) {
      occ.push({ start: b.start, end: b.start + b.dur });
    }
  }
  for (const task of tasks) {
    if (excludeIds.has(task.id)) continue;
    if (!task.start_time) continue;
    if (String(task.start_time).slice(0, 10) !== scheduleDate) continue;
    const timePart = String(task.start_time).includes("T")
      ? String(task.start_time).split("T")[1].slice(0, 5)
      : null;
    if (!timePart) continue;
    const sm = parseHHMM(timePart);
    const dur = durationOf(task);
    occ.push({ start: sm, end: sm + dur, taskId: task.id });
  }
  return occ.sort((a, b) => a.start - b.start);
}

function findFreeSlot(
  duration: number,
  occupied: Occupied[],
  workStart: number,
  workEnd: number,
  notBefore: number,
): { start: number; end: number } | null {
  if (duration <= 0) return null;
  let cursor = Math.max(workStart, notBefore);
  const blocked = [...occupied].sort((a, b) => a.start - b.start);
  for (let guard = 0; guard < 2000 && cursor + duration <= workEnd; guard++) {
    let hit: Occupied | null = null;
    for (const b of blocked) {
      if (cursor < b.end && cursor + duration > b.start) {
        hit = b;
        break;
      }
    }
    if (!hit) return { start: cursor, end: cursor + duration };
    cursor = Math.max(cursor + 1, hit.end);
  }
  return null;
}

type AdaptiveMove = {
  task_id: string;
  title: string;
  original_start: string | null;
  original_end: string | null;
  completed_minutes: number;
  remaining_minutes: number;
  new_start: string | null;
  new_end: string | null;
  status: "rescheduled" | "needs_rescheduling" | "completed";
  reason: string;
};

/**
 * Apply remaining durations from time_entries and detect unfinished scheduled tasks
 * whose planned end is in the past.
 */
function applyRemainingDurations(
  tasks: Task[],
  completedByTask: Map<string, number>,
  scheduleDate: string,
  now: Date,
): { tasks: Task[]; unfinishedIds: string[]; movesSeed: AdaptiveMove[] } {
  const unfinishedIds: string[] = [];
  const movesSeed: AdaptiveMove[] = [];
  const adjusted = tasks.map((t) => {
    const est = durationOf(t);
    const done = Math.max(0, completedByTask.get(t.id) || 0);
    const remaining = Math.max(0, est - done);
    if (done >= est && est > 0) {
      // Fully worked — leave for completion handling elsewhere
      movesSeed.push({
        task_id: t.id,
        title: t.title,
        original_start: t.start_time || null,
        original_end: null,
        completed_minutes: done,
        remaining_minutes: 0,
        new_start: null,
        new_end: null,
        status: "completed",
        reason: "Actual work met or exceeded estimated duration.",
      });
      return { ...t, estimated_duration: 0 };
    }
    const next = { ...t, estimated_duration: remaining > 0 ? remaining : est };

    if (
      t.start_time &&
      String(t.start_time).slice(0, 10) === scheduleDate &&
      remaining > 0
    ) {
      const timePart = String(t.start_time).includes("T")
        ? String(t.start_time).split("T")[1].slice(0, 5)
        : "09:00";
      const startM = parseHHMM(timePart);
      const endM = startM + est; // original planned end using original estimate
      const endDate = new Date(`${scheduleDate}T${toHHMM(endM)}:00`);
      // If scheduled end is past and task not done → unfinished
      if (endDate.getTime() <= now.getTime()) {
        unfinishedIds.push(t.id);
        movesSeed.push({
          task_id: t.id,
          title: t.title,
          original_start: timePart,
          original_end: toHHMM(endM),
          completed_minutes: done,
          remaining_minutes: remaining,
          new_start: null,
          new_end: null,
          status: "needs_rescheduling",
          reason:
            "Task was unfinished during its scheduled period. Remaining work needs a valid slot.",
        });
      }
    }
    return next;
  }).filter((t) => (t.estimated_duration || 0) > 0 || unfinishedIds.includes(t.id));

  // Keep unfinished even if remaining was set
  return { tasks: adjusted.filter((t) => durationOf(t) > 0), unfinishedIds, movesSeed };
}

function localRescheduleUnfinished(
  tasks: Task[],
  unfinishedIds: string[],
  scheduleDate: string,
  startMin: number,
  endMin: number,
  breakStyle: string,
  movesSeed: AdaptiveMove[],
): { blocks: Block[]; moves: AdaptiveMove[]; allPlaced: boolean } {
  const unfinishedSet = new Set(unfinishedIds);
  const occupied = buildOccupiedFromTasks(
    tasks,
    scheduleDate,
    unfinishedSet,
    breakStyle,
    startMin,
    endMin,
  );

  // Existing blocks for non-unfinished tasks
  const blocks: Block[] = [];
  for (const o of occupied) {
    if (o.taskId) {
      const task = tasks.find((x) => x.id === o.taskId);
      blocks.push({
        task_id: o.taskId,
        title: task?.title || "Task",
        start: toHHMM(o.start),
        end: toHHMM(o.end),
        category: task?.category || "General",
        kind: "task",
      });
    } else {
      blocks.push({
        task_id: `break-${o.start}`,
        title: "Break",
        start: toHHMM(o.start),
        end: toHHMM(o.end),
        category: "Break",
        kind: "break",
      });
    }
  }

  const moves: AdaptiveMove[] = movesSeed.map((m) => ({ ...m }));
  let allPlaced = true;
  const nowMin =
    new Date().getHours() * 60 + new Date().getMinutes();

  // Sort unfinished by priority_score desc then due date
  const unfinishedTasks = tasks
    .filter((t) => unfinishedSet.has(t.id))
    .sort((a, b) => {
      const pd = (b.priority_score || 0) - (a.priority_score || 0);
      if (pd !== 0) return pd;
      const ad = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const bd = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      return ad - bd;
    });

  for (const task of unfinishedTasks) {
    const dur = durationOf(task);
    // Prefer later today after now
    let slot = findFreeSlot(dur, occupied, startMin, endMin, Math.max(startMin, nowMin));
    // Else any free slot today in work window
    if (!slot) {
      slot = findFreeSlot(dur, occupied, startMin, endMin, startMin);
    }

    const move = moves.find((m) => m.task_id === task.id);
    if (slot) {
      occupied.push({ start: slot.start, end: slot.end, taskId: task.id });
      occupied.sort((a, b) => a.start - b.start);
      blocks.push({
        task_id: task.id,
        title: task.title,
        start: toHHMM(slot.start),
        end: toHHMM(slot.end),
        category: task.category || "General",
        kind: "task",
      });
      if (move) {
        move.new_start = toHHMM(slot.start);
        move.new_end = toHHMM(slot.end);
        move.status = "rescheduled";
        move.reason =
          "Task was unfinished during its scheduled period. Remaining work was moved to the next valid available time slot.";
      }
    } else {
      allPlaced = false;
      if (move) {
        move.status = "needs_rescheduling";
        move.reason =
          "No valid time slot is available before the deadline on this day.";
      }
    }
  }

  blocks.sort((a, b) => parseHHMM(a.start) - parseHHMM(b.start));
  return { blocks, moves, allPlaced };
}


serve(async (req) => {
  if (
    req.method ===
    "OPTIONS"
  ) {
    return new Response(
      null,
      {
        headers:
          corsHeaders,
      }
    );
  }

  try {
    const authHeader =
      req.headers.get(
        "authorization"
      );

    const supabase =
      createClient(
        Deno.env.get(
          "SUPABASE_URL"
        )!,
        Deno.env.get(
          "SUPABASE_ANON_KEY"
        )!,
        {
          global: {
            headers: {
              Authorization:
                authHeader || "",
            },
          },
        }
      );

    const {
      data: {
        user,
      },
    } =
      await supabase.auth.getUser();

    if (!user) {
      return new Response(
        JSON.stringify({
          error:
            "Unauthorized",
        }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        }
      );
    }

    /* =====================================================
       REQUEST
       ===================================================== */

    let body: any = {};

    try {
      body =
        await req.json();
    } catch {
      body = {};
    }

    const scheduleDate =
      typeof body?.schedule_date ===
        "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(
        body.schedule_date
      )
        ? body.schedule_date
        : new Date()
            .toISOString()
            .slice(0, 10);

    /* =====================================================
       TASKS
       ===================================================== */

    const {
      data: allTasks,
      error: tasksError,
    } =
      await supabase
        .from("tasks")
        .select(
          "id, title, category, difficulty, estimated_duration, due_date, start_time, priority_score, status, archived"
        )
        .eq(
          "user_id",
          user.id
        )
        .or(
          "archived.eq.false,archived.is.null"
        )
        .neq(
          "status",
          "done"
        );

    if (tasksError) {
      throw tasksError;
    }

    let tasks =
      uniqueTasks(
        (allTasks || []).filter(
          (task: Task) =>
            task.archived !==
              true &&
            task.status !==
              "done"
        )
      );

    if (
      tasks.length === 0
    ) {
      return new Response(
        JSON.stringify({
          blocks: [],
          deferred: [],
          task_count: 0,
          task_ids: [],
          scheduled_count: 0,
          deferred_count: 0,
          algorithm:
            "csp + pso-random-key + peak-aware",
          timestamp:
            new Date().toISOString(),
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type":
              "application/json",
          },
        }
      );
    }

    /* =====================================================
       PROFILE
       ===================================================== */

    const {
      data: profile,
    } =
      await supabase
        .from("profiles")
        .select(
          "work_start, work_end, peak_start, peak_end, break_style"
        )
        .eq(
          "id",
          user.id
        )
        .maybeSingle();

    const workStart =
      profile?.work_start ||
      "09:00";

    const workEnd =
      profile?.work_end ||
      "17:00";

    const peakStart =
      profile?.peak_start ||
      workStart;

    const peakEnd =
      profile?.peak_end ||
      "12:00";

    const breakStyle =
      profile?.break_style ||
      "pomodoro";

    const startMin =
      parseHHMM(
        workStart
      );

    const endMin =
      parseHHMM(
        workEnd
      );

    const peakStartMin =
      parseHHMM(
        peakStart
      );

    const peakEndMin =
      parseHHMM(
        peakEnd
      );

    if (
      endMin <=
      startMin
    ) {
      throw new Error(
        "Work end time must be later than work start time."
      );
    }

    const isAdaptive = body?.adaptive === true;

    /* =====================================================
       ADAPTIVE: remaining duration + local reschedule
       ===================================================== */

    let adaptiveMoves: AdaptiveMove[] = [];

    if (isAdaptive) {
      // Actual work from time_entries (user-scoped)
      const { data: entries } = await supabase
        .from("time_entries")
        .select("task_id, duration, start_time, end_time")
        .eq("user_id", user.id);

      const completedByTask = new Map<string, number>();
      for (const e of entries || []) {
        if (!e.task_id) continue;
        let mins = Number(e.duration) || 0;
        if (mins <= 0 && e.start_time && e.end_time) {
          mins = Math.max(
            0,
            Math.round(
              (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) /
                60000,
            ),
          );
        }
        completedByTask.set(
          e.task_id,
          (completedByTask.get(e.task_id) || 0) + mins,
        );
      }

      const applied = applyRemainingDurations(
        tasks,
        completedByTask,
        scheduleDate,
        new Date(),
      );
      // Replace tasks with remaining-duration versions
      tasks = applied.tasks;
      adaptiveMoves = applied.movesSeed;

      if (applied.unfinishedIds.length > 0) {
        const local = localRescheduleUnfinished(
          tasks,
          applied.unfinishedIds,
          scheduleDate,
          startMin,
          endMin,
          breakStyle,
          adaptiveMoves,
        );
        adaptiveMoves = local.moves;

        if (local.allPlaced) {
          const validatedBlocks = validateBlocks(
            local.blocks,
            startMin,
            endMin,
          );
          await persistSchedule(
            supabase,
            user.id,
            tasks,
            validatedBlocks,
            scheduleDate,
          );

          // Task history notes (best-effort)
          for (const m of adaptiveMoves) {
            if (m.status !== "rescheduled") continue;
            try {
              await supabase.from("task_history").insert({
                task_id: m.task_id,
                user_id: user.id,
                note: m.reason,
                changes: {
                  type: "adaptive_reschedule",
                  completed_minutes: m.completed_minutes,
                  remaining_minutes: m.remaining_minutes,
                  new_start: m.new_start,
                  new_end: m.new_end,
                },
              });
            } catch {
              /* optional table */
            }
          }

          return new Response(
            JSON.stringify({
              blocks: validatedBlocks,
              task_count: tasks.length,
              task_ids: tasks.map((t) => t.id),
              deferred: adaptiveMoves
                .filter((m) => m.status === "needs_rescheduling")
                .map((m) => ({
                  task_id: m.task_id,
                  title: m.title,
                  duration: m.remaining_minutes,
                  status: "needs_rescheduling",
                })),
              adaptive_moves: adaptiveMoves,
              adaptive: true,
              pso: null,
              window: {
                start: workStart,
                end: workEnd,
                peak_start: peakStart,
                peak_end: peakEnd,
                break_style: breakStyle,
                schedule_date: scheduleDate,
              },
              scheduled_count: validatedBlocks.filter((b) => b.kind === "task")
                .length,
              deferred_count: adaptiveMoves.filter(
                (m) => m.status === "needs_rescheduling",
              ).length,
              algorithm: "adaptive-local + csp-validate",
              timestamp: new Date().toISOString(),
              note:
                "Local adaptive reschedule used remaining duration from time entries; other tasks kept in place.",
            }),
            {
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }
        // else fall through to full PSO+CSP with remaining durations
      }
    }

    /* =====================================================
       URGENCY ORDER
       ===================================================== */

    const orderedInput =
      [...tasks].sort(
        (a, b) => {
          const aDue =
            a.due_date
              ? new Date(
                  a.due_date
                ).getTime()
              : Number.POSITIVE_INFINITY;

          const bDue =
            b.due_date
              ? new Date(
                  b.due_date
                ).getTime()
              : Number.POSITIVE_INFINITY;

          if (
            aDue !==
            bDue
          ) {
            return (
              aDue - bDue
            );
          }

          return (
            (b.priority_score ||
              0) -
            (a.priority_score ||
              0)
          );
        }
      );

    /* =====================================================
       PSO
       ===================================================== */

    const {
      order,
      best,
    } =
      pso(
        orderedInput,
        startMin,
        endMin,
        peakStartMin,
        peakEndMin,
        breakStyle,
        scheduleDate
      );

    const ordered =
      order.map(
        (index) =>
          orderedInput[
            index
          ]
      );

    /* =====================================================
       CSP
       ===================================================== */

    const cspResult =
      csp(
        ordered,
        startMin,
        endMin,
        breakStyle
      );

    const validatedBlocks =
      validateBlocks(
        cspResult.blocks,
        startMin,
        endMin
      );

    const scheduledIds =
      new Set(
        validatedBlocks
          .filter(
            (block) =>
              block.kind ===
              "task"
          )
          .map(
            (block) =>
              block.task_id
          )
      );

    const deferred =
      ordered.filter(
        (task) =>
          !scheduledIds.has(
            task.id
          )
      );

    /* =====================================================
       SAVE
       ===================================================== */

    await persistSchedule(
      supabase,
      user.id,
      tasks,
      validatedBlocks,
      scheduleDate
    );

    /* =====================================================
       RESPONSE
       ===================================================== */

    return new Response(
      JSON.stringify({
        blocks:
          validatedBlocks,

        deferred:
          deferred.map(
            (task) => ({
              task_id:
                task.id,
              title:
                task.title,
              duration:
                durationOf(task),
              priority:
                task.priority_score ??
                null,
              status:
                task.status ||
                "todo",
            })
          ),

        pso: {
          fitness:
            best,
          iterations: 60,
          swarm_size: 25,
          inertia_weight:
            0.7,
          cognitive:
            1.5,
          social:
            1.5,
        },

        window: {
          start:
            workStart,
          end:
            workEnd,
          peak_start:
            peakStart,
          peak_end:
            peakEnd,
          break_style:
            breakStyle,
          schedule_date:
            scheduleDate,
        },

        scheduled_count:
          scheduledIds.size,

        deferred_count:
          deferred.length,

        algorithm:
          "csp + pso-random-key + peak-aware",

        timestamp:
          new Date().toISOString(),
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type":
            "application/json",
        },
      }
    );
  } catch (error) {
    console.error(
      "generate-schedule error:",
      error
    );

    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : String(error),
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type":
            "application/json",
        },
      }
    );
  }
});
