import { describe, expect, it } from "vitest";
import { buildSchoolDays, buildSchoolWeek, schoolEndsOn } from "./schoolday.js";
import type { SourcedEvent } from "./sources.js";
import type { Person } from "./types.js";

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);
const lesson = (personId: string, d: number, sh: number, sm: number, eh: number, em: number, extra: Partial<SourcedEvent> = {}): SourcedEvent => ({
  sourceId: "school:vk",
  category: "school",
  personId,
  title: "Lektion",
  allDay: false,
  start: at(d, sh, sm),
  end: at(d, eh, em),
  ...extra,
});
const people = new Map<string, Person>([
  ["ella", { id: "ella", name: "Ella", color: "#5ab8ff", kind: "child" } as Person],
  ["leo", { id: "leo", name: "Leo", color: "#f5c84b", kind: "child" } as Person],
  ["anna", { id: "anna", name: "Anna", color: "#ff8fa3", kind: "adult" } as Person],
]);

describe("Skolan idag", () => {
  const evs = [
    lesson("ella", 20, 8, 10, 9, 0),
    lesson("ella", 20, 13, 0, 14, 30, { gym: true }),
    lesson("leo", 20, 9, 0, 15, 0),
    // Parent meeting in the evening and an all-day item must not move the end time.
    lesson("leo", 20, 18, 0, 19, 0, { title: "Föräldramöte" }),
    lesson("leo", 20, 0, 0, 0, 0, { allDay: true, end: at(21, 0) }),
    lesson("ella", 21, 8, 10, 12, 0),
    { ...lesson("leo", 20, 10, 0, 11, 0), sourceId: "cal:sport" },
  ];

  it("gives first start and last end per child, earliest end first", () => {
    const r = buildSchoolDays(evs, people, at(20, 7))!;
    expect(r.map((x) => [x.name, x.dayLabel, x.start, x.end, x.gym])).toEqual([
      ["Ella", "idag", "08:10", "14:30", true],
      ["Leo", "idag", "09:00", "15:00", false],
    ]);
  });

  it("moves on to the next school day when today is over", () => {
    const r = buildSchoolDays(evs, people, at(20, 15, 30))!;
    expect(r.map((x) => [x.name, x.dayLabel, x.end])).toEqual([["Ella", "imorgon", "12:00"]]);
  });

  it("leaves out days the child is at the other home", () => {
    const r = buildSchoolDays(evs, people, at(20, 7), (e) => e.personId !== "leo")!;
    expect(r.map((x) => x.name)).toEqual(["Ella"]);
  });
});

import { buildSchoolWeek, taskKind } from "./schoolday.js";
import { newer } from "./updates.js";

describe("Skolsidan", () => {
  const evs: SourcedEvent[] = [
    lesson("ella", 20, 8, 10, 9, 0, { title: "Matematik", location: "B12" }),
    lesson("ella", 20, 13, 0, 14, 30, { title: "Idrott", gym: true }),
    lesson("ella", 22, 8, 10, 12, 0, { title: "Svenska" }),
    lesson("ella", 21, 0, 0, 0, 0, { allDay: true, end: at(22, 0), title: "Läxa: glosor kap 3" }),
    lesson("ella", 23, 9, 0, 10, 0, { title: "Prov i NO" }),
    lesson("ella", 24, 0, 0, 0, 0, { allDay: true, end: at(25, 0), title: "Studiedag" }),
  ];

  it("lists the week's lessons Monday–Friday and the coming tasks", () => {
    const [ella] = buildSchoolWeek(evs, people, at(20, 7));
    expect(ella.days.map((d) => [d.label, d.lessons.length])).toEqual([
      ["Måndag", 0],
      ["Tisdag", 2],
      ["Onsdag", 0],
      ["Torsdag", 1],
      ["Fredag", 0],
    ]);
    expect(ella.days[1].today).toBe(true);
    expect(ella.days[1].lessons[0]).toEqual({ start: "08:10", end: "09:00", title: "Matematik", location: "B12", gym: false });
    expect(ella.tasks.map((t) => [t.label, t.kind, t.title])).toEqual([
      ["imorgon", "läxa", "Läxa: glosor kap 3"],
      ["fre 23/10", "prov", "Prov i NO"],
    ]);
  });

  it("shows next week on the weekend", () => {
    const sat = [lesson("ella", 26, 8, 0, 9, 0)];
    const [ella] = buildSchoolWeek(sat, people, at(24, 10));
    expect(ella.days[0].dayKey).toBe("2026-10-26");
  });

  it("names the kind of task", () => {
    expect(taskKind("Glosor vecka 44")).toBe("läxa");
    expect(taskKind("Förhör kap 2")).toBe("prov");
    expect(taskKind("Lämna in rapport")).toBe("inlämning");
    expect(taskKind("Uppgift: bok")).toBe("uppgift");
  });
});

describe("Ny version", () => {
  it("compares versions as numbers", () => {
    expect(newer("0.10.0", "0.9.3")).toBe(true);
    expect(newer("0.7.0", "0.7.0")).toBe(false);
    expect(newer("0.6.9", "0.7.0")).toBe(false);
  });
});

describe("Skolan idag – skolans egna tider", () => {
  const post = (d: number, sh: number, sm: number, eh: number, em: number, title: string) => lesson("leo", d, sh, sm, eh, em, { title, post: true });
  const day = (d: number, sh: number, sm: number, eh: number, em: number) => lesson("leo", d, sh, sm, eh, em, { title: "Skoldag", schoolDay: true });

  it("takes the school day from the platform, not from a swim test in the calendar", () => {
    const evs = [post(20, 9, 30, 10, 30, "Simprov"), day(20, 8, 30, 14, 0)];
    const r = buildSchoolDays(evs, people, at(20, 7))!;
    expect(r.map((x) => [x.name, x.start, x.end])).toEqual([["Leo", "08:30", "14:00"]]);
  });

  it("says nothing for a day with only posts – a swim test is not a school day", () => {
    const r = buildSchoolDays([post(20, 9, 30, 10, 30, "Simprov"), day(21, 8, 30, 15, 30)], people, at(20, 7))!;
    expect(r.map((x) => [x.dayLabel, x.start, x.end])).toEqual([["imorgon", "08:30", "15:30"]]);
  });

  it("still marks the day for gym clothes when the gym lesson is a post", () => {
    const evs = [day(20, 8, 30, 14, 0), { ...post(20, 10, 0, 11, 0, "Idrott"), gym: true }];
    expect(buildSchoolDays(evs, people, at(20, 7))![0]).toMatchObject({ start: "08:30", end: "14:00", gym: true });
  });

  it("uses reported hours in the week and pickup views and keeps lessons for each child", () => {
    const events = [
      day(20, 8, 30, 14, 0),
      lesson("leo", 20, 13, 0, 15, 0),
      { ...post(20, 16, 0, 17, 0, "Idrott"), gym: true },
      lesson("ella", 20, 8, 0, 13, 0),
    ];
    const week = buildSchoolWeek(events, people, at(20, 7));
    const leo = week.find((kid) => kid.personId === "leo")!.days.find((d) => d.today)!;
    expect(leo.hours).toEqual({ start: "08:30", end: "14:00", gym: true });
    expect(leo.lessons.map((item) => item.title)).toEqual(["Lektion"]);
    expect(schoolEndsOn(events, people, at(20, 7), () => true)).toMatchObject([
      { name: "Ella", end: "13:00" }, { name: "Leo", end: "14:00", gym: true },
    ]);
    expect(schoolEndsOn([post(20, 12, 0, 13, 0, "Utflykt")], people, at(20, 7), () => true)).toEqual([]);
  });
});
