import { describe, expect, it } from "vitest";
import { allowedToTurnOn, isQuietNow } from "./quiet.js";

const q = { entities: ["light.fonsterlampa_charlie"], from: "18:00", to: "08:00" };
const at = (hh: number, mm = 0) => new Date(2026, 10, 4, hh, mm);

describe("lampor som inte får tändas på natten", () => {
  it("är tyst från 18:00 över midnatt till 08:00", () => {
    expect(isQuietNow(q, at(17, 59))).toBe(false);
    expect(isQuietNow(q, at(18, 0))).toBe(true);
    expect(isQuietNow(q, at(23, 30))).toBe(true);
    expect(isQuietNow(q, at(0, 5))).toBe(true);
    expect(isQuietNow(q, at(7, 59))).toBe(true);
    expect(isQuietNow(q, at(8, 0))).toBe(false);
  });
  it("hoppar bara över de utpekade lamporna, och bara när det är tyst", () => {
    const all = ["light.trapp", "light.fonsterlampa_charlie", "light.fonsterlampa_esther"];
    expect(allowedToTurnOn(all, q, at(20, 23))).toEqual(["light.trapp", "light.fonsterlampa_esther"]);
    expect(allowedToTurnOn(all, q, at(12, 0))).toEqual(all);
  });
  it("gör ingenting utan inställning, med tom lista eller lika från och till", () => {
    const all = ["light.fonsterlampa_charlie"];
    expect(allowedToTurnOn(all, undefined, at(22))).toEqual(all);
    expect(allowedToTurnOn(all, { ...q, entities: [] }, at(22))).toEqual(all);
    expect(allowedToTurnOn(all, { ...q, from: "08:00" }, at(22))).toEqual(all);
  });
});
