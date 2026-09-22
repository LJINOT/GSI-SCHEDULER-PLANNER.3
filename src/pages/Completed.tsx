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
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "90", label: "Last 90 days", days: 90 },
  { value: "365", label: "Last year", days: 365 },
  { value: "all", label: "All time", days: null },
];

export default function Completed() {
  const [allTasks, setAllTasks] = useState<any[]>([]);
  const [range, setRange] = useState("30");
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  const fetchTasks = () => {
    supabase
      .from("tasks")
      .select("*, projects(name)")
      .eq("status", "done")
      .order("updated_at", { ascending: false })
      .then(({ data }) => setAllTasks(data || []));
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const filteredTasks = useMemo(() => {
    const sel = RANGES.find((r) => r.value === range);
    let list = allTasks;
    if (sel?.days) {
      const cutoff = Date.now() - sel.days * 24 * 60 * 60 * 1000;
      list = list.filter((t) => new Date(t.updated_at).getTime() >= cutoff);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((t) => t.title?.toLowerCase().includes(q));
    }
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
    const { error } = await supabase.from("tasks").update({
      archived: true,
      archived_at: new Date().toISOString(),
    }).eq("id", deleteTarget.id);
    if (error) {
      toast.error(error.message || "Failed to delete task");
    } else {
      toast.success("Task archived");
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
            Completed {formatPH(t.updated_at, "MMM d, yyyy")} at {formatPH(t.updated_at, "h:mm a")}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {t.estimated_duration && <Badge variant="outline">{t.estimated_duration} min</Badge>}
        <Button variant="ghost" size="icon" title="Restore" onClick={() => handleRestore(t)}>
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" title="Archive" onClick={() => setDeleteTarget(t)}>
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
          <p>No completed tasks in this range</p>
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
              This will archive "{deleteTarget?.title}". You can restore it later from archived tasks. It will not be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
