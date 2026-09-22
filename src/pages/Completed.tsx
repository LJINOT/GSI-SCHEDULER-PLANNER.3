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

/** Start of calendar day N days ago in local browser time (ISO for Supabase filter).
 * days=0 → today 00:00:00 local.
 * days=7 → start of the day 6 days before today (7 calendar days including today).
 */
function rangeStartIso(days: number | null): string | null {
  if (days === null) return null;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (days > 0) {
    // Inclusive window of `days` calendar days ending today
    start.setDate(start.getDate() - (days - 1));
  }
  return start.toISOString();
}

/** Completion timestamp for filtering/display: prefer completed_at */
function completionTs(t: { completed_at?: string | null; updated_at?: string | null }): string | null {
  return t.completed_at || t.updated_at || null;
}

export default function Completed() {
  const [allTasks, setAllTasks] = useState<any[]>([]);
  const [range, setRange] = useState("30");
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  /** Load completed tasks for the authenticated user, filtered by completed_at range. */
  const fetchTasks = async (selectedRange: string = range) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setAllTasks([]);
        return;
      }

      const sel = RANGES.find((r) => r.value === selectedRange);
      const startIso = rangeStartIso(sel?.days ?? null);

      // Query key conceptually: ["completed-tasks", userId, selectedRange]
      let q = supabase
        .from("tasks")
        .select("*, projects(name)")
        .eq("status", "done")
        .eq("user_id", user.id)
        .eq("archived", false)
        .order("completed_at", { ascending: false, nullsFirst: false });

      // Prefer completed_at; also accept rows that only have updated_at by not excluding nulls in SQL,
      // then apply completed_at-or-updated_at boundary client-side for safety.
      if (startIso) {
        // Server-side filter: completed_at >= start OR (completed_at is null AND updated_at >= start)
        // Supabase/PostgREST: use or() for the null-completed_at legacy rows
        q = q.or(`completed_at.gte.${startIso},and(completed_at.is.null,updated_at.gte.${startIso})`);
      }

      const { data, error } = await q;
      if (error) {
        // Fallback without or() if schema/API rejects — filter client-side on completed_at
        console.warn("Completed range query:", error.message);
        const { data: fallback } = await supabase
          .from("tasks")
          .select("*, projects(name)")
          .eq("status", "done")
          .eq("user_id", user.id)
          .eq("archived", false)
          .order("updated_at", { ascending: false });
        let list = fallback || [];
        if (startIso) {
          const cutoff = new Date(startIso).getTime();
          list = list.filter((t) => {
            const ts = completionTs(t);
            return ts ? new Date(ts).getTime() >= cutoff : false;
          });
        }
        setAllTasks(list);
      } else {
        // Extra client guard for exact boundary using completed_at
        let list = data || [];
        if (startIso) {
          const cutoff = new Date(startIso).getTime();
          list = list.filter((t) => {
            const ts = completionTs(t);
            return ts ? new Date(ts).getTime() >= cutoff : false;
          });
        }
        setAllTasks(list);
      }
    } finally {
      setLoading(false);
    }
  };

  // Re-fetch whenever the date range changes (must not reuse previous "All" results)
  useEffect(() => {
    fetchTasks(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  // Search is client-side on the already range-filtered set
  const filteredTasks = useMemo(() => {
    let list = allTasks;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((t) => t.title?.toLowerCase().includes(q));
    }
    return list;
  }, [allTasks, search]);

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
            Completed {formatPH(completionTs(t) || t.updated_at, "MMM d, yyyy")} at {formatPH(completionTs(t) || t.updated_at, "h:mm a")}
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
          <p className="text-muted-foreground">{totalTasks} task{totalTasks !== 1 ? "s" : ""} completed</p>
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
          <Select value={range} onValueChange={setRange}>
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
          <p>{loading ? "Loading…" : `No completed tasks in this range`}</p>
          {!loading && range !== "all" && (
            <p className="text-xs mt-2 opacity-70">Try a wider date range or select All time.</p>
          )}
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
