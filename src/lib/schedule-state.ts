/**
 * Official schedule state helpers.
 * Cache is display-only; database schedules row is authoritative.
 */

export type ScheduleStatus =
  | "NO_SCHEDULE"
  | "CURRENT"
  | "GENERATING"
  | "PREVIEW"
  | "APPLYING"
  | "OUTDATED"
  | "ADAPTING";

export type ScheduleMeta = {
  version: number;
  fingerprint: string;
  created_by: "auto_schedule" | "adaptive_scheduling" | "manual_adjustment";
  status: "current" | "previous";
  schedule_date: string;
  work_start?: string;
  work_end?: string;
  peak_start?: string;
  peak_end?: string;
  break_style?: string;
  timezone?: string;
  algorithm?: string;
  created_at?: string;
};

export type ScheduleBlockLike = {
  task_id?: string;
  title?: string;
  start?: string;
  end?: string;
  kind?: string;
  [key: string]: unknown;
};

/** Normalize timeline that may be a blocks array or { blocks, meta }. */
export function extractTimeline(timeline: unknown): {
  blocks: ScheduleBlockLike[];
  meta: Partial<ScheduleMeta> | null;
} {
  if (!timeline) return { blocks: [], meta: null };
  if (Array.isArray(timeline)) {
    return { blocks: timeline as ScheduleBlockLike[], meta: null };
  }
  if (typeof timeline === "object" && timeline !== null) {
    const obj = timeline as { blocks?: unknown; meta?: Partial<ScheduleMeta> };
    const blocks = Array.isArray(obj.blocks) ? (obj.blocks as ScheduleBlockLike[]) : [];
    return { blocks, meta: obj.meta || null };
  }
  return { blocks: [], meta: null };
}

/** Build a stable fingerprint string from scheduling inputs (not a crypto secret). */
export function buildScheduleFingerprint(input: {
  tasks: Array<{
    id: string;
    estimated_duration?: number | null;
    priority_score?: number | null;
    due_date?: string | null;
    status?: string | null;
  }>;
  work_start: string;
  work_end: string;
  peak_start?: string;
  peak_end?: string;
  timezone?: string;
  break_style?: string;
  algorithm_version?: string;
}): string {
  const tasks = [...input.tasks]
    .filter((t) => t.status !== "done")
    .map((t) => ({
      id: t.id,
      d: Number(t.estimated_duration) || 30,
      p: Number(t.priority_score) || 0,
      due: t.due_date ? String(t.due_date).slice(0, 16) : "",
      st: t.status || "todo",
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const payload = JSON.stringify({
    tasks,
    w: [input.work_start, input.work_end],
    peak: [input.peak_start || "", input.peak_end || ""],
    tz: input.timezone || "UTC",
    br: input.break_style || "pomodoro",
    av: input.algorithm_version || "csp-pso-v1",
  });

  // FNV-1a 32-bit hash → hex (deterministic, no crypto dependency)
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function scheduleStatusLabel(status: ScheduleStatus): string {
  switch (status) {
    case "NO_SCHEDULE":
      return "No schedule has been created yet.";
    case "CURRENT":
      return "Your schedule is up to date.";
    case "OUTDATED":
      return "Your schedule needs updating because task or schedule settings changed.";
    case "GENERATING":
      return "Generating schedule…";
    case "PREVIEW":
      return "Previewing a new schedule. Apply to replace the current one.";
    case "APPLYING":
      return "Applying schedule…";
    case "ADAPTING":
      return "Adapting schedule to recent changes…";
    default:
      return "";
  }
}
