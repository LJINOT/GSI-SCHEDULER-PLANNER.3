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
  CheckCircle2,
  AlertTriangle,
  XCircle,
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

type ValidationStatus = "VALID" | "REVIEW" | "INVALID" | null;

type AiValidation = {
  validation: ValidationStatus;
  related: boolean;
  confidence: number;
  /** Embedding cosine similarity 0–1. */
  similarity: number;
  /** Multi-factor weighted score 0–1. */
  score: number;
  basic_score?: number;
  reason: string;
  contradiction?: boolean;
  repetition?: boolean;
  category_warning?: string | null;
  validation_detail?: {
    status?: string;
    score?: number;
    semantic_similarity?: number;
    intent_match?: number;
    action_match?: number;
    object_match?: number;
    domain_match?: number;
    purpose_match?: number;
    category_match?: number;
    completeness?: number;
    contradiction?: boolean;
    repetition?: boolean;
    repetition_type?: string | null;
  };
  suggestions: {
    duration?: number;
    difficulty?: string;
    category?: string;
  } | null;
};

const MAX_DATE = "9999-12-31";
const DURATION_PRESETS = [15, 30, 45, 60, 90, 120];
const categories = [...VA_CATEGORY_NAMES].sort((a, b) =>
  a.localeCompare(b, undefined, { sensitivity: "base" }),
);

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

  const prefillProjectId =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("project") || ""
      : "";

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(embedded ? "" : prefillDate);
  const [dueTime, setDueTime] = useState("");
  const [startTime, setStartTime] = useState("");
  const [startDate, setStartDate] = useState(embedded ? "" : prefillDate);
  const [category, setCategory] = useState("");
  const [difficulty, setDifficulty] = useState<string>("");
  const [estimatedDuration, setEstimatedDuration] = useState<string>("");
  const [projectId, setProjectId] = useState<string>(
    prefillProjectId || "none",
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiValidation, setAiValidation] = useState<AiValidation | null>(null);
  const [forceContinue, setForceContinue] = useState(false);
  /** True only after a successful validation call for the current title/description/category. */
  const [descriptionValidated, setDescriptionValidated] = useState(false);

  /** Tracks which optional AI suggestions the user has applied (Use → Used). */
  const [appliedSuggestions, setAppliedSuggestions] = useState<{
    duration?: boolean;
    difficulty?: boolean;
    category?: boolean;
  }>({});

  const [errors, setErrors] = useState<{
    title?: string;
    description?: string;
    dueDate?: string;
    dueTime?: string;
    startDate?: string;
    startTime?: string;
    newProject?: string;
    duration?: string;
    difficulty?: string;
    category?: string;
  }>({});

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
        .order("created_at", { ascending: false });
      if (error) {
        console.error("AddTask: failed to load projects:", error);
        return;
      }
      if (!cancelled) setProjects(data || []);
    };
    loadProjects();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleProjectChange = (val: string) => {
    if (val === "__new__") {
      setShowNewProject(true);
      setProjectId("none");
    } else {
      setShowNewProject(false);
      setProjectId(val);
    }
  };

  const createInlineProject = async () => {
    if (!newProjectName.trim()) {
      setErrors((p) => ({
        ...p,
        newProject: "Project name is required",
      }));
      return;
    }
    setErrors((p) => ({ ...p, newProject: undefined }));
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Not logged in");
      return;
    }
    const norm = newProjectName.trim().toLowerCase();
    const { data: existingProjects, error: projectCheckError } = await supabase
      .from("projects")
      .select("id, name")
      .eq("user_id", user.id)
      .or("archived.eq.false,archived.is.null");
    if (projectCheckError) {
      toast.error("Unable to check existing projects.");
      return;
    }
    if (
      (existingProjects || []).some(
        (row: { name?: string }) =>
          String(row.name || "").trim().toLowerCase() === norm,
      )
    ) {
      setErrors((p) => ({
        ...p,
        newProject:
          "Project name already exists. Please use a different project name.",
      }));
      return;
    }
    const { data, error } = await supabase
      .from("projects")
      .insert({
        user_id: user.id,
        name: newProjectName.trim(),
        description: newProjectDesc.trim() || null,
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
      toast.error("Project was not created.");
      return;
    }
    setProjects((previous) => [data as Project, ...previous]);
    setProjectId(data.id);
    setShowNewProject(false);
    setNewProjectName("");
    setNewProjectDesc("");
    toast.success("Project created");
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setDueDate("");
    setDueTime("");
    setStartTime("");
    setStartDate("");
    setCategory("");
    setDifficulty("");
    setEstimatedDuration("");
    setProjectId("none");
    setAiValidation(null);
    setForceContinue(false);
    setDescriptionValidated(false);
    setAppliedSuggestions({});
    setErrors({});
  };

  const clearValidationOnEdit = () => {
    if (aiValidation) setAiValidation(null);
    if (forceContinue) setForceContinue(false);
    setDescriptionValidated(false);
    setAppliedSuggestions({});
  };

  /** Semantic validation of title vs description; optional suggestions only. */
  const validateDescription = async () => {
    if (!title.trim()) {
      setErrors((p) => ({ ...p, title: "Enter a title first" }));
      return;
    }
    if (!description.trim()) {
      setErrors((p) => ({
        ...p,
        description: "Enter a description to validate.",
      }));
      return;
    }
    if (analyzing) return;
    setAnalyzing(true);
    setForceContinue(false);

    try {
      const { data, error } = await supabase.functions.invoke("analyze-task", {
        body: {
          title: title.trim(),
          description: description.trim(),
          category: category || undefined,
          duration: estimatedDuration
            ? Number(estimatedDuration)
            : undefined,
          difficulty: difficulty || undefined,
        },
      });

      if (error) {
        throw new Error(error.message || "The validation function failed.");
      }

      const payload =
        data && typeof data === "object"
          ? (data as Record<string, unknown>)
          : null;

      if (!payload) {
        throw new Error("The validation function returned no data.");
      }

      if (payload.ok === false) {
        const mainError =
          typeof payload.error === "string"
            ? payload.error
            : "Validation failed.";
        throw new Error(mainError);
      }

      const validation = (
        ["VALID", "REVIEW", "INVALID"].includes(
          String(payload.validation || ""),
        )
          ? String(payload.validation)
          : "REVIEW"
      ) as ValidationStatus;

      const detail =
        payload.validation_detail &&
        typeof payload.validation_detail === "object"
          ? (payload.validation_detail as AiValidation["validation_detail"])
          : undefined;

      const result: AiValidation = {
        validation,
        related: Boolean(payload.related),
        confidence: Number(payload.confidence) || 0,
        similarity: Number(payload.similarity) || 0,
        score: Number(payload.score) || Number(payload.similarity) || 0,
        basic_score:
          typeof payload.basic_score === "number"
            ? payload.basic_score
            : undefined,
        reason:
          typeof payload.message === "string"
            ? payload.message
            : typeof payload.reason === "string"
              ? payload.reason
              : "Validation complete.",
        contradiction: Boolean(
          (detail && detail.contradiction) || payload.contradiction,
        ),
        repetition: Boolean(
          (detail && detail.repetition) || payload.repetition,
        ),
        category_warning:
          typeof payload.category_warning === "string"
            ? payload.category_warning
            : null,
        validation_detail: detail,
        suggestions:
          payload.suggestions && typeof payload.suggestions === "object"
            ? (payload.suggestions as AiValidation["suggestions"])
            : null,
      };

      setAiValidation(result);
      setDescriptionValidated(true);
      setAppliedSuggestions({});

      if (validation === "VALID") {
        toast.success("Description matches the task.");
      } else if (validation === "REVIEW") {
        toast.message("Please review your description.");
      } else {
        toast.error("Description does not match the task title.");
      }
    } catch (err: unknown) {
      console.error("AddTask: validation failed:", err);
      toast.error(
        err instanceof Error ? err.message : "Validation failed.",
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const applySuggestion = (
    field: "duration" | "difficulty" | "category",
  ) => {
    if (!aiValidation?.suggestions) return;
    if (field === "duration" && aiValidation.suggestions.duration) {
      setEstimatedDuration(String(aiValidation.suggestions.duration));
      setErrors((p) => ({ ...p, duration: undefined }));
      setAppliedSuggestions((p) => ({ ...p, duration: true }));
    }
    if (field === "difficulty" && aiValidation.suggestions.difficulty) {
      setDifficulty(aiValidation.suggestions.difficulty);
      setErrors((p) => ({ ...p, difficulty: undefined }));
      setAppliedSuggestions((p) => ({ ...p, difficulty: true }));
    }
    if (field === "category" && aiValidation.suggestions.category) {
      setCategory(aiValidation.suggestions.category);
      setErrors((p) => ({ ...p, category: undefined }));
      // Category participates in validation — applying suggestion should not
      // wipe a just-completed validation; only mark as used.
      setAppliedSuggestions((p) => ({ ...p, category: true }));
    }
  };

  const isValidYear = (dateStr: string) => {
    if (!dateStr) return true;
    const year = parseInt(dateStr.slice(0, 4), 10);
    return !Number.isNaN(year) && year <= 9999;
  };

  const parseDuration = (): number | null => {
    const n = Number(estimatedDuration);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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

    if (!dueDate) validationErrors.dueDate = "Due date is required.";
    if (!dueTime) validationErrors.dueTime = "Due time is required.";

    const durationVal = parseDuration();
    if (durationVal === null) {
      validationErrors.duration =
        "Estimated duration is required (positive number of minutes).";
    }

    if (!difficulty || !["easy", "medium", "hard"].includes(difficulty)) {
      validationErrors.difficulty = "Please select a difficulty.";
    }

    if (!category) {
      validationErrors.category = "Please select a category.";
    }

    if (startDate && !startTime) {
      validationErrors.startTime =
        "Start time is required when a start date is set.";
    }
    if (startTime && !startDate) {
      validationErrors.startDate =
        "Start date is required when a start time is set.";
    }

    if (Object.keys(validationErrors).length > 0) {
      setErrors((p) => ({ ...p, ...validationErrors }));
      toast.error("Please complete all required task fields.");
      return;
    }

    // Validation required after latest title/description/category changes
    if (!descriptionValidated || !aiValidation) {
      toast.error("Please validate the task description before saving.");
      return;
    }

    // Semantic validation gate
    if (
      aiValidation.validation === "INVALID" &&
      !forceContinue
    ) {
      toast.error(
        "Description does not match the task title. Please provide a related description.",
      );
      return;
    }

    if (
      aiValidation.validation === "REVIEW" &&
      !forceContinue
    ) {
      toast.message(
        "Please review your description, or choose Continue Anyway.",
      );
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

    setErrors({});
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Not logged in");
      setLoading(false);
      return;
    }

    const normalizedTitle = trimmedTitle.toLowerCase();
    const { data: existingTitles, error: titleCheckError } = await supabase
      .from("tasks")
      .select("id, title")
      .eq("user_id", user.id)
      .or("archived.eq.false,archived.is.null");

    if (titleCheckError) {
      toast.error("Unable to verify the task title. Please try again.");
      setLoading(false);
      return;
    }

    const duplicate = (existingTitles || []).some(
      (row: { title?: string }) =>
        String(row.title || "").trim().toLowerCase() === normalizedTitle,
    );
    if (duplicate) {
      setErrors((p) => ({
        ...p,
        title:
          "Task title already exists. Please use a different task title.",
      }));
      toast.error("Task title already exists.");
      setLoading(false);
      return;
    }

    const off = tzOffset(new Date(), getTimezone());
    let dueDatetime: string | null = null;
    if (dueDate) {
      dueDatetime = dueTime
        ? `${dueDate}T${dueTime}:00${off}`
        : `${dueDate}T23:59:00${off}`;
    }

    let startDatetime: string | null = null;
    const effectiveStartDate = startDate || dueDate;
    if (effectiveStartDate && startTime) {
      startDatetime = `${effectiveStartDate}T${startTime}:00${off}`;
    }

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
        toast.error(
          "Start date and time must be before the due date and time.",
        );
        setLoading(false);
        return;
      }
      if (startTimestamp < Date.now()) {
        toast.error("Start time cannot be in the past.");
        setLoading(false);
        return;
      }
    }

    // ============================================================
    // SOURCE OF TRUTH: user-confirmed structured attributes only.
    // NLP may suggest; it never overrides these values.
    // AHP / PSO / CSP receive these validated values.
    // ============================================================
    const finalDuration = durationVal as number;
    const finalDifficulty = difficulty; // easy | medium | hard
    const finalCategory = category;

    let initialStatus = "todo";
    if (startDatetime && new Date(startDatetime) <= new Date()) {
      initialStatus = "in_progress";
    }

    const { error: insertError } = await supabase.from("tasks").insert({
      title: trimmedTitle,
      description: trimmedDescription,
      due_date: dueDatetime,
      start_time: startDatetime,
      estimated_duration: finalDuration,
      difficulty: finalDifficulty,
      category: finalCategory,
      status: initialStatus,
      user_id: user.id,
      project_id: projectId !== "none" ? projectId : null,
      archived: false,
    });

    setLoading(false);

    if (insertError) {
      console.error("AddTask: failed to create task:", insertError);
      toast.error(insertError.message || "Failed to create task.");
      return;
    }

    toast.success("Task created successfully!");
    resetForm();
    if (embedded) {
      onCreated?.();
    } else {
      navigate("/tasks");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={
        embedded ? "space-y-4" : "max-w-2xl mx-auto space-y-6"
      }
    >
      {!embedded && (
        <h1 className="font-display text-3xl font-bold">Add Task</h1>
      )}

      <form onSubmit={handleSubmit}>
        <Card className={embedded ? "border-0 shadow-none" : undefined}>
          {!embedded && (
            <CardHeader>
              <CardTitle className="font-display">New Task</CardTitle>
            </CardHeader>
          )}

          <CardContent
            className={embedded ? "space-y-4 p-0" : "space-y-4"}
          >
            {/* TITLE */}
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                required
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (errors.title) {
                    setErrors((p) => ({ ...p, title: undefined }));
                  }
                  clearValidationOnEdit();
                }}
                placeholder="e.g. Log & Categorize Reported System Bugs"
                aria-invalid={!!errors.title}
                maxLength={TITLE_MAX}
                className={
                  errors.title
                    ? "border-destructive focus-visible:ring-destructive"
                    : undefined
                }
              />
              <p className="text-xs text-muted-foreground">
                {title.length}/{TITLE_MAX} characters
              </p>
              {errors.title && (
                <p className="text-xs text-destructive">{errors.title}</p>
              )}
            </div>

            {/* DESCRIPTION */}
            <div className="space-y-2">
              <Label htmlFor="desc">Description</Label>
              <Textarea
                id="desc"
                required
                aria-invalid={!!errors.description}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (errors.description) {
                    setErrors((p) => ({
                      ...p,
                      description: undefined,
                    }));
                  }
                  clearValidationOnEdit();
                }}
                placeholder="Describe the work involved in this task..."
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
              <Label>Project</Label>
              <Select value={projectId} onValueChange={handleProjectChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Stand-alone Task</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: p.color }}
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
                      value={newProjectName}
                      onChange={(e) => {
                        setNewProjectName(e.target.value);
                        if (errors.newProject) {
                          setErrors((p) => ({
                            ...p,
                            newProject: undefined,
                          }));
                        }
                      }}
                      placeholder="Project name"
                      aria-invalid={!!errors.newProject}
                      className={
                        errors.newProject
                          ? "border-destructive focus-visible:ring-destructive"
                          : undefined
                      }
                    />
                    {errors.newProject && (
                      <p className="text-xs text-destructive">
                        {errors.newProject}
                      </p>
                    )}
                    <Textarea
                      value={newProjectDesc}
                      onChange={(e) => setNewProjectDesc(e.target.value)}
                      rows={2}
                      placeholder="Description (optional)"
                    />
                    <div className="flex gap-2 justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowNewProject(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={createInlineProject}
                      >
                        Create
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* CATEGORY — user selected is source of truth */}
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={category}
                onValueChange={(value) => {
                  setCategory(value);
                  if (errors.category) {
                    setErrors((p) => ({ ...p, category: undefined }));
                  }
                  clearValidationOnEdit();
                }}
              >
                <SelectTrigger
                  className={
                    errors.category
                      ? "border-destructive focus-visible:ring-destructive"
                      : undefined
                  }
                >
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.category && (
                <p className="text-xs text-destructive">{errors.category}</p>
              )}
            </div>

            {/* DIFFICULTY — user selected is source of truth */}
            <div className="space-y-2">
              <Label>Difficulty</Label>
              <Select
                value={difficulty}
                onValueChange={(value) => {
                  setDifficulty(value);
                  if (errors.difficulty) {
                    setErrors((p) => ({ ...p, difficulty: undefined }));
                  }
                }}
              >
                <SelectTrigger
                  className={
                    errors.difficulty
                      ? "border-destructive focus-visible:ring-destructive"
                      : undefined
                  }
                >
                  <SelectValue placeholder="Select difficulty" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
              {errors.difficulty && (
                <p className="text-xs text-destructive">
                  {errors.difficulty}
                </p>
              )}
            </div>

            {/* ESTIMATED DURATION — user input is source of truth */}
            <div className="space-y-2">
              <Label htmlFor="duration">Estimated Duration (minutes)</Label>
              <div className="flex flex-wrap gap-2 mb-2">
                {DURATION_PRESETS.map((m) => (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={
                      estimatedDuration === String(m) ? "default" : "outline"
                    }
                    onClick={() => {
                      setEstimatedDuration(String(m));
                      if (errors.duration) {
                        setErrors((p) => ({ ...p, duration: undefined }));
                      }
                    }}
                  >
                    {m} min
                  </Button>
                ))}
              </div>
              <Input
                id="duration"
                type="number"
                min={1}
                max={480}
                step={1}
                value={estimatedDuration}
                onChange={(e) => {
                  setEstimatedDuration(e.target.value);
                  if (errors.duration) {
                    setErrors((p) => ({ ...p, duration: undefined }));
                  }
                }}
                placeholder="e.g. 60"
                aria-invalid={!!errors.duration}
                className={
                  errors.duration
                    ? "border-destructive focus-visible:ring-destructive"
                    : undefined
                }
              />
              <p className="text-xs text-muted-foreground">
                Your estimate is used for scheduling. Actual time is tracked
                in Focus Mode and stored separately.
              </p>
              {errors.duration && (
                <p className="text-xs text-destructive">{errors.duration}</p>
              )}
            </div>

            {/* DUE DATE / TIME — user selected is source of truth */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="due-date">Due Date</Label>
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
                <Label htmlFor="due-time">Due Time</Label>
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
                <Label htmlFor="start-date">Start Date</Label>
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
                  <p className="text-xs text-destructive">
                    {errors.startDate}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="start-time">Start Time</Label>
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
                  <p className="text-xs text-destructive">
                    {errors.startTime}
                  </p>
                )}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Task will auto-switch to &quot;In Progress&quot; when this
              date/time is reached. If no start date is set, the due date
              will be used.
            </p>

            {/* NLP: Title/Description validation */}
            <Button
              type="button"
              variant="outline"
              onClick={validateDescription}
              disabled={analyzing || descriptionValidated}
              className={
                descriptionValidated
                  ? "w-full opacity-70 bg-muted text-muted-foreground cursor-default"
                  : "w-full"
              }
            >
              {analyzing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : descriptionValidated ? (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              ) : (
                <Brain className="mr-2 h-4 w-4" />
              )}
              {analyzing
                ? "Validating..."
                : descriptionValidated
                  ? "Description Validated"
                  : "Validate Description"}
            </Button>

            {/* Validation result */}
            {aiValidation && (
              <Card
                className={
                  aiValidation.validation === "VALID"
                    ? "bg-accent/30 border-primary/20"
                    : aiValidation.validation === "REVIEW"
                      ? "bg-amber-500/10 border-amber-500/30"
                      : "bg-destructive/10 border-destructive/30"
                }
              >
                <CardContent className="py-4 space-y-3">
                  <div className="flex items-start gap-2">
                    {aiValidation.validation === "VALID" && (
                      <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    )}
                    {aiValidation.validation === "REVIEW" && (
                      <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                    )}
                    {aiValidation.validation === "INVALID" && (
                      <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                    )}
                    <div className="space-y-1">
                      <p className="text-sm font-semibold">
                        {aiValidation.validation === "VALID" &&
                          "Description matches the task."}
                        {aiValidation.validation === "REVIEW" &&
                          "Please review your description. It may not fully match the task title."}
                        {aiValidation.validation === "INVALID" &&
                          "Description does not match the task title."}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {aiValidation.reason}
                      </p>
                      {aiValidation.category_warning && (
                        <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                          {aiValidation.category_warning}
                        </p>
                      )}
                      {aiValidation.repetition && (
                        <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                          Your description is very similar to the task title.
                          Add more details about the actual work.
                        </p>
                      )}
                      {aiValidation.contradiction && (
                        <p className="text-xs text-destructive mt-1">
                          The description conflicts with the task title.
                        </p>
                      )}
                      {aiValidation.validation === "INVALID" && (
                        <p className="text-xs text-destructive mt-1">
                          Please describe the work involved in this task,
                          then validate again.
                        </p>
                      )}
                    </div>
                  </div>

                  {aiValidation.validation === "REVIEW" && !forceContinue && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          /* user edits description — validation clears on change */
                        }}
                      >
                        Edit Description
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          setForceContinue(true);
                          toast.message(
                            "You can create the task with the current description.",
                          );
                        }}
                      >
                        Continue Anyway
                      </Button>
                    </div>
                  )}

                  {forceContinue && aiValidation.validation !== "VALID" && (
                    <Badge variant="outline">Continuing with review override</Badge>
                  )}

                  {/* Optional AI suggestions — never auto-applied */}
                  {aiValidation.suggestions && (
                    <div className="rounded-lg border overflow-hidden mt-2">
                      <div className="px-3 py-2 text-xs font-semibold bg-muted/50 border-b">
                        Optional AI suggestions (you confirm the final values)
                      </div>
                      {aiValidation.suggestions.difficulty && (
                        <div className="flex items-center justify-between px-3 py-2 border-b text-sm">
                          <span>
                            Difficulty:{" "}
                            <Badge variant="outline" className="capitalize">
                              {aiValidation.suggestions.difficulty}
                            </Badge>
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={!!appliedSuggestions.difficulty}
                            className={
                              appliedSuggestions.difficulty
                                ? "text-muted-foreground cursor-default"
                                : undefined
                            }
                            onClick={() => applySuggestion("difficulty")}
                          >
                            {appliedSuggestions.difficulty ? "Used" : "Use"}
                          </Button>
                        </div>
                      )}
                      {aiValidation.suggestions.duration != null && (
                        <div className="flex items-center justify-between px-3 py-2 border-b text-sm">
                          <span>
                            Duration:{" "}
                            <Badge variant="outline">
                              {aiValidation.suggestions.duration} min
                            </Badge>
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={!!appliedSuggestions.duration}
                            className={
                              appliedSuggestions.duration
                                ? "text-muted-foreground cursor-default"
                                : undefined
                            }
                            onClick={() => applySuggestion("duration")}
                          >
                            {appliedSuggestions.duration ? "Used" : "Use"}
                          </Button>
                        </div>
                      )}
                      {aiValidation.suggestions.category && (
                        <div className="flex items-center justify-between px-3 py-2 text-sm">
                          <span>
                            Category:{" "}
                            <Badge variant="outline">
                              {aiValidation.suggestions.category}
                            </Badge>
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={!!appliedSuggestions.category}
                            className={
                              appliedSuggestions.category
                                ? "text-muted-foreground cursor-default"
                                : undefined
                            }
                            onClick={() => applySuggestion("category")}
                          >
                            {appliedSuggestions.category ? "Used" : "Use"}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Validation checks title–description consistency (intent,
                    actions, domain, and more). Suggestions are optional. AHP
                    uses only your confirmed duration, difficulty, category,
                    and deadline.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* CREATE TASK */}
            <Button
              type="submit"
              className="w-full"
              disabled={
                loading ||
                analyzing ||
                (aiValidation?.validation === "INVALID" && !forceContinue)
              }
            >
              {loading ? "Creating..." : "Create Task"}
            </Button>
          </CardContent>
        </Card>
      </form>
    </motion.div>
  );
}
