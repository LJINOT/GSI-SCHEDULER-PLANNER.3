import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain, Calculator, Settings2 } from "lucide-react";

import scheduleSource from "../../supabase/functions/generate-schedule/index.ts?raw";
import prioritiesSource from "../../supabase/functions/rank-priorities/index.ts?raw";

const DEV_MODE_KEY = "gsi-developer-mode";
const MECHANICS_KEY = "gsi-developer-mechanics";
const SOURCE_KEY = "gsi-developer-source";

export default function DeveloperMode() {
  const [enabled, setEnabled] = useState(
    localStorage.getItem(DEV_MODE_KEY) === "true"
  );

  const [mechanics, setMechanics] = useState(
    localStorage.getItem(MECHANICS_KEY) !== "false"
  );

  const [source, setSource] = useState(
    localStorage.getItem(SOURCE_KEY) === "true"
  );

  useEffect(() => {
    localStorage.setItem(DEV_MODE_KEY, String(enabled));
    window.dispatchEvent(
      new CustomEvent("gsi-developer-mode-changed", {
        detail: enabled,
      })
    );
  }, [enabled]);

  useEffect(() => {
    localStorage.setItem(MECHANICS_KEY, String(mechanics));
  }, [mechanics]);

  useEffect(() => {
    localStorage.setItem(SOURCE_KEY, String(source));
  }, [source]);

  return (
    <div className="container mx-auto p-6 space-y-6">

      <div>
        <h1 className="text-2xl font-bold">
          Developer Mode
        </h1>

        <p className="text-muted-foreground mt-1">
          Inspect the actual calculations used by the GSI scheduling system.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Global Developer Controls
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">
                Developer Mode
              </div>

              <div className="text-sm text-muted-foreground">
                Show live calculation inspectors on core features.
              </div>
            </div>

            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">
                Calculation Mechanics
              </div>

              <div className="text-sm text-muted-foreground">
                Show algorithm calculation details.
              </div>
            </div>

            <Switch
              checked={mechanics}
              onCheckedChange={setMechanics}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">
                Production Source
              </div>

              <div className="text-sm text-muted-foreground">
                Show the actual backend source code.
              </div>
            </div>

            <Switch
              checked={source}
              onCheckedChange={setSource}
            />
          </div>

        </CardContent>
      </Card>

      <Tabs defaultValue="ahp">

        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="ahp">
            <Calculator className="h-4 w-4 mr-2" />
            AHP
          </TabsTrigger>

          <TabsTrigger value="pso">
            <Brain className="h-4 w-4 mr-2" />
            PSO
          </TabsTrigger>

          <TabsTrigger value="csp">
            <Settings2 className="h-4 w-4 mr-2" />
            CSP
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ahp">
          <AlgorithmCard
            title="Analytic Hierarchy Process"
            description="AHP calculates task priority using the production priority-ranking function."
            mechanics={mechanics}
            source={source}
            code={prioritiesSource}
          />
        </TabsContent>

        <TabsContent value="pso">
          <AlgorithmCard
            title="Particle Swarm Optimization"
            description="PSO searches task-order combinations before CSP creates the feasible schedule."
            mechanics={mechanics}
            source={source}
            code={scheduleSource}
          />
        </TabsContent>

        <TabsContent value="csp">
          <AlgorithmCard
            title="Constraint Satisfaction / Schedule Placement"
            description="CSP places the PSO task order into the available work window while respecting the current scheduling constraints."
            mechanics={mechanics}
            source={source}
            code={scheduleSource}
          />
        </TabsContent>

      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>
            Live Inspector Locations
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-3 text-sm">

          <div className="border rounded-lg p-4">
            <strong>Priorities</strong>
            <p className="text-muted-foreground">
              Shows the actual AHP calculation for a real task.
            </p>
          </div>

          <div className="border rounded-lg p-4">
            <strong>Auto Schedule</strong>
            <p className="text-muted-foreground">
              Shows actual PSO ordering, fitness, and CSP placement.
            </p>
          </div>

          <div className="border rounded-lg p-4">
            <strong>Smart Suggestions</strong>
            <p className="text-muted-foreground">
              Shows the actual factors used for a recommendation.
            </p>
          </div>

          <div className="border rounded-lg p-4">
            <strong>Adaptive Scheduling</strong>
            <p className="text-muted-foreground">
              Shows the actual schedule before and after adaptation.
            </p>
          </div>

        </CardContent>
      </Card>

    </div>
  );
}

function AlgorithmCard({
  title,
  description,
  mechanics,
  source,
  code,
}: {
  title: string;
  description: string;
  mechanics: boolean;
  source: boolean;
  code: string;
}) {
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {description}
        </p>
      </CardHeader>

      {mechanics && (
        <CardContent className="space-y-4">

          <div className="border rounded-lg p-4">
            <div className="font-semibold mb-2">
              How the production algorithm works
            </div>

            <p className="text-sm text-muted-foreground">
              The live inspectors on the core feature pages display
              calculation results generated by the actual production
              algorithm. They do not create a second calculation.
            </p>
          </div>

          {source && (
            <pre className="max-h-[600px] overflow-auto rounded-lg bg-muted p-4 text-xs">
              <code>{code}</code>
            </pre>
          )}

        </CardContent>
      )}
    </Card>
  );
}
