export const STATUS_OPTIONS = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
] as const;

export type TaskStatus = (typeof STATUS_OPTIONS)[number]["value"];

export function statusLabel(status: string | null | undefined): string {
  return STATUS_OPTIONS.find((s) => s.value === status)?.label ?? "To Do";
}

export const statusBadgeClass: Record<string, string> = {
  todo: "bg-muted text-foreground border-border",
  in_progress: "bg-warning/15 text-warning border-warning/30",
  done: "bg-success/15 text-success border-success/30",
};

/** Distinct visual treatment for each priority level. */
export const PRIORITY_STYLES: Record<string, { label: string; className: string; dot: string }> = {
  high: {
    label: "High",
    className: "bg-destructive text-destructive-foreground border-transparent font-bold tracking-wide",
    dot: "bg-destructive",
  },
  medium: {
    label: "Medium",
    className: "bg-warning/15 text-warning border-warning/40 font-semibold",
    dot: "bg-warning",
  },
  low: {
    label: "Low",
    className: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
};

export function priorityFromScore(score: number | null | undefined): "high" | "medium" | "low" {
  const s = score ?? 0;
  if (s >= 65) return "high";
  if (s >= 40) return "medium";
  return "low";
}
