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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PlusCircle, Search, Archive, Pencil, ChevronDown, ChevronUp, FolderKanban, FileText, History } from "lucide-react";
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
  const [openProjects, setOpenProjects] = useState<string[]>([]);
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
    if (projectId) setOpenProjects(prev => prev.includes(projectId) ? prev : [...prev, projectId]);
    if (taskId) setExpandedTaskId(taskId);
    if (!loading && (taskId || projectId)) {
      const target = taskId || `project-${projectId}`;
      setTimeout(() => {
        taskRefs.current[target]?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 200);
    }
  }, [searchParams, loading]);

  const fetchAll = async () => {
    const [{ data: t, error }, { data: p }, { data: h }] = await Promise.all([
      supabase.from("tasks").select("*").eq("archived", false).order("created_at", { ascending: false }),
      supabase.from("projects").select("id, name, color").eq("archived", false).order("created_at", { ascending: false }),
      supabase.from("task_history").select("id, task_id, note, created_at").order("created_at", { ascending: false }),
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

  useEffect(() => { fetchAll(); }, []);

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

  const filtered = tasks.filter((t) => {
    const matchSearch = t.title.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || t.status === statusFilter;
    // Completed tasks live on the Completed page — only show them when explicitly filtered
    if (t.status === "done" && statusFilter !== "done") return false;
    return matchSearch && matchStatus;
  });

  const standalone = filtered.filter(t => !t.project_id);
  const tasksByProject = (pid: string) => filtered.filter(t => t.project_id === pid);

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
                <History className="h-3.5 w-3.5" /> Change notes
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
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Tasks</h1>
        <Button onClick={() => setAddOpen(true)}><PlusCircle className="mr-2 h-4 w-4" /> Add Task</Button>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search tasks..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="todo">To Do</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="done">Done</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No tasks found. <Link to="/add-task" className="text-primary hover:underline">Create one?</Link></CardContent></Card>
      ) : (
        <div className="space-y-6">
{projects.length > 0 && (
  <div>
    <div className="flex items-center gap-2 mb-3">
      <FolderKanban className="h-4 w-4 text-muted-foreground" />
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Projects
      </h2>
    </div>

    <Accordion
      type="multiple"
      value={openProjects}
      onValueChange={setOpenProjects}
      className="space-y-3"
    >
      {projects.map((p) => {
        const pt = tasksByProject(p.id);
        const done = pt.filter((t) => t.status === "done").length;
        const pct = pt.length === 0 ? 0 : Math.round((done / pt.length) * 100);

        return (
          <AccordionItem
            key={p.id}
            value={p.id}
            ref={(el) => {
              taskRefs.current[`project-${p.id}`] = el as unknown as HTMLDivElement;
            }}
            className="border-0 bg-transparent"
          >
            {/* Folder-style trigger */}
            <AccordionTrigger className="hover:no-underline p-0 [&>svg]:hidden group">
              <div className="w-full flex items-stretch gap-0 rounded-xl overflow-hidden border bg-card hover:shadow-md transition-shadow text-left">
                {/* Colored spine */}
                <div
                  className="w-3 shrink-0"
                  style={{ backgroundColor: p.color }}
                />

                {/* Folder face */}
                <div className="flex-1 min-w-0 px-4 py-3 flex items-center gap-4">
                  {/* Folder icon */}
                  <div
                    className="relative h-11 w-12 shrink-0 rounded-md flex items-center justify-center"
                    style={{
                      backgroundColor: `${p.color}22`,
                      border: `1.5px solid ${p.color}55`,
                    }}
                  >
                    <div
                      className="absolute top-1 left-1 right-1 h-2 rounded-t-sm"
                      style={{ backgroundColor: p.color, opacity: 0.7 }}
                    />
                    <FolderKanban
                      className="h-5 w-5 relative z-10"
                      style={{ color: p.color }}
                    />
                  </div>

                  {/* Name + count + progress */}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate leading-tight">
                      {p.name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {done}/{pt.length} tasks
                      {pt.length > 0 && ` · ${pct}% complete`}
                    </p>
                    <Progress value={pct} className="h-1.5 mt-1.5" />
                  </div>

                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </div>
              </div>
            </AccordionTrigger>

            <AccordionContent className="pt-2 pb-1 px-1">
              {pt.length === 0 ? (
                <p className="text-sm text-muted-foreground py-3 px-3">
                  No tasks in this project.
                </p>
              ) : (
                <div className="space-y-2 rounded-lg border bg-muted/30 p-2">
                  {pt.map(renderTask)}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  </div>
)}

          {standalone.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Stand-alone Tasks</h2>
              </div>
              <div className="space-y-2">{standalone.map(renderTask)}</div>
            </div>
          )}
        </div>
      )}

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
