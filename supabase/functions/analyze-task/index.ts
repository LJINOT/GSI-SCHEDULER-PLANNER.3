import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * analyze-task — Advanced Context-Aware NLP Validation
 * Three-way consistency: Title↔Description, Title↔Category, Description↔Category
 * Evidence-based recommendations only. Project matching against real user data.
 * Deterministic schema, temperature 0.05, no random fallbacks.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const THRESHOLDS = {
  HIGH: 0.75,
  MEDIUM: 0.55,
  RELATIONSHIP_CONSISTENT: 0.70,
  RELATIONSHIP_MISMATCH: 0.40,
  PROJECT_STRONG_MATCH: 0.72,
  PROJECT_MIN_MARGIN: 0.12,
};

const WEIGHTS = {
  semantic_similarity: 0.25,
  intent_match: 0.18,
  action_match: 0.14,
  object_match: 0.10,
  domain_match: 0.10,
  purpose_match: 0.08,
  category_match: 0.08,
  completeness: 0.07,
};

const VA_CATEGORIES = [
  "Client Communication", "Customer Support", "Email Management",
  "Calendar & Scheduling", "Administrative Tasks", "Data Entry",
  "Research", "Report & Documentation", "File & Document Management",
  "Project Coordination", "Lead Generation", "CRM Management",
  "Social Media Management", "Content Creation", "E-commerce Support",
  "Bookkeeping & Finance", "Meeting & Coordination", "Personal Assistance",
  "General / Other",
] as const;

const VA_CATEGORY_SET = new Set<string>(VA_CATEGORIES);

const VAGUE_PATTERNS = [
  /^do it\.?$/i, /^work on it\.?$/i, /^report\.?$/i, /^finish this\.?$/i,
  /^handle this\.?$/i, /^important\.?$/i, /^task\.?$/i, /^todo\.?$/i,
  /^tbd\.?$/i, /^n\/?a\.?$/i, /^see title\.?$/i, /^as above\.?$/i,
  /^same\.?$/i, /^do some work\.?$/i, /^some work\.?$/i, /^work\.?$/i,
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

function basicTextRelatedness(a: string, b: string): number {
  const stop = new Set([
    "a", "an", "the", "and", "or", "to", "of", "in", "on", "for", "with",
    "is", "are", "be", "by", "at", "from", "as", "it", "this", "that",
    "task", "work", "do", "please", "will", "can", "should",
  ]);
  const tokens = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .filter((t) => t.length > 2 && !stop.has(t));
  const aTokens = tokens(a);
  const bTokens = tokens(b);
  if (!aTokens.length || !bTokens.length) return 0;
  const bSet = new Set(bTokens);
  let hits = 0;
  for (const t of aTokens) if (bSet.has(t)) hits++;
  return hits / aTokens.length;
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
  const tSet = new Set(t.split(" ").filter((w) => w.length > 2));
  const dSet = new Set(d.split(" ").filter((w) => w.length > 2));
  if (tSet.size && dSet.size) {
    let inter = 0;
    for (const w of tSet) if (dSet.has(w)) inter++;
    const union = new Set([...tSet, ...dSet]).size;
    if (inter / union >= 0.85 && Math.abs(d.length - t.length) < 40) {
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
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text: truncated }] } }),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const values = json?.embedding?.values;
      if (Array.isArray(values) && values.length > 0) return values as number[];
    } catch { /* try next */ }
  }
  return null;
}

function modelCandidates(): string[] {
  return ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-latest", "gemini-2.5-flash", "gemini-flash-latest"];
}

type ConsistencyStatus = "consistent" | "mismatch" | "uncertain";

type FactorScores = {
  semantic_similarity: number; intent_match: number; action_match: number;
  object_match: number; domain_match: number; purpose_match: number;
  category_match: number; completeness: number; contradiction: boolean;
  repetition: boolean; repetition_type: string | null;
};

type RelationshipResult = { status: ConsistencyStatus; score: number; explanation: string };

type FieldSuggestion = {
  field: "title" | "description" | "category";
  current: string; suggested: string; reason: string;
} | null;

function computeWeightedScore(f: FactorScores): number {
  let score =
    WEIGHTS.semantic_similarity * f.semantic_similarity +
    WEIGHTS.intent_match * f.intent_match +
    WEIGHTS.action_match * f.action_match +
    WEIGHTS.object_match * f.object_match +
    WEIGHTS.domain_match * f.domain_match +
    WEIGHTS.purpose_match * f.purpose_match +
    WEIGHTS.category_match * f.category_match +
    WEIGHTS.completeness * f.completeness;
  if (f.contradiction) score = Math.min(score, 0.35);
  if (f.repetition && f.completeness < 0.5) score = Math.min(score, 0.68);
  if (f.completeness < 0.35) score = Math.min(score, 0.6);
  return clamp01(score);
}

function classifyRelationship(score: number, contradiction: boolean, vague: boolean): ConsistencyStatus {
  if (contradiction) return "mismatch";
  if (vague) return "uncertain";
  if (score >= THRESHOLDS.RELATIONSHIP_CONSISTENT) return "consistent";
  if (score < THRESHOLDS.RELATIONSHIP_MISMATCH) return "mismatch";
  return "uncertain";
}

function classifyOverall(
  score: number, f: FactorScores,
  titleDesc: ConsistencyStatus, titleCat: ConsistencyStatus, descCat: ConsistencyStatus,
): "VALID" | "REVIEW" | "INVALID" {
  if (f.contradiction) return "INVALID";
  const relatednessAvg = (f.action_match + f.object_match + f.domain_match + f.purpose_match) / 4;
  if (f.semantic_similarity < 0.35 && relatednessAvg < 0.3 && f.intent_match < 0.3) return "INVALID";
  const allConsistent = titleDesc === "consistent" && titleCat === "consistent" && descCat === "consistent";
  if (allConsistent && score >= 0.78 && !f.repetition && f.completeness >= 0.55) return "VALID";
  if (score >= THRESHOLDS.HIGH && f.completeness >= 0.5 && !f.contradiction && titleDesc !== "mismatch") return "VALID";
  if (score < 0.4) return "INVALID";
  return "REVIEW";
}

function decideFieldSuggestion(
  title: string, description: string, category: string,
  titleDesc: RelationshipResult, titleCat: RelationshipResult, descCat: RelationshipResult,
  aiSuggestedTitle: string | null, aiSuggestedDescription: string | null, aiSuggestedCategory: string | null,
  completeness: number, contradiction: boolean,
): FieldSuggestion {
  if (titleDesc.status === "consistent" && titleCat.status === "consistent" && descCat.status === "consistent") return null;
  const consistentCount = [titleDesc.status, titleCat.status, descCat.status].filter((s) => s === "consistent").length;
  if (consistentCount === 0 || contradiction) return null;

  if (titleDesc.status === "consistent" && (titleCat.status === "mismatch" || descCat.status === "mismatch")) {
    if (aiSuggestedCategory && VA_CATEGORY_SET.has(aiSuggestedCategory) && aiSuggestedCategory !== category) {
      return { field: "category", current: category || "(none)", suggested: aiSuggestedCategory,
        reason: "The title and description both describe work that fits a different category than the one selected." };
    }
    return null;
  }

  if (descCat.status === "consistent" && titleDesc.status === "mismatch" && titleCat.status === "mismatch") {
    if (aiSuggestedTitle && aiSuggestedTitle.trim().length >= 5) {
      const cleaned = aiSuggestedTitle.trim();
      if (normalizeText(cleaned) !== normalizeText(title)) {
        return { field: "title", current: title, suggested: cleaned,
          reason: "The description and category both indicate a different kind of work than the current title suggests." };
      }
    }
    return null;
  }

  if (titleCat.status === "consistent" && (titleDesc.status === "mismatch" || (titleDesc.status === "uncertain" && completeness < 0.45))) {
    if (aiSuggestedDescription && aiSuggestedDescription.trim().length >= 15) {
      const cleaned = aiSuggestedDescription.trim();
      if (normalizeText(cleaned) !== normalizeText(description)) {
        return { field: "description", current: description || "(empty)", suggested: cleaned,
          reason: "The title and category agree on the type of work, but the description does not match or is too vague." };
      }
    }
    return null;
  }
  return null;
}

function matchProjects(
  title: string, description: string, category: string,
  projects: Array<{ id: string; name: string; description?: string | null }>,
  selectedProjectId: string | null, taskType: string,
  aiProjectMatch: { id: string; name: string; reason: string } | null,
) {
  if (!projects.length) {
    return { match: null as null, selected_consistent: null as null | boolean,
      message: "No existing projects available for matching, or project data could not be loaded." };
  }

  if (aiProjectMatch) {
    const found = projects.find((p) => p.id === aiProjectMatch.id || normalizeText(p.name) === normalizeText(aiProjectMatch.name));
    if (found) {
      return {
        match: { project_id: found.id, project_name: found.name, relevance: 0.85,
          reason: aiProjectMatch.reason || "The task purpose appears related to this existing project." },
        selected_consistent: selectedProjectId && selectedProjectId !== "none" ? selectedProjectId === found.id : null,
        message: taskType === "standalone" || selectedProjectId === "none"
          ? `Possible matching project: ${found.name}`
          : selectedProjectId === found.id
            ? "The task appears related to the selected project."
            : `This task may fit the project "${found.name}" better.`,
      };
    }
  }

  const taskText = normalizeText(`${title} ${description} ${category}`);
  const scored = projects.map((p) => {
    const nameNorm = normalizeText(p.name);
    const descNorm = normalizeText(p.description || "");
    const nameScore = basicTextRelatedness(taskText, nameNorm);
    const descScore = descNorm ? basicTextRelatedness(taskText, descNorm) : 0;
    let boost = 0;
    if (taskText.includes(nameNorm) && nameNorm.length > 3) boost = 0.25;
    return { project: p, score: clamp01(nameScore * 0.65 + descScore * 0.35 + boost) };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  if (!best || best.score < THRESHOLDS.PROJECT_STRONG_MATCH || (second && best.score - second.score < THRESHOLDS.PROJECT_MIN_MARGIN)) {
    return { match: null, selected_consistent: null,
      message: "No strong project match found. This task can remain stand-alone." };
  }
  const selectedConsistent = selectedProjectId && selectedProjectId !== "none" ? selectedProjectId === best.project.id : null;
  return {
    match: { project_id: best.project.id, project_name: best.project.name,
      relevance: Math.round(best.score * 1000) / 1000,
      reason: "The task's purpose and activities appear related to this existing project." },
    selected_consistent: selectedConsistent,
    message: selectedConsistent === true
      ? "The task appears related to the selected project."
      : selectedConsistent === false
        ? `This task may not fit the selected project's purpose. Consider "${best.project.name}".`
        : `Possible matching project: ${best.project.name}`,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  console.log("analyze-task: advanced three-way consistency validation");

  try {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body." }, 400); }

    const title = typeof body.title === "string" ? body.title.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const userCategory = typeof body.category === "string" ? body.category.trim() : "";
    const userDuration = typeof body.duration === "number" ? body.duration : undefined;
    const userDifficulty = typeof body.difficulty === "string" ? body.difficulty.trim().toLowerCase() : "";
    const selectedProjectId = typeof body.project_id === "string" ? body.project_id.trim() : null;
    const taskType = typeof body.task_type === "string" ? body.task_type.trim().toLowerCase()
      : selectedProjectId && selectedProjectId !== "none" ? "project" : "standalone";

    const rawProjects = Array.isArray(body.projects) ? body.projects : [];
    const projects = rawProjects
      .filter((p): p is Record<string, unknown> => p != null && typeof p === "object" && typeof (p as {id?:unknown}).id === "string")
      .map((p) => ({ id: String(p.id), name: String(p.name || ""), description: typeof p.description === "string" ? p.description : null }))
      .filter((p) => p.name.length > 0);

    if (!title) return jsonResponse({ error: "Task title is required." }, 400);

    if (!description) {
      return jsonResponse({
        ok: true, validation: "INVALID", related: false, confidence: 1,
        reason: "Description is empty. Please provide a description related to the task title.",
        message: "Description is empty. Please provide a description related to the task title.",
        similarity: 0, score: 0,
        relationships: {
          title_description: { status: "mismatch", score: 0, explanation: "Description is empty." },
          title_category: { status: "uncertain", score: 0.5, explanation: "Cannot evaluate without a description." },
          description_category: { status: "mismatch", score: 0, explanation: "Description is empty." },
        },
        field_suggestion: null, project_match: null,
        project_message: "Project matching skipped because description is empty.",
        validation_detail: { status: "INVALID", score: 0, semantic_similarity: 0, intent_match: 0, action_match: 0, object_match: 0, domain_match: 0, purpose_match: 0, category_match: 0.5, completeness: 0, contradiction: false, repetition: false, repetition_type: null },
        task_intent: null, thresholds: THRESHOLDS, weights: WEIGHTS, suggestions: null, ai_degraded: false, embedding_degraded: false, uncertain: true,
      });
    }

    const localRep = localRepetitionCheck(title, description);
    const localComp = localCompleteness(description);
    const basicScore = basicTextRelatedness(title, description);
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

    let similarity: number | null = null;
    let embeddingDegraded = false;
    if (GEMINI_API_KEY) {
      const [titleEmb, descEmb] = await Promise.all([embedText(GEMINI_API_KEY, title), embedText(GEMINI_API_KEY, description)]);
      if (titleEmb && descEmb) similarity = cosineSimilarity(titleEmb, descEmb);
      else embeddingDegraded = true;
    } else embeddingDegraded = true;
    const semanticSimilarity = similarity ?? basicScore;

    let confidence = 0.5;
    let aiReason = "";
    let taskIntent: { action: string[]; object: string[]; domain: string; purpose: string } | null = null;
    let actionMatch = 0.5, objectMatch = 0.5, domainMatch = 0.5, purposeMatch = 0.5, intentMatch = 0.5;
    let categoryMatch = userCategory ? 0.7 : 0.5;
    let completeness = localComp;
    let contradiction = false;
    let aiRepetition = localRep.repetition;
    let repetitionType = localRep.repetition_type;
    let titleDescScore = semanticSimilarity, titleCatScore = 0.5, descCatScore = 0.5;
    let titleDescExplanation = "", titleCatExplanation = "", descCatExplanation = "";
    let aiSuggestedTitle: string | null = null, aiSuggestedDescription: string | null = null, aiSuggestedCategory: string | null = null;
    let aiProjectMatch: { id: string; name: string; reason: string } | null = null;
    const suggestions: { difficulty?: "easy"|"medium"|"hard"; category?: string; title?: string; description?: string } = {};
    let aiDegraded = false;

    if (GEMINI_API_KEY) {
      const projectListForPrompt = projects.length > 0
        ? projects.slice(0, 30).map((p) => `- id:${p.id} | name:"${p.name}"${p.description ? ` | desc:"${p.description.slice(0, 120)}"` : ""}`).join("\\n")
        : "(no projects provided)";

      const systemPrompt = `You are the Advanced Context-Aware Task Consistency Validator for the GSI Schedule Planner (Virtual Assistant tasks).
Evaluate THREE relationships and recommend a correction ONLY when evidence is strong.
RELATIONSHIPS: 1. Title ↔ Description  2. Title ↔ Category  3. Description ↔ Category
DECISION RULES:
- If ALL three are consistent → overall VALID, suggest NOTHING.
- If two fields agree and the third conflicts → recommend correcting the conflicting field.
- If all three conflict or evidence is weak → overall REVIEW, suggest NOTHING.
- Never invent project names. Only reference projects from the provided list.
- Never suggest a category not in the allowed list. Prefer null over a weak suggestion.
Return ONLY one valid JSON object:
{
  "overall_status": "VALID" | "REVIEW" | "INVALID",
  "confidence": number,
  "reason": string,
  "task_intent": { "action": string[], "object": string[], "domain": string, "purpose": string },
  "relationships": {
    "title_description": { "status": "consistent"|"mismatch"|"uncertain", "score": number, "explanation": string },
    "title_category": { "status": "consistent"|"mismatch"|"uncertain", "score": number, "explanation": string },
    "description_category": { "status": "consistent"|"mismatch"|"uncertain", "score": number, "explanation": string }
  },
  "scores": { "intent_match": number, "action_match": number, "object_match": number, "domain_match": number, "purpose_match": number, "category_match": number, "completeness": number },
  "contradiction": boolean,
  "repetition": boolean,
  "repetition_type": "exact"|"near"|"semantic"|null,
  "field_suggestion": { "field": "title"|"description"|"category", "suggested": string, "reason": string } | null,
  "suggested_difficulty": "easy"|"medium"|"hard"|null,
  "project_match": { "id": string, "name": string, "reason": string } | null
}
field_suggestion: suggest title only when desc+category agree but conflict with title; category only when title+desc agree but conflict with category; description only when title+category agree but description is wrong/vague. Else null.
suggested category must be exactly one of: ${VA_CATEGORIES.join(", ")}
Do NOT suggest duration. project_match only from provided list when strong. Else null.
reason: one clear sentence. No Markdown. JSON only.`;

      const userPrompt = `TASK TITLE:\\n${title}\\n\\nTASK DESCRIPTION:\\n${description}\\n\\nUSER SELECTED CATEGORY:\\n${userCategory || "(none)"}\\n\\nUSER SELECTED DURATION (minutes):\\n${userDuration ?? "(none)"}\\n\\nUSER SELECTED DIFFICULTY:\\n${userDifficulty || "(none)"}\\n\\nTASK TYPE:\\n${taskType}\\n\\nSELECTED PROJECT ID:\\n${selectedProjectId || "(none / stand-alone)"}\\n\\nEXISTING USER PROJECTS (only recommend from this list):\\n${projectListForPrompt}`;

      const requestBody = {
        contents: [{ role: "user", parts: [{ text: `${systemPrompt}\\n\\n${userPrompt}` }] }],
        generationConfig: { temperature: 0.05, responseMimeType: "application/json" },
      };

      let gotAi = false;
      for (const model of modelCandidates()) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
            body: JSON.stringify(requestBody),
          });
          if (res.status === 401 || res.status === 403) return jsonResponse({ error: "Gemini API authorization failed. Check GEMINI_API_KEY." }, 502);
          if (res.status === 429) return jsonResponse({ error: "Gemini rate limit reached. Please try again shortly." }, 429);
          if (!res.ok) continue;

          const aiJson = JSON.parse(await res.text());
          const parts = aiJson?.candidates?.[0]?.content?.parts;
          let content = "";
          if (Array.isArray(parts)) content = parts.map((p: { text?: string }) => typeof p?.text === "string" ? p.text : "").join("");
          if (!content.trim()) continue;

          const parsed = extractJsonObject(content) as Record<string, unknown>;
          confidence = clamp01(Number(parsed.confidence) || 0.7);
          aiReason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";

          const intent = parsed.task_intent as Record<string, unknown> | undefined;
          if (intent && typeof intent === "object") {
            taskIntent = {
              action: Array.isArray(intent.action) ? intent.action.map(String) : [],
              object: Array.isArray(intent.object) ? intent.object.map(String) : [],
              domain: String(intent.domain || ""), purpose: String(intent.purpose || ""),
            };
          }

          const rels = parsed.relationships as Record<string, unknown> | undefined;
          if (rels && typeof rels === "object") {
            const td = rels.title_description as Record<string, unknown> | undefined;
            if (td) { titleDescScore = clamp01(Number(td.score) ?? semanticSimilarity); titleDescExplanation = typeof td.explanation === "string" ? td.explanation : ""; }
            const tc = rels.title_category as Record<string, unknown> | undefined;
            if (tc) { titleCatScore = clamp01(Number(tc.score) ?? 0.5); titleCatExplanation = typeof tc.explanation === "string" ? tc.explanation : ""; }
            const dc = rels.description_category as Record<string, unknown> | undefined;
            if (dc) { descCatScore = clamp01(Number(dc.score) ?? 0.5); descCatExplanation = typeof dc.explanation === "string" ? dc.explanation : ""; }
          }

          const scores = parsed.scores as Record<string, unknown> | undefined;
          if (scores && typeof scores === "object") {
            actionMatch = clamp01(Number(scores.action_match) ?? 0.5);
            objectMatch = clamp01(Number(scores.object_match) ?? 0.5);
            domainMatch = clamp01(Number(scores.domain_match) ?? 0.5);
            purposeMatch = clamp01(Number(scores.purpose_match) ?? 0.5);
            intentMatch = clamp01(Number(scores.intent_match) ?? 0.5);
            categoryMatch = clamp01(Number(scores.category_match) ?? (userCategory ? 0.7 : 0.5));
            const aiComp = Number(scores.completeness);
            if (Number.isFinite(aiComp)) {
              completeness = clamp01(Math.min(localComp, clamp01(aiComp)) * 0.4 + Math.max(localComp, clamp01(aiComp)) * 0.6);
            }
          }

          contradiction = Boolean(parsed.contradiction);
          if (Boolean(parsed.repetition)) {
            aiRepetition = true;
            const rt = String(parsed.repetition_type || "semantic");
            if (["exact", "near", "semantic"].includes(rt)) repetitionType = rt as "exact"|"near"|"semantic";
            else if (!repetitionType) repetitionType = "semantic";
          }

          const fs = parsed.field_suggestion as Record<string, unknown> | null | undefined;
          if (fs && typeof fs === "object") {
            const field = String(fs.field || "");
            const suggested = typeof fs.suggested === "string" ? fs.suggested.trim() : "";
            if (field === "title" && suggested.length >= 5) aiSuggestedTitle = suggested;
            else if (field === "description" && suggested.length >= 15) aiSuggestedDescription = suggested;
            else if (field === "category" && suggested) aiSuggestedCategory = normalizeVACategory(suggested);
          }

          const sugDiff = String(parsed.suggested_difficulty || "").toLowerCase();
          if (["easy", "medium", "hard"].includes(sugDiff)) suggestions.difficulty = sugDiff as "easy"|"medium"|"hard";

          const pm = parsed.project_match as Record<string, unknown> | null | undefined;
          if (pm && typeof pm === "object") {
            const pid = typeof pm.id === "string" ? pm.id : "";
            const pname = typeof pm.name === "string" ? pm.name.trim() : "";
            const preason = typeof pm.reason === "string" ? pm.reason.trim() : "";
            if (pid || pname) aiProjectMatch = { id: pid, name: pname, reason: preason || "The task purpose appears related to this existing project." };
          }

          gotAi = true;
          console.log("analyze-task: three-way AI ok", model);
          break;
        } catch (e) {
          console.warn("analyze-task: AI attempt failed", model, e);
        }
      }
      if (!gotAi) aiDegraded = true;
    } else {
      aiDegraded = true;
    }

    if (aiDegraded) {
      actionMatch = objectMatch = domainMatch = purposeMatch = intentMatch = semanticSimilarity;
      categoryMatch = userCategory ? 0.6 : 0.5;
      titleDescScore = semanticSimilarity; titleCatScore = 0.5; descCatScore = 0.5;
      titleDescExplanation = semanticSimilarity >= THRESHOLDS.HIGH
        ? "Title and description appear related (reduced confidence — AI unavailable)."
        : semanticSimilarity >= THRESHOLDS.MEDIUM ? "Title and description may not fully match. Please review." : "Title and description do not appear related.";
      titleCatExplanation = descCatExplanation = "Category consistency could not be fully evaluated (AI unavailable).";
      aiReason = semanticSimilarity >= THRESHOLDS.HIGH
        ? "Description appears related to the title (AI unavailable; used embedding similarity)."
        : semanticSimilarity >= THRESHOLDS.MEDIUM ? "Description may not fully match the title. Please review." : "Description does not appear related to the title.";
    }

    if (VAGUE_PATTERNS.some((re) => re.test(description.trim()))) completeness = Math.min(completeness, 0.15);
    if (localRep.repetition) {
      aiRepetition = true;
      if (!repetitionType) repetitionType = localRep.repetition_type;
      completeness = Math.min(completeness, 0.4);
    }

    const factors: FactorScores = {
      semantic_similarity: clamp01(semanticSimilarity), intent_match: clamp01(intentMatch),
      action_match: clamp01(actionMatch), object_match: clamp01(objectMatch),
      domain_match: clamp01(domainMatch), purpose_match: clamp01(purposeMatch),
      category_match: clamp01(categoryMatch), completeness: clamp01(completeness),
      contradiction, repetition: aiRepetition, repetition_type: repetitionType,
    };

    const score = computeWeightedScore(factors);
    const isVague = completeness < 0.4 || factors.repetition;
    const titleDescStatus = classifyRelationship(titleDescScore, factors.contradiction, isVague && titleDescScore < 0.6);
    const titleCatStatus = classifyRelationship(titleCatScore, false, !userCategory);
    const descCatStatus = classifyRelationship(descCatScore, false, isVague || !userCategory);

    const titleDescRel: RelationshipResult = {
      status: titleDescStatus, score: Math.round(titleDescScore * 1000) / 1000,
      explanation: titleDescExplanation || (titleDescStatus === "consistent" ? "Title and description are consistent." : titleDescStatus === "mismatch" ? "Title and description appear to describe different work." : "Title and description relationship is unclear."),
    };
    const titleCatRel: RelationshipResult = {
      status: titleCatStatus, score: Math.round(titleCatScore * 1000) / 1000,
      explanation: titleCatExplanation || (titleCatStatus === "consistent" ? "Selected category fits the title." : titleCatStatus === "mismatch" ? "Selected category does not fit the title." : "Category fit for the title is uncertain."),
    };
    const descCatRel: RelationshipResult = {
      status: descCatStatus, score: Math.round(descCatScore * 1000) / 1000,
      explanation: descCatExplanation || (descCatStatus === "consistent" ? "Selected category fits the description." : descCatStatus === "mismatch" ? "Selected category does not fit the description." : "Category fit for the description is uncertain."),
    };

    let status = classifyOverall(score, factors, titleDescStatus, titleCatStatus, descCatStatus);
    if (status === "INVALID" && factors.repetition && !factors.contradiction && factors.semantic_similarity >= 0.55) status = "REVIEW";

    const fieldSuggestion = decideFieldSuggestion(
      title, description, userCategory, titleDescRel, titleCatRel, descCatRel,
      aiSuggestedTitle, aiSuggestedDescription, aiSuggestedCategory, completeness, contradiction,
    );

    if (fieldSuggestion) {
      if (fieldSuggestion.field === "title") suggestions.title = fieldSuggestion.suggested;
      else if (fieldSuggestion.field === "description") suggestions.description = fieldSuggestion.suggested;
      else if (fieldSuggestion.field === "category") suggestions.category = fieldSuggestion.suggested;
    }

    const projectResult = matchProjects(title, description, userCategory, projects, selectedProjectId, taskType, aiProjectMatch);

    let message = aiReason;
    if (!message) {
      if (status === "VALID") message = "Your title, description, and category are consistent.";
      else if (factors.contradiction) message = "The description conflicts with the task title. Please describe work that matches this task.";
      else if (factors.repetition) message = "Your description is very similar to the task title. Add more details about the actual work.";
      else if (factors.completeness < 0.4) message = "Your description is too vague. Add specific details about what needs to be done.";
      else if (fieldSuggestion) message = fieldSuggestion.reason;
      else message = "Please review the title, description, and category. The system cannot confidently determine which field needs correction.";
    }

    const related = status === "VALID" || (status === "REVIEW" && !factors.contradiction);
    const uncertain = status === "REVIEW" && !fieldSuggestion && (titleDescStatus === "uncertain" || titleCatStatus === "uncertain" || descCatStatus === "uncertain");

    console.log("analyze-task: result", { status, score, titleDesc: titleDescStatus, titleCat: titleCatStatus, descCat: descCatStatus, hasSuggestion: !!fieldSuggestion, hasProject: !!projectResult.match });

    return jsonResponse({
      ok: true,
      validation: status,
      related,
      confidence: Math.round(confidence * 1000) / 1000,
      reason: message,
      message,
      similarity: Math.round(factors.semantic_similarity * 1000) / 1000,
      score: Math.round(score * 1000) / 1000,
      relationships: {
        title_description: titleDescRel,
        title_category: titleCatRel,
        description_category: descCatRel,
      },
      field_suggestion: fieldSuggestion ? { field: fieldSuggestion.field, current: fieldSuggestion.current, suggested: fieldSuggestion.suggested, reason: fieldSuggestion.reason } : null,
      project_match: projectResult.match ? { project_id: projectResult.match.project_id, project_name: projectResult.match.project_name, relevance: projectResult.match.relevance, reason: projectResult.match.reason } : null,
      project_message: projectResult.message,
      selected_project_consistent: projectResult.selected_consistent,
      validation_detail: {
        status, score: Math.round(score * 1000) / 1000,
        semantic_similarity: Math.round(factors.semantic_similarity * 1000) / 1000,
        intent_match: Math.round(factors.intent_match * 1000) / 1000,
        action_match: Math.round(factors.action_match * 1000) / 1000,
        object_match: Math.round(factors.object_match * 1000) / 1000,
        domain_match: Math.round(factors.domain_match * 1000) / 1000,
        purpose_match: Math.round(factors.purpose_match * 1000) / 1000,
        category_match: Math.round(factors.category_match * 1000) / 1000,
        completeness: Math.round(factors.completeness * 1000) / 1000,
        contradiction: factors.contradiction, repetition: factors.repetition, repetition_type: factors.repetition_type,
      },
      task_intent: taskIntent,
      thresholds: THRESHOLDS,
      weights: WEIGHTS,
      suggestions: Object.keys(suggestions).length > 0 ? { difficulty: suggestions.difficulty, category: suggestions.category, title: suggestions.title, description: suggestions.description } : null,
      ai_degraded: aiDegraded,
      embedding_degraded: embeddingDegraded,
      uncertain: uncertain || false,
    });
  } catch (err) {
    console.error("analyze-task error:", err);
    return jsonResponse({ error: "Task analysis failed.", detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});
