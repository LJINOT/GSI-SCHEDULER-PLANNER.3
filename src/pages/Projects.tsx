import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

import { toast } from "sonner";
import { motion } from "framer-motion";

import {
  PlusCircle,
  Archive,
  FolderKanban,
  Pencil,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import { formatPH } from "@/lib/date-utils";


// ============================================================
// TYPES
// ============================================================

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


// ============================================================
// CONSTANTS
// ============================================================

const COLORS = [
  "#6366f1",
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
];

const statusColors: Record<string, string> = {
  todo: "bg-muted text-muted-foreground",
  in_progress: "bg-info/10 text-info",
  done: "bg-success/10 text-success",
};

const TASK_LIST_LIMIT = 3;


// ============================================================
// MAIN COMPONENT
// ============================================================

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchParams] = useSearchParams();

  const projectRefs = useRef<
    Record<string, HTMLDivElement | null>
  >({});

  const highlightId = searchParams.get("project");


  // ==========================================================
  // PROJECT CREATE / EDIT
  // ==========================================================

  const [open, setOpen] = useState(false);

  const [editingProject, setEditingProject] =
    useState<Project | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] =
    useState("");

  const [color, setColor] =
    useState(COLORS[0]);

  const [nameError, setNameError] =
    useState("");


  // ==========================================================
  // PROJECT DELETE / ARCHIVE
  // ==========================================================

  const [
    deleteProjectTarget,
    setDeleteProjectTarget,
  ] = useState<Project | null>(null);


  // ==========================================================
  // PROJECT UI
  // ==========================================================

  const [
    expandedProjects,
    setExpandedProjects,
  ] = useState<Record<string, boolean>>({});

  const [view, setView] =
    useState<"cards" | "board">("cards");

  const [
    projectFilters,
    setProjectFilters,
  ] = useState<
    Record<
      string,
      "all" | "todo" | "in_progress" | "done"
    >
  >({});


  // ==========================================================
  // TASK EDIT
  // ==========================================================

  const [
    taskDialogOpen,
    setTaskDialogOpen,
  ] = useState(false);

  const [
    editingTask,
    setEditingTask,
  ] = useState<Task | null>(null);

  const [taskTitle, setTaskTitle] =
    useState("");

  const [
    taskDescription,
    setTaskDescription,
  ] = useState("");

  const [
    taskDueDate,
    setTaskDueDate,
  ] = useState("");

  const [
    taskStartTime,
    setTaskStartTime,
  ] = useState("");

  const [
    taskDuration,
    setTaskDuration,
  ] = useState("");

  const [
    taskStatus,
    setTaskStatus,
  ] = useState("todo");

  const [
    taskTitleError,
    setTaskTitleError,
  ] = useState("");


  // ==========================================================
  // TASK DELETE
  // ==========================================================

  const [
    deleteTaskTarget,
    setDeleteTaskTarget,
  ] = useState<Task | null>(null);


  // ==========================================================
  // HIGHLIGHT PROJECT FROM URL
  // ==========================================================

  useEffect(() => {
    if (highlightId && !loading) {
      setTimeout(() => {
        projectRefs.current[
          highlightId
        ]?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 200);

      setExpandedProjects((prev) => ({
        ...prev,
        [highlightId]: true,
      }));
    }
  }, [highlightId, loading]);


  // ==========================================================
  // FETCH PROJECTS + TASKS
  // ==========================================================

  const fetchAll = async () => {
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      setProjects([]);
      setTasks([]);
      setLoading(false);

      if (!user) {
        toast.error(
          "Please sign in to view your projects."
        );
      }

      return;
    }

    const uid = user.id;

    const [
      { data: p, error: pErr },
      { data: t, error: tErr },
    ] = await Promise.all([
      supabase
        .from("projects")
        .select("*")
        .eq("user_id", uid)
        .or(
          "archived.eq.false,archived.is.null"
        )
        .order("created_at", {
          ascending: false,
        }),

      supabase
        .from("tasks")
        .select(
          "id, title, description, status, due_date, start_time, estimated_duration, project_id"
        )
        .eq("user_id", uid)
        .or(
          "archived.eq.false,archived.is.null"
        ),
    ]);

    if (pErr) {
      console.error(
        "Failed to load projects:",
        pErr
      );

      toast.error(pErr.message);
    }

    if (tErr) {
      console.error(
        "Failed to load tasks:",
        tErr
      );

      toast.error(tErr.message);
    }

    setProjects(p || []);
    setTasks(t || []);
    setLoading(false);
  };


  // ==========================================================
  // AUTH LISTENER
  // ==========================================================

  useEffect(() => {
    fetchAll();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (event) => {
        if (
          event === "SIGNED_IN" ||
          event === "TOKEN_REFRESHED" ||
          event === "INITIAL_SESSION"
        ) {
          fetchAll();
        }

        if (event === "SIGNED_OUT") {
          setProjects([]);
          setTasks([]);
        }
      }
    );

    return () =>
      subscription.unsubscribe();
  }, []);


  // ==========================================================
  // RESET PROJECT FORM
  // ==========================================================

  const resetProjectForm = () => {
    setName("");
    setDescription("");
    setColor(COLORS[0]);
    setNameError("");
    setEditingProject(null);
  };


  // ==========================================================
  // CREATE PROJECT DIALOG
  // ==========================================================

  const openCreateDialog = () => {
    resetProjectForm();
    setOpen(true);
  };


  // ==========================================================
  // EDIT PROJECT DIALOG
  // ==========================================================

  const openEditDialog = (
    project: Project
  ) => {
    setEditingProject(project);

    setName(project.name);

    setDescription(
      project.description || ""
    );

    setColor(project.color);

    setNameError("");

    setOpen(true);
  };


  // ==========================================================
  // SAVE PROJECT
  //
  // FIX:
  // The authenticated user is obtained BEFORE checking
  // editingProject.
  // ==========================================================

  const saveProject = async () => {
    // --------------------------------------------------------
    // Validate project name
    // --------------------------------------------------------

    if (!name.trim()) {
      setNameError(
        "Project name is required"
      );

      return;
    }

    setNameError("");


    // --------------------------------------------------------
    // Get authenticated user FIRST
    // --------------------------------------------------------

    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      toast.error(
        "Please sign in to save the project."
      );

      return;
    }


    // --------------------------------------------------------
    // Normalize name
    // --------------------------------------------------------

    const normalizedName =
      name.trim().toLowerCase();


    // --------------------------------------------------------
    // Check duplicate project names
    // --------------------------------------------------------

    const {
      data: existingProjects,
      error: duplicateCheckError,
    } = await supabase
      .from("projects")
      .select("id, name")
      .eq("user_id", user.id)
      .or(
        "archived.eq.false,archived.is.null"
      );

    if (duplicateCheckError) {
      console.error(
        "Project duplicate check failed:",
        duplicateCheckError
      );

      toast.error(
        duplicateCheckError.message
      );

      return;
    }


    const duplicate =
      (existingProjects || []).some(
        (project: {
          id: string;
          name?: string;
        }) =>
          project.id !==
            editingProject?.id &&
          String(project.name || "")
            .trim()
            .toLowerCase() ===
            normalizedName
      );


    if (duplicate) {
      setNameError(
        "Project name already exists. Please use a different project name."
      );

      return;
    }


    // ========================================================
    // EDIT EXISTING PROJECT
    // ========================================================

    if (editingProject) {
      const {
        error: updateError,
      } = await supabase
        .from("projects")
        .update({
          name: name.trim(),

          description:
            description.trim() ||
            null,

          color,
        })
        .eq(
          "id",
          editingProject.id
        )
        .eq(
          "user_id",
          user.id
        );

      if (updateError) {
        console.error(
          "Project update failed:",
          updateError
        );

        toast.error(
          `Failed to update project: ${updateError.message}`
        );

        return;
      }

      toast.success(
        "Project updated successfully."
      );

      resetProjectForm();

      setOpen(false);

      await fetchAll();

      return;
    }


    // ========================================================
    // CREATE NEW PROJECT
    // ========================================================

    const {
      error: insertError,
    } = await supabase
      .from("projects")
      .insert({
        user_id: user.id,

        name: name.trim(),

        description:
          description.trim() ||
          null,

        color,

        archived: false,
      });

    if (insertError) {
      console.error(
        "Project creation failed:",
        insertError
      );

      toast.error(
        `Failed to create project: ${insertError.message}`
      );

      return;
    }

    toast.success(
      "Project created successfully."
    );

    resetProjectForm();

    setOpen(false);

    await fetchAll();
  };


  // ==========================================================
  // ARCHIVE PROJECT
  // ==========================================================

  const confirmDeleteProject =
    async () => {
      if (!deleteProjectTarget)
        return;

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        toast.error(
          "Please sign in to archive the project."
        );

        return;
      }

      const {
        error,
      } = await supabase
        .from("projects")
        .update({
          archived: true,
          archived_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          deleteProjectTarget.id
        )
        .eq(
          "user_id",
          user.id
        );

      if (error) {
        toast.error(error.message);
      } else {
        toast.success(
          "Project archived — it can be restored later."
        );

        await fetchAll();
      }

      setDeleteProjectTarget(null);
    };


  // ==========================================================
  // PROJECT STATISTICS
  // ==========================================================

  const statsFor = (
    projectId: string
  ) => {
    const projectTasks =
      tasks.filter(
        (task) =>
          task.project_id ===
          projectId
      );

    const done =
      projectTasks.filter(
        (task) =>
          task.status === "done"
      ).length;

    const pct =
      projectTasks.length === 0
        ? 0
        : Math.round(
            (done /
              projectTasks.length) *
              100
          );

    return {
      total: projectTasks.length,
      done,
      pct,
    };
  };


  // ==========================================================
  // GET TASKS FOR PROJECT
  // ==========================================================

  const tasksFor = (
    projectId: string
  ) =>
    tasks.filter(
      (task) =>
        task.project_id ===
        projectId
    );


  // ==========================================================
  // DATETIME LOCAL FORMATTER
  // ==========================================================

  const toDatetimeLocal = (
    iso: string | null
  ) => {
    if (!iso) return "";

    const date = new Date(iso);

    const pad = (value: number) =>
      String(value).padStart(2, "0");

    return `${date.getFullYear()}-${pad(
      date.getMonth() + 1
    )}-${pad(
      date.getDate()
    )}T${pad(
      date.getHours()
    )}:${pad(
      date.getMinutes()
    )}`;
  };


  // ==========================================================
  // OPEN TASK EDIT DIALOG
  // ==========================================================

  const openEditTaskDialog = (
    task: Task
  ) => {
    if (task.status === "done") {
      toast.error(
        "Completed tasks are read-only in Projects."
      );

      return;
    }

    setEditingTask(task);

    setTaskTitle(task.title);

    setTaskDescription(
      task.description || ""
    );

    setTaskDueDate(
      toDatetimeLocal(
        task.due_date
      )
    );

    setTaskStartTime(
      toDatetimeLocal(
        task.start_time
      )
    );

    setTaskDuration(
      task.estimated_duration
        ? String(
            task.estimated_duration
          )
        : ""
    );

    setTaskStatus(
      task.status
    );

    setTaskTitleError("");

    setTaskDialogOpen(true);
  };


  // ==========================================================
  // SAVE TASK
  // ==========================================================

  const saveTask = async () => {
    if (!taskTitle.trim()) {
      setTaskTitleError(
        "Task title is required"
      );

      return;
    }

    setTaskTitleError("");

    if (!editingTask) return;


    // --------------------------------------------------------
    // Completed tasks cannot be edited
    // --------------------------------------------------------

    if (
      editingTask.status ===
      "done"
    ) {
      toast.error(
        "Completed tasks cannot be edited here."
      );

      return;
    }


    // --------------------------------------------------------
    // Duration validation
    // --------------------------------------------------------

    if (
      taskDuration !== "" &&
      taskDuration != null &&
      !(Number(taskDuration) > 0)
    ) {
      toast.error(
        "Duration must be greater than 0."
      );

      return;
    }


    // --------------------------------------------------------
    // Start < Due
    // --------------------------------------------------------

    if (
      taskStartTime &&
      taskDueDate &&
      new Date(taskStartTime) >=
        new Date(taskDueDate)
    ) {
      toast.error(
        "Start time must be earlier than due date/time."
      );

      return;
    }


    // --------------------------------------------------------
    // Fixed breaks
    // --------------------------------------------------------

    if (taskStartTime) {
      const hour =
        new Date(
          taskStartTime
        ).getHours();

      if (
        hour === 9 ||
        hour === 12 ||
        hour === 15
      ) {
        toast.error(
          "Cannot schedule over fixed breaks (9:00 AM, 12:00 PM, 3:00 PM)."
        );

        return;
      }
    }


    // --------------------------------------------------------
    // Overlap validation
    // --------------------------------------------------------

    if (taskStartTime) {
      const duration =
        Math.max(
          5,
          Number(taskDuration) ||
            editingTask.estimated_duration ||
            30
        );

      const newStart =
        new Date(
          taskStartTime
        ).getTime();

      const newEnd =
        newStart +
        duration *
          60_000;

      const conflict =
        tasks.find(
          (task) => {
            if (
              task.id ===
                editingTask.id ||
              !task.start_time ||
              task.status ===
                "done"
            ) {
              return false;
            }

            const start =
              new Date(
                task.start_time
              ).getTime();

            const end =
              start +
              Math.max(
                5,
                task.estimated_duration ||
                  30
              ) *
                60_000;

            return (
              newStart < end &&
              newEnd > start
            );
          }
        );

      if (conflict) {
        toast.error(
          `Overlaps with "${conflict.title}".`
        );

        return;
      }
    }


    // --------------------------------------------------------
    // Get authenticated user
    // --------------------------------------------------------

    const {
      data: { user },
      error: authError,
    } =
      await supabase.auth.getUser();

    if (authError || !user) {
      toast.error(
        "Please sign in to edit this task."
      );

      return;
    }


    // --------------------------------------------------------
    // Update task
    // --------------------------------------------------------

    const {
      error,
    } = await supabase
      .from("tasks")
      .update({
        title:
          taskTitle.trim(),

        description:
          taskDescription.trim() ||
          null,

        due_date: taskDueDate
          ? new Date(
              taskDueDate
            ).toISOString()
          : null,

        start_time: taskStartTime
          ? new Date(
              taskStartTime
            ).toISOString()
          : null,

        estimated_duration:
          taskDuration
            ? Number(taskDuration)
            : null,

        status:
          taskStatus,
      })
      .eq(
        "id",
        editingTask.id
      )
      .eq(
        "user_id",
        user.id
      );


    if (error) {
      console.error(
        "Task update failed:",
        error
      );

      toast.error(
        `Failed to update task: ${error.message}`
      );

      return;
    }


    // --------------------------------------------------------
    // Record task history
    // --------------------------------------------------------

    const {
      error: historyError,
    } = await supabase
      .from("task_history")
      .insert({
        user_id: user.id,

        task_id:
          editingTask.id,

        note:
          "Edited from Projects",

        changes: {
          title:
            taskTitle.trim(),

          description:
            taskDescription.trim() ||
            null,

          start_time:
            taskStartTime ||
            null,

          due_date:
            taskDueDate ||
            null,

          estimated_duration:
            taskDuration ||
            null,

          status:
            taskStatus,
        },
      });

    if (historyError) {
      console.warn(
        "Task was updated, but history could not be recorded:",
        historyError
      );
    }


    toast.success(
      "Task updated successfully."
    );

    setTaskDialogOpen(false);

    setEditingTask(null);

    await fetchAll();
  };


  // ==========================================================
  // ARCHIVE TASK
  // ==========================================================

  const confirmDeleteTask =
    async () => {
      if (!deleteTaskTarget)
        return;

      const {
        data: { user },
      } =
        await supabase.auth.getUser();

      if (!user) {
        toast.error(
          "Please sign in to archive the task."
        );

        return;
      }

      const {
        error,
      } = await supabase
        .from("tasks")
        .update({
          archived: true,
          archived_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          deleteTaskTarget.id
        )
        .eq(
          "user_id",
          user.id
        );

      if (error) {
        toast.error(
          error.message
        );
      } else {
        toast.success(
          "Task archived — it can be restored later."
        );

        await fetchAll();
      }

      setDeleteTaskTarget(null);
    };


  // ==========================================================
  // CHANGE TASK STATUS
  // ==========================================================

  const moveTask = async (
    task: Task,
    status: string
  ) => {
    if (
      task.status === status
    ) {
      return;
    }

    try {
      // ------------------------------------------------------
      // Complete through Edge Function
      // ------------------------------------------------------

      if (status === "done") {
        const {
          data,
          error,
        } =
          await supabase.functions.invoke(
            "complete-task",
            {
              body: {
                task_id: task.id,
              },
            }
          );

        if (error) {
          throw error;
        }

        const body =
          typeof data ===
          "string"
            ? JSON.parse(data)
            : data || {};

        if (body?.error) {
          throw new Error(
            body.error
          );
        }

        const moved =
          Array.isArray(
            body?.adaptive_moves
          )
            ? body.adaptive_moves.filter(
                (move: any) =>
                  move.status ===
                  "rescheduled"
              ).length
            : 0;

        toast.success(
          moved > 0
            ? `Task completed. ${moved} task${
                moved === 1
                  ? ""
                  : "s"
              } rescheduled.`
            : "Task completed."
        );
      }

      // ------------------------------------------------------
      // Normal status update
      // ------------------------------------------------------

      else {
        const {
          data: {
            user,
          },
        } =
          await supabase.auth.getUser();

        if (!user) {
          throw new Error(
            "You are not signed in."
          );
        }

        const {
          error,
        } = await supabase
          .from("tasks")
          .update({
            status,
            completed_at:
              null,
          })
          .eq(
            "id",
            task.id
          )
          .eq(
            "user_id",
            user.id
          );

        if (error) {
          throw error;
        }
      }

      await fetchAll();
    } catch (error: any) {
      console.error(
        "Failed to update task status:",
        error
      );

      toast.error(
        /duplicate|unique/i.test(
          error?.message || ""
        )
          ? "A task with this title already exists."
          : error?.message ||
              "Failed to update task status."
      );

      await fetchAll();
    }
  };


  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <motion.div
      initial={{
        opacity: 0,
        y: 8,
      }}
      animate={{
        opacity: 1,
        y: 0,
      }}
      className="space-y-6"
    >

      {/* ======================================================
          HEADER
      ====================================================== */}

      <div className="flex items-center justify-between">

        <div>
          <h1 className="font-display text-3xl font-bold">
            Projects
          </h1>

          <p className="text-muted-foreground mt-1">
            Group related tasks into folders for cleaner organization
          </p>
        </div>


        <div className="flex items-center gap-2">

          {/* VIEW SWITCHER */}

          <div className="flex rounded-md border border-border overflow-hidden">

            {(
              [
                {
                  key: "cards",
                  label: "Cards",
                },
                {
                  key: "board",
                  label: "Board",
                },
              ] as const
            ).map((v) => (

              <button
                key={v.key}
                type="button"
                onClick={() =>
                  setView(v.key)
                }
                className={`px-3 py-1.5 text-xs transition-colors ${
                  view === v.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {v.label}
              </button>

            ))}

          </div>


          {/* NEW PROJECT */}

          <Dialog
            open={open}
            onOpenChange={(value) => {
              setOpen(value);

              if (!value) {
                resetProjectForm();
              }
            }}
          >

            <DialogTrigger asChild>

              <Button
                onClick={
                  openCreateDialog
                }
              >
                <PlusCircle className="mr-2 h-4 w-4" />

                New Project
              </Button>

            </DialogTrigger>


            <DialogContent>

              <DialogHeader>

                <DialogTitle>
                  {editingProject
                    ? "Edit Project"
                    : "Create Project"}
                </DialogTitle>

              </DialogHeader>


              <div className="space-y-4">

                {/* PROJECT NAME */}

                <div className="space-y-2">

                  <Label>
                    Name
                  </Label>

                  <Input
                    value={name}
                    onChange={(event) => {
                      setName(
                        event.target.value
                      );

                      if (
                        event.target.value.trim()
                      ) {
                        setNameError("");
                      }
                    }}
                    placeholder="e.g. Thesis Research"
                  />

                  {nameError && (
                    <p className="text-sm text-destructive">
                      {nameError}
                    </p>
                  )}

                </div>


                {/* DESCRIPTION */}

                <div className="space-y-2">

                  <Label>
                    Description
                  </Label>

                  <Textarea
                    value={
                      description
                    }
                    onChange={(event) =>
                      setDescription(
                        event.target.value
                      )
                    }
                    rows={2}
                  />

                </div>


                {/* COLOR */}

                <div className="space-y-2">

                  <Label>
                    Color
                  </Label>

                  <div className="flex gap-2 flex-wrap">

                    {COLORS.map(
                      (projectColor) => (

                        <button
                          key={
                            projectColor
                          }
                          type="button"
                          onClick={() =>
                            setColor(
                              projectColor
                            )
                          }
                          className={`h-7 w-7 rounded-full border-2 ${
                            color ===
                            projectColor
                              ? "border-foreground"
                              : "border-transparent"
                          }`}
                          style={{
                            backgroundColor:
                              projectColor,
                          }}
                        />

                      )
                    )}

                  </div>

                </div>

              </div>


              <DialogFooter>

                <Button
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                    resetProjectForm();
                  }}
                >
                  Cancel
                </Button>

                <Button
                  onClick={saveProject}
                >
                  {editingProject
                    ? "Save"
                    : "Create"}
                </Button>

              </DialogFooter>

            </DialogContent>

          </Dialog>

        </div>

      </div>


      {/* ======================================================
          LOADING
      ====================================================== */}

      {loading ? (

        <div className="flex justify-center py-12">

          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />

        </div>

      ) : projects.length === 0 ? (

        <Card>

          <CardContent className="py-16 text-center text-muted-foreground">

            <FolderKanban className="mx-auto h-12 w-12 mb-4 opacity-30" />

            <p>
              No projects yet. Create one to start grouping tasks.
            </p>

          </CardContent>

        </Card>

      ) : view === "board" ? (

        /* ====================================================
           BOARD VIEW
        ==================================================== */

        <div className="grid gap-4 md:grid-cols-3">

          {(
            [
              {
                key: "todo",
                label: "To Do",
              },
              {
                key: "in_progress",
                label: "In Progress",
              },
              {
                key: "done",
                label: "Done",
              },
            ] as const
          ).map((column) => {

            const columnTasks =
              tasks.filter(
                (task) =>
                  task.project_id &&
                  task.status ===
                    column.key
              );

            return (

              <Card
                key={column.key}
                className="bg-muted/30"
              >

                <CardHeader className="pb-3">

                  <CardTitle className="text-sm flex items-center justify-between">

                    {column.label}

                    <Badge variant="outline">
                      {
                        columnTasks.length
                      }
                    </Badge>

                  </CardTitle>

                </CardHeader>


                <CardContent className="space-y-2 max-h-[65vh] overflow-y-auto">

                  {columnTasks.length ===
                  0 ? (

                    <p className="text-xs text-muted-foreground py-2">
                      Nothing here yet.
                    </p>

                  ) : (

                    columnTasks.map(
                      (task) => {

                        const project =
                          projects.find(
                            (item) =>
                              item.id ===
                              task.project_id
                          );

                        return (

                          <div
                            key={task.id}
                            className="rounded-md border border-border bg-background p-2.5 space-y-2"
                          >

                            <p className="text-sm font-medium">
                              {task.title}
                            </p>


                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">

                              {project && (
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{
                                    backgroundColor:
                                      project.color,
                                  }}
                                />
                              )}

                              <span className="truncate">
                                {
                                  project?.name
                                }
                              </span>


                              {task.due_date && (
                                <span className="ml-auto shrink-0">
                                  Due{" "}
                                  {formatPH(
                                    task.due_date,
                                    "MMM d, h:mm a"
                                  )}
                                </span>
                              )}

                            </div>


                            <Select
                              value={
                                task.status
                              }
                              onValueChange={(
                                value
                              ) =>
                                moveTask(
                                  task,
                                  value
                                )
                              }
                            >

                              <SelectTrigger className="h-7 text-xs">
                                <SelectValue />
                              </SelectTrigger>

                              <SelectContent>

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

                        );
                      }
                    )

                  )}

                </CardContent>

              </Card>

            );
          })}

        </div>

      ) : (

        /* ====================================================
           CARD VIEW
        ==================================================== */

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">

          {projects.map((project) => {

            const stats =
              statsFor(
                project.id
              );

            const projectTasks =
              tasksFor(
                project.id
              );

            const filter =
              projectFilters[
                project.id
              ] || "all";

            const filteredTasks =
              filter === "all"
                ? projectTasks
                : projectTasks.filter(
                    (task) =>
                      task.status ===
                      filter
                  );

            const isExpanded =
              !!expandedProjects[
                project.id
              ];

            const visibleTasks =
              isExpanded
                ? filteredTasks
                : filteredTasks.slice(
                    0,
                    TASK_LIST_LIMIT
                  );

            const hasMore =
              filteredTasks.length >
              TASK_LIST_LIMIT;


            return (

              <Card
                key={project.id}
                ref={(element) => {
                  projectRefs.current[
                    project.id
                  ] = element;
                }}
                className={`hover:shadow-md transition-shadow ${
                  highlightId ===
                  project.id
                    ? "ring-2 ring-primary"
                    : ""
                }`}
              >

                {/* PROJECT HEADER */}

                <CardHeader className="pb-3">

                  <div className="flex items-start justify-between gap-2">

                    <div className="flex items-center gap-2 min-w-0">

                      <span
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{
                          backgroundColor:
                            project.color,
                        }}
                      />

                      <CardTitle className="text-base truncate">
                        {project.name}
                      </CardTitle>

                    </div>


                    <div className="flex items-center shrink-0">

                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          openEditDialog(
                            project
                          )
                        }
                      >
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>


                      <Button
                        variant="ghost"
                        size="icon"
                        title="Archive project"
                        onClick={() =>
                          setDeleteProjectTarget(
                            project
                          )
                        }
                      >
                        <Archive className="h-4 w-4 text-muted-foreground" />
                      </Button>

                    </div>

                  </div>

                </CardHeader>


                {/* PROJECT BODY */}

                <CardContent className="space-y-3">

                  {project.description && (

                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {
                        project.description
                      }
                    </p>

                  )}


                  <div className="flex items-center justify-between text-xs text-muted-foreground">

                    <span>
                      {stats.done}/
                      {stats.total}{" "}
                      completed
                    </span>

                    <Badge variant="outline">
                      {stats.pct}%
                    </Badge>

                  </div>


                  <Progress
                    value={
                      stats.pct
                    }
                    className="h-2"
                  />


                  {/* TASK LIST */}

                  <div className="pt-2 border-t border-border">

                    {projectTasks.length ===
                    0 ? (

                      <p className="text-xs text-muted-foreground py-1">
                        No tasks assigned to this project.
                      </p>

                    ) : (

                      <>

                        {/* ==================================================
                            FILTER BUTTONS
                        ================================================== */}

                        <div className="flex flex-wrap gap-1.5 mb-2">

                          {[
                            {
                              key: "all" as const,
                              label: "All",
                            },
                            {
                              key: "todo" as const,
                              label: "To Do",
                            },
                            {
                              key: "in_progress" as const,
                              label: "In Progress",
                            },
                            {
                              key: "done" as const,
                              label: "Done",
                            },
                          ].map(
                            (filterOption) => (

                              <button
                                key={
                                  filterOption.key
                                }
                                type="button"
                                onClick={() =>
                                  setProjectFilters(
                                    (previous) => ({
                                      ...previous,
                                      [project.id]:
                                        filterOption.key,
                                    })
                                  )
                                }
                                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                                  filter ===
                                  filterOption.key
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-background text-muted-foreground border-border hover:border-muted-foreground/50"
                                }`}
                              >
                                {
                                  filterOption.label
                                }
                              </button>

                            )
                          )}

                        </div>


                        {/* ==================================================
                            NO FILTER RESULTS
                        ================================================== */}

                        {filteredTasks.length ===
                        0 ? (

                          <p className="text-xs text-muted-foreground py-1">
                            No tasks match this filter.
                          </p>

                        ) : (

                          <div className="space-y-2">

                            {visibleTasks.map(
                              (task) => (

                                <div
                                  key={
                                    task.id
                                  }
                                  className="group flex items-start justify-between gap-2 p-2 rounded-md border border-border bg-background hover:bg-muted/50 transition-colors"
                                >

                                  <div className="min-w-0 flex-1">

                                    <p className="text-sm font-medium truncate">
                                      {
                                        task.title
                                      }
                                    </p>


                                    <div className="flex flex-wrap items-center gap-1.5 mt-1">

                                      <Badge
                                        className={`text-[10px] px-1.5 py-0 ${
                                          statusColors[
                                            task.status
                                          ] ||
                                          "bg-muted text-muted-foreground"
                                        }`}
                                      >
                                        {task.status.replace(
                                          "_",
                                          " "
                                        )}
                                      </Badge>


                                      {task.start_time && (

                                        <span className="text-[10px] text-muted-foreground">

                                          {formatPH(
                                            task.start_time,
                                            "MMM d, h:mm a"
                                          )}

                                        </span>

                                      )}


                                      {task.due_date &&
                                        !task.start_time && (

                                          <span className="text-[10px] text-muted-foreground">

                                            Due{" "}
                                            {formatPH(
                                              task.due_date,
                                              "MMM d, h:mm a"
                                            )}

                                          </span>

                                        )}

                                    </div>

                                  </div>


                                  {/* TASK ACTIONS */}

                                  <div className="flex items-center shrink-0 opacity-80 group-hover:opacity-100">

                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() =>
                                        openEditTaskDialog(
                                          task
                                        )
                                      }
                                    >
                                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                                    </Button>


                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      title="Archive task"
                                      onClick={() =>
                                        setDeleteTaskTarget(
                                          task
                                        )
                                      }
                                    >
                                      <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                                    </Button>

                                  </div>

                                </div>

                              )
                            )}


                            {/* ==================================================
                                SHOW MORE / LESS
                            ================================================== */}

                            {hasMore && (

                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full text-xs h-7"
                                onClick={() =>
                                  setExpandedProjects(
                                    (previous) => ({
                                      ...previous,
                                      [project.id]:
                                        !previous[
                                          project.id
                                        ],
                                    })
                                  )
                                }
                              >

                                {isExpanded ? (

                                  <>
                                    Show less

                                    <ChevronUp className="ml-1 h-3.5 w-3.5" />
                                  </>

                                ) : (

                                  <>
                                    Show{" "}
                                    {
                                      filteredTasks.length -
                                      TASK_LIST_LIMIT
                                    }{" "}
                                    more

                                    <ChevronDown className="ml-1 h-3.5 w-3.5" />
                                  </>

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


      {/* ======================================================
          ARCHIVE PROJECT DIALOG
      ====================================================== */}

      <AlertDialog
        open={
          !!deleteProjectTarget
        }
        onOpenChange={(value) => {
          if (!value) {
            setDeleteProjectTarget(
              null
            );
          }
        }}
      >

        <AlertDialogContent>

          <AlertDialogHeader>

            <AlertDialogTitle>
              Archive project?
            </AlertDialogTitle>

            <AlertDialogDescription>
              "{deleteProjectTarget?.name}" will be moved out of your lists but kept on record, so nothing is lost.
            </AlertDialogDescription>

          </AlertDialogHeader>


          <AlertDialogFooter>

            <AlertDialogCancel>
              Cancel
            </AlertDialogCancel>

            <AlertDialogAction
              onClick={
                confirmDeleteProject
              }
            >
              Archive
            </AlertDialogAction>

          </AlertDialogFooter>

        </AlertDialogContent>

      </AlertDialog>


      {/* ======================================================
          EDIT TASK DIALOG
      ====================================================== */}

      <Dialog
        open={
          taskDialogOpen
        }
        onOpenChange={(value) => {
          setTaskDialogOpen(
            value
          );

          if (!value) {
            setEditingTask(null);
            setTaskTitleError("");
          }
        }}
      >

        <DialogContent>

          <DialogHeader>

            <DialogTitle>
              Edit Task
            </DialogTitle>

          </DialogHeader>


          <div className="space-y-4">

            {/* TASK TITLE */}

            <div className="space-y-2">

              <Label>
                Title
              </Label>

              <Input
                value={taskTitle}
                onChange={(event) => {
                  setTaskTitle(
                    event.target.value
                  );

                  if (
                    event.target.value.trim()
                  ) {
                    setTaskTitleError("");
                  }
                }}
              />

              {taskTitleError && (

                <p className="text-sm text-destructive">
                  {taskTitleError}
                </p>

              )}

            </div>


            {/* DESCRIPTION */}

            <div className="space-y-2">

              <Label>
                Description
              </Label>

              <Textarea
                value={
                  taskDescription
                }
                onChange={(event) =>
                  setTaskDescription(
                    event.target.value
                  )
                }
                rows={2}
              />

            </div>


            {/* START + DUE */}

            <div className="grid grid-cols-2 gap-4">

              <div className="space-y-2">

                <Label>
                  Start Time
                </Label>

                <Input
                  type="datetime-local"
                  value={
                    taskStartTime
                  }
                  onChange={(event) =>
                    setTaskStartTime(
                      event.target.value
                    )
                  }
                />

              </div>


              <div className="space-y-2">

                <Label>
                  Due Date
                </Label>

                <Input
                  type="datetime-local"
                  value={
                    taskDueDate
                  }
                  onChange={(event) =>
                    setTaskDueDate(
                      event.target.value
                    )
                  }
                />

              </div>

            </div>


            {/* DURATION + STATUS */}

            <div className="grid grid-cols-2 gap-4">

              <div className="space-y-2">

                <Label>
                  Estimated Duration (min)
                </Label>

                <Input
                  type="number"
                  min={0}
                  value={
                    taskDuration
                  }
                  onChange={(event) =>
                    setTaskDuration(
                      event.target.value
                    )
                  }
                />

              </div>


              <div className="space-y-2">

                <Label>
                  Status
                </Label>

                <Select
                  value={
                    taskStatus
                  }
                  onValueChange={
                    setTaskStatus
                  }
                >

                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>

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

            </div>

          </div>


          <DialogFooter>

            <Button
              variant="outline"
              onClick={() =>
                setTaskDialogOpen(
                  false
                )
              }
            >
              Cancel
            </Button>

            <Button
              onClick={saveTask}
            >
              Save
            </Button>

          </DialogFooter>

        </DialogContent>

      </Dialog>


      {/* ======================================================
          ARCHIVE TASK DIALOG
      ====================================================== */}

      <AlertDialog
        open={
          !!deleteTaskTarget
        }
        onOpenChange={(value) => {
          if (!value) {
            setDeleteTaskTarget(
              null
            );
          }
        }}
      >

        <AlertDialogContent>

          <AlertDialogHeader>

            <AlertDialogTitle>
              Archive task?
            </AlertDialogTitle>

            <AlertDialogDescription>
              "{deleteTaskTarget?.title}" will be moved out of your lists but kept on record, so nothing is lost.
            </AlertDialogDescription>

          </AlertDialogHeader>


          <AlertDialogFooter>

            <AlertDialogCancel>
              Cancel
            </AlertDialogCancel>

            <AlertDialogAction
              onClick={
                confirmDeleteTask
              }
            >
              Archive
            </AlertDialogAction>

          </AlertDialogFooter>

        </AlertDialogContent>

      </AlertDialog>

    </motion.div>
  );
}
