import type { SchoolData, SourcedEvent } from "./sources.js";
import { loadLocal, saveLocal, type OwnEvent } from "./store.js";
import { addDays } from "./time.js";
import type { Person, Reminder, SchoolNews } from "./types.js";

const SHORT_MONTHS = ["jan", "feb", "mars", "apr", "maj", "juni", "juli", "aug", "sep", "okt", "nov", "dec"];

/** News for the board, newest first, with who it is about and whether someone has read it. */
export function buildSchoolNews(news: SchoolData["news"], people: Map<string, Person>): SchoolNews[] {
  const seen = new Set(loadLocal().newsSeen ?? []);
  const unique = new Map<string, SchoolData["news"][number]>();
  for (const n of news) if (!unique.has(n.id)) unique.set(n.id, n);
  return [...unique.values()]
    .sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""))
    .slice(0, 20)
    .map((n) => {
      const p = n.personId ? people.get(n.personId) : undefined;
      const d = n.published ? new Date(n.published) : undefined;
      return {
        id: n.id,
        personId: n.personId,
        who: p?.name,
        color: p?.color,
        title: n.title,
        text: n.text,
        published: n.published,
        date: d ? `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}` : undefined,
        // Vklass's own files need the family's login, so the board fetches them; other links open as they are.
        files: n.files.map((f) => ({ name: f.name, url: /^https:\/\/[a-z0-9.-]*vklass\.se\//i.test(f.url) ? `api/school/file?u=${encodeURIComponent(f.url)}` : f.url })),
        seen: seen.has(n.id),
      };
    });
}

/** Unread news from the last week in Kom ihåg (at most two, the rest are on Skolan). */
export function newsReminders(news: SchoolNews[], now: Date): Reminder[] {
  const week = now.getTime() - 7 * 86_400_000;
  return news
    .filter((n) => !n.seen && (!n.published || Date.parse(n.published) >= week))
    .slice(0, 2)
    .map((n) => ({ icon: "school" as const, title: `Från skolan: ${n.title}`, sub: `${n.who ? `${n.who} · ` : ""}tryck för att läsa`, tone: "blue" as const, personId: n.personId, newsId: n.id }));
}

// ---------- Utflykt, matsäck … from school news ----------

const TRIP = /utflykt|friluftsdag|skogsdag|studiebesök|exkursion|skridskodag|skiddag|idrottsdag|temadag|teaterbesök|biblioteksbesök/i;
const BRING: [RegExp, string][] = [
  [/matsäck/i, "matsäck"],
  [/vattenflask/i, "vattenflaska"],
  [/ombyte|extrakläder/i, "ombyteskläder"],
  [/gymnastikkläder|idrottskläder|gympakläder/i, "idrottskläder"],
  [/regnkläder|regnställ/i, "regnkläder"],
  [/sittunderlag/i, "sittunderlag"],
  [/skridsko/i, "skridskor"],
  [/hjälm/i, "hjälm"],
  [/skidor|längdskid/i, "skidor"],
  [/busskort|reskort/i, "busskort"],
  [/lånekort|bibliotekskort/i, "lånekort"],
];
const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const WEEKDAYS = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];

/** Dates mentioned in a text ("27/10", "27 oktober", "på torsdag"), from the day it was written. */
export function datesIn(text: string, from: Date): Date[] {
  const out: Date[] = [];
  const year = (m: number, d: number) => {
    const c = new Date(from.getFullYear(), m, d);
    return c.getTime() < from.getTime() - 60 * 86_400_000 ? new Date(from.getFullYear() + 1, m, d) : c;
  };
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)) {
    const d = Number(m[1]);
    const mo = Number(m[2]) - 1;
    if (d >= 1 && d <= 31 && mo >= 0 && mo <= 11) out.push(year(mo, d));
  }
  for (const m of text.toLowerCase().matchAll(/\b(\d{1,2})(?::e|e)?\s+(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)[a-zåäö]*/g)) {
    out.push(year(MONTHS.indexOf(m[2]), Number(m[1])));
  }
  for (const m of text.toLowerCase().matchAll(/\b(måndag|tisdag|onsdag|torsdag|fredag)(en)?\b/g)) {
    const wd = WEEKDAYS.indexOf(m[1]);
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    do d.setDate(d.getDate() + 1);
    while (d.getDay() !== wd);
    out.push(d);
  }
  return out;
}

/**
 * Trips and things to bring that the school writes about: "Ella · utflykt imorgon – ta med matsäck,
 * vattenflaska". Shown the day before and on the day, so they also reach the morning notification.
 */
export function newsTripReminders(news: SchoolNews[], now: Date): Reminder[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = addDays(today, 1); // not +24 h: the day the clock goes back is 25 hours long
  const out: Reminder[] = [];
  const recent = now.getTime() - 21 * 86_400_000;
  for (const n of news) {
    if (n.published && Date.parse(n.published) < recent) continue;
    const text = `${n.title}\n${n.text}`;
    const trip = text.match(TRIP)?.[0];
    const bring = BRING.filter(([re]) => re.test(text)).map(([, what]) => what);
    if (!trip && !bring.length) continue;
    const written = n.published ? new Date(n.published) : now;
    const day = datesIn(text, written).find((d) => d.getTime() === today.getTime() || d.getTime() === tomorrow.getTime());
    if (!day) continue;
    const when = day.getTime() === today.getTime() ? "idag" : "imorgon";
    const what = trip ? trip.toLowerCase() : n.title;
    out.push({
      icon: "bag",
      title: `${n.who ? `${n.who} · ` : ""}${what} ${when}${bring.length ? ` – ta med ${bring.join(", ")}` : ""}`,
      sub: `Från skolan: ${n.title}`,
      tone: "amber",
      personId: n.personId,
    });
  }
  return out.slice(0, 2);
}

export function markNewsSeen(ids: string[]) {
  const all = [...new Set([...ids, ...(loadLocal().newsSeen ?? [])])].slice(0, 200);
  saveLocal({ newsSeen: all });
}

// ---------- Own events ----------

export function loadOwnEvents(): OwnEvent[] {
  return loadLocal().ownEvents ?? [];
}

export function addOwnEvent(e: Omit<OwnEvent, "id">, now = new Date()): OwnEvent {
  const ev = { ...e, id: `own${now.getTime().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}` };
  // Old events (more than a week ago) are dropped so the file stays small.
  const cutoff = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  saveLocal({ ownEvents: [...loadOwnEvents().filter((x) => x.date >= cutoff), ev] });
  return ev;
}

export function removeOwnEvent(id: string) {
  saveLocal({ ownEvents: loadOwnEvents().filter((e) => e.id !== id) });
}

/** Own events as calendar events, so they show in the week, Nu and Planera veckan like any other. */
export function ownCalendarEvents(): SourcedEvent[] {
  return loadOwnEvents().map((e) => {
    const [y, m, d] = e.date.split("-").map(Number);
    const at = (t?: string) => (t ? new Date(y, m - 1, d, Number(t.slice(0, 2)), Number(t.slice(3, 5))) : new Date(y, m - 1, d));
    const start = at(e.time);
    const end = e.time ? (e.end ? at(e.end) : new Date(start.getTime() + 60 * 60_000)) : new Date(y, m - 1, d + 1);
    return { sourceId: "own", uid: e.id, title: e.title, description: e.note, start, end, allDay: !e.time, personId: e.personId, category: "family" as const };
  });
}
