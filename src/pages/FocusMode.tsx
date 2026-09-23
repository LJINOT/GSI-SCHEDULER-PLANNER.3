import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { Play, Pause, RotateCcw, Focus, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { formatPH } from "@/lib/date-utils";
import { priorityFromScore } from "@/lib/status";

type FocusTask = {
  id: string;
  title: string;
  estimated_duration: number | null;
  start_time: string | null;
  due_date: string | null;
  priority_score: number | null;
  status: string;
};

function mmss(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** Session length in minutes: estimated duration (min 5), no fixed 50-min override */
function targetMinutes(task: FocusTask | null): number {
  if (!task) return 25;
  return Math.max(5, task.estimated_duration || 25);
}

export default function FocusMode() {
  const [focusTask, setFocusTask] = useState<FocusTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [totalSeconds, setTotalSeconds] = useState(25 * 60);
  const [remaining, setRemaining] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [sessionStartIso, setSessionStartIso] = useState<string | null>(null);
  const [deadlineTick, setDeadlineTick] = useState(0);
  const finishedRef = useRef(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load focus task
  useEffect(() => {
    const fetchFocusTask = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setLoading(false);
          return;
        }

        const { data } = await supabase
          .from("tasks")
          .select("id, title, estimated_duration, start_time, due_date, priority_score, status")
          .eq("user_id", user.id)
          .eq("archived", false)
          .neq("status", "done")
          .order("priority_score", { ascending: false, nullsFirst: false });
        if (data?.[0]) setFocusTask(data[0] as FocusTask);
        // data contains ALL active tasks for this user (no artificial limit of 1)
      } catch {
        /* ignore */
      }
      setLoading(false);
    };
    fetchFocusTask();
  }, []);

  // Restore active time entry for this user (survives navigation + refresh)
  useEffect(() => {
    const restore = async () => {
      const { data: { user } } = await supabase.auth.getUser();
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

      // Load associated task if needed
      let task = focusTask;
      if (!task || task.id !== open.task_id) {
        const { data: t } = await supabase
          .from("tasks")
          .select("id, title, estimated_duration, start_time, due_date, priority_score, status")
          .eq("id", open.task_id)
          .maybeSingle();
        if (t) {
          task = t as FocusTask;
          setFocusTask(task);
        }
      }

      const targetSec = targetMinutes(task) * 60;
      const started = new Date(open.start_time).getTime();
      const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
      const left = Math.max(0, targetSec - elapsed);

      setEntryId(open.id);
      setSessionStartIso(open.start_time);
      setTotalSeconds(targetSec);
      setRemaining(left);
      finishedRef.current = left <= 0;
      // Keep running if time remains
      setRunning(left > 0);
    };
    restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When focus task changes and no active entry, set duration from task
  useEffect(() => {
    if (entryId) return; // active session owns the clock
    const mins = targetMinutes(focusTask);
    setTotalSeconds(mins * 60);
    setRemaining(mins * 60);
    finishedRef.current = false;
    setRunning(false);
  }, [focusTask?.id, focusTask?.estimated_duration, entryId]);

  // Tick: derive remaining from started_at + target (authoritative), not only decrement
  useEffect(() => {
    if (!running || !sessionStartIso) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    const tick = () => {
      const started = new Date(sessionStartIso).getTime();
      const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
      const left = Math.max(0, totalSeconds - elapsed);
      setRemaining(left);
      if (left <= 0 && !finishedRef.current) {
        finishedRef.current = true;
        setRunning(false);
        void completeSession();
        toast.success("Focus session complete — take a short break!");
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("Focus session complete", { body: focusTask?.title || "Time for a break" });
        }
      }
    };
    tick();
    tickRef.current = setInterval(tick, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, sessionStartIso, totalSeconds, focusTask?.title]);

  useEffect(() => {
    const id = setInterval(() => setDeadlineTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const completeSession = useCallback(async () => {
    if (!entryId || !sessionStartIso) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const end = new Date().toISOString();
    const duration = Math.max(
      1,
      Math.round((Date.now() - new Date(sessionStartIso).getTime()) / 60000),
    );
    await supabase
      .from("time_entries")
      .update({ end_time: end, duration })
      .eq("id", entryId)
      .eq("user_id", user.id);
    setEntryId(null);
    setSessionStartIso(null);
  }, [entryId, sessionStartIso]);

  const markTaskDone = async () => {
    if (!focusTask) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Please log in");
      return;
    }

    // Close the active focus entry first so actual work time is preserved.
    if (entryId && sessionStartIso) {
      await completeSession();
    }

    const { error } = await supabase
      .from("tasks")
      .update({
        status: "done",
      })
      .eq("id", focusTask.id)
      .eq("user_id", user.id);

    if (error) {
      toast.error(error.message || "Could not mark task as done");
      return;
    }

    setRunning(false);
    setEntryId(null);
    setSessionStartIso(null);
    setFocusTask(null);
    setTotalSeconds(25 * 60);
    setRemaining(25 * 60);
    finishedRef.current = false;

    toast.success("Task marked as done");
  };

  const startOrResume = async () => {
    if (!focusTask) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Please log in");
      return;
    }

    // Reuse existing open entry if present
    if (entryId && sessionStartIso) {
      setRunning(true);
      return;
    }

    // Close any other open entries for this user (one active session)
    await supabase
      .from("time_entries")
      .update({ end_time: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("end_time", null);

    const startIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("time_entries")
      .insert({
        user_id: user.id,
        task_id: focusTask.id,
        start_time: startIso,
      })
      .select("id")
      .single();

    if (error) {
      toast.error(error.message || "Could not start focus session");
      return;
    }

    const mins = targetMinutes(focusTask);
    setTotalSeconds(mins * 60);
    setRemaining(mins * 60);
    setEntryId(data.id);
    setSessionStartIso(startIso);
    finishedRef.current = false;
    setRunning(true);
  };

  const pause = async () => {
    // Pause: stop running UI but keep the open time entry so navigation preserves progress.
    // Remaining is always computed from start_time when restored.
    setRunning(false);
  };

  const reset = async () => {
    if (entryId) {
      await completeSession();
    }
    const mins = targetMinutes(focusTask);
    setTotalSeconds(mins * 60);
    setRemaining(mins * 60);
    setRunning(false);
    finishedRef.current = false;
    setEntryId(null);
    setSessionStartIso(null);
  };

  const pct = totalSeconds ? ((totalSeconds - remaining) / totalSeconds) * 100 : 0;

  void deadlineTick; // keep deadline refresh if used below

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-lg mx-auto space-y-6"
    >
      <div>
        <h1 className="font-display text-3xl font-bold flex items-center gap-2">
          <Focus className="h-7 w-7 text-primary" /> Focus Mode
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Stay on one task. Timer continues if you leave this page or refresh.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">
            {focusTask?.title || "No active task"}
          </CardTitle>
          {focusTask && (
            <div className="flex flex-wrap gap-2 mt-2">
              <Badge variant="outline">
                {priorityFromScore(focusTask.priority_score)} priority
              </Badge>
              {focusTask.due_date && (
                <Badge variant="outline">Due {formatPH(focusTask.due_date, "MMM d, h:mm a")}</Badge>
              )}
              <Badge variant="outline">{Math.round(totalSeconds / 60)} min target</Badge>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center space-y-3">
            <p className="font-display text-6xl font-bold tabular-nums tracking-tight text-foreground">
              {mmss(remaining)}
            </p>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {Math.round(totalSeconds / 60)}-minute focus block
              {remaining === 0 ? " · finished" : running ? " · running" : entryId ? " · paused" : " · ready"}
            </p>
            <div className="flex justify-center gap-2">
              <Button
                variant={running ? "secondary" : "default"}
                onClick={() => (running ? pause() : startOrResume())}
                disabled={remaining === 0 || !focusTask}
              >
                {running ? (
                  <>
                    <Pause className="mr-2 h-4 w-4" /> Pause
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" /> {entryId ? "Resume" : "Start"}
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={reset} disabled={!focusTask}>
                <RotateCcw className="mr-2 h-4 w-4" /> Reset
              </Button>
              <Button
                variant="secondary"
                onClick={markTaskDone}
                disabled={!focusTask}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" /> Mark as Done
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
