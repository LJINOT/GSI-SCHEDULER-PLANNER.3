import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * analyze-task — Hybrid semantic validation (embeddings + AI)
 *
 * NLP role:
 * 1. Title ↔ description relatedness (primary: cosine similarity of embeddings)
 * 2. AI structured judgment (secondary: related, confidence, reason)
 * 3. Optional suggestions for duration / difficulty / category (never authoritative)
 *
 * Source of truth for duration, difficulty, category, deadline remains user input.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Tunable thresholds — calibrate with real GSI task examples. */
const THRESHOLDS = {
  HIGH: 0.75,
  MEDIUM: 0.55,
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

/** Cosine similarity of two vectors. Returns 0 if either is empty. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  const raw = dot / denom;
  return Math.min(1, Math.max(0, raw));
}

/** Cheap lexical overlap as fallback / tertiary signal (0–1). */
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
  return hits / tTokens.length;
}

/**
 * Combined decision:
 *   1. Embedding cosine similarity (primary)
 *   2. AI related + confidence (secondary)
 *   3. Basic text overlap (tertiary / fallback)
 */
function classifyValidation(
  similarity: number | null,
  aiRelated: boolean | null,
  confidence: number,
  basicScore: number,
): "VALID" | "REVIEW" | "INVALID" {
  const sim = similarity ?? basicScore;

  if (sim >= THRESHOLDS.HIGH) {
    if (aiRelated === false && confidence >= 0.9) return "REVIEW";
    return "VALID";
  }

  if (sim >= THRESHOLDS.MEDIUM) {
    if (aiRelated === true && confidence >= 0.75) return "VALID";
    if (aiRelated === false && confidence >= 0.85) return "INVALID";
    return "REVIEW";
  }

  if (aiRelated === true && confidence >= 0.85 && basicScore >= 0.25) {
    return "REVIEW";
  }
  if (aiRelated === false && confidence >= 0.7) return "INVALID";
  if (sim < 0.35) return "INVALID";
  return "REVIEW";
}

/** Embed text via Gemini embedding API. Returns null on failure. */
async function embedText(
  apiKey: string,
  text: string,
): Promise<number[] | null> {
  const models = [
    "text-embedding-004",
    "embedding-001",
    "text-embedding-005",
  ];

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
          content: {
            parts: [{ text: truncated }],
          },
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        console.warn(
          `embedText: ${model} failed (${res.status}):`,
          errBody.slice(0, 200),
        );
        continue;
      }

      const json = await res.json();
      const values = json?.embedding?.values;
      if (Array.isArray(values) && values.length > 0) {
        console.log(`embedText: ok with ${model}, dim=${values.length}`);
        return values as number[];
      }
    } catch (e) {
      console.warn(`embedText: ${model} error:`, e);
    }
  }

  return null;
}

async function getAvailableModel(_apiKey: string): Promise<string> {
  return "gemini-2.0-flash";
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

  console.log("analyze-task: started (hybrid embedding + AI validation)");

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
      typeof body.difficulty === "string"
        ? body.difficulty.trim().toLowerCase()
        : "";

    if (!title) {
      return jsonResponse({ error: "Task title is required." }, 400);
    }

    if (!description) {
      return jsonResponse({
        ok: true,
        validation: "INVALID",
        related: false,
        confidence: 1,
        reason:
          "Description is empty. Please provide a description related to the task title.",
        similarity: 0,
        basic_score: 0,
        thresholds: THRESHOLDS,
        suggestions: null,
      });
    }

    if (description.length < 12) {
      return jsonResponse({
        ok: true,
        validation: "INVALID",
        related: false,
        confidence: 0.9,
        reason:
          "Description is too short. Please describe the work involved in this task.",
        similarity: 0,
        basic_score: 0,
        thresholds: THRESHOLDS,
        suggestions: null,
      });
    }

    const titleNorm = title.toLowerCase().replace(/\s+/g, " ").trim();
    const descNorm = description.toLowerCase().replace(/\s+/g, " ").trim();
    if (descNorm === titleNorm || descNorm.startsWith(titleNorm + " ")) {
      if (descNorm.length < titleNorm.length + 20) {
        return jsonResponse({
          ok: true,
          validation: "REVIEW",
          related: true,
          confidence: 0.6,
          reason:
            "Description is almost the same as the title. Please add more detail about the work involved.",
          similarity: 0.5,
          basic_score: 1,
          thresholds: THRESHOLDS,
          suggestions: null,
        });
      }
    }

    const basicScore = basicTextRelatedness(title, description);
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

    // ---------- Embeddings (primary signal) ----------
    let similarity: number | null = null;
    let embeddingDegraded = false;

    if (GEMINI_API_KEY) {
      const [titleEmb, descEmb] = await Promise.all([
        embedText(GEMINI_API_KEY, title),
        embedText(GEMINI_API_KEY, description),
      ]);

      if (titleEmb && descEmb) {
        similarity = cosineSimilarity(titleEmb, descEmb);
        console.log("analyze-task: cosine similarity =", similarity);
      } else {
        embeddingDegraded = true;
        console.warn("analyze-task: embeddings unavailable, using basic + AI");
      }
    } else {
      embeddingDegraded = true;
    }

    // ---------- AI judgment (secondary) ----------
    let aiRelated: boolean | null = null;
    let confidence = 0.5;
    let reason = "";
    const suggestions: {
      duration?: number;
      difficulty?: "easy" | "medium" | "hard";
      category?: string;
    } = {};
    let aiDegraded = false;

    if (GEMINI_API_KEY) {
      const primaryModel = await getAvailableModel(GEMINI_API_KEY);
      const modelsToTry = modelCandidates(primaryModel);

      const systemPrompt = `
You are the semantic validation assistant for the GSI Schedule Planner.

PRIMARY job: judge whether the TASK DESCRIPTION is semantically related to the TASK TITLE.
Legitimate descriptions may use different wording — still VALID if meaning matches.

Return ONLY one valid JSON object:

related: boolean
confidence: number between 0 and 1
reason: string (one short sentence)

suggested_duration: integer minutes (optional, 5–480) — recommendation only
suggested_difficulty: "easy" | "medium" | "hard" (optional) — recommendation only
  EASY: simple steps, low decision-making, usually short
  MEDIUM: several steps, moderate research/coordination
  HARD: many steps, complex problem solving, high cognitive load
suggested_category: exactly one from:
  Client Communication, Customer Support, Email Management, Calendar & Scheduling,
  Administrative Tasks, Data Entry, Research, Report & Documentation,
  File & Document Management, Project Coordination, Lead Generation, CRM Management,
  Social Media Management, Content Creation, E-commerce Support, Bookkeeping & Finance,
  Meeting & Coordination, Personal Assistance, General / Other

Do NOT invent a deadline. Do NOT claim suggestions are final. No Markdown outside JSON.
`;

      const userPrompt = `
TASK TITLE:
${title}

TASK DESCRIPTION:
${description}

USER SELECTED CATEGORY (if any): ${userCategory || "(none)"}
USER SELECTED DURATION (minutes, if any): ${userDuration ?? "(none)"}
USER SELECTED DIFFICULTY (if any): ${userDifficulty || "(none)"}
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
      let lastStatus = 0;
      let gotAi = false;

      for (const model of modelsToTry) {
        const url =
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

        try {
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

          if (res.status === 401 || res.status === 403) {
            return jsonResponse(
              {
                error:
                  "Gemini API authorization failed. Check GEMINI_API_KEY.",
              },
              502,
            );
          }
          if (res.status === 429) {
            return jsonResponse(
              {
                error:
                  "Gemini rate limit reached. Please try again shortly.",
              },
              429,
            );
          }
          if (!res.ok) continue;

          const aiJson = JSON.parse(responseText);
          const candidates = Array.isArray(aiJson?.candidates)
            ? aiJson.candidates
            : [];
          const parts = candidates?.[0]?.content?.parts;
          let content = "";
          if (Array.isArray(parts)) {
            content = parts
              .map((p: { text?: string }) =>
                typeof p?.text === "string" ? p.text : "",
              )
              .join("");
          }
          if (!content.trim()) continue;

          const parsed = extractJsonObject(content) as Record<
            string,
            unknown
          >;
          aiRelated = Boolean(parsed.related);
          confidence = Number(parsed.confidence);
          if (!Number.isFinite(confidence)) {
            confidence = aiRelated ? 0.7 : 0.7;
          }
          confidence = Math.min(1, Math.max(0, confidence));
          reason =
            typeof parsed.reason === "string" && parsed.reason.trim()
              ? parsed.reason.trim()
              : aiRelated
                ? "The description appears related to the task title."
                : "The description does not appear related to the task title.";

          const sugDuration = Number(parsed.suggested_duration);
          if (Number.isFinite(sugDuration)) {
            suggestions.duration = Math.round(
              Math.min(480, Math.max(5, sugDuration)),
            );
          }
          const sugDiff = String(parsed.suggested_difficulty || "")
            .toLowerCase();
          if (["easy", "medium", "hard"].includes(sugDiff)) {
            suggestions.difficulty = sugDiff as
              | "easy"
              | "medium"
              | "hard";
          }
          const sugCat = String(parsed.suggested_category || "").trim();
          if (sugCat) {
            suggestions.category = normalizeVACategory(sugCat);
          }

          gotAi = true;
          console.log("analyze-task: AI ok with", model);
          break;
        } catch (e) {
          console.warn("analyze-task: AI attempt failed", model, e);
        }
      }

      if (!gotAi) {
        aiDegraded = true;
        console.warn(
          "analyze-task: AI unavailable, status=",
          lastStatus,
        );
      }
    } else {
      aiDegraded = true;
    }

    // ---------- Classify ----------
    const validation = classifyValidation(
      similarity,
      aiRelated,
      confidence,
      basicScore,
    );

    if (!reason) {
      if (validation === "VALID") {
        reason =
          similarity != null
            ? `Description is semantically related to the title (similarity ${similarity.toFixed(2)}).`
            : "Description appears related to the title.";
      } else if (validation === "REVIEW") {
        reason =
          "Please review your description. It may not fully match the task title.";
      } else {
        reason =
          "Description does not match the task title. Please describe the work involved in this task.";
      }
    }

    const related =
      validation === "VALID" ||
      (validation === "REVIEW" && aiRelated !== false);

    const legacyDuration = suggestions.duration ?? 30;
    const legacyDifficulty = suggestions.difficulty ?? "medium";
    const legacyCategory =
      userCategory && VA_CATEGORY_SET.has(userCategory)
        ? userCategory
        : suggestions.category ?? "General / Other";

    console.log("analyze-task: result", {
      validation,
      similarity,
      basicScore,
      aiRelated,
      confidence,
    });

    return jsonResponse({
      ok: true,
      validation,
      related,
      confidence: aiRelated != null ? confidence : (similarity ?? basicScore),
      reason,
      similarity:
        similarity != null
          ? Math.round(similarity * 1000) / 1000
          : null,
      basic_score: Math.round(basicScore * 1000) / 1000,
      thresholds: THRESHOLDS,
      suggestions:
        Object.keys(suggestions).length > 0 ? suggestions : null,
      degraded: embeddingDegraded || aiDegraded,
      embedding_available: similarity != null,
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
