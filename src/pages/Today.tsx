import { useState, useEffect, useMemo, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Loader2, Zap, ChevronDown, ChevronUp } from "lucide-react";
import { loadCache, saveCache } from "@/lib/persist-cache";
import { DevPanel, DevStat, DevBar } from "@/components/DevPanel";
import { useDevMode } from "@/hooks/use-dev-mode";
import { priorityFromScore, PRIORITY_STYLES, statusLabel } from "@/lib/status";
import { format, isToday, isTomorrow, isPast, differenceInCalendarDays } from "date-fns";

const CACHE_KEY = "gsi-cache:today-picks";
const PREV_CACHE_KEY = "gsi-cache:today-picks-prev";

type Breakdown = { urgency: number; quick_win: number; flow: number; cognitive_fit: number };
type SmartPick = {
  id: string;
  title: string;
  reason: string;
  priority: string;
  score?: number;
  breakdown?: Breakdown;
};

type Payload = {
  picks: SmartPick[];
  weights?: { urgency: number; quickWin: number; flow: number; cognitive: number };
  peak_window?: string;
  peak_source?: string;
  algorithm?: string;
  timestamp?: string;
};

type TaskRow = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  start_time: string | null;
  estimated_duration: number | null;
  priority_score: number | null;
  category: string | null;
};

function dueLabel(due: string | null): string {
  if (!due) return "—";
  try {
    const d = new Date(due);
    if (isToday(d)) return "Today";
    if (isTomorrow(d)) return "Tomorrow";
    if (isPast(d)) return `Overdue (${format(d, "MMM d")})`;
    const days = differenceInCalendarDays(d, new Date());
    if (days <= 7) return format(d, "EEE, MMM d");
    return format(d, "MMM d, yyyy");
  } catch {
    return "—";
  }
}

function aiLabel(rank: number, score?: number): string {
  if (rank === 1) return "Do First";
  if (rank === 2) return "Do Next";
  if (score !== undefined && score >= 70) return "Do Next";
  return "Do Later";
}

function aiLabelClass(label: string): string {
  if (label === "Do First") return "bg-destructive/15 text-destructive border-destructive/30";
  if (label === "Do Next") return "bg-warning/15 text-warning border-warning/30";
  return "bg-muted text-muted-foreground border-border";
}

export default function Today() {
  const [payload, setPayload] = useState<Payload | null>(() => loadCache<Payload>(CACHE_KEY));
  const [prevPayload, setPrevPayload] = useState<Payload | null>(() => loadCache<Payload>(PREV_CACHE_KEY));
  const [taskMap, setTaskMap] = useState<Record<string, TaskRow>>({});
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [recentActivityIds, setRecentActivityIds] = useState<Set<string>>(new Set());
  const { devMode } = useDevMode();

  const picks = payload?.picks || [];
  const w = payload?.weights;

  useEffect(() => {
    const load = async () => {
      const since = new Date();
      since.setDate(since.getDate() - 7);

      const [{ data: tasks }, { data: entries }] = await Promise.all([
        supabase
          .from("tasks")
          .select("id, title, status, due_date, start_time, estimated_duration, priority_score, category")
          .eq("archived", false)
          .neq("status", "done"),
        supabase
          .from("time_entries")
          .select("task_id")
          .gte("start_time", since.toISOString()),
      ]);

      const map: Record<string, TaskRow> = {};
      (tasks || []).forEach((t: any) => {
        map[t.id] = t as TaskRow;
      });
      setTaskMap(map);

      const ids = new Set<string>();
      (entries || []).forEach((e: any) => {
        if (e.task_id) ids.add(e.task_id);
      });
      setRecentActivityIds(ids);
    };
    load();
  }, [payload?.timestamp]);

  const rankedRows = useMemo(() => {
    return picks.map((p, i) => {
      const t = taskMap[p.id];
      const rank = i + 1;
      const label = aiLabel(rank, p.score);
      const pr =
        t ? priorityFromScore(t.priority_score) : ((p.priority as "high" | "medium" | "low") || "medium");
      return { pick: p, task: t, rank, label, priorityKey: pr };
    });
  }, [picks, taskMap]);

  const whyFor = (row: (typeof rankedRows)[0]): string[] => {
    const lines: string[] = [];
    const t = row.task;
    const p = row.pick;

    if (p.reason) lines.push(p.reason);

    if (t) {
      const pr = priorityFromScore(t.priority_score);
      if (pr === "high") lines.push("High priority.");
      if (t.due_date) {
        const d = new Date(t.due_date);
        if (isToday(d)) lines.push("Due today.");
        else if (isPast(d)) lines.push("Deadline has passed (overdue).");
        else if (isTomorrow(d)) lines.push("Due tomorrow.");
        else {
          const days = differenceInCalendarDays(d, new Date());
          if (days <= 3) lines.push(`Deadline in ${days} day${days === 1 ? "" : "s"}.`);
        }
      }
      if (t.estimated_duration) {
        lines.push(`Estimated duration about ${t.estimated_duration} minutes.`);
      }
      if (t.status === "todo") lines.push("Task has not been started yet.");
      if (t.status === "in_progress") lines.push("Already in progress — good to continue.");
      if (!t.start_time) lines.push("Not yet placed on the schedule.");
      if (t.start_time) lines.push("Already has a scheduled start time.");
    }

    if (recentActivityIds.has(row.pick.id)) {
      lines.push("Recent activity recorded on this task (last 7 days).");
    }

    const seen = new Set<string>();
    return lines.filter((l) => {
      const key = l.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const changes = useMemo(() => {
    if (!prevPayload?.picks?.length || !payload?.picks?.length) return [];
    const prevRank = new Map(prevPayload.picks.map((p, i) => [p.id, i + 1]));
    const items: {
      id: string;
      title: string;
      previous: number;
      current: number;
      change: string;
      reason: string;
    }[] = [];

    payload.picks.forEach((p, i) => {
      const cur = i + 1;
      const prev = prevRank.get(p.id);
      if (prev === undefined || prev === cur) return;
      const movedUp = cur < prev;
      const t = taskMap[p.id];
      let reason = p.reason || "Ranking updated from latest task data.";
      if (t?.due_date) {
        const d = new Date(t.due_date);
        if (isToday(d) || isPast(d)) {
          reason = movedUp
            ? "Changed relative to previous recommendation and the task has higher urgency."
            : "Another task now has a closer deadline.";
        }
      }
      if (t && priorityFromScore(t.priority_score) === "high" && movedUp) {
        reason = "Changed relative to previous recommendation and the task has High priority.";
      }
      items.push({
        id: p.id,
        title: p.title,
        previous: prev,
        current: cur,
        change: movedUp ? "Moved up" : "Moved down",
        reason,
      });
    });
    return items;
  }, [payload, prevPayload, taskMap]);

  const getSmartPicks = async () => {
    setLoading(true);
    try {
      if (payload) {
        saveCache(PREV_CACHE_KEY, payload);
        setPrevPayload(payload);
      }
      const { data, error } = await supabase.functions.invoke("smart-picks", { body: {} });
      if (error) throw error;
      const next: Payload = { ...(data || {}), picks: data?.picks || [] };
      setPayload(next);
      saveCache(CACHE_KEY, next);
      toast.success("Today's recommendations updated.");
    } catch (err: any) {
      toast.error(err.message || "Failed to get recommendations");
    }
    setLoading(false);
  };

  const decisionFactors = useMemo(() => {
    // Only show factors the backend actually used
    const used: string[] = (payload as any)?.factors_used || (payload as any)?.weights
      ? Object.keys((payload as any)?.weights || {}).filter((k) => (payload as any).weights[k] != null)
      : [];
    const labelMap: Record<string, string> = {
      urgency: "Deadline",
      deadline: "Deadline",
      quick_win: "Duration",
      quickWin: "Duration",
      duration: "Duration",
      flow: "Status",
      cognitive: "Cognitive fit",
      cognitive_fit: "Cognitive fit",
      behavior: "Behavior pattern",
      behavior_peak: "Behavior pattern",
      priority: "Priority",
    };
    if (used.length === 0) {
      return [
        { key: "Priority", active: rankedRows.some((r) => r.pick.priority) },
        { key: "Deadline", active: rankedRows.some((r) => !!r.task?.due_date) },
        { key: "Duration", active: rankedRows.some((r) => r.task?.estimated_duration != null) },
      ];
    }
    return used.map((u) => ({
      key: labelMap[u] || u,
      active: true,
    }));
  }, [rankedRows, payload]);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold">Today AI Recommendation</h1>
          <p className="text-muted-foreground mt-1">What should you work on today?</p>
        </div>
        <Button onClick={getSmartPicks} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
          Refresh Recommendations
        </Button>
      </div>

      {devMode && payload && (
        <DevPanel
          title="Today ranking — urgency · quick-win · flow · cognitive fit"
          subtitle={`${payload.algorithm || "ahp-smart-picks"} · ${payload.timestamp ? new Date(payload.timestamp).toLocaleString() : "—"}`}
          raw={payload}
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <DevStat label="Peak window" value={payload.peak_window || "—"} />
            <DevStat label="Peak source" value={payload.peak_source || "—"} />
            <DevStat label="Picks" value={picks.length} />
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

      {/* 1. Today's AI Recommendations */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Today&apos;s AI Recommendations
        </h2>

        {loading && rankedRows.length === 0 ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rankedRows.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground text-sm">
              <Zap className="mx-auto h-8 w-8 mb-2 opacity-30" />
              No recommendations yet. Click &quot;Refresh Recommendations&quot; to rank what to focus on today.
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs w-12">Rank</TableHead>
                  <TableHead className="text-xs">Task</TableHead>
                  <TableHead className="text-xs w-24">Priority</TableHead>
                  <TableHead className="text-xs whitespace-nowrap">Due</TableHead>
                  <TableHead className="text-xs w-24">Duration</TableHead>
                  <TableHead className="text-xs whitespace-nowrap">AI Recommendation</TableHead>
                  <TableHead className="text-xs w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rankedRows.map((row) => {
                  const open = expandedId === row.pick.id;
                  const style = PRIORITY_STYLES[row.priorityKey] || PRIORITY_STYLES.medium;
                  const reasons = whyFor(row);
                  return (
                    <Fragment key={row.pick.id}>
                      <TableRow
                        className="text-sm cursor-pointer hover:bg-accent/40"
                        onClick={() => setExpandedId(open ? null : row.pick.id)}
                      >
                        <TableCell className="py-2.5 font-display font-bold text-muted-foreground">
                          {row.rank}
                        </TableCell>
                        <TableCell className="py-2.5 font-medium max-w-[180px] truncate">
                          {row.pick.title}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <Badge variant="outline" className={`text-[10px] ${style.className}`}>
                            {style.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {dueLabel(row.task?.due_date ?? null)}
                        </TableCell>
                        <TableCell className="py-2.5 text-xs text-muted-foreground">
                          {row.task?.estimated_duration != null
                            ? `${row.task.estimated_duration} min`
                            : "—"}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <Badge variant="outline" className={`text-[10px] ${aiLabelClass(row.label)}`}>
                            {row.label}
                          </Badge>
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
                          <TableCell colSpan={7} className="py-3 px-4">
                            <div className="text-xs space-y-1 max-h-40 overflow-y-auto text-muted-foreground">
                              <p className="font-semibold text-foreground text-[11px] uppercase tracking-wide mb-1">
                                Why is this recommended today?
                              </p>
                              {reasons.length === 0 ? (
                                <p>Not enough task data to explain this ranking.</p>
                              ) : (
                                reasons.map((line, idx) => <p key={idx}>{line}</p>)
                              )}
                              {row.task && (
                                <p className="pt-1 text-[11px]">
                                  Status: {statusLabel(row.task.status)}
                                  {devMode && row.pick.score !== undefined && (
                                    <> · Score: {row.pick.score.toFixed(1)}</>
                                  )}
                                </p>
                              )}
                              {devMode && row.pick.breakdown && (
                                <div className="pt-2 space-y-1">
                                  <DevBar label="Urgency" value={row.pick.breakdown.urgency} weight={w?.urgency} />
                                  <DevBar label="Quick win" value={row.pick.breakdown.quick_win} weight={w?.quickWin} />
                                  <DevBar label="Flow" value={row.pick.breakdown.flow} weight={w?.flow} />
                                  <DevBar label="Cognitive fit" value={row.pick.breakdown.cognitive_fit} weight={w?.cognitive} />
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

      {/* AI Decision Factors */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          AI Decision Factors
        </h2>
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="text-xs">Factor</TableHead>
                <TableHead className="text-xs">Used in ranking</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {decisionFactors.map((f) => (
                <TableRow key={f.key} className="text-sm">
                  <TableCell className="py-2 font-medium">{f.key}</TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground">
                    {f.active ? "Yes — from your task data" : "No data available yet"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          This page only recommends what to focus on today. It does not create or change your schedule.
        </p>
      </section>

      {/* Recommendation Changes */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Recommendation Changes
        </h2>
        {changes.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              No recommendation changes yet.
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
                  <TableHead className="text-xs">Change</TableHead>
                  <TableHead className="text-xs hidden sm:table-cell">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changes.map((c) => (
                  <TableRow key={c.id} className="text-sm align-top">
                    <TableCell className="py-2 font-medium max-w-[160px] truncate">{c.title}</TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">#{c.previous}</TableCell>
                    <TableCell className="py-2 text-xs font-medium">#{c.current}</TableCell>
                    <TableCell className="py-2 text-xs">{c.change}</TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground hidden sm:table-cell max-w-[240px]">
                      {c.reason}
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
