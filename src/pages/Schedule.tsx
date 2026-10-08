import {
  useState,
  useEffect,
  useMemo,
  useRef,
} from "react";

import { supabase } from "@/integrations/supabase/client";

import {
  Card,
  CardContent,
} from "@/components/ui/card";

import {
  Button,
} from "@/components/ui/button";

import {
  Badge,
} from "@/components/ui/badge";

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
  Wand2,
  CheckCircle2,
} from "lucide-react";

import {
  loadCache,
  saveCache,
} from "@/lib/persist-cache";

import {
  DevPanel,
  DevStat,
} from "@/components/DevPanel";

import { useDevMode } from "@/hooks/use-dev-mode";

import {
  priorityFromScore,
  PRIORITY_STYLES,
  statusLabel,
} from "@/lib/status";

import { format } from "date-fns";
import {
  extractTimeline,
  scheduleStatusLabel,
  type ScheduleStatus,
} from "@/lib/schedule-state";
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

const CACHE_KEY =
  "gsi-cache:schedule-blocks";

/* =========================================================
   HELPERS
   ========================================================= */

function to12h(
  hhmm: string
): string {
  if (
    !hhmm ||
    !hhmm.includes(":")
  ) {
    return hhmm;
  }

  const [h, m] =
    hhmm
      .split(":")
      .map(Number);

  const period =
    h >= 12
      ? "PM"
      : "AM";

  const hr =
    ((h + 11) % 12) + 1;

  return `${hr}:${String(
    m
  ).padStart(2, "0")} ${period}`;
}

function toMinutes(
  value: string
): number {
  const [h, m] =
    value
      .split(":")
      .map(Number);

  return (
    (Number.isFinite(h)
      ? h
      : 0) *
      60 +
    (Number.isFinite(m)
      ? m
      : 0)
  );
}

function getLocalDateString(
  date = new Date()
): string {
  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      date.getDate()
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/* =========================================================
   TYPES
   ========================================================= */

type TaskRow = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  start_time: string | null;
  estimated_duration:
    | number
    | null;
  priority_score:
    | number
    | null;
  category:
    | string
    | null;
};

type ScheduleBlock = {
  task_id: string;
  title: string;
  start: string;
  end: string;
  category: string;
  kind?: "task" | "break";
  priority?: "High" | "Medium" | "Low";
};

type DeferredTask = {
  task_id: string;
  title: string;
  duration?: number;
  priority?: number | null;
  status?: string;
};

type TaskSummary = {
  task_id: string;
  title: string;
  duration: number;
  scheduled_minutes: number;
  remaining_minutes: number;
  priority: number | null;
  priority_label: "High" | "Medium" | "Low";
  due_date?: string | null;
  overdue: boolean;
  status: "scheduled" | "partially_scheduled" | "deferred";
};

type Payload = {
  blocks: ScheduleBlock[];

  deferred?: DeferredTask[];
  task_summary?: TaskSummary[];
  partial_count?: number;

  pso?: {
    fitness: number;
    iterations: number;
    swarm_size: number;
    inertia_weight?: number;
    cognitive?: number;
    social?: number;
  };

  window?: {
    start: string;
    end: string;
    peak_start: string;
    peak_end: string;
    break_style: string;
    schedule_date?: string;
  };

  algorithm?: string;
  timestamp?: string;
  note?: string;

  scheduled_count?: number;
  deferred_count?: number;
};

/* =========================================================
   BLOCK VALIDATION
   ========================================================= */

/*
 * The Schedule page must never display duplicate
 * or overlapping blocks.
 *
 * This is mainly protection for old cache/database
 * data. The backend also performs the same validation.
 */
function normalizeBlocks(
  input: ScheduleBlock[]
): ScheduleBlock[] {
  const sorted =
    [...input]
      .filter(
        (block) =>
          block &&
          block.start &&
          block.end
      )
      .sort(
        (a, b) => {
          const startDiff =
            toMinutes(
              a.start
            ) -
            toMinutes(
              b.start
            );

          if (
            startDiff !== 0
          ) {
            return startDiff;
          }

          return (
            toMinutes(
              a.end
            ) -
            toMinutes(
              b.end
            )
          );
        }
      );

  const result: ScheduleBlock[] =
    [];

  // Detect overnight schedule (any block crosses midnight: end < start)
  const hasOvernight = sorted.some((b) => {
    const s = toMinutes(b.start);
    const e = toMinutes(b.end);
    return e < s;
  });

  const DAY = 24 * 60;
  const shiftKey = (clock: number, overnight: boolean) => {
    if (!overnight) return clock;
    // Evening portion sorts after morning of same shift display: use clock as-is
    // for non-cross blocks; for ordering overnight shifts prefer evening first.
    // Linearize: times from noon onward stay, early morning get +DAY for sort only
    // when we already know overnight. Simpler: if overnight, map clock < 12h to +DAY
    // only if there exists a block starting after 12:00 — use 12:00 threshold.
    if (clock < 12 * 60) return clock + DAY;
    return clock;
  };

  // Re-sort for overnight so 22:00 comes before 01:00
  const ordered = hasOvernight
    ? [...sorted].sort((a, b) => {
        const as = shiftKey(toMinutes(a.start), true);
        const bs = shiftKey(toMinutes(b.start), true);
        if (as !== bs) return as - bs;
        return shiftKey(toMinutes(a.end), true) - shiftKey(toMinutes(b.end), true);
      })
    : sorted;

  for (const block of ordered) {
    const start = toMinutes(block.start);
    const end = toMinutes(block.end);

    // Allow overnight segments (end < start). Only drop zero-length.
    if (end === start) {
      continue;
    }

    const previous =
      result.length > 0 ? result[result.length - 1] : null;

    if (previous) {
      const prevStart = toMinutes(previous.start);
      const prevEnd = toMinutes(previous.end);
      // Overlap check in linearized shift space when overnight
      const p0 = hasOvernight ? shiftKey(prevStart, true) : prevStart;
      const p1 = hasOvernight
        ? (prevEnd < prevStart ? shiftKey(prevEnd, true) : shiftKey(prevEnd, true))
        : prevEnd;
      const c0 = hasOvernight ? shiftKey(start, true) : start;
      const c1 = hasOvernight
        ? (end < start ? shiftKey(end, true) : shiftKey(end, true))
        : end;
      if (c0 < p1 && c1 > p0) {
        continue;
      }
    }

    result.push(block);
  }

  return result;
}

/* =========================================================
   COMPONENT
   ========================================================= */

export default function Schedule() {
  const [
    payload,
    setPayload,
  ] =
    useState<Payload | null>(
      null
    );

  /** Candidate schedule — never becomes official until user applies. */
  const [previewPayload, setPreviewPayload] =
    useState<Payload | null>(null);
  const [confirmRegenOpen, setConfirmRegenOpen] =
    useState(false);
  const [scheduleStatus, setScheduleStatus] =
    useState<"NO_SCHEDULE" | "CURRENT" | "PREVIEW" | "GENERATING" | "OUTDATED">("NO_SCHEDULE");
  const generatingLock = useRef(false);

  const [
    unscheduled,
    setUnscheduled,
  ] =
    useState<TaskRow[]>(
      []
    );

  const [
    loadingTasks,
    setLoadingTasks,
  ] =
    useState(true);

  const [
    loadingSchedule,
    setLoadingSchedule,
  ] =
    useState(true);

  const [
    generating,
    setGenerating,
  ] =
    useState(false);

  const [
    justCreated,
    setJustCreated,
  ] =
    useState(false);

  const {
    devMode,
  } =
    useDevMode();

  const blocks =
    payload?.blocks || [];

  /* =======================================================
     FETCH UNSCHEDULED TASKS
     ======================================================= */

  const fetchUnscheduled =
    async () => {
      setLoadingTasks(
        true
      );

      const {
        data: {
          user,
        },
      } =
        await supabase.auth.getUser();

      if (!user) {
        setUnscheduled(
          []
        );

        setLoadingTasks(
          false
        );

        return;
      }

      const {
        data,
        error,
      } =
        await supabase
          .from("tasks")
          .select(
            "id, title, status, due_date, start_time, estimated_duration, priority_score, category"
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
          )
          .order(
            "priority_score",
            {
              ascending:
                false,
            }
          );

      if (error) {
        console.error(
          "Failed to load unscheduled tasks:",
          error
        );

        setUnscheduled(
          []
        );

        setLoadingTasks(
          false
        );

        return;
      }

      const rows =
        (data as TaskRow[]) ||
        [];

      /*
       * Eligible for Auto Schedule = all active
       * (non-done, non-archived) tasks for this user.
       * Previously only null start_time was shown, so users
       * who set due/start times only saw 1 row while Tasks
       * page showed all 7.
       * Prefer null start_time first, then others (can re-place).
       */
      const eligible = rows
        .filter((task) => task.status !== "done")
        .sort((a, b) => {
          const aU = a.start_time ? 1 : 0;
          const bU = b.start_time ? 1 : 0;
          if (aU !== bU) return aU - bU;
          return (b.priority_score || 0) - (a.priority_score || 0);
        });
      setUnscheduled(eligible);

      setLoadingTasks(
        false
      );
    };

  /* =======================================================
     LOAD SAVED GENERATED SCHEDULE
     ======================================================= */

  const loadSavedSchedule =
    async (): Promise<Payload | null> => {
      const {
        data: {
          user,
        },
      } =
        await supabase.auth.getUser();

      if (!user) {
        return null;
      }

      const today =
        getLocalDateString();

      /*
       * The schedules table is now the
       * authoritative generated timeline.
       */
      const {
        data: scheduleRows,
        error,
      } =
        await supabase
          .from("schedules")
          .select(
            "id, schedule_date, timeline, created_at"
          )
          .eq(
            "user_id",
            user.id
          )
          .eq(
            "schedule_date",
            today
          )
          .order(
            "created_at",
            {
              ascending:
                false,
            }
          )
          .limit(1);

      if (
        !error &&
        scheduleRows &&
        scheduleRows.length >
          0
      ) {
        const row =
          scheduleRows[0] as any;

        const { blocks: rawTimeline, meta: scheduleMeta } =
          extractTimeline(row.timeline);

        const savedBlocks =
          normalizeBlocks(
            rawTimeline as ScheduleBlock[]
          );

        if (
          savedBlocks.length >
          0
        ) {
          return {
            blocks:
              savedBlocks,
            algorithm:
              (scheduleMeta as any)?.algorithm ||
              "saved-generated-schedule",
            timestamp:
              row.created_at ||
              new Date().toISOString(),
            window: {
              start:
                (scheduleMeta as any)?.work_start || "—",
              end:
                (scheduleMeta as any)?.work_end || "—",
              peak_start:
                (scheduleMeta as any)?.peak_start || "—",
              peak_end:
                (scheduleMeta as any)?.peak_end || "—",
              break_style:
                (scheduleMeta as any)?.break_style || "—",
              schedule_date:
                today,
            },
            schedule_meta: scheduleMeta,
          } as any;
        }
      }

      /*
       * Fallback only if no saved generated
       * timeline exists.
       *
       * This is useful for schedules created
       * by older versions of the system.
       */
      const {
        data: tasks,
      } =
        await supabase
          .from("tasks")
          .select(
            "id, title, start_time, estimated_duration, category, status"
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
          )
          .not(
            "start_time",
            "is",
            null
          )
          .order(
            "start_time",
            {
              ascending:
                true,
            }
          );

      const fallbackBlocks: ScheduleBlock[] =
        [];

      for (
        const task of (tasks ||
          []) as any[]
      ) {
        if (
          !task.start_time
        ) {
          continue;
        }

        const startDate =
          new Date(
            task.start_time
          );

        /*
         * Only today's tasks.
         */
        if (
          getLocalDateString(
            startDate
          ) !== today
        ) {
          continue;
        }

        const duration =
          Math.max(
            5,
            Number(
              task.estimated_duration
            ) || 30
          );

        const endDate =
          new Date(
            startDate.getTime() +
              duration *
                60_000
          );

        const fmt =
          (date: Date) =>
            `${String(
              date.getHours()
            ).padStart(
              2,
              "0"
            )}:${String(
              date.getMinutes()
            ).padStart(
              2,
              "0"
            )}`;

        fallbackBlocks.push(
          {
            task_id:
              task.id,
            title:
              task.title,
            start:
              fmt(
                startDate
              ),
            end:
              fmt(
                endDate
              ),
            category:
              task.category ||
              "General",
            kind: "task",
          }
        );
      }

      const safeFallback =
        normalizeBlocks(
          fallbackBlocks
        );

      if (
        safeFallback.length ===
        0
      ) {
        return null;
      }

      return {
        blocks:
          safeFallback,
        algorithm:
          "loaded-from-existing-task-times",
        timestamp:
          new Date().toISOString(),
      };
    };

  /* =======================================================
     INITIAL LOAD
     ======================================================= */

  useEffect(() => {
    let cancelled =
      false;

    const load =
      async () => {
        setLoadingSchedule(
          true
        );

        await fetchUnscheduled();

        const saved =
          await loadSavedSchedule();

        if (
          cancelled
        ) {
          return;
        }

        if (saved) {
          setPayload(
            saved
          );

          saveCache(
            CACHE_KEY,
            saved
          );
        } else {
          /*
           * Only use cache if the database has
           * no schedule at all.
           */
          const cached =
            loadCache<Payload>(
              CACHE_KEY
            );

          if (
            cached &&
            Array.isArray(
              cached.blocks
            )
          ) {
            const safeBlocks =
              normalizeBlocks(
                cached.blocks
              );

            if (
              safeBlocks.length >
              0
            ) {
              setPayload({
                ...cached,
                blocks:
                  safeBlocks,
              });
            }
          }
        }

        setLoadingSchedule(
          false
        );
      };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  /* =======================================================
     GENERATE SCHEDULE
     ======================================================= */

  const hasOfficialSchedule =
    (payload?.blocks || []).filter((b: any) => b.kind !== "break").length > 0;

  const runGenerate = async (opts: {
    preview: boolean;
    apply: boolean;
  }) => {
    if (generatingLock.current) return;
    generatingLock.current = true;
    setGenerating(true);
    setJustCreated(false);
    setScheduleStatus("GENERATING");

    try {
      const scheduleDate = getLocalDateString();
      const { data, error } = await supabase.functions.invoke(
        "generate-schedule",
        {
          body: {
            schedule_date: scheduleDate,
            preview: opts.preview,
            apply: opts.apply,
          },
        },
      );

      if (error) throw error;

      const body =
        typeof data === "string" ? JSON.parse(data) : data || {};
      if (body.error) throw new Error(body.error);

      const rawBlocks = Array.isArray(body.blocks) ? body.blocks : [];
      const safeBlocks = normalizeBlocks(rawBlocks);
      const taskBlockCount = safeBlocks.filter(
        (b: any) => b.kind !== "break",
      ).length;

      const next: Payload = {
        ...body,
        blocks: safeBlocks,
        algorithm: body.algorithm || "csp-pso",
        timestamp: body.timestamp || new Date().toISOString(),
      };

      // Never overwrite an official schedule with an empty generation.
      if (taskBlockCount === 0) {
        if (hasOfficialSchedule) {
          toast.message(
            "The new schedule could not be generated. Your current schedule was kept unchanged.",
          );
          setScheduleStatus("CURRENT");
          setPreviewPayload(null);
          return;
        }
        toast.message(
          body.note ||
            "No schedule slots could be generated. Confirm working hours are set and you have active tasks.",
        );
        setScheduleStatus("NO_SCHEDULE");
        return;
      }

      if (opts.preview && hasOfficialSchedule) {
        // Show candidate only — official schedule stays until Apply.
        setPreviewPayload(next);
        setScheduleStatus("PREVIEW");
        setConfirmRegenOpen(true);
        toast.message(
          "Preview ready. Review the new schedule before applying it.",
        );
        return;
      }

      // First schedule or explicit apply
      setPayload(next);
      setPreviewPayload(null);
      saveCache(CACHE_KEY, next);
      setJustCreated(true);
      setScheduleStatus("CURRENT");
      await fetchUnscheduled();

      const deferredN = Array.isArray(body.deferred)
        ? body.deferred.length
        : Number(body.deferred_count) || 0;
      const win = body.window;
      const winLabel =
        win?.start && win?.end
          ? `${win.start}–${win.end}${win.overnight ? " (overnight)" : ""}`
          : null;
      toast.success(
        winLabel
          ? `Schedule applied for ${winLabel}`
          : "Schedule created successfully.",
        deferredN > 0
          ? {
              description: `${deferredN} task(s) deferred — not enough time in the work window.`,
            }
          : undefined,
      );
    } catch (error: any) {
      console.error("Schedule generation failed:", error);
      let message = error?.message || "Failed to generate schedule";
      try {
        const ctx = error?.context;
        if (ctx && typeof ctx.json === "function") {
          const body = await ctx.json();
          if (body?.error) message = String(body.error);
        }
      } catch {
        /* keep */
      }
      if (/non-2xx/i.test(message)) {
        message =
          "Unable to generate schedule. Check your working hours, then try again.";
      }
      toast.error(message);
      setScheduleStatus(hasOfficialSchedule ? "CURRENT" : "NO_SCHEDULE");
    } finally {
      setGenerating(false);
      generatingLock.current = false;
    }
  };

  /** Entry: first schedule applies; existing schedule opens confirm → preview. */
  const generateSchedule = async () => {
    if (generatingLock.current) return;
    if (hasOfficialSchedule) {
      setConfirmRegenOpen(true);
      return;
    }
    await runGenerate({ preview: false, apply: true });
  };

  const confirmPreviewNew = async () => {
    setConfirmRegenOpen(false);
    await runGenerate({ preview: true, apply: false });
  };

  const applyPreviewSchedule = async () => {
    if (!previewPayload) return;
    // Re-run with apply so DB + start_time stay consistent
    setConfirmRegenOpen(false);
    await runGenerate({ preview: false, apply: true });
  };

  const keepCurrentSchedule = () => {
    setPreviewPayload(null);
    setConfirmRegenOpen(false);
    setScheduleStatus(hasOfficialSchedule ? "CURRENT" : "NO_SCHEDULE");
    toast.message("Current schedule kept unchanged.");
  };

/* =======================================================
     GROUPING
     ======================================================= */

  const groupedBlocks =
    useMemo(() => {
      if (
        blocks.length ===
        0
      ) {
        return [];
      }

      return [
        {
          dateLabel:
            "Today",
          items:
            blocks,
        },
      ];
    }, [blocks]);

  /* =======================================================
     UI
     ======================================================= */

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
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold">
            Auto Schedule
          </h1>

          <p className="text-muted-foreground mt-1">
            {hasOfficialSchedule
              ? "Your official schedule is active. Regenerate only after confirming a preview."
              : "Create an optimized schedule from your unscheduled tasks."}
          </p>
          {scheduleStatus !== "NO_SCHEDULE" && (
            <p className="text-xs text-muted-foreground mt-1">
              {scheduleStatus === "PREVIEW"
                ? "Previewing a new schedule. Apply to replace the current one."
                : scheduleStatus === "CURRENT"
                ? "Your schedule is up to date."
                : scheduleStatus === "GENERATING"
                ? "Generating schedule…"
                : ""}
            </p>
          )}
        </div>

        <Button
          onClick={generateSchedule}
          disabled={generating || loadingTasks}
        >
          {generating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Wand2 className="mr-2 h-4 w-4" />
          )}
          {hasOfficialSchedule ? "Regenerate Schedule" : "Auto Schedule"}
        </Button>
      </div>

      {devMode &&
        payload && (
          <ScheduleDevPanel
            payload={
              payload
            }
          />
        )}

      {/* ===================================================
          GENERATED SCHEDULE
          =================================================== */}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Generated Schedule
          </h2>

          {blocks.length >
            0 && (
            <span className="text-xs text-muted-foreground">
              {
                blocks.length
              }{" "}
              block
              {blocks.length !==
              1
                ? "s"
                : ""}
            </span>
          )}
        </div>

        {justCreated &&
          blocks.length >
            0 && (
            <div className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" />

              Schedule created successfully.
            </div>
          )}

        {loadingSchedule ? (
          <Card>
            <CardContent className="py-10 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : blocks.length ===
          0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground text-sm space-y-1">
              <p className="font-medium text-foreground/80">
                No schedule generated yet.
              </p>

              <p>
                Click &quot;Auto Schedule&quot; to generate a schedule from your unscheduled tasks.
              </p>
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

                    <TableHead className="text-xs w-24">
                      Duration
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {groupedBlocks.flatMap(
                    (
                      group
                    ) =>
                      group.items.map(
                        (
                          block,
                          index
                        ) => {
                          const isBreak =
                            block.kind ===
                            "break";

                          const start =
                            toMinutes(
                              block.start
                            );

                          const end =
                            toMinutes(
                              block.end
                            );

                          const duration =
                            Math.max(
                              0,
                              end -
                                start
                            );

                          return (
                            <TableRow
                              key={`${block.task_id}-${block.start}-${index}`}
                              className="text-sm"
                            >
                              <TableCell className="py-2 text-xs text-muted-foreground">
                                {
                                  group.dateLabel
                                }
                              </TableCell>

                              <TableCell className="py-2 font-mono text-xs">
                                {to12h(
                                  block.start
                                )}{" "}
                                –{" "}
                                {to12h(
                                  block.end
                                )}
                              </TableCell>

                              <TableCell className="py-2 font-medium max-w-[220px] truncate">
                                {
                                  block.title
                                }

                                {!isBreak && block.segment_total && block.segment_total > 1 && (
                                  <span className="ml-2 text-[10px] text-muted-foreground">
                                    (Part {block.segment_index}/{block.segment_total})
                                  </span>
                                )}

                                {isBreak && (
                                  <span className="ml-2 text-[10px] text-muted-foreground">
                                    (break)
                                  </span>
                                )}
                              </TableCell>

                              <TableCell className="py-2 text-xs">
                                {isBreak ? "—" : block.priority || "—"}
                              </TableCell>

                              <TableCell className="py-2 text-xs text-muted-foreground">
                                {duration >
                                0
                                  ? `${duration}m`
                                  : "—"}
                              </TableCell>
                            </TableRow>
                          );
                        }
                      )
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </section>

      {/* ===================================================
          SCHEDULING SUMMARY — ALL INPUT TASKS
          =================================================== */}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Scheduling Summary
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Every active task is shown, including tasks split across time slots or deferred.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {(payload?.task_summary || unscheduled).length} tasks
          </span>
        </div>

        <div className="rounded-lg border overflow-hidden">
          <div className="max-h-[420px] overflow-y-auto overflow-x-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs">Task</TableHead>
                  <TableHead className="text-xs w-24">Priority</TableHead>
                  <TableHead className="text-xs w-32">Deadline</TableHead>
                  <TableHead className="text-xs w-24">Duration</TableHead>
                  <TableHead className="text-xs w-28">Scheduled</TableHead>
                  <TableHead className="text-xs w-28">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(payload?.task_summary || unscheduled.map((t) => ({
                  task_id: t.id,
                  title: t.title,
                  duration: Number(t.estimated_duration) || 30,
                  scheduled_minutes: t.start_time ? Number(t.estimated_duration) || 30 : 0,
                  remaining_minutes: t.start_time ? 0 : Number(t.estimated_duration) || 30,
                  priority: t.priority_score,
                  priority_label: priorityFromScore(t.priority_score).replace(/^./, (c) => c.toUpperCase()) as "High" | "Medium" | "Low",
                  due_date: t.due_date,
                  overdue: !!t.due_date && new Date(t.due_date).getTime() < Date.now(),
                  status: t.start_time ? "scheduled" : "deferred",
                }))).map((item) => (
                  <TableRow key={item.task_id} className="text-sm">
                    <TableCell className="font-medium py-2 max-w-[240px] truncate">{item.title}</TableCell>
                    <TableCell className="py-2">
                      <Badge variant="outline" className="text-[10px]">{item.priority_label}</Badge>
                      {item.overdue && <span className="ml-1 text-[10px] text-destructive">Overdue</span>}
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">
                      {item.due_date ? format(new Date(item.due_date), "MMM d, yyyy h:mm a") : "—"}
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">{item.duration}m</TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">{item.scheduled_minutes}m</TableCell>
                    <TableCell className="py-2 text-xs">
                      {item.status === "scheduled" ? "Scheduled" : item.status === "partially_scheduled" ? `Partial · ${item.remaining_minutes}m left` : "Deferred"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>

      {/* ===================================================
          UNSCHEDULED TASKS
          =================================================== */}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Active Tasks
          </h2>

          {!loadingTasks &&
            unscheduled.length >
              0 && (
              <span className="text-xs text-muted-foreground">
                {
                  unscheduled.length
                }{" "}
                task
                {unscheduled.length !==
                1
                  ? "s"
                  : ""}
              </span>
            )}
        </div>

        {loadingTasks ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : unscheduled.length ===
          0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground text-sm">
              No active tasks available.
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <div className="max-h-[360px] overflow-y-auto overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-xs">
                      Task
                    </TableHead>

                    <TableHead className="text-xs w-24">
                      Priority
                    </TableHead>

                    <TableHead className="text-xs w-32">
                      Deadline
                    </TableHead>

                    <TableHead className="text-xs w-24">
                      Duration
                    </TableHead>

                    <TableHead className="text-xs w-28">
                      Status
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {unscheduled.map(
                    (task) => {
                      const priority =
                        priorityFromScore(
                          task.priority_score
                        );

                      const style =
                        PRIORITY_STYLES[
                          priority
                        ];

                      return (
                        <TableRow
                          key={
                            task.id
                          }
                          className="text-sm"
                        >
                          <TableCell className="font-medium py-2 max-w-[220px] truncate">
                            {
                              task.title
                            }
                          </TableCell>

                          <TableCell className="py-2">
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${style.className}`}
                            >
                              {
                                style.label
                              }
                            </Badge>
                          </TableCell>

                          <TableCell className="py-2 text-muted-foreground text-xs">
                            {task.due_date
                              ? format(
                                  new Date(
                                    task.due_date
                                  ),
                                  "MMM d, yyyy"
                                )
                              : "—"}
                          </TableCell>

                          <TableCell className="py-2 text-muted-foreground text-xs">
                            {task.estimated_duration
                              ? `${task.estimated_duration}m`
                              : "—"}
                          </TableCell>

                          <TableCell className="py-2">
                            <span className="text-xs capitalize">
                              {statusLabel(
                                task.status
                              )}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    }
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </section>

      {/* Confirm before regenerating an existing official schedule */}
      <AlertDialog open={confirmRegenOpen && !previewPayload} onOpenChange={setConfirmRegenOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Current schedule already exists</AlertDialogTitle>
            <AlertDialogDescription>
              Creating a new schedule may change task order and time assignments.
              Your current schedule will stay active until you apply a preview.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={keepCurrentSchedule}>
              Keep Current
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmPreviewNew}>
              Preview New Schedule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Apply preview */}
      <AlertDialog
        open={!!previewPayload}
        onOpenChange={(open) => {
          if (!open) keepCurrentSchedule();
        }}
      >
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Apply new schedule?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Review the candidate schedule. Applying replaces your current
                  official schedule.
                </p>
                {previewPayload && (
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      {
                        (previewPayload.blocks || []).filter(
                          (b: any) => b.kind !== "break",
                        ).length
                      }{" "}
                      task blocks
                    </li>
                    <li>
                      {Array.isArray((previewPayload as any).deferred)
                        ? (previewPayload as any).deferred.length
                        : 0}{" "}
                      deferred
                    </li>
                    {(previewPayload as any).window?.start && (
                      <li>
                        Window: {(previewPayload as any).window.start}–
                        {(previewPayload as any).window.end}
                        {(previewPayload as any).window?.overnight
                          ? " (overnight)"
                          : ""}
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={keepCurrentSchedule}>
              Keep Current
            </AlertDialogCancel>
            <AlertDialogAction onClick={applyPreviewSchedule}>
              Apply New Schedule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

/* =========================================================
   DEVELOPER PANEL
   ========================================================= */

export function ScheduleDevPanel({
  payload,
  title,
}: {
  payload: Payload;
  title?: string;
}) {
  return (
    <DevPanel
      title={
        title ||
        "Auto-scheduler internals — PSO ordering + CSP placement"
      }
      subtitle={`${payload.algorithm || "csp-pso"} · run at ${
        payload.timestamp
          ? new Date(
              payload.timestamp
            ).toLocaleString()
          : "—"
      }`}
      raw={payload}
    >
      <p className="text-[11px] text-muted-foreground">
        Step 1 — active, unfinished, non-archived tasks are prepared and missing priority scores are calculated from the same AHP inputs used by the system. Step 2 — tasks are grouped by strict priority: HIGH current, HIGH overdue, MEDIUM current, MEDIUM overdue, LOW current, LOW overdue; PSO optimizes the order inside each group. Step 3 — CSP uses every valid work period and can split long tasks around fixed breaks while preventing overlaps and respecting deadlines. All active tasks remain visible in the scheduling summary even when today's capacity is insufficient.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <DevStat
          label="Work window"
          value={
            payload.window
              ? `${to12h(
                  payload.window
                    .start
                )}–${to12h(
                  payload.window
                    .end
                )}`
              : "—"
          }
        />

        <DevStat
          label="Peak window"
          value={
            payload.window
              ? `${to12h(
                  payload.window
                    .peak_start
                )}–${to12h(
                  payload.window
                    .peak_end
                )}`
              : "—"
          }
        />

        <DevStat
          label="Break style"
          value={
            payload.window
              ?.break_style ||
            "—"
          }
        />

        <DevStat
          label="Best fitness"
          value={
            payload.pso
              ? payload.pso.fitness.toFixed(
                  2
                )
              : "—"
          }
        />

        <DevStat
          label="Swarm size"
          value={
            payload.pso
              ?.swarm_size ??
            "—"
          }
        />

        <DevStat
          label="Iterations"
          value={
            payload.pso
              ?.iterations ??
            "—"
          }
        />

        <DevStat
          label="Blocks placed"
          value={
            payload.blocks
              .length
          }
        />

        <DevStat
          label="Deferred"
          value={
            payload.deferred
              ?.length ??
            0
          }
        />
      </div>

      {payload.deferred &&
        payload.deferred.length >
          0 && (
          <div className="rounded-md border bg-background p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              Deferred — did not fit today's configured work window
            </p>

            <ul className="text-[11px] font-mono space-y-0.5 max-h-40 overflow-auto">
              {payload.deferred.map(
                (item) => (
                  <li
                    key={
                      item.task_id
                    }
                    className="truncate"
                  >
                    •{" "}
                    {
                      item.title
                    }
                  </li>
                )
              )}
            </ul>
          </div>
        )}

      {payload.note && (
        <p className="text-[11px] text-warning">
          {payload.note}
        </p>
      )}
    </DevPanel>
  );
}
