import type { HaState } from "./connectors/ha.js";

/**
 * Smart laddning (märkesoberoende). Alla smartstyrningar som lägger en laddplan och ett laddläge i Home Assistant kan visas här,
 * utan inställningar, om de följer avtalet (se docs/SMART-LADDNING.md):
 *
 *  - Laddplan: en sensor med attributet `slots` = [{ start, end, kw? }] (ISO 8601, helst med tidszon). Tillståndet är en kort text
 *    ("Laddar nu", "Planerad 01:15"). Valfria attribut: soc_after_plan, planned_kwh, source.
 *  - Laddläge: en select/input_select med alternativ för automatik, ladda nu och pausa (t.ex. Auto / Ladda nu / Pausa,
 *    Auto / Charge now / Pause). Att välja ett alternativ ska ge samma överstyrning som smartstyrningens egen knapp.
 */
export interface Slot {
  start: string;
  end: string;
  kw: number | null;
  /** Batteri i % före och efter blocket, om smartstyrningen publicerar det (attributen `soc_start` / `soc_end` per block). */
  socStart?: number;
  socEnd?: number;
}

/** Kontroll av ett morgonmål, t.ex. "minst 50 % kl 06:00" (attributet `morning_check` = { time, soc, min }). */
export interface MorningCheck {
  time: string;
  soc: number;
  min: number;
  ok: boolean;
}

export interface SmartCharging {
  planEntity: string;
  modeEntity?: string;
  state: string;
  mode?: string;
  options: string[];
  /** Alternativet som motsvarar "ladda nu" respektive "pausa" (för laddknappen), om det finns. */
  nowOption?: string;
  pauseOption?: string;
  autoOption?: string;
  slots: Slot[];
  socAfter: number | null;
  plannedKwh: number | null;
  /** Valfritt: vad batteriet beräknas ha vid ett morgonmål (golvet) enligt planen. */
  morning?: MorningCheck;
  source?: string;
  /** Veckoschema (klar kl T med mål %) som smartstyrningen följer, om den publicerar det (attributet `schedule`). */
  schedule?: ScheduleRow[];
  /** Id som smartstyrningen vill ha tillbaka när schemat ändras (attributet `schedule_car`). */
  scheduleCar?: string;
  /** input_text där en ändring skrivs som JSON; smartstyrningen sparar den och kvitterar genom att tömma fältet. Utan den är schemat bara läsbart. */
  scheduleEntity?: string;
}

export interface ScheduleRow {
  /** 0 = måndag … 6 = söndag. */
  day: number;
  time: string;
  soc: number;
  enabled: boolean;
}

const NOW = /(ladda nu|charge now|force|tvinga|start now|ladda direkt|max)/i;
const PAUSE = /(pausa|pause|stopp|stop|hold|vänta|av$|off$)/i;
const AUTO = /(auto|smart)/i;

const attrs = (s: HaState) => s.attributes as Record<string, unknown>;

export function parseSchedule(raw: unknown): ScheduleRow[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rows = raw
    .map((x) => x as Record<string, unknown>)
    .filter((r) => r && Number.isInteger(Number(r.day)) && Number(r.day) >= 0 && Number(r.day) <= 6 && /^\d{2}:\d{2}/.test(String(r.time)))
    .map((r) => ({ day: Number(r.day), time: String(r.time).slice(0, 5), soc: Math.max(0, Math.min(100, Number(r.soc) || 0)), enabled: r.enabled === true || r.enabled === "true" }))
    .sort((a, b) => a.day - b.day);
  return rows.length ? rows : undefined;
}

export function parseSlots(raw: unknown): Slot[] {
  if (!Array.isArray(raw)) return [];
  const out: Slot[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const start = String(r.start ?? r.from ?? "");
    const end = String(r.end ?? r.to ?? "");
    if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) continue;
    const kw = Number(r.kw ?? r.power_kw);
    const slot: Slot = { start, end, kw: Number.isFinite(kw) ? kw : null };
    const s0 = r.soc_start === undefined || r.soc_start === null || r.soc_start === "" ? NaN : Number(r.soc_start);
    const s1 = r.soc_end === undefined || r.soc_end === null || r.soc_end === "" ? NaN : Number(r.soc_end);
    if (Number.isFinite(s0) && Number.isFinite(s1)) {
      slot.socStart = Math.round(s0);
      slot.socEnd = Math.round(s1);
    }
    out.push(slot);
  }
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export function parseMorning(raw: unknown): MorningCheck | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const soc = Number(r.soc);
  const min = Number(r.min);
  const time = String(r.time ?? "");
  if (!Number.isFinite(soc) || !Number.isFinite(min) || !/^\d{2}:\d{2}$/.test(time)) return undefined;
  return { time, soc: Math.round(soc), min: Math.round(min), ok: soc >= min - 0.5 };
}

const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9åäö]+/g, "_").replace(/^_+|_+$/g, "");

/** Hittar bilens laddplan och laddläge: uttryckligt valda entiteter först, annars entiteter som följer avtalet och hör till bilen (namn i entitets-id:t). */
export function findSmartCharging(states: Map<string, HaState>, carName: string, explicit?: { plan?: string; mode?: string }): SmartCharging | undefined {
  const all = [...states.values()];
  const plans = all.filter((s) => s.entity_id.startsWith("sensor.") && Array.isArray(attrs(s).slots));
  const modes = all.filter((s) => /^(input_select|select)\./.test(s.entity_id) && Array.isArray(attrs(s).options) && /ladd|charg/i.test(s.entity_id) && (attrs(s).options as unknown[]).some((o) => AUTO.test(String(o))) && (attrs(s).options as unknown[]).some((o) => PAUSE.test(String(o))));
  const key = slug(carName);
  const first = key.split("_")[0];
  const pick = (list: HaState[], want?: string) => {
    if (want) return states.get(want);
    const byFull = list.find((s) => s.entity_id.includes(key));
    if (byFull) return byFull;
    const byFirst = first.length >= 3 ? list.filter((s) => s.entity_id.includes(first)) : [];
    if (byFirst.length === 1) return byFirst[0];
    return list.length === 1 && !explicit ? list[0] : undefined;
  };
  const cmdEnts = all.filter((s) => s.entity_id.startsWith("input_text.") && /laddschema|charge_?schedule|laddplan/i.test(s.entity_id) && /kommando|command|set/i.test(s.entity_id));
  const plan = pick(plans, explicit?.plan);
  const modeS = pick(modes, explicit?.mode);
  if (!plan && !modeS) return undefined;
  const options = modeS ? (attrs(modeS).options as unknown[]).map(String) : [];
  const a = plan ? attrs(plan) : {};
  const schedule = parseSchedule(a.schedule);
  const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    planEntity: plan?.entity_id ?? "",
    modeEntity: modeS?.entity_id,
    state: plan ? (plan.state === "unknown" || plan.state === "unavailable" ? "" : plan.state) : "",
    mode: modeS?.state,
    options,
    nowOption: options.find((o) => NOW.test(o)),
    pauseOption: options.find((o) => PAUSE.test(o) && !AUTO.test(o)),
    autoOption: options.find((o) => AUTO.test(o) && !NOW.test(o)),
    slots: parseSlots(a.slots),
    socAfter: num(a.soc_after_plan),
    plannedKwh: num(a.planned_kwh),
    morning: parseMorning(a.morning_check),
    source: a.source ? String(a.source) : undefined,
    schedule,
    scheduleCar: a.schedule_car ? String(a.schedule_car) : undefined,
    scheduleEntity: schedule && a.schedule_car ? (cmdEnts.length === 1 ? cmdEnts[0] : cmdEnts.find((c) => c.entity_id.includes(first)))?.entity_id : undefined,
  };
}

export interface AutoMode {
  entityId: string;
  name: string;
  mode: string;
  options: string[];
}

/**
 * Lägesväljare för smart styrning av värme, varmvatten, spabad m.m.: en select/input_select vars FÖRSTA alternativ är Auto
 * (= följer sitt eget schema, som smartstyrningen i Home Assistant bestämmer). Hittas av sig själva och visas under Hus, så att
 * man alltid kan lämna tillbaka styrningen till Auto. Bilarnas laddlägen (de visas under Bil) tas inte med.
 */
export function findAutoModes(states: Map<string, HaState>, exclude: Set<string> = new Set()): AutoMode[] {
  const WHAT = /(värme|varme|heat|varmvatten|hotwater|hot_water|water_heater|spa|pool|golv|floor|ladd|charg)/i;
  return [...states.values()]
    .filter((s) => /^(input_select|select)\./.test(s.entity_id) && !exclude.has(s.entity_id) && Array.isArray(attrs(s).options))
    .map((s) => ({ s, options: (attrs(s).options as unknown[]).map(String) }))
    .filter(({ s, options }) => options.length >= 2 && options.length <= 5 && /^auto/i.test(options[0]) && WHAT.test(s.entity_id) && !/ladd|charg/i.test(s.entity_id))
    .map(({ s, options }) => ({ entityId: s.entity_id, name: String(s.attributes.friendly_name ?? s.entity_id.split(".")[1]).replace(/\s*läge$/i, ""), mode: s.state, options }))
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));
}
