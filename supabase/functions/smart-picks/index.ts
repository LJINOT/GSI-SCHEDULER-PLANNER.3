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

const DAY = 24 * 60;

type WorkWin = {
  start: number;
  end: number;
  overnight: boolean;
  effStart: number;
  effEnd: number;
};

function buildWin(start: number, end: number): WorkWin | null {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start === end) return null;
  const overnight = end < start;
  return {
    start,
    end,
    overnight,
    effStart: start,
    effEnd: overnight ? end + DAY : end,
  };
}

/** Map clock minutes into shift-linear coords, or -1 if outside window. */
function clockToShift(clock: number, ww: WorkWin): number {
  const c = ((clock % DAY) + DAY) % DAY;
  if (!ww.overnight) {
    if (c < ww.start || c > ww.end) return -1;
    return c;
  }
  if (c >= ww.start) return c;
  if (c <= ww.end) return c + DAY;
  return -1;
}

function shiftToClock(shift: number): number {
  return ((shift % DAY) + DAY) % DAY;
}

/**
 * Find earliest free slot of `duration` minutes at/after preferredStart
 * inside the (possibly overnight) work window.
 * Returns clock-minute start/end (end may be < start when crossing midnight).
 */
function findNextAvailableSlot(
  preferredStart: number,
  duration: number,
  occupiedIntervals: { start: number; end: number }[],
  workStart: number,
  workEnd: number,
): { start: number; end: number; unavailable_reason?: string } | null {
  if (duration <= 0) return null;
  const ww = buildWin(workStart, workEnd);
  if (!ww) return null;

  const shiftDur = ww.effEnd - ww.effStart;
  if (duration > shiftDur) {
    return null; // task longer than entire work window
  }

  // Map preferred start into shift space (or window start if outside / before)
  let prefShift = clockToShift(preferredStart, ww);
  if (prefShift < 0) {
    // Outside window: if before shift starts today, use shift start; else no slot today
    if (!ww.overnight) {
      if (preferredStart < ww.start) prefShift = ww.effStart;
      else return null; // after work end
    } else {
      // overnight: preferred in the daytime gap → next shift start
      prefShift = ww.effStart;
    }
  }
  let cursor = Math.max(prefShift, ww.effStart);
  if (cursor + duration > ww.effEnd) return null;

  // Occupied → shift coordinates
  const blocked = occupiedIntervals
    .map((o) => {
      const s = clockToShift(o.start, ww);
      if (s < 0) return null;
      const len = Math.max(1, o.end - o.start);
      // overnight occupied may already span; use duration in clock if end>start else wrap
      let d = o.end > o.start ? o.end - o.start : o.end + DAY - o.start;
      if (!Number.isFinite(d) || d <= 0) d = len;
      return { start: s, end: s + d };
    })
    .filter((x): x is { start: number; end: number } => x != null)
    .sort((a, b) => a.start - b.start);

  for (let i = 0; i < 2000 && cursor + duration <= ww.effEnd; i++) {
    let hit: { start: number; end: number } | null = null;
    for (const b of blocked) {
      if (intervalsOverlap(cursor, cursor + duration, b.start, b.end)) {
        hit = b;
        break;
      }
    }
    if (!hit) {
      const startClock = shiftToClock(cursor);
      const endClock = shiftToClock(cursor + duration);
      return { start: startClock, end: endClock };
    }
    cursor = Math.max(cursor + 1, hit.end);
  }
  return null;
}

function unavailableMessage(
  duration: number,
  workStart: number,
  workEnd: number,
  localMin: number,
): string {
  const ww = buildWin(workStart, workEnd);
  if (!ww) return "Invalid working hours — set start and end in General Settings.";
  const capacity = ww.effEnd - ww.effStart;
  if (duration > capacity) {
    return `Needs ${duration} min but work window is only ${capacity} min.`;
  }
  if (!ww.overnight && localMin >= ww.end) {
    return `Work day ended (${toHHMM(ww.end)}). Try again in the next work window (${toHHMM(ww.start)}–${toHHMM(ww.end)}).`;
  }
  if (!ww.overnight && localMin < ww.start) {
    return `Work starts at ${to12h(toHHMM(ww.start))}.`;
  }
  // Inside window but no free contiguous slot
  return `No free ${duration}-min slot left in ${to12h(toHHMM(ww.start))}–${to12h(toHHMM(ww.end))}.`;
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

/** Minimum distinct days of Focus/task activity before extending work hours. */
const MIN_ACTIVITY_DAYS = 3;
/** Minimum Focus sessions before trusting a learned extension. */
const MIN_SESSIONS_FOR_EXTENSION = 5;
/** Ignore activity older than this many days when learning. */
const ACTIVITY_LOOKBACK_DAYS = 28;
/** Do not extend if latest task activity is older than this. */
const STALE_ACTIVITY_DAYS = 14;
/** Cap how far past configured end we may extend (minutes). */
const MAX_EXTENSION_MINUTES = 4 * 60;

type EffectiveWorkWindow = {
  startMin: number;
  endMin: number;
  overnight: boolean;
  configuredStartMin: number;
  configuredEndMin: number;
  extended: boolean;
  learnedEndMin: number | null;
  activityDays: number;
  reason: string;
};

function localDayKey(iso: string, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(iso));
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
    return `${g("year")}-${g("month")}-${g("day")}`;
  } catch {
    return null;
  }
}

/**
 * Learn an effective recommendation window from Focus Mode time_entries
 * (task activity) and completed_at timestamps. App-only activity is not used.
 *
 * Configured hours are the default. Extension past work_end requires repeated
 * multi-day evidence of task sessions ending later.
 */
function learnEffectiveWorkWindow(
  timeEntries: any[],
  completedTasks: any[],
  timeZone: string,
  configuredStartMin: number,
  configuredEndMin: number,
): EffectiveWorkWindow {
  const configuredOvernight = configuredEndMin < configuredStartMin;
  const base: EffectiveWorkWindow = {
    startMin: configuredStartMin,
    endMin: configuredEndMin,
    overnight: configuredOvernight,
    configuredStartMin,
    configuredEndMin,
    extended: false,
    learnedEndMin: null,
    activityDays: 0,
    reason: "This time is within your configured work hours.",
  };

  const now = Date.now();
  const lookbackMs = ACTIVITY_LOOKBACK_DAYS * 86_400_000;
  const staleMs = STALE_ACTIVITY_DAYS * 86_400_000;

  // Per-day max end minute of task activity (Focus sessions)
  const dayEnd = new Map<string, number>();
  const dayStart = new Map<string, number>();
  let sessionCount = 0;
  let latestActivityMs = 0;

  for (const e of timeEntries || []) {
    if (!e.start_time) continue;
    const startMs = new Date(e.start_time).getTime();
    if (!Number.isFinite(startMs) || now - startMs > lookbackMs) continue;

    const mins = Number(e.duration) || (
      e.end_time
        ? Math.max(0, Math.round((new Date(e.end_time).getTime() - startMs) / 60000))
        : 0
    );
    if (mins <= 0) continue;

    const endMs = e.end_time
      ? new Date(e.end_time).getTime()
      : startMs + mins * 60_000;
    if (Number.isFinite(endMs)) latestActivityMs = Math.max(latestActivityMs, endMs);

    const day = localDayKey(e.start_time, timeZone);
    const startHm = localHourMinute(e.start_time, timeZone);
    if (!day || !startHm) continue;

    const startMinOfDay = startHm.hour * 60 + startHm.minute;
    const endMinOfDay = (startMinOfDay + mins) % (24 * 60);
    // For learning "works late", use session end clock (may wrap past midnight)
    let endClock = endMinOfDay;
    if (e.end_time) {
      const endHm = localHourMinute(e.end_time, timeZone);
      if (endHm) endClock = endHm.hour * 60 + endHm.minute;
    }

    sessionCount += 1;
    const prevEnd = dayEnd.get(day);
    // Prefer later end on same calendar day; for overnight sessions ending after midnight,
    // treat end clocks in 0–6h as "late" by adding 24h for comparison within that day key
    let endScore = endClock;
    if (endClock < startMinOfDay) endScore = endClock + 24 * 60;
    const prevScore = prevEnd == null ? -1 : (prevEnd < 6 * 60 && startMinOfDay > 12 * 60 ? prevEnd + 24 * 60 : prevEnd);
    if (endScore > prevScore) dayEnd.set(day, endClock);

    const prevStart = dayStart.get(day);
    if (prevStart == null || startMinOfDay < prevStart) dayStart.set(day, startMinOfDay);
  }

  // Completions only reinforce days already seen or add weak signal — prefer Focus data
  for (const t of completedTasks || []) {
    const when = t.completed_at || t.updated_at;
    if (!when) continue;
    const ms = new Date(when).getTime();
    if (!Number.isFinite(ms) || now - ms > lookbackMs) continue;
    latestActivityMs = Math.max(latestActivityMs, ms);
    const day = localDayKey(when, timeZone);
    const hm = localHourMinute(when, timeZone);
    if (!day || !hm) continue;
    const m = hm.hour * 60 + hm.minute;
    // Only boost end if we already have Focus data that day, or count as light evidence
    if (dayEnd.has(day)) {
      const prev = dayEnd.get(day)!;
      if (m > prev) dayEnd.set(day, m);
    }
  }

  const activityDays = dayEnd.size;
  base.activityDays = activityDays;

  if (sessionCount < MIN_SESSIONS_FOR_EXTENSION || activityDays < MIN_ACTIVITY_DAYS) {
    base.reason =
      sessionCount === 0
        ? "Limited recent activity data is available, so recommendations use your configured work window."
        : "Limited recent activity data is available, so recommendations use your configured work window.";
    return base;
  }

  if (latestActivityMs > 0 && now - latestActivityMs > staleMs) {
    base.reason =
      "Recent task activity is stale, so recommendations stay within your configured work window.";
    return base;
  }

  // Median / upper-quartile of daily end times (same-day comparison)
  const ends = [...dayEnd.values()].sort((a, b) => a - b);
  // For extension past configured end on same-day schedules, compare ends that are
  // later than configured end (including post-midnight as late)
  const configuredOvernight = configuredEndMin < configuredStartMin;
  if (configuredOvernight) {
    // Overnight configured: do not auto-extend further without separate logic
    base.reason = "This time is within your configured work hours.";
    return base;
  }

  // Use 75th percentile of daily activity end clocks
  const idx = Math.min(ends.length - 1, Math.floor(ends.length * 0.75));
  let learnedEnd = ends[idx];

  // Isolated late outlier: if only 1 day is far past median, use median instead
  const median = ends[Math.floor(ends.length / 2)];
  const lateDays = ends.filter((e) => e > configuredEndMin + 30).length;
  if (lateDays < 2) {
    // Need at least 2 distinct days working past configured end
    base.reason = "This time is within your configured work hours.";
    return base;
  }
  // Cap learned end: not more than median+90 if one day is extreme
  if (learnedEnd > median + 90) learnedEnd = median + 90;

  if (learnedEnd <= configuredEndMin + 15) {
    // Consistently at or before configured end — do not extend
    base.reason = "This time is within your configured work hours.";
    return base;
  }

  const extension = Math.min(learnedEnd - configuredEndMin, MAX_EXTENSION_MINUTES);
  const effectiveEnd = configuredEndMin + Math.max(0, extension);

  base.endMin = effectiveEnd;
  base.learnedEndMin = learnedEnd;
  base.extended = effectiveEnd > configuredEndMin;
  base.reason = base.extended
    ? "Your activity history indicates that you often work into the evening."
    : "This time is within your configured work hours.";
  return base;
}

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
    const configuredEnd = parseHHMM(profile?.work_end || "17:00");
    const { hour: localHour, minOfDay: localMin, todayStr } = localNow(userTz);

    // Behavior-aware effective window (configured default + optional extension)
    let effective: EffectiveWorkWindow;
    try {
      effective = learnEffectiveWorkWindow(
        timeEntries || [],
        completedTasks || [],
        userTz,
        workStartMin,
        configuredEnd,
      );
    } catch (learnErr) {
      console.warn("learnEffectiveWorkWindow failed, using configured hours:", learnErr);
      effective = {
        startMin: workStartMin,
        endMin: configuredEnd,
        overnight: configuredEnd < workStartMin,
        configuredStartMin: workStartMin,
        configuredEndMin: configuredEnd,
        extended: false,
        learnedEndMin: null,
        activityDays: 0,
        reason: "This time is within your configured work hours.",
      };
    }
    const workEndMin = effective.endMin;
    const overnightWork = effective.overnight;
    const source: "behavior" | "personalization" | "general" =
      effective.extended
        ? "behavior"
        : behavior.evidenceLevel === "learning"
        ? "behavior"
        : profile?.peak_start
        ? "personalization"
        : "general";

    const workWindow = buildWin(workStartMin, workEndMin);

    // Occupied: breaks only if they fall inside the work window + scheduled tasks today
    const occupied: { start: number; end: number; taskId?: string }[] = [];
    if (workWindow) {
      for (const b of FIXED_BREAKS) {
        const s = clockToShift(b.start, workWindow);
        if (s < 0) continue;
        const breakDur = b.end - b.start;
        if (s + breakDur > workWindow.effEnd) continue;
        occupied.push({ start: b.start, end: b.end });
      }
    }
    for (const t of tasks as any[]) {
      if (!t.start_time) continue;
      const sm = taskStartOnToday(t.start_time, userTz, todayStr);
      if (sm == null) continue;
      const dur = Math.max(5, Math.min(480, Number(t.estimated_duration) || 30));
      // Keep occupied even if slightly outside — findNextAvailableSlot maps via clockToShift
      occupied.push({ start: sm, end: sm + dur, taskId: t.id });
    }

    // --- Existing behavioral scoring (unchanged weights) ---
    type Scored = {
      id: string;
      title: string;
      reason: string;
      _windowReason?: string;
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
        // User planned duration (same field as scheduling) — do not invent a different length
        const duration = Math.max(5, Math.min(480, Number(t.estimated_duration) || 30));

        // Prefer "now" when inside the work window; otherwise window start (handles overnight)
        let preferredStart = localMin;
        if (workWindow) {
          preferredStart =
            clockToShift(localMin, workWindow) >= 0 ? localMin : workStartMin;
          // Soft peak preference only when peak falls inside the work window
          const diff = (t.difficulty || "medium").toLowerCase();
          if (diff === "hard" && clockToShift(peakStartMin, workWindow) >= 0) {
            preferredStart = Math.max(preferredStart, peakStartMin);
          } else if (diff === "easy" && clockToShift(peakEndMin, workWindow) >= 0) {
            preferredStart = Math.max(preferredStart, peakEndMin);
          }
        } else {
          preferredStart = Math.max(localMin, workStartMin);
        }

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
          _windowReason: effective.reason,
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
        const msg = unavailableMessage(
          item.duration,
          workStartMin,
          workEndMin,
          localMin,
        );
        picks.push({
          id: item.id,
          title: item.title,
          reason: item.reason,
          priority: item.priority,
          score: item.score,
          suggested_time: msg,
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

      // Explain flexible hours when the slot starts after the configured work end
      let reason = item.reason;
      if (
        effective.extended &&
        slot.start >= effective.configuredEndMin &&
        item._windowReason
      ) {
        reason = `${item.reason}; ${item._windowReason}`;
      } else if (item._windowReason && !effective.extended) {
        // keep AHP reasons primary; optional short window note only if limited data
        if (
          item._windowReason.includes("Limited") ||
          item._windowReason.includes("stale")
        ) {
          reason = `${item.reason}; ${item._windowReason}`;
        }
      }

      picks.push({
        id: item.id,
        title: item.title,
        reason,
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
        work_window: {
          start: toHHMM(workStartMin),
          end: toHHMM(workEndMin),
          configured_start: toHHMM(effective.configuredStartMin),
          configured_end: toHHMM(effective.configuredEndMin),
          overnight: !!(workWindow && workWindow.overnight),
          extended: effective.extended,
          learned_end: effective.learnedEndMin != null
            ? toHHMM(effective.learnedEndMin)
            : null,
          activity_days: effective.activityDays,
          duration_minutes: workWindow
            ? workWindow.effEnd - workWindow.effStart
            : null,
          reason: effective.reason,
        },
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
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : "Smart picks failed";
    return new Response(
      JSON.stringify({
        error: message,
        picks: [],
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
