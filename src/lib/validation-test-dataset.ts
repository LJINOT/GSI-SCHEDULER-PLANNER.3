/**
 * Manually reviewed validation test dataset for GSI Schedule Planner.
 *
 * Each case defines inputs, expected outcome, and which metrics it contributes to.
 * Outcomes were defined BEFORE evaluation (Section 11.1).
 *
 * Categories of cases:
 * - consistent: all fields agree
 * - incorrect_title / incorrect_description / incorrect_category
 * - contradictory
 * - ambiguous / incomplete
 * - project_match_valid / project_match_invalid
 * - history_accept / history_reject
 * - service_failure (simulated degraded mode)
 */

import type { SuggestionHistoryEntry } from "./task-validation-matrix";

export type ExpectedOutcome =
  | "consistent"
  | "needs_correction"
  | "needs_clarification"
  | "uncertain";

export type ExpectedCorrectionField = "title" | "description" | "category" | null;

export type ValidationTestCase = {
  id: string;
  group:
    | "consistent"
    | "incorrect_title"
    | "incorrect_description"
    | "incorrect_category"
    | "contradictory"
    | "ambiguous"
    | "project_match_valid"
    | "project_match_invalid"
    | "history_accept"
    | "history_reject"
    | "service_failure";
  title: string;
  description: string;
  category: string;
  /** Simulated factor scores when AI is unavailable (deterministic path). */
  factors: {
    title_desc_score: number;
    title_desc_contradiction: boolean;
    title_cat_score: number;
    desc_cat_score: number;
    completeness: number;
    repetition: boolean;
  };
  /** Optional AI-generated candidates (as the model would return). */
  candidates?: {
    title?: string | null;
    description?: string | null;
    category?: string | null;
  };
  history?: SuggestionHistoryEntry[];
  projects?: { id: string; name: string; description?: string | null }[];
  /** Expected decision overall. */
  expected_overall: ExpectedOutcome;
  /** Expected correction field when overall is needs_correction. */
  expected_correction_field: ExpectedCorrectionField;
  /** Substring or normalized value that a relevant correction should contain/match. */
  expected_correction_contains?: string;
  /** Fields that must NOT be recommended for change (already correct). */
  must_not_correct?: Array<"title" | "description" | "category">;
  /** Whether project match should be recommended. */
  expected_project_match?: boolean;
  expected_project_id?: string | null;
  /** Notes for reviewers. */
  notes: string;
};

/** Shared sample projects for project-match cases (user-owned). */
export const SAMPLE_PROJECTS = [
  {
    id: "proj-onboard",
    name: "Client Onboarding",
    description: "Email sequences and welcome packs for new clients",
  },
  {
    id: "proj-tax",
    name: "Tax Season 2026",
    description: "Bookkeeping and quarterly filings",
  },
  {
    id: "proj-social",
    name: "Social Campaign Q4",
    description: "Instagram and LinkedIn content calendar",
  },
  {
    id: "proj-crm",
    name: "CRM Cleanup",
    description: "Lead pipeline and contact records maintenance",
  },
];

/**
 * Reviewed dataset — expected outcomes defined prior to measurement.
 * Size: 24 cases covering all groups required by Section 11.1.
 */
export const VALIDATION_TEST_DATASET: ValidationTestCase[] = [
  // ----- Consistent -----
  {
    id: "C01",
    group: "consistent",
    title: "Reply to client product inquiry",
    description:
      "Draft and send a response addressing the client's questions about product features and pricing",
    category: "Client Communication",
    factors: {
      title_desc_score: 0.9,
      title_desc_contradiction: false,
      title_cat_score: 0.92,
      desc_cat_score: 0.91,
      completeness: 0.85,
      repetition: false,
    },
    expected_overall: "consistent",
    expected_correction_field: null,
    must_not_correct: ["title", "description", "category"],
    notes: "All three fields agree — no correction should be offered.",
  },
  {
    id: "C02",
    group: "consistent",
    title: "Organize Google Drive client folders",
    description:
      "Rename and archive client documents in the shared drive by project name",
    category: "File & Document Management",
    factors: {
      title_desc_score: 0.88,
      title_desc_contradiction: false,
      title_cat_score: 0.9,
      desc_cat_score: 0.89,
      completeness: 0.8,
      repetition: false,
    },
    expected_overall: "consistent",
    expected_correction_field: null,
    must_not_correct: ["title", "description", "category"],
    notes: "Consistent file-management task.",
  },
  {
    id: "C03",
    group: "consistent",
    title: "Update CRM lead status",
    description:
      "Mark qualified leads as contacted and add follow-up notes in the pipeline",
    category: "CRM Management",
    factors: {
      title_desc_score: 0.87,
      title_desc_contradiction: false,
      title_cat_score: 0.9,
      desc_cat_score: 0.88,
      completeness: 0.82,
      repetition: false,
    },
    expected_overall: "consistent",
    expected_correction_field: null,
    must_not_correct: ["title", "description", "category"],
    notes: "Consistent CRM task.",
  },

  // ----- Incorrect title (Case A) -----
  {
    id: "T01",
    group: "incorrect_title",
    title: "Play video games",
    description:
      "Draft and send a response to the client's product question about shipping times",
    category: "Client Communication",
    factors: {
      title_desc_score: 0.12,
      title_desc_contradiction: true,
      title_cat_score: 0.1,
      desc_cat_score: 0.9,
      completeness: 0.85,
      repetition: false,
    },
    candidates: {
      title: "Reply to client product shipping question",
    },
    expected_overall: "needs_correction",
    expected_correction_field: "title",
    expected_correction_contains: "client",
    must_not_correct: ["description", "category"],
    notes: "Description+category agree; title is unrelated entertainment.",
  },
  {
    id: "T02",
    group: "incorrect_title",
    title: "Cook dinner",
    description:
      "Enter customer contact records into the spreadsheet from the CSV export",
    category: "Data Entry",
    factors: {
      title_desc_score: 0.08,
      title_desc_contradiction: true,
      title_cat_score: 0.1,
      desc_cat_score: 0.88,
      completeness: 0.8,
      repetition: false,
    },
    candidates: {
      title: "Enter customer records from CSV export",
    },
    expected_overall: "needs_correction",
    expected_correction_field: "title",
    expected_correction_contains: "customer",
    must_not_correct: ["description", "category"],
    notes: "Title is personal chore; description is data entry.",
  },

  // ----- Incorrect description (Case C) -----
  {
    id: "D01",
    group: "incorrect_description",
    title: "Reply to client email",
    description: "Buy groceries and cook dinner for the weekend",
    category: "Client Communication",
    factors: {
      title_desc_score: 0.1,
      title_desc_contradiction: true,
      title_cat_score: 0.9,
      desc_cat_score: 0.12,
      completeness: 0.75,
      repetition: false,
    },
    candidates: {
      description:
        "Draft and send a response addressing the client's latest email inquiry",
    },
    expected_overall: "needs_correction",
    expected_correction_field: "description",
    expected_correction_contains: "client",
    must_not_correct: ["title", "category"],
    notes: "Title+category agree; description is unrelated personal task.",
  },
  {
    id: "D02",
    group: "incorrect_description",
    title: "Prepare weekly status report",
    description: "Water the office plants and trim the lobby hedges",
    category: "Report & Documentation",
    factors: {
      title_desc_score: 0.1,
      title_desc_contradiction: true,
      title_cat_score: 0.88,
      desc_cat_score: 0.1,
      completeness: 0.7,
      repetition: false,
    },
    candidates: {
      description:
        "Compile progress updates and deliverables into the weekly status report for the team",
    },
    expected_overall: "needs_correction",
    expected_correction_field: "description",
    expected_correction_contains: "report",
    must_not_correct: ["title", "category"],
    notes: "Title+category are reporting; description is facility work.",
  },

  // ----- Incorrect category (Case B) -----
  {
    id: "K01",
    group: "incorrect_category",
    title: "Organize Google Drive folders",
    description:
      "Rename and archive client documents in the shared drive by project",
    category: "Lead Generation",
    factors: {
      title_desc_score: 0.9,
      title_desc_contradiction: false,
      title_cat_score: 0.15,
      desc_cat_score: 0.15,
      completeness: 0.85,
      repetition: false,
    },
    candidates: {
      category: "File & Document Management",
    },
    expected_overall: "needs_correction",
    expected_correction_field: "category",
    expected_correction_contains: "File",
    must_not_correct: ["title", "description"],
    notes: "Title+description agree on file work; category is lead gen.",
  },
  {
    id: "K02",
    group: "incorrect_category",
    title: "Reply to support ticket #4821",
    description:
      "Respond to the customer complaint about delayed shipping and offer a resolution",
    category: "Social Media Management",
    factors: {
      title_desc_score: 0.88,
      title_desc_contradiction: false,
      title_cat_score: 0.12,
      desc_cat_score: 0.14,
      completeness: 0.84,
      repetition: false,
    },
    candidates: {
      category: "Customer Support",
    },
    expected_overall: "needs_correction",
    expected_correction_field: "category",
    expected_correction_contains: "Customer Support",
    must_not_correct: ["title", "description"],
    notes: "Support ticket work miscategorized as social media.",
  },

  // ----- Contradictory (multiple fields) -----
  {
    id: "X01",
    group: "contradictory",
    title: "Play chess online",
    description: "File quarterly taxes for the company",
    category: "Social Media Management",
    factors: {
      title_desc_score: 0.08,
      title_desc_contradiction: true,
      title_cat_score: 0.1,
      desc_cat_score: 0.12,
      completeness: 0.8,
      repetition: false,
    },
    expected_overall: "needs_clarification",
    expected_correction_field: null,
    notes: "All three conflict — no reliable single-field correction.",
  },
  {
    id: "X02",
    group: "contradictory",
    title: "Schedule team standup",
    description: "Research competitor pricing for the new product line",
    category: "Bookkeeping & Finance",
    factors: {
      title_desc_score: 0.15,
      title_desc_contradiction: true,
      title_cat_score: 0.2,
      desc_cat_score: 0.18,
      completeness: 0.8,
      repetition: false,
    },
    expected_overall: "needs_clarification",
    expected_correction_field: null,
    notes: "Scheduling vs research vs finance — clarify intent.",
  },

  // ----- Ambiguous / incomplete -----
  {
    id: "A01",
    group: "ambiguous",
    title: "Task",
    description: "do it",
    category: "Administrative Tasks",
    factors: {
      title_desc_score: 0.25,
      title_desc_contradiction: false,
      title_cat_score: 0.5,
      desc_cat_score: 0.4,
      completeness: 0.1,
      repetition: false,
    },
    candidates: {
      title: "Complete administrative paperwork for Q3 filing",
    },
    expected_overall: "needs_clarification",
    expected_correction_field: null,
    notes: "Vague — must not fabricate a confident title.",
  },
  {
    id: "A02",
    group: "ambiguous",
    title: "Important",
    description: "finish this",
    category: "General / Other",
    factors: {
      title_desc_score: 0.3,
      title_desc_contradiction: false,
      title_cat_score: 0.45,
      desc_cat_score: 0.4,
      completeness: 0.1,
      repetition: false,
    },
    expected_overall: "needs_clarification",
    expected_correction_field: null,
    notes: "Insufficient detail — clarification required.",
  },
  {
    id: "A03",
    group: "ambiguous",
    title: "Report",
    description: "report",
    category: "Report & Documentation",
    factors: {
      title_desc_score: 0.55,
      title_desc_contradiction: false,
      title_cat_score: 0.7,
      desc_cat_score: 0.5,
      completeness: 0.15,
      repetition: true,
    },
    expected_overall: "needs_clarification",
    expected_correction_field: null,
    notes: "Repetition + vague — not a confident correction case.",
  },

  // ----- Project match valid -----
  {
    id: "P01",
    group: "project_match_valid",
    title: "Send welcome email to new client",
    description:
      "Prepare onboarding email sequence for the signed client with welcome pack details",
    category: "Client Communication",
    factors: {
      title_desc_score: 0.9,
      title_desc_contradiction: false,
      title_cat_score: 0.9,
      desc_cat_score: 0.9,
      completeness: 0.85,
      repetition: false,
    },
    projects: SAMPLE_PROJECTS,
    expected_overall: "consistent",
    expected_correction_field: null,
    expected_project_match: true,
    expected_project_id: "proj-onboard",
    notes: "Consistent task; strongly related to Client Onboarding project.",
  },
  {
    id: "P02",
    group: "project_match_valid",
    title: "Update lead status in pipeline",
    description:
      "Mark qualified leads as contacted and refresh contact records",
    category: "CRM Management",
    factors: {
      title_desc_score: 0.88,
      title_desc_contradiction: false,
      title_cat_score: 0.9,
      desc_cat_score: 0.88,
      completeness: 0.8,
      repetition: false,
    },
    projects: SAMPLE_PROJECTS,
    expected_overall: "consistent",
    expected_correction_field: null,
    expected_project_match: true,
    expected_project_id: "proj-crm",
    notes: "Consistent CRM task; should match CRM Cleanup.",
  },

  // ----- Project match invalid (no force) -----
  {
    id: "P03",
    group: "project_match_invalid",
    title: "Water the office plants",
    description: "Water the plants in the lobby and conference rooms",
    category: "Administrative Tasks",
    factors: {
      title_desc_score: 0.9,
      title_desc_contradiction: false,
      title_cat_score: 0.75,
      desc_cat_score: 0.75,
      completeness: 0.8,
      repetition: false,
    },
    projects: SAMPLE_PROJECTS,
    expected_overall: "consistent",
    expected_correction_field: null,
    expected_project_match: false,
    expected_project_id: null,
    notes: "Consistent but unrelated to any sample project — no force match.",
  },
  {
    id: "P04",
    group: "project_match_invalid",
    title: "Play video games",
    description: "Draft client reply about shipping",
    category: "Client Communication",
    factors: {
      title_desc_score: 0.12,
      title_desc_contradiction: true,
      title_cat_score: 0.1,
      desc_cat_score: 0.9,
      completeness: 0.8,
      repetition: false,
    },
    candidates: { title: "Reply to client about shipping" },
    projects: SAMPLE_PROJECTS,
    expected_overall: "needs_correction",
    expected_correction_field: "title",
    expected_project_match: false,
    notes: "Inconsistent fields — project match must not run as confident assign.",
  },

  // ----- History: accepted should not re-suggest -----
  {
    id: "H01",
    group: "history_accept",
    title: "Play video games",
    description:
      "Draft and send a response to the client's product question",
    category: "Client Communication",
    factors: {
      title_desc_score: 0.12,
      title_desc_contradiction: true,
      title_cat_score: 0.1,
      desc_cat_score: 0.9,
      completeness: 0.85,
      repetition: false,
    },
    candidates: {
      title: "Reply to client product question",
    },
    history: [
      {
        field: "title",
        value: "Reply to client product question",
        action: "accepted",
        input_fingerprint:
          "play video games||draft and send a response to the client s product question||client communication",
      },
    ],
    expected_overall: "needs_clarification",
    expected_correction_field: null,
    notes:
      "Same candidate already accepted for this fingerprint — do not re-suggest; ask clarification if still mismatched.",
  },

  // ----- History: rejected should not re-suggest -----
  {
    id: "H02",
    group: "history_reject",
    title: "Play video games",
    description:
      "Draft and send a response to the client's product question",
    category: "Client Communication",
    factors: {
      title_desc_score: 0.12,
      title_desc_contradiction: true,
      title_cat_score: 0.1,
      desc_cat_score: 0.9,
      completeness: 0.85,
      repetition: false,
    },
    candidates: {
      title: "Reply to client product question",
    },
    history: [
      {
        field: "title",
        value: "Reply to client product question",
        action: "rejected",
        input_fingerprint:
          "play video games||draft and send a response to the client s product question||client communication",
      },
    ],
    expected_overall: "needs_clarification",
    expected_correction_field: null,
    notes: "Rejected candidate must not be repeated for unchanged inputs.",
  },

  // ----- Service failure / degraded (conservative) -----
  {
    id: "F01",
    group: "service_failure",
    title: "Reply to client inquiry",
    description:
      "Draft and send a response addressing the client's product questions",
    category: "Client Communication",
    factors: {
      // Degraded mode: lexical relatedness + category keyword fit
      title_desc_score: 0.78,
      title_desc_contradiction: false,
      title_cat_score: 0.75,
      desc_cat_score: 0.75,
      completeness: 0.8,
      repetition: false,
    },
    expected_overall: "consistent",
    expected_correction_field: null,
    notes:
      "With solid lexical relatedness and category keyword fit, degraded mode marks consistent; must not invent corrections.",
  },
  {
    id: "F02",
    group: "service_failure",
    title: "XYZ unknown",
    description: "abc unrelated stuff",
    category: "Lead Generation",
    factors: {
      title_desc_score: 0.2,
      title_desc_contradiction: false,
      title_cat_score: 0.35,
      desc_cat_score: 0.3,
      completeness: 0.5,
      repetition: false,
    },
    expected_overall: "needs_clarification",
    expected_correction_field: null,
    notes:
      "Low relatedness without AI — uncertain/clarification, not false VALID success.",
  },

  // ----- Bad candidate that would introduce contradiction -----
  {
    id: "B01",
    group: "incorrect_title",
    title: "Play video games",
    description:
      "Draft and send a response to the client's product question",
    category: "Client Communication",
    factors: {
      title_desc_score: 0.12,
      title_desc_contradiction: true,
      title_cat_score: 0.1,
      desc_cat_score: 0.9,
      completeness: 0.85,
      repetition: false,
    },
    candidates: {
      // Deliberately bad candidate — should fail second check / not be preferred
      title: "Organize garden tools in the shed",
    },
    expected_overall: "needs_clarification",
    expected_correction_field: null,
    notes:
      "Candidate title introduces a new contradiction with description+category; discard.",
  },
];
