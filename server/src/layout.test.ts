import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, fitSpans, gridOf, isDefault, moveInRow, moveRow, normalizeLayout, parseLayout, resizeBox, rowTemplate, swapBoxes, type Layout } from "./layout.js";

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const shape = (l: Layout) => l.rows.map((r) => r.ids.map((id, i) => `${id}:${r.spans[i]}`).join(" "));

describe("startsidan som pussel", () => {
  it("the default is the page as it has always looked", () => {
    expect(shape(DEFAULT_LAYOUT)).toEqual(["nu:5 idag:3 mat:4", "vecka:12", "teknik:12"]);
    expect(gridOf(DEFAULT_LAYOUT)).toEqual([
      { id: "nu", row: 1, col: 1, span: 5, order: 0 },
      { id: "idag", row: 1, col: 6, span: 3, order: 1 },
      { id: "mat", row: 1, col: 9, span: 4, order: 2 },
      { id: "vecka", row: 2, col: 1, span: 12, order: 3 },
      { id: "teknik", row: 3, col: 1, span: 12, order: 4 },
    ]);
    expect(rowTemplate(DEFAULT_LAYOUT)).toBe("fit-content(26%) minmax(46%, 1fr) fit-content(14%)");
  });

  it("widths always add up to 12 and nobody gets narrower than 2", () => {
    for (const w of [[1], [1, 1, 1], [5, 3, 4], [100, 1], [1, 1, 1, 1], [0, -3, 7]]) {
      const s = fitSpans(w);
      expect(sum(s)).toBe(12);
      expect(Math.min(...s)).toBeGreaterThanOrEqual(2);
    }
  });

  it("making a box wider makes its neighbour narrower (and stops at the narrowest)", () => {
    const wider = resizeBox(DEFAULT_LAYOUT, "nu", 2);
    // Idag can only give one column before it is at its narrowest.
    expect(shape(wider)[0]).toBe("nu:6 idag:2 mat:4");
    expect(sum(wider.rows[0]!.spans)).toBe(12);
    // The last box in a row takes from the one on its left.
    expect(shape(resizeBox(DEFAULT_LAYOUT, "mat", 1))[0]).toBe("nu:5 idag:2 mat:5");
    // Narrower gives the room to the neighbour.
    expect(shape(resizeBox(DEFAULT_LAYOUT, "nu", -2))[0]).toBe("nu:3 idag:5 mat:4");
    // Alone in its row: nothing to share.
    expect(resizeBox(DEFAULT_LAYOUT, "vecka", 3)).toBe(DEFAULT_LAYOUT);
  });

  it("dragging one box onto another swaps them", () => {
    const l = swapBoxes(DEFAULT_LAYOUT, "nu", "vecka");
    expect(shape(l)).toEqual(["vecka:5 idag:3 mat:4", "nu:12", "teknik:12"]);
    expect(rowTemplate(l)).toBe("minmax(46%, 1fr) fit-content(26%) fit-content(14%)");
    expect(shape(moveInRow(DEFAULT_LAYOUT, "idag", 1))[0]).toBe("nu:5 mat:3 idag:4");
  });

  it("up and down move a box between rows, or into a row of its own; empty rows disappear", () => {
    const up = moveRow(DEFAULT_LAYOUT, "teknik", -1);
    expect(shape(up)).toEqual(["nu:5 idag:3 mat:4", "vecka:6 teknik:6"]);
    expect(shape(moveRow(DEFAULT_LAYOUT, "nu", -1))).toEqual(["nu:12", "idag:5 mat:7", "vecka:12", "teknik:12"]);
    expect(shape(moveRow(DEFAULT_LAYOUT, "vecka", -1))).toEqual(["nu:4 idag:2 mat:3 vecka:3", "teknik:12"]);
    // Already alone at the bottom: stays.
    expect(moveRow(DEFAULT_LAYOUT, "teknik", 1)).toBe(DEFAULT_LAYOUT);
  });

  it("a hidden box's room goes to the others in its row, and the week row still grows", () => {
    const g = gridOf(DEFAULT_LAYOUT, ["nu"]);
    expect(g.filter((p) => p.row === 1).map((p) => `${p.id}:${p.col}+${p.span}`)).toEqual(["idag:1+5", "mat:6+7"]);
    // A whole row hidden is skipped.
    expect(gridOf(DEFAULT_LAYOUT, ["nu", "idag", "mat"])[0]).toMatchObject({ id: "vecka", row: 1 });
    expect(rowTemplate(DEFAULT_LAYOUT, ["teknik"])).toBe("fit-content(26%) minmax(46%, 1fr)");
  });

  it("whatever was saved, every box is there exactly once", () => {
    const broken = { rows: [{ ids: ["nu", "nu", "okänd", "vecka"], spans: [3, 3, 3, 9] }, { ids: [], spans: [] }] };
    const l = normalizeLayout(broken);
    const all = l.rows.flatMap((r) => r.ids).sort();
    expect(all).toEqual(["idag", "mat", "nu", "teknik", "vecka"]);
    l.rows.forEach((r) => expect(sum(r.spans)).toBe(12));
    expect(parseLayout("inte json")).toEqual(DEFAULT_LAYOUT);
    expect(isDefault(parseLayout(null))).toBe(true);
    expect(isDefault(swapBoxes(DEFAULT_LAYOUT, "nu", "mat"))).toBe(false);
  });
});
