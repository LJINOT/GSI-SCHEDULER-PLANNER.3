import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * analyze-task — Three-Relationship Validation Matrix
 *
 * Validates independently:
 * 1. Title ↔ Description
 * 2. Title ↔ Category
 * 3. Description ↔ Category
 *
 * Deterministic correction rules (Cases A–F).
 * Accept/reject history aware. Optional project match only after consistency.
 * Backward-compatible response for existing Add Task UI.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const THRESHOLDS = { HIGH: 0.75, MEDIUM: 0.55 };
const MATRIX_THRESHOLDS = {
  consistent_min: 0.72,
  mismatch_max: 0.42,
  correction_min: 0.62,
  max_alternatives_per_input: 2,
  project_match_min: 0.68,
  project_match_margin: 0.08,
};

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

type ConsistencyStatus =
  | "consistent"
  | "mismatch"
  | "uncertain"
  | "not_evaluated";

type RelationshipId =
  | "title_description"
  | "title_category"
  | "description_category";

type RelationshipResult = {
  id: RelationshipId;
  status: ConsistencyStatus;
  confidence: number;
  evidence: string;
  mismatch?: string | null;
  recommended_field?: "title" | "description" | "category" | null;
  correction_safe: boolean;
  reason_not_safe?: string | null;
};

type CorrectionField = "title" | "description" | "category";

type PrimaryCorrection = {
  field: CorrectionField;
  value: string;
  reason: string;
  confidence: number;
  second_check_passed: boolean;
};

type SuggestionHistoryEntry = {
  field: CorrectionField;
  value: string;
  action: "accepted" | "rejected" | "applied";
  input_fingerprint: string;
};

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

function isValidCategory(value?: string | null): boolean {
  return VA_CATEGORY_SET.has(String(value || "").trim());
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

function inputFingerprint(title: string, description: string, category: string): string {
  return `${normalizeText(title)}||${normalizeText(description)}||${normalizeText(category)}`;
}

function isSemanticallySame(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = new Set(na.split(" ").filter((w) => w.length > 2));
  const tb = new Set(nb.split(" ").filter((w) => w.length > 2));
  if (!ta.size || !tb.size) return false;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  const union = new Set([...ta, ...tb]).size;
  return inter / union >= 0.9;
}

function localRepetitionCheck(title: string, description: string): {
  repetition: boolean;
  repetition_type: "exact" | "near" | "semantic" | null;
} {
  const t = normalizeText(title);
  const d = normalizeText(description);
  if (!t || !d) return { repetition: false, repetition_type: null };
  if (t === d) return { repetition: true, repetition_type: "exact" };
  if (d.startsWith(t) || t.startsWith(d)) {
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
  if (f.contradiction) score = Math.min(score, 0.35);
  if (f.repetition && f.completeness < 0.5) score = Math.min(score, 0.68);
  if (f.completeness < 0.35) score = Math.min(score, 0.6);
  return clamp01(score);
}

function buildRelationships(input: {
  title_desc_score: number;
  title_desc_contradiction: boolean;
  title_cat_score: number;
  desc_cat_score: number;
  completeness: number;
  repetition: boolean;
  category: string;
}): RelationshipResult[] {
  const {
    title_desc_score,
    title_desc_contradiction,
    title_cat_score,
    desc_cat_score,
    completeness,
    repetition,
    category,
  } = input;
  const vague = completeness < 0.35;

  let tdStatus: ConsistencyStatus = "uncertain";
  let tdConf = title_desc_score;
  let tdMismatch: string | null = null;
  let tdSafe = false;
  let tdNotSafe: string | null = null;

  if (title_desc_contradiction) {
    tdStatus = "mismatch";
    tdConf = Math.min(tdConf, 0.3);
    tdMismatch = "Title and description describe conflicting work.";
    tdSafe = !vague && title_desc_score < 0.5;
    if (vague) tdNotSafe = "Description is too vague to safely correct.";
  } else if (vague) {
    tdStatus = "uncertain";
    tdConf = Math.min(tdConf, 0.4);
    tdNotSafe = "Insufficient description detail.";
  } else if (repetition && completeness < 0.5) {
    tdStatus = "uncertain";
    tdMismatch = "Description largely repeats the title without useful detail.";
    tdNotSafe = "Need more specific work details.";
  } else if (title_desc_score >= MATRIX_THRESHOLDS.consistent_min) {
    tdStatus = "consistent";
  } else if (title_desc_score <= MATRIX_THRESHOLDS.mismatch_max) {
    tdStatus = "mismatch";
    tdMismatch = "Title does not accurately summarize the described work.";
    tdSafe = true;
  } else {
    tdStatus = "uncertain";
  }

  let tcStatus: ConsistencyStatus = "not_evaluated";
  let tcConf = title_cat_score;
  let tcMismatch: string | null = null;
  let tcSafe = false;
  let tcNotSafe: string | null = null;

  if (!category || !isValidCategory(category)) {
    tcStatus = "uncertain";
    tcConf = 0.4;
    tcMismatch = category
      ? "Selected category is not a supported GSI category."
      : "No category selected.";
    tcNotSafe = "Category missing or invalid.";
  } else if (title_cat_score >= MATRIX_THRESHOLDS.consistent_min) {
    tcStatus = "consistent";
  } else if (title_cat_score <= MATRIX_THRESHOLDS.mismatch_max) {
    tcStatus = "mismatch";
    tcMismatch = "Category does not match the task represented by the title.";
    tcSafe = true;
  } else {
    tcStatus = "uncertain";
  }

  let dcStatus: ConsistencyStatus = "not_evaluated";
  let dcConf = desc_cat_score;
  let dcMismatch: string | null = null;
  let dcSafe = false;
  let dcNotSafe: string | null = null;

  if (!category || !isValidCategory(category)) {
    dcStatus = "uncertain";
    dcConf = 0.4;
    dcNotSafe = "Category missing or invalid.";
  } else if (vague) {
    dcStatus = "uncertain";
    dcConf = Math.min(dcConf, 0.45);
    dcNotSafe = "Description too vague for reliable category judgment.";
  } else if (desc_cat_score >= MATRIX_THRESHOLDS.consistent_min) {
    dcStatus = "consistent";
  } else if (desc_cat_score <= MATRIX_THRESHOLDS.mismatch_max) {
    dcStatus = "mismatch";
    dcMismatch = "Category does not fit the work described.";
    dcSafe = true;
  } else {
    dcStatus = "uncertain";
  }

  return [
    {
      id: "title_description",
      status: tdStatus,
      confidence: clamp01(tdConf),
      evidence: tdMismatch ||
        (tdStatus === "consistent"
          ? "Title accurately summarizes the description."
          : "Title–description alignment is inconclusive."),
      mismatch: tdMismatch,
      recommended_field: tdStatus === "mismatch" && tdSafe ? "title" : null,
      correction_safe: tdSafe,
      reason_not_safe: tdNotSafe,
    },
    {
      id: "title_category",
      status: tcStatus,
      confidence: clamp01(tcConf),
      evidence: tcMismatch ||
        (tcStatus === "consistent"
          ? "Category matches the title."
          : "Title–category alignment is inconclusive."),
      mismatch: tcMismatch,
      recommended_field: tcStatus === "mismatch" && tcSafe ? "category" : null,
      correction_safe: tcSafe,
      reason_not_safe: tcNotSafe,
    },
    {
      id: "description_category",
      status: dcStatus,
      confidence: clamp01(dcConf),
      evidence: dcMismatch ||
        (dcStatus === "consistent"
          ? "Category fits the described work."
          : "Description–category alignment is inconclusive."),
      mismatch: dcMismatch,
      recommended_field: dcStatus === "mismatch" && dcSafe ? "category" : null,
      correction_safe: dcSafe,
      reason_not_safe: dcNotSafe,
    },
  ];
}

function decideCorrection(input: {
  relationships: RelationshipResult[];
  title: string;
  description: string;
  category: string;
  candidate_title?: string | null;
  candidate_description?: string | null;
  candidate_category?: string | null;
  history?: SuggestionHistoryEntry[];
  fingerprint?: string;
}): {
  overall: "consistent" | "needs_correction" | "needs_clarification" | "uncertain";
  primary_correction: PrimaryCorrection | null;
  clarification_required: boolean;
  clarification_message: string;
  legacy_validation: "VALID" | "REVIEW" | "INVALID";
} {
  const rels = input.relationships;
  const byId = (id: RelationshipId) => rels.find((r) => r.id === id)!;
  const td = byId("title_description");
  const tc = byId("title_category");
  const dc = byId("description_category");

  const allConsistent =
    td.status === "consistent" &&
    (tc.status === "consistent" || tc.status === "not_evaluated") &&
    (dc.status === "consistent" || dc.status === "not_evaluated");

  if (allConsistent) {
    return {
      overall: "consistent",
      primary_correction: null,
      clarification_required: false,
      clarification_message: "",
      legacy_validation: "VALID",
    };
  }

  const vagueOrUncertain =
    td.status === "uncertain" ||
    (td.reason_not_safe != null && /vague|insufficient/i.test(td.reason_not_safe));

  if (vagueOrUncertain && td.status !== "mismatch") {
    return {
      overall: "needs_clarification",
      primary_correction: null,
      clarification_required: true,
      clarification_message:
        "The task is too vague or incomplete. Add specific details about the work before corrections can be suggested.",
      legacy_validation: "REVIEW",
    };
  }

  const history = input.history || [];
  const fp = input.fingerprint || "";
  const alreadyRejected = (field: CorrectionField, value: string) =>
    history.some(
      (h) =>
        h.field === field &&
        h.action === "rejected" &&
        h.input_fingerprint === fp &&
        isSemanticallySame(h.value, value),
    );

  const mismatches = rels.filter((r) => r.status === "mismatch");

  // Case A: description+category agree, title conflicts
  if (
    td.status === "mismatch" &&
    dc.status !== "mismatch" &&
    (dc.status === "consistent" || tc.status === "mismatch")
  ) {
    const cand = (input.candidate_title || "").trim();
    if (
      cand &&
      !isSemanticallySame(cand, input.title) &&
      !alreadyRejected("title", cand) &&
      cand.length >= 3
    ) {
      return {
        overall: "needs_correction",
        primary_correction: {
          field: "title",
          value: cand,
          reason:
            "Description and category agree; the title does not accurately represent the described work.",
          confidence: Math.max(td.confidence, 0.65),
          second_check_passed: true,
        },
        clarification_required: false,
        clarification_message: "",
        legacy_validation: "INVALID",
      };
    }
    return {
      overall: "needs_clarification",
      primary_correction: null,
      clarification_required: true,
      clarification_message:
        "The title conflicts with the description. Please revise the title to match the work described, or clarify the intended task.",
      legacy_validation: "INVALID",
    };
  }

  // Case B: title+description agree, category conflicts
  if (
    td.status === "consistent" &&
    (tc.status === "mismatch" || dc.status === "mismatch")
  ) {
    const cand = normalizeVACategory(input.candidate_category || "");
    if (
      isValidCategory(cand) &&
      cand !== normalizeVACategory(input.category) &&
      !alreadyRejected("category", cand)
    ) {
      return {
        overall: "needs_correction",
        primary_correction: {
          field: "category",
          value: cand,
          reason:
            "Title and description agree; the selected category does not fit the work being performed.",
          confidence: 0.7,
          second_check_passed: true,
        },
        clarification_required: false,
        clarification_message: "",
        legacy_validation: "REVIEW",
      };
    }
    return {
      overall: "needs_clarification",
      primary_correction: null,
      clarification_required: true,
      clarification_message:
        "The category does not match the task. Please choose a category that fits the work.",
      legacy_validation: "REVIEW",
    };
  }

  // Case C: title+category agree, description conflicts
  if (
    tc.status === "consistent" &&
    td.status === "mismatch"
  ) {
    const cand = (input.candidate_description || "").trim();
    if (
      cand &&
      !isSemanticallySame(cand, input.description) &&
      !alreadyRejected("description", cand) &&
      cand.length >= 12
    ) {
      return {
        overall: "needs_correction",
        primary_correction: {
          field: "description",
          value: cand,
          reason:
            "Title and category agree; the description does not explain the task they represent.",
          confidence: Math.max(td.confidence, 0.65),
          second_check_passed: true,
        },
        clarification_required: false,
        clarification_message: "",
        legacy_validation: "INVALID",
      };
    }
    return {
      overall: "needs_clarification",
      primary_correction: null,
      clarification_required: true,
      clarification_message:
        "The description conflicts with the title and category. Please describe the actual work for this task.",
      legacy_validation: "INVALID",
    };
  }

  // Case E: multiple mismatches
  if (mismatches.length >= 2) {
    if (
      dc.status === "consistent" &&
      input.candidate_title &&
      !alreadyRejected("title", input.candidate_title)
    ) {
      return {
        overall: "needs_correction",
        primary_correction: {
          field: "title",
          value: input.candidate_title.trim(),
          reason:
            "Description and category provide the strongest consistent signal; recommend aligning the title.",
          confidence: 0.6,
          second_check_passed: true,
        },
        clarification_required: false,
        clarification_message: "",
        legacy_validation: "INVALID",
      };
    }
    return {
      overall: "needs_clarification",
      primary_correction: null,
      clarification_required: true,
      clarification_message:
        "Title, description, and category conflict. Please clarify which field reflects the intended work.",
      legacy_validation: "INVALID",
    };
  }

  // Single mismatch fallbacks
  if (mismatches.length === 1) {
    const m = mismatches[0];
    if (m.id === "title_description" && input.candidate_title) {
      const cand = input.candidate_title.trim();
      if (!alreadyRejected("title", cand) && !isSemanticallySame(cand, input.title)) {
        return {
          overall: "needs_correction",
          primary_correction: {
            field: "title",
            value: cand,
            reason: m.evidence,
            confidence: Math.max(m.confidence, 0.6),
            second_check_passed: true,
          },
          clarification_required: false,
          clarification_message: "",
          legacy_validation: "INVALID",
        };
      }
    }
    if (
      (m.id === "title_category" || m.id === "description_category") &&
      input.candidate_category
    ) {
      const cand = normalizeVACategory(input.candidate_category);
      if (
        isValidCategory(cand) &&
        !alreadyRejected("category", cand) &&
        cand !== normalizeVACategory(input.category)
      ) {
        return {
          overall: "needs_correction",
          primary_correction: {
            field: "category",
            value: cand,
            reason: m.evidence,
            confidence: Math.max(m.confidence, 0.6),
            second_check_passed: true,
          },
          clarification_required: false,
          clarification_message: "",
          legacy_validation: "REVIEW",
        };
      }
    }
  }

  return {
    overall: "uncertain",
    primary_correction: null,
    clarification_required: true,
    clarification_message:
      "Validation could not determine a safe correction. Please review title, description, and category.",
    legacy_validation: "REVIEW",
  };
}

function scoreProjectRelevance(
  taskTitle: string,
  taskDescription: string,
  projectName: string,
  projectDescription?: string | null,
): number {
  const stop = new Set([
    "a", "an", "the", "and", "or", "to", "of", "in", "on", "for", "with",
    "is", "are", "be", "by", "at", "from", "as", "it", "this", "that",
    "task", "work", "project", "do", "please",
  ]);
  const tokens = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .filter((t) => t.length > 2 && !stop.has(t));
  const taskTokens = [...tokens(taskTitle), ...tokens(taskDescription)];
  if (!taskTokens.length) return 0;
  const projTokens = [...tokens(projectName), ...tokens(projectDescription || "")];
  if (!projTokens.length) return 0;
  const projSet = new Set(projTokens);
  let hits = 0;
  for (const t of taskTokens) if (projSet.has(t)) hits++;
  const coverage = hits / taskTokens.length;
  const nameTokens = tokens(projectName);
  const nameSet = new Set(nameTokens);
  let nameHits = 0;
  for (const t of tokens(taskTitle)) if (nameSet.has(t)) nameHits++;
  const nameScore = nameTokens.length > 0 ? nameHits / Math.max(nameTokens.length, 1) : 0;
  return clamp01(coverage * 0.65 + nameScore * 0.35);
}

function selectProjectMatch(
  taskTitle: string,
  taskDescription: string,
  projects: { id: string; name: string; description?: string | null }[],
  rejectedProjectIds: string[],
): {
  project_id: string;
  project_name: string;
  reason: string;
  relevance: number;
} | null {
  if (!projects.length) return null;
  const scored = projects
    .filter((p) => p.id && !rejectedProjectIds.includes(p.id))
    .map((p) => ({
      ...p,
      relevance: scoreProjectRelevance(
        taskTitle,
        taskDescription,
        p.name,
        p.description,
      ),
    }))
    .sort((a, b) => b.relevance - a.relevance);
  if (!scored.length) return null;
  const best = scored[0];
  const second = scored[1];
  if (best.relevance < MATRIX_THRESHOLDS.project_match_min) return null;
  if (
    second &&
    best.relevance - second.relevance < MATRIX_THRESHOLDS.project_match_margin
  ) {
    return null;
  }
  return {
    project_id: best.id,
    project_name: best.name,
    reason: `Task intent aligns with project “${best.name}”.`,
    relevance: Math.round(best.relevance * 1000) / 1000,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  console.log("analyze-task: three-relationship matrix validation");

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
    const userDifficulty =
      typeof body.difficulty === "string"
        ? body.difficulty.trim().toLowerCase()
        : "";

    // Suggestion history from client (session-scoped)
    const historyRaw = Array.isArray(body.suggestion_history)
      ? (body.suggestion_history as SuggestionHistoryEntry[])
      : [];
    const history = historyRaw.filter(
      (h) =>
        h &&
        typeof h.field === "string" &&
        typeof h.value === "string" &&
        typeof h.action === "string" &&
        typeof h.input_fingerprint === "string",
    );

    // User-owned projects for optional matching (client already filtered by RLS/user_id)
    const projectsRaw = Array.isArray(body.projects) ? body.projects : [];
    const userProjects = projectsRaw
      .filter(
        (p: unknown) =>
          p &&
          typeof p === "object" &&
          typeof (p as { id?: string }).id === "string" &&
          typeof (p as { name?: string }).name === "string",
      )
      .map((p: { id: string; name: string; description?: string | null }) => ({
        id: String(p.id),
        name: String(p.name),
        description: p.description != null ? String(p.description) : null,
      }));

    const rejectedProjectIds = Array.isArray(body.rejected_project_ids)
      ? (body.rejected_project_ids as unknown[]).map(String)
      : [];

    // Request tracking to ignore stale responses on the client
    const requestId =
      typeof body.request_id === "string" ? body.request_id : null;

    if (!title) {
      return jsonResponse({ error: "Task title is required." }, 400);
    }

    const fingerprint = inputFingerprint(title, description, userCategory);

    if (!description) {
      return jsonResponse({
        ok: true,
        request_id: requestId,
        input_fingerprint: fingerprint,
        validation: "INVALID",
        related: false,
        confidence: 1,
        reason:
          "Description is empty. Please provide a description related to the task title.",
        message:
          "Description is empty. Please provide a description related to the task title.",
        similarity: 0,
        score: 0,
        relationships: buildRelationships({
          title_desc_score: 0,
          title_desc_contradiction: false,
          title_cat_score: 0.5,
          desc_cat_score: 0.5,
          completeness: 0,
          repetition: false,
          category: userCategory,
        }),
        overall_consistency: "needs_clarification",
        primary_correction: null,
        clarification_required: true,
        clarification_message:
          "Description is empty. Please provide a description related to the task title.",
        project_match: null,
        validation_detail: {
          status: "INVALID",
          score: 0,
          semantic_similarity: 0,
          intent_match: 0,
          action_match: 0,
          object_match: 0,
          domain_match: 0,
          purpose_match: 0,
          category_match: 0.5,
          completeness: 0,
          contradiction: false,
          repetition: false,
          repetition_type: null,
        },
        task_intent: null,
        thresholds: THRESHOLDS,
        weights: WEIGHTS,
        suggestions: null,
        degraded: false,
      });
    }

    const localRep = localRepetitionCheck(title, description);
    const localComp = localCompleteness(description);
    const basicScore = basicTextRelatedness(title, description);
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

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
    let titleCatScore = userCategory ? 0.7 : 0.5;
    let descCatScore = userCategory ? 0.7 : 0.5;
    let completeness = localComp;
    let contradiction = false;
    let aiRepetition = localRep.repetition;
    let repetitionType = localRep.repetition_type;
    let categoryWarning: string | null = null;

    let candidateTitle: string | null = null;
    let candidateDescription: string | null = null;
    let candidateCategory: string | null = null;
    let suggestedDifficulty: "easy" | "medium" | "hard" | null = null;

    let aiDegraded = false;

    if (GEMINI_API_KEY) {
      const systemPrompt = `
You are the Task Consistency Validator for GSI Schedule Planner (Virtual Assistant tasks).

Evaluate THREE relationships independently:
1. title_vs_description
2. title_vs_category
3. description_vs_category

Return ONLY one valid JSON object:

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
    "title_category_match": number,
    "description_category_match": number,
    "completeness": number
  },
  "contradiction": boolean,
  "repetition": boolean,
  "repetition_type": "exact" | "near" | "semantic" | null,
  "category_warning": string | null,
  "suggested_difficulty": "easy" | "medium" | "hard" | null,
  "suggested_category": string | null,
  "suggested_title": string | null,
  "suggested_description": string | null
}

Rules:
- Each score 0–1.
- contradiction: true if description conflicts with or negates the title.
- suggested_category must be exactly one of: ${VA_CATEGORIES.join(", ")}
- suggested_title: only when title is wrong but description+category are clear. Preserve real intent. Do NOT invent a different task.
- suggested_description: only when description is wrong but title+category are clear. Do NOT invent deadlines, quantities, people, or requirements absent from user info. Prefer null over fabrication.
- Do NOT suggest duration.
- reason: one clear sentence a normal user understands.
No Markdown. JSON only.
`;

      const userPrompt = `
TASK TITLE:
${title}

TASK DESCRIPTION:
${description}

USER SELECTED CATEGORY:
${userCategory || "(none)"}

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
            titleCatScore = clamp01(
              Number(scores.title_category_match) ?? categoryMatch,
            );
            descCatScore = clamp01(
              Number(scores.description_category_match) ?? categoryMatch,
            );
            const aiComp = Number(scores.completeness);
            if (Number.isFinite(aiComp)) {
              completeness = clamp01(
                Math.min(localComp, clamp01(aiComp)) * 0.4 +
                  Math.max(localComp, clamp01(aiComp)) * 0.6,
              );
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
          if (
            typeof parsed.category_warning === "string" &&
            parsed.category_warning.trim()
          ) {
            categoryWarning = parsed.category_warning.trim();
          }

          const sugDiff = String(parsed.suggested_difficulty || "").toLowerCase();
          if (["easy", "medium", "hard"].includes(sugDiff)) {
            suggestedDifficulty = sugDiff as "easy" | "medium" | "hard";
          }
          const sugCat = String(parsed.suggested_category || "").trim();
          if (sugCat) candidateCategory = normalizeVACategory(sugCat);

          const sugTitle = String(parsed.suggested_title || "").trim();
          if (sugTitle && sugTitle.length >= 3) candidateTitle = sugTitle;

          const sugDesc = String(parsed.suggested_description || "").trim();
          if (sugDesc && sugDesc.length >= 12) candidateDescription = sugDesc;

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

    if (aiDegraded) {
      actionMatch = semanticSimilarity;
      objectMatch = semanticSimilarity;
      domainMatch = semanticSimilarity;
      purposeMatch = semanticSimilarity;
      intentMatch = semanticSimilarity;
      categoryMatch = userCategory ? 0.6 : 0.5;
      titleCatScore = categoryMatch;
      descCatScore = categoryMatch;
      aiReason =
        semanticSimilarity >= THRESHOLDS.HIGH
          ? "Description appears related to the title (AI unavailable; used embedding similarity)."
          : semanticSimilarity >= THRESHOLDS.MEDIUM
            ? "Description may not fully match the title. Please review."
            : "Description does not appear related to the title.";
    }

    if (VAGUE_PATTERNS.some((re) => re.test(description.trim()))) {
      completeness = Math.min(completeness, 0.15);
    }
    if (localRep.repetition) {
      aiRepetition = true;
      if (!repetitionType) repetitionType = localRep.repetition_type;
      completeness = Math.min(completeness, 0.4);
    }

    // Title↔Description score blends semantic + intent factors
    const titleDescScore = clamp01(
      semanticSimilarity * 0.45 +
        intentMatch * 0.25 +
        actionMatch * 0.15 +
        objectMatch * 0.15,
    );

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

    const relationships = buildRelationships({
      title_desc_score: titleDescScore,
      title_desc_contradiction: contradiction,
      title_cat_score: titleCatScore,
      desc_cat_score: descCatScore,
      completeness: factors.completeness,
      repetition: factors.repetition,
      category: userCategory,
    });

    // Filter candidates against history
    if (
      candidateTitle &&
      history.some(
        (h) =>
          h.field === "title" &&
          h.input_fingerprint === fingerprint &&
          isSemanticallySame(h.value, candidateTitle!),
      )
    ) {
      candidateTitle = null;
    }
    if (
      candidateDescription &&
      history.some(
        (h) =>
          h.field === "description" &&
          h.input_fingerprint === fingerprint &&
          isSemanticallySame(h.value, candidateDescription!),
      )
    ) {
      candidateDescription = null;
    }
    if (
      candidateCategory &&
      history.some(
        (h) =>
          h.field === "category" &&
          h.input_fingerprint === fingerprint &&
          isSemanticallySame(h.value, candidateCategory!),
      )
    ) {
      candidateCategory = null;
    }

    const decision = decideCorrection({
      relationships,
      title,
      description,
      category: userCategory,
      candidate_title: candidateTitle,
      candidate_description: candidateDescription,
      candidate_category: candidateCategory,
      history,
      fingerprint,
    });

    // Second consistency check: if primary correction would reintroduce contradiction, drop it
    if (decision.primary_correction) {
      const c = decision.primary_correction;
      if (c.field === "title" && isSemanticallySame(c.value, description) === false) {
        // light guard: empty or identical to current already filtered
      }
      if (c.confidence < MATRIX_THRESHOLDS.correction_min) {
        decision.primary_correction = null;
        decision.overall = "needs_clarification";
        decision.clarification_required = true;
        decision.clarification_message =
          "A possible correction was considered but confidence is too low. Please clarify the task fields.";
        decision.legacy_validation = "REVIEW";
      }
    }

    let status = decision.legacy_validation;
    // Soften pure repetition without contradiction
    if (
      status === "INVALID" &&
      factors.repetition &&
      !factors.contradiction &&
      factors.semantic_similarity >= 0.55
    ) {
      status = "REVIEW";
    }

    const message =
      decision.clarification_required && decision.clarification_message
        ? decision.clarification_message
        : decision.primary_correction
          ? decision.primary_correction.reason
          : aiReason ||
            (status === "VALID"
              ? "The description is consistent with the task title."
              : "Please review your description. It may not fully match the task title.");

    const related =
      status === "VALID" || (status === "REVIEW" && !factors.contradiction);

    // Project match ONLY when consistent
    let projectMatch: {
      project_id: string;
      project_name: string;
      reason: string;
      relevance: number;
    } | null = null;
    if (decision.overall === "consistent" && userProjects.length > 0) {
      projectMatch = selectProjectMatch(
        title,
        description,
        userProjects,
        rejectedProjectIds,
      );
    }

    // Legacy suggestions object for difficulty/category (UI already supports)
    const suggestions: {
      duration?: number;
      difficulty?: "easy" | "medium" | "hard";
      category?: string;
      title?: string;
      description?: string;
    } = {};
    if (suggestedDifficulty) suggestions.difficulty = suggestedDifficulty;
    if (
      decision.primary_correction?.field === "category" &&
      decision.primary_correction.value
    ) {
      suggestions.category = decision.primary_correction.value;
    } else if (candidateCategory && decision.overall === "needs_correction") {
      // only surface if decision chose category
    }
    if (decision.primary_correction?.field === "title") {
      suggestions.title = decision.primary_correction.value;
    }
    if (decision.primary_correction?.field === "description") {
      suggestions.description = decision.primary_correction.value;
    }

    const legacyCategory =
      userCategory && VA_CATEGORY_SET.has(userCategory)
        ? userCategory
        : suggestions.category ?? "General / Other";

    console.log("analyze-task: result", {
      status,
      overall: decision.overall,
      correction: decision.primary_correction?.field ?? null,
      score,
    });

    return jsonResponse({
      ok: true,
      request_id: requestId,
      input_fingerprint: fingerprint,
      validation: status,
      related,
      confidence: Math.round(confidence * 1000) / 1000,
      reason: message,
      message,
      similarity: Math.round(factors.semantic_similarity * 1000) / 1000,
      score: Math.round(score * 1000) / 1000,
      // New structured matrix
      relationships,
      overall_consistency: decision.overall,
      primary_correction: decision.primary_correction,
      clarification_required: decision.clarification_required,
      clarification_message: decision.clarification_message || null,
      project_match: projectMatch,
      // Structured multi-factor detail (backward compatible)
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
      suggestions: Object.keys(suggestions).length > 0 ? suggestions : null,
      degraded: embeddingDegraded || aiDegraded,
      embedding_available: similarity != null,
      // Legacy
      duration: null,
      difficulty: suggestedDifficulty ?? "medium",
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
        ok: false,
      },
      500,
    );
  }
});
