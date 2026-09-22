import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Existing AHP weights for "what to do RIGHT NOW" — do not change
const W = { urgency: 0.50, quickWin: 0.20, flow: 0.15, cognitive: 0.15 };

/** Fixed GSI breaks (minutes from midnight) */
const FIXED_BREAKS: { start: number; end: number }[] = [
  { start: 9 * 60, end: 9 * 60 + 15 },
  { start: 12 * 60, end: 13 * 60 },
  { start: 15 * 60, end: 15 * 60 + 15 },
];

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
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hr = ((h + 11) % 12) + 1;
  return `${hr}:${String(m).padStart(2, "0")} ${period}`;
}

function cognitiveFitScore(
  difficulty: string | undefined,
  localHour: number,
  peakStart: number,
  peakEnd: number,
): number {
  const d = (difficulty || "medium").toLowerCase();
  const inPeak = localHour >= Math.floor(peakStart / 60) && localHour < Math.ceil(peakEnd / 60);
  if (inPeak) return d === "hard" ? 1.0 : d === "medium" ? 0.8 : 0.55;
  if (localHour >= 12 && localHour < 17) return d === "medium" ? 0.85 : d === "hard" ? 0.55 : 0.65;
  return d === "easy" ? 0.95 : d === "medium" ? 0.55 : 0.3;
}

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && a1 > b0;
}

/**
 * Earliest free interval of length `dur` starting at/after `preferred`,
 * within [workStart, workEnd], avoiding all busy blocks (existing schedule + breaks + prior recommendations).
 */
function findAvailableSlot(
  preferred: number,
  dur: number,
  workStart: number,
  workEnd: number,
  busy: { start: number; end: number }[],
): { start: number; end: number } | null {
  if (dur <= 0 || preferred + dur > workEnd && preferred < workStart) {
    /* still try from workStart */
  }
  let cursor = Math.max(preferred, workStart);
  if (cursor + dur > workEnd) return null;

  const blocked = [...busy].sort((a, b) => a.start - b.start);

  // Cap iterations to avoid infinite loop
  for (let guard = 0; guard < 500 && cursor + dur <= workEnd; guard++) {
    let collision: { start: number; end: number } | null = null;
    for (const b of blocked) {
      if (overlaps(cursor, cursor + dur, b.start, b.end)) {
        collision = b;
        break;
      }
    }
    if (!collision) {
      return { start: cursor, end: cursor + dur };
    }
    // Jump to end of blocking interval
    cursor = Math.max(cursor + 1, collision.end);
  }
  return null;
}

function localMinutesInTz(tz: string): { hour: number; minOfDay: number; todayStr: string } {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
    const hour = Number(get("hour"));
    const minute = Number(get("minute"));
    const todayStr = `${get("year")}-${get("month")}-${get("day")}`;
    return { hour, minOfDay: hour * 60 + minute, todayStr };
  } catch {
    const n = new Date();
    return {
      hour: n.getUTCHours(),
      minOfDay: n.getUTCHours() * 60 + n.getUTCMinutes(),
      todayStr: n.toISOString().slice(0, 10),
    };
  }
}

function startMinutesOnDate(iso: string, tz: string, todayStr: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date(iso));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
    const ds = `${get("year")}-${get("month")}-${get("day")}`;
    if (ds !== todayStr) return null;
    return Number(get("hour")) * 60 + Number(get("minute"));
  } catch {
    return null;
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
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: tasks }, { data: profile }, { data: behaviorLogs }] = await Promise.all([
      supabase
        .from("tasks")
        .select("*")
        .neq("status", "done")
        .eq("user_id", user.id)
        .eq("archived", false),
      supabase
        .from("profiles")
        .select("work_start, work_end, peak_start, peak_end, break_style, timezone")
        .eq("id", user.id)
        .single(),
      supabase
        .from("behavior_logs")
        .select("*")
        .eq("user_id", user.id)
        .eq("metric_type", "peak_hour")
        .order("recorded_at", { ascending: false })
        .limit(1),
    ]);

    if (!tasks || tasks.length === 0) {
      return new Response(
        JSON.stringify({ picks: [], algorithm: "ahp-smart-picks", timestamp: new Date().toISOString() }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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

    const userTz = profile?.timezone || "UTC";
    const { hour: localHour, minOfDay: localMin, todayStr } = localMinutesInTz(userTz);

    // ---- Existing scheduled intervals for TODAY (busy) ----
    const busy: { start: number; end: number; taskId?: string }[] = [
      ...FIXED_BREAKS.map((b) => ({ start: b.start, end: b.end })),
    ];
    for (const t of tasks as any[]) {
      if (!t.start_time) continue;
      const sm = startMinutesOnDate(t.start_time, userTz, todayStr);
      if (sm == null) continue;
      const dur = Math.max(5, Math.min(480, Number(t.estimated_duration) || 30));
      busy.push({ start: sm, end: sm + dur, taskId: t.id });
    }

    // ---- STEP 1: existing AHP scoring (unchanged weights / reasons) ----
    type Scored = {
      id: string;
      title: string;
      reason: string;
      priority: string;
      score: number;
      duration: number;
      difficulty: string | null;
      preferredStart: number;
      breakdown: Record<string, number>;
    };

    const scored: Scored[] = (tasks as any[])
      .map((t) => {
        const u = urgencyScore(t.due_date);
        const q = quickWinScore(t.estimated_duration);
        const f = flowScore(t.status);
        const c = cognitiveFitScore(t.difficulty, localHour, peakStartMin, peakEndMin);
        const score = (u * W.urgency + q * W.quickWin + f * W.flow + c * W.cognitive) * 100;
        const priority = score >= 70 ? "high" : score >= 45 ? "medium" : "low";
        const dur = Math.max(15, Math.min(180, Number(t.estimated_duration) || 30));

        // Preferred start from existing behavior logic
        let preferred = Math.max(localMin, workStartMin);
        if ((t.difficulty || "medium") === "hard") preferred = Math.max(preferred, peakStartMin);
        else if ((t.difficulty || "medium") === "easy") preferred = Math.max(preferred, peakEndMin);

        const reasons: string[] = [];
        if (u >= 0.9) reasons.push("deadline is critical");
        else if (u >= 0.6) reasons.push("deadline within 72h");
        if (q >= 0.8) reasons.push("quick win (≤30 min)");
        if (f >= 1.0) reasons.push("already in progress — preserve flow");
        if (c >= 0.9) reasons.push("good fit for your peak window");
        if (!reasons.length) reasons.push("balanced AHP score for current moment");

        return {
          id: t.id,
          title: t.title,
          reason: reasons.join("; "),
          priority,
          score: Math.round(score * 10) / 10,
          duration: dur,
          difficulty: t.difficulty ?? null,
          preferredStart: preferred,
          breakdown: { urgency: u, quick_win: q, flow: f, cognitive_fit: c },
        };
      })
      .sort((a, b) => b.score - a.score);

    // ---- STEP 2–5: sequential slot allocation (no shared preferred-only start) ----
    const occupied = busy.map((b) => ({ start: b.start, end: b.end }));
    const picks: any[] = [];

    for (const item of scored) {
      // Already scheduled today → report existing window (do not re-allocate or write DB)
      const existing = busy.find((b) => b.taskId === item.id);
      if (existing) {
        picks.push({
          id: item.id,
          title: item.title,
          reason: item.reason + "; already scheduled today",
          priority: item.priority,
          score: item.score,
          suggested_time: `${to12h(toHHMM(existing.start))} – ${to12h(toHHMM(existing.end))}`,
          recommended_start: toHHMM(existing.start),
          recommended_end: toHHMM(existing.end),
          duration: item.duration,
          breakdown: item.breakdown,
          available: true,
        });
        continue;
      }

      const slot = findAvailableSlot(
        item.preferredStart,
        item.duration,
        workStartMin,
        workEndMin,
        occupied,
      );

      if (!slot) {
        picks.push({
          id: item.id,
          title: item.title,
          reason: item.reason,
          priority: item.priority,
          score: item.score,
          suggested_time: "No available time slot",
          recommended_start: null,
          recommended_end: null,
          duration: item.duration,
          breakdown: item.breakdown,
          available: false,
        });
        continue;
      }

      // Immediately reserve so the next recommendation cannot reuse this interval
      occupied.push({ start: slot.start, end: slot.end });

      picks.push({
        id: item.id,
        title: item.title,
        reason: item.reason,
        priority: item.priority,
        score: item.score,
        suggested_time: `${to12h(toHHMM(slot.start))} – ${to12h(toHHMM(slot.end))}`,
        recommended_start: toHHMM(slot.start),
        recommended_end: toHHMM(slot.end),
        duration: item.duration,
        breakdown: item.breakdown,
        available: true,
      });
    }

    // Prefer available picks; sort by recommended start time for display
    const available = picks
      .filter((p) => p.available && p.recommended_start)
      .sort((a, b) => parseHHMM(a.recommended_start) - parseHHMM(b.recommended_start));
    const unavailable = picks.filter((p) => !p.available);
    const finalPicks = [...available, ...unavailable].slice(0, 5);

    return new Response(
      JSON.stringify({
        picks: finalPicks,
        weights: W,
        peak_source: source,
        peak_window: `${to12h(toHHMM(peakStartMin))} – ${to12h(toHHMM(peakEndMin))}`,
        break_style: profile?.break_style || "pomodoro",
        algorithm: "ahp-immediate-tasks + sequential-non-overlapping-slots",
        timestamp: new Date().toISOString(),
        timezone: userTz,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("smart-picks error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
