import { loadLocal, saveLocal } from "./store.js";
import { addDays, dayKey, daysBetween, shortWeekday, startOfDay } from "./time.js";
import type { MealDay } from "./types.js";
export { MEAL_STOPWORDS, sameAsLunch } from "./mealwords.js";

const WEEKDAYS = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];

/**
 * Which date a menu line is for. Menus say "Måndag 19/10" (skolmaten, Skolmat i HA) or just
 * "Måndag" (Vklass); without a date the next such weekday within the week is used.
 */
export function menuDate(label: string, today: Date): Date | null {
  const m = /(\d{1,2})\/(\d{1,2})/.exec(label);
  if (m) {
    const d = new Date(today.getFullYear(), Number(m[2]) - 1, Number(m[1]));
    // Around new year the menu can be for next year.
    if (daysBetween(today, d) < -180) d.setFullYear(d.getFullYear() + 1);
    return d;
  }
  const wd = WEEKDAYS.findIndex((w) => label.toLowerCase().includes(w));
  if (wd < 0) return null;
  const isoDay = wd === 0 ? 7 : wd;
  // "Vecka 43" / "v43" on the menu: that exact ISO week.
  const wk = /\bv(?:ecka)?\.?\s*(\d{1,2})\b/i.exec(label);
  if (wk) return dateOfIsoWeek(Number(wk[1]), isoDay, today);
  // No week given: only this week. On a Sunday evening Vklass still shows this week's menu,
  // so "Måndag" must never jump ahead to tomorrow – better an empty day than the wrong lunch.
  const monday = addDays(startOfDay(today), -((today.getDay() + 6) % 7));
  return addDays(monday, isoDay - 1);
}

/** Date of weekday (1–7) in ISO week `week`, in the year closest to `near`. */
function dateOfIsoWeek(week: number, isoDay: number, near: Date): Date {
  let best: Date | null = null;
  for (const y of [near.getFullYear() - 1, near.getFullYear(), near.getFullYear() + 1]) {
    const jan4 = new Date(y, 0, 4);
    const week1Monday = addDays(jan4, -((jan4.getDay() + 6) % 7));
    const d = addDays(week1Monday, (week - 1) * 7 + isoDay - 1);
    if (!best || Math.abs(daysBetween(near, d)) < Math.abs(daysBetween(near, best))) best = d;
  }
  return best!;
}

/** Dinners from a calendar of the week's menu (Paprika, a meal planner): one text per day, "Middag: " in front is dropped. */
export function dinnersFromEvents(evs: { title: string; start: Date }[]): Record<string, string> {
  const out: Record<string, string[]> = {};
  for (const e of evs) {
    const t = e.title.replace(/^\s*middag\s*[:\-–]\s*/i, "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!t) continue;
    const list = (out[dayKey(e.start)] ??= []);
    if (!list.some((x) => x.toLowerCase() === t.toLowerCase())) list.push(t);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join(" · ")]));
}

export function loadDinners(): Record<string, string> {
  return loadLocal().dinners ?? {};
}

/** Save one day's dinner ("" clears). Days older than a week are dropped. */
export function saveDinner(day: string, text: string, now = new Date(), shopping?: string) {
  const local = loadLocal();
  const all = { ...(local.dinners ?? {}) };
  const clean = text.trim().slice(0, 80);
  const before = all[day];
  if (clean) all[day] = clean;
  else delete all[day];
  const cutoff = dayKey(addDays(startOfDay(now), -7));
  for (const k of Object.keys(all)) if (k < cutoff) delete all[k];
  // Learn favourites: count each new choice, remember what was bought for it.
  const stats = { ...(local.dinnerStats ?? {}) };
  const k = clean.toLowerCase();
  if (clean && (before ?? "").toLowerCase() !== k) stats[k] = { ...stats[k], count: (stats[k]?.count ?? 0) + 1, last: dayKey(now), shopping: stats[k]?.shopping };
  if (clean && shopping?.trim()) stats[k] = { ...(stats[k] ?? { count: 1, last: dayKey(now) }), shopping: shopping.trim().slice(0, 200) };
  // Keep the list small: the 60 most used.
  const kept = Object.entries(stats).sort((a, b) => b[1].count - a[1].count || b[1].last.localeCompare(a[1].last)).slice(0, 60);
  saveLocal({ dinners: all, dinnerStats: Object.fromEntries(kept) });
}

/** Ideas when the family has no history yet. */
const STARTERS = ["Tacos", "Köttfärssås och spagetti", "Lax i ugn", "Korv stroganoff", "Pannkakor", "Fiskpinnar", "Kycklinggryta", "Soppa och smörgås"];

/** Up to 12 favourites: most chosen first, filled up with a few starters for a new family. */
export function mealFavorites(now = new Date()): { name: string; shopping?: string }[] {
  void now;
  const stats = loadLocal().dinnerStats ?? {};
  const learned = Object.entries(stats)
    .sort((a, b) => b[1].count - a[1].count || b[1].last.localeCompare(a[1].last))
    .map(([k, v]) => ({ name: k[0].toUpperCase() + k.slice(1), shopping: v.shopping }));
  const names = new Set(learned.map((f) => f.name.toLowerCase()));
  const starters = learned.length >= 8 ? [] : STARTERS.filter((s) => !names.has(s.toLowerCase())).map((name) => ({ name }));
  return [...learned, ...starters].slice(0, 12);
}

export function loadShelf(): Record<string, string[]> {
  return loadLocal().shelf ?? {};
}

export function saveShelf(personId: string, items: string[]) {
  const all = { ...loadShelf() };
  const clean = [...new Set(items.map((i) => i.trim().slice(0, 30)).filter(Boolean))].slice(0, 10);
  if (clean.length) all[personId] = clean;
  else delete all[personId];
  saveLocal({ shelf: all });
}

/** The coming 7 days: school/förskola lunch per child next to the family's dinner. */
export function buildMeals(food: { child: string; day: string; dishes: string[] }[], dinners: Record<string, string>, now: Date): MealDay[] {
  const today = startOfDay(now);
  const days: MealDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    const key = dayKey(d);
    days.push({ dayKey: key, dayLabel: i === 0 ? "idag" : i === 1 ? "imorgon" : `${shortWeekday(d).toLowerCase()} ${d.getDate()}/${d.getMonth() + 1}`, dinner: dinners[key], lunch: [] });
  }
  for (const f of food) {
    const d = menuDate(f.day, today);
    const day = d && days.find((x) => x.dayKey === dayKey(d));
    if (!day || !f.dishes.length) continue;
    // Several children on the same menu: one line with both names.
    const same = day.lunch.find((l) => l.dishes.join("|") === f.dishes.join("|"));
    if (same) {
      if (f.child && !same.child.split(" och ").includes(f.child)) same.child = same.child ? `${same.child} och ${f.child}` : f.child;
    } else day.lunch.push({ child: f.child, dishes: f.dishes });
  }
  return days;
}

/** "Pannkakor" for dinner when the kids had pannkakor for lunch – words of 5+ letters in common. */
