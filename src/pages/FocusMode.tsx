import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { motion } from "framer-motion";
import {
  Play,
  Pause,
  RotateCcw,
  Focus,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock3,
  ListTodo,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { formatPH } from "@/lib/date-utils";
import { priorityFromScore, PRIORITY_STYLES } from "@/lib/status";

type FocusTask = {
  id: string;
  title: string;
  description: string | null;
  estimated_duration: number | null;
  start_time: string | null;
  due_date: string | null;
  priority_score: number | null;
  difficulty: string | null;
  category: string | null;
  status: string;
  project_id: string | null;
  projects?: { name: string; color?: string | null } | null;
};

type SelectionSource = "recommended" | "manual";

function mmss(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;

  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/**
 * Focus block duration.
 * Uses the task's estimated duration.
 * Minimum = 5 minutes.
 * Maximum = 8 hours.
 */
function targetMinutes(task: FocusTask | null): number {
  if (!task) return 25;

  return Math.max(
    5,
    Math.min(480, Number(task.estimated_duration) || 25),
  );
}

const FOCUS_CATEGORY_IMPORTANCE: Record<string, number> = {
  "Client Communication": 0.95,
  "Customer Support": 0.95,
  "Email Management": 0.80,
  "Calendar & Scheduling": 0.85,
  "Administrative Tasks": 0.75,
  "Data Entry": 0.65,
  Research: 0.80,
  "Report & Documentation": 0.85,
  "File & Document Management": 0.65,
  "Project Coordination": 0.90,
  "Lead Generation": 0.85,
  "CRM Management": 0.80,
  "Social Media Management": 0.75,
  "Content Creation": 0.75,
  "E-commerce Support": 0.80,
  "Bookkeeping & Finance": 0.90,
  "Meeting & Coordination": 0.80,
  "Personal Assistance": 0.60,
  "General / Other": 0.50,
};

/**
 * Same fixed AHP weights used by the rank-priorities function.
 *
 * Deadline       = 54.621903%
 * Difficulty     = 23.230307%
 * Duration       = 13.772461%
 * Category       =  8.375329%
 */
function focusScore(t: FocusTask): number {
  const stored = Number(t.priority_score);

  if (Number.isFinite(stored) && stored > 0) {
    return stored;
  }

  const dueHours = t.due_date
    ? (new Date(t.due_date).getTime() - Date.now()) / 3_600_000
    : Infinity;

  const deadline =
    dueHours < 0
      ? 1
      : dueHours < 24
        ? 0.9
        : dueHours < 72
          ? 0.7
          : dueHours < 168
            ? 0.45
            : dueHours < 336
              ? 0.25
              : 0.1;

  const d = String(t.difficulty || "medium").toLowerCase();

  const difficulty =
    d === "hard"
      ? 1
      : d === "easy"
        ? 0.3
        : 0.6;

  const minutes = Number(t.estimated_duration) || 30;

  const duration =
    minutes <= 15
      ? 1
      : minutes <= 30
        ? 0.8
        : minutes <= 60
          ? 0.6
          : minutes <= 120
            ? 0.4
            : 0.2;

  const category =
    FOCUS_CATEGORY_IMPORTANCE[t.category || "General / Other"] ?? 0.5;

  return (
    deadline * 0.54621903 +
    difficulty * 0.23230307 +
    duration * 0.13772461 +
    category * 0.08375329
  ) * 100;
}

function priorityTier(score: number): number {
  if (score >= 65) return 3;
  if (score >= 40) return 2;
  return 1;
}

function priorityLabel(score: number): string {
  if (score >= 65) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

function isOverdue(task: FocusTask): boolean {
  return !!task.due_date && new Date(task.due_date).getTime() < Date.now();
}

function durationMinutes(task: FocusTask): number {
  return Math.max(5, Number(task.estimated_duration) || 25);
}

function remainingDeadlineHours(task: FocusTask): number {
  if (!task.due_date) return Infinity;

  return (
    (new Date(task.due_date).getTime() - Date.now()) /
    3_600_000
  );
}

function deadlineRisk(task: FocusTask): boolean {
  if (!task.due_date) return false;

  const remainingHours = remainingDeadlineHours(task);
  const requiredHours = durationMinutes(task) / 60;

  return remainingHours >= 0 && remainingHours <= requiredHours + 2;
}

/**
 * Returns the reason why Focus Mode selected the recommended task.
 */
function getRecommendationReason(
  task: FocusTask,
  allTasks: FocusTask[],
): string {
  const score = focusScore(task);
  const tier = priorityTier(score);

  if (isOverdue(task) && tier === 3) {
    if (durationMinutes(task) <= 60) {
      return "This task is HIGH priority, overdue, and can be handled within a short focus session.";
    }

    return "This task is HIGH priority and overdue, so it requires immediate attention.";
  }

  if (deadlineRisk(task)) {
    return "This task is close to its deadline and its estimated work time may put the deadline at risk.";
  }

  if (task.due_date) {
    const hours = remainingDeadlineHours(task);

    if (hours <= 24) {
      return "This task has HIGH priority and its deadline is within 24 hours.";
    }

    if (hours <= 72) {
      return "This task has a close deadline and needs attention before the deadline becomes critical.";
    }
  }

  if (tier === 3) {
    return "This task has the highest priority tier among the available tasks.";
  }

  if (tier === 2) {
    return "No qualifying HIGH-priority task requires immediate focus, so this MEDIUM-priority task is the next urgent task.";
  }

  if (allTasks.length === 1) {
    return "This is currently the only unfinished task available for Focus Mode.";
  }

  return "No higher-priority task currently requires immediate attention, so this task is selected by deadline urgency and priority.";
}

/**
 * Focus Mode decision rule.
 *
 * 1. Find HIGH overdue tasks.
 * 2. Find the most urgent upcoming HIGH task.
 * 3. A short HIGH overdue task (<= 60 min) can be handled first
 *    only when the upcoming HIGH task still has enough deadline room.
 * 4. If the upcoming HIGH task is at risk, protect it first.
 * 5. If no HIGH task qualifies, use MEDIUM/LOW based on urgency,
 *    priority score, and duration.
 *
 * Important:
 * Once a session starts, this function is NOT called again
 * to replace the active task.
 */
function pickFocusTask(rows: FocusTask[]): FocusTask | null {
  if (!rows.length) return null;

  const tier = (t: FocusTask) => priorityTier(focusScore(t));

  const highTasks = rows.filter((t) => tier(t) === 3);

  const highOverdue = highTasks
    .filter(isOverdue)
    .sort((a, b) => {
      const aRisk = deadlineRisk(a) ? 1 : 0;
      const bRisk = deadlineRisk(b) ? 1 : 0;

      if (aRisk !== bRisk) return bRisk - aRisk;

      const scoreDiff = focusScore(b) - focusScore(a);

      if (scoreDiff !== 0) return scoreDiff;

      return durationMinutes(a) - durationMinutes(b);
    });

  const highCurrent = highTasks
    .filter((t) => !isOverdue(t))
    .sort((a, b) => {
      const aRisk = deadlineRisk(a) ? 1 : 0;
      const bRisk = deadlineRisk(b) ? 1 : 0;

      if (aRisk !== bRisk) return bRisk - aRisk;

      const ad = a.due_date
        ? new Date(a.due_date).getTime()
        : Infinity;

      const bd = b.due_date
        ? new Date(b.due_date).getTime()
        : Infinity;

      if (ad !== bd) return ad - bd;

      return focusScore(b) - focusScore(a);
    });

  const urgentUpcomingHigh = highCurrent[0];

  /*
   * HIGH overdue handling.
   */
  for (const overdueHigh of highOverdue) {
    const shortEnough = durationMinutes(overdueHigh) <= 60;

    if (!shortEnough) continue;

    if (!urgentUpcomingHigh) {
      return overdueHigh;
    }

    if (deadlineRisk(urgentUpcomingHigh)) {
      return urgentUpcomingHigh;
    }

    const remainingHours =
      remainingDeadlineHours(urgentUpcomingHigh);

    const requiredHours =
      durationMinutes(urgentUpcomingHigh) / 60 + 24;

    if (
      remainingHours === Infinity ||
      remainingHours >= requiredHours
    ) {
      return overdueHigh;
    }
  }

  /*
   * If an upcoming HIGH task is at deadline risk,
   * protect it before lower-risk overdue work.
   */
  if (urgentUpcomingHigh) {
    return urgentUpcomingHigh;
  }

  /*
   * General fallback.
   *
   * Priority tier first.
   * Then deadline urgency.
   * Then overdue status.
   * Then shorter task.
   * Then higher score.
   */
  return [...rows].sort((a, b) => {
    const tierDiff =
      priorityTier(focusScore(b)) -
      priorityTier(focusScore(a));

    if (tierDiff !== 0) return tierDiff;

    const aDeadline = a.due_date
      ? new Date(a.due_date).getTime()
      : Infinity;

    const bDeadline = b.due_date
      ? new Date(b.due_date).getTime()
      : Infinity;

    if (aDeadline !== bDeadline) {
      return aDeadline - bDeadline;
    }

    const overdueDiff =
      Number(isOverdue(b)) - Number(isOverdue(a));

    if (overdueDiff !== 0) return overdueDiff;

    const durationDiff =
      durationMinutes(a) - durationMinutes(b);

    if (durationDiff !== 0) return durationDiff;

    return focusScore(b) - focusScore(a);
  })[0];
}

export default function FocusMode() {
  const [tasks, setTasks] = useState<FocusTask[]>([]);
  const [focusTask, setFocusTask] = useState<FocusTask | null>(null);
  const [selectionSource, setSelectionSource] =
    useState<SelectionSource>("recommended");

  const [loading, setLoading] = useState(true);

  const [totalSeconds, setTotalSeconds] = useState(25 * 60);
  const [remaining, setRemaining] = useState(25 * 60);

  const [running, setRunning] = useState(false);

  const [entryId, setEntryId] =
    useState<string | null>(null);

  const [sessionStartIso, setSessionStartIso] =
    useState<string | null>(null);

  const [manualTaskId, setManualTaskId] =
    useState<string>("");

  const finishedRef = useRef(false);

  const tickRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  const activeSession = !!entryId || running;

  const fetchTasks = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      return [];
    }

    const { data, error } = await supabase
      .from("tasks")
      .select(
        "id, title, description, estimated_duration, start_time, due_date, priority_score, difficulty, category, status, project_id, projects(name, color)",
      )
      .eq("user_id", user.id)
      .or("archived.eq.false,archived.is.null")
      .neq("status", "done");

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return [];
    }

    const rows = (data || []) as FocusTask[];

    setTasks(rows);

    return rows;
  }, []);

  /*
   * Initial task recommendation.
   */
  useEffect(() => {
    const load = async () => {
      const rows = await fetchTasks();

      const chosen = pickFocusTask(rows);

      setFocusTask(chosen);
      setSelectionSource("recommended");

      if (chosen) {
        const secs = targetMinutes(chosen) * 60;

        setTotalSeconds(secs);
        setRemaining(secs);
      }

      setLoading(false);
    };

    void load();
  }, [fetchTasks]);

  /*
   * Restore an open time entry.
   *
   * This is important when the user navigates away from Focus Mode
   * while a focus session is still running.
   */
  useEffect(() => {
    const restore = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const { data: open } = await supabase
        .from("time_entries")
        .select(
          "id, task_id, start_time, duration",
        )
        .eq("user_id", user.id)
        .is("end_time", null)
        .order("start_time", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!open?.start_time) return;

      let task =
        tasks.find((t) => t.id === open.task_id) ||
        focusTask;

      if (!task || task.id !== open.task_id) {
        const { data: t } = await supabase
          .from("tasks")
          .select(
            "id, title, description, estimated_duration, start_time, due_date, priority_score, difficulty, category, status, project_id, projects(name, color)",
          )
          .eq("id", open.task_id)
          .eq("user_id", user.id)
          .maybeSingle();

        if (t) {
          task = t as FocusTask;
          setFocusTask(task);
        }
      }

      if (!task) return;

      const mins = targetMinutes(task);
      const total = mins * 60;

      setTotalSeconds(total);
      setEntryId(open.id);
      setSessionStartIso(open.start_time);

      const started =
        new Date(open.start_time).getTime();

      const elapsed = Math.max(
        0,
        Math.floor(
          (Date.now() - started) / 1000,
        ),
      );

      const left = Math.max(
        0,
        total - elapsed,
      );

      setRemaining(left);

      if (left > 0) {
        setRunning(true);
      }
    };

    void restore();

    // The initial tasks are intentionally used as a snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const closeEntry = useCallback(
    async (elapsedSeconds: number) => {
      if (!entryId) return;

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const durationMin = Math.max(
        1,
        Math.round(elapsedSeconds / 60),
      );

      await supabase
        .from("time_entries")
        .update({
          end_time: new Date().toISOString(),
          duration: durationMin,
        })
        .eq("id", entryId)
        .eq("user_id", user.id);

      setEntryId(null);
      setSessionStartIso(null);
    },
    [entryId],
  );

  /*
   * Timer is based on the actual start timestamp.
   *
   * This means navigating away from the page does not reset
   * the countdown.
   */
  useEffect(() => {
    clearTick();

    if (!running || !sessionStartIso) {
      return;
    }

    tickRef.current = setInterval(() => {
      const started =
        new Date(sessionStartIso).getTime();

      const elapsed = Math.max(
        0,
        Math.floor(
          (Date.now() - started) / 1000,
        ),
      );

      const left = Math.max(
        0,
        totalSeconds - elapsed,
      );

      setRemaining(left);

      if (
        left <= 0 &&
        !finishedRef.current
      ) {
        finishedRef.current = true;

        setRunning(false);
        clearTick();

        void (async () => {
          await closeEntry(totalSeconds);

          toast.message(
            "Focus block finished. Remaining work can be rescheduled in Adaptive Scheduling.",
          );
        })();
      }
    }, 500);

    return clearTick;
  }, [
    running,
    sessionStartIso,
    totalSeconds,
    closeEntry,
    clearTick,
  ]);

  /*
   * Select a different task.
   *
   * This is intentionally blocked while running.
   */
  const selectTask = (taskId: string) => {
    if (activeSession) {
      toast.warning(
        "Pause or finish the current focus session before switching tasks.",
      );
      return;
    }

    const selected = tasks.find(
      (t) => t.id === taskId,
    );

    if (!selected) return;

    setFocusTask(selected);
    setSelectionSource("manual");

    const secs =
      targetMinutes(selected) * 60;

    setTotalSeconds(secs);
    setRemaining(secs);

    setManualTaskId(taskId);

    toast.message(
      `"${selected.title}" selected for Focus Mode.`,
    );
  };

  /*
   * Return to the system recommendation.
   */
  const useRecommendation = () => {
    if (activeSession) {
      toast.warning(
        "Pause or finish the current focus session before changing tasks.",
      );
      return;
    }

    const recommended =
      pickFocusTask(tasks);

    if (!recommended) {
      toast.info(
        "There are no unfinished tasks available.",
      );
      return;
    }

    setFocusTask(recommended);
    setSelectionSource("recommended");

    const secs =
      targetMinutes(recommended) * 60;

    setTotalSeconds(secs);
    setRemaining(secs);

    setManualTaskId(recommended.id);

    toast.message(
      "System recommendation restored.",
    );
  };

  const startOrResume = async () => {
    if (!focusTask || remaining <= 0) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      toast.error("Not logged in");
      return;
    }

    /*
     * Resume the same task.
     */
    if (entryId && sessionStartIso) {
      setRunning(true);
      finishedRef.current = false;
      return;
    }

    /*
     * Close any other open entry for this user.
     *
     * This prevents duplicate active timers.
     */
    const { data: opens } = await supabase
      .from("time_entries")
      .select("id")
      .eq("user_id", user.id)
      .is("end_time", null);

    for (const o of opens || []) {
      await supabase
        .from("time_entries")
        .update({
          end_time: new Date().toISOString(),
          duration: 0,
        })
        .eq("id", o.id)
        .eq("user_id", user.id);
    }

    const startIso =
      new Date().toISOString();

    const { data: created, error } =
      await supabase
        .from("time_entries")
        .insert({
          user_id: user.id,
          task_id: focusTask.id,
          start_time: startIso,
          duration: 0,
        })
        .select("id")
        .single();

    if (error || !created) {
      toast.error(
        error?.message ||
          "Could not start focus session",
      );
      return;
    }

    setEntryId(created.id);
    setSessionStartIso(startIso);
    setRunning(true);

    finishedRef.current = false;
  };

  const pause = async () => {
    if (!running || !sessionStartIso) {
      return;
    }

    setRunning(false);
    clearTick();

    const started =
      new Date(sessionStartIso).getTime();

    const elapsed = Math.max(
      0,
      Math.floor(
        (Date.now() - started) / 1000,
      ),
    );

    setRemaining(
      Math.max(
        0,
        totalSeconds - elapsed,
      ),
    );

    await closeEntry(elapsed);

    toast.message(
      "Focus session paused. Your recorded work time was saved.",
    );
  };

  const reset = async () => {
    setRunning(false);
    clearTick();

    finishedRef.current = false;

    const secs =
      targetMinutes(focusTask) * 60;

    setTotalSeconds(secs);
    setRemaining(secs);

    if (entryId && sessionStartIso) {
      const started =
        new Date(sessionStartIso).getTime();

      const elapsed = Math.max(
        0,
        Math.floor(
          (Date.now() - started) / 1000,
        ),
      );

      await closeEntry(elapsed);
    }

    toast.message(
      "Timer reset. Previously recorded focus time was kept.",
    );
  };

  const markTaskDone = async () => {
    if (!focusTask) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    if (running && sessionStartIso) {
      const started =
        new Date(sessionStartIso).getTime();

      const elapsed = Math.max(
        0,
        Math.floor(
          (Date.now() - started) / 1000,
        ),
      );

      setRunning(false);

      await closeEntry(elapsed);
    }

    const { error } = await supabase
      .from("tasks")
      .update({
        status: "done",
        completed_at:
          new Date().toISOString(),
      })
      .eq("id", focusTask.id)
      .eq("user_id", user.id);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(
      "Task marked complete.",
    );

    const completedId =
      focusTask.id;

    const remainingTasks =
      tasks.filter(
        (task) =>
          task.id !== completedId,
      );

    setTasks(remainingTasks);

    /*
     * Automatically recommend the next task
     * after completion.
     */
    const next =
      pickFocusTask(remainingTasks);

    setFocusTask(next);
    setSelectionSource("recommended");

    if (next) {
      const secs =
        targetMinutes(next) * 60;

      setTotalSeconds(secs);
      setRemaining(secs);
      setManualTaskId(next.id);
    } else {
      setTotalSeconds(0);
      setRemaining(0);
      setManualTaskId("");
    }
  };

  const recommendationReason = useMemo(() => {
    if (!focusTask) return "";

    return getRecommendationReason(
      focusTask,
      tasks,
    );
  }, [focusTask, tasks]);

  const score = focusTask
    ? focusScore(focusTask)
    : 0;

  const pr =
    focusTask
      ? priorityLabel(score)
      : null;

  const prStyle =
    focusTask
      ? PRIORITY_STYLES[
          priorityFromScore(score)
        ]
      : null;

  const projectName =
    focusTask?.projects?.name ||
    null;

  const blockMin =
    Math.round(totalSeconds / 60);

  const pct =
    totalSeconds > 0
      ? ((totalSeconds - remaining) /
          totalSeconds) *
        100
      : 0;

  const overdue =
    focusTask
      ? isOverdue(focusTask)
      : false;

  const risk =
    focusTask
      ? deadlineRisk(focusTask)
      : false;

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

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
      className="mx-auto max-w-2xl space-y-4"
    >
      <div className="text-center space-y-1">
        <h1 className="font-display text-3xl font-bold">
          Focus Mode
        </h1>

        <p className="text-sm text-muted-foreground">
          One task. Full attention. Track real work time.
        </p>
      </div>

      {focusTask && (
        <Card className="border-border/80 shadow-sm">
          <CardContent className="pt-6 pb-4 px-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Focus className="h-4 w-4 text-primary" />

                  <span className="text-sm font-semibold">
                    {selectionSource ===
                    "recommended"
                      ? "System Recommendation"
                      : "Your Selected Task"}
                  </span>
                </div>

                {selectionSource ===
                  "manual" && (
                  <Badge
                    variant="secondary"
                    className="text-xs"
                  >
                    Manually selected
                  </Badge>
                )}
              </div>

              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="flex gap-3">
                  {overdue ? (
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                  ) : risk ? (
                    <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                  ) : (
                    <Focus className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  )}

                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      Why this task?
                    </p>

                    <p className="text-sm text-muted-foreground">
                      {recommendationReason}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Focus task
                  </label>

                  <Select
                    value={
                      manualTaskId ||
                      focusTask.id
                    }
                    onValueChange={
                      selectTask
                    }
                    disabled={activeSession}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a task" />
                    </SelectTrigger>

                    <SelectContent>
                      {tasks.map((task) => {
                        const taskScore =
                          focusScore(task);

                        const taskPriority =
                          priorityLabel(
                            taskScore,
                          );

                        return (
                          <SelectItem
                            key={task.id}
                            value={task.id}
                          >
                            <div className="flex items-center gap-2">
                              <span className="truncate">
                                {task.title}
                              </span>

                              <span className="text-xs text-muted-foreground">
                                {taskPriority}
                              </span>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>

                  {activeSession && (
                    <p className="text-xs text-muted-foreground">
                      Pause or finish the session before switching tasks.
                    </p>
                  )}
                </div>

                {selectionSource ===
                  "manual" && (
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={
                        useRecommendation
                      }
                      disabled={
                        activeSession
                      }
                    >
                      <ArrowRight className="mr-2 h-4 w-4" />
                      Use Recommendation
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/80 shadow-sm">
        <CardContent className="pt-10 pb-8 px-6 space-y-6">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Focus className="h-7 w-7" />
            </div>

            <h2 className="font-display text-2xl font-semibold leading-tight max-w-md">
              {focusTask?.title ||
                "No active task"}
            </h2>

            {focusTask?.description ? (
              <p className="text-sm text-muted-foreground max-w-md line-clamp-3">
                {focusTask.description}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground/70">
                {focusTask
                  ? "No description"
                  : "Create or schedule a task to begin focusing."}
              </p>
            )}
          </div>

          {focusTask && (
            <div className="flex flex-wrap justify-center gap-2">
              {projectName && (
                <Badge
                  variant="secondary"
                  className="text-xs"
                >
                  {projectName}
                </Badge>
              )}

              {prStyle && (
                <Badge
                  variant="outline"
                  className={`text-xs capitalize ${prStyle.className}`}
                >
                  {prStyle.label}
                </Badge>
              )}

              <Badge
                variant="outline"
                className="text-xs"
              >
                {targetMinutes(
                  focusTask,
                )}{" "}
                min
              </Badge>

              {overdue && (
                <Badge
                  variant="destructive"
                  className="text-xs"
                >
                  Overdue
                </Badge>
              )}
            </div>
          )}

          <div className="text-center space-y-3">
            <p className="font-display text-6xl sm:text-7xl font-bold tabular-nums tracking-tight text-foreground">
              {mmss(remaining)}
            </p>

            <div className="mx-auto h-1.5 w-full max-w-xs rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{
                  width: `${Math.min(
                    100,
                    pct,
                  )}%`,
                }}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              {blockMin}-minute focus block ·{" "}
              {remaining === 0
                ? "finished"
                : running
                  ? "running"
                  : entryId
                    ? "paused"
                    : "ready"}
            </p>
          </div>

          <div className="flex justify-center gap-3">
            <Button
              size="lg"
              variant={
                running
                  ? "secondary"
                  : "default"
              }
              onClick={() =>
                running
                  ? pause()
                  : startOrResume()
              }
              disabled={
                remaining === 0 ||
                !focusTask
              }
              className="min-w-[120px]"
            >
              {running ? (
                <>
                  <Pause className="mr-2 h-4 w-4" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  {entryId
                    ? "Resume"
                    : "Start Focus"}
                </>
              )}
            </Button>

            <Button
              size="lg"
              variant="outline"
              onClick={() =>
                void reset()
              }
              disabled={!focusTask}
              className="min-w-[120px]"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset
            </Button>
          </div>

          {focusTask && (
            <div className="space-y-3 pt-2 border-t border-border/60">
              {focusTask.due_date && (
                <p className="text-center text-xs text-muted-foreground">
                  Deadline{" "}
                  {formatPH(
                    focusTask.due_date,
                    "MMM d, yyyy · h:mm a",
                  )}
                </p>
              )}

              <div className="flex justify-center pt-1">
                <Button
                  variant="secondary"
                  onClick={() =>
                    void markTaskDone()
                  }
                  className="min-w-[180px]"
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Mark Complete
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {!focusTask && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center">
            <ListTodo className="mx-auto h-8 w-8 text-muted-foreground mb-3" />

            <h2 className="font-semibold">
              No unfinished tasks
            </h2>

            <p className="text-sm text-muted-foreground mt-1">
              Create a task or finish your current work before starting another focus session.
            </p>
          </CardContent>
        </Card>
      )}

      {focusTask && (
        <p className="text-center text-xs text-muted-foreground px-4">
          Focus Mode recommends a task using priority,
          deadline urgency, overdue status, remaining
          deadline time, and estimated duration. You can
          choose another task when the focus session is
          not running.
        </p>
      )}
    </motion.div>
  );
}
