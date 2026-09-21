import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Code2, Cpu, Layers, Lock } from "lucide-react";
import { useDevMode, useDevUnlock } from "@/hooks/use-dev-mode";


// Raw source imports (Vite `?raw`) — the actual production code for the
// three from-scratch algorithms. No external algorithm libraries are used;
// only the database client is imported for reading tasks.
import scheduleSource from "../../supabase/functions/generate-schedule/index.ts?raw";
import prioritiesSource from "../../supabase/functions/rank-priorities/index.ts?raw";

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="text-[11px] leading-relaxed bg-muted/40 border rounded-md p-3 overflow-auto max-h-[520px] font-mono whitespace-pre">
      <code>{code}</code>
    </pre>
  );
}

const HOW_AHP = [
  "1. A fixed 4×4 Saaty pairwise-comparison matrix encodes the four criteria: deadline > difficulty > duration > category.",
  "2. Power iteration (100 rounds) approximates the principal eigenvector of that matrix — the criteria weights.",
  "3. λ_max is computed via a Rayleigh-style ratio; from it we derive Consistency Index (CI) and Consistency Ratio (CR = CI / RI).",
  "4. Every task is scored on each criterion (deadline proximity, difficulty, duration inverse, category importance) between 0–1.",
  "5. Final priority = Σ (criterion_score × criterion_weight) × 100. Tasks are sorted, tagged high / medium / low, and given a plain-English reason.",
];

const HOW_PSO = [
  "1. Encode each task order as a vector of continuous 'random keys' in [0,1]; sort keys to decode a permutation.",
  "2. Initialise a swarm of 25 particles + velocities; evaluate fitness for each by running the CSP placer and scoring the resulting timeline.",
  "3. Fitness rewards hard tasks inside the peak window, penalises hard tasks late, penalises category-switching, and heavily penalises missed deadlines.",
  "4. On every iteration each particle updates its velocity from inertia (w=0.7), personal best (c1=1.5) and global best (c2=1.5), then moves — clamped to [0,1].",
  "5. After 60 iterations the global best decodes to the winning task order, which is handed to CSP to lay out the final blocks.",
];

const HOW_CSP = [
  "1. Given an ordered task list and a work window [start, end], place each task sequentially, advancing a time cursor.",
  "2. A running focus counter tracks minutes since the last break; when it exceeds the work interval (25 / 45 / 50 min depending on break style), a break block is inserted.",
  "3. Each task duration is clamped to 5–480 minutes; if the cursor + duration would exceed the window, the CSP fails (returns null → 'unsatisfiable').",
  "4. Otherwise a Block { start, end, task_id, category, kind } is emitted. Breaks are labelled with kind:'break' so the UI can render them differently.",
  "5. Because the algorithm is deterministic and greedy inside a fixed order, PSO explores the order-space while CSP guarantees feasibility.",
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
        <h1 className="font-display text-2xl font-bold">Developer Mode is locked</h1>
        <p className="text-sm text-muted-foreground">
          This section is reserved for authorized IT specialists. Unlock it from the Algorithm Insights page.
        </p>
        <Button asChild><Link to="/settings/algorithm-insights">Go to Algorithm Insights</Link></Button>
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
          <h1 className="font-display text-3xl font-bold">Developer Mode</h1>
          <p className="text-sm text-muted-foreground">Source and mechanics of the three from-scratch algorithms.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-base">Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="global-dev-mode" className="text-sm font-medium">Global Developer Mode</Label>
              <p className="text-xs text-muted-foreground">Reveals algorithm calculation panels across every page.</p>
            </div>
            <Switch id="global-dev-mode" checked={devMode} onCheckedChange={setDevMode} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="show-mechanics" className="text-sm font-medium">Mechanics</Label>
              <p className="text-xs text-muted-foreground">Show step-by-step explanations for AHP, PSO and CSP.</p>
            </div>
            <Switch id="show-mechanics" checked={showMechanics} onCheckedChange={setShowMechanics} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="show-source" className="text-sm font-medium">Source</Label>
              <p className="text-xs text-muted-foreground">Show the raw production source of each edge function.</p>
            </div>
            <Switch id="show-source" checked={showSource} onCheckedChange={setShowSource} />
          </div>
          <div className="flex items-center justify-between border-t pt-4">
            <div>
              <p className="text-sm font-medium">Lock Developer Mode</p>
              <p className="text-xs text-muted-foreground">Hides this section from Settings again.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setUnlocked(false)}>
              <Lock className="h-3.5 w-3.5 mr-1.5" />Lock
            </Button>
          </div>
        </CardContent>
      </Card>





      <Tabs defaultValue="ahp" className="w-full">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="ahp"><Layers className="h-3.5 w-3.5 mr-1.5" />AHP</TabsTrigger>
          <TabsTrigger value="pso"><Cpu className="h-3.5 w-3.5 mr-1.5" />PSO</TabsTrigger>
          <TabsTrigger value="csp"><Code2 className="h-3.5 w-3.5 mr-1.5" />CSP</TabsTrigger>
        </TabsList>

        <TabsContent value="ahp" className="space-y-4 pt-4">
          {showMechanics && (
          <Card>
            <CardHeader><CardTitle className="font-display text-base">How AHP works in this system</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {HOW_AHP.map((s, i) => <p key={i}>{s}</p>)}
            </CardContent>
          </Card>
          )}
          {showSource && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="font-display text-base flex items-center justify-between">
                Source — <code className="text-xs font-mono text-muted-foreground">supabase/functions/rank-priorities/index.ts</code>
              </CardTitle>
            </CardHeader>
            <CardContent><CodeBlock code={prioritiesSource} /></CardContent>
          </Card>
          )}
        </TabsContent>

        <TabsContent value="pso" className="space-y-4 pt-4">
          {showMechanics && (
          <Card>
            <CardHeader><CardTitle className="font-display text-base">How PSO works in this system</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {HOW_PSO.map((s, i) => <p key={i}>{s}</p>)}
            </CardContent>
          </Card>
          )}
          {showSource && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="font-display text-base flex items-center justify-between">
                Source — <code className="text-xs font-mono text-muted-foreground">supabase/functions/generate-schedule/index.ts</code>
              </CardTitle>
            </CardHeader>
            <CardContent><CodeBlock code={scheduleSource} /></CardContent>
          </Card>
          )}
        </TabsContent>

        <TabsContent value="csp" className="space-y-4 pt-4">
          {showMechanics && (
          <Card>
            <CardHeader><CardTitle className="font-display text-base">How CSP works in this system</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {HOW_CSP.map((s, i) => <p key={i}>{s}</p>)}
            </CardContent>
          </Card>
          )}
          {showSource && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="font-display text-base">Source — CSP function (inside the scheduler)</CardTitle>
            </CardHeader>
            <CardContent><CodeBlock code={scheduleSource} /></CardContent>
          </Card>
          )}
        </TabsContent>

      </Tabs>
    </motion.div>
  );
}
