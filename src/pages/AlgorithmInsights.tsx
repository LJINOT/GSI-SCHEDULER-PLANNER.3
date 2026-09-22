import { useState } from "react";
import { motion } from "framer-motion";

import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {

  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Brain, Target, CalendarDays, Zap, ArrowLeft, Sparkles, Code2,
} from "lucide-react";
import { AlgorithmFlow } from "@/components/AlgorithmFlow";
import { useDevUnlock } from "@/hooks/use-dev-mode";


function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
        {n}
      </div>
      <div className="flex-1 space-y-1">
        <p className="font-medium text-sm">{title}</p>
        <div className="text-xs text-muted-foreground leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function InPlainEnglish({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-foreground/80 leading-relaxed">
      <p className="font-semibold text-primary mb-1">In plain English</p>
      {children}
    </div>
  );
}

const DEV_PIN = "1111";

export default function AlgorithmInsights() {
  const { unlocked, setUnlocked } = useDevUnlock();
  const navigate = useNavigate();
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");

  const handleUnlockClick = () => {
    if (unlocked) {
      navigate("/settings/developer");
      return;
    }
    setPin("");
    setPinError("");
    setPinOpen(true);
  };

  const submitPin = () => {
    if (pin !== DEV_PIN) {
      setPinError("Incorrect PIN. Please try again.");
      setPin("");
      return;
    }
    setPinOpen(false);
    setUnlocked(true);
    toast.success("Developer Mode unlocked — available in Settings.");
    navigate("/settings/developer");
  };


  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-4xl mx-auto space-y-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Algorithm Insights</h1>
          <p className="text-sm text-muted-foreground mt-1">
            A friendly look at how GSI Schedule Planner decides what you should do — and when.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={unlocked ? "outline" : "default"} size="sm" onClick={handleUnlockClick}>
            <Code2 className="h-4 w-4 mr-2" />
            {unlocked ? "Open Developer Mode" : "Unlock Developer Mode"}
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/settings/help"><ArrowLeft className="h-4 w-4 mr-2" />Back to Help</Link>
          </Button>
        </div>
      </div>

      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display">Enter developer PIN</DialogTitle>
            <DialogDescription>
              Developer Mode is reserved for authorized IT specialists. Enter the 4-digit PIN to continue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              autoFocus
              inputMode="numeric"
              maxLength={4}
              type="password"
              placeholder="••••"
              value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 4)); setPinError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") submitPin(); }}
              className="text-center tracking-[0.6em] text-lg"
            />
            {pinError && <p className="text-xs text-destructive">{pinError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPinOpen(false)}>Cancel</Button>
            <Button onClick={submitPin} disabled={pin.length !== 4}>Unlock</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>



      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle className="font-display text-lg">The big picture</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-3">
          <p>
            Think of the app as a small team of four helpers working together behind the scenes:
          </p>
          <ul className="space-y-2 text-sm">
            <li className="flex gap-2">
              <Brain className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <span><b className="text-foreground">The Reader (NLP)</b> — reads your task and guesses the category, how long it will take, and how hard it is.</span>
            </li>
            <li className="flex gap-2">
              <Target className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <span><b className="text-foreground">The Ranker (AHP)</b> — decides which task deserves your attention first.</span>
            </li>
            <li className="flex gap-2">
              <CalendarDays className="h-4 w-4 text-info shrink-0 mt-0.5" />
              <span><b className="text-foreground">The Planner (PSO + CSP)</b> — picks the best time of day for each task and makes sure nothing overlaps.</span>
            </li>
            <li className="flex gap-2">
              <Zap className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <span><b className="text-foreground">The Coach (Behavioral Learning)</b> — watches how you actually work and quietly makes the other three smarter over time.</span>
            </li>
          </ul>
          <p className="text-xs">Tap any section below to see what each helper does, step by step.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">How the algorithm works — visualized</CardTitle>
        </CardHeader>
        <CardContent>
          <AlgorithmFlow />
        </CardContent>
      </Card>

      <Accordion type="multiple" defaultValue={["ahp"]} className="space-y-3">
        {/* AHP */}
        <AccordionItem value="ahp" className="border rounded-lg px-4">
          <AccordionTrigger>
            <div className="flex items-center gap-3">
              <Target className="h-5 w-5 text-destructive" />
              <div className="text-left">
                <p className="font-medium">The Ranker — what should I do first?</p>
                <p className="text-xs text-muted-foreground">Powers the Priorities page</p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <InPlainEnglish>
              Imagine sorting your to-do list by asking four questions about each task:
              <b> "Is it due soon? Is it hard? Is it short or long? Is the category important?"</b>{" "}
              The Ranker asks those exact questions, gives each answer a score, and adds them up
              to decide what belongs at the top of your list.
            </InPlainEnglish>

            <div className="space-y-3">
              <Step n={1} title="Look at four things about every task">
                Deadline (how soon it's due), difficulty (easy / medium / hard), duration (short
                tasks are easier to fit in), and category (some categories matter more to you).
              </Step>
              <Step n={2} title="Decide which of the four matters most">
                The app treats <b>deadline</b> as the most important, then difficulty, then
                duration, then category. This ordering never changes — it's the same rulebook
                for every user, so results are fair and predictable.
              </Step>
              <Step n={3} title="Turn the rulebook into weights">
                Behind the scenes the four factors are converted into percentages that add up to
                100%. A typical split looks like this:
                <ul className="mt-2 space-y-1">
                  <li>• Deadline — around <b>55%</b> of the score</li>
                  <li>• Difficulty — around <b>22%</b></li>
                  <li>• Duration — around <b>13%</b></li>
                  <li>• Category — around <b>10%</b></li>
                </ul>
              </Step>
              <Step n={4} title="Double-check the rulebook is consistent">
                A quick math check confirms the four weights don't contradict each other. If they
                did, the app would refuse to rank and warn you instead.
              </Step>
              <Step n={5} title="Score each task from 0 to 100">
                Every task earns points on each of the four factors, multiplied by that factor's
                weight. A task due tomorrow that's hard and short will score much higher than an
                easy long task with no deadline.
              </Step>
              <Step n={6} title="Sort into buckets you can act on">
                <span className="inline-flex items-center gap-1 flex-wrap">
                  Score 65+ →
                  <Badge variant="destructive" className="text-[10px] py-0">high</Badge>
                  · 40–64 →
                  <Badge className="text-[10px] py-0">medium</Badge>
                  · below 40 →
                  <Badge variant="secondary" className="text-[10px] py-0">low</Badge>
                </span>
                <span className="block mt-1">
                  Each task also gets a short reason in plain words like "due within 72 hours;
                  high difficulty; short duration" so you know why it ranked where it did.
                </span>
              </Step>
            </div>

            <Separator />
            <p className="text-xs text-muted-foreground">
              <b>Bottom line:</b> the order on the Priorities page isn't a guess. It's a fair,
              repeatable recipe — two people with the same tasks will always see the same order.
            </p>
          </AccordionContent>
        </AccordionItem>

        {/* PSO + CSP */}
        <AccordionItem value="pso" className="border rounded-lg px-4">
          <AccordionTrigger>
            <div className="flex items-center gap-3">
              <CalendarDays className="h-5 w-5 text-info" />
              <div className="text-left">
                <p className="font-medium">The Planner — when should I do each task?</p>
                <p className="text-xs text-muted-foreground">
                  Powers Auto Schedule, Today, and Adaptive Scheduling
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <InPlainEnglish>
              Picture a swarm of tiny helpers flying around your calendar, each one trying out a
              different start time for a task. They talk to each other, notice which time slot
              feels best, and slowly gather around the winner. Once they agree, a second helper
              double-checks that the slot doesn't clash with anything already on your calendar.
            </InPlainEnglish>

            <div className="space-y-3">
              <Step n={1} title="Gather what it needs">
                Your open tasks, their priority scores from the Ranker, your usual peak hours,
                and your preferred break style (short Pomodoro breaks or longer focus blocks).
              </Step>
              <Step n={2} title="Try many possible time slots">
                For each task, the app tests dozens of possible start times across the day. Each
                option is rated on things like: does it match your best hours? Is the deadline
                close? Would it clash with something else? Would it break your focus?
              </Step>
              <Step n={3} title="Let the best times win">
                The options that scored well pull the others toward them, round after round,
                until the swarm agrees on the strongest choice — the ideal time of day for that
                task based on how you actually work.
              </Step>
              <Step n={4} title="Double-check the winning slot">
                A safety pass makes sure the chosen slot doesn't overlap another task, stays
                inside your working hours, respects the deadline, and keeps your preferred break
                pattern intact.
              </Step>
              <Step n={5} title="Rearrange gently when life changes">
                If you skip or move a task, the Planner only replans the affected part of your
                day. Everything else stays put, so your schedule doesn't get shuffled around
                unnecessarily.
              </Step>
            </div>

            <Separator />
            <p className="text-xs text-muted-foreground">
              <b>Bottom line:</b> the Planner figures out <i>when</i> is best based on your
              habits and priorities, then guarantees the plan is actually possible — no double
              bookings, no impossible deadlines.
            </p>
          </AccordionContent>
        </AccordionItem>

        {/* Behavioral learning */}
        <AccordionItem value="behavior" className="border rounded-lg px-4">
          <AccordionTrigger>
            <div className="flex items-center gap-3">
              <Zap className="h-5 w-5 text-warning" />
              <div className="text-left">
                <p className="font-medium">The Coach — learning how you really work</p>
                <p className="text-xs text-muted-foreground">
                  Powers Productivity Insights and Deadline Risk
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <InPlainEnglish>
              The Coach quietly keeps a diary of when you finish things, how long tasks really
              take you, and how often you miss deadlines. It never guesses — it just watches
              your history and updates a few simple averages, which the other helpers then use
              to make better decisions.
            </InPlainEnglish>

            <div className="space-y-3">
              <Step n={1} title="Look back at the last few days or weeks">
                You choose a window (7 to 90 days). Only tasks you actually finished or missed
                are counted — pending tasks don't skew the numbers.
              </Step>
              <Step n={2} title="Find your peak hours">
                It counts how many tasks you completed at each hour of the day and highlights
                the two consecutive hours where you finish the most. Those become your peak
                window — the Planner then favours them.
              </Step>
              <Step n={3} title="Learn your real pace">
                For every category, it compares how long you estimated a task versus how long it
                actually took. If you always underestimate freelance work by 15%, future
                estimates in that category get gently bumped up so your plan stays realistic.
              </Step>
              <Step n={4} title="Warn you about deadline risk">
                It mixes today's urgency with how often you've missed similar deadlines in the
                past to flag which tasks are most at risk. Shown as high, medium, or low on the
                Deadline Risk and Productivity Insights pages.
              </Step>
              <Step n={5} title="Feed everything back into planning">
                Your peak hours, break preference, and pace corrections are all saved to your
                profile, so the next time the Planner runs, it's smarter than yesterday.
              </Step>
            </div>

            <Separator />
            <p className="text-xs text-muted-foreground">
              <b>Bottom line:</b> the more you use the app, the more it reflects the way{" "}
              <i>you</i> work — not a generic user.
            </p>
          </AccordionContent>
        </AccordionItem>

        {/* NLP */}
        <AccordionItem value="nlp" className="border rounded-lg px-4">
          <AccordionTrigger>
            <div className="flex items-center gap-3">
              <Brain className="h-5 w-5 text-primary" />
              <div className="text-left">
                <p className="font-medium">The Reader — understanding what you typed</p>
                <p className="text-xs text-muted-foreground">Runs on the Add Task page</p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <InPlainEnglish>
              When you type a task like "finish client proposal," the Reader figures out on your
              behalf what kind of task it is, roughly how long it will take, and how hard it
              might be — so you don't have to fill in every field yourself.
            </InPlainEnglish>

            <div className="space-y-3">
              <Step n={1} title="Tidy up the text">
                Fixes common typos and normalizes wording so the same task always looks the same
                to the app.
              </Step>
              <Step n={2} title="Pick the right category">
                An AI assistant reads the task and chooses from your existing categories
                (Academic, Freelancing, Office, Field Work, and so on) — never a made-up one.
              </Step>
              <Step n={3} title="Estimate duration and difficulty">
                It also suggests roughly how many minutes the task will take and whether it's
                easy, medium, or hard.
              </Step>
              <Step n={4} title="Adjust for how you really work">
                Before saving, the estimate is nudged using what the Coach learned about your
                pace, so the number you see is realistic — not just generic.
              </Step>
              <Step n={5} title="Hand off to the Ranker and Planner">
                Once the task has a category, duration, difficulty, and deadline, it's ready to
                be prioritized and scheduled like everything else.
              </Step>
            </div>

            <Separator />
            <p className="text-xs text-muted-foreground">
              <b>Bottom line:</b> AI only helps at the moment you create a task. Every decision
              after that — ranking and scheduling — is based on clear rules you can trust.
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Card>
        <CardHeader><CardTitle className="font-display text-lg">A quick example, start to finish</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p className="italic">"Finish client proposal — due tomorrow 5pm, about 90 minutes, Freelancing."</p>
          <ol className="list-decimal list-inside space-y-1 text-xs">
            <li><b>Reader:</b> spots it's a Freelancing task, medium difficulty, roughly 90 minutes.</li>
            <li><b>Coach:</b> knows freelance tasks usually take you 15% longer, so the estimate becomes about 104 minutes.</li>
            <li><b>Ranker:</b> due in under 24 hours + medium difficulty + short-ish + important category → score around 78 → marked <b>high</b>.</li>
            <li><b>Planner:</b> picks 9:00–10:44 AM because that's inside your peak window (9–11 AM).</li>
            <li><b>Safety check:</b> nothing else is booked then → the block is added to your Today page.</li>
            <li><b>After you finish:</b> actual time was 96 minutes → the Coach updates its notes so next time is even more accurate.</li>
          </ol>
        </CardContent>
      </Card>
    </motion.div>
  );
}
