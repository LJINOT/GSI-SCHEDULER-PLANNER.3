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

type BreakStyle = "pomodoro" | "long-focus" | "flexible";

type BreakBlock = {
  start: number;
  dur: number;
  title: string;
};

const BREAK_STYLES: Record<BreakStyle, BreakBlock[]> = {
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

function getBreakBlocks(breakStyle?: string): BreakBlock[] {
  const style = (breakStyle || "pomodoro") as BreakStyle;

  return BREAK_STYLES[style] ?? BREAK_STYLES.pomodoro;
}

/* =========================================================
   CSP
   ========================================================= */

function csp(
  tasks: Task[],
  startMin: number,
  endMin: number,
  breakStyle: string
): Block[] | null {
  const blocks: Block[] = [];

  let cursor = startMin;

  const pending = getBreakBlocks(breakStyle)
    .filter(
      (b) =>
        b.start >= startMin &&
        b.start + b.dur <= endMin
    )
    .map((b) => ({
      ...b,
      used: false,
    }));

  const flushBreaks = (until: number) => {
    for (const b of pending) {
      if (b.used) continue;

      /*
       * The break must occur before the task if the task
       * would cross the break's start time.
       */
      if (until > b.start) {
        cursor = Math.max(cursor, b.start);

        /*
         * If the break itself cannot fit, fail the CSP.
         */
        if (cursor + b.dur > endMin) {
          return false;
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

    return true;
  };

  for (const t of tasks) {
    const dur = Math.max(
      5,
      Math.min(480, t.estimated_duration || 30)
    );

    /*
     * Check whether a break needs to be inserted
     * before this task.
     */
    const breaksOk = flushBreaks(cursor + dur);

    if (!breaksOk) {
      return null;
    }

    /*
     * Never allow a task to go beyond work_end.
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
   * Add remaining breaks after the final task
   * if they occur inside the work window.
   */
  for (const b of pending) {
    if (b.used) continue;

    if (b.start >= cursor && b.start + b.dur <= endMin) {
      blocks.push({
        task_id: `break-${b.start}`,
        title: b.title,
        start: toHHMM(b.start),
        end: toHHMM(b.start + b.dur),
        category: "Break",
        kind: "break",
      });

      b.used = true;
    }
  }

  /*
   * Final chronological ordering.
   */
  blocks.sort((a, b) => {
    const startDiff =
      parseHHMM(a.start) - parseHHMM(b.start);

    if (startDiff !== 0) {
      return startDiff;
    }

    return parseHHMM(a.end) - parseHHMM(b.end);
  });

  /*
   * Final overlap validation.
   */
  for (let i = 1; i < blocks.length; i++) {
    const previous = blocks[i - 1];
    const current = blocks[i];

    if (
      parseHHMM(current.start) <
      parseHHMM(previous.end)
    ) {
      return null;
    }
  }

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
      score += 1000;
      continue;
    }

    const bStart = parseHHMM(b.start);
    const bEnd = parseHHMM(b.end);

    const diffWeight =
      t.difficulty === "hard"
        ? 3
        : t.difficulty === "medium"
        ? 1
        : 0.3;

    const insidePeak =
      bStart >= peakStart &&
      bEnd <= peakEnd;

    /*
     * Hard tasks should preferably be inside
     * the user's peak working period.
     */
    if (
      t.difficulty === "hard" &&
      !insidePeak
    ) {
      score += 25;
    }

    /*
     * Easy tasks inside peak time are slightly
     * discouraged because peak time is more useful
     * for difficult work.
     */
    if (
      t.difficulty === "easy" &&
      insidePeak
    ) {
      score += 8;
    }

    /*
     * Later placement receives a small penalty.
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
  for (let i = 1; i < tasks.length; i++) {
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

  const rng = () => Math.random();

  const swarm = Array.from(
    { length: opts.swarm },
    () =>
      Array.from(
        { length: n },
        rng
      )
  );

  const velocity = Array.from(
    { length: opts.swarm },
    () =>
      Array.from(
        { length: n },
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
        decode(
          swarm[i]
        ).map(
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
   SAVE GENERATED START TIMES
   ========================================================= */

async function persistSchedule(
  supabase: any,
  blocks: Block[],
  scheduleDate: string,
  timezone: string
) {
  const taskBlocks = blocks.filter(
    (b) => b.kind === "task"
  );

  for (const block of taskBlocks) {
    /*
     * Build local date/time.
     *
     * Example:
     * 2026-09-23 + 09:00
     */
    const localDateTime =
      `${scheduleDate}T${block.start}:00`;

    /*
     * Use the user's timezone when converting
     * local schedule time to an ISO timestamp.
     */
    const date = new Date(
      `${localDateTime}`
    );

    /*
     * If the runtime cannot directly interpret
     * the IANA timezone, preserve the local
     * schedule timestamp rather than moving it
     * to an incorrect date.
     */
    let startTime: string;

    try {
      const formatter =
        new Intl.DateTimeFormat(
          "en-US",
          {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          }
        );

      /*
       * The formatter is intentionally invoked
       * to validate the supplied timezone.
       */
      formatter.format(date);

      /*
       * Supabase timestamp storage.
       * The local schedule date/time is kept as
       * the scheduled wall-clock time.
       */
      startTime =
        `${scheduleDate}T${block.start}:00`;
    } catch {
      startTime =
        `${scheduleDate}T${block.start}:00`;
    }

    const { error } =
      await supabase
        .from("tasks")
        .update({
          start_time: startTime,
        })
        .eq("id", block.task_id);

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
      body = await req.json();
    } catch {
      body = {};
    }

    /*
     * Allow the Auto Schedule page to optionally
     * provide the date it wants to schedule.
     *
     * Defaults to today.
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
     * Auto Schedule works with all active unfinished
     * tasks instead of only tasks inside the next 24h.
     */
    const tasks: Task[] =
      (allTasks || []).filter(
        (t: any) =>
          t.archived !== true &&
          t.status !== "done"
      );

    if (tasks.length === 0) {
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
          "work_start, work_end, peak_start, peak_end, break_style, timezone"
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

    const timezone =
      profile?.timezone ||
      "Asia/Manila";

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
      endMin <= startMin
    ) {
      throw new Error(
        "Work end time must be later than work start time."
      );
    }

    /* =====================================================
       ORDER CANDIDATE TASKS
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

    /* =====================================================
       CSP / PSO
       ===================================================== */

    /*
     * Do NOT use the old 85% capacity filter.
     *
     * Give all active tasks to PSO/CSP.
     * CSP determines what can actually fit.
     */
    const fitting: Task[] = [
      ...byUrgency,
    ];

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
        (i) => fitting[i]
      );

    /*
     * Try the PSO order first.
     */
    let blocks =
      csp(
        ordered,
        startMin,
        endMin,
        breakStyle
      );

    /*
     * If the full list cannot fit, build the
     * largest feasible prefix.
     */
    if (!blocks) {
      const feasibleTasks: Task[] = [];

      for (
        const task of ordered
      ) {
        const candidate = [
          ...feasibleTasks,
          task,
        ];

        const candidateBlocks =
          csp(
            candidate,
            startMin,
            endMin,
            breakStyle
          );

        if (
          candidateBlocks
        ) {
          feasibleTasks.push(
            task
          );
        }
      }

      blocks =
        csp(
          feasibleTasks,
          startMin,
          endMin,
          breakStyle
        ) || [];

      /*
       * Tasks not included in the feasible set
       * are deferred.
       */
      const scheduledIds =
        new Set(
          feasibleTasks.map(
            (t) => t.id
          )
        );

      const deferred =
        fitting.filter(
          (t) =>
            !scheduledIds.has(
              t.id
            )
        );

      /* ================================================
         PERSIST
         ================================================ */

      if (blocks.length > 0) {
        await persistSchedule(
          supabase,
          blocks,
          scheduleDate,
          timezone
        );
      }

      blocks.sort(
        (a, b) =>
          parseHHMM(a.start) -
          parseHHMM(b.start)
      );

      return new Response(
        JSON.stringify({
          blocks,
          deferred:
            deferred.map(
              (t) => ({
                task_id: t.id,
                title: t.title,
                duration:
                  t.estimated_duration ||
                  30,
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
            timezone,
            schedule_date:
              scheduleDate,
          },
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
       EVERYTHING FITS
       ===================================================== */

    await persistSchedule(
      supabase,
      blocks,
      scheduleDate,
      timezone
    );

    blocks.sort(
      (a, b) =>
        parseHHMM(a.start) -
        parseHHMM(b.start)
    );

    return new Response(
      JSON.stringify({
        blocks,
        deferred: [],
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
          timezone,
          schedule_date:
            scheduleDate,
        },
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
