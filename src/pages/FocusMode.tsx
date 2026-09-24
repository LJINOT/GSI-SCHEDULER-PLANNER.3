import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { Play, Pause, RotateCcw, Focus, Loader2, CheckCircle2 } from "lucide-react";
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

function mmss(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** Focus block minutes from task duration (min 5), default 25 */
function targetMinutes(task: FocusTask | null): number {
  if (!task) return 25;
  return Math.max(5, Math.min(480, Number(task.estimated_duration) || 25));
}

const FOCUS_CATEGORY_IMPORTANCE: Record<string, number> = {
  "Exam Review": 1, "Assignment": 0.95, "Project": 0.9, "Lab Work": 0.85,
  "Presentation": 0.85, "Client Communication": 0.9, "Research": 0.75,
  "Content Creation": 0.65, "Graphic Design": 0.65, "General": 0.5,
};

function focusScore(t: FocusTask): number {
  const stored = Number(t.priority_score);
  if (Number.isFinite(stored) && stored > 0) return stored;

  const dueHours = t.due_date
    ? (new Date(t.due_date).getTime() - Date.now()) / 3_600_000
    : Infinity;
  const deadline = dueHours < 0 ? 1 : dueHours < 24 ? 0.9 : dueHours < 72 ? 0.7 : dueHours < 168 ? 0.45 : dueHours < 336 ? 0.25 : 0.1;
  const d = String(t.difficulty || "medium").toLowerCase();
  const difficulty = d === "hard" ? 1 : d === "easy" ? 0.3 : 0.6;
  const minutes = Number(t.estimated_duration) || 30;
  const duration = minutes <= 15 ? 1 : minutes <= 30 ? 0.8 : minutes <= 60 ? 0.6 : minutes <= 120 ? 0.4 : 0.2;
  const category = FOCUS_CATEGORY_IMPORTANCE[t.category || "General"] ?? 0.5;

  // Same fixed AHP weights used by the system's rank-priorities function.
  return (deadline * 0.54621903 + difficulty * 0.23230307 + duration * 0.13772461 + category * 0.08375329) * 100;
}

function pickFocusTask(rows: FocusTask[]): FocusTask | null {
  if (!rows.length) return null;

  const score = (t: FocusTask) => focusScore(t);
  const tier = (t: FocusTask) => {
    const s = score(t);
    return s >= 65 ? 3 : s >= 40 ? 2 : 1;
  };
  const overdue = (t: FocusTask) =>
    !!t.due_date && new Date(t.due_date).getTime() < Date.now();
  const durationMinutes = (t: FocusTask) =>
    Math.max(5, Number(t.estimated_duration) || 25);

  const highTasks = rows.filter((t) => tier(t) === 3);
  const highOverdue = highTasks
    .filter(overdue)
    .sort((a, b) => durationMinutes(a) - durationMinutes(b));
  const highCurrent = highTasks
    .filter((t) => !overdue(t))
    .sort((a, b) => {
      const ad = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const bd = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      return score(b) - score(a);
    });

  /*
   * Improved Focus Mode priority rule:
   *
   * 1. Look for a HIGH overdue task.
   * 2. Find the most urgent upcoming HIGH task.
   * 3. If that upcoming HIGH task has enough deadline room, a reasonably
   *    short HIGH overdue task can be completed first to reduce backlog.
   * 4. If the upcoming HIGH task is close to its deadline, protect it first.
   * 5. If no HIGH overdue task qualifies, continue with MEDIUM/LOW urgency.
   *
   * Deadline room means the upcoming HIGH task has at least one full day
   * plus its estimated duration remaining. A task without a due date has
   * no deadline pressure, so it has enough room for this decision.
   * A short overdue task is currently defined as <= 60 minutes.
   * Once a focus session starts, the current task is not changed mid-session.
   */
  const urgentUpcomingHigh = highCurrent[0];
  const shortOverdueHigh = highOverdue[0];

  if (shortOverdueHigh) {
    const upcomingHasEnoughRoom = !urgentUpcomingHigh || (() => {
      if (!urgentUpcomingHigh.due_date) return true;
      const remainingHours =
        (new Date(urgentUpcomingHigh.due_date).getTime() - Date.now()) /
        3_600_000;
      const requiredHours = durationMinutes(urgentUpcomingHigh) / 60 + 24;
      return remainingHours >= requiredHours;
    })();

    if (durationMinutes(shortOverdueHigh) <= 60 && upcomingHasEnoughRoom) {
      return shortOverdueHigh;
    }

    if (urgentUpcomingHigh) return urgentUpcomingHigh;
  }

  // Normal fallback: priority tier first, then current before overdue,
  // then the earlier deadline and finally the higher priority score.
  return [...rows].sort((a, b) => {
    const tierDiff = tier(b) - tier(a);
    if (tierDiff !== 0) return tierDiff;

    const overdueDiff = Number(overdue(a)) - Number(overdue(b));
    if (overdueDiff !== 0) return overdueDiff;

    const ad = a.due_date ? new Date(a.due_date).getTime() : Infinity;
    const bd = b.due_date ? new Date(b.due_date).getTime() : Infinity;
    if (ad !== bd) return ad - bd;

    return score(b) - score(a);
  })[0];
}

export default function FocusMode() {
  const [focusTask, setFocusTask] = useState<FocusTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [totalSeconds, setTotalSeconds] = useState(25 * 60);
  const [remaining, setRemaining] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [sessionStartIso, setSessionStartIso] = useState<string | null>(null);
  const finishedRef = useRef(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const fetchFocusTask = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setLoading(false);
          return;
        }

        const { data } = await supabase
          .from("tasks")
          .select(
            "id, title, description, estimated_duration, start_time, due_date, priority_score, difficulty, category, status, project_id, projects(name, color)",
          )
          .eq("user_id", user.id)
          .or("archived.eq.false,archived.is.null")
          .neq("status", "done");

        const rows = (data || []) as FocusTask[];
        const chosen = pickFocusTask(rows);
        setFocusTask(chosen);
        if (chosen) {
          const secs = targetMinutes(chosen) * 60;
          setTotalSeconds(secs);
          setRemaining(secs);
        }
      } catch {
        /* ignore */
      }
      setLoading(false);
    };
    fetchFocusTask();
  }, []);

  // Restore open time entry (no duplicate sessions)
  useEffect(() => {
    const restore = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: open } = await supabase
        .from("time_entries")
        .select("id, task_id, start_time, duration")
        .eq("user_id", user.id)
        .is("end_time", null)
        .order("start_time", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!open?.start_time) return;

      let task = focusTask;
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
      const started = new Date(open.start_time).getTime();
      const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
      const left = Math.max(0, total - elapsed);
      setRemaining(left);
      if (left > 0) setRunning(true);
    };
    void restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearTick = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  const closeEntry = useCallback(
    async (elapsedSeconds: number) => {
      if (!entryId) return;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const durationMin = Math.max(1, Math.round(elapsedSeconds / 60));
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

  useEffect(() => {
    clearTick();
    if (!running || !sessionStartIso) return;

    tickRef.current = setInterval(() => {
      const started = new Date(sessionStartIso).getTime();
      const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
      const left = Math.max(0, totalSeconds - elapsed);
      setRemaining(left);

      if (left <= 0 && !finishedRef.current) {
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
  }, [running, sessionStartIso, totalSeconds, closeEntry]);

  const startOrResume = async () => {
    if (!focusTask || remaining <= 0) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Not logged in");
      return;
    }

    if (entryId && sessionStartIso) {
      setRunning(true);
      finishedRef.current = false;
      return;
    }

    // Close any other open entry for this user
    const { data: opens } = await supabase
      .from("time_entries")
      .select("id")
      .eq("user_id", user.id)
      .is("end_time", null);
    for (const o of opens || []) {
      await supabase
        .from("time_entries")
        .update({ end_time: new Date().toISOString(), duration: 0 })
        .eq("id", o.id)
        .eq("user_id", user.id);
    }

    const startIso = new Date().toISOString();
    const { data: created, error } = await supabase
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
      toast.error(error?.message || "Could not start focus session");
      return;
    }

    setEntryId(created.id);
    setSessionStartIso(startIso);
    setRunning(true);
    finishedRef.current = false;
  };

  const pause = async () => {
    if (!running || !sessionStartIso) return;
    setRunning(false);
    clearTick();
    const started = new Date(sessionStartIso).getTime();
    const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
    setRemaining(Math.max(0, totalSeconds - elapsed));
    await closeEntry(elapsed);
    // Keep remaining countdown; user can start a new segment later
  };

  const reset = () => {
    // Reset UI timer only — does not delete saved time_entries
    setRunning(false);
    clearTick();
    finishedRef.current = false;
    const secs = targetMinutes(focusTask) * 60;
    setTotalSeconds(secs);
    setRemaining(secs);
    // If a session is open, close it with elapsed so far
    if (entryId && sessionStartIso) {
      const started = new Date(sessionStartIso).getTime();
      const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
      void closeEntry(elapsed);
    }
    toast.message("Timer reset. Saved focus time was kept.");
  };

  const markTaskDone = async () => {
    if (!focusTask) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    if (running && sessionStartIso) {
      const started = new Date(sessionStartIso).getTime();
      const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
      setRunning(false);
      await closeEntry(elapsed);
    }

    const { error } = await supabase
      .from("tasks")
      .update({
        status: "done",
        completed_at: new Date().toISOString(),
      })
      .eq("id", focusTask.id)
      .eq("user_id", user.id);

    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Task marked complete");
    setFocusTask(null);
    setRemaining(0);
  };

  const pct =
    totalSeconds > 0
      ? ((totalSeconds - remaining) / totalSeconds) * 100
      : 0;
  const pr = focusTask
    ? priorityFromScore(focusTask.priority_score)
    : null;
  const prStyle = pr ? PRIORITY_STYLES[pr] : null;
  const projectName = focusTask?.projects?.name || null;
  const blockMin = Math.round(totalSeconds / 60);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-lg space-y-4"
    >
      <div className="text-center space-y-1">
        <h1 className="font-display text-3xl font-bold">Focus Mode</h1>
        <p className="text-sm text-muted-foreground">
          One task. Full attention. Track real work time.
        </p>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardContent className="pt-10 pb-8 px-6 space-y-6">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Focus className="h-7 w-7" />
            </div>

            <h2 className="font-display text-2xl font-semibold leading-tight max-w-md">
              {focusTask?.title || "No active task"}
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

          <div className="text-center space-y-3">
            <p className="font-display text-6xl sm:text-7xl font-bold tabular-nums tracking-tight text-foreground">
              {mmss(remaining)}
            </p>
            <div className="mx-auto h-1.5 w-full max-w-xs rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${Math.min(100, pct)}%` }}
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
                    : "paused"}
            </p>
          </div>

          <div className="flex justify-center gap-3">
            <Button
              size="lg"
              variant={running ? "secondary" : "default"}
              onClick={() => (running ? pause() : startOrResume())}
              disabled={remaining === 0 || !focusTask}
              className="min-w-[120px]"
            >
              {running ? (
                <>
                  <Pause className="mr-2 h-4 w-4" /> Pause
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" /> Start
                </>
              )}
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={reset}
              disabled={!focusTask}
              className="min-w-[120px]"
            >
              <RotateCcw className="mr-2 h-4 w-4" /> Reset
            </Button>
          </div>

          {focusTask && (
            <div className="space-y-3 pt-2 border-t border-border/60">
              <div className="flex flex-wrap justify-center gap-2">
                {projectName && (
                  <Badge variant="secondary" className="text-xs">
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
                <Badge variant="outline" className="text-xs">
                  {targetMinutes(focusTask)} min
                </Badge>
              </div>
              {focusTask.due_date && (
                <p className="text-center text-xs text-muted-foreground">
                  Deadline {formatPH(focusTask.due_date, "MMM d, yyyy · h:mm a")}
                </p>
              )}
              <div className="flex justify-center pt-1">
                <Button
                  variant="secondary"
                  onClick={markTaskDone}
                  className="min-w-[180px]"
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Mark Complete
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
