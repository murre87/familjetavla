import { describe, expect, it } from "vitest";
import { custodyStatus, isHome } from "./custody.js";
import { cheapestBlock, priceLevel, toHourly } from "./connectors/elpris.js";
import { buildPrices } from "./dashboard.js";
import { defaultConfig } from "./store.js";
import { parseIcs } from "./connectors/ics.js";
import { parseEdpDate } from "./connectors/waste.js";
import { isoWeek } from "./time.js";

const d = (s: string) => new Date(`${s}T12:00:00`);

describe("isoWeek", () => {
  it("handles week 53 in 2026", () => {
    expect(isoWeek(d("2026-12-31"))).toBe(53);
    expect(isoWeek(d("2027-01-04"))).toBe(1);
    expect(isoWeek(d("2026-10-18"))).toBe(42);
    expect(isoWeek(d("2026-10-19"))).toBe(43);
  });
});

describe("custody", () => {
  it("odd weeks with Monday handover", () => {
    const c = { mode: "oddWeeks" as const, handoverDay: 1 as const };
    expect(isHome(c, d("2026-10-18"))).toBe(false); // sön v42
    expect(isHome(c, d("2026-10-19"))).toBe(true); // mån v43
    expect(isHome(c, d("2026-10-25"))).toBe(true); // sön v43
    expect(isHome(c, d("2026-10-26"))).toBe(false); // mån v44
  });

  it("odd weeks gives two in a row across week 53", () => {
    const c = { mode: "oddWeeks" as const };
    expect(isHome(c, d("2026-12-30"))).toBe(true); // v53
    expect(isHome(c, d("2027-01-05"))).toBe(true); // v1
  });

  it("alternating never drifts over new year", () => {
    const c = { mode: "alternating" as const, anchorDate: "2026-10-19", handoverDay: 1 as const };
    expect(isHome(c, d("2026-10-20"))).toBe(true);
    expect(isHome(c, d("2026-10-27"))).toBe(false);
    expect(isHome(c, d("2026-12-30"))).toBe(true); // v53: 10 weeks after v43
    expect(isHome(c, d("2027-01-05"))).toBe(false); // v1: alternates, unlike oddWeeks
    expect(isHome(c, d("2026-10-12"))).toBe(false); // week before anchor
  });

  it("Friday handover", () => {
    const c = { mode: "alternating" as const, anchorDate: "2026-10-23", handoverDay: 5 as const };
    expect(isHome(c, d("2026-10-22"))).toBe(false); // tor
    expect(isHome(c, d("2026-10-23"))).toBe(true); // fre
    expect(isHome(c, d("2026-10-29"))).toBe(true); // tor nästa vecka
    expect(isHome(c, d("2026-10-30"))).toBe(false); // fre
  });

  it("status counts down to the change", () => {
    const st = custodyStatus({ mode: "oddWeeks" }, d("2026-10-18"));
    expect(st.home).toBe(false);
    expect(st.daysLeft).toBe(1);
    expect(st.nextChange?.getDate()).toBe(19);
  });
});

describe("elpris", () => {
  const rows = Array.from({ length: 96 }, (_, i) => {
    const t = new Date(2026, 9, 18, 0, i * 15);
    const h = t.getHours();
    return { SEK_per_kWh: h < 5 ? 0.1 : h >= 17 && h < 20 ? 1.2 : 0.8, time_start: t.toISOString() };
  });

  it("averages quarter hours into hours", () => {
    const hourly = toHourly(rows);
    expect(hourly).toHaveLength(24);
    expect(hourly[0].price).toBeCloseTo(0.1);
  });

  it("keeps the four quarters of a full hour, and none for a partial one", () => {
    const quarters = Array.from({ length: 8 }, (_, i) => ({ SEK_per_kWh: 0.1 * (i + 1), time_start: new Date(2026, 9, 18, 0, i * 15).toISOString() }));
    const hourly = toHourly(quarters.slice(0, 7));
    expect(hourly[0].quarters).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(hourly[1].quarters).toBeUndefined(); // only three quarters of hour 1
  });

  it("shows quarters from the current one when asked, otherwise hours", () => {
    const cfg = defaultConfig();
    const now = new Date(2026, 9, 18, 10, 20); // second quarter of 10
    const spot = toHourly(rows).filter((p) => p.start.getHours() >= 10);
    expect(buildPrices(cfg, spot, now)!.bars[0].minute).toBeUndefined();
    const q = buildPrices({ ...cfg, electricity: { ...cfg.electricity, resolution: "quarter" } }, spot, now)!;
    expect(q.resolution).toBe("quarter");
    expect(q.bars.slice(0, 3).map((b) => `${b.hour}:${b.minute}`)).toEqual(["10:15", "10:30", "10:45"]);
    expect(q.bars[0].current).toBe(true);
    expect(q.bars[1].current).toBe(false);
  });

  it("finds the cheapest contiguous block", () => {
    const hourly = toHourly(rows);
    const b = cheapestBlock(hourly, 4, new Date(2026, 9, 18, 0, 10))!;
    expect(b.start.getHours()).toBe(0);
    expect(b.end.getHours()).toBe(4);
    expect(priceLevel(1.2, hourly)).toBe("dyrt");
    expect(priceLevel(0.1, hourly)).toBe("billigt");
  });
});

describe("ics", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:1",
    "DTSTART;TZID=Europe/Stockholm:20261019T173000",
    "DTEND;TZID=Europe/Stockholm:20261019T190000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6",
    "SUMMARY:Fotboll träning",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:2",
    "DTSTART;VALUE=DATE:20261024",
    "DTEND;VALUE=DATE:20261025",
    "SUMMARY:Cup",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("expands weekly training and keeps all-day events", () => {
    const evs = parseIcs(ics, new Date(2026, 9, 18), new Date(2026, 9, 25));
    const titles = evs.map((e) => `${e.start.getDate()} ${e.title}`);
    expect(titles).toEqual(["19 Fotboll träning", "21 Fotboll träning", "24 Cup"]);
    expect(evs[0].start.getHours()).toBe(17);
    expect(evs[2].allDay).toBe(true);
  });

  it("keeps wall-clock time across the DST change (25 Oct 2026)", () => {
    const evs = parseIcs(ics, new Date(2026, 9, 26), new Date(2026, 9, 27));
    expect(evs).toHaveLength(1);
    expect([evs[0].start.getDate(), evs[0].start.getHours(), evs[0].start.getMinutes()]).toEqual([26, 17, 30]);
  });
});

describe("waste dates", () => {
  it("parses the EDP formats", () => {
    expect(parseEdpDate("2026-10-20")?.getDate()).toBe(20);
    const w = parseEdpDate("v43 Okt 2026")!;
    expect([w.getMonth(), w.getDate()]).toEqual([9, 19]);
    expect(parseEdpDate("Vecka 44", new Date(2026, 9, 18))?.getDate()).toBe(26);
    expect(parseEdpDate("Nov 2026")?.getMonth()).toBe(10);
    expect(parseEdpDate("")).toBeNull();
  });
});
