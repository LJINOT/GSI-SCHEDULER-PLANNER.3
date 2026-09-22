import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { PlusCircle, Archive, FolderKanban, Pencil, ChevronDown, ChevronUp } from "lucide-react";
import { formatPH } from "@/lib/date-utils";

type Project = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  status: string;
};

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  due_date: string | null;
  start_time: string | null;
  estimated_duration: number | null;
  project_id: string | null;
};

const COLORS = ["#6366f1", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#ec4899", "#8b5cf6", "#14b8a6"];

const statusColors: Record<string, string> = {
  todo: "bg-muted text-muted-foreground",
  in_progress: "bg-info/10 text-info",
  done: "bg-success/10 text-success",
};

const TASK_LIST_LIMIT = 3;

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams] = useSearchParams();
  const projectRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const highlightId = searchParams.get("project");

  // create/edit project dialog
  const [open, setOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [nameError, setNameError] = useState("");

  // delete project confirmation
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<Project | null>(null);

  // expanded task lists per project
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  // cards vs kanban board view
  const [view, setView] = useState<"cards" | "board">("cards");
  // status filter per project
  const [projectFilters, setProjectFilters] = useState<Record<string, 'all' | 'todo' | 'in_progress' | 'done'>>({});

  // edit task dialog
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskStartTime, setTaskStartTime] = useState("");
  const [taskDuration, setTaskDuration] = useState("");
  const [taskStatus, setTaskStatus] = useState("todo");
  const [taskTitleError, setTaskTitleError] = useState("");

  // delete task confirmation
  const [deleteTaskTarget, setDeleteTaskTarget] = useState<Task | null>(null);

  useEffect(() => {
    if (highlightId && !loading) {
      setTimeout(() => {
        projectRefs.current[highlightId]?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 200);
      setExpandedProjects((prev) => ({ ...prev, [highlightId]: true }));
    }
  }, [highlightId, loading]);

  const fetchAll = async () => {
    const [{ data: p }, { data: t }] = await Promise.all([
      supabase.from("projects").select("*").eq("archived", false).order("created_at", { ascending: false }),
      supabase.from("tasks").select("id, title, description, status, due_date, start_time, estimated_duration, project_id").eq("archived", false),
    ]);
    setProjects(p || []);
    setTasks(t || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const resetProjectForm = () => {
    setName(""); setDescription(""); setColor(COLORS[0]); setNameError(""); setEditingProject(null);
  };

  const openCreateDialog = () => {
    resetProjectForm();
    setOpen(true);
  };

  const openEditDialog = (p: Project) => {
    setEditingProject(p);
    setName(p.name);
    setDescription(p.description || "");
    setColor(p.color);
    setNameError("");
    setOpen(true);
  };

  const saveProject = async () => {
    if (!name.trim()) { setNameError("Project name is required"); return; }
    setNameError("");

    if (editingProject) {
      const { error } = await supabase.from("projects").update({
        name: name.trim(), description: description.trim() || null, color,
      }).eq("id", editingProject.id);
      if (error) toast.error(error.message);
      else {
        toast.success("Project updated");
        resetProjectForm(); setOpen(false);
        fetchAll();
      }
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("projects").insert({
      user_id: user.id, name: name.trim(), description: description.trim() || null, color,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Project created");
      resetProjectForm(); setOpen(false);
      fetchAll();
    }
  };

  const confirmDeleteProject = async () => {
    if (!deleteProjectTarget) return;
    const { error } = await supabase.from("projects")
      .update({ archived: true, archived_at: new Date().toISOString() })
      .eq("id", deleteProjectTarget.id);
    if (error) toast.error(error.message);
    else { toast.success("Project archived — it can be restored later"); fetchAll(); }
    setDeleteProjectTarget(null);
  };

  const statsFor = (projectId: string) => {
    const t = tasks.filter(x => x.project_id === projectId);
    const done = t.filter(x => x.status === "done").length;
    const pct = t.length === 0 ? 0 : Math.round((done / t.length) * 100);
    return { total: t.length, done, pct };
  };

  const tasksFor = (projectId: string) => tasks.filter(x => x.project_id === projectId);

  const toDatetimeLocal = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const openEditTaskDialog = (t: Task) => {
    setEditingTask(t);
    setTaskTitle(t.title);
    setTaskDescription(t.description || "");
    setTaskDueDate(toDatetimeLocal(t.due_date));
    setTaskStartTime(toDatetimeLocal(t.start_time));
    setTaskDuration(t.estimated_duration ? String(t.estimated_duration) : "");
    setTaskStatus(t.status);
    setTaskTitleError("");
    setTaskDialogOpen(true);
  };

  const saveTask = async () => {
    if (taskStart && taskDue && new Date(taskStart) >= new Date(taskDue)) {
      toast.error("Start time must be earlier than due date/time");
      return;
    }
    if (taskDuration !== "" && taskDuration != null && !(Number(taskDuration) > 0)) {
      toast.error("Duration must be greater than 0");
      return;
    }

    if (!taskTitle.trim()) { setTaskTitleError("Task title is required"); return; }
    setTaskTitleError("");
    if (!editingTask) return;

    const { error } = await supabase.from("tasks").update({
      title: taskTitle.trim(),
      description: taskDescription.trim() || null,
      due_date: taskDueDate ? new Date(taskDueDate).toISOString() : null,
      start_time: taskStartTime ? new Date(taskStartTime).toISOString() : null,
      estimated_duration: taskDuration ? Number(taskDuration) : null,
      status: taskStatus,
    }).eq("id", editingTask.id);

    if (error) toast.error(error.message);
    else {
      toast.success("Task updated");
      setTaskDialogOpen(false);
      setEditingTask(null);
      fetchAll();
    }
  };

  const confirmDeleteTask = async () => {
    if (!deleteTaskTarget) return;
    const { error } = await supabase.from("tasks")
      .update({ archived: true, archived_at: new Date().toISOString() })
      .eq("id", deleteTaskTarget.id);
    if (error) toast.error(error.message);
    else { toast.success("Task archived — it can be restored later"); fetchAll(); }
    setDeleteTaskTarget(null);
  };

  const moveTask = async (task: Task, status: string) => {
    if (task.status === status) return;
    setTasks(prev => prev.map(t => (t.id === task.id ? { ...t, status } : t)));
    const { error } = await supabase.from("tasks").update({ status }).eq("id", task.id);
    if (error) { toast.error(error.message); fetchAll(); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Projects</h1>
          <p className="text-muted-foreground mt-1">Group related tasks into folders for cleaner organization</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            {([{ key: "cards", label: "Cards" }, { key: "board", label: "Board" }] as const).map(v => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                className={`px-3 py-1.5 text-xs transition-colors ${view === v.key ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
              >
                {v.label}
              </button>
            ))}
          </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetProjectForm(); }}>
          <DialogTrigger asChild>
            <Button onClick={openCreateDialog}><PlusCircle className="mr-2 h-4 w-4" />New Project</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editingProject ? "Edit Project" : "Create Project"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={name} maxLength={255}
                  onChange={(e) => { setName(e.target.value); if (e.target.value.trim()) setNameError(""); }}
                  placeholder="e.g. Thesis Research"
                />
                {nameError && <p className="text-sm text-destructive">{nameError}</p>}
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setColor(c)}
                      className={`h-7 w-7 rounded-full border-2 ${color === c ? "border-foreground" : "border-transparent"}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setOpen(false); resetProjectForm(); }}>Cancel</Button>
              <Button onClick={saveProject}>{editingProject ? "Save" : "Create"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : projects.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <FolderKanban className="mx-auto h-12 w-12 mb-4 opacity-30" />
          <p>No projects yet. Create one to start grouping tasks.</p>
        </CardContent></Card>
      ) : view === "board" ? (
        <div className="grid gap-4 md:grid-cols-3">
          {([
            { key: "todo", label: "To Do" },
            { key: "in_progress", label: "In Progress" },
            { key: "done", label: "Done" },
          ] as const).map(col => {
            const colTasks = tasks.filter(t => t.project_id && t.status === col.key);
            return (
              <Card key={col.key} className="bg-muted/30">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    {col.label}
                    <Badge variant="outline">{colTasks.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 max-h-[65vh] overflow-y-auto">
                  {colTasks.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">Nothing here yet.</p>
                  ) : colTasks.map(t => {
                    const proj = projects.find(p => p.id === t.project_id);
                    return (
                      <div key={t.id} className="rounded-md border border-border bg-background p-2.5 space-y-2">
                        <p className="text-sm font-medium">{t.title}</p>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          {proj && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: proj.color }} />}
                          <span className="truncate">{proj?.name}</span>
                          {t.due_date && <span className="ml-auto shrink-0">Due {formatPH(t.due_date, "MMM d, h:mm a")}</span>}
                        </div>
                        <Select value={t.status} onValueChange={(v) => moveTask(t, v)}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="todo">To Do</SelectItem>
                            <SelectItem value="in_progress">In Progress</SelectItem>
                            <SelectItem value="done">Done</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map(p => {
            const s = statsFor(p.id);
            const projectTasks = tasksFor(p.id);
            const filter = projectFilters[p.id] || 'all';
            const filteredTasks = filter === 'all' ? projectTasks : projectTasks.filter(t => t.status === filter);
            const isExpanded = !!expandedProjects[p.id];
            const visibleTasks = isExpanded ? filteredTasks : filteredTasks.slice(0, TASK_LIST_LIMIT);
            const hasMore = filteredTasks.length > TASK_LIST_LIMIT;

            return (
              <Card
                key={p.id}
                ref={(el) => { projectRefs.current[p.id] = el; }}
                className={`hover:shadow-md transition-shadow ${highlightId === p.id ? "ring-2 ring-primary" : ""}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                      <CardTitle className="text-base truncate">{p.name}</CardTitle>
                    </div>
                    <div className="flex items-center shrink-0">
                      <Button variant="ghost" size="icon" onClick={() => openEditDialog(p)}>
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Archive project" onClick={() => setDeleteProjectTarget(p)}>
                        <Archive className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {p.description && <p className="text-sm text-muted-foreground line-clamp-2">{p.description}</p>}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{s.done}/{s.total} completed</span>
                    <Badge variant="outline">{s.pct}%</Badge>
                  </div>
                  <Progress value={s.pct} className="h-2" />

                  <div className="pt-2 border-t border-border">
                    {projectTasks.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-1">No tasks assigned to this project.</p>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {[
                            { key: 'all' as const, label: 'All' },
                            { key: 'todo' as const, label: 'To Do' },
                            { key: 'in_progress' as const, label: 'In Progress' },
                            { key: 'done' as const, label: 'Done' },
                          ].map((f) => (
                            <button
                              key={f.key}
                              onClick={() => setProjectFilters(prev => ({ ...prev, [p.id]: f.key }))}
                              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                                filter === f.key
                                  ? 'bg-primary text-primary-foreground border-primary'
                                  : 'bg-background text-muted-foreground border-border hover:border-muted-foreground/50'
                              }`}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>
                        {filteredTasks.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-1">No tasks match this filter.</p>
                        ) : (
                          <div className="space-y-2">
                            {visibleTasks.map(t => (
                              <div key={t.id} className="group flex items-start justify-between gap-2 p-2 rounded-md border border-border bg-background hover:bg-muted/50 transition-colors">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium truncate">{t.title}</p>
                                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                    <Badge className={`text-[10px] px-1.5 py-0 ${statusColors[t.status] || 'bg-muted text-muted-foreground'}`}>
                                      {t.status.replace('_', ' ')}
                                    </Badge>
                                    {t.start_time && (
                                      <span className="text-[10px] text-muted-foreground">{formatPH(t.start_time, 'MMM d, h:mm a')}</span>
                                    )}
                                    {t.due_date && !t.start_time && (
                                      <span className="text-[10px] text-muted-foreground">Due {formatPH(t.due_date, 'MMM d, h:mm a')}</span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center shrink-0 opacity-80 group-hover:opacity-100">
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditTaskDialog(t)}>
                                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Archive task" onClick={() => setDeleteTaskTarget(t)}>
                                    <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                            {hasMore && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full text-xs h-7"
                                onClick={() => setExpandedProjects(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                              >
                                {isExpanded ? (
                                  <>Show less <ChevronUp className="ml-1 h-3.5 w-3.5" /></>
                                ) : (
                                  <>Show {filteredTasks.length - TASK_LIST_LIMIT} more <ChevronDown className="ml-1 h-3.5 w-3.5" /></>
                                )}
                              </Button>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete project confirmation */}
      <AlertDialog open={!!deleteProjectTarget} onOpenChange={(o) => { if (!o) setDeleteProjectTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive project?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteProjectTarget?.name}" will be moved out of your lists but kept on record, so nothing is lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteProject}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit task dialog */}
      <Dialog open={taskDialogOpen} onOpenChange={(o) => { setTaskDialogOpen(o); if (!o) { setEditingTask(null); setTaskTitleError(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Task</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={taskTitle}
                onChange={(e) => { setTaskTitle(e.target.value); if (e.target.value.trim()) setTaskTitleError(""); }}
              />
              {taskTitleError && <p className="text-sm text-destructive">{taskTitleError}</p>}
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={taskDescription} onChange={(e) => setTaskDescription(e.target.value)} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Time</Label>
                <Input type="datetime-local" value={taskStartTime} onChange={(e) => setTaskStartTime(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input type="datetime-local" value={taskDueDate} onChange={(e) => setTaskDueDate(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Estimated Duration (min)</Label>
                <Input type="number" min={0} value={taskDuration} onChange={(e) => setTaskDuration(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={taskStatus} onValueChange={setTaskStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todo">To Do</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="done">Done</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTaskDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveTask}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete task confirmation */}
      <AlertDialog open={!!deleteTaskTarget} onOpenChange={(o) => { if (!o) setDeleteTaskTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive task?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTaskTarget?.title}" will be moved out of your lists but kept on record, so nothing is lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteTask}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
