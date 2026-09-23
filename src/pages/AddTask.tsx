import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Brain, Loader2, PlusCircle } from "lucide-react";
import { TITLE_MAX } from "@/lib/validation";

type Project = { id: string; name: string; color: string };

import { todayInputDate, tzOffset, getTimezone, formatPH } from "@/lib/date-utils";
const MAX_DATE = "9999-12-31"; // year must stay ≤ 9999

const categories = [
  // Academic
  "Assignment", "Exam Review", "Project", "Research", "Reading", "Lab Work", "Presentation",
  // Personal / lifestyle
  "Personal", "Health", "Errands", "Chores", "Social", "Finance", "Fitness",
  // Workplace / general
  "Office Work", "Meeting", "Construction", "Field Work",
  // Freelance / VA
  "Freelancing", "Virtual Assistant",
  "Client Communication", "Email Management", "Calendar Scheduling", "Project Tracking",
  "Social Media Management", "Content Creation", "Graphic Design", "Video Editing",
  "Data Entry", "Research Task", "Bookkeeping", "Invoicing",
  "Customer Support", "Lead Generation", "Transcription", "Translation",
  "SEO Optimization", "Website Maintenance", "Proposal Writing", "Meeting Notes",
  "Other",
];

export default function AddTask({ embedded = false, onCreated }: { embedded?: boolean; onCreated?: () => void } = {}) {
  const navigate = useNavigate();
  const prefillDate = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("date") || ""
    : "";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(embedded ? "" : prefillDate);
  const [dueTime, setDueTime] = useState("");
  const [startTime, setStartTime] = useState("");
  const [startDate, setStartDate] = useState(embedded ? "" : prefillDate);
  const [category, setCategory] = useState("");
  const [projectId, setProjectId] = useState<string>("none");
  const [projects, setProjects] = useState<Project[]>([]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiMeta, setAiMeta] = useState<{ duration: number; difficulty: string; category: string; priority?: string; corrected_description?: string } | null>(null);
  const [errors, setErrors] = useState<{ title?: string; newProject?: string }>({});

  useEffect(() => {
    supabase.from("projects").select("id, name, color").order("created_at", { ascending: false })
      .then(({ data }) => setProjects(data || []));
  }, []);

  const handleProjectChange = (val: string) => {
    if (val === "__new__") { setShowNewProject(true); setProjectId("none"); }
    else { setShowNewProject(false); setProjectId(val); }
  };

  const createInlineProject = async () => {
    if (!newProjectName.trim()) { setErrors(p => ({ ...p, newProject: "Project name is required" })); return; }
    setErrors(p => ({ ...p, newProject: undefined }));
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase.from("projects").insert({
      user_id: user.id, name: newProjectName.trim(), description: newProjectDesc.trim() || null,
    }).select().single();
    if (error) { toast.error(error.message); return; }
    setProjects([data as Project, ...projects]);
    setProjectId(data.id);
    setShowNewProject(false);
    setNewProjectName(""); setNewProjectDesc("");
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
    setProjectId("none");
    setAiMeta(null);
  };

  const analyzeTask = async () => {
    if (!title.trim()) { setErrors(p => ({ ...p, title: "Enter a title first" })); return; }
    if (analyzing) return;
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-task", {
        body: { title, description, category: category || undefined },
      });
      // Functions may put the payload error on data.error even when error is set
      const payload = data && typeof data === "object" ? data as Record<string, unknown> : null;
      if (error) {
        const msg =
          (payload && typeof payload.error === "string" && payload.error) ||
          error.message ||
          "Analysis failed";
        throw new Error(msg);
      }
      if (payload?.error && typeof payload.error === "string") {
        throw new Error(payload.error);
      }
      if (!payload || typeof payload.duration !== "number") {
        throw new Error("AI returned an invalid analysis. Please try again.");
      }
      setAiMeta({
        duration: payload.duration as number,
        difficulty: String(payload.difficulty || "medium"),
        category: String(payload.category || category || "General"),
        priority: payload.priority ? String(payload.priority) : undefined,
        corrected_description: typeof payload.corrected_description === "string"
          ? payload.corrected_description
          : undefined,
      });
      if (
        typeof payload.corrected_description === "string" &&
        payload.corrected_description &&
        payload.corrected_description !== description
      ) {
        setDescription(payload.corrected_description);
        toast.success("AI analysis complete — description auto-corrected");
      } else {
        toast.success("AI analysis complete!");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Analysis failed";
      toast.error(msg);
    }
    setAnalyzing(false);
  };

  const isValidYear = (dateStr: string) => {
    if (!dateStr) return true;
    const year = parseInt(dateStr.slice(0, 4), 10);
    return !Number.isNaN(year) && year <= 9999;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setErrors(p => ({ ...p, title: "Task title is required" })); return; }
    if (title.trim().length > TITLE_MAX) { setErrors(p => ({ ...p, title: `Keep the title under ${TITLE_MAX} characters.` })); return; }
    if (dueDate && dueDate < todayInputDate()) { toast.error("Due date cannot be in the past"); return; }
    if (startDate && startDate < todayInputDate()) { toast.error("Start date cannot be in the past"); return; }
    if (!isValidYear(dueDate) || !isValidYear(startDate)) {
      toast.error("Year cannot be greater than 9999");
      return;
    }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error("Not logged in"); setLoading(false); return; }

    // Duplicate title checker — titles must be unique and identifiable
    const { data: dupes } = await supabase
      .from("tasks")
      .select("id, title")
      .eq("user_id", user.id)
      .ilike("title", title.trim());
    if (dupes && dupes.length > 0) {
      setErrors(p => ({ ...p, title: "A task with this title already exists. Use different or more specific words so it stays unique and identifiable." }));
      setLoading(false);
      return;
    }
    setErrors(p => ({ ...p, title: undefined }));

    // Auto-analyze if user didn't press "Analyze with AI" so difficulty/duration are still populated.
    let meta = aiMeta;
    if (!meta) {
      try {
        const { data, error } = await supabase.functions.invoke("analyze-task", {
          body: { title, description, category: category || undefined },
        });
        if (!error && data) {
          meta = data;
          setAiMeta(data);
          if (data?.corrected_description && data.corrected_description !== description) {
            setDescription(data.corrected_description);
          }
        }
      } catch {
        // non-fatal — still save the task
      }
    }

    // Build timestamptz using the user's selected timezone offset (not hardcoded PH)
    const off = tzOffset(new Date(), getTimezone());
    let dueDatetime: string | null = null;
    if (dueDate) {
      dueDatetime = dueTime ? `${dueDate}T${dueTime}:00${off}` : `${dueDate}T23:59:00${off}`;
    }
    let startDatetime: string | null = null;
    const effectiveStartDate = startDate || dueDate;
    if (effectiveStartDate && startTime) {
      startDatetime = `${effectiveStartDate}T${startTime}:00${off}`;
    }
    // Block past start time for today (in user timezone)
    if (startDatetime && new Date(startDatetime).getTime() < Date.now()) {
      toast.error("Start time cannot be in the past.");
      setLoading(false);
      return;
    }

    const finalCategory = category || meta?.category || "General";

    // Prevent overlapping scheduled times with existing tasks
    if (startDatetime) {
      const newStart = new Date(startDatetime).getTime();
      const newEnd = newStart + (meta?.duration || 30) * 60_000;
      const { data: scheduled } = await supabase
        .from("tasks")
        .select("title, start_time, estimated_duration")
        .eq("user_id", user.id)
        .eq("archived", false)
        .neq("status", "done")
        .not("start_time", "is", null);
      const clash = (scheduled || []).find((t: any) => {
        const s = new Date(t.start_time).getTime();
        const e = s + (t.estimated_duration || 30) * 60_000;
        return newStart < e && s < newEnd;
      });
      if (clash) {
        setLoading(false);
        toast.error(`That time overlaps with "${clash.title}". Pick another start time.`);
        return;
      }
    }

    // Determine initial status: if start_time is in the past or now, set to in_progress
    let initialStatus = "todo";
    if (startDatetime && new Date(startDatetime) <= new Date()) {
      initialStatus = "in_progress";
    }

    const { error } = await supabase.from("tasks").insert({
      title,
      description: description || null,
      due_date: dueDatetime,
      start_time: startDatetime,
      estimated_duration: meta?.duration || null,
      difficulty: meta?.difficulty || null,
      category: finalCategory,
      status: initialStatus,
      user_id: user.id,
      project_id: projectId !== "none" ? projectId : null,
    });

    setLoading(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Task created!");
      resetForm();
      if (embedded) onCreated?.();
      else navigate("/tasks");
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={embedded ? "space-y-4" : "max-w-2xl mx-auto space-y-6"}>
      {!embedded && <h1 className="font-display text-3xl font-bold">Add Task</h1>}
      <form onSubmit={handleSubmit}>
        <Card className={embedded ? "border-0 shadow-none" : undefined}>
          {!embedded && (
            <CardHeader>
              <CardTitle className="font-display">New Task</CardTitle>
            </CardHeader>
          )}
          <CardContent className={embedded ? "space-y-4 p-0" : "space-y-4"}>
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => { setTitle(e.target.value); if (errors.title) setErrors(p => ({ ...p, title: undefined })); }}
                placeholder="e.g. Finish Math Assignment or Grocery shopping"
                aria-invalid={!!errors.title}
                maxLength={TITLE_MAX}
                className={errors.title ? "border-destructive focus-visible:ring-destructive" : undefined}
              />
              <p className="text-xs text-muted-foreground">{title.length}/{TITLE_MAX} characters</p>
              {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="desc">Description</Label>
              <Textarea
                id="desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add details..."
                rows={3}
                autoCorrect="on"
                spellCheck
                autoCapitalize="sentences"
              />
            </div>

            <div className="space-y-2">
              <Label>Project</Label>
              <Select value={projectId} onValueChange={handleProjectChange}>
                <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Stand-alone Task</SelectItem>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                        {p.name}
                      </span>
                    </SelectItem>
                  ))}
                  <SelectItem value="__new__">
                    <span className="inline-flex items-center gap-1 text-primary">
                      <PlusCircle className="h-3 w-3" /> Create New Project
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              {showNewProject && (
                <Card className="bg-accent/30 border-primary/20">
                  <CardContent className="py-3 space-y-2">
                    <Input
                      value={newProjectName}
                      onChange={(e) => { setNewProjectName(e.target.value); if (errors.newProject) setErrors(p => ({ ...p, newProject: undefined })); }}
                      placeholder="Project name"
                      aria-invalid={!!errors.newProject}
                      className={errors.newProject ? "border-destructive focus-visible:ring-destructive" : undefined}
                    />
                    {errors.newProject && <p className="text-xs text-destructive">{errors.newProject}</p>}
                    <Textarea value={newProjectDesc} onChange={(e) => setNewProjectDesc(e.target.value)} rows={2} placeholder="Description (optional)" />
                    <div className="flex gap-2 justify-end">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewProject(false)}>Cancel</Button>
                      <Button type="button" size="sm" onClick={createInlineProject}>Create</Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="due-date">Due Date</Label>
                <Input
                  id="due-date"
                  type="date"
                  min={todayInputDate()}
                  max={MAX_DATE}
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="due-time">Due Time</Label>
                <Input id="due-time" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start-date">Start Date</Label>
                <Input
                  id="start-date"
                  type="date"
                  min={todayInputDate()}
                  max={MAX_DATE}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="start-time">Start Time</Label>
                <Input id="start-time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Task will auto-switch to "In Progress" when this date/time is reached. If no start date is set, the due date will be used.
            </p>

            <Button type="button" variant="outline" onClick={analyzeTask} disabled={analyzing} className="w-full">
              {analyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Brain className="mr-2 h-4 w-4" />}
              {analyzing ? "Analyzing..." : "Analyze with AI"}
            </Button>

            {aiMeta && (
              <Card className="bg-accent/30 border-primary/20">
                <CardContent className="py-4">
                  <p className="text-sm font-medium mb-2">AI Analysis</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">⏱ {aiMeta.duration} min</Badge>
                    <Badge variant="outline">📊 {aiMeta.difficulty}</Badge>
                    <Badge variant="outline">📁 {aiMeta.category}</Badge>
                    {aiMeta.priority && <Badge variant="outline">⚡ {aiMeta.priority} priority</Badge>}
                  </div>
                </CardContent>
              </Card>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating..." : "Create Task"}
            </Button>
          </CardContent>
        </Card>
      </form>
    </motion.div>
  );
}
