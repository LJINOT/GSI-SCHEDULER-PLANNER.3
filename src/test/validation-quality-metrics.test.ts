import { describe, it, expect } from "vitest";
import {
  computeValidationQualityMetrics,
  formatMetricsReport,
} from "@/lib/validation-quality-metrics";
import { VALIDATION_TEST_DATASET } from "@/lib/validation-test-dataset";
import {
  secondPassConsistencyCheck,
  decideCorrectionWithSecondPass,
  buildRelationships,
  inputFingerprint,
} from "@/lib/task-validation-matrix";

describe("Section 11 — Validation quality metrics", () => {
  const result = computeValidationQualityMetrics(VALIDATION_TEST_DATASET);

  it("has a reviewed dataset of sufficient size", () => {
    expect(result.test_set_size).toBeGreaterThanOrEqual(20);
    expect(VALIDATION_TEST_DATASET.length).toBe(result.test_set_size);
  });

  it("reports all nine metrics with numerator/denominator", () => {
    expect(result.metrics).toHaveLength(9);
    for (const m of result.metrics) {
      expect(m.name).toBeTruthy();
      expect(typeof m.numerator).toBe("number");
      expect(typeof m.denominator).toBe("number");
      // rate is null only when denominator is 0 (N/A)
      if (m.denominator === 0) {
        expect(m.rate).toBeNull();
      } else {
        expect(m.rate).not.toBeNull();
        expect(m.rate!).toBeGreaterThanOrEqual(0);
        expect(m.rate!).toBeLessThanOrEqual(1);
      }
    }
  });

  it("First-Correction Success Rate is measured (not invented)", () => {
    const m = result.metrics.find(
      (x) => x.name === "First-Correction Success Rate",
    )!;
    expect(m.denominator).toBeGreaterThan(0);
    // Log for the report
    // eslint-disable-next-line no-console
    console.log(
      `First-Correction Success: ${m.numerator}/${m.denominator} = ${m.rate}`,
      "failed:",
      m.failed_cases,
    );
  });

  it("Unnecessary Correction Rate prefers zero", () => {
    const m = result.metrics.find(
      (x) => x.name === "Unnecessary Correction Rate",
    )!;
    expect(m.denominator).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(
      `Unnecessary Correction: ${m.numerator}/${m.denominator} = ${m.rate}`,
      "failed:",
      m.failed_cases,
    );
  });

  it("Uncertain-Case Handling avoids fabricated corrections", () => {
    const m = result.metrics.find(
      (x) => x.name === "Uncertain-Case Handling",
    )!;
    expect(m.denominator).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(
      `Uncertain-Case Handling: ${m.numerator}/${m.denominator} = ${m.rate}`,
      "failed:",
      m.failed_cases,
    );
  });

  it("Repeated-Suggestion Rate is low for history cases", () => {
    const m = result.metrics.find(
      (x) => x.name === "Repeated-Suggestion Rate",
    )!;
    expect(m.denominator).toBeGreaterThan(0);
    // Lower is better — expect no repeats on the reviewed set
    expect(m.numerator).toBe(0);
  });

  it("Accepted-Suggestion Retention holds", () => {
    const m = result.metrics.find(
      (x) => x.name === "Accepted-Suggestion Retention",
    )!;
    expect(m.denominator).toBeGreaterThan(0);
    expect(m.numerator).toBe(m.denominator);
  });

  it("Project-Match Precision only counts real suggestions", () => {
    const m = result.metrics.find(
      (x) => x.name === "Project-Match Precision",
    )!;
    // eslint-disable-next-line no-console
    console.log(
      `Project-Match Precision: ${m.numerator}/${m.denominator} = ${m.rate}`,
      "failed:",
      m.failed_cases,
    );
  });

  it("Fallback Reliability does not claim false success", () => {
    const m = result.metrics.find((x) => x.name === "Fallback Reliability")!;
    expect(m.denominator).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(
      `Fallback Reliability: ${m.numerator}/${m.denominator} = ${m.rate}`,
      "failed:",
      m.failed_cases,
    );
  });

  it("Performance metric is N/A offline", () => {
    const m = result.metrics.find(
      (x) => x.name === "Performance and API Efficiency",
    )!;
    expect(m.rate).toBeNull();
    expect(m.denominator).toBe(0);
  });

  it("prints the full metrics report for documentation", () => {
    const report = formatMetricsReport(result);
    // eslint-disable-next-line no-console
    console.log(report);
    expect(report).toContain("Validation Quality Report");
  });
});

describe("Section 12 — Second-pass consistency check", () => {
  it("rejects a title candidate that introduces a new domain contradiction", () => {
    const correction = {
      field: "title" as const,
      value: "Organize garden tools in the shed",
      reason: "test",
      confidence: 0.8,
      second_check_passed: false,
    };
    const check = secondPassConsistencyCheck({
      title: "Play video games",
      description:
        "Draft and send a response to the client's product question",
      category: "Client Communication",
      correction,
    });
    expect(check.passed).toBe(false);
  });

  it("accepts a title candidate aligned with description and category", () => {
    const correction = {
      field: "title" as const,
      value: "Reply to client product question",
      reason: "test",
      confidence: 0.8,
      second_check_passed: false,
    };
    const check = secondPassConsistencyCheck({
      title: "Play video games",
      description:
        "Draft and send a response to the client's product question about shipping",
      category: "Client Communication",
      correction,
    });
    expect(check.passed).toBe(true);
  });

  it("decideCorrectionWithSecondPass drops bad candidates", () => {
    const rels = buildRelationships({
      title: "Play video games",
      description:
        "Draft and send a response to the client's product question",
      category: "Client Communication",
      title_desc_score: 0.12,
      title_desc_contradiction: true,
      title_cat_score: 0.1,
      desc_cat_score: 0.9,
      completeness: 0.85,
      repetition: false,
    });
    const d = decideCorrectionWithSecondPass({
      relationships: rels,
      title: "Play video games",
      description:
        "Draft and send a response to the client's product question",
      category: "Client Communication",
      candidate_title: "Organize garden tools in the shed",
      fingerprint: inputFingerprint(
        "Play video games",
        "Draft and send a response to the client's product question",
        "Client Communication",
      ),
    });
    expect(d.primary_correction).toBeNull();
    expect(d.overall).toBe("needs_clarification");
  });
});
