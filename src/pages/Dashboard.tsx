import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  PlusCircle, Clock, Target, CheckCircle2, Zap, Loader2, Sparkles,
  CalendarRange, AlertTriangle, Focus, RefreshCw, BarChart3,
} from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { formatPH, formatDate } from "@/lib/date-utils";
import { statusLabel, statusBadgeClass } from "@/lib/status";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { toast } from "sonner";


const fadeIn = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } };
const stagger = { show: { transition: { staggerChildren: 0.08 } } };

type Task = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  start_time: string | null;
  priority_score: number | null;
  category: string | null;
  project_id: string | null;
};

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string; color: string }[]>([]);
  const [aiPicks, setAiPicks] = useState<any[]>([]);
  const [loadingPicks, setLoadingPicks] = useState(false);
  const [expandedStat, setExpandedStat] = useState<string | null>(null);

  // Module summaries stored from last visit
  const [deadlineRiskCount, setDeadlineRiskCount] = useState(0);
  const [focusTaskTitle, setFocusTaskTitle] = useState<string | null>(null);
  const [adaptiveBlockCount, setAdaptiveBlockCount] = useState(0);
  const [productivityScore, setProductivityScore] = useState<number | null>(null);

  const fetchTasks = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const [{ data: taskData }, { data: projectData }] = await Promise.all([
      supabase.from("tasks").select("id, title, status, due_date, start_time, priority_score, category, project_id, estimated_duration, archived").eq("user_id", user.id).eq("archived", false),
      supabase.from("projects").select("id, name, color").eq("user_id", user.id),
    ]);
    setTasks(taskData || []);
    setProjects(projectData || []);
  };

  const checkStartTimes = useCallback(async () => {
    const now = new Date();
    const tasksToUpdate = tasks.filter(
      t => t.status === "todo" && t.start_time && new Date(t.start_time) <= now
    );
    for (const task of tasksToUpdate) {
      await supabase.from("tasks").update({ status: "in_progress" }).eq("id", task.id);
      if (Notification.permission === "granted") {
        new Notification("Task Started", { body: `"${task.title}" is now in progress!` });
      }
      toast.info(`"${task.title}" is now in progress!`);
    }
    if (tasksToUpdate.length > 0) fetchTasks();
  }, [tasks]);

  const fetchModuleSummaries = async () => {
    // Deadline risk
    const { data: riskData } = await supabase
      .from("tasks")
      .select("due_date, status")
      .eq("archived", false)
      .not("due_date", "is", null);
    const todayPH = formatPH(new Date(), "yyyy-MM-dd");
    const atRisk = (riskData || []).filter(t => {
      const duePH = formatPH(t.due_date!, "yyyy-MM-dd");
      const dueDate = new Date(duePH + "T00:00:00");
      const todayDate = new Date(todayPH + "T00:00:00");
      const daysLeft = Math.ceil((dueDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
      return daysLeft <= 3;
    });
    setDeadlineRiskCount(atRisk.length);

    // Focus mode - highest priority task
    const { data: focusData } = await supabase
      .from("tasks")
      .select("title")
      .eq("archived", false)
      .neq("status", "done")
      .order("priority_score", { ascending: false, nullsFirst: false })
      .limit(1);
    setFocusTaskTitle(focusData?.[0]?.title || null);

    // Productivity score from behavior logs
    const { data: behaviorData } = await supabase
      .from("behavior_logs")
      .select("value")
      .eq("metric_type", "productivity_score")
      .order("recorded_at", { ascending: false })
      .limit(1);
    if (behaviorData?.[0]) {
      const val = behaviorData[0].value;
      setProductivityScore(typeof val === "number" ? val : (val as any)?.score ?? null);
    }
  };

  useEffect(() => {
    fetchTasks();
    fetchModuleSummaries();
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    const channel = supabase
      .channel("dashboard-tasks")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => {
        fetchTasks();
        fetchModuleSummaries();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    checkStartTimes();
    const interval = setInterval(checkStartTimes, 30000);
    return () => clearInterval(interval);
  }, [checkStartTimes]);

  const todayPH = formatPH(new Date(), "yyyy-MM-dd");
  const dueTodayTasks = tasks.filter(t => {
    if (!t.due_date || t.status === "done") return false;
    return formatPH(t.due_date, "yyyy-MM-dd") === todayPH;
  });
  // Scheduled for today = has start_time today (not merely due today)
  const scheduledTodayTasks = tasks
    .filter(t => {
      if (!t.start_time || t.status === "done") return false;
      return formatPH(t.start_time, "yyyy-MM-dd") === todayPH;
    })
    .sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime());
  const inProgressTasks = tasks.filter(t => t.status === "in_progress");
  const completedTasks = tasks.filter(t => t.status === "done");
  const priorityTasks = tasks.filter(t => (t.priority_score ?? 0) >= 65 && t.status !== "done");

  // This week tasks
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);

  const thisWeekTasks = tasks.filter(t => {
    if (!t.due_date) return false;
    const dueDate = new Date(t.due_date);
    return dueDate >= startOfWeek && dueDate <= endOfWeek;
  });

  const stats = [
    { key: "due_today", label: "Due Today", value: dueTodayTasks.length, tasks: dueTodayTasks, icon: Clock, color: "text-warning" },
    { key: "in_progress", label: "In Progress", value: inProgressTasks.length, tasks: inProgressTasks, icon: Target, color: "text-info" },
    { key: "completed", label: "Completed", value: completedTasks.length, tasks: completedTasks, icon: CheckCircle2, color: "text-success" },
    { key: "priority", label: "Priority", value: priorityTasks.length, tasks: priorityTasks, icon: Zap, color: "text-destructive" },
  ];

  const todayTasks = scheduledTodayTasks;

  const statusBreakdown = [
    { name: "To Do", value: tasks.filter(t => t.status === "todo").length, color: "hsl(var(--muted-foreground))" },
    { name: "In Progress", value: inProgressTasks.length, color: "hsl(var(--warning))" },
    { name: "Done", value: completedTasks.length, color: "hsl(var(--success))" },
  ].filter(s => s.value > 0);

  const generateAiPicks = async () => {
    setLoadingPicks(true);
    try {
      const { data, error } = await supabase.functions.invoke("smart-picks", {
        body: { tasks: tasks.filter(t => t.status !== "done") },
      });
      if (error) throw error;
      setAiPicks(data?.picks || []);
      toast.success("AI picks generated!");
    } catch (err: any) {
      toast.error(err.message || "Failed to generate picks");
    }
    setLoadingPicks(false);
  };

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">GSI</h1>
          <p className="font-display text-lg font-semibold tracking-widest uppercase text-muted-foreground">Schedule Planner</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild>
            <Link to="/add-task"><PlusCircle className="mr-2 h-4 w-4" /> Add Task</Link>
          </Button>
        </div>
      </div>



      {/* Stats */}
      <motion.div variants={stagger} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <motion.div key={s.label} variants={fadeIn}>
            <Card
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setExpandedStat(expandedStat === s.key ? null : s.key)}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
                <s.icon className={`h-4 w-4 ${s.color}`} />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-display font-bold">{s.value}</p>
                {expandedStat === s.key && s.tasks.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-t pt-3">
                    {s.tasks.slice(0, 5).map(t => (
                      <div key={t.id} className="flex items-center justify-between text-sm">
                        <span className="truncate flex-1">{t.title}</span>
                        {t.category && <Badge variant="outline" className="ml-2 text-xs">{t.category}</Badge>}
                      </div>
                    ))}
                    {s.tasks.length > 5 && (
                      <p className="text-xs text-muted-foreground">+{s.tasks.length - 5} more</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      {/* Status breakdown */}
      <motion.div variants={fadeIn}>
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Task Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">No tasks yet</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusBreakdown}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={95}
                      paddingAngle={3}
                      label={(e: any) => `${e.name}: ${e.value}`}
                    >
                      {statusBreakdown.map((s) => (
                        <Cell key={s.name} fill={s.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "0.5rem",
                        color: "hsl(var(--popover-foreground))",
                      }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>



      {/* Today's Schedule + AI Picks */}
      <div className="grid gap-6 lg:grid-cols-2">
        <motion.div variants={fadeIn}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="font-display">Today's Schedule</CardTitle>
            </CardHeader>
            <CardContent>
              {todayTasks.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-muted-foreground">
                  <p>No tasks scheduled for today. <Link to="/add-task" className="text-primary hover:underline">Add one?</Link></p>
                </div>
              ) : (
                <div className="space-y-3">
                  {todayTasks.map(t => (
                    <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg bg-accent/30">
                      <div className={`h-2 w-2 rounded-full ${t.status === "in_progress" ? "bg-info" : "bg-warning"}`} />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{t.title}</p>
                        {t.category && <p className="text-xs text-muted-foreground">{t.category}</p>}
                      </div>
                      <div className="text-right">
                        {t.due_date && (
                          <span className="text-xs font-medium text-destructive">
                            Deadline: {formatPH(t.due_date, "h:mm a")}
                          </span>
                        )}
                        {t.start_time && (
                          <p className="text-xs text-muted-foreground">
                            Start: {formatPH(t.start_time, "h:mm a")}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={fadeIn}>
          <Card className="h-full">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" /> AI Top Picks
              </CardTitle>
              <Button size="sm" variant="outline" onClick={generateAiPicks} disabled={loadingPicks}>
                {loadingPicks ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Sparkles className="mr-2 h-3 w-3" />}
                Generate
              </Button>
            </CardHeader>
            <CardContent>
              {aiPicks.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-muted-foreground">
                  <p>Click "Generate" to get AI-powered recommendations</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {aiPicks.map((pick: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-accent/30">
                      <span className="text-sm font-bold text-primary">{i + 1}</span>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{pick.title || pick}</p>
                        {pick.reason && <p className="text-xs text-muted-foreground">{pick.reason}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* This Week */}
      <motion.div variants={fadeIn}>
        <Card>
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2">
              <CalendarRange className="h-4 w-4 text-primary" /> This Week
              <Badge variant="secondary" className="ml-2">{thisWeekTasks.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {thisWeekTasks.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-6">No tasks scheduled this week</p>
            ) : (
              <div className="space-y-2">
                {thisWeekTasks.slice(0, 8).map(t => (
                  <div key={t.id} className="flex items-center justify-between p-2.5 rounded-lg bg-accent/30">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className={`h-2 w-2 rounded-full shrink-0 ${t.status === "done" ? "bg-success" : t.status === "in_progress" ? "bg-info" : "bg-muted-foreground"}`} />
                      <span className={`text-sm truncate ${t.status === "done" ? "line-through opacity-60" : ""}`}>{t.title}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {t.due_date && <span className="text-xs text-muted-foreground">{formatDate(t.due_date)}</span>}
                      <Badge variant="outline" className={`text-xs ${statusBadgeClass[t.status] || ""}`}>{statusLabel(t.status)}</Badge>
                    </div>
                  </div>
                ))}
                {thisWeekTasks.length > 8 && (
                  <p className="text-xs text-muted-foreground text-center">+{thisWeekTasks.length - 8} more tasks</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* AI Module Summaries */}
      <motion.div variants={stagger} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <motion.div variants={fadeIn}>
          <Link to="/deadline-risk">
            <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-destructive/50">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <p className="text-sm font-medium">Deadline Risk</p>
                </div>
                <p className="text-2xl font-display font-bold">{deadlineRiskCount}</p>
                <p className="text-xs text-muted-foreground">tasks at risk</p>
              </CardContent>
            </Card>
          </Link>
        </motion.div>
        <motion.div variants={fadeIn}>
          <Link to="/focus-mode">
            <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-primary/50">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 mb-1">
                  <Focus className="h-4 w-4 text-primary" />
                  <p className="text-sm font-medium">Focus Mode</p>
                </div>
                <p className="text-sm font-display font-bold truncate">{focusTaskTitle || "No focus task"}</p>
                <p className="text-xs text-muted-foreground">top priority</p>
              </CardContent>
            </Card>
          </Link>
        </motion.div>
        <motion.div variants={fadeIn}>
          <Link to="/adaptive-scheduling">
            <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-info/50">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 mb-1">
                  <RefreshCw className="h-4 w-4 text-info" />
                  <p className="text-sm font-medium">Adaptive Scheduling</p>
                </div>
                <p className="text-sm font-display font-bold">AI-Powered</p>
                <p className="text-xs text-muted-foreground">rearrange your day</p>
              </CardContent>
            </Card>
          </Link>
        </motion.div>
        <motion.div variants={fadeIn}>
          <Link to="/productivity-insights">
            <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-warning/50">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="h-4 w-4 text-warning" />
                  <p className="text-sm font-medium">Productivity</p>
                </div>
                <p className="text-2xl font-display font-bold">{productivityScore != null ? `${productivityScore}%` : "—"}</p>
                <p className="text-xs text-muted-foreground">score</p>
              </CardContent>
            </Card>
          </Link>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
