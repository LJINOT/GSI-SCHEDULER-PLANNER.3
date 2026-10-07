import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import {
  Play,
  Pause,
  RotateCcw,
  Focus,
  Loader2,
  CheckCircle2,
  Brain,
  AlertTriangle,
  Clock,
  Lock,
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
  projects?: {
    name: string;
    color?: string | null;
  } | null;
};

function mmss(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;

  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/**
 * Focus block duration.
 * Uses the task's estimated duration with a safe range.
 */
function targetMinutes(task: FocusTask | null): number {
  if (!task) return 25;

  return Math.max(
    5,
    Math.min(480, Number(task.estimated_duration) || 25),
  );
}

/**
 * Same category importance values used by the Focus/AHP fallback.
 */
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
 * Calculates the Focus Mode score.
 *
 * If the task already has an AHP priority_score,
 * the stored value is used.
 *
 * Otherwise, the same AHP fallback criteria are calculated:
 * - Deadline
 * - Difficulty
 * - Duration
 * - Category importance
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

  const difficultyValue = String(
    t.difficulty || "medium",
  ).toLowerCase();

  const difficulty =
    difficultyValue === "hard"
      ? 1
      : difficultyValue === "easy"
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

  // Same fixed AHP weights used by the system.
  return (
    deadline * 0.54621903 +
    difficulty * 0.23230307 +
    duration * 0.13772461 +
    category * 0.08375329
  ) * 100;
}

function priorityTier(task: FocusTask): number {
  const score = focusScore(task);

  if (score >= 65) return 3; // HIGH
  if (score >= 40) return 2; // MEDIUM
  return 1; // LOW
}

function isOverdue(task: FocusTask): boolean {
  return (
    !!task.due_date &&
    new Date(task.due_date).getTime() < Date.now()
  );
}

function isDeadlineRisk(task: FocusTask): boolean {
  if (!task.due_date || isOverdue(task)) return false;

  const hours =
    (new Date(task.due_date).getTime() - Date.now()) /
    3_600_000;

  return hours <= 24;
}

function durationMinutes(task: FocusTask): number {
  return Math.max(
    5,
    Number(task.estimated_duration) || 25,
  );
}

/**
 * Determines which task Focus Mode recommends.
 *
 * Decision hierarchy:
 *
 * 1. HIGH overdue task with short/reasonable duration
 * 2. Protect an urgent upcoming HIGH task if its deadline is close
 * 3. HIGH overdue task if there is no immediate upcoming HIGH risk
 * 4. Remaining HIGH tasks
 * 5. MEDIUM tasks by urgency
 * 6. LOW tasks by urgency
 */
function pickFocusTask(rows: FocusTask[]): FocusTask | null {
  if (!rows.length) return null;

  const score = (task: FocusTask) => focusScore(task);

  const highTasks = rows.filter(
    (task) => priorityTier(task) === 3,
  );

  const highOverdue = highTasks
    .filter(isOverdue)
    .sort((a, b) => {
      const durationDifference =
        durationMinutes(a) - durationMinutes(b);

      if (durationDifference !== 0) {
        return durationDifference;
      }

      return score(b) - score(a);
    });

  const highUpcoming = highTasks
    .filter((task) => !isOverdue(task))
    .sort((a, b) => {
      const ad = a.due_date
        ? new Date(a.due_date).getTime()
        : Infinity;

      const bd = b.due_date
        ? new Date(b.due_date).getTime()
        : Infinity;

      if (ad !== bd) return ad - bd;

      return score(b) - score(a);
    });

  const urgentUpcomingHigh = highUpcoming[0];
  const shortOverdueHigh = highOverdue.find(
    (task) => durationMinutes(task) <= 60,
  );

  /*
   * If an overdue HIGH task is reasonably short,
   * allow it to be completed before an upcoming HIGH task
   * only when the upcoming HIGH task still has enough time.
   */
  if (shortOverdueHigh) {
    const upcomingHasEnoughRoom =
      !urgentUpcomingHigh ||
      !urgentUpcomingHigh.due_date ||
      (() => {
        const remainingHours =
          (new Date(
            urgentUpcomingHigh.due_date,
          ).getTime() - Date.now()) /
          3_600_000;

        const requiredHours =
          durationMinutes(urgentUpcomingHigh) / 60 + 24;

        return remainingHours >= requiredHours;
      })();

    if (upcomingHasEnoughRoom) {
      return shortOverdueHigh;
    }
  }

  /*
   * If an upcoming HIGH task is near its deadline,
   * protect it first.
   */
  if (
    urgentUpcomingHigh &&
    isDeadlineRisk(urgentUpcomingHigh)
  ) {
    return urgentUpcomingHigh;
  }

  /*
   * If there are no immediate HIGH deadline risks,
   * handle remaining HIGH overdue work.
   */
  if (highOverdue.length) {
    return highOverdue[0];
  }

  /*
   * Normal fallback.
   *
   * Priority tier first,
   * then overdue,
   * then deadline,
   * then score.
   */
  return [...rows].sort((a, b) => {
    const tierDifference =
      priorityTier(b) - priorityTier(a);

    if (tierDifference !== 0) {
      return tierDifference;
    }

    const overdueDifference =
      Number(isOverdue(b)) - Number(isOverdue(a));

    if (overdueDifference !== 0) {
      return overdueDifference;
    }

    const ad = a.due_date
      ? new Date(a.due_date).getTime()
      : Infinity;

    const bd = b.due_date
      ? new Date(b.due_date).getTime()
      : Infinity;

    if (ad !== bd) {
      return ad - bd;
    }

    return score(b) - score(a);
  })[0];
}

function getFocusReason(task: FocusTask | null): string {
  if (!task) {
    return "No unfinished task is currently available.";
  }

  const tier = priorityTier(task);

  if (isOverdue(task) && tier === 3) {
    return "This HIGH-priority task is overdue, so Focus Mode is prioritizing it to reduce deadline risk.";
  }

  if (isDeadlineRisk(task) && tier === 3) {
    return "This HIGH-priority task is approaching its deadline, so it is being protected from further delay.";
  }

  if (isOverdue(task)) {
    return `This ${tier === 2 ? "MEDIUM" : "LOW"}-priority task is overdue and is the next available urgent task.`;
  }

  if (tier === 3) {
    return "This HIGH-priority task has the strongest current deadline and priority conditions.";
  }

  if (tier === 2) {
    return "No qualifying HIGH-priority task requires immediate focus, so this MEDIUM-priority task is the next urgent task.";
  }

  return "No higher-priority task currently requires immediate focus, so this task is the next available task based on urgency.";
}

const TASK_SELECT =
  "id, title, description, estimated_duration, start_time, due_date, priority_score, difficulty, category, status, project_id, projects(name, color)";

export default function FocusMode() {
  const [tasks, setTasks] = useState<FocusTask[]>([]);

  const [systemRecommendation, setSystemRecommendation] =
    useState<FocusTask | null>(null);

  const [focusTask, setFocusTask] =
    useState<FocusTask | null>(null);

  const [manualSelection, setManualSelection] =
    useState(false);

  const [loading, setLoading] = useState(true);

  const [totalSeconds, setTotalSeconds] =
    useState(25 * 60);

  const [remaining, setRemaining] =
    useState(25 * 60);

  const [running, setRunning] =
    useState(false);

  const [entryId, setEntryId] =
    useState<string | null>(null);

  const [sessionStartIso, setSessionStartIso] =
    useState<string | null>(null);

  const finishedRef = useRef(false);

  const tickRef =
    useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Clear timer interval.
   */
  const clearTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  /**
   * Load all unfinished tasks and select recommendation.
   */
  const loadTasks = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("user_id", user.id)
      .or("archived.eq.false,archived.is.null")
      .neq("status", "done");

    if (error) {
      console.error(error);
      toast.error("Could not load Focus Mode tasks.");
      setLoading(false);
      return;
    }

    const rows = (data || []) as FocusTask[];

    setTasks(rows);

    const recommendation = pickFocusTask(rows);

    setSystemRecommendation(recommendation);

    /*
     * Do not replace the current task when the user is manually
     * selecting a task.
     */
    if (!manualSelection) {
      setFocusTask(recommendation);

      if (recommendation) {
        const seconds =
          targetMinutes(recommendation) * 60;

        setTotalSeconds(seconds);
        setRemaining(seconds);
      }
    }

    setLoading(false);
  }, [manualSelection]);

  /**
   * Initial task loading.
   */
  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  /**
   * Restore an open time entry after navigation/reload.
   *
   * This prevents the timer from resetting when the user
   * navigates away and comes back while a focus session is active.
   */
  useEffect(() => {
    const restoreOpenSession = async () => {
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
        .order("start_time", {
          ascending: false,
        })
        .limit(1)
        .maybeSingle();

      if (!open?.start_time || !open.task_id) {
        return;
      }

      let task =
        tasks.find(
          (item) => item.id === open.task_id,
        ) || null;

      if (!task) {
        const { data: taskData } =
          await supabase
            .from("tasks")
            .select(TASK_SELECT)
            .eq("id", open.task_id)
            .eq("user_id", user.id)
            .maybeSingle();

        if (taskData) {
          task = taskData as FocusTask;
        }
      }

      if (!task) return;

      setFocusTask(task);

      const seconds =
        targetMinutes(task) * 60;

      setTotalSeconds(seconds);

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
        seconds - elapsed,
      );

      setRemaining(left);

      if (left > 0) {
        setRunning(true);
      }
    };

    void restoreOpenSession();

    // Only restore once when the page loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Close current time entry.
   */
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

      // Aggregate measured time onto the task as actual_duration.
      // Never overwrites estimated_duration (user estimate remains source of truth for AHP until history is used for recommendations only).
      const taskId = focusTask?.id;
      if (taskId) {
        const { data: entries } = await supabase
          .from("time_entries")
          .select("duration")
          .eq("task_id", taskId)
          .eq("user_id", user.id)
          .not("duration", "is", null);

        const totalActual = (entries || []).reduce(
          (sum, row) => sum + (Number(row.duration) || 0),
          0,
        );

        if (totalActual > 0) {
          await supabase
            .from("tasks")
            .update({ actual_duration: totalActual })
            .eq("id", taskId)
            .eq("user_id", user.id);
        }
      }

      setEntryId(null);
      setSessionStartIso(null);
    },
    [entryId, focusTask?.id],
  );

  /**
   * Countdown.
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

          toast.success(
            "Focus block finished.",
          );

          /*
           * Refresh recommendations after
           * the focus block ends.
           */
          await loadTasks();
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
    loadTasks,
  ]);

  /**
   * Change selected task manually.
   *
   * Disabled while the session is running so the
   * current focus task cannot silently change.
   */
  const handleTaskChange = (
    taskId: string,
  ) => {
    if (running) {
      toast.message(
        "Pause the current focus session before changing tasks.",
      );
      return;
    }

    const selected =
      tasks.find(
        (task) => task.id === taskId,
      ) || null;

    if (!selected) return;

    setFocusTask(selected);
    setManualSelection(
      selected.id !==
        systemRecommendation?.id,
    );

    const seconds =
      targetMinutes(selected) * 60;

    setTotalSeconds(seconds);
    setRemaining(seconds);
    setEntryId(null);
    setSessionStartIso(null);
    finishedRef.current = false;
  };

  /**
   * Return to system recommendation.
   */
  const useRecommendation = () => {
    if (running) {
      toast.message(
        "Pause the current focus session before changing tasks.",
      );
      return;
    }

    if (!systemRecommendation) {
      toast.message(
        "There is no system recommendation right now.",
      );
      return;
    }

    setFocusTask(systemRecommendation);
    setManualSelection(false);

    const seconds =
      targetMinutes(systemRecommendation) *
      60;

    setTotalSeconds(seconds);
    setRemaining(seconds);
    setEntryId(null);
    setSessionStartIso(null);
    finishedRef.current = false;

    toast.success(
      "System recommendation restored.",
    );
  };

  /**
   * Start or resume.
   *
   * If there is no open time entry, create one.
   */
  const startOrResume = async () => {
    if (!focusTask || remaining <= 0) {
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      toast.error("Not logged in.");
      return;
    }

    /*
     * Resume an existing session.
     */
    if (entryId && sessionStartIso) {
      setRunning(true);
      finishedRef.current = false;

      toast.message("Focus session resumed.");
      return;
    }

    /*
     * Close any other open time entry.
     */
    const { data: opens } =
      await supabase
        .from("time_entries")
        .select("id")
        .eq("user_id", user.id)
        .is("end_time", null);

    for (const openEntry of opens || []) {
      await supabase
        .from("time_entries")
        .update({
          end_time: new Date().toISOString(),
          duration: 0,
        })
        .eq("id", openEntry.id)
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
          "Could not start focus session.",
      );
      return;
    }

    setEntryId(created.id);
    setSessionStartIso(startIso);
    setRunning(true);
    finishedRef.current = false;

    toast.success("Focus session started.");
  };

  /**
   * PAUSE BUTTON ACTION
   *
   * Saves the elapsed focus time and closes
   * the current time entry.
   */
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

    const newRemaining = Math.max(
      0,
      totalSeconds - elapsed,
    );

    setRemaining(newRemaining);

    await closeEntry(elapsed);

    toast.message(
      "Focus session paused. Your saved work time was kept.",
    );
  };

  /**
   * Reset the countdown.
   *
   * Previously saved time entries are NOT deleted.
   */
  const reset = async () => {
    setRunning(false);
    clearTick();
    finishedRef.current = false;

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

    const seconds =
      targetMinutes(focusTask) * 60;

    setTotalSeconds(seconds);
    setRemaining(seconds);

    toast.message(
      "Timer reset. Previously saved focus time was kept.",
    );
  };

  /**
   * Mark the current task complete.
   *
   * After completion, Focus Mode automatically
   * finds the next recommended task.
   */
  const markTaskDone = async () => {
    if (!focusTask) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      toast.error("Not logged in.");
      return;
    }

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
      clearTick();

      await closeEntry(elapsed);
    }

    const { error } =
      await supabase
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
      `"${focusTask.title}" marked complete.`,
    );

    /*
     * Remove completed task from local list.
     */
    const remainingTasks =
      tasks.filter(
        (task) =>
          task.id !== focusTask.id,
      );

    setTasks(remainingTasks);

    /*
     * Automatically recommend the next task.
     */
    const nextTask =
      pickFocusTask(remainingTasks);

    setSystemRecommendation(nextTask);
    setFocusTask(nextTask);
    setManualSelection(false);
    setEntryId(null);
    setSessionStartIso(null);
    finishedRef.current = false;

    if (nextTask) {
      const seconds =
        targetMinutes(nextTask) * 60;

      setTotalSeconds(seconds);
      setRemaining(seconds);

      toast.message(
        `Next Focus recommendation: ${nextTask.title}`,
      );
    } else {
      setTotalSeconds(0);
      setRemaining(0);
    }
  };

  const currentScore =
    focusTask ? focusScore(focusTask) : 0;

  const currentPriority =
    focusTask
      ? priorityFromScore(currentScore)
      : null;

  const priorityStyle =
    currentPriority
      ? PRIORITY_STYLES[currentPriority]
      : null;

  const projectName =
    focusTask?.projects?.name || null;

  const overdue =
    focusTask
      ? isOverdue(focusTask)
      : false;

  const deadlineRisk =
    focusTask
      ? isDeadlineRisk(focusTask)
      : false;

  const pct =
    totalSeconds > 0
      ? ((totalSeconds - remaining) /
          totalSeconds) *
        100
      : 0;

  const blockMin =
    focusTask
      ? targetMinutes(focusTask)
      : 0;

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
      {/* HEADER */}
      <div className="text-center space-y-1">
        <h1 className="font-display text-3xl font-bold">
          Focus Mode
        </h1>

        <p className="text-sm text-muted-foreground">
          One task. Full attention. Track real work time.
        </p>
      </div>

      {/* SYSTEM RECOMMENDATION */}
      {systemRecommendation && (
        <Card className="border-primary/20 bg-primary/[0.03]">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Brain className="h-5 w-5" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-primary">
                  System Recommendation
                </p>

                <h2 className="mt-1 font-semibold">
                  {systemRecommendation.title}
                </h2>

                <p className="mt-1 text-xs text-muted-foreground">
                  {getFocusReason(
                    systemRecommendation,
                  )}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge
                variant="outline"
                className="text-xs"
              >
                {priorityFromScore(
                  focusScore(
                    systemRecommendation,
                  ),
                )}
              </Badge>

              <Badge
                variant="outline"
                className="text-xs"
              >
                {targetMinutes(
                  systemRecommendation,
                )}{" "}
                min
              </Badge>

              {isOverdue(
                systemRecommendation,
              ) && (
                <Badge
                  variant="destructive"
                  className="text-xs"
                >
                  Overdue
                </Badge>
              )}

              {isDeadlineRisk(
                systemRecommendation,
              ) && (
                <Badge
                  variant="outline"
                  className="text-xs"
                >
                  Deadline Risk
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* TASK SELECTION */}
      {focusTask && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Your Selected Task
                  </p>

                  <p className="text-xs text-muted-foreground mt-1">
                    {manualSelection
                      ? "Manually selected"
                      : "System recommended"}
                  </p>
                </div>

                {running && (
                  <Badge
                    variant="secondary"
                    className="text-xs"
                  >
                    <Lock className="mr-1 h-3 w-3" />
                    Locked
                  </Badge>
                )}
              </div>

              <div className="mt-3 space-y-2">
                <label
                  htmlFor="focus-task"
                  className="text-sm font-medium"
                >
                  Focus task
                </label>

                <select
                  id="focus-task"
                  value={focusTask.id}
                  onChange={(event) =>
                    handleTaskChange(
                      event.target.value,
                    )
                  }
                  disabled={running}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {tasks.map((task) => {
                    const score =
                      focusScore(task);

                    const priority =
                      priorityFromScore(
                        score,
                      );

                    return (
                      <option
                        key={task.id}
                        value={task.id}
                      >
                        {task.title} — {priority}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {/* WHY THIS TASK */}
            <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
              <div className="flex gap-2">
                <Brain className="mt-0.5 h-4 w-4 shrink-0 text-primary" />

                <div>
                  <p className="text-xs font-semibold">
                    Why this task?
                  </p>

                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {getFocusReason(
                      focusTask,
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* USE RECOMMENDATION */}
            {manualSelection &&
              systemRecommendation && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={
                    useRecommendation
                  }
                  disabled={running}
                  className="w-full"
                >
                  <Brain className="mr-2 h-4 w-4" />
                  Use Recommendation
                </Button>
              )}
          </CardContent>
        </Card>
      )}

      {/* MAIN FOCUS CARD */}
      <Card className="border-border/80 shadow-sm">
        <CardContent className="pt-10 pb-8 px-6 space-y-6">
          {/* TASK HEADER */}
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

          {/* ALERTS */}
          {focusTask && (
            <div className="flex justify-center flex-wrap gap-2">
              {overdue && (
                <Badge
                  variant="destructive"
                  className="text-xs"
                >
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  Overdue
                </Badge>
              )}

              {!overdue &&
                deadlineRisk && (
                  <Badge
                    variant="outline"
                    className="text-xs"
                  >
                    <Clock className="mr-1 h-3 w-3" />
                    Deadline Risk
                  </Badge>
                )}
            </div>
          )}

          {/* TIMER */}
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

          {/* START / PAUSE / RESUME / RESET */}
          <div className="flex justify-center gap-3 flex-wrap">
            {!running ? (
              <Button
                size="lg"
                variant="default"
                onClick={
                  startOrResume
                }
                disabled={
                  remaining === 0 ||
                  !focusTask
                }
                className="min-w-[150px]"
              >
                <Play className="mr-2 h-4 w-4" />

                {entryId
                  ? "Resume"
                  : "Start Focus"}
              </Button>
            ) : (
              <Button
                size="lg"
                variant="secondary"
                onClick={pause}
                disabled={!focusTask}
                className="min-w-[150px]"
              >
                <Pause className="mr-2 h-4 w-4" />
                Pause
              </Button>
            )}

            <Button
              size="lg"
              variant="outline"
              onClick={reset}
              disabled={!focusTask}
              className="min-w-[120px]"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset
            </Button>
          </div>

          {/* TASK DETAILS */}
          {focusTask && (
            <div className="space-y-3 pt-2 border-t border-border/60">
              <div className="flex flex-wrap justify-center gap-2">
                {/* DAILY FOCUS BLOCKS - PRESERVED */}
                <Badge
                  variant="secondary"
                  className="text-xs"
                >
                  Daily Focus Blocks
                </Badge>

                {projectName && (
                  <Badge
                    variant="secondary"
                    className="text-xs"
                  >
                    {projectName}
                  </Badge>
                )}

                {focusTask.category && (
                  <Badge
                    variant="outline"
                    className="text-xs"
                  >
                    {focusTask.category}
                  </Badge>
                )}

                {priorityStyle && (
                  <Badge
                    variant="outline"
                    className={`text-xs capitalize ${priorityStyle.className}`}
                  >
                    {currentPriority}
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
              </div>

              {/* DEADLINE */}
              {focusTask.due_date && (
                <div className="text-center space-y-1">
                  <p className="text-center text-xs text-muted-foreground">
                    Deadline{" "}
                    {formatPH(
                      focusTask.due_date,
                      "MMM d, yyyy · h:mm a",
                    )}
                  </p>

                  {overdue && (
                    <p className="text-xs font-medium text-destructive">
                      This task is overdue.
                    </p>
                  )}

                  {!overdue &&
                    deadlineRisk && (
                      <p className="text-xs font-medium text-muted-foreground">
                        Deadline is within 24 hours.
                      </p>
                    )}
                </div>
              )}

              {/* COMPLETE */}
              <div className="flex justify-center pt-1">
                <Button
                  variant="secondary"
                  onClick={
                    markTaskDone
                  }
                  className="min-w-[180px]"
                  disabled={!focusTask}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Mark Complete
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* NO TASK STATE */}
      {!focusTask && (
        <Card>
          <CardContent className="py-10 text-center">
            <Focus className="mx-auto h-10 w-10 text-muted-foreground/50" />

            <h2 className="mt-3 font-semibold">
              No unfinished tasks
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              Create or schedule a task to use Focus Mode.
            </p>
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}
