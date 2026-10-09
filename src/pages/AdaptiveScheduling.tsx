import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
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
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  Loader2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { saveCache } from "@/lib/persist-cache";
import { ScheduleDevPanel } from "@/pages/Schedule";
import { useDevMode } from "@/hooks/use-dev-mode";
import {
  priorityFromScore,
  PRIORITY_STYLES,
  statusLabel,
} from "@/lib/status";
import { isPast, isToday } from "date-fns";
import { extractTimeline } from "@/lib/schedule-state";
import { formatTime12h, formatTimeRange12h } from "@/lib/format-time";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const CACHE_KEY = "gsi-cache:adaptive-schedule";


type TaskRow = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  start_time: string | null;
  estimated_duration: number | null;
  priority_score: number | null;
  category: string | null;
  updated_at?: string;
};

type ScheduleBlock = {
  task_id: string;
  title: string;
  start: string;
  end: string;
  category: string;
  kind?: string;
};

/**
 * Convert HH:MM into minutes so schedules are sorted
 * by actual clock time rather than string order.
 */
function startMinutes(
  hhmm: string | undefined | null
): number {
  if (!hhmm || !String(hhmm).includes(":")) {
    return Number.MAX_SAFE_INTEGER;
  }

  const [h, m] = String(hhmm).split(":").map(Number);

  if (!Number.isFinite(h)) {
    return Number.MAX_SAFE_INTEGER;
  }

  return h * 60 + (Number.isFinite(m) ? m : 0);
}

function sortBlocksChronologically(
  blocks: ScheduleBlock[]
): ScheduleBlock[] {
  return [...blocks].sort((a, b) => {
    const sa = startMinutes(a.start);
    const sb = startMinutes(b.start);

    if (sa !== sb) return sa - sb;

    const ea = startMinutes(a.end);
    const eb = startMinutes(b.end);

    if (ea !== eb) return ea - eb;

    return String(a.task_id).localeCompare(String(b.task_id));
  });
}

type AdaptiveMove = {
  task_id: string;
  title: string;
  original_start?: string | null;
  original_end?: string | null;
  completed_minutes?: number;
  remaining_minutes?: number;
  new_start?: string | null;
  new_end?: string | null;
  status?: string;
  reason?: string;
};

type Payload = {
  blocks: ScheduleBlock[];
  deferred?: {
    task_id: string;
    title: string;
  }[];
  adaptive_moves?: AdaptiveMove[];
  pso?: {
    fitness: number;
    iterations: number;
    swarm_size: number;
  };
  window?: {
    start: string;
    end: string;
    peak_start: string;
    peak_end: string;
    break_style: string;
  };
  algorithm?: string;
  timestamp?: string;
  note?: string;
};

type ChangeItem = {
  id: string;
  reason: string;
  title: string;
};

export default function AdaptiveScheduling() {
  /**
   * payload is the SINGLE source of truth for the schedule shown
   * on this page.
   *
   * Before adaptation:
   *   payload = current schedule
   *
   * After adaptation:
   *   payload = newly adapted current schedule
   *
   * There is intentionally NO separate "Updated Schedule".
   */
  const [payload, setPayload] = useState<Payload | null>(null);
  /** Candidate adaptive schedule — never official until Apply. */
  const [previewPayload, setPreviewPayload] = useState<Payload | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scheduleStatus, setScheduleStatus] = useState<
    "NO_SCHEDULE" | "CURRENT" | "OUTDATED" | "CONFIRMING" | "GENERATING" | "PREVIEW" | "APPLYING" | "ERROR"
  >("NO_SCHEDULE");
  const [loadingSchedule, setLoadingSchedule] = useState(true);
  const generatingLock = useRef(false);

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [generating, setGenerating] = useState(false);

  const { devMode } = useDevMode();

  const blocks = useMemo(
    () =>
      sortBlocksChronologically(
        payload?.blocks || []
      ),
    [payload?.blocks]
  );

  /**
   * Load the user's current tasks.
   */
  const fetchTasks = async () => {
    setLoadingTasks(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setTasks([]);
      setLoadingTasks(false);
      return;
    }

    const { data } = await supabase
      .from("tasks")
      .select(
        "id, title, status, due_date, start_time, estimated_duration, priority_score, category, updated_at"
      )
      .eq("user_id", user.id)
      .or("archived.eq.false,archived.is.null")
      .order("updated_at", {
        ascending: false,
      });

    setTasks((data as TaskRow[]) || []);
    setLoadingTasks(false);
  };

  /**
   * Load the current authenticated user's schedule.
   *
   * IMPORTANT:
   * We do NOT generate a new schedule when the page opens.
   * We only display the existing schedule.
   */
  useEffect(() => {
    fetchTasks();

    const loadCurrent = async () => {
      setLoadingSchedule(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setScheduleStatus("NO_SCHEDULE");
          return;
        }

        const now = new Date();
        const scheduleDate =
          `${now.getFullYear()}-` +
          `${String(now.getMonth() + 1).padStart(2, "0")}-` +
          `${String(now.getDate()).padStart(2, "0")}`;

        // DB is authoritative — never generate on open/refresh.
        const { data: rows } = await supabase
          .from("schedules")
          .select("timeline, schedule_date, created_at")
          .eq("user_id", user.id)
          .eq("schedule_date", scheduleDate)
          .order("created_at", { ascending: false })
          .limit(1);

        const row = rows?.[0] as any;
        if (!row) {
          setScheduleStatus("NO_SCHEDULE");
          return;
        }

        const { blocks: rawBlocks, meta } = extractTimeline(row.timeline);
        if (!rawBlocks.length) {
          setScheduleStatus("NO_SCHEDULE");
          return;
        }

        const next: Payload = {
          blocks: sortBlocksChronologically(rawBlocks as ScheduleBlock[]),
          algorithm:
            (meta as any)?.algorithm ||
            "loaded-from-current-user-schedule",
          timestamp: row.created_at,
          window: meta
            ? {
                start: (meta as any).work_start || "—",
                end: (meta as any).work_end || "—",
                peak_start: (meta as any).peak_start || "—",
                peak_end: (meta as any).peak_end || "—",
                break_style: (meta as any).break_style || "—",
              }
            : undefined,
        };

        setPayload(next);
        setPreviewPayload(null);
        setScheduleStatus("CURRENT");
        // Cache is display-only; DB remains source of truth.
        saveCache(CACHE_KEY, next);
      } finally {
        setLoadingSchedule(false);
      }
    };

    void loadCurrent();
  }, []);

  /**
   * Detect things that may require adaptation.
   */
  const changes = useMemo<ChangeItem[]>(() => {
    const items: ChangeItem[] = [];

    const scheduledIds = new Set(
      blocks
        .filter((b) => b.kind !== "break")
        .map((b) => b.task_id)
    );

    for (const t of tasks) {
      /**
       * Overdue task
       */
      if (
        t.status !== "done" &&
        t.due_date
      ) {
        const due = new Date(t.due_date);

        if (
          isPast(due) &&
          !isToday(due)
        ) {
          items.push({
            id: t.id,
            title: t.title,
            reason:
              "Overdue — deadline has passed",
          });

          continue;
        }
      }

      /**
       * Completed task still exists in schedule
       */
      if (
        t.status === "done" &&
        scheduledIds.has(t.id)
      ) {
        items.push({
          id: t.id,
          title: t.title,
          reason:
            "Completed — can be removed from schedule",
        });

        continue;
      }

      /**
       * New task that has not been scheduled
       */
      if (
        !t.start_time &&
        t.status !== "done" &&
        !scheduledIds.has(t.id)
      ) {
        items.push({
          id: t.id,
          title: t.title,
          reason:
            "New unscheduled task affecting the plan",
        });

        continue;
      }

      /**
       * Deadline is today
       */
      if (
        t.status !== "done" &&
        t.due_date &&
        isToday(new Date(t.due_date))
      ) {
        items.push({
          id: t.id,
          title: t.title,
          reason: "Deadline is today",
        });
      }

      /**
       * Scheduled period ended but task is unfinished.
       */
      if (
        t.status !== "done" &&
        t.start_time
      ) {
        const start =
          new Date(t.start_time).getTime();

        const durMin = Math.max(
          5,
          Number(t.estimated_duration) || 30
        );

        const end =
          start + durMin * 60_000;

        if (
          Number.isFinite(start) &&
          end <= Date.now()
        ) {
          items.push({
            id: t.id,
            title: t.title,
            reason:
              "Scheduled period ended — task still unfinished",
          });
        }
      }
    }

    /**
     * Remove duplicate task IDs.
     */
    const seen = new Set<string>();

    return items.filter((c) => {
      if (seen.has(c.id)) {
        return false;
      }

      seen.add(c.id);
      return true;
    });
  }, [tasks, blocks]);

  const hasChanges = changes.length > 0;

  const hasOfficialSchedule =
    blocks.filter((b) => b.kind !== "break").length > 0;

  const displayStatus =
    scheduleStatus === "PREVIEW"
      ? "PREVIEW"
      : scheduleStatus === "GENERATING" || scheduleStatus === "APPLYING"
        ? scheduleStatus
        : !hasOfficialSchedule
          ? "NO_SCHEDULE"
          : hasChanges
            ? "OUTDATED"
            : "CURRENT";

  const parseError = async (err: any): Promise<string> => {
    let message = err?.message || "Failed to adapt schedule";
    try {
      const ctx = err?.context;
      if (ctx && typeof ctx.json === "function") {
        const body = await ctx.json();
        if (body?.error) message = String(body.error);
      } else if (typeof err?.context?.body === "string") {
        const body = JSON.parse(err.context.body);
        if (body?.error) message = String(body.error);
      }
    } catch {
      /* keep */
    }
    if (/non-2xx/i.test(message)) {
      message =
        "Unable to adapt schedule. Check your working hours, then try again.";
    }
    return message;
  };

  /**
   * Generate adaptive candidate without writing the official schedule.
   */
  const runPreviewAdapt = async () => {
    if (generatingLock.current) return;
    generatingLock.current = true;
    setGenerating(true);
    setScheduleStatus("GENERATING");
    setConfirmOpen(false);

    try {
      const { data, error } = await supabase.functions.invoke(
        "generate-schedule",
        {
          body: {
            adaptive: true,
            preview: true,
            apply: false,
          },
        },
      );
      if (error) throw error;

      const body =
        typeof data === "string" ? JSON.parse(data) : data || {};
      if (body.error) throw new Error(body.error);

      const rawBlocks = Array.isArray(body.blocks) ? body.blocks : [];
      const next: Payload = {
        ...body,
        blocks: sortBlocksChronologically(rawBlocks),
      };
      const taskBlocks = next.blocks.filter((b) => b.kind !== "break");

      if (taskBlocks.length === 0) {
        toast.message(
          body.note ||
            "No adaptive changes could be generated. Your current schedule was kept unchanged.",
        );
        setPreviewPayload(null);
        setScheduleStatus(hasOfficialSchedule ? "CURRENT" : "NO_SCHEDULE");
        return;
      }

      setPreviewPayload(next);
      setScheduleStatus("PREVIEW");
      toast.message(
        "Preview ready. Review proposed changes before applying.",
      );
    } catch (err: any) {
      toast.error(await parseError(err));
      setScheduleStatus(hasOfficialSchedule ? "CURRENT" : "NO_SCHEDULE");
      setPreviewPayload(null);
    } finally {
      setGenerating(false);
      generatingLock.current = false;
    }
  };

  /**
   * Commit the exact previewed candidate (no re-generation).
   */
  const applyPreview = async () => {
    if (!previewPayload || generatingLock.current) return;
    generatingLock.current = true;
    setGenerating(true);
    setScheduleStatus("APPLYING");

    try {
      const { data, error } = await supabase.functions.invoke(
        "generate-schedule",
        {
          body: {
            adaptive: true,
            apply: true,
            preview: false,
            commit_blocks: previewPayload.blocks,
            adaptive_moves: previewPayload.adaptive_moves || [],
            deferred: previewPayload.deferred || [],
          },
        },
      );
      if (error) throw error;

      const body =
        typeof data === "string" ? JSON.parse(data) : data || {};
      if (body.error) throw new Error(body.error);

      const rawBlocks = Array.isArray(body.blocks)
        ? body.blocks
        : previewPayload.blocks;
      const next: Payload = {
        ...previewPayload,
        ...body,
        blocks: sortBlocksChronologically(rawBlocks),
      };
      const taskBlocks = next.blocks.filter((b) => b.kind !== "break");
      if (taskBlocks.length === 0) {
        toast.message(
          "The previewed schedule could not be applied. Your current schedule was kept unchanged.",
        );
        setScheduleStatus("CURRENT");
        return;
      }

      setPayload(next);
      setPreviewPayload(null);
      saveCache(CACHE_KEY, next);
      await fetchTasks();
      setScheduleStatus("CURRENT");
      toast.success("Schedule Updated", {
        description:
          "Your current schedule was adapted using the previewed changes.",
        duration: 4500,
      });
    } catch (err: any) {
      toast.error(await parseError(err));
      setScheduleStatus("CURRENT");
    } finally {
      setGenerating(false);
      generatingLock.current = false;
    }
  };

  const keepCurrent = () => {
    setConfirmOpen(false);
    setPreviewPayload(null);
    setScheduleStatus(hasOfficialSchedule ? (hasChanges ? "OUTDATED" : "CURRENT") : "NO_SCHEDULE");
    toast.message("Current schedule kept unchanged.");
  };

  /**
   * Entry: confirm first when an official schedule exists.
   */
  const adaptSchedule = () => {
    if (generatingLock.current || generating) return;

    if (!hasOfficialSchedule) {
      toast.message(
        "No existing schedule found. Create one first from Auto Schedule.",
      );
      return;
    }

    if (!hasChanges) {
      toast.message("Your schedule is already up to date.");
      return;
    }

    setConfirmOpen(true);
    setScheduleStatus("CONFIRMING");
  };

  return (
    <motion.div
      initial={{
        opacity: 0,
        y: 8,
      }}
      animate={{
        opacity: 1,
        y: 0,
      }}
      className="space-y-6"
    >
      {/* PAGE HEADER */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold">
            Adaptive Scheduling
          </h1>

          <p className="text-muted-foreground mt-1">
            Adjust your existing schedule when tasks
            or deadlines change. Changes apply only after you confirm a preview.
          </p>
          {displayStatus === "CURRENT" && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-success" />
              Your schedule is up to date.
            </p>
          )}
          {displayStatus === "OUTDATED" && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Your schedule may need updating. Review changes before adapting.
            </p>
          )}
          {displayStatus === "PREVIEW" && (
            <p className="text-xs text-muted-foreground mt-1">
              Preview ready — apply to replace the current schedule, or keep current.
            </p>
          )}
        </div>

        <Button
          onClick={adaptSchedule}
          disabled={generating || loadingSchedule}
        >
          {generating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {generating
            ? scheduleStatus === "APPLYING"
              ? "Applying..."
              : "Previewing..."
            : "Adapt Schedule"}
        </Button>
      </div>

      {/* DEVELOPER MODE */}
      {devMode && payload && (
        <ScheduleDevPanel
          payload={payload}
          title="Adaptive engine — how priorities were re-ordered this run"
        />
      )}

      {/* =====================================================
          SINGLE CURRENT SCHEDULE
          ===================================================== */}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Current Schedule
            </h2>

            <p className="text-xs text-muted-foreground mt-1">
              Official schedule from the database. It only changes after you apply a preview.
            </p>
          </div>
        </div>

        {(loadingTasks || loadingSchedule) &&
        blocks.length === 0 ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : blocks.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground text-sm">
              No existing schedule found. Create one
              first from Auto Schedule.
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <div className="max-h-[500px] overflow-y-auto overflow-x-auto overscroll-contain">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-xs w-28">
                      Date
                    </TableHead>

                    <TableHead className="text-xs w-36">
                      Time
                    </TableHead>

                    <TableHead className="text-xs">
                      Task
                    </TableHead>

                    <TableHead className="text-xs w-24">
                      Priority
                    </TableHead>

                    <TableHead className="text-xs w-28">
                      Status
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {blocks.map((b, i) => {
                    const task = tasks.find(
                      (t) =>
                        t.id === b.task_id
                    );

                    const pr = task
                      ? priorityFromScore(
                          task.priority_score
                        )
                      : null;

                    const style = pr
                      ? PRIORITY_STYLES[pr]
                      : null;

                    const isBreak =
                      b.kind === "break";

                    return (
                      <TableRow
                        key={`${b.task_id}-${i}`}
                        className="text-sm"
                      >
                        <TableCell className="py-2 text-xs text-muted-foreground">
                          Today
                        </TableCell>

                        <TableCell className="py-2 font-mono text-xs whitespace-nowrap">
                          {formatTimeRange12h(b.start, b.end)}
                        </TableCell>

                        <TableCell className="py-2 font-medium max-w-[220px] truncate">
                          {b.title}

                          {isBreak && (
                            <span className="ml-2 text-[10px] text-muted-foreground">
                              (break)
                            </span>
                          )}
                        </TableCell>

                        <TableCell className="py-2">
                          {style ? (
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${style.className}`}
                            >
                              {style.label}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>

                        <TableCell className="py-2 text-xs capitalize">
                          {isBreak
                            ? "—"
                            : task
                              ? statusLabel(
                                  task.status
                                )
                              : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </section>

      {/* =====================================================
          CHANGES DETECTED
          ===================================================== */}

      {hasChanges ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            Changes Detected
          </h2>

          <div className="rounded-lg border overflow-hidden">
            <div className="max-h-[360px] overflow-y-auto overflow-x-auto overscroll-contain">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-xs">
                      Task
                    </TableHead>

                    <TableHead className="text-xs">
                      Reason
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {changes.map((c) => (
                    <TableRow
                      key={c.id}
                      className="text-sm"
                    >
                      <TableCell className="py-2 font-medium max-w-[220px] truncate">
                        {c.title}
                      </TableCell>

                      <TableCell className="py-2 text-xs text-muted-foreground">
                        {c.reason}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </section>
      ) : (
        blocks.length > 0 && (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" />

              Your schedule is up to date.
            </CardContent>
          </Card>
        )
      )}

      {/* =====================================================
          UNFINISHED TASK MOVES
          ===================================================== */}

      {((previewPayload?.adaptive_moves || payload?.adaptive_moves)?.length ?? 0) >
          0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {previewPayload
                ? "Proposed Moves (Preview)"
                : "Unfinished Task Moves"}
            </h2>

            <div className="rounded-lg border overflow-hidden max-h-[320px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/95">
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-xs">
                      Task
                    </TableHead>

                    <TableHead className="text-xs">
                      Original
                    </TableHead>

                    <TableHead className="text-xs">
                      Completed
                    </TableHead>

                    <TableHead className="text-xs">
                      Remaining
                    </TableHead>

                    <TableHead className="text-xs">
                      New Schedule
                    </TableHead>

                    <TableHead className="text-xs">
                      Status
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {(previewPayload?.adaptive_moves ||
                    payload!.adaptive_moves!
                  ).map((m) => (
                      <TableRow
                        key={m.task_id}
                        className="text-sm"
                      >
                        <TableCell className="py-2 font-medium max-w-[160px] truncate">
                          {m.title}
                        </TableCell>

                        <TableCell className="py-2 font-mono text-xs text-muted-foreground whitespace-nowrap">
                          {m.original_start && m.original_end
                            ? formatTimeRange12h(m.original_start, m.original_end)
                            : "—"}
                        </TableCell>

                        <TableCell className="py-2 text-xs">
                          {m.completed_minutes ??
                            0}{" "}
                          min
                        </TableCell>

                        <TableCell className="py-2 text-xs">
                          {m.remaining_minutes ??
                            0}{" "}
                          min
                        </TableCell>

                        <TableCell className="py-2 font-mono text-xs whitespace-nowrap">
                          {m.new_start && m.new_end
                            ? formatTimeRange12h(m.new_start, m.new_end)
                            : "—"}
                        </TableCell>

                        <TableCell className="py-2 text-xs">
                          <span className="text-muted-foreground">
                            {m.status}
                          </span>

                          {m.reason && (
                            <p className="text-[10px] text-muted-foreground mt-0.5 max-w-[200px]">
                              {m.reason}
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        )}

      <AlertDialog
        open={confirmOpen && !previewPayload}
        onOpenChange={(open) => {
          if (!open) keepCurrent();
          else setConfirmOpen(true);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Adapt Your Current Schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              Adaptive Scheduling may change task times based on unfinished
              tasks, deadlines, completed work, and scheduling settings. Your
              current schedule will remain unchanged until you confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={keepCurrent}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runPreviewAdapt}>
              Preview Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!previewPayload}
        onOpenChange={(open) => {
          if (!open) keepCurrent();
        }}
      >
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Apply adaptive changes?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Review the proposed schedule. Applying replaces your current
                  official schedule with this preview.
                </p>
                {previewPayload && (
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      {
                        previewPayload.blocks.filter((b) => b.kind !== "break")
                          .length
                      }{" "}
                      task blocks
                    </li>
                    <li>
                      {(previewPayload.adaptive_moves || []).length} adaptive
                      move(s)
                    </li>
                    <li>
                      {Array.isArray(previewPayload.deferred)
                        ? previewPayload.deferred.length
                        : 0}{" "}
                      deferred
                    </li>
                  </ul>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={keepCurrent}>
              Keep Current Schedule
            </AlertDialogCancel>
            <AlertDialogAction onClick={applyPreview} disabled={generating}>
              Apply Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
