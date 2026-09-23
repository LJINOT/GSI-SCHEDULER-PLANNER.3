import { useState, useEffect, useMemo, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, Lightbulb, ChevronDown, ChevronUp, Brain, Activity, Clock,
} from "lucide-react";
import { loadCache, saveCache } from "@/lib/persist-cache";
import { DevPanel, DevStat, DevBar } from "@/components/DevPanel";
import { useDevMode } from "@/hooks/use-dev-mode";
import { formatDistanceToNow, isToday } from "date-fns";

const CACHE_KEY = "gsi-cache:smart-suggestions";
const PREV_CACHE_KEY = "gsi-cache:smart-suggestions-prev";

type Breakdown = { urgency: number; quick_win: number; flow: number; cognitive_fit: number };
type Suggestion = {
  id: string;
  title: string;
  reason: string;
  priority: string;
  score?: number;
  suggested_time?: string;
  breakdown?: Breakdown;
  estimated_duration?: number | null;
};

type Payload = {
  picks: Suggestion[];
  weights?: { urgency: number; quickWin: number; flow: number; cognitive: number };
  peak_source?: string;
  peak_window?: string;
  break_style?: string;
  algorithm?: string;
  timestamp?: string;
};

type TimeEntry = {
  id: string;
  start_time: string;
  end_time: string | null;
  duration: number | null;
  task_id: string;
};

type TaskLite = {
  id: string;
  title: string;
  estimated_duration: number | null;
  status: string;
  category: string | null;
};

function to12hRange(suggested?: string): string {
  if (!suggested) return "—";
  return suggested;
}


/** Client-side sequential allocation — safety net if edge function is outdated */
function allocateNonOverlapping(
  picks: Suggestion[],
  workStart = "09:00",
  workEnd = "22:00",
): Suggestion[] {
  const parse = (s: string) => {
    const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ap = m[3]?.toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return h * 60 + min;
  };
  const to12 = (mins: number) => {
    const h24 = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    const ap = h24 >= 12 ? "PM" : "AM";
    const h = ((h24 + 11) % 12) + 1;
    return `${h}:${String(m).padStart(2, "0")} ${ap}`;
  };
  const FIXED = [
    { start: 9 * 60, end: 9 * 60 + 15 },
    { start: 12 * 60, end: 13 * 60 },
    { start: 15 * 60, end: 15 * 60 + 15 },
  ];
  const ws = parse(workStart) ?? 9 * 60;
  const we = parse(workEnd) ?? 22 * 60;
  const occupied = [...FIXED];
  const overlap = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && a1 > b0;
  const find = (pref: number, dur: number) => {
    let c = Math.max(pref, ws);
    for (let i = 0; i < 500 && c + dur <= we; i++) {
      const hit = occupied.find((b) => overlap(c, c + dur, b.start, b.end));
      if (!hit) return { start: c, end: c + dur };
      c = Math.max(c + 1, hit.end);
    }
    return null;
  };

  // Detect if backend already produced non-overlapping starts
  const starts = picks
    .map((p) => {
      const part = (p.suggested_time || "").split("–")[0]?.trim() || (p.suggested_time || "").split("-")[0]?.trim();
      return part ? parse(part.replace(/–/g, "").trim()) : null;
    })
    .filter((x): x is number => x != null);
  const uniqueStarts = new Set(starts);
  if (starts.length >= 2 && uniqueStarts.size === starts.length) {
    // likely already unique starts — still check full overlap
    let anyOverlap = false;
    for (let i = 0; i < picks.length; i++) {
      for (let j = i + 1; j < picks.length; j++) {
        const a = (picks[i].suggested_time || "").split(/[–-]/).map((s) => parse(s.trim()));
        const b = (picks[j].suggested_time || "").split(/[–-]/).map((s) => parse(s.trim()));
        if (a[0] != null && a[1] != null && b[0] != null && b[1] != null && overlap(a[0], a[1], b[0], b[1])) {
          anyOverlap = true;
        }
      }
    }
    if (!anyOverlap) return picks;
  }

  const out: Suggestion[] = [];
  for (const p of picks) {
    if ((p.suggested_time || "").toLowerCase().includes("no available")) {
      out.push(p);
      continue;
    }
    const dur = Math.max(15, (p as any).duration || 30);
    // preferred from current suggested start if parseable, else now-ish
    const prefPart = (p.suggested_time || "").split(/[–-]/)[0]?.trim();
    let pref = prefPart ? parse(prefPart) : null;
    if (pref == null) pref = ws;
    const slot = find(pref, dur);
    if (!slot) {
      out.push({ ...p, suggested_time: "No available time slot" });
      continue;
    }
    occupied.push({ start: slot.start, end: slot.end });
    out.push({
      ...p,
      suggested_time: `${to12(slot.start)} – ${to12(slot.end)}`,
      duration: dur,
    } as Suggestion);
  }
  // sort by start
  out.sort((a, b) => {
    const pa = parse((a.suggested_time || "").split(/[–-]/)[0]?.trim() || "") ?? 0;
    const pb = parse((b.suggested_time || "").split(/[–-]/)[0]?.trim() || "") ?? 0;
    return pa - pb;
  });
  return out;
}


function confidenceFromScore(score?: number): { label: string; className: string } {
  const s = score ?? 0;
  if (s >= 70) return { label: "High", className: "bg-success/15 text-success border-success/30" };
  if (s >= 45) return { label: "Medium", className: "bg-warning/15 text-warning border-warning/30" };
  return { label: "Low", className: "bg-muted text-muted-foreground border-border" };
}

function levelFromCount(count: number, max: number): "High" | "Medium" | "Low" {
  if (max <= 0) return "Low";
  const ratio = count / max;
  if (ratio >= 0.6) return "High";
  if (ratio >= 0.3) return "Medium";
  return "Low";
}

export default function SmartSuggestions() {
  const [payload, setPayload] = useState<Payload | null>(() => loadCache<Payload>(CACHE_KEY));
  const [prevPayload, setPrevPayload] = useState<Payload | null>(() => loadCache<Payload>(PREV_CACHE_KEY));
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [tasks, setTasks] = useState<TaskLite[]>([]);
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<string | null>(null);
  const [loadingPatterns, setLoadingPatterns] = useState(true);
  const { devMode } = useDevMode();

  const suggestions = payload?.picks || [];
  const w = payload?.weights;

  useEffect(() => {
    const load = async () => {
      setLoadingPatterns(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setTimeEntries([]);
        setTasks([]);
        setLastAnalyzedAt(null);
        setLoadingPatterns(false);
        return;
      }

      const since = new Date();
      since.setDate(since.getDate() - 14);

      const [{ data: entries }, { data: taskRows }, { data: logs }] = await Promise.all([
        supabase
          .from("time_entries")
          .select("id, start_time, end_time, duration, task_id")
          .gte("start_time", since.toISOString())
          .order("start_time", { ascending: false }),
        supabase
          .from("tasks")
          .select("id, title, estimated_duration, status, category")
          .eq("user_id", user.id)
          .eq("archived", false),
        supabase
          .from("behavior_logs")
          .select("recorded_at, metric_type, value")
          .eq("user_id", user.id)
          .order("recorded_at", { ascending: false })
          .limit(5),
      ]);

      setTimeEntries((entries as TimeEntry[]) || []);
      setTasks((taskRows as TaskLite[]) || []);

      const latest = logs?.[0]?.recorded_at || payload?.timestamp || null;
      setLastAnalyzedAt(latest);
      setLoadingPatterns(false);
    };
    load();
  }, [payload?.timestamp]);

  // Refresh the live recommendation set for this account when the page opens.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke("smart-picks", { body: {} });
        if (cancelled) return;
        if (error) throw error;
        const rawPicks = Array.isArray(data?.picks) ? data.picks as Suggestion[] : [];
        const next: Payload = { ...(data || {}), picks: allocateNonOverlapping(rawPicks) };
        setPayload(next);
        saveCache(CACHE_KEY, next);
        if (next.timestamp) setLastAnalyzedAt(next.timestamp);
      } catch (err) {
        if (!cancelled) console.error("Failed to refresh Smart Suggestions:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void refresh();
    return () => { cancelled = true; };
  }, []);

  const taskDurationMap = useMemo(() => {
    const m: Record<string, number | null> = {};
    tasks.forEach((t) => {
      m[t.id] = t.estimated_duration;
    });
    return m;
  }, [tasks]);

  const workPattern = useMemo(() => {
    const hourCounts = Array(24).fill(0);
    const dayCounts = Array(7).fill(0);
    let totalDuration = 0;
    let durationSamples = 0;

    for (const e of timeEntries) {
      const start = new Date(e.start_time);
      hourCounts[start.getHours()] += 1;
      dayCounts[start.getDay()] += 1;
      if (e.duration && e.duration > 0) {
        totalDuration += e.duration;
        durationSamples += 1;
      }
    }

    let peakHour = 9;
    let peakHourCount = 0;
    hourCounts.forEach((c, h) => {
      if (c > peakHourCount) {
        peakHourCount = c;
        peakHour = h;
      }
    });

    let peakDay = 1;
    let peakDayCount = 0;
    dayCounts.forEach((c, d) => {
      if (c > peakDayCount) {
        peakDayCount = c;
        peakDay = d;
      }
    });

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const avgSession = durationSamples > 0 ? Math.round(totalDuration / durationSamples) : null;

    const morning = hourCounts.slice(5, 12).reduce((a, b) => a + b, 0);
    const afternoon = hourCounts.slice(12, 17).reduce((a, b) => a + b, 0);
    const evening =
      hourCounts.slice(17, 24).reduce((a, b) => a + b, 0) +
      hourCounts.slice(0, 5).reduce((a, b) => a + b, 0);
    const maxPeriod = Math.max(morning, afternoon, evening, 1);

    const fmtHour = (h: number) => {
      const period = h >= 12 ? "PM" : "AM";
      const hr = ((h + 11) % 12) + 1;
      return `${hr}:00 ${period}`;
    };

    return {
      hasData: timeEntries.length > 0,
      peakHourLabel: peakHourCount > 0 ? fmtHour(peakHour) : null,
      peakDayLabel: peakDayCount > 0 ? dayNames[peakDay] : null,
      avgSession,
      periodLevels: {
        Morning: levelFromCount(morning, maxPeriod),
        Afternoon: levelFromCount(afternoon, maxPeriod),
        Evening: levelFromCount(evening, maxPeriod),
      } as Record<string, "High" | "Medium" | "Low">,
      sampleCount: timeEntries.length,
    };
  }, [timeEntries]);

  const adaptations = useMemo(() => {
    if (!prevPayload?.picks?.length || !payload?.picks?.length) return [];
    const prevMap = new Map(prevPayload.picks.map((p) => [p.id, p]));
    const changes: {
      id: string;
      title: string;
      previous: string;
      current: string;
      reason: string;
    }[] = [];

    for (const cur of payload.picks) {
      const prev = prevMap.get(cur.id);
      if (!prev?.suggested_time || !cur.suggested_time) continue;
      if (prev.suggested_time === cur.suggested_time) continue;
      changes.push({
        id: cur.id,
        title: cur.title,
        previous: prev.suggested_time,
        current: cur.suggested_time,
        reason:
          cur.reason ||
          (workPattern.peakHourLabel
            ? `Recent activity shows stronger completion around ${workPattern.peakHourLabel}.`
            : "Recommendation updated from latest behavior analysis."),
      });
    }
    return changes;
  }, [payload, prevPayload, workPattern.peakHourLabel]);

  const getSuggestions = async () => {
    setLoading(true);
    try {
      if (payload) {
        saveCache(PREV_CACHE_KEY, payload);
        setPrevPayload(payload);
      }

      const { data, error } = await supabase.functions.invoke("smart-picks", { body: {} });
      if (error) throw error;
      const rawPicks = (data?.picks || []) as Suggestion[];
      const next: Payload = { ...(data || {}), picks: allocateNonOverlapping(rawPicks) };
      setPayload(next);
      saveCache(CACHE_KEY, next);
      if (next.timestamp) setLastAnalyzedAt(next.timestamp);
      toast.success("Recommendations updated from your activity patterns.");
    } catch (err: any) {
      toast.error(err.message || "Failed to get suggestions");
    }
    setLoading(false);
  };

  const lastAnalyzedLabel = useMemo(() => {
    if (!lastAnalyzedAt) return "Not analyzed yet";
    try {
      const d = new Date(lastAnalyzedAt);
      if (isToday(d)) return "Today";
      return formatDistanceToNow(d, { addSuffix: true });
    } catch {
      return "—";
    }
  }, [lastAnalyzedAt]);

  const explanationFor = (s: Suggestion) => {
    const lines: string[] = [];
    if (s.suggested_time) lines.push(`Recommended: ${s.suggested_time}`);
    if (s.reason) lines.push(`Reason: ${s.reason}`);
    if (workPattern.peakHourLabel) {
      lines.push(`Your most active hour (last 14 days): ${workPattern.peakHourLabel}`);
    }
    if (workPattern.avgSession) {
      lines.push(`Average session length: ${workPattern.avgSession} min`);
    }
    const dur = s.estimated_duration ?? taskDurationMap[s.id];
    if (dur) lines.push(`Task duration: ${dur} min`);
    if (payload?.peak_window) {
      lines.push(
        `Peak window used: ${payload.peak_window}${payload.peak_source ? ` (${payload.peak_source})` : ""}`
      );
    }
    if (lines.length === 1 && s.suggested_time) {
      lines.push("Reason: Based on current priority, duration, and your work window.");
    }
    return lines;
  };

  const levelColor: Record<string, string> = {
    High: "text-success",
    Medium: "text-warning",
    Low: "text-muted-foreground",
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold">Smart Suggestions</h1>
          <p className="text-muted-foreground mt-1">
            Recommend the best time for a task based on your behavior patterns. Does not create or change your schedule.
          </p>
        </div>
        <Button onClick={getSuggestions} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lightbulb className="mr-2 h-4 w-4" />}
          Refresh Recommendations
        </Button>
      </div>

      {/* Learning status */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground border rounded-lg px-3 py-2 bg-card">
        <span className="inline-flex items-center gap-1.5">
          <Brain className="h-3.5 w-3.5 text-primary" />
          Learning from recent activity
        </span>
        <span className="text-border">|</span>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          Last analyzed: <strong className="text-foreground font-medium">{lastAnalyzedLabel}</strong>
        </span>
        {workPattern.sampleCount > 0 && (
          <>
            <span className="text-border">|</span>
            <span>{workPattern.sampleCount} sessions in last 14 days</span>
          </>
        )}
      </div>

      {devMode && payload && (
        <DevPanel
          title="Smart-picks scoring — urgency · quick-win · flow · cognitive fit"
          subtitle={`${payload.algorithm || "ahp-smart-picks"} · ${payload.timestamp ? new Date(payload.timestamp).toLocaleString() : "—"}`}
          raw={payload}
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <DevStat label="Peak source" value={payload.peak_source || "—"} />
            <DevStat label="Peak window" value={payload.peak_window || "—"} />
            <DevStat label="Break style" value={payload.break_style || "—"} />
            <DevStat label="Picks" value={suggestions.length} />
            {w && (
              <>
                <DevStat label="w urgency" value={w.urgency.toFixed(3)} />
                <DevStat label="w quick-win" value={w.quickWin.toFixed(3)} />
                <DevStat label="w flow" value={w.flow.toFixed(3)} />
                <DevStat label="w cognitive" value={w.cognitive.toFixed(3)} />
              </>
            )}
          </div>
        </DevPanel>
      )}

      {/* Recommended time slots */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Recommended Time slots
        </h2>

        {loading && suggestions.length === 0 ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : suggestions.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground text-sm">
              <Lightbulb className="mx-auto h-8 w-8 mb-2 opacity-30" />
              No recommendations yet. Click &quot;Refresh Recommendations&quot; to analyze your tasks and activity.
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs">Task</TableHead>
                  <TableHead className="text-xs whitespace-nowrap">Recommended Time</TableHead>
                  <TableHead className="text-xs w-24">Duration</TableHead>
                  <TableHead className="text-xs w-24">Confidence</TableHead>
                  <TableHead className="text-xs hidden md:table-cell">Reason</TableHead>
                  <TableHead className="text-xs w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {suggestions.map((s) => {
                  const conf = confidenceFromScore(s.score);
                  const dur = s.estimated_duration ?? taskDurationMap[s.id];
                  const open = expandedId === s.id;
                  return (
                    <Fragment key={s.id}>
                      <TableRow
                        className="text-sm cursor-pointer hover:bg-accent/40"
                        onClick={() => setExpandedId(open ? null : s.id)}
                      >
                        <TableCell className="font-medium py-2.5 max-w-[180px] truncate">
                          {s.title}
                        </TableCell>
                        <TableCell className="py-2.5 font-mono text-xs whitespace-nowrap">
                          {to12hRange(s.suggested_time)}
                        </TableCell>
                        <TableCell className="py-2.5 text-xs text-muted-foreground">
                          {dur ? `${dur} min` : "—"}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <Badge variant="outline" className={`text-[10px] ${conf.className}`}>
                            {conf.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2.5 text-xs text-muted-foreground max-w-[240px] truncate hidden md:table-cell">
                          {s.reason || "—"}
                        </TableCell>
                        <TableCell className="py-2.5">
                          {open ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow className="bg-muted/20">
                          <TableCell colSpan={6} className="py-3 px-4">
                            <div className="text-xs space-y-1 max-h-40 overflow-y-auto text-muted-foreground">
                              <p className="font-semibold text-foreground text-[11px] uppercase tracking-wide mb-1">
                                Why this time?
                              </p>
                              {explanationFor(s).map((line, idx) => (
                                <p key={idx}>{line}</p>
                              ))}
                              {devMode && s.breakdown && (
                                <div className="pt-2 space-y-1">
                                  <DevBar label="Urgency" value={s.breakdown.urgency} weight={w?.urgency} />
                                  <DevBar label="Quick win" value={s.breakdown.quick_win} weight={w?.quickWin} />
                                  <DevBar label="Flow" value={s.breakdown.flow} weight={w?.flow} />
                                  <DevBar label="Cognitive fit" value={s.breakdown.cognitive_fit} weight={w?.cognitive} />
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Your Work Pattern */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          Your Work Pattern
        </h2>
        {loadingPatterns ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !workPattern.hasData ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              Not enough activity yet. Complete tasks with time tracking to build your pattern.
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableBody>
                <TableRow className="text-sm">
                  <TableCell className="py-2 text-muted-foreground w-48">Most productive time</TableCell>
                  <TableCell className="py-2 font-medium">{workPattern.peakHourLabel || "—"}</TableCell>
                </TableRow>
                <TableRow className="text-sm">
                  <TableCell className="py-2 text-muted-foreground">Most productive day</TableCell>
                  <TableCell className="py-2 font-medium">{workPattern.peakDayLabel || "—"}</TableCell>
                </TableRow>
                <TableRow className="text-sm">
                  <TableCell className="py-2 text-muted-foreground">Average session duration</TableCell>
                  <TableCell className="py-2 font-medium">
                    {workPattern.avgSession != null ? `${workPattern.avgSession} min` : "—"}
                  </TableCell>
                </TableRow>
                <TableRow className="text-sm">
                  <TableCell className="py-2 text-muted-foreground">Data window</TableCell>
                  <TableCell className="py-2 font-medium">Last 14 days</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Recent Pattern */}
      {workPattern.hasData && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Recent Pattern
          </h2>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs">Period</TableHead>
                  <TableHead className="text-xs">Productivity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(["Morning", "Afternoon", "Evening"] as const).map((period) => (
                  <TableRow key={period} className="text-sm">
                    <TableCell className="py-2 font-medium">{period}</TableCell>
                    <TableCell className={`py-2 font-medium ${levelColor[workPattern.periodLevels[period]]}`}>
                      {workPattern.periodLevels[period]}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {/* AI Adaptation */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          AI Adaptation
        </h2>
        {adaptations.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              {payload
                ? "No recommendation changes since the last refresh."
                : "Run recommendations twice over time to see how suggestions adapt."}
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs">Task</TableHead>
                  <TableHead className="text-xs">Previous</TableHead>
                  <TableHead className="text-xs">Current</TableHead>
                  <TableHead className="text-xs hidden sm:table-cell">Why it changed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adaptations.map((a) => (
                  <TableRow key={a.id} className="text-sm align-top">
                    <TableCell className="py-2 font-medium max-w-[140px] truncate">{a.title}</TableCell>
                    <TableCell className="py-2 font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {a.previous}
                    </TableCell>
                    <TableCell className="py-2 font-mono text-xs whitespace-nowrap">{a.current}</TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground hidden sm:table-cell max-w-[240px]">
                      {a.reason}
                      <span className="block mt-0.5 text-[10px] text-muted-foreground/80">
                        Based on: Last 14 days
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </motion.div>
  );
}
