// Shared by the server and the board (no Node imports here).

/** The boxes on a screen that can be adjusted on their own (held for a moment to open their settings). */
export type BoxId = "nu" | "idag" | "mat" | "vecka" | "teknik" | "person" | "todo";
export const BOX_IDS: BoxId[] = ["nu", "idag", "mat", "vecka", "teknik", "person", "todo"];

export interface BoxPref {
  /** Text size for just this box: 0.7–1.6 (1 = as it is). Grows only as far as the box has room. */
  size?: number;
  density?: "compact" | "airy";
  hidden?: boolean;
  /** Week: how many days (3–8). */
  days?: number;
  /** Week: the names shown (everyone when missing). */
  people?: string[];
  /** Week: only homework, or only training and matches. */
  show?: "tasks" | "activities";
  /** When school ends: every day (default), only the days the child is with us, or not at all. */
  schoolEnd?: "home" | "off";
  /** A child's own view: every day (default, also at the other home) or only the days with us. */
  scope?: "home";
}
export type BoxPrefs = Partial<Record<BoxId, BoxPref>>;

export const BOX_SIZE_MIN = 0.7;
export const BOX_SIZE_MAX = 1.6;
const clampSize = (n: number) => Math.min(BOX_SIZE_MAX, Math.max(BOX_SIZE_MIN, Math.round(n * 20) / 20));

/** A valid copy of one box's settings with everything that equals the default left out. */
export function normalizePref(p: unknown): BoxPref {
  const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
  const out: BoxPref = {};
  if (typeof o.size === "number" && Number.isFinite(o.size)) {
    const s = clampSize(o.size);
    if (Math.abs(s - 1) > 0.001) out.size = s;
  }
  if (o.density === "compact" || o.density === "airy") out.density = o.density;
  if (o.hidden === true) out.hidden = true;
  if (typeof o.days === "number" && Number.isFinite(o.days)) out.days = Math.min(8, Math.max(3, Math.round(o.days)));
  if (Array.isArray(o.people)) {
    const names = o.people.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 40).slice(0, 12);
    if (names.length) out.people = names;
  }
  if (o.show === "tasks" || o.show === "activities") out.show = o.show;
  if (o.schoolEnd === "home" || o.schoolEnd === "off") out.schoolEnd = o.schoolEnd;
  if (o.scope === "home") out.scope = "home";
  return out;
}

export function parsePrefs(raw: string | null | undefined): BoxPrefs {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const out: BoxPrefs = {};
    for (const id of BOX_IDS) {
      const p = normalizePref(j?.[id]);
      if (Object.keys(p).length) out[id] = p;
    }
    return out;
  } catch {
    return {};
  }
}

/** New settings with `patch` applied to one box (`null` puts the box back as it was); a box with nothing set is left out. */
export function withPref(prefs: BoxPrefs, id: BoxId, patch: Partial<BoxPref> | null): BoxPrefs {
  const next: BoxPrefs = { ...prefs };
  const merged = patch === null ? {} : normalizePref({ ...prefs[id], ...patch, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v === undefined).map(([k]) => [k, undefined])) });
  // An explicit `undefined` in the patch removes that setting.
  if (patch) for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (merged as Record<string, unknown>)[k];
  if (Object.keys(merged).length) next[id] = merged;
  else delete next[id];
  return next;
}

/** Column spans (out of 12) for the visible boxes in a row, in proportion to their weights, always adding up to 12. */
export function boxSpans(items: { id: BoxId; w: number }[]): Partial<Record<BoxId, number>> {
  const sum = items.reduce((a, b) => a + b.w, 0);
  if (!items.length || sum <= 0) return {};
  const raw = items.map((i) => (12 * i.w) / sum);
  const spans = raw.map((r) => Math.max(1, Math.floor(r)));
  let rest = 12 - spans.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) spans[order[k]!.i]!++;
  for (let k = 0; rest < 0; k = (k + 1) % order.length) {
    const big = spans.indexOf(Math.max(...spans));
    if (spans[big]! > 1) {
      spans[big]!--;
      rest++;
    } else if (k > 50) break;
  }
  return Object.fromEntries(items.map((it, i) => [it.id, spans[i]!]));
}

/** Does an event pass the box's "show only …" setting? Homework = a school task, activities = sport (training and matches). */
export function passesShow(show: BoxPref["show"], e: { category: string }, isTask: boolean): boolean {
  if (show === "tasks") return isTask;
  if (show === "activities") return !isTask && e.category === "sport";
  return true;
}
