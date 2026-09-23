import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ChevronDown,
  ChevronRight,
  Calculator,
  Brain,
  ListOrdered,
  Clock,
  ArrowRight,
} from "lucide-react";

type SectionProps = {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
};

function DebugSection({
  title,
  children,
  defaultOpen = true,
}: SectionProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left bg-muted/40 hover:bg-muted/60 transition-colors"
      >
        <span className="font-medium">{title}</span>
        {open ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </button>

      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

function ValueRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  );
}

function NumberBox({
  label,
  value,
}: {
  label: string;
  value: number | string | undefined;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-1">
        {value === undefined ? "—" : value}
      </div>
    </div>
  );
}

/* =========================================================
   AHP INSPECTOR
========================================================= */

export type AHPDebug = {
  task?: {
    id?: string;
    title?: string;
    difficulty?: string;
    estimated_duration?: number;
    due_date?: string;
    category?: string;
  };

  criteria?: string[];

  weights?: number[];

  task_scores?: {
    deadline?: number;
    difficulty?: number;
    duration?: number;
    category?: number;
  };

  weighted_components?: {
    deadline?: number;
    difficulty?: number;
    duration?: number;
    category?: number;
  };

  lambda_max?: number;
  ci?: number;
  cr?: number;

  final_score?: number;
  priority?: string;
};

export function AHPInspector({
  debug,
}: {
  debug?: AHPDebug | null;
}) {
  if (!debug) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No AHP calculation is available yet.
        </CardContent>
      </Card>
    );
  }

  const weights = debug.weights || [];

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          Developer Mode — Live AHP Calculation
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">

        <DebugSection title="1. Task Input">
          <ValueRow
            label="Task"
            value={debug.task?.title || "—"}
          />

          <ValueRow
            label="Difficulty"
            value={debug.task?.difficulty || "—"}
          />

          <ValueRow
            label="Duration"
            value={
              debug.task?.estimated_duration !== undefined
                ? `${debug.task.estimated_duration} minutes`
                : "—"
            }
          />

          <ValueRow
            label="Category"
            value={debug.task?.category || "—"}
          />

          <ValueRow
            label="Due Date"
            value={debug.task?.due_date || "—"}
          />
        </DebugSection>

        <DebugSection title="2. AHP Criterion Weights">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <NumberBox
              label="Deadline"
              value={
                weights[0] !== undefined
                  ? `${(weights[0] * 100).toFixed(2)}%`
                  : undefined
              }
            />

            <NumberBox
              label="Difficulty"
              value={
                weights[1] !== undefined
                  ? `${(weights[1] * 100).toFixed(2)}%`
                  : undefined
              }
            />

            <NumberBox
              label="Duration"
              value={
                weights[2] !== undefined
                  ? `${(weights[2] * 100).toFixed(2)}%`
                  : undefined
              }
            />

            <NumberBox
              label="Category"
              value={
                weights[3] !== undefined
                  ? `${(weights[3] * 100).toFixed(2)}%`
                  : undefined
              }
            />
          </div>
        </DebugSection>

        <DebugSection title="3. Task Scores">
          <ValueRow
            label="Deadline Proximity"
            value={debug.task_scores?.deadline?.toFixed(4) ?? "—"}
          />

          <ValueRow
            label="Difficulty"
            value={debug.task_scores?.difficulty?.toFixed(4) ?? "—"}
          />

          <ValueRow
            label="Duration"
            value={debug.task_scores?.duration?.toFixed(4) ?? "—"}
          />

          <ValueRow
            label="Category Importance"
            value={debug.task_scores?.category?.toFixed(4) ?? "—"}
          />
        </DebugSection>

        <DebugSection title="4. Weighted Contributions">
          <ValueRow
            label="Deadline"
            value={debug.weighted_components?.deadline?.toFixed(6) ?? "—"}
          />

          <ValueRow
            label="Difficulty"
            value={debug.weighted_components?.difficulty?.toFixed(6) ?? "—"}
          />

          <ValueRow
            label="Duration"
            value={debug.weighted_components?.duration?.toFixed(6) ?? "—"}
          />

          <ValueRow
            label="Category"
            value={debug.weighted_components?.category?.toFixed(6) ?? "—"}
          />

          <Separator className="my-3" />

          <div className="rounded-lg bg-primary/5 p-4">
            <div className="text-xs text-muted-foreground">
              Final AHP Score
            </div>

            <div className="text-2xl font-bold mt-1">
              {debug.final_score?.toFixed(2) ?? "—"}
            </div>
          </div>
        </DebugSection>

        <DebugSection title="5. Consistency Check">
          <ValueRow
            label="Lambda Max"
            value={debug.lambda_max?.toFixed(6) ?? "—"}
          />

          <ValueRow
            label="Consistency Index"
            value={debug.ci?.toFixed(6) ?? "—"}
          />

          <ValueRow
            label="Consistency Ratio"
            value={debug.cr?.toFixed(6) ?? "—"}
          />

          <ValueRow
            label="Result"
            value={
              debug.cr !== undefined
                ? debug.cr < 0.1
                  ? <Badge>Consistent</Badge>
                  : <Badge variant="destructive">Needs Review</Badge>
                : "—"
            }
          />
        </DebugSection>

        <div className="rounded-lg border-2 border-primary/20 p-4">
          <div className="text-xs text-muted-foreground">
            Final Priority
          </div>

          <div className="flex items-center justify-between mt-2">
            <span className="text-2xl font-bold">
              {debug.final_score?.toFixed(2) ?? "—"}
            </span>

            <Badge>
              {debug.priority || "—"}
            </Badge>
          </div>
        </div>

      </CardContent>
    </Card>
  );
}

/* =========================================================
   PSO + CSP INSPECTOR
========================================================= */

export type ScheduleDebug = {
  input_tasks?: Array<{
    id?: string;
    title?: string;
    estimated_duration?: number;
    priority_score?: number;
    difficulty?: string;
    category?: string;
    due_date?: string;
  }>;

  pso_parameters?: {
    swarm_size?: number;
    iterations?: number;
    w?: number;
    c1?: number;
    c2?: number;
  };

  best_order?: string[];

  best_fitness?: number;

  fitness_breakdown?: Array<{
    task_id?: string;
    title?: string;
    penalty?: number;
    reasons?: string[];
  }>;

  csp_blocks?: Array<{
    task_id?: string;
    title?: string;
    start?: string;
    end?: string;
    duration?: number;
  }>;

  fixed_breaks?: Array<{
    start?: string;
    end?: string;
    title?: string;
  }>;

  work_window?: {
    start?: string;
    end?: string;
  };
};

export function ScheduleInspector({
  debug,
}: {
  debug?: ScheduleDebug | null;
}) {
  if (!debug) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No Auto Schedule calculation is available yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Developer Mode — Live PSO + CSP Calculation
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">

        <DebugSection title="1. Input Tasks">
          <div className="space-y-2">
            {(debug.input_tasks || []).map((task, index) => (
              <div
                key={task.id || index}
                className="border rounded-lg p-3"
              >
                <div className="font-medium">
                  {task.title || "Untitled Task"}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-xs">
                  <span>
                    Duration: {task.estimated_duration ?? "—"} min
                  </span>

                  <span>
                    Priority: {task.priority_score?.toFixed(2) ?? "—"}
                  </span>

                  <span>
                    Difficulty: {task.difficulty || "—"}
                  </span>

                  <span>
                    Category: {task.category || "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </DebugSection>

        <DebugSection title="2. PSO Parameters">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <NumberBox
              label="Swarm"
              value={debug.pso_parameters?.swarm_size}
            />

            <NumberBox
              label="Iterations"
              value={debug.pso_parameters?.iterations}
            />

            <NumberBox
              label="w"
              value={debug.pso_parameters?.w}
            />

            <NumberBox
              label="c1"
              value={debug.pso_parameters?.c1}
            />

            <NumberBox
              label="c2"
              value={debug.pso_parameters?.c2}
            />
          </div>
        </DebugSection>

        <DebugSection title="3. Best PSO Order">
          <div className="space-y-2">
            {(debug.best_order || []).map((title, index) => (
              <div
                key={`${title}-${index}`}
                className="flex items-center gap-3 border rounded-lg p-3"
              >
                <Badge variant="outline">
                  {index + 1}
                </Badge>

                <span>{title}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-lg bg-primary/5 p-4">
            <div className="text-xs text-muted-foreground">
              Best Fitness
            </div>

            <div className="text-2xl font-bold">
              {debug.best_fitness ?? "—"}
            </div>
          </div>
        </DebugSection>

        <DebugSection title="4. Actual Fitness Breakdown">
          <div className="space-y-2">
            {(debug.fitness_breakdown || []).map((item, index) => (
              <div
                key={item.task_id || index}
                className="border rounded-lg p-3"
              >
                <div className="flex justify-between gap-3">
                  <span className="font-medium">
                    {item.title || "Task"}
                  </span>

                  <span className="font-semibold">
                    +{item.penalty ?? 0}
                  </span>
                </div>

                {(item.reasons || []).length > 0 && (
                  <ul className="mt-2 text-xs text-muted-foreground list-disc pl-5">
                    {item.reasons?.map((reason, i) => (
                      <li key={i}>{reason}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </DebugSection>

        <DebugSection title="5. CSP Work Window">
          <ValueRow
            label="Work Start"
            value={debug.work_window?.start || "—"}
          />

          <ValueRow
            label="Work End"
            value={debug.work_window?.end || "—"}
          />
        </DebugSection>

        <DebugSection title="6. Fixed Breaks">
          <div className="space-y-2">
            {(debug.fixed_breaks || []).map((breakItem, index) => (
              <div
                key={index}
                className="flex items-center justify-between border rounded-lg p-3"
              >
                <span>{breakItem.title || "Break"}</span>

                <span className="text-sm">
                  {breakItem.start} → {breakItem.end}
                </span>
              </div>
            ))}
          </div>
        </DebugSection>

        <DebugSection title="7. Final CSP Placement">
          <div className="space-y-2">
            {(debug.csp_blocks || []).map((block, index) => (
              <div
                key={block.task_id || index}
                className="flex items-center gap-3 border rounded-lg p-3"
              >
                <Clock className="h-4 w-4" />

                <div className="flex-1">
                  <div className="font-medium">
                    {block.title || "Task"}
                  </div>

                  <div className="text-xs text-muted-foreground">
                    {block.duration ?? "—"} minutes
                  </div>
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <span>{block.start || "—"}</span>
                  <ArrowRight className="h-3 w-3" />
                  <span>{block.end || "—"}</span>
                </div>
              </div>
            ))}
          </div>
        </DebugSection>

      </CardContent>
    </Card>
  );
}

/* =========================================================
   SMART SUGGESTIONS
========================================================= */

export type SmartSuggestionDebug = {
  task?: {
    id?: string;
    title?: string;
    duration?: number;
  };

  recommended_start?: string;
  recommended_end?: string;

  factors?: Array<{
    name?: string;
    value?: string | number;
    contribution?: number;
  }>;

  reason?: string;
};

export function SmartSuggestionInspector({
  debug,
}: {
  debug?: SmartSuggestionDebug | null;
}) {
  if (!debug) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No Smart Suggestion calculation is available yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle>Developer Mode — Smart Suggestions</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">

        <DebugSection title="1. Recommendation">
          <ValueRow
            label="Task"
            value={debug.task?.title || "—"}
          />

          <ValueRow
            label="Duration"
            value={
              debug.task?.duration !== undefined
                ? `${debug.task.duration} minutes`
                : "—"
            }
          />

          <ValueRow
            label="Recommended Start"
            value={debug.recommended_start || "—"}
          />

          <ValueRow
            label="Recommended End"
            value={debug.recommended_end || "—"}
          />
        </DebugSection>

        <DebugSection title="2. Actual Factors Used">
          <div className="space-y-2">
            {(debug.factors || []).map((factor, index) => (
              <div
                key={index}
                className="border rounded-lg p-3"
              >
                <div className="flex justify-between">
                  <span className="font-medium">
                    {factor.name || "Factor"}
                  </span>

                  <span>
                    {factor.value ?? "—"}
                  </span>
                </div>

                {factor.contribution !== undefined && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Contribution: {factor.contribution}
                  </div>
                )}
              </div>
            ))}
          </div>
        </DebugSection>

        <DebugSection title="3. Recommendation Reason">
          <div className="rounded-lg bg-muted/40 p-4 text-sm">
            {debug.reason || "No reason returned."}
          </div>
        </DebugSection>

      </CardContent>
    </Card>
  );
}

/* =========================================================
   ADAPTIVE SCHEDULING
========================================================= */

export type AdaptiveDebug = {
  trigger?: string;

  before?: Array<{
    id?: string;
    title?: string;
    start?: string;
    end?: string;
  }>;

  changes?: Array<{
    title?: string;
    old_start?: string;
    new_start?: string;
    old_end?: string;
    new_end?: string;
    reason?: string;
  }>;

  after?: Array<{
    id?: string;
    title?: string;
    start?: string;
    end?: string;
  }>;

  result?: string;
};

export function AdaptiveSchedulingInspector({
  debug,
}: {
  debug?: AdaptiveDebug | null;
}) {
  if (!debug) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No Adaptive Scheduling calculation is available yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListOrdered className="h-5 w-5" />
          Developer Mode — Adaptive Scheduling
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">

        <DebugSection title="1. Adaptation Trigger">
          <div className="rounded-lg bg-muted/40 p-4 text-sm">
            {debug.trigger || "No trigger information returned."}
          </div>
        </DebugSection>

        <DebugSection title="2. Before">
          <ScheduleList tasks={debug.before || []} />
        </DebugSection>

        <DebugSection title="3. Changes">
          <div className="space-y-2">
            {(debug.changes || []).map((change, index) => (
              <div
                key={index}
                className="border rounded-lg p-3"
              >
                <div className="font-medium">
                  {change.title || "Task"}
                </div>

                <div className="grid grid-cols-2 gap-3 mt-2 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Before
                    </div>
                    {change.old_start || "—"} → {change.old_end || "—"}
                  </div>

                  <div>
                    <div className="text-xs text-muted-foreground">
                      After
                    </div>
                    {change.new_start || "—"} → {change.new_end || "—"}
                  </div>
                </div>

                {change.reason && (
                  <div className="text-xs text-muted-foreground mt-2">
                    Reason: {change.reason}
                  </div>
                )}
              </div>
            ))}
          </div>
        </DebugSection>

        <DebugSection title="4. After">
          <ScheduleList tasks={debug.after || []} />
        </DebugSection>

        <div className="rounded-lg border-2 border-primary/20 p-4">
          <div className="text-xs text-muted-foreground">
            Adaptation Result
          </div>

          <div className="font-medium mt-1">
            {debug.result || "—"}
          </div>
        </div>

      </CardContent>
    </Card>
  );
}

function ScheduleList({
  tasks,
}: {
  tasks: Array<{
    id?: string;
    title?: string;
    start?: string;
    end?: string;
  }>;
}) {
  return (
    <div className="space-y-2">
      {tasks.map((task, index) => (
        <div
          key={task.id || index}
          className="flex items-center gap-3 border rounded-lg p-3"
        >
          <Badge variant="outline">
            {index + 1}
          </Badge>

          <div className="flex-1">
            <div className="font-medium">
              {task.title || "Task"}
            </div>
          </div>

          <div className="text-sm">
            {task.start || "—"} → {task.end || "—"}
          </div>
        </div>
      ))}
    </div>
  );
}
