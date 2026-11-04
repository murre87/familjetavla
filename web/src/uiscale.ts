import { useSyncExternalStore } from "react";

/** Skärmstorlek för den här enheten (iPaden och hallskärmen vill ha olika). Sparas i webbläsaren, inte i tavlans inställningar. */
const KEY = "familjetavla.uiscale";
export const SCALE_MIN = 0.6;
export const SCALE_MAX = 1.3;

const clamp = (z: number) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(z * 20) / 20));

/** No choice made yet: an 11" tablet on its side (≈1194×834) gets a bit smaller so the cards fit; everything else stays at 100 %. */
function defaultScale(): number {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return w >= 1000 && w <= 1300 && h >= 600 && h <= 900 ? 0.85 : 1;
}

/** True when someone has chosen a size on this screen (the default is then not used). */
export function scaleChosen(): boolean {
  try {
    return Number(localStorage.getItem(KEY)) > 0;
  } catch {
    return false;
  }
}

export function readScale(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v > 0 ? clamp(v) : defaultScale();
  } catch {
    return defaultScale();
  }
}

/** Sätter storleken på hela sidan. `--ui` får höjderna i CSS (som räknar i vh) att följa med, så att tavlan fyller skärmen. */
export function applyScale(z: number) {
  const root = document.documentElement;
  root.style.zoom = z === 1 ? "" : String(z);
  root.style.setProperty("--ui", String(z));
}

export function saveScale(z: number): number {
  const v = clamp(z);
  try {
    localStorage.setItem(KEY, String(v)); // även 100 %: ett val som ska stå kvar, inte "inget val"
  } catch {
    /* privat läge: gäller bara tills sidan laddas om */
  }
  applyScale(v);
  return v;
}

const SAVER_KEY = "familjetavla.screensaver";

/** Skärmsläckaren (fotoramen efter en stunds inaktivitet och nattläget) avstängd på just den här skärmen? */
export function screensaverOff(): boolean {
  try {
    return localStorage.getItem(SAVER_KEY) === "off";
  } catch {
    return false;
  }
}

export function setScreensaverOff(off: boolean) {
  try {
    if (off) localStorage.setItem(SAVER_KEY, "off");
    else localStorage.removeItem(SAVER_KEY);
  } catch {
    /* privat läge: gäller tills sidan laddas om */
  }
}

export type Design = "flat" | "glass";
const DESIGN_KEY = "familjetavla.design";

function readDesign(): Design | null {
  try {
    const v = localStorage.getItem(DESIGN_KEY);
    return v === "flat" || v === "glass" ? v : null;
  } catch {
    return null;
  }
}

let designOverride: Design | null = readDesign();
const designListeners = new Set<() => void>();

/** Utseendet för just den här skärmen (null = som i inställningarna). */
export function setDesignOverride(v: Design | null) {
  designOverride = v;
  try {
    if (v) localStorage.setItem(DESIGN_KEY, v);
    else localStorage.removeItem(DESIGN_KEY);
  } catch {
    /* privat läge: gäller tills sidan laddas om */
  }
  designListeners.forEach((f) => f());
}

export const getDesignOverride = () => designOverride;

/** Utseendet som gäller här: skärmens eget val, annars familjens inställning. */
export function useDesign(fromSettings: Design): Design {
  const o = useSyncExternalStore(
    (f) => {
      designListeners.add(f);
      return () => designListeners.delete(f);
    },
    () => designOverride,
  );
  return o ?? fromSettings;
}
