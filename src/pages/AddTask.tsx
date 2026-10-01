import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  Brain,
  Loader2,
  PlusCircle,
} from "lucide-react";
import { TITLE_MAX } from "@/lib/validation";
import { VA_CATEGORY_NAMES } from "@/lib/va-categories";

import {
  todayInputDate,
  tzOffset,
  getTimezone,
} from "@/lib/date-utils";

type Project = {
  id: string;
  name: string;
  color: string;
};

type AiMeta = {
  duration: number;
  difficulty: string;
  category: string;
  priority?: string;
  corrected_description?: string;
};

const MAX_DATE = "9999-12-31";

const categories = VA_CATEGORY_NAMES;

export default function AddTask({
  embedded = false,
  onCreated,
}: {
  embedded?: boolean;
  onCreated?: () => void;
} = {}) {
  const navigate = useNavigate();

  const prefillDate =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("date") || ""
      : "";

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [dueDate, setDueDate] = useState(
    embedded ? "" : prefillDate,
  );

  const [dueTime, setDueTime] = useState("");

  const [startTime, setStartTime] = useState("");

  const [startDate, setStartDate] = useState(
    embedded ? "" : prefillDate,
  );

  const [category, setCategory] = useState("");

  const [projectId, setProjectId] =
    useState<string>("none");

  const [projects, setProjects] =
    useState<Project[]>([]);

  const [showNewProject, setShowNewProject] =
    useState(false);

  const [newProjectName, setNewProjectName] =
    useState("");

  const [newProjectDesc, setNewProjectDesc] =
    useState("");

  const [loading, setLoading] = useState(false);

  const [analyzing, setAnalyzing] =
    useState(false);

  const [aiMeta, setAiMeta] =
    useState<AiMeta | null>(null);

  const [errors, setErrors] = useState<{
    title?: string;
    description?: string;
    dueDate?: string;
    dueTime?: string;
    startDate?: string;
    startTime?: string;
    newProject?: string;
  }>({});

  // ----------------------------------------
  // Load projects
  // ----------------------------------------

  useEffect(() => {
    let cancelled = false;

    const loadProjects = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || cancelled) return;

      const { data, error } = await supabase
        .from("projects")
        .select("id, name, color")
        .eq("user_id", user.id)
        .order("created_at", {
          ascending: false,
        });

      if (error) {
        console.error(
          "AddTask: failed to load projects:",
          error,
        );
        return;
      }

      if (!cancelled) {
        setProjects(data || []);
      }
    };

    loadProjects();

    return () => {
      cancelled = true;
    };
  }, []);

  // ----------------------------------------
  // Project selection
  // ----------------------------------------

  const handleProjectChange = (
    val: string,
  ) => {
    if (val === "__new__") {
      setShowNewProject(true);
      setProjectId("none");
    } else {
      setShowNewProject(false);
      setProjectId(val);
    }
  };

  // ----------------------------------------
  // Create project
  // ----------------------------------------

  const createInlineProject =
    async () => {
      if (!newProjectName.trim()) {
        setErrors((p) => ({
          ...p,
          newProject:
            "Project name is required",
        }));
        return;
      }

      setErrors((p) => ({
        ...p,
        newProject: undefined,
      }));

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        toast.error("Not logged in");
        return;
      }

      const norm =
        newProjectName
          .trim()
          .toLowerCase();

      const {
        data: existingProjects,
        error: projectCheckError,
      } = await supabase
        .from("projects")
        .select("id, name")
        .eq("user_id", user.id)
        .or(
          "archived.eq.false,archived.is.null",
        );

      if (projectCheckError) {
        console.error(
          "AddTask: project check failed:",
          projectCheckError,
        );

        toast.error(
          "Unable to check existing projects.",
        );

        return;
      }

      if (
        (existingProjects || []).some(
          (row: { name?: string }) =>
            String(row.name || "")
              .trim()
              .toLowerCase() === norm,
        )
      ) {
        setErrors((p) => ({
          ...p,
          newProject:
            "Project name already exists. Please use a different project name.",
        }));
        return;
      }

      const {
        data,
        error,
      } = await supabase
        .from("projects")
        .insert({
          user_id: user.id,
          name: newProjectName.trim(),
          description:
            newProjectDesc.trim() || null,
        })
        .select()
        .single();

      if (error) {
        toast.error(
          /duplicate|unique/i.test(
            error.message || "",
          )
            ? "Project name already exists. Please use a different project name."
            : error.message,
        );
        return;
      }

      if (!data) {
        toast.error(
          "Project was not created.",
        );
        return;
      }

      setProjects((previous) => [
        data as Project,
        ...previous,
      ]);

      setProjectId(data.id);
      setShowNewProject(false);
      setNewProjectName("");
      setNewProjectDesc("");

      toast.success("Project created");
    };

  // ----------------------------------------
  // Reset
  // ----------------------------------------

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setDueDate("");
    setDueTime("");
    setStartTime("");
    setStartDate("");
    setCategory("");
    setProjectId("none");
    setAiMeta(null);
    setErrors({});
  };

  // ----------------------------------------
  // Analyze task with AI
  // ----------------------------------------

  const analyzeTask = async () => {
    if (!title.trim()) {
      setErrors((p) => ({
        ...p,
        title: "Enter a title first",
      }));
      return;
    }

    if (analyzing) return;

    setAnalyzing(true);

    try {
      console.log(
        "AddTask: starting AI analysis",
      );

      const {
        data,
        error,
      } = await supabase.functions.invoke(
        "analyze-task",
        {
          body: {
            title: title.trim(),
            description,
            category:
              category || undefined,
          },
        },
      );

      console.log(
        "AddTask: analyze-task response:",
        data,
      );

      console.log(
        "AddTask: analyze-task error:",
        error,
      );

      if (error) {
        console.error(
          "AddTask: Edge Function error:",
          error,
        );

        throw new Error(
          error.message ||
            "The AI analysis function failed.",
        );
      }

      const payload =
        data &&
        typeof data === "object"
          ? (data as Record<
              string,
              unknown
            >)
          : null;

      if (!payload) {
        throw new Error(
          "The AI function returned no data.",
        );
      }

      if (payload.ok === false) {
        const mainError =
          typeof payload.error === "string"
            ? payload.error
            : "AI analysis failed.";

        const details =
          typeof payload.details ===
          "string"
            ? payload.details
            : "";

        console.error(
          "AddTask: Gemini error:",
          {
            mainError,
            details,
          },
        );

        throw new Error(
          details
            ? `${mainError} ${details}`
            : mainError,
        );
      }

      const duration =
        Number(payload.duration);

      if (
        !Number.isFinite(duration) ||
        duration <= 0
      ) {
        console.error(
          "AddTask: Invalid AI response:",
          payload,
        );

        throw new Error(
          "AI returned an invalid duration.",
        );
      }

      const difficulty =
        typeof payload.difficulty ===
        "string"
          ? payload.difficulty
          : "medium";

      const analyzedCategory =
        typeof payload.category ===
          "string" &&
        payload.category.trim()
          ? payload.category.trim()
          : category || "General";

      const priority =
        typeof payload.priority ===
        "string"
          ? payload.priority
          : "medium";

      const correctedDescription =
        typeof payload.corrected_description ===
        "string"
          ? payload.corrected_description
          : "";

      const result: AiMeta = {
        duration,
        difficulty,
        category: analyzedCategory,
        priority,
        corrected_description:
          correctedDescription,
      };

      setAiMeta(result);

      if (!category) {
        setCategory(
          analyzedCategory,
        );
      }

      if (
        correctedDescription &&
        correctedDescription !==
          description
      ) {
        setDescription(
          correctedDescription,
        );

        toast.success(
          "AI analysis complete — description auto-corrected",
        );
      } else {
        toast.success(
          "AI analysis complete!",
        );
      }

      console.log(
        "AddTask: AI analysis successful:",
        result,
      );
    } catch (err: unknown) {
      console.error(
        "AddTask: AI analysis failed:",
        err,
      );

      const message =
        err instanceof Error
          ? err.message
          : "Analysis failed.";

      toast.error(message);
    } finally {
      setAnalyzing(false);
    }
  };

  // ----------------------------------------
  // Date validation
  // ----------------------------------------

  const isValidYear = (
    dateStr: string,
  ) => {
    if (!dateStr) return true;

    const year = parseInt(
      dateStr.slice(0, 4),
      10,
    );

    return (
      !Number.isNaN(year) &&
      year <= 9999
    );
  };

  // ----------------------------------------
  // Submit task
  // ----------------------------------------

  const handleSubmit = async (
    e: React.FormEvent,
  ) => {
    e.preventDefault();

    const trimmedTitle =
      title.trim();

    const trimmedDescription =
      description.trim();

    const validationErrors:
      typeof errors = {};

    // ----------------------------------------
    // Required fields
    // ----------------------------------------

    if (!trimmedTitle) {
      validationErrors.title =
        "Task title is required.";
    } else if (
      trimmedTitle.length > TITLE_MAX
    ) {
      validationErrors.title =
        `Keep the title under ${TITLE_MAX} characters.`;
    }

    if (!trimmedDescription) {
      validationErrors.description =
        "Task description is required.";
    }

    if (!dueDate) {
      validationErrors.dueDate =
        "Due date is required.";
    }

    if (!dueTime) {
      validationErrors.dueTime =
        "Due time is required.";
    }

    // Start date/time are optional,
    // but they must always be entered
    // as a pair.

    if (
      startDate &&
      !startTime
    ) {
      validationErrors.startTime =
        "Start time is required when a start date is set.";
    }

    if (
      startTime &&
      !startDate
    ) {
      validationErrors.startDate =
        "Start date is required when a start time is set.";
    }

    if (
      Object.keys(
        validationErrors,
      ).length > 0
    ) {
      setErrors((p) => ({
        ...p,
        ...validationErrors,
      }));

      toast.error(
        "Please complete all required task fields.",
      );

      setLoading(false);
      return;
    }

    // ----------------------------------------
    // Date validation
    // ----------------------------------------

    if (
      dueDate <
      todayInputDate()
    ) {
      setErrors((p) => ({
        ...p,
        dueDate:
          "Due date cannot be in the past.",
      }));

      toast.error(
        "Due date cannot be in the past.",
      );

      return;
    }

    if (
      startDate &&
      startDate <
        todayInputDate()
    ) {
      setErrors((p) => ({
        ...p,
        startDate:
          "Start date cannot be in the past.",
      }));

      toast.error(
        "Start date cannot be in the past.",
      );

      return;
    }

    if (
      !isValidYear(dueDate) ||
      !isValidYear(startDate)
    ) {
      toast.error(
        "Year cannot be greater than 9999.",
      );

      return;
    }

    setErrors((p) => ({
      ...p,
      title: undefined,
      description: undefined,
      dueDate: undefined,
      dueTime: undefined,
      startDate: undefined,
      startTime: undefined,
    }));

    setLoading(true);

    // ----------------------------------------
    // Get authenticated user
    // ----------------------------------------

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      toast.error("Not logged in");
      setLoading(false);
      return;
    }

    // ----------------------------------------
    // Duplicate title checker
    // ----------------------------------------

    const normalizedTitle =
      trimmedTitle.toLowerCase();

    const {
      data: existingTitles,
      error: titleCheckError,
    } = await supabase
      .from("tasks")
      .select("id, title")
      .eq("user_id", user.id)
      .or(
        "archived.eq.false,archived.is.null",
      );

    if (titleCheckError) {
      console.error(
        "AddTask: failed to check existing task titles:",
        titleCheckError,
      );

      toast.error(
        "Unable to verify the task title. Please try again.",
      );

      setLoading(false);
      return;
    }

    const duplicate =
      (existingTitles || []).some(
        (row: { title?: string }) =>
          String(
            row.title || "",
          )
            .trim()
            .toLowerCase() ===
          normalizedTitle,
      );

    if (duplicate) {
      setErrors((p) => ({
        ...p,
        title:
          "Task title already exists. Please use a different task title.",
      }));

      toast.error(
        "Task title already exists.",
      );

      setLoading(false);
      return;
    }

    setErrors((p) => ({
      ...p,
      title: undefined,
    }));

    // ----------------------------------------
    // Auto-analyze if AI was not manually run
    // ----------------------------------------

    let meta = aiMeta;

    if (!meta) {
      try {
        const {
          data,
          error,
        } =
          await supabase.functions.invoke(
            "analyze-task",
            {
              body: {
                title:
                  trimmedTitle,
                description:
                  trimmedDescription,
                category:
                  category ||
                  undefined,
              },
            },
          );

        if (
          !error &&
          data &&
          typeof data ===
            "object"
        ) {
          const payload =
            data as Record<
              string,
              unknown
            >;

          if (
            payload.ok !== false &&
            typeof payload.duration ===
              "number"
          ) {
            meta = {
              duration:
                payload.duration,

              difficulty:
                typeof payload.difficulty ===
                "string"
                  ? payload.difficulty
                  : "medium",

              category:
                typeof payload.category ===
                "string"
                  ? payload.category
                  : category ||
                    "General",

              priority:
                typeof payload.priority ===
                "string"
                  ? payload.priority
                  : "medium",

              corrected_description:
                typeof payload.corrected_description ===
                "string"
                  ? payload.corrected_description
                  : "",
            };

            setAiMeta(meta);

            if (
              meta.corrected_description &&
              meta.corrected_description !==
                description
            ) {
              setDescription(
                meta.corrected_description,
              );
            }
          }
        }
      } catch (error) {
        console.warn(
          "Automatic AI analysis failed. Task will still be saved:",
          error,
        );
      }
    }

    // ----------------------------------------
    // Build timezone-aware dates
    // ----------------------------------------

    const off = tzOffset(
      new Date(),
      getTimezone(),
    );

    let dueDatetime:
      | string
      | null = null;

    if (dueDate) {
      dueDatetime = dueTime
        ? `${dueDate}T${dueTime}:00${off}`
        : `${dueDate}T23:59:00${off}`;
    }

    let startDatetime:
      | string
      | null = null;

    const effectiveStartDate =
      startDate || dueDate;

    if (
      effectiveStartDate &&
      startTime
    ) {
      startDatetime =
        `${effectiveStartDate}T${startTime}:00${off}`;
    }

    // ----------------------------------------
    // Validate due date/time
    // ----------------------------------------

    if (!dueDatetime) {
      toast.error(
        "Due date and due time are required.",
      );

      setLoading(false);
      return;
    }

    const dueTimestamp =
      new Date(
        dueDatetime,
      ).getTime();

    if (
      !Number.isFinite(
        dueTimestamp,
      )
    ) {
      toast.error(
        "Please enter a valid due date and time.",
      );

      setLoading(false);
      return;
    }

    if (
      dueTimestamp <=
      Date.now()
    ) {
      toast.error(
        "Due date and time must be in the future.",
      );

      setLoading(false);
      return;
    }

    // ----------------------------------------
    // Validate start date/time
    // ----------------------------------------

    if (startDatetime) {
      const startTimestamp =
        new Date(
          startDatetime,
        ).getTime();

      if (
        !Number.isFinite(
          startTimestamp,
        )
      ) {
        toast.error(
          "Please enter a valid start date and time.",
        );

        setLoading(false);
        return;
      }

      if (
        startTimestamp >=
        dueTimestamp
      ) {
        toast.error(
          "Start date and time must be before the due date and time.",
        );

        setLoading(false);
        return;
      }
    }

    // ----------------------------------------
    // Prevent past start time
    // ----------------------------------------

    if (
      startDatetime &&
      new Date(
        startDatetime,
      ).getTime() <
        Date.now()
    ) {
      toast.error(
        "Start time cannot be in the past.",
      );

      setLoading(false);
      return;
    }

    // ----------------------------------------
    // Final category
    // ----------------------------------------

    const finalCategory =
      category ||
      meta?.category ||
      "General";

    // ============================================================
    // IMPORTANT SCHEDULING RULE
    // ============================================================
    //
    // DO NOT CHECK FOR OVERLAPPING TASKS HERE.
    //
    // Add Task is responsible for collecting and saving
    // the user's task information.
    //
    // The scheduling system is responsible for solving
    // conflicts between tasks.
    //
    // Workflow:
    //
    // User enters tasks
    //       ↓
    // AHP → determine priority
    //       ↓
    // PSO → search for task order
    //       ↓
    // CSP → find valid time slots
    //       ↓
    // Generated schedule
    //
    // Therefore:
    //
    // Multiple tasks may temporarily have the same
    // requested start time.
    //
    // They must still be saved.
    //
    // The final generated schedule must NOT contain
    // overlapping tasks.
    // ============================================================

    // ----------------------------------------
    // Initial status
    // ----------------------------------------

    let initialStatus =
      "todo";

    if (
      startDatetime &&
      new Date(
        startDatetime,
      ) <= new Date()
    ) {
      initialStatus =
        "in_progress";
    }

    // ----------------------------------------
    // Insert task
    // ----------------------------------------

    const {
      error: insertError,
    } = await supabase
      .from("tasks")
      .insert({
        title:
          trimmedTitle,

        description:
          trimmedDescription,

        due_date:
          dueDatetime,

        start_time:
          startDatetime,

        estimated_duration:
          meta?.duration ||
          null,

        difficulty:
          meta?.difficulty ||
          null,

        category:
          finalCategory,

        status:
          initialStatus,

        user_id:
          user.id,

        project_id:
          projectId !== "none"
            ? projectId
            : null,

        archived: false,
      });

    setLoading(false);

    if (insertError) {
      console.error(
        "AddTask: failed to create task:",
        insertError,
      );

      toast.error(
        insertError.message ||
          "Failed to create task.",
      );

      return;
    }

    // ----------------------------------------
    // Success
    // ----------------------------------------

    toast.success(
      "Task created successfully!",
    );

    resetForm();

    if (embedded) {
      onCreated?.();
    } else {
      navigate("/tasks");
    }
  };

  // ----------------------------------------
  // UI
  // ----------------------------------------

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
      className={
        embedded
          ? "space-y-4"
          : "max-w-2xl mx-auto space-y-6"
      }
    >
      {!embedded && (
        <h1 className="font-display text-3xl font-bold">
          Add Task
        </h1>
      )}

      <form onSubmit={handleSubmit}>
        <Card
          className={
            embedded
              ? "border-0 shadow-none"
              : undefined
          }
        >
          {!embedded && (
            <CardHeader>
              <CardTitle className="font-display">
                New Task
              </CardTitle>
            </CardHeader>
          )}

          <CardContent
            className={
              embedded
                ? "space-y-4 p-0"
                : "space-y-4"
            }
          >
            {/* TITLE */}
            <div className="space-y-2">
              <Label htmlFor="title">
                Title
              </Label>

              <Input
                id="title"
                required
                value={title}
                onChange={(e) => {
                  setTitle(
                    e.target.value,
                  );

                  if (errors.title) {
                    setErrors((p) => ({
                      ...p,
                      title:
                        undefined,
                    }));
                  }

                  if (aiMeta) {
                    setAiMeta(null);
                  }
                }}
                placeholder="e.g. Finish Math Assignment or Grocery shopping"
                aria-invalid={
                  !!errors.title
                }
                maxLength={
                  TITLE_MAX
                }
                className={
                  errors.title
                    ? "border-destructive focus-visible:ring-destructive"
                    : undefined
                }
              />

              <p className="text-xs text-muted-foreground">
                {title.length}/
                {TITLE_MAX} characters
              </p>

              {errors.title && (
                <p className="text-xs text-destructive">
                  {errors.title}
                </p>
              )}
            </div>

            {/* DESCRIPTION */}
            <div className="space-y-2">
              <Label htmlFor="desc">
                Description
              </Label>

              <Textarea
                id="desc"
                required
                aria-invalid={
                  !!errors.description
                }
                value={description}
                onChange={(e) => {
                  setDescription(
                    e.target.value,
                  );

                  if (aiMeta) {
                    setAiMeta(null);
                  }
                }}
                placeholder="Add details..."
                rows={3}
                autoCorrect="on"
                spellCheck
                autoCapitalize="sentences"
              />

              {errors.description && (
                <p className="text-xs text-destructive">
                  {errors.description}
                </p>
              )}
            </div>

            {/* PROJECT */}
            <div className="space-y-2">
              <Label>
                Project
              </Label>

              <Select
                value={projectId}
                onValueChange={
                  handleProjectChange
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="none">
                    Stand-alone Task
                  </SelectItem>

                  {projects.map((p) => (
                    <SelectItem
                      key={p.id}
                      value={p.id}
                    >
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{
                            backgroundColor:
                              p.color,
                          }}
                        />
                        {p.name}
                      </span>
                    </SelectItem>
                  ))}

                  <SelectItem value="__new__">
                    <span className="inline-flex items-center gap-1 text-primary">
                      <PlusCircle className="h-3 w-3" />
                      Create New Project
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>

              {showNewProject && (
                <Card className="bg-accent/30 border-primary/20">
                  <CardContent className="py-3 space-y-2">
                    <Input
                      value={
                        newProjectName
                      }
                      onChange={(e) => {
                        setNewProjectName(
                          e.target.value,
                        );

                        if (
                          errors.newProject
                        ) {
                          setErrors((p) => ({
                            ...p,
                            newProject:
                              undefined,
                          }));
                        }
                      }}
                      placeholder="Project name"
                      aria-invalid={
                        !!errors.newProject
                      }
                      className={
                        errors.newProject
                          ? "border-destructive focus-visible:ring-destructive"
                          : undefined
                      }
                    />

                    {errors.newProject && (
                      <p className="text-xs text-destructive">
                        {
                          errors.newProject
                        }
                      </p>
                    )}

                    <Textarea
                      value={
                        newProjectDesc
                      }
                      onChange={(e) =>
                        setNewProjectDesc(
                          e.target.value,
                        )
                      }
                      rows={2}
                      placeholder="Description (optional)"
                    />

                    <div className="flex gap-2 justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setShowNewProject(
                            false,
                          )
                        }
                      >
                        Cancel
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        onClick={
                          createInlineProject
                        }
                      >
                        Create
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* CATEGORY */}
            <div className="space-y-2">
              <Label>
                Category
              </Label>

              <Select
                value={category}
                onValueChange={(value) => {
                  setCategory(value);

                  if (aiMeta) {
                    setAiMeta(null);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>

                <SelectContent>
                  {categories.map(
                    (c) => (
                      <SelectItem
                        key={c}
                        value={c}
                      >
                        {c}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* DUE DATE / TIME */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="due-date">
                  Due Date
                </Label>

                <Input
                  id="due-date"
                  type="date"
                  required
                  min={todayInputDate()}
                  max={MAX_DATE}
                  value={dueDate}
                  onChange={(e) => {
                    setDueDate(
                      e.target.value,
                    );

                    if (
                      errors.dueDate
                    ) {
                      setErrors((p) => ({
                        ...p,
                        dueDate:
                          undefined,
                      }));
                    }
                  }}
                  aria-invalid={
                    !!errors.dueDate
                  }
                />

                {errors.dueDate && (
                  <p className="text-xs text-destructive">
                    {errors.dueDate}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="due-time">
                  Due Time
                </Label>

                <Input
                  id="due-time"
                  type="time"
                  required
                  value={dueTime}
                  onChange={(e) => {
                    setDueTime(
                      e.target.value,
                    );

                    if (
                      errors.dueTime
                    ) {
                      setErrors((p) => ({
                        ...p,
                        dueTime:
                          undefined,
                      }));
                    }
                  }}
                  aria-invalid={
                    !!errors.dueTime
                  }
                />

                {errors.dueTime && (
                  <p className="text-xs text-destructive">
                    {errors.dueTime}
                  </p>
                )}
              </div>
            </div>

            {/* START DATE / TIME */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start-date">
                  Start Date
                </Label>

                <Input
                  id="start-date"
                  type="date"
                  min={todayInputDate()}
                  max={MAX_DATE}
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(
                      e.target.value,
                    );

                    if (
                      errors.startDate
                    ) {
                      setErrors((p) => ({
                        ...p,
                        startDate:
                          undefined,
                      }));
                    }
                  }}
                  aria-invalid={
                    !!errors.startDate
                  }
                />

                {errors.startDate && (
                  <p className="text-xs text-destructive">
                    {errors.startDate}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="start-time">
                  Start Time
                </Label>

                <Input
                  id="start-time"
                  type="time"
                  value={startTime}
                  onChange={(e) => {
                    setStartTime(
                      e.target.value,
                    );

                    if (
                      errors.startTime
                    ) {
                      setErrors((p) => ({
                        ...p,
                        startTime:
                          undefined,
                      }));
                    }
                  }}
                  aria-invalid={
                    !!errors.startTime
                  }
                />

                {errors.startTime && (
                  <p className="text-xs text-destructive">
                    {errors.startTime}
                  </p>
                )}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Task will auto-switch to
              "In Progress" when this
              date/time is reached. If no
              start date is set, the due
              date will be used.
            </p>

            {/* AI BUTTON */}
            <Button
              type="button"
              variant="outline"
              onClick={analyzeTask}
              disabled={analyzing}
              className="w-full"
            >
              {analyzing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Brain className="mr-2 h-4 w-4" />
              )}

              {analyzing
                ? "Analyzing..."
                : "Analyze with AI"}
            </Button>

        {/* AI RESULT */}
{aiMeta && (
  <Card className="bg-accent/30 border-primary/20">
    <CardContent className="py-4 space-y-4">
      {/* Header */}
      <div>
        <p className="text-sm font-semibold">
          AI Analysis
        </p>

        <p className="text-xs text-muted-foreground mt-1">
          The task is analyzed using the following criteria:
          difficulty, duration, category importance, and
          deadline proximity.
        </p>
      </div>

      {/* Criteria Table */}
      <div className="rounded-lg border overflow-hidden">
        <div className="grid grid-cols-[1fr_1.2fr] bg-muted/50 border-b">
          <div className="px-3 py-2 text-xs font-semibold">
            Criterion
          </div>

          <div className="px-3 py-2 text-xs font-semibold">
            Task Information
          </div>
        </div>

        {/* Difficulty */}
        <div className="grid grid-cols-[1fr_1.2fr] border-b">
          <div className="px-3 py-3 text-sm font-medium">
            Difficulty
          </div>

          <div className="px-3 py-3 text-sm">
            <Badge variant="outline" className="capitalize">
              {aiMeta.difficulty}
            </Badge>
          </div>
        </div>

        {/* Duration */}
        <div className="grid grid-cols-[1fr_1.2fr] border-b">
          <div className="px-3 py-3 text-sm font-medium">
            Duration
          </div>

          <div className="px-3 py-3 text-sm">
            <Badge variant="outline">
              {aiMeta.duration} minutes
            </Badge>
          </div>
        </div>

        {/* Category Importance */}
        <div className="grid grid-cols-[1fr_1.2fr] border-b">
          <div className="px-3 py-3 text-sm font-medium">
            Category Importance
          </div>

          <div className="px-3 py-3 text-sm">
            <Badge variant="outline">
              {aiMeta.category}
            </Badge>
          </div>
        </div>

        {/* Deadline Proximity */}
        <div className="grid grid-cols-[1fr_1.2fr]">
          <div className="px-3 py-3 text-sm font-medium">
            Deadline Proximity
          </div>

          <div className="px-3 py-3 text-sm">
            {dueDate && dueTime ? (
              <div className="space-y-1">
                <Badge variant="outline">
                  {dueDate} at {dueTime}
                </Badge>

                <p className="text-xs text-muted-foreground">
                  How close the task is to its deadline.
                </p>
              </div>
            ) : (
              <span className="text-muted-foreground">
                Deadline not set
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Overall Priority */}
      {aiMeta.priority && (
        <div className="rounded-lg border bg-background/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">
                Overall Priority
              </p>

              <p className="text-sm font-semibold mt-1">
                Calculated Priority
              </p>
            </div>

            <Badge
              variant="outline"
              className="capitalize font-semibold"
            >
              ⚡ {aiMeta.priority}
            </Badge>
          </div>
        </div>
      )}

      {/* Explanation */}
      <div className="rounded-md bg-muted/40 p-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">
            How this is used:
          </span>{" "}
          These task characteristics provide the information
          used when determining the task's priority and
          scheduling order. Difficulty, duration, category
          importance, and deadline proximity are considered
          when managing the task.
        </p>
      </div>
    </CardContent>
  </Card>
)}

            {/* CREATE TASK */}
            <Button
              type="submit"
              className="w-full"
              disabled={loading}
            >
              {loading
                ? "Creating..."
                : "Create Task"}
            </Button>
          </CardContent>
        </Card>
      </form>
    </motion.div>
  );
}
