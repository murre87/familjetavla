import { cached } from "./cache.js";
import type { HourPrice } from "./connectors/elpris.js";
import { ha, type HaConn, type HaState } from "./connectors/ha.js";
import type { Dashboard, EnergyEntities } from "./types.js";

type Energy = NonNullable<Dashboard["energy"]>;
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** A power sensor in kW (W and MW converted), or undefined when it has no number. */
export function kwOf(states: Map<string, HaState>, id?: string): number | undefined {
  const st = id ? states.get(id) : undefined;
  const n = Number(st?.state);
  if (!st || !Number.isFinite(n)) return undefined;
  const unit = String(st.attributes.unit_of_measurement ?? "");
  return round(unit === "W" ? n / 1000 : unit === "MW" ? n * 1000 : n);
}

/**
 * Power right now. The grid meter may give one signed value (+ buy, − sell) or two (buy and sell,
 * like Tibber Pulse "Effekt" and "Elproduktion"). The house is what the sun makes plus what is
 * bought minus what is sold, plus what a home battery gives (or minus what it takes); a house
 * sensor is only used when the sun and the battery or the meter are missing.
 */
export function energyNow(e: EnergyEntities, states: Map<string, HaState>): Omit<Energy, "today" | "batteryPct"> {
  const solar = kwOf(states, e.solar);
  const buy = kwOf(states, e.grid);
  const sell = kwOf(states, e.gridExport);
  const grid = buy !== undefined ? round(buy - (sell ?? 0)) : sell !== undefined ? -sell : undefined;
  // Home Assistant's energy panel counts battery discharge as plus; some brands report charging as plus.
  const rawBattery = kwOf(states, e.batteryPower);
  const battery = rawBattery === undefined ? undefined : e.batteryChargePositive ? -rawBattery : rawBattery;
  // With a meter and the sun (or a battery) the board counts the house itself: sun + bought − sold
  // ± battery. A home's own "consumption" sensor often is just the bought power (0 while selling),
  // so it is only used when the board cannot count.
  const house =
    grid !== undefined && (solar !== undefined || battery !== undefined)
      ? round(Math.max(0, (solar ?? 0) + grid + (battery ?? 0)))
      : kwOf(states, e.house);
  const sold = grid !== undefined && grid < 0 ? -grid : 0;
  const selfUse = solar !== undefined ? round(Math.max(0, Math.min(solar - sold, house ?? solar))) : undefined;
  return { solarKw: solar, gridKw: grid, houseKw: house, selfUseKw: selfUse, batteryKw: battery };
}

/** Battery level in %, or undefined. */
function pctOf(states: Map<string, HaState>, id?: string): number | undefined {
  const n = Number(id ? states.get(id)?.state : undefined);
  return id && Number.isFinite(n) ? n : undefined;
}

/** What the board shows "just nu": power flows plus the home battery. Sent live as HA reports. */
export function energyLive(e: EnergyEntities, states: Map<string, HaState>): Omit<Energy, "today"> {
  return { ...energyNow(e, states), batteryPct: pctOf(states, e.battery) };
}

/** Entities whose change moves the live flow (not the kWh meters, which only feed "Idag"). */
export const liveEnergyIds = (e: EnergyEntities) =>
  [e.solar, e.grid, e.gridExport, e.house, e.battery, e.batteryPower].filter((x): x is string => Boolean(x));

/**
 * What a meter counted between readings. Works for lifetime readings (total_increasing) and for
 * counters that restart at midnight or every hour. Real meters misbehave, so a drop is only a
 * restart when it looks like one:
 *  - a small dip (still at least half) is a correction: nothing is counted
 *  - a drop at the start of an hour is a restart (midnight, hourly counters)
 *  - a drop that comes back to the old level within 30 minutes is a glitch (e.g. a short 0)
 *  - any other big drop is a restart: the new value is what has been counted since
 */
function steps(points: { t: number; v: number }[]): { t: number; inc: number }[] {
  const out: { t: number; inc: number }[] = [];
  if (!points.length) return out;
  let last = points[0].v;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.v >= last) {
      out.push({ t: p.t, inc: p.v - last });
      last = p.v;
      continue;
    }
    if (p.v >= last * 0.5) {
      last = p.v;
      continue;
    }
    const minute = new Date(p.t).getMinutes();
    const comesBack = points.slice(i + 1).some((q) => q.t - p.t <= 30 * 60_000 && q.v >= last * 0.9);
    if (minute > 5 && comesBack) continue;
    out.push({ t: p.t, inc: p.v });
    last = p.v;
  }
  return out;
}

/** How much a meter has counted since midnight (see steps for how restarts and glitches are read). */
export function increase(points: { t: number; v: number }[]): number | undefined {
  if (!points.length) return undefined;
  return steps(points).reduce((a, s) => a + s.inc, 0);
}

const toKwh = (n: number, unit: string) => (unit === "Wh" ? n / 1000 : unit === "MWh" ? n * 1000 : n);

/** Per hour (ms of the hour start → kWh), to price what was bought. */
export function hourly(points: { t: number; v: number }[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const { t, inc } of steps(points)) {
    const h = new Date(t);
    h.setMinutes(0, 0, 0);
    out.set(h.getTime(), (out.get(h.getTime()) ?? 0) + inc);
  }
  return out;
}

export function energyToday(
  e: EnergyEntities,
  series: Record<string, { t: number; v: number }[]>,
  units: Record<string, string>,
  prices: HourPrice[],
  priceOf: (p: number) => number,
): Energy["today"] {
  const kwh = (id?: string) => {
    if (!id || !series[id]) return undefined;
    const inc = increase(series[id]);
    return inc === undefined ? undefined : round(toKwh(inc, units[id] ?? "kWh"));
  };
  const solarKwh = kwh(e.solarEnergy);
  const importKwh = kwh(e.importEnergy);
  const exportKwh = kwh(e.exportEnergy);
  const batteryChargeKwh = kwh(e.batteryChargeEnergy);
  const batteryDischargeKwh = kwh(e.batteryDischargeEnergy);
  if (solarKwh === undefined && importKwh === undefined && exportKwh === undefined) return undefined;
  const battery = (batteryDischargeKwh ?? 0) - (batteryChargeKwh ?? 0);
  const houseKwh = importKwh !== undefined ? round(Math.max(0, (solarKwh ?? 0) + importKwh - (exportKwh ?? 0) + battery)) : undefined;
  const selfUseKwh = solarKwh !== undefined ? round(Math.max(0, solarKwh - (exportKwh ?? 0))) : undefined;
  // What was not bought. Without a battery this is the same as own solar use / consumption; with one
  // it also counts what the battery gave back (sun stored earlier).
  const selfSufficiencyPct =
    houseKwh && importKwh !== undefined && (selfUseKwh !== undefined || batteryDischargeKwh !== undefined)
      ? Math.round(Math.min(100, Math.max(0, ((houseKwh - importKwh) / houseKwh) * 100)))
      : undefined;
  let costKr: number | undefined;
  if (e.importEnergy && series[e.importEnergy] && prices.length) {
    const byHour = new Map(prices.map((p) => [p.start.getTime(), priceOf(p.price)]));
    let sum = 0;
    let priced = false;
    for (const [h, v] of hourly(series[e.importEnergy])) {
      const price = byHour.get(h);
      if (price === undefined) continue;
      sum += toKwh(v, units[e.importEnergy] ?? "kWh") * price;
      priced = true;
    }
    if (priced) costKr = round(sum, 0);
  }
  return { solarKwh, importKwh, exportKwh, houseKwh, selfUseKwh, batteryChargeKwh, batteryDischargeKwh, selfSufficiencyPct, costKr };
}

/** Today's meter history from Home Assistant, at most every five minutes. */
export async function todaySeries(conn: HaConn, e: EnergyEntities, now: Date): Promise<Record<string, { t: number; v: number }[]>> {
  const ids = [e.solarEnergy, e.importEnergy, e.exportEnergy, e.batteryChargeEnergy, e.batteryDischargeEnergy].filter((x): x is string => Boolean(x));
  if (!ids.length) return {};
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return cached(`energy-today:${ids.join(",")}:${midnight.toDateString()}`, 5 * 60_000, () => ha.historyRaw(conn, ids, midnight, now));
}
