import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Code2,
  Cpu,
  Layers,
  Lock,
} from "lucide-react";
import {
  useDevMode,
  useDevUnlock,
} from "@/hooks/use-dev-mode";

// Raw source imports — actual production code
import scheduleSource from "../../supabase/functions/generate-schedule/index.ts?raw";
import prioritiesSource from "../../supabase/functions/rank-priorities/index.ts?raw";

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="text-[11px] leading-relaxed bg-muted/40 border rounded-md p-3 overflow-auto max-h-[520px] font-mono whitespace-pre">
      <code>{code}</code>
    </pre>
  );
}

/* =========================================================
   AHP
   Mathematical Model:

   Weight Normalization:
   Σ wj = 1

   Weighted Sum:
   Pi = Σ wj · sij
   ========================================================= */

const HOW_AHP = [
  "1. The Analytic Hierarchy Process (AHP) calculates a priority score for each task using four evaluation criteria: Deadline Proximity, Difficulty, Duration, and Category Importance.",

  "2. A fixed 4×4 Saaty pairwise-comparison matrix is used to determine the relative importance of the four criteria. The resulting criterion weights are normalized so that Σwj = 1.",

  "3. Power iteration is used to estimate the principal eigenvector of the pairwise-comparison matrix. The eigenvector provides the normalized weight wj for each criterion.",

  "4. The consistency of the pairwise comparisons is evaluated using λmax, the Consistency Index (CI), and the Consistency Ratio (CR). For four criteria, the Random Index (RI) is 0.90.",

  "5. Each task receives a normalized score sij from 0 to 1 for every evaluation criterion. These scores represent the task's performance under deadline proximity, difficulty, duration, and category importance.",

  "6. The overall priority of task i is computed using the weighted-sum model: Pi = Σ(wj × sij). The weighted criterion scores are combined to produce one overall priority value for the task.",

  "7. The resulting priority score is used by the scheduling framework to determine the relative importance of tasks before schedule optimization.",
];

/* =========================================================
   PSO
   Mathematical Model:

   Velocity:
   Vi(t+1) = wVi(t)
           + c1r1(Pbest - Xi(t))
           + c2r2(Gbest - Xi(t))

   Position:
   Xi(t+1) = Xi(t) + Vi(t+1)
   ========================================================= */

const HOW_PSO = [
  "1. Particle Swarm Optimization (PSO) explores different task-order configurations to find a schedule with better productivity characteristics.",

  "2. Each particle represents a candidate solution. The particle position Xi represents the current candidate configuration, while Vi represents its velocity or movement toward another configuration.",

  "3. The velocity is updated using the PSO equation: Vi(t+1) = wVi(t) + c1r1(Pbest − Xi(t)) + c2r2(Gbest − Xi(t)).",

  "4. The inertia weight w controls the influence of the particle's previous movement. The cognitive coefficient c1 controls the influence of the particle's personal best position, while c2 controls the influence of the swarm's global best position.",

  "5. The random variables r1 and r2 are values between 0 and 1. They introduce variation into particle movement and allow the swarm to explore different candidate solutions.",

  "6. The particle position is updated using Xi(t+1) = Xi(t) + Vi(t+1). This produces a new candidate solution for the next iteration.",

  "7. Candidate schedules are evaluated using the scheduling fitness function. The objective considers task completion, alignment with the user's productivity or energy pattern, and context-switching penalties.",

  "8. The PSO process continues through multiple iterations while tracking each particle's personal best (Pbest) and the overall swarm's global best (Gbest). The best candidate configuration is selected as the optimized task sequence.",
];

/* =========================================================
   CSP
   Mathematical Model:

   CSP = (X, D, C)

   Task completion:
   tifinish = tistart + di

   Deadline:
   tifinish ≤ deadlinei

   Non-overlap:
   (tistart + di ≤ tjstart)
   OR
   (tjstart + dj ≤ tistart)

   Break Style:
   User-selected break pattern from Personalization
   ========================================================= */

const HOW_CSP = [
  "1. The Constraint Satisfaction Problem (CSP) is represented as CSP = (X, D, C), where X is the set of scheduling variables, D is the domain of permissible time slots, and C is the set of constraints that must be satisfied.",

  "2. Each task is assigned a start time and finish time within the available work window. The finish time is calculated as tifinish = tistart + di, where di is the estimated task duration.",

  "3. Each scheduled task must satisfy the completion boundary constraint tifinish ≤ deadlinei so that the task finishes within its specified deadline.",

  "4. Tasks must not overlap. For any two tasks i and j, either task i finishes before task j starts, or task j finishes before task i starts: (tistart + di ≤ tjstart) OR (tjstart + dj ≤ tistart).",

  "5. CSP uses the Break Style selected by the user in Settings → Personalization. The selected break_style determines the work-and-break pattern used when placing tasks.",

  "6. Breaks are treated as scheduling constraints. When a task would overlap a required break, the task is moved to the available time after the break instead of being placed across the break.",

  "7. The selected Break Style is read from the user's profile and is used when Auto Schedule or another schedule-generation process creates or regenerates the schedule.",

  "8. For a given PSO task order, CSP performs deterministic sequential placement using the work window, task durations, deadlines, non-overlap rules, and the selected Break Style.",

  "9. The CSP provides the feasibility layer of the scheduling framework. PSO explores candidate task sequences, while CSP determines whether each sequence can be placed while satisfying the scheduling constraints.",

  "10. A valid schedule therefore contains task blocks and break blocks that remain within the work window, do not overlap, respect the selected Break Style, and satisfy the required task constraints.",
];

export default function DeveloperMode() {
  const { devMode, setDevMode } = useDevMode();
  const { unlocked, setUnlocked } = useDevUnlock();

  const [showMechanics, setShowMechanics] = useState(true);
  const [showSource, setShowSource] = useState(true);

  if (!unlocked) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center space-y-4">
        <Lock className="h-8 w-8 mx-auto text-muted-foreground" />

        <h1 className="font-display text-2xl font-bold">
          Developer Mode is locked
        </h1>

        <p className="text-sm text-muted-foreground">
          This section is reserved for authorized IT specialists.
          Unlock it from the Algorithm Insights page.
        </p>

        <Button asChild>
          <Link to="/settings/algorithm-insights">
            Go to Algorithm Insights
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-6xl mx-auto space-y-6"
    >
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Code2 className="h-5 w-5" />
        </div>

        <div>
          <h1 className="font-display text-3xl font-bold">
            Developer Mode
          </h1>

          <p className="text-sm text-muted-foreground">
            Source and mechanics of the three from-scratch algorithms.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-base">
            Controls
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">

          <div className="flex items-center justify-between">
            <div>
              <Label
                htmlFor="global-dev-mode"
                className="text-sm font-medium"
              >
                Global Developer Mode
              </Label>

              <p className="text-xs text-muted-foreground">
                Reveals algorithm calculation panels across every page.
              </p>
            </div>

            <Switch
              id="global-dev-mode"
              checked={devMode}
              onCheckedChange={setDevMode}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label
                htmlFor="show-mechanics"
                className="text-sm font-medium"
              >
                Mechanics
              </Label>

              <p className="text-xs text-muted-foreground">
                Show step-by-step explanations for AHP, PSO and CSP.
              </p>
            </div>

            <Switch
              id="show-mechanics"
              checked={showMechanics}
              onCheckedChange={setShowMechanics}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label
                htmlFor="show-source"
                className="text-sm font-medium"
              >
                Source
              </Label>

              <p className="text-xs text-muted-foreground">
                Show the raw production source of each edge function.
              </p>
            </div>

            <Switch
              id="show-source"
              checked={showSource}
              onCheckedChange={setShowSource}
            />
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <div>
              <p className="text-sm font-medium">
                Lock Developer Mode
              </p>

              <p className="text-xs text-muted-foreground">
                Hides this section from Settings again.
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setUnlocked(false)}
            >
              <Lock className="h-3.5 w-3.5 mr-1.5" />
              Lock
            </Button>
          </div>

        </CardContent>
      </Card>

      <Tabs defaultValue="ahp" className="w-full">

        <TabsList className="grid grid-cols-3 w-full">

          <TabsTrigger value="ahp">
            <Layers className="h-3.5 w-3.5 mr-1.5" />
            AHP
          </TabsTrigger>

          <TabsTrigger value="pso">
            <Cpu className="h-3.5 w-3.5 mr-1.5" />
            PSO
          </TabsTrigger>

          <TabsTrigger value="csp">
            <Code2 className="h-3.5 w-3.5 mr-1.5" />
            CSP
          </TabsTrigger>

        </TabsList>

        {/* AHP */}

        <TabsContent
          value="ahp"
          className="space-y-4 pt-4"
        >

          {showMechanics && (
            <Card>
              <CardHeader>
                <CardTitle className="font-display text-base">
                  How AHP works in this system
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-2 text-sm text-muted-foreground">
                {HOW_AHP.map((s, i) => (
                  <p key={i}>{s}</p>
                ))}
              </CardContent>
            </Card>
          )}

          {showSource && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="font-display text-base flex items-center justify-between">
                  Source —

                  <code className="text-xs font-mono text-muted-foreground">
                    supabase/functions/rank-priorities/index.ts
                  </code>
                </CardTitle>
              </CardHeader>

              <CardContent>
                <CodeBlock code={prioritiesSource} />
              </CardContent>
            </Card>
          )}

        </TabsContent>

        {/* PSO */}

        <TabsContent
          value="pso"
          className="space-y-4 pt-4"
        >

          {showMechanics && (
            <Card>
              <CardHeader>
                <CardTitle className="font-display text-base">
                  How PSO works in this system
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-2 text-sm text-muted-foreground">
                {HOW_PSO.map((s, i) => (
                  <p key={i}>{s}</p>
                ))}
              </CardContent>
            </Card>
          )}

          {showSource && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="font-display text-base flex items-center justify-between">
                  Source —

                  <code className="text-xs font-mono text-muted-foreground">
                    supabase/functions/generate-schedule/index.ts
                  </code>
                </CardTitle>
              </CardHeader>

              <CardContent>
                <CodeBlock code={scheduleSource} />
              </CardContent>
            </Card>
          )}

        </TabsContent>

        {/* CSP */}

        <TabsContent
          value="csp"
          className="space-y-4 pt-4"
        >

          {showMechanics && (
            <Card>
              <CardHeader>
                <CardTitle className="font-display text-base">
                  How CSP works in this system
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-2 text-sm text-muted-foreground">
                {HOW_CSP.map((s, i) => (
                  <p key={i}>{s}</p>
                ))}
              </CardContent>
            </Card>
          )}

          {showSource && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="font-display text-base">
                  Source — CSP function (inside the scheduler)
                </CardTitle>
              </CardHeader>

              <CardContent>
                <CodeBlock code={scheduleSource} />
              </CardContent>
            </Card>
          )}

        </TabsContent>

      </Tabs>
    </motion.div>
  );
}
