import { describe, expect, it } from "vitest";
import { buildDays } from "./dashboard.js";
import type { SourcedEvent } from "./sources.js";

// The calendar page (#37) shows the weeks after the board's seven days, built the same way as the week.
describe("buildDays further ahead", () => {
  const today = new Date(2026, 10, 7); // lördag 7 november
  const at = (y: number, m: number, d: number, h: number): Date => new Date(y, m, d, h);
  const ev = (title: string, start: Date, extra: Partial<SourcedEvent> = {}): SourcedEvent => ({
    title,
    start,
    end: new Date(start.getTime() + 3_600_000),
    allDay: false,
    sourceId: "cal1",
    category: "family",
    ...extra,
  });
  const family = {
    people: new Map(),
    children: [],
    all: [ev("Tandläkare", at(2026, 10, 17, 9)), ev("Förra veckans", at(2026, 10, 9, 9)), ev("Långt fram", at(2026, 11, 20, 9))],
    travelCtx: { saved: {}, calendars: new Map() },
  };

  it("page 1 is the seven days after the board's week, with weekday names and no 'Idag'", () => {
    const days = buildDays(family, [], {}, today, 7, 7);
    expect(days.map((d) => d.key)).toEqual(["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
    expect(days.some((d) => d.isToday || d.name === "Idag" || d.name === "Imorgon")).toBe(false);
    expect(days[3]!.events.map((e) => e.title)).toEqual(["Tandläkare"]);
    // Only that page's days: nothing from the board's week or further on.
    expect(days.flatMap((d) => d.events.map((e) => e.title))).toEqual(["Tandläkare"]);
  });

  it("the board's own week is unchanged: today first, then tomorrow", () => {
    const days = buildDays(family, [], {}, today, 0, 7);
    expect(days[0]).toMatchObject({ key: "2026-11-07", name: "Idag", isToday: true });
    expect(days[1]!.name).toBe("Imorgon");
    expect(days[2]!.events.map((e) => e.title)).toEqual(["Förra veckans"]);
  });

  it("waste and the week's dinner land on their day further ahead too", () => {
    const days = buildDays(family, [{ date: at(2026, 10, 18, 0), type: "Kärl 1" }], { "2026-11-19": "Tacos" }, today, 7, 7);
    expect(days[4]!.events.map((e) => e.title)).toEqual(["Kärl 1"]);
    expect(days[5]!.events.map((e) => e.title)).toEqual(["Middag: Tacos"]);
  });
});

// The child's own view and the school ends (Emil 2026-11-07: "när barnen slutar varje dag", "alla träningar oavsett vecka").
describe("a child's every day", () => {
  const today = new Date(2026, 10, 9); // måndag 9 november
  const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
  const alicia = {
    id: "a",
    name: "Alicia",
    color: "#0f0",
    kind: "child" as const,
    // Here every day except Tuesday 10 and Wednesday 11 (at the other home).
    custody: { mode: "always" as const, overrides: [{ from: "2026-11-10", to: "2026-11-11", home: false }] },
  };
  const ev = (title: string, start: Date, end: Date, extra: Partial<SourcedEvent>): SourcedEvent => ({ title, start, end, allDay: false, sourceId: "cal", category: "sport", personId: "a", ...extra });
  const all = [
    ev("Matte", at(9, 8), at(9, 12), { sourceId: "school:vk", category: "school" }),
    ev("Svenska", at(9, 12), at(9, 14, 45), { sourceId: "school:vk", category: "school" }),
    ev("Idrott", at(10, 13), at(10, 15, 10), { sourceId: "school:vk", category: "school", gym: true }),
    ev("Glosor v.46", at(10, 15), at(10, 16), { sourceId: "school:vk", category: "school", task: true }),
    ev("Träning F14", at(10, 17), at(10, 18, 30), {}),
    ev("Match", at(9, 18), at(9, 19), {}),
  ];
  const family = { people: new Map([["a", alicia]]), children: [alicia], all, travelCtx: { saved: {}, calendars: new Map() } };

  it("shows when school ends every day, also at the other home (marked so), from the last lesson and not a task", () => {
    const days = buildDays(family, [], {}, today, 0, 3);
    expect(days[0]!.schoolEnds).toEqual([{ name: "Alicia", end: "14:45", gym: false, home: true }]);
    expect(days[1]!.schoolEnds).toEqual([{ name: "Alicia", end: "15:10", gym: true, home: false }]);
    expect(days[2]!.schoolEnds).toEqual([]);
  });

  it("the board hides her training at the other home; her own view shows it", () => {
    const board = buildDays(family, [], {}, today, 0, 2);
    expect(board[1]!.events.map((e) => e.title)).not.toContain("Träning F14");
    expect(board[0]!.events.map((e) => e.title)).toContain("Match");
    const own = buildDays(family, [], {}, today, 0, 2, { allFor: "a" });
    expect(own[1]!.events.map((e) => e.title)).toContain("Träning F14");
  });
});

describe("Att göra (#86)", () => {
  it("shows the open items, dated ones first, and leaves the done ones out", async () => {
    const { todoView } = await import("./dashboard.js");
    const v = todoView([
      { uid: "1", summary: "Boka sotning", status: "needs_action" },
      { uid: "2", summary: "Beställa filter", status: "completed" },
      { uid: "3", summary: "Byta däck", status: "needs_action", due: "2026-11-20" },
      { uid: "4", summary: "  ", status: "needs_action" },
      { uid: "5", summary: "Hallampa", status: "needs_action", due: "2026-11-10" },
    ]);
    expect(v.title).toBe("Att göra");
    expect(v.items.map((i) => i.name)).toEqual(["Hallampa", "Byta däck", "Boka sotning"]);
    expect(v.items[0]).toMatchObject({ id: "5", due: "2026-11-10" });
    expect(todoView([], "Huset").title).toBe("Huset");
  });
});
