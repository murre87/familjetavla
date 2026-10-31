import { describe, expect, it } from "vitest";
import { energyLive, energyNow, energyToday, increase, liveEnergyIds } from "./energy.js";
import type { HaState } from "./connectors/ha.js";
import { discover, type HaEntityInfo } from "./discovery.js";

const st = (entity_id: string, state: string, unit: string): HaState => ({ entity_id, state, attributes: { unit_of_measurement: unit }, last_changed: "" });

describe("energy now", () => {
  it("house = sun + bought − sold, like a real home with SolarEdge and Tibber Pulse", () => {
    const states = new Map([st("sensor.solar", "128", "W"), st("sensor.pulse", "425", "W"), st("sensor.pulse_prod", "0", "W")].map((s) => [s.entity_id, s]));
    expect(energyNow({ solar: "sensor.solar", grid: "sensor.pulse", gridExport: "sensor.pulse_prod" }, states)).toEqual({ solarKw: 0.13, gridKw: 0.43, houseKw: 0.56, selfUseKw: 0.13 });
  });
  it("selling: the grid goes negative and only the rest of the sun is used at home", () => {
    const states = new Map([st("sensor.solar", "5.2", "kW"), st("sensor.pulse", "0", "W"), st("sensor.pulse_prod", "3800", "W")].map((s) => [s.entity_id, s]));
    expect(energyNow({ solar: "sensor.solar", grid: "sensor.pulse", gridExport: "sensor.pulse_prod" }, states)).toEqual({ solarKw: 5.2, gridKw: -3.8, houseKw: 1.4, selfUseKw: 1.4 });
  });
  it("a home's own consumption sensor that is only the bought power does not hide the sun", () => {
    // Tibber Effekt is 0 while selling; a template copying it says the house uses nothing.
    const states = new Map([st("sensor.solar", "4000", "W"), st("sensor.pulse", "0", "W"), st("sensor.pulse_prod", "2500", "W"), st("sensor.tpl", "0", "kW")].map((s) => [s.entity_id, s]));
    expect(energyNow({ solar: "sensor.solar", grid: "sensor.pulse", gridExport: "sensor.pulse_prod", house: "sensor.tpl" }, states).houseKw).toBe(1.5);
    // Without a solar sensor the house sensor is used.
    expect(energyNow({ grid: "sensor.pulse", house: "sensor.tpl" }, states).houseKw).toBe(0);
  });
  it("live: the flow and the battery, and only power sensors move it (not the kWh meters)", () => {
    const states = new Map([st("sensor.solar", "2000", "W"), st("sensor.pulse", "500", "W"), st("sensor.bat", "64", "%")].map((s) => [s.entity_id, s]));
    const e = { solar: "sensor.solar", grid: "sensor.pulse", battery: "sensor.bat", importEnergy: "sensor.meter" };
    expect(energyLive(e, states)).toEqual({ solarKw: 2, gridKw: 0.5, houseKw: 2.5, selfUseKw: 2, batteryPct: 64 });
    expect(liveEnergyIds(e)).toEqual(["sensor.solar", "sensor.pulse", "sensor.bat"]);
  });
});

describe("home battery", () => {
  it("a discharging battery is counted in the house (real home: Sigenergy and Tibber Pulse at night)", () => {
    // Sigenergy reports charging as plus: −2.1 kW is the battery giving 2.1 kW to the house.
    const states = new Map([st("sensor.pv", "0", "kW"), st("sensor.grid", "1.3", "kW"), st("sensor.bat_p", "-2.1", "kW")].map((s) => [s.entity_id, s]));
    const e = { solar: "sensor.pv", grid: "sensor.grid", batteryPower: "sensor.bat_p", batteryChargePositive: true };
    expect(energyNow(e, states)).toEqual({ solarKw: 0, gridKw: 1.3, houseKw: 3.4, selfUseKw: 0, batteryKw: 2.1 });
  });
  it("a charging battery takes from the sun, not from the house (Home Assistant sign: plus = discharge)", () => {
    const states = new Map([st("sensor.pv", "4000", "W"), st("sensor.grid", "0", "W"), st("sensor.bat_p", "-3000", "W")].map((s) => [s.entity_id, s]));
    expect(energyNow({ solar: "sensor.pv", grid: "sensor.grid", batteryPower: "sensor.bat_p" }, states)).toEqual({ solarKw: 4, gridKw: 0, houseKw: 1, selfUseKw: 1, batteryKw: -3 });
  });
  it("a meter and a battery without sun still count the house", () => {
    const states = new Map([st("sensor.grid", "500", "W"), st("sensor.bat_p", "1.5", "kW"), st("sensor.tpl", "0.5", "kW")].map((s) => [s.entity_id, s]));
    expect(energyNow({ grid: "sensor.grid", batteryPower: "sensor.bat_p", house: "sensor.tpl" }, states).houseKw).toBe(2);
  });
  it("the battery power moves the live flow", () => {
    expect(liveEnergyIds({ grid: "sensor.grid", battery: "sensor.bat", batteryPower: "sensor.bat_p" })).toEqual(["sensor.grid", "sensor.bat", "sensor.bat_p"]);
  });
  it("today: what the battery gave back is consumption that was not bought", () => {
    const t = (h: number) => new Date(2026, 9, 30, h).getTime();
    const series = {
      "sensor.pv_day": [{ t: t(0), v: 0 }, { t: t(23), v: 0.68 }],
      "sensor.in_day": [{ t: t(0), v: 0 }, { t: t(23), v: 14.82 }],
      "sensor.out_day": [{ t: t(0), v: 0 }, { t: t(23), v: 0.83 }],
      "sensor.bat_in": [{ t: t(0), v: 0 }, { t: t(23), v: 3.68 }],
      "sensor.bat_out": [{ t: t(0), v: 0 }, { t: t(23), v: 7.22 }],
    };
    const e = { solarEnergy: "sensor.pv_day", importEnergy: "sensor.in_day", exportEnergy: "sensor.out_day", batteryChargeEnergy: "sensor.bat_in", batteryDischargeEnergy: "sensor.bat_out" };
    const r = energyToday(e, series, {}, [], (p) => p);
    // 0.68 + 14.82 − 0.83 + 7.22 − 3.68 = 18.21 kWh, the same as Sigenergy's own "load consumption".
    expect(r).toMatchObject({ houseKwh: 18.21, batteryChargeKwh: 3.68, batteryDischargeKwh: 7.22, selfSufficiencyPct: 19 });
  });
});

describe("energy today", () => {
  const t = (h: number, m = 0) => new Date(2026, 9, 20, h, m).getTime();
  it("counts a lifetime meter and a counter that restarts at midnight the same way", () => {
    expect(increase([{ t: t(0), v: 56079.4 }, { t: t(8), v: 56090 }, { t: t(14), v: 56103.0 }])).toBeCloseTo(23.6, 1);
    expect(increase([{ t: t(0), v: 21.4 }, { t: t(0, 1), v: 0.2 }, { t: t(14), v: 23.6 }])).toBeCloseTo(23.6, 1);
  });
  it("a short glitch to 0 is not counted twice (real home: 57.5 kWh instead of 31.9)", () => {
    const pts = [{ t: t(0), v: 0 }, { t: t(12), v: 20 }, { t: t(18, 40), v: 25.6 }, { t: t(18, 41), v: 0 }, { t: t(18, 43), v: 25.7 }, { t: t(21), v: 31.9 }];
    expect(increase(pts)).toBeCloseTo(31.9, 1);
  });
  it("a day that passes yesterday's total still counts from midnight", () => {
    expect(increase([{ t: t(0), v: 30 }, { t: t(0, 1), v: 0.1 }, { t: t(0, 20), v: 0.5 }, { t: t(21), v: 35 }])).toBeCloseTo(35, 1);
  });
  it("hourly counters restart every hour, small corrections count nothing", () => {
    expect(increase([{ t: t(9, 50), v: 1.8 }, { t: t(10, 0), v: 0 }, { t: t(10, 20), v: 2 }, { t: t(10, 59), v: 3 }, { t: t(11, 1), v: 0.1 }])).toBeCloseTo(3.1, 1);
    expect(increase([{ t: t(9), v: 10 }, { t: t(10), v: 9.99 }, { t: t(11), v: 11 }])).toBeCloseTo(1, 1);
  });
  it("gives consumption, own solar use, self-sufficiency and cost", () => {
    const series = {
      "sensor.sol": [{ t: t(0), v: 55982453 }, { t: t(14), v: 55996176 }],
      "sensor.in": [{ t: t(0), v: 56079.431 }, { t: t(1), v: 56081.431 }, { t: t(14), v: 56103.031 }],
      "sensor.out": [{ t: t(0), v: 41665.478 }, { t: t(14), v: 41670.19 }],
    };
    const prices = Array.from({ length: 24 }, (_, h) => ({ start: new Date(t(h)), price: 1 }));
    const r = energyToday({ solarEnergy: "sensor.sol", importEnergy: "sensor.in", exportEnergy: "sensor.out" }, series, { "sensor.sol": "Wh", "sensor.in": "kWh", "sensor.out": "kWh" }, prices, (p) => p);
    expect(r).toMatchObject({ solarKwh: 13.72, importKwh: 23.6, exportKwh: 4.71, houseKwh: 32.61, selfUseKwh: 9.01, selfSufficiencyPct: 28 });
    expect(r?.costKr).toBe(24);
  });
});

describe("energy discovery", () => {
  it("finds Tibber Pulse bought/sold power and the meter readings", () => {
    const e = (id: string, n: string, d: string, m: string, dc: string | null, u: string, st: string): HaEntityInfo => ({ e: id, n, a: null, d, dn: null, m, mo: null, dc, u, st, lu: "" });
    const d = discover([
      e("sensor.ac_power", "Solaredge-modbus AC Power", "inv", "SolarEdge", "power", "W", "128"),
      e("sensor.ac_energy", "Solaredge-modbus AC Energy", "inv", "SolarEdge", "energy", "kWh", "55996.176"),
      e("sensor.pulse_effekt", "Tibber Pulse Malmgatan 34 Effekt", "pulse", "Tibber", "power", "W", "425"),
      e("sensor.pulse_max", "Tibber Pulse Malmgatan 34 Max effekt", "pulse", "Tibber", "power", "W", "8399"),
      e("sensor.elproduktion", "Elproduktion", "pulse", "Tibber", "power", "W", "0"),
      e("sensor.pulse_meter_in", "Tibber Pulse Malmgatan 34 Senaste mätarförbrukning", "pulse", "Tibber", "energy", "kWh", "56103.031"),
      e("sensor.pulse_meter_out", "Tibber Pulse Malmgatan 34 Senaste mätarproduktion", "pulse", "Tibber", "energy", "kWh", "41670.19"),
      e("sensor.pulse_hour", "Tibber Pulse Malmgatan 34 Ackumulerad förbrukning under aktuell timme", "pulse", "Tibber", "energy", "kWh", "0.6"),
    ]);
    expect(d.energy).toMatchObject({ solar: "sensor.ac_power", grid: "sensor.pulse_effekt", gridExport: "sensor.elproduktion", solarEnergy: "sensor.ac_energy", importEnergy: "sensor.pulse_meter_in", exportEnergy: "sensor.pulse_meter_out" });
  });
  it("never suggests the home's own templates and helpers, only real meters", () => {
    const e = (id: string, n: string, d: string | null, dc: string | null, u: string, st: string, o = false): HaEntityInfo => ({ e: id, n, a: null, d, dn: null, m: d ? "Tibber" : null, mo: null, dc, u, st, lu: "", o });
    const d = discover([
      e("sensor.husets_forbrukning", "Husets förbrukning", null, "power", "kW", "0.42", true),
      e("sensor.elnetto", "Elnetto grid", null, "power", "W", "417", true),
      e("sensor.smartbox_elpris", "Smartbox Elpris", null, null, "kr/kWh", "0.72", true),
      e("sensor.pulse_effekt", "Tibber Pulse Effekt", "pulse", "power", "W", "417"),
      e("sensor.nordpool", "nordpool", null, null, "SEK/kWh", "0.90"),
    ]);
    expect(d.energy.grid).toBe("sensor.pulse_effekt");
    expect(d.energy.house).toBeUndefined();
    expect(d.priceSensors.map((p) => p.entityId)).toEqual(["sensor.nordpool"]);
  });
});
