import { getJson } from "../http.js";
import { addDays, dayKey } from "../time.js";

/**
 * Spot prices from elprisetjustnu.se (free, no key). Prices are spot excluding VAT, grid fees
 * and markup. Since Oct 2025 the market settles in 15-minute periods; we average to hours.
 */
export interface HourPrice {
  start: Date;
  price: number; // SEK/kWh (hour average)
  /** The four 15-minute prices of the hour (SEK/kWh), when the source has them. */
  quarters?: number[];
}

type Row = { SEK_per_kWh: number; time_start: string };

async function day(date: Date, area: string): Promise<Row[]> {
  const y = date.getFullYear();
  const md = dayKey(date).slice(5);
  try {
    return await getJson<Row[]>(`https://www.elprisetjustnu.se/api/v1/prices/${y}/${md}_${area}.json`);
  } catch (e) {
    // Tomorrow's prices are published around 13:00; a 404 before then is expected.
    if ((e as { status?: number }).status === 404) return [];
    throw e;
  }
}

export function toHourly(rows: Row[]): HourPrice[] {
  const byHour = new Map<number, { sum: number; n: number; start: Date; q: { m: number; p: number }[] }>();
  for (const r of rows) {
    const t = new Date(r.time_start);
    const hourStart = new Date(t.getFullYear(), t.getMonth(), t.getDate(), t.getHours());
    const k = hourStart.getTime();
    const e = byHour.get(k) ?? { sum: 0, n: 0, start: hourStart, q: [] };
    e.sum += r.SEK_per_kWh;
    e.n += 1;
    e.q.push({ m: t.getMinutes(), p: r.SEK_per_kWh });
    byHour.set(k, e);
  }
  return [...byHour.values()]
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((e) => ({
      start: e.start,
      price: Math.round((e.sum / e.n) * 1000) / 1000,
      // Only a full hour of quarters (0, 15, 30, 45) counts – never guess a missing one.
      ...(e.q.length === 4 && [0, 15, 30, 45].every((m) => e.q.some((x) => x.m === m))
        ? { quarters: [0, 15, 30, 45].map((m) => Math.round(e.q.find((x) => x.m === m)!.p * 1000) / 1000) }
        : {}),
    }));
}

export async function fetchPrices(area: string, now = new Date()): Promise<HourPrice[]> {
  const [today, tomorrow] = await Promise.all([day(now, area), day(addDays(now, 1), area)]);
  return toHourly([...today, ...tomorrow]);
}

/** Cheapest contiguous block of `hours` starting at or after now. */
export function cheapestBlock(prices: HourPrice[], hours: number, now = new Date()) {
  const upcoming = prices.filter((p) => p.start.getTime() + 3_600_000 > now.getTime());
  let best: { i: number; avg: number } | null = null;
  for (let i = 0; i + hours <= upcoming.length; i++) {
    const slice = upcoming.slice(i, i + hours);
    // Only contiguous hours.
    if (slice[slice.length - 1].start.getTime() - slice[0].start.getTime() !== (hours - 1) * 3_600_000) continue;
    const avg = slice.reduce((s, p) => s + p.price, 0) / hours;
    if (!best || avg < best.avg) best = { i, avg };
  }
  if (!best) return null;
  return {
    start: upcoming[best.i].start,
    end: new Date(upcoming[best.i + hours - 1].start.getTime() + 3_600_000),
    avg: Math.round(best.avg * 100) / 100,
    hours: upcoming.slice(best.i, best.i + hours).map((p) => p.start.getTime()),
  };
}

export function priceLevel(price: number, prices: HourPrice[]): "billigt" | "normalt" | "dyrt" {
  if (prices.length === 0) return "normalt";
  const sorted = [...prices].map((p) => p.price).sort((a, b) => a - b);
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))];
  if (price <= q(0.33)) return "billigt";
  if (price >= q(0.67)) return "dyrt";
  return "normalt";
}
