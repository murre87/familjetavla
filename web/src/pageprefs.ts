import { useSyncExternalStore } from "react";

/**
 * Settings per tab and page (Mat, Bil, Kalender …) on this screen: for now the text size. Saved per screen like the
 * box settings, so the kitchen iPad can have bigger text than the hall screen.
 */
export interface PagePref {
  /** 0.7–2 (1 = as it is). The page scrolls when the text is bigger than what fits. */
  size?: number;
}
export const PAGE_SIZE_MIN = 0.7;
export const PAGE_SIZE_MAX = 2;

const KEY = "familjetavla.pages";
const listeners = new Set<() => void>();
let cache: Record<string, PagePref> | null = null;

const clamp = (n: number) => Math.min(PAGE_SIZE_MAX, Math.max(PAGE_SIZE_MIN, Math.round(n * 20) / 20));

function read(): Record<string, PagePref> {
  if (cache === null) {
    cache = {};
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, PagePref>;
      for (const [k, v] of Object.entries(raw ?? {})) {
        if (typeof k === "string" && k.length < 40 && v && typeof v.size === "number" && Number.isFinite(v.size)) cache[k] = { size: clamp(v.size) };
      }
    } catch {
      /* private mode or broken: start empty */
    }
  }
  return cache;
}

function write(next: Record<string, PagePref>) {
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

export function usePagePrefs() {
  const prefs = useSyncExternalStore(subscribe, read, read);
  return {
    prefs,
    setSize: (id: string, size: number) => {
      const s = clamp(size);
      const next = { ...read() };
      if (Math.abs(s - 1) < 0.001) delete next[id];
      else next[id] = { size: s };
      write(next);
    },
  };
}
