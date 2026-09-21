export const PASSWORD_RULES = [
  { label: "At least 8 characters", test: (v: string) => v.length >= 8 },
  { label: "One lowercase letter (a–z)", test: (v: string) => /[a-z]/.test(v) },
  { label: "One uppercase letter (A–Z)", test: (v: string) => /[A-Z]/.test(v) },
  { label: "One number (0–9)", test: (v: string) => /[0-9]/.test(v) },
];

export function validatePassword(value: string): string | null {
  const failed = PASSWORD_RULES.filter((r) => !r.test(value));
  if (failed.length === 0) return null;
  return `Password must include: ${failed.map((f) => f.label.toLowerCase()).join(", ")}.`;
}

export const TITLE_MAX = 255;

export function validateTitle(value: string, label = "Title"): string | null {
  const v = value.trim();
  if (!v) return `${label} is required.`;
  if (v.length > TITLE_MAX) return `${label} must be ${TITLE_MAX} characters or fewer.`;
  return null;
}

/** Strip everything except digits, spaces, +, -, ( and ) for phone inputs. */
export function sanitizePhone(value: string): string {
  return value.replace(/[^0-9]/g, "");
}
