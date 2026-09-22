import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// PSO over a single dimension: hour-of-day (0..23) to find peak productivity hour.
// Fitness: weighted completions count at that hour (uses Manila timezone offset = +8).
function psoPeakHour(hourHistogram: number[]): { hour: number; score: number } {
  const swarm = 15, iters = 40, w = 0.7, c1 = 1.4, c2 = 1.4;
  const eval_ = (x: number) => {
    const h = Math.max(0, Math.min(23, Math.round(x)));
    // Smooth with neighbors so optima isn't single-bucket noise
    const left = hourHistogram[(h + 23) % 24];
    const right = hourHistogram[(h + 1) % 24];
    return hourHistogram[h] * 2 + left + right;
  };
  let positions = Array.from({ length: swarm }, () => Math.random() * 23);
  let velocities = Array.from({ length: swarm }, () => (Math.random() - 0.5) * 4);
  let pbest = [...positions];
  let pbestScore = positions.map(eval_);
  let gIdx = pbestScore.indexOf(Math.max(...pbestScore));
  let gbest = pbest[gIdx], gbestScore = pbestScore[gIdx];

  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < swarm; i++) {
      const r1 = Math.random(), r2 = Math.random();
      velocities[i] = w * velocities[i] + c1 * r1 * (pbest[i] - positions[i]) + c2 * r2 * (gbest - positions[i]);
      positions[i] = Math.max(0, Math.min(23, positions[i] + velocities[i]));
      const s = eval_(positions[i]);
      if (s > pbestScore[i]) { pbestScore[i] = s; pbest[i] = positions[i]; }
      if (s > gbestScore) { gbestScore = s; gbest = positions[i]; }
    }
  }
  return { hour: Math.round(gbest), score: gbestScore };
}

function formatHourRange(h: number): string {
  const start = h, end = (h + 1) % 24;
  const fmt = (x: number) => `${String(x).padStart(2, "0")}:00`;
  return `${fmt(start)}–${fmt(end)} `;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader! } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json().catch(() => ({}));
    const rangeDays: number = Number(body?.rangeDays) || 30;
    const sinceISO = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: allTasks }, { data: timeEntries }, { data: profile }] = await Promise.all([
      supabase.from("tasks").select("*").eq("user_id", user.id).eq("archived", false).gte("created_at", sinceISO),
      supabase.from("time_entries").select("*").eq("user_id", user.id).gte("start_time", sinceISO),
      supabase.from("profiles").select("timezone").eq("id", user.id).single(),
    ]);
    const userTz = profile?.timezone || "UTC";
    const hourInTz = (iso: string) => {
      try {
        const parts = new Intl.DateTimeFormat("en-US", { timeZone: userTz, hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso));
        return Number(parts.find((p) => p.type === "hour")?.value ?? 0);
      } catch {
        return new Date(iso).getUTCHours();
      }
    };

    const tasks = allTasks || [];
    const completedTasks = tasks.filter((t: any) => t.status === "done");
    const pendingTasks = tasks.filter((t: any) => t.status !== "done");

    // ---- Deadline risk (deterministic) ----
    const now = Date.now();
    const riskScores: number[] = [];
    let overdueCount = 0, dueSoonCount = 0, atRiskCount = 0;
    const riskyTasks: { title: string; due: string; hoursLeft: number; risk: number }[] = [];

    for (const t of pendingTasks) {
      if (!t.due_date) continue;
      const hoursLeft = (new Date(t.due_date).getTime() - now) / 3_600_000;
      let risk: number;
      if (hoursLeft < 0) { risk = 1.0; overdueCount++; }
      else if (hoursLeft < 24) { risk = 0.85; dueSoonCount++; }
      else if (hoursLeft < 72) { risk = 0.6; atRiskCount++; }
      else if (hoursLeft < 168) { risk = 0.35; }
      else { risk = 0.1; }
      riskScores.push(risk);
      if (risk >= 0.6) riskyTasks.push({ title: t.title, due: t.due_date, hoursLeft: Math.round(hoursLeft), risk });
    }

    let lateCompletions = 0;
    for (const t of completedTasks) {
      if (t.due_date && new Date(t.updated_at).getTime() > new Date(t.due_date).getTime()) lateCompletions++;
    }
    const lateRate = completedTasks.length ? lateCompletions / completedTasks.length : 0;
    const avgPendingRisk = riskScores.length ? riskScores.reduce((a, b) => a + b, 0) / riskScores.length : 0;
    const deadlineRiskFactor = Math.round((avgPendingRisk * 0.7 + lateRate * 0.3) * 100);

    // ---- Peak activity hour from completions + actual time entries (user timezone) ----
    const hourHistogram = new Array(24).fill(0);
    for (const t of completedTasks) {
      const when = t.completed_at || t.updated_at;
      if (!when) continue;
      hourHistogram[hourInTz(when)] += 1;
    }
    for (const e of (timeEntries || [])) {
      if (!e.start_time) continue;
      const weight = e.duration && e.duration > 0 ? Math.min(2, e.duration / 30) : 0.5;
      hourHistogram[hourInTz(e.start_time)] += weight;
    }
    const peak = psoPeakHour(hourHistogram);

    // ---- Aggregates: prefer actual time_entry durations over estimates ----
    const actualDurations = (timeEntries || []).map((e: any) => Number(e.duration) || 0).filter((n: number) => n > 0);
    const estimateDurations = completedTasks.map((t: any) => Number(t.estimated_duration) || 0).filter(Boolean);
    const durations = actualDurations.length ? actualDurations : estimateDurations;
    const avgDuration = durations.length ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length) : 0;
    const usedActualTime = actualDurations.length > 0;

    const catCounts: Record<string, number> = {};
    for (const t of completedTasks) {
      const c = t.category || "General";
      catCounts[c] = (catCounts[c] || 0) + 1;
    }
    const preferredCategories = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);

    const completionRate = tasks.length ? completedTasks.length / tasks.length : 0;
    // Productivity score = 60% completion rate + 40% deadline adherence (1 - lateRate, 1 - avgPendingRisk)
    const adherence = 1 - (lateRate * 0.5 + avgPendingRisk * 0.5);
    const productivityScore = Math.round((completionRate * 0.6 + adherence * 0.4) * 100);

    // ---- Generated rule-based insights (no LLM) ----
    const insights: string[] = [];
    if (peak.score > 0) insights.push(`Your peak productivity window is ${formatHourRange(peak.hour)} — schedule hard tasks here.`);
    if (overdueCount > 0) insights.push(`You have ${overdueCount} overdue task${overdueCount > 1 ? "s" : ""}; clear these first to reduce risk.`);
    if (dueSoonCount > 0) insights.push(`${dueSoonCount} task${dueSoonCount > 1 ? "s are" : " is"} due within 24 hours — front-load them today.`);
    if (lateRate > 0.25) insights.push(`Late completion rate is ${Math.round(lateRate * 100)}%; add a buffer of 15–20% to your duration estimates.`);
    if (avgDuration > 0 && avgDuration > 90) insights.push(`Your average task is ${avgDuration} min — consider breaking large tasks into sub-tasks ≤ 60 min.`);
    if (preferredCategories.length) insights.push(`You complete the most in: ${preferredCategories.join(", ")}. Batch similar categories together.`);
    if (insights.length < 3) insights.push("Log more tasks and time entries to unlock deeper behavioral insights.");

    const deadline_risk_summary = overdueCount > 0
      ? `High risk: ${overdueCount} overdue and ${dueSoonCount} due within 24h. Historical late rate ${Math.round(lateRate * 100)}%.`
      : avgPendingRisk > 0.5
        ? `Moderate risk: several deadlines approaching. Late rate ${Math.round(lateRate * 100)}%.`
        : `Low risk: deadlines are well-managed (${Math.round(lateRate * 100)}% historical late rate).`;

    return new Response(JSON.stringify({
      peak_hours: formatHourRange(peak.hour) + ` (${userTz})`,
      peak_label: usedActualTime ? "Most active time (from recorded work)" : "Most active time (limited data)",
      actual_time_available: usedActualTime,
      avg_task_duration: avgDuration,
      preferred_categories: preferredCategories,
      insights,
      productivity_score: productivityScore,
      deadline_risk_summary,
      range_days: rangeDays,
      deadline_risk: {
        factor: deadlineRiskFactor,
        overdue_count: overdueCount,
        due_within_24h: dueSoonCount,
        due_within_72h: atRiskCount,
        pending_with_deadline: riskScores.length,
        late_completion_rate: Math.round(lateRate * 100),
        risky_tasks: riskyTasks.sort((a, b) => b.risk - a.risk).slice(0, 5),
      },
      totals: { completed: completedTasks.length, pending: pendingTasks.length, total: tasks.length },
      pso: { peak_hour: peak.hour, peak_score: peak.score, iterations: 40, swarm_size: 15 },
      algorithm: "deterministic-stats + pso-peak-hour",
      timestamp: new Date().toISOString(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("behavior-insights error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
