import { describe, expect, it } from "vitest";
import type { HaState } from "./connectors/ha.js";
import { findAutoModes, findSmartCharging, parseMorning, parseSchedule, parseSlots } from "./smartcharging.js";

const st = (id: string, state: string, attributes: Record<string, unknown> = {}): HaState => ({ entity_id: id, state, attributes, last_changed: "2026-10-23T10:00:00Z" });
const slots = [
  { start: "2026-10-24T23:45+02:00", end: "2026-10-25T00:45+02:00", kw: 11 },
  { start: "2026-10-25T02:15+02:00", end: "2026-10-25T02:45+02:00", kw: 10.5 },
];
const world = new Map<string, HaState>(
  [
    st("sensor.tesla_model_y_laddplan", "Planerad 23:45", { slots, soc_after_plan: 100, planned_kwh: 49.4, source: "EnergyWizard" }),
    st("input_select.tesla_model_y_laddlage", "Auto", { options: ["Auto", "Ladda nu", "Pausa"] }),
    st("sensor.nissan_leaf_laddplan", "Ingen plan", { slots: [] }),
    st("input_select.nissan_leaf_laddlage", "Pausa", { options: ["Auto", "Ladda nu", "Pausa"] }),
    st("sensor.tesla_battery", "41"),
  ].map((s) => [s.entity_id, s]),
);

describe("smart charging", () => {
  it("matches plan and mode to the right car by name", () => {
    const t = findSmartCharging(world, "Tesla Model Y")!;
    expect(t.planEntity).toBe("sensor.tesla_model_y_laddplan");
    expect(t.modeEntity).toBe("input_select.tesla_model_y_laddlage");
    expect(t.slots).toHaveLength(2);
    expect(t.nowOption).toBe("Ladda nu");
    expect(t.pauseOption).toBe("Pausa");
    expect(t.autoOption).toBe("Auto");
    expect(t.socAfter).toBe(100);
    const n = findSmartCharging(world, "Nissan Leaf")!;
    expect(n.modeEntity).toBe("input_select.nissan_leaf_laddlage");
    expect(n.mode).toBe("Pausa");
    expect(n.slots).toEqual([]);
  });

  it("does not guess when several cars could match", () => {
    expect(findSmartCharging(world, "Volvo")).toBeUndefined();
  });

  it("uses the only smart-charging entities for the only car, and understands English options", () => {
    const one = new Map<string, HaState>([
      ["sensor.ev_plan", st("sensor.ev_plan", "Charging now", { slots })],
      ["select.ev_charge_mode", st("select.ev_charge_mode", "Auto", { options: ["Auto", "Charge now", "Pause"] })],
    ]);
    const c = findSmartCharging(one, "Min bil")!;
    expect(c.nowOption).toBe("Charge now");
    expect(c.pauseOption).toBe("Pause");
  });

  it("ignores broken slots", () => {
    expect(parseSlots([{ start: "x", end: "y" }, { start: "2026-10-24T10:00:00Z", end: "2026-10-24T09:00:00Z" }, { start: "2026-10-24T10:00:00Z", end: "2026-10-24T11:00:00Z", kw: "7" }])).toEqual([{ start: "2026-10-24T10:00:00Z", end: "2026-10-24T11:00:00Z", kw: 7 }]);
    expect(parseSlots("nej")).toEqual([]);
  });

  it("returns nothing without any smart-charging entities", () => {
    expect(findSmartCharging(new Map([["sensor.tesla_battery", st("sensor.tesla_battery", "41")]]), "Tesla")).toBeUndefined();
  });

  it("finds Auto-first mode selectors for heat, hot water and spa, not the car modes", () => {
    const w = new Map<string, HaState>(
      [
        st("input_select.energywizard_varme", "Auto", { options: ["Auto", "Varm", "Sänkt"], friendly_name: "EnergyWizard varme" }),
        st("input_select.energywizard_spabad", "Eco", { options: ["Auto", "Värm nu", "Eco"], friendly_name: "Spabad läge" }),
        st("input_select.tesla_model_y_laddlage", "Auto", { options: ["Auto", "Ladda nu", "Pausa"] }),
        st("select.fan_speed", "Low", { options: ["Low", "High"] }),
        st("input_select.heat_style", "Cozy", { options: ["Cozy", "Auto"] }),
      ].map((x) => [x.entity_id, x]),
    );
    const modes = findAutoModes(w);
    expect(modes.map((m) => m.entityId)).toEqual(["input_select.energywizard_varme", "input_select.spabad".replace("spabad", "energywizard_spabad")]);
    expect(modes.find((m) => m.entityId.endsWith("spabad"))).toMatchObject({ name: "Spabad", mode: "Eco" });
  });

  it("reads the weekly charge schedule and the command field for changing it", () => {
    const sched = Array.from({ length: 7 }, (_, d) => ({ day: d, time: "07:00", soc: 80, enabled: d < 5 }));
    const w = new Map<string, HaState>(
      [
        st("sensor.tesla_model_y_laddplan", "Planerad 23:45", { slots, schedule: sched, schedule_car: "tesla" }),
        st("input_select.tesla_model_y_laddlage", "Auto", { options: ["Auto", "Ladda nu", "Pausa"] }),
        st("input_text.energywizard_laddschema_kommando", "", {}),
      ].map((x) => [x.entity_id, x]),
    );
    const c = findSmartCharging(w, "Tesla MY")!;
    expect(c.schedule).toHaveLength(7);
    expect(c.schedule![0]).toEqual({ day: 0, time: "07:00", soc: 80, enabled: true });
    expect(c.scheduleCar).toBe("tesla");
    expect(c.scheduleEntity).toBe("input_text.energywizard_laddschema_kommando");
    expect(parseSchedule([{ day: 9, time: "07:00" }, { day: 1, time: "bad" }])).toBeUndefined();
  });
});

describe("laddplan med batterinivå per block och morgonkontroll", () => {
  it("läser soc_start/soc_end per block och ignorerar dem när bara det ena finns", () => {
    const r = parseSlots([
      { start: "2026-10-26T01:00+01:00", end: "2026-10-26T02:30+01:00", kw: 8, soc_start: 32, soc_end: 46.4 },
      { start: "2026-10-26T05:30+01:00", end: "2026-10-26T06:00+01:00", kw: 6.4, soc_start: 46 },
    ]);
    expect(r[0]).toMatchObject({ socStart: 32, socEnd: 46 });
    expect(r[1].socStart).toBeUndefined();
  });
  it("morning_check: ok när batteriet når golvet, annars inte", () => {
    expect(parseMorning({ time: "06:00", soc: 50, min: 50 })).toEqual({ time: "06:00", soc: 50, min: 50, ok: true });
    expect(parseMorning({ time: "06:00", soc: 44, min: 50 })?.ok).toBe(false);
    expect(parseMorning({ time: "6", soc: 44, min: 50 })).toBeUndefined();
    expect(parseMorning("x")).toBeUndefined();
  });
  it("hittas på laddplanen", () => {
    const w = new Map<string, HaState>([
      ["sensor.tesla_model_y_laddplan", st("sensor.tesla_model_y_laddplan", "Planerad 00:15", { slots, morning_check: { time: "06:00", soc: 50, min: 50 } })],
    ]);
    expect(findSmartCharging(w, "Tesla Model Y")?.morning?.ok).toBe(true);
  });
});
