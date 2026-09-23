import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PlusCircle, Search, Archive, Pencil, ChevronDown, ChevronUp, FolderKanban, FileText, History, Folder } from "lucide-react";
import { useSearchParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { formatPH } from "@/lib/date-utils";
import { STATUS_OPTIONS } from "@/lib/status";
import AddTask from "@/pages/AddTask";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority_score: number | null;
  category: string | null;
  difficulty: string | null;
  due_date: string | null;
  start_time: string | null;
  estimated_duration: number | null;
  project_id: string | null;
};

type Project = { id: string; name: string; color: string };

const statusColors: Record<string, string> = {
  todo: "bg-muted text-muted-foreground",
  in_progress: "bg-info/10 text-info",
  done: "bg-success/10 text-success",
};

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [folderProjectId, setFolderProjectId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const taskRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [editErrors, setEditErrors] = useState<{ title?: string }>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Task | null>(null);
  const [editNote, setEditNote] = useState("");
  const [history, setHistory] = useState<Record<string, { id: string; note: string; created_at: string }[]>>({});

  useEffect(() => {
    const taskId = searchParams.get("task");
    const projectId = searchParams.get("project");
    if (projectId) setFolderProjectId(projectId);
    if (taskId) setExpandedTaskId(taskId);
    if (!loading && taskId) {
      setTimeout(() => {
        taskRefs.current[taskId]?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 200);
    }
  }, [searchParams, loading]);

  const fetchAll = async () => {
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      setTasks([]);
      setProjects([]);
      setHistory({});
      setLoading(false);
      if (!user) toast.error("Please sign in to view your tasks.");
      return;
    }
    const uid = user.id;
    const [{ data: t, error }, { data: p }, { data: h }] = await Promise.all([
      supabase.from("tasks").select("*").eq("user_id", uid).eq("archived", false).order("created_at", { ascending: false }),
      supabase.from("projects").select("id, name, color").eq("user_id", uid).eq("archived", false).order("created_at", { ascending: false }),
      supabase.from("task_history").select("id, task_id, note, created_at").eq("user_id", uid).order("created_at", { ascending: false }),
    ]);
    if (error) toast.error(error.message);
    else setTasks(t || []);
    setProjects(p || []);
    const grouped: Record<string, { id: string; note: string; created_at: string }[]> = {};
    for (const row of h || []) {
      (grouped[row.task_id] ||= []).push({ id: row.id, note: row.note, created_at: row.created_at });
    }
    setHistory(grouped);
    setLoading(false);
  };

  const checkStartTimes = useCallback(async () => {
    const now = new Date();
    const tasksToUpdate = tasks.filter(
      t => t.status === "todo" && t.start_time && new Date(t.start_time) <= now
    );
    for (const task of tasksToUpdate) {
      await supabase.from("tasks").update({ status: "in_progress" }).eq("id", task.id);
      toast.info(`"${task.title}" is now in progress!`);
    }
    if (tasksToUpdate.length > 0) fetchAll();
  }, [tasks]);

  useEffect(() => {
    fetchAll();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") fetchAll();
      if (event === "SIGNED_OUT") {
        setTasks([]);
        setProjects([]);
        setHistory({});
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    checkStartTimes();
    const interval = setInterval(checkStartTimes, 30000);
    return () => clearInterval(interval);
  }, [checkStartTimes]);

  const toggleStatus = async (task: Task) => {
    if (task.status === "in_progress") {
      const { error } = await supabase.from("tasks").update({ status: "done" }).eq("id", task.id);
      if (error) toast.error(error.message); else fetchAll();
      return;
    }
    const next = task.status === "done" ? "todo" : "done";
    const { error } = await supabase.from("tasks").update({ status: next }).eq("id", task.id);
    if (error) toast.error(error.message); else fetchAll();
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    const { error } = await supabase.from("tasks")
      .update({ archived: true, archived_at: new Date().toISOString() })
      .eq("id", archiveTarget.id);
    if (error) toast.error(error.message);
    else { toast.success("Task archived — it can be restored later"); fetchAll(); }
    setArchiveTarget(null);
  };

  const toInput = (iso: string | null) => (iso ? formatPH(iso, "yyyy-MM-dd'T'HH:mm") : "");
  const fromInput = (val: string) => (val ? new Date(`${val}:00+08:00`).toISOString() : null);

  const saveEdit = async () => {
    if (!editTask) return;
    const title = editTask.title.trim();
    if (!title) { setEditErrors({ title: "Task title is required." }); return; }
    const dup = tasks.some(t => t.id !== editTask.id && t.title.trim().toLowerCase() === title.toLowerCase());
    if (dup) { setEditErrors({ title: "A task with this title already exists." }); return; }
    setEditErrors({});
    setSavingEdit(true);
    const before = tasks.find(t => t.id === editTask.id);
    const { error } = await supabase.from("tasks").update({
      title,
      description: editTask.description,
      due_date: editTask.due_date,
      start_time: editTask.start_time,
      project_id: editTask.project_id,
    }).eq("id", editTask.id);
    if (!error) {
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (before) {
        for (const key of ["title", "description", "due_date", "start_time", "project_id"] as const) {
          const from = key === "title" ? before.title : (before as any)[key];
          const to = key === "title" ? title : (editTask as any)[key];
          if (from !== to) changes[key] = { from, to };
        }
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (user && (editNote.trim() || Object.keys(changes).length > 0)) {
        await supabase.from("task_history").insert({
          task_id: editTask.id,
          user_id: user.id,
          note: editNote.trim() || "Task details updated",
          changes: changes as any,
        });
      }
    }
    setSavingEdit(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Task updated");
    setEditTask(null);
    setEditNote("");
    fetchAll();
  };

  const setStatus = async (task: Task, next: string) => {
    if (next === task.status) return;
    const { error } = await supabase.from("tasks").update({ status: next }).eq("id", task.id);
    if (error) toast.error(error.message); else fetchAll();
  };

  const q = search.trim().toLowerCase();

  // Single filter pipeline: non-archived tasks (from fetch) → search → status
  // "All Status" means all non-archived statuses including completed (done).
  const filtered = tasks.filter((t) => {
    const projName = projects.find((p) => p.id === t.project_id)?.name?.toLowerCase() || "";
    const matchSearch =
      !q ||
      t.title.toLowerCase().includes(q) ||
      projName.includes(q);
    const matchStatus = statusFilter === "all" || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const standalone = filtered.filter((t) => !t.project_id);
  const tasksByProject = (pid: string) => filtered.filter((t) => t.project_id === pid);

  const visibleProjects = projects.filter((p) => {
    if (!q) return true;
    if (p.name.toLowerCase().includes(q)) return true;
    return tasks.some((t) => t.project_id === p.id && t.title.toLowerCase().includes(q));
  });

  const folderProject = folderProjectId ? projects.find((p) => p.id === folderProjectId) ?? null : null;
  const folderTasks = folderProjectId ? tasksByProject(folderProjectId) : [];

  const renderTask = (task: Task) => {
    const highlighted = searchParams.get("task") === task.id;
    return (
    <Card
      key={task.id}
      ref={(el) => { taskRefs.current[task.id] = el; }}
      className={`hover:shadow-md transition-shadow cursor-pointer ${highlighted ? "ring-2 ring-primary" : ""}`}
      onClick={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
    >
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div onClick={(e) => e.stopPropagation()} className="shrink-0">
              <Select value={task.status} onValueChange={(v) => setStatus(task, v)}>
                <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <p className={`font-medium truncate ${task.status === "done" ? "line-through opacity-60" : ""}`}>{task.title}</p>
              <div className="flex gap-2 text-xs text-muted-foreground">
                {task.start_time && <span>Start: {formatPH(task.start_time, "MMM d, h:mm a")}</span>}
                {task.due_date && <span>Due: {formatPH(task.due_date, "MMM d, h:mm a")}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {task.category && <Badge variant="outline">{task.category}</Badge>}
            {task.difficulty && <Badge variant="secondary">{task.difficulty}</Badge>}
            {task.status !== "done" && (
              <Button variant="ghost" size="icon" title="Edit task" onClick={(e) => { e.stopPropagation(); setEditErrors({}); setEditNote(""); setEditTask(task); }}><Pencil className="h-4 w-4 text-muted-foreground" /></Button>
            )}
            <Button variant="ghost" size="icon" title="Archive task" onClick={(e) => { e.stopPropagation(); setArchiveTarget(task); }}><Archive className="h-4 w-4 text-muted-foreground" /></Button>
            {expandedTaskId === task.id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>
        {expandedTaskId === task.id && (
          <div className="mt-3 pt-3 border-t border-border space-y-3">
            <p className="text-sm text-muted-foreground">{task.description || "No description provided."}</p>
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                <History className="h-3.5 w-3.5 text-muted-foreground" /> Change notes
              </p>
              {(history[task.id]?.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">No changes recorded yet.</p>
              ) : (
                <ul className="space-y-1">
                  {history[task.id].map(h => (
                    <li key={h.id} className="text-xs text-muted-foreground">
                      <span className="text-foreground">{h.note}</span> — {formatPH(h.created_at, "MMM d, yyyy h:mm a")}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
    );
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">Tasks</h1>
        <Button onClick={() => setAddOpen(true)}>
          <PlusCircle className="mr-2 h-4 w-4" /> Add Task
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks or projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="todo">To Do</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="done">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-center py-12">Loading…</p>
      ) : (
        <div className="space-y-6">
          {/* PROJECTS — folder grid with internal scroll */}
          {visibleProjects.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FolderKanban className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    Projects
                  </h2>
                </div>
                <span className="text-xs text-muted-foreground">
                  {visibleProjects.length} project{visibleProjects.length !== 1 ? "s" : ""}
                </span>
              </div>

              <div className="max-h-[340px] overflow-y-auto overflow-x-hidden rounded-lg border bg-card/30 p-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                  {visibleProjects.map((p) => {
                    const pt = tasksByProject(p.id);
                    // progress from all non-archived project tasks (not only filtered status)
                    const allPt = tasks.filter(t => t.project_id === p.id);
                    const done = allPt.filter(t => t.status === "done").length;
                    const total = allPt.length;
                    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setFolderProjectId(p.id)}
                        className="group flex flex-col items-center text-center rounded-xl border bg-card p-3 shadow-sm transition hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[120px]"
                      >
                        <div
                          className="gsi-icon-box mb-2"
                          style={{
                            backgroundColor: `${p.color}22`,
                            color: p.color,
                          }}
                        >
                          <Folder className="h-5 w-5" style={{ color: p.color }} />
                        </div>
                        <p className="text-sm font-semibold leading-tight line-clamp-2 w-full">
                          {p.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {total} task{total !== 1 ? "s" : ""}
                          {total > 0 ? ` · ${pct}%` : ""}
                        </p>
                        {q && pt.length > 0 && (
                          <p className="text-[10px] text-primary mt-0.5 font-medium">
                            {pt.length} match{pt.length !== 1 ? "es" : ""} — open folder
                          </p>
                        )}
                        {total > 0 && (
                          <div className="w-full mt-2 h-1 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary/70 transition-all"
                              style={{ width: `${pct}%`, backgroundColor: p.color }}
                            />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {/* STANDALONE — only tasks with no project */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Standalone Tasks
                </h2>
              </div>
              <span className="text-xs text-muted-foreground">
                {standalone.length} task{standalone.length !== 1 ? "s" : ""}
              </span>
            </div>

            {standalone.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  {q ? "No standalone tasks match your search." : "No standalone tasks."}
                </CardContent>
              </Card>
            ) : (
              <div className="max-h-[400px] overflow-y-auto space-y-2 pr-1">
                {standalone.map(renderTask)}
              </div>
            )}
          </section>

        </div>
      )}

      {/* Project folder modal */}
      <Dialog open={!!folderProject} onOpenChange={(o) => { if (!o) setFolderProjectId(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-3 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 font-display">
              {folderProject && (
                <Folder className="h-5 w-5 shrink-0" style={{ color: folderProject.color }} />
              )}
              <span className="truncate">{folderProject?.name}</span>
            </DialogTitle>
            {folderProject && (
              <p className="text-sm text-muted-foreground">
                {(() => {
                  const allPt = tasks.filter(t => t.project_id === folderProject.id);
                  const done = allPt.filter(t => t.status === "done").length;
                  return `${done} of ${allPt.length} tasks completed`;
                })()}
              </p>
            )}
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2 min-h-0">
            {folderTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No tasks in this project for the current filters.
              </p>
            ) : (
              folderTasks.map(renderTask)
            )}
          </div>
          <div className="border-t px-6 py-3 shrink-0 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setFolderProjectId(null); setAddOpen(true); }}
            >
              <PlusCircle className="mr-2 h-4 w-4" /> Add Task
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Task</DialogTitle></DialogHeader>
          <AddTask embedded onCreated={() => { setAddOpen(false); fetchAll(); }} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTask} onOpenChange={(o) => { if (!o) { setEditTask(null); setEditErrors({}); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Task</DialogTitle></DialogHeader>
          {editTask && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input value={editTask.title} onChange={(e) => setEditTask({ ...editTask, title: e.target.value })} />
                {editErrors.title && <p className="text-xs text-destructive">{editErrors.title}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea value={editTask.description || ""} onChange={(e) => setEditTask({ ...editTask, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Start</Label>
                  <Input type="datetime-local" value={toInput(editTask.start_time)} onChange={(e) => setEditTask({ ...editTask, start_time: fromInput(e.target.value) })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Due</Label>
                  <Input type="datetime-local" value={toInput(editTask.due_date)} onChange={(e) => setEditTask({ ...editTask, due_date: fromInput(e.target.value) })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Project</Label>
                <Select value={editTask.project_id ?? "none"} onValueChange={(v) => setEditTask({ ...editTask, project_id: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Stand-alone Task</SelectItem>
                    {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Reason for this change (optional)</Label>
                <Textarea
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder="e.g. Client moved the deadline"
                  rows={2}
                />
                <p className="text-xs text-muted-foreground">Saved as a note you can review in the task's change history.</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditTask(null); setEditNote(""); }}>Cancel</Button>
            <Button onClick={saveEdit} disabled={savingEdit}>{savingEdit ? "Saving..." : "Save changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!archiveTarget} onOpenChange={(o) => { if (!o) setArchiveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive task?</AlertDialogTitle>
            <AlertDialogDescription>
              "{archiveTarget?.title}" will be moved out of your lists but kept on record, so nothing is lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmArchive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
