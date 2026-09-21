import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "framer-motion";
import { Brain, Zap, Target, CalendarDays, Sparkles, ArrowRight, Compass, PlusCircle, ListChecks, CalendarClock, LineChart, Lightbulb } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useState } from "react";

const GUIDE_STEPS = [
  {
    icon: PlusCircle,
    title: "1. Add your first task",
    body: "Open Add Task from the sidebar. Type what you need to do in plain language (e.g. \"Finish client proposal, due tomorrow 5pm\"). The NLP analyzer fills in category, duration, and difficulty for you. You can also pick a Project to group related tasks.",
  },
  {
    icon: ListChecks,
    title: "2. Review your tasks",
    body: "Head to Tasks to see everything grouped by project with progress bars. Toggle a task between To-do and Done — the In-progress state is set automatically at the scheduled start time.",
  },
  {
    icon: Target,
    title: "3. See what matters most",
    body: "Open Priorities. The AHP algorithm ranks tasks by deadline, difficulty, duration and category, and shows a short reason next to each one. Results stay cached for an hour so revisits are instant.",
  },
  {
    icon: CalendarClock,
    title: "4. Build your day",
    body: "Use Auto Schedule to let PSO + CSP place tasks into a conflict-free timeline based on your peak hours and break style. Today shows the plan for right now; Adaptive Scheduling rearranges the day when something slips.",
  },
  {
    icon: Lightbulb,
    title: "5. Get Smart Suggestions",
    body: "Smart Suggestions recommends what to work on next based on urgency, priority, and your current productivity window. Great when you're unsure where to start.",
  },
  {
    icon: LineChart,
    title: "6. Learn from your patterns",
    body: "Productivity Insights shows your peak hours, duration bias per category, and Deadline Risk Factor over a range you choose (7–90 days). The more you use GSI, the more accurate these numbers become — and they feed back into scheduling.",
  },
  {
    icon: Sparkles,
    title: "7. Understand the algorithms",
    body: "Curious how it all works? Settings → Algorithm Insights explains AHP, PSO+CSP, NLP, and Behavioral Learning step-by-step, with formulas and a worked example.",
  },
];

function GuideDialog() {
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);
  const s = GUIDE_STEPS[step];
  const Icon = s.icon;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setStep(0); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Compass className="h-4 w-4 mr-1" /> Start guided tour
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary">
            <Icon className="h-5 w-5" />
            <DialogTitle className="font-display">{s.title}</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground pt-2 leading-relaxed">
            {s.body}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center gap-1.5 py-2">
          {GUIDE_STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-primary" : "w-1.5 bg-muted"}`}
            />
          ))}
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            Back
          </Button>
          {step < GUIDE_STEPS.length - 1 ? (
            <Button size="sm" onClick={() => setStep((s) => s + 1)}>
              Next <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          ) : (
            <Button size="sm" onClick={() => setOpen(false)}>Finish</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function HelpAbout() {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto space-y-6">
      <h1 className="font-display text-3xl font-bold">Help / About</h1>

      <Card>
        <CardHeader><CardTitle className="font-display text-lg">GSI Schedule Planner</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>An AI-driven task management and scheduling system that learns your behavior to optimize your productivity.</p>
        </CardContent>
      </Card>

      <Card className="border-secondary/40 bg-secondary/10">
        <CardContent className="flex items-center justify-between gap-4 py-4">
          <div className="flex items-start gap-3">
            <Compass className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium text-sm">New here? Take the guided tour</p>
              <p className="text-xs text-muted-foreground">
                A quick 7-step walkthrough of the core features — from adding your first task to reading the insights.
              </p>
            </div>
          </div>
          <GuideDialog />
        </CardContent>
      </Card>

      <Card className="border-primary/40 bg-primary/5">
        <CardContent className="flex items-center justify-between gap-4 py-4">
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium text-sm">Algorithm Insights</p>
              <p className="text-xs text-muted-foreground">
                See step-by-step how AHP, PSO/CSP, NLP, and behavioral learning produce every result in the app.
              </p>
            </div>
          </div>
          <Button size="sm" asChild>
            <Link to="/settings/algorithm-insights">Open <ArrowRight className="h-3.5 w-3.5 ml-1" /></Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-display text-lg">System Algorithms</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3 p-3 rounded-lg bg-accent/30">
            <Brain className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">NLP — Task Analyzer</p>
              <p className="text-xs text-muted-foreground">Natural Language Processing analyzes task titles and descriptions to estimate difficulty, urgency, and duration</p>
            </div>
          </div>
          <div className="flex gap-3 p-3 rounded-lg bg-accent/30">
            <Zap className="h-5 w-5 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">PSO — Behavior Learning</p>
              <p className="text-xs text-muted-foreground">Particle Swarm Optimization learns your productivity patterns and preferred working hours</p>
            </div>
          </div>
          <div className="flex gap-3 p-3 rounded-lg bg-accent/30">
            <CalendarDays className="h-5 w-5 text-info shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">CSP — Auto Schedule</p>
              <p className="text-xs text-muted-foreground">Constraint Satisfaction Problem creates conflict-free schedules by placing tasks in optimal time blocks</p>
            </div>
          </div>
          <div className="flex gap-3 p-3 rounded-lg bg-accent/30">
            <Target className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">AHP — Priority Ranking</p>
              <p className="text-xs text-muted-foreground">Analytic Hierarchy Process systematically ranks tasks based on multiple weighted criteria</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="font-display text-lg">Quick Tips</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>• Add detailed descriptions to tasks for better AI analysis</p>
          <p>• Use the Auto Schedule feature to let CSP handle your calendar</p>
          <p>• Check Focus Mode to see your most important current task</p>
          <p>• View Deadline Risk to catch tasks before they become overdue</p>
          <p>• The more you use the app, the better behavior learning becomes</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
