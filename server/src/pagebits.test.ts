import { describe, expect, it } from "vitest";
import { hourBuckets, shortControl } from "./pagebits.js";

describe("knappnamn i ett enhetskort", () => {
  it("drops what the card already says", () => {
    expect(shortControl("Spabad Spa Malmgatan 34: Blower")).toBe("Blower");
    expect(shortControl("Spabad Economy Mode", "Spabad: Heater")).toBe("Economy Mode");
    expect(shortControl("Spabad Pump 1", "Spabad Spa Malmgatan 34: Heater")).toBe("Pump 1");
    expect(shortControl("Blower", "Spabad: Heater")).toBe("Blower");
  });
  it("never leaves an empty name", () => {
    expect(shortControl("Spabad", "Spabad: Heater")).toBe("Spabad");
    expect(shortControl("spabad lights", "Spabad")).toBe("Lights");
  });
});

describe("grafer timme för timme", () => {
  it("averages half-hour points per clock hour, the last hour is now", () => {
    const to = "2026-11-14T10:31:00Z";
    const from = "2026-11-14T07:31:00Z";
    // 7 points every 30 min: 07:31 08:01 08:31 09:01 09:31 10:01 10:31
    const r = hourBuckets({ from, to, series: [{ points: [1, 2, 4, 6, 8, null, 10] }] });
    expect(r.hours.map((h) => new Date(h * 3_600_000).getUTCHours())).toEqual([8, 9, 10]);
    expect(r.series[0]).toEqual([3, 7, 10]);
  });
  it("keeps an hour without values empty", () => {
    const r = hourBuckets({ from: "2026-11-14T08:00:00Z", to: "2026-11-14T10:00:00Z", series: [{ points: [1, null, null, null, 5] }] });
    expect(r.series[0]).toEqual([1, null, 5]);
  });
});
