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

type BreakStyle = "standard" | "pomodoro" | "extended" | "minimal";

type BreakBlock = {
  start: number;
  dur: number;
  title: string;
};

/*
 * Break patterns used by the CSP.
 *
 * IMPORTANT:
 * These values must match the values stored in
 * profiles.break_style.
 */
const BREAK_STYLES: Record<BreakStyle, BreakBlock[]> = {
  standard: [
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

  extended: [
    {
      start: 9 * 60,
      dur: 20,
      title: "Morning Break (Snack)",
    },
    {
      start: 12 * 60,
      dur: 60,
      title: "Lunch Break",
    },
    {
      start: 15 * 60,
      dur: 20,
      title: "Afternoon Break (Snack)",
    },
  ],

  minimal: [
    {
      start: 12 * 60,
      dur: 45,
      title: "Lunch Break",
    },
  ],
};

function getBreakBlocks(breakStyle?: string): BreakBlock[] {
  const style = (breakStyle || "standard") as BreakStyle;

  return BREAK_STYLES[style] ?? BREAK_STYLES.standard;
}

/* =========================================================
   CSP - CONSTRAINT SATISFACTION PROBLEM
   ========================================================= */

/*
 * Places tasks sequentially while respecting:
 *
 * 1. Configured work window
 * 2. Selected Break Style
 * 3. Break durations
 * 4. Task duration
 * 5. No task overlap
 *
 * The task order is supplied by PSO.
 */
function csp(
  tasks: Task[],
  startMin: number,
  endMin: number,
  breakStyle: string
): Block[] | null {
  const blocks: Block[] = [];
  let cursor = startMin;

  // Get breaks according to the user's selected Break Style.
  const selectedBreaks = getBreakBlocks(breakStyle);

  /*
   * Only include breaks that completely fit inside
   * the configured work window.
   */
  const pending = selectedBreaks
    .filter(
      (b) =>
        b.start >= startMin &&
        b.start + b.dur <= endMin
    )
    .map((b) => ({
      ...b,
      used: false,
    }));

  /*
   * Insert any break that occurs before the end of
   * the next task.
   */
  const flushBreaks = (until: number) => {
    for (const b of pending) {
      if (b.used) continue;

      if (until > b.start) {
        /*
         * Move the cursor to the break start.
         * This prevents a task from occupying the
         * break period.
         */
        cursor = Math.max(cursor, b.start);

        /*
         * Make sure the break itself still fits
         * inside the work window.
         */
        if (cursor + b.dur > endMin) {
          continue;
        }

        blocks.push({
          task_id: `break-${b.start}`,
          title: b.title,
          start: toHHMM(cursor),
          end: toHHMM(cursor + b.dur),
          category: "Break",
          kind: "break",
        });

        cursor += b.dur;
        b.used = true;
      }
    }
  };

  /*
   * Place each task in the PSO-provided order.
   */
  for (const t of tasks) {
    /*
     * Keep the existing duration limits:
     * minimum = 5 minutes
     * maximum = 480 minutes
     */
    const dur = Math.max(
      5,
      Math.min(480, t.estimated_duration || 30)
    );

    /*
     * Check whether a configured break occurs
     * during this task's possible placement.
     */
    flushBreaks(cursor + dur);

    /*
     * If the task no longer fits in the work window,
     * CSP fails.
     */
    if (cursor + dur > endMin) {
      return null;
    }

    blocks.push({
      task_id: t.id,
      title: t.title,
      start: toHHMM(cursor),
      end: toHHMM(cursor + dur),
      category: t.category || "General",
      kind: "task",
    });

    cursor += dur;
  }

  /*
   * Insert any remaining break that occurs after
   * the final task but still belongs to the work window.
   */
  flushBreaks(endMin);

  return blocks;
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
  const placed = csp(
    tasks,
    startMin,
    endMin,
    breakStyle
  );

  if (!placed) {
    return Number.POSITIVE_INFINITY;
  }

  let score = 0;

  const placedTasks = placed.filter(
    (b) => b.kind !== "break"
  );

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const b = placedTasks[i];

    if (!b) {
      return Number.POSITIVE_INFINITY;
    }

    const bStart = parseHHMM(b.start);
    const bEnd = parseHHMM(b.end);

    const diffWeight =
      t.difficulty === "hard"
        ? 3
        : t.difficulty === "medium"
        ? 1
        : 0.3;

    /*
     * Reward hard tasks being inside the user's
     * configured peak window by penalizing them
     * when they are outside it.
     */
    const insidePeak =
      bStart >= peakStart &&
      bEnd <= peakEnd;

    if (
      t.difficulty === "hard" &&
      !insidePeak
    ) {
      score += 25;
    }

    /*
     * Penalize using the peak period for easy tasks.
     */
    if (
      t.difficulty === "easy" &&
      insidePeak
    ) {
      score += 8;
    }

    /*
     * Penalize tasks that are placed later in
     * the configured work window.
     */
    const windowSize =
      endMin - startMin || 1;

    const startFrac =
      (bStart - startMin) / windowSize;

    score +=
      diffWeight *
      startFrac *
      6;

    /*
     * Deadline penalty if the task finishes after
     * its due date today.
     */
    if (t.due_date) {
      const due =
        new Date(t.due_date).getTime();

      const todayStart = new Date();

      todayStart.setHours(
        0,
        0,
        0,
        0
      );

      const endTs =
        todayStart.getTime() +
        bEnd * 60_000;

      if (endTs > due) {
        score += 50;
      }
    }
  }

  /*
   * Category switching penalty.
   */
  for (
    let i = 1;
    i < tasks.length;
    i++
  ) {
    if (
      (tasks[i].category || "") !==
      (tasks[i - 1].category || "")
    ) {
      score += 2;
    }
  }

  return score;
}

/* =========================================================
   PSO
   ========================================================= */

function decode(keys: number[]): number[] {
  return keys
    .map((k, i) => ({
      k,
      i,
    }))
    .sort((a, b) => a.k - b.k)
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

  /*
   * Random-key PSO representation.
   */
  const rng = () => Math.random();

  const swarm = Array.from(
    {
      length: opts.swarm,
    },
    () =>
      Array.from(
        {
          length: n,
        },
        rng
      )
  );

  const velocity = Array.from(
    {
      length: opts.swarm,
    },
    () =>
      Array.from(
        {
          length: n,
        },
        () => (rng() - 0.5) * 0.2
      )
  );

  const pbest = swarm.map(
    (p) => [...p]
  );

  const pbestScore = swarm.map(
    (p) =>
      fitness(
        decode(p).map(
          (i) => tasks[i]
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
      Math.min(...pbestScore)
    );

  let gbest = [
    ...pbest[gIdx],
  ];

  let gbestScore =
    pbestScore[gIdx];

  /*
   * Main PSO iteration loop.
   */
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

      const s = fitness(
        decode(swarm[i]).map(
          (idx) => tasks[idx]
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
        pbestScore[i] = s;
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
    order: decode(gbest),
    best: gbestScore,
  };
}

/* =========================================================
   EDGE FUNCTION
   ========================================================= */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(
      null,
      {
        headers: corsHeaders,
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
      data: { user },
    } = await supabase.auth.getUser();

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
       GET ACTIVE TASKS
       ===================================================== */

    const {
      data: allTasks,
    } = await supabase
      .from("tasks")
      .select("*")
      .neq("status", "done")
      .eq("user_id", user.id)
      .eq("archived", false);

    /*
     * Only consider tasks that belong to today:
     *
     * - due today / within the next 24 hours
     * - starting today / within the next 24 hours
     * - undated tasks
     */
    const nowMs =
      Date.now();

    const dayEndMs =
      nowMs +
      24 *
        60 *
        60 *
        1000;

    const tasks =
      (allTasks || []).filter(
        (t: any) => {
          const due =
            t.due_date
              ? new Date(
                  t.due_date
                ).getTime()
              : null;

          const start =
            t.start_time
              ? new Date(
                  t.start_time
                ).getTime()
              : null;

          if (
            due === null &&
            start === null
          ) {
            return true;
          }

          if (
            due !== null &&
            due <= dayEndMs
          ) {
            return true;
          }

          if (
            start !== null &&
            start <= dayEndMs &&
            start >=
              nowMs -
                24 *
                  60 *
                  60 *
                  1000
          ) {
            return true;
          }

          return false;
        }
      );

    if (
      tasks.length === 0
    ) {
      return new Response(
        JSON.stringify({
          blocks: [],
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
       USER PROFILE / SETTINGS
       ===================================================== */

    const {
      data: profile,
    } = await supabase
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

    /*
     * The Break Style now comes directly from
     * profiles.break_style.
     */
    const breakStyle =
      profile?.break_style ||
      "standard";

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

    const windowSize =
      endMin -
      startMin;

    /* =====================================================
       CAPACITY
       ===================================================== */

    /*
     * Don't fail when backlog exceeds today's
     * available work window.
     *
     * Reserve approximately 15% for breaks.
     */
    const capacity =
      Math.max(
        0,
        Math.floor(
          windowSize *
            0.85
        )
      );

    const byUrgency =
      [
        ...(tasks as Task[]),
      ].sort(
        (a: any, b: any) => {
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

          if (ad !== bd) {
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

    const fitting: Task[] =
      [];

    const deferred: Task[] =
      [];

    let used = 0;

    for (
      const t of byUrgency
    ) {
      const dur =
        Math.max(
          5,
          Math.min(
            480,
            t.estimated_duration ||
              30
          )
        );

      if (
        used + dur <=
        capacity
      ) {
        fitting.push(t);
        used += dur;
      } else {
        deferred.push(t);
      }
    }

    if (
      fitting.length ===
      0
    ) {
      return new Response(
        JSON.stringify({
          blocks: [],
          deferred:
            deferred.map(
              (t) => ({
                task_id:
                  t.id,
                title:
                  t.title,
              })
            ),
          note:
            "No task fits within the configured work window. Widen your work hours in Settings.",
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
       PSO
       ===================================================== */

    const {
      order,
      best,
    } = pso(
      fitting,
      startMin,
      endMin,
      peakStartMin,
      peakEndMin,
      breakStyle
    );

    const ordered =
      order.map(
        (i) =>
          fitting[i]
      );

    /* =====================================================
       CSP
       ===================================================== */

    /*
     * CSP receives the SAME Break Style used by PSO.
     */
    const blocks =
      csp(
        ordered,
        startMin,
        endMin,
        breakStyle
      ) ||
      csp(
        fitting,
        startMin,
        endMin,
        breakStyle
      ) ||
      [];

    /* =====================================================
       CHRONOLOGICAL ORDER
       ===================================================== */

    blocks.sort(
      (a, b) => {
        const toMin = (
          s: string
        ) => {
          const [
            h,
            m,
          ] = (
            s ||
            "99:99"
          )
            .split(":")
            .map(Number);

          return (
            (h || 0) *
              60 +
            (m || 0)
          );
        };

        const d =
          toMin(a.start) -
          toMin(b.start);

        if (d !== 0) {
          return d;
        }

        return (
          toMin(a.end) -
          toMin(b.end)
        );
      }
    );

    /* =====================================================
       RESPONSE
       ===================================================== */

    return new Response(
      JSON.stringify({
        blocks,

        deferred:
          deferred.map(
            (t) => ({
              task_id:
                t.id,
              title:
                t.title,
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
        },

        algorithm:
          "csp-backtracking + pso-random-key + peak-aware",

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
          (e as Error)
            .message,
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
