import { formatInTimeZone } from "date-fns-tz";

/** Fallback only when profile timezone is not yet loaded. Prefer profile.timezone. */
export const DEFAULT_TZ = "UTC";
const TZ_KEY = "gsi-timezone";
export const TZ_EVENT = "gsi-timezone-changed";

export const TIMEZONES = [
  { value: "Asia/Manila", label: "Manila (PHT)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Asia/Dubai", label: "Dubai (GST)" },
  { value: "Asia/Kolkata", label: "India (IST)" },
  { value: "Australia/Sydney", label: "Sydney (AEST)" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Berlin", label: "Berlin (CET)" },
  { value: "America/New_York", label: "New York (ET)" },
  { value: "America/Chicago", label: "Chicago (CT)" },
  { value: "America/Denver", label: "Denver (MT)" },
  { value: "America/Los_Angeles", label: "Los Angeles (PT)" },
  { value: "UTC", label: "UTC" },
];

export function getTimezone(): string {
  try {
    return localStorage.getItem(TZ_KEY) || DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ;
  }
}

export function setTimezone(tz: string) {
  try {
    localStorage.setItem(TZ_KEY, tz);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(TZ_EVENT));
}

/** Offset string like "+08:00" for the active timezone at the given moment. */
export function tzOffset(date: Date = new Date(), tz: string = getTimezone()): string {
  return formatInTimeZone(date, tz, "xxx");
}

/** Format a date in the user's timezone (from profile, cached in localStorage). */
export function formatPH(date: Date | string, fmt: string, tz: string = getTimezone()): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (!d || isNaN(d.getTime())) return "—";
  return formatInTimeZone(d, tz, fmt);
}

export const formatTZ = formatPH;

/** Readable date + 12-hour time, e.g. "Mar 6, 2026 · 2:30 PM". */
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return formatPH(date, "MMM d, yyyy · h:mm a");
}

/** Readable date only, e.g. "Mar 6, 2026". */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return formatPH(date, "MMM d, yyyy");
}

/** Readable time only, e.g. "2:30 PM". */
export function formatTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return formatPH(date, "h:mm a");
}

/** "yyyy-MM-dd" for today in the active timezone — safe for date inputs. */
export function todayInputDate(): string {
  return formatPH(new Date(), "yyyy-MM-dd");
}

/** Convert a "yyyy-MM-ddTHH:mm" local-input value into an ISO string in the active timezone. */
export function inputToISO(value: string): string | null {
  if (!value) return null;
  const base = value.length === 16 ? `${value}:00` : value;
  const offset = tzOffset(new Date(base.replace("T", " ").slice(0, 10) + "T00:00:00Z"));
  const d = new Date(`${base}${offset}`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Convert an ISO string into a "yyyy-MM-ddTHH:mm" value for datetime-local inputs. */
export function isoToInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return formatPH(iso, "yyyy-MM-dd'T'HH:mm");
}

/** Human countdown, e.g. "2d 4h left" or "Overdue by 3h". */
export function countdown(target: string | Date | null | undefined, now: Date = new Date()): string {
  if (!target) return "—";
  const t = typeof target === "string" ? new Date(target) : target;
  if (isNaN(t.getTime())) return "—";
  let diff = Math.floor((t.getTime() - now.getTime()) / 1000);
  const overdue = diff < 0;
  diff = Math.abs(diff);
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  const parts = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
  return overdue ? `Overdue by ${parts}` : `${parts} left`;
}


/** Cache profile timezone for display helpers. Profile remains the source of truth. */
export function syncTimezoneFromProfile(tz: string | null | undefined) {
  if (!tz || typeof tz !== "string") return;
  try {
    const prev = localStorage.getItem(TZ_KEY);
    if (prev !== tz) {
      localStorage.setItem(TZ_KEY, tz);
      window.dispatchEvent(new CustomEvent(TZ_EVENT));
    }
  } catch {
    /* ignore */
  }
}
