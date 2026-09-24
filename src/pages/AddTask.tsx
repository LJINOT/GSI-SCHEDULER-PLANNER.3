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

const categories = [
  // Academic
  "Assignment",
  "Exam Review",
  "Project",
  "Research",
  "Reading",
  "Lab Work",
  "Presentation",

  // Personal / lifestyle
  "Personal",
  "Health",
  "Errands",
  "Chores",
  "Social",
  "Finance",
  "Fitness",

  // Workplace / general
  "Office Work",
  "Meeting",
  "Construction",
  "Field Work",

  // Freelance / VA
  "Freelancing",
  "Virtual Assistant",
  "Client Communication",
  "Email Management",
  "Calendar Scheduling",
  "Project Tracking",
  "Social Media Management",
  "Content Creation",
  "Graphic Design",
  "Video Editing",
  "Data Entry",
  "Research Task",
  "Bookkeeping",
  "Invoicing",
  "Customer Support",
  "Lead Generation",
  "Transcription",
  "Translation",
  "SEO Optimization",
  "Website Maintenance",
  "Proposal Writing",
  "Meeting Notes",
  "Other",
];

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

      const norm = newProjectName.trim().toLowerCase();
      const { data: existingProjects } = await supabase
        .from("projects")
        .select("id, name")
        .eq("user_id", user.id)
        .or("archived.eq.false,archived.is.null");
      if ((existingProjects || []).some(
        (row: { name?: string }) =>
          String(row.name || "").trim().toLowerCase() === norm,
      )) {
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
          /duplicate|unique/i.test(error.message || "")
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

      // ------------------------------------
      // Supabase function-level error
      // ------------------------------------

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

      // ------------------------------------
      // Validate response
      // ------------------------------------

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

      // ------------------------------------
      // New Edge Function returns:
      //
      // {
      //   ok: false,
      //   error: "...",
      //   details: "..."
      // }
      // ------------------------------------

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

      // ------------------------------------
      // Validate required AI result
      // ------------------------------------

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

      // ------------------------------------
      // Save AI result
      // ------------------------------------

      const result: AiMeta = {
        duration,
        difficulty,
        category: analyzedCategory,
        priority,
        corrected_description:
          correctedDescription,
      };

      setAiMeta(result);

      // ------------------------------------
      // Apply corrected description
      // ------------------------------------

      if (
        correctedDescription &&
        correctedDescription !== description
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

      // Don't remove an existing successful
      // AI analysis if a later request fails.
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

    // The required task details are validated here as well as in the
    // form controls so a task cannot be created by bypassing browser
    // validation or by submitting an incomplete form.
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const validationErrors: typeof errors = {};

    if (!trimmedTitle) {
      validationErrors.title = "Task title is required.";
    } else if (trimmedTitle.length > TITLE_MAX) {
      validationErrors.title = `Keep the title under ${TITLE_MAX} characters.`;
    }

    if (!trimmedDescription) {
      validationErrors.description = "Task description is required.";
    }

    if (!dueDate) {
      validationErrors.dueDate = "Due date is required.";
    }

    if (!dueTime) {
      validationErrors.dueTime = "Due time is required.";
    }

    // Start date/time are optional, but they must always be entered as a pair.
    if (startDate && !startTime) {
      validationErrors.startTime = "Start time is required when a start date is set.";
    }
    if (startTime && !startDate) {
      validationErrors.startDate = "Start date is required when a start time is set.";
    }

    if (Object.keys(validationErrors).length > 0) {
      setErrors((p) => ({ ...p, ...validationErrors }));
      toast.error("Please complete all required task fields.");
      setLoading(false);
      return;
    }

    if (dueDate < todayInputDate()) {
      setErrors((p) => ({
        ...p,
        dueDate: "Due date cannot be in the past.",
      }));
      toast.error("Due date cannot be in the past.");
      return;
    }

    if (startDate && startDate < todayInputDate()) {
      setErrors((p) => ({
        ...p,
        startDate: "Start date cannot be in the past.",
      }));
      toast.error("Start date cannot be in the past.");
      return;
    }

    if (!isValidYear(dueDate) || !isValidYear(startDate)) {
      toast.error("Year cannot be greater than 9999.");
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

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      toast.error("Not logged in");
      setLoading(false);
      return;
    }

    // ------------------------------------
    // Duplicate title checker
    // ------------------------------------

    const normalizedTitle = title.trim().toLowerCase();
    const { data: existingTitles } = await supabase
      .from("tasks")
      .select("id, title")
      .eq("user_id", user.id)
      .or("archived.eq.false,archived.is.null");

    const dup = (existingTitles || []).some(
      (row: { title?: string }) =>
        String(row.title || "").trim().toLowerCase() === normalizedTitle,
    );

    if (dup) {
      setErrors((p) => ({
        ...p,
        title: "Task title already exists. Please use a different task title.",
      }));
      setLoading(false);
      return;
    }

    setErrors((p) => ({
      ...p,
      title: undefined,
    }));

    // ------------------------------------
    // Auto-analyze if the user didn't
    // manually click Analyze with AI.
    // ------------------------------------

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
                title: title.trim(),
                description,
                category:
                  category || undefined,
              },
            },
          );

        if (
          !error &&
          data &&
          typeof data === "object"
        ) {
          const payload =
            data as Record<
              string,
              unknown
            >;

          // Only use the result when
          // the Edge Function says it succeeded.
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

    // ------------------------------------
    // Build timezone-aware dates
    // ------------------------------------

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

    // ------------------------------------
    // Validate required due date/time and
    // start date/time relationship.
    // ------------------------------------

    if (!dueDatetime) {
      toast.error("Due date and due time are required.");
      setLoading(false);
      return;
    }

    const dueTimestamp = new Date(dueDatetime).getTime();
    if (!Number.isFinite(dueTimestamp)) {
      toast.error("Please enter a valid due date and time.");
      setLoading(false);
      return;
    }

    if (dueTimestamp <= Date.now()) {
      toast.error("Due date and time must be in the future.");
      setLoading(false);
      return;
    }

    if (startDatetime) {
      const startTimestamp = new Date(startDatetime).getTime();
      if (!Number.isFinite(startTimestamp)) {
        toast.error("Please enter a valid start date and time.");
        setLoading(false);
        return;
      }

      if (startTimestamp >= dueTimestamp) {
        toast.error("Start date and time must be before the due date and time.");
        setLoading(false);
        return;
      }
    }

    // ------------------------------------
    // Prevent past start time
    // ------------------------------------

    if (
      startDatetime &&
      new Date(startDatetime).getTime() <
        Date.now()
    ) {
      toast.error(
        "Start time cannot be in the past.",
      );

      setLoading(false);
      return;
    }

    // ------------------------------------
    // Final category
    // ------------------------------------

    const finalCategory =
      category ||
      meta?.category ||
      "General";

    // ------------------------------------
    // Prevent overlapping schedules
    // ------------------------------------

    if (startDatetime) {
      const newStart =
        new Date(
          startDatetime,
        ).getTime();

      const newEnd =
        newStart +
        (meta?.duration || 30) *
          60_000;

      const {
        data: scheduled,
      } = await supabase
        .from("tasks")
        .select(
          "title, start_time, estimated_duration",
        )
        .eq(
          "user_id",
          user.id,
        )
        .eq(
          "archived",
          false,
        )
        .neq(
          "status",
          "done",
        )
        .not(
          "start_time",
          "is",
          null,
        );

      const clash =
        (scheduled || []).find(
          (t: any) => {
            const s =
              new Date(
                t.start_time,
              ).getTime();

            const e =
              s +
              (t.estimated_duration ||
                30) *
                60_000;

            return (
              newStart < e &&
              s < newEnd
            );
          },
        );

      if (clash) {
        setLoading(false);

        toast.error(
          `That time overlaps with "${clash.title}". Pick another start time.`,
        );

        return;
      }
    }

    // ------------------------------------
    // Initial status
    // ------------------------------------

    let initialStatus =
      "todo";

    if (
      startDatetime &&
      new Date(startDatetime) <=
        new Date()
    ) {
      initialStatus =
        "in_progress";
    }

    // ------------------------------------
    // Insert task
    // ------------------------------------

    const {
      error,
    } = await supabase
      .from("tasks")
      .insert({
        title: trimmedTitle,
        description: trimmedDescription,

        due_date:
          dueDatetime,

        start_time:
          startDatetime,

        estimated_duration:
          meta?.duration || null,

        difficulty:
          meta?.difficulty || null,

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
      });

    setLoading(false);

    if (error) {
      toast.error(
        error.message,
      );
    } else {
      toast.success(
        "Task created!",
      );

      resetForm();

      if (embedded) {
        onCreated?.();
      } else {
        navigate("/tasks");
      }
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

                  // Clear previous AI
                  // analysis when the task
                  // itself changes.
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
                aria-invalid={!!errors.description}
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
                    setDueDate(e.target.value);
                    if (errors.dueDate) {
                      setErrors((p) => ({ ...p, dueDate: undefined }));
                    }
                  }}
                  aria-invalid={!!errors.dueDate}
                />
                {errors.dueDate && (
                  <p className="text-xs text-destructive">{errors.dueDate}</p>
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
                    setDueTime(e.target.value);
                    if (errors.dueTime) {
                      setErrors((p) => ({ ...p, dueTime: undefined }));
                    }
                  }}
                  aria-invalid={!!errors.dueTime}
                />
                {errors.dueTime && (
                  <p className="text-xs text-destructive">{errors.dueTime}</p>
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
                    setStartDate(e.target.value);
                    if (errors.startDate) {
                      setErrors((p) => ({ ...p, startDate: undefined }));
                    }
                  }}
                  aria-invalid={!!errors.startDate}
                />
                {errors.startDate && (
                  <p className="text-xs text-destructive">{errors.startDate}</p>
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
                    setStartTime(e.target.value);
                    if (errors.startTime) {
                      setErrors((p) => ({ ...p, startTime: undefined }));
                    }
                  }}
                  aria-invalid={!!errors.startTime}
                />
                {errors.startTime && (
                  <p className="text-xs text-destructive">{errors.startTime}</p>
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
                <CardContent className="py-4">
                  <p className="text-sm font-medium mb-2">
                    AI Analysis
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      ⏱{" "}
                      {aiMeta.duration}{" "}
                      min
                    </Badge>

                    <Badge variant="outline">
                      📊{" "}
                      {aiMeta.difficulty}
                    </Badge>

                    <Badge variant="outline">
                      📁{" "}
                      {aiMeta.category}
                    </Badge>

                    {aiMeta.priority && (
                      <Badge variant="outline">
                        ⚡{" "}
                        {aiMeta.priority}{" "}
                        priority
                      </Badge>
                    )}
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
