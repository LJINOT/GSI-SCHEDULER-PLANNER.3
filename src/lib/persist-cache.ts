/** User-scoped localStorage cache helpers. Never share keys across accounts. */

let _uid: string | null = null;

export function setCacheUserId(userId: string | null) {
  _uid = userId;
}

export function cacheKey(base: string): string {
  return _uid ? `${base}:${_uid}` : base;
}

export function loadCache<T>(baseKey: string): T | null {
  try {
    const raw = localStorage.getItem(cacheKey(baseKey));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveCache(baseKey: string, value: unknown): void {
  try {
    localStorage.setItem(cacheKey(baseKey), JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

export function clearCache(baseKey: string): void {
  try {
    localStorage.removeItem(cacheKey(baseKey));
  } catch {
    /* ignore */
  }
}

export function clearAllUserCaches(userId: string): void {
  const prefix = `:${userId}`;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.endsWith(prefix)) keys.push(k);
  }
  keys.forEach((k) => localStorage.removeItem(k));
}
