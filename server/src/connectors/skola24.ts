import { fetchWithTimeout } from "../http.js";
import type { CalEvent } from "./ics.js";

/**
 * Skola24 (timetable viewer) – unofficial, the open calls the viewer on web.skola24.se makes itself,
 * as mapped by github.com/TekniskSupport/home-assistant-skola24-to-ical:
 *   units of a municipality (hostname) → classes of a unit → encrypted selection → render key
 *   → active school year → render/timetable per ISO week (lessons with start/end time and texts).
 * No login: a class timetable is public; a child's own timetable uses the personal number, encrypted by Skola24.
 */

const API = "https://web.skola24.se/api";
// The scope the viewer itself sends (it is in the page's JavaScript, not a secret).
const SCOPE = "8a22163c-8662-4535-9050-bc5e1923df48";

async function call<T>(path: string, body: unknown = null): Promise<T> {
  const res = await fetchWithTimeout(`${API}/${path}`, {
    method: "POST",
    headers: { "X-Scope": SCOPE, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 20_000,
  });
  if (!res.ok) throw new Error(`Skola24 svarade ${res.status}`);
  const j = (await res.json()) as { data?: T; error?: unknown; validation?: unknown[]; exception?: unknown };
  const v = (j.validation as { message?: string }[] | undefined)?.[0]?.message;
  if (v) throw new Error(`Skola24: ${v}`);
  if (j.error || j.exception) throw new Error(`Skola24: ${JSON.stringify(j.error ?? j.exception).slice(0, 160)}`);
  return j.data as T;
}

/** "jonkoping.skola24.se" from what a person writes ("Jönköping", "jonkoping", the full address). */
export function skola24Host(input: string): string {
  const t = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!t) return "";
  if (t.endsWith(".skola24.se")) return t;
  const slug = t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/å|ä/g, "a").replace(/ö/g, "o").replace(/[^a-z0-9]/g, "");
  return `${slug}.skola24.se`;
}

export interface Skola24Unit {
  unitId: string;
  unitGuid: string;
}

export async function skola24Units(host: string): Promise<Skola24Unit[]> {
  const d = await call<{ getTimetableViewerUnitsResponse?: { units?: Skola24Unit[] } }>("services/skola24/get/timetable/viewer/units", { getTimetableViewerUnitsRequest: { hostname: host } });
  return d.getTimetableViewerUnitsResponse?.units ?? [];
}

export async function skola24Classes(host: string, unitGuid: string): Promise<{ groupName: string; groupGuid: string }[]> {
  const d = await call<{ classes?: { groupName: string; groupGuid: string }[] }>("get/timetable/selection", { hostname: host, unitGuid, filters: { class: "true" } });
  return d.classes ?? [];
}

interface Lesson {
  timeStart?: string | null;
  timeEnd?: string | null;
  dayOfWeekNumber?: number;
  texts?: string[];
}

function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { year: t.getUTCFullYear(), week: Math.ceil(((t.getTime() - jan1.getTime()) / 86_400_000 + 1) / 7) };
}

function dateOfIsoWeek(year: number, week: number, isoDay: number): Date {
  const jan4 = new Date(year, 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (week - 1) * 7 + (isoDay - 1));
  return monday;
}

/** Lessons between `from` and `to` as calendar events (the title is the subject, the room goes in `location`). */
export async function skola24Lessons(opts: { host: string; unitGuid: string; classGuid?: string; personalNumber?: string }, from: Date, to: Date): Promise<CalEvent[]> {
  const { host, unitGuid } = opts;
  let selection: string;
  let selectionType: number;
  if (opts.personalNumber) {
    selection = (await call<{ signature: string }>("encrypt/signature", { signature: opts.personalNumber })).signature;
    selectionType = 4;
  } else if (opts.classGuid) {
    selection = opts.classGuid;
    selectionType = 0;
  } else throw new Error("Skola24: välj klass (eller ange barnets personnummer).");
  const key = (await call<{ key: string }>("get/timetable/render/key")).key;
  const years = await call<{ activeSchoolYears?: { guid: string }[] }>("get/active/school/years", { hostName: host, checkSchoolYearsFeatures: "false" });
  const schoolYear = years.activeSchoolYears?.[0]?.guid;
  if (!schoolYear) throw new Error("Skola24: hittade inget aktivt läsår.");

  const weeks = new Map<string, { year: number; week: number }>();
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const w = isoWeek(d);
    weeks.set(`${w.year}-${w.week}`, w);
  }
  const events: CalEvent[] = [];
  for (const { year, week } of [...weeks.values()].slice(0, 6)) {
    const data = await call<{ lessonInfo?: Lesson[] | null }>("render/timetable", {
      renderKey: key,
      host,
      unitGuid,
      startDate: "null",
      endDate: "null",
      scheduleDay: 0,
      blackAndWhite: "false",
      width: 1223,
      height: 550,
      schoolYear,
      selectionType,
      selection,
      showHeader: "false",
      periodText: "",
      week,
      year,
      privateFreeTextMode: "false",
      privateSelectionMode: "null",
      customerKey: "",
    });
    const seen = new Set<string>();
    for (const l of data.lessonInfo ?? []) {
      if (!l.timeStart || !l.timeEnd || !l.dayOfWeekNumber) continue;
      const day = dateOfIsoWeek(year, week, l.dayOfWeekNumber === 0 ? 7 : l.dayOfWeekNumber);
      const at = (t: string) => {
        const [h, m] = t.split(":").map(Number);
        return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h ?? 0, m ?? 0);
      };
      const title = l.texts?.[0]?.trim() ?? "";
      const start = at(l.timeStart);
      const id = `${start.getTime()}-${title}`;
      if (!title || seen.has(id)) continue;
      seen.add(id);
      events.push({ start, end: at(l.timeEnd), allDay: false, title, location: l.texts?.[2]?.trim() || undefined, description: l.texts?.slice(1).filter(Boolean).join(" · ") || undefined });
    }
  }
  return events.filter((e) => e.end >= from && e.start <= to).sort((a, b) => a.start.getTime() - b.start.getTime());
}
