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
import { Loader2, Wand2, CheckCircle2 } from "lucide-react";
import { loadCache, saveCache } from "@/lib/persist-cache";
import { DevPanel, DevStat } from "@/components/DevPanel";
import { useDevMode } from "@/hooks/use-dev-mode";
import { priorityFromScore, PRIORITY_STYLES, statusLabel } from "@/lib/status";
import { format } from "date-fns";

const CACHE_KEY = "gsi-cache:schedule-blocks";

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
};

type ScheduleBlock = {
  task_id: string;
  title: string;
  start: string;
  end: string;
  category: string;
  kind?: string;
};

type Payload = {
  blocks: ScheduleBlock[];
  deferred?: { task_id: string; title: string }[];
  pso?: { fitness: number; iterations: number; swarm_size: number };
  window?: { start: string; end: string; peak_start: string; peak_end: string; break_style: string };
  algorithm?: string;
  timestamp?: string;
  note?: string;
};

export default function Schedule() {
  const [payload, setPayload] = useState<Payload | null>(() => loadCache<Payload>(CACHE_KEY));
  const [unscheduled, setUnscheduled] = useState<TaskRow[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [justCreated, setJustCreated] = useState(false);
  const { devMode } = useDevMode();

  const blocks = payload?.blocks || [];

  const fetchUnscheduled = async () => {
    setLoadingTasks(true);
    // Match what generate-schedule considers: not done, not archived.
    // Prefer tasks with no start_time; if none, show all active tasks so the button stays usable.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setUnscheduled([]);
      setLoadingTasks(false);
      return;
    }
    const { data } = await supabase
      .from("tasks")
      .select("id, title, status, due_date, start_time, estimated_duration, priority_score, category")
      .eq("user_id", user.id)
      .eq("archived", false)
      .neq("status", "done")
      .order("priority_score", { ascending: false });

    const rows = (data as TaskRow[]) || [];
    const noStart = rows.filter((t) => !t.start_time);
    setUnscheduled(noStart.length > 0 ? noStart : rows);
    setLoadingTasks(false);
  };

  useEffect(() => {
    fetchUnscheduled();
  }, []);

  /** Load today's scheduled tasks from DB into Generated Schedule (source of truth after persist). */
  const loadGeneratedFromDb = async (): Promise<ScheduleBlock[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data } = await supabase
      .from("tasks")
      .select("id, title, start_time, estimated_duration, category, status")
      .eq("user_id", user.id)
      .eq("archived", false)
      .neq("status", "done")
      .not("start_time", "is", null)
      .order("start_time", { ascending: true });

    const rows = data || [];
    const todayStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local
    const blocks: ScheduleBlock[] = [];
    for (const t of rows as any[]) {
      if (!t.start_time) continue;
      const localDay = new Date(t.start_time).toLocaleDateString("en-CA");
      if (localDay !== todayStr) continue;
      const startDate = new Date(t.start_time);
      const dur = Math.max(5, Number(t.estimated_duration) || 30);
      const endDate = new Date(startDate.getTime() + dur * 60_000);
      const fmt = (d: Date) =>
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      blocks.push({
        task_id: t.id,
        title: t.title,
        start: fmt(startDate),
        end: fmt(endDate),
        category: t.category || "General",
        kind: "task",
      });
    }
    return blocks;
  };

  const generateSchedule = async () => {
    if (unscheduled.length === 0) {
      toast.error("No unscheduled tasks available.");
      return;
    }
    setGenerating(true);
    setJustCreated(false);
    try {
      const { data, error } = await supabase.functions.invoke("generate-schedule", { body: {} });
      if (error) throw error;

      // Normalize response (some gateways wrap body)
      const body = typeof data === "string" ? JSON.parse(data) : (data || {});
      if (body.error) throw new Error(body.error);

      let blocks: ScheduleBlock[] = Array.isArray(body.blocks) ? body.blocks : [];

      // If function returned blocks, use them; also merge DB after persist
      if (blocks.length === 0) {
        // Backend may have persisted without returning blocks — reload from DB
        blocks = await loadGeneratedFromDb();
      }

      const next: Payload = {
        ...body,
        blocks,
        algorithm: body.algorithm || "csp-pso",
        timestamp: body.timestamp || new Date().toISOString(),
      };

      setPayload(next);
      saveCache(CACHE_KEY, next);

      if (blocks.length === 0) {
        toast.error(body.note || "No schedule slots could be generated. Check work hours or task durations.");
      } else {
        setJustCreated(true);
        toast.success("Schedule created successfully.");
      }

      // Refresh unscheduled list from DB (tasks that now have start_time drop out)
      await fetchUnscheduled();

      // Second pass: prefer DB as source of truth after persistence settles
      const fromDb = await loadGeneratedFromDb();
      if (fromDb.length > 0) {
        const merged: Payload = { ...next, blocks: fromDb };
        setPayload(merged);
        saveCache(CACHE_KEY, merged);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to generate schedule");
    }
    setGenerating(false);
  };

  // On mount, also hydrate Generated Schedule from DB if cache empty
  useEffect(() => {
    (async () => {
      if ((payload?.blocks?.length || 0) > 0) return;
      const fromDb = await loadGeneratedFromDb();
      if (fromDb.length > 0) {
        const next: Payload = {
          blocks: fromDb,
          algorithm: "loaded-from-tasks",
          timestamp: new Date().toISOString(),
        };
        setPayload(next);
        saveCache(CACHE_KEY, next);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groupedBlocks = useMemo(() => {
    if (blocks.length === 0) return [];
    return [{ dateLabel: "Today", items: blocks }];
  }, [blocks]);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl font-bold">Auto Schedule</h1>
          <p className="text-muted-foreground mt-1">
            Create an optimized schedule from your unscheduled tasks.
          </p>
        </div>
        {/* Button stays clickable unless loading or currently generating */}
        <Button onClick={generateSchedule} disabled={generating || loadingTasks}>
          {generating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Wand2 className="mr-2 h-4 w-4" />
          )}
          Auto Schedule
        </Button>
      </div>

      {devMode && payload && <ScheduleDevPanel payload={payload} />}

      {/* PRIMARY: Generated Schedule first */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Generated Schedule
          </h2>
          {blocks.length > 0 && (
            <span className="text-xs text-muted-foreground">{blocks.length} block{blocks.length !== 1 ? "s" : ""}</span>
          )}
        </div>

        {justCreated && blocks.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" />
            Schedule created successfully.
          </div>
        )}

        {blocks.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground text-sm space-y-1">
              <p className="font-medium text-foreground/80">No schedule generated yet.</p>
              <p>Click &quot;Auto Schedule&quot; to generate a schedule from your unscheduled tasks.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <div className="max-h-[480px] overflow-y-auto overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-xs w-28">Date</TableHead>
                    <TableHead className="text-xs w-36">Time</TableHead>
                    <TableHead className="text-xs">Task</TableHead>
                    <TableHead className="text-xs w-24">Priority</TableHead>
                    <TableHead className="text-xs w-24">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupedBlocks.flatMap((group) =>
                    group.items.map((b, i) => {
                      const isBreak = b.kind === "break";
                      const startM =
                        parseInt(b.start.split(":")[0] || "0", 10) * 60 +
                        parseInt(b.start.split(":")[1] || "0", 10);
                      const endM =
                        parseInt(b.end.split(":")[0] || "0", 10) * 60 +
                        parseInt(b.end.split(":")[1] || "0", 10);
                      const dur = Math.max(0, endM - startM);
                      return (
                        <TableRow key={`${b.task_id}-${i}`} className="text-sm">
                          <TableCell className="py-2 text-xs text-muted-foreground">
                            {group.dateLabel}
                          </TableCell>
                          <TableCell className="py-2 font-mono text-xs">
                            {to12h(b.start)} – {to12h(b.end)}
                          </TableCell>
                          <TableCell className="py-2 font-medium max-w-[220px] truncate">
                            {b.title}
                            {isBreak && (
                              <span className="ml-2 text-[10px] text-muted-foreground">(break)</span>
                            )}
                          </TableCell>
                          <TableCell className="py-2 text-xs text-muted-foreground">—</TableCell>
                          <TableCell className="py-2 text-xs text-muted-foreground">
                            {dur > 0 ? `${dur}m` : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </section>

      {/* SECONDARY: Unscheduled Tasks below — all rows kept, internal scroll */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Unscheduled Tasks
          </h2>
          {!loadingTasks && unscheduled.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {unscheduled.length} task{unscheduled.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {loadingTasks ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : unscheduled.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground text-sm">
              No unscheduled tasks available.
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <div className="max-h-[360px] overflow-y-auto overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-xs">Task</TableHead>
                    <TableHead className="text-xs w-24">Priority</TableHead>
                    <TableHead className="text-xs w-32">Deadline</TableHead>
                    <TableHead className="text-xs w-24">Duration</TableHead>
                    <TableHead className="text-xs w-28">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unscheduled.map((t) => {
                    const pr = priorityFromScore(t.priority_score);
                    const style = PRIORITY_STYLES[pr];
                    return (
                      <TableRow key={t.id} className="text-sm">
                        <TableCell className="font-medium py-2 max-w-[220px] truncate">
                          {t.title}
                        </TableCell>
                        <TableCell className="py-2">
                          <Badge variant="outline" className={`text-[10px] ${style.className}`}>
                            {style.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2 text-muted-foreground text-xs">
                          {t.due_date ? format(new Date(t.due_date), "MMM d, yyyy") : "—"}
                        </TableCell>
                        <TableCell className="py-2 text-muted-foreground text-xs">
                          {t.estimated_duration ? `${t.estimated_duration}m` : "—"}
                        </TableCell>
                        <TableCell className="py-2">
                          <span className="text-xs capitalize">{statusLabel(t.status)}</span>
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
    </motion.div>
  );
}

export function ScheduleDevPanel({ payload, title }: { payload: Payload; title?: string }) {
  return (
    <DevPanel
      title={title || "Auto-scheduler internals — PSO ordering + CSP placement"}
      subtitle={`${payload.algorithm || "csp-pso"} · run at ${payload.timestamp ? new Date(payload.timestamp).toLocaleString() : "—"}`}
      raw={payload}
    >
      <p className="text-[11px] text-muted-foreground">
        Step 1 — candidate filter: only tasks due/starting today (or undated) enter the pool, then the most urgent ones
        are packed until 85% of the work window is used; the rest are deferred. Step 2 — PSO searches task orderings
        (random-key encoding, 25 particles × 60 iterations) minimising a fitness penalty: hard tasks outside your peak
        window +25, easy tasks inside peak +8, later start times ×difficulty, missed deadline +50, category switch +2.
        Step 3 — CSP backtracking lays the winning order onto the clock and injects breaks per your break style.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <DevStat label="Work window" value={payload.window ? `${to12h(payload.window.start)}–${to12h(payload.window.end)}` : "—"} />
        <DevStat label="Peak window" value={payload.window ? `${to12h(payload.window.peak_start)}–${to12h(payload.window.peak_end)}` : "—"} />
        <DevStat label="Break style" value={payload.window?.break_style || "—"} />
        <DevStat label="Best fitness" value={payload.pso ? payload.pso.fitness.toFixed(2) : "—"} />
        <DevStat label="Swarm size" value={payload.pso?.swarm_size ?? "—"} />
        <DevStat label="Iterations" value={payload.pso?.iterations ?? "—"} />
        <DevStat label="Blocks placed" value={payload.blocks.length} />
        <DevStat label="Deferred" value={payload.deferred?.length ?? 0} />
      </div>
      {payload.deferred && payload.deferred.length > 0 && (
        <div className="rounded-md border bg-background p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Deferred — did not fit today's window
          </p>
          <ul className="text-[11px] font-mono space-y-0.5 max-h-40 overflow-auto">
            {payload.deferred.map((d) => (
              <li key={d.task_id} className="truncate">• {d.title}</li>
            ))}
          </ul>
        </div>
      )}
      {payload.note && <p className="text-[11px] text-warning">{payload.note}</p>}
    </DevPanel>
  );
}
