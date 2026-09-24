import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Existing AHP weights — do not change */
const W = { urgency: 0.50, quickWin: 0.20, flow: 0.15, cognitive: 0.15 };

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
function cognitiveFitScore(difficulty: string | undefined, localHour: number, peakStart: number, peakEnd: number): number {
  const d = (difficulty || "medium").toLowerCase();
  const inPeak = localHour >= Math.floor(peakStart / 60) && localHour < Math.ceil(peakEnd / 60);
  if (inPeak) return d === "hard" ? 1.0 : d === "medium" ? 0.8 : 0.55;
  if (localHour >= 12 && localHour < 17) return d === "medium" ? 0.85 : d === "hard" ? 0.55 : 0.65;
  return d === "easy" ? 0.95 : d === "medium" ? 0.55 : 0.3;
}

/** True if [a0,a1) overlaps [b0,b1) — adjacent endpoints do NOT overlap */
function intervalsOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && a1 > b0;
}

/**
 * Single allocation function used for all recommendations.
 * Finds earliest free [start, end) of length `duration` at/after preferredStart.
 */
function findNextAvailableSlot(
  preferredStart: number,
  duration: number,
  occupiedIntervals: { start: number; end: number }[],
  workStart: number,
  workEnd: number,
): { start: number; end: number } | null {
  if (duration <= 0) return null;
  let cursor = Math.max(preferredStart, workStart);
  if (cursor + duration > workEnd) return null;

  const blocked = [...occupiedIntervals].sort((a, b) => a.start - b.start);

  for (let i = 0; i < 1000 && cursor + duration <= workEnd; i++) {
    let hit: { start: number; end: number } | null = null;
    for (const b of blocked) {
      if (intervalsOverlap(cursor, cursor + duration, b.start, b.end)) {
        hit = b;
        break;
      }
    }
    if (!hit) return { start: cursor, end: cursor + duration };
    // Jump past the conflicting interval (not a fixed +30)
    cursor = Math.max(cursor + 1, hit.end);
  }
  return null;
}

function localNow(tz: string): { hour: number; minOfDay: number; todayStr: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
    const hour = Number(g("hour"));
    const minute = Number(g("minute"));
    return { hour, minOfDay: hour * 60 + minute, todayStr: `${g("year")}-${g("month")}-${g("day")}` };
  } catch {
    const n = new Date();
    return {
      hour: n.getUTCHours(),
      minOfDay: n.getUTCHours() * 60 + n.getUTCMinutes(),
      todayStr: n.toISOString().slice(0, 10),
    };
  }
}

function taskStartOnToday(iso: string, tz: string, todayStr: string): number | null {
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
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
    if (`${g("year")}-${g("month")}-${g("day")}` !== todayStr) return null;
    return Number(g("hour")) * 60 + Number(g("minute"));
  } catch {
    return null;
  }
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

    const [{ data: tasks }, { data: profile }, { data: timeEntries }, { data: completedTasks }] = await Promise.all([
      supabase.from("tasks").select("*").neq("status", "done").eq("user_id", user.id).or("archived.eq.false,archived.is.null"),
      supabase.from("profiles").select("work_start, work_end, peak_start, peak_end, break_style, timezone").eq("id", user.id).single(),
      supabase.from("time_entries").select("task_id, start_time, end_time, duration").eq("user_id", user.id),
      supabase.from("tasks").select("id, completed_at, updated_at").eq("user_id", user.id).eq("status", "done").or("archived.eq.false,archived.is.null"),
    ]);

    if (!tasks || tasks.length === 0) {
      return new Response(JSON.stringify({ picks: [], algorithm: "ahp-smart-picks", timestamp: new Date().toISOString() }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const configuredPeakStart = parseHHMM(profile?.peak_start || profile?.work_start || "09:00");
    const configuredPeakEnd = parseHHMM(profile?.peak_end || "12:00");
    const userTz = profile?.timezone || "UTC";
    const behavior = buildBehavioralProfile(timeEntries || [], completedTasks || [], userTz, configuredPeakStart, configuredPeakEnd, (tasks || []).length + (completedTasks || []).length);
    const peakStartMin = behavior.peakStartMin;
    const peakEndMin = behavior.peakEndMin;
    const workStartMin = parseHHMM(profile?.work_start || "09:00");
    // Recommendation search window: respect work_end but allow evening if work_end is early
    // so sequential long tasks can still get non-overlapping slots (recommendation-only).
    const configuredEnd = parseHHMM(profile?.work_end || "17:00");
    const workEndMin = Math.max(configuredEnd, 22 * 60); // up to 10 PM for suggestion packing
    const source: "behavior" | "personalization" | "general" = behavior.evidenceLevel === "learning"
      ? "behavior"
      : profile?.peak_start ? "personalization" : "general";
    const { hour: localHour, minOfDay: localMin, todayStr } = localNow(userTz);

    // Occupied: fixed breaks + existing scheduled tasks today
    const occupied: { start: number; end: number; taskId?: string }[] = FIXED_BREAKS.map((b) => ({
      start: b.start,
      end: b.end,
    }));
    for (const t of tasks as any[]) {
      if (!t.start_time) continue;
      const sm = taskStartOnToday(t.start_time, userTz, todayStr);
      if (sm == null) continue;
      const dur = Math.max(5, Math.min(480, Number(t.estimated_duration) || 30));
      occupied.push({ start: sm, end: sm + dur, taskId: t.id });
    }

    // --- Existing behavioral scoring (unchanged weights) ---
    type Scored = {
      id: string;
      title: string;
      reason: string;
      priority: string;
      score: number;
      duration: number;
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
        const duration = Math.max(15, Math.min(180, Number(t.estimated_duration) || 30));

        let preferredStart = Math.max(localMin, workStartMin);
        if ((t.difficulty || "medium") === "hard") preferredStart = Math.max(preferredStart, peakStartMin);
        else if ((t.difficulty || "medium") === "easy") preferredStart = Math.max(preferredStart, peakEndMin);

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
          duration,
          preferredStart,
          breakdown: { urgency: u, quick_win: q, flow: f, cognitive_fit: c },
        };
      })
      .sort((a, b) => b.score - a.score);

    // --- Sequential non-overlapping allocation ---
    // occupied grows with each assigned recommendation so the next task cannot reuse the same start.
    const picks: any[] = [];

    for (const item of scored) {
      const already = occupied.find((o) => o.taskId === item.id);
      if (already) {
        picks.push({
          id: item.id,
          title: item.title,
          reason: item.reason + "; already scheduled today",
          priority: item.priority,
          score: item.score,
          suggested_time: `${to12h(toHHMM(already.start))} – ${to12h(toHHMM(already.end))}`,
          recommended_start: toHHMM(already.start),
          recommended_end: toHHMM(already.end),
          duration: item.duration,
          breakdown: item.breakdown,
          available: true,
        });
        continue;
      }

      const slot = findNextAvailableSlot(
        item.preferredStart,
        item.duration,
        occupied,
        workStartMin,
        workEndMin,
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

      // CRITICAL: reserve immediately so next recommendation cannot start at the same time
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

    // Display order: by allocated start time (collision-free timeline)
    const available = picks
      .filter((p) => p.available && p.recommended_start)
      .sort((a, b) => parseHHMM(a.recommended_start) - parseHHMM(b.recommended_start));
    const unavailable = picks.filter((p) => !p.available);
    const finalPicks = [...available, ...unavailable].slice(0, 25);

    // Sanity: no two available picks may overlap
    for (let i = 0; i < available.length; i++) {
      for (let j = i + 1; j < available.length; j++) {
        const a0 = parseHHMM(available[i].recommended_start);
        const a1 = parseHHMM(available[i].recommended_end);
        const b0 = parseHHMM(available[j].recommended_start);
        const b1 = parseHHMM(available[j].recommended_end);
        if (intervalsOverlap(a0, a1, b0, b1)) {
          console.error("OVERLAP BUG", available[i].title, available[j].title);
        }
      }
    }

    const recommendationTimestamp = new Date().toISOString();

    // Persist the exact recommendation event for this user.
    // This keeps "Last analyzed" tied to recommendations rather than
    // unrelated behavior-log events.
    const { error: historyError } = await supabase
      .from("recommendation_history")
      .insert({
        user_id: user.id,
        source: "smart-picks",
        picks: finalPicks,
        factors: {
          weights: W,
          peak_source: source,
          peak_window: `${to12h(toHHMM(peakStartMin))} – ${to12h(toHHMM(peakEndMin))}`,
          behavior: {
            evidence_level: behavior.evidenceLevel,
            actual_minutes: behavior.actualMinutes,
            average_actual_minutes: behavior.avgActualMinutes,
            completed_sessions: behavior.completedSessions,
          },
          break_style: profile?.break_style || "pomodoro",
          timezone: userTz,
        },
        created_at: recommendationTimestamp,
      });

    if (historyError) {
      console.warn("Could not save recommendation history:", historyError.message);
    }

    return new Response(
      JSON.stringify({
        picks: finalPicks,
        weights: W,
        peak_source: source,
        peak_window: `${to12h(toHHMM(peakStartMin))} – ${to12h(toHHMM(peakEndMin))}`,
        break_style: profile?.break_style || "pomodoro",
        algorithm: "ahp-immediate-tasks + sequential-non-overlapping-slots",
        timestamp: recommendationTimestamp,
        timezone: userTz,
        behavior_profile: {
          evidence_level: behavior.evidenceLevel,
          actual_minutes: behavior.actualMinutes,
          average_actual_minutes: behavior.avgActualMinutes,
          completed_sessions: behavior.completedSessions,
          completion_rate: behavior.completionRate,
        },
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
