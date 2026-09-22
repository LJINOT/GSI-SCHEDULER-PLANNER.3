import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { motion } from "framer-motion";
import { CheckCircle2, Archive, Search, RotateCcw, Trash2, Folder, User } from "lucide-react";
import { formatPH } from "@/lib/date-utils";
import { toast } from "sonner";

const RANGES: { value: string; label: string; days: number | null }[] = [
  { value: "today", label: "Today", days: 0 },
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "90", label: "Last 90 days", days: 90 },
  { value: "365", label: "Last year", days: 365 },
  { value: "all", label: "All time", days: null },
];

/** Prefer completed_at; fall back to updated_at only for older rows. */
function completionTime(t: { completed_at?: string | null; updated_at?: string | null }): number {
  const raw = t.completed_at || t.updated_at;
  if (!raw) return 0;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** Inclusive start of local calendar window for N days (0 = today only). */
function windowStartMs(days: number): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  if (days > 0) {
    start.setDate(start.getDate() - (days - 1));
  }
  return start.getTime();
}

export default function Completed() {
  const [allTasks, setAllTasks] = useState<any[]>([]);
  const [range, setRange] = useState("30");
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  const fetchTasks = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setAllTasks([]);
      return;
    }
    // Load this user's completed tasks (range filter applied in filteredTasks below)
    let query = supabase
      .from("tasks")
      .select("*, projects(name)")
      .eq("status", "done")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    // archived=false when column exists — ignore error via fallback
    const { data, error } = await query;
    if (error) {
      console.error("Completed fetch:", error.message);
      setAllTasks([]);
      return;
    }
    // Prefer non-archived when field present
    const rows = (data || []).filter((t: any) => t.archived !== true);
    setAllTasks(rows);
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  /**
   * Date range is applied HERE on every range change.
   * Uses completed_at (not created_at / not primary updated_at).
   * Changing the dropdown updates `range` → this memo recomputes → list refreshes.
   */
  const filteredTasks = useMemo(() => {
    const sel = RANGES.find((r) => r.value === range);
    let list = allTasks;

    // Apply date window for every option except "all"
    if (sel && sel.value !== "all") {
      const days = sel.days; // 0 = today, 7 = last 7 calendar days, etc.
      if (days !== null && days !== undefined) {
        const cutoff = windowStartMs(days);
        list = list.filter((t) => {
          const ts = completionTime(t);
          // Exclude tasks with no usable completion time from ranged views
          if (!ts) return false;
          return ts >= cutoff;
        });
      }
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((t) => (t.title || "").toLowerCase().includes(q));
    }

    // Newest completions first
    list = [...list].sort((a, b) => completionTime(b) - completionTime(a));
    return list;
  }, [allTasks, range, search]);

  const standAloneTasks = useMemo(() => filteredTasks.filter((t) => !t.project_id), [filteredTasks]);
  const projectTasks = useMemo(() => filteredTasks.filter((t) => t.project_id), [filteredTasks]);

  const totalTasks = filteredTasks.length;

  const handleRestore = async (task: any) => {
    const { error } = await supabase.from("tasks").update({ status: "todo" }).eq("id", task.id);
    if (error) {
      toast.error(error.message || "Failed to restore task");
      return;
    }
    toast.success("Task restored to To-Do");
    fetchTasks();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from("tasks").delete().eq("id", deleteTarget.id);
    if (error) {
      toast.error(error.message || "Failed to delete task");
    } else {
      toast.success("Task deleted");
      fetchTasks();
    }
    setDeleteTarget(null);
  };

  const renderTaskRow = (t: any) => (
    <div key={t.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-accent/30">
      <div className="flex items-center gap-3 min-w-0">
        <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
        <div className="min-w-0">
          <p className="font-medium line-through truncate">{t.title}</p>
          <p className="text-xs text-muted-foreground">
            {t.category && `${t.category} · `}
            {t.projects?.name && `${t.projects.name} · `}
            Completed {formatPH(t.completed_at || t.updated_at, "MMM d, yyyy")} at {formatPH(t.completed_at || t.updated_at, "h:mm a")}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {t.estimated_duration && <Badge variant="outline">{t.estimated_duration} min</Badge>}
        <Button variant="ghost" size="icon" title="Restore" onClick={() => handleRestore(t)}>
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" title="Delete" onClick={() => setDeleteTarget(t)}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Completed</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Showing <strong className="text-foreground">{filteredTasks.length}</strong> of{" "}
            <strong className="text-foreground">{allTasks.length}</strong> completed
            {range !== "all" ? ` · ${RANGES.find((r) => r.value === range)?.label}` : " · All time"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by title..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 w-[220px]"
            />
          </div>
          <Select value={range} onValueChange={(v) => { setRange(v); }}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {totalTasks === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <CheckCircle2 className="mx-auto h-12 w-12 mb-4 opacity-30" />
          <p>No completed tasks in the selected date range</p>
        </CardContent></Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-lg flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                Stand-alone Tasks
                <Badge variant="secondary" className="ml-auto">{standAloneTasks.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {standAloneTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No stand-alone tasks completed</p>
              ) : (
                standAloneTasks.map(renderTaskRow)
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-lg flex items-center gap-2">
                <Folder className="h-4 w-4 text-muted-foreground" />
                Project Tasks
                <Badge variant="secondary" className="ml-auto">{projectTasks.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {projectTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No project tasks completed</p>
              ) : (
                projectTasks.map(renderTaskRow)
              )}
            </CardContent>
          </Card>
        </>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{deleteTarget?.title}". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
