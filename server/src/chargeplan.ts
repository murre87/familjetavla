import { ha, type HaConn, type HaState } from "./connectors/ha.js";
import { haSocket } from "./connectors/haws.js";
import { buildControl } from "./dashboard.js";
import type { HaEntityInfo } from "./discovery.js";
import { slug } from "./publisher.js";
import type { CarCharging, CarEntity, ChargeRule } from "./types.js";

/**
 * A charging plan for a car, the Home Assistant way (the "Laddning" card covers start/stop and the car's own schedule):
 *  1. Read what already exists: the car's own charge settings (limit, scheduled start, departure),
 *     the wall charger's settings, apps like EV Smart Charging, and schedules/automations about charging.
 *  2. If the family wants its own plan, create it in HA itself: a schedule helper
 *     ("Familjetavla laddning <bil>") plus an automation that turns charging on and off with it.
 *     It keeps working when the board is off, and shows up in HA like anything else.
 */

const domain = (e: string) => e.split(".")[0];
const has = (s: string | null | undefined, re: RegExp) => Boolean(s && re.test(s));

const CHARGE = /charg|ladd/i;
const NOT_TARGET = /port|lucka|cable|kabel|lock|lås|schedul|schema|smart|off.?peak|depart|avgång|limit|gräns|current|ström|\bamp/i;
const CHARGER =
  /easee|zaptec|wallbox|charge ?amps|go-?e|ctek|garo|ocpp|ohme|pod ?point|zappi|myenergi|wall ?connector|ev smart charging|chargepoint|alfen|keba|webasto|nexblue|monta|emporia|laddbox/i;
const PLAN = /ladd|charg|\bev\b|elbil/i;
const CONTROL_DOMAINS = ["switch", "select", "number", "time", "input_datetime", "input_number", "input_select", "input_boolean", "button"];

const isCharger = (x: HaEntityInfo) => has(`${x.m ?? ""} ${x.mo ?? ""} ${x.dn ?? ""}`, CHARGER) || x.e.includes("ev_smart_charging");

export function ownNames(car: Pick<CarEntity, "name">) {
  return {
    schedule: `Familjetavla laddning ${car.name}`,
    automationId: `familjetavla_laddning_${slug(car.name) || "bil"}`,
  };
}

export interface ChargeFinds {
  targets: string[];
  limit?: string;
  settings: string[];
  existing: string[];
}

/** What controls charging for this car, found among the car's and the chargers' entities. Pure, for tests. */
export function findCharging(all: HaEntityInfo[], carEnts: HaEntityInfo[], ownEntities: string[] = []): ChargeFinds {
  const live = (x: HaEntityInfo) => x.st !== "unavailable";
  const chargerEnts = all.filter((x) => isCharger(x) && live(x));
  const carSwitches = carEnts.filter((x) => domain(x.e) === "switch" && has(x.n, CHARGE) && !has(x.n, NOT_TARGET));
  const chargerSwitches = chargerEnts.filter((x) => domain(x.e) === "switch" && !x.e.includes("ev_smart_charging") && !has(x.n, /\b(lock|lås|led|light|ljus|lampa)\b/i));
  const targets = [...carSwitches, ...chargerSwitches].map((x) => x.e);

  const limit = carEnts.find((x) => ["number", "input_number"].includes(domain(x.e)) && x.u === "%" && has(x.n, /limit|gräns|target|mål|max|soc|charg|ladd/i))?.e;

  const taken = new Set([...targets, limit]);
  // The car's own charge settings are on the "Laddning" card already; here: wall chargers and charging apps.
  const settings = chargerEnts
    .filter((x) => CONTROL_DOMAINS.includes(domain(x.e)))
    .map((x) => x.e)
    .filter((e, i, arr) => !taken.has(e) && arr.indexOf(e) === i)
    .slice(0, 12);

  const own = new Set(ownEntities);
  const existing = all
    .filter((x) => ["schedule", "automation"].includes(domain(x.e)) && !own.has(x.e) && has(`${x.n} ${x.e}`, PLAN))
    .map((x) => x.e)
    .slice(0, 8);
  return { targets, limit, settings, existing };
}

// ---------- Rules ↔ HA schedule blocks ----------

export const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type DayKey = (typeof DAY_KEYS)[number];
export type Blocks = Record<DayKey, { from: string; to: string }[]>;

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};
const fromMin = (m: number, seconds = true) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}${seconds ? ":00" : ""}`;

/**
 * "Mån–fre 22:00–06:00" → HA schedule blocks. HA blocks cannot pass midnight, so an overnight
 * rule becomes 22:00–24:00 on the day and 00:00–06:00 on the next. From = to means all day.
 */
export function rulesToBlocks(rules: ChargeRule[]): Blocks {
  const per: [number, number][][] = DAY_KEYS.map(() => []);
  for (const r of rules) {
    const a = toMin(r.from);
    const b = toMin(r.to);
    for (const d of r.days) {
      const i = d - 1;
      if (a === b) per[i].push([0, 1440]);
      else if (a < b) per[i].push([a, b]);
      else {
        per[i].push([a, 1440]);
        if (b > 0) per[(i + 1) % 7].push([0, b]);
      }
    }
  }
  const out = {} as Blocks;
  DAY_KEYS.forEach((k, i) => {
    const merged: [number, number][] = [];
    for (const iv of per[i].sort((x, y) => x[0] - y[0])) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
      else merged.push([...iv]);
    }
    out[k] = merged.map(([f, t]) => ({ from: fromMin(f), to: fromMin(t) }));
  });
  return out;
}

/** HA schedule blocks → rules for the board, joining 22–24 + 00–06 back into one overnight rule. */
export function blocksToRules(blocks: Partial<Blocks>): ChargeRule[] {
  const per = DAY_KEYS.map((k) => (blocks[k] ?? []).map((b) => ({ a: toMin(b.from), b: toMin(b.to), used: false })));
  const pieces: { day: number; from: number; to: number }[] = [];
  per.forEach((list, i) => {
    for (const iv of list) {
      if (iv.used) continue;
      iv.used = true;
      if (iv.b >= 1440 && iv.a > 0) {
        const next = per[(i + 1) % 7].find((x) => !x.used && x.a === 0 && x.b < 1440);
        if (next) {
          next.used = true;
          pieces.push({ day: i + 1, from: iv.a, to: next.b });
          continue;
        }
      }
      pieces.push({ day: i + 1, from: iv.a, to: iv.b >= 1440 ? 0 : iv.b });
    }
  });
  const groups = new Map<string, ChargeRule>();
  for (const p of pieces) {
    const key = `${p.from}-${p.to}`;
    const g = groups.get(key) ?? { days: [], from: fromMin(p.from, false), to: fromMin(p.to, false) };
    if (!g.days.includes(p.day)) g.days.push(p.day);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, days: g.days.sort((x, y) => x - y) }))
    .sort((x, y) => x.days[0] - y.days[0] || x.from.localeCompare(y.from));
}

/** The automation the board writes to HA. */
export function buildAutomation(car: Pick<CarEntity, "name">, scheduleEntity: string, target: string, limit?: { entityId: string; value: number }) {
  const { automationId, schedule } = ownNames(car);
  const on = [
    ...(limit ? [{ action: `${domain(limit.entityId) === "input_number" ? "input_number" : "number"}.set_value`, target: { entity_id: limit.entityId }, data: { value: limit.value } }] : []),
    { action: "homeassistant.turn_on", target: { entity_id: target } },
  ];
  return {
    id: automationId,
    alias: `Familjetavla: ladda ${car.name}`,
    description: `Skapad av Familjetavla. Laddar när schemat "${schedule}" är på. Ändra tiderna på tavlan eller i hjälparen.`,
    mode: "single",
    triggers: [
      { trigger: "state", entity_id: scheduleEntity, from: "off", to: "on" },
      { trigger: "state", entity_id: scheduleEntity, from: "on", to: "off" },
    ],
    conditions: [],
    actions: [
      {
        choose: [{ conditions: [{ condition: "state", entity_id: scheduleEntity, state: "on" }], sequence: on }],
        default: [{ action: "homeassistant.turn_off", target: { entity_id: target } }],
      },
    ],
  };
}

/** Reads back target and limit from an automation the board wrote. */
export function parseAutomation(cfg: unknown): { target?: string; limit?: number; limitEntity?: string } {
  const out: { target?: string; limit?: number; limitEntity?: string } = {};
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const action = String(o.action ?? o.service ?? "");
    const ent = (o.target as { entity_id?: string } | undefined)?.entity_id;
    if (action === "homeassistant.turn_on" && typeof ent === "string") out.target = ent;
    if (action.endsWith(".set_value") && typeof ent === "string") {
      out.limitEntity = ent;
      out.limit = Number((o.data as { value?: unknown } | undefined)?.value);
    }
    Object.values(o).forEach(walk);
  };
  walk((cfg as { actions?: unknown; action?: unknown })?.actions ?? (cfg as { action?: unknown })?.action);
  return out;
}

// ---------- Talking to HA ----------

type SchedItem = { id: string; name: string } & Partial<Blocks>;

function socket() {
  const s = haSocket();
  if (!s?.connected) throw new Error("Tavlan är inte ansluten till Home Assistant just nu.");
  return s;
}

async function findOwnSchedule(car: CarEntity, states: Map<string, HaState>) {
  const { schedule } = ownNames(car);
  const items = await socket().call<SchedItem[]>({ type: "schedule/list" });
  const item = items.find((x) => x.name === schedule);
  if (!item) return null;
  const byName = [...states.values()].find((s) => s.entity_id.startsWith("schedule.") && s.attributes.friendly_name === schedule);
  return { item, entityId: byName?.entity_id ?? `schedule.${item.id}` };
}

function automationEntity(states: Map<string, HaState>, automationId: string) {
  return [...states.values()].find((s) => s.entity_id.startsWith("automation.") && s.attributes.id === automationId)?.entity_id;
}

function nextEvent(s?: HaState): string | undefined {
  const v = s?.attributes.next_event;
  return typeof v === "string" ? v : undefined;
}

export async function readCharging(conn: HaConn, car: CarEntity, all: HaEntityInfo[], carEnts: HaEntityInfo[], states: Map<string, HaState>): Promise<CarCharging> {
  const { automationId } = ownNames(car);
  const sock = haSocket();
  const own = sock?.connected ? await findOwnSchedule(car, states).catch(() => null) : null;
  const autoEnt = automationEntity(states, automationId);
  const finds = findCharging(all, carEnts, [own?.entityId, autoEnt].filter(Boolean) as string[]);
  const name = (id: string) => String(states.get(id)?.attributes.friendly_name ?? all.find((x) => x.e === id)?.n ?? id);

  let ownOut: CarCharging["own"];
  if (own) {
    const auto = await ha.automationConfig(conn, automationId).catch(() => null);
    const parsed = auto ? parseAutomation(auto) : {};
    ownOut = {
      scheduleEntity: own.entityId,
      automationEntity: autoEnt,
      enabled: autoEnt ? states.get(autoEnt)?.state !== "off" : Boolean(auto),
      active: states.get(own.entityId)?.state === "on",
      rules: blocksToRules(own.item),
      target: parsed.target,
      limit: Number.isFinite(parsed.limit) ? parsed.limit : undefined,
      next: nextEvent(states.get(own.entityId)),
      missingAutomation: !auto,
    };
  }

  return {
    target: finds.targets[0] ? buildControl(states, ownOut?.target ?? finds.targets[0], car.name) : undefined,
    targetOptions: [...new Set([...(ownOut?.target ? [ownOut.target] : []), ...finds.targets])].map((e) => ({ entityId: e, name: name(e) })),
    limit: finds.limit ? buildControl(states, finds.limit, car.name) : undefined,
    settings: finds.settings.map((e) => buildControl(states, e, car.name)),
    existing: finds.existing.map((e) => ({
      entityId: e,
      name: name(e),
      domain: domain(e) as "schedule" | "automation",
      on: states.get(e)?.state === "on",
      next: nextEvent(states.get(e)),
    })),
    own: ownOut,
    canCreate: Boolean(sock?.connected) && finds.targets.length > 0,
  };
}

/** Allowed entities for direct control from the charging card. */
export function chargingEntities(c: CarCharging): Set<string> {
  return new Set([
    ...c.targetOptions.map((t) => t.entityId),
    ...(c.limit ? [c.limit.entityId] : []),
    ...c.settings.map((s) => s.entityId),
    ...c.existing.filter((e) => e.domain === "automation").map((e) => e.entityId),
    ...(c.own?.automationEntity ? [c.own.automationEntity] : []),
  ]);
}

export async function saveOwnPlan(
  conn: HaConn,
  car: CarEntity,
  states: Map<string, HaState>,
  plan: { rules: ChargeRule[]; target: string; limit?: { entityId: string; value: number } },
) {
  const sock = socket();
  const { schedule } = ownNames(car);
  const blocks = rulesToBlocks(plan.rules);
  const existing = await findOwnSchedule(car, states);
  let entityId: string;
  if (existing) {
    await sock.call({ type: "schedule/update", schedule_id: existing.item.id, name: schedule, icon: "mdi:ev-station", ...blocks });
    entityId = existing.entityId;
  } else {
    const created = await sock.call<SchedItem>({ type: "schedule/create", name: schedule, icon: "mdi:ev-station", ...blocks });
    entityId = `schedule.${created.id}`;
  }
  const auto = buildAutomation(car, entityId, plan.target, plan.limit);
  await ha.saveAutomation(conn, auto.id, auto);
  return { scheduleEntity: entityId };
}

export async function deleteOwnPlan(conn: HaConn, car: CarEntity, states: Map<string, HaState>) {
  const { automationId } = ownNames(car);
  const existing = await findOwnSchedule(car, states);
  if (existing) await socket().call({ type: "schedule/delete", schedule_id: existing.item.id });
  await ha.deleteAutomation(conn, automationId).catch(() => {});
}

/** Set a value on a time/number/select entity, or toggle a switch/automation. */
export async function setChargeEntity(conn: HaConn, entityId: string, op: "toggle" | "on" | "off" | "press" | "set" | "select" | "time", value?: string | number) {
  const d = domain(entityId);
  if (op === "time") {
    const t = String(value ?? "");
    if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(t)) throw new Error("Ogiltig tid");
    const time = t.length === 5 ? `${t}:00` : t;
    if (d === "input_datetime") return ha.service(conn, "input_datetime", "set_datetime", { entity_id: entityId, time });
    return ha.service(conn, "time", "set_value", { entity_id: entityId, time });
  }
  if (op === "set") return ha.service(conn, d === "input_number" ? "input_number" : "number", "set_value", { entity_id: entityId, value: Number(value) });
  if (op === "select") return ha.service(conn, d === "input_select" ? "input_select" : "select", "select_option", { entity_id: entityId, option: String(value) });
  if (op === "press") return ha.service(conn, d === "input_button" ? "input_button" : "button", "press", { entity_id: entityId });
  if (op === "toggle") return ha.service(conn, "homeassistant", "toggle", { entity_id: entityId });
  return ha.service(conn, "homeassistant", op === "off" ? "turn_off" : "turn_on", { entity_id: entityId });
}
