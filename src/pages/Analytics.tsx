import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "framer-motion";
import { BarChart3, TrendingUp, Clock, CheckCircle2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function Analytics() {
  const [stats, setStats] = useState({ total: 0, completed: 0, totalTime: 0 });
  const [categoryData, setCategoryData] = useState<{ name: string; count: number }[]>([]);

  useEffect(() => {
    const fetchStats = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: allTasks }, { data: entries }] = await Promise.all([
        supabase.from("tasks").select("status, category").eq("user_id", user.id).or("archived.eq.false,archived.is.null"),
        supabase.from("time_entries").select("duration, start_time, end_time").eq("user_id", user.id),
      ]);
      const tasks = allTasks || [];
      const total = tasks.length;
      const completed = tasks.filter((t) => t.status === "done").length;
      // Actual recorded minutes from time_entries
      let totalMinutes = 0;
      for (const e of entries || []) {
        if (e.duration && e.duration > 0) totalMinutes += Number(e.duration);
        else if (e.start_time && e.end_time) {
          totalMinutes += Math.max(0, Math.round((new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 60000));
        }
      }
      setStats({ total, completed, totalTime: totalMinutes });

      const cats: Record<string, number> = {};
      tasks.forEach((t) => { const c = t.category || "Other"; cats[c] = (cats[c] || 0) + 1; });
      setCategoryData(Object.entries(cats).map(([name, count]) => ({ name, count })));
    };
    fetchStats();
  }, []);

  const formatTotalTime = (mins: number) => {
    if (!mins) return "0m";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const completionRate = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <h1 className="font-display text-3xl font-bold">Analytics</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-success mb-2" />
            <p className="text-3xl font-display font-bold">{completionRate}%</p>
            <p className="text-sm text-muted-foreground">Completion Rate</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <TrendingUp className="mx-auto h-8 w-8 text-primary mb-2" />
            <p className="text-3xl font-display font-bold">{stats.total}</p>
            <p className="text-sm text-muted-foreground">Total Tasks</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <Clock className="mx-auto h-8 w-8 text-info mb-2" />
            <p className="text-3xl font-display font-bold">{formatTotalTime(stats.totalTime)}</p>
            <p className="text-sm text-muted-foreground">Recorded work time</p>
            <p className="text-xs text-muted-foreground mt-1">{stats.completed} tasks completed</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="font-display">Tasks by Category</CardTitle></CardHeader>
        <CardContent>
          {categoryData.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={categoryData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" className="text-muted-foreground" />
                <YAxis className="text-muted-foreground" />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
