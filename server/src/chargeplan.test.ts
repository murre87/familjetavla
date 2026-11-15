import { describe, expect, it } from "vitest";
import { blocksToRules, buildAutomation, findCharging, parseAutomation, rulesToBlocks } from "./chargeplan.js";
import type { HaEntityInfo } from "./discovery.js";

const ent = (e: string, n: string, extra: Partial<HaEntityInfo> = {}): HaEntityInfo => ({
  e,
  n,
  a: null,
  d: "car",
  dn: "Tesla",
  m: "Tesla",
  mo: "Model Y",
  dc: null,
  u: null,
  st: "on",
  lu: "2026-10-18T10:00:00Z",
  ...extra,
});

describe("rulesToBlocks", () => {
  it("splits overnight windows at midnight", () => {
    const b = rulesToBlocks([{ days: [1, 2, 3, 4, 5], from: "22:00", to: "06:00" }]);
    expect(b.monday).toEqual([{ from: "22:00:00", to: "24:00:00" }]);
    expect(b.tuesday).toEqual([
      { from: "00:00:00", to: "06:00:00" },
      { from: "22:00:00", to: "24:00:00" },
    ]);
    expect(b.saturday).toEqual([{ from: "00:00:00", to: "06:00:00" }]);
    expect(b.sunday).toEqual([]);
  });

  it("sunday night continues on monday morning, and overlaps merge", () => {
    const b = rulesToBlocks([
      { days: [7], from: "23:00", to: "05:00" },
      { days: [1], from: "04:00", to: "07:00" },
    ]);
    expect(b.sunday).toEqual([{ from: "23:00:00", to: "24:00:00" }]);
    expect(b.monday).toEqual([{ from: "00:00:00", to: "07:00:00" }]);
  });

  it("same from and to means all day; ending at midnight adds nothing the next day", () => {
    const b = rulesToBlocks([
      { days: [6], from: "00:00", to: "00:00" },
      { days: [3], from: "20:00", to: "00:00" },
    ]);
    expect(b.saturday).toEqual([{ from: "00:00:00", to: "24:00:00" }]);
    expect(b.wednesday).toEqual([{ from: "20:00:00", to: "24:00:00" }]);
    expect(b.thursday).toEqual([]);
  });
});

describe("blocksToRules", () => {
  it("round-trips overnight and daytime rules", () => {
    const rules = [
      { days: [1, 2, 3, 4, 5], from: "22:00", to: "06:00" },
      { days: [6, 7], from: "10:00", to: "14:00" },
    ];
    expect(blocksToRules(rulesToBlocks(rules))).toEqual(rules);
  });

  it("reads blocks made in HA's own editor", () => {
    expect(blocksToRules({ friday: [{ from: "01:00:00", to: "05:30:00" }], monday: [{ from: "18:00:00", to: "24:00:00" }] })).toEqual([
      { days: [1], from: "18:00", to: "00:00" },
      { days: [5], from: "01:00", to: "05:30" },
    ]);
  });
});

describe("findCharging", () => {
  const car = [
    ent("sensor.tesla_battery", "Tesla Battery", { dc: "battery", u: "%", st: "64" }),
    ent("switch.tesla_charge", "Tesla Charge"),
    ent("switch.tesla_charge_port_door", "Tesla Charge port door"),
    ent("number.tesla_charge_limit", "Tesla Charge limit", { u: "%", st: "80" }),
    ent("time.tesla_scheduled_charging", "Tesla Scheduled charging", { st: "22:00:00" }),
    ent("switch.tesla_sentry_mode", "Tesla Sentry mode"),
  ];
  const charger = [
    ent("switch.easee_charger_enabled", "Easee Charger enabled", { d: "easee", dn: "Easee Home", m: "Easee", mo: "Home" }),
    ent("sensor.easee_power", "Easee Power", { d: "easee", dn: "Easee Home", m: "Easee", mo: "Home" }),
    ent("number.easee_max_current", "Easee Max current", { d: "easee", dn: "Easee Home", m: "Easee", mo: "Home", u: "A", st: "16" }),
  ];
  const ha = [
    ent("automation.ladda_billigt", "Ladda bilen billigt", { d: null, dn: null, m: null, mo: null }),
    ent("schedule.familjetavla_laddning_tesla", "Familjetavla laddning Tesla", { d: null, dn: null, m: null, mo: null }),
    ent("automation.godnatt", "Godnatt", { d: null, dn: null, m: null, mo: null }),
  ];

  it("finds the charge switch, limit, charger settings and existing plans", () => {
    const f = findCharging([...car, ...charger, ...ha], car, ["schedule.familjetavla_laddning_tesla"]);
    expect(f.targets).toEqual(["switch.tesla_charge", "switch.easee_charger_enabled"]);
    expect(f.limit).toBe("number.tesla_charge_limit");
    expect(f.settings).not.toContain("time.tesla_scheduled_charging");
    expect(f.settings).toEqual(["number.easee_max_current"]);
    expect(f.existing).toEqual(["automation.ladda_billigt"]);
  });
});

describe("automation", () => {
  it("is built and read back", () => {
    const a = buildAutomation({ name: "Tesla" }, "schedule.familjetavla_laddning_tesla", "switch.tesla_charge", { entityId: "number.tesla_charge_limit", value: 80 });
    expect(a.id).toBe("familjetavla_laddning_tesla");
    expect(parseAutomation(a)).toEqual({ target: "switch.tesla_charge", limit: 80, limitEntity: "number.tesla_charge_limit" });
  });
});
