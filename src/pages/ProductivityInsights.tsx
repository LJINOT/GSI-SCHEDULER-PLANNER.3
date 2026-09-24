import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Loader2, BarChart3, Clock, Zap, TrendingUp, AlertTriangle, CalendarClock, CalendarX2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { DevPanel, DevStat } from "@/components/DevPanel";


type RiskyTask = { title: string; due: string; hoursLeft: number; risk: number };
type Insights = {
  peak_hours: string;
  avg_task_duration: number;
  preferred_categories: string[];
  insights: string[];
  productivity_score: number;
  deadline_risk_summary?: string;
  range_days?: number;
  deadline_risk?: {
    factor: number;
    overdue_count: number;
    due_within_24h: number;
    due_within_72h: number;
    pending_with_deadline: number;
    late_completion_rate: number;
    risky_tasks: RiskyTask[];
  };
  totals?: { completed: number; pending: number; total: number };
  behavior_profile?: {
    evidence_level: "limited" | "learning";
    actual_minutes: number;
    average_actual_minutes: number;
    completed_sessions: number;
    learned_peak_start: string;
    learned_peak_end: string;
  };
};

const RANGE_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "14", label: "Last 14 days" },
  { value: "30", label: "Last 30 days" },
  { value: "60", label: "Last 60 days" },
  { value: "90", label: "Last 90 days" },
];

export default function ProductivityInsights() {
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(false);
  const [rangeDays, setRangeDays] = useState("30");
  const [categoryData, setCategoryData] = useState<{ name: string; count: number }[]>([]);
  const [missedDeadlines, setMissedDeadlines] = useState(0);

  const fetchInsights = async () => {
    setLoading(true);
    try {
      const { data: aiData, error } = await supabase.functions.invoke("behavior-insights", {
        body: { rangeDays: Number(rangeDays) },
      });
      if (error) throw error;
      setData(aiData);

      // Category stats + missed-deadline counter scoped to the current user and analysis range.
      const sinceISO = new Date(Date.now() - Number(rangeDays) * 24 * 60 * 60 * 1000).toISOString();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not logged in");
      const [{ data: rangePending }, { data: rangeCompleted }] = await Promise.all([
        supabase.from("tasks").select("category, status, due_date, completed_at").eq("user_id", user.id).or("archived.eq.false,archived.is.null").neq("status", "done"),
        supabase.from("tasks").select("category, status, due_date, completed_at").eq("user_id", user.id).or("archived.eq.false,archived.is.null").eq("status", "done").gte("completed_at", sinceISO),
      ]);
      const rangeTasks = [...(rangePending || []), ...(rangeCompleted || [])];
      const cats: Record<string, number> = {};
      let missed = 0;
      const nowMs = Date.now();
      (rangeTasks || []).forEach((t) => {
        const c = t.category || "Other"; cats[c] = (cats[c] || 0) + 1;
        if (t.due_date) {
          const dueMs = new Date(t.due_date).getTime();
          if (t.status === "done") {
            if (t.completed_at && new Date(t.completed_at).getTime() > dueMs) missed++;
          } else if (dueMs < nowMs) {
            missed++;
          }
        }
      });
      setCategoryData(Object.entries(cats).map(([name, count]) => ({ name, count })));
      setMissedDeadlines(missed);

      toast.success(`Insights generated for last ${rangeDays} days`);
    } catch (err: any) {
      toast.error(err.message || "Failed to generate insights");
    }
    setLoading(false);
  };

  const riskTone = (factor: number) => {
    if (factor >= 70) return { label: "High Risk", color: "text-destructive", bar: "bg-destructive" };
    if (factor >= 40) return { label: "Moderate Risk", color: "text-warning", bar: "bg-warning" };
    return { label: "Low Risk", color: "text-success", bar: "bg-success" };
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Productivity Insights</h1>
          <p className="text-muted-foreground mt-1">Peak hours, completion time, workload distribution & deadline risk</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={rangeDays} onValueChange={setRangeDays}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={fetchInsights} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BarChart3 className="mr-2 h-4 w-4" />}
            Analyze Patterns
          </Button>
        </div>
      </div>

      {!data ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <BarChart3 className="mx-auto h-12 w-12 mb-4 opacity-30" />
            <p className="text-lg">No insights yet</p>
            <p className="text-sm mt-1">Pick a time range and click "Analyze Patterns" to discover your productivity trends</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">Range: last {data.range_days ?? rangeDays} days</Badge>
            {data.totals && (
              <Badge variant="outline">{data.totals.completed} completed · {data.totals.pending} pending</Badge>
            )}
          </div>

          <DevPanel
            title="Analytics internals — data sources, formulas & metrics"
            subtitle="behavior-insights edge function + client-side range aggregation"
            raw={{ insights: data, category_distribution: categoryData, missed_deadlines: missedDeadlines }}
          >
            <p className="text-[11px] text-muted-foreground">
              <strong>Sources:</strong> actual <code>time_entries</code>, completed tasks using <code>completed_at</code>, pending tasks, and the user's timezone/preferences.
              Behavioral calculations are scoped to your user id and use the selected analysis range for completed work.
            </p>
            <p className="text-[11px] text-muted-foreground">
              <strong>Behavior model:</strong> actual session minutes are grouped by the user's local start hour; completed tasks add a success signal.
              A learned two-hour window is used when enough evidence exists. Actual time is preferred over estimated duration.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <DevStat label="Range (days)" value={data.range_days ?? rangeDays} />
              <DevStat label="Tasks in range" value={data.totals?.total ?? "—"} />
              <DevStat label="Completed" value={data.totals?.completed ?? "—"} />
              <DevStat label="Pending" value={data.totals?.pending ?? "—"} />
              <DevStat label="Productivity score" value={`${data.productivity_score}%`} />
              <DevStat label="Avg duration" value={`${data.avg_task_duration} min`} />
              <DevStat label="Risk factor" value={data.deadline_risk ? `${data.deadline_risk.factor}%` : "—"} />
              <DevStat label="Late completion rate" value={data.deadline_risk ? `${data.deadline_risk.late_completion_rate}%` : "—"} />
            </div>
          </DevPanel>



          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-6 text-center">
                <TrendingUp className="mx-auto h-8 w-8 text-primary mb-2" />
                <p className="text-3xl font-display font-bold">{data.productivity_score}%</p>
                <p className="text-sm text-muted-foreground">Productivity Score</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <Clock className="mx-auto h-8 w-8 text-info mb-2" />
                <p className="text-3xl font-display font-bold">{data.avg_task_duration}m</p>
                <p className="text-sm text-muted-foreground">Avg Task Duration</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <Zap className="mx-auto h-8 w-8 text-warning mb-2" />
                <p className="text-xl font-display font-bold">{data.peak_hours}</p>
                <p className="text-sm text-muted-foreground">Peak Hours</p>
              </CardContent>
            </Card>
            {data.deadline_risk && (
              <Card>
                <CardContent className="pt-6 text-center">
                  <AlertTriangle className={`mx-auto h-8 w-8 mb-2 ${riskTone(data.deadline_risk.factor).color}`} />
                  <p className="text-3xl font-display font-bold">{data.deadline_risk.factor}%</p>
                  <p className="text-sm text-muted-foreground">Deadline Risk Factor</p>
                </CardContent>
              </Card>
            )}
          </div>

          {data.behavior_profile && (
            <Card>
              <CardContent className="py-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <span><strong>Learned window:</strong> {data.behavior_profile.learned_peak_start}–{data.behavior_profile.learned_peak_end}</span>
                <span><strong>Actual work:</strong> {data.behavior_profile.actual_minutes} min</span>
                <span><strong>Avg session:</strong> {data.behavior_profile.average_actual_minutes} min</span>
                <span><strong>Sessions:</strong> {data.behavior_profile.completed_sessions}</span>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="pt-6 flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                <CalendarX2 className="h-6 w-6 text-destructive" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">Missed Deadlines (last {rangeDays} days)</p>
                <p className="text-3xl font-display font-bold">{missedDeadlines}</p>
              </div>
              <Badge variant={missedDeadlines > 0 ? "destructive" : "secondary"}>
                {missedDeadlines === 0 ? "On track" : missedDeadlines > 5 ? "Needs attention" : "Manageable"}
              </Badge>
            </CardContent>
          </Card>
          {data.deadline_risk && (
            <Card>
              <CardHeader>
                <CardTitle className="font-display flex items-center gap-2">
                  <CalendarClock className="h-5 w-5 text-primary" />
                  Deadline Risk Pattern
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">Overall risk</span>
                    <span className={riskTone(data.deadline_risk.factor).color}>
                      {riskTone(data.deadline_risk.factor).label}
                    </span>
                  </div>
                  <Progress value={data.deadline_risk.factor} />
                  {data.deadline_risk_summary && (
                    <p className="text-sm text-muted-foreground pt-1">{data.deadline_risk_summary}</p>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-display font-bold text-destructive">{data.deadline_risk.overdue_count}</p>
                    <p className="text-xs text-muted-foreground">Overdue</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-display font-bold text-warning">{data.deadline_risk.due_within_24h}</p>
                    <p className="text-xs text-muted-foreground">Due ≤ 24h</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-display font-bold text-info">{data.deadline_risk.due_within_72h}</p>
                    <p className="text-xs text-muted-foreground">Due ≤ 72h</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-display font-bold">{data.deadline_risk.late_completion_rate}%</p>
                    <p className="text-xs text-muted-foreground">Late completion rate</p>
                  </div>
                </div>

                {data.deadline_risk.risky_tasks.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Top at-risk tasks</p>
                    {data.deadline_risk.risky_tasks.map((t, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg bg-accent/30 p-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{t.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {t.hoursLeft < 0 ? `Overdue by ${Math.abs(t.hoursLeft)}h` : `${t.hoursLeft}h left`}
                          </p>
                        </div>
                        <Badge variant={t.risk >= 0.85 ? "destructive" : "secondary"}>
                          {Math.round(t.risk * 100)}%
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {data.insights.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="font-display">AI Insights</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {data.insights.map((insight, i) => (
                  <div key={i} className="flex gap-3 p-3 rounded-lg bg-accent/30">
                    <Zap className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <p className="text-sm">{insight}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {categoryData.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="font-display">Workload Distribution</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={categoryData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" className="text-muted-foreground" />
                    <YAxis className="text-muted-foreground" />
                    <Tooltip />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </motion.div>
  );
}
