import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { parsePrefs, withPref, type BoxId, type BoxPref, type BoxPrefs } from "../../server/src/boxprefs";

/** Settings per box (text size, density, hidden, days …) for just this screen: the iPad and the hall screen want different things. */
const KEY = "familjetavla.boxes";
const listeners = new Set<() => void>();
let cache: BoxPrefs | null = null;

function read(): BoxPrefs {
  if (cache === null) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch {
      /* private mode: kept in memory only */
    }
    cache = parsePrefs(raw);
  }
  return cache;
}

function write(next: BoxPrefs) {
  cache = next;
  try {
    if (Object.keys(next).length) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useBoxPrefs() {
  const prefs = useSyncExternalStore(subscribe, read, read);
  return {
    prefs,
    setPref: (id: BoxId, patch: Partial<BoxPref>) => write(withPref(read(), id, patch)),
    resetPref: (id: BoxId) => write(withPref(read(), id, null)),
    resetAll: () => write({}),
  };
}

/** What a box needs to carry its own settings: extra classes, a style for its place in the grid, and the hold-to-open handlers. */
export interface BoxProps {
  className: string;
  style?: CSSProperties;
  handlers: Record<string, unknown>;
  /** Text size for Fit (grows only as far as the box has room). */
  base?: number;
  /** The cog that opens this box's settings. */
  gear?: ReactNode;
}

export function boxClass(p: BoxPref | undefined): string {
  return `has-prefs ${p?.density ? `dens-${p.density}` : ""}`.trim();
}
