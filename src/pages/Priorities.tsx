import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Loader2, Target, Folder, User } from "lucide-react";
import { loadCache, saveCache } from "@/lib/persist-cache";
import { DevPanel, DevStat, DevBar } from "@/components/DevPanel";
import { useDevMode } from "@/hooks/use-dev-mode";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { format } from "date-fns";

const CACHE_KEY = "gsi-cache:priorities-ranked";

type Criteria = { deadline: number; difficulty: number; duration: number; category: number };
type RankedTask = { id: string; title: string; score: number; priority: string; reasoning: string; criteria?: Criteria };
type Ahp = {
  weights: { deadline: number; difficulty: number; duration: number; category: number };
  lambda_max: number;
  consistency_index: number;
  consistency_ratio: number;
  consistent: boolean;
};
type Payload = { tasks: RankedTask[]; ahp?: Ahp; algorithm?: string; timestamp?: string };
type TaskMeta = {
  id: string;
  project_id: string | null;
  project_name: string | null;
  due_date: string | null;
  estimated_duration: number | null;
};

const PRIORITY_FILTERS = [
  { value: "all", label: "All" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export default function Priorities() {
  const [payload, setPayload] = useState<Payload | null>(() => loadCache<Payload>(CACHE_KEY));
  const [loading, setLoading] = useState(false);
  const [taskMeta, setTaskMeta] = useState<Record<string, TaskMeta>>({});
  const [priorityFilter, setPriorityFilter] = useState("all");
  const { devMode } = useDevMode();

  const ranked = payload?.tasks || [];
  const weights = payload?.ahp?.weights;

  useEffect(() => {
    const loadTaskMeta = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setTaskMeta({});
        return;
      }

      const { data } = await supabase
        .from("tasks")
        .select("id, project_id, due_date, estimated_duration, projects(name)")
        .eq("user_id", user.id)
        .eq("archived", false);

      const map: Record<string, TaskMeta> = {};
      (data || []).forEach((t: any) => {
          map[t.id] = {
            id: t.id,
            project_id: t.project_id,
            project_name: t.projects?.name || null,
            due_date: t.due_date || null,
            estimated_duration: t.estimated_duration ?? null,
          };
        });
        setTaskMeta(map);
    };

    void loadTaskMeta();
  }, [payload]);

  // Auto-rank when page opens with no ranked list (new users / empty cache)
  useEffect(() => {
    if (!payload || !payload.tasks || payload.tasks.length === 0) {
      void rankPriorities();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rankPriorities = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("rank-priorities", { body: {} });
      if (error) throw error;
      const next: Payload = { tasks: data?.tasks || [], ahp: data?.ahp, algorithm: data?.algorithm, timestamp: data?.timestamp };
      setPayload(next);
      saveCache(CACHE_KEY, next);
      toast.success("Priorities ranked with AHP!");
    } catch (err: any) {
      toast.error(err.message || "Failed to rank priorities");
    }
    setLoading(false);
  };

  const priorityColors: Record<string, string> = {
    high: "bg-destructive/10 text-destructive",
    medium: "bg-warning/10 text-warning",
    low: "bg-success/10 text-success",
  };

  const filtered = useMemo(() => {
    if (priorityFilter === "all") return ranked;
    return ranked.filter((t) => t.priority === priorityFilter);
  }, [ranked, priorityFilter]);

  const formatDeadline = (due: string | null | undefined) => {
    if (!due) return "—";
    try {
      return format(new Date(due), "MMM d, yyyy");
    } catch {
      return "—";
    }
  };

  const formatDuration = (mins: number | null | undefined) => {
    if (mins == null) return "—";
    return `${mins}m`;
  };

  const renderTaskCard = (t: RankedTask, i: number, list: RankedTask[]) => {
    const next = list[i + 1];
    const meta = taskMeta[t.id];
    return (
      <Card key={t.id} className="hover:shadow-md transition-shadow">
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center gap-4">
            <span className="text-2xl font-display font-bold text-muted-foreground w-8">#{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium">{t.title}</p>
                <Badge variant="outline" className="text-[10px] gap-1">
                  {meta?.project_id ? <Folder className="h-3 w-3" /> : <User className="h-3 w-3" />}
                  {meta?.project_id ? `Project Task${meta.project_name ? ` · ${meta.project_name}` : ""}` : "Stand-alone Task"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{t.reasoning}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Deadline: {formatDeadline(meta?.due_date)} · Duration: {formatDuration(meta?.estimated_duration)}
              </p>
            </div>
            {devMode && (
              <span className="font-mono text-sm font-semibold text-primary shrink-0">{t.score.toFixed(1)}</span>
            )}
            <Badge className={priorityColors[t.priority] || priorityColors.medium}>{t.priority}</Badge>
          </div>

          {devMode && t.criteria && (
            <div className="rounded-md border border-dashed border-primary/40 bg-primary/[0.03] p-3 space-y-2">
              <p className="text-[10px] font-semibold text-primary">
                Rank #{i + 1} · score {t.score.toFixed(1)}
                {next ? ` — ranked above "${next.title}" (${next.score.toFixed(1)}), a gap of ${(t.score - next.score).toFixed(1)} pts` : " — lowest ranked task"}
              </p>
              <DevBar label="C1 deadline proximity" value={t.criteria.deadline} weight={weights?.deadline} />
              <DevBar label="C2 difficulty" value={t.criteria.difficulty} weight={weights?.difficulty} />
              <DevBar label="C3 duration (inverse)" value={t.criteria.duration} weight={weights?.duration} />
              <DevBar label="C4 category importance" value={t.criteria.category} weight={weights?.category} />
              {weights && (
                <p className="text-[10px] font-mono text-muted-foreground">
                  ({t.criteria.deadline.toFixed(2)}×{weights.deadline.toFixed(3)} +{" "}
                  {t.criteria.difficulty.toFixed(2)}×{weights.difficulty.toFixed(3)} +{" "}
                  {t.criteria.duration.toFixed(2)}×{weights.duration.toFixed(3)} +{" "}
                  {t.criteria.category.toFixed(2)}×{weights.category.toFixed(3)}) × 100 = {t.score.toFixed(1)}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground">
                Threshold map: score ≥ 65 → high · ≥ 40 → medium · else low.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Priorities</h1>
        <Button onClick={rankPriorities} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Target className="mr-2 h-4 w-4" />}
          Rank with AHP
        </Button>
      </div>

      {payload?.ahp && (
        <DevPanel
          title="AHP ranking engine — how each score is produced"
          subtitle={`${payload.algorithm || "ahp-saaty"} · run at ${payload.timestamp ? new Date(payload.timestamp).toLocaleString() : "—"}`}
          raw={payload}
        >
          <p className="text-[11px] text-muted-foreground">
            score = (deadline×w₁ + difficulty×w₂ + duration×w₃ + category×w₄) × 100. Weights come from the principal
            eigenvector of the Saaty pairwise matrix; the consistency ratio validates the judgements (must be &lt; 0.10).
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <DevStat label="w₁ deadline" value={payload.ahp.weights.deadline.toFixed(4)} />
            <DevStat label="w₂ difficulty" value={payload.ahp.weights.difficulty.toFixed(4)} />
            <DevStat label="w₃ duration" value={payload.ahp.weights.duration.toFixed(4)} />
            <DevStat label="w₄ category" value={payload.ahp.weights.category.toFixed(4)} />
            <DevStat label="λ max" value={payload.ahp.lambda_max.toFixed(4)} />
            <DevStat label="CI" value={payload.ahp.consistency_index.toFixed(4)} />
            <DevStat label="CR" value={payload.ahp.consistency_ratio.toFixed(4)} />
            <DevStat label="Consistent" value={payload.ahp.consistent ? "yes (CR < 0.10)" : "no"} />
          </div>
        </DevPanel>
      )}

      {ranked.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Target className="mx-auto h-12 w-12 mb-4 opacity-30" />
            <p>Click "Rank with AHP" to get AI-powered priority rankings</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Filter by priority:</span>
            <ToggleGroup type="single" value={priorityFilter} onValueChange={(v) => v && setPriorityFilter(v)}>
              {PRIORITY_FILTERS.map((f) => (
                <ToggleGroupItem key={f.value} value={f.value} className="text-xs px-3">
                  {f.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-lg flex items-center gap-2">
                <Target className="h-4 w-4 text-muted-foreground" />
                Ranked Tasks
                <Badge variant="secondary" className="ml-auto">{filtered.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No tasks match this filter</p>
              ) : devMode ? (
                <div className="space-y-2 p-4">{filtered.map((t, i) => renderTaskCard(t, i, filtered))}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase tracking-wide text-muted-foreground border-y bg-muted/40">
                      <tr>
                        <th className="text-left font-medium px-4 py-2 w-12">#</th>
                        <th className="text-left font-medium px-4 py-2">Task</th>
                        <th className="text-left font-medium px-4 py-2 hidden sm:table-cell">Source</th>
                        <th className="text-left font-medium px-4 py-2 whitespace-nowrap">Deadline</th>
                        <th className="text-left font-medium px-4 py-2 whitespace-nowrap">Duration</th>
                        <th className="text-left font-medium px-4 py-2">Why it ranks here</th>
                        <th className="text-left font-medium px-4 py-2">Priority</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((t, i) => {
                        const meta = taskMeta[t.id];
                        return (
                          <tr key={t.id} className="border-b last:border-0 hover:bg-accent/30 align-top">
                            <td className="px-4 py-3 font-display font-bold text-muted-foreground">{i + 1}</td>
                            <td className="px-4 py-3 font-medium max-w-[16rem]">{t.title}</td>
                            <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell whitespace-nowrap">
                              <span className="inline-flex items-center gap-1">
                                {meta?.project_id ? <Folder className="h-3 w-3" /> : <User className="h-3 w-3" />}
                                {meta?.project_id ? meta.project_name || "Project" : "Stand-alone"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                              {formatDeadline(meta?.due_date)}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                              {formatDuration(meta?.estimated_duration)}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground max-w-md">{t.reasoning}</td>
                            <td className="px-4 py-3">
                              <Badge className={priorityColors[t.priority] || priorityColors.medium}>{t.priority}</Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </motion.div>
  );
}
