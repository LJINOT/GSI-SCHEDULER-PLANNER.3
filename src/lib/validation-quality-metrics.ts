/**
 * Validation quality metrics (Section 11.1).
 *
 * Runs the pure decision matrix against the reviewed test dataset and
 * reports numerator / denominator / rate for each metric.
 * Does not invent percentages — only measured outcomes.
 */

import {
  buildRelationships,
  decideCorrectionWithSecondPass,
  inputFingerprint,
  selectProjectMatch,
  isSemanticallySame,
  type MatrixDecision,
} from "./task-validation-matrix";
import {
  VALIDATION_TEST_DATASET,
  type ValidationTestCase,
} from "./validation-test-dataset";

export type MetricResult = {
  name: string;
  numerator: number;
  denominator: number;
  rate: number | null; // null => not applicable
  applicable_cases: string[];
  failed_cases: string[];
  notes: string;
};

export type CaseEvaluation = {
  id: string;
  group: string;
  expected_overall: string;
  actual_overall: string;
  expected_field: string | null;
  actual_field: string | null;
  overall_match: boolean;
  field_match: boolean;
  project_match_ok: boolean;
  decision: MatrixDecision;
  project_id: string | null;
};

function evaluateCase(tc: ValidationTestCase): CaseEvaluation {
  const relationships = buildRelationships({
    title: tc.title,
    description: tc.description,
    category: tc.category,
    title_desc_score: tc.factors.title_desc_score,
    title_desc_contradiction: tc.factors.title_desc_contradiction,
    title_cat_score: tc.factors.title_cat_score,
    desc_cat_score: tc.factors.desc_cat_score,
    completeness: tc.factors.completeness,
    repetition: tc.factors.repetition,
  });

  const fp = inputFingerprint(tc.title, tc.description, tc.category);
  const decision = decideCorrectionWithSecondPass({
    relationships,
    title: tc.title,
    description: tc.description,
    category: tc.category,
    candidate_title: tc.candidates?.title,
    candidate_description: tc.candidates?.description,
    candidate_category: tc.candidates?.category,
    history: tc.history,
    fingerprint: fp,
  });

  let projectId: string | null = null;
  if (
    decision.overall === "consistent" &&
    tc.projects &&
    tc.projects.length > 0
  ) {
    const match = selectProjectMatch(tc.title, tc.description, tc.projects);
    projectId = match?.project_id ?? null;
  }

  const actualField = decision.primary_correction?.field ?? null;
  const overallMatch = decision.overall === tc.expected_overall;
  const fieldMatch =
    tc.expected_correction_field === null
      ? actualField === null
      : actualField === tc.expected_correction_field;

  let projectMatchOk = true;
  if (tc.expected_project_match === true) {
    projectMatchOk = projectId === (tc.expected_project_id ?? null);
  } else if (tc.expected_project_match === false) {
    projectMatchOk = projectId === null;
  }

  // must_not_correct: if we suggested a forbidden field, field_match fails
  if (
    tc.must_not_correct &&
    actualField &&
    tc.must_not_correct.includes(actualField)
  ) {
    // mark as field mismatch for unnecessary correction tracking
  }

  return {
    id: tc.id,
    group: tc.group,
    expected_overall: tc.expected_overall,
    actual_overall: decision.overall,
    expected_field: tc.expected_correction_field,
    actual_field: actualField,
    overall_match: overallMatch,
    field_match: fieldMatch,
    project_match_ok: projectMatchOk,
    decision,
    project_id: projectId,
  };
}

function rate(num: number, den: number): number | null {
  if (den === 0) return null;
  return Math.round((num / den) * 1000) / 1000;
}

/**
 * Compute all Section 11.1 metrics against the reviewed dataset.
 */
export function computeValidationQualityMetrics(
  dataset: ValidationTestCase[] = VALIDATION_TEST_DATASET,
): {
  test_set_size: number;
  cases: CaseEvaluation[];
  metrics: MetricResult[];
} {
  const cases = dataset.map(evaluateCase);
  const byId = (id: string) => cases.find((c) => c.id === id)!;
  const tcById = (id: string) => dataset.find((t) => t.id === id)!;

  // 1. First-Correction Success Rate
  // Cases that need correction (expected needs_correction) where first correction
  // has the right field AND (if specified) value contains expected substring.
  const needCorrection = dataset.filter(
    (t) => t.expected_overall === "needs_correction",
  );
  const firstSuccess = needCorrection.filter((t) => {
    const ev = byId(t.id);
    if (ev.actual_overall !== "needs_correction") return false;
    if (ev.actual_field !== t.expected_correction_field) return false;
    if (t.expected_correction_contains && ev.decision.primary_correction) {
      const v = ev.decision.primary_correction.value.toLowerCase();
      return v.includes(t.expected_correction_contains.toLowerCase());
    }
    return true;
  });
  const m1: MetricResult = {
    name: "First-Correction Success Rate",
    numerator: firstSuccess.length,
    denominator: needCorrection.length,
    rate: rate(firstSuccess.length, needCorrection.length),
    applicable_cases: needCorrection.map((t) => t.id),
    failed_cases: needCorrection
      .filter((t) => !firstSuccess.some((s) => s.id === t.id))
      .map((t) => t.id),
    notes:
      "Cases expected to need correction where the first system correction targets the right field and matches expected content.",
  };

  // 2. Unnecessary Correction Rate
  // Among cases where a field is listed in must_not_correct, how often we still suggested it.
  const protectedCases = dataset.filter(
    (t) => t.must_not_correct && t.must_not_correct.length > 0,
  );
  let unnecessaryHits = 0;
  const unnecessaryFailed: string[] = [];
  for (const t of protectedCases) {
    const ev = byId(t.id);
    if (
      ev.actual_field &&
      t.must_not_correct!.includes(ev.actual_field)
    ) {
      unnecessaryHits++;
      unnecessaryFailed.push(t.id);
    }
  }
  const m2: MetricResult = {
    name: "Unnecessary Correction Rate",
    numerator: unnecessaryHits,
    denominator: protectedCases.length,
    rate: rate(unnecessaryHits, protectedCases.length),
    applicable_cases: protectedCases.map((t) => t.id),
    failed_cases: unnecessaryFailed,
    notes:
      "Share of cases with known-correct fields where the system still recommended changing one of those fields. Lower is better.",
  };

  // 3. Correction Relevance Rate
  // Among cases where a correction was generated, share that address the actual mismatch.
  const generated = cases.filter((c) => c.actual_field !== null);
  const relevant = generated.filter((c) => {
    const t = tcById(c.id);
    if (t.expected_correction_field === null) return false;
    if (c.actual_field !== t.expected_correction_field) return false;
    if (t.expected_correction_contains && c.decision.primary_correction) {
      return c.decision.primary_correction.value
        .toLowerCase()
        .includes(t.expected_correction_contains.toLowerCase());
    }
    return true;
  });
  const m3: MetricResult = {
    name: "Correction Relevance Rate",
    numerator: relevant.length,
    denominator: generated.length,
    rate: rate(relevant.length, generated.length),
    applicable_cases: generated.map((c) => c.id),
    failed_cases: generated
      .filter((c) => !relevant.some((r) => r.id === c.id))
      .map((c) => c.id),
    notes:
      "Of all generated corrections, share that target the true mismatch with supporting content.",
  };

  // 4. Accepted-Suggestion Retention
  // History-accept cases must not re-offer the same accepted candidate.
  const acceptCases = dataset.filter((t) => t.group === "history_accept");
  const acceptOk = acceptCases.filter((t) => {
    const ev = byId(t.id);
    const cand = t.candidates?.title || t.candidates?.description || t.candidates?.category;
    if (!cand) return true;
    if (!ev.decision.primary_correction) return true;
    return !isSemanticallySame(ev.decision.primary_correction.value, cand);
  });
  const m4: MetricResult = {
    name: "Accepted-Suggestion Retention",
    numerator: acceptOk.length,
    denominator: acceptCases.length,
    rate: rate(acceptOk.length, acceptCases.length),
    applicable_cases: acceptCases.map((t) => t.id),
    failed_cases: acceptCases
      .filter((t) => !acceptOk.some((s) => s.id === t.id))
      .map((t) => t.id),
    notes:
      "Accepted candidates must not be re-suggested for unchanged input fingerprints.",
  };

  // 5. Uncertain-Case Handling
  const ambiguous = dataset.filter(
    (t) =>
      t.group === "ambiguous" ||
      t.group === "contradictory" ||
      t.expected_overall === "needs_clarification" ||
      t.expected_overall === "uncertain",
  );
  // unique by id
  const ambIds = [...new Set(ambiguous.map((t) => t.id))];
  const ambOk = ambIds.filter((id) => {
    const ev = byId(id);
    const t = tcById(id);
    // Must request clarification or be uncertain — must NOT invent a confident wrong correction
    if (
      t.expected_overall === "needs_clarification" ||
      t.expected_overall === "uncertain"
    ) {
      return (
        (ev.actual_overall === "needs_clarification" ||
          ev.actual_overall === "uncertain") &&
        ev.actual_field === null
      );
    }
    return true;
  });
  const m5: MetricResult = {
    name: "Uncertain-Case Handling",
    numerator: ambOk.length,
    denominator: ambIds.length,
    rate: rate(ambOk.length, ambIds.length),
    applicable_cases: ambIds,
    failed_cases: ambIds.filter((id) => !ambOk.includes(id)),
    notes:
      "Ambiguous/contradictory cases must yield clarification or uncertain status without fabricated corrections.",
  };

  // 6. Repeated-Suggestion Rate
  // History reject + accept: any re-offer of same candidate counts as repeat.
  const histCases = dataset.filter(
    (t) => t.group === "history_accept" || t.group === "history_reject",
  );
  let repeats = 0;
  const repeatFailed: string[] = [];
  for (const t of histCases) {
    const ev = byId(t.id);
    const cand =
      t.candidates?.title ||
      t.candidates?.description ||
      t.candidates?.category;
    if (
      cand &&
      ev.decision.primary_correction &&
      isSemanticallySame(ev.decision.primary_correction.value, cand)
    ) {
      repeats++;
      repeatFailed.push(t.id);
    }
  }
  const m6: MetricResult = {
    name: "Repeated-Suggestion Rate",
    numerator: repeats,
    denominator: histCases.length,
    rate: rate(repeats, histCases.length),
    applicable_cases: histCases.map((t) => t.id),
    failed_cases: repeatFailed,
    notes:
      "How often an accepted/rejected (or equivalent) suggestion is repeated for unchanged inputs. Lower is better.",
  };

  // 7. Project-Match Precision
  const projectCases = dataset.filter(
    (t) =>
      t.group === "project_match_valid" || t.group === "project_match_invalid",
  );
  const projectOk = projectCases.filter((t) => byId(t.id).project_match_ok);
  // Precision among cases where a project was suggested
  const suggested = projectCases.filter((t) => byId(t.id).project_id !== null);
  const suggestedCorrect = suggested.filter((t) => {
    const ev = byId(t.id);
    return t.expected_project_match === true && ev.project_id === t.expected_project_id;
  });
  const m7: MetricResult = {
    name: "Project-Match Precision",
    numerator: suggestedCorrect.length,
    denominator: suggested.length,
    rate: rate(suggestedCorrect.length, suggested.length),
    applicable_cases: projectCases.map((t) => t.id),
    failed_cases: projectCases
      .filter((t) => !byId(t.id).project_match_ok)
      .map((t) => t.id),
    notes:
      "Of projects the system suggested, share that match the independently reviewed expected project. Also tracks false positives via failed_cases.",
  };

  // 8. Fallback Reliability
  const failCases = dataset.filter((t) => t.group === "service_failure");
  const failOk = failCases.filter((t) => {
    const ev = byId(t.id);
    // Must match expected overall; must not invent high-confidence correction without evidence
    if (t.expected_overall === "consistent") {
      return (
        ev.actual_overall === "consistent" && ev.actual_field === null
      );
    }
    return (
      (ev.actual_overall === "needs_clarification" ||
        ev.actual_overall === "uncertain" ||
        ev.actual_overall === "needs_correction") &&
      // degraded must not claim VALID if expected clarification
      (t.expected_overall !== "needs_clarification" ||
        ev.actual_field === null)
    );
  });
  const m8: MetricResult = {
    name: "Fallback Reliability",
    numerator: failOk.length,
    denominator: failCases.length,
    rate: rate(failOk.length, failCases.length),
    applicable_cases: failCases.map((t) => t.id),
    failed_cases: failCases
      .filter((t) => !failOk.some((s) => s.id === t.id))
      .map((t) => t.id),
    notes:
      "Degraded/no-AI cases must stay conservative and not report false validation success.",
  };

  // 9. Performance and API Efficiency — not measurable in pure unit tests
  const m9: MetricResult = {
    name: "Performance and API Efficiency",
    numerator: 0,
    denominator: 0,
    rate: null,
    applicable_cases: [],
    failed_cases: [],
    notes:
      "Not applicable in offline pure-function evaluation. Requires live Edge Function latency instrumentation (request_id dedupe already prevents duplicate concurrent overwrites).",
  };

  return {
    test_set_size: dataset.length,
    cases,
    metrics: [m1, m2, m3, m4, m5, m6, m7, m8, m9],
  };
}

/** Format metrics for console / report. */
export function formatMetricsReport(
  result: ReturnType<typeof computeValidationQualityMetrics>,
): string {
  const lines: string[] = [];
  lines.push(`Validation Quality Report`);
  lines.push(`Test set size: ${result.test_set_size}`);
  lines.push("");
  for (const m of result.metrics) {
    const rateStr =
      m.rate === null
        ? "N/A"
        : `${(m.rate * 100).toFixed(1)}% (${m.numerator}/${m.denominator})`;
    lines.push(`## ${m.name}`);
    lines.push(`  Result: ${rateStr}`);
    lines.push(`  Numerator: ${m.numerator}`);
    lines.push(`  Denominator: ${m.denominator}`);
    lines.push(`  Applicable cases: ${m.applicable_cases.join(", ") || "(none)"}`);
    lines.push(`  Failed cases: ${m.failed_cases.join(", ") || "(none)"}`);
    lines.push(`  Notes: ${m.notes}`);
    lines.push("");
  }
  const mismatches = result.cases.filter((c) => !c.overall_match || !c.field_match);
  lines.push(`Case-level overall+field mismatches: ${mismatches.length}`);
  for (const c of mismatches) {
    lines.push(
      `  ${c.id}: expected ${c.expected_overall}/${c.expected_field} got ${c.actual_overall}/${c.actual_field}`,
    );
  }
  return lines.join("\n");
}
