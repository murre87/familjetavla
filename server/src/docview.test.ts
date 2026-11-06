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
