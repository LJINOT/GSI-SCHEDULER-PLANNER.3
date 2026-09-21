// Simple localStorage cache with TTL (default 1 hour)
const DEFAULT_TTL_MS = 60 * 60 * 1000;

export function loadCache<T>(key: string, ttlMs: number = DEFAULT_TTL_MS): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { value, expiresAt } = JSON.parse(raw);
    if (typeof expiresAt !== "number" || Date.now() > expiresAt) {
      localStorage.removeItem(key);
      return null;
    }
    return value as T;
  } catch {
    return null;
  }
}

export function saveCache<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): void {
  try {
    localStorage.setItem(key, JSON.stringify({ value, expiresAt: Date.now() + ttlMs }));
  } catch {
    // ignore quota errors
  }
}
