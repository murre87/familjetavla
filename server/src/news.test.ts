import { describe, expect, it } from "vitest";
import { newsReminders } from "./news.js";
import type { SchoolNews } from "./types.js";

const n = (id: string, published: string, seen = false): SchoolNews => ({ id, title: `Nyhet ${id}`, text: "", published, files: [], seen });

describe("school news reminders", () => {
  it("shows at most two unread news from the last week", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    const r = newsReminders([n("a", "2026-10-20T08:00:00Z"), n("b", "2026-10-19T08:00:00Z", true), n("c", "2026-10-18T08:00:00Z"), n("d", "2026-10-17T08:00:00Z"), n("e", "2026-10-01T08:00:00Z")], now);
    expect(r.map((x) => x.title)).toEqual(["Från skolan: Nyhet a", "Från skolan: Nyhet c"]);
  });
});

describe("utflykt och matsäck från skolans nyheter", () => {
  it("hittar datum i texten: 27/10, 27 oktober och på torsdag", async () => {
    const { datesIn } = await import("./news.js");
    const from = new Date(2026, 9, 20); // tisdag
    const keys = (t: string) => datesIn(t, from).map((d) => d.toDateString());
    expect(keys("Utflykt 27/10")).toEqual([new Date(2026, 9, 27).toDateString()]);
    expect(keys("utflykten den 27:e oktober")).toEqual([new Date(2026, 9, 27).toDateString()]);
    expect(keys("På torsdag går vi till skogen")).toEqual([new Date(2026, 9, 22).toDateString()]);
  });
  it("påminner dagen innan och samma dag med vad som ska med", async () => {
    const { newsTripReminders } = await import("./news.js");
    const n = { id: "1", who: "Ella", title: "Friluftsdag", text: "På torsdag är det friluftsdag. Ta med matsäck och vattenflaska.", published: "2026-10-20T08:00:00", files: [], seen: true };
    expect(newsTripReminders([n], new Date(2026, 9, 21, 18)).map((r) => r.title)).toEqual(["Ella · friluftsdag imorgon – ta med matsäck, vattenflaska"]);
    expect(newsTripReminders([n], new Date(2026, 9, 22, 7)).map((r) => r.title)).toEqual(["Ella · friluftsdag idag – ta med matsäck, vattenflaska"]);
    expect(newsTripReminders([n], new Date(2026, 9, 20, 9))).toEqual([]);
  });

  it("finds tomorrow on the day the clock goes back (a 25-hour day)", async () => {
    const { newsTripReminders } = await import("./news.js");
    const n = { id: "2", who: "Ella", title: "Friluftsdag", text: "På måndag är det friluftsdag. Ta med matsäck.", published: "2026-10-23T08:00:00", files: [], seen: true };
    // Sunday 25 October 2026 is the day Sweden goes back to winter time: midnight + 24 h is still the same date.
    expect(newsTripReminders([n], new Date(2026, 9, 25, 18)).map((r) => r.title)).toEqual(["Ella · friluftsdag imorgon – ta med matsäck"]);
  });
});
