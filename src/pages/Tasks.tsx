import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  PlusCircle,
  Search,
  Archive,
  Pencil,
  ChevronDown,
  ChevronUp,
  FolderKanban,
  FileText,
  History,
} from "lucide-react";
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

type Project = {
  id: string;
  name: string;
  color: string;
};

type TaskHistory = {
  id: string;
  task_id: string;
  note: string;
  created_at: string;
};

type TaskChange = {
  from: unknown;
  to: unknown;
};

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

  // Stores the note entered in the Edit Task dialog.
  const [editNote, setEditNote] = useState("");

  // Task history grouped by task ID.
  const [history, setHistory] = useState<
    Record<string, { id: string; note: string; created_at: string }[]>
  >({});

  useEffect(() => {
    const taskId = searchParams.get("task");
    const projectId = searchParams.get("project");

    if (projectId) {
      setOpenProjects((prev) =>
        prev.includes(projectId) ? prev : [...prev, projectId]
      );
    }

    if (taskId) {
      setExpandedTaskId(taskId);
    }

    if (!loading && (taskId || projectId)) {
      const target = taskId || `project-${projectId}`;

      setTimeout(() => {
        taskRefs.current[target]?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 200);
    }
  }, [searchParams, loading]);

  /**
   * Fetch tasks, projects, and task history.
   */
  const fetchAll = async () => {
    setLoading(true);

    const [
      { data: taskData, error: taskError },
      { data: projectData, error: projectError },
      { data: historyData, error: historyError },
    ] = await Promise.all([
      supabase
        .from("tasks")
        .select("*")
        .eq("archived", false)
        .order("created_at", { ascending: false }),

      supabase
        .from("projects")
        .select("id, name, color")
        .eq("archived", false)
        .order("created_at", { ascending: false }),

      supabase
        .from("task_history")
        .select("id, task_id, note, created_at")
        .order("created_at", { ascending: false }),
    ]);

    if (taskError) {
      console.error("Failed to load tasks:", taskError);
      toast.error(`Failed to load tasks: ${taskError.message}`);
    } else {
      setTasks(taskData || []);
    }

    if (projectError) {
      console.error("Failed to load projects:", projectError);
      toast.error(`Failed to load projects: ${projectError.message}`);
    } else {
      setProjects(projectData || []);
    }

    if (historyError) {
      console.error("Failed to load task history:", historyError);

      /*
       * Do not silently fail here.
       *
       * If the task_history table or RLS policy is incorrect,
       * the user needs to know that the history cannot be loaded.
       */
      toast.error(`Failed to load change history: ${historyError.message}`);

      setHistory({});
    } else {
      const grouped: Record<
        string,
        { id: string; note: string; created_at: string }[]
      > = {};

      for (const row of historyData || []) {
        if (!row.task_id) continue;

        (grouped[row.task_id] ||= []).push({
          id: row.id,
          note: row.note,
          created_at: row.created_at,
        });
      }

      setHistory(grouped);
    }

    setLoading(false);
  };

  const checkStartTimes = useCallback(async () => {
    const now = new Date();

    const tasksToUpdate = tasks.filter(
      (task) =>
        task.status === "todo" &&
        task.start_time &&
        new Date(task.start_time) <= now
    );

    for (const task of tasksToUpdate) {
      const { error } = await supabase
        .from("tasks")
        .update({ status: "in_progress" })
        .eq("id", task.id);

      if (error) {
        console.error(
          `Failed to update task "${task.title}" status:`,
          error
        );
      } else {
        toast.info(`"${task.title}" is now in progress!`);
      }
    }

    if (tasksToUpdate.length > 0) {
      await fetchAll();
    }
  }, [tasks]);

  useEffect(() => {
    fetchAll();
  }, []);

  useEffect(() => {
    checkStartTimes();

    const interval = setInterval(checkStartTimes, 30000);

    return () => clearInterval(interval);
  }, [checkStartTimes]);

  /**
   * Toggle task status.
   */
  const toggleStatus = async (task: Task) => {
    if (task.status === "in_progress") {
      const { error } = await supabase
        .from("tasks")
        .update({ status: "done" })
        .eq("id", task.id);

      if (error) {
        toast.error(error.message);
      } else {
        await fetchAll();
      }

      return;
    }

    const next = task.status === "done" ? "todo" : "done";

    const { error } = await supabase
      .from("tasks")
      .update({ status: next })
      .eq("id", task.id);

    if (error) {
      toast.error(error.message);
    } else {
      await fetchAll();
    }
  };

  /**
   * Archive a task.
   */
  const confirmArchive = async () => {
    if (!archiveTarget) return;

    const { error } = await supabase
      .from("tasks")
      .update({
        archived: true,
        archived_at: new Date().toISOString(),
      })
      .eq("id", archiveTarget.id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Task archived — it can be restored later");
      await fetchAll();
    }

    setArchiveTarget(null);
  };

  /**
   * Convert database ISO timestamp to Philippine datetime-local value.
   */
  const toInput = (iso: string | null) =>
    iso ? formatPH(iso, "yyyy-MM-dd'T'HH:mm") : "";

  /**
   * Convert datetime-local value to ISO timestamp using Asia/Manila.
   */
  const fromInput = (val: string) =>
    val ? new Date(`${val}:00+08:00`).toISOString() : null;

  /**
   * Save edited task and its change note.
   *
   * IMPORTANT:
   * The task update and task history insert are handled separately.
   * Both operations are checked for errors.
   */
  const saveEdit = async () => {
    if (!editTask) return;

    const title = editTask.title.trim();

    // Validate title.
    if (!title) {
      setEditErrors({
        title: "Task title is required.",
      });
      return;
    }

    // Check for duplicate title.
    const duplicateTask = tasks.some(
      (task) =>
        task.id !== editTask.id &&
        task.title.trim().toLowerCase() === title.toLowerCase()
    );

    if (duplicateTask) {
      setEditErrors({
        title: "A task with this title already exists.",
      });
      return;
    }

    setEditErrors({});
    setSavingEdit(true);

    try {
      /*
       * Get the original task before updating it.
       */
      const before = tasks.find((task) => task.id === editTask.id);

      if (!before) {
        toast.error("The original task could not be found.");
        return;
      }

      /*
       * Determine what actually changed.
       */
      const changes: Record<string, TaskChange> = {};

      const fieldsToCompare = [
        "title",
        "description",
        "due_date",
        "start_time",
        "project_id",
      ] as const;

      for (const key of fieldsToCompare) {
        const oldValue =
          key === "title"
            ? before.title
            : before[key];

        const newValue =
          key === "title"
            ? title
            : editTask[key];

        if (oldValue !== newValue) {
          changes[key] = {
            from: oldValue,
            to: newValue,
          };
        }
      }

      const note = editNote.trim();

      /*
       * Update the task.
       */
      const { error: taskUpdateError } = await supabase
        .from("tasks")
        .update({
          title,
          description: editTask.description,
          due_date: editTask.due_date,
          start_time: editTask.start_time,
          project_id: editTask.project_id,
        })
        .eq("id", editTask.id);

      /*
       * IMPORTANT:
       * Stop here if the actual task update failed.
       */
      if (taskUpdateError) {
        console.error("Failed to update task:", taskUpdateError);

        toast.error(
          `Failed to update task: ${taskUpdateError.message}`
        );

        return;
      }

      /*
       * Save change history if:
       *
       * 1. The user entered a note, OR
       * 2. There were actual task changes.
       */
      if (note || Object.keys(changes).length > 0) {
        /*
         * Get the currently authenticated user.
         */
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) {
          console.error(
            "Failed to get authenticated user:",
            userError
          );

          toast.error(
            `Task updated, but the change note could not be saved: ${userError.message}`
          );

          return;
        }

        if (!user) {
          toast.error(
            "Task updated, but no authenticated user was found. The change note was not saved."
          );

          return;
        }

        /*
         * IMPORTANT:
         * Check the task_history INSERT response.
         */
        const {
          data: insertedHistory,
          error: historyInsertError,
        } = await supabase
          .from("task_history")
          .insert({
            task_id: editTask.id,
            user_id: user.id,
            note: note || "Task details updated",
            changes,
          })
          .select("id, task_id, note, created_at")
          .single();

        /*
         * This is the important fix.
         *
         * Previously the application ignored this error.
         */
        if (historyInsertError) {
          console.error(
            "Failed to save task history:",
            historyInsertError
          );

          toast.error(
            `Task updated, but the change note could not be saved: ${historyInsertError.message}`
          );

          /*
           * Keep the edit dialog open so the user can retry
           * instead of silently losing the note.
           */
          return;
        }

        /*
         * Immediately update the local history state.
         *
         * This makes the new note appear without relying only
         * on fetchAll().
         */
        if (insertedHistory) {
          setHistory((previous) => ({
            ...previous,
            [editTask.id]: [
              {
                id: insertedHistory.id,
                note: insertedHistory.note,
                created_at: insertedHistory.created_at,
              },
              ...(previous[editTask.id] || []),
            ],
          }));
        }
      }

      /*
       * Everything succeeded.
       */
      toast.success(
        note
          ? "Task and change note saved successfully"
          : "Task updated successfully"
      );

      /*
       * Close the dialog and clear the note.
       */
      setEditTask(null);
      setEditNote("");
      setEditErrors({});

      /*
       * Refresh tasks/history from Supabase.
       */
      await fetchAll();
    } catch (err) {
      console.error("Unexpected error while saving task:", err);

      const message =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred.";

      toast.error(`Failed to save task: ${message}`);
    } finally {
      setSavingEdit(false);
    }
  };

  /**
   * Change task status.
   */
  const setStatus = async (task: Task, next: string) => {
    if (next === task.status) return;

    const { error } = await supabase
      .from("tasks")
      .update({ status: next })
      .eq("id", task.id);

    if (error) {
      toast.error(error.message);
    } else {
      await fetchAll();
    }
  };

  /**
   * Filter tasks.
   */
  const filtered = tasks.filter((task) => {
    const matchSearch = task.title
      .toLowerCase()
      .includes(search.toLowerCase());

    const matchStatus =
      statusFilter === "all" ||
      task.status === statusFilter;

    /*
     * Completed tasks live on the Completed page.
     * Only show them when Done is explicitly selected.
     */
    if (
      task.status === "done" &&
      statusFilter !== "done"
    ) {
      return false;
    }

    return matchSearch && matchStatus;
  });

  const standalone = filtered.filter(
    (task) => !task.project_id
  );

  const tasksByProject = (projectId: string) =>
    filtered.filter(
      (task) => task.project_id === projectId
    );

  /**
   * Render a task card.
   */
  const renderTask = (task: Task) => {
    const highlighted =
      searchParams.get("task") === task.id;

    return (
      <Card
        key={task.id}
        ref={(element) => {
          taskRefs.current[task.id] = element;
        }}
        className={`hover:shadow-md transition-shadow cursor-pointer ${
          highlighted ? "ring-2 ring-primary" : ""
        }`}
        onClick={() =>
          setExpandedTaskId(
            expandedTaskId === task.id
              ? null
              : task.id
          )
        }
      >
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div
                onClick={(event) =>
                  event.stopPropagation()
                }
                className="shrink-0"
              >
                <Select
                  value={task.status}
                  onValueChange={(value) =>
                    setStatus(task, value)
                  }
                >
                  <SelectTrigger className="h-8 w-36 text-xs">
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    {STATUS_OPTIONS.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-0">
                <p
                  className={`font-medium truncate ${
                    task.status === "done"
                      ? "line-through opacity-60"
                      : ""
                  }`}
                >
                  {task.title}
                </p>

                <div className="flex gap-2 text-xs text-muted-foreground">
                  {task.start_time && (
                    <span>
                      Start:{" "}
                      {formatPH(
                        task.start_time,
                        "MMM d, h:mm a"
                      )}
                    </span>
                  )}

                  {task.due_date && (
                    <span>
                      Due:{" "}
                      {formatPH(
                        task.due_date,
                        "MMM d, h:mm a"
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {task.category && (
                <Badge variant="outline">
                  {task.category}
                </Badge>
              )}

              {task.difficulty && (
                <Badge variant="secondary">
                  {task.difficulty}
                </Badge>
              )}

              {task.status !== "done" && (
                <Button
                  variant="ghost"
                  size="icon"
                  title="Edit task"
                  onClick={(event) => {
                    event.stopPropagation();

                    setEditErrors({});
                    setEditNote("");
                    setEditTask(task);
                  }}
                >
                  <Pencil className="h-4 w-4 text-muted-foreground" />
                </Button>
              )}

              <Button
                variant="ghost"
                size="icon"
                title="Archive task"
                onClick={(event) => {
                  event.stopPropagation();
                  setArchiveTarget(task);
                }}
              >
                <Archive className="h-4 w-4 text-muted-foreground" />
              </Button>

              {expandedTaskId === task.id ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>

          {expandedTaskId === task.id && (
            <div className="mt-3 pt-3 border-t border-border space-y-3">
              <p className="text-sm text-muted-foreground">
                {task.description ||
                  "No description provided."}
              </p>

              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  <History className="h-3.5 w-3.5" />
                  Change notes
                </p>

                {(history[task.id]?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No changes recorded yet.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {history[task.id].map((item) => (
                      <li
                        key={item.id}
                        className="text-xs text-muted-foreground"
                      >
                        <span className="text-foreground">
                          {item.note}
                        </span>{" "}
                        —{" "}
                        {formatPH(
                          item.created_at,
                          "MMM d, yyyy h:mm a"
                        )}
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
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">
          Tasks
        </h1>

        <Button onClick={() => setAddOpen(true)}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Task
        </Button>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />

          <Input
            placeholder="Search tasks..."
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            className="pl-9"
          />
        </div>

        <Select
          value={statusFilter}
          onValueChange={setStatusFilter}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value="all">
              All Status
            </SelectItem>

            <SelectItem value="todo">
              To Do
            </SelectItem>

            <SelectItem value="in_progress">
              In Progress
            </SelectItem>

            <SelectItem value="done">
              Done
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No tasks found.{" "}
            <Link
              to="/add-task"
              className="text-primary hover:underline"
            >
              Create one?
            </Link>
          </CardContent>
        </Card>
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
                {projects.map((project) => {
                  const projectTasks =
                    tasksByProject(project.id);

                  const done =
                    projectTasks.filter(
                      (task) => task.status === "done"
                    ).length;

                  const percentage =
                    projectTasks.length === 0
                      ? 0
                      : Math.round(
                          (done /
                            projectTasks.length) *
                            100
                        );

                  return (
                    <AccordionItem
                      key={project.id}
                      value={project.id}
                      ref={(element) => {
                        taskRefs.current[
                          `project-${project.id}`
                        ] =
                          element as unknown as HTMLDivElement;
                      }}
                      className="border-0 bg-transparent"
                    >
                      <AccordionTrigger className="hover:no-underline p-0 [&>svg]:hidden group">
                        <div className="w-full flex items-stretch gap-0 rounded-xl overflow-hidden border bg-card hover:shadow-md transition-shadow text-left">
                          <div
                            className="w-3 shrink-0"
                            style={{
                              backgroundColor:
                                project.color,
                            }}
                          />

                          <div className="flex-1 min-w-0 px-4 py-3 flex items-center gap-4">
                            <div
                              className="relative h-11 w-12 shrink-0 rounded-md flex items-center justify-center"
                              style={{
                                backgroundColor: `${project.color}22`,
                                border: `1.5px solid ${project.color}55`,
                              }}
                            >
                              <div
                                className="absolute top-1 left-1 right-1 h-2 rounded-t-sm"
                                style={{
                                  backgroundColor:
                                    project.color,
                                  opacity: 0.7,
                                }}
                              />

                              <FolderKanban
                                className="h-5 w-5 relative z-10"
                                style={{
                                  color:
                                    project.color,
                                }}
                              />
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-sm truncate leading-tight">
                                {project.name}
                              </p>

                              <p className="text-xs text-muted-foreground mt-0.5">
                                {done}/
                                {projectTasks.length}{" "}
                                tasks
                                {projectTasks.length >
                                  0 &&
                                  ` · ${percentage}% complete`}
                              </p>

                              <Progress
                                value={percentage}
                                className="h-1.5 mt-1.5"
                              />
                            </div>

                            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                          </div>
                        </div>
                      </AccordionTrigger>

                      <AccordionContent className="pt-2 pb-1 px-1">
                        {projectTasks.length === 0 ? (
                          <p className="text-sm text-muted-foreground py-3 px-3">
                            No tasks in this project.
                          </p>
                        ) : (
                          <div className="space-y-2 rounded-lg border bg-muted/30 p-2">
                            {projectTasks.map(
                              renderTask
                            )}
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

                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Stand-alone Tasks
                </h2>
              </div>

              <div className="space-y-2">
                {standalone.map(renderTask)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ADD TASK DIALOG */}
      <Dialog
        open={addOpen}
        onOpenChange={setAddOpen}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Task</DialogTitle>
          </DialogHeader>

          <AddTask
            embedded
            onCreated={() => {
              setAddOpen(false);
              fetchAll();
            }}
          />
        </DialogContent>
      </Dialog>

      {/* EDIT TASK DIALOG */}
      <Dialog
        open={!!editTask}
        onOpenChange={(open) => {
          if (!open && !savingEdit) {
            setEditTask(null);
            setEditErrors({});
            setEditNote("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
          </DialogHeader>

          {editTask && (
            <div className="space-y-4">
              {/* TITLE */}
              <div className="space-y-1.5">
                <Label>Title</Label>

                <Input
                  value={editTask.title}
                  onChange={(event) =>
                    setEditTask({
                      ...editTask,
                      title: event.target.value,
                    })
                  }
                />

                {editErrors.title && (
                  <p className="text-xs text-destructive">
                    {editErrors.title}
                  </p>
                )}
              </div>

              {/* DESCRIPTION */}
              <div className="space-y-1.5">
                <Label>Description</Label>

                <Textarea
                  value={
                    editTask.description || ""
                  }
                  onChange={(event) =>
                    setEditTask({
                      ...editTask,
                      description:
                        event.target.value,
                    })
                  }
                />
              </div>

              {/* START / DUE */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Start</Label>

                  <Input
                    type="datetime-local"
                    value={toInput(
                      editTask.start_time
                    )}
                    onChange={(event) =>
                      setEditTask({
                        ...editTask,
                        start_time: fromInput(
                          event.target.value
                        ),
                      })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Due</Label>

                  <Input
                    type="datetime-local"
                    value={toInput(
                      editTask.due_date
                    )}
                    onChange={(event) =>
                      setEditTask({
                        ...editTask,
                        due_date: fromInput(
                          event.target.value
                        ),
                      })
                    }
                  />
                </div>
              </div>

              {/* PROJECT */}
              <div className="space-y-1.5">
                <Label>Project</Label>

                <Select
                  value={
                    editTask.project_id ?? "none"
                  }
                  onValueChange={(value) =>
                    setEditTask({
                      ...editTask,
                      project_id:
                        value === "none"
                          ? null
                          : value,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="none">
                      Stand-alone Task
                    </SelectItem>

                    {projects.map((project) => (
                      <SelectItem
                        key={project.id}
                        value={project.id}
                      >
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* CHANGE NOTE */}
              <div className="space-y-1.5">
                <Label>
                  Reason for this change (optional)
                </Label>

                <Textarea
                  value={editNote}
                  onChange={(event) =>
                    setEditNote(
                      event.target.value
                    )
                  }
                  placeholder="e.g. Client moved the deadline"
                  rows={3}
                />

                <p className="text-xs text-muted-foreground">
                  This note will be saved in the
                  task's change history.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              disabled={savingEdit}
              onClick={() => {
                setEditTask(null);
                setEditNote("");
                setEditErrors({});
              }}
            >
              Cancel
            </Button>

            <Button
              onClick={saveEdit}
              disabled={savingEdit}
            >
              {savingEdit
                ? "Saving..."
                : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ARCHIVE CONFIRMATION */}
      <AlertDialog
        open={!!archiveTarget}
        onOpenChange={(open) => {
          if (!open) {
            setArchiveTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Archive task?
            </AlertDialogTitle>

            <AlertDialogDescription>
              "{archiveTarget?.title}" will be
              moved out of your lists but kept on
              record, so nothing is lost.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>
              Cancel
            </AlertDialogCancel>

            <AlertDialogAction
              onClick={confirmArchive}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
