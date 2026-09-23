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
  category?: string;
  difficulty?: string;
  estimated_duration?: number;
  due_date?: string | null;
  start_time?: string | null;
  priority_score?: number | null;
  status?: string;
  archived?: boolean;
};

type Block = {
  task_id: string;
  title: string;
  start: string;
  end: string;
  category: string;
  kind?: "task" | "break";
};

function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
}

function toHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/* =========================================================
   BREAK STYLE
   ========================================================= */

type BreakStyle =
  | "pomodoro"
  | "long-focus"
  | "flexible";

type BreakBlock = {
  start: number;
  dur: number;
  title: string;
};

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

  return (
    BREAK_STYLES[style] ??
    BREAK_STYLES.pomodoro
  );
}

/* =========================================================
   CSP RESULT
   ========================================================= */

type CSPResult = {
  blocks: Block[];
  scheduledTaskIds: string[];
};

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

  let cursor = startMin;

  const breaks = getBreakBlocks(
    breakStyle
  )
    .filter(
      (b) =>
        b.start >= startMin &&
        b.start + b.dur <= endMin
    )
    .sort(
      (a, b) => a.start - b.start
    );

  let breakIndex = 0;

  /*
   * Add every break that starts before the
   * current cursor.
   */
  const flushPastBreaks = () => {
    while (
      breakIndex < breaks.length
    ) {
      const b = breaks[breakIndex];

      if (
        cursor >=
        b.start + b.dur
      ) {
        breakIndex++;
        continue;
      }

      if (
        cursor >= b.start &&
        cursor < b.start + b.dur
      ) {
        blocks.push({
          task_id: `break-${b.start}`,
          title: b.title,
          start: toHHMM(b.start),
          end: toHHMM(
            b.start + b.dur
          ),
          category: "Break",
          kind: "break",
        });

        cursor =
          b.start + b.dur;

        breakIndex++;
        continue;
      }

      break;
    }
  };

  for (const task of tasks) {
    const duration = Math.max(
      5,
      Math.min(
        480,
        task.estimated_duration || 30
      )
    );

    flushPastBreaks();

    /*
     * Find the next break.
     */
    const nextBreak =
      breakIndex < breaks.length
        ? breaks[breakIndex]
        : null;

    /*
     * If the task would cross the next break,
     * place the break first and continue after it.
     */
    if (
      nextBreak &&
      cursor < nextBreak.start &&
      cursor + duration >
        nextBreak.start
    ) {
      blocks.push({
        task_id: `break-${nextBreak.start}`,
        title: nextBreak.title,
        start: toHHMM(
          nextBreak.start
        ),
        end: toHHMM(
          nextBreak.start +
            nextBreak.dur
        ),
        category: "Break",
        kind: "break",
      });

      cursor =
        nextBreak.start +
        nextBreak.dur;

      breakIndex++;
    }

    flushPastBreaks();

    /*
     * If the task cannot fit inside the
     * configured work window, do NOT place it.
     *
     * It will be returned as deferred.
     */
    if (
      cursor + duration >
      endMin
    ) {
      continue;
    }

    /*
     * Final check for another break.
     */
    const followingBreak =
      breakIndex < breaks.length
        ? breaks[breakIndex]
        : null;

    if (
      followingBreak &&
      cursor < followingBreak.start &&
      cursor + duration >
        followingBreak.start
    ) {
      blocks.push({
        task_id: `break-${followingBreak.start}`,
        title: followingBreak.title,
        start: toHHMM(
          followingBreak.start
        ),
        end: toHHMM(
          followingBreak.start +
            followingBreak.dur
        ),
        category: "Break",
        kind: "break",
      });

      cursor =
        followingBreak.start +
        followingBreak.dur;

      breakIndex++;

      if (
        cursor + duration >
        endMin
      ) {
        continue;
      }
    }

    const taskStart = cursor;
    const taskEnd =
      cursor + duration;

    /*
     * Absolute work-window check.
     */
    if (
      taskStart < startMin ||
      taskEnd > endMin
    ) {
      continue;
    }

    /*
     * Check against the previous block.
     */
    const previous =
      blocks.length > 0
        ? blocks[
            blocks.length - 1
          ]
        : null;

    if (previous) {
      const previousEnd =
        parseHHMM(
          previous.end
        );

      if (
        taskStart <
        previousEnd
      ) {
        continue;
      }
    }

    blocks.push({
      task_id: task.id,
      title: task.title,
      start: toHHMM(taskStart),
      end: toHHMM(taskEnd),
      category:
        task.category ||
        "General",
      kind: "task",
    });

    scheduledTaskIds.push(
      task.id
    );

    cursor = taskEnd;
  }

  /*
   * Sort everything chronologically.
   */
  blocks.sort((a, b) => {
    const startDifference =
      parseHHMM(a.start) -
      parseHHMM(b.start);

    if (
      startDifference !== 0
    ) {
      return startDifference;
    }

    return (
      parseHHMM(a.end) -
      parseHHMM(b.end)
    );
  });

  /*
   * Final safety validation.
   *
   * A valid schedule must NEVER contain
   * overlapping blocks.
   */
  const validBlocks: Block[] = [];
  const validTaskIds: string[] =
    [];

  for (const block of blocks) {
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

      const currentStart =
        parseHHMM(
          block.start
        );

      if (
        currentStart <
        previousEnd
      ) {
        /*
         * Never return an overlapping block.
         */
        if (
          block.kind === "task"
        ) {
          const index =
            validTaskIds.indexOf(
              block.task_id
            );

          if (index !== -1) {
            validTaskIds.splice(
              index,
              1
            );
          }
        }

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
  breakStyle: string
): number {
  const result = csp(
    tasks,
    startMin,
    endMin,
    breakStyle
  );

  const placedTasks =
    result.blocks.filter(
      (b) => b.kind === "task"
    );

  /*
   * Strong penalty for tasks that cannot fit.
   */
  let score =
    (tasks.length -
      result.scheduledTaskIds
        .length) *
    1000;

  for (
    let i = 0;
    i < placedTasks.length;
    i++
  ) {
    const t = tasks[i];
    const b = placedTasks[i];

    if (!b) {
      continue;
    }

    const bStart =
      parseHHMM(b.start);

    const bEnd =
      parseHHMM(b.end);

    const diffWeight =
      t.difficulty === "hard"
        ? 3
        : t.difficulty ===
          "medium"
        ? 1
        : 0.3;

    const insidePeak =
      bStart >= peakStart &&
      bEnd <= peakEnd;

    /*
     * Hard tasks outside peak period.
     */
    if (
      t.difficulty === "hard" &&
      !insidePeak
    ) {
      score += 25;
    }

    /*
     * Easy tasks inside peak period.
     */
    if (
      t.difficulty === "easy" &&
      insidePeak
    ) {
      score += 8;
    }

    /*
     * Later placement penalty.
     */
    const windowSize =
      endMin - startMin || 1;

    const startFrac =
      (bStart - startMin) /
      windowSize;

    score +=
      diffWeight *
      startFrac *
      6;

    /*
     * Deadline penalty.
     */
    if (t.due_date) {
      const due =
        new Date(
          t.due_date
        ).getTime();

      const todayStart =
        new Date();

      todayStart.setHours(
        0,
        0,
        0,
        0
      );

      const endTs =
        todayStart.getTime() +
        bEnd * 60_000;

      if (
        endTs > due
      ) {
        score += 50;
      }
    }
  }

  /*
   * Category switching penalty.
   */
  for (
    let i = 1;
    i < placedTasks.length;
    i++
  ) {
    if (
      (
        placedTasks[i]
          .category || ""
      ) !==
      (
        placedTasks[i - 1]
          .category || ""
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
    .map((k, i) => ({
      k,
      i,
    }))
    .sort(
      (a, b) => a.k - b.k
    )
    .map((o) => o.i);
}

function pso(
  tasks: Task[],
  startMin: number,
  endMin: number,
  peakStart: number,
  peakEnd: number,
  breakStyle: string,
  opts = {
    swarm: 25,
    iters: 60,
    w: 0.7,
    c1: 1.5,
    c2: 1.5,
  }
) {
  const n = tasks.length;

  if (n === 0) {
    return {
      order: [] as number[],
      best: 0,
    };
  }

  const rng = () =>
    Math.random();

  const swarm =
    Array.from(
      {
        length:
          opts.swarm,
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
          opts.swarm,
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
      (p) => [...p]
    );

  const pbestScore =
    swarm.map(
      (p) =>
        fitness(
          decode(p).map(
            (i) =>
              tasks[i]
          ),
          startMin,
          endMin,
          peakStart,
          peakEnd,
          breakStyle
        )
    );

  let gIdx =
    pbestScore.indexOf(
      Math.min(
        ...pbestScore
      )
    );

  let gbest = [
    ...pbest[gIdx],
  ];

  let gbestScore =
    pbestScore[gIdx];

  for (
    let it = 0;
    it < opts.iters;
    it++
  ) {
    for (
      let i = 0;
      i < opts.swarm;
      i++
    ) {
      for (
        let j = 0;
        j < n;
        j++
      ) {
        const r1 = rng();
        const r2 = rng();

        velocity[i][j] =
          opts.w *
            velocity[i][j] +
          opts.c1 *
            r1 *
            (pbest[i][j] -
              swarm[i][j]) +
          opts.c2 *
            r2 *
            (gbest[j] -
              swarm[i][j]);

        swarm[i][j] =
          Math.max(
            0,
            Math.min(
              1,
              swarm[i][j] +
                velocity[i][j]
            )
          );
      }

      const s =
        fitness(
          decode(
            swarm[i]
          ).map(
            (idx) =>
              tasks[idx]
          ),
          startMin,
          endMin,
          peakStart,
          peakEnd,
          breakStyle
        );

      if (
        s < pbestScore[i]
      ) {
        pbestScore[i] =
          s;

        pbest[i] = [
          ...swarm[i],
        ];
      }

      if (
        s < gbestScore
      ) {
        gbestScore = s;

        gbest = [
          ...swarm[i],
        ];
      }
    }
  }

  return {
    order:
      decode(gbest),
    best:
      gbestScore,
  };
}

/* =========================================================
   PERSIST GENERATED SCHEDULE
   ========================================================= */

async function persistSchedule(
  supabase: any,
  blocks: Block[],
  scheduleDate: string
) {
  const taskBlocks =
    blocks.filter(
      (b) =>
        b.kind === "task"
    );

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
        );

    if (error) {
      throw new Error(
        `Failed to save schedule for task ${block.task_id}: ${error.message}`
      );
    }
  }
}

/* =========================================================
   MAIN EDGE FUNCTION
   ========================================================= */

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
                authHeader!,
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
       REQUEST BODY
       ===================================================== */

    let body: any = {};

    try {
      body =
        await req.json();
    } catch {
      body = {};
    }

    /*
     * Default to today's date.
     *
     * Auto Schedule can optionally send:
     * {
     *   schedule_date: "2026-09-23"
     * }
     */
    const scheduleDate =
      body?.schedule_date ||
      new Date()
        .toISOString()
        .slice(0, 10);

    /* =====================================================
       GET ACTIVE TASKS
       ===================================================== */

    const {
      data: allTasks,
      error: tasksError,
    } =
      await supabase
        .from("tasks")
        .select("*")
        .eq(
          "user_id",
          user.id
        )
        .eq(
          "archived",
          false
        )
        .neq(
          "status",
          "done"
        );

    if (tasksError) {
      throw tasksError;
    }

    /*
     * ALL active unfinished tasks are candidates.
     *
     * No arbitrary 24-hour filter.
     */
    const tasks: Task[] =
      (allTasks || []).filter(
        (t: any) =>
          t.archived !== true &&
          t.status !== "done"
      );

    if (
      tasks.length === 0
    ) {
      return new Response(
        JSON.stringify({
          blocks: [],
          deferred: [],
          algorithm:
            "csp-pso",
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
        .single();

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

    /* =====================================================
       PRIORITY / URGENCY ORDER
       ===================================================== */

    const byUrgency =
      [...tasks].sort(
        (a, b) => {
          const ad =
            a.due_date
              ? new Date(
                  a.due_date
                ).getTime()
              : Infinity;

          const bd =
            b.due_date
              ? new Date(
                  b.due_date
                ).getTime()
              : Infinity;

          if (
            ad !== bd
          ) {
            return ad - bd;
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
        byUrgency,
        startMin,
        endMin,
        peakStartMin,
        peakEndMin,
        breakStyle
      );

    const ordered =
      order.map(
        (i) =>
          byUrgency[i]
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

    const blocks =
      cspResult.blocks;

    const scheduledIds =
      new Set(
        cspResult.scheduledTaskIds
      );

    const deferred =
      ordered.filter(
        (task) =>
          !scheduledIds.has(
            task.id
          )
      );

    /* =====================================================
       SAVE GENERATED TIMES
       ===================================================== */

    if (
      blocks.length > 0
    ) {
      await persistSchedule(
        supabase,
        blocks,
        scheduleDate
      );
    }

    /* =====================================================
       FINAL CHRONOLOGICAL SORT
       ===================================================== */

    blocks.sort(
      (a, b) => {
        const startDiff =
          parseHHMM(
            a.start
          ) -
          parseHHMM(
            b.start
          );

        if (
          startDiff !== 0
        ) {
          return startDiff;
        }

        return (
          parseHHMM(
            a.end
          ) -
          parseHHMM(
            b.end
          )
        );
      }
    );

    /* =====================================================
       FINAL OVERLAP VALIDATION
       ===================================================== */

    for (
      let i = 1;
      i < blocks.length;
      i++
    ) {
      const previous =
        blocks[i - 1];

      const current =
        blocks[i];

      if (
        parseHHMM(
          current.start
        ) <
        parseHHMM(
          previous.end
        )
      ) {
        console.error(
          "Invalid overlapping schedule detected:",
          previous,
          current
        );

        throw new Error(
          "CSP generated an overlapping schedule. Schedule was not accepted."
        );
      }
    }

    /* =====================================================
       RESPONSE
       ===================================================== */

    return new Response(
      JSON.stringify({
        blocks,

        deferred:
          deferred.map(
            (task) => ({
              task_id:
                task.id,
              title:
                task.title,
              duration:
                task.estimated_duration ||
                30,
              priority:
                task.priority_score ||
                null,
              status:
                task.status ||
                "todo",
            })
          ),

        pso: {
          fitness: best,
          iterations: 60,
          swarm_size: 25,
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
          cspResult
            .scheduledTaskIds
            .length,

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
  } catch (e) {
    console.error(
      "generate-schedule error:",
      e
    );

    return new Response(
      JSON.stringify({
        error:
          (e as Error).message,
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
