import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft, ChevronRight, Plus, Search, X,
  Sparkles, AlertTriangle, Clock, GripVertical, Zap, Brain, CheckCircle2, Loader2, Lightbulb
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from "@/components/ui/dialog";
import { format, addDays, startOfWeek, addWeeks, subWeeks, addMonths, subMonths, isSameDay, isToday, startOfDay, startOfMonth, endOfMonth, eachDayOfInterval, getDay } from "date-fns";
import { toast } from "sonner";
import { priorityFromScore } from "@/lib/status";

type Task = {
  id: string; title: string; description: string | null; due_date: string | null;
  status: string; category: string | null; estimated_duration: number | null;
  difficulty: string | null; priority_score: number | null; start_time: string | null;
};
type ViewMode = "day" | "week" | "month" | "schedule";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const BLOCK_HEIGHT = 60;

/** Extract yyyy-MM-dd from a timestamptz string */
const toDateStr = (dt: string | null) => {
  if (!dt) return null;
  try { return format(new Date(dt), "yyyy-MM-dd"); } catch { return null; }
};

const priorityColor = (score: number | null) => {
  const p = priorityFromScore(score);
  if (p === "high") return "border-destructive bg-destructive/5";
  if (p === "medium") return "border-primary bg-primary/5";
  return "border-muted-foreground/40 border-dashed bg-muted/30";
};

const priorityLabel = (score: number | null) => {
  const p = priorityFromScore(score);
  return p === "high" ? "High" : p === "medium" ? "Medium" : "Low";
};

const categoryColors: Record<string, string> = {
  work: "hsl(220, 70%, 50%)",
  study: "hsl(160, 60%, 40%)",
  personal: "hsl(280, 50%, 50%)",
  health: "hsl(340, 60%, 50%)",
  other: "hsl(40, 60%, 50%)",
  Assignment: "hsl(239, 84%, 67%)",
  "Exam Review": "hsl(0, 84%, 60%)",
  Project: "hsl(258, 90%, 66%)",
  Research: "hsl(189, 94%, 43%)",
  Reading: "hsl(160, 84%, 39%)",
  "Lab Work": "hsl(38, 92%, 50%)",
  Presentation: "hsl(330, 81%, 60%)",
  Personal: "hsl(280, 50%, 50%)",
  Health: "hsl(340, 60%, 50%)",
  Errands: "hsl(40, 60%, 50%)",
  Chores: "hsl(30, 40%, 45%)",
  Social: "hsl(200, 70%, 50%)",
  Finance: "hsl(150, 50%, 40%)",
  Fitness: "hsl(10, 70%, 50%)",
  "Office Work": "hsl(220, 70%, 50%)",
  Meeting: "hsl(210, 60%, 45%)",
  Freelancing: "hsl(258, 70%, 55%)",
  "Virtual Assistant": "hsl(239, 70%, 55%)",
  "Client Communication": "hsl(200, 60%, 45%)",
  "Content Creation": "hsl(280, 55%, 50%)",
  "Data Entry": "hsl(200, 30%, 45%)",
  Bookkeeping: "hsl(150, 40%, 40%)",
};

export default function CalendarView() {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState<"high" | "medium" | "low" | "risk" | null>(null);
  const [smartSuggestOpen, setSmartSuggestOpen] = useState(false);
  const [smartSuggestTask, setSmartSuggestTask] = useState<Task | null>(null);
  const [smartSuggestLoading, setSmartSuggestLoading] = useState(false);
  const [smartSuggestPicks, setSmartSuggestPicks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("tasks").select("*").eq("archived", false);
    setTasks(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const goToday = () => setCurrentDate(new Date());

  const goPrev = () => {
    if (viewMode === "month") setCurrentDate(d => subMonths(d, 1));
    else if (viewMode === "week") setCurrentDate(d => subWeeks(d, 1));
    else setCurrentDate(d => addDays(d, -1));
  };

  const goNext = () => {
    if (viewMode === "month") setCurrentDate(d => addMonths(d, 1));
    else if (viewMode === "week") setCurrentDate(d => addWeeks(d, 1));
    else setCurrentDate(d => addDays(d, 1));
  };

  const columns = useMemo(() => {
    if (viewMode === "day") return [currentDate];
    if (viewMode === "week") {
      const start = startOfWeek(currentDate, { weekStartsOn: 1 });
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    return [];
  }, [viewMode, currentDate]);

  const headerTitle = useMemo(() => {
    if (viewMode === "month") return format(currentDate, "MMMM yyyy");
    if (viewMode === "day") return format(currentDate, "EEEE, MMMM d, yyyy");
    if (columns.length > 0) {
      const first = columns[0], last = columns[columns.length - 1];
      if (first.getMonth() === last.getMonth()) return format(first, "MMMM yyyy");
      return `${format(first, "MMM")} – ${format(last, "MMM yyyy")}`;
    }
    return "";
  }, [viewMode, currentDate, columns]);

  const todayStr = format(new Date(), "yyyy-MM-dd");

  // Computed sets for calendar markers
  const datesWithTasks = useMemo(() => {
    const s = new Set<string>();
    tasks.forEach(t => {
      const d = toDateStr(t.due_date);
      if (d) s.add(d);
      const st = toDateStr(t.start_time);
      if (st) s.add(st);
    });
    return s;
  }, [tasks]);

  const highPriorityDates = useMemo(() => {
    const s = new Set<string>();
    tasks.forEach(t => {
      if (priorityFromScore(t.priority_score) === "high") {
        const d = toDateStr(t.due_date);
        if (d) s.add(d);
      }
    });
    return s;
  }, [tasks]);

  const riskDates = useMemo(() => {
    const s = new Set<string>();
    tasks.forEach(t => {
      if (!t.due_date || t.status === "done") return;
      const d = toDateStr(t.due_date);
      if (!d) return;
      const diff = (new Date(t.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      if (diff <= 2 && diff >= -1) s.add(d);
    });
    return s;
  }, [tasks]);

  const focusDates = useMemo(() => {
    const s = new Set<string>();
    tasks.forEach(t => {
      if (t.status === "done") return;
      const d = toDateStr(t.due_date);
      if (d === todayStr) s.add(d);
    });
    return s;
  }, [tasks, todayStr]);

  // Filtered tasks
  const filteredTasks = useMemo(() => {
    let list = tasks;
    if (searchQuery) list = list.filter(t => t.title.toLowerCase().includes(searchQuery.toLowerCase()));
    if (filter === "high") list = list.filter(t => priorityFromScore(t.priority_score) === "high");
    if (filter === "risk") {
      list = list.filter(t => {
        if (!t.due_date || t.status === "done") return false;
        const diff = (new Date(t.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
        return diff <= 2 && diff >= -1;
      });
    }
    return list;
  }, [tasks, searchQuery, filter, todayStr]);

  const tasksForDay = (day: Date) => {
    const ds = format(day, "yyyy-MM-dd");
    return filteredTasks.filter(t => toDateStr(t.due_date) === ds || toDateStr(t.start_time) === ds);
  };

  // Smart suggestions data
  const riskTasks = useMemo(() => tasks.filter(t => {
    if (!t.due_date || t.status === "done") return false;
    const diff = (new Date(t.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return diff <= 2 && diff >= -1;
  }), [tasks]);

  const unscheduledCount = tasks.filter(t => !t.start_time && t.status !== "done").length;
  const topSuggestion = tasks.find(t => !t.start_time && t.status !== "done" && priorityFromScore(t.priority_score) !== "low");

  // Mini calendar modifiers based on active filter
  const calendarModifiers = useMemo(() => {
    const hasTask = (d: Date) => datesWithTasks.has(format(d, "yyyy-MM-dd"));
    const isHighPriority = (d: Date) => highPriorityDates.has(format(d, "yyyy-MM-dd"));
    const isRisk = (d: Date) => riskDates.has(format(d, "yyyy-MM-dd"));
    if (filter === "high") return { hasTask, isHighPriority };
    if (filter === "risk") return { hasTask, isRisk };
    return { hasTask };
  }, [filter, datesWithTasks, highPriorityDates, riskDates]);

  const calendarModifierStyles = useMemo(() => {
    const styles: Record<string, string> = {
      hasTask: "bg-primary/15 font-bold",
    };
    if (filter === "high") styles.isHighPriority = "!bg-orange-500/20 ring-1 ring-orange-500/40 font-bold";
    if (filter === "risk") styles.isRisk = "!bg-destructive/20 ring-1 ring-destructive/50 font-bold text-destructive";
    return styles;
  }, [filter]);

  // Drag handlers
  const handleDragStart = (task: Task) => setDraggedTask(task);

  const handleDrop = async (day: Date, hour: number) => {
    if (!draggedTask) return;
    // Fixed system breaks — do not place tasks on these hours
    if (hour === 9 || hour === 12 || hour === 15) {
      toast.error("Cannot schedule over a fixed break (9:00 AM, 12:00 PM, or 3:00 PM)");
      setDraggedTask(null);
      return;
    }
    const newDate = new Date(day);
    newDate.setHours(hour, 0, 0, 0);
    const isoDate = newDate.toISOString();
    const dur = Math.max(5, draggedTask.estimated_duration || 30);
    // Overlap check against other scheduled tasks (same calendar day)
    const dayStr = format(day, "yyyy-MM-dd");
    const newStart = newDate.getTime();
    const newEnd = newStart + dur * 60_000;
    const conflict = tasks.find((t) => {
      if (t.id === draggedTask.id || !t.start_time || t.status === "done") return false;
      if (format(new Date(t.start_time), "yyyy-MM-dd") !== dayStr) return false;
      const s = new Date(t.start_time).getTime();
      const e = s + Math.max(5, t.estimated_duration || 30) * 60_000;
      return newStart < e && newEnd > s;
    });
    if (conflict) {
      toast.error(`Conflicts with "${conflict.title}"`);
      setDraggedTask(null);
      return;
    }
    // Update scheduled start_time only — do not change due_date/deadline
    const { error } = await supabase.from("tasks").update({ start_time: isoDate }).eq("id", draggedTask.id);
    if (error) toast.error("Failed to move task");
    else {
      setTasks(prev => prev.map(t => t.id === draggedTask.id ? { ...t, start_time: isoDate } : t));
      toast.success(`Moved "${draggedTask.title}" to ${format(newDate, "MMM d, h:mm a")}`);
    }
    setDraggedTask(null);
  };

  const getZoneClass = (hour: number) => {
    if (hour >= 9 && hour <= 11) return "bg-green-500/[0.06]";
    if (hour >= 14 && hour <= 16) return "bg-yellow-500/[0.04]";
    if (hour >= 12 && hour <= 13) return "bg-muted/40";
    return "";
  };

  const monthDays = useMemo(() => {
    if (viewMode !== "month") return [];
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    const days = eachDayOfInterval({ start, end });
    const padStart = getDay(start) === 0 ? 6 : getDay(start) - 1;
    const padded = Array.from({ length: padStart }, (_, i) => addDays(start, -(padStart - i)));
    return [...padded, ...days];
  }, [viewMode, currentDate]);

  const agendaDays = useMemo(() => {
    if (viewMode !== "schedule") return [];
    const upcoming: { date: Date; tasks: Task[] }[] = [];
    for (let i = 0; i < 14; i++) {
      const day = addDays(new Date(), i);
      const dt = tasksForDay(day);
      if (dt.length > 0) upcoming.push({ date: day, tasks: dt });
    }
    return upcoming;
  }, [viewMode, filteredTasks]);

  const views: { key: ViewMode; label: string }[] = [
    { key: "day", label: "Day" },
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
    { key: "schedule", label: "Schedule" },
  ];

  const filters: { key: Exclude<typeof filter, null>; label: string }[] = [
    { key: "high", label: "High Priority" },
    { key: "risk", label: "Deadline Risk" },
  ];

  const toggleFilter = (key: Exclude<typeof filter, null>) => {
    setFilter(prev => (prev === key ? null : key));
  };

  // High priority tasks scheduled within the currently visible month
  const highPriorityTasksInMonth = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    return tasks.filter(t => {
      if ((t.priority_score || 0) < 7 || !t.due_date) return false;
      const d = new Date(t.due_date);
      return d >= monthStart && d <= monthEnd;
    }).sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime());
  }, [tasks, currentDate]);

  const openSmartSuggestions = async (task: Task) => {
    setSmartSuggestTask(task);
    setSmartSuggestOpen(true);
    setSmartSuggestLoading(true);
    setSmartSuggestPicks([]);
    try {
      const { data, error } = await supabase.functions.invoke("smart-picks", { body: {} });
      if (error) throw error;
      const allPicks = data?.picks || [];
      const matched = allPicks.filter((p: any) => p.id === task.id);
      setSmartSuggestPicks(matched.length > 0 ? matched : allPicks);
    } catch {
      toast.error("Failed to get smart suggestions");
    } finally {
      setSmartSuggestLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] -m-6">
      {/* Top Bar – already has both arrows (kept as-is) */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-card shrink-0">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={goPrev} aria-label="Previous">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={goNext} aria-label="Next">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>Today</Button>
        </div>
        <h2 className="font-display text-lg font-semibold min-w-[160px]">{headerTitle}</h2>
        <div className="flex gap-1 bg-secondary rounded-lg p-0.5">
          {views.map(v => (
            <button
              key={v.key}
              onClick={() => setViewMode(v.key)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${viewMode === v.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {searchOpen ? (
          <div className="flex items-center gap-1">
            <Input placeholder="Search tasks…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="h-8 w-48 text-sm" autoFocus />
            <Button variant="ghost" size="icon" onClick={() => { setSearchOpen(false); setSearchQuery(""); }}><X className="h-4 w-4" /></Button>
          </div>
        ) : (
          <Button variant="ghost" size="icon" onClick={() => setSearchOpen(true)}><Search className="h-4 w-4" /></Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> Create</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => window.location.href = "/add-task"}>New Task</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Left Sidebar */}
        <div className="w-56 border-r bg-card shrink-0 flex flex-col">
          <ScrollArea className="flex-1 p-3">
            {/* ─── FIXED Mini Calendar ─── */}
            {/* The previous className was too aggressive and clipped the right arrow.
                We now keep both nav buttons visible and properly sized. */}
            <Calendar
              mode="single"
              selected={currentDate}
              onSelect={d => d && setCurrentDate(d)}
              className="p-0 w-full"
              classNames={{
                // Keep the compact day cells
                table: "w-full",
                head_cell: "w-7 text-[11px]",
                cell: "h-7 w-7 text-center text-[11px] p-0",
                day: "h-7 w-7 p-0 text-[11px]",
                // Critical: ensure both arrows stay visible and clickable
                caption: "flex justify-center pt-1 relative items-center mb-1",
                nav: "flex items-center gap-1",
                nav_button: "h-7 w-7 bg-transparent p-0 opacity-70 hover:opacity-100",
                nav_button_previous: "absolute left-0",
                nav_button_next: "absolute right-0",
              }}
              modifiers={calendarModifiers}
              modifiersClassNames={calendarModifierStyles}
            />

            <Separator className="my-3" />

            {/* Quick Filters */}
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Quick Filters</p>
            <div className="space-y-1">
              {filters.map(f => (
                <button
                  key={f.key}
                  onClick={() => toggleFilter(f.key)}
                  className={`w-full text-left text-sm px-2 py-1.5 rounded-md transition-colors ${filter === f.key ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-accent"}`}
                >
                  {f.label}
                  {f.key === "risk" && riskTasks.length > 0 && (
                    <span className="ml-auto float-right text-xs bg-destructive/10 text-destructive rounded px-1">{riskTasks.length}</span>
                  )}
                  {f.key === "high" && (
                    <span className="ml-auto float-right text-xs bg-orange-500/10 text-orange-600 rounded px-1">
                      {tasks.filter(t => priorityFromScore(t.priority_score) === "high").length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <Separator className="my-3" />

            {filter === "high" && (
              <>
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
                  High Priority — {format(currentDate, "MMMM yyyy")}
                </p>
                <div className="space-y-1 mb-3">
                  {highPriorityTasksInMonth.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No high-priority tasks this month</p>
                  ) : (
                    highPriorityTasksInMonth.map(t => (
                      <button
                        key={t.id}
                        onClick={() => openSmartSuggestions(t)}
                        className="w-full flex items-center gap-1.5 p-1.5 rounded-md hover:bg-orange-500/10 text-left"
                      >
                        <div className="w-1 h-4 rounded-full bg-orange-500 shrink-0" />
                        <span className="truncate text-xs text-foreground flex-1">{t.title}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {t.due_date ? format(new Date(t.due_date), "MMM d") : ""}
                        </span>
                      </button>
                    ))
                  )}
                </div>
                <Separator className="my-3" />
              </>
            )}

            {/* Smart Suggestions */}
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> Smart Suggestions
            </p>
            <div className="space-y-2">
              {topSuggestion && (
                <div className="p-2 rounded-lg bg-primary/5 border border-primary/20 text-xs">
                  <p className="font-medium text-primary flex items-center gap-1"><Zap className="h-3 w-3" /> Best slot</p>
                  <p className="text-foreground mt-0.5">{topSuggestion.title} → 10:30–11:45 AM</p>
                </div>
              )}
              {riskTasks.length > 0 && (
                <div className="p-2 rounded-lg bg-destructive/5 border border-destructive/20 text-xs">
                  <p className="font-medium text-destructive flex items-center gap-1 mb-1"><AlertTriangle className="h-3 w-3" /> Deadline alerts</p>
                  <div className="space-y-1">
                    {riskTasks.slice(0, 5).map(t => (
                      <div
                        key={t.id}
                        onClick={() => setSelectedTask(t)}
                        className="flex items-center gap-1.5 p-1 rounded hover:bg-destructive/10 cursor-pointer"
                      >
                        <div className="w-1 h-4 rounded-full bg-destructive shrink-0" />
                        <span className="truncate text-foreground">{t.title}</span>
                        <span className="text-muted-foreground shrink-0 ml-auto">
                          {t.due_date ? format(new Date(t.due_date), "MMM d") : ""}
                        </span>
                      </div>
                    ))}
                    {riskTasks.length > 5 && (
                      <p className="text-muted-foreground pl-3">+{riskTasks.length - 5} more</p>
                    )}
                  </div>
                </div>
              )}
              {unscheduledCount > 0 && (
                <div className="p-2 rounded-lg bg-accent border border-border text-xs">
                  <p className="font-medium flex items-center gap-1"><Brain className="h-3 w-3" /> Adaptive</p>
                  <p className="text-muted-foreground mt-0.5">{unscheduledCount} unscheduled — auto-arrange available</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Main Grid */}
        <div className="flex-1 min-w-0 flex flex-col">
          {viewMode === "month" ? (
            <MonthGrid days={monthDays} currentDate={currentDate} tasks={filteredTasks} onSelectTask={setSelectedTask} onSelectDate={d => { window.location.href = `/add-task?date=${format(d, "yyyy-MM-dd")}`; }} />
          ) : viewMode === "schedule" ? (
            <AgendaView days={agendaDays} onSelectTask={setSelectedTask} />
          ) : (
            <TimeGrid columns={columns} tasks={filteredTasks} onSelectTask={setSelectedTask} selectedTask={selectedTask} getZoneClass={getZoneClass} onDragStart={handleDragStart} onDrop={handleDrop} draggedTask={draggedTask} />
          )}
        </div>

        {/* Right Sidebar – Task Inspector */}
        <AnimatePresence>
          {selectedTask && (
            <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 280, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="border-l bg-card shrink-0 overflow-hidden">
              <TaskInspector task={selectedTask} onClose={() => setSelectedTask(null)} onRefresh={fetchTasks} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Smart Suggestions Dialog */}
      <Dialog open={smartSuggestOpen} onOpenChange={setSmartSuggestOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Smart Suggestions
            </DialogTitle>
            <DialogDescription>
              {smartSuggestTask ? `For "${smartSuggestTask.title}"` : "Recommended time slots"}
            </DialogDescription>
          </DialogHeader>
          {smartSuggestLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : smartSuggestPicks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Lightbulb className="mx-auto h-8 w-8 mb-2 opacity-30" />
              No suggestions available for this task
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {smartSuggestPicks.map((p: any, i: number) => (
                <div key={p.id || i} className="p-2.5 rounded-lg bg-accent/50 border border-border text-sm">
                  <p className="font-medium">{p.title}</p>
                  {p.reason && <p className="text-xs text-muted-foreground mt-0.5">{p.reason}</p>}
                  {p.suggested_time && <p className="text-xs text-primary mt-1">{p.suggested_time}</p>}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Time Grid (Day / Week / 4-Day) ─── */
function TimeGrid({
  columns, tasks, onSelectTask, selectedTask, getZoneClass, onDragStart, onDrop, draggedTask
}: {
  columns: Date[]; tasks: Task[]; onSelectTask: (t: Task) => void;
  selectedTask: Task | null; getZoneClass: (h: number) => string;
  onDragStart: (t: Task) => void; onDrop: (d: Date, h: number) => void;
  draggedTask: Task | null;
}) {
  return (
    <ScrollArea className="flex-1">
      <div className="min-w-[600px]">
        <div className="flex border-b sticky top-0 bg-card z-10">
          <div className="w-14 shrink-0" />
          {columns.map(day => (
            <div key={day.toISOString()} className={`flex-1 text-center py-2 border-l ${isToday(day) ? "bg-primary/5" : ""}`}>
              <p className="text-xs text-muted-foreground">{format(day, "EEE")}</p>
              <p className={`text-lg font-semibold ${isToday(day) ? "text-primary" : ""}`}>{format(day, "d")}</p>
            </div>
          ))}
        </div>
        {HOURS.map(hour => (
          <div key={hour} className="flex" style={{ height: BLOCK_HEIGHT }}>
            <div className="w-14 shrink-0 text-[11px] text-muted-foreground text-right pr-2 pt-0.5">
              {hour === 0 ? "" : `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`}
            </div>
            {columns.map(day => {
              const dayStr = format(day, "yyyy-MM-dd");
              const dayTasks = tasks.filter(t => toDateStr(t.due_date) === dayStr || toDateStr(t.start_time) === dayStr);
              const slotTasks = dayTasks.filter((_, i) => {
                const startH = 9 + i;
                return startH === hour;
              });
              return (
                <div
                  key={day.toISOString()}
                  className={`flex-1 border-l border-b relative ${getZoneClass(hour)} ${draggedTask ? "hover:bg-primary/5 cursor-copy" : ""}`}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => onDrop(day, hour)}
                >
                  <div className="absolute left-0 right-0 top-1/2 border-b border-dashed border-border/40" />
                  {slotTasks.map(task => {
                    const dur = task.estimated_duration || 30;
                    const heightPx = Math.max((dur / 60) * BLOCK_HEIGHT, 24);
                    const color = categoryColors[task.category || "other"] || categoryColors.other;
                    const isDone = task.status === "done";
                    return (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={() => onDragStart(task)}
                        onClick={() => onSelectTask(task)}
                        className={`absolute left-0.5 right-0.5 rounded-md px-1.5 py-0.5 text-xs cursor-pointer border-l-[3px] overflow-hidden transition-shadow hover:shadow-md ${selectedTask?.id === task.id ? "ring-2 ring-primary" : ""} ${isDone ? "opacity-70" : ""}`}
                        style={{
                          height: heightPx,
                          borderColor: isDone ? "hsl(var(--success))" : color,
                          backgroundColor: isDone ? "hsl(var(--success) / 0.18)" : `${color}11`,
                        }}
                        title={task.title}
                      >
                        <div className="flex items-center gap-1">
                          {isDone ? <CheckCircle2 className="h-3 w-3 text-success shrink-0" /> : <GripVertical className="h-3 w-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100" />}
                          <span className={`font-medium truncate ${isDone ? "line-through" : ""}`}>{task.title}</span>
                        </div>
                        {dur > 30 && <span className="text-muted-foreground">{dur}m</span>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

/* ─── Month Grid ─── */
function MonthGrid({
  days, currentDate, tasks, onSelectTask, onSelectDate,
}: {
  days: Date[]; currentDate: Date; tasks: Task[];
  onSelectTask: (t: Task) => void; onSelectDate: (d: Date) => void;
}) {
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <div className="flex-1 p-2 overflow-auto">
      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
        {dayNames.map(d => (
          <div key={d} className="bg-card text-center text-xs font-semibold text-muted-foreground py-2">{d}</div>
        ))}
        {days.map(day => {
          const ds = format(day, "yyyy-MM-dd");
          const dt = tasks.filter(t => toDateStr(t.due_date) === ds || toDateStr(t.start_time) === ds);
          const inMonth = day.getMonth() === currentDate.getMonth();
          return (
            <div
              key={ds}
              onClick={() => onSelectDate(day)}
              className={`bg-card min-h-[80px] p-1 cursor-pointer hover:bg-accent/30 transition-colors ${!inMonth ? "opacity-40" : ""} ${isToday(day) ? "ring-1 ring-inset ring-primary/30" : ""}`}
            >
              <p className={`text-xs font-medium mb-0.5 ${isToday(day) ? "text-primary" : ""}`}>{format(day, "d")}</p>
              {dt.slice(0, 3).map(t => {
                const done = t.status === "done";
                return (
                  <div
                    key={t.id}
                    onClick={e => { e.stopPropagation(); onSelectTask(t); }}
                    className={`text-[10px] truncate px-1 rounded mb-0.5 cursor-pointer ${done ? "bg-success/15 text-success line-through" : "bg-primary/10 text-primary hover:bg-primary/20"}`}
                  >
                    {t.title}
                  </div>
                );
              })}
              {dt.length > 3 && <p className="text-[10px] text-muted-foreground">+{dt.length - 3} more</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Schedule / Agenda View ─── */
function AgendaView({ days, onSelectTask }: { days: { date: Date; tasks: Task[] }[]; onSelectTask: (t: Task) => void }) {
  return (
    <ScrollArea className="flex-1 p-4">
      {days.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">No upcoming tasks in the next 2 weeks</p>
      ) : (
        <div className="space-y-4 max-w-2xl">
          {days.map(({ date, tasks }) => (
            <div key={date.toISOString()}>
              <p className={`text-sm font-semibold mb-1 ${isToday(date) ? "text-primary" : ""}`}>
                {isToday(date) ? "Today" : format(date, "EEEE, MMM d")}
              </p>
              <div className="space-y-1">
                {tasks.map(t => (
                  <div key={t.id} onClick={() => onSelectTask(t)} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent cursor-pointer">
                    <div className="w-1 h-8 rounded-full" style={{ background: categoryColors[t.category || "other"] }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.title}</p>
                      <p className="text-xs text-muted-foreground">{t.estimated_duration || 30}m • {t.category || "other"}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{priorityLabel(t.priority_score)}</Badge>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </ScrollArea>
  );
}

/* ─── Task Inspector (Right Panel) ─── */
function TaskInspector({ task, onClose, onRefresh }: { task: Task; onClose: () => void; onRefresh: () => void }) {
  const [rescheduling, setRescheduling] = useState(false);

  const handleReschedule = async () => {
    setRescheduling(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast.error("Please log in"); return; }
      const res = await supabase.functions.invoke("generate-schedule", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.error) throw res.error;
      toast.success("Schedule regenerated");
      onRefresh();
    } catch {
      toast.error("Failed to reschedule");
    } finally {
      setRescheduling(false);
    }
  };

  return (
    <div className="w-[280px] p-4 flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-semibold text-sm">Task Inspector</h3>
        <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      <div className="space-y-4 flex-1">
        <div>
          <p className="font-semibold">{task.title}</p>
          {task.description && <p className="text-sm text-muted-foreground mt-1">{task.description}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Start</p>
            <p className="font-medium">{task.start_time ? format(new Date(task.start_time), "MMM d, h:mm a") : "None"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Due Date</p>
            <p className="font-medium">{task.due_date ? format(new Date(task.due_date), "MMM d, h:mm a") : "None"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Duration</p>
            <p className="font-medium">{task.estimated_duration || 30}m</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Priority</p>
            <Badge variant="outline" className={`text-xs ${(task.priority_score || 0) >= 7 ? "border-destructive text-destructive" : ""}`}>
              {priorityLabel(task.priority_score)} {task.priority_score ? `(${task.priority_score})` : ""}
            </Badge>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Category</p>
            <p className="font-medium capitalize">{task.category || "Other"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <Badge variant="outline" className="text-xs capitalize">{task.status.replace("_", " ")}</Badge>
          </div>
        </div>
        <Separator />
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> Smart Actions
          </p>
          <div className="space-y-1.5">
            <Button variant="outline" size="sm" className="w-full justify-start text-xs gap-2" onClick={handleReschedule} disabled={rescheduling}>
              <Zap className="h-3 w-3" /> {rescheduling ? "Rescheduling…" : "Reschedule Smarter"}
            </Button>
            <Button variant="outline" size="sm" className="w-full justify-start text-xs gap-2" disabled>
              <Clock className="h-3 w-3" /> Move to High-Energy Slot
            </Button>
            <Button variant="outline" size="sm" className="w-full justify-start text-xs gap-2" disabled>
              <Plus className="h-3 w-3" /> Add Buffer Time
            </Button>
          </div>
        </div>
        <Separator />
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
            <Brain className="h-3 w-3" /> Behavioral Insights
          </p>
          <div className="p-2 rounded-lg bg-accent/50 text-xs text-muted-foreground">
            <p>Not enough activity data yet.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
