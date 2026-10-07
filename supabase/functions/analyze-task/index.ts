import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * analyze-task — Maximum Task Consistency Validation
 *
 * Multi-factor title ↔ description validation:
 * 1. Semantic similarity (embeddings + cosine)
 * 2. Task intent extraction (action, object, domain, purpose)
 * 3. Action / object / domain / purpose matching
 * 4. Category consistency
 * 5. Contradiction detection
 * 6. Completeness & repetition detection
 * 7. AI semantic judgment
 *
 * NLP never overwrites user duration, difficulty, category, or deadline.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Configurable — tune with real GSI examples. */
const THRESHOLDS = {
  HIGH: 0.75,
  MEDIUM: 0.55,
};

/** Configurable multi-factor weights (must sum ~1). */
const WEIGHTS = {
  semantic_similarity: 0.30,
  intent_match: 0.20,
  action_match: 0.15,
  object_match: 0.10,
  domain_match: 0.10,
  category_match: 0.05,
  purpose_match: 0.05,
  completeness: 0.05,
};

const VA_CATEGORIES = [
  "Client Communication",
  "Customer Support",
  "Email Management",
  "Calendar & Scheduling",
  "Administrative Tasks",
  "Data Entry",
  "Research",
  "Report & Documentation",
  "File & Document Management",
  "Project Coordination",
  "Lead Generation",
  "CRM Management",
  "Social Media Management",
  "Content Creation",
  "E-commerce Support",
  "Bookkeeping & Finance",
  "Meeting & Coordination",
  "Personal Assistance",
  "General / Other",
] as const;

const VA_CATEGORY_SET = new Set<string>(VA_CATEGORIES);

const VAGUE_PATTERNS = [
  /^do it\.?$/i,
  /^work on it\.?$/i,
  /^report\.?$/i,
  /^finish this\.?$/i,
  /^handle this\.?$/i,
  /^important\.?$/i,
  /^task\.?$/i,
  /^todo\.?$/i,
  /^tbd\.?$/i,
  /^n\/?a\.?$/i,
  /^see title\.?$/i,
  /^as above\.?$/i,
  /^same\.?$/i,
];

function normalizeVACategory(value?: string): string {
  const category = String(value || "").trim();
  const aliases: Record<string, string> = {
    "Calendar Scheduling": "Calendar & Scheduling",
    "Project Tracking": "Project Coordination",
    "Research Task": "Research",
    Bookkeeping: "Bookkeeping & Finance",
    Invoicing: "Bookkeeping & Finance",
    "Meeting Notes": "Meeting & Coordination",
    Finance: "Bookkeeping & Finance",
    "Office Work": "Administrative Tasks",
    "Virtual Assistant": "Administrative Tasks",
    Freelancing: "General / Other",
    General: "General / Other",
    Other: "General / Other",
  };
  const normalized = aliases[category] || category;
  return VA_CATEGORY_SET.has(normalized) ? normalized : "General / Other";
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extractJsonObject(text: string): unknown {
  if (!text) throw new Error("Empty AI response");
  let s = text.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return Math.min(1, Math.max(0, dot / denom));
}

function basicTextRelatedness(title: string, description: string): number {
  const stop = new Set([
    "a", "an", "the", "and", "or", "to", "of", "in", "on", "for", "with",
    "is", "are", "be", "by", "at", "from", "as", "it", "this", "that",
    "task", "work", "do", "please", "will", "can", "should",
  ]);
  const tokens = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .filter((t) => t.length > 2 && !stop.has(t));
  const tTokens = tokens(title);
  const dTokens = tokens(description);
  if (!tTokens.length || !dTokens.length) return 0;
  const dSet = new Set(dTokens);
  let hits = 0;
  for (const t of tTokens) if (dSet.has(t)) hits++;
  return hits / tTokens.length;
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function localRepetitionCheck(title: string, description: string): {
  repetition: boolean;
  repetition_type: "exact" | "near" | "semantic" | null;
} {
  const t = normalizeText(title);
  const d = normalizeText(description);
  if (!t || !d) return { repetition: false, repetition_type: null };
  if (t === d) return { repetition: true, repetition_type: "exact" };
  if (d === t || d.startsWith(t) || t.startsWith(d)) {
    if (Math.abs(d.length - t.length) < Math.max(12, t.length * 0.35)) {
      return { repetition: true, repetition_type: "near" };
    }
  }
  // Token Jaccard near-duplicate
  const tSet = new Set(t.split(" ").filter((w) => w.length > 2));
  const dSet = new Set(d.split(" ").filter((w) => w.length > 2));
  if (tSet.size && dSet.size) {
    let inter = 0;
    for (const w of tSet) if (dSet.has(w)) inter++;
    const union = new Set([...tSet, ...dSet]).size;
    const jaccard = inter / union;
    if (jaccard >= 0.85 && Math.abs(d.length - t.length) < 40) {
      return { repetition: true, repetition_type: "semantic" };
    }
  }
  return { repetition: false, repetition_type: null };
}

function localCompleteness(description: string): number {
  const d = description.trim();
  if (!d) return 0;
  if (VAGUE_PATTERNS.some((re) => re.test(d))) return 0.1;
  if (d.length < 12) return 0.2;
  if (d.length < 25) return 0.4;
  if (d.split(/\s+/).length < 5) return 0.45;
  if (d.length < 50) return 0.65;
  return 0.85;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

async function embedText(apiKey: string, text: string): Promise<number[] | null> {
  const models = ["text-embedding-004", "embedding-001", "text-embedding-005"];
  const truncated = text.slice(0, 8000);
  for (const model of models) {
    try {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          model: `models/${model}`,
          content: { parts: [{ text: truncated }] },
        }),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const values = json?.embedding?.values;
      if (Array.isArray(values) && values.length > 0) return values as number[];
    } catch {
      /* try next */
    }
  }
  return null;
}

function modelCandidates(): string[] {
  return [
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
    "gemini-2.5-flash",
    "gemini-flash-latest",
  ];
}

type FactorScores = {
  semantic_similarity: number;
  intent_match: number;
  action_match: number;
  object_match: number;
  domain_match: number;
  purpose_match: number;
  category_match: number;
  completeness: number;
  contradiction: boolean;
  repetition: boolean;
  repetition_type: string | null;
};

function computeWeightedScore(f: FactorScores): number {
  let score =
    WEIGHTS.semantic_similarity * f.semantic_similarity +
    WEIGHTS.intent_match * f.intent_match +
    WEIGHTS.action_match * f.action_match +
    WEIGHTS.object_match * f.object_match +
    WEIGHTS.domain_match * f.domain_match +
    WEIGHTS.category_match * f.category_match +
    WEIGHTS.purpose_match * f.purpose_match +
    WEIGHTS.completeness * f.completeness;

  // Contradiction must not be overridden by high similarity alone
  if (f.contradiction) {
    score = Math.min(score, 0.35);
  }
  // Heavy repetition / low completeness caps the score into REVIEW band
  if (f.repetition && f.completeness < 0.5) {
    score = Math.min(score, 0.68);
  }
  if (f.completeness < 0.35) {
    score = Math.min(score, 0.6);
  }
  return clamp01(score);
}

function classifyFromFactors(
  score: number,
  f: FactorScores,
): "VALID" | "REVIEW" | "INVALID" {
  if (f.contradiction) {
    return score < 0.25 ? "INVALID" : "INVALID";
  }
  // Clearly unrelated dimensions
  const relatednessAvg =
    (f.action_match + f.object_match + f.domain_match + f.purpose_match) / 4;
  if (
    f.semantic_similarity < 0.35 &&
    relatednessAvg < 0.3 &&
    f.intent_match < 0.3
  ) {
    return "INVALID";
  }
  if (score >= 0.82 && !f.repetition && f.completeness >= 0.55) {
    return "VALID";
  }
  if (score >= THRESHOLDS.HIGH && f.completeness >= 0.5 && !f.contradiction) {
    return "VALID";
  }
  if (score < 0.4) return "INVALID";
  return "REVIEW";
}

function buildUserMessage(
  status: "VALID" | "REVIEW" | "INVALID",
  f: FactorScores,
  aiReason: string,
  categoryWarning: string | null,
): string {
  if (status === "VALID") {
    return aiReason || "The description is consistent with the task title.";
  }
  if (f.contradiction) {
    return (
      aiReason ||
      "The description conflicts with the task title. Please describe work that matches this task."
    );
  }
  if (f.repetition) {
    return "Your description is very similar to the task title. Add more details about the actual work.";
  }
  if (f.completeness < 0.4) {
    return "Your description is too vague. Add specific details about what needs to be done.";
  }
  if (categoryWarning) {
    return categoryWarning;
  }
  if (status === "INVALID") {
    return (
      aiReason ||
      "The description does not match the task title. Please describe the work involved in this task."
    );
  }
  return (
    aiReason ||
    "Please review your description. It may not fully match the task title."
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  console.log("analyze-task: maximum multi-factor validation");

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, 400);
    }

    const title = typeof body.title === "string" ? body.title.trim() : "";
    const description =
      typeof body.description === "string" ? body.description.trim() : "";
    const userCategory =
      typeof body.category === "string" ? body.category.trim() : "";
    const userDuration =
      typeof body.duration === "number" ? body.duration : undefined;
    const userDifficulty =
      typeof body.difficulty === "string"
        ? body.difficulty.trim().toLowerCase()
        : "";

    if (!title) {
      return jsonResponse({ error: "Task title is required." }, 400);
    }

    // ---------- Early local checks ----------
    if (!description) {
      return jsonResponse({
        ok: true,
        validation: "INVALID",
        related: false,
        confidence: 1,
        reason:
          "Description is empty. Please provide a description related to the task title.",
        message:
          "Description is empty. Please provide a description related to the task title.",
        similarity: 0,
        score: 0,
        validation_detail: {
          status: "INVALID",
          score: 0,
          semantic_similarity: 0,
          intent_match: 0,
          action_match: 0,
          object_match: 0,
          domain_match: 0,
          purpose_match: 0,
          category_match: userCategory ? 0.5 : 0.5,
          completeness: 0,
          contradiction: false,
          repetition: false,
          repetition_type: null,
        },
        task_intent: null,
        thresholds: THRESHOLDS,
        weights: WEIGHTS,
        suggestions: null,
      });
    }

    const localRep = localRepetitionCheck(title, description);
    const localComp = localCompleteness(description);
    const basicScore = basicTextRelatedness(title, description);
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

    // ---------- Embeddings ----------
    let similarity: number | null = null;
    let embeddingDegraded = false;
    if (GEMINI_API_KEY) {
      const [titleEmb, descEmb] = await Promise.all([
        embedText(GEMINI_API_KEY, title),
        embedText(GEMINI_API_KEY, description),
      ]);
      if (titleEmb && descEmb) {
        similarity = cosineSimilarity(titleEmb, descEmb);
      } else {
        embeddingDegraded = true;
      }
    } else {
      embeddingDegraded = true;
    }
    const semanticSimilarity = similarity ?? basicScore;

    // ---------- Multi-factor AI analysis ----------
    let aiRelated: boolean | null = null;
    let confidence = 0.5;
    let aiReason = "";
    let taskIntent: {
      action: string[];
      object: string[];
      domain: string;
      purpose: string;
    } | null = null;

    let actionMatch = 0.5;
    let objectMatch = 0.5;
    let domainMatch = 0.5;
    let purposeMatch = 0.5;
    let intentMatch = 0.5;
    let categoryMatch = userCategory ? 0.7 : 0.5;
    let completeness = localComp;
    let contradiction = false;
    let aiRepetition = localRep.repetition;
    let repetitionType = localRep.repetition_type;
    let categoryWarning: string | null = null;

    const suggestions: {
      duration?: number;
      difficulty?: "easy" | "medium" | "hard";
      category?: string;
    } = {};
    let aiDegraded = false;

    if (GEMINI_API_KEY) {
      const systemPrompt = `
You are the Maximum Task Consistency Validator for the GSI Schedule Planner (Virtual Assistant tasks).

Analyze TITLE vs DESCRIPTION across multiple dimensions. Understand synonyms
(e.g. log≈record, categorize≈classify, bugs≈software issues).

Return ONLY one valid JSON object with this exact structure:

{
  "related": boolean,
  "confidence": number,
  "reason": string,
  "task_intent": {
    "action": string[],
    "object": string[],
    "domain": string,
    "purpose": string
  },
  "scores": {
    "intent_match": number,
    "action_match": number,
    "object_match": number,
    "domain_match": number,
    "purpose_match": number,
    "category_match": number,
    "completeness": number
  },
  "contradiction": boolean,
  "repetition": boolean,
  "repetition_type": "exact" | "near" | "semantic" | null,
  "category_warning": string | null,
  "suggested_duration": number | null,
  "suggested_difficulty": "easy" | "medium" | "hard" | null,
  "suggested_category": string | null
}

Scoring rules (each score 0 to 1):
- action_match: does description perform/contribute to title actions?
- object_match: same main object/target?
- domain_match: same work domain (software/IT, communication, reporting, etc.)?
- purpose_match: same successful outcome?
- intent_match: overall intent alignment
- category_match: does USER category fit title+description? (1 if consistent, ~0.3 if mismatch, 0.5 if no category)
- completeness: does description contain useful work details? (not vague like "do it")

contradiction: true if description conflicts with or negates the title (e.g. "do not respond" for "Respond to emails", or completely different activity like games vs report).

repetition: true if description only restates the title with little extra detail.

category_warning: short user-facing warning if category mismatches, else null.
Example: "Your selected category may not match this task."

reason: one clear sentence a normal user understands. Explain WHAT is wrong or right.
Do NOT say only "similarity score too low."

Suggestions are OPTIONAL recommendations only — never final values.
suggested_category must be exactly one of:
${VA_CATEGORIES.join(", ")}

No Markdown. JSON only.
`;

      const userPrompt = `
TASK TITLE:
${title}

TASK DESCRIPTION:
${description}

USER SELECTED CATEGORY:
${userCategory || "(none)"}

USER SELECTED DURATION (minutes):
${userDuration ?? "(none)"}

USER SELECTED DIFFICULTY:
${userDifficulty || "(none)"}
`;

      const requestBody = {
        contents: [
          {
            role: "user",
            parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      };

      let gotAi = false;
      for (const model of modelCandidates()) {
        try {
          const url =
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": GEMINI_API_KEY,
            },
            body: JSON.stringify(requestBody),
          });
          if (res.status === 401 || res.status === 403) {
            return jsonResponse(
              { error: "Gemini API authorization failed. Check GEMINI_API_KEY." },
              502,
            );
          }
          if (res.status === 429) {
            return jsonResponse(
              { error: "Gemini rate limit reached. Please try again shortly." },
              429,
            );
          }
          if (!res.ok) continue;

          const aiJson = JSON.parse(await res.text());
          const parts = aiJson?.candidates?.[0]?.content?.parts;
          let content = "";
          if (Array.isArray(parts)) {
            content = parts
              .map((p: { text?: string }) =>
                typeof p?.text === "string" ? p.text : "",
              )
              .join("");
          }
          if (!content.trim()) continue;

          const parsed = extractJsonObject(content) as Record<string, unknown>;
          aiRelated = Boolean(parsed.related);
          confidence = clamp01(Number(parsed.confidence) || 0.7);
          aiReason =
            typeof parsed.reason === "string" ? parsed.reason.trim() : "";

          const intent = parsed.task_intent as Record<string, unknown> | undefined;
          if (intent && typeof intent === "object") {
            taskIntent = {
              action: Array.isArray(intent.action)
                ? intent.action.map(String)
                : [],
              object: Array.isArray(intent.object)
                ? intent.object.map(String)
                : [],
              domain: String(intent.domain || ""),
              purpose: String(intent.purpose || ""),
            };
          }

          const scores = parsed.scores as Record<string, unknown> | undefined;
          if (scores && typeof scores === "object") {
            actionMatch = clamp01(Number(scores.action_match) ?? 0.5);
            objectMatch = clamp01(Number(scores.object_match) ?? 0.5);
            domainMatch = clamp01(Number(scores.domain_match) ?? 0.5);
            purposeMatch = clamp01(Number(scores.purpose_match) ?? 0.5);
            intentMatch = clamp01(Number(scores.intent_match) ?? 0.5);
            categoryMatch = clamp01(
              Number(scores.category_match) ?? (userCategory ? 0.7 : 0.5),
            );
            const aiComp = Number(scores.completeness);
            if (Number.isFinite(aiComp)) {
              completeness = clamp01(Math.min(localComp + 0.15, aiComp));
              // Prefer stricter of local vs AI for vague phrases
              completeness = Math.min(completeness, localComp + 0.2);
              completeness = clamp01(
                Math.min(completeness, Number.isFinite(aiComp) ? aiComp : completeness),
              );
              // blend: take min for safety on vague
              completeness = clamp01(Math.min(localComp, clamp01(aiComp)) * 0.4 +
                Math.max(localComp, clamp01(aiComp)) * 0.6);
            }
          }

          contradiction = Boolean(parsed.contradiction);
          if (Boolean(parsed.repetition)) {
            aiRepetition = true;
            const rt = String(parsed.repetition_type || "semantic");
            if (["exact", "near", "semantic"].includes(rt)) {
              repetitionType = rt as "exact" | "near" | "semantic";
            } else if (!repetitionType) {
              repetitionType = "semantic";
            }
          }
          if (typeof parsed.category_warning === "string" && parsed.category_warning.trim()) {
            categoryWarning = parsed.category_warning.trim();
          }

          const sugDuration = Number(parsed.suggested_duration);
          if (Number.isFinite(sugDuration)) {
            suggestions.duration = Math.round(
              Math.min(480, Math.max(5, sugDuration)),
            );
          }
          const sugDiff = String(parsed.suggested_difficulty || "").toLowerCase();
          if (["easy", "medium", "hard"].includes(sugDiff)) {
            suggestions.difficulty = sugDiff as "easy" | "medium" | "hard";
          }
          const sugCat = String(parsed.suggested_category || "").trim();
          if (sugCat) suggestions.category = normalizeVACategory(sugCat);

          gotAi = true;
          console.log("analyze-task: multi-factor AI ok", model);
          break;
        } catch (e) {
          console.warn("analyze-task: AI attempt failed", model, e);
        }
      }
      if (!gotAi) aiDegraded = true;
    } else {
      aiDegraded = true;
    }

    // If AI degraded, derive rough factor scores from semantic + basic
    if (aiDegraded) {
      actionMatch = semanticSimilarity;
      objectMatch = semanticSimilarity;
      domainMatch = semanticSimilarity;
      purposeMatch = semanticSimilarity;
      intentMatch = semanticSimilarity;
      categoryMatch = userCategory ? 0.6 : 0.5;
      aiReason =
        semanticSimilarity >= THRESHOLDS.HIGH
          ? "Description appears related to the title (AI unavailable; used embedding similarity)."
          : semanticSimilarity >= THRESHOLDS.MEDIUM
            ? "Description may not fully match the title. Please review."
            : "Description does not appear related to the title.";
    }

    // Apply local completeness floor for known vague phrases
    if (VAGUE_PATTERNS.some((re) => re.test(description.trim()))) {
      completeness = Math.min(completeness, 0.15);
    }
    if (localRep.repetition) {
      aiRepetition = true;
      if (!repetitionType) repetitionType = localRep.repetition_type;
      completeness = Math.min(completeness, 0.4);
    }

    const factors: FactorScores = {
      semantic_similarity: clamp01(semanticSimilarity),
      intent_match: clamp01(intentMatch),
      action_match: clamp01(actionMatch),
      object_match: clamp01(objectMatch),
      domain_match: clamp01(domainMatch),
      purpose_match: clamp01(purposeMatch),
      category_match: clamp01(categoryMatch),
      completeness: clamp01(completeness),
      contradiction,
      repetition: aiRepetition,
      repetition_type: repetitionType,
    };

    const score = computeWeightedScore(factors);
    let status = classifyFromFactors(score, factors);

    // Soften: repetition alone → REVIEW not INVALID
    if (status === "INVALID" && factors.repetition && !factors.contradiction && factors.semantic_similarity >= 0.55) {
      status = "REVIEW";
    }

    const message = buildUserMessage(
      status,
      factors,
      aiReason,
      categoryWarning,
    );

    const related =
      status === "VALID" ||
      (status === "REVIEW" && !factors.contradiction);

    // Legacy fields for older clients (not authoritative)
    const legacyDuration = suggestions.duration ?? 30;
    const legacyDifficulty = suggestions.difficulty ?? "medium";
    const legacyCategory =
      userCategory && VA_CATEGORY_SET.has(userCategory)
        ? userCategory
        : suggestions.category ?? "General / Other";

    console.log("analyze-task: result", { status, score, factors });

    return jsonResponse({
      ok: true,
      // Primary (backward compatible top-level)
      validation: status,
      related,
      confidence: aiRelated != null ? confidence : score,
      reason: message,
      message,
      similarity: Math.round(factors.semantic_similarity * 1000) / 1000,
      score: Math.round(score * 1000) / 1000,
      // Structured multi-factor detail
      validation_detail: {
        status,
        score: Math.round(score * 1000) / 1000,
        semantic_similarity: Math.round(factors.semantic_similarity * 1000) / 1000,
        intent_match: Math.round(factors.intent_match * 1000) / 1000,
        action_match: Math.round(factors.action_match * 1000) / 1000,
        object_match: Math.round(factors.object_match * 1000) / 1000,
        domain_match: Math.round(factors.domain_match * 1000) / 1000,
        purpose_match: Math.round(factors.purpose_match * 1000) / 1000,
        category_match: Math.round(factors.category_match * 1000) / 1000,
        completeness: Math.round(factors.completeness * 1000) / 1000,
        contradiction: factors.contradiction,
        repetition: factors.repetition,
        repetition_type: factors.repetition_type,
      },
      task_intent: taskIntent,
      category_warning: categoryWarning,
      thresholds: THRESHOLDS,
      weights: WEIGHTS,
      suggestions:
        Object.keys(suggestions).length > 0 ? suggestions : null,
      degraded: embeddingDegraded || aiDegraded,
      embedding_available: similarity != null,
      // Legacy
      duration: legacyDuration,
      difficulty: legacyDifficulty,
      category: legacyCategory,
      priority: "medium",
      corrected_description: description,
      basic_score: Math.round(basicScore * 1000) / 1000,
    });
  } catch (err) {
    console.error("analyze-task: unexpected error", err);
    return jsonResponse(
      {
        error: "Unexpected error during task analysis.",
        details: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});
