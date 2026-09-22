import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const W = { urgency: 0.45, quickWin: 0.15, flow: 0.15, cognitive: 0.15, behavior: 0.10 };

function urgencyScore(due?: string | null): number {
  if (!due) return 0.15;
  const hoursLeft = (new Date(due).getTime() - Date.now()) / 3_600_000;
  if (hoursLeft < 0) return 1.0;
  if (hoursLeft < 6) return 0.95;
  if (hoursLeft < 24) return 0.85;
  if (hoursLeft < 72) return 0.6;
  if (hoursLeft < 168) return 0.35;
  return 0.15;
}
function quickWinScore(min?: number): number {
  const m = min || 30;
  if (m <= 15) return 1.0;
  if (m <= 30) return 0.8;
  if (m <= 60) return 0.55;
  if (m <= 120) return 0.3;
  return 0.1;
}
function flowScore(status?: string): number {
  if (status === "in_progress") return 1.0;
  if (status === "todo") return 0.6;
  return 0.3;
}
function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + (m || 0);
}
function toHHMM(min: number): string {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hr = ((h + 11) % 12) + 1;
  return `${hr}:${String(m).padStart(2, "0")} ${period}`;
}
function cognitiveFitScore(difficulty: string | undefined, localHour: number, peakStart: number, peakEnd: number): number {
  const d = (difficulty || "medium").toLowerCase();
  const inPeak = localHour >= Math.floor(peakStart / 60) && localHour < Math.ceil(peakEnd / 60);
  if (inPeak) return d === "hard" ? 1.0 : d === "medium" ? 0.8 : 0.55;
  if (localHour >= 12 && localHour < 17) return d === "medium" ? 0.85 : d === "hard" ? 0.55 : 0.65;
  return d === "easy" ? 0.95 : d === "medium" ? 0.55 : 0.3;
}
function peakFromHistogram(hist: number[]): number {
  let best = 9, bestScore = -1;
  for (let h = 0; h < 24; h++) {
    const score = hist[h] * 2 + hist[(h + 23) % 24] + hist[(h + 1) % 24];
    if (score > bestScore) { bestScore = score; best = h; }
  }
  return best;
}
function localHourInTz(tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).formatToParts(new Date());
    return Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  } catch {
    return new Date().getUTCHours();
  }
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

    const [{ data: tasks }, { data: profile }, { data: entries }, { data: prevHist }] = await Promise.all([
      supabase.from("tasks").select("*").eq("user_id", user.id).eq("archived", false).neq("status", "done"),
      supabase.from("profiles").select("work_start, work_end, peak_start, peak_end, break_style, timezone").eq("id", user.id).single(),
      supabase.from("time_entries").select("start_time, end_time, duration, task_id").eq("user_id", user.id).not("end_time", "is", null).order("start_time", { ascending: false }).limit(200),
      supabase.from("recommendation_history").select("id, picks, created_at").eq("user_id", user.id).eq("source", "smart-picks").order("created_at", { ascending: false }).limit(1),
    ]);

    if (!tasks || tasks.length === 0) {
      return new Response(JSON.stringify({ picks: [], algorithm: "ahp-smart-picks", timestamp: new Date().toISOString(), insufficient_behavior_data: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const tz = profile?.timezone || "UTC";
    let peakStartMin = parseHHMM(profile?.peak_start || profile?.work_start || "09:00");
    let peakEndMin = parseHHMM(profile?.peak_end || "12:00");
    const workStartMin = parseHHMM(profile?.work_start || "09:00");
    const workEndMin = parseHHMM(profile?.work_end || "17:00");
    let peakSource: "behavior" | "personalization" | "general" = profile?.peak_start ? "personalization" : "general";

    const hist = Array(24).fill(0) as number[];
    const entryList = entries || [];
    for (const e of entryList) {
      try {
        const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(e.start_time));
        const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
        hist[h] += 1;
      } catch { /* skip */ }
    }
    const behaviorSamples = entryList.length;
    if (behaviorSamples >= 3) {
      const peakH = peakFromHistogram(hist);
      peakStartMin = peakH * 60;
      peakEndMin = Math.min(24 * 60, peakH * 60 + 120);
      peakSource = "behavior";
    }

    const localHour = localHourInTz(tz);
    const localMin = localHour * 60;
    const factorsUsed = ["urgency", "quick_win", "flow", "cognitive_fit"];
    if (behaviorSamples >= 3) factorsUsed.push("behavior_peak");

    const scored = tasks.map((t: any) => {
      const u = urgencyScore(t.due_date);
      const q = quickWinScore(t.estimated_duration);
      const f = flowScore(t.status);
      const c = cognitiveFitScore(t.difficulty, localHour, peakStartMin, peakEndMin);
      const b = behaviorSamples >= 3 ? Math.min(1, hist[Math.floor(peakStartMin / 60)] / Math.max(1, Math.max(...hist))) : 0.5;
      const score = (u * W.urgency + q * W.quickWin + f * W.flow + c * W.cognitive + b * W.behavior) * 100;
      const priority = score >= 70 ? "high" : score >= 45 ? "medium" : "low";
      const dur = Math.max(15, Math.min(180, t.estimated_duration || 30));
      let slotStart = Math.max(localMin, workStartMin);
      if ((t.difficulty || "medium") === "hard") slotStart = Math.max(slotStart, peakStartMin);
      else if ((t.difficulty || "medium") === "easy") slotStart = Math.max(slotStart, peakEndMin);
      for (const [bs, be] of [[9*60, 9*60+15], [12*60, 13*60], [15*60, 15*60+15]]) {
        if (slotStart < be && slotStart + dur > bs) slotStart = be;
      }
      if (slotStart + dur > workEndMin) slotStart = Math.max(workStartMin, workEndMin - dur);
      const suggested_time = `${to12h(toHHMM(slotStart))} – ${to12h(toHHMM(slotStart + dur))}`;
      const reasons: string[] = [];
      if (u >= 0.9) reasons.push("deadline is critical or overdue");
      else if (u >= 0.6) reasons.push("deadline within 72h");
      if (f >= 1) reasons.push("already in progress");
      if (q >= 0.8) reasons.push("short duration — quick win");
      if (c >= 0.85) reasons.push("fits your current energy window");
      if (behaviorSamples >= 3 && peakSource === "behavior") reasons.push(`aligns with your observed peak around ${to12h(toHHMM(peakStartMin))}`);
      if (!reasons.length) reasons.push("balanced score across available factors");
      return {
        id: t.id, title: t.title, reason: reasons.join("; "), priority,
        score: Math.round(score * 10) / 10, suggested_time,
        estimated_duration: t.estimated_duration ?? null,
        breakdown: { urgency: u, quick_win: q, flow: f, cognitive_fit: c, behavior: behaviorSamples >= 3 ? b : undefined },
        factors_used: factorsUsed,
      };
    });
    scored.sort((a, b) => b.score - a.score);
    const picks = scored.slice(0, 10);

    await supabase.from("recommendation_history").insert({
      user_id: user.id, source: "smart-picks",
      picks: picks.map((p) => ({ id: p.id, title: p.title, suggested_time: p.suggested_time, score: p.score, priority: p.priority })),
      factors: { weights: W, peak_source: peakSource, behavior_samples: behaviorSamples },
    });
    await supabase.from("behavior_logs").insert({
      user_id: user.id, metric_type: "smart_picks_run", value: { count: picks.length, peak_source: peakSource },
    });

    const previous = prevHist?.[0] || null;
    return new Response(JSON.stringify({
      picks,
      weights: { urgency: W.urgency, quickWin: W.quickWin, flow: W.flow, cognitive: W.cognitive, behavior: W.behavior },
      factors_used: factorsUsed, peak_source: peakSource,
      peak_window: `${to12h(toHHMM(peakStartMin))} – ${to12h(toHHMM(peakEndMin))}`,
      break_style: profile?.break_style || "pomodoro",
      behavior_samples: behaviorSamples, insufficient_behavior_data: behaviorSamples < 3,
      previous_recommendation: previous ? { created_at: previous.created_at, picks: previous.picks } : null,
      algorithm: "ahp-smart-picks", timestamp: new Date().toISOString(), timezone: tz,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("smart-picks error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
