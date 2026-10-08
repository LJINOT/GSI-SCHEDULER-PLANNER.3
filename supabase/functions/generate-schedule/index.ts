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
  category?: string | null;
  difficulty?: string | null;
  estimated_duration?: number | null;
  due_date?: string | null;
  start_time?: string | null;
  priority_score?: number | null;
  status?: string | null;
  archived?: boolean | null;
};

type Block = {
  task_id: string;
  title: string;
  start: string;
  end: string;
  category: string;
  kind: "task" | "break";
  segment_index?: number;
  segment_total?: number;
  priority_score?: number;
  priority?: "High" | "Medium" | "Low";
  overdue?: boolean;
};

type BreakStyle =
  | "pomodoro"
  | "long-focus"
  | "flexible";

type BreakBlock = {
  start: number;
  dur: number;
  title: string;
};

type CSPResult = {
  blocks: Block[];
  scheduledTaskIds: string[];
};

type PSOResult = {
  order: number[];
  best: number;
};

/**
 * Normalize a daily time value to HH:MM.
 * Accepts DB/HTML values such as:
 *   "7:00", "07:00", "07:00:00", "07:00:00.000",
 *   "07:00:00+08:00", "1970-01-01T09:00:00", "9:00 AM"
 * Does NOT use Date objects for simple HH:MM comparisons.
 */
function normalizeTimeString(value: string | null | undefined): string | null {
  if (value == null) return null;
  let s = String(value).trim();
  if (!s) return null;

  // Object-like accidental values
  if (s === "[object Object]") return null;

  // ISO datetime → time portion
  if (s.includes("T")) {
    s = s.split("T")[1] || s;
  }

  // Strip trailing Z, fractional seconds, timezone offsets
  s = s.replace(/Z$/i, "");
  s = s.replace(/\.\d+/, ""); // first fractional group
  s = s.replace(/[+-]\d{2}:?\d{2}$/, "");
  s = s.trim();

  // 12-hour clock: "9:00 AM" / "09:30PM"
  const ampm = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (ampm) {
    let hours = Number(ampm[1]);
    const minutes = Number(ampm[2]);
    const mer = ampm[3].toUpperCase();
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (mer === "AM") {
      if (hours === 12) hours = 0;
    } else {
      if (hours !== 12) hours += 12;
    }
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  // Extract first HH:MM anywhere in the string (handles "09:00:00", noise, etc.)
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  // Allow 24:00 as end-of-day → 23:59 for comparison purposes
  if (hours === 24 && minutes === 0) {
    hours = 23;
    return "23:59";
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(Math.floor(hours)).padStart(2, "0")}:${String(Math.floor(minutes)).padStart(2, "0")}`;
}

function parseHHMM(value: string | null | undefined): number {
  const norm = normalizeTimeString(value);
  if (!norm) return NaN;
  const [hours, minutes] = norm.split(":").map(Number);
  return hours * 60 + minutes;
}

const DAY_MINUTES = 24 * 60;

type WorkWindow = {
  /** Clock minutes 0–1439 */
  startMin: number;
  endMin: number;
  /** True when the shift crosses midnight (e.g. 22:00 → 06:00). */
  overnight: boolean;
  /** Linear shift coordinates: [effectiveStart, effectiveEnd) */
  effectiveStart: number;
  effectiveEnd: number;
};

/**
 * Build a work window. Supports night shifts:
 *   same-day:  09:00 → 17:00  (end > start)
 *   overnight: 22:00 → 06:00  (end < start)
 * Zero-length (end === start) is invalid.
 */
function buildWorkWindow(
  startMin: number,
  endMin: number,
): WorkWindow | null {
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return null;
  if (startMin < 0 || startMin >= DAY_MINUTES) return null;
  if (endMin < 0 || endMin >= DAY_MINUTES) return null;
  if (startMin === endMin) return null; // zero-length

  const overnight = endMin < startMin;
  return {
    startMin,
    endMin,
    overnight,
    effectiveStart: startMin,
    effectiveEnd: overnight ? endMin + DAY_MINUTES : endMin,
  };
}

function isValidWorkWindow(startMin: number, endMin: number): boolean {
  return buildWorkWindow(startMin, endMin) != null;
}

/** Map a clock time into linear shift coordinates, or -1 if outside the window. */
function clockToShift(clockMin: number, ww: WorkWindow): number {
  const c = ((clockMin % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  if (!ww.overnight) {
    if (c < ww.startMin || c > ww.endMin) return -1;
    return c;
  }
  // Overnight: [startMin, 24:00) U [0, endMin]
  if (c >= ww.startMin) return c;
  if (c <= ww.endMin) return c + DAY_MINUTES;
  return -1;
}

function shiftToClock(shiftMin: number): number {
  return ((shiftMin % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

function shiftToHHMM(shiftMin: number): string {
  return toHHMM(shiftToClock(shiftMin));
}

/** Duration of a clock-time block in minutes (shift-aware for overnight). */
function getBlockDurationMinutes(
  startClock: number,
  endClock: number,
  ww: WorkWindow | null,
): number {
  if (ww) {
    const s = clockToShift(startClock, ww);
    const e = clockToShift(endClock, ww);
    if (s >= 0 && e >= 0 && e > s) return e - s;
  }
  // Same-day fallback
  if (endClock > startClock) return endClock - startClock;
  // Cross-midnight without work window context
  if (endClock < startClock) return endClock + DAY_MINUTES - startClock;
  return 0;
}

function getBlockDurationFromStrings(
  startHHMM: string,
  endHHMM: string,
  startMin: number,
  endMin: number,
): number {
  return getBlockDurationMinutes(
    parseHHMM(startHHMM),
    parseHHMM(endHHMM),
    buildWorkWindow(startMin, endMin),
  );
}


/** True if [clockStart, clockEnd] lies fully inside the work window (shift-linear). */
function segmentInWorkWindow(
  clockStart: number,
  clockEnd: number,
  ww: WorkWindow,
): boolean {
  // Zero / negative duration in clock space may cross midnight for overnight
  let s = clockToShift(clockStart, ww);
  if (s < 0) return false;

  let e: number;
  if (!ww.overnight) {
    e = clockEnd;
    if (e <= clockStart) return false;
    if (e > ww.endMin || clockStart < ww.startMin) return false;
    return true;
  }

  // Overnight: end may be next calendar morning
  if (clockEnd > clockStart) {
    // same clock-day segment (e.g. 22:00–23:30)
    e = clockToShift(clockEnd, ww);
    if (e < 0) return false;
    return e > s && e <= ww.effectiveEnd;
  }
  // crosses midnight in the block itself (e.g. 23:00–01:00)
  e = clockToShift(clockEnd, ww);
  if (e < 0) return false;
  return e > s && e <= ww.effectiveEnd;
}

/**
 * Clamp preferred/peak into the work window.
 * For overnight shifts the preferred window must also sit inside the shift.
 */
function clampPeakToWork(
  peakStartMin: number,
  peakEndMin: number,
  startMin: number,
  endMin: number,
): { peakStartMin: number; peakEndMin: number; adjusted: boolean } {
  const ww = buildWorkWindow(startMin, endMin);
  if (!ww) {
    return { peakStartMin: startMin, peakEndMin: endMin, adjusted: true };
  }

  // Default: use full work window
  const full = {
    peakStartMin: ww.startMin,
    peakEndMin: ww.endMin,
    adjusted: true,
  };

  const ps = clockToShift(peakStartMin, ww);
  const pe = clockToShift(peakEndMin, ww);

  if (ps < 0 || pe < 0) return full;

  // Preferred must be a non-empty span in shift space
  let shiftStart = ps;
  let shiftEnd = pe;
  if (shiftEnd <= shiftStart) {
    // peak might be overnight-style inside a same-day job, or invalid — use full
    return full;
  }
  if (shiftStart < ww.effectiveStart) shiftStart = ww.effectiveStart;
  if (shiftEnd > ww.effectiveEnd) shiftEnd = ww.effectiveEnd;
  if (shiftEnd <= shiftStart) return full;

  const outS = shiftToClock(shiftStart);
  const outE = shiftToClock(shiftEnd);
  const adjusted =
    outS !== peakStartMin || outE !== peakEndMin;
  return { peakStartMin: outS, peakEndMin: outE, adjusted };
}

function toHHMM(minutes: number): string {
  // Wrap into a single day so overnight shift coordinates still print as clock times.
  let safe = Math.round(minutes);
  safe = ((safe % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;

  const hours = Math.floor(safe / 60);
  const mins = safe % 60;

  return `${String(hours).padStart(2, "0")}:${String(
    mins
  ).padStart(2, "0")}`;
}

function durationOf(task: Task): number {
  return Math.max(
    5,
    Math.min(
      480,
      Number(task.estimated_duration) || 30
    )
  );
}

/* =========================================================
   PRIORITY FALLBACK / URGENCY
   ========================================================= */

const AHP_MATRIX: number[][] = [
  [1, 3, 4, 5],
  [1 / 3, 1, 2, 3],
  [1 / 4, 1 / 2, 1, 2],
  [1 / 5, 1 / 3, 1 / 2, 1],
];

const AHP_CATEGORY_IMPORTANCE: Record<string, number> = {
  "Client Communication": 0.95,
  "Customer Support": 0.95,
  "Email Management": 0.80,
  "Calendar & Scheduling": 0.85,
  "Administrative Tasks": 0.75,
  "Data Entry": 0.65,
  "Research": 0.80,
  "Report & Documentation": 0.85,
  "File & Document Management": 0.65,
  "Project Coordination": 0.90,
  "Lead Generation": 0.85,
  "CRM Management": 0.80,
  "Social Media Management": 0.75,
  "Content Creation": 0.75,
  "E-commerce Support": 0.80,
  "Bookkeeping & Finance": 0.90,
  "Meeting & Coordination": 0.80,
  "Personal Assistance": 0.60,
  "General / Other": 0.50,
};

function ahpWeights(): number[] {
  let v = [0.25, 0.25, 0.25, 0.25];
  for (let i = 0; i < 100; i++) {
    const next = v.map((_, r) => AHP_MATRIX[r].reduce((sum, value, c) => sum + value * v[c], 0));
    const total = next.reduce((a, b) => a + b, 0) || 1;
    v = next.map((x) => x / total);
  }
  return v;
}

function ahpDeadlineScore(due?: string | null): number {
  if (!due) return 0.15;
  const hours = (new Date(due).getTime() - Date.now()) / 3_600_000;
  if (hours < 0) return 1.0;
  if (hours < 24) return 0.9;
  if (hours < 72) return 0.7;
  if (hours < 168) return 0.45;
  if (hours < 336) return 0.25;
  return 0.1;
}

function ahpDifficultyScore(difficulty?: string | null): number {
  const d = String(difficulty || "medium").toLowerCase();
  return d === "hard" ? 1 : d === "easy" ? 0.3 : 0.6;
}

function ahpDurationScore(minutes?: number | null): number {
  const m = Number(minutes) || 30;
  if (m <= 15) return 1;
  if (m <= 30) return 0.8;
  if (m <= 60) return 0.6;
  if (m <= 120) return 0.4;
  return 0.2;
}

function fallbackAHPScore(task: Task): number {
  const w = ahpWeights();
  const c1 = ahpDeadlineScore(task.due_date);
  const c2 = ahpDifficultyScore(task.difficulty);
  const c3 = ahpDurationScore(task.estimated_duration);
  const c4 = AHP_CATEGORY_IMPORTANCE[task.category || "General / Other"] ?? 0.5;
  return Math.round((c1 * w[0] + c2 * w[1] + c3 * w[2] + c4 * w[3]) * 1000) / 10;
}

function effectivePriorityScore(task: Task): number {
  const stored = Number(task.priority_score);
  return Number.isFinite(stored) && stored > 0 ? stored : fallbackAHPScore(task);
}

function isOverdue(task: Task): boolean {
  if (!task.due_date) return false;
  return new Date(task.due_date).getTime() < Date.now();
}

function priorityTier(task: Task): number {
  const score = effectivePriorityScore(task);
  return score >= 65 ? 3 : score >= 40 ? 2 : 1;
}

/*
 * Priority rule used by Auto Schedule and Adaptive Scheduling:
 * 1) Higher AHP priority always comes first.
 * 2) Within the same priority, a task that is not overdue comes first.
 *    This keeps a current high-priority one-time task ahead of an overdue
 *    high-priority task, while an overdue high task still beats a current
 *    medium task because HIGH is a higher tier.
 * 3) Earlier deadlines then higher AHP score break remaining ties.
 */
function comparePriority(a: Task, b: Task): number {
  const tierDiff = priorityTier(b) - priorityTier(a);
  if (tierDiff !== 0) return tierDiff;

  const overdueDiff = Number(isOverdue(a)) - Number(isOverdue(b));
  if (overdueDiff !== 0) return overdueDiff;

  const ad = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
  const bd = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
  if (ad !== bd) return ad - bd;

  return effectivePriorityScore(b) - effectivePriorityScore(a);
}

function sortByPriority(tasks: Task[]): Task[] {
  return [...tasks].sort(comparePriority);
}

function priorityLabel(task: Task): "High" | "Medium" | "Low" {
  const tier = priorityTier(task);
  return tier === 3 ? "High" : tier === 2 ? "Medium" : "Low";
}

function latestEndForTask(task: Task, scheduleDate: string, fallbackEnd: number): number {
  if (!task.due_date) return fallbackEnd;
  const dueMs = new Date(task.due_date).getTime();
  // An overdue task is already past its deadline, so do not prevent the
  // scheduler from giving it a recovery slot today.
  if (Number.isFinite(dueMs) && dueMs < Date.now()) return fallbackEnd;
  const due = String(task.due_date);
  if (due.slice(0, 10) !== scheduleDate) return fallbackEnd;
  const timePart = due.includes("T") ? due.split("T")[1]?.slice(0, 5) : "23:59";
  const dueMin = parseHHMM(timePart || "23:59");
  return Math.min(fallbackEnd, dueMin);
}

/* =========================================================
   BREAK STYLE
   ========================================================= */

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

  return BREAK_STYLES[style] ??
    BREAK_STYLES.pomodoro;
}

/* =========================================================
   TASK CLEANUP
   ========================================================= */

/*
 * A task should enter PSO/CSP only once.
 */
function uniqueTasks(tasks: Task[]): Task[] {
  const seen = new Set<string>();
  const result: Task[] = [];

  for (const task of tasks) {
    if (!task?.id) continue;

    if (seen.has(task.id)) {
      continue;
    }

    seen.add(task.id);
    result.push(task);
  }

  return result;
}

/* =========================================================
   CSP
   ========================================================= */

function csp(
  tasks: Task[],
  startMin: number,
  endMin: number,
  breakStyle: string,
  scheduleDateForCSP = "",
  notBefore = startMin,
): CSPResult {
  const blocks: Block[] = [];
  const scheduledTaskIds: string[] = [];
  const unique = uniqueTasks(tasks);
  const ww = buildWorkWindow(startMin, endMin);
  if (!ww) {
    return { blocks: [], scheduledTaskIds: [] };
  }
  const effStart = ww.effectiveStart;
  const effEnd = ww.effectiveEnd;

  // Breaks: keep fixed breaks that fit the window; for overnight shifts
  // fall back to relative placement along the shift so day-only breaks
  // (09:00 / 12:00 / 15:00) are not forced onto night workers.
  let breaks: BreakBlock[] = getBreakBlocks(breakStyle)
    .map((b) => {
      const s = clockToShift(b.start, ww);
      if (s < 0) return null;
      const e = s + b.dur;
      if (e > effEnd) return null;
      return { start: s, dur: b.dur, title: b.title };
    })
    .filter((b): b is BreakBlock => b != null)
    .sort((a, b) => a.start - b.start);

  if (breaks.length === 0 && ww.overnight) {
    const shiftDur = effEnd - effStart;
    const style = (breakStyle || "pomodoro") as string;
    const relative: Array<{ frac: number; dur: number; title: string }> =
      style === "long-focus"
        ? [{ frac: 0.5, dur: 45, title: "Shift Break" }]
        : style === "flexible"
        ? [{ frac: 0.45, dur: 30, title: "Shift Break" }]
        : [
            { frac: 0.25, dur: 15, title: "Short Break" },
            { frac: 0.5, dur: 30, title: "Main Break" },
            { frac: 0.75, dur: 15, title: "Short Break" },
          ];
    for (const r of relative) {
      if (r.dur + 30 > shiftDur) continue; // need room for work around break
      const s = Math.round(effStart + shiftDur * r.frac);
      const e = s + r.dur;
      if (e <= effEnd) {
        breaks.push({ start: s, dur: r.dur, title: r.title });
      }
    }
    breaks.sort((a, b) => a.start - b.start);
  }

  // occupied uses linear shift coordinates
  const occupied: Array<{ start: number; end: number; taskId?: string }> = breaks.map((b) => ({
    start: b.start,
    end: b.start + b.dur,
  }));

  const addTaskBlock = (task: Task, start: number, end: number) => {
    blocks.push({
      task_id: task.id,
      title: task.title,
      start: shiftToHHMM(start),
      end: shiftToHHMM(end),
      category: task.category || "General / Other",
      kind: "task",
    });
    occupied.push({ start, end, taskId: task.id });
    occupied.sort((a, b) => a.start - b.start);
  };

  for (const b of breaks) {
    blocks.push({
      task_id: `break-${b.start}`,
      title: b.title,
      start: shiftToHHMM(b.start),
      end: shiftToHHMM(b.start + b.dur),
      category: "Break",
      kind: "break",
    });
  }

  /*
   * CSP uses the available capacity instead of requiring one large
   * continuous block. A long flexible task may therefore use several
   * valid work periods around fixed breaks. This is the important change
   * for 120–480 minute tasks on a normal workday.
   */
  for (const task of unique) {
    let remaining = durationOf(task);
    // Cap placement by due date when it falls inside the work window; otherwise
    // use the full (possibly overnight) effective end so night shifts still fill.
    let latestEndShift = effEnd;
    if (!ww.overnight) {
      const latestEndClock = latestEndForTask(task, scheduleDateForCSP, ww.endMin);
      latestEndShift = Math.min(effEnd, latestEndClock);
    } else if (task.due_date) {
      const latestEndClock = latestEndForTask(task, scheduleDateForCSP, ww.endMin);
      const mapped = clockToShift(latestEndClock, ww);
      if (mapped >= 0) latestEndShift = Math.min(effEnd, mapped);
    }

    while (remaining > 0) {
      const sorted = [...occupied].sort((a, b) => a.start - b.start);
      // notBefore may be clock minutes from caller — map into shift space
      let notBeforeShift = notBefore;
      if (ww.overnight) {
        const mapped = clockToShift(notBefore, ww);
        notBeforeShift = mapped >= 0 ? mapped : effStart;
      }
      let cursor = Math.max(effStart, notBeforeShift);
      let placed = false;

      for (const blocked of sorted) {
        if (blocked.end <= cursor) continue;
        if (blocked.start > cursor) {
          const freeEnd = Math.min(blocked.start, latestEndShift);
          const available = Math.max(0, freeEnd - cursor);
          if (available > 0) {
            const take = Math.min(remaining, available);
            addTaskBlock(task, cursor, cursor + take);
            remaining -= take;
            placed = true;
            break;
          }
        }
        cursor = Math.max(cursor, blocked.end);
        if (cursor >= effEnd) break;
      }

      if (!placed && cursor < latestEndShift) {
        const available = latestEndShift - cursor;
        if (available > 0) {
          const take = Math.min(remaining, available);
          addTaskBlock(task, cursor, cursor + take);
          remaining -= take;
          placed = true;
        }
      }

      if (!placed) break;
      // A single-task segment is enough to continue; this flag exists to
      // document that later segments are intentional, not duplicate tasks.
      notBefore = startMin;
    }

    if (remaining <= 0) scheduledTaskIds.push(task.id);
  }

  const segmentCounts = new Map<string, number>();
  for (const block of blocks) {
    if (block.kind === "task") {
      segmentCounts.set(block.task_id, (segmentCounts.get(block.task_id) || 0) + 1);
    }
  }
  const segmentSeen = new Map<string, number>();
  for (const block of blocks) {
    if (block.kind !== "task") continue;
    const task = unique.find((t) => t.id === block.task_id);
    const idx = (segmentSeen.get(block.task_id) || 0) + 1;
    segmentSeen.set(block.task_id, idx);
    block.segment_index = idx;
    block.segment_total = segmentCounts.get(block.task_id) || 1;
    block.priority_score = task ? effectivePriorityScore(task) : undefined;
    block.priority = task ? priorityLabel(task) : undefined;
    block.overdue = task ? isOverdue(task) : false;
  }

  blocks.sort((a, b) => {
    if (ww.overnight) {
      const as = clockToShift(parseHHMM(a.start), ww);
      const bs = clockToShift(parseHHMM(b.start), ww);
      const aKey = as >= 0 ? as : parseHHMM(a.start);
      const bKey = bs >= 0 ? bs : parseHHMM(b.start);
      if (aKey !== bKey) return aKey - bKey;
      return parseHHMM(a.end) - parseHHMM(b.end);
    }
    const diff = parseHHMM(a.start) - parseHHMM(b.start);
    return diff !== 0 ? diff : parseHHMM(a.end) - parseHHMM(b.end);
  });

  // Final safety validation using SHIFT-LINEAR coordinates (overnight-safe).
  const validBlocks: Block[] = [];
  const validTaskIds = new Set<string>();
  for (const block of blocks) {
    const start = parseHHMM(block.start);
    const end = parseHHMM(block.end);
    if (start === end) continue;

    const sShift = clockToShift(start, ww);
    const eShift = clockToShift(end, ww);
    if (sShift < 0 || eShift < 0 || eShift <= sShift) continue;
    if (sShift < ww.effectiveStart || eShift > ww.effectiveEnd) continue;

    const previous = validBlocks.length ? validBlocks[validBlocks.length - 1] : null;
    if (previous) {
      const p0 = clockToShift(parseHHMM(previous.start), ww);
      const p1 = clockToShift(parseHHMM(previous.end), ww);
      if (p0 >= 0 && p1 >= 0 && sShift < p1 && eShift > p0) continue;
    }
    validBlocks.push(block);
    if (block.kind === "task") validTaskIds.add(block.task_id);
  }

  return {
    blocks: validBlocks,
    scheduledTaskIds: [...validTaskIds].filter((id) => {
      const task = unique.find((t) => t.id === id);
      if (!task) return false;
      const total = validBlocks
        .filter((b) => b.kind === "task" && b.task_id === id)
        .reduce(
          (sum, b) =>
            sum +
            getBlockDurationMinutes(
              parseHHMM(b.start),
              parseHHMM(b.end),
              ww,
            ),
          0,
        );
      return total >= durationOf(task);
    }),
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
  breakStyle: string,
  scheduleDate: string
): number {
  const result = csp(
    tasks,
    startMin,
    endMin,
    breakStyle,
    scheduleDate,
  );

  /*
   * Strong penalty for every task
   * that was not scheduled.
   */
  let score =
    (tasks.length -
      result.scheduledTaskIds
        .length) *
    1000;

  const taskMap = new Map(
    tasks.map((task) => [
      task.id,
      task,
    ])
  );

  const placedTasks =
    result.blocks.filter(
      (block) =>
        block.kind === "task"
    );

  /*
   * Evaluate each actual placed task.
   */
  for (const block of placedTasks) {
    const task =
      taskMap.get(
        block.task_id
      );

    if (!task) {
      continue;
    }

    const start =
      parseHHMM(block.start);

    const end =
      parseHHMM(block.end);

    const difficulty =
      (
        task.difficulty ||
        ""
      ).toLowerCase();

    const diffWeight =
      difficulty === "hard"
        ? 3
        : difficulty === "medium"
        ? 1
        : 0.3;

    const insidePeak =
      start >= peakStart &&
      end <= peakEnd;

    /*
     * Hard tasks outside peak.
     */
    if (
      difficulty === "hard" &&
      !insidePeak
    ) {
      score += 25;
    }

    /*
     * Easy tasks inside peak.
     */
    if (
      difficulty === "easy" &&
      insidePeak
    ) {
      score += 8;
    }

    /*
     * Later placement penalty.
     */
    const windowSize =
      Math.max(
        1,
        endMin - startMin
      );

    const startFraction =
      (start - startMin) /
      windowSize;

    score +=
      diffWeight *
      startFraction *
      6;

    /*
     * Deadline penalty.
     */
    if (task.due_date) {
      const scheduledEnd =
        new Date(
          `${scheduleDate}T${block.end}:00`
        ).getTime();

      const due =
        new Date(
          task.due_date
        ).getTime();

      if (
        Number.isFinite(
          scheduledEnd
        ) &&
        Number.isFinite(due) &&
        scheduledEnd > due
      ) {
        score += 50;
      }
    }
  }

  /*
   * Context/category switching penalty.
   */
  for (
    let i = 1;
    i < placedTasks.length;
    i++
  ) {
    const previous =
      taskMap.get(
        placedTasks[
          i - 1
        ].task_id
      );

    const current =
      taskMap.get(
        placedTasks[i]
          .task_id
      );

    if (
      previous &&
      current &&
      (
        previous.category ||
        "General"
      ) !==
        (
          current.category ||
          "General"
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
    .map((key, index) => ({
      key,
      index,
    }))
    .sort(
      (a, b) =>
        a.key - b.key
    )
    .map(
      (item) =>
        item.index
    );
}

function pso(
  tasks: Task[],
  startMin: number,
  endMin: number,
  peakStart: number,
  peakEnd: number,
  breakStyle: string,
  scheduleDate: string,
  options = {
    swarm: 25,
    iters: 60,
    w: 0.7,
    c1: 1.5,
    c2: 1.5,
  }
): PSOResult {
  const n = tasks.length;

  if (n === 0) {
    return {
      order: [],
      best: 0,
    };
  }

  const rng = () =>
    Math.random();

  const swarm =
    Array.from(
      {
        length:
          options.swarm,
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
          options.swarm,
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
      (particle) => [
        ...particle,
      ]
    );

  const pbestScore =
    swarm.map(
      (particle) =>
        fitness(
          decode(
            particle
          ).map(
            (index) =>
              tasks[index]
          ),
          startMin,
          endMin,
          peakStart,
          peakEnd,
          breakStyle,
          scheduleDate
        )
    );

  let gIdx =
    pbestScore.indexOf(
      Math.min(
        ...pbestScore
      )
    );

  let gbest =
    pbest[gIdx]
      ? [...pbest[gIdx]]
      : [...swarm[0]];

  let gbestScore =
    pbestScore[gIdx] ??
    Number.POSITIVE_INFINITY;

  for (
    let iteration = 0;
    iteration <
    options.iters;
    iteration++
  ) {
    for (
      let particleIndex = 0;
      particleIndex <
      options.swarm;
      particleIndex++
    ) {
      for (
        let dimension = 0;
        dimension < n;
        dimension++
      ) {
        const r1 = rng();
        const r2 = rng();

        velocity[
          particleIndex
        ][dimension] =
          options.w *
            velocity[
              particleIndex
            ][dimension] +
          options.c1 *
            r1 *
            (
              pbest[
                particleIndex
              ][dimension] -
              swarm[
                particleIndex
              ][dimension]
            ) +
          options.c2 *
            r2 *
            (
              gbest[dimension] -
              swarm[
                particleIndex
              ][dimension]
            );

        swarm[
          particleIndex
        ][dimension] =
          Math.max(
            0,
            Math.min(
              1,
              swarm[
                particleIndex
              ][dimension] +
                velocity[
                  particleIndex
                ][dimension]
            )
          );
      }

      const currentScore =
        fitness(
          decode(
            swarm[
              particleIndex
            ]
          ).map(
            (index) =>
              tasks[index]
          ),
          startMin,
          endMin,
          peakStart,
          peakEnd,
          breakStyle,
          scheduleDate
        );

      if (
        currentScore <
        pbestScore[
          particleIndex
        ]
      ) {
        pbestScore[
          particleIndex
        ] = currentScore;

        pbest[
          particleIndex
        ] = [
          ...swarm[
            particleIndex
          ],
        ];
      }

      if (
        currentScore <
        gbestScore
      ) {
        gbestScore =
          currentScore;

        gbest = [
          ...swarm[
            particleIndex
          ],
        ];
      }
    }
  }

  return {
    order: decode(
      gbest
    ),
    best: gbestScore,
  };
}

/* =========================================================
   PERSIST SCHEDULE
   ========================================================= */

async function persistSchedule(
  supabase: any,
  userId: string,
  tasks: Task[],
  blocks: Block[],
  scheduleDate: string,
  meta?: {
    created_by?: string;
    fingerprint?: string;
    work_start?: string;
    work_end?: string;
    peak_start?: string;
    peak_end?: string;
    break_style?: string;
    algorithm?: string;
  },
) {
  /*
   * Only task blocks are persisted to
   * tasks.start_time.
   */
  const taskBlocks = blocks.filter((block) => block.kind === "task");
  const firstTaskBlock = new Map<string, Block>();
  for (const block of taskBlocks) {
    if (!firstTaskBlock.has(block.task_id)) firstTaskBlock.set(block.task_id, block);
  }

  /*
   * Clear previous active task start times
   * belonging to this schedule date.
   *
   * We identify the date from the stored
   * timestamp prefix so future schedules
   * are not accidentally cleared.
   */
  const oldScheduledTasks =
    tasks.filter((task) => {
      if (!task.start_time) {
        return false;
      }

      return (
        String(
          task.start_time
        ).slice(0, 10) ===
        scheduleDate
      );
    });

  for (
    const task of oldScheduledTasks
  ) {
    const { error } =
      await supabase
        .from("tasks")
        .update({
          start_time: null,
        })
        .eq(
          "id",
          task.id
        )
        .eq(
          "user_id",
          userId
        );

    if (error) {
      throw new Error(
        `Failed to clear old schedule for ${task.title}: ${error.message}`
      );
    }
  }

  /*
   * Save the new task start times.
   */
  for (
    const block of firstTaskBlock.values()
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
        )
        .eq(
          "user_id",
          userId
        );

    if (error) {
      throw new Error(
        `Failed to save schedule for ${block.title}: ${error.message}`
      );
    }
  }

  /*
   * The schedules table becomes the authoritative
   * generated timeline for the Schedule page.
   *
   * The project already contains this table.
   */
  const { data: existingSchedules, error: findError } =
    await supabase
      .from("schedules")
      .select("id")
      .eq(
        "user_id",
        userId
      )
      .eq(
        "schedule_date",
        scheduleDate
      );

  if (findError) {
    throw new Error(
      `Failed to read existing schedule: ${findError.message}`
    );
  }

  if (
    existingSchedules &&
    existingSchedules.length > 0
  ) {
    /*
     * Update all existing rows for the date.
     *
     * This also repairs duplicate schedule
     * rows left by older versions.
     */
    const { error: updateError } =
      await supabase
        .from("schedules")
        .update({
          timeline: {
            blocks,
            meta: {
              version: (existingSchedules?.length || 0) + 1,
              fingerprint: meta?.fingerprint || null,
              created_by: meta?.created_by || "auto_schedule",
              status: "current",
              schedule_date: scheduleDate,
              work_start: meta?.work_start || null,
              work_end: meta?.work_end || null,
              peak_start: meta?.peak_start || null,
              peak_end: meta?.peak_end || null,
              break_style: meta?.break_style || null,
              algorithm: meta?.algorithm || null,
              updated_at: new Date().toISOString(),
            },
          },
        })
        .eq(
          "user_id",
          userId
        )
        .eq(
          "schedule_date",
          scheduleDate
        );

    if (updateError) {
      throw new Error(
        `Failed to update saved schedule: ${updateError.message}`
      );
    }
  } else {
    const { error: insertError } =
      await supabase
        .from("schedules")
        .insert({
          user_id:
            userId,
          schedule_date:
            scheduleDate,
          timeline: {
            blocks,
            meta: {
              version: 1,
              fingerprint: meta?.fingerprint || null,
              created_by: meta?.created_by || "auto_schedule",
              status: "current",
              schedule_date: scheduleDate,
              work_start: meta?.work_start || null,
              work_end: meta?.work_end || null,
              peak_start: meta?.peak_start || null,
              peak_end: meta?.peak_end || null,
              break_style: meta?.break_style || null,
              algorithm: meta?.algorithm || null,
              updated_at: new Date().toISOString(),
            },
          },
        });

    if (insertError) {
      throw new Error(
        `Failed to save generated schedule: ${insertError.message}`
      );
    }
  }
}

/* =========================================================
   FINAL VALIDATION
   ========================================================= */

function validateBlocks(
  blocks: Block[],
  startMin: number,
  endMin: number,
  warnings?: string[],
): Block[] {
  const wwSort = buildWorkWindow(startMin, endMin);
  const sorted = [...blocks].sort(
    (a, b) => {
      const as = parseHHMM(a.start);
      const bs = parseHHMM(b.start);
      if (wwSort?.overnight) {
        const ash = clockToShift(as, wwSort);
        const bsh = clockToShift(bs, wwSort);
        const aKey = ash >= 0 ? ash : as;
        const bKey = bsh >= 0 ? bsh : bs;
        if (aKey !== bKey) return aKey - bKey;
        return parseHHMM(a.end) - parseHHMM(b.end);
      }
      const startDiff = as - bs;
      if (startDiff !== 0) return startDiff;
      return parseHHMM(a.end) - parseHHMM(b.end);
    }
  );

  const result: Block[] = [];
  for (const block of sorted) {
    const start =
      parseHHMM(block.start);

    const end =
      parseHHMM(block.end);

    const ww = buildWorkWindow(startMin, endMin);
    if (!ww) {
      warnings?.push(`No valid work window; dropped ${block.title}`);
      continue;
    }
    // Zero-length only
    if (start === end) {
      warnings?.push(`Dropped zero-length block: ${block.title}`);
      continue;
    }
    if (!segmentInWorkWindow(start, end, ww)) {
      warnings?.push(
        `Dropped block outside work window: ${block.title} (${block.start}–${block.end}).`,
      );
      console.warn(
        "validateBlocks: dropped outside-window block",
        block.title,
        block.start,
        block.end,
        "window",
        toHHMM(startMin),
        toHHMM(endMin),
      );
      continue;
    }

    const previous =
      result.length > 0
        ? result[
            result.length - 1
          ]
        : null;

    if (previous) {
      const prevStart = parseHHMM(previous.start);
      const prevEnd = parseHHMM(previous.end);
      if (ww.overnight) {
        const p0 = clockToShift(prevStart, ww);
        const p1 = clockToShift(prevEnd, ww);
        const c0 = clockToShift(start, ww);
        const c1 = clockToShift(end, ww);
        if (p0 >= 0 && p1 >= 0 && c0 >= 0 && c1 >= 0 && c0 < p1 && c1 > p0) {
          warnings?.push(
            `Dropped overlapping block: "${block.title}" conflicts with "${previous.title}".`,
          );
          continue;
        }
      } else if (start < prevEnd) {
        warnings?.push(
          `Dropped overlapping block: "${block.title}" conflicts with "${previous.title}".`,
        );
        console.warn(
          "validateBlocks: dropped overlapping block",
          block.title,
          previous.title,
        );
        continue;
      }
    }

    result.push(
      block
    );
  }

  return result;
}

/* =========================================================
   MAIN EDGE FUNCTION
   ========================================================= */


/* =========================================================
   ADAPTIVE: unfinished detection + local reschedule
   ========================================================= */

type Occupied = { start: number; end: number; taskId?: string };

function buildOccupiedFromTasks(
  tasks: Task[],
  scheduleDate: string,
  excludeIds: Set<string>,
  breakStyle: string,
  startMin: number,
  endMin: number,
): Occupied[] {
  const occ: Occupied[] = [];
  for (const b of getBreakBlocks(breakStyle)) {
    if (b.start >= startMin && b.start + b.dur <= endMin) {
      occ.push({ start: b.start, end: b.start + b.dur });
    }
  }
  for (const task of tasks) {
    if (excludeIds.has(task.id)) continue;
    if (!task.start_time) continue;
    if (String(task.start_time).slice(0, 10) !== scheduleDate) continue;
    const timePart = normalizeTimeString(
      String(task.start_time).includes("T")
        ? String(task.start_time).split("T")[1]
        : String(task.start_time),
    );
    if (!timePart) continue;
    const sm = parseHHMM(timePart);
    const dur = durationOf(task);
    const em = sm + dur;
    // CRITICAL: never preserve placements outside the configured work window
    // (supports overnight shifts via segmentInWorkWindow).
    const ww = buildWorkWindow(startMin, endMin);
    if (!ww || !segmentInWorkWindow(sm, em, ww)) {
      continue;
    }
    occ.push({ start: sm, end: em, taskId: task.id });
  }
  return occ.sort((a, b) => a.start - b.start);
}

function findFreeSlot(
  duration: number,
  occupied: Occupied[],
  workStart: number,
  workEnd: number,
  notBefore: number,
): { start: number; end: number } | null {
  if (duration <= 0) return null;
  const ww = buildWorkWindow(workStart, workEnd);
  if (!ww) return null;
  // occupied is in shift coordinates when built from buildOccupiedFromTasks for overnight
  // For local adaptive, occupied uses clock if same-day — normalize to shift.
  const toShiftOcc = (o: Occupied): Occupied => {
    if (!ww.overnight) return o;
    // If already looks like shift (end > DAY), keep; else map
    if (o.start >= DAY_MINUTES || o.end > DAY_MINUTES) return o;
    const s = clockToShift(o.start, ww);
    if (s < 0) return o;
    return { start: s, end: s + (o.end - o.start), taskId: o.taskId };
  };
  const blocked = occupied.map(toShiftOcc).sort((a, b) => a.start - b.start);
  let notBeforeShift = notBefore;
  if (ww.overnight) {
    const m = clockToShift(notBefore, ww);
    notBeforeShift = m >= 0 ? m : ww.effectiveStart;
  }
  let cursor = Math.max(ww.effectiveStart, notBeforeShift);
  for (let guard = 0; guard < 2000 && cursor + duration <= ww.effectiveEnd; guard++) {
    let hit: Occupied | null = null;
    for (const b of blocked) {
      if (cursor < b.end && cursor + duration > b.start) {
        hit = b;
        break;
      }
    }
    if (!hit) {
      // Return clock times for block writers that expect clock HH:MM
      return {
        start: shiftToClock(cursor),
        end: shiftToClock(cursor + duration),
      };
    }
    cursor = Math.max(cursor + 1, hit.end);
  }
  return null;
}

type AdaptiveMove = {
  task_id: string;
  title: string;
  original_start: string | null;
  original_end: string | null;
  completed_minutes: number;
  remaining_minutes: number;
  new_start: string | null;
  new_end: string | null;
  status: "rescheduled" | "needs_rescheduling" | "completed";
  reason: string;
};

/**
 * Apply remaining durations from time_entries and detect unfinished scheduled tasks
 * whose planned end is in the past.
 */
function applyRemainingDurations(
  tasks: Task[],
  completedByTask: Map<string, number>,
  scheduleDate: string,
  now: Date,
): { tasks: Task[]; unfinishedIds: string[]; movesSeed: AdaptiveMove[] } {
  const unfinishedIds: string[] = [];
  const movesSeed: AdaptiveMove[] = [];
  const adjusted = tasks.map((t) => {
    const est = durationOf(t);
    const done = Math.max(0, completedByTask.get(t.id) || 0);
    const remaining = Math.max(0, est - done);
    if (done >= est && est > 0) {
      // Fully worked — leave for completion handling elsewhere
      movesSeed.push({
        task_id: t.id,
        title: t.title,
        original_start: t.start_time || null,
        original_end: null,
        completed_minutes: done,
        remaining_minutes: 0,
        new_start: null,
        new_end: null,
        status: "completed",
        reason: "Actual work met or exceeded estimated duration.",
      });
      return { ...t, estimated_duration: 0 };
    }
    const next = { ...t, estimated_duration: remaining > 0 ? remaining : est };

    if (
      t.start_time &&
      String(t.start_time).slice(0, 10) === scheduleDate &&
      remaining > 0
    ) {
      const timePart = String(t.start_time).includes("T")
        ? String(t.start_time).split("T")[1].slice(0, 5)
        : "09:00";
      const startM = parseHHMM(timePart);
      const endM = startM + est; // original planned end using original estimate
      const endDate = new Date(`${scheduleDate}T${toHHMM(endM)}:00`);
      // If scheduled end is past and task not done → unfinished
      if (endDate.getTime() <= now.getTime()) {
        unfinishedIds.push(t.id);
        movesSeed.push({
          task_id: t.id,
          title: t.title,
          original_start: timePart,
          original_end: toHHMM(endM),
          completed_minutes: done,
          remaining_minutes: remaining,
          new_start: null,
          new_end: null,
          status: "needs_rescheduling",
          reason:
            "Task was unfinished during its scheduled period. Remaining work needs a valid slot.",
        });
      }
    }
    return next;
  }).filter((t) => (t.estimated_duration || 0) > 0 || unfinishedIds.includes(t.id));

  // Keep unfinished even if remaining was set
  return { tasks: adjusted.filter((t) => durationOf(t) > 0), unfinishedIds, movesSeed };
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

function localRescheduleUnfinished(
  tasks: Task[],
  unfinishedIds: string[],
  scheduleDate: string,
  startMin: number,
  endMin: number,
  breakStyle: string,
  movesSeed: AdaptiveMove[],
  peakStartMin: number,
  peakEndMin: number,
  timeZone = "UTC",
): { blocks: Block[]; moves: AdaptiveMove[]; allPlaced: boolean } {
  const unfinishedSet = new Set(unfinishedIds);
  const occupied = buildOccupiedFromTasks(
    tasks,
    scheduleDate,
    unfinishedSet,
    breakStyle,
    startMin,
    endMin,
  );

  // Existing blocks for non-unfinished tasks
  const blocks: Block[] = [];
  for (const o of occupied) {
    if (o.taskId) {
      const task = tasks.find((x) => x.id === o.taskId);
      blocks.push({
        task_id: o.taskId,
        title: task?.title || "Task",
        start: toHHMM(o.start),
        end: toHHMM(o.end),
        category: task?.category || "General",
        kind: "task",
      });
    } else {
      blocks.push({
        task_id: `break-${o.start}`,
        title: "Break",
        start: toHHMM(o.start),
        end: toHHMM(o.end),
        category: "Break",
        kind: "break",
      });
    }
  }

  const moves: AdaptiveMove[] = movesSeed.map((m) => ({ ...m }));
  let allPlaced = true;
  const nowLocal = localHourMinute(new Date().toISOString(), timeZone);
  const nowMin = nowLocal
    ? nowLocal.hour * 60 + nowLocal.minute
    : new Date().getUTCHours() * 60 + new Date().getUTCMinutes();

  // Sort unfinished by priority_score desc then due date
  const unfinishedTasks = sortByPriority(
    tasks.filter((t) => unfinishedSet.has(t.id))
  );

  for (const task of unfinishedTasks) {
    const dur = durationOf(task);
    const difficulty = String(task.difficulty || "medium").toLowerCase();
    let preferred = Math.max(startMin, nowMin);
    if (difficulty === "hard") {
      // Difficult tasks prefer the learned/configured peak window.
      preferred = Math.max(preferred, peakStartMin);
    } else if (difficulty === "easy" && preferred < peakEndMin) {
      // Easier tasks can be placed after the preferred peak window when possible.
      preferred = Math.max(preferred, peakEndMin);
    } else if (preferred < peakStartMin) {
      // Medium tasks may also use the preferred window when capacity allows.
      preferred = peakStartMin;
    }
    // Prefer a behavior-aligned slot, then fall back to any valid slot today.
    let slot = findFreeSlot(dur, occupied, startMin, endMin, preferred);
    if (!slot) slot = findFreeSlot(dur, occupied, startMin, endMin, Math.max(startMin, nowMin));
    if (!slot) slot = findFreeSlot(dur, occupied, startMin, endMin, startMin);

    const move = moves.find((m) => m.task_id === task.id);
    if (slot) {
      occupied.push({ start: slot.start, end: slot.end, taskId: task.id });
      occupied.sort((a, b) => a.start - b.start);
      blocks.push({
        task_id: task.id,
        title: task.title,
        start: toHHMM(slot.start),
        end: toHHMM(slot.end),
        category: task.category || "General / Other",
        kind: "task",
      });
      if (move) {
        move.new_start = toHHMM(slot.start);
        move.new_end = toHHMM(slot.end);
        move.status = "rescheduled";
        move.reason =
          "Task was unfinished during its scheduled period. Remaining work was moved to the next valid available time slot.";
      }
    } else {
      allPlaced = false;
      if (move) {
        move.status = "needs_rescheduling";
        move.reason =
          "No valid time slot is available before the deadline on this day.";
      }
    }
  }

  blocks.sort((a, b) => parseHHMM(a.start) - parseHHMM(b.start));
  return { blocks, moves, allPlaced };
}


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
                authHeader || "",
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
       REQUEST
       ===================================================== */

    let body: any = {};

    try {
      body =
        await req.json();
    } catch {
      body = {};
    }

    const scheduleDate =
      typeof body?.schedule_date ===
        "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(
        body.schedule_date
      )
        ? body.schedule_date
        : new Date()
            .toISOString()
            .slice(0, 10);

    /* =====================================================
       TASKS
       ===================================================== */

    const {
      data: allTasks,
      error: tasksError,
    } =
      await supabase
        .from("tasks")
        .select(
          "id, title, category, difficulty, estimated_duration, due_date, start_time, priority_score, status, archived"
        )
        .eq(
          "user_id",
          user.id
        )
        .or(
          "archived.eq.false,archived.is.null"
        )
        .neq(
          "status",
          "done"
        );

    if (tasksError) {
      throw tasksError;
    }

    let tasks =
      uniqueTasks(
        (allTasks || []).filter(
          (task: Task) =>
            task.archived !==
              true &&
            task.status !==
              "done"
        )
      ).map((task: Task) => ({
        ...task,
        priority_score: effectivePriorityScore(task),
      }));

    if (
      tasks.length === 0
    ) {
      return new Response(
        JSON.stringify({
          blocks: [],
          deferred: [],
          task_count: 0,
          task_ids: [],
          scheduled_count: 0,
          deferred_count: 0,
          algorithm:
            "csp + pso-random-key + behavior-aware peak scheduling",
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
        .maybeSingle();

    // Defaults only when profile values are missing — never hard-lock to 07:00–19:00.
    const rawStartFromDb = profile?.work_start ?? null;
    const rawEndFromDb = profile?.work_end ?? null;
    const parsedStart = normalizeTimeString(rawStartFromDb);
    const parsedEnd = normalizeTimeString(rawEndFromDb);

    // If BOTH missing → safe default 09:00–17:00.
    // If only one missing → default the missing side relative to the other
    // so we do not invent an inverted window.
    let workStartRaw: string;
    let workEndRaw: string;
    if (parsedStart && parsedEnd) {
      workStartRaw = parsedStart;
      workEndRaw = parsedEnd;
    } else if (parsedStart && !parsedEnd) {
      workStartRaw = parsedStart;
      // default end = start + 8h (capped at 23:59)
      const s = parseHHMM(parsedStart);
      workEndRaw = toHHMM(Math.min(s + 8 * 60, 23 * 60 + 59));
    } else if (!parsedStart && parsedEnd) {
      workEndRaw = parsedEnd;
      const e = parseHHMM(parsedEnd);
      workStartRaw = toHHMM(Math.max(e - 8 * 60, 0));
    } else {
      workStartRaw = "09:00";
      workEndRaw = "17:00";
    }

    const startMin = parseHHMM(workStartRaw);
    const endMin = parseHHMM(workEndRaw);

    const scheduleWarnings: string[] = [];

    if (!isValidWorkWindow(startMin, endMin)) {
      console.error("generate-schedule: invalid working hours", {
        user: user.id,
        db_work_start: rawStartFromDb,
        db_work_end: rawEndFromDb,
        parsed_start: workStartRaw,
        parsed_end: workEndRaw,
        startMin,
        endMin,
      });
      return new Response(
        JSON.stringify({
          error:
            `Invalid working hours (${workStartRaw} → ${workEndRaw}). Start and end cannot be the same time. For night shifts use e.g. 22:00 → 06:00. Open General Settings to fix, then save.`,
          window: {
            start: workStartRaw,
            end: workEndRaw,
            db_start: rawStartFromDb,
            db_end: rawEndFromDb,
          },
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const workWindow = buildWorkWindow(startMin, endMin)!;
    if (workWindow.overnight) {
      scheduleWarnings.push(
        `Overnight work window active: ${workStartRaw} → ${workEndRaw} (crosses midnight).`,
      );
    }

    const workStart = toHHMM(startMin);
    const workEnd = toHHMM(endMin);

    // Preferred/peak defaults to the full work window when unset or invalid.
    let peakStart =
      normalizeTimeString(profile?.peak_start) || workStart;
    let peakEnd =
      normalizeTimeString(profile?.peak_end) || workEnd;

    const breakStyle =
      profile?.break_style ||
      "pomodoro";

    let peakStartMin = parseHHMM(peakStart);
    let peakEndMin = parseHHMM(peakEnd);

    // Always clamp preferred window into hard work hours.
    {
      const clamped = clampPeakToWork(
        peakStartMin,
        peakEndMin,
        startMin,
        endMin,
      );
      if (clamped.adjusted) {
        scheduleWarnings.push(
          "Preferred working time was adjusted to fit the configured working hours.",
        );
      }
      peakStartMin = clamped.peakStartMin;
      peakEndMin = clamped.peakEndMin;
      peakStart = toHHMM(peakStartMin);
      peakEnd = toHHMM(peakEndMin);
    }

    const userTz = profile?.timezone || "UTC";
    const [{ data: behaviorEntries }, { data: completedTasksForBehavior }] = await Promise.all([
      supabase.from("time_entries").select("task_id, start_time, end_time, duration").eq("user_id", user.id),
      supabase.from("tasks").select("id, completed_at, updated_at").eq("user_id", user.id).eq("status", "done").or("archived.eq.false,archived.is.null"),
    ]);
    const behavior = buildBehavioralProfile(
      behaviorEntries || [],
      completedTasksForBehavior || [],
      userTz,
      peakStartMin,
      peakEndMin,
      tasks.length + (completedTasksForBehavior || []).length,
    );
    if (behavior.evidenceLevel === "learning") {
      // Learned peak is preference only — never expand beyond work hours.
      const learned = clampPeakToWork(
        behavior.peakStartMin,
        behavior.peakEndMin,
        startMin,
        endMin,
      );
      peakStartMin = learned.peakStartMin;
      peakEndMin = learned.peakEndMin;
      if (learned.adjusted) {
        scheduleWarnings.push(
          "Learned peak time was constrained to your working hours.",
        );
      }
    }

    console.log("generate-schedule window", {
      user: user.id,
      work_start: workStart,
      work_end: workEnd,
      peak_start: toHHMM(peakStartMin),
      peak_end: toHHMM(peakEndMin),
      schedule_date: scheduleDate,
    });

    const isAdaptive = body?.adaptive === true;
    const isPreview = body?.preview === true;
    // Persist only when explicitly applying, or adaptive without preview.
    // Preview never writes. Legacy callers (no preview/apply flags) still apply.
    const doPersist =
      !isPreview &&
      (body?.apply === true ||
        (isAdaptive && body?.apply !== false) ||
        (body?.preview === undefined && body?.apply === undefined));

    /* =====================================================
       ADAPTIVE: remaining duration + local reschedule
       ===================================================== */

    let adaptiveMoves: AdaptiveMove[] = [];

    if (isAdaptive) {
      // Actual work from time_entries (user-scoped)
      const { data: entries } = await supabase
        .from("time_entries")
        .select("task_id, duration, start_time, end_time")
        .eq("user_id", user.id);

      const completedByTask = new Map<string, number>();
      for (const e of entries || []) {
        if (!e.task_id) continue;
        let mins = Number(e.duration) || 0;
        if (mins <= 0 && e.start_time && e.end_time) {
          mins = Math.max(
            0,
            Math.round(
              (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) /
                60000,
            ),
          );
        }
        completedByTask.set(
          e.task_id,
          (completedByTask.get(e.task_id) || 0) + mins,
        );
      }

      const applied = applyRemainingDurations(
        tasks,
        completedByTask,
        scheduleDate,
        new Date(),
      );
      // Replace tasks with remaining-duration versions
      tasks = applied.tasks;
      adaptiveMoves = applied.movesSeed;

      // When working hours change, previously valid start times may now
      // fall outside the window. Treat those as needing reschedule so we
      // never feed invalid blocks into final validation.
      const outsideWorkIds: string[] = [];
      for (const t of tasks) {
        if (!t.start_time) continue;
        if (String(t.start_time).slice(0, 10) !== scheduleDate) continue;
        const timePart = normalizeTimeString(
          String(t.start_time).includes("T")
            ? String(t.start_time).split("T")[1]
            : String(t.start_time),
        );
        if (!timePart) continue;
        const sm = parseHHMM(timePart);
        const em = sm + durationOf(t);
        const wwCheck = buildWorkWindow(startMin, endMin);
        if (!wwCheck || !segmentInWorkWindow(sm, em, wwCheck)) {
          outsideWorkIds.push(t.id);
          adaptiveMoves.push({
            task_id: t.id,
            title: t.title,
            original_start: timePart,
            original_end: toHHMM(em),
            completed_minutes: 0,
            remaining_minutes: durationOf(t),
            new_start: null,
            new_end: null,
            status: "needs_rescheduling",
            reason:
              "Existing start time is outside your current working hours and will be rescheduled.",
          });
        }
      }
      if (outsideWorkIds.length > 0) {
        scheduleWarnings.push(
          `${outsideWorkIds.length} task(s) were outside the current working hours and will be rescheduled.`,
        );
        // Clear invalid start_time in memory so full rebuild does not try to keep them
        tasks = tasks.map((t) =>
          outsideWorkIds.includes(t.id) ? { ...t, start_time: null } : t,
        );
        // Merge into unfinished so local adaptive path does not preserve them
        for (const id of outsideWorkIds) {
          if (!applied.unfinishedIds.includes(id)) applied.unfinishedIds.push(id);
        }
      }

      if (applied.unfinishedIds.length > 0 || outsideWorkIds.length > 0) {
        /*
         * If an unfinished task outranks a task that currently occupies the
         * schedule, do not simply place it after that task. Rebuild the full
         * schedule so the priority rule can move the lower-priority task.
         *
         * Also rebuild when there are tasks with no slot on the requested day.
         * This is important for overdue/unscheduled work: if free capacity is
         * available, the full priority-aware pipeline gets a chance to place
         * the task instead of leaving it outside the adaptive result.
         */
        const unfinishedTasksForPriority = tasks.filter((t) => applied.unfinishedIds.includes(t.id));
        const existingScheduled = tasks.filter(
          (t) =>
            !applied.unfinishedIds.includes(t.id) &&
            t.start_time &&
            String(t.start_time).slice(0, 10) === scheduleDate
        );
        const unscheduledForDay = tasks.filter(
          (t) =>
            !applied.unfinishedIds.includes(t.id) &&
            (!t.start_time || String(t.start_time).slice(0, 10) !== scheduleDate)
        );
        const priorityConflict = unfinishedTasksForPriority.some((unfinished) =>
          existingScheduled.some((existing) => comparePriority(unfinished, existing) < 0)
        );
        const unscheduledPriorityConflict = unscheduledForDay.some((candidate) =>
          existingScheduled.some((existing) => comparePriority(candidate, existing) < 0)
        );

        if (!priorityConflict && !unscheduledPriorityConflict && unscheduledForDay.length === 0) {
          const local = localRescheduleUnfinished(
          tasks,
          applied.unfinishedIds,
          scheduleDate,
          startMin,
          endMin,
          breakStyle,
          adaptiveMoves,
          peakStartMin,
          peakEndMin,
          userTz,
        );
        adaptiveMoves = local.moves;

        if (local.allPlaced) {
          const validatedBlocks = validateBlocks(
            local.blocks,
            startMin,
            endMin,
            scheduleWarnings,
          );
          if (doPersist) await persistSchedule(
            supabase,
            user.id,
            tasks,
            validatedBlocks,
            scheduleDate,
            {
              created_by: "adaptive_scheduling",
              work_start: workStart,
              work_end: workEnd,
              peak_start: peakStart,
              peak_end: peakEnd,
              break_style: breakStyle,
              algorithm: "adaptive",
            },
          );

          // Task history notes (best-effort)
          for (const m of adaptiveMoves) {
            if (m.status !== "rescheduled") continue;
            try {
              await supabase.from("task_history").insert({
                task_id: m.task_id,
                user_id: user.id,
                note: m.reason,
                changes: {
                  type: "adaptive_reschedule",
                  completed_minutes: m.completed_minutes,
                  remaining_minutes: m.remaining_minutes,
                  new_start: m.new_start,
                  new_end: m.new_end,
                },
              });
            } catch {
              /* optional table */
            }
          }

          return new Response(
            JSON.stringify({
              blocks: validatedBlocks,
              task_count: tasks.length,
              task_ids: tasks.map((t) => t.id),
              deferred: adaptiveMoves
                .filter((m) => m.status === "needs_rescheduling")
                .map((m) => ({
                  task_id: m.task_id,
                  title: m.title,
                  duration: m.remaining_minutes,
                  status: "needs_rescheduling",
                })),
              adaptive_moves: adaptiveMoves,
              adaptive: true,
              pso: null,
              window: {
                start: workStart,
                end: workEnd,
                peak_start: peakStart,
                peak_end: peakEnd,
                break_style: breakStyle,
                schedule_date: scheduleDate,
              },
              scheduled_count: validatedBlocks.filter((b) => b.kind === "task")
                .length,
              deferred_count: adaptiveMoves.filter(
                (m) => m.status === "needs_rescheduling",
              ).length,
              algorithm: "adaptive-local + csp-validate",
              timestamp: new Date().toISOString(),
              note:
                "Adaptive Scheduling used remaining work from time entries and preserved unaffected tasks when no priority conflict required a full rebuild.",
            }),
            {
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            },
          );
        }
                }
// else fall through to full PSO+CSP with remaining durations
      }
    }

    /* =====================================================
       PRIORITY ORDER + PSO
       ===================================================== */

    /*
     * Strict priority tiers are applied before PSO. A HIGH task therefore
     * cannot be pushed behind a MEDIUM/LOW task simply because another
     * scheduling factor scored better. Within the same tier, a current
     * task comes before an overdue task. Thus HIGH-current is first, then
     * HIGH-overdue, then MEDIUM-current, and so on.
     */
    const priorityGroups: Task[][] = [];
    const groupKeys = [
      "high-current", "high-overdue",
      "medium-current", "medium-overdue",
      "low-current", "low-overdue",
    ];

    for (const key of groupKeys) {
      const [tierName, overdueName] = key.split("-");
      const tier = tierName === "high" ? 3 : tierName === "medium" ? 2 : 1;
      const overdue = overdueName === "overdue";
      const group = tasks.filter(
        (task) => priorityTier(task) === tier && isOverdue(task) === overdue
      );
      if (group.length) priorityGroups.push(group);
    }

    const orderedInput = priorityGroups.flatMap((group) => {
      const seed = sortByPriority(group);
      const { order } = pso(
        seed,
        startMin,
        endMin,
        peakStartMin,
        peakEndMin,
        breakStyle,
        scheduleDate
      );
      return order.map((index) => seed[index]);
    });

    // Keep the priority-group order intact after PSO.
    const ordered = orderedInput;
    const best = fitness(
      ordered,
      startMin,
      endMin,
      peakStartMin,
      peakEndMin,
      breakStyle,
      scheduleDate
    );

    /* =====================================================
       CSP
       ===================================================== */

    const cspResult =
      csp(
        ordered,
        startMin,
        endMin,
        breakStyle,
        scheduleDate,
      );

    const validatedBlocks =
      validateBlocks(
        cspResult.blocks,
        startMin,
        endMin,
        scheduleWarnings,
      );

    const scheduledMinutes = new Map<string, number>();
    for (const block of validatedBlocks) {
      if (block.kind !== "task") continue;
      const minutes = getBlockDurationMinutes(
        parseHHMM(block.start),
        parseHHMM(block.end),
        workWindow,
      );
      scheduledMinutes.set(block.task_id, (scheduledMinutes.get(block.task_id) || 0) + minutes);
    }

    const scheduledIds = new Set(
      ordered
        .filter((task) => (scheduledMinutes.get(task.id) || 0) >= durationOf(task))
        .map((task) => task.id)
    );

    const partial = ordered.filter((task) => {
      const done = scheduledMinutes.get(task.id) || 0;
      return done > 0 && done < durationOf(task);
    });

    const deferred = ordered.filter((task) => !scheduledIds.has(task.id));

    /* =====================================================
       SAVE
       ===================================================== */

    if (doPersist) await persistSchedule(
      supabase,
      user.id,
      tasks,
      validatedBlocks,
      scheduleDate,
      {
        created_by: isAdaptive ? "adaptive_scheduling" : "auto_schedule",
        work_start: workStart,
        work_end: workEnd,
        peak_start: peakStart,
        peak_end: peakEnd,
        break_style: breakStyle,
        algorithm: "priority-aware csp + pso",
      },
    );

    /* =====================================================
       RESPONSE
       ===================================================== */

    return new Response(
      JSON.stringify({
        blocks:
          validatedBlocks,

        deferred:
          deferred.map(
            (task) => ({
              task_id:
                task.id,
              title:
                task.title,
              duration:
                Math.max(0, durationOf(task) - (scheduledMinutes.get(task.id) || 0)),
              priority:
                task.priority_score ??
                null,
              priority_label:
                priorityLabel(task),
              due_date:
                task.due_date || null,
              overdue:
                isOverdue(task),
              scheduled_minutes:
                scheduledMinutes.get(task.id) || 0,
              status:
                partial.some((t) => t.id === task.id)
                  ? "partially_scheduled"
                  : "deferred",
            })
          ),

        task_summary: ordered.map((task) => {
          const scheduled = scheduledMinutes.get(task.id) || 0;
          return {
            task_id: task.id,
            title: task.title,
            duration: durationOf(task),
            scheduled_minutes: scheduled,
            remaining_minutes: Math.max(0, durationOf(task) - scheduled),
            priority: task.priority_score ?? null,
            priority_label: priorityLabel(task),
            due_date: task.due_date || null,
            overdue: isOverdue(task),
            status: scheduled >= durationOf(task)
              ? "scheduled"
              : scheduled > 0
                ? "partially_scheduled"
                : "deferred",
          };
        }),

        pso: {
          fitness:
            best,
          iterations: 60,
          swarm_size: 25,
          inertia_weight:
            0.7,
          cognitive:
            1.5,
          social:
            1.5,
        },

        window: {
          start: workStart,
          end: workEnd,
          overnight: workWindow.overnight,
          duration_minutes: workWindow.effectiveEnd - workWindow.effectiveStart,
          peak_start: peakStart,
          peak_end: peakEnd,
          break_style: breakStyle,
          schedule_date: scheduleDate,
        },

        note: workWindow.overnight
          ? `Schedule generated for overnight window ${workStart}–${workEnd} (${workWindow.effectiveEnd - workWindow.effectiveStart} available minutes).`
          : `Schedule generated for ${workStart}–${workEnd} (${workWindow.effectiveEnd - workWindow.effectiveStart} available minutes).`,

        scheduled_count:
          scheduledIds.size,

        partial_count:
          partial.length,

        deferred_count:
          deferred.length,

        warnings: scheduleWarnings,
        preview: isPreview,
        applied: doPersist,

        algorithm:
          "priority-aware csp + pso-random-key + behavior-aware peak scheduling",
        behavior_profile: {
          evidence_level: behavior.evidenceLevel,
          actual_minutes: behavior.actualMinutes,
          average_actual_minutes: behavior.avgActualMinutes,
          completed_sessions: behavior.completedSessions,
          learned_peak_start: toHHMM(behavior.peakStartMin),
          learned_peak_end: toHHMM(behavior.peakEndMin),
        },

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
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);
    console.error("generate-schedule error:", message);

    const isValidation =
      /working hours|work end|work start|invalid/i.test(message);

    return new Response(
      JSON.stringify({
        error: message,
      }),
      {
        status: isValidation ? 400 : 500,
        headers: {
          ...corsHeaders,
          "Content-Type":
            "application/json",
        },
      }
    );
  }
});
