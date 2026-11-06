import type { SourcedEvent } from "./sources.js";
import { boardFiles } from "./files.js";
import type { Dashboard, Person, SchoolChild } from "./types.js";

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** Calendar days, not 24-hour steps – the clocks change in March and October. */
const plusDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const SHORT = ["sön", "mån", "tis", "ons", "tor", "fre", "lör"];

/**
 * When each child's school day starts and ends, from the lessons the school platform gives us.
 * Today until the last lesson is over (plus a quarter), then the next school day.
 * Evening things in the school calendar (parent meetings) and all-day items don't count.
 */
export function buildSchoolDays(
  events: SourcedEvent[],
  people: Map<string, Person>,
  now: Date,
  isHere: (ev: SourcedEvent, day: Date) => boolean = () => true,
): Dashboard["schoolDay"] {
  const lessons = events.filter((e) => {
    if (!e.sourceId.startsWith("school:") || e.allDay || e.task || !e.personId) return false;
    const h = e.start.getHours();
    const endsBy = e.end.getHours() + e.end.getMinutes() / 60;
    return h >= 6 && h < 17 && endsBy <= 18 && e.end > e.start;
  });
  const today = startOfDay(now);
  const out: NonNullable<Dashboard["schoolDay"]> = [];
  for (const p of people.values()) {
    if (p.kind !== "child") continue;
    const mine = lessons.filter((e) => e.personId === p.id);
    for (let i = 0; i < 5; i++) {
      const day = plusDays(today, i);
      const next = plusDays(day, 1);
      const that = mine.filter((e) => e.start >= day && e.start < next && isHere(e, day));
      if (!that.length) continue;
      const start = new Date(Math.min(...that.map((e) => e.start.getTime())));
      const end = new Date(Math.max(...that.map((e) => e.end.getTime())));
      if (i === 0 && now.getTime() > end.getTime() + 15 * 60_000) continue;
      out.push({
        personId: p.id,
        name: p.name,
        color: p.color,
        dayLabel: i === 0 ? "idag" : i === 1 ? "imorgon" : SHORT[day.getDay()],
        start: hm(start),
        end: hm(end),
        gym: that.some((e) => e.gym),
      });
      break;
    }
  }
  // Soonest first: today's children before tomorrow's, then by end time.
  const order = (l: string) => (l === "idag" ? 0 : l === "imorgon" ? 1 : 2);
  return out.sort((a, b) => order(a.dayLabel) - order(b.dayLabel) || a.end.localeCompare(b.end));
}

const LONG = ["Söndag", "Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag"];
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "Läxa: glosor kap 3", "Prov i matte", "Inlämning NO-rapport" … */
const TASK = /(läx|glosor|förhör|prov\b|provet|diagnos|nationella|inlämning|lämna in|deadline|uppgift|redovisning|test\b)/i;

export function taskKind(title: string): SchoolChild["tasks"][number]["kind"] {
  if (/läx|glosor/i.test(title)) return "läxa";
  if (/prov|förhör|diagnos|nationella|test\b/i.test(title)) return "prov";
  if (/inlämning|lämna in|deadline|redovisning/i.test(title)) return "inlämning";
  return "uppgift";
}

/**
 * The school page: Monday–Friday of this week (next week on the weekend) with every lesson,
 * and homework, tests and hand-ins for the coming two weeks, per child.
 * Tasks are school-calendar items that say so ("Läxa", "Prov", "Inlämning" …); all-day
 * school items that aren't closures count too.
 */
export function buildSchoolWeek(
  events: SourcedEvent[],
  people: Map<string, Person>,
  now: Date,
  isHere: (ev: SourcedEvent, day: Date) => boolean = () => true,
): SchoolChild[] {
  const today = startOfDay(now);
  const dow = today.getDay();
  // Weekend → next week; otherwise this week's Monday.
  const monday = plusDays(today, dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow);
  const school = events.filter((e) => (e.sourceId.startsWith("school:") || e.category === "school") && e.personId);
  const out: SchoolChild[] = [];
  for (const p of people.values()) {
    if (p.kind !== "child") continue;
    const mine = school.filter((e) => e.personId === p.id);
    if (!mine.length) continue;
    const days: SchoolChild["days"] = [];
    for (let i = 0; i < 5; i++) {
      const day = plusDays(monday, i);
      const next = plusDays(day, 1);
      const lessons = mine
        .filter((e) => !e.allDay && !e.task && e.start >= day && e.start < next && !TASK.test(e.title) && isHere(e, day))
        .sort((a, b) => a.start.getTime() - b.start.getTime())
        .map((e) => ({ start: hm(e.start), end: hm(e.end), title: e.title, location: e.location || undefined, gym: Boolean(e.gym) }));
      days.push({ dayKey: dayKey(day), label: LONG[day.getDay()], today: day.getTime() === today.getTime(), lessons });
    }
    const until = plusDays(today, 14);
    const CLOSED = /stängt|stängd|lov\b|studiedag|planeringsdag|apt\b/i;
    const tasks = mine
      .filter((e) => e.end > today && e.start < until && (e.task || TASK.test(e.title) || (e.allDay && !CLOSED.test(e.title))))
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((e) => {
        const d = startOfDay(e.start);
        const diff = Math.round((d.getTime() - today.getTime()) / DAY); // rounding absorbs the DST hour
        const label = diff <= 0 ? "idag" : diff === 1 ? "imorgon" : `${SHORT[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
        const detail = (e.description ?? "").replace(/<[^>]+>/g, " ").trim();
        return {
          dayKey: dayKey(d),
          label,
          title: e.title,
          // The platform's own word (Läxa, Prov, Uppgift) wins over a guess from the title.
          kind: e.taskKind ?? taskKind(e.title),
          time: e.allDay ? undefined : hm(e.start),
          detail: detail && detail !== e.title ? detail.slice(0, 4000) : undefined,
          url: e.url,
          // Through the board's own file route (it logs in to the school platform for you).
          ...(boardFiles(e.files) ? { files: boardFiles(e.files) } : {}),
        };
      });
    if (!days.some((d) => d.lessons.length) && !tasks.length) continue;
    out.push({ personId: p.id, name: p.name, color: p.color, days, tasks });
  }
  return out;
}
