/**
 * GSI Schedule Planner - VA Category Taxonomy
 *
 * Single source of truth for the Virtual Assistant task categories used by:
 * - Add Task
 * - AI/NLP task analysis
 * - AHP priority calculation
 * - Focus Mode fallback scoring
 * - Auto Schedule fallback scoring
 *
 * The category score is a DOMAIN BASELINE, not the final task priority.
 * AHP combines it with deadline, difficulty, and duration.
 */

export type VACategory = {
  name: string;
  description: string;
  examples: string[];
  keywords: string[];
  ahpValue: number;
};

export const VA_CATEGORIES: VACategory[] = [
  {
    name: "Client Communication",
    description: "Direct communication with clients for updates, questions, requests, and follow-ups.",
    examples: ["Reply to client", "Follow up with client", "Send client update"],
    keywords: ["client", "customer", "respond", "reply", "follow up", "follow-up", "message", "inquiry", "request", "client update", "contact client"],
    ahpValue: 0.95,
  },
  {
    name: "Customer Support",
    description: "Handling customer questions, complaints, support tickets, and service concerns.",
    examples: ["Answer support ticket", "Resolve customer inquiry", "Respond to complaint"],
    keywords: ["customer support", "support ticket", "complaint", "customer issue", "support request", "help customer", "customer concern", "ticket"],
    ahpValue: 0.95,
  },
  {
    name: "Email Management",
    description: "Reading, replying to, organizing, filtering, and maintaining email inboxes.",
    examples: ["Clean inbox", "Reply to emails", "Organize messages"],
    keywords: ["email", "emails", "inbox", "reply email", "unread", "mailbox", "correspondence", "email management"],
    ahpValue: 0.80,
  },
  {
    name: "Calendar & Scheduling",
    description: "Managing appointments, meetings, bookings, events, and calendar availability.",
    examples: ["Schedule meeting", "Book appointment", "Update calendar"],
    keywords: ["calendar", "schedule", "scheduling", "appointment", "booking", "meeting", "availability", "event", "book a meeting"],
    ahpValue: 0.85,
  },
  {
    name: "Administrative Tasks",
    description: "General administrative and office support work.",
    examples: ["Prepare forms", "Process administrative request", "Organize office records"],
    keywords: ["admin", "administrative", "office", "paperwork", "form", "process request", "office work", "administration"],
    ahpValue: 0.75,
  },
  {
    name: "Data Entry",
    description: "Entering, updating, cleaning, or transferring information between systems.",
    examples: ["Encode customer records", "Update spreadsheet", "Enter data"],
    keywords: ["data entry", "encode", "encoding", "input data", "spreadsheet", "database", "enter data", "update records"],
    ahpValue: 0.65,
  },
  {
    name: "Research",
    description: "Finding, checking, organizing, and summarizing information.",
    examples: ["Competitor research", "Web research", "Product research"],
    keywords: ["research", "investigate", "search", "find information", "gather information", "competitor research", "market research", "web research"],
    ahpValue: 0.80,
  },
  {
    name: "Report & Documentation",
    description: "Creating reports, summaries, records, and formal documentation.",
    examples: ["Weekly report", "Prepare summary", "Create documentation"],
    keywords: ["report", "documentation", "document", "summary", "weekly report", "prepare report", "write report", "records"],
    ahpValue: 0.85,
  },
  {
    name: "File & Document Management",
    description: "Organizing, naming, storing, archiving, uploading, and maintaining digital files.",
    examples: ["Organize Google Drive", "Rename files", "Archive documents"],
    keywords: ["file", "files", "folder", "folders", "document management", "organize files", "archive", "upload", "download", "google drive"],
    ahpValue: 0.65,
  },
  {
    name: "Project Coordination",
    description: "Supporting projects by tracking progress, deadlines, milestones, and team coordination.",
    examples: ["Update project tracker", "Follow up with team", "Track project progress"],
    keywords: ["project", "coordinate", "coordination", "project tracker", "progress", "milestone", "team", "project follow-up", "project tracking"],
    ahpValue: 0.90,
  },
  {
    name: "Lead Generation",
    description: "Finding potential customers or business leads and organizing prospect information.",
    examples: ["Find potential clients", "Build lead list", "Research prospects"],
    keywords: ["lead", "leads", "lead generation", "prospect", "prospects", "potential client", "sales lead", "contact list"],
    ahpValue: 0.85,
  },
  {
    name: "CRM Management",
    description: "Maintaining customer relationship management records, contacts, leads, and pipelines.",
    examples: ["Update CRM", "Add customer record", "Update lead status"],
    keywords: ["crm", "customer relationship", "customer record", "lead status", "contact record", "pipeline", "sales record"],
    ahpValue: 0.80,
  },
  {
    name: "Social Media Management",
    description: "Managing social media posts, schedules, comments, and engagement.",
    examples: ["Schedule Facebook post", "Reply to comments", "Manage content calendar"],
    keywords: ["social media", "facebook", "instagram", "linkedin", "post", "posts", "comment", "engagement", "content calendar", "social post"],
    ahpValue: 0.75,
  },
  {
    name: "Content Creation",
    description: "Creating written, visual, or other digital content for a client or business.",
    examples: ["Write caption", "Create article", "Prepare promotional content"],
    keywords: ["content", "write", "article", "caption", "blog", "copy", "promotional content", "creative content"],
    ahpValue: 0.75,
  },
  {
    name: "E-commerce Support",
    description: "Supporting online stores, products, orders, customers, and inventory.",
    examples: ["Update product listing", "Process order", "Check inventory"],
    keywords: ["ecommerce", "e-commerce", "online store", "product listing", "order", "orders", "inventory", "shopify", "product catalog"],
    ahpValue: 0.80,
  },
  {
    name: "Bookkeeping & Finance",
    description: "Supporting financial administration such as invoices, expenses, payments, and transaction records.",
    examples: ["Prepare invoice", "Record expenses", "Update financial spreadsheet"],
    keywords: ["invoice", "invoicing", "billing", "expense", "expenses", "payment", "bookkeeping", "transaction", "financial", "finance"],
    ahpValue: 0.90,
  },
  {
    name: "Meeting & Coordination",
    description: "Preparing meetings, recording information, and handling meeting follow-up actions.",
    examples: ["Prepare agenda", "Write meeting minutes", "Send meeting follow-up"],
    keywords: ["meeting", "agenda", "minutes", "meeting notes", "notes", "follow-up", "attendees", "meeting preparation"],
    ahpValue: 0.80,
  },
  {
    name: "Personal Assistance",
    description: "Handling personal assistance requested by a client.",
    examples: ["Personal appointment", "Travel research", "Personal reminder"],
    keywords: ["personal", "personal appointment", "travel", "reservation", "personal reminder", "personal errand", "errand"],
    ahpValue: 0.60,
  },
  {
    name: "General / Other",
    description: "Fallback category for VA tasks that do not clearly match another category.",
    examples: ["Miscellaneous VA task", "Other support task"],
    keywords: ["general", "miscellaneous", "other", "miscellaneous work"],
    ahpValue: 0.50,
  },
];

export const VA_CATEGORY_NAMES = VA_CATEGORIES.map((category) => category.name);

export const VA_CATEGORY_IMPORTANCE: Record<string, number> = Object.fromEntries(
  VA_CATEGORIES.map((category) => [category.name, category.ahpValue]),
);

export function getCategoryImportance(category?: string | null): number {
  if (!category) return VA_CATEGORY_IMPORTANCE["General / Other"];
  return VA_CATEGORY_IMPORTANCE[category] ?? VA_CATEGORY_IMPORTANCE["General / Other"];
}

/**
 * Normalize older category names that may still exist in existing database rows.
 * This prevents old tasks from breaking the new AHP mapping.
 */
const LEGACY_CATEGORY_ALIASES: Record<string, string> = {
  "Calendar Scheduling": "Calendar & Scheduling",
  "Project Tracking": "Project Coordination",
  "Research Task": "Research",
  "Bookkeeping": "Bookkeeping & Finance",
  "Invoicing": "Bookkeeping & Finance",
  "Meeting Notes": "Meeting & Coordination",
  "Finance": "Bookkeeping & Finance",
  "Office Work": "Administrative Tasks",
  "Freelancing": "General / Other",
  "Virtual Assistant": "Administrative Tasks",
  "General": "General / Other",
  "Other": "General / Other",
};

export function normalizeVACategory(category?: string | null): string {
  const value = String(category || "").trim();
  if (!value) return "General / Other";
  return LEGACY_CATEGORY_ALIASES[value] || (VA_CATEGORY_IMPORTANCE[value] !== undefined ? value : "General / Other");
}
