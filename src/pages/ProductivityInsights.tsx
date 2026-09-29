import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { motion } from "framer-motion";

import {
  Loader2,
  BarChart3,
  Clock,
  Zap,
  TrendingUp,
  AlertTriangle,
  CalendarClock,
  CalendarX2,
  CheckCircle2,
  Timer,
  Brain,
  Target,
  Activity,
  ListChecks,
  CircleAlert,
} from "lucide-react";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import { DevPanel, DevStat } from "@/components/DevPanel";

/* =========================================================
   TYPES
========================================================= */

type RiskyTask = {
  title: string;
  due: string;
  hoursLeft: number;
  risk: number;
};

type DeadlineRisk = {
  factor: number;
  overdue_count: number;
  due_within_24h: number;
  due_within_72h: number;
  pending_with_deadline: number;
  late_completion_rate: number;
  risky_tasks: RiskyTask[];
};

type BehaviorProfile = {
  evidence_level: "limited" | "learning";
  actual_minutes: number;
  average_actual_minutes: number;
  completed_sessions: number;
  learned_peak_start: string;
  learned_peak_end: string;
};

type Insights = {
  peak_hours: string;
  avg_task_duration: number;
  preferred_categories: string[];
  insights: string[];
  productivity_score: number;

  deadline_risk_summary?: string;

  range_days?: number;

  deadline_risk?: DeadlineRisk;

  totals?: {
    completed: number;
    pending: number;
    total: number;
  };

  behavior_profile?: BehaviorProfile;
};

type CategoryData = {
  name: string;
  count: number;
};

/* =========================================================
   ANALYSIS RANGE OPTIONS
========================================================= */

const RANGE_OPTIONS = [
  {
    value: "1",
    label: "Today",
  },
  {
    value: "7",
    label: "Last 7 days",
  },
  {
    value: "14",
    label: "Last 14 days",
  },
  {
    value: "30",
    label: "Last 30 days",
  },
  {
    value: "60",
    label: "Last 60 days",
  },
  {
    value: "90",
    label: "Last 90 days",
  },
];

/* =========================================================
   COMPONENT
========================================================= */

export default function ProductivityInsights() {
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(false);

  const [rangeDays, setRangeDays] = useState("30");

  const [categoryData, setCategoryData] = useState<CategoryData[]>([]);

  const [missedDeadlines, setMissedDeadlines] = useState(0);

  /* =======================================================
     FETCH PRODUCTIVITY INSIGHTS
  ======================================================= */

  const fetchInsights = async () => {
    setLoading(true);

    try {
      const selectedDays = Number(rangeDays);

      /* ---------------------------------------------------
         1. Get current authenticated user
      --------------------------------------------------- */

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;

      if (!user) {
        throw new Error("You must be logged in to view productivity insights.");
      }

      /* ---------------------------------------------------
         2. Get behavioral/productivity analysis
      --------------------------------------------------- */

      const {
        data: aiData,
        error: aiError,
      } = await supabase.functions.invoke("behavior-insights", {
        body: {
          rangeDays: selectedDays,
        },
      });

      if (aiError) {
        throw aiError;
      }

      if (!aiData) {
        throw new Error("No productivity insight data was returned.");
      }

      setData(aiData);

      /* ---------------------------------------------------
         3. Calculate selected analysis range
      --------------------------------------------------- */

      const sinceISO = new Date(
        Date.now() - selectedDays * 24 * 60 * 60 * 1000
      ).toISOString();

      /* ---------------------------------------------------
         4. Get tasks for current user
         ---------------------------------------------------
         Active tasks:
         - current user only
         - archived tasks excluded
         - completed tasks excluded

         Completed tasks:
         - current user only
         - archived tasks excluded
         - completed inside selected range
      --------------------------------------------------- */

      const [
        { data: rangePending, error: pendingError },
        { data: rangeCompleted, error: completedError },
      ] = await Promise.all([
        supabase
          .from("tasks")
          .select(
            "category, status, due_date, completed_at, created_at, estimated_duration"
          )
          .eq("user_id", user.id)
          .or("archived.eq.false,archived.is.null")
          .neq("status", "done"),

        supabase
          .from("tasks")
          .select(
            "category, status, due_date, completed_at, created_at, estimated_duration"
          )
          .eq("user_id", user.id)
          .or("archived.eq.false,archived.is.null")
          .eq("status", "done")
          .gte("completed_at", sinceISO),
      ]);

      if (pendingError) throw pendingError;
      if (completedError) throw completedError;

      /* ---------------------------------------------------
         5. Combine tasks included in analysis
      --------------------------------------------------- */

      const rangeTasks = [
        ...(rangePending || []),
        ...(rangeCompleted || []),
      ];

      /* ---------------------------------------------------
         6. Category distribution
      --------------------------------------------------- */

      const categories: Record<string, number> = {};

      let missed = 0;

      const nowMs = Date.now();

      rangeTasks.forEach((task) => {
        const category = task.category || "Other";

        categories[category] =
          (categories[category] || 0) + 1;

        /* -------------------------------------------------
           Deadline behavior

           Completed after due date = late/missed
           Pending and already overdue = currently missed
        ------------------------------------------------- */

        if (task.due_date) {
          const dueMs = new Date(task.due_date).getTime();

          if (task.status === "done") {
            if (
              task.completed_at &&
              new Date(task.completed_at).getTime() > dueMs
            ) {
              missed++;
            }
          } else if (dueMs < nowMs) {
            missed++;
          }
        }
      });

      setCategoryData(
        Object.entries(categories)
          .map(([name, count]) => ({
            name,
            count,
          }))
          .sort((a, b) => b.count - a.count)
      );

      setMissedDeadlines(missed);

      /* ---------------------------------------------------
         7. Success message
      --------------------------------------------------- */

      const selectedLabel =
        RANGE_OPTIONS.find(
          (option) => option.value === rangeDays
        )?.label || `Last ${rangeDays} days`;

      toast.success(`Insights generated for ${selectedLabel.toLowerCase()}`);
    } catch (error: any) {
      console.error("Productivity Insights error:", error);

      toast.error(
        error?.message ||
          "Failed to generate productivity insights."
      );
    } finally {
      setLoading(false);
    }
  };

  /* =======================================================
     RISK LEVEL
  ======================================================= */

  const riskTone = (factor: number) => {
    if (factor >= 70) {
      return {
        label: "High Risk",
        color: "text-destructive",
        bar: "bg-destructive",
      };
    }

    if (factor >= 40) {
      return {
        label: "Moderate Risk",
        color: "text-warning",
        bar: "bg-warning",
      };
    }

    return {
      label: "Low Risk",
      color: "text-success",
      bar: "bg-success",
    };
  };

  /* =======================================================
     DATA AVAILABILITY
  ======================================================= */

  const hasBehaviorData =
    data?.behavior_profile?.completed_sessions &&
    data.behavior_profile.completed_sessions > 0;

  const hasProductivityData =
    data?.totals &&
    (data.totals.completed > 0 ||
      data.totals.pending > 0);

  /* =======================================================
     RANGE LABEL
  ======================================================= */

  const selectedRangeLabel =
    RANGE_OPTIONS.find(
      (option) => option.value === rangeDays
    )?.label || `Last ${rangeDays} days`;

  /* =======================================================
     RENDER
  ======================================================= */

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
      {/* =================================================
          PAGE HEADER
      ================================================= */}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">
            Productivity Insights
          </h1>

          <p className="text-muted-foreground mt-1">
            Understand your productivity, behavior patterns,
            workload, and deadline performance.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={rangeDays}
            onValueChange={setRangeDays}
          >
            <SelectTrigger className="w-[170px]">
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              {RANGE_OPTIONS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            onClick={fetchInsights}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <BarChart3 className="mr-2 h-4 w-4" />
            )}

            Analyze Patterns
          </Button>
        </div>
      </div>

      {/* =================================================
          RANGE EXPLANATION
      ================================================= */}

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-3">
            <Activity className="h-5 w-5 text-primary" />

            <div>
              <p className="font-medium">
                Analysis Period
              </p>

              <p className="text-sm text-muted-foreground">
                Productivity and behavioral patterns are
                analyzed using data from{" "}
                <strong>{selectedRangeLabel.toLowerCase()}</strong>.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* =================================================
          NO DATA / INITIAL STATE
      ================================================= */}

      {!data ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <BarChart3 className="mx-auto h-12 w-12 mb-4 opacity-30" />

            <p className="text-lg font-medium">
              No insights analyzed yet
            </p>

            <p className="text-sm mt-1 max-w-md mx-auto">
              Choose an analysis period and click
              "Analyze Patterns" to calculate your
              productivity and behavioral patterns.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* =================================================
              RANGE SUMMARY
          ================================================= */}

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              Range: {selectedRangeLabel}
            </Badge>

            {data.totals && (
              <Badge variant="outline">
                {data.totals.completed} completed ·{" "}
                {data.totals.pending} pending
              </Badge>
            )}

            {data.behavior_profile && (
              <Badge variant="outline">
                Behavior:{" "}
                {data.behavior_profile.evidence_level ===
                "learning"
                  ? "Learning"
                  : "Limited data"}
              </Badge>
            )}
          </div>

          {/* =================================================
              DEVELOPER CALCULATION PANEL
          ================================================= */}

          <DevPanel
            title="Analytics internals — data sources, formulas & metrics"
            subtitle="Behavior analysis + selected-range aggregation"
            raw={{
              insights: data,
              selected_range_days: Number(rangeDays),
              category_distribution: categoryData,
              missed_deadlines: missedDeadlines,
            }}
          >
            <p className="text-[11px] text-muted-foreground">
              <strong>Analysis range:</strong>{" "}
              {selectedRangeLabel}. Completed work and
              behavioral records are analyzed within the
              selected period.
            </p>

            <p className="text-[11px] text-muted-foreground">
              <strong>Behavioral data:</strong> actual
              time-entry sessions, completed tasks,
              completion timing, deadline behavior,
              and the user's configured or learned
              productivity period.
            </p>

            <p className="text-[11px] text-muted-foreground">
              <strong>Deadline Risk Factor:</strong> the
              behavioral risk value is supplied by the
              <code className="mx-1">
                behavior-insights
              </code>
              analysis and reflects deadline-related
              behavior within the selected analysis range.
            </p>

            <p className="text-[11px] text-muted-foreground">
              <strong>Important:</strong> a new user with
              insufficient behavioral history should not
              receive fabricated behavioral results.
              The interface should indicate limited
              evidence instead.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <DevStat
                label="Range (days)"
                value={data.range_days ?? rangeDays}
              />

              <DevStat
                label="Tasks in range"
                value={data.totals?.total ?? "—"}
              />

              <DevStat
                label="Completed"
                value={data.totals?.completed ?? "—"}
              />

              <DevStat
                label="Pending"
                value={data.totals?.pending ?? "—"}
              />

              <DevStat
                label="Productivity score"
                value={
                  hasProductivityData
                    ? `${data.productivity_score}%`
                    : "Limited data"
                }
              />

              <DevStat
                label="Avg duration"
                value={
                  data.avg_task_duration
                    ? `${data.avg_task_duration} min`
                    : "—"
                }
              />

              <DevStat
                label="Behavioral risk"
                value={
                  data.deadline_risk
                    ? `${data.deadline_risk.factor}%`
                    : "—"
                }
              />

              <DevStat
                label="Late completion"
                value={
                  data.deadline_risk
                    ? `${data.deadline_risk.late_completion_rate}%`
                    : "—"
                }
              />
            </div>
          </DevPanel>

          {/* =================================================
              PRODUCTIVITY OVERVIEW
          ================================================= */}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Productivity Score */}

            <Card>
              <CardContent className="pt-6 text-center">
                <TrendingUp className="mx-auto h-8 w-8 text-primary mb-2" />

                <p className="text-3xl font-display font-bold">
                  {hasProductivityData
                    ? `${data.productivity_score}%`
                    : "—"}
                </p>

                <p className="text-sm text-muted-foreground">
                  Productivity Score
                </p>
              </CardContent>
            </Card>

            {/* Average Duration */}

            <Card>
              <CardContent className="pt-6 text-center">
                <Clock className="mx-auto h-8 w-8 text-info mb-2" />

                <p className="text-3xl font-display font-bold">
                  {data.avg_task_duration
                    ? `${data.avg_task_duration}m`
                    : "—"}
                </p>

                <p className="text-sm text-muted-foreground">
                  Avg Task Duration
                </p>
              </CardContent>
            </Card>

            {/* Peak Hours */}

            <Card>
              <CardContent className="pt-6 text-center">
                <Zap className="mx-auto h-8 w-8 text-warning mb-2" />

                <p className="text-xl font-display font-bold">
                  {data.peak_hours || "—"}
                </p>

                <p className="text-sm text-muted-foreground">
                  Peak Productivity Hours
                </p>
              </CardContent>
            </Card>

            {/* Deadline Risk */}

            <Card>
              <CardContent className="pt-6 text-center">
                <AlertTriangle
                  className={`mx-auto h-8 w-8 mb-2 ${
                    data.deadline_risk
                      ? riskTone(
                          data.deadline_risk.factor
                        ).color
                      : "text-muted-foreground"
                  }`}
                />

                <p className="text-3xl font-display font-bold">
                  {data.deadline_risk
                    ? `${data.deadline_risk.factor}%`
                    : "—"}
                </p>

                <p className="text-sm text-muted-foreground">
                  Behavioral Deadline Risk
                </p>
              </CardContent>
            </Card>
          </div>

          {/* =================================================
              BEHAVIOR PROFILE
          ================================================= */}

          {data.behavior_profile && (
            <Card>
              <CardHeader>
                <CardTitle className="font-display flex items-center gap-2">
                  <Brain className="h-5 w-5 text-primary" />

                  Behavioral Profile
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      data.behavior_profile
                        .evidence_level === "learning"
                        ? "default"
                        : "secondary"
                    }
                  >
                    {data.behavior_profile
                      .evidence_level === "learning"
                      ? "Learning from behavior"
                      : "Limited behavioral data"}
                  </Badge>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border p-4">
                    <p className="text-xs text-muted-foreground">
                      Learned productive window
                    </p>

                    <p className="font-semibold mt-1">
                      {
                        data.behavior_profile
                          .learned_peak_start
                      }{" "}
                      –{" "}
                      {
                        data.behavior_profile
                          .learned_peak_end
                      }
                    </p>
                  </div>

                  <div className="rounded-lg border p-4">
                    <p className="text-xs text-muted-foreground">
                      Actual work time
                    </p>

                    <p className="text-xl font-bold mt-1">
                      {
                        data.behavior_profile
                          .actual_minutes
                      }{" "}
                      min
                    </p>
                  </div>

                  <div className="rounded-lg border p-4">
                    <p className="text-xs text-muted-foreground">
                      Average session
                    </p>

                    <p className="text-xl font-bold mt-1">
                      {
                        data.behavior_profile
                          .average_actual_minutes
                      }{" "}
                      min
                    </p>
                  </div>

                  <div className="rounded-lg border p-4">
                    <p className="text-xs text-muted-foreground">
                      Completed sessions
                    </p>

                    <p className="text-xl font-bold mt-1">
                      {
                        data.behavior_profile
                          .completed_sessions
                      }
                    </p>
                  </div>
                </div>

                {!hasBehaviorData && (
                  <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
                    <strong>Not enough behavioral history yet.</strong>{" "}
                    Continue completing tasks and recording
                    work sessions so GSI can learn your
                    productivity patterns.
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* =================================================
              DEADLINE RISK
          ================================================= */}

          {data.deadline_risk && (
            <Card>
              <CardHeader>
                <CardTitle className="font-display flex items-center gap-2">
                  <CalendarClock className="h-5 w-5 text-primary" />

                  Behavioral Deadline Risk
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-5">
                {/* Risk score */}

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <div>
                      <span className="font-medium">
                        Deadline Risk Factor
                      </span>

                      <p className="text-xs text-muted-foreground">
                        Based on deadline-related behavior
                        within the selected usage range.
                      </p>
                    </div>

                    <span
                      className={
                        riskTone(
                          data.deadline_risk.factor
                        ).color
                      }
                    >
                      {
                        riskTone(
                          data.deadline_risk.factor
                        ).label
                      }
                    </span>
                  </div>

                  <Progress
                    value={Math.max(
                      0,
                      Math.min(
                        100,
                        data.deadline_risk.factor
                      )
                    )}
                  />

                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>0% — Lower risk</span>
                    <span>
                      {data.deadline_risk.factor}%
                    </span>
                    <span>100% — Higher risk</span>
                  </div>

                  {data.deadline_risk_summary && (
                    <p className="text-sm text-muted-foreground pt-1">
                      {data.deadline_risk_summary}
                    </p>
                  )}
                </div>

                {/* Deadline statistics */}

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border p-4 text-center">
                    <CircleAlert className="mx-auto h-5 w-5 text-destructive mb-2" />

                    <p className="text-2xl font-display font-bold text-destructive">
                      {
                        data.deadline_risk
                          .overdue_count
                      }
                    </p>

                    <p className="text-xs text-muted-foreground">
                      Overdue
                    </p>
                  </div>

                  <div className="rounded-lg border p-4 text-center">
                    <Timer className="mx-auto h-5 w-5 text-warning mb-2" />

                    <p className="text-2xl font-display font-bold text-warning">
                      {
                        data.deadline_risk
                          .due_within_24h
                      }
                    </p>

                    <p className="text-xs text-muted-foreground">
                      Due within 24h
                    </p>
                  </div>

                  <div className="rounded-lg border p-4 text-center">
                    <CalendarClock className="mx-auto h-5 w-5 text-info mb-2" />

                    <p className="text-2xl font-display font-bold text-info">
                      {
                        data.deadline_risk
                          .due_within_72h
                      }
                    </p>

                    <p className="text-xs text-muted-foreground">
                      Due within 72h
                    </p>
                  </div>

                  <div className="rounded-lg border p-4 text-center">
                    <Target className="mx-auto h-5 w-5 text-primary mb-2" />

                    <p className="text-2xl font-display font-bold">
                      {
                        data.deadline_risk
                          .late_completion_rate
                      }%
                    </p>

                    <p className="text-xs text-muted-foreground">
                      Late completion rate
                    </p>
                  </div>
                </div>

                {/* At-risk tasks */}

                {data.deadline_risk.risky_tasks.length >
                  0 && (
                  <div className="space-y-3">
                    <div>
                      <p className="font-medium">
                        Tasks contributing to current
                        deadline concern
                      </p>

                      <p className="text-xs text-muted-foreground">
                        These are current task-level
                        signals, separate from the
                        historical behavioral risk factor.
                      </p>
                    </div>

                    {data.deadline_risk.risky_tasks.map(
                      (task, index) => (
                        <div
                          key={`${task.title}-${index}`}
                          className="flex items-center justify-between gap-3 rounded-lg bg-accent/30 p-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {task.title}
                            </p>

                            <p className="text-xs text-muted-foreground">
                              {task.hoursLeft < 0
                                ? `Overdue by ${Math.abs(
                                    task.hoursLeft
                                  )}h`
                                : `${task.hoursLeft}h left`}
                            </p>
                          </div>

                          <Badge
                            variant={
                              task.risk >= 0.85
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {Math.round(
                              task.risk * 100
                            )}
                            %
                          </Badge>
                        </div>
                      )
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* =================================================
              MISSED DEADLINES
          ================================================= */}

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                  <CalendarX2 className="h-6 w-6 text-destructive" />
                </div>

                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">
                    Deadline issues in selected range
                  </p>

                  <p className="text-3xl font-display font-bold">
                    {missedDeadlines}
                  </p>
                </div>

                <Badge
                  variant={
                    missedDeadlines > 0
                      ? "destructive"
                      : "secondary"
                  }
                >
                  {missedDeadlines === 0
                    ? "On track"
                    : missedDeadlines > 5
                    ? "Needs attention"
                    : "Manageable"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* =================================================
              WHAT GSI LEARNED
          ================================================= */}

          {data.insights.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="font-display flex items-center gap-2">
                  <Brain className="h-5 w-5 text-primary" />

                  What GSI Learned
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  These observations are based on the
                  selected usage range and available
                  behavioral data.
                </p>

                {data.insights.map((insight, index) => (
                  <div
                    key={index}
                    className="flex gap-3 p-4 rounded-lg bg-accent/30"
                  >
                    <Zap className="h-4 w-4 text-primary mt-0.5 shrink-0" />

                    <p className="text-sm">
                      {insight}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* =================================================
              PREFERRED CATEGORIES
          ================================================= */}

          {data.preferred_categories &&
            data.preferred_categories.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="font-display flex items-center gap-2">
                    <ListChecks className="h-5 w-5 text-primary" />

                    Preferred Task Categories
                  </CardTitle>
                </CardHeader>

                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {data.preferred_categories.map(
                      (category, index) => (
                        <Badge
                          key={`${category}-${index}`}
                          variant="secondary"
                        >
                          {category}
                        </Badge>
                      )
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

          {/* =================================================
              WORKLOAD DISTRIBUTION
          ================================================= */}

          {categoryData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="font-display flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-primary" />

                  Workload Distribution
                </CardTitle>

                <p className="text-sm text-muted-foreground">
                  Tasks included in the selected analysis
                  period.
                </p>
              </CardHeader>

              <CardContent>
                <ResponsiveContainer
                  width="100%"
                  height={320}
                >
                  <BarChart
                    data={categoryData}
                    margin={{
                      top: 10,
                      right: 10,
                      left: 0,
                      bottom: 10,
                    }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-border"
                    />

                    <XAxis
                      dataKey="name"
                      className="text-muted-foreground"
                    />

                    <YAxis
                      allowDecimals={false}
                      className="text-muted-foreground"
                    />

                    <Tooltip />

                    <Bar
                      dataKey="count"
                      name="Tasks"
                      fill="hsl(var(--primary))"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* =================================================
              NEW USER / LIMITED DATA NOTICE
          ================================================= */}

          {!hasBehaviorData && (
            <Card className="border-dashed">
              <CardContent className="py-6">
                <div className="flex gap-4">
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <Activity className="h-5 w-5 text-muted-foreground" />
                  </div>

                  <div>
                    <p className="font-medium">
                      More behavioral data is needed
                    </p>

                    <p className="text-sm text-muted-foreground mt-1">
                      GSI can already use your task
                      information and configured work
                      preferences. As you complete tasks
                      and record work sessions, the system
                      can identify stronger productivity
                      and deadline behavior patterns.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* =================================================
              DATA INTERPRETATION
          ================================================= */}

          <Card className="bg-muted/30">
            <CardHeader>
              <CardTitle className="font-display">
                How to Read These Insights
              </CardTitle>
            </CardHeader>

            <CardContent className="grid gap-4 md:grid-cols-3">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="h-4 w-4 text-success" />

                  <p className="font-medium">
                    Productivity
                  </p>
                </div>

                <p className="text-sm text-muted-foreground">
                  Shows how your completed work and
                  recorded activity performed during the
                  selected analysis period.
                </p>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Brain className="h-4 w-4 text-primary" />

                  <p className="font-medium">
                    Behavioral Pattern
                  </p>
                </div>

                <p className="text-sm text-muted-foreground">
                  Shows patterns learned from available
                  work sessions and completed task
                  behavior.
                </p>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-warning" />

                  <p className="font-medium">
                    Deadline Risk
                  </p>
                </div>

                <p className="text-sm text-muted-foreground">
                  Shows the calculated behavioral deadline
                  risk together with current deadline
                  signals.
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </motion.div>
  );
}
