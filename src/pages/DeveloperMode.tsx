import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Brain,
  Calculator,
  Code2,
  Cpu,
  Info,
  Layers3,
  LockKeyhole,
  Network,
} from "lucide-react";

// IMPORTANT:
// These are the ACTUAL production files.
// Developer Mode explains these files instead of duplicating their logic.
import scheduleSource from "../../supabase/functions/generate-schedule/index.ts?raw";
import prioritiesSource from "../../supabase/functions/rank-priorities/index.ts?raw";

type AlgorithmTab = "ahp" | "pso" | "csp";

const AHP_MATRIX = [
  [1, 3, 4, 5],
  [1 / 3, 1, 2, 3],
  [1 / 4, 1 / 2, 1, 2],
  [1 / 5, 1 / 3, 1 / 2, 1],
];

const CRITERIA = [
  "Deadline Proximity",
  "Difficulty",
  "Duration",
  "Category Importance",
];

function formatNumber(value: number, decimals = 4) {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(decimals);
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="max-h-[600px] overflow-auto rounded-lg border bg-muted/40 p-4 text-xs leading-5">
      <code>{code}</code>
    </pre>
  );
}

function Metric({
  label,
  value,
  description,
}: {
  label: string;
  value: string | number;
  description?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
      {description && (
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="rounded-lg border bg-muted/50 p-2">
        <Icon className="h-5 w-5" />
      </div>

      <div>
        <h3 className="font-semibold">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}

function AHPPanel() {
  return (
    <div className="space-y-6">
      <SectionTitle
        icon={Brain}
        title="AHP Priority Ranking"
        description="Analytic Hierarchy Process used by rank-priorities."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            1. Pairwise Comparison Matrix
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border p-2 text-left">Criteria</th>
                  {CRITERIA.map((criterion) => (
                    <th
                      key={criterion}
                      className="border p-2 text-center"
                    >
                      {criterion}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {AHP_MATRIX.map((row, rowIndex) => (
                  <tr key={CRITERIA[rowIndex]}>
                    <td className="border p-2 font-medium">
                      {CRITERIA[rowIndex]}
                    </td>

                    {row.map((value, columnIndex) => (
                      <td
                        key={`${rowIndex}-${columnIndex}`}
                        className="border p-2 text-center"
                      >
                        {formatNumber(value, 3)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CRITERIA.map((criterion) => (
          <Metric
            key={criterion}
            label={criterion}
            value="Calculated at runtime"
            description="Uses the production AHP power iteration."
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            2. AHP Calculation Method
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-3 text-sm">
          <p>
            The system uses the fixed 4×4 Saaty comparison matrix to determine
            the relative importance of the four criteria.
          </p>

          <p>
            The priority weights are calculated using{" "}
            <strong>100 power-iteration rounds</strong>.
          </p>

          <p>
            The system then calculates Lambda Max, the Consistency Index (CI),
            and the Consistency Ratio (CR).
          </p>

          <div className="rounded-lg border bg-muted/40 p-4 font-mono text-sm">
            CI = (λmax - n) / (n - 1)
            <br />
            CR = CI / RI
            <br />
            RI for n = 4 = 0.90
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            3. Task Scoring Rules
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border p-4">
              <h4 className="font-semibold">Deadline</h4>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>No due date → 0.15</li>
                <li>Overdue → 1.00</li>
                <li>&lt; 24 hours → 0.90</li>
                <li>&lt; 72 hours → 0.70</li>
                <li>&lt; 168 hours → 0.45</li>
                <li>&lt; 336 hours → 0.25</li>
                <li>Otherwise → 0.10</li>
              </ul>
            </div>

            <div className="rounded-lg border p-4">
              <h4 className="font-semibold">Difficulty</h4>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>Hard → 1.00</li>
                <li>Medium → 0.60</li>
                <li>Easy → 0.30</li>
              </ul>
            </div>

            <div className="rounded-lg border p-4">
              <h4 className="font-semibold">Duration</h4>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>≤ 15 min → 1.00</li>
                <li>≤ 30 min → 0.80</li>
                <li>≤ 60 min → 0.60</li>
                <li>≤ 120 min → 0.40</li>
                <li>&gt; 120 min → 0.20</li>
              </ul>
            </div>

            <div className="rounded-lg border p-4">
              <h4 className="font-semibold">Final Priority</h4>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>Score ≥ 65 → High</li>
                <li>Score ≥ 40 → Medium</li>
                <li>Score &lt; 40 → Low</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Final AHP Formula</CardTitle>
        </CardHeader>

        <CardContent>
          <div className="rounded-lg border bg-muted/40 p-4 font-mono text-sm leading-7">
            Final Score =
            <br />
            (Deadline × W₁)
            <br />
            + (Difficulty × W₂)
            <br />
            + (Duration × W₃)
            <br />
            + (Category Importance × W₄)
            <br />
            <br />
            Final Score × 100
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Production Source</CardTitle>
        </CardHeader>
        <CardContent>
          <CodeBlock code={prioritiesSource} />
        </CardContent>
      </Card>
    </div>
  );
}

function PSOPanel() {
  return (
    <div className="space-y-6">
      <SectionTitle
        icon={Cpu}
        title="PSO Task Ordering"
        description="Particle Swarm Optimization used by generate-schedule."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Representation" value="Random Key" />
        <Metric label="Swarm Size" value="25" />
        <Metric label="Iterations" value="60" />
        <Metric label="Inertia (w)" value="0.7" />
        <Metric label="Cognitive (c1)" value="1.5" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            PSO Process
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="space-y-3">
            {[
              "Create random-key particles.",
              "Decode each particle into a task order.",
              "Send the task order to CSP placement.",
              "Calculate the fitness of the resulting schedule.",
              "Update each particle's personal best.",
              "Update the swarm's global best.",
              "Repeat for 60 iterations.",
              "Use the best task order for scheduling.",
            ].map((step, index) => (
              <div
                key={step}
                className="flex items-center gap-3 rounded-lg border p-3"
              >
                <Badge variant="outline">{index + 1}</Badge>
                <span className="text-sm">{step}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Current Fitness Function
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            The scheduler minimizes fitness. Lower fitness represents fewer
            scheduling penalties.
          </p>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border p-4">
              <p className="font-semibold">CSP failure</p>
              <p className="mt-1 font-mono text-sm">1e9</p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="font-semibold">
                Hard task outside peak
              </p>
              <p className="mt-1 font-mono text-sm">+25</p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="font-semibold">
                Easy task inside peak
              </p>
              <p className="mt-1 font-mono text-sm">+8</p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="font-semibold">Later start</p>
              <p className="mt-1 font-mono text-sm">
                +0.01 × minutes from work start
              </p>
            </div>

            <div className="rounded-lg border p-4 md:col-span-2">
              <p className="font-semibold">
                Due within 24 hours and scheduled after peak
              </p>
              <p className="mt-1 font-mono text-sm">+15</p>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/40 p-4 text-sm">
            <strong>Important:</strong> The current production fitness
            function does not include a category-switching penalty.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Production Source
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CodeBlock code={scheduleSource} />
        </CardContent>
      </Card>
    </div>
  );
}

function CSPPanel() {
  return (
    <div className="space-y-6">
      <SectionTitle
        icon={Network}
        title="CSP Schedule Placement"
        description="Greedy sequential placement used after PSO finds a task order."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Current CSP Method
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4 text-sm">
          <div className="rounded-lg border bg-muted/40 p-4">
            <strong>Method:</strong> Greedy Sequential Placement
          </div>

          <p>
            CSP receives the task order produced by PSO and places the tasks
            sequentially inside the user's configured work window.
          </p>

          <p>
            The current implementation does not perform a traditional
            backtracking search.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Fixed Breaks
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border p-4">
              <p className="font-semibold">Morning Snack</p>
              <p className="text-sm text-muted-foreground">
                9:00 AM – 9:15 AM
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="font-semibold">Lunch</p>
              <p className="text-sm text-muted-foreground">
                12:00 PM – 1:00 PM
              </p>
            </div>

            <div className="rounded-lg border p-4">
              <p className="font-semibold">Afternoon Snack</p>
              <p className="text-sm text-muted-foreground">
                3:00 PM – 3:15 PM
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Placement Rules
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="space-y-2">
            {[
              "Start at the configured work_start.",
              "Place tasks sequentially according to the PSO order.",
              "Use each task's estimated duration.",
              "Clamp task duration between 5 and 480 minutes.",
              "Respect the fixed 9 AM, 12 PM, and 3 PM breaks.",
              "If a task conflicts with a break, move placement after the break.",
              "Prevent task overlap.",
              "Keep tasks within the configured work window.",
              "Return failure if a task cannot fit before work_end.",
            ].map((rule, index) => (
              <div
                key={rule}
                className="flex gap-3 rounded-lg border p-3"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {index + 1}.
                </span>
                <span className="text-sm">{rule}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Algorithm Relationship
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="flex flex-col items-center gap-3 text-center">
            <Badge>AHP</Badge>
            <span className="text-xs text-muted-foreground">
              Calculates task priority
            </span>

            <span>↓</span>

            <Badge>PSO</Badge>
            <span className="text-xs text-muted-foreground">
              Searches for a task order
            </span>

            <span>↓</span>

            <Badge>CSP</Badge>
            <span className="text-xs text-muted-foreground">
              Places the ordered tasks into the work window
            </span>

            <span>↓</span>

            <Badge variant="secondary">
              Final Schedule
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Production Source
          </CardTitle>
        </CardHeader>

        <CardContent>
          <CodeBlock code={scheduleSource} />
        </CardContent>
      </Card>
    </div>
  );
}

export default function DeveloperMode() {
  const [enabled, setEnabled] = useState(true);
  const [mechanics, setMechanics] = useState(true);
  const [showSource, setShowSource] = useState(false);
  const [activeTab, setActiveTab] = useState<AlgorithmTab>("ahp");

  const sourceInfo = useMemo(
    () => ({
      ahp: {
        name: "rank-priorities",
        description: "Production AHP implementation",
      },
      pso: {
        name: "generate-schedule",
        description: "Production PSO implementation",
      },
      csp: {
        name: "generate-schedule",
        description: "Production CSP implementation",
      },
    }),
    []
  );

  if (!enabled) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <div className="flex items-center gap-3">
              <LockKeyhole className="h-5 w-5" />
              <div>
                <h2 className="font-semibold">
                  Developer Mode Disabled
                </h2>
                <p className="text-sm text-muted-foreground">
                  Enable Developer Mode to view algorithm mechanics.
                </p>
              </div>
            </div>

            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Code2 className="h-6 w-6" />
            <h1 className="text-2xl font-bold">
              Developer Mode
            </h1>
          </div>

          <p className="mt-1 text-sm text-muted-foreground">
            Transparent view of the algorithms currently used by GSI Schedule
            Planner.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm">Developer Mode</span>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm">Mechanics</span>
            <Switch
              checked={mechanics}
              onCheckedChange={setMechanics}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm">Source</span>
            <Switch
              checked={showSource}
              onCheckedChange={setShowSource}
            />
          </div>
        </div>
      </div>

      {/* IMPORTANT NOTICE */}
      <Card>
        <CardContent className="flex gap-3 p-4">
          <Info className="mt-0.5 h-5 w-5 shrink-0" />

          <div className="text-sm">
            <p className="font-semibold">
              Production code is the source of truth.
            </p>

            <p className="mt-1 text-muted-foreground">
              These panels explain the current AHP, PSO, and CSP
              implementations. They do not create a separate scheduling
              algorithm.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ALGORITHM TABS */}
      <Tabs
        value={activeTab}
        onValueChange={(value) =>
          setActiveTab(value as AlgorithmTab)
        }
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="ahp">
            <Brain className="mr-2 h-4 w-4" />
            AHP
          </TabsTrigger>

          <TabsTrigger value="pso">
            <Cpu className="mr-2 h-4 w-4" />
            PSO
          </TabsTrigger>

          <TabsTrigger value="csp">
            <Network className="mr-2 h-4 w-4" />
            CSP
          </TabsTrigger>
        </TabsList>

        {mechanics && (
          <>
            <TabsContent value="ahp" className="mt-6">
              <AHPPanel />
            </TabsContent>

            <TabsContent value="pso" className="mt-6">
              <PSOPanel />
            </TabsContent>

            <TabsContent value="csp" className="mt-6">
              <CSPPanel />
            </TabsContent>
          </>
        )}
      </Tabs>

      {/* SOURCE INFORMATION */}
      {showSource && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Layers3 className="h-5 w-5" />
              <div>
                <CardTitle className="text-base">
                  Production Source Mapping
                </CardTitle>

                <p className="text-sm text-muted-foreground">
                  {sourceInfo[activeTab].description}
                </p>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <div className="mb-4 rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">
                Source file
              </p>

              <p className="mt-1 font-mono text-sm">
                {activeTab === "ahp"
                  ? "supabase/functions/rank-priorities/index.ts"
                  : "supabase/functions/generate-schedule/index.ts"}
              </p>
            </div>

            <CodeBlock
              code={
                activeTab === "ahp"
                  ? prioritiesSource
                  : scheduleSource
              }
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
