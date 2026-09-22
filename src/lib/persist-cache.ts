/** User-scoped localStorage cache. Keys become baseKey:<userId> when a user is known. */

function currentUid(): string | null {
  try {
    return localStorage.getItem("gsi-auth-uid");
  } catch {
    return null;
  }
}

function scopedKey(baseKey: string): string {
  const uid = currentUid();
  return uid ? `${baseKey}:${uid}` : baseKey;
}

export function loadCache<T = unknown>(baseKey: string): T | null {
  try {
    const raw = localStorage.getItem(scopedKey(baseKey));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveCache(baseKey: string, value: unknown): void {
  try {
    localStorage.setItem(scopedKey(baseKey), JSON.stringify(value));
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearCache(baseKey: string): void {
  try {
    localStorage.removeItem(scopedKey(baseKey));
  } catch {
    /* ignore */
  }
}
