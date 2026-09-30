import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// AHP Saaty pairwise matrix for 4 criteria:
// C1 deadline_proximity, C2 difficulty, C3 duration_inverse (shorter = more urgent slot), C4 category_importance
// Importance ranking: deadline > difficulty > duration > category
const SAATY_MATRIX: number[][] = [
  [1,   3,   4,   5],
  [1/3, 1,   2,   3],
  [1/4, 1/2, 1,   2],
  [1/5, 1/3, 1/2, 1],
];

// Random Consistency Index for n=4 (Saaty)
const RI_N4 = 0.90;

function powerIterationEigenvector(matrix: number[][], iterations = 100): { weights: number[]; lambdaMax: number } {
  const n = matrix.length;
  let v = new Array(n).fill(1 / n);
  let lambdaMax = 0;
  for (let it = 0; it < iterations; it++) {
    const next = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) next[i] += matrix[i][j] * v[j];
    }
    const norm = next.reduce((a, b) => a + b, 0) || 1;
    const normalized = next.map(x => x / norm);
    // Estimate lambda max via Rayleigh-style: average of (Av)_i / v_i
    let lam = 0;
    let counted = 0;
    for (let i = 0; i < n; i++) {
      if (v[i] > 1e-9) { lam += next[i] / v[i]; counted++; }
    }
    lambdaMax = counted ? lam / counted : n;
    v = normalized;
  }
  return { weights: v, lambdaMax };
}

const VA_CATEGORY_IMPORTANCE: Record<string, number> = {
  "Client Communication": 0.95,
  "Customer Support": 0.95,
  "Email Management": 0.80,
  "Calendar & Scheduling": 0.85,
  "Administrative Tasks": 0.75,
  "Data Entry": 0.65,
  "Research": 0.80,
  "Report & Documentation": 0.85,
  "File & Document Management": 0.65,
  "Project Coordination": 0.90,
  "Lead Generation": 0.85,
  "CRM Management": 0.80,
  "Social Media Management": 0.75,
  "Content Creation": 0.75,
  "E-commerce Support": 0.80,
  "Bookkeeping & Finance": 0.90,
  "Meeting & Coordination": 0.80,
  "Personal Assistance": 0.60,
  "General / Other": 0.50,
};

function difficultyScore(d?: string): number {
  if (d === "hard") return 1.0;
  if (d === "easy") return 0.3;
  return 0.6; // medium / default
}

function durationScore(min?: number): number {
  // Shorter tasks score higher (easier to slot in immediately)
  const m = min || 30;
  if (m <= 15) return 1.0;
  if (m <= 30) return 0.8;
  if (m <= 60) return 0.6;
  if (m <= 120) return 0.4;
  return 0.2;
}

function deadlineScore(due?: string | null): number {
  if (!due) return 0.15;
  const hoursLeft = (new Date(due).getTime() - Date.now()) / 3_600_000;
  if (hoursLeft < 0) return 1.0;          // overdue
  if (hoursLeft < 24) return 0.9;
  if (hoursLeft < 72) return 0.7;
  if (hoursLeft < 168) return 0.45;
  if (hoursLeft < 336) return 0.25;
  return 0.1;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader! } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: tasks } = await supabase.from("tasks").select("*").neq("status", "done").eq("user_id", user.id).or("archived.eq.false,archived.is.null");
    if (!tasks || tasks.length === 0) {
      return new Response(JSON.stringify({ tasks: [], algorithm: "ahp-saaty", timestamp: new Date().toISOString() }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { weights, lambdaMax } = powerIterationEigenvector(SAATY_MATRIX);
    const n = SAATY_MATRIX.length;
    const ci = (lambdaMax - n) / (n - 1);
    const cr = ci / RI_N4;
    const consistent = cr < 0.10;

    const ranked = tasks.map((t: any) => {
      const c1 = deadlineScore(t.due_date);
      const c2 = difficultyScore(t.difficulty);
      const c3 = durationScore(t.estimated_duration);
      const c4 = VA_CATEGORY_IMPORTANCE[t.category] ?? VA_CATEGORY_IMPORTANCE["General / Other"];
      const score = (c1 * weights[0] + c2 * weights[1] + c3 * weights[2] + c4 * weights[3]) * 100;
      const priority = score >= 65 ? "high" : score >= 40 ? "medium" : "low";

      const reasons: string[] = [];
      if (c1 >= 0.9) reasons.push("deadline is imminent or overdue");
      else if (c1 >= 0.7) reasons.push("due within 72 hours");
      if (c2 >= 0.9) reasons.push("high difficulty needs focus");
      if (c3 >= 0.8) reasons.push("short duration — quick to clear");
      if (c4 >= 0.85) reasons.push("high-importance category");
      if (!reasons.length) reasons.push("balanced AHP score across criteria");

      return {
        id: t.id,
        title: t.title,
        score: Math.round(score * 10) / 10,
        priority,
        reasoning: reasons.join("; "),
        criteria: { deadline: c1, difficulty: c2, duration: c3, category: c4 },
      };
    }).sort((a, b) => b.score - a.score);

    return new Response(JSON.stringify({
      tasks: ranked,
      task_count: ranked.length,
      task_ids: ranked.map((t: any) => t.id),
      ahp: {
        weights: { deadline: weights[0], difficulty: weights[1], duration: weights[2], category: weights[3] },
        lambda_max: lambdaMax,
        consistency_index: ci,
        consistency_ratio: cr,
        consistent,
      },
      algorithm: "ahp-saaty-power-iteration",
      timestamp: new Date().toISOString(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("rank-priorities error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
