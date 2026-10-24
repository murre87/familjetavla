import type { SchoolNewsItem } from "./providers/types.js";
import { cached } from "./cache.js";
import { fetchIcs, filterEvents, type CalEvent } from "./connectors/ics.js";
import { ha, haConnection } from "./connectors/ha.js";
import type { HourPrice } from "./connectors/elpris.js";
import type { Pickup } from "./connectors/waste.js";
import { findProvider, makeCtx } from "./providers/registry.js";
import { getSecret } from "./store.js";
import type { CalendarCategory, CalendarSource, Config } from "./types.js";

const MIN = 60_000;

export interface SourcedEvent extends CalEvent {
  sourceId: string;
  personId?: string;
  category: CalendarCategory;
  gym?: boolean;
  /** Homework, test or hand-in from a school platform. */
  task?: boolean;
  /** The item on the school platform. */
  url?: string;
  /** Name of the calendar (helps pick an icon: "Fotboll F14" → ball). */
  sourceName?: string;
  /** Shown even when the child is at the other home (calendar set to "always" or an alwaysShow match). */
  ignoreCustody?: boolean;
}

export interface SourceError {
  source: string;
  message: string;
}

export async function calendarEvents(src: CalendarSource, from: Date, to: Date): Promise<CalEvent[]> {
  if (src.kind === "ha") {
    const conn = haConnection();
    if (!conn || !src.entityId) throw new Error("Home Assistant är inte anslutet.");
    return ha.calendarEvents(conn, src.entityId, from, to);
  }
  const url = getSecret(`calendar.${src.id}.url`);
  if (!url) throw new Error("Kalenderlänk saknas.");
  return fetchIcs(url, from, to);
}

export async function collectCalendars(cfg: Config, from: Date, to: Date, errors: SourceError[]): Promise<SourcedEvent[]> {
  const results = await Promise.all(
    cfg.calendars.map(async (src) => {
      try {
        const evs = await cached(`cal:${src.id}:${from.toDateString()}`, 15 * MIN, () => calendarEvents(src, from, to));
        const always = (src.alwaysShow ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
        return filterEvents(evs, src.include, src.exclude).map((e) => ({
          ...e,
          sourceId: src.id,
          sourceName: src.name,
          personId: src.personId,
          category: src.category,
          ignoreCustody:
            src.visibility === "always" ||
            (always.length > 0 && always.some((t) => `${e.title} ${e.description ?? ""} ${(e.categories ?? []).join(" ")}`.toLowerCase().includes(t))),
        }));
      } catch (e) {
        errors.push({ source: src.name, message: (e as Error).message });
        return [];
      }
    }),
  );
  return results.flat();
}

export interface SchoolData {
  events: SourcedEvent[];
  food: { child: string; day: string; dishes: string[] }[];
  /** Care time (förskola/fritids) per person id. */
  care: { personId: string; text: string }[];
  /** News from the school, with the integration it came from (for fetching files). */
  news: (SchoolNewsItem & { personId?: string; integrationId: string })[];
}

/** Attachment addresses seen in the latest news – the only files the board will fetch for a viewer. */
export const newsFiles = new Map<string, string>();

export async function collectSchool(cfg: Config, from: Date, to: Date, errors: SourceError[]): Promise<SchoolData> {
  const out: SchoolData = { events: [], food: [], care: [], news: [] };
  const names = new Map(cfg.people.map((p) => [p.id, p.name]));
  await Promise.all(
    cfg.integrations
      .filter((i) => i.category === "school")
      .map(async (integ) => {
        const provider = findProvider("school", integ.provider);
        if (!provider) return;
        try {
          const data = await cached(`school:${integ.id}:${from.toDateString()}`, 60 * MIN, () => provider.fetch(makeCtx(integ), from, to));
          for (const e of data.events) {
            const personId = e.child ? integ.personMap?.[e.child] : integ.personId;
            out.events.push({ ...e, sourceId: `school:${integ.id}`, personId, category: "school" });
          }
          for (const c of data.care ?? []) {
            const pid = c.child ? integ.personMap?.[c.child] : integ.personId;
            if (pid) out.care.push({ personId: pid, text: c.text });
          }
          for (const n of data.news ?? []) {
            const personId = n.child ? integ.personMap?.[n.child] : integ.personId;
            out.news.push({ ...n, personId, integrationId: integ.id });
            for (const f of n.files) newsFiles.set(f.url, integ.id);
          }
          for (const f of data.food ?? []) {
            const pid = f.child ? integ.personMap?.[f.child] : integ.personId;
            out.food.push({ ...f, child: (pid && names.get(pid)) || f.child });
          }
        } catch (e) {
          errors.push({ source: provider.meta.name, message: (e as Error).message });
        }
      }),
  );
  return out;
}

function single(cfg: Config, category: "waste" | "price" | "grocery") {
  return cfg.integrations.find((i) => i.category === category);
}

export async function collectWaste(cfg: Config, errors: SourceError[]): Promise<Pickup[]> {
  const integ = single(cfg, "waste");
  if (!integ) return [];
  const provider = findProvider("waste", integ.provider);
  if (!provider) return [];
  try {
    return await cached(`waste:${integ.id}:${new Date().toDateString()}`, 6 * 60 * MIN, () => provider.fetch(makeCtx(integ)));
  } catch (e) {
    errors.push({ source: "Sophämtning", message: (e as Error).message });
    return [];
  }
}

export async function collectPrices(cfg: Config, now: Date, errors: SourceError[]): Promise<HourPrice[]> {
  const integ = single(cfg, "price");
  if (!integ) return [];
  const provider = findProvider("price", integ.provider);
  if (!provider) return [];
  // Tomorrow's prices arrive ~13:00, so split the cache at that point.
  const slot = `${now.toDateString()}:${now.getHours() >= 13 ? "pm" : "am"}`;
  try {
    return await cached(`price:${integ.id}:${slot}`, 30 * MIN, () => provider.fetch(makeCtx(integ), now));
  } catch (e) {
    errors.push({ source: "Elpris", message: (e as Error).message });
    return [];
  }
}

/** Every chosen store (the list goes to the one in `shopping.sendTo`, else the first). */
export function groceryIntegrations(cfg: Config) {
  return cfg.integrations
    .filter((i) => i.category === "grocery")
    .flatMap((integ) => {
      const provider = findProvider("grocery", integ.provider);
      return provider ? [{ integ, provider }] : [];
    });
}

export function groceryIntegration(cfg: Config) {
  const all = groceryIntegrations(cfg);
  return all.find((g) => g.integ.id === cfg.shopping.sendTo) ?? all[0] ?? null;
}

/** Total price per kWh incl. markup, grid fee, energy tax and VAT, from spot SEK/kWh. */
export function totalPrice(cfg: Config, spot: number): number {
  const e = cfg.electricity;
  const extra = (e.markupOre + e.gridOre + e.taxOre) / 100;
  return Math.round((spot + extra) * (e.vat ? 1.25 : 1) * 100) / 100;
}

export function hasPriceExtras(cfg: Config): boolean {
  const e = cfg.electricity;
  return e.markupOre + e.gridOre + e.taxOre > 0 || e.vat;
}
