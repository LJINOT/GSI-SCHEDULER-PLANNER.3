import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  status?: string;
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
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const FIXED_BREAKS = [
  { start: 9 * 60, dur: 15, title: "Morning Break (Snack)" },
  { start: 12 * 60, dur: 60, title: "Lunch Break" },
  { start: 15 * 60, dur: 15, title: "Afternoon Break (Snack)" },
];

function csp(tasks: Task[], startMin: number, endMin: number): Block[] | null {
  const blocks: Block[] = [];
  let cursor = startMin;
  const breaks = FIXED_BREAKS
    .filter((b) => b.start >= startMin && b.start + b.dur <= endMin)
    .map((b) => ({ ...b, placed: false }));

  const placeDueBreaks = () => {
    for (const b of breaks) {
      if (b.placed) continue;
      if (cursor > b.start && cursor < b.start + b.dur) {
        cursor = b.start + b.dur;
        b.placed = true;
        blocks.push({
          task_id: `break-${b.start}`,
          title: b.title,
          start: toHHMM(b.start),
          end: toHHMM(b.start + b.dur),
          category: "Break",
          kind: "break",
        });
        continue;
      }
      if (cursor >= b.start) {
        blocks.push({
          task_id: `break-${b.start}`,
          title: b.title,
          start: toHHMM(b.start),
          end: toHHMM(b.start + b.dur),
          category: "Break",
          kind: "break",
        });
        cursor = Math.max(cursor, b.start + b.dur);
        b.placed = true;
      }
    }
  };

  for (const t of tasks) {
    const dur = Math.max(5, Math.min(480, t.estimated_duration || 30));
    placeDueBreaks();
    for (const b of breaks) {
      if (b.placed) continue;
      if (cursor < b.start && cursor + dur > b.start) {
        blocks.push({
          task_id: `break-${b.start}`,
          title: b.title,
          start: toHHMM(b.start),
          end: toHHMM(b.start + b.dur),
          category: "Break",
          kind: "break",
        });
        cursor = b.start + b.dur;
        b.placed = true;
      }
    }
    if (cursor + dur > endMin) return null;
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
  for (const b of breaks) {
    if (!b.placed) {
      blocks.push({
        task_id: `break-${b.start}`,
        title: b.title,
        start: toHHMM(b.start),
        end: toHHMM(b.start + b.dur),
        category: "Break",
        kind: "break",
      });
      b.placed = true;
    }
  }
  blocks.sort((a, b) => parseHHMM(a.start) - parseHHMM(b.start));
  return blocks;
}

function fitness(tasks: Task[], startMin: number, endMin: number, peakStart: number, peakEnd: number): number {
  const placed = csp(tasks, startMin, endMin);
  if (!placed) return 1e9;
  let score = 0;
  for (const b of placed) {
    if (b.kind === "break") continue;
    const sm = parseHHMM(b.start);
    const t = tasks.find((x) => x.id === b.task_id);
    const diff = (t?.difficulty || "medium").toLowerCase();
    const inPeak = sm >= peakStart && sm < peakEnd;
    if (diff === "hard" && !inPeak) score += 25;
    if (diff === "easy" && inPeak) score += 8;
    score += (sm - startMin) * 0.01;
    if (t?.due_date) {
      const due = new Date(t.due_date).getTime();
      if (due < Date.now() + 24 * 3600_000 && sm > peakEnd) score += 15;
    }
  }
  return score;
}

function decode(keys: number[]): number[] {
  return keys.map((k, i) => ({ k, i })).sort((a, b) => a.k - b.k).map((o) => o.i);
}

function pso(tasks: Task[], startMin: number, endMin: number, peakStart: number, peakEnd: number, opts = { swarm: 25, iters: 60, w: 0.7, c1: 1.5, c2: 1.5 }) {
  const n = tasks.length;
  if (n === 0) return { order: [] as number[], best: 0 };
  const rng = () => Math.random();
  const swarm = Array.from({ length: opts.swarm }, () => Array.from({ length: n }, rng));
  const velocity = Array.from({ length: opts.swarm }, () => Array.from({ length: n }, () => (rng() - 0.5) * 0.2));
  const pbest = swarm.map((p) => [...p]);
  const pbestScore = swarm.map((p) => fitness(decode(p).map((i) => tasks[i]), startMin, endMin, peakStart, peakEnd));
  let gIdx = pbestScore.indexOf(Math.min(...pbestScore));
  let gbest = [...pbest[gIdx]];
  let gbestScore = pbestScore[gIdx];
  for (let it = 0; it < opts.iters; it++) {
    for (let i = 0; i < opts.swarm; i++) {
      for (let j = 0; j < n; j++) {
        const r1 = rng(), r2 = rng();
        velocity[i][j] = opts.w * velocity[i][j] + opts.c1 * r1 * (pbest[i][j] - swarm[i][j]) + opts.c2 * r2 * (gbest[j] - swarm[i][j]);
        swarm[i][j] = Math.max(0, Math.min(1, swarm[i][j] + velocity[i][j]));
      }
      const s = fitness(decode(swarm[i]).map((idx) => tasks[idx]), startMin, endMin, peakStart, peakEnd);
      if (s < pbestScore[i]) { pbestScore[i] = s; pbest[i] = [...swarm[i]]; }
      if (s < gbestScore) { gbestScore = s; gbest = [...swarm[i]]; }
    }
  }
  return { order: decode(gbest), best: gbestScore };
}

function localDateStr(tz: string, d = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function localDateTimeISO(dateStr: string, hhmm: string): string {
  return `${dateStr}T${hhmm}:00`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader! } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const body = await req.json().catch(() => ({}));
    const adaptive = !!body?.adaptive;
    await supabase.rpc("transition_due_task_statuses", { p_user_id: user.id });

    const { data: profile } = await supabase
      .from("profiles")
      .select("work_start, work_end, peak_start, peak_end, break_style, timezone")
      .eq("id", user.id)
      .single();

    const tz = profile?.timezone || "UTC";
    const workStart = profile?.work_start || "09:00";
    const workEnd = profile?.work_end || "17:00";
    const peakStart = profile?.peak_start || workStart;
    const peakEnd = profile?.peak_end || "12:00";
    const breakStyle = profile?.break_style || "pomodoro";
    const todayStr = localDateStr(tz);

    const { data: allTasks } = await supabase
      .from("tasks")
      .select("*")
      .eq("user_id", user.id)
      .eq("archived", false)
      .neq("status", "done");

    const dayEndMs = Date.now() + 24 * 60 * 60 * 1000;
    let candidatePool = ((allTasks || []) as Task[]).filter((t) => {
      const due = t.due_date ? new Date(t.due_date).getTime() : null;
      const start = t.start_time ? new Date(t.start_time).getTime() : null;
      if (due === null && start === null) return true;
      if (due !== null && due <= dayEndMs) return true;
      if (start !== null && start <= dayEndMs && start >= Date.now() - 24 * 60 * 60 * 1000) return true;
      return false;
    });

    const changes: { task_id: string; title: string; reason: string }[] = [];
    const previouslyScheduled = ((allTasks || []) as Task[]).filter(
      (t) => t.start_time && String(t.start_time).startsWith(todayStr),
    );

    if (adaptive) {
      for (const t of previouslyScheduled) {
        if (t.status === "done") changes.push({ task_id: t.id, title: t.title, reason: "Task completed" });
      }
      for (const t of candidatePool) {
        if (!t.start_time) changes.push({ task_id: t.id, title: t.title, reason: "New unscheduled task" });
        else if (t.due_date && new Date(t.due_date).getTime() < Date.now()) {
          changes.push({ task_id: t.id, title: t.title, reason: "Task is overdue" });
        }
      }
      candidatePool = candidatePool.filter((t) => t.status !== "done");
    }

    if (candidatePool.length === 0) {
      return new Response(JSON.stringify({
        blocks: [], changes, adaptive, algorithm: "csp-pso", timestamp: new Date().toISOString(),
        note: adaptive ? "No tasks need adaptation." : "No tasks available to schedule.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const startMin = parseHHMM(workStart);
    const endMin = parseHHMM(workEnd);
    const peakStartMin = parseHHMM(peakStart);
    const peakEndMin = parseHHMM(peakEnd);
    const capacity = Math.max(0, Math.floor((endMin - startMin) * 0.85));

    const byUrgency = [...candidatePool].sort((a, b) => {
      const ad = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const bd = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      return (b.priority_score || 0) - (a.priority_score || 0);
    });

    const fitting: Task[] = [];
    const deferred: { task_id: string; title: string }[] = [];
    let used = 0;
    for (const t of byUrgency) {
      const dur = Math.max(5, Math.min(480, t.estimated_duration || 30));
      if (used + dur <= capacity) { fitting.push(t); used += dur; }
      else deferred.push({ task_id: t.id, title: t.title });
    }

    if (fitting.length === 0) {
      return new Response(JSON.stringify({
        blocks: [], deferred, changes, adaptive,
        note: "No task fits within the configured work window.",
        algorithm: "csp-pso", timestamp: new Date().toISOString(),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (adaptive && changes.length === 0 && previouslyScheduled.length > 0) {
      return new Response(JSON.stringify({
        blocks: previouslyScheduled.filter((t) => t.start_time).map((t) => {
          const startIso = t.start_time!;
          const hhmm = startIso.includes("T") ? startIso.split("T")[1]?.slice(0, 5) : toHHMM(startMin);
          const dur = Math.max(5, t.estimated_duration || 30);
          const sm = parseHHMM(hhmm || toHHMM(startMin));
          return { task_id: t.id, title: t.title, start: toHHMM(sm), end: toHHMM(sm + dur), category: t.category || "General", kind: "task" as const };
        }),
        changes: [], adaptive: true, note: "Schedule is up to date — no changes detected.",
        algorithm: "csp-pso", timestamp: new Date().toISOString(),
        window: { start: workStart, end: workEnd, peak_start: peakStart, peak_end: peakEnd, break_style: breakStyle },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { order, best } = pso(fitting, startMin, endMin, peakStartMin, peakEndMin);
    const ordered = order.map((i) => fitting[i]);
    const blocks = csp(ordered, startMin, endMin) || csp(fitting, startMin, endMin) || [];

    for (const b of blocks.filter((x) => x.kind !== "break")) {
      const iso = localDateTimeISO(todayStr, b.start);
      await supabase.from("tasks").update({ start_time: iso, updated_at: new Date().toISOString() })
        .eq("id", b.task_id).eq("user_id", user.id).eq("archived", false);
    }

    const { data: existing } = await supabase.from("schedules").select("id")
      .eq("user_id", user.id).eq("schedule_date", todayStr).maybeSingle();
    if (existing?.id) {
      await supabase.from("schedules").update({ timeline: blocks as unknown as Record<string, unknown> }).eq("id", existing.id);
    } else {
      await supabase.from("schedules").insert({ user_id: user.id, schedule_date: todayStr, timeline: blocks as unknown as Record<string, unknown> });
    }

    return new Response(JSON.stringify({
      blocks, deferred, changes: adaptive ? changes : undefined, adaptive: adaptive || undefined,
      pso: { fitness: best, iterations: 60, swarm_size: 25 },
      window: { start: workStart, end: workEnd, peak_start: peakStart, peak_end: peakEnd, break_style: breakStyle },
      timezone: tz, algorithm: "csp-backtracking + pso-random-key + peak-aware",
      timestamp: new Date().toISOString(), persisted: true,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-schedule error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
