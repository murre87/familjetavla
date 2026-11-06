import { fetchIcs } from "../connectors/ics.js";
import { ha, haConnection } from "../connectors/ha.js";
import { EDP_PARKED, EDP_PROVIDERS, edpSchedule, edpSearch, srvSchedule, srvSuggest, sthlmSchedule, type Pickup } from "../connectors/waste.js";
import { addDays, daysBetween, parseDayKey, shortDate, shortWeekday, startOfDay } from "../time.js";
import type { ManualPickup } from "../types.js";
import type { ProviderCtx, WasteProvider } from "./types.js";

const fmt = (p: { date: Date; type: string }) => `${shortWeekday(p.date)} ${shortDate(p.date)} · ${p.type}`;

function edpUrl(ctx: ProviderCtx): string {
  const key = ctx.str("municipality");
  if (key && key !== "custom") {
    const p = EDP_PROVIDERS[key];
    const parked = EDP_PARKED[key];
    if (!p && parked) throw new Error(`${parked.title} går inte att hämta från just nu (${parked.reason}). Välj Eget schema, eller Från Home Assistant med Waste Collection Schedule.`);
    if (!p) throw new Error("Välj kommun eller renhållare.");
    return p.apiUrl;
  }
  const url = ctx.str("apiUrl");
  if (!/^https:\/\/.+\/SimpleWastePickup\/?$/i.test(url)) throw new Error("Adressen ska börja med https:// och sluta på /SimpleWastePickup.");
  return url;
}

export const wasteEdp: WasteProvider = {
  meta: {
    id: "edp",
    category: "waste",
    name: "Sök på adress",
    description: "19 kommuner och renhållare som använder EDP Future – provade mot riktiga adresser varje vecka.",
    status: "stable",
    fields: [
      {
        key: "municipality",
        label: "Kommun / renhållare",
        type: "select",
        options: [
          ...Object.entries(EDP_PROVIDERS)
            .map(([value, p]) => ({ value, label: p.title }))
            .sort((a, b) => a.label.localeCompare(b.label, "sv")),
          { value: "custom", label: "Annan (ange adress till tjänsten)" },
        ],
      },
      { key: "apiUrl", label: "Tjänstens adress", type: "url", optional: true, placeholder: "https://…/FutureWeb/SimpleWastePickup", help: "Bara för Annan. Finns ofta bakom kommunens sida \"När töms mitt kärl\"." },
      { key: "address", label: "Gatuadress", type: "text", placeholder: "Storgatan 1" },
      { key: "building", label: "Välj din adress", type: "select", optional: true, help: "Tryck Testa för att söka." },
    ],
    guide: ["Välj kommun, skriv gatuadress och tryck Testa.", "Välj rätt adress i listan och tryck Testa igen för att se hämtdagarna."],
  },
  async test(ctx) {
    const url = edpUrl(ctx);
    const building = ctx.str("building");
    if (!building) {
      const address = ctx.str("address");
      if (address.length < 3) throw new Error("Skriv gatuadress och nummer.");
      const found = await edpSearch(url, address);
      // No match can also mean the company's search is down (June Avfall, November 2026: every search came back empty while
      // the schedule for an address already chosen still worked). The search only matches the start of a street name, so there is
      // no safe test street for every town: say both.
      if (!found.length) throw new Error(`Hittade ingen adress som börjar med "${address}". Börja med gatunamnet, t.ex. "Storgatan 12". Hittar du ändå inget kan renhållarens sökning vara nere, prova då igen senare. En adress du redan valt fortsätter att ge hämtdagar.`);
      // The service only answers with its first ten matches: a street without a number then shows 1–9 and not your house.
      const capped = found.length >= 10 && !/\d/.test(address);
      return {
        ok: true,
        message: capped
          ? `Renhållaren visar bara de första ${found.length} träffarna. Skriv med husnummer (till exempel "${address} 34") i Gatuadress och tryck Testa igen.`
          : `Hittade ${found.length} adress${found.length === 1 ? "" : "er"} – välj din och testa igen.`,
        choices: { field: "building", options: found.slice(0, 40).map((b) => ({ value: b, label: b })) },
      };
    }
    const pickups = await edpSchedule(url, building);
    return { ok: true, message: pickups.length ? "Hämtdagar hittade." : "Adressen hittades men inga kommande hämtningar.", preview: pickups.slice(0, 6).map(fmt) };
  },
  async fetch(ctx) {
    const building = ctx.str("building");
    if (!building) return [];
    return edpSchedule(edpUrl(ctx), building);
  },
};

export const wasteSrv: WasteProvider = {
  meta: {
    id: "srv",
    category: "waste",
    name: "SRV Återvinning",
    description: "Botkyrka, Haninge, Huddinge, Nynäshamn och Salem – sök på adress.",
    status: "stable",
    fields: [
      { key: "address", label: "Gatuadress", type: "text", placeholder: "Skolvägen 10" },
      { key: "building", label: "Välj din adress", type: "select", optional: true, help: "Tryck Testa för att söka." },
    ],
    guide: [
      "Skriv gatuadress och tryck Testa.",
      "Välj rätt adress i listan och tryck Testa igen för att se hämtdagarna.",
      "Slutar det fungera: välj Eget schema, eller Från Home Assistant om du har Waste Collection Schedule.",
    ],
  },
  async test(ctx) {
    const building = ctx.str("building");
    if (!building) {
      const address = ctx.str("address");
      if (address.length < 3) throw new Error("Skriv gatuadress och nummer.");
      const found = await srvSuggest(address);
      if (!found.length) throw new Error(`SRV hittade ingen adress som matchar "${address}".`);
      return {
        ok: true,
        message: `Hittade ${found.length} adress${found.length === 1 ? "" : "er"} – välj din och testa igen.`,
        choices: { field: "building", options: found.slice(0, 15).map((b) => ({ value: b, label: b })) },
      };
    }
    const pickups = await srvSchedule(building);
    return { ok: true, message: pickups.length ? "Hämtdagar hittade." : "Adressen hittades men inga kommande hämtningar.", preview: pickups.slice(0, 6).map(fmt) };
  },
  async fetch(ctx) {
    const building = ctx.str("building");
    if (!building) return [];
    const until = addDays(startOfDay(new Date()), 21);
    return (await srvSchedule(building)).filter((p) => p.date < until);
  },
};

export const wasteStockholm: WasteProvider = {
  meta: {
    id: "stockholm",
    category: "waste",
    name: "Stockholm Vatten och Avfall",
    description: "Villor och radhus i Stockholms stad – restavfall och matavfall.",
    status: "experimental",
    fields: [{ key: "address", label: "Adress", type: "text", placeholder: "Daltorpsvägen 28, Vällingby, 16244", help: "Gata och nummer, ort, postnummer – som på stockholmvattenochavfall.se." }],
    guide: [
      "Skriv adressen som \"Gata nr, Ort, postnummer\" och tryck Testa.",
      "Gäller villor och radhus. Bor ni i flerfamiljshus sköter fastighetsägaren hämtningen.",
    ],
  },
  async test(ctx) {
    const address = ctx.str("address");
    if (address.length < 5) throw new Error("Skriv adressen, t.ex. Daltorpsvägen 28, Vällingby, 16244.");
    const pickups = await sthlmSchedule(address);
    return { ok: true, message: pickups.length ? "Hämtdagar hittade." : "Adressen hittades men inga kommande hämtningar.", preview: pickups.slice(0, 6).map(fmt) };
  },
  async fetch(ctx) {
    const address = ctx.str("address");
    if (!address) return [];
    const until = addDays(startOfDay(new Date()), 21);
    return (await sthlmSchedule(address)).filter((p) => p.date < until);
  },
};

/** Expand fixed-interval pickups between from and to. */
export function expandManual(rows: ManualPickup[], from: Date, to: Date): Pickup[] {
  const out: Pickup[] = [];
  for (const r of rows) {
    if (!r.type || !/^\d{4}-\d{2}-\d{2}$/.test(r.firstDate) || !(r.everyWeeks >= 1)) continue;
    const first = parseDayKey(r.firstDate);
    const step = Math.round(r.everyWeeks) * 7;
    // Jump to the first occurrence at or after `from`, also when firstDate lies in the past.
    const offset = daysBetween(first, startOfDay(from));
    let n = offset > 0 ? Math.ceil(offset / step) : 0;
    for (;;) {
      const d = addDays(first, n * step);
      if (d >= to) break;
      if (!r.months?.length || r.months.includes(d.getMonth() + 1)) out.push({ date: d, type: r.type });
      n++;
    }
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

function parseSchedule(raw: string): ManualPickup[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as ManualPickup[]) : [];
  } catch {
    return [];
  }
}

export const wasteManual: WasteProvider = {
  meta: {
    id: "manual",
    category: "waste",
    name: "Eget schema",
    description: "Skriv själv när kärlen töms – fast intervall, t.ex. varannan vecka, gärna olika per säsong.",
    status: "stable",
    fields: [{ key: "schedule", label: "Kärl och intervall", type: "schedule" }],
    guide: [
      "Lägg till ett kärl per sorts avfall och ange en hämtdag du vet och hur ofta det töms.",
      "Töms det tätare på sommaren: lägg till samma kärl två gånger med olika månader.",
    ],
  },
  async test(ctx) {
    const rows = parseSchedule(ctx.str("schedule"));
    if (!rows.length) throw new Error("Lägg till minst ett kärl.");
    const now = startOfDay(new Date());
    return { ok: true, preview: expandManual(rows, now, addDays(now, 60)).slice(0, 6).map(fmt) };
  },
  async fetch(ctx) {
    const now = startOfDay(new Date());
    return expandManual(parseSchedule(ctx.str("schedule")), now, addDays(now, 21));
  },
};

export const wasteIcs: WasteProvider = {
  meta: {
    id: "waste-ics",
    category: "waste",
    name: "Kalenderlänk",
    description: "Om din kommun erbjuder hämtschemat som prenumererbar kalender.",
    status: "stable",
    fields: [{ key: "url", label: "Kalenderlänk (ICS/webcal)", type: "url", secret: true }],
    guide: ["Sök på din kommuns webb efter \"hämtschema kalender\" eller \"prenumerera tömningsdagar\"."],
  },
  async test(ctx) {
    const url = ctx.secret("url");
    if (!url) throw new Error("Klistra in kalenderlänken.");
    const now = new Date();
    const evs = await fetchIcs(url, now, new Date(now.getTime() + 45 * 86_400_000));
    return { ok: true, preview: evs.slice(0, 6).map((e) => fmt({ date: e.start, type: e.title })) };
  },
  async fetch(ctx) {
    const url = ctx.secret("url");
    if (!url) return [];
    const now = new Date();
    return (await fetchIcs(url, now, new Date(now.getTime() + 21 * 86_400_000))).map((e) => ({ date: e.start, type: e.title }));
  },
};

export const wasteHa: WasteProvider = {
  meta: {
    id: "waste-ha",
    category: "waste",
    name: "Från Home Assistant",
    description: "Använd en kalender från t.ex. Waste Collection Schedule (stöder ett 50-tal svenska renhållare).",
    status: "stable",
    needsHa: true,
    fields: [{ key: "entityId", label: "Kalender", type: "entity", domains: ["calendar"] }],
  },
  async test(ctx) {
    const evs = await this.fetch(ctx);
    return { ok: true, preview: evs.slice(0, 6).map(fmt) };
  },
  async fetch(ctx) {
    const conn = haConnection();
    if (!conn) throw new Error("Home Assistant är inte anslutet.");
    const now = new Date();
    const evs = await ha.calendarEvents(conn, ctx.str("entityId"), now, new Date(now.getTime() + 21 * 86_400_000));
    return evs.map((e) => ({ date: e.start, type: e.title }));
  },
};
