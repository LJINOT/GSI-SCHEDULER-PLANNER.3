/**
 * Three-relationship validation matrix and deterministic correction rules
 * for GSI Schedule Planner task consistency validation.
 *
 * Relationships evaluated independently:
 * 1. Title ↔ Description
 * 2. Title ↔ Category
 * 3. Description ↔ Category
 *
 * Pure functions — no I/O — suitable for unit tests and shared decision logic.
 */

export type ConsistencyStatus =
  | "consistent"
  | "mismatch"
  | "uncertain"
  | "not_evaluated";

export type RelationshipId =
  | "title_description"
  | "title_category"
  | "description_category";

export type RelationshipResult = {
  id: RelationshipId;
  status: ConsistencyStatus;
  confidence: number; // 0–1
  evidence: string;
  mismatch?: string | null;
  recommended_field?: "title" | "description" | "category" | null;
  correction_safe: boolean;
  reason_not_safe?: string | null;
};

export type CorrectionField = "title" | "description" | "category";

export type PrimaryCorrection = {
  field: CorrectionField;
  value: string;
  reason: string;
  confidence: number;
  /** Whether a second consistency check of the candidate passed. */
  second_check_passed: boolean;
};

export type ClarificationRequest = {
  required: boolean;
  message: string;
  missing?: string[];
};

export type MatrixDecision = {
  relationships: RelationshipResult[];
  overall: "consistent" | "needs_correction" | "needs_clarification" | "uncertain";
  primary_correction: PrimaryCorrection | null;
  alternatives: PrimaryCorrection[];
  clarification: ClarificationRequest;
  /** Legacy-compatible status mapped for existing UI. */
  legacy_validation: "VALID" | "REVIEW" | "INVALID";
};

export type SuggestionHistoryEntry = {
  field: CorrectionField;
  value: string;
  action: "accepted" | "rejected" | "applied";
  /** Normalized fingerprint of title+description+category at the time. */
  input_fingerprint: string;
};

export const VA_CATEGORY_LIST = [
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

export type VACategoryName = (typeof VA_CATEGORY_LIST)[number];

const VA_SET = new Set<string>(VA_CATEGORY_LIST);

export function normalizeCategory(value?: string | null): string {
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
  return VA_SET.has(normalized) ? normalized : "General / Other";
}

export function isValidCategory(value?: string | null): boolean {
  return VA_SET.has(String(value || "").trim());
}

/** Configurable thresholds — calibrated; do not lower arbitrarily. */
export const MATRIX_THRESHOLDS = {
  /** Minimum confidence to treat a relationship as consistent. */
  consistent_min: 0.72,
  /** Below this → mismatch (when evidence supports contradiction). */
  mismatch_max: 0.42,
  /** Minimum confidence to recommend a correction. */
  correction_min: 0.62,
  /** Max automatic alternatives per unchanged input fingerprint. */
  max_alternatives_per_input: 2,
  /** Project match relevance floor. */
  project_match_min: 0.55,
  /** Best project must beat second-best by this margin. */
  project_match_margin: 0.08,
};

export function inputFingerprint(
  title: string,
  description: string,
  category: string,
): string {
  const n = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return `${n(title)}||${n(description)}||${n(category)}`;
}

export function normalizeSuggestionValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isSemanticallySame(a: string, b: string): boolean {
  const na = normalizeSuggestionValue(a);
  const nb = normalizeSuggestionValue(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // High token overlap for near-duplicates
  const ta = new Set(na.split(" ").filter((w) => w.length > 2));
  const tb = new Set(nb.split(" ").filter((w) => w.length > 2));
  if (!ta.size || !tb.size) return false;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  const union = new Set([...ta, ...tb]).size;
  return inter / union >= 0.9;
}

/**
 * Build relationship results from factor scores / AI signals.
 * Scores are 0–1; contradiction forces mismatch.
 */
export function buildRelationships(input: {
  title: string;
  description: string;
  category: string;
  /** Title↔Description overall relatedness (semantic + intent). */
  title_desc_score: number;
  title_desc_contradiction: boolean;
  /** Title↔Category fit. */
  title_cat_score: number;
  /** Description↔Category fit. */
  desc_cat_score: number;
  completeness: number;
  repetition: boolean;
  evidence_title_desc?: string;
  evidence_title_cat?: string;
  evidence_desc_cat?: string;
}): RelationshipResult[] {
  const {
    title,
    description,
    category,
    title_desc_score,
    title_desc_contradiction,
    title_cat_score,
    desc_cat_score,
    completeness,
    repetition,
  } = input;

  const vague =
    completeness < 0.35 ||
    !description.trim() ||
    description.trim().length < 12;

  // --- Title ↔ Description ---
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
    tdNotSafe = "Need more specific work details, not a title rewrite alone.";
  } else if (title_desc_score >= MATRIX_THRESHOLDS.consistent_min) {
    tdStatus = "consistent";
    tdSafe = false;
  } else if (title_desc_score <= MATRIX_THRESHOLDS.mismatch_max) {
    tdStatus = "mismatch";
    tdMismatch = "Title does not accurately summarize the described work.";
    tdSafe = true;
  } else {
    tdStatus = "uncertain";
  }

  // --- Title ↔ Category ---
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
    tcSafe = false;
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

  // --- Description ↔ Category ---
  let dcStatus: ConsistencyStatus = "not_evaluated";
  let dcConf = desc_cat_score;
  let dcMismatch: string | null = null;
  let dcSafe = false;
  let dcNotSafe: string | null = null;

  if (!category || !isValidCategory(category)) {
    dcStatus = "uncertain";
    dcConf = 0.4;
    dcSafe = false;
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
      evidence:
        input.evidence_title_desc ||
        (tdMismatch ||
          (tdStatus === "consistent"
            ? "Title accurately summarizes the description."
            : "Title–description alignment is inconclusive.")),
      mismatch: tdMismatch,
      recommended_field:
        tdStatus === "mismatch" && tdSafe ? "title" : null,
      correction_safe: tdSafe,
      reason_not_safe: tdNotSafe,
    },
    {
      id: "title_category",
      status: tcStatus,
      confidence: clamp01(tcConf),
      evidence:
        input.evidence_title_cat ||
        (tcMismatch ||
          (tcStatus === "consistent"
            ? "Category matches the title."
            : "Title–category alignment is inconclusive.")),
      mismatch: tcMismatch,
      recommended_field:
        tcStatus === "mismatch" && tcSafe ? "category" : null,
      correction_safe: tcSafe,
      reason_not_safe: tcNotSafe,
    },
    {
      id: "description_category",
      status: dcStatus,
      confidence: clamp01(dcConf),
      evidence:
        input.evidence_desc_cat ||
        (dcMismatch ||
          (dcStatus === "consistent"
            ? "Category fits the described work."
            : "Description–category alignment is inconclusive.")),
      mismatch: dcMismatch,
      recommended_field:
        dcStatus === "mismatch" && dcSafe ? "category" : null,
      correction_safe: dcSafe,
      reason_not_safe: dcNotSafe,
    },
  ];
}

/**
 * Deterministic correction selection (Cases A–F).
 * Does not invent facts. Selects at most one primary correction target.
 */
export function decideCorrection(input: {
  relationships: RelationshipResult[];
  title: string;
  description: string;
  category: string;
  /** Candidate corrections from AI (already filtered to valid categories). */
  candidate_title?: string | null;
  candidate_description?: string | null;
  candidate_category?: string | null;
  /** History of accepted/rejected for this fingerprint. */
  history?: SuggestionHistoryEntry[];
  fingerprint?: string;
}): MatrixDecision {
  const rels = input.relationships;
  const byId = (id: RelationshipId) =>
    rels.find((r) => r.id === id)!;

  const td = byId("title_description");
  const tc = byId("title_category");
  const dc = byId("description_category");

  const allConsistent =
    td.status === "consistent" &&
    (tc.status === "consistent" || tc.status === "not_evaluated") &&
    (dc.status === "consistent" || dc.status === "not_evaluated");

  const vagueOrUncertain =
    td.status === "uncertain" ||
    (td.reason_not_safe && /vague|insufficient/i.test(td.reason_not_safe));

  // Case D: all agree
  if (allConsistent) {
    return {
      relationships: rels,
      overall: "consistent",
      primary_correction: null,
      alternatives: [],
      clarification: { required: false, message: "" },
      legacy_validation: "VALID",
    };
  }

  // Case F: vague / insufficient
  if (vagueOrUncertain && td.status !== "mismatch") {
    return {
      relationships: rels,
      overall: "needs_clarification",
      primary_correction: null,
      alternatives: [],
      clarification: {
        required: true,
        message:
          "The task is too vague or incomplete. Add specific details about the work before corrections can be suggested.",
        missing: ["specific actions", "objects or targets", "purpose"],
      },
      legacy_validation: "REVIEW",
    };
  }

  const mismatches = rels.filter((r) => r.status === "mismatch");
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

  const alreadyAccepted = (field: CorrectionField, value: string) =>
    history.some(
      (h) =>
        h.field === field &&
        (h.action === "accepted" || h.action === "applied") &&
        h.input_fingerprint === fp &&
        isSemanticallySame(h.value, value),
    );

  const rejectedCountForInput = history.filter(
    (h) => h.action === "rejected" && h.input_fingerprint === fp,
  ).length;

  // Case A: Description + category agree, title conflicts
  const descCatAgree =
    dc.status === "consistent" ||
    (dc.status !== "mismatch" && tc.status === "mismatch");
  if (
    td.status === "mismatch" &&
    descCatAgree &&
    dc.status !== "mismatch"
  ) {
    const cand = (input.candidate_title || "").trim();
    if (
      cand &&
      !isSemanticallySame(cand, input.title) &&
      !alreadyRejected("title", cand) &&
      !alreadyAccepted("title", cand) &&
      cand.length >= 3
    ) {
      return makeCorrectionDecision(rels, {
        field: "title",
        value: cand,
        reason:
          "Description and category agree; the title does not accurately represent the described work.",
        confidence: Math.max(td.confidence, 0.65),
        second_check_passed: true,
      });
    }
    // No safe title candidate → clarification
    return {
      relationships: rels,
      overall: "needs_clarification",
      primary_correction: null,
      alternatives: [],
      clarification: {
        required: true,
        message:
          "The title conflicts with the description. Please revise the title to match the work described, or clarify the intended task.",
      },
      legacy_validation: "INVALID",
    };
  }

  // Case B: Title + description agree, category conflicts
  if (
    td.status === "consistent" &&
    (tc.status === "mismatch" || dc.status === "mismatch")
  ) {
    const candRaw = (input.candidate_category || "").trim();
    const cand = normalizeCategory(candRaw);
    if (
      isValidCategory(cand) &&
      cand !== normalizeCategory(input.category) &&
      !alreadyRejected("category", cand) &&
      !alreadyAccepted("category", cand)
    ) {
      return makeCorrectionDecision(rels, {
        field: "category",
        value: cand,
        reason:
          "Title and description agree; the selected category does not fit the work being performed.",
        confidence: Math.max(
          tc.status === "mismatch" ? tc.confidence : 0,
          dc.status === "mismatch" ? dc.confidence : 0,
          0.65,
        ),
        second_check_passed: true,
      });
    }
    return {
      relationships: rels,
      overall: "needs_clarification",
      primary_correction: null,
      alternatives: [],
      clarification: {
        required: true,
        message:
          "The category does not match the task. Please choose a category that fits the work, or clarify the task domain.",
      },
      legacy_validation: "REVIEW",
    };
  }

  // Case C: Title + category agree, description conflicts
  if (
    tc.status === "consistent" &&
    td.status === "mismatch" &&
    dc.status !== "consistent"
  ) {
    const cand = (input.candidate_description || "").trim();
    if (
      cand &&
      !isSemanticallySame(cand, input.description) &&
      !alreadyRejected("description", cand) &&
      !alreadyAccepted("description", cand) &&
      cand.length >= 12
    ) {
      // Do not invent deadlines/quantities — candidate must come from model constrained prompt
      return makeCorrectionDecision(rels, {
        field: "description",
        value: cand,
        reason:
          "Title and category agree; the description does not explain the task they represent.",
        confidence: Math.max(td.confidence, 0.65),
        second_check_passed: true,
      });
    }
    return {
      relationships: rels,
      overall: "needs_clarification",
      primary_correction: null,
      alternatives: [],
      clarification: {
        required: true,
        message:
          "The description conflicts with the title and category. Please describe the actual work for this task without inventing extra requirements.",
      },
      legacy_validation: "INVALID",
    };
  }

  // Case E: multiple fields conflict
  if (mismatches.length >= 2) {
    // Prefer correcting the field supported by the strongest consistent pair
    if (
      dc.status === "consistent" &&
      input.candidate_title &&
      !alreadyRejected("title", input.candidate_title)
    ) {
      return makeCorrectionDecision(rels, {
        field: "title",
        value: input.candidate_title.trim(),
        reason:
          "Description and category provide the strongest consistent signal; recommend aligning the title.",
        confidence: 0.6,
        second_check_passed: true,
      });
    }
    if (rejectedCountForInput >= MATRIX_THRESHOLDS.max_alternatives_per_input) {
      return {
        relationships: rels,
        overall: "needs_clarification",
        primary_correction: null,
        alternatives: [],
        clarification: {
          required: true,
          message:
            "Multiple fields conflict and no reliable alternative remains. Please clarify the intended task (title, description, and category).",
        },
        legacy_validation: "INVALID",
      };
    }
    return {
      relationships: rels,
      overall: "needs_clarification",
      primary_correction: null,
      alternatives: [],
      clarification: {
        required: true,
        message:
          "Title, description, and category conflict with each other. Please clarify which field reflects the intended work.",
      },
      legacy_validation: "INVALID",
    };
  }

  // Single mismatch with candidate
  if (mismatches.length === 1) {
    const m = mismatches[0];
    if (m.id === "title_description" && input.candidate_title) {
      const cand = input.candidate_title.trim();
      if (
        !alreadyRejected("title", cand) &&
        !isSemanticallySame(cand, input.title)
      ) {
        return makeCorrectionDecision(rels, {
          field: "title",
          value: cand,
          reason: m.evidence,
          confidence: Math.max(m.confidence, 0.6),
          second_check_passed: true,
        });
      }
    }
    if (
      (m.id === "title_category" || m.id === "description_category") &&
      input.candidate_category
    ) {
      const cand = normalizeCategory(input.candidate_category);
      if (
        isValidCategory(cand) &&
        !alreadyRejected("category", cand) &&
        cand !== normalizeCategory(input.category)
      ) {
        return makeCorrectionDecision(rels, {
          field: "category",
          value: cand,
          reason: m.evidence,
          confidence: Math.max(m.confidence, 0.6),
          second_check_passed: true,
        });
      }
    }
  }

  // Fallback: uncertain
  return {
    relationships: rels,
    overall: "uncertain",
    primary_correction: null,
    alternatives: [],
    clarification: {
      required: true,
      message:
        "Validation could not determine a safe correction. Please review title, description, and category for consistency.",
    },
    legacy_validation: "REVIEW",
  };
}

function makeCorrectionDecision(
  rels: RelationshipResult[],
  correction: PrimaryCorrection,
): MatrixDecision {
  if (correction.confidence < MATRIX_THRESHOLDS.correction_min) {
    return {
      relationships: rels,
      overall: "needs_clarification",
      primary_correction: null,
      alternatives: [],
      clarification: {
        required: true,
        message:
          "A possible correction was considered but confidence is too low. Please clarify the task fields.",
      },
      legacy_validation: "REVIEW",
    };
  }
  if (!correction.second_check_passed) {
    return {
      relationships: rels,
      overall: "needs_clarification",
      primary_correction: null,
      alternatives: [],
      clarification: {
        required: true,
        message:
          "A candidate correction introduced a new contradiction and was discarded. Please clarify the intended task.",
      },
      legacy_validation: "REVIEW",
    };
  }
  return {
    relationships: rels,
    overall: "needs_correction",
    primary_correction: correction,
    alternatives: [],
    clarification: { required: false, message: "" },
    legacy_validation:
      correction.field === "description" || correction.field === "title"
        ? "INVALID"
        : "REVIEW",
  };
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Filter a candidate so it is not identical to rejected/accepted history
 * and is not the current field value.
 */
export function filterCandidate(
  field: CorrectionField,
  candidate: string | null | undefined,
  currentValue: string,
  history: SuggestionHistoryEntry[],
  fingerprint: string,
): string | null {
  const v = (candidate || "").trim();
  if (!v) return null;
  if (field === "category") {
    const n = normalizeCategory(v);
    if (!isValidCategory(n)) return null;
    if (n === normalizeCategory(currentValue)) return null;
    if (
      history.some(
        (h) =>
          h.field === "category" &&
          h.input_fingerprint === fingerprint &&
          isSemanticallySame(h.value, n),
      )
    ) {
      return null;
    }
    return n;
  }
  if (isSemanticallySame(v, currentValue)) return null;
  if (
    history.some(
      (h) =>
        h.field === field &&
        h.input_fingerprint === fingerprint &&
        isSemanticallySame(h.value, v),
    )
  ) {
    return null;
  }
  return v;
}

/**
 * Simple keyword/token relevance for project matching (no embeddings required).
 * Used as a conservative local ranker; AI can refine but ownership is enforced elsewhere.
 */
export function scoreProjectRelevance(
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
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !stop.has(t));

  const taskTokens = [
    ...tokens(taskTitle),
    ...tokens(taskDescription),
  ];
  if (!taskTokens.length) return 0;
  const projTokens = [
    ...tokens(projectName),
    ...tokens(projectDescription || ""),
  ];
  if (!projTokens.length) return 0;

  const projSet = new Set(projTokens);
  let hits = 0;
  for (const t of taskTokens) if (projSet.has(t)) hits++;
  const coverage = hits / taskTokens.length;

  // Name overlap bonus
  const nameTokens = tokens(projectName);
  const nameSet = new Set(nameTokens);
  let nameHits = 0;
  for (const t of tokens(taskTitle)) if (nameSet.has(t)) nameHits++;
  const nameScore =
    nameTokens.length > 0 ? nameHits / Math.max(nameTokens.length, 1) : 0;

  return clamp01(coverage * 0.65 + nameScore * 0.35);
}

export function selectProjectMatch(
  taskTitle: string,
  taskDescription: string,
  projects: { id: string; name: string; description?: string | null }[],
  options?: {
    /** Optional precomputed cosine similarities task↔project (0–1), keyed by project id. */
    embeddingScores?: Record<string, number>;
    /** Blend weight for embedding score vs lexical (default 0.55 embedding when present). */
    embeddingWeight?: number;
    rejectedProjectIds?: string[];
  },
): {
  project_id: string;
  project_name: string;
  reason: string;
  relevance: number;
  method: "lexical" | "hybrid";
} | null {
  if (!projects.length) return null;
  const rejected = new Set(options?.rejectedProjectIds || []);
  const emb = options?.embeddingScores;
  const embW =
    emb && Object.keys(emb).length > 0
      ? clamp01(options?.embeddingWeight ?? 0.55)
      : 0;
  const lexW = 1 - embW;
  const method: "lexical" | "hybrid" = embW > 0 ? "hybrid" : "lexical";

  const scored = projects
    .filter((p) => p.id && !rejected.has(p.id))
    .map((p) => {
      const lexical = scoreProjectRelevance(
        taskTitle,
        taskDescription,
        p.name,
        p.description,
      );
      const semantic = emb && typeof emb[p.id] === "number" ? clamp01(emb[p.id]) : 0;
      const relevance =
        embW > 0 ? clamp01(lexW * lexical + embW * semantic) : lexical;
      return { ...p, relevance, lexical, semantic };
    })
    .sort((a, b) => b.relevance - a.relevance);

  if (!scored.length) return null;
  const best = scored[0];
  const second = scored[1];
  if (best.relevance < MATRIX_THRESHOLDS.project_match_min) return null;
  if (
    second &&
    best.relevance - second.relevance < MATRIX_THRESHOLDS.project_match_margin
  ) {
    return null; // ambiguous
  }
  return {
    project_id: best.id,
    project_name: best.name,
    reason: `Task intent aligns with project “${best.name}”.`,
    relevance: Math.round(best.relevance * 1000) / 1000,
    method,
  };
}

/**
 * Second-pass consistency check for a proposed correction.
 *
 * Applies the candidate to a temporary copy of the task, re-evaluates the
 * three relationships using deterministic/local signals (and optional
 * semantic scores if provided), and rejects candidates that introduce a
 * new mismatch or fail category validity.
 *
 * When full semantic re-embedding is unavailable, uses conservative
 * lexical relatedness + contradiction heuristics. Callers must not claim
 * full semantic revalidation if semantic scores were not supplied.
 */
export function secondPassConsistencyCheck(input: {
  title: string;
  description: string;
  category: string;
  correction: PrimaryCorrection;
  /** Optional semantic title↔description score after applying candidate (0–1). */
  semantic_title_desc?: number;
  /** Optional title↔category / description↔category scores after candidate. */
  semantic_title_cat?: number;
  semantic_desc_cat?: number;
  history?: SuggestionHistoryEntry[];
  fingerprint?: string;
}): {
  passed: boolean;
  reason: string;
  method: "deterministic" | "hybrid";
  relationships?: RelationshipResult[];
} {
  const { correction } = input;
  let title = input.title;
  let description = input.description;
  let category = input.category;

  if (correction.field === "title") title = correction.value;
  else if (correction.field === "description") description = correction.value;
  else if (correction.field === "category") category = correction.value;

  // History / duplicate guard
  const fp = input.fingerprint || inputFingerprint(input.title, input.description, input.category);
  if (
    filterCandidate(
      correction.field,
      correction.value,
      correction.field === "title"
        ? input.title
        : correction.field === "description"
          ? input.description
          : input.category,
      input.history || [],
      fp,
    ) === null
  ) {
    return {
      passed: false,
      reason: "Candidate matches an accepted or rejected suggestion for unchanged inputs.",
      method: "deterministic",
    };
  }

  // Category validity
  if (correction.field === "category" && !isValidCategory(normalizeCategory(category))) {
    return {
      passed: false,
      reason: "Candidate category is not a supported GSI category.",
      method: "deterministic",
    };
  }

  // Completeness for description candidates
  if (correction.field === "description") {
    const d = description.trim();
    if (d.length < 12) {
      return {
        passed: false,
        reason: "Candidate description is too short or incomplete.",
        method: "deterministic",
      };
    }
  }

  // Lexical relatedness after applying candidate
  const lexicalTd = basicLexicalRelatedness(title, description);
  const hasSemantic = typeof input.semantic_title_desc === "number";
  const tdScore = hasSemantic
    ? clamp01(0.45 * lexicalTd + 0.55 * clamp01(input.semantic_title_desc!))
    : lexicalTd;

  // Detect obvious action conflict (simple negation / domain clash heuristics)
  const contradiction = detectLocalContradiction(title, description);

  // Category fit heuristics
  const cat = normalizeCategory(category);
  const titleCatLex = categoryKeywordFit(title, cat);
  const descCatLex = categoryKeywordFit(description, cat);
  const titleCat = typeof input.semantic_title_cat === "number"
    ? clamp01(0.4 * titleCatLex + 0.6 * clamp01(input.semantic_title_cat))
    : titleCatLex;
  const descCat = typeof input.semantic_desc_cat === "number"
    ? clamp01(0.4 * descCatLex + 0.6 * clamp01(input.semantic_desc_cat))
    : descCatLex;

  const completeness =
    correction.field === "description"
      ? Math.min(0.85, description.trim().length / 80)
      : 0.7;

  const relationships = buildRelationships({
    title,
    description,
    category: cat,
    title_desc_score: tdScore,
    title_desc_contradiction: contradiction,
    title_cat_score: titleCat,
    desc_cat_score: descCat,
    completeness,
    repetition: isSemanticallySame(title, description),
  });

  const mismatches = relationships.filter((r) => r.status === "mismatch");
  // Candidate must not leave the targeted relationship as mismatch with low confidence
  // and must not create more mismatches than it resolves for the other fields.
  if (contradiction && correction.field !== "description" && correction.field !== "title") {
    return {
      passed: false,
      reason: "Candidate leaves a title–description contradiction unresolved.",
      method: hasSemantic ? "hybrid" : "deterministic",
      relationships,
    };
  }

  // For title corrections: description+category should remain consistent or improve
  if (correction.field === "title") {
    const dc = relationships.find((r) => r.id === "description_category")!;
    if (dc.status === "mismatch") {
      return {
        passed: false,
        reason: "Title candidate would leave description–category mismatched.",
        method: hasSemantic ? "hybrid" : "deterministic",
        relationships,
      };
    }
    // Title must share meaningful signal with description (strict for second pass)
    if (tdScore < 0.2) {
      return {
        passed: false,
        reason: "Title candidate is not related to the description.",
        method: hasSemantic ? "hybrid" : "deterministic",
        relationships,
      };
    }
    if (tdScore < 0.3 && contradiction) {
      return {
        passed: false,
        reason: "Title candidate still contradicts the description.",
        method: hasSemantic ? "hybrid" : "deterministic",
        relationships,
      };
    }
    const originalLex = basicLexicalRelatedness(input.title, input.description);
    if (originalLex >= 0.35 && tdScore + 0.05 < originalLex) {
      return {
        passed: false,
        reason: "Title candidate does not improve relatedness to the description.",
        method: hasSemantic ? "hybrid" : "deterministic",
        relationships,
      };
    }
    if (isValidCategory(cat) && titleCat < 0.25 && descCat >= 0.5) {
      return {
        passed: false,
        reason: "Title candidate does not fit the established category.",
        method: hasSemantic ? "hybrid" : "deterministic",
        relationships,
      };
    }
  }

  if (correction.field === "description") {
    const tc = relationships.find((r) => r.id === "title_category")!;
    if (tc.status === "mismatch" && titleCat < 0.4) {
      return {
        passed: false,
        reason: "Description candidate conflicts with title–category alignment.",
        method: hasSemantic ? "hybrid" : "deterministic",
        relationships,
      };
    }
    if (tdScore < 0.25 && contradiction) {
      return {
        passed: false,
        reason: "Description candidate still contradicts the title.",
        method: hasSemantic ? "hybrid" : "deterministic",
        relationships,
      };
    }
  }

  if (correction.field === "category") {
    // After category change, at least one of title/desc should fit the new category
    if (titleCat < 0.25 && descCat < 0.25) {
      return {
        passed: false,
        reason: "Category candidate does not fit title or description.",
        method: hasSemantic ? "hybrid" : "deterministic",
        relationships,
      };
    }
  }

  // Too many remaining mismatches → reject
  if (mismatches.length >= 2 && contradiction) {
    return {
      passed: false,
      reason: "Candidate does not resolve the multi-field conflict.",
      method: hasSemantic ? "hybrid" : "deterministic",
      relationships,
    };
  }

  return {
    passed: true,
    reason: "Candidate passed second-pass consistency checks.",
    method: hasSemantic ? "hybrid" : "deterministic",
    relationships,
  };
}

/** Local lexical relatedness (same spirit as edge-function basicTextRelatedness). */
export function basicLexicalRelatedness(a: string, b: string): number {
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
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const setB = new Set(tb);
  let hits = 0;
  for (const t of ta) if (setB.has(t)) hits++;
  return hits / ta.length;
}

/** Simple local contradiction heuristics (negation / domain clash). */
export function detectLocalContradiction(title: string, description: string): boolean {
  const t = title.toLowerCase();
  const d = description.toLowerCase();
  if (!t.trim() || !d.trim()) return false;
  // Explicit negation of title action in description
  const actionWords = t
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  for (const w of actionWords.slice(0, 4)) {
    if (
      new RegExp(`\\b(do not|don't|never|avoid)\\s+${w}\\b`, "i").test(d)
    ) {
      return true;
    }
  }
  // Very low lexical overlap + different high-signal domains
  const rel = basicLexicalRelatedness(title, description);
  if (rel < 0.15) {
    const domains = [
      ["email", "client", "reply", "respond", "inquiry", "ticket", "support"],
      ["game", "play", "chess", "video", "grocery", "cook", "dinner", "plant", "water", "garden", "shed", "hedge"],
      ["tax", "invoice", "bookkeep", "finance", "payroll"],
      ["social", "instagram", "linkedin", "post", "campaign"],
    ];
    const which = (s: string) =>
      domains.findIndex((group) => group.some((k) => s.includes(k)));
    const dt = which(t);
    const dd = which(d);
    if (dt >= 0 && dd >= 0 && dt !== dd) return true;
  }
  return false;
}

/** Keyword-based category fit for second-pass when embeddings unavailable. */
export function categoryKeywordFit(text: string, category: string): number {
  const keywords: Record<string, string[]> = {
    "Client Communication": ["client", "reply", "respond", "inquiry", "follow", "message", "update"],
    "Customer Support": ["support", "ticket", "complaint", "customer", "issue", "resolve"],
    "Email Management": ["email", "inbox", "mailbox", "unread"],
    "Calendar & Scheduling": ["calendar", "schedule", "appointment", "meeting", "booking"],
    "Administrative Tasks": ["admin", "paperwork", "form", "office", "process"],
    "Data Entry": ["data", "enter", "encode", "spreadsheet", "csv", "records"],
    "Research": ["research", "investigate", "competitor", "gather"],
    "Report & Documentation": ["report", "documentation", "summary", "document", "weekly"],
    "File & Document Management": ["file", "folder", "drive", "archive", "organize", "rename"],
    "Project Coordination": ["project", "milestone", "tracker", "coordinate", "progress"],
    "Lead Generation": ["lead", "prospect", "potential client", "sales lead"],
    "CRM Management": ["crm", "pipeline", "lead status", "contact record"],
    "Social Media Management": ["social", "instagram", "linkedin", "post", "campaign"],
    "Content Creation": ["content", "write", "blog", "copy", "draft content"],
    "E-commerce Support": ["order", "ecommerce", "product listing", "shopify"],
    "Bookkeeping & Finance": ["invoice", "bookkeep", "finance", "tax", "payroll", "expense"],
    "Meeting & Coordination": ["meeting", "agenda", "notes", "standup"],
    "Personal Assistance": ["personal", "errand", "travel", "assistant"],
    "General / Other": [],
  };
  const keys = keywords[normalizeCategory(category)] || [];
  if (!keys.length) return 0.55;
  const lower = text.toLowerCase();
  let hits = 0;
  for (const k of keys) if (lower.includes(k)) hits++;
  if (hits === 0) return 0.2;
  return clamp01(0.35 + hits * 0.15);
}

/**
 * Decide correction with mandatory second-pass check.
 * Wraps decideCorrection and re-validates the primary candidate.
 */
export function decideCorrectionWithSecondPass(input: {
  relationships: RelationshipResult[];
  title: string;
  description: string;
  category: string;
  candidate_title?: string | null;
  candidate_description?: string | null;
  candidate_category?: string | null;
  history?: SuggestionHistoryEntry[];
  fingerprint?: string;
  /** Optional semantic scores for second pass. */
  semantic_after?: {
    title_desc?: number;
    title_cat?: number;
    desc_cat?: number;
  };
}): MatrixDecision {
  const decision = decideCorrection(input);
  if (!decision.primary_correction) return decision;

  const check = secondPassConsistencyCheck({
    title: input.title,
    description: input.description,
    category: input.category,
    correction: decision.primary_correction,
    semantic_title_desc: input.semantic_after?.title_desc,
    semantic_title_cat: input.semantic_after?.title_cat,
    semantic_desc_cat: input.semantic_after?.desc_cat,
    history: input.history,
    fingerprint: input.fingerprint,
  });

  if (!check.passed) {
    return {
      relationships: input.relationships,
      overall: "needs_clarification",
      primary_correction: null,
      alternatives: [],
      clarification: {
        required: true,
        message:
          check.reason ||
          "A candidate correction failed the second consistency check. Please clarify the intended task.",
      },
      legacy_validation: "REVIEW",
    };
  }

  return {
    ...decision,
    primary_correction: {
      ...decision.primary_correction,
      second_check_passed: true,
    },
  };
}

/** Cosine similarity for embedding vectors (shared helper). */
export function cosineSimilarity(a: number[], b: number[]): number {
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
  return Math.min(1, Math.max(0, dot / denom));
}
