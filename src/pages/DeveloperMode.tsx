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

// Raw source imports (Vite `?raw`) — the actual production code
// for the three from-scratch algorithms.
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
   AHP — MATCHES CURRENT rank-priorities EDGE FUNCTION
   ========================================================= */

const HOW_AHP = [
  "1. A fixed 4×4 Saaty pairwise-comparison matrix is used for four criteria: Deadline Proximity, Difficulty, Duration, and Category Importance.",

  "2. The system uses power iteration for 100 rounds to estimate the principal eigenvector. These values become the weights of the four criteria.",

  "3. The system calculates λ_max, then uses it to calculate the Consistency Index (CI) and Consistency Ratio (CR). For 4 criteria, the Random Index (RI) is 0.90.",

  "4. Each task receives a 0–1 score for every criterion. Deadline scoring considers no due date, overdue tasks, and different time ranges before the deadline. Difficulty uses Easy = 0.3, Medium = 0.6, and Hard = 1.0. Duration gives higher scores to shorter tasks. Category uses the category-importance values defined in the production function.",

  "5. The final priority score is calculated as (deadlineScore × deadlineWeight) + (difficultyScore × difficultyWeight) + (durationScore × durationWeight) + (categoryScore × categoryWeight), then multiplied by 100.",

  "6. Priority labels are assigned from the final score: High = 65 or higher, Medium = 40 to below 65, and Low = below 40.",
];

/* =========================================================
   PSO — MATCHES CURRENT generate-schedule EDGE FUNCTION
   ========================================================= */

const HOW_PSO = [
  "1. Each task order is represented using continuous random keys between 0 and 1. Sorting the keys converts a particle into a task sequence.",

  "2. The system creates a swarm of 25 particles. Each particle has a position and velocity and is evaluated by placing its decoded task order through the CSP scheduler.",

  "3. The fitness function gives a lower score to better schedules. If CSP cannot create a valid schedule, the fitness receives a penalty of 1,000,000,000.",

  "4. The current fitness rules add +25 when a hard task is scheduled outside the peak window, +8 when an easy task is scheduled inside the peak window, +0.01 for each minute a task starts later within the work window, and +15 when a task is due within 24 hours and starts after the peak window.",

  "5. Each particle updates its velocity using inertia (w = 0.7), personal-best influence (c1 = 1.5), and global-best influence (c2 = 1.5). The particle position is kept within the 0–1 range.",

  "6. The PSO process runs for 60 iterations. The global best particle provides the final task order that is passed to the CSP placement process.",
];

/* =========================================================
   CSP — MATCHES CURRENT generate-schedule EDGE FUNCTION
   ========================================================= */

const HOW_CSP = [
  "1. CSP receives the task order produced by PSO together with the user's work start and work end times.",

  "2. Tasks are placed sequentially using a time cursor. The current implementation uses fixed breaks at 9:00–9:15 AM for Morning Snack, 12:00–1:00 PM for Lunch, and 3:00–3:15 PM for Afternoon Snack.",

  "3. Before placing a task, the scheduler checks whether the task would cross a fixed break. If it would, the task is moved to the time after that break.",

  "4. Task duration is limited to a minimum of 5 minutes and a maximum of 480 minutes. If a task cannot fit before the work-end time, CSP returns failure (null).",

  "5. Valid tasks are converted into schedule blocks containing their start and end times, task information, category, and block type. The resulting blocks are sorted by start time.",

  "6. The CSP placement is deterministic and greedy for the task order it receives. PSO searches different task orders, while CSP checks whether each order can be placed within the work window and fixed-break constraints.",

  "7. The current CSP implementation does not use a running focus counter, and the break_style setting does not change the fixed 9:00 AM, 12:00 PM, and 3:00 PM breaks.",
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
      {/* =====================================================
          HEADER
          ===================================================== */}

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

      {/* =====================================================
          CONTROLS
          ===================================================== */}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-base">
            Controls
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">

          {/* Global Developer Mode */}

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

          {/* Mechanics */}

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

          {/* Source */}

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

          {/* Lock */}

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

      {/* =====================================================
          ALGORITHM TABS
          ===================================================== */}

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

        {/* ===================================================
            AHP
            =================================================== */}

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

        {/* ===================================================
            PSO
            =================================================== */}

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

        {/* ===================================================
            CSP
            =================================================== */}

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
