import { formatDateTime } from "@/lib/date-utils";
import { statusLabel } from "@/lib/status";

type AnyTask = Record<string, any>;

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined || value === "" ? "—" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Export tasks as a human-readable CSV — dates are formatted, never raw JSON. */
export function exportTasksCSV(tasks: AnyTask[], projectNameById: Record<string, string> = {}, filename?: string) {
  const headers = [
    "Task", "Project", "Status", "Priority", "Category", "Difficulty",
    "Start Time", "Target Date", "Duration (min)", "Description",
  ];
  const rows = tasks.map((t) => [
    t.title,
    t.project_id ? projectNameById[t.project_id] || "Project" : "Stand-alone",
    statusLabel(t.status),
    t.priority_score != null ? Math.round(t.priority_score) : "—",
    t.category,
    t.difficulty,
    t.start_time ? formatDateTime(t.start_time) : "—",
    t.due_date ? formatDateTime(t.due_date) : "—",
    t.estimated_duration,
    t.description,
  ]);
  const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n");
  download(filename || `gsi-tasks-${formatDateTime(new Date()).replace(/[^\w]+/g, "-")}.csv`, csv);
}

/** Export projects with their progress as readable CSV. */
export function exportProjectsCSV(
  projects: AnyTask[],
  tasks: AnyTask[],
  filename?: string,
) {
  const headers = ["Project", "Status", "Description", "Total Tasks", "Completed", "In Progress", "To Do", "Created"];
  const rows = projects.map((p) => {
    const pt = tasks.filter((t) => t.project_id === p.id);
    return [
      p.name,
      p.status,
      p.description,
      pt.length,
      pt.filter((t) => t.status === "done").length,
      pt.filter((t) => t.status === "in_progress").length,
      pt.filter((t) => t.status === "todo").length,
      p.created_at ? formatDateTime(p.created_at) : "—",
    ];
  });
  const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n");
  download(filename || "gsi-projects.csv", csv);
}
