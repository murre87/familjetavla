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
