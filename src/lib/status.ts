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
  todo: "bg-primary/10 text-primary border-primary/20",
  in_progress: "bg-ai/10 text-ai border-ai/25",
  done: "bg-success/10 text-success border-success/25",
};

export const PRIORITY_STYLES: Record<string, { label: string; className: string; dot: string }> = {
  high: {
    label: "High",
    className: "bg-[#FEF2F2] text-[#EF4444] border-[#FECACA] font-semibold",
    dot: "bg-[#EF4444]",
  },
  medium: {
    label: "Medium",
    className: "bg-[#FFFBEB] text-[#F59E0B] border-[#FDE68A] font-semibold",
    dot: "bg-[#F59E0B]",
  },
  low: {
    label: "Low",
    className: "bg-[#ECFDF5] text-[#10B981] border-[#A7F3D0] font-medium",
    dot: "bg-[#10B981]",
  },
};

export function priorityFromScore(score: number | null | undefined): "high" | "medium" | "low" {
  const s = score ?? 0;
  if (s >= 65) return "high";
  if (s >= 40) return "medium";
  return "low";
}
