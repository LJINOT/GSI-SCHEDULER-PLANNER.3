import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// AHP weights for "what to do RIGHT NOW":
const W = { urgency: 0.50, quickWin: 0.20, flow: 0.15, cognitive: 0.15 };

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
  const h = Math.floor(min / 60), m = min % 60;
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

    const [{ data: tasks }, { data: profile }, { data: behaviorLogs }] = await Promise.all([
      supabase.from("tasks").select("*").neq("status", "done").eq("user_id", user.id),
      supabase.from("profiles").select("work_start, work_end, peak_start, peak_end, break_style").eq("id", user.id).single(),
      supabase.from("behavior_logs").select("*").eq("user_id", user.id).eq("metric_type", "peak_hour").order("recorded_at", { ascending: false }).limit(1),
    ]);

    if (!tasks || tasks.length === 0) {
      return new Response(JSON.stringify({ picks: [], algorithm: "ahp-smart-picks", timestamp: new Date().toISOString() }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Establish peak window: behavioral log overrides personalization, which overrides general work hours
    let peakStartMin = parseHHMM(profile?.peak_start || profile?.work_start || "09:00");
    let peakEndMin = parseHHMM(profile?.peak_end || profile?.work_end || "12:00");
    const workStartMin = parseHHMM(profile?.work_start || "09:00");
    const workEndMin = parseHHMM(profile?.work_end || "17:00");
    let source: "behavior" | "personalization" | "general" = profile?.peak_start ? "personalization" : "general";
    if (behaviorLogs && behaviorLogs[0]?.value) {
      const v: any = behaviorLogs[0].value;
      if (typeof v.hour === "number") {
        peakStartMin = v.hour * 60;
        peakEndMin = (v.hour + 2) * 60;
        source = "behavior";
      }
    }

    const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
    const now = new Date(Date.now() + MANILA_OFFSET_MS);
    const localHour = now.getUTCHours();
    const localMin = now.getUTCHours() * 60 + now.getUTCMinutes();

    const scored = (tasks as any[]).map(t => {
      const u = urgencyScore(t.due_date);
      const q = quickWinScore(t.estimated_duration);
      const f = flowScore(t.status);
      const c = cognitiveFitScore(t.difficulty, localHour, peakStartMin, peakEndMin);
      const score = (u * W.urgency + q * W.quickWin + f * W.flow + c * W.cognitive) * 100;
      const priority = score >= 70 ? "high" : score >= 45 ? "medium" : "low";

      // Adaptive timeslot: harder tasks → in peak; quick wins → between break slots; default → next available work slot
      const dur = Math.max(15, Math.min(180, t.estimated_duration || 30));
      let slotStart = Math.max(localMin, workStartMin);
      if ((t.difficulty || "medium") === "hard") slotStart = Math.max(slotStart, peakStartMin);
      else if ((t.difficulty || "medium") === "easy") slotStart = Math.max(slotStart, peakEndMin);
      if (slotStart + dur > workEndMin) slotStart = Math.max(workStartMin, workEndMin - dur);
      const slotEnd = slotStart + dur;
      const suggested_time = `${to12h(toHHMM(slotStart))} – ${to12h(toHHMM(slotEnd))}`;

      const reasons: string[] = [];
      if (u >= 0.9) reasons.push("deadline is critical");
      else if (u >= 0.6) reasons.push("deadline within 72h");
      if (q >= 0.8) reasons.push("quick win (≤30 min)");
      if (f >= 1.0) reasons.push("already in progress — preserve flow");
      if (c >= 0.9) reasons.push(`good fit for your peak window`);
      if (!reasons.length) reasons.push("balanced AHP score for current moment");

      return {
        id: t.id,
        title: t.title,
        reason: reasons.join("; "),
        priority,
        score: Math.round(score * 10) / 10,
        suggested_time,
        breakdown: { urgency: u, quick_win: q, flow: f, cognitive_fit: c },
      };
    }).sort((a, b) => b.score - a.score);

    const picks = scored.slice(0, 5);

    return new Response(JSON.stringify({
      picks,
      weights: W,
      peak_source: source,
      peak_window: `${to12h(toHHMM(peakStartMin))} – ${to12h(toHHMM(peakEndMin))}`,
      break_style: profile?.break_style || "pomodoro",
      algorithm: "ahp-immediate-tasks + adaptive-timeslot",
      timestamp: new Date().toISOString(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("smart-picks error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
