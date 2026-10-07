import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * analyze-task Edge Function — Title/Description semantic validation + optional suggestions
 *
 * Architecture change (GSI Schedule Planner):
 * - NLP does NOT invent authoritative duration, difficulty, category, or deadline.
 * - Those come from structured user input (or Focus Mode for actual_duration).
 * - This function validates semantic relatedness between title and description
 *   and may return OPTIONAL suggestions the user can accept or ignore.
 *
 * Response shape:
 * {
 *   ok: true,
 *   validation: "VALID" | "REVIEW" | "INVALID",
 *   related: boolean,
 *   confidence: number,          // 0–1 AI judgment confidence
 *   reason: string,
 *   suggestions?: {
 *     duration?: number,         // minutes, optional recommendation only
 *     difficulty?: "easy"|"medium"|"hard",
 *     category?: string
 *   }
 * }
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Configurable thresholds for combined validation (tune with real GSI examples). */
const THRESHOLDS = {
  HIGH: 0.75, // >= HIGH + AI related → VALID
  MEDIUM: 0.55, // MEDIUM–HIGH → REVIEW
  // < MEDIUM → INVALID (unless AI strongly says related — still REVIEW)
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
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
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
  if (start >= 0 && end > start) {
    s = s.slice(start, end + 1);
  }
  return JSON.parse(s);
}

/** Simple token-overlap relatedness as a basic text signal (0–1). */
function basicTextRelatedness(title: string, description: string): number {
  const stop = new Set([
    "a", "an", "the", "and", "or", "to", "of", "in", "on", "for", "with",
    "is", "are", "be", "by", "at", "from", "as", "it", "this", "that",
    "task", "work", "do", "please", "will", "can", "should",
  ]);
  const tokens = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !stop.has(t));

  const tTokens = tokens(title);
  const dTokens = tokens(description);
  if (tTokens.length === 0 || dTokens.length === 0) return 0;

  const dSet = new Set(dTokens);
  let hits = 0;
  for (const t of tTokens) {
    if (dSet.has(t)) hits++;
  }
  // Jaccard-ish on title side
  return hits / tTokens.length;
}

function classifyValidation(
  aiRelated: boolean,
  confidence: number,
  basicScore: number,
): "VALID" | "REVIEW" | "INVALID" {
  // Combined: AI judgment is primary; basic text is secondary signal.
  // Prefer not being excessively strict on differently worded legitimate descriptions.
  if (aiRelated && confidence >= THRESHOLDS.HIGH) {
    return "VALID";
  }
  if (aiRelated && confidence >= THRESHOLDS.MEDIUM) {
    return basicScore >= 0.2 || confidence >= 0.65 ? "VALID" : "REVIEW";
  }
  if (!aiRelated && confidence >= THRESHOLDS.HIGH) {
    return "INVALID";
  }
  if (!aiRelated && confidence >= THRESHOLDS.MEDIUM) {
    return basicScore < 0.15 ? "INVALID" : "REVIEW";
  }
  // Low confidence either way
  if (basicScore >= THRESHOLDS.MEDIUM) return "REVIEW";
  if (basicScore < 0.15 && !aiRelated) return "INVALID";
  return "REVIEW";
}

async function getAvailableModel(_apiKey: string): Promise<string> {
  const preferred = [
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
    "gemini-2.5-flash",
    "gemini-flash-latest",
  ];
  return preferred[0];
}

function modelCandidates(primary: string): string[] {
  const rest = [
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
    "gemini-2.5-flash",
    "gemini-flash-latest",
  ].filter((m) => m !== primary);
  return [primary, ...rest];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  console.log("analyze-task: started (semantic validation mode)");

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, 400);
    }

    const title =
      typeof body.title === "string" ? body.title.trim() : "";
    const description =
      typeof body.description === "string" ? body.description.trim() : "";
    const userCategory =
      typeof body.category === "string" ? body.category.trim() : "";
    const userDuration =
      typeof body.duration === "number" ? body.duration : undefined;
    const userDifficulty =
      typeof body.difficulty === "string" ? body.difficulty.trim().toLowerCase() : "";

    if (!title) {
      return jsonResponse({ error: "Task title is required." }, 400);
    }

    // Empty description: cannot validate relatedness meaningfully
    if (!description) {
      return jsonResponse({
        ok: true,
        validation: "INVALID",
        related: false,
        confidence: 1,
        reason: "Description is empty. Please provide a description related to the task title.",
        basic_score: 0,
        thresholds: THRESHOLDS,
        suggestions: null,
      });
    }

    const basicScore = basicTextRelatedness(title, description);

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is missing.");
      // Graceful degradation: use basic text only
      const validation =
        basicScore >= THRESHOLDS.HIGH
          ? "VALID"
          : basicScore >= THRESHOLDS.MEDIUM
            ? "REVIEW"
            : "INVALID";
      return jsonResponse({
        ok: true,
        validation,
        related: validation !== "INVALID",
        confidence: basicScore,
        reason:
          validation === "VALID"
            ? "Basic text overlap suggests the description relates to the title (AI unavailable)."
            : validation === "REVIEW"
              ? "Description may not fully match the title (AI unavailable). Please review."
              : "Description does not appear related to the title (AI unavailable).",
        basic_score: basicScore,
        thresholds: THRESHOLDS,
        suggestions: null,
        degraded: true,
      });
    }

    const primaryModel = await getAvailableModel(GEMINI_API_KEY);
    const modelsToTry = modelCandidates(primaryModel);

    const systemPrompt = `
You are the semantic validation assistant for the GSI Schedule Planner.

Your PRIMARY job is to judge whether the TASK DESCRIPTION is semantically related to the TASK TITLE.
Legitimate descriptions may use different wording from the title — that is still VALID if the meaning matches.

Return ONLY one valid JSON object with these fields:

related: boolean
  - true if the description is about the same work as the title
  - false if the description is clearly unrelated (e.g. title about logging bugs, description about drinking water)

confidence: number between 0 and 1
  - how confident you are in the related judgment

reason: string
  - one short sentence explaining the judgment

suggested_duration: integer minutes (optional recommendation only)
  - reasonable estimate for this task type
  - min 5, max 480
  - This is ONLY a suggestion; the user provides the authoritative duration

suggested_difficulty: "easy" | "medium" | "hard" (optional recommendation only)
  - Guidelines:
    EASY: simple steps, low decision-making, usually short, little research
    MEDIUM: several steps, moderate decision-making, may need research/coordination
    HARD: many steps, significant decision-making, complex problem solving, high cognitive load
  - This is ONLY a suggestion; the user selects the authoritative difficulty

suggested_category: string (optional recommendation only)
  - EXACTLY one from this list:
    Client Communication, Customer Support, Email Management, Calendar & Scheduling,
    Administrative Tasks, Data Entry, Research, Report & Documentation,
    File & Document Management, Project Coordination, Lead Generation, CRM Management,
    Social Media Management, Content Creation, E-commerce Support, Bookkeeping & Finance,
    Meeting & Coordination, Personal Assistance, General / Other
  - If the user already selected a category, prefer keeping it unless clearly wrong
  - This is ONLY a suggestion; the user selects the authoritative category

Do NOT invent a deadline.
Do NOT claim your suggestions are final values.
Do NOT return Markdown or explanation outside the JSON.
`;

    const userPrompt = `
TASK TITLE:
${title}

TASK DESCRIPTION:
${description}

USER SELECTED CATEGORY (if any):
${userCategory || "(none)"}

USER SELECTED DURATION (minutes, if any):
${userDuration ?? "(none)"}

USER SELECTED DIFFICULTY (if any):
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
        temperature: 0.15,
        responseMimeType: "application/json",
      },
    };

    let responseText = "";
    let model = modelsToTry[0];
    let lastStatus = 0;
    let aiResponse: Response | null = null;

    for (const candidate of modelsToTry) {
      model = candidate;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      console.log("analyze-task: calling Gemini:", model);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        body: JSON.stringify(requestBody),
      });

      responseText = await res.text();
      lastStatus = res.status;
      console.log("analyze-task: Gemini status:", model, res.status);

      if (res.ok) {
        aiResponse = res;
        break;
      }

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
    }

    if (!aiResponse) {
      // Fallback to basic score only
      const validation =
        basicScore >= THRESHOLDS.HIGH
          ? "VALID"
          : basicScore >= THRESHOLDS.MEDIUM
            ? "REVIEW"
            : "INVALID";
      return jsonResponse({
        ok: true,
        validation,
        related: validation !== "INVALID",
        confidence: basicScore,
        reason: `AI unavailable (${lastStatus}). Used basic text relatedness.`,
        basic_score: basicScore,
        thresholds: THRESHOLDS,
        suggestions: null,
        degraded: true,
      });
    }

    let aiJson: unknown;
    try {
      aiJson = JSON.parse(responseText);
    } catch {
      return jsonResponse({ error: "Gemini returned an invalid response." }, 502);
    }

    const candidates = Array.isArray((aiJson as any)?.candidates)
      ? (aiJson as any).candidates
      : [];
    const parts = candidates?.[0]?.content?.parts;
    let content = "";
    if (Array.isArray(parts)) {
      content = parts
        .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
        .join("");
    }

    if (!content.trim()) {
      const validation =
        basicScore >= THRESHOLDS.HIGH
          ? "VALID"
          : basicScore >= THRESHOLDS.MEDIUM
            ? "REVIEW"
            : "INVALID";
      return jsonResponse({
        ok: true,
        validation,
        related: validation !== "INVALID",
        confidence: basicScore,
        reason: "AI returned empty content; used basic text relatedness.",
        basic_score: basicScore,
        thresholds: THRESHOLDS,
        suggestions: null,
        degraded: true,
      });
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = extractJsonObject(content) as Record<string, unknown>;
    } catch (e) {
      console.error("Failed to parse AI JSON:", content.slice(0, 500), e);
      const validation =
        basicScore >= THRESHOLDS.HIGH
          ? "VALID"
          : basicScore >= THRESHOLDS.MEDIUM
            ? "REVIEW"
            : "INVALID";
      return jsonResponse({
        ok: true,
        validation,
        related: validation !== "INVALID",
        confidence: basicScore,
        reason: "Could not parse AI judgment; used basic text relatedness.",
        basic_score: basicScore,
        thresholds: THRESHOLDS,
        suggestions: null,
        degraded: true,
      });
    }

    const related = Boolean(parsed.related);
    let confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) confidence = related ? 0.7 : 0.7;
    confidence = Math.min(1, Math.max(0, confidence));

    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim()
        : related
          ? "The description appears related to the task title."
          : "The description does not appear related to the task title.";

    const validation = classifyValidation(related, confidence, basicScore);

    // Optional suggestions — never authoritative
    const suggestions: {
      duration?: number;
      difficulty?: "easy" | "medium" | "hard";
      category?: string;
    } = {};

    let sugDuration = Number(parsed.suggested_duration);
    if (Number.isFinite(sugDuration)) {
      sugDuration = Math.round(Math.min(480, Math.max(5, sugDuration)));
      suggestions.duration = sugDuration;
    }

    const sugDiff = String(parsed.suggested_difficulty || "").toLowerCase();
    if (["easy", "medium", "hard"].includes(sugDiff)) {
      suggestions.difficulty = sugDiff as "easy" | "medium" | "hard";
    }

    const sugCat = String(parsed.suggested_category || "").trim();
    if (sugCat) {
      suggestions.category = normalizeVACategory(sugCat);
    }

    // Backward-compat fields for any residual consumers (NOT used as source of truth)
    const legacyDuration = suggestions.duration ?? 30;
    const legacyDifficulty = suggestions.difficulty ?? "medium";
    const legacyCategory =
      userCategory && VA_CATEGORY_SET.has(userCategory)
        ? userCategory
        : suggestions.category ?? "General / Other";

    console.log("analyze-task: result", {
      validation,
      related,
      confidence,
      basicScore,
    });

    return jsonResponse({
      ok: true,
      validation,
      related,
      confidence,
      reason,
      basic_score: Math.round(basicScore * 1000) / 1000,
      thresholds: THRESHOLDS,
      suggestions:
        Object.keys(suggestions).length > 0 ? suggestions : null,
      // Legacy fields kept so older UI paths do not crash; frontend must not treat them as authoritative
      duration: legacyDuration,
      difficulty: legacyDifficulty,
      category: legacyCategory,
      priority: "medium",
      corrected_description: description,
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
