/**
 * Display helpers for schedule clock times (HH:MM from the scheduler).
 * Does not convert timezones or alter stored values.
 */

/** Format "13:05" → "1:05pm" (lowercase, no space before am/pm). */
export function formatTime12h(hhmm: string | null | undefined): string {
  if (!hhmm || !String(hhmm).includes(":")) {
    return hhmm ? String(hhmm) : "";
  }

  const parts = String(hhmm).trim().split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1]);

  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    return String(hhmm);
  }

  // Guard invalid clock values from bad data
  const hours24 = ((Math.floor(h) % 24) + 24) % 24;
  const minutes = Math.min(59, Math.max(0, Math.floor(m)));

  const period = hours24 >= 12 ? "pm" : "am";
  const hour12 = hours24 % 12 === 0 ? 12 : hours24 % 12;

  return `${hour12}:${String(minutes).padStart(2, "0")}${period}`;
}

/** Format a range as a single non-wrapping unit: "1:00am - 2:00am". */
export function formatTimeRange12h(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const s = formatTime12h(start);
  const e = formatTime12h(end);
  if (!s && !e) return "";
  if (!s) return e;
  if (!e) return s;
  return `${s} - ${e}`;
}
