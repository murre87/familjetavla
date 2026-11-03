import { alertReceivers, homeAlerts, newHomeMemory } from "./homealerts.js";
import type { FastifyBaseLogger } from "fastify";
import { ha, haConnection } from "./connectors/ha.js";
import { buildDashboard, gatherFamily } from "./dashboard.js";
import { haSocket } from "./connectors/haws.js";
import { buildPlan, dutyMessage, duties, needsAttention, type Duty } from "./plan.js";
import { loadShelf, saveShelf } from "./meals.js";
import { travelKey } from "./travel.js";
import { loadConfig, loadLocal, saveLocal } from "./store.js";
import { collectWaste } from "./sources.js";
import { updateAvailable, updateNotice } from "./updates.js";
import { addDays, hhmm, isoWeekday, startOfDay } from "./time.js";
import type { Person } from "./types.js";

export interface Outgoing {
  service: string;
  title: string;
  message: string;
  key: string;
  /** Buttons in the notification (Home Assistant companion app). */
  actions?: { action: string; title: string }[];
}

/** The button in a drop-off notification that clears "saknas på hyllan" for the child. */
export const SHELF_DONE = "FAMILJETAVLA_LAMNAT:";

const MORNING = "06:45";
const WASTE = "19:30";

const join = (xs: string[]) => xs.join(" · ");

/**
 * Pure: which notifications are due this minute.
 *  - `before` minutes before each duty: "Om 30 min: Hämta Maja på förskolan 16:00"
 *    (a drop-off with something to bring: "… – ta med: blöjor, extrakläder")
 *  - morning (06:45 unless changed): today's "kom ihåg" and what that person is responsible for today
 *  - 19:30 (changeable): "Sopor hämtas imorgon" when a pickup is tomorrow
 *  - 20:00: tomorrow's duties for that person
 *  - Sunday 19:00: "Planera veckan" when something has no one yet
 */
/** Whether this grown-up wants notifications about this child (no choice made = all children). */
export function follows(a: Person, childId: string | undefined): boolean {
  return !childId || !a.notify?.children || a.notify.children.includes(childId);
}

export function dueNotifications(
  adults: Person[],
  list: Duty[],
  missingThisWeek: number,
  missingTomorrow: number,
  now: Date,
  todayItems: { text: string; personId?: string }[] = [],
  wasteTomorrow: string[] = [],
): Outgoing[] {
  const out: Outgoing[] = [];
  const t = hhmm(now);
  const tomorrow = addDays(startOfDay(now), 1);
  const dayAfter = addDays(tomorrow, 1);
  for (const a of adults) {
    const n = a.notify;
    if (!n?.service) continue;
    const mine = list.filter((d) => d.personId === a.id);
    if (n.before && n.before > 0) {
      for (const d of mine) {
        // The usual morning drop-off is routine – only remind when this morning is different,
        // or when something has to come along (blöjor, extrakläder).
        if (d.leg === "to" && d.standard && d.at.getHours() < 10 && !d.bring?.length) continue;
        const fire = new Date(d.at.getTime() - n.before * 60_000);
        if (hhmm(fire) === t && fire.toDateString() === now.toDateString()) {
          const actions = d.bring?.length && d.childId ? [{ action: `${SHELF_DONE}${d.childId}`, title: "Lämnat ✓" }] : undefined;
          out.push({ service: n.service, title: `Om ${n.before} min`, message: dutyMessage(d), key: `before:${a.id}:${d.key}`, actions });
        }
      }
    }
    if (morningTime(a) === t) {
      const today = mine.filter((d) => d.at.toDateString() === now.toDateString() && d.at >= now);
      // Own duties always; the day's list only for the children this grown-up follows.
      const lines = [...today.map((d) => dutyMessage(d)), ...todayItems.filter((i) => follows(a, i.personId)).map((i) => i.text)];
      if (lines.length) out.push({ service: n.service, title: "Idag", message: join(lines), key: `morning:${a.id}:${now.toDateString()}` });
    }
    if (wasteTomorrow.length && wasteTime(a) === t) {
      out.push({
        service: n.service,
        title: "Sopor imorgon",
        message: `${wasteTomorrow.join(", ")} hämtas imorgon – ställ ut kärlet ikväll`,
        key: `waste:${a.id}:${tomorrow.toDateString()}`,
      });
    }
    if (n.evening && t === "20:00") {
      const tm = mine.filter((d) => d.at >= tomorrow && d.at < dayAfter);
      const extra = missingTomorrow ? [`${missingTomorrow} ${missingTomorrow === 1 ? "sak" : "saker"} imorgon saknar ansvarig`] : [];
      if (tm.length || extra.length) {
        // Key includes what is in it, so a changed plan after 20:00 does not stay silent until tomorrow's own reminders.
        const sig = tm.map((d) => `${d.key}${d.bring?.join("+") ?? ""}`).join(",");
        out.push({ service: n.service, title: "Imorgon", message: join([...tm.map((d) => dutyMessage(d)), ...extra]), key: `evening:${a.id}:${tomorrow.toDateString()}:${sig}` });
      }
    }
    if (n.weekly && isoWeekday(now) === 7 && t === "19:00" && missingThisWeek > 0) {
      out.push({
        service: n.service,
        title: "Planera veckan",
        message: `${missingThisWeek} ${missingThisWeek === 1 ? "sak saknar" : "saker saknar"} någon som lämnar, hämtar eller skjutsar. Öppna tavlan och tryck på Planera veckan.`,
        key: `weekly:${a.id}:${now.toDateString()}`,
      });
    }
  }
  return out;
}

const withoutTime = (text: string) => text.replace(/ \d{2}:\d{2}$/, "");
const dayName = (d: Date) => d.toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" }).replace(/\.$/, "");

/**
 * A training or match the grown-up drives to that moved or disappeared from the club's calendar
 * (SportAdmin, laget.se …) within the next two days. `sourcesOk` false (a calendar could not be read)
 * means nothing is called cancelled, since it may just be missing this time.
 */
export function dutyChanges(prev: Duty[], next: Duty[], now: Date, sourcesOk: boolean, eventKeys: Set<string>): { personId: string; title: string; message: string; key: string }[] {
  const out: { personId: string; title: string; message: string; key: string }[] = [];
  const soon = now.getTime() + 48 * 3_600_000;
  const watched = (d: Duty) => d.leg === "to" && !d.key.startsWith("care:") && d.at.getTime() > now.getTime() && d.at.getTime() < soon;
  for (const p of prev.filter(watched)) {
    const same = next.find((n) => n.key === p.key && n.leg === p.leg) ?? next.find((n) => n.leg === p.leg && n.personId === p.personId && withoutTime(n.text) === withoutTime(p.text) && n.at.toDateString() === p.at.toDateString());
    if (same) {
      if (same.at.getTime() !== p.at.getTime()) {
        out.push({
          personId: same.personId,
          title: "Ny tid",
          message: `${withoutTime(p.text)} ${dayName(same.at)}: nu ${hhmm(same.at)} (var ${hhmm(p.at)})`,
          key: `moved:${p.key}:${hhmm(same.at)}`,
        });
      }
    } else if (sourcesOk && !eventKeys.has(p.key.replace(/:(to|home)$/, ""))) {
      // Still in the calendar but nobody drives any more (bus, someone else) is not a cancellation.
      out.push({ personId: p.personId, title: "Inställt?", message: `${withoutTime(p.text)} ${dayName(p.at)} ${hhmm(p.at)} finns inte längre i kalendern`, key: `gone:${p.key}` });
    }
  }
  return out;
}

/** When this grown-up gets the morning notification, or "" when it is off. */
export function morningTime(a: Person): string {
  return a.notify?.morning ?? MORNING;
}

/** When this grown-up gets the evening-before waste notification, or "" when it is off. */
export function wasteTime(a: Person): string {
  return a.notify?.waste ?? WASTE;
}

/** A reminder as one line for the phone: "Regn under dagen – ta regnjackan" (board-only hints left out). */
export function reminderLine(r: { title: string; sub: string }): string {
  return r.sub && !/tryck|bocka|tavlan|planera veckan/i.test(r.sub) ? `${r.title} – ${r.sub.charAt(0).toLowerCase()}${r.sub.slice(1)}` : r.title;
}

/** Checks every minute (only when someone has notifications on) and sends each message once. */
export function startNotifier(log: FastifyBaseLogger) {
  const sent = new Set<string>();
  let lastDuties: Duty[] | null = null;
  // "Lämnat ✓" in the phone: clear what was missing on the shelf, like ticking it off on the board.
  haSocket()?.onAction((action) => {
    if (!action.startsWith(SHELF_DONE)) return;
    const id = action.slice(SHELF_DONE.length);
    if (loadConfig().people.some((p) => p.id === id && p.care)) {
      saveShelf(id, []);
      log.info("Hyllan bockad av från telefonen");
    }
  });
  let lastMinute = "";
  const homeMem = newHomeMemory();
  const tick = async () => {
    const now = new Date();
    const minute = `${now.toDateString()} ${hhmm(now)}`;
    if (minute === lastMinute) return;
    lastMinute = minute;
    const cfg = loadConfig();
    const adults = cfg.people.filter((p) => p.kind === "adult" && p.notify?.service);
    const conn = haConnection();
    if (!adults.length || !conn || !cfg.setupComplete) return;
    try {
      const errors: { source: string; message: string }[] = [];
      const fam = await gatherFamily(cfg, now, errors);
      const list = duties(fam.withCare, fam.people, fam.travelCtx, now, addDays(startOfDay(now), 3), loadShelf());
      // Trainings that moved or were cancelled since the last look: tell the one who drives.
      // A sick child's training is struck on purpose – not "inställd".
      const eventKeys = new Set([...fam.withCare, ...fam.hiddenSick].map((e) => travelKey(e)));
      const changes = lastDuties ? dutyChanges(lastDuties, list, now, errors.length === 0, eventKeys) : [];
      lastDuties = list;
      for (const c of changes) {
        const a = adults.find((x) => x.id === c.personId);
        if (!a?.notify?.service || sent.has(c.key)) continue;
        sent.add(c.key);
        await ha.service(conn, "notify", a.notify.service, { title: c.title, message: c.message }).catch((e) => log.warn(`Notis till ${a.notify!.service} misslyckades: ${(e as Error).message}`));
      }
      const plan = buildPlan(fam.withCare, fam.people, fam.travelCtx, now, () => ({ time: "", title: "", color: "", who: "", category: "family", icon: "event" }));
      const missingTomorrow = plan.items.filter((i) => i.dayLabel === "imorgon" && needsAttention(i)).length;
      // The morning list is the board's own "kom ihåg" – only built in the minute someone gets it.
      const t = hhmm(now);
      const todayItems = adults.some((a) => morningTime(a) === t) ? (await buildDashboard(now, { allReminders: true })).reminders.map((r) => ({ text: reminderLine(r), personId: r.personId })) : [];
      // Tomorrow's waste pickups – only looked up in the minute someone gets that notification.
      let wasteTomorrow: string[] = [];
      if (adults.some((a) => wasteTime(a) === t)) {
        const tomorrowKey = addDays(startOfDay(now), 1).toDateString();
        wasteTomorrow = [...new Set((await collectWaste(cfg, [])).filter((w) => startOfDay(w.date).toDateString() === tomorrowKey).map((w) => w.type))];
      }
      for (const m of dueNotifications(adults, list, plan.missing, missingTomorrow, now, todayItems, wasteTomorrow)) {
        if (sent.has(m.key)) continue;
        sent.add(m.key);
        await ha.service(conn, "notify", m.service, { title: m.title, message: m.message, ...(m.actions ? { data: { actions: m.actions } } : {}) }).catch((e) => log.warn(`Notis till ${m.service} misslyckades: ${(e as Error).message}`));
      }
      // Hemmet: machines, robots, doors, garage, alarm – to the adults at home.
      const sec = cfg.entities.security;
      if ((cfg.entities.appliances ?? []).length || (cfg.entities.robots ?? []).length || sec) {
        const states = new Map((await ha.states(conn)).map((s) => [s.entity_id, s]));
        for (const alert of homeAlerts(cfg, states, homeMem, now)) {
          if (sent.has(alert.key)) continue;
          sent.add(alert.key);
          for (const a of alertReceivers(adults, states, alert.to)) {
            await ha.service(conn, "notify", a.notify!.service!, { title: alert.title, message: alert.message }).catch((e) => log.warn(`Notis till ${a.notify!.service} misslyckades: ${(e as Error).message}`));
          }
        }
      }
      // Ny version av Familjetavlan: en notis per version, till de vuxna som har notiser på.
      const notice = updateNotice(updateAvailable(), loadLocal().updateNotified);
      if (notice) {
        for (const a of adults.filter((x) => x.notify?.updates !== false)) {
          await ha.service(conn, "notify", a.notify!.service!, { title: notice.title, message: notice.message }).catch((e) => log.warn(`Notis till ${a.notify!.service} misslyckades: ${(e as Error).message}`));
        }
        saveLocal({ updateNotified: notice.version });
      }
      if (sent.size > 2000) sent.clear();
    } catch (e) {
      log.warn(`Påminnelser: ${(e as Error).message}`);
    }
  };
  return setInterval(() => void tick(), 20_000);
}
