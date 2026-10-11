import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  AlertOctagon,
  Eye,
  Loader2,
} from "lucide-react";
import { formatPH } from "@/lib/date-utils";
import {
  priorityFromScore,
  PRIORITY_STYLES,
  statusLabel,
} from "@/lib/status";

type RiskTask = {
  id: string;
  title: string;
  due_date: string;
  estimated_duration: number | null;
  status: string;
  priority_score: number | null;
  category: string | null;
  description: string | null;
  daysLeft: number;
  risk: "critical" | "high" | "medium" | "low";
};

type RiskFilter = "all" | "critical" | "high" | "medium";

function computeRisk(
  dueDateIso: string,
): { daysLeft: number; risk: RiskTask["risk"] } {
  const todayPH = formatPH(new Date(), "yyyy-MM-dd");
  const duePH = formatPH(dueDateIso, "yyyy-MM-dd");
  const dueDate = new Date(duePH + "T00:00:00");
  const todayDate = new Date(todayPH + "T00:00:00");
  const daysLeft = Math.ceil(
    (dueDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  let risk: RiskTask["risk"] = "low";
  if (daysLeft < 0) risk = "critical";
  else if (daysLeft === 0) risk = "critical";
  else if (daysLeft <= 1) risk = "high";
  else if (daysLeft <= 3) risk = "medium";

  return { daysLeft, risk };
}

export default function DeadlineRisk() {
  const [riskTasks, setRiskTasks] = useState<RiskTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<RiskFilter>("all");
  const [selected, setSelected] = useState<RiskTask | null>(null);
  const [completing, setCompleting] = useState(false);

  const loadRiskTasks = useCallback(async () => {
    setLoading(true);
    // Exclude completed tasks from deadline risk
    const { data, error } = await supabase
      .from("tasks")
      .select(
        "id, title, due_date, estimated_duration, status, priority_score, category, description",
      )
      .not("due_date", "is", null)
      .neq("status", "done")
      .or("archived.eq.false,archived.is.null")
      .order("due_date");

    if (error) {
      toast.error(error.message || "Failed to load deadline risks.");
      setRiskTasks([]);
      setLoading(false);
      return;
    }

    const analyzed: RiskTask[] = (data || [])
      .filter((t) => t.due_date)
      .map((t) => {
        const { daysLeft, risk } = computeRisk(t.due_date!);
        return {
          id: t.id,
          title: t.title,
          due_date: t.due_date!,
          estimated_duration: t.estimated_duration,
          status: t.status,
          priority_score: t.priority_score,
          category: t.category,
          description: t.description,
          daysLeft,
          risk,
        };
      });

    const filtered = analyzed.filter((t) => t.risk !== "low");
    filtered.sort((a, b) => a.daysLeft - b.daysLeft);
    setRiskTasks(filtered);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadRiskTasks();
  }, [loadRiskTasks]);

  const riskColors: Record<string, string> = {
    critical: "bg-destructive/10 text-destructive border-destructive/30",
    high: "bg-warning/10 text-warning border-warning/30",
    medium: "bg-info/10 text-info border-info/30",
  };

  const riskLabels: Record<string, string> = {
    critical: "⚠️ Overdue / Due Today",
    high: "Due Tomorrow",
    medium: "Due in 2-3 Days",
  };

  const cautionInfo = (t: RiskTask) => {
    if (t.risk === "critical") {
      return {
        text: t.daysLeft < 0 ? "Act now — overdue" : "Act now — due today",
        icon: AlertOctagon,
        className: "text-destructive",
      };
    }
    if (t.risk === "high") {
      return {
        text: "Caution — due tomorrow",
        icon: AlertTriangle,
        className: "text-warning",
      };
    }
    return {
      text: "Watch — due in 2-3 days",
      icon: Eye,
      className: "text-info",
    };
  };

  const filters: { key: RiskFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "critical", label: "Critical" },
    { key: "high", label: "High" },
    { key: "medium", label: "Medium" },
  ];

  const filteredTasks = useMemo(() => {
    if (activeFilter === "all") return riskTasks;
    return riskTasks.filter((t) => t.risk === activeFilter);
  }, [riskTasks, activeFilter]);

  const countFor = (key: RiskFilter) =>
    key === "all"
      ? riskTasks.length
      : riskTasks.filter((t) => t.risk === key).length;

  const openDetails = (t: RiskTask) => {
    setSelected(t);
  };

  const markComplete = async () => {
    if (!selected || completing) return;
    if (selected.status === "done") return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      toast.error("You are not signed in.");
      return;
    }

    setCompleting(true);
    try {
      const { error } = await supabase
        .from("tasks")
        .update({
          status: "done",
          completed_at: new Date().toISOString(),
        })
        .eq("id", selected.id)
        .eq("user_id", user.id);

      if (error) {
        toast.error(error.message || "Could not mark task as complete.");
        return;
      }

      // Remove from active risk list immediately
      setRiskTasks((prev) => prev.filter((t) => t.id !== selected.id));
      setSelected(null);
      toast.success("Task marked as complete.");
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Could not mark task as complete.",
      );
    } finally {
      setCompleting(false);
    }
  };

  const priorityKey = selected
    ? priorityFromScore(selected.priority_score)
    : null;
  const priorityStyle = priorityKey ? PRIORITY_STYLES[priorityKey] : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div>
        <h1 className="font-display text-3xl font-bold">
          Deadline Risk Detector
        </h1>
        <p className="text-muted-foreground mt-1">
          Pending tasks at risk — completed tasks are excluded automatically
        </p>
      </div>

      {!loading && riskTasks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                activeFilter === f.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:bg-accent"
              }`}
            >
              {f.label}{" "}
              <span className="opacity-70">({countFor(f.key)})</span>
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : riskTasks.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <CheckCircle2 className="mx-auto h-12 w-12 mb-4 text-success opacity-50" />
            <p className="text-lg">All clear!</p>
            <p className="text-sm mt-1">
              No tasks at risk of missing their deadline
            </p>
          </CardContent>
        </Card>
      ) : filteredTasks.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <CheckCircle2 className="mx-auto h-12 w-12 mb-4 text-success opacity-50" />
            <p className="text-lg">Nothing here</p>
            <p className="text-sm mt-1">No tasks match this filter</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredTasks.map((t) => {
            const caution = cautionInfo(t);
            const CautionIcon = caution.icon;
            return (
              <Card
                key={t.id}
                className={`border-l-4 ${riskColors[t.risk]} cursor-pointer transition-colors hover:bg-accent/30`}
                onClick={() => openDetails(t)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openDetails(t);
                  }
                }}
              >
                <CardContent className="flex items-center gap-4 py-4">
                  <AlertTriangle
                    className={`h-5 w-5 shrink-0 ${
                      t.risk === "critical"
                        ? "text-destructive"
                        : t.risk === "high"
                          ? "text-warning"
                          : "text-info"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{t.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Due: {formatPH(t.due_date, "MMM d, yyyy h:mm a")}
                      {t.daysLeft < 0
                        ? ` (${Math.abs(t.daysLeft)} day${
                            Math.abs(t.daysLeft) !== 1 ? "s" : ""
                          } overdue)`
                        : t.daysLeft === 0
                          ? " (today)"
                          : ` (${t.daysLeft} day${
                              t.daysLeft !== 1 ? "s" : ""
                            } left)`}
                    </p>
                    <p
                      className={`text-xs font-medium mt-1.5 flex items-center gap-1 ${caution.className}`}
                    >
                      <CautionIcon className="h-3.5 w-3.5" /> {caution.text}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline">{riskLabels[t.risk]}</Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Task details — open on click; does not complete until button is used */}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !completing) setSelected(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display pr-6">
              {selected?.title || "Task"}
            </DialogTitle>
            <DialogDescription>
              Review deadline risk details. Completing requires an explicit
              action below.
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant="outline"
                  className={riskColors[selected.risk]}
                >
                  {riskLabels[selected.risk]}
                </Badge>
                {priorityStyle && (
                  <Badge variant="outline" className={priorityStyle.className}>
                    {priorityStyle.label} priority
                  </Badge>
                )}
                <Badge variant="secondary">
                  {selected.status === "done"
                    ? "Completed"
                    : statusLabel(selected.status)}
                </Badge>
              </div>

              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Deadline</span>
                  <span className="font-medium text-right">
                    {formatPH(selected.due_date, "MMM d, yyyy h:mm a")}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Time left</span>
                  <span className="font-medium text-right">
                    {selected.daysLeft < 0
                      ? `${Math.abs(selected.daysLeft)} day(s) overdue`
                      : selected.daysLeft === 0
                        ? "Due today"
                        : `${selected.daysLeft} day(s) left`}
                  </span>
                </div>
                {selected.estimated_duration != null && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Duration</span>
                    <span className="font-medium text-right">
                      {selected.estimated_duration} min
                    </span>
                  </div>
                )}
                {selected.category && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Category</span>
                    <span className="font-medium text-right">
                      {selected.category}
                    </span>
                  </div>
                )}
              </div>

              {selected.description && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    Description
                  </p>
                  <p className="text-sm whitespace-pre-wrap line-clamp-6">
                    {selected.description}
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSelected(null)}
              disabled={completing}
            >
              Close
            </Button>
            {selected && selected.status !== "done" && (
              <Button
                type="button"
                onClick={markComplete}
                disabled={completing}
              >
                {completing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Mark as Complete
                  </>
                )}
              </Button>
            )}
            {selected && selected.status === "done" && (
              <Badge variant="secondary" className="self-center">
                Completed
              </Badge>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
