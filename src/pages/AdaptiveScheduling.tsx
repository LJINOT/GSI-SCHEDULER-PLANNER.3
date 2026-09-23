import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { loadCache, saveCache } from "@/lib/persist-cache";
import { ScheduleDevPanel } from "@/pages/Schedule";
import { useDevMode } from "@/hooks/use-dev-mode";
import { priorityFromScore, PRIORITY_STYLES, statusLabel } from "@/lib/status";
import { isPast, isToday } from "date-fns";

const CACHE_KEY = "gsi-cache:adaptive-schedule";
const AUTO_CACHE_KEY = "gsi-cache:schedule-blocks";

function to12h(hhmm: string): string {
  if (!hhmm || !hhmm.includes(":")) return hhmm;
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hr = ((h + 11) % 12) + 1;
  return `${hr}:${String(m).padStart(2, "0")} ${period}`;
}

type TaskRow = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  start_time: string | null;
  estimated_duration: number | null;
  priority_score: number | null;
  category: string | null;
  updated_at?: string;
};

type ScheduleBlock = {
  task_id: string;
  title: string;
  start: string;
  end: string;
  category: string;
  kind?: string;
};


/** Sort schedule blocks by real clock minutes (not AM/PM string sort). */
function startMinutes(hhmm: string | undefined | null): number {
  if (!hhmm || !String(hhmm).includes(":")) return Number.MAX_SAFE_INTEGER;
  const [h, m] = String(hhmm).split(":").map(Number);
  if (!Number.isFinite(h)) return Number.MAX_SAFE_INTEGER;
  return h * 60 + (Number.isFinite(m) ? m : 0);
}

function sortBlocksChronologically(blocks: ScheduleBlock[]): ScheduleBlock[] {
  return [...blocks].sort((a, b) => {
    const sa = startMinutes(a.start);
    const sb = startMinutes(b.start);
    if (sa !== sb) return sa - sb;
    const ea = startMinutes(a.end);
    const eb = startMinutes(b.end);
    if (ea !== eb) return ea - eb;
    return String(a.task_id).localeCompare(String(b.task_id));
  });
}

type Payload = {
  blocks: ScheduleBlock[];
  deferred?: { task_id: string; title: string }[];
  pso?: { fitness: number; iterations: number; swarm_size: number };
  window?: { start: string; end: string; peak_start: string; peak_end: string; break_style: string };
  algorithm?: string;
  timestamp?: string;
  note?: string;
};

type ChangeItem = {
  id: string;
  reason: string;
  title: string;
};

export default function AdaptiveScheduling() {
  const [payload, setPayload] = useState<Payload | null>(() => {
    return loadCache<Payload>(CACHE_KEY) || loadCache<Payload>(AUTO_CACHE_KEY);
  });
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [justAdapted, setJustAdapted] = useState(false);
  const { devMode } = useDevMode();

  const blocks = useMemo(() => sortBlocksChronologically(payload?.blocks || []), [payload?.blocks]);

  const fetchTasks = async () => {
    setLoadingTasks(true);
    const { data } = await supabase
      .from("tasks")
      .select("id, title, status, due_date, start_time, estimated_duration, priority_score, category, updated_at")
      .eq("archived", false)
      .order("updated_at", { ascending: false });
    setTasks((data as TaskRow[]) || []);
    setLoadingTasks(false);
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const changes = useMemo<ChangeItem[]>(() => {
    const items: ChangeItem[] = [];
    const scheduledIds = new Set(
      blocks.filter((b) => b.kind !== "break").map((b) => b.task_id)
    );

    for (const t of tasks) {
      if (t.status !== "done" && t.due_date) {
        const due = new Date(t.due_date);
        if (isPast(due) && !isToday(due)) {
          items.push({
            id: t.id,
            title: t.title,
            reason: "Overdue — deadline has passed",
          });
          continue;
        }
      }

      if (t.status === "done" && scheduledIds.has(t.id)) {
        items.push({
          id: t.id,
          title: t.title,
          reason: "Completed — can be removed from schedule",
        });
        continue;
      }

      if (!t.start_time && t.status !== "done" && !scheduledIds.has(t.id)) {
        items.push({
          id: t.id,
          title: t.title,
          reason: "New unscheduled task affecting the plan",
        });
        continue;
      }

      if (t.status !== "done" && t.due_date && isToday(new Date(t.due_date))) {
        items.push({
          id: t.id,
          title: t.title,
          reason: "Deadline is today",
        });
      }
    }

    const seen = new Set<string>();
    return items.filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }, [tasks, blocks]);

  const hasChanges = changes.length > 0;

  const adaptSchedule = async () => {
    if (!hasChanges && blocks.length > 0) {
      toast.message("Your schedule is up to date.");
      return;
    }
    setGenerating(true);
    setJustAdapted(false);
    try {
      const { data, error } = await supabase.functions.invoke("generate-schedule", {
        body: { adaptive: true },
      });
      if (error) throw error;
      const body = typeof data === "string" ? JSON.parse(data) : (data || {});
      const rawBlocks = Array.isArray(body.blocks) ? body.blocks : [];
      const next: Payload = {
        ...body,
        blocks: sortBlocksChronologically(rawBlocks),
      };
      setPayload(next);
      saveCache(CACHE_KEY, next);
      setJustAdapted(true);
      if (next.blocks.length === 0) {
        toast.message(body.note || "No schedule blocks returned.");
      } else {
        toast.success("Schedule adapted successfully.");
      }
      fetchTasks();
    } catch (err: any) {
      toast.error(err.message || "Failed to adapt schedule");
    }
    setGenerating(false);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold">Adaptive Scheduling</h1>
          <p className="text-muted-foreground mt-1">
            Adjust your existing schedule when tasks or deadlines change.
          </p>
        </div>
        <Button onClick={adaptSchedule} disabled={generating}>
          {generating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Adapt Schedule
        </Button>
      </div>

      {devMode && payload && (
        <ScheduleDevPanel
          payload={payload}
          title="Adaptive engine — how priorities were re-ordered this run"
        />
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Current Schedule
        </h2>

        {loadingTasks && blocks.length === 0 ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : blocks.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground text-sm">
              No existing schedule found. Create one first from Auto Schedule.
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <div className="max-h-[500px] overflow-y-auto overflow-x-auto overscroll-contain">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs w-28">Date</TableHead>
                  <TableHead className="text-xs w-36">Time</TableHead>
                  <TableHead className="text-xs">Task</TableHead>
                  <TableHead className="text-xs w-24">Priority</TableHead>
                  <TableHead className="text-xs w-28">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blocks.map((b, i) => {
                  const task = tasks.find((t) => t.id === b.task_id);
                  const pr = task ? priorityFromScore(task.priority_score) : null;
                  const style = pr ? PRIORITY_STYLES[pr] : null;
                  const isBreak = b.kind === "break";
                  return (
                    <TableRow key={`${b.task_id}-${i}`} className="text-sm">
                      <TableCell className="py-2 text-xs text-muted-foreground">Today</TableCell>
                      <TableCell className="py-2 font-mono text-xs">
                        {to12h(b.start)} – {to12h(b.end)}
                      </TableCell>
                      <TableCell className="py-2 font-medium max-w-[220px] truncate">
                        {b.title}
                        {isBreak && (
                          <span className="ml-2 text-[10px] text-muted-foreground">(break)</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2">
                        {style ? (
                          <Badge variant="outline" className={`text-[10px] ${style.className}`}>
                            {style.label}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2 text-xs capitalize">
                        {isBreak ? "—" : task ? statusLabel(task.status) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              </Table>
            </div>
          </div>
        )}
      </section>

      {hasChanges ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            Changes Detected
          </h2>
          <div className="rounded-lg border overflow-hidden">
            <div className="max-h-[360px] overflow-y-auto overflow-x-auto overscroll-contain">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs">Task</TableHead>
                  <TableHead className="text-xs">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changes.map((c) => (
                  <TableRow key={c.id} className="text-sm">
                    <TableCell className="py-2 font-medium max-w-[220px] truncate">
                      {c.title}
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">
                      {c.reason}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              </Table>
            </div>
          </div>
        </section>
      ) : (
        blocks.length > 0 && (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" />
              Your schedule is up to date.
            </CardContent>
          </Card>
        )
      )}

      {justAdapted && (
        <div className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" />
          Schedule adapted successfully.
        </div>
      )}

      {justAdapted && blocks.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Updated Schedule
          </h2>
          <div className="rounded-lg border overflow-hidden">
            <div className="max-h-[500px] overflow-y-auto overflow-x-auto overscroll-contain">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs w-28">Date</TableHead>
                  <TableHead className="text-xs w-36">Time</TableHead>
                  <TableHead className="text-xs">Task</TableHead>
                  <TableHead className="text-xs w-24">Priority</TableHead>
                  <TableHead className="text-xs w-28">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blocks.map((b, i) => {
                  const task = tasks.find((t) => t.id === b.task_id);
                  const pr = task ? priorityFromScore(task.priority_score) : null;
                  const style = pr ? PRIORITY_STYLES[pr] : null;
                  const isBreak = b.kind === "break";
                  return (
                    <TableRow key={`updated-${b.task_id}-${i}`} className="text-sm">
                      <TableCell className="py-2 text-xs text-muted-foreground">Today</TableCell>
                      <TableCell className="py-2 font-mono text-xs">
                        {to12h(b.start)} – {to12h(b.end)}
                      </TableCell>
                      <TableCell className="py-2 font-medium max-w-[220px] truncate">
                        {b.title}
                      </TableCell>
                      <TableCell className="py-2">
                        {style ? (
                          <Badge variant="outline" className={`text-[10px] ${style.className}`}>
                            {style.label}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2 text-xs capitalize">
                        {isBreak ? "—" : task ? statusLabel(task.status) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              </Table>
            </div>
          </div>
        </section>
      )}
    </motion.div>
  );
}
