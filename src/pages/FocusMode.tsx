import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Loader2, Focus, CheckCircle2, Clock, Play, Pause, RotateCcw } from "lucide-react";
import { formatDateTime, countdown } from "@/lib/date-utils";

type FocusTask = {
  id: string;
  title: string;
  description: string | null;
  estimated_duration: number | null;
  category: string | null;
  difficulty: string | null;
  due_date: string | null;
};

function mmss(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export default function FocusMode() {
  const [focusTask, setFocusTask] = useState<FocusTask | null>(null);
  const [loading, setLoading] = useState(true);

  const [totalSeconds, setTotalSeconds] = useState(25 * 60);
  const [remaining, setRemaining] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [deadlineTick, setDeadlineTick] = useState(0);
  const finishedRef = useRef(false);

  useEffect(() => {
    const fetchFocusTask = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("smart-picks", { body: {} });
        if (error) throw error;
        const topPick = data?.picks?.[0];
        if (topPick) {
          const { data: task } = await supabase.from("tasks").select("*").eq("archived", false).eq("id", topPick.id).single();
          setFocusTask(task as FocusTask);
        }
      } catch {
        const { data } = await supabase
          .from("tasks")
          .select("*")
          .neq("status", "done")
          .order("priority_score", { ascending: false, nullsFirst: false })
          .limit(1);
        if (data?.[0]) setFocusTask(data[0] as FocusTask);
      }
      setLoading(false);
    };
    fetchFocusTask();
  }, []);

  // Session length follows the task's estimated duration (capped at a 50-minute block).
  useEffect(() => {
    const mins = Math.min(focusTask?.estimated_duration || 25, 50);
    setTotalSeconds(mins * 60);
    setRemaining(mins * 60);
    setRunning(false);
    finishedRef.current = false;
  }, [focusTask?.id, focusTask?.estimated_duration]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          if (!finishedRef.current) {
            finishedRef.current = true;
            toast.success("Focus session complete — take a short break!");
            if ("Notification" in window && Notification.permission === "granted") {
              new Notification("Focus session complete", { body: focusTask?.title || "Time for a break" });
            }
          }
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, focusTask?.title]);

  // Live deadline countdown refresh
  useEffect(() => {
    const id = setInterval(() => setDeadlineTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const reset = useCallback(() => {
    setRunning(false);
    finishedRef.current = false;
    setRemaining(totalSeconds);
  }, [totalSeconds]);

  const markComplete = async () => {
    if (!focusTask) return;
    const { error } = await supabase.from("tasks").update({ status: "done" }).eq("id", focusTask.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Task completed! 🎉");
      setFocusTask(null);
      setRunning(false);
    }
  };

  const pct = totalSeconds ? ((totalSeconds - remaining) / totalSeconds) * 100 : 0;
  const deadlineText = focusTask?.due_date ? countdown(focusTask.due_date) : null;
  const overdue = deadlineText?.startsWith("Overdue");

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto space-y-6">
      <div className="text-center">
        <h1 className="font-display text-3xl font-bold">Focus Mode</h1>
        <p className="text-muted-foreground mt-1">The most important task for your current time block</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : focusTask ? (
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.1 }}>
          <Card className="border-2 border-primary/30 shadow-lg">
            <CardContent className="py-10 text-center space-y-6">
              <Focus className="mx-auto h-12 w-12 text-primary opacity-60" />
              <div>
                <h2 className="text-2xl font-display font-bold">{focusTask.title}</h2>
                {focusTask.description && <p className="text-muted-foreground mt-2">{focusTask.description}</p>}
              </div>

              {/* Countdown timer */}
              <div className="space-y-3" key={deadlineTick === -1 ? "x" : "timer"}>
                <p className="font-display text-6xl font-bold tabular-nums tracking-tight">{mmss(remaining)}</p>
                <Progress value={pct} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  {Math.round(totalSeconds / 60)}-minute focus block
                  {remaining === 0 ? " · finished" : running ? " · running" : " · paused"}
                </p>
                <div className="flex justify-center gap-2">
                  <Button variant={running ? "secondary" : "default"} onClick={() => setRunning((r) => !r)} disabled={remaining === 0}>
                    {running ? <><Pause className="mr-2 h-4 w-4" /> Pause</> : <><Play className="mr-2 h-4 w-4" /> Start</>}
                  </Button>
                  <Button variant="outline" onClick={reset}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Reset
                  </Button>
                </div>
              </div>

              <div className="flex justify-center gap-3 flex-wrap">
                {focusTask.category && <Badge variant="outline">{focusTask.category}</Badge>}
                {focusTask.difficulty && <Badge variant="secondary">{focusTask.difficulty}</Badge>}
                {focusTask.estimated_duration && (
                  <Badge variant="outline" className="gap-1">
                    <Clock className="h-3 w-3" /> {focusTask.estimated_duration} min
                  </Badge>
                )}
              </div>

              {focusTask.due_date && (
                <div className={`text-sm ${overdue ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                  Deadline {formatDateTime(focusTask.due_date)} · {deadlineText}
                </div>
              )}

              <Button size="lg" onClick={markComplete} className="mt-2">
                <CheckCircle2 className="mr-2 h-5 w-5" /> Mark Complete
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Focus className="mx-auto h-12 w-12 mb-4 opacity-30" />
            <p className="text-lg">No tasks to focus on</p>
            <p className="text-sm mt-1">All clear! Add some tasks to get focused recommendations.</p>
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}
