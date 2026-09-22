import { useCallback, useEffect, useState } from "react";

const EVENT = "gsi-dev-mode-changed";
const UNLOCK_EVENT = "gsi-dev-unlock-changed";

function uidSuffix(): string {
  try {
    return localStorage.getItem("gsi-auth-uid") || "anon";
  } catch {
    return "anon";
  }
}
function KEY() { return `gsi-dev-mode:${uidSuffix()}`; }
function UNLOCK_KEY() { return `gsi-dev-unlocked:${uidSuffix()}`; }
function UNLOCK_AT_KEY() { return `gsi-dev-unlocked-at:${uidSuffix()}`; }

/** Developer Mode auto-locks after 30 minutes and starts locked for every new account. */
export const DEV_UNLOCK_TTL_MS = 30 * 60 * 1000;

function lockNow() {
  try {
    localStorage.setItem(UNLOCK_KEY(), "0");
    localStorage.removeItem(UNLOCK_AT_KEY());
    localStorage.setItem(KEY(), "0");
  } catch {
    /* ignore */
  }
}

export function isDevUnlocked(): boolean {
  try {
    if (localStorage.getItem(UNLOCK_KEY()) !== "1") return false;
    const at = Number(localStorage.getItem(UNLOCK_AT_KEY()) || 0);
    if (!at || Date.now() - at > DEV_UNLOCK_TTL_MS) {
      lockNow();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Milliseconds left before Developer Mode locks itself again (0 when locked). */
export function devUnlockRemaining(): number {
  try {
    const at = Number(localStorage.getItem(UNLOCK_AT_KEY()) || 0);
    if (!at) return 0;
    return Math.max(0, DEV_UNLOCK_TTL_MS - (Date.now() - at));
  } catch {
    return 0;
  }
}

/** Whether the Developer Mode section is revealed in Settings (IT specialists only). */
export function useDevUnlock() {
  const [unlocked, setUnlockedState] = useState<boolean>(() => isDevUnlocked());
  const [remaining, setRemaining] = useState<number>(() => devUnlockRemaining());

  useEffect(() => {
    const sync = () => {
      setUnlockedState(isDevUnlocked());
      setRemaining(devUnlockRemaining());
    };
    window.addEventListener(UNLOCK_EVENT, sync);
    window.addEventListener("storage", sync);
    const id = setInterval(() => {
      const stillUnlocked = isDevUnlocked();
      setUnlockedState((prev) => {
        if (prev && !stillUnlocked) {
          window.dispatchEvent(new CustomEvent(EVENT));
        }
        return stillUnlocked;
      });
      setRemaining(devUnlockRemaining());
    }, 1000);
    return () => {
      window.removeEventListener(UNLOCK_EVENT, sync);
      window.removeEventListener("storage", sync);
      clearInterval(id);
    };
  }, []);

  const setUnlocked = useCallback((on: boolean) => {
    try {
      if (on) {
        localStorage.setItem(UNLOCK_KEY(), "1");
        localStorage.setItem(UNLOCK_AT_KEY(), String(Date.now()));
      } else {
        lockNow();
      }
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent(UNLOCK_EVENT));
    window.dispatchEvent(new CustomEvent(EVENT));
  }, []);

  return { unlocked, setUnlocked, remaining };
}

export function isDevModeOn(): boolean {
  try {
    if (!isDevUnlocked()) return false;
    return localStorage.getItem(KEY()) === "1";
  } catch {
    return false;
  }
}

export function useDevMode() {
  const [devMode, setDevModeState] = useState<boolean>(() => isDevModeOn());

  useEffect(() => {
    const sync = () => setDevModeState(isDevModeOn());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    const id = setInterval(sync, 5000);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
      clearInterval(id);
    };
  }, []);

  const setDevMode = useCallback((on: boolean) => {
    try {
      localStorage.setItem(KEY(), on ? "1" : "0");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent(EVENT));
  }, []);

  return { devMode, setDevMode };
}
