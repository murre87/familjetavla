import { describe, expect, it } from "vitest";
import { mapVklassItems, parseVklassWelcome, vklassDayLabel } from "./connectors/vklass.js";

// Same structure as the real custodian start page (2026-10-19), made-up names and food.
const card = (name: string, extra: string, days: [string, string[]][]) => `
<div class="vk-student-card">
  <div class="vk-student-card-header opaque"><vkau-icon-badge></vkau-icon-badge><h2 class="vk-student-card-header__text">${name}</h2></div>
  <div class="vk-student-card-content vk-swipe__item__invisible-outside-viewport"><div>${extra}</div></div>
  ${days
    .map(([d, dishes]) => `<div><div class="vk-student-card__day"><h3>${d}</h3><div class="vk-student-card__day__food"><h4>Matsedel</h4><ul>${dishes.map((x) => `<li>${x}</li>`).join("")}</ul></div></div></div>`)
    .join("")}
</div>`;
const html =
  card(
    "Kim",
    `<div class="vk-display"><div class="vk-display__header">Omsorgstid</div><div class="vk-display__content"><a class="vk-link" href="#/CareSchedule/Overview"><span class="vk-link__text-wrapper"><span class="vk-link__text">07:15 - 16:00</span></span></a><div class="vk-flex"><span class="text-bold">Ej närvarande</span></div></div></div>`,
    [["Idag", ["Vegetarisk rätt"]], ["Imorgon", ["Fiskgratäng", "Potatismos"]], ["fredag", ["Tacos"]]],
  ) +
  card("Alex", `<a href="/Schedule?studentIds=4711">Nästa lektion</a>`, [["Idag", ["Korv med mos", "Vegetarisk korv med mos"]]]);

describe("Vklass start page", () => {
  const today = new Date(2026, 9, 20); // tisdag
  const kids = parseVklassWelcome(html, today);

  it("finds every child, also a preschool child without lessons", () => {
    expect(kids.map((k) => k.name)).toEqual(["Kim", "Alex"]);
    expect(kids[1].id).toBe("4711");
    expect(kids[0].id).toBe("");
  });

  it("reads the menu per day with real dates", () => {
    expect(kids[0].food).toEqual([
      { day: "tisdag 20/10", dishes: ["Vegetarisk rätt"] },
      { day: "onsdag 21/10", dishes: ["Fiskgratäng", "Potatismos"] },
      { day: "fredag 23/10", dishes: ["Tacos"] },
    ]);
    expect(kids[1].food[0].dishes).toEqual(["Korv med mos", "Vegetarisk korv med mos"]);
  });

  it("reads the care time", () => {
    expect(kids[0].careTime).toBe("07:15 - 16:00");
    expect(kids[1].careTime).toBeUndefined();
  });

  it("turns Idag/Imorgon/weekday into a date", () => {
    expect(vklassDayLabel("Idag", today)).toBe("tisdag 20/10");
    expect(vklassDayLabel("Imorgon", today)).toBe("onsdag 21/10");
    expect(vklassDayLabel("tisdag", today)).toBe("tisdag 27/10");
    expect(vklassDayLabel("måndag", new Date(2026, 9, 23))).toBe("måndag 26/10");
  });
});

import { cleanLessonTitle } from "./connectors/vklass.js";
import { buildSchoolWeek } from "./schoolday.js";

describe("Vklass lessons and assignments", () => {
  it("drops the course code from lesson names", () => {
    expect(cleanLessonTitle("Svenska (5:a:TH-26__SV)")).toBe("Svenska");
    expect(cleanLessonTitle("Matematik (KLA.5_MA)")).toBe("Matematik");
    expect(cleanLessonTitle("Idrott och hälsa (5:a:TH-26__IDH)")).toBe("Idrott och hälsa");
    expect(cleanLessonTitle("Utflykt (heldag)")).toBe("Utflykt (heldag)");
  });

  it("puts assignments under homework, not among the lessons", () => {
    const now = new Date(2026, 9, 20, 9); // tisdag
    const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);
    const people = new Map([["e", { id: "e", name: "Kim", color: "#fff", kind: "child" as const }]]);
    const ev = (title: string, start: Date, task = false) => ({ title, start, end: new Date(start.getTime() + 3_600_000), allDay: false, sourceId: "school:vk", personId: "e", category: "school" as const, task });
    const week = buildSchoolWeek(
      [ev("Svenska", at(20, 8)), ev("SV-läxa", at(22, 12, 35), true), ev("Matematikprov i talområdet", at(22, 8), true), ev("Bokrecension", at(23, 8), true)],
      people as never,
      now,
    );
    const kim = week[0];
    expect(kim.days[1].lessons.map((l) => l.title)).toEqual(["Svenska"]);
    expect(kim.days[3].lessons).toEqual([]);
    expect(kim.tasks.map((t) => `${t.label} ${t.kind} ${t.title}`)).toEqual([
      "tor 22/10 prov Matematikprov i talområdet",
      "tor 22/10 läxa SV-läxa",
      "fre 23/10 uppgift Bokrecension",
    ]);
  });
});

import { htmlToText } from "./connectors/vklass.js";

describe("Vklass task text", () => {
  it("keeps headings, bullets and line breaks readable", () => {
    const html = "<p>Inför provet ska du kunna:</p><p><strong>1. Storleksordna tal</strong></p><ul><li>Jämföra tal</li><li>Små decimaltal</li></ul><p><em>Exempel:</em> 19&nbsp;900 000</p>";
    expect(htmlToText(html)).toBe("Inför provet ska du kunna:\n\n1. Storleksordna tal\n\n• Jämföra tal\n• Små decimaltal\n\nExempel: 19 900 000");
    expect(htmlToText("Här kommer veckans läxa.")).toBe("Här kommer veckans läxa.");
  });
});

describe("Vklass calendar items", () => {
  it("a lesson with a space-separated time is a lesson, not an all-day task", () => {
    const [lesson, hw, day] = mapVklassItems([
      { title: "Svenska (8B-FLA-26__SV)", start: "2026-11-02 08:50", end: "2026-11-02 09:50", eventType: 1, className: "vk-cl-event-lecture" },
      { title: "Glosor V.45", start: "2026-11-06 11:10", eventType: 2, className: "vk-cl-event-assignment" },
      { title: "Studiedag", start: "2026-11-09", eventType: 8 },
    ]);
    expect(lesson).toMatchObject({ allDay: false, task: false, title: "Svenska" });
    expect(hw).toMatchObject({ allDay: false, task: true });
    expect(day.allDay).toBe(true);
    expect(mapVklassItems([{ title: "X", start: "2026-11-02T08:50:00", eventType: 1 }])[0].allDay).toBe(false);
  });
});
