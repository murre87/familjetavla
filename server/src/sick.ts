import type { SourcedEvent } from "./sources.js";
import { loadLocal, saveLocal } from "./store.js";
import { addDays, dayKey, startOfDay } from "./time.js";

/** Sjuk/VAB: days per child when förskola, school and activities are struck from the board. */
export function loadSick(): Record<string, string[]> {
  return loadLocal().sick ?? {};
}

export function setSick(personId: string, date: string, sick: boolean, now = new Date()) {
  const all = { ...loadSick() };
  // Keep two weeks back at most – old sick days are of no use.
  const oldest = dayKey(addDays(startOfDay(now), -14));
  const days = new Set((all[personId] ?? []).filter((d) => d >= oldest));
  if (sick) days.add(date);
  else days.delete(date);
  if (days.size) all[personId] = [...days].sort();
  else delete all[personId];
  saveLocal({ sick: all });
}

export const isSickOn = (sick: Record<string, string[]>, personId: string | undefined, d: Date) => Boolean(personId && sick[personId]?.includes(dayKey(d)));

/**
 * Takes away a sick child's events that day (förskola, lessons, training, own events) and puts in one
 * "Sjuk" marker instead, so the week, Nu, the duties and the notifications all follow.
 */
export function applySick(events: SourcedEvent[], sick: Record<string, string[]>): { kept: SourcedEvent[]; hidden: SourcedEvent[] } {
  const kept: SourcedEvent[] = [];
  const hidden: SourcedEvent[] = [];
  for (const e of events) (isSickOn(sick, e.personId, e.start) && e.sourceId !== "sick" ? hidden : kept).push(e);
  for (const [personId, days] of Object.entries(sick)) {
    for (const d of days) {
      const [y, m, day] = d.split("-").map(Number);
      kept.push({ sourceId: "sick", uid: `sick-${personId}-${d}`, title: "Sjuk – hemma", start: new Date(y, m - 1, day), end: new Date(y, m - 1, day + 1), allDay: true, personId, category: "family", ignoreCustody: true });
    }
  }
  return { kept, hidden };
}

// ---------- Lov (days off school) ----------

/** Lov: days a child is off school or förskola (a holiday week, a study day). Activities stay, school and pick-up/drop-off go. */
export function loadLeave(): Record<string, string[]> {
  return loadLocal().leave ?? {};
}

/** Every day from `from` to `to` (inclusive), at most 60; a "to" before "from" gives just the first day. */
export function expandDays(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to < from ? from : to}T00:00:00`);
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 60; d = addDays(d, 1)) out.push(dayKey(d));
  return out;
}

/** Marks every day from `from` to `to` as lov or removes the mark. */
export function setLeave(personId: string, from: string, to: string, on: boolean, now = new Date()) {
  const all = { ...loadLeave() };
  const days = new Set((all[personId] ?? []).filter((d) => d >= dayKey(addDays(startOfDay(now), -14))));
  for (const d of expandDays(from, to)) {
    if (on) days.add(d);
    else days.delete(d);
  }
  if (days.size) all[personId] = [...days].sort();
  else delete all[personId];
  saveLocal({ leave: all });
}

const isSchoolOrCare = (e: SourcedEvent) => e.category === "school" || e.sourceId.startsWith("school:") || e.sourceId.startsWith("care:");

/** Takes a child's school, förskola and pick-up/drop-off away on lov days and puts in one "Lov" marker; activities stay. */
export function applyLeave(events: SourcedEvent[], leave: Record<string, string[]>): SourcedEvent[] {
  const kept = events.filter((e) => !(e.personId && leave[e.personId]?.includes(dayKey(e.start)) && isSchoolOrCare(e) && e.sourceId !== "leave"));
  for (const [personId, days] of Object.entries(leave)) {
    for (const d of days) {
      const [y, m, day] = d.split("-").map(Number);
      kept.push({ sourceId: "leave", uid: `leave-${personId}-${d}`, title: "Lov – ledig", start: new Date(y!, m! - 1, day), end: new Date(y!, m! - 1, day! + 1), allDay: true, personId, category: "family" } as SourcedEvent);
    }
  }
  return kept;
}
