import { describe, expect, it } from "vitest";
import { guessArea, matchWasteProvider } from "./connectors/geo.js";
import { detectGroups, filterEvents, type CalEvent } from "./connectors/ics.js";
import { visibleOn } from "./dashboard.js";
import { pricesFromAttributes } from "./providers/price.js";
import { expandManual } from "./providers/waste.js";
import type { SourcedEvent } from "./sources.js";
import type { Person } from "./types.js";

const ev = (title: string, extra: Partial<CalEvent> = {}): CalEvent => ({
  start: new Date(2026, 9, 20, 17),
  end: new Date(2026, 9, 20, 18),
  allDay: false,
  title,
  ...extra,
});

describe("team filter", () => {
  const feed = [ev("P14 Blå – Träning"), ev("P14 Blå – Match mot IFK"), ev("F12 – Träning"), ev("F12 – Match"), ev("Föräldramöte")];

  it("detects teams from title prefixes", () => {
    expect(detectGroups(feed).map((g) => g.name)).toEqual(["P14 Blå", "F12"]);
  });

  it("detects teams from CATEGORIES", () => {
    const withCats = [ev("Träning", { categories: ["Flickor 2014"] }), ev("Match", { categories: ["Flickor 2014"] }), ev("Träning", { categories: ["Futsal"] }), ev("Cup", { categories: ["Futsal"] })];
    expect(detectGroups(withCats).map((g) => g.name).sort()).toEqual(["Flickor 2014", "Futsal"]);
  });

  it("keeps only the chosen team and drops excluded words", () => {
    expect(filterEvents(feed, ["p14"]).length).toBe(2);
    expect(filterEvents(feed, [], ["föräldramöte"]).length).toBe(4);
    expect(filterEvents(feed, ["f12"], ["match"]).map((e) => e.title)).toEqual(["F12 – Träning"]);
  });
});

describe("custody visibility", () => {
  const child: Person = { id: "a", name: "Ella", color: "#5ab8ff", kind: "child", custody: { mode: "oddWeeks" } };
  const people = new Map([[child.id, child]]);
  const evenWeekDay = new Date(2026, 9, 14); // v42 – at the other home
  const base = { ...ev("Träning"), sourceId: "c", personId: "a", category: "sport" as const };

  it("hides training on the other parent's week but shows matches", () => {
    expect(visibleOn(base as SourcedEvent, people, evenWeekDay)).toBe(false);
    expect(visibleOn({ ...base, ignoreCustody: true } as SourcedEvent, people, evenWeekDay)).toBe(true);
    expect(visibleOn(base as SourcedEvent, people, new Date(2026, 9, 21))).toBe(true);
  });
});

describe("manual waste schedule", () => {
  it("repeats from a past first date and respects months", () => {
    const rows = [
      { type: "Matavfall", firstDate: "2026-01-06", everyWeeks: 2 },
      { type: "Trädgård", firstDate: "2026-04-01", everyWeeks: 2, months: [4, 5, 6, 7, 8, 9] },
    ];
    const out = expandManual(rows, new Date(2026, 9, 18), new Date(2026, 10, 18));
    expect(out.every((p) => p.type === "Matavfall")).toBe(true);
    expect(out.map((p) => p.date.getDate())).toEqual([27, 10]) // 6 jan + 21×14 dagar = 27 okt;
  });
});

describe("electricity area", () => {
  it.each([
    ["Luleå", 65.58, 22.15, "SE1"],
    ["Piteå", 65.32, 21.48, "SE1"],
    ["Skellefteå", 64.75, 20.95, "SE2"],
    ["Söderhamn", 61.3, 17.06, "SE2"],
    ["Mora", 61.0, 14.54, "SE3"],
    ["Gävle", 60.67, 17.14, "SE3"],
    ["Stockholm", 59.33, 18.07, "SE3"],
    ["Varberg", 57.1, 12.25, "SE3"],
    ["Falkenberg", 56.9, 12.49, "SE4"],
    ["Malmö", 55.6, 13.0, "SE4"],
  ])("%s → %s", (_n, lat, lon, area) => {
    expect(guessArea(lat as number, lon as number)).toBe(area);
  });

  it("matches municipality to waste provider", () => {
    expect(matchWasteProvider("Lunds kommun")).toBe("lund");
    expect(matchWasteProvider("Växjö kommun")).toBe("ssam");
    expect(matchWasteProvider("Stockholms kommun")).toBeUndefined();
  });
});

describe("HA price sensor", () => {
  it("reads Nordpool raw_today", () => {
    const raw = Array.from({ length: 24 }, (_, h) => ({ start: new Date(2026, 9, 18, h).toISOString(), value: h / 10 }));
    const p = pricesFromAttributes({ raw_today: raw }, "SEK/kWh", new Date(2026, 9, 18));
    expect(p).toHaveLength(24);
    expect(p[5].price).toBeCloseTo(0.5);
  });

  it("reads öre arrays", () => {
    const p = pricesFromAttributes({ today: Array.from({ length: 24 }, () => 100) }, "öre/kWh", new Date(2026, 9, 18));
    expect(p[0].price).toBeCloseTo(1);
  });
});

describe("custody overrides and swap calendar", () => {
  it("override wins over the base rule", async () => {
    const { isHome } = await import("./custody.js");
    const c = {
      mode: "alternating" as const,
      anchorDate: "2026-10-19",
      overrides: [{ from: "2026-10-31", to: "2026-11-01", home: true }],
    };
    expect(isHome(c, new Date(2026, 9, 31))).toBe(true); // would be away (v44)
    expect(isHome(c, new Date(2026, 9, 30))).toBe(false); // fredag v44, utanför undantaget
  });

  it("swap calendar events become overrides", async () => {
    const { withSwapCalendar } = await import("./dashboard.js");
    const kid: Person = { id: "k", name: "Ella", color: "#fff", kind: "child", custody: { mode: "oddWeeks" } };
    const evs = [
      { ...ev("Ella"), allDay: true, start: new Date(2026, 9, 14), end: new Date(2026, 9, 15), sourceId: "swap", category: "family" as const },
      { ...ev("Ella borta"), allDay: true, start: new Date(2026, 9, 21), end: new Date(2026, 9, 22), sourceId: "swap", category: "family" as const },
    ];
    const [p] = withSwapCalendar([kid], evs);
    expect(p.custody?.overrides).toEqual([
      { from: "2026-10-14", to: "2026-10-14", home: true },
      { from: "2026-10-21", to: "2026-10-21", home: false },
    ]);
  });
});

describe("scheduler", () => {
  it("fires only enabled schedules at the exact minute and weekday", async () => {
    const { dueSchedules } = await import("./scheduler.js");
    const s = { id: "a", name: "Värme", entityId: "climate.car", action: "on" as const, days: [1, 2, 3, 4, 5], time: "06:40", enabled: true };
    expect(dueSchedules([s], new Date(2026, 9, 19, 6, 40))).toHaveLength(1); // måndag
    expect(dueSchedules([s], new Date(2026, 9, 18, 6, 40))).toHaveLength(0); // söndag
    expect(dueSchedules([{ ...s, enabled: false }], new Date(2026, 9, 19, 6, 40))).toHaveLength(0);
  });
});

describe("discovery", () => {
  it("finds a car, solar, spa and a Husdata heat pump card", async () => {
    const { discover } = await import("./discovery.js");
    const e = (x: Partial<import("./discovery.js").HaEntityInfo> & { e: string; n: string }) => ({ a: null, d: null, dn: null, m: null, mo: null, dc: null, u: null, st: "1", lu: new Date().toISOString(), ...x });
    const all = [
      e({ e: "sensor.leaf_battery", n: "Leaf Battery", d: "car", dn: "Nissan Leaf", m: "Nissan", dc: "battery", u: "%" }),
      e({ e: "sensor.leaf_range", n: "Leaf Range (AC Off)", d: "car", dn: "Nissan Leaf", m: "Nissan", u: "km" }),
      e({ e: "device_tracker.leaf", n: "Leaf", d: "car", dn: "Nissan Leaf", m: "Nissan", st: "home" }),
      e({ e: "climate.leaf_climate", n: "Leaf Climate", d: "car", dn: "Nissan Leaf", m: "Nissan" }),
      e({ e: "sensor.solaredge_current_power", n: "SolarEdge Current Power", d: "inv", m: "SolarEdge", dc: "power", u: "W" }),
      e({ e: "climate.spa", n: "Spa", d: "spa", dn: "Spabad", m: "Balboa" }),
      e({ e: "switch.spa_pump_1", n: "Spa Pump 1", d: "spa", dn: "Spabad", m: "Balboa" }),
      e({ e: "sensor.h60_indoor", n: "Värmepump Inomhus", d: "hp", dn: "Värmepump", m: "Husdata", dc: "temperature", u: "°C" }),
      e({ e: "sensor.h60_hot_water", n: "Värmepump Varmvatten", d: "hp", dn: "Värmepump", m: "Husdata", dc: "temperature", u: "°C" }),
      e({ e: "light.kok", n: "Kök tak", a: "Kök" }),
    ];
    const d = discover(all);
    expect(d.cars).toHaveLength(1);
    expect(d.cars[0]).toMatchObject({ name: "Nissan Leaf", battery: "sensor.leaf_battery", range: "sensor.leaf_range", climate: "climate.leaf_climate" });
    expect(d.energy.solar).toBe("sensor.solaredge_current_power");
    expect(d.climates).toEqual([{ name: "Spa", entityId: "climate.spa", controls: ["switch.spa_pump_1"] }]);
    expect(d.deviceCards[0]).toMatchObject({ title: "Värmepump", primary: "sensor.h60_indoor", sensors: ["sensor.h60_hot_water"] });
    expect(d.lightGroups).toEqual([{ name: "Kök", entities: ["light.kok"] }]);
  });
});

describe("design helpers", () => {
  it("picks an icon from title and calendar name", async () => {
    const { activityIcon } = await import("./dashboard.js");
    expect(activityIcon("F14 – Träning Fotboll F14", "sport")).toBe("ball");
    expect(activityIcon("Simträning", "sport")).toBe("swim");
    expect(activityIcon("Ellas kalas", "family")).toBe("cake");
    expect(activityIcon("Tandläkare", "family")).toBe("health");
    expect(activityIcon("Matavfall", "waste")).toBe("trash");
    expect(activityIcon("Något", "other")).toBe("event");
  });

  it("uses two letters when initials clash", async () => {
    const { initialsOf } = await import("./dashboard.js");
    const ps = [
      { id: "a", name: "Emil", color: "#000", kind: "adult" as const },
      { id: "b", name: "Ella", color: "#000", kind: "child" as const },
      { id: "c", name: "Leo", color: "#000", kind: "child" as const },
    ];
    const m = new Map(ps.map((p) => [p.id, p]));
    expect(ps.map((p) => initialsOf(p, m))).toEqual(["Em", "El", "L"]);
  });

  it("builds the Nu zone from the next timed events", async () => {
    const { buildNow } = await import("./dashboard.js");
    const now = new Date(2026, 9, 18, 17, 15);
    const evs = [
      { start: new Date(2026, 9, 18, 18), end: new Date(2026, 9, 18, 19), allDay: false, title: "Middag", sourceId: "f", category: "family" as const },
      { start: new Date(2026, 9, 19, 17, 30), end: new Date(2026, 9, 19, 19), allDay: false, title: "Fotboll", sourceId: "f", category: "sport" as const },
      { start: new Date(2026, 9, 18, 0), end: new Date(2026, 9, 19, 0), allDay: true, title: "Heldag", sourceId: "f", category: "family" as const },
    ];
    const n = buildNow(evs, new Map(), now);
    expect(n.headline).toBe("Om 45 min");
    expect(n.items.map((i) => [i.title, i.dayLabel])).toEqual([["Middag", "idag"], ["Fotboll", "imorgon"]]);
  });
});

import { legLabel, resolveTravel, travelKey, travelOptions, travelSummary, wantsTravel } from "./travel.js";

describe("dit/hem för barnens aktiviteter", () => {
  const people = new Map([
    ["emil", { id: "emil", name: "Emil", color: "#000", kind: "adult" as const }],
    ["ella", { id: "ella", name: "Ella", color: "#000", kind: "child" as const }],
  ]);
  const ev = { sourceId: "ella-sport", personId: "ella", start: new Date("2026-10-19T15:30:00Z"), end: new Date("2026-10-19T17:00:00Z"), allDay: false, title: "F14 – Träning", category: "sport" as const };

  it("gäller barnens egna aktiviteter, inte skollektioner", () => {
    expect(wantsTravel(ev, people)).toBe(true);
    expect(wantsTravel({ ...ev, sourceId: "school:x" }, people)).toBe(false);
    expect(wantsTravel({ ...ev, personId: "emil" }, people)).toBe(false);
  });

  it("listar vuxna först och sedan buss/skjuts", () => {
    expect(travelOptions(people).map((o) => o.label)).toEqual(["Emil skjutsar", "Annan skjutsar", "Buss", "Cyklar/går"]);
    expect(legLabel({ mode: "ride", by: "Saras pappa" }, people)).toBe("Saras pappa skjutsar");
  });

  it("eget val vinner över kalenderns standard", () => {
    const cal = { id: "ella-sport", name: "Fotboll F14", provider: "sportadmin" as const, kind: "ics" as const, category: "sport" as const, travel: { to: { mode: "bus" as const }, home: { mode: "bus" as const } } };
    const std = resolveTravel(ev, people, cal, {});
    expect(std.fromCalendar).toBe(true);
    expect(travelSummary(std)).toBe("Buss dit och hem");
    const own = resolveTravel(ev, people, cal, { [travelKey(ev)]: { to: { mode: "adult:emil" }, home: { mode: "bus" } } });
    expect(own.fromCalendar).toBe(false);
    expect(travelSummary(own)).toBe("Emil skjutsar dit · buss hem");
  });
});

describe("barn som bor här hela tiden", () => {
  it("ingen bytespåminnelse, men förskola med vem som lämnar och hämtar", async () => {
    const { buildReminders, buildCareEvents, careCalendars } = await import("./dashboard.js");
    const emil = { id: "emil", name: "Emil", color: "#c9a2ff", kind: "adult" as const };
    const leo = {
      id: "leo",
      name: "Leo",
      color: "#f5c84b",
      kind: "child" as const,
      custody: { mode: "always" as const },
      care: { name: "Förskola", days: { "1": "07:30-16:00", "5": "08:00-15:00" }, travel: { to: { mode: "adult:emil" as const } } },
    };
    const people = new Map<string, Person>([[emil.id, emil], [leo.id, leo]]);
    const monday = new Date("2026-10-19T00:00:00");
    // Vklass gives today's time, the guide's schedule the rest of the week.
    const care = buildCareEvents([...people.values()], [{ personId: "leo", text: "07:45 - 16:15" }], [], monday, 7);
    expect(care.map((e) => `${e.start.getDay()} ${e.start.getHours()}:${e.start.getMinutes()}`)).toEqual(["1 7:45", "5 8:0"]);
    const ctx = { saved: {}, calendars: new Map(careCalendars([...people.values()])) };
    const r = buildReminders(new Date("2026-10-19T07:00:00"), care, people, [], null, ctx);
    expect(r.map((x) => `${x.title} | ${x.sub}`)).toEqual(["Leo · förskola 07:45–16:15 | Emil lämnar"]);
  });

  it("varnar en vecka i förväg för planeringsdag och hoppar över den dagen", async () => {
    const { buildReminders, buildCareEvents } = await import("./dashboard.js");
    const leo = { id: "leo", name: "Leo", color: "#f5c84b", kind: "child" as const, care: { days: { "3": "07:30-16:00" } } };
    const people = new Map<string, Person>([[leo.id, leo]]);
    const closed: SourcedEvent = { ...ev("Förskolan stängd – planeringsdag", { allDay: true, start: new Date(2026, 9, 21), end: new Date(2026, 9, 22) }), sourceId: "kal", category: "school", personId: "leo" };
    const monday = new Date(2026, 9, 19);
    expect(buildCareEvents([leo], [], [closed], monday, 7)).toEqual([]);
    const r = buildReminders(new Date(2026, 9, 19, 9), [closed], people, [], null);
    expect(r[0].title).toBe("Leo · Förskolan stängd – planeringsdag ons 21 okt");
  });
});

describe("växelvis med olika rytm", () => {
  it("14-dagarsmönster 2-2-3 och varannan helg", async () => {
    const { CUSTODY_PRESETS, isHome } = await import("./custody.js");
    const p223 = CUSTODY_PRESETS.find((p) => p.id === "223")!.pattern;
    const c = { mode: "pattern" as const, pattern: p223, anchorDate: "2026-10-19" }; // vecka A börjar mån 19 okt
    const days = Array.from({ length: 14 }, (_, i) => isHome(c, new Date(2026, 9, 19 + i)));
    expect(days).toEqual(p223);
    // Samma mönster två veckor senare och före ankardatumet.
    expect(isHome(c, new Date(2026, 10, 2))).toBe(true);
    expect(isHome(c, new Date(2026, 9, 14))).toBe(p223[9]);
  });

  it("en rad per grupp när barnen byter olika dagar", async () => {
    const { buildCustodyCard } = await import("./dashboard.js");
    const kid = (id: string, handoverDay: 1 | 5) => ({ id, name: id, color: "#fff", kind: "child" as const, custody: { mode: "alternating" as const, anchorDate: "2026-10-19", handoverDay } });
    const now = new Date(2026, 9, 20, 12);
    const one = buildCustodyCard([kid("Ella", 1), kid("Leo", 1)], now)!;
    expect(one.rows).toBeUndefined();
    expect(one.headline).toBe("Ella och Leo är här");
    const two = buildCustodyCard([kid("Ella", 1), kid("Leo", 1), kid("Max", 5)], now)!;
    expect(two.rows!.map((r) => `${r.names}: ${r.text}`)).toEqual(["Max: här t.o.m. tor", "Ella och Leo: här t.o.m. sön"]);
  });
});

describe("skjutsval överlever flyttad tid", () => {
  it("nyckeln bygger på UID och datum", async () => {
    const { travelKey } = await import("./travel.js");
    const a = { sourceId: "fotboll", uid: "abc", start: new Date(2026, 9, 20, 17, 30) };
    expect(travelKey(a)).toBe(travelKey({ ...a, start: new Date(2026, 9, 20, 17, 45) }));
    expect(travelKey(a)).not.toBe(travelKey({ ...a, start: new Date(2026, 9, 27, 17, 30) }));
  });
});

describe("ansvar och påminnelser", () => {
  const emil = { id: "emil", name: "Emil", color: "#c9a2ff", kind: "adult" as const, notify: { service: "mobile_app_emil", before: 30, evening: true, weekly: true } };
  const anna = { id: "anna", name: "Anna", color: "#ff8fa3", kind: "adult" as const };
  const maja = { id: "maja", name: "Maja", color: "#34e0a1", kind: "child" as const, care: { name: "Förskola", days: { "1": "07:30-16:00", "2": "07:30-16:00" }, travel: { to: { mode: "adult:emil" as const } } } };
  const ella = { id: "ella", name: "Ella", color: "#5ab8ff", kind: "child" as const };
  const people = new Map<string, Person>([emil, anna, maja, ella].map((p) => [p.id, p]));
  const monday = new Date(2026, 9, 19);

  async function family() {
    const { buildCareEvents, careCalendars } = await import("./dashboard.js");
    const care = buildCareEvents([...people.values()], [], [], monday, 7);
    const training: SourcedEvent = { ...ev("F14 – Träning", { start: new Date(2026, 9, 19, 17, 30), end: new Date(2026, 9, 19, 19) }), sourceId: "fotboll", category: "sport", personId: "ella", uid: "t1" };
    const ctx = { saved: {}, calendars: new Map(careCalendars([...people.values()])) };
    return { events: [...care, training], ctx };
  }

  it("Planera veckan räknar det som saknar ansvarig", async () => {
    const { buildPlan } = await import("./plan.js");
    const { events, ctx } = await family();
    const plan = buildPlan(events, people, ctx, new Date(2026, 9, 19, 6), () => ({ time: "", title: "", color: "", who: "", category: "family", icon: "event" }));
    // Mån + tis förskola (hämtning saknas) och träningen (båda saknas)
    expect(plan.items.length).toBe(3);
    expect(plan.missing).toBe(3);
  });

  it("vuxnas ansvar med svenska formuleringar", async () => {
    const { duties } = await import("./plan.js");
    const { events, ctx } = await family();
    const list = duties(events, people, ctx, new Date(2026, 9, 19, 0), new Date(2026, 9, 21));
    expect(list.map((d) => `${d.personId}: ${d.text}`)).toEqual(["emil: Lämna Maja på förskolan 07:30", "emil: Lämna Maja på förskolan 07:30"]);
  });

  it("notis 30 min innan, kvällen innan och planera veckan på söndag", async () => {
    const { duties } = await import("./plan.js");
    const { dueNotifications } = await import("./notify.js");
    const { events, ctx } = await family();
    const list = duties(events, people, ctx, new Date(2026, 9, 18), new Date(2026, 9, 21));
    const at = (h: number, m: number, d = 19) => dueNotifications([emil, anna], list, 3, 1, new Date(2026, 9, d, h, m));
    // Den vanliga morgonlämningen är rutin – ingen notis …
    expect(at(7, 0)).toEqual([]);
    // … men när just den här morgonen är ändrad kommer den.
    const changed = duties(events, people, { ...ctx, saved: { "care:maja@care@2026-10-19": { to: { mode: "adult:emil" } } } }, new Date(2026, 9, 18), new Date(2026, 9, 21));
    expect(dueNotifications([emil, anna], changed, 0, 0, new Date(2026, 9, 19, 7, 0)).map((n) => `${n.title}: ${n.message}`)).toEqual(["Om 30 min: Lämna Maja på förskolan 07:30"]);
    expect(at(20, 0)[0].message).toBe("Lämna Maja på förskolan 07:30 · 1 sak imorgon saknar ansvarig");
    expect(at(19, 0, 18).map((n) => n.title)).toEqual(["Planera veckan"]); // söndag 18 okt
  });

  it("det som saknas på hyllan följer med lämningen i notisen, även den vanliga morgonen", async () => {
    const { duties } = await import("./plan.js");
    const { dueNotifications } = await import("./notify.js");
    const { events, ctx } = await family();
    const list = duties(events, people, ctx, new Date(2026, 9, 18), new Date(2026, 9, 21), { maja: ["Blöjor", "Extrakläder"] });
    expect(dueNotifications([emil, anna], list, 0, 0, new Date(2026, 9, 19, 7, 0)).map((n) => `${n.title}: ${n.message}`)).toEqual([
      "Om 30 min: Lämna Maja på förskolan 07:30 – ta med: blöjor, extrakläder",
    ]);
    expect(dueNotifications([emil, anna], list, 0, 0, new Date(2026, 9, 18, 20, 0))[0].message).toBe("Lämna Maja på förskolan 07:30 – ta med: blöjor, extrakläder");
    // A button in the notification ticks the shelf off from the phone.
    expect(dueNotifications([emil, anna], list, 0, 0, new Date(2026, 9, 19, 7, 0))[0].actions).toEqual([{ action: "FAMILJETAVLA_LAMNAT:maja", title: "Lämnat ✓" }]);
  });

  it("flyttad eller inställd träning till den som skjutsar – inte när någon annan tar skjutsen", async () => {
    const { dutyChanges } = await import("./notify.js");
    const now = new Date(2026, 9, 19, 12);
    const d = (at: Date, key = "fotboll@t1@2026-10-19") => ({ personId: "emil", at, text: `Skjutsa Ella till F14 – Träning ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`, key: `${key}:to`, leg: "to" as const, standard: false });
    const before = [d(new Date(2026, 9, 19, 17, 30))];
    const keys = new Set(["fotboll@t1@2026-10-19"]);
    expect(dutyChanges(before, [d(new Date(2026, 9, 19, 18, 0))], now, true, keys).map((c) => `${c.title}: ${c.message}`)).toEqual(["Ny tid: Skjutsa Ella till F14 – Träning mån 19 okt: nu 18:00 (var 17:30)"]);
    expect(dutyChanges(before, [], now, true, new Set()).map((c) => c.title)).toEqual(["Inställt?"]);
    // Still in the calendar, just nobody drives now (bus) → nothing.
    expect(dutyChanges(before, [], now, true, keys)).toEqual([]);
    // A calendar could not be read this time → never "cancelled".
    expect(dutyChanges(before, [], now, false, new Set())).toEqual([]);
  });

  it("morgonnotis 06:45 med dagens kom ihåg och det man själv ansvarar för", async () => {
    const { duties } = await import("./plan.js");
    const { dueNotifications, reminderLine } = await import("./notify.js");
    const { events, ctx } = await family();
    const list = duties(events, people, ctx, new Date(2026, 9, 19, 6), new Date(2026, 9, 21), { maja: ["Blöjor"] });
    const items = [{ text: reminderLine({ title: "Regn under dagen", sub: "Ta regnjackan" }) }, { text: reminderLine({ title: "Idrott tis – Ella", sub: "Tryck för detaljer" }), personId: "ella" }];
    const out = dueNotifications([emil, anna], list, 0, 0, new Date(2026, 9, 19, 6, 45), items);
    expect(out.map((n) => `${n.service}|${n.title}: ${n.message}`)).toEqual([
      "mobile_app_emil|Idag: Lämna Maja på förskolan 07:30 – ta med: blöjor · Regn under dagen – ta regnjackan · Idrott tis – Ella",
    ]);
    // Anna has no phone set – nothing for her. With a phone and no duties she still gets the day's list.
    const annaPhone = { ...anna, notify: { service: "mobile_app_anna" } };
    expect(dueNotifications([annaPhone], list, 0, 0, new Date(2026, 9, 19, 6, 45), items).map((n) => n.message)).toEqual(["Regn under dagen – ta regnjackan · Idrott tis – Ella"]);
    // A grown-up who follows only Maja: no Ella in the list – but still the own drop-off.
    const onlyMaja = { ...emil, notify: { ...emil.notify, children: ["maja"] } };
    expect(dueNotifications([onlyMaja], list, 0, 0, new Date(2026, 9, 19, 6, 45), items)[0].message).toBe("Lämna Maja på förskolan 07:30 – ta med: blöjor · Regn under dagen – ta regnjackan");
    const onlyElla = { ...emil, notify: { ...emil.notify, children: ["ella"] } };
    expect(dueNotifications([onlyElla], list, 0, 0, new Date(2026, 9, 19, 6, 45), items)[0].message).toBe("Lämna Maja på förskolan 07:30 – ta med: blöjor · Regn under dagen – ta regnjackan · Idrott tis – Ella");
    // Off when the grown-up turned it off.
    expect(dueNotifications([{ ...emil, notify: { ...emil.notify, morning: "" } }], list, 0, 0, new Date(2026, 9, 19, 6, 45), items)).toEqual([]);
  });

  it("kalenderlänken är giltig ICS med påminnelse", async () => {
    const { dutiesIcs } = await import("./plan.js");
    const { parseIcs } = await import("./connectors/ics.js");
    const ics = dutiesIcs("Emil", [{ personId: "emil", at: new Date(2026, 9, 19, 16), text: "Hämta Maja på förskolan 16:00", key: "care:maja@care@2026-10-19:home" }], 30);
    expect(ics).toContain("TRIGGER:-PT30M");
    const evs = parseIcs(ics, new Date(2026, 9, 19), new Date(2026, 9, 20));
    expect(evs.map((e) => `${e.title} ${e.start.getHours()}`)).toEqual(["Hämta Maja på förskolan 16"]);
  });
});

describe("veckans mat", () => {
  it("lägger skollunch på rätt dag och slår ihop barn med samma meny", async () => {
    const { buildMeals, menuDate } = await import("./meals.js");
    const sun = new Date(2026, 9, 18, 19);
    expect(menuDate("Måndag 19/10", sun)?.getDate()).toBe(19);
    // Vklass utan datum: bara innevarande vecka – söndag kväll blir "Tisdag" förra tisdagen (13), aldrig imorgon.
    expect(menuDate("Tisdag", sun)?.getDate()).toBe(13);
    expect(menuDate("Måndag", new Date(2026, 9, 21))?.getDate()).toBe(19); // onsdag: denna veckas måndag
    expect(menuDate("Tisdag vecka 43", sun)?.getDate()).toBe(20);
    expect(menuDate("Måndag v1", new Date(2026, 11, 30))?.toDateString()).toBe(new Date(2027, 0, 4).toDateString());
    expect(menuDate("Fredag 2/1", new Date(2026, 11, 30))?.getFullYear()).toBe(2027);
    const meals = buildMeals(
      [
        { child: "Maja", day: "Måndag 19/10", dishes: ["Pannkakor med sylt"] },
        { child: "Nils", day: "Måndag 19/10", dishes: ["Pannkakor med sylt"] },
        { child: "Nils", day: "Tisdag 20/10", dishes: ["Fiskgratäng"] },
      ],
      { "2026-10-19": "Tacos" },
      sun,
    );
    expect(meals.length).toBe(7);
    expect(meals[1]).toEqual({ dayKey: "2026-10-19", dayLabel: "imorgon", dinner: "Tacos", lunch: [{ child: "Maja och Nils", dishes: ["Pannkakor med sylt"] }] });
    expect(meals[2].lunch[0].child).toBe("Nils");
  });

  it("varnar när middagen är samma som lunchen", async () => {
    const { sameAsLunch } = await import("./meals.js");
    const { dinnerReminder } = await import("./dashboard.js");
    const lunch = [{ dishes: ["Pannkakor med sylt"] }];
    expect(sameAsLunch("Pannkakor och bacon", lunch)).toBe("Pannkakor med sylt");
    expect(sameAsLunch("Tacos", lunch)).toBeNull();
    // Tillbehör räknas inte: potatis, sallad, pasta …
    expect(sameAsLunch("Kyckling med ugnsrostad potatis och sallad", [{ dishes: ["Stekt fisk med kokt potatis och sallad"] }])).toBeNull();
    expect(sameAsLunch("Lasagne", [{ dishes: ["Lasagne med sallad"] }])).toBe("Lasagne med sallad");
    const day = { dayKey: "2026-10-19", dayLabel: "idag", dinner: "Pannkakor", lunch: [{ child: "Maja", dishes: ["Pannkakor med sylt"] }] };
    expect(dinnerReminder([day], new Date(2026, 9, 19, 15))[0]).toMatchObject({ title: "Middag ikväll: Pannkakor", tone: "amber" });
    expect(dinnerReminder([day], new Date(2026, 9, 19, 9))).toEqual([]);
  });
});

describe("förskolan stänger tidigt", () => {
  it("APT varnar men behåller omsorgen; planeringsdag stänger hela dagen", async () => {
    const { buildCareEvents, buildReminders } = await import("./dashboard.js");
    const leo = { id: "leo", name: "Leo", color: "#f5c84b", kind: "child" as const, care: { days: { "3": "07:30-16:00", "4": "07:30-16:00" } } };
    const people = new Map<string, Person>([[leo.id, leo]]);
    const apt: SourcedEvent = { ...ev("APT – förskolan stänger 15:00", { allDay: true, start: new Date(2026, 9, 21), end: new Date(2026, 9, 22) }), sourceId: "kal", category: "school", personId: "leo" };
    const plan: SourcedEvent = { ...ev("Planeringsdag", { allDay: true, start: new Date(2026, 9, 22), end: new Date(2026, 9, 23) }), sourceId: "kal", category: "school", personId: "leo" };
    const care = buildCareEvents([leo], [], [apt, plan], new Date(2026, 9, 19), 7);
    expect(care.map((e) => e.start.getDate())).toEqual([21]);
    const r = buildReminders(new Date(2026, 9, 19, 9), [apt, plan], people, [], null);
    expect(r.map((x) => x.sub)).toEqual(["Kolla när förskolan stänger – hämta tidigare?", "Om 3 dagar – ordna barnomsorg"]);
  });
});

describe("krockar i Planera veckan", () => {
  it("visar när en vuxen har något i sin egen kalender vid lämning eller hämtning", async () => {
    const { busyAdults } = await import("./plan.js");
    const emil = { id: "emil", name: "Emil", color: "#c9a2ff", kind: "adult" as const };
    const anna = { id: "anna", name: "Anna", color: "#ff8fa3", kind: "adult" as const };
    const ella = { id: "ella", name: "Ella", color: "#5ab8ff", kind: "child" as const };
    const people = new Map<string, Person>([emil, anna, ella].map((p) => [p.id, p]));
    const training: SourcedEvent = { ...ev("F14 – Träning", { start: new Date(2026, 9, 21, 17, 30), end: new Date(2026, 9, 21, 19) }), sourceId: "fotboll", category: "sport", personId: "ella" };
    const meeting: SourcedEvent = { ...ev("Kundmöte", { start: new Date(2026, 9, 21, 16), end: new Date(2026, 9, 21, 17, 15) }), sourceId: "jobb-emil", category: "work", personId: "emil" };
    const trip: SourcedEvent = { ...ev("Tjänsteresa Malmö", { allDay: true, start: new Date(2026, 9, 21), end: new Date(2026, 9, 22) }), sourceId: "jobb-anna", category: "work", personId: "anna" };
    const lunch: SourcedEvent = { ...ev("Lunch", { start: new Date(2026, 9, 21, 12), end: new Date(2026, 9, 21, 13) }), sourceId: "jobb-emil", category: "work", personId: "emil" };
    const busy = busyAdults(training, [training, meeting, trip, lunch], people);
    expect(busy).toEqual([
      { personId: "emil", leg: "to", title: "Kundmöte 16:00–17:15" },
      { personId: "anna", leg: "to", title: "Tjänsteresa Malmö" },
      { personId: "anna", leg: "home", title: "Tjänsteresa Malmö" },
    ]);
  });
});

describe("middagsfavoriter, hyllan och veckodagar", () => {
  it("lär sig favoriter och vad man brukar handla", async () => {
    const { saveDinner, mealFavorites } = await import("./meals.js");
    const now = new Date(2026, 9, 18, 19);
    saveDinner("2026-10-19", "Tacos", now, "tacoskal, ost");
    saveDinner("2026-10-26", "tacos", now);
    saveDinner("2026-10-20", "Lax i ugn", now);
    const fav = mealFavorites(now);
    expect(fav[0]).toEqual({ name: "Tacos", shopping: "tacoskal, ost" });
    expect(fav[1].name).toBe("Lax i ugn");
    expect(fav.length).toBeGreaterThan(2); // fylls på med förslag för en ny familj
  });

  it("påminner om det som saknas på hyllan och veckodagens anteckning", async () => {
    const { saveShelf } = await import("./meals.js");
    const { buildReminders } = await import("./dashboard.js");
    const maja = { id: "maja", name: "Maja", color: "#34e0a1", kind: "child" as const, care: { name: "Förskola", days: { "2": "07:30-16:00" }, notes: { "2": "Utflykt – packa ryggsäck och frukt" } } };
    const people = new Map<string, Person>([[maja.id, maja]]);
    saveShelf("maja", ["Blöjor", "Extrakläder"]);
    const tuesdayMorning = new Date(2026, 9, 20, 7);
    const titles = buildReminders(tuesdayMorning, [], people, [], null).map((r) => r.title);
    expect(titles).toContain("Maja · ta med till förskolan: blöjor, extrakläder");
    expect(titles).toContain("Maja · Utflykt – packa ryggsäck och frukt");
    // Måndag kväll visar tisdagens anteckning.
    expect(buildReminders(new Date(2026, 9, 19, 19), [], people, [], null).map((r) => r.title)).toContain("Maja · Utflykt – packa ryggsäck och frukt");
    saveShelf("maja", []);
    expect(buildReminders(tuesdayMorning, [], people, [], null).some((r) => r.title.includes("ta med"))).toBe(false);
  });
  it("Vklass omsorgstid gäller inte en söndag", async () => {
    const { buildCareEvents } = await import("./dashboard.js");
    const leo = { id: "leo", name: "Leo", color: "#f5c84b", kind: "child" as const, care: { days: { "1": "07:30-16:00" } } };
    const sunday = new Date(2026, 10, 1);
    const care = buildCareEvents([leo], [{ personId: "leo", text: "07:15 - 16:00" }], [], sunday, 2);
    expect(care.map((c) => c.start.getDate())).toEqual([2]); // bara måndagen, inte söndagen
  });
  it("Skola24: grupperna i en klass är de som heter som klassen – ämnesgrupper och 7A–7C ingår, men aldrig en annan årskurs", async () => {
    const { groupsOfClass } = await import("./connectors/skola24.js");
    const g = (n: string) => ({ groupName: n, groupGuid: `guid-${n}` });
    // Gantofta skola (Helsingborg): klasserna heter 0–9, grupperna 7:1, 7:2, 7A, 7B, 7MAS …
    const all = ["4:1", "4:2", "4MAB", "7:1", "7:2", "7A", "7B", "7MAS", "70", "789STV", "17:1", "8:1"].map(g);
    expect(groupsOfClass("7", all).map((x) => x.groupName)).toEqual(["7:1", "7:2", "7A", "7B", "7MAS"]);
    expect(groupsOfClass("4", all).map((x) => x.groupName)).toEqual(["4:1", "4:2", "4MAB"]);
    // Heter klasserna 7A och 7B räknas inte 7A som grupp i klass 7.
    expect(groupsOfClass("7", all, ["7", "7A", "7B"]).map((x) => x.groupName)).toEqual(["7:1", "7:2", "7MAS"]);
    expect(groupsOfClass("", all)).toEqual([]);
  });
});
