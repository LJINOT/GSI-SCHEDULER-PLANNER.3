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
  ArrowLeft,
  Search,
  MoreHorizontal,
  Eye,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  priority_score: number | null;
  difficulty: string | null;
  category: string | null;
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

/** Map priority_score to HIGH / MEDIUM / LOW for compact scanning. */
function priorityLabel(score: number | null | undefined): "HIGH" | "MEDIUM" | "LOW" {
  if (score == null || !Number.isFinite(Number(score))) return "MEDIUM";
  const s = Number(score);
  if (s >= 0.66) return "HIGH";
  if (s >= 0.33) return "MEDIUM";
  return "LOW";
}

const priorityDot: Record<string, string> = {
  HIGH: "bg-destructive",
  MEDIUM: "bg-warning",
  LOW: "bg-success",
};

const priorityText: Record<string, string> = {
  HIGH: "text-destructive",
  MEDIUM: "text-warning",
  LOW: "text-success",
};


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

  /** Focused Project Details (reduces crowding vs embedding all tasks in every card). */
  const [selectedProjectId, setSelectedProjectId] =
    useState<string | null>(null);

  const [detailFilter, setDetailFilter] = useState<
    "all" | "todo" | "in_progress" | "done"
  >("all");

  const [detailSearch, setDetailSearch] = useState("");

  const [detailSort, setDetailSort] = useState<
    "priority" | "due" | "title" | "status"
  >("priority");

  /** Read-only task details panel (edit still uses existing dialog). */
  const [viewingTask, setViewingTask] =
    useState<Task | null>(null);

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
      setSelectedProjectId(highlightId);
      setView("cards");
      setTimeout(() => {
        projectRefs.current[
          highlightId
        ]?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 100);
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
          "id, title, description, status, due_date, start_time, estimated_duration, project_id, priority_score, difficulty, category"
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

  const selectedProject =
    selectedProjectId
      ? projects.find((pr) => pr.id === selectedProjectId) ?? null
      : null;

  const openProjectDetails = (projectId: string) => {
    setSelectedProjectId(projectId);
    setDetailFilter("all");
    setDetailSearch("");
    setDetailSort("priority");
    setViewingTask(null);
  };

  const closeProjectDetails = () => {
    setSelectedProjectId(null);
    setViewingTask(null);
    setDetailSearch("");
    setDetailFilter("all");
  };

  const detailTasksFor = (projectId: string) => {
    let list = tasksFor(projectId);
    if (detailFilter !== "all") {
      list = list.filter((t) => t.status === detailFilter);
    }
    const q = detailSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.description || "").toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (detailSort === "title") {
        return a.title.localeCompare(b.title);
      }
      if (detailSort === "status") {
        return a.status.localeCompare(b.status);
      }
      if (detailSort === "due") {
        const ad = a.due_date ? new Date(a.due_date).getTime() : Infinity;
        const bd = b.due_date ? new Date(b.due_date).getTime() : Infinity;
        return ad - bd;
      }
      // priority
      return (Number(b.priority_score) || 0) - (Number(a.priority_score) || 0);
    });
    return sorted;
  };

  const formatDueCompact = (iso: string | null) => {
    if (!iso) return null;
    try {
      return formatPH(iso, "MMM d");
    } catch {
      return null;
    }
  };

  const statusCountsFor = (projectId: string) => {
    const list = tasksFor(projectId);
    return {
      total: list.length,
      todo: list.filter((t) => t.status === "todo").length,
      in_progress: list.filter((t) => t.status === "in_progress").length,
      done: list.filter((t) => t.status === "done").length,
    };
  };

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
           CARD VIEW / PROJECT DETAILS
        ==================================================== */

        selectedProject ? (
          /* PROJECT DETAILS — compact summary + task list */
          <div className="space-y-4 max-w-3xl">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 -ml-2 text-muted-foreground"
              onClick={closeProjectDetails}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Projects
            </Button>

            <Card>
              <CardContent className="pt-5 pb-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: selectedProject.color }}
                      />
                      <h2 className="font-display text-xl font-semibold truncate">
                        {selectedProject.name}
                      </h2>
                    </div>
                    {selectedProject.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {selectedProject.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditDialog(selectedProject)}
                    >
                      <Pencil className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Archive project"
                      onClick={() => setDeleteProjectTarget(selectedProject)}
                    >
                      <Archive className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>

                {(() => {
                  const st = statsFor(selectedProject.id);
                  const sc = statusCountsFor(selectedProject.id);
                  return (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          Status:{" "}
                          <span className="text-foreground font-medium capitalize">
                            {(selectedProject.status || "active").replace(/_/g, " ")}
                          </span>
                        </span>
                        <span>
                          Progress:{" "}
                          <span className="text-foreground font-medium">{st.pct}%</span>
                        </span>
                        <span>
                          {st.done}/{st.total} completed
                        </span>
                      </div>
                      <Progress value={st.pct} className="h-2" />
                      <p className="text-[11px] text-muted-foreground">
                        {sc.total} task{sc.total === 1 ? "" : "s"}
                        {sc.total > 0 && (
                          <>
                            {" · "}
                            {sc.in_progress} In Progress · {sc.todo} To Do
                            {sc.done > 0 ? ` · ${sc.done} Done` : ""}
                          </>
                        )}
                      </p>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                  Tasks
                </h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    window.location.href = `/add-task?project=${selectedProject.id}`;
                  }}
                >
                  <PlusCircle className="mr-1.5 h-3.5 w-3.5" />
                  Add Task
                </Button>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={detailSearch}
                    onChange={(e) => setDetailSearch(e.target.value)}
                    placeholder="Search tasks..."
                    className="h-9 pl-8 text-sm"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { key: "all" as const, label: "All" },
                      { key: "todo" as const, label: "To Do" },
                      { key: "in_progress" as const, label: "In Progress" },
                      { key: "done" as const, label: "Done" },
                    ]
                  ).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setDetailFilter(opt.key)}
                      className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                        detailFilter === opt.key
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:border-muted-foreground/50"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <Select
                  value={detailSort}
                  onValueChange={(v) => setDetailSort(v as typeof detailSort)}
                >
                  <SelectTrigger className="h-9 w-[140px] text-xs">
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="priority">Priority</SelectItem>
                    <SelectItem value="due">Due date</SelectItem>
                    <SelectItem value="title">Title</SelectItem>
                    <SelectItem value="status">Status</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(() => {
                const rows = detailTasksFor(selectedProject.id);
                if (tasksFor(selectedProject.id).length === 0) {
                  return (
                    <Card className="border-dashed">
                      <CardContent className="py-8 text-center space-y-2">
                        <p className="text-sm font-medium">No tasks yet</p>
                        <p className="text-xs text-muted-foreground">
                          Add your first task to start planning this project.
                        </p>
                        <Button
                          size="sm"
                          className="mt-2"
                          onClick={() => {
                            window.location.href = `/add-task?project=${selectedProject.id}`;
                          }}
                        >
                          <PlusCircle className="mr-1.5 h-3.5 w-3.5" />
                          Add Task
                        </Button>
                      </CardContent>
                    </Card>
                  );
                }
                if (rows.length === 0) {
                  return (
                    <p className="text-xs text-muted-foreground py-4 text-center">
                      No tasks match this search or filter.
                    </p>
                  );
                }
                return (
                  <div className="rounded-lg border border-border divide-y divide-border max-h-[min(60vh,520px)] overflow-y-auto bg-card">
                    {rows.map((task) => {
                      const pri = priorityLabel(task.priority_score);
                      const due = formatDueCompact(task.due_date);
                      const dur =
                        task.estimated_duration != null
                          ? `${task.estimated_duration} min`
                          : null;
                      const meta = [due ? `Due ${due}` : null, dur]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <div
                          key={task.id}
                          className="group flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 cursor-pointer transition-colors"
                          onClick={() => setViewingTask(task)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setViewingTask(task);
                            }
                          }}
                        >
                          <div className="flex items-center gap-1.5 w-[4.5rem] shrink-0">
                            <span className={`h-2 w-2 rounded-full ${priorityDot[pri]}`} />
                            <span className={`text-[10px] font-semibold tracking-wide ${priorityText[pri]}`}>
                              {pri}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{task.title}</p>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {meta || "No due date"}
                              {" · "}
                              <span className="capitalize">{task.status.replace(/_/g, " ")}</span>
                            </p>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 opacity-70 group-hover:opacity-100"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setViewingTask(task);
                                }}
                              >
                                <Eye className="mr-2 h-3.5 w-3.5" />
                                View
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditTaskDialog(task);
                                }}
                              >
                                <Pencil className="mr-2 h-3.5 w-3.5" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteTaskTarget(task);
                                }}
                              >
                                <Archive className="mr-2 h-3.5 w-3.5" />
                                Archive
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const stats = statsFor(project.id);
            const counts = statusCountsFor(project.id);
            return (
              <Card
                key={project.id}
                ref={(element) => {
                  projectRefs.current[project.id] = element;
                }}
                className={`hover:shadow-md transition-shadow cursor-pointer ${
                  highlightId === project.id ? "ring-2 ring-primary" : ""
                }`}
                onClick={() => openProjectDetails(project.id)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: project.color }}
                      />
                      <CardTitle className="text-base truncate">
                        {project.name}
                      </CardTitle>
                    </div>
                    <div
                      className="flex items-center shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEditDialog(project)}
                      >
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Archive project"
                        onClick={() => setDeleteProjectTarget(project)}
                      >
                        <Archive className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 pt-0">
                  {project.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {project.description}
                    </p>
                  )}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {counts.total} task{counts.total === 1 ? "" : "s"}
                      {counts.in_progress > 0 ? ` · ${counts.in_progress} active` : ""}
                    </span>
                    <Badge variant="outline">{stats.pct}%</Badge>
                  </div>
                  <Progress value={stats.pct} className="h-1.5" />
                  <p className="text-[11px] text-primary/80 pt-0.5">View details →</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
        )

      )}


      {/* ======================================================
          TASK DETAILS (read-only, on demand)
      ====================================================== */}

      <Dialog
        open={!!viewingTask}
        onOpenChange={(open) => {
          if (!open) setViewingTask(null);
        }}
      >
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="pr-6">
              {viewingTask?.title || "Task Details"}
            </DialogTitle>
          </DialogHeader>

          {viewingTask && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Priority</p>
                  <p className={`font-medium ${priorityText[priorityLabel(viewingTask.priority_score)]}`}>
                    {priorityLabel(viewingTask.priority_score)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="font-medium capitalize">
                    {viewingTask.status.replace(/_/g, " ")}
                  </p>
                </div>
                {viewingTask.category && (
                  <div>
                    <p className="text-xs text-muted-foreground">Category</p>
                    <p className="font-medium">{viewingTask.category}</p>
                  </div>
                )}
                {viewingTask.difficulty && (
                  <div>
                    <p className="text-xs text-muted-foreground">Difficulty</p>
                    <p className="font-medium capitalize">{viewingTask.difficulty}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">Duration</p>
                  <p className="font-medium">
                    {viewingTask.estimated_duration != null
                      ? `${viewingTask.estimated_duration} minutes`
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Due Date</p>
                  <p className="font-medium">
                    {viewingTask.due_date
                      ? formatPH(viewingTask.due_date, "MMM d, yyyy h:mm a")
                      : "—"}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1">Description</p>
                <div className="rounded-md border border-border bg-muted/30 p-3 max-h-48 overflow-y-auto text-sm whitespace-pre-wrap">
                  {viewingTask.description?.trim() || (
                    <span className="text-muted-foreground">No description</span>
                  )}
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  variant="outline"
                  onClick={() => setViewingTask(null)}
                >
                  Close
                </Button>
                <Button
                  onClick={() => {
                    const t = viewingTask;
                    setViewingTask(null);
                    if (t) openEditTaskDialog(t);
                  }}
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Edit Task
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>


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
                  Duration (min)
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
