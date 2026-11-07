import { useSyncExternalStore } from "react";
import { DEFAULT_LAYOUT, normalizeLayout, parseLayout, type Layout } from "../../server/src/layout";

/** How this screen's start page is laid out (the puzzle under "Ordna startsidan"). Per screen, like the box settings. */
const KEY = "familjetavla.layout";
const listeners = new Set<() => void>();
let cache: Layout | null = null;

function read(): Layout {
  if (cache === null) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch {
      /* private mode: kept in memory only */
    }
    cache = parseLayout(raw);
  }
  return cache;
}

export function saveLayout(next: Layout) {
  cache = normalizeLayout(next);
  try {
    if (JSON.stringify(cache) === JSON.stringify(DEFAULT_LAYOUT)) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useLayout = () => useSyncExternalStore(subscribe, read, read);

/** Opens "Ordna startsidan" on the start page (from a box's settings or the Aa sheet). */
export const ARRANGE_EVENT = "familjetavla:arrange";
export const startArranging = () => window.dispatchEvent(new Event(ARRANGE_EVENT));
