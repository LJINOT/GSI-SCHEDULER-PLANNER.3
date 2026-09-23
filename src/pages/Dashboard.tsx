import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  PlusCircle, Loader2, AlertTriangle, Focus, RefreshCw, BarChart3,
  ChevronRight, ListTodo, CheckCircle2, Clock, Sparkles, CalendarDays,
  Target, LayoutList,
} from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { formatPH } from "@/lib/date-utils";
import { statusLabel, priorityFromScore, PRIORITY_STYLES } from "@/lib/status";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Sector } from "recharts";
import { loadCache } from "@/lib/persist-cache";
import { format, isToday, isTomorrow, isPast } from "date-fns";

const fadeIn = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };
const stagger = { show: { transition: { staggerChildren: 0.06 } } };

const TODAY_CACHE_KEY = "gsi-cache:today-picks";
const ADAPTIVE_CACHE_KEY = "gsi-cache:adaptive-schedule";
const AUTO_CACHE_KEY = "gsi-cache:schedule-blocks";

type Task = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  start_time: string | null;
  priority_score: number | null;
  category: string | null;
  project_id: string | null;
  estimated_duration?: number | null;
};

type Project = { id: string; name: string; color: string };

type TodayPick = {
  id: string;
  title: string;
  reason: string;
  priority: string;
  score?: number;
};

const DONUT_COLORS: Record<string, string> = {
  "To Do": "#4F46E5",
  "In Progress": "#8B5CF6",
  Completed: "#10B981",
};

function greetingForHour(h: number): string {
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function dueShort(due: string | null): string {
  if (!due) return "—";
  try {
    const d = new Date(due);
    if (isToday(d)) return "Due today";
    if (isTomorrow(d)) return "Due tomorrow";
    if (isPast(d)) return `Overdue · ${format(d, "MMM d")}`;
    return `Due ${format(d, "MMM d")}`;
  } catch {
    return "—";
  }
}

function scheduleTimeRange(t: Task): string {
  if (!t.start_time) return "Unscheduled";
  const start = formatPH(t.start_time, "h:mm a");
  const dur = t.estimated_duration;
  if (dur && dur > 0) {
    try {
      const endDate = new Date(new Date(t.start_time).getTime() + dur * 60_000);
      return `${start} – ${formatPH(endDate.toISOString(), "h:mm a")}`;
    } catch {
      return start;
    }
  }
  return start;
}

function ActiveShape(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={innerRadius}
      outerRadius={outerRadius + 6}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
    />
  );
}

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [displayName, setDisplayName] = useState("there");
  const [deadlineRiskCount, setDeadlineRiskCount] = useState(0);
  const [riskTasks, setRiskTasks] = useState<Task[]>([]);
  const [focusTaskTitle, setFocusTaskTitle] = useState<string | null>(null);
  const [productivityScore, setProductivityScore] = useState<number | null>(null);
  const [adaptiveStatus, setAdaptiveStatus] = useState("Up to date");
  const [todayPicks, setTodayPicks] = useState<TodayPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPicks, setLoadingPicks] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);

  const fetchTasks = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const [{ data: taskData }, { data: projectData }, { data: profile }] = await Promise.all([
      supabase
        .from("tasks")
        .select("id, title, status, due_date, start_time, priority_score, category, project_id, estimated_duration")
        .eq("user_id", user.id)
        .or("archived.eq.false,archived.is.null"),
      supabase.from("projects").select("id, name, color").eq("user_id", user.id).or("archived.eq.false,archived.is.null"),
      supabase.from("profiles").select("full_name").eq("id", user.id).single(),
    ]);
    setTasks((taskData as Task[]) || []);
    setProjects((projectData as Project[]) || []);
    if (profile?.full_name) {
      setDisplayName(profile.full_name.split(" ")[0] || profile.full_name);
    }
  };

  const checkStartTimes = useCallback(async () => {
    const now = new Date();
    const tasksToUpdate = tasks.filter(
      (t) => t.status === "todo" && t.start_time && new Date(t.start_time) <= now
    );
    for (const task of tasksToUpdate) {
      await supabase.from("tasks").update({ status: "in_progress" }).eq("id", task.id).eq("user_id", user.id);
    }
    if (tasksToUpdate.length > 0) fetchTasks();
  }, [tasks]);

  const fetchModuleSummaries = async () => {
    const todayPH = formatPH(new Date(), "yyyy-MM-dd");

    const { data: { user: riskUser } } = await supabase.auth.getUser();
    if (!riskUser) return;
    const { data: riskData } = await supabase
      .from("tasks")
      .select("id, title, status, due_date, start_time, priority_score, category, project_id, estimated_duration")
      .eq("user_id", riskUser.id)
      .or("archived.eq.false,archived.is.null")
      .not("due_date", "is", null)
      .neq("status", "done");

    const atRisk = ((riskData as Task[]) || []).filter((t) => {
      const duePH = formatPH(t.due_date!, "yyyy-MM-dd");
      const dueDate = new Date(duePH + "T00:00:00");
      const todayDate = new Date(todayPH + "T00:00:00");
      const daysLeft = Math.ceil((dueDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
      return daysLeft <= 3;
    });
    setDeadlineRiskCount(atRisk.length);
    setRiskTasks(atRisk.slice(0, 4));

    const { data: focusData } = await supabase
      .from("tasks")
      .select("title")
      .eq("user_id", riskUser.id)
      .neq("status", "done")
      .or("archived.eq.false,archived.is.null")
      .order("priority_score", { ascending: false, nullsFirst: false })
      .limit(1);
    setFocusTaskTitle(focusData?.[0]?.title || null);

    const { data: behaviorData } = await supabase
      .from("behavior_logs")
      .select("value")
      .eq("user_id", riskUser.id)
      .eq("metric_type", "productivity_score")
      .order("recorded_at", { ascending: false })
      .limit(1);
    if (behaviorData?.[0]) {
      const val = behaviorData[0].value;
      setProductivityScore(typeof val === "number" ? val : (val as any)?.score ?? null);
    } else {
      setProductivityScore(null);
    }
  };

  const loadTodayRecommendations = async () => {
    const cached = loadCache<{ picks?: TodayPick[] }>(TODAY_CACHE_KEY);
    if (cached?.picks?.length) {
      setTodayPicks(cached.picks.slice(0, 3));
      return;
    }
    setLoadingPicks(true);
    try {
      const { data, error } = await supabase.functions.invoke("smart-picks", { body: {} });
      if (!error && data?.picks) {
        setTodayPicks((data.picks as TodayPick[]).slice(0, 3));
      }
    } catch {
      /* silent */
    }
    setLoadingPicks(false);
  };

  const loadAdaptiveStatus = () => {
    const adaptive = loadCache<{ blocks?: unknown[] }>(ADAPTIVE_CACHE_KEY);
    const auto = loadCache<{ blocks?: unknown[] }>(AUTO_CACHE_KEY);
    if (!adaptive?.blocks?.length && !auto?.blocks?.length) {
      setAdaptiveStatus("No schedule yet");
      return;
    }
    setAdaptiveStatus("Schedule up to date");
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchTasks(), fetchModuleSummaries(), loadTodayRecommendations()]);
      loadAdaptiveStatus();
      setLoading(false);
    })();

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

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    checkStartTimes();
    const interval = setInterval(checkStartTimes, 30000);
    return () => clearInterval(interval);
  }, [checkStartTimes]);

  const todayPH = formatPH(new Date(), "yyyy-MM-dd");
  const hour = new Date().getHours();
  const greeting = greetingForHour(hour);
  const todayLabel = format(new Date(), "MMMM d, yyyy");

  const todoCount = tasks.filter((t) => t.status === "todo").length;
  const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;
  const completedCount = tasks.filter((t) => t.status === "done").length;
  const totalTasks = tasks.length;
  const completionPct = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;

  const projectMap = useMemo(() => {
    const m: Record<string, Project> = {};
    projects.forEach((p) => {
      m[p.id] = p;
    });
    return m;
  }, [projects]);

  const taskMeta = useMemo(() => {
    const m: Record<string, Task> = {};
    tasks.forEach((t) => {
      m[t.id] = t;
    });
    return m;
  }, [tasks]);

  const donutData = useMemo(() => {
    return [
      { name: "To Do", value: todoCount, color: DONUT_COLORS["To Do"] },
      { name: "In Progress", value: inProgressCount, color: DONUT_COLORS["In Progress"] },
      { name: "Completed", value: completedCount, color: DONUT_COLORS.Completed },
    ].filter((d) => d.value > 0);
  }, [todoCount, inProgressCount, completedCount]);

  const todaysSchedule = useMemo(() => {
    const withStart = tasks.filter((t) => {
      if (!t.start_time || t.status === "done") return false;
      return formatPH(t.start_time, "yyyy-MM-dd") === todayPH;
    });
    if (withStart.length > 0) {
      return [...withStart].sort(
        (a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime()
      );
    }
    return tasks
      .filter((t) => t.due_date && t.status !== "done" && formatPH(t.due_date, "yyyy-MM-dd") === todayPH)
      .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0));
  }, [tasks, todayPH]);

  const breakMarkers = [
    { time: "9:00 AM", label: "Snack break" },
    { time: "12:00 PM", label: "Lunch break" },
    { time: "3:00 PM", label: "Snack break" },
  ];

  const summaryCards = [
    {
      label: "Total Tasks",
      value: totalTasks,
      sub: `${todoCount + inProgressCount} active`,
      icon: ListTodo,
      box: "bg-primary/10 text-primary",
    },
    {
      label: "Completed",
      value: completedCount,
      sub: totalTasks ? `${completionPct}% completion` : "No tasks yet",
      icon: CheckCircle2,
      box: "bg-success/10 text-success",
    },
    {
      label: "In Progress",
      value: inProgressCount,
      sub: "Currently active",
      icon: Clock,
      box: "bg-ai/10 text-ai",
    },
    {
      label: "Deadline Risk",
      value: deadlineRiskCount,
      sub: deadlineRiskCount > 0 ? "Needs attention" : "All clear",
      icon: AlertTriangle,
      box: deadlineRiskCount > 0 ? "bg-warning/10 text-warning" : "bg-success/10 text-success",
    },
  ];

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-16 rounded-2xl bg-muted/60" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-muted/60" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="h-72 rounded-2xl bg-muted/60" />
          <div className="h-72 rounded-2xl bg-muted/60" />
        </div>
      </div>
    );
  }

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      {/* Welcome header */}
      <motion.div variants={fadeIn} className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            {greeting}, {displayName}
          </h1>
          <p className="text-muted-foreground mt-1">
            Here&apos;s your schedule and productivity overview for today.
          </p>
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 text-primary" />
            {todayLabel}
          </p>
        </div>
        <Button asChild className="shrink-0 shadow-sm">
          <Link to="/add-task">
            <PlusCircle className="mr-2 h-4 w-4" /> Add Task
          </Link>
        </Button>
      </motion.div>

      {/* Summary cards */}
      <motion.div variants={fadeIn} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map((c) => (
          <Card
            key={c.label}
            className="rounded-2xl border shadow-[0_4px_20px_rgba(15,23,42,0.05)] hover:shadow-[0_8px_28px_rgba(15,23,42,0.08)] transition-all duration-200 hover:-translate-y-0.5"
          >
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {c.label}
                  </p>
                  <p className="text-3xl font-display font-bold mt-1 tabular-nums">{c.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{c.sub}</p>
                </div>
                <div className={`gsi-icon-box ${c.box}`}>
                  <c.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </motion.div>

      {/* Task Overview + Today's Schedule */}
      <div className="grid gap-6 lg:grid-cols-2">
        <motion.div variants={fadeIn}>
          <Card className="rounded-2xl border shadow-[0_4px_20px_rgba(15,23,42,0.05)] h-full">
            <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="font-display text-lg">Task Overview</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Your current task distribution</p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to="/tasks">
                  View Tasks <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {totalTasks === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <LayoutList className="h-10 w-10 text-muted-foreground/40 mb-3" />
                  <p className="text-sm text-muted-foreground">No tasks yet</p>
                  <Button variant="link" size="sm" asChild className="mt-1">
                    <Link to="/add-task">Add your first task</Link>
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <div className="relative h-[200px] w-[200px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={donutData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={58}
                          outerRadius={78}
                          paddingAngle={3}
                          activeIndex={activeIndex}
                          activeShape={ActiveShape}
                          onMouseEnter={(_, i) => setActiveIndex(i)}
                          onMouseLeave={() => setActiveIndex(undefined)}
                        >
                          {donutData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} stroke="transparent" />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number, name: string) => {
                            const pct = totalTasks ? Math.round((value / totalTasks) * 100) : 0;
                            return [`${value} (${pct}%)`, name];
                          }}
                          contentStyle={{
                            background: "hsl(var(--popover))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "0.75rem",
                            color: "hsl(var(--popover-foreground))",
                            fontSize: 12,
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-display font-bold tabular-nums">{totalTasks}</span>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Total Tasks
                      </span>
                    </div>
                  </div>
                  <div className="flex-1 w-full space-y-2">
                    {[
                      { name: "To Do", value: todoCount, color: DONUT_COLORS["To Do"] },
                      { name: "In Progress", value: inProgressCount, color: DONUT_COLORS["In Progress"] },
                      { name: "Completed", value: completedCount, color: DONUT_COLORS.Completed },
                    ].map((row) => {
                      const pct = totalTasks ? Math.round((row.value / totalTasks) * 100) : 0;
                      return (
                        <div key={row.name} className="flex items-center gap-2 text-sm">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ background: row.color }}
                          />
                          <span className="flex-1 text-muted-foreground">{row.name}</span>
                          <span className="font-semibold tabular-nums">{row.value}</span>
                          <span className="text-xs text-muted-foreground w-10 text-right">{pct}%</span>
                        </div>
                      );
                    })}
                    <div className="pt-2">
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>Completion</span>
                        <span className="font-medium text-foreground">{completionPct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-success transition-all duration-500"
                          style={{ width: `${completionPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={fadeIn}>
          <Card className="rounded-2xl border shadow-[0_4px_20px_rgba(15,23,42,0.05)] h-full">
            <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle className="font-display text-lg">Today&apos;s Schedule</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Your timed tasks for today</p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to="/auto-schedule">
                  Auto Schedule <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              {todaysSchedule.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Clock className="h-10 w-10 text-muted-foreground/40 mb-3" />
                  <p className="text-sm font-medium">No tasks scheduled today</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                    You currently have no tasks with a start time for today.
                  </p>
                  <Button variant="link" size="sm" asChild className="mt-2">
                    <Link to="/add-task">Add Task</Link>
                  </Button>
                </div>
              ) : (
                <div className="relative space-y-0 max-h-[320px] overflow-y-auto pr-1">
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {breakMarkers.map((b) => (
                      <span
                        key={b.time}
                        className="inline-flex items-center gap-1 rounded-full bg-info/10 text-info text-[10px] px-2 py-0.5 font-medium"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-info" />
                        {b.time} · {b.label}
                      </span>
                    ))}
                  </div>

                  {todaysSchedule.map((t, idx) => {
                    const pr = priorityFromScore(t.priority_score);
                    const style = PRIORITY_STYLES[pr];
                    const proj = t.project_id ? projectMap[t.project_id] : null;
                    const isLast = idx === todaysSchedule.length - 1;
                    const dotColor =
                      pr === "high" ? "bg-destructive" : pr === "medium" ? "bg-warning" : "bg-success";
                    return (
                      <div key={t.id} className="flex gap-3">
                        <div className="flex flex-col items-center w-4 shrink-0">
                          <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-background ${dotColor}`} />
                          {!isLast && <span className="w-px flex-1 bg-border mt-1" />}
                        </div>
                        <div className={`flex-1 min-w-0 pb-4 ${isLast ? "pb-0" : ""}`}>
                          <p className="text-[11px] font-mono text-muted-foreground">
                            {scheduleTimeRange(t)}
                          </p>
                          <p className="text-sm font-semibold mt-0.5 truncate">{t.title}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <Badge variant="outline" className={`text-[10px] ${style.className}`}>
                              {style.label}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              {statusLabel(t.status)}
                            </Badge>
                            {proj && (
                              <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                                {proj.name}
                              </span>
                            )}
                            {t.estimated_duration != null && (
                              <span className="text-[10px] text-muted-foreground">
                                {t.estimated_duration} min
                              </span>
                            )}
                          </div>
                          {t.due_date && (
                            <p className="text-[10px] text-muted-foreground mt-1">
                              Deadline: {formatPH(t.due_date, "h:mm a")}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* AI Top Picks + Deadline Risk */}
      <div className="grid gap-6 lg:grid-cols-2">
        <motion.div variants={fadeIn}>
          <Card className="rounded-2xl border border-ai/20 shadow-[0_4px_20px_rgba(15,23,42,0.05)] h-full overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-ai/80 to-primary/60" />
            <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2 space-y-0">
              <div className="flex items-start gap-3">
                <div className="gsi-icon-box bg-ai/10 text-ai">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="font-display text-lg">AI Top Picks</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Tasks you may want to focus on today
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to="/today">
                  View All <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {loadingPicks ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-ai" />
                </div>
              ) : todayPicks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10 px-4">
                  No recommendations yet. Open Today AI Recommendation to generate them.
                </p>
              ) : (
                <div className="divide-y">
                  {todayPicks.map((p, i) => {
                    const t = taskMeta[p.id];
                    const pr = t
                      ? priorityFromScore(t.priority_score)
                      : ((p.priority as "high" | "medium" | "low") || "medium");
                    const style = PRIORITY_STYLES[pr] || PRIORITY_STYLES.medium;
                    return (
                      <div key={p.id} className="px-5 py-3.5 flex gap-3">
                        <span className="text-sm font-display font-bold text-ai/70 w-6 shrink-0">
                          #{i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate">{p.title}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <Badge variant="outline" className={`text-[10px] ${style.className}`}>
                              {style.label}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground">
                              {dueShort(t?.due_date ?? null)}
                            </span>
                            {t?.estimated_duration != null && (
                              <span className="text-[11px] text-muted-foreground">
                                {t.estimated_duration} min
                              </span>
                            )}
                          </div>
                          {p.reason && (
                            <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
                              {p.reason}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={fadeIn}>
          <Card className="rounded-2xl border shadow-[0_4px_20px_rgba(15,23,42,0.05)] h-full overflow-hidden">
            <div
              className={`h-1 w-full ${
                deadlineRiskCount > 0
                  ? "bg-gradient-to-r from-warning to-destructive/80"
                  : "bg-success/60"
              }`}
            />
            <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2 space-y-0">
              <div className="flex items-start gap-3">
                <div
                  className={`gsi-icon-box ${
                    deadlineRiskCount > 0 ? "bg-warning/10 text-warning" : "bg-success/10 text-success"
                  }`}
                >
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="font-display text-lg">Deadline Risk</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {deadlineRiskCount > 0
                      ? `${deadlineRiskCount} task${deadlineRiskCount === 1 ? "" : "s"} need attention`
                      : "No tasks at risk"}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to="/deadline-risk">
                  View <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {riskTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10 px-4">
                  All clear — no deadlines within 3 days.
                </p>
              ) : (
                <div className="divide-y">
                  {riskTasks.map((t) => {
                    const pr = priorityFromScore(t.priority_score);
                    const style = PRIORITY_STYLES[pr];
                    const overdue =
                      t.due_date ? isPast(new Date(t.due_date)) && !isToday(new Date(t.due_date)) : false;
                    return (
                      <div
                        key={t.id}
                        className={`px-5 py-3 flex items-start gap-3 ${
                          overdue ? "bg-destructive/5" : "bg-warning/5"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate">{t.title}</p>
                          <div className="flex flex-wrap gap-1.5 mt-1 items-center">
                            <Badge variant="outline" className={`text-[10px] ${style.className}`}>
                              {style.label}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground">
                              {dueShort(t.due_date)}
                            </span>
                            <span
                              className={`text-[10px] font-semibold ${
                                overdue ? "text-destructive" : "text-warning"
                              }`}
                            >
                              {overdue ? "Critical" : "Attention"}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Quick Actions */}
      <motion.div variants={fadeIn}>
        <Card className="rounded-2xl border shadow-[0_4px_20px_rgba(15,23,42,0.05)]">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-lg">Quick Actions</CardTitle>
            <p className="text-xs text-muted-foreground">Jump to common workflows</p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Link
                to="/add-task"
                className="flex items-start gap-3 rounded-xl border p-3.5 hover:bg-accent/50 hover:border-primary/30 transition-all duration-200 hover:-translate-y-0.5"
              >
                <div className="gsi-icon-box bg-primary/10 text-primary">
                  <PlusCircle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Add Task</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Create a new task</p>
                </div>
              </Link>

              <Link
                to="/auto-schedule"
                className="flex items-start gap-3 rounded-xl border p-3.5 hover:bg-accent/50 hover:border-primary/30 transition-all duration-200 hover:-translate-y-0.5"
              >
                <div className="gsi-icon-box bg-primary/10 text-primary">
                  <Target className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Auto Schedule</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Create a schedule with PSO</p>
                </div>
              </Link>

              <Link
                to="/adaptive-scheduling"
                className="flex items-start gap-3 rounded-xl border border-ai/20 p-3.5 hover:bg-ai/5 hover:border-ai/40 transition-all duration-200 hover:-translate-y-0.5"
              >
                <div className="gsi-icon-box bg-ai/10 text-ai">
                  <RefreshCw className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Adaptive Scheduling</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{adaptiveStatus}</p>
                </div>
              </Link>

              <Link
                to="/focus-mode"
                className="flex items-start gap-3 rounded-xl border p-3.5 hover:bg-accent/50 transition-all duration-200 hover:-translate-y-0.5"
              >
                <div className="gsi-icon-box bg-info/10 text-info">
                  <Focus className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Focus Mode</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[140px]">
                    {focusTaskTitle || "Pick a focus task"}
                  </p>
                </div>
              </Link>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Attention */}
      <motion.div variants={fadeIn}>
        <Card className="rounded-2xl border shadow-[0_4px_20px_rgba(15,23,42,0.05)]">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-lg">Attention</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              <Link
                to="/deadline-risk"
                className="flex items-center gap-3 px-5 py-3.5 hover:bg-accent/40 transition-colors"
              >
                <div className="gsi-icon-box bg-warning/10 text-warning h-9 w-9">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Deadline Risk</p>
                  <p className="text-xs text-muted-foreground">
                    {deadlineRiskCount} task{deadlineRiskCount === 1 ? "" : "s"} at risk
                  </p>
                </div>
                <span className="text-xs text-primary font-medium">View</span>
              </Link>

              <Link
                to="/focus-mode"
                className="flex items-center gap-3 px-5 py-3.5 hover:bg-accent/40 transition-colors"
              >
                <div className="gsi-icon-box bg-primary/10 text-primary h-9 w-9">
                  <Focus className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Focus Task</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {focusTaskTitle ? `Current focus: ${focusTaskTitle}` : "No focus task"}
                  </p>
                </div>
                <span className="text-xs text-primary font-medium">Start Focus</span>
              </Link>

              <Link
                to="/adaptive-scheduling"
                className="flex items-center gap-3 px-5 py-3.5 hover:bg-accent/40 transition-colors"
              >
                <div className="gsi-icon-box bg-ai/10 text-ai h-9 w-9">
                  <RefreshCw className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Adaptive Schedule</p>
                  <p className="text-xs text-muted-foreground">{adaptiveStatus}</p>
                </div>
                <span className="text-xs text-primary font-medium">View</span>
              </Link>

              <Link
                to="/productivity-insights"
                className="flex items-center gap-3 px-5 py-3.5 hover:bg-accent/40 transition-colors"
              >
                <div className="gsi-icon-box bg-success/10 text-success h-9 w-9">
                  <BarChart3 className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Productivity</p>
                  <p className="text-xs text-muted-foreground">
                    {productivityScore != null ? `${productivityScore}%` : "Not available yet"}
                  </p>
                </div>
                <span className="text-xs text-primary font-medium">View</span>
              </Link>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
