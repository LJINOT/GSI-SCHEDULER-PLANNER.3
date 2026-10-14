import { describe, it, expect } from "vitest";
import {
  buildRelationships,
  decideCorrection,
  filterCandidate,
  inputFingerprint,
  isSemanticallySame,
  normalizeCategory,
  isValidCategory,
  scoreProjectRelevance,
  selectProjectMatch,
  MATRIX_THRESHOLDS,
  type SuggestionHistoryEntry,
} from "@/lib/task-validation-matrix";

describe("normalizeCategory / isValidCategory", () => {
  it("normalizes known aliases", () => {
    expect(normalizeCategory("Bookkeeping")).toBe("Bookkeeping & Finance");
    expect(normalizeCategory("General")).toBe("General / Other");
  });
  it("rejects unknown categories to General / Other via normalize", () => {
    expect(normalizeCategory("Made Up Category")).toBe("General / Other");
  });
  it("validates exact supported names", () => {
    expect(isValidCategory("Email Management")).toBe(true);
    expect(isValidCategory("Fake Category")).toBe(false);
  });
});

describe("inputFingerprint and semantic sameness", () => {
  it("produces stable fingerprints", () => {
    const a = inputFingerprint("Reply to client", "Send update email", "Client Communication");
    const b = inputFingerprint("Reply to client!", "Send update email.", "Client Communication");
    expect(a).toBe(b);
  });
  it("detects near-duplicate suggestions", () => {
    expect(isSemanticallySame("Reply to client email", "reply to client email")).toBe(true);
    expect(isSemanticallySame("Reply to client", "Organize google drive files")).toBe(false);
  });
});

describe("buildRelationships — three independent relationships", () => {
  it("Case D: all consistent", () => {
    const rels = buildRelationships({
      title: "Reply to client inquiry",
      description: "Draft and send a response to the client's product question",
      category: "Client Communication",
      title_desc_score: 0.88,
      title_desc_contradiction: false,
      title_cat_score: 0.9,
      desc_cat_score: 0.9,
      completeness: 0.8,
      repetition: false,
    });
    expect(rels.every((r) => r.status === "consistent")).toBe(true);
  });

  it("Case A signal: title conflicts while description is solid", () => {
    const rels = buildRelationships({
      title: "Play video games",
      description: "Draft and send a response to the client's product question",
      category: "Client Communication",
      title_desc_score: 0.2,
      title_desc_contradiction: true,
      title_cat_score: 0.15,
      desc_cat_score: 0.9,
      completeness: 0.8,
      repetition: false,
    });
    const td = rels.find((r) => r.id === "title_description")!;
    const dc = rels.find((r) => r.id === "description_category")!;
    expect(td.status).toBe("mismatch");
    expect(dc.status).toBe("consistent");
  });

  it("Case F: vague description → uncertain, not confident mismatch", () => {
    const rels = buildRelationships({
      title: "Important task",
      description: "do it",
      category: "Administrative Tasks",
      title_desc_score: 0.3,
      title_desc_contradiction: false,
      title_cat_score: 0.5,
      desc_cat_score: 0.4,
      completeness: 0.1,
      repetition: false,
    });
    const td = rels.find((r) => r.id === "title_description")!;
    expect(td.status).toBe("uncertain");
    expect(td.correction_safe).toBe(false);
  });
});

describe("decideCorrection — deterministic cases A–F", () => {
  const baseConsistentRels = buildRelationships({
    title: "Reply to client",
    description: "Send a polite reply addressing their billing question",
    category: "Client Communication",
    title_desc_score: 0.9,
    title_desc_contradiction: false,
    title_cat_score: 0.9,
    desc_cat_score: 0.9,
    completeness: 0.85,
    repetition: false,
  });

  it("Case D: all agree → no correction", () => {
    const d = decideCorrection({
      relationships: baseConsistentRels,
      title: "Reply to client",
      description: "Send a polite reply addressing their billing question",
      category: "Client Communication",
    });
    expect(d.overall).toBe("consistent");
    expect(d.primary_correction).toBeNull();
    expect(d.legacy_validation).toBe("VALID");
  });

  it("Case A: description+category agree, title conflicts → recommend title", () => {
    const rels = buildRelationships({
      title: "Play video games",
      description: "Draft and send a response to the client's product question",
      category: "Client Communication",
      title_desc_score: 0.15,
      title_desc_contradiction: true,
      title_cat_score: 0.1,
      desc_cat_score: 0.9,
      completeness: 0.85,
      repetition: false,
    });
    const d = decideCorrection({
      relationships: rels,
      title: "Play video games",
      description: "Draft and send a response to the client's product question",
      category: "Client Communication",
      candidate_title: "Reply to client product question",
    });
    expect(d.overall).toBe("needs_correction");
    expect(d.primary_correction?.field).toBe("title");
    expect(d.primary_correction?.value).toContain("client");
  });

  it("Case B: title+description agree, category conflicts → recommend category", () => {
    const rels = buildRelationships({
      title: "Organize Google Drive folders",
      description: "Rename and archive client documents in shared drive",
      category: "Lead Generation",
      title_desc_score: 0.9,
      title_desc_contradiction: false,
      title_cat_score: 0.2,
      desc_cat_score: 0.2,
      completeness: 0.85,
      repetition: false,
    });
    const d = decideCorrection({
      relationships: rels,
      title: "Organize Google Drive folders",
      description: "Rename and archive client documents in shared drive",
      category: "Lead Generation",
      candidate_category: "File & Document Management",
    });
    expect(d.overall).toBe("needs_correction");
    expect(d.primary_correction?.field).toBe("category");
    expect(d.primary_correction?.value).toBe("File & Document Management");
  });

  it("Case C: title+category agree, description conflicts → recommend description", () => {
    const rels = buildRelationships({
      title: "Reply to client email",
      description: "Buy groceries and cook dinner for the weekend",
      category: "Client Communication",
      title_desc_score: 0.1,
      title_desc_contradiction: true,
      title_cat_score: 0.9,
      desc_cat_score: 0.15,
      completeness: 0.8,
      repetition: false,
    });
    const d = decideCorrection({
      relationships: rels,
      title: "Reply to client email",
      description: "Buy groceries and cook dinner for the weekend",
      category: "Client Communication",
      candidate_description:
        "Draft and send a response addressing the client's latest email inquiry",
    });
    expect(d.overall).toBe("needs_correction");
    expect(d.primary_correction?.field).toBe("description");
  });

  it("Case F: vague → clarification, no fabricated correction", () => {
    const rels = buildRelationships({
      title: "Task",
      description: "do it",
      category: "Administrative Tasks",
      title_desc_score: 0.3,
      title_desc_contradiction: false,
      title_cat_score: 0.5,
      desc_cat_score: 0.4,
      completeness: 0.1,
      repetition: false,
    });
    const d = decideCorrection({
      relationships: rels,
      title: "Task",
      description: "do it",
      category: "Administrative Tasks",
      candidate_title: "Complete administrative paperwork for Q3 filing",
    });
    expect(d.overall).toBe("needs_clarification");
    expect(d.primary_correction).toBeNull();
    expect(d.clarification.required).toBe(true);
  });

  it("Case E: multiple conflicts without clear evidence → clarification", () => {
    const rels = buildRelationships({
      title: "Play chess",
      description: "File quarterly taxes for the company",
      category: "Social Media Management",
      title_desc_score: 0.1,
      title_desc_contradiction: true,
      title_cat_score: 0.1,
      desc_cat_score: 0.15,
      completeness: 0.8,
      repetition: false,
    });
    const d = decideCorrection({
      relationships: rels,
      title: "Play chess",
      description: "File quarterly taxes for the company",
      category: "Social Media Management",
    });
    expect(d.overall).toBe("needs_clarification");
    expect(d.primary_correction).toBeNull();
  });

  it("rejects already-rejected candidate for same fingerprint", () => {
    const rels = buildRelationships({
      title: "Play video games",
      description: "Draft and send a response to the client's product question",
      category: "Client Communication",
      title_desc_score: 0.15,
      title_desc_contradiction: true,
      title_cat_score: 0.1,
      desc_cat_score: 0.9,
      completeness: 0.85,
      repetition: false,
    });
    const fp = inputFingerprint(
      "Play video games",
      "Draft and send a response to the client's product question",
      "Client Communication",
    );
    const history: SuggestionHistoryEntry[] = [
      {
        field: "title",
        value: "Reply to client product question",
        action: "rejected",
        input_fingerprint: fp,
      },
    ];
    const d = decideCorrection({
      relationships: rels,
      title: "Play video games",
      description: "Draft and send a response to the client's product question",
      category: "Client Communication",
      candidate_title: "Reply to client product question",
      history,
      fingerprint: fp,
    });
    expect(d.primary_correction).toBeNull();
    expect(d.clarification.required).toBe(true);
  });
});

describe("filterCandidate", () => {
  it("drops invalid or current category", () => {
    expect(
      filterCandidate("category", "Lead Generation", "Lead Generation", [], "fp"),
    ).toBeNull();
    expect(filterCandidate("category", "Not Real", "Email Management", [], "fp")).toBeNull();
    expect(
      filterCandidate("category", "Email Management", "Lead Generation", [], "fp"),
    ).toBe("Email Management");
  });
});

describe("project matching", () => {
  const projects = [
    {
      id: "p1",
      name: "Client Onboarding",
      description: "Email sequences and welcome packs for new clients",
    },
    {
      id: "p2",
      name: "Tax Season 2026",
      description: "Bookkeeping and quarterly filings",
    },
    {
      id: "p3",
      name: "Social Campaign Q4",
      description: "Instagram and LinkedIn content calendar",
    },
  ];

  it("recommends a clearly relevant project with correct id", () => {
    const m = selectProjectMatch(
      "Send welcome email to new client",
      "Prepare onboarding email sequence for the signed client",
      projects,
    );
    expect(m).not.toBeNull();
    expect(m!.project_id).toBe("p1");
    expect(m!.project_name).toBe("Client Onboarding");
  });

  it("does not force a match for unrelated work", () => {
    const m = selectProjectMatch(
      "Water the office plants",
      "Water the plants in the lobby and conference rooms",
      projects,
    );
    expect(m).toBeNull();
  });

  it("scoreProjectRelevance is higher for related than unrelated", () => {
    const high = scoreProjectRelevance(
      "Update CRM lead status",
      "Mark qualified leads in the pipeline",
      "CRM Cleanup",
      "Lead pipeline and contact records",
    );
    const low = scoreProjectRelevance(
      "Update CRM lead status",
      "Mark qualified leads in the pipeline",
      "Garden Maintenance",
      "Water plants and trim hedges",
    );
    expect(high).toBeGreaterThan(low);
    expect(high).toBeGreaterThanOrEqual(MATRIX_THRESHOLDS.project_match_min * 0.5);
  });
});
