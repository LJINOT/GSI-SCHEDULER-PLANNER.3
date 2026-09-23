import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Play, Square, Clock } from "lucide-react";
import { formatPH } from "@/lib/date-utils";

export default function Timesheet() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [activeTimer, setActiveTimer] = useState<string | null>(null);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setTasks([]); return; }
      const { data } = await supabase.from("tasks").select("*").eq("user_id", user.id).neq("status", "done");
      setTasks(data || []);
    })();
    supabase.from("time_entries").select("*, tasks(title)").order("start_time", { ascending: false }).limit(20).then(({ data }) => {
      const rows = data || [];
      setEntries(rows);
      const open = rows.find((e: any) => !e.end_time);
      if (open) {
        setActiveEntryId(open.id);
        setActiveTimer(open.task_id);
      }
    });
  }, []);

  const startTimer = async (taskId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from("time_entries").insert({
      task_id: taskId,
      user_id: user.id,
      start_time: new Date().toISOString(),
    }).select().single();
    if (error || !data) toast.error(error?.message || "Failed to start timer");
    else { setActiveTimer(taskId); setActiveEntryId(data.id); toast.success("Timer started"); }
  };

  const stopTimer = async () => {
    if (!activeEntryId) return;
    const now = new Date().toISOString();
    const start = entries.find((e) => e.id === activeEntryId)?.start_time;
    const duration = start ? Math.max(1, Math.round((Date.now() - new Date(start).getTime()) / 60000)) : null;
    const { error } = await supabase.from("time_entries").update({ end_time: now, duration }).eq("id", activeEntryId);
    if (error) toast.error(error.message);
    else { setActiveTimer(null); setActiveEntryId(null); toast.success("Timer stopped"); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <h1 className="font-display text-3xl font-bold">Timesheet</h1>

      <Card>
        <CardHeader><CardTitle className="font-display text-lg">Active Tasks</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {tasks.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No active tasks</p>
          ) : tasks.map((t) => (
            <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-accent/30">
              <span className="font-medium">{t.title}</span>
              {activeTimer === t.id ? (
                <Button size="sm" variant="destructive" onClick={stopTimer}>
                  <Square className="mr-1 h-3 w-3" /> Stop
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => startTimer(t.id)} disabled={!!activeTimer}>
                  <Play className="mr-1 h-3 w-3" /> Start
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-display text-lg">Recent Entries</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {entries.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No time entries yet</p>
          ) : entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between p-3 rounded-lg border">
              <div>
                <p className="font-medium">{(e.tasks as any)?.title || "Unknown"}</p>
                <p className="text-xs text-muted-foreground">
                  {formatPH(e.start_time, "MMM d, h:mm a")}
                  {e.end_time && ` — ${formatPH(e.end_time, "h:mm a")}`}
                </p>
              </div>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
          ))}
        </CardContent>
      </Card>
    </motion.div>
  );
}
