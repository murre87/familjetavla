import { describe, expect, it } from "vitest";
import { configSchema } from "./routes.js";
import { defaultConfig } from "./store.js";

describe("config from Home Assistant", () => {
  it("shortens long friendly names instead of refusing to save", () => {
    const cfg = defaultConfig();
    const long = "Temperatur vardagsrum (Aqara sensor) övervåningen";
    cfg.entities.temps = [{ name: long, entityId: "sensor.t1" }];
    cfg.entities.graphs = [
      { title: "Effekt", series: [{ name: "Hus", entityId: "sensor.house", color: "#f1f2fa" }] },
      { title: "Temperatur", series: [{ name: long, entityId: "sensor.t1", color: "#f5c84b" }] },
    ];
    const r = configSchema.safeParse(cfg);
    expect(r.success, r.success ? "" : r.error.message).toBe(true);
    if (!r.success) return;
    const name = r.data.entities.graphs[1].series[0].name;
    expect(name.length).toBeLessThanOrEqual(30);
    expect(name.startsWith("Temperatur vardagsrum")).toBe(true);
    expect(r.data.entities.temps[0].name.length).toBeLessThanOrEqual(40);
  });
});

describe("Snabbknappar (#101)", () => {
  it("keeps where each button shows, and a button without a choice still saves", () => {
    const cfg = defaultConfig();
    cfg.entities.buttons = [
      { name: "Godnatt", entityId: "scene.godnatt", style: "blue" },
      { name: "Roger hem", entityId: "script.ak_hem_roger", style: "plain", place: "household" },
      { name: "Hemma", entityId: "script.hemma", style: "accent", place: "home" },
    ];
    const r = configSchema.safeParse(cfg);
    expect(r.success, r.success ? "" : r.error.message).toBe(true);
    if (!r.success) return;
    expect(r.data.entities.buttons.map((b) => b.place)).toEqual([undefined, "household", "home"]);
  });

  it("refuses a place that does not exist", () => {
    const cfg = defaultConfig();
    cfg.entities.buttons = [{ name: "X", entityId: "script.x", style: "plain", place: "garage" as never }];
    expect(configSchema.safeParse(cfg).success).toBe(false);
  });

  it("has the start-page card on from the start", () => {
    expect(defaultConfig().dashboard.home.find((w) => w.id === "buttons")?.on).toBe(true);
  });
});
