import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { formatPH, formatDate, formatTime, countdown } from "@/lib/date-utils";
import { statusLabel, statusBadgeClass } from "@/lib/status";

export default function ThisWeek() {
  const [tasksByDay, setTasksByDay] = useState<Record<string, any[]>>({});
  const [projects, setProjects] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Compute week bounds in the active timezone (Sunday..Saturday)
      const todayPH = formatPH(new Date(), "yyyy-MM-dd");
      const [y, m, d] = todayPH.split("-").map(Number);
      const todayLocal = new Date(y, m - 1, d);
      const weekDays: string[] = [];
      const start = new Date(todayLocal);
      start.setDate(todayLocal.getDate() - todayLocal.getDay());
      for (let i = 0; i < 7; i++) {
        const day = new Date(start);
        day.setDate(start.getDate() + i);
        weekDays.push(
          `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`
        );
      }
      const weekSet = new Set(weekDays);

      const [{ data }, { data: projectData }] = await Promise.all([
        supabase.from("tasks").select("*").eq("user_id", user.id),
        supabase.from("projects").select("id, name").eq("user_id", user.id),
      ]);

      const pmap: Record<string, string> = {};
      (projectData || []).forEach((p: any) => { pmap[p.id] = p.name; });
      setProjects(pmap);

      const grouped: Record<string, any[]> = {};
      weekDays.forEach((k) => (grouped[k] = []));

      (data || []).forEach((t: any) => {
        if (t.archived) return;
        const keys = new Set<string>();
        if (t.due_date) {
          const k = formatPH(t.due_date, "yyyy-MM-dd");
          if (weekSet.has(k)) keys.add(k);
        }
        if (t.start_time) {
          const k = formatPH(t.start_time, "yyyy-MM-dd");
          if (weekSet.has(k)) keys.add(k);
        }
        keys.forEach((k) => grouped[k].push(t));
      });

      // Sort each day by start time, then due date
      Object.values(grouped).forEach((list) =>
        list.sort((a, b) => {
          const at = new Date(a.start_time || a.due_date || 0).getTime();
          const bt = new Date(b.start_time || b.due_date || 0).getTime();
          return at - bt;
        })
      );

      setTasksByDay(grouped);
    })();
  }, []);

  const days = Object.keys(tasksByDay).sort();
  const totalCount = Object.values(tasksByDay).reduce((sum, arr) => sum + arr.length, 0);
  const todayKey = formatPH(new Date(), "yyyy-MM-dd");

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">This Week</h1>
        <Badge variant="secondary">{totalCount} tasks</Badge>
      </div>

      {totalCount === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No tasks scheduled this week</CardContent></Card>
      ) : (
        days.map((day) => (
          <Card key={day} className={day === todayKey ? "border-primary/50" : undefined}>
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-lg flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  {formatPH(new Date(day + "T12:00:00Z"), "EEEE")} · {formatDate(day + "T12:00:00Z")}
                  {day === todayKey && <Badge className="bg-primary text-primary-foreground">Today</Badge>}
                </span>
                <Badge variant="outline">{tasksByDay[day].length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {tasksByDay[day].length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No tasks</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase tracking-wide text-muted-foreground border-y bg-muted/40">
                      <tr>
                        <th className="text-left font-medium px-4 py-2">Task</th>
                        <th className="text-left font-medium px-4 py-2 hidden sm:table-cell">Project</th>
                        <th className="text-left font-medium px-4 py-2">Start</th>
                        <th className="text-left font-medium px-4 py-2">Target</th>
                        <th className="text-left font-medium px-4 py-2 hidden md:table-cell">Time left</th>
                        <th className="text-left font-medium px-4 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasksByDay[day].map((t) => (
                        <tr key={t.id} className="border-b last:border-0 hover:bg-accent/30">
                          <td className="px-4 py-2.5 font-medium max-w-[16rem] truncate">{t.title}</td>
                          <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">
                            {t.project_id ? projects[t.project_id] || "Project" : "Stand-alone"}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">{t.start_time ? formatTime(t.start_time) : "—"}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{t.due_date ? formatTime(t.due_date) : "—"}</td>
                          <td className="px-4 py-2.5 hidden md:table-cell">
                            {t.status === "done" ? (
                              <span className="text-success">Completed</span>
                            ) : (
                              <span className={t.due_date && new Date(t.due_date) < new Date() ? "text-destructive" : "text-muted-foreground"}>
                                {countdown(t.due_date)}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge variant="outline" className={statusBadgeClass[t.status] || ""}>{statusLabel(t.status)}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </motion.div>
  );
}
