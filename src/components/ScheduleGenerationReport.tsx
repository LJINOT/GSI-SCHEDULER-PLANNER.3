import { useMemo, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Printer, FileDown } from "lucide-react";
import { formatTimeRange12h, formatTime12h } from "@/lib/format-time";
import { formatPH } from "@/lib/date-utils";
import { toast } from "sonner";

export type ReportBlock = {
  task_id: string;
  title: string;
  start: string;
  end: string;
  category?: string;
  kind?: "task" | "break" | string;
  priority?: string | null;
  segment_index?: number;
  segment_total?: number;
};

export type ReportTaskSummary = {
  task_id: string;
  title: string;
  duration: number;
  scheduled_minutes: number;
  remaining_minutes: number;
  priority?: number | null;
  priority_label?: string | null;
  due_date?: string | null;
  overdue?: boolean;
  status: "scheduled" | "partially_scheduled" | "deferred" | string;
  reason?: string | null;
};

export type ReportPayload = {
  blocks?: ReportBlock[];
  deferred?: Array<{
    task_id: string;
    title: string;
    duration?: number;
    scheduled_minutes?: number;
    priority?: number | null;
    priority_label?: string | null;
    due_date?: string | null;
    status?: string;
    reason?: string | null;
  }>;
  task_summary?: ReportTaskSummary[];
  window?: {
    start?: string;
    end?: string;
    peak_start?: string;
    peak_end?: string;
    break_style?: string;
    schedule_date?: string;
    overnight?: boolean;
    duration_minutes?: number | null;
  };
  algorithm?: string;
  timestamp?: string;
  note?: string;
  scheduled_count?: number;
  deferred_count?: number;
  partial_count?: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: ReportPayload | null;
  /** Local schedule date label (YYYY-MM-DD) when window.schedule_date missing */
  scheduleDateFallback?: string;
};

function minutesBetween(start: string, end: string): number {
  const parse = (s: string) => {
    const [h, m] = String(s).split(":").map(Number);
    if (!Number.isFinite(h)) return 0;
    return h * 60 + (Number.isFinite(m) ? m : 0);
  };
  const a = parse(start);
  let b = parse(end);
  if (b <= a) b += 24 * 60; // overnight block
  return Math.max(0, b - a);
}

function na(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "" || v === "—") return "Not available";
  return String(v);
}

export function ScheduleGenerationReport({
  open,
  onOpenChange,
  payload,
  scheduleDateFallback,
}: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  const report = useMemo(() => {
    if (!payload?.blocks?.length) return null;

    const blocks = payload.blocks;
    const taskBlocks = blocks.filter((b) => b.kind !== "break");
    const breakBlocks = blocks.filter((b) => b.kind === "break");

    const uniqueTaskIds = new Set(taskBlocks.map((b) => b.task_id));
    const taskMinutes = new Map<string, number>();
    for (const b of taskBlocks) {
      const d = minutesBetween(b.start, b.end);
      taskMinutes.set(b.task_id, (taskMinutes.get(b.task_id) || 0) + d);
    }

    const totalTaskDuration = [...taskMinutes.values()].reduce((a, b) => a + b, 0);
    const totalBreakDuration = breakBlocks.reduce(
      (a, b) => a + minutesBetween(b.start, b.end),
      0,
    );
    const totalOccupied = totalTaskDuration + totalBreakDuration;

    const summary = payload.task_summary || [];
    const fullyScheduled = summary.length
      ? summary.filter((t) => t.status === "scheduled").length
      : uniqueTaskIds.size;
    const partial = summary.length
      ? summary.filter((t) => t.status === "partially_scheduled")
      : [];
    const deferredFromSummary = summary.filter((t) => t.status === "deferred");
    const deferredList =
      deferredFromSummary.length > 0
        ? deferredFromSummary
        : (payload.deferred || []).map((d) => ({
            task_id: d.task_id,
            title: d.title,
            duration: d.duration ?? 0,
            scheduled_minutes: d.scheduled_minutes ?? 0,
            remaining_minutes: Math.max(
              0,
              (d.duration ?? 0) - (d.scheduled_minutes ?? 0),
            ),
            priority: d.priority ?? null,
            priority_label: d.priority_label ?? null,
            due_date: d.due_date ?? null,
            status: (d.status as ReportTaskSummary["status"]) || "deferred",
            reason: d.reason ?? null,
          }));

    const submitted =
      summary.length > 0
        ? summary.length
        : uniqueTaskIds.size + deferredList.filter((d) => !uniqueTaskIds.has(d.task_id)).length;

    const win = payload.window;
    const available =
      typeof win?.duration_minutes === "number" && Number.isFinite(win.duration_minutes)
        ? win.duration_minutes
        : null;

    const scheduleDate =
      win?.schedule_date || scheduleDateFallback || "Not available";

    let interpretation = "A schedule was produced for the available work window.";
    if (deferredList.length === 0 && partial.length === 0) {
      interpretation = "All eligible tasks in this run were fully scheduled.";
    } else if (partial.length > 0 || deferredList.length > 0) {
      interpretation =
        "Some tasks were partially scheduled or deferred because of work-window, duration, break, or conflict constraints.";
    }

    const analysis = [
      "AHP assigns each task a priority score from the system's criteria (urgency, duration impact, and related factors implemented in the planner).",
      "PSO searches for a favorable ordering of tasks using the fitness rules implemented in the scheduler.",
      "CSP places tasks into valid time slots while respecting the work window, planned durations, breaks, and non-overlap constraints.",
      interpretation,
    ];

    const chron = [...blocks].sort((a, b) => {
      const pa = minutesBetween("00:00", a.start);
      const pb = minutesBetween("00:00", b.start);
      // overnight: evening after morning for display within one shift is already stored as clock times
      return pa - pb || minutesBetween("00:00", a.end) - minutesBetween("00:00", b.end);
    });

    return {
      scheduleDate,
      generatedAt: payload.timestamp || null,
      algorithm: payload.algorithm || "Not available",
      windowStart: win?.start,
      windowEnd: win?.end,
      overnight: !!win?.overnight,
      breakStyle: win?.break_style,
      peakStart: win?.peak_start,
      peakEnd: win?.peak_end,
      note: payload.note,
      submitted,
      fullyScheduled: summary.length
        ? fullyScheduled
        : uniqueTaskIds.size - partial.length,
      partialCount: summary.length
        ? partial.length
        : Number(payload.partial_count) || 0,
      deferredCount: deferredList.length || Number(payload.deferred_count) || 0,
      totalTaskDuration,
      totalBreakDuration,
      totalOccupied,
      available,
      chron,
      deferredList,
      partial,
      analysis,
      taskMinutes,
    };
  }, [payload, scheduleDateFallback]);

  const handlePrint = () => {
    if (!report) {
      toast.message("Generate a schedule first to print a report.");
      return;
    }
    const node = printRef.current;
    if (!node) return;

    const win = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
    if (!win) {
      toast.error("Pop-up blocked. Allow pop-ups to print the report.");
      return;
    }
    win.document.write(`<!DOCTYPE html><html><head><title>Schedule Generation Report</title>
<style>
  body { font-family: system-ui, sans-serif; font-size: 12px; color: #111; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  h2 { font-size: 14px; margin: 20px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; }
  .meta { color: #444; margin-bottom: 12px; }
  .stat { display: inline-block; margin-right: 16px; margin-bottom: 6px; }
  @media print {
    body { margin: 12mm; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
</style></head><body>${node.innerHTML}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
    }, 300);
  };

  const handleExportPdf = () => {
    // Browser print-to-PDF is the reliable path without new dependencies.
    toast.message("Use Print → Save as PDF in the print dialog.");
    handlePrint();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Schedule Generation Report</DialogTitle>
          <DialogDescription>
            Summary of the official schedule currently loaded — not a new generation run.
          </DialogDescription>
        </DialogHeader>

        {!report ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No official schedule is available to report. Generate a schedule with Auto
            Schedule first, then open this report.
          </p>
        ) : (
          <div ref={printRef} className="space-y-5 text-sm">
            {/* Header */}
            <div className="space-y-1">
              <h1 className="text-lg font-semibold tracking-tight">
                Schedule Generation Report
              </h1>
              <div className="text-muted-foreground text-xs space-y-0.5">
                <p>
                  <span className="font-medium text-foreground">Schedule date:</span>{" "}
                  {report.scheduleDate}
                </p>
                <p>
                  <span className="font-medium text-foreground">Report generated:</span>{" "}
                  {report.generatedAt
                    ? formatPH(report.generatedAt, "MMM d, yyyy h:mm a")
                    : "Not available"}
                </p>
                <p>
                  <span className="font-medium text-foreground">Algorithm:</span>{" "}
                  {na(report.algorithm)}
                </p>
                <p>
                  <span className="font-medium text-foreground">Work window:</span>{" "}
                  {report.windowStart && report.windowEnd
                    ? `${formatTime12h(report.windowStart)} – ${formatTime12h(report.windowEnd)}${
                        report.overnight ? " (overnight)" : ""
                      }`
                    : "Not available"}
                </p>
                <p>
                  <span className="font-medium text-foreground">Break style:</span>{" "}
                  {na(report.breakStyle)}
                </p>
                {(report.peakStart || report.peakEnd) && (
                  <p>
                    <span className="font-medium text-foreground">Peak window:</span>{" "}
                    {report.peakStart && report.peakEnd
                      ? formatTimeRange12h(report.peakStart, report.peakEnd)
                      : "Not available"}
                  </p>
                )}
                {report.note && (
                  <p className="pt-1 text-foreground/80">{report.note}</p>
                )}
              </div>
            </div>

            {/* Summary */}
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Schedule summary
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  ["Tasks submitted", report.submitted],
                  ["Fully scheduled", report.fullyScheduled],
                  ["Partially scheduled", report.partialCount],
                  ["Deferred / unscheduled", report.deferredCount],
                  ["Total task duration", `${report.totalTaskDuration} min`],
                  ["Total break duration", `${report.totalBreakDuration} min`],
                  ["Total occupied", `${report.totalOccupied} min`],
                  [
                    "Work-window capacity",
                    report.available != null
                      ? `${report.available} min`
                      : "Not available",
                  ],
                ].map(([label, value]) => (
                  <div
                    key={String(label)}
                    className="rounded-md border px-3 py-2 bg-muted/30"
                  >
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {label}
                    </p>
                    <p className="font-semibold tabular-nums">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Blocks */}
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Generated schedule details
              </h2>
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="text-xs">Date</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">Time</TableHead>
                      <TableHead className="text-xs">Title</TableHead>
                      <TableHead className="text-xs">Priority</TableHead>
                      <TableHead className="text-xs">Duration</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.chron.map((b, i) => {
                      const isBreak = b.kind === "break";
                      const dur = minutesBetween(b.start, b.end);
                      return (
                        <TableRow key={`${b.task_id}-${b.start}-${i}`}>
                          <TableCell className="text-xs text-muted-foreground">
                            {report.scheduleDate}
                          </TableCell>
                          <TableCell className="text-xs font-mono whitespace-nowrap">
                            {formatTimeRange12h(b.start, b.end)}
                          </TableCell>
                          <TableCell className="text-xs font-medium max-w-[200px]">
                            {b.title}
                            {isBreak && (
                              <span className="ml-1 text-muted-foreground">(break)</span>
                            )}
                            {!isBreak &&
                              b.segment_total &&
                              b.segment_total > 1 && (
                                <span className="ml-1 text-[10px] text-muted-foreground">
                                  Part {b.segment_index}/{b.segment_total}
                                </span>
                              )}
                          </TableCell>
                          <TableCell className="text-xs">
                            {isBreak ? "—" : b.priority || "—"}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums">
                            {dur} min
                          </TableCell>
                          <TableCell className="text-xs">
                            {isBreak ? "Break" : "Scheduled"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Deferred / partial */}
            {(report.deferredList.length > 0 || report.partial.length > 0) && (
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Unscheduled and partially scheduled
                </h2>
                <div className="rounded-lg border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead className="text-xs">Task</TableHead>
                        <TableHead className="text-xs">Priority</TableHead>
                        <TableHead className="text-xs">Requested</TableHead>
                        <TableHead className="text-xs">Scheduled</TableHead>
                        <TableHead className="text-xs">Remaining</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...report.partial, ...report.deferredList].map((t) => (
                        <TableRow key={t.task_id}>
                          <TableCell className="text-xs font-medium max-w-[160px]">
                            {t.title}
                          </TableCell>
                          <TableCell className="text-xs">
                            {t.priority_label || "—"}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums">
                            {t.duration != null ? `${t.duration} min` : "—"}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums">
                            {t.scheduled_minutes ?? 0} min
                          </TableCell>
                          <TableCell className="text-xs tabular-nums">
                            {t.remaining_minutes ??
                              Math.max(
                                0,
                                (t.duration || 0) - (t.scheduled_minutes || 0),
                              )}{" "}
                            min
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="outline" className="text-[10px]">
                              {t.status === "partially_scheduled"
                                ? "Partially Scheduled"
                                : "Deferred"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[180px]">
                            {t.reason ||
                              (t.status === "partially_scheduled"
                                ? "Not enough contiguous capacity for the full duration in the work window."
                                : "Could not place the full planned duration within the work window and existing constraints.")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* Analysis */}
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Scheduling analysis
              </h2>
              <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
                {report.analysis.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleExportPdf}
            disabled={!report}
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export PDF
          </Button>
          <Button type="button" onClick={handlePrint} disabled={!report}>
            <Printer className="h-4 w-4 mr-2" />
            Print Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
