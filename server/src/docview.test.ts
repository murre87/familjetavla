import { describe, expect, it } from "vitest";
import { docPage, downloadHeader, isDocx, safeFileName } from "./docview.js";
import { parseAssignmentKind } from "./connectors/vklass.js";

describe("bilagor: Word, nedladdning och typ", () => {
  it("känner igen Word-filer", () => {
    expect(isDocx("Stavning v 46.docx")).toBe(true);
    expect(isDocx("läxa", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
    expect(isDocx("Läxa v 45.pdf", "application/pdf")).toBe(false);
  });
  it("gör ett säkert filnamn och en nedladdningsrubrik", () => {
    expect(safeFileName('a/b:c*"d".pdf')).toBe("a_b_c__d_.pdf");
    expect(safeFileName(undefined)).toBe("bilaga");
    expect(downloadHeader("Läxa v 45.pdf")).toBe("attachment; filename*=UTF-8''L%C3%A4xa%20v%2045.pdf");
  });
  it("lägger sidan i en enkel sida", () => {
    expect(docPage("<p>hej</p>")).toContain("<body><p>hej</p></body>");
  });
  it("läser typen som Vklass själv skriver den", () => {
    const page = (t: string) => `<header><div class="text-tags">${t}</div><h1>X</h1></header>`;
    expect(parseAssignmentKind(page("Läxa, Svenska"))).toBe("läxa");
    expect(parseAssignmentKind(page("Prov, Matematik"))).toBe("prov");
    expect(parseAssignmentKind(page("Uppgift, Engelska"))).toBe("uppgift");
    expect(parseAssignmentKind(page("Inlämning, SO"))).toBe("inlämning");
    expect(parseAssignmentKind(page("Något annat, SO"))).toBeUndefined();
    expect(parseAssignmentKind("<p>ingen typ</p>")).toBeUndefined();
  });
});

import { menuDishes } from "./mealwords.js";
describe("skolmat från Home Assistant (issue 60: maten kom dubbelt)", () => {
  it("visar varje rätt en gång, med beskrivningen som källa", () => {
    expect(
      menuDishes(
        "Korv Stroganoff serveras med ris. I Stroganoff med sojakorv serveras med potatis och havreris.",
        "[Lunch] • Korv Stroganoff serveras med ris. • Stroganoff med sojakorv serveras med potatis och havreris.",
      ),
    ).toEqual(["Korv Stroganoff serveras med ris.", "Stroganoff med sojakorv serveras med potatis och havreris."]);
  });
  it("slår ihop samma rätt som står två gånger", () => {
    expect(menuDishes("Kökets Val I Kökets Val", "[Lunch] • Kökets Val • Kökets Val")).toEqual(["Kökets Val"]);
  });
  it("klarar en titel utan beskrivning, med | eller I mellan valen", () => {
    expect(menuDishes("Lasagne med morot och keso. | Kökets vegetariska val.")).toEqual(["Lasagne med morot och keso.", "Kökets vegetariska val."]);
    expect(menuDishes("Fisk Gratäng serveras kokt potatis. I Het grön gratäng.")).toEqual(["Fisk Gratäng serveras kokt potatis.", "Het grön gratäng."]);
    expect(menuDishes("Pasta med tomatsås")).toEqual(["Pasta med tomatsås"]);
  });
});

import { isMenuEvent, menuEventDishes, splitMenuEvents } from "./mealwords.js";
describe("matsedel i en kalender (issue 66: SchoolSoft)", () => {
  const ev = (title: string, description: string | undefined, day: number, allDay = true) => ({ title, description, allDay, start: new Date(2026, 10, day), end: new Date(2026, 10, day + 1) });
  const label = (d: Date) => `d${d.getDate()}`;
  it("känner igen Matsedel som heldagshändelse, men inte en lektion", () => {
    expect(isMenuEvent(ev("Matsedel", "x", 9))).toBe(true);
    expect(isMenuEvent(ev("matsedel", "x", 9))).toBe(true);
    expect(isMenuEvent(ev("Lektion Lunch", "x", 9, false))).toBe(false);
    expect(isMenuEvent(ev("Matsedel", "x", 9, false))).toBe(false);
  });
  it("tar bort rubrikraden och behåller rätten", () => {
    expect(menuEventDishes("Huvudrätt\nChili con carne serveras med ris")).toEqual(["Chili con carne serveras med ris"]);
    expect(menuEventDishes("Lunch\nKorvstroganoff serveras med ris")).toEqual(["Korvstroganoff serveras med ris"]);
    expect(menuEventDishes("Vegetariskt\nVegetarisk chili serveras med ris")).toEqual(["Vegetariskt: Vegetarisk chili serveras med ris"]);
    expect(menuEventDishes("Pasta med köttfärssås")).toEqual(["Pasta med köttfärssås"]);
    expect(menuEventDishes(undefined)).toEqual([]);
  });
  it("slår ihop dagens två Matsedel-händelser och lämnar övriga händelser kvar", () => {
    const { events, food } = splitMenuEvents(
      [ev("Matsedel", "Huvudrätt\nChili con carne serveras med ris", 9), ev("Matsedel", "Vegetariskt\nVegetarisk chili serveras med ris", 9), ev("Planering Unit 4", "x", 9), ev("Matsedel", "Lunch\nKorvstroganoff serveras med ris", 10)],
      label,
    );
    expect(events.map((e) => e.title)).toEqual(["Planering Unit 4"]);
    expect(food).toEqual([
      { child: "", day: "d9", dishes: ["Chili con carne serveras med ris", "Vegetariskt: Vegetarisk chili serveras med ris"] },
      { child: "", day: "d10", dishes: ["Korvstroganoff serveras med ris"] },
    ]);
  });
});

import { dinnersFromEvents } from "./meals.js";
describe("middag från en kalender (issue 61: Paprika)", () => {
  const d = (day: number, hh = 0) => new Date(2026, 10, day, hh);
  it("gör varje dags händelser till en middag och tar bort 'Middag:' i början", () => {
    expect(dinnersFromEvents([{ title: "Middag: Lasagne", start: d(9) }, { title: "Tacos", start: d(10, 18) }])).toEqual({ "2026-11-09": "Lasagne", "2026-11-10": "Tacos" });
  });
  it("slår ihop flera rätter samma dag utan dubbletter", () => {
    expect(dinnersFromEvents([{ title: "Pasta", start: d(9) }, { title: "Sallad", start: d(9) }, { title: "pasta", start: d(9) }])).toEqual({ "2026-11-09": "Pasta · Sallad" });
  });
  it("hoppar över tomma titlar", () => {
    expect(dinnersFromEvents([{ title: "  ", start: d(9) }, { title: "Middag:", start: d(9) }])).toEqual({});
  });
});

import { applyLeave, expandDays } from "./sick.js";
import type { SourcedEvent } from "./sources.js";
describe("lov (issue 52)", () => {
  const ev = (over: Partial<SourcedEvent>): SourcedEvent => ({ sourceId: "x", title: "t", start: new Date(2026, 10, 9, 8), end: new Date(2026, 10, 9, 9), allDay: false, category: "family", personId: "k1", ...over }) as SourcedEvent;
  it("tar bort skola, förskola och hämtning men låter träningen vara kvar, och lägger in ett Lov-märke", () => {
    const out = applyLeave(
      [ev({ title: "Matte", sourceId: "school:a", category: "school" }), ev({ title: "Fritids", sourceId: "care:k1", category: "school" }), ev({ title: "Träning", sourceId: "cal", category: "sport" }), ev({ title: "Skola andra dagen", sourceId: "school:a", category: "school", start: new Date(2026, 10, 10, 8), end: new Date(2026, 10, 10, 9) })],
      { k1: ["2026-11-09"] },
    );
    expect(out.map((e) => e.title).sort()).toEqual(["Lov – ledig", "Skola andra dagen", "Träning"]);
    expect(out.find((e) => e.title === "Lov – ledig")?.sourceId).toBe("leave");
  });
  it("rör inte ett annat barns dagar", () => {
    const out = applyLeave([ev({ title: "Matte", sourceId: "school:a", category: "school", personId: "k2" })], { k1: ["2026-11-09"] });
    expect(out.map((e) => e.title).sort()).toEqual(["Lov – ledig", "Matte"]);
  });
  it("gör ett datumspann till dagar, högst 60, och en bakvänd period blir en dag", () => {
    expect(expandDays("2026-11-09", "2026-11-11")).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
    expect(expandDays("2026-11-09", "2026-11-09")).toEqual(["2026-11-09"]);
    expect(expandDays("2026-11-09", "2026-11-01")).toEqual(["2026-11-09"]);
    expect(expandDays("2026-11-01", "2027-03-01")).toHaveLength(60);
    expect(expandDays("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
});

import { htmlToText } from "./connectors/vklass.js";
describe("glosor som tabell (en lista med ord blev ett ord per rad)", () => {
  it("behåller varje tabellrad som 'ord | översättning'", () => {
    const html = '<p>Läxa</p><table><tr><td><p>shame</p></td><td><p>synd/ skam</p></td></tr><tr><td>any</td><td>någon/ några</td></tr></table>';
    // A blank line after the paragraph is a normal paragraph break; every table row stays one line.
    expect(htmlToText(html)).toBe("Läxa\n\nshame | synd/ skam\nany | någon/ några");
  });
  it("lämnar vanlig text som den är", () => {
    expect(htmlToText("<p>Se bifogade läxpappret.</p>")).toBe("Se bifogade läxpappret.");
  });
});

import { textBlocks } from "./textblocks.js";
describe("text med tabellrader", () => {
  it("gör rader med 'a | b' i följd till en tabell och resten till text", () => {
    expect(textBlocks("Läxa till tisdag\nshame | synd/ skam\nany | någon/ några\nKlart")).toEqual([
      { kind: "text", text: "Läxa till tisdag" },
      { kind: "table", rows: [["shame", "synd/ skam"], ["any", "någon/ några"]] },
      { kind: "text", text: "Klart" },
    ]);
  });
  it("låter en ensam rad med | vara text och tål text utan tabell", () => {
    expect(textBlocks("a | b")).toEqual([{ kind: "text", text: "a | b" }]);
    expect(textBlocks("Bara text\nPå två rader")).toEqual([{ kind: "text", text: "Bara text\nPå två rader" }]);
    expect(textBlocks("")).toEqual([]);
  });
});

import { BOX_SIZE_MAX, BOX_SIZE_MIN, boxSpans, normalizePref, parsePrefs, passesShow, withPref } from "./boxprefs.js";
describe("rutinställningar (håll in en ruta)", () => {
  it("rensar och begränsar värden, och lämnar standard utanför", () => {
    expect(normalizePref({ size: 1 })).toEqual({});
    expect(normalizePref({ size: 9 }).size).toBe(BOX_SIZE_MAX);
    expect(normalizePref({ size: 0.1 }).size).toBe(BOX_SIZE_MIN);
    expect(normalizePref({ size: 1.23 }).size).toBe(1.25);
    expect(normalizePref({ density: "kaos", days: 99, people: [], show: "alla", hidden: false })).toEqual({ days: 8 });
    expect(normalizePref({ days: 1 }).days).toBe(3);
    expect(normalizePref({ people: ["Esther", 7, ""], hidden: true })).toEqual({ people: ["Esther"], hidden: true });
    expect(normalizePref(null)).toEqual({});
  });
  it("läser sparade inställningar och tål trasig text", () => {
    expect(parsePrefs(null)).toEqual({});
    expect(parsePrefs("{trasig")).toEqual({});
    expect(parsePrefs(JSON.stringify({ vecka: { days: 5, show: "tasks" }, okänd: { size: 2 }, nu: { size: 1 } }))).toEqual({ vecka: { days: 5, show: "tasks" } });
  });
  it("ändrar en ruta i taget och tar bort den när inget är kvar", () => {
    let p = withPref({}, "vecka", { days: 5 });
    p = withPref(p, "vecka", { show: "activities" });
    expect(p).toEqual({ vecka: { days: 5, show: "activities" } });
    p = withPref(p, "vecka", { days: undefined });
    expect(p).toEqual({ vecka: { show: "activities" } });
    p = withPref(p, "nu", { hidden: true });
    expect(Object.keys(p).sort()).toEqual(["nu", "vecka"]);
    expect(withPref(p, "vecka", null)).toEqual({ nu: { hidden: true } });
    expect(withPref({ nu: { hidden: true } }, "nu", { hidden: false })).toEqual({});
  });
  it("delar upp 12 kolumner efter vikt, alltid summa 12", () => {
    const sum = (s: Record<string, number | undefined>) => Object.values(s).reduce((a, b) => a! + b!, 0);
    expect(boxSpans([{ id: "nu", w: 5 }, { id: "idag", w: 3 }, { id: "mat", w: 4 }])).toEqual({ nu: 5, idag: 3, mat: 4 });
    expect(boxSpans([{ id: "idag", w: 3 }, { id: "mat", w: 4 }])).toEqual({ idag: 5, mat: 7 });
    expect(boxSpans([{ id: "mat", w: 4 }])).toEqual({ mat: 12 });
    expect(boxSpans([])).toEqual({});
    for (const items of [[5, 3, 4], [5, 3], [3, 4], [1, 1, 1], [7, 1, 1]]) expect(sum(boxSpans(items.map((w, i) => ({ id: (["nu", "idag", "mat"] as const)[i]!, w }))))).toBe(12);
  });
  it("visar bara läxor eller bara träningar och matcher när det är valt", () => {
    const sport = { category: "sport" };
    const other = { category: "family" };
    expect(passesShow(undefined, other, false)).toBe(true);
    expect(passesShow("tasks", other, true)).toBe(true);
    expect(passesShow("tasks", sport, false)).toBe(false);
    expect(passesShow("activities", sport, false)).toBe(true);
    expect(passesShow("activities", other, false)).toBe(false);
    expect(passesShow("activities", sport, true)).toBe(false);
  });
});
