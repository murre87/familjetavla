import { describe, expect, it } from "vitest";
import { christmasLine, christmasView, inChristmasSeason } from "./christmas.js";
import type { Config } from "./types.js";

const d = (m: number, day: number, y = 2026) => new Date(y, m - 1, day, 12, 0);
const cfg = (christmas?: "auto" | "on" | "off", household: Partial<Config["household"]> = {}) =>
  ({ household: { name: "H", ...household }, dashboard: { christmas } }) as unknown as Config;

describe("julsäsongen", () => {
  it("börjar 21 november och slutar 26 december, båda dagarna med", () => {
    expect(inChristmasSeason(d(11, 20))).toBe(false);
    expect(inChristmasSeason(d(11, 21))).toBe(true);
    expect(inChristmasSeason(d(12, 24))).toBe(true);
    expect(inChristmasSeason(d(12, 26))).toBe(true);
    expect(inChristmasSeason(d(12, 27))).toBe(false);
  });
  it("gäller varje år och inte resten av året", () => {
    for (const y of [2026, 2027, 2030]) {
      expect(inChristmasSeason(d(12, 1, y))).toBe(true);
      expect(inChristmasSeason(d(1, 15, y))).toBe(false);
      expect(inChristmasSeason(d(7, 4, y))).toBe(false);
    }
  });
});

describe("julkortet visas", () => {
  it("som standard (auto, och när inget är valt) bara under säsongen", () => {
    expect(christmasView(cfg(), d(11, 21)).show).toBe(true);
    expect(christmasView(cfg("auto"), d(12, 26)).show).toBe(true);
    expect(christmasView(cfg(), d(12, 27)).show).toBe(false);
    expect(christmasView(cfg("auto"), d(5, 1)).show).toBe(false);
  });
  it("året runt när familjen valt på, och aldrig när de valt av (även mitt i säsongen)", () => {
    expect(christmasView(cfg("on"), d(6, 1)).show).toBe(true);
    expect(christmasView(cfg("off"), d(12, 24)).show).toBe(false);
    expect(christmasView(cfg("off"), d(12, 24)).inSeason).toBe(true);
  });
  it("ett okänt värde räknas som auto", () => {
    expect(christmasView(cfg("nej" as never), d(12, 1)).mode).toBe("auto");
  });
  it("använder hemmets plats, annars Stockholm, och aldrig ett enskilt hus", () => {
    const own = christmasView(cfg("auto", { lat: 65.58, lon: 22.15, place: "Luleå" }), d(12, 1));
    expect([own.lat, own.lon, own.place]).toEqual([65.58, 22.15, "Luleå"]);
    const none = christmasView(cfg("auto"), d(12, 1));
    expect([none.lat, none.lon, none.place]).toEqual([59.33, 18.07, ""]);
    expect(christmasView(cfg("auto", { lat: Number.NaN, lon: 1 }), d(12, 1)).lat).toBe(59.33);
  });
});

describe("texten i rutan", () => {
  it("räknar dagar till julafton, med imorgon och idag", () => {
    expect(christmasLine(new Date(2026, 10, 21, 9, 0)).big).toBe("33 dagar till jul");
    expect(christmasLine(new Date(2026, 11, 22, 23, 59)).big).toBe("2 dagar till jul");
    expect(christmasLine(new Date(2026, 11, 23, 8, 0)).big).toBe("Imorgon är det julafton");
    expect(christmasLine(new Date(2026, 11, 24, 8, 0)).big).toBe("Julafton idag");
  });
  it("säger God jul från julaftons kväll till slutet av annandag jul", () => {
    expect(christmasLine(new Date(2026, 11, 24, 17, 59)).big).toBe("Julafton idag");
    expect(christmasLine(new Date(2026, 11, 24, 18, 0)).big).toBe("God jul!");
    expect(christmasLine(new Date(2026, 11, 26, 23, 0)).big).toBe("God jul!");
  });
  it("pekar på nästa jul efter annandag jul (när kortet är påslaget året runt)", () => {
    expect(christmasLine(new Date(2026, 11, 27, 9, 0)).big).toBe("362 dagar till jul");
    expect(christmasLine(new Date(2027, 0, 1, 9, 0)).big).toBe("357 dagar till jul");
  });
});
