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
  segment_index?: number;
  segment_total?: number;
  priority_score?: number;
  priority?: "High" | "Medium" | "Low";
  overdue?: boolean;
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
   PRIORITY FALLBACK / URGENCY
   ========================================================= */

const AHP_MATRIX: number[][] = [
  [1, 3, 4, 5],
  [1 / 3, 1, 2, 3],
  [1 / 4, 1 / 2, 1, 2],
  [1 / 5, 1 / 3, 1 / 2, 1],
];

const AHP_CATEGORY_IMPORTANCE: Record<string, number> = {
  "Exam Review": 1.0, "Assignment": 0.95, "Project": 0.9, "Lab Work": 0.85,
  "Presentation": 0.85, "Client Communication": 0.9, "Invoicing": 0.85,
  "Proposal Writing": 0.85, "Customer Support": 0.8, "Research": 0.75,
  "Research Task": 0.75, "Reading": 0.6, "Finance": 0.8, "Health": 0.85,
  "Email Management": 0.5, "Calendar Scheduling": 0.55, "Project Tracking": 0.6,
  "Social Media Management": 0.6, "Content Creation": 0.65, "Graphic Design": 0.65,
  "Video Editing": 0.6, "Data Entry": 0.5, "Bookkeeping": 0.65, "Lead Generation": 0.65,
  "Transcription": 0.55, "Translation": 0.6, "SEO Optimization": 0.6,
  "Website Maintenance": 0.6, "Meeting Notes": 0.55, "Freelancing": 0.7,
  "Virtual Assistant": 0.6, "Personal": 0.4, "Errands": 0.4, "Chores": 0.35,
  "Social": 0.3, "Fitness": 0.45, "General": 0.5,
};

function ahpWeights(): number[] {
  let v = [0.25, 0.25, 0.25, 0.25];
  for (let i = 0; i < 100; i++) {
    const next = v.map((_, r) => AHP_MATRIX[r].reduce((sum, value, c) => sum + value * v[c], 0));
    const total = next.reduce((a, b) => a + b, 0) || 1;
    v = next.map((x) => x / total);
  }
  return v;
}

function ahpDeadlineScore(due?: string | null): number {
  if (!due) return 0.15;
  const hours = (new Date(due).getTime() - Date.now()) / 3_600_000;
  if (hours < 0) return 1.0;
  if (hours < 24) return 0.9;
  if (hours < 72) return 0.7;
  if (hours < 168) return 0.45;
  if (hours < 336) return 0.25;
  return 0.1;
}

function ahpDifficultyScore(difficulty?: string | null): number {
  const d = String(difficulty || "medium").toLowerCase();
  return d === "hard" ? 1 : d === "easy" ? 0.3 : 0.6;
}

function ahpDurationScore(minutes?: number | null): number {
  const m = Number(minutes) || 30;
  if (m <= 15) return 1;
  if (m <= 30) return 0.8;
  if (m <= 60) return 0.6;
  if (m <= 120) return 0.4;
  return 0.2;
}

function fallbackAHPScore(task: Task): number {
  const w = ahpWeights();
  const c1 = ahpDeadlineScore(task.due_date);
  const c2 = ahpDifficultyScore(task.difficulty);
  const c3 = ahpDurationScore(task.estimated_duration);
  const c4 = AHP_CATEGORY_IMPORTANCE[task.category || "General"] ?? 0.5;
  return Math.round((c1 * w[0] + c2 * w[1] + c3 * w[2] + c4 * w[3]) * 1000) / 10;
}

function effectivePriorityScore(task: Task): number {
  const stored = Number(task.priority_score);
  return Number.isFinite(stored) && stored > 0 ? stored : fallbackAHPScore(task);
}

function isOverdue(task: Task): boolean {
  if (!task.due_date) return false;
  return new Date(task.due_date).getTime() < Date.now();
}

function priorityTier(task: Task): number {
  const score = effectivePriorityScore(task);
  return score >= 65 ? 3 : score >= 40 ? 2 : 1;
}

/*
 * Priority rule used by Auto Schedule and Adaptive Scheduling:
 * 1) Higher AHP priority always comes first.
 * 2) Within the same priority, a task that is not overdue comes first.
 *    This keeps a current high-priority one-time task ahead of an overdue
 *    high-priority task, while an overdue high task still beats a current
 *    medium task because HIGH is a higher tier.
 * 3) Earlier deadlines then higher AHP score break remaining ties.
 */
function comparePriority(a: Task, b: Task): number {
  const tierDiff = priorityTier(b) - priorityTier(a);
  if (tierDiff !== 0) return tierDiff;

  const overdueDiff = Number(isOverdue(a)) - Number(isOverdue(b));
  if (overdueDiff !== 0) return overdueDiff;

  const ad = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
  const bd = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
  if (ad !== bd) return ad - bd;

  return effectivePriorityScore(b) - effectivePriorityScore(a);
}

function sortByPriority(tasks: Task[]): Task[] {
  return [...tasks].sort(comparePriority);
}

function priorityLabel(task: Task): "High" | "Medium" | "Low" {
  const tier = priorityTier(task);
  return tier === 3 ? "High" : tier === 2 ? "Medium" : "Low";
}

function latestEndForTask(task: Task, scheduleDate: string, fallbackEnd: number): number {
  if (!task.due_date) return fallbackEnd;
  const dueMs = new Date(task.due_date).getTime();
  // An overdue task is already past its deadline, so do not prevent the
  // scheduler from giving it a recovery slot today.
  if (Number.isFinite(dueMs) && dueMs < Date.now()) return fallbackEnd;
  const due = String(task.due_date);
  if (due.slice(0, 10) !== scheduleDate) return fallbackEnd;
  const timePart = due.includes("T") ? due.split("T")[1]?.slice(0, 5) : "23:59";
  const dueMin = parseHHMM(timePart || "23:59");
  return Math.min(fallbackEnd, dueMin);
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
  breakStyle: string,
  scheduleDateForCSP = "",
  notBefore = startMin,
): CSPResult {
  const blocks: Block[] = [];
  const scheduledTaskIds: string[] = [];
  const unique = uniqueTasks(tasks);
  const breaks = getBreakBlocks(breakStyle)
    .filter((b) => b.start >= startMin && b.start + b.dur <= endMin)
    .sort((a, b) => a.start - b.start);

  const occupied: Array<{ start: number; end: number; taskId?: string }> = breaks.map((b) => ({
    start: b.start,
    end: b.start + b.dur,
  }));

  const addTaskBlock = (task: Task, start: number, end: number) => {
    blocks.push({
      task_id: task.id,
      title: task.title,
      start: toHHMM(start),
      end: toHHMM(end),
      category: task.category || "General",
      kind: "task",
    });
    occupied.push({ start, end, taskId: task.id });
    occupied.sort((a, b) => a.start - b.start);
  };

  for (const b of breaks) {
    blocks.push({
      task_id: `break-${b.start}`,
      title: b.title,
      start: toHHMM(b.start),
      end: toHHMM(b.start + b.dur),
      category: "Break",
      kind: "break",
    });
  }

  /*
   * CSP uses the available capacity instead of requiring one large
   * continuous block. A long flexible task may therefore use several
   * valid work periods around fixed breaks. This is the important change
   * for 120–480 minute tasks on a normal workday.
   */
  for (const task of unique) {
    let remaining = durationOf(task);
    const latestEnd = latestEndForTask(task, scheduleDateForCSP, endMin);

    while (remaining > 0) {
      const sorted = [...occupied].sort((a, b) => a.start - b.start);
      let cursor = Math.max(startMin, notBefore);
      let placed = false;

      for (const blocked of sorted) {
        if (blocked.end <= cursor) continue;
        if (blocked.start > cursor) {
          const freeEnd = Math.min(blocked.start, latestEnd);
          const available = Math.max(0, freeEnd - cursor);
          if (available > 0) {
            const take = Math.min(remaining, available);
            addTaskBlock(task, cursor, cursor + take);
            remaining -= take;
            placed = true;
            break;
          }
        }
        cursor = Math.max(cursor, blocked.end);
        if (cursor >= endMin) break;
      }

      if (!placed && cursor < latestEnd) {
        const available = latestEnd - cursor;
        if (available > 0) {
          const take = Math.min(remaining, available);
          addTaskBlock(task, cursor, cursor + take);
          remaining -= take;
          placed = true;
        }
      }

      if (!placed) break;
      // A single-task segment is enough to continue; this flag exists to
      // document that later segments are intentional, not duplicate tasks.
      notBefore = startMin;
    }

    if (remaining <= 0) scheduledTaskIds.push(task.id);
  }

  const segmentCounts = new Map<string, number>();
  for (const block of blocks) {
    if (block.kind === "task") {
      segmentCounts.set(block.task_id, (segmentCounts.get(block.task_id) || 0) + 1);
    }
  }
  const segmentSeen = new Map<string, number>();
  for (const block of blocks) {
    if (block.kind !== "task") continue;
    const task = unique.find((t) => t.id === block.task_id);
    const idx = (segmentSeen.get(block.task_id) || 0) + 1;
    segmentSeen.set(block.task_id, idx);
    block.segment_index = idx;
    block.segment_total = segmentCounts.get(block.task_id) || 1;
    block.priority_score = task ? effectivePriorityScore(task) : undefined;
    block.priority = task ? priorityLabel(task) : undefined;
    block.overdue = task ? isOverdue(task) : false;
  }

  blocks.sort((a, b) => {
    const diff = parseHHMM(a.start) - parseHHMM(b.start);
    return diff !== 0 ? diff : parseHHMM(a.end) - parseHHMM(b.end);
  });

  // Final safety validation: overlaps are never returned.
  const validBlocks: Block[] = [];
  const validTaskIds = new Set<string>();
  for (const block of blocks) {
    const start = parseHHMM(block.start);
    const end = parseHHMM(block.end);
    if (start < startMin || end > endMin || end <= start) continue;
    const previous = validBlocks.length ? validBlocks[validBlocks.length - 1] : null;
    if (previous && start < parseHHMM(previous.end)) continue;
    validBlocks.push(block);
    if (block.kind === "task") validTaskIds.add(block.task_id);
  }

  return {
    blocks: validBlocks,
    scheduledTaskIds: [...validTaskIds].filter((id) => {
      const task = unique.find((t) => t.id === id);
      if (!task) return false;
      const total = validBlocks
        .filter((b) => b.kind === "task" && b.task_id === id)
        .reduce((sum, b) => sum + parseHHMM(b.end) - parseHHMM(b.start), 0);
      return total >= durationOf(task);
    }),
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
    breakStyle,
    scheduleDate,
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
  const taskBlocks = blocks.filter((block) => block.kind === "task");
  const firstTaskBlock = new Map<string, Block>();
  for (const block of taskBlocks) {
    if (!firstTaskBlock.has(block.task_id)) firstTaskBlock.set(block.task_id, block);
  }

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
    const block of firstTaskBlock.values()
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



type BehavioralProfile = {
  peakStartMin: number;
  peakEndMin: number;
  avgActualMinutes: number;
  completionRate: number;
  actualMinutes: number;
  completedSessions: number;
  evidenceLevel: "limited" | "learning";
};

function localHourMinute(iso: string, timeZone: string): { hour: number; minute: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(iso));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
    const hour = get("hour"), minute = get("minute");
    return Number.isFinite(hour) && Number.isFinite(minute) ? { hour, minute } : null;
  } catch {
    return null;
  }
}

function buildBehavioralProfile(
  timeEntries: any[],
  completedTasks: any[],
  timeZone: string,
  fallbackStart: number,
  fallbackEnd: number,
  totalTaskCount?: number,
): BehavioralProfile {
  const histogram = new Array(24).fill(0);
  let actualMinutes = 0;
  let completedSessions = 0;

  for (const e of timeEntries || []) {
    const mins = Number(e.duration) || (e.start_time
      ? Math.max(0, Math.round(((e.end_time ? new Date(e.end_time).getTime() : Date.now()) - new Date(e.start_time).getTime()) / 60000))
      : 0);
    if (!e.start_time || mins <= 0) continue;
    const hm = localHourMinute(e.start_time, timeZone);
    if (!hm) continue;
    histogram[hm.hour] += Math.min(180, mins);
    actualMinutes += mins;
    completedSessions += 1;
  }

  for (const t of completedTasks || []) {
    const when = t.completed_at || t.updated_at;
    if (!when) continue;
    const hm = localHourMinute(when, timeZone);
    if (!hm) continue;
    // A completed task is a stronger success signal than mere activity.
    histogram[hm.hour] += 45;
  }

  const sampleCount = completedSessions + (completedTasks || []).length;
  const enoughEvidence = completedSessions >= 2 || actualMinutes >= 90 || (completedTasks || []).length >= 2;

  let bestHour = Math.floor(fallbackStart / 60);
  let bestScore = -1;
  for (let h = 0; h < 24; h++) {
    const score = histogram[h] + histogram[(h + 1) % 24] * 0.65;
    if (score > bestScore) {
      bestScore = score;
      bestHour = h;
    }
  }

  const avgActualMinutes = timeEntries?.length
    ? Math.round(actualMinutes / Math.max(1, completedSessions))
    : 0;

  const total = Math.max(0, Number(totalTaskCount ?? (completedTasks || []).length));
  const completionRate = total > 0 ? Math.min(1, (completedTasks || []).length / total) : 0;

  return {
    peakStartMin: enoughEvidence ? bestHour * 60 : fallbackStart,
    peakEndMin: enoughEvidence ? Math.min(bestHour * 60 + 120, 24 * 60) : fallbackEnd,
    avgActualMinutes,
    completionRate,
    actualMinutes,
    completedSessions: sampleCount,
    evidenceLevel: enoughEvidence ? "learning" : "limited",
  };
}

function localRescheduleUnfinished(
  tasks: Task[],
  unfinishedIds: string[],
  scheduleDate: string,
  startMin: number,
  endMin: number,
  breakStyle: string,
  movesSeed: AdaptiveMove[],
  peakStartMin: number,
  peakEndMin: number,
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
  const unfinishedTasks = sortByPriority(
    tasks.filter((t) => unfinishedSet.has(t.id))
  );

  for (const task of unfinishedTasks) {
    const dur = durationOf(task);
    const difficulty = String(task.difficulty || "medium").toLowerCase();
    let preferred = Math.max(startMin, nowMin);
    if (difficulty === "hard") {
      preferred = Math.max(preferred, peakStartMin);
    } else if (difficulty === "easy" && preferred < peakEndMin) {
      preferred = Math.max(preferred, peakEndMin);
    }
    // Prefer a behavior-aligned slot, then fall back to any valid slot today.
    let slot = findFreeSlot(dur, occupied, startMin, endMin, preferred);
    if (!slot) slot = findFreeSlot(dur, occupied, startMin, endMin, Math.max(startMin, nowMin));
    if (!slot) slot = findFreeSlot(dur, occupied, startMin, endMin, startMin);

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
      ).map((task: Task) => ({
        ...task,
        priority_score: effectivePriorityScore(task),
      }));

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
            "csp + pso-random-key + behavior-aware peak scheduling",
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
          "work_start, work_end, peak_start, peak_end, break_style, timezone"
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

    let peakStartMin = parseHHMM(peakStart);
    let peakEndMin = parseHHMM(peakEnd);

    if (
      endMin <=
      startMin
    ) {
      throw new Error(
        "Work end time must be later than work start time."
      );
    }

    const userTz = profile?.timezone || "UTC";
    const [{ data: behaviorEntries }, { data: completedTasksForBehavior }] = await Promise.all([
      supabase.from("time_entries").select("task_id, start_time, end_time, duration").eq("user_id", user.id),
      supabase.from("tasks").select("id, completed_at, updated_at").eq("user_id", user.id).eq("status", "done").or("archived.eq.false,archived.is.null"),
    ]);
    const behavior = buildBehavioralProfile(
      behaviorEntries || [],
      completedTasksForBehavior || [],
      userTz,
      peakStartMin,
      peakEndMin,
      tasks.length + (completedTasksForBehavior || []).length,
    );
    if (behavior.evidenceLevel === "learning") {
      peakStartMin = behavior.peakStartMin;
      peakEndMin = behavior.peakEndMin;
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
        /*
         * If an unfinished task outranks a task that currently occupies the
         * schedule, do not simply place it after that task. Rebuild the full
         * schedule so the priority rule can move the lower-priority task.
         */
        const unfinishedTasksForPriority = tasks.filter((t) => applied.unfinishedIds.includes(t.id));
        const existingScheduled = tasks.filter(
          (t) =>
            !applied.unfinishedIds.includes(t.id) &&
            t.start_time &&
            String(t.start_time).slice(0, 10) === scheduleDate
        );
        const priorityConflict = unfinishedTasksForPriority.some((unfinished) =>
          existingScheduled.some((existing) => comparePriority(unfinished, existing) < 0)
        );

        if (!priorityConflict) {
          const local = localRescheduleUnfinished(
          tasks,
          applied.unfinishedIds,
          scheduleDate,
          startMin,
          endMin,
          breakStyle,
          adaptiveMoves,
          peakStartMin,
          peakEndMin,
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
                "Adaptive Scheduling used remaining work from time entries and preserved unaffected tasks when no priority conflict required a full rebuild.",
            }),
            {
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }
                }
// else fall through to full PSO+CSP with remaining durations
      }
    }

    /* =====================================================
       PRIORITY ORDER + PSO
       ===================================================== */

    /*
     * Strict priority tiers are applied before PSO. A HIGH task therefore
     * cannot be pushed behind a MEDIUM/LOW task simply because another
     * scheduling factor scored better. Within the same tier, a current
     * task comes before an overdue task. Thus HIGH-current is first, then
     * HIGH-overdue, then MEDIUM-current, and so on.
     */
    const priorityGroups: Task[][] = [];
    const groupKeys = [
      "high-current", "high-overdue",
      "medium-current", "medium-overdue",
      "low-current", "low-overdue",
    ];

    for (const key of groupKeys) {
      const [tierName, overdueName] = key.split("-");
      const tier = tierName === "high" ? 3 : tierName === "medium" ? 2 : 1;
      const overdue = overdueName === "overdue";
      const group = tasks.filter(
        (task) => priorityTier(task) === tier && isOverdue(task) === overdue
      );
      if (group.length) priorityGroups.push(group);
    }

    const orderedInput = priorityGroups.flatMap((group) => {
      const seed = sortByPriority(group);
      const { order } = pso(
        seed,
        startMin,
        endMin,
        peakStartMin,
        peakEndMin,
        breakStyle,
        scheduleDate
      );
      return order.map((index) => seed[index]);
    });

    // Keep the priority-group order intact after PSO.
    const ordered = orderedInput;
    const best = fitness(
      ordered,
      startMin,
      endMin,
      peakStartMin,
      peakEndMin,
      breakStyle,
      scheduleDate
    );

    /* =====================================================
       CSP
       ===================================================== */

    const cspResult =
      csp(
        ordered,
        startMin,
        endMin,
        breakStyle,
        scheduleDate,
      );

    const validatedBlocks =
      validateBlocks(
        cspResult.blocks,
        startMin,
        endMin
      );

    const scheduledMinutes = new Map<string, number>();
    for (const block of validatedBlocks) {
      if (block.kind !== "task") continue;
      const minutes = Math.max(0, parseHHMM(block.end) - parseHHMM(block.start));
      scheduledMinutes.set(block.task_id, (scheduledMinutes.get(block.task_id) || 0) + minutes);
    }

    const scheduledIds = new Set(
      ordered
        .filter((task) => (scheduledMinutes.get(task.id) || 0) >= durationOf(task))
        .map((task) => task.id)
    );

    const partial = ordered.filter((task) => {
      const done = scheduledMinutes.get(task.id) || 0;
      return done > 0 && done < durationOf(task);
    });

    const deferred = ordered.filter((task) => !scheduledIds.has(task.id));

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
                Math.max(0, durationOf(task) - (scheduledMinutes.get(task.id) || 0)),
              priority:
                task.priority_score ??
                null,
              priority_label:
                priorityLabel(task),
              due_date:
                task.due_date || null,
              overdue:
                isOverdue(task),
              scheduled_minutes:
                scheduledMinutes.get(task.id) || 0,
              status:
                partial.some((t) => t.id === task.id)
                  ? "partially_scheduled"
                  : "deferred",
            })
          ),

        task_summary: ordered.map((task) => {
          const scheduled = scheduledMinutes.get(task.id) || 0;
          return {
            task_id: task.id,
            title: task.title,
            duration: durationOf(task),
            scheduled_minutes: scheduled,
            remaining_minutes: Math.max(0, durationOf(task) - scheduled),
            priority: task.priority_score ?? null,
            priority_label: priorityLabel(task),
            due_date: task.due_date || null,
            overdue: isOverdue(task),
            status: scheduled >= durationOf(task)
              ? "scheduled"
              : scheduled > 0
                ? "partially_scheduled"
                : "deferred",
          };
        }),

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

        partial_count:
          partial.length,

        deferred_count:
          deferred.length,

        algorithm:
          "priority-aware csp + pso-random-key + behavior-aware peak scheduling",
        behavior_profile: {
          evidence_level: behavior.evidenceLevel,
          actual_minutes: behavior.actualMinutes,
          average_actual_minutes: behavior.avgActualMinutes,
          completed_sessions: behavior.completedSessions,
          learned_peak_start: toHHMM(behavior.peakStartMin),
          learned_peak_end: toHHMM(behavior.peakEndMin),
        },

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
