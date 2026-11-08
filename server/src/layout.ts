// The start page as a puzzle the family builds themselves: rows of boxes, each with a width out of 12 columns.
// Shared by the board and the tests (no Node imports here). Saved per screen, like the box settings.
import type { BoxId } from "./boxprefs.js";

/** The boxes on the new start page that can be moved (the person view is its own page). */
export type LayoutBox = Extract<BoxId, "nu" | "idag" | "mat" | "vecka" | "teknik" | "todo">;
export const LAYOUT_BOXES: LayoutBox[] = ["nu", "idag", "mat", "vecka", "teknik", "todo"];

/** One row: the boxes from left to right and their widths (columns out of 12, adding up to 12 among the boxes shown). */
export interface LayoutRow {
  ids: LayoutBox[];
  spans: number[];
}
export interface Layout {
  rows: LayoutRow[];
}

export const COLS = 12;
/** Narrowest a box may be made (columns). */
export const MIN_SPAN = 2;
/** Most boxes side by side. */
export const MAX_PER_ROW = 4;

/**
 * As the page has always looked: Nu, Idag and Maten on top, the week under, the row of buttons at the bottom.
 * "Att göra" (#86) stands to the right of the week, and only when a list is chosen (else the week has the whole row).
 */
export const DEFAULT_LAYOUT: Layout = {
  rows: [
    { ids: ["nu", "idag", "mat"], spans: [5, 3, 4] },
    { ids: ["vecka", "todo"], spans: [9, 3] },
    { ids: ["teknik"], spans: [12] },
  ],
};

const clone = (l: Layout): Layout => ({ rows: l.rows.map((r) => ({ ids: [...r.ids], spans: [...r.spans] })) });

/** Spans for `n` boxes in proportion to `weights`, each at least MIN_SPAN, always adding up to 12. */
export function fitSpans(weights: number[]): number[] {
  const n = weights.length;
  if (!n) return [];
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 1));
  const sum = w.reduce((a, b) => a + b, 0);
  const raw = w.map((x) => (COLS * x) / sum);
  const spans = raw.map((r) => Math.max(MIN_SPAN, Math.floor(r)));
  let rest = COLS - spans.reduce((a, b) => a + b, 0);
  const byFraction = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (let k = 0; rest > 0; k = (k + 1) % n, rest--) spans[byFraction[k]!.i]!++;
  while (rest < 0) {
    const big = spans.indexOf(Math.max(...spans));
    if (spans[big]! <= MIN_SPAN) break;
    spans[big]!--;
    rest++;
  }
  return spans;
}

/**
 * A valid layout from whatever was saved: every box exactly once, at most four per row, no empty rows,
 * widths that add up to 12. Anything unknown is dropped; a box missing is put back where it stood by default.
 */
export function normalizeLayout(raw: unknown): Layout {
  const rowsIn = (raw && typeof raw === "object" && Array.isArray((raw as Layout).rows) ? (raw as Layout).rows : DEFAULT_LAYOUT.rows) as unknown[];
  const seen = new Set<LayoutBox>();
  const rows: LayoutRow[] = [];
  for (const r of rowsIn) {
    if (!r || typeof r !== "object") continue;
    const ids = Array.isArray((r as LayoutRow).ids) ? (r as LayoutRow).ids : [];
    const spans = Array.isArray((r as LayoutRow).spans) ? (r as LayoutRow).spans : [];
    const row: LayoutRow = { ids: [], spans: [] };
    ids.forEach((id, i) => {
      if (!LAYOUT_BOXES.includes(id) || seen.has(id) || row.ids.length >= MAX_PER_ROW) return;
      seen.add(id);
      row.ids.push(id);
      row.spans.push(Number(spans[i]) || 1);
    });
    if (row.ids.length) rows.push({ ids: row.ids, spans: fitSpans(row.spans) });
  }
  // A box that is missing goes back to its default row (or a row of its own at the end).
  for (const id of LAYOUT_BOXES) {
    if (seen.has(id)) continue;
    const defRow = DEFAULT_LAYOUT.rows.findIndex((r) => r.ids.includes(id));
    const target = rows.find((r) => r.ids.some((x) => DEFAULT_LAYOUT.rows[defRow]!.ids.includes(x)) && r.ids.length < MAX_PER_ROW);
    if (target) {
      // Added with the width it has by default; the others keep theirs (and their proportions while it is hidden).
      const defSpan = DEFAULT_LAYOUT.rows[defRow]!.spans[DEFAULT_LAYOUT.rows[defRow]!.ids.indexOf(id)]!;
      target.ids.push(id);
      target.spans = [...target.spans, defSpan];
    } else rows.push({ ids: [id], spans: [COLS] });
  }
  return { rows };
}

export function parseLayout(raw: string | null | undefined): Layout {
  if (!raw) return clone(DEFAULT_LAYOUT);
  try {
    return normalizeLayout(JSON.parse(raw));
  } catch {
    return clone(DEFAULT_LAYOUT);
  }
}

export const isDefault = (l: Layout) => JSON.stringify(normalizeLayout(l)) === JSON.stringify(DEFAULT_LAYOUT);

function where(l: Layout, id: LayoutBox): { r: number; i: number } {
  for (let r = 0; r < l.rows.length; r++) {
    const i = l.rows[r]!.ids.indexOf(id);
    if (i >= 0) return { r, i };
  }
  return { r: -1, i: -1 };
}

/** Two boxes change places (each keeps the width of the place it moves to). */
export function swapBoxes(l: Layout, a: LayoutBox, b: LayoutBox): Layout {
  if (a === b) return l;
  const out = clone(l);
  const pa = where(out, a);
  const pb = where(out, b);
  if (pa.r < 0 || pb.r < 0) return l;
  out.rows[pa.r]!.ids[pa.i] = b;
  out.rows[pb.r]!.ids[pb.i] = a;
  return out;
}

/** Left or right within the row (changes place with the neighbour). */
export function moveInRow(l: Layout, id: LayoutBox, dir: -1 | 1): Layout {
  const p = where(l, id);
  const other = l.rows[p.r]?.ids[p.i + dir];
  return other ? swapBoxes(l, id, other) : l;
}

/**
 * Up or down: into the row above/below (at the end, the others there share their room with it), or – at the top
 * or bottom, or when that row is full – into a new row of its own. A row left empty disappears.
 */
export function moveRow(l: Layout, id: LayoutBox, dir: -1 | 1): Layout {
  const out = clone(l);
  const p = where(out, id);
  if (p.r < 0) return l;
  const from = out.rows[p.r]!;
  if (from.ids.length === 1 && (p.r + dir < 0 || p.r + dir >= out.rows.length)) return l; // already alone at the edge
  from.ids.splice(p.i, 1);
  from.spans.splice(p.i, 1);
  from.spans = fitSpans(from.spans);
  const to = out.rows[p.r + dir];
  if (to && to.ids.length < MAX_PER_ROW) {
    // It gets an equal share: as wide as the others there are on average.
    to.ids.push(id);
    to.spans = fitSpans([...to.spans, to.spans.reduce((a, b) => a + b, 0) / to.spans.length]);
  } else {
    out.rows.splice(dir < 0 ? p.r : p.r + 1, 0, { ids: [id], spans: [COLS] });
  }
  out.rows = out.rows.filter((r) => r.ids.length);
  return { rows: out.rows.map((r) => ({ ids: r.ids, spans: fitSpans(r.spans) })) };
}

/**
 * Wider or narrower by `cols`: the room is taken from (or given to) the neighbour on the right, or on the left
 * for the last box in a row. Nothing goes below MIN_SPAN. Hidden boxes are left out of the sharing.
 */
export function resizeBox(l: Layout, id: LayoutBox, cols: number, hidden: LayoutBox[] = []): Layout {
  const out = clone(l);
  const p = where(out, id);
  if (p.r < 0 || !cols) return l;
  const row = out.rows[p.r]!;
  const shown = row.ids.map((x, i) => ({ x, i })).filter((o) => !hidden.includes(o.x));
  const me = shown.findIndex((o) => o.x === id);
  if (me < 0 || shown.length < 2) return l;
  const spans = shownSpans(row, hidden);
  const nb = me < shown.length - 1 ? me + 1 : me - 1;
  const give = Math.max(-(spans[me]! - MIN_SPAN), Math.min(cols, spans[nb]! - MIN_SPAN));
  if (!give) return l;
  spans[me]! += give;
  spans[nb]! -= give;
  shown.forEach((o, k) => (row.spans[o.i] = spans[k]!));
  return out;
}

/** The widths of the boxes shown in a row (the hidden ones' room shared out among the rest). */
function shownSpans(row: LayoutRow, hidden: LayoutBox[]): number[] {
  const w = row.ids.map((x, i) => ({ x, w: row.spans[i]! })).filter((o) => !hidden.includes(o.x));
  return fitSpans(w.map((o) => o.w));
}

export interface GridPlace {
  id: LayoutBox;
  /** 1-based grid row among the rows that have something shown. */
  row: number;
  /** 1-based first column and width. */
  col: number;
  span: number;
  /** Order on a phone, where every box is one row. */
  order: number;
}

/** Where every shown box goes in the 12-column grid. Rows with nothing shown are skipped. */
export function gridOf(l: Layout, hidden: LayoutBox[] = []): GridPlace[] {
  const out: GridPlace[] = [];
  let row = 0;
  for (const r of l.rows) {
    const shown = r.ids.filter((x) => !hidden.includes(x));
    if (!shown.length) continue;
    row++;
    const spans = shownSpans(r, hidden);
    let col = 1;
    shown.forEach((id, k) => {
      out.push({ id, row, col, span: spans[k]!, order: out.length });
      col += spans[k]!;
    });
  }
  return out;
}

/**
 * Row heights for the grid: the row with the week grows and takes what is left; a row with only the buttons at the
 * bottom is as tall as they are; other rows take what they need, at most about a quarter of the height each.
 */
export function rowTemplate(l: Layout, hidden: LayoutBox[] = []): string {
  const rows = l.rows.map((r) => r.ids.filter((x) => !hidden.includes(x))).filter((r) => r.length);
  const hasWeek = rows.some((r) => r.includes("vecka"));
  return rows
    .map((r) => (r.includes("vecka") ? "minmax(46%, 1fr)" : r.every((x) => x === "teknik") ? "fit-content(14%)" : hasWeek ? "fit-content(26%)" : "minmax(0, 1fr)"))
    .join(" ");
}
