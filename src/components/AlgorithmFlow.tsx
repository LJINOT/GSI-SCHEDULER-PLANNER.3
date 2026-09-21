import { motion } from "framer-motion";
import { Brain, Target, CalendarDays, Zap, ArrowRight } from "lucide-react";

const stages = [
  { icon: Brain, label: "Reader", sub: "NLP", color: "text-primary", bg: "bg-primary/10", ring: "ring-primary/30" },
  { icon: Target, label: "Ranker", sub: "AHP", color: "text-destructive", bg: "bg-destructive/10", ring: "ring-destructive/30" },
  { icon: CalendarDays, label: "Planner", sub: "PSO + CSP", color: "text-info", bg: "bg-info/10", ring: "ring-info/30" },
  { icon: Zap, label: "Coach", sub: "Learning", color: "text-warning", bg: "bg-warning/10", ring: "ring-warning/30" },
];

export function AlgorithmFlow() {
  return (
    <div className="space-y-6">
      {/* Pipeline */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto pb-2">
        {stages.map((s, i) => (
          <div key={s.label} className="flex items-center gap-2 shrink-0">
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.15 }}
              className={`flex flex-col items-center gap-1 p-3 rounded-xl ${s.bg} ring-1 ${s.ring} min-w-[92px]`}
            >
              <s.icon className={`h-6 w-6 ${s.color}`} />
              <p className="text-xs font-semibold">{s.label}</p>
              <p className="text-[10px] text-muted-foreground">{s.sub}</p>
            </motion.div>
            {i < stages.length - 1 && (
              <motion.div
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.15 + 0.1 }}
              >
                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </motion.div>
            )}
          </div>
        ))}
      </div>

      {/* Animated data flow */}
      <div className="relative h-2 rounded-full bg-muted overflow-hidden">
        <motion.div
          className="absolute top-0 left-0 h-full w-1/4 bg-gradient-to-r from-primary via-info to-warning rounded-full"
          animate={{ x: ["-100%", "400%"] }}
          transition={{ duration: 3.5, repeat: Infinity, ease: "linear" }}
        />
      </div>

      {/* PSO swarm mini-visual */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border p-4 space-y-2">
          <p className="text-xs font-semibold text-info">Planner — swarm converging on best time slot</p>
          <div className="relative h-24 rounded-md bg-muted/40 overflow-hidden">
            {[...Array(8)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute h-2 w-2 rounded-full bg-info"
                initial={{
                  x: Math.random() * 260,
                  y: Math.random() * 80,
                }}
                animate={{
                  x: [Math.random() * 260, 180 + Math.random() * 20, 190],
                  y: [Math.random() * 80, 40 + Math.random() * 10, 44],
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  repeatType: "reverse",
                  delay: i * 0.1,
                }}
              />
            ))}
            <div className="absolute right-3 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-info ring-4 ring-info/30" />
            <div className="absolute bottom-1 left-2 text-[10px] text-muted-foreground">candidate times</div>
            <div className="absolute bottom-1 right-2 text-[10px] text-info font-medium">best slot</div>
          </div>
        </div>

        {/* AHP weights */}
        <div className="rounded-lg border p-4 space-y-2">
          <p className="text-xs font-semibold text-destructive">Ranker — how the score is built</p>
          <div className="space-y-1.5">
            {[
              { label: "Deadline", pct: 55, color: "bg-destructive" },
              { label: "Difficulty", pct: 22, color: "bg-primary" },
              { label: "Duration", pct: 13, color: "bg-info" },
              { label: "Category", pct: 10, color: "bg-warning" },
            ].map((w, i) => (
              <div key={w.label} className="space-y-0.5">
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>{w.label}</span>
                  <span>{w.pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <motion.div
                    className={`h-full ${w.color}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${w.pct}%` }}
                    transition={{ delay: 0.2 + i * 0.1, duration: 0.6 }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
