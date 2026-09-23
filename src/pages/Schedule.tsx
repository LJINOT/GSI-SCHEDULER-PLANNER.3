import {
  useState,
  useEffect,
  useMemo,
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
};

type DeferredTask = {
  task_id: string;
  title: string;
  duration?: number;
  priority?: number | null;
  status?: string;
};

type Payload = {
  blocks: ScheduleBlock[];

  deferred?: DeferredTask[];

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

  const seenTaskIds =
    new Set<string>();

  for (const block of sorted) {
    const start =
      toMinutes(
        block.start
      );

    const end =
      toMinutes(
        block.end
      );

    if (
      end <= start
    ) {
      continue;
    }

    /*
     * A task can only appear once.
     *
     * Breaks are also uniquely identified by
     * their task_id.
     */
    if (
      block.kind ===
      "task"
    ) {
      if (
        seenTaskIds.has(
          block.task_id
        )
      ) {
        continue;
      }

      seenTaskIds.add(
        block.task_id
      );
    }

    const previous =
      result.length > 0
        ? result[
            result.length - 1
          ]
        : null;

    if (previous) {
      const previousEnd =
        toMinutes(
          previous.end
        );

      /*
       * Never show an overlapping block.
       */
      if (
        start <
        previousEnd
      ) {
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
          .eq(
            "archived",
            false
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
       * Only tasks with no start_time are
       * genuinely unscheduled.
       *
       * Do NOT fall back to all rows when
       * noStart is empty.
       */
      setUnscheduled(
        rows.filter(
          (task) =>
            !task.start_time
        )
      );

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

        const rawTimeline =
          Array.isArray(
            row.timeline
          )
            ? row.timeline
            : [];

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
              "saved-generated-schedule",
            timestamp:
              row.created_at ||
              new Date().toISOString(),
            window: {
              start:
                "—",
              end:
                "—",
              peak_start:
                "—",
              peak_end:
                "—",
              break_style:
                "—",
              schedule_date:
                today,
            },
          };
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
          .eq(
            "archived",
            false
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

  const generateSchedule =
    async () => {
      if (
        unscheduled.length ===
        0
      ) {
        /*
         * Do not prevent regeneration if an existing
         * schedule is present. Auto Schedule can be
         * used to regenerate the current schedule.
         */
      }

      setGenerating(
        true
      );

      setJustCreated(
        false
      );

      try {
        const scheduleDate =
          getLocalDateString();

        const {
          data,
          error,
        } =
          await supabase.functions.invoke(
            "generate-schedule",
            {
              body: {
                schedule_date:
                  scheduleDate,
              },
            }
          );

        if (error) {
          throw error;
        }

        const body =
          typeof data ===
          "string"
            ? JSON.parse(data)
            : data || {};

        if (
          body.error
        ) {
          throw new Error(
            body.error
          );
        }

        /*
         * IMPORTANT:
         *
         * The returned blocks are the
         * authoritative result.
         *
         * We DO NOT reconstruct the schedule
         * from tasks.start_time afterward.
         */
        const rawBlocks =
          Array.isArray(
            body.blocks
          )
            ? body.blocks
            : [];

        const safeBlocks =
          normalizeBlocks(
            rawBlocks
          );

        const next: Payload =
          {
            ...body,
            blocks:
              safeBlocks,
            algorithm:
              body.algorithm ||
              "csp-pso",
            timestamp:
              body.timestamp ||
              new Date().toISOString(),
          };

        setPayload(
          next
        );

        saveCache(
          CACHE_KEY,
          next
        );

        setJustCreated(
          safeBlocks.length >
            0
        );

        /*
         * Refresh the actual unscheduled
         * tasks after the backend persisted
         * the schedule.
         */
        await fetchUnscheduled();

        if (
          safeBlocks.length ===
          0
        ) {
          toast.error(
            body.note ||
              "No schedule slots could be generated. Check your work hours or task durations."
          );
        } else {
          toast.success(
            "Schedule created successfully."
          );
        }
      } catch (error: any) {
        console.error(
          "Schedule generation failed:",
          error
        );

        toast.error(
          error?.message ||
            "Failed to generate schedule"
        );
      } finally {
        setGenerating(
          false
        );
      }
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
            Create an optimized schedule from your unscheduled tasks.
          </p>
        </div>

        <Button
          onClick={
            generateSchedule
          }
          disabled={
            generating ||
            loadingTasks
          }
        >
          {generating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Wand2 className="mr-2 h-4 w-4" />
          )}

          Auto Schedule
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

                                {isBreak && (
                                  <span className="ml-2 text-[10px] text-muted-foreground">
                                    (break)
                                  </span>
                                )}
                              </TableCell>

                              <TableCell className="py-2 text-xs text-muted-foreground">
                                —
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
          UNSCHEDULED TASKS
          =================================================== */}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Unscheduled Tasks
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
              No unscheduled tasks available.
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
        Step 1 — active, unfinished, non-archived tasks are prepared and duplicate task IDs are removed. Step 2 — PSO searches task orderings using random-key encoding with 25 particles and 60 iterations. The fitness function penalizes tasks that cannot fit, hard tasks outside the peak window, easy tasks inside the peak window, later placement, missed deadlines, and category switching. Step 3 — CSP places the winning PSO order sequentially inside the configured work window while respecting the selected Break Style and preventing overlapping blocks.
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
