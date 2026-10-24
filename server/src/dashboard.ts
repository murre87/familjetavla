import { buildAppliances } from "./appliances.js";
import { buildRobots, buildSecurity } from "./security.js";
import { energyLive, energyToday, todaySeries } from "./energy.js";
import { findAutoModes, findSmartCharging } from "./smartcharging.js";
import { choresForToday } from "./chores.js";
import { buildSchoolNews, newsReminders, newsTripReminders, ownCalendarEvents } from "./news.js";
import { updateAvailable, versionInfo } from "./updates.js";
import { buildSchoolDays, buildSchoolWeek } from "./schoolday.js";
import { cached } from "./cache.js";
import { cheapestBlock, priceLevel, type HourPrice } from "./connectors/elpris.js";
import { ha, haConnection, type HaState } from "./connectors/ha.js";
import { buildMusic } from "./music.js";
import { haSocket } from "./connectors/haws.js";
import { applySick, loadSick } from "./sick.js";
import { coldestBetween, forecast, rainBetween, skyNow, sunToday, tempNow, weatherSummary, type Forecast } from "./connectors/weather.js";
import { careTimesFor, custodyStatus, isHome } from "./custody.js";
import {
  collectCalendars,
  collectPrices,
  collectSchool,
  collectWaste,
  groceryIntegration,
  hasPriceExtras,
  totalPrice,
  type SourceError,
  type SchoolData,
  type SourcedEvent,
} from "./sources.js";
import { listPhotos, loadConfig, loadLocal, loadLocalList } from "./store.js";
import { buildPlan, careAt, needsAttention } from "./plan.js";
import { buildMeals, loadDinners, loadShelf, mealFavorites, sameAsLunch } from "./meals.js";
import { isCare, knownDrivers, travelKey, loadTravel, resolveTravel, travelOptions, travelSummary, wantsTravel } from "./travel.js";
import {
  addDays,
  daysBetween,
  dayKey,
  hhmm,
  inTimeWindow,
  isoWeek,
  longDate,
  relativeDay,
  shortDate,
  shortWeekday,
  startOfDay,
  isoWeekday,
} from "./time.js";
import type { ActivityIcon, CalendarSource, Config, Control, DashDay, DashEvent, Dashboard, Person, Reminder, TravelChoice } from "./types.js";

const MIN = 60_000;
const WASTE_COLOR = "#9aa0bf";
const FAMILY_COLOR = "#34e0a1";

/**
 * Swap calendar: an all-day event with the child's name means "here" that day, the name plus
 * "borta" means away. Appended as overrides, so they win over the base rule and earlier overrides.
 */
export function withSwapCalendar(people: Person[], events: SourcedEvent[]): Person[] {
  if (!events.length) return people;
  return people.map((p) => {
    if (p.kind !== "child" || !p.name) return p;
    const name = p.name.toLowerCase();
    const extra: NonNullable<NonNullable<Person["custody"]>["overrides"]> = [];
    for (const e of events) {
      const t = e.title.toLowerCase();
      if (!e.allDay || !t.includes(name)) continue;
      const last = new Date(e.end.getTime() - 1);
      extra.push({ from: dayKey(e.start), to: dayKey(last), home: !/borta|hos (mamma|pappa)|andra hemmet/.test(t) });
    }
    if (!extra.length) return p;
    const custody = p.custody ?? { mode: "always" as const };
    return { ...p, custody: { ...custody, overrides: [...(custody.overrides ?? []), ...extra] } };
  });
}

/** The next few timed things from now until tomorrow evening – the big "Nu" zone. */
/** What toDash needs to attach "Dit/Hem" choices to children's activities. */
export interface TravelCtx {
  saved: Record<string, TravelChoice>;
  calendars: Map<string, CalendarSource>;
}

export function buildNow(events: SourcedEvent[], people: Map<string, Person>, now: Date, travel?: TravelCtx): Dashboard["now"] {
  const until = addDays(startOfDay(now), 2);
  const upcoming = events
    .map((e) => (isCare(e.sourceId) ? careMoment(e, now) : e))
    .filter((e): e is SourcedEvent => Boolean(e))
    .filter((e) => !e.allDay && e.end > now && e.start < until)
    .filter((e) => visibleOn(e, people, startOfDay(e.start)))
    .filter((e) => !e.sourceId.startsWith("school:") || e.gym)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, 3)
    .map((e) => ({
      ...toDash(e, people, travel),
      inMinutes: Math.round((e.start.getTime() - now.getTime()) / 60_000),
      dayLabel: daysBetween(now, e.start) === 0 ? "idag" : daysBetween(now, e.start) === 1 ? "imorgon" : shortWeekday(e.start).toLowerCase(),
    }));
  const first = upcoming[0];
  let headline = "Inget mer inplanerat idag";
  if (first) {
    const m = first.inMinutes;
    if (m <= 0) headline = `Pågår: ${first.title}`;
    else if (m < 60) headline = `Om ${m} min`;
    else if (m < 180) headline = `Om ${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim();
    else headline = first.dayLabel === "idag" ? `Senare idag kl ${first.time}` : `${first.dayLabel[0].toUpperCase()}${first.dayLabel.slice(1)} kl ${first.time}`;
  }
  return { headline, items: upcoming };
}

/** A care day in the Nu zone: "Lämning" until drop-off, then "Hämtning" until pick-up. */
function careMoment(e: SourcedEvent, now: Date): SourcedEvent | null {
  const at = e.start > now ? e.start : e.end > now ? e.end : null;
  if (!at) return null;
  // Drop-off keeps the whole care span (07:30–16:00); pick-up is a short moment at the end.
  if (at === e.start) return { ...e, title: `Lämning · ${e.title}` };
  return { ...e, title: `Hämtning · ${e.title}`, start: at, end: new Date(at.getTime() + 15 * 60_000) };
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} och ${names[names.length - 1]}`;
}

/** Child-owned calendars (sport, school…) only show on days the child is here. */
export function visibleOn(ev: SourcedEvent, people: Map<string, Person>, day: Date): boolean {
  if (!ev.personId || ev.ignoreCustody) return true;
  const p = people.get(ev.personId);
  if (!p || p.kind !== "child") return true;
  return isHome(p.custody, day);
}

function eventsOnDay(events: SourcedEvent[], day: Date): SourcedEvent[] {
  const s = startOfDay(day).getTime();
  const e = addDays(startOfDay(day), 1).getTime();
  return events.filter((ev) => ev.start.getTime() < e && ev.end.getTime() > s && !(ev.allDay && ev.end.getTime() === s));
}

const ICON_RULES: [RegExp, ActivityIcon][] = [
  [/fotboll|football|soccer|match|cup|innebandy|handboll|basket|hockey|bandy|tennis|padel|golf|futsal/i, "ball"],
  [/sim|swim|bad(?!minton)|vattenpolo/i, "swim"],
  [/idrott|gympa|\bidh\b|gymnastik|träning|friidrott|dans|karate|judo|taekwondo|ridning|klättring/i, "gym"],
  [/musik|piano|gitarr|kör\b|sång|fiol|trummor|orkester|kulturskola/i, "music"],
  [/födelsedag|kalas|bday|birthday|fest|party/i, "cake"],
  [/tandläkare|läkare|vårdcentral|bvc|tandvård|doktor|sjukhus|vaccin/i, "health"],
  [/middag|lunch|frukost|mat\b|fika|restaurang|tacos|pizza/i, "food"],
  [/skola|lektion|prov|utvecklingssamtal|föräldramöte|studiedag|lov\b|förskola/i, "school"],
  [/resa|flyg|semester|tåg|hotell|stuga/i, "travel"],
  [/bil|service|besiktning|skjuts|hämta|lämna/i, "car"],
  [/jobb|möte|arbete|work/i, "work"],
];

export function activityIcon(title: string, category: DashEvent["category"]): ActivityIcon {
  if (category === "waste") return "trash";
  for (const [re, icon] of ICON_RULES) if (re.test(title)) return icon;
  if (category === "sport") return "gym";
  if (category === "school") return "school";
  if (category === "work") return "work";
  return "event";
}

function toDash(ev: SourcedEvent, people: Map<string, Person>, travel?: TravelCtx): DashEvent {
  const p = ev.personId ? people.get(ev.personId) : undefined;
  return {
    ...(travel && wantsTravel(ev, people) ? { travel: resolveTravel(ev, people, travel.calendars.get(ev.sourceId), travel.saved) } : {}),
    time: ev.allDay ? "" : hhmm(ev.start),
    end: ev.allDay ? undefined : hhmm(ev.end),
    title: ev.title,
    color: p?.color ?? FAMILY_COLOR,
    who: p?.name ?? "",
    initial: p ? initialsOf(p, people) : undefined,
    category: ev.category,
    icon: ev.gym ? "gym" : activityIcon(`${ev.title} ${ev.sourceName ?? ""}`, ev.category),
    location: ev.location,
    description: cleanDescription(ev.description, ev.title),
    ...(ev.sourceId === "own" && ev.uid ? { ownId: ev.uid } : ev.sourceId !== "sick" ? { cancelKey: travelKey(ev) } : {}),
    ...(p?.kind === "child" ? { sick: { personId: p.id, date: dayKey(ev.start), on: ev.sourceId === "sick" } } : {}),
  };
}

/** Calendar notes as plain text: no HTML, no Teams/Meet boilerplate, at most ~1500 characters. */
function cleanDescription(raw: string | undefined, title: string): string | undefined {
  if (!raw) return undefined;
  const t = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!t || t === title) return undefined;
  return t.length > 1500 ? `${t.slice(0, 1500).trimEnd()}…` : t;
}

/** One letter, or two when two people share the first letter (Emil/Ella → Em/El). */
export function initialsOf(p: Person, people: Map<string, Person>): string {
  const first = p.name.slice(0, 1).toUpperCase();
  const clash = [...people.values()].some((o) => o.id !== p.id && o.name.slice(0, 1).toUpperCase() === first);
  return clash ? `${first}${p.name.slice(1, 2).toLowerCase()}` : first;
}

function phaseOf(now: Date): Dashboard["header"]["phase"] {
  const h = now.getHours() + now.getMinutes() / 60;
  if (h >= 5 && h < 8) return "dawn";
  if (h >= 8 && h < 17.5) return "day";
  if (h >= 17.5 && h < 21) return "dusk";
  return "night";
}

function haValue(states: Map<string, HaState>, id?: string): string | undefined {
  if (!id) return undefined;
  const s = states.get(id);
  if (!s || s.state === "unavailable" || s.state === "unknown") return undefined;
  return s.state;
}

function formatTemp(states: Map<string, HaState>, id: string): string {
  const v = haValue(states, id);
  if (v === undefined) return "–";
  const n = Number(v);
  const unit = String(states.get(id)?.attributes.unit_of_measurement ?? "°");
  return Number.isFinite(n) ? `${n.toFixed(1).replace(".", ",").replace(",0", "")}${unit === "°C" ? "°" : unit}` : v;
}

/** Everything about the family for the coming week: people (with swap calendar), events, care days, travel. */
export interface Family {
  people: Map<string, Person>;
  children: Person[];
  /** Calendars + school, without the swap calendar. */
  all: SourcedEvent[];
  /** `all` plus generated förskola/fritids days. */
  withCare: SourcedEvent[];
  travelCtx: TravelCtx;
}

export async function gatherFamily(cfg: Config, now: Date, errors: SourceError[]): Promise<Family & { schoolFood: SchoolData["food"]; schoolNews: SchoolData["news"]; hiddenSick: SourcedEvent[] }> {
  const today = startOfDay(now);
  const horizon = addDays(today, 7);
  const [calEvents, school] = await Promise.all([collectCalendars(cfg, today, horizon, errors), collectSchool(cfg, today, horizon, errors)]);
  const swapCal = cfg.household.custodyCalendarId;
  const people = new Map(withSwapCalendar(cfg.people, calEvents.filter((e) => e.sourceId === swapCal)).map((p) => [p.id, p]));
  const children = [...people.values()].filter((p) => p.kind === "child");
  // "Utgår": events the family struck on the board are gone everywhere – week, Nu, reminders, phone.
  const cancelled = loadLocal().cancelled ?? {};
  const kept = (e: SourcedEvent) => !cancelled[travelKey(e)];
  const all = [...calEvents.filter((e) => e.sourceId !== swapCal), ...school.events, ...ownCalendarEvents()].filter(kept);
  const careEvents = buildCareEvents([...people.values()], school.care, all, today, 7).filter(kept);
  const travelCtx: TravelCtx = { saved: loadTravel(), calendars: new Map([...cfg.calendars.map((c) => [c.id, c] as const), ...careCalendars([...people.values()])]) };
  // A sick child's förskola, lessons and training are struck that day (one "Sjuk" marker instead).
  const sick = loadSick();
  const withCare = applySick([...all, ...careEvents], sick);
  return { people, children, all: applySick(all, sick).kept, withCare: withCare.kept, hiddenSick: withCare.hidden, travelCtx, schoolFood: school.food, schoolNews: school.news };
}

/** `allReminders`: the morning notification wants every reminder, the board shows the first five. */
export async function buildDashboard(now = new Date(), opts: { allReminders?: boolean } = {}): Promise<Dashboard> {
  const cfg = loadConfig();
  const errors: SourceError[] = [];
  const today = startOfDay(now);

  const conn = haConnection();
  const [family, waste, weather, prices, states, shopping] = await Promise.all([
    gatherFamily(cfg, now, errors),
    collectWaste(cfg, errors),
    cfg.household.lat != null && cfg.household.lon != null
      ? cached(`weather`, 30 * MIN, () => forecast(cfg.household.lat!, cfg.household.lon!)).catch((e) => {
          errors.push({ source: "Väder", message: (e as Error).message });
          return null;
        })
      : Promise.resolve(null),
    collectPrices(cfg, now, errors),
    haSocket()?.connected
      ? Promise.resolve([...haSocket()!.states.values()])
      : conn
      ? cached("ha:states", 20_000, () => ha.states(conn)).catch((e) => {
          errors.push({ source: "Home Assistant", message: (e as Error).message });
          return [] as HaState[];
        })
      : Promise.resolve([] as HaState[]),
    loadShopping(cfg, errors),
  ]);
  const stateMap = new Map(states.map((s) => [s.entity_id, s]));
  const { people, children, all, withCare, travelCtx } = family;
  const energySeries = conn ? await todaySeries(conn, cfg.entities.energy ?? {}, now).catch(() => ({})) : {};
  const plan = buildPlan(withCare, people, travelCtx, now, (e) => toDash(e, people, travelCtx));
  const dinners = loadDinners();
  const meals = buildMeals(family.schoolFood, dinners, now);
  const schoolNews = buildSchoolNews(family.schoolNews, people);

  // ---- Days ----
  const days: DashDay[] = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(today, i);
    const prev = addDays(day, -1);
    const evs = eventsOnDay(all, day)
      .filter((e) => visibleOn(e, people, day))
      // School lessons are noise on a family board – keep only gym (packing matters) and all-day items.
      .filter((e) => !e.sourceId.startsWith("school:") || e.gym || e.allDay)
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime())
      .map((e) => toDash(e, people, travelCtx));

    const arriving = children.filter((c) => isHome(c.custody, day) && !isHome(c.custody, prev));
    const leaving = children.filter((c) => !isHome(c.custody, day) && isHome(c.custody, prev));
    const extra: DashEvent[] = [];
    if (arriving.length) extra.push({ time: "", title: `${joinNames(arriving.map((c) => c.name))} kommer`, color: FAMILY_COLOR, who: "", category: "family", icon: "kids" });
    if (leaving.length) extra.push({ time: "", title: `${joinNames(leaving.map((c) => c.name))} byter hem`, color: FAMILY_COLOR, who: "", category: "family", icon: "kids" });
    if (dinners[dayKey(day)]) extra.push({ time: "", title: `Middag: ${dinners[dayKey(day)]}`, color: FAMILY_COLOR, who: "", category: "family", icon: "food" });
    for (const w of waste.filter((p) => daysBetween(day, p.date) === 0)) {
      extra.push({ time: "", title: w.type, color: WASTE_COLOR, who: "", category: "waste", icon: "trash" });
    }

    days.push({
      key: dayKey(day),
      name: i === 0 ? "Idag" : i === 1 ? "Imorgon" : shortWeekday(day),
      date: i === 0 ? `${shortWeekday(day).toLowerCase()} ${day.getDate()}` : shortDate(day),
      isToday: i === 0,
      childrenHome: children.filter((c) => isHome(c.custody, day)).map((c) => c.name),
      events: [...extra, ...evs],
    });
  }

  // ---- Custody card ----
  const custody = buildCustodyCard(children, now);
  if (custody) {
    // Four weeks ahead per shared child, for the Hos oss page.
    custody.calendar = children
      .filter((c) => c.custody && c.custody.mode !== "always")
      .map((c) => ({ name: c.name, color: c.color, days: Array.from({ length: 28 }, (_, i) => isHome(c.custody, addDays(today, i))) }));
  }

  return {
    generatedAt: now.toISOString(),
    header: {
      dateLabel: longDate(now),
      week: isoWeek(now),
      weather: weather ? weatherSummary(weather, now) : undefined,
      sky: weather ? skyNow(weather, now) : undefined,
      tempNow: weather ? tempNow(weather, now) : undefined,
      sun: weather && cfg.dashboard.sunArc ? sunToday(weather, now) : undefined,
      phase: phaseOf(now),
    },
    now: buildNow(withCare, people, now, travelCtx),
    travelOptions: travelOptions(people),
    knownDrivers: knownDrivers(),
    people: cfg.people.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      initial: initialsOf(p, new Map(cfg.people.map((x) => [x.id, x]))),
      home: p.kind === "adult" || isHome(p.custody, now),
      kind: p.kind,
    })),
    idle: { minutes: cfg.dashboard.idleMinutes ?? 10, photos: listPhotos() },
    reminders: [...planReminder(plan, now), ...newsTripReminders(schoolNews, now), ...newsReminders(schoolNews, now), ...dinnerReminder(meals, now), ...buildReminders(now, withCare, people, waste, weather, travelCtx)].slice(0, opts.allReminders ? 20 : 5),
    schoolNews,
    plan,
    meals,
    mealFavorites: mealFavorites(now),
    sick: Object.entries(loadSick()).flatMap(([id, days]) =>
      days.filter((d) => d >= dayKey(today) && people.get(id)).map((d) => ({ personId: id, name: people.get(id)!.name, date: d })),
    ),
    shelf: Object.entries(loadShelf())
      .filter(([id]) => people.get(id)?.care)
      .map(([id, items]) => ({ personId: id, name: people.get(id)!.name, items })),
    chores: choresForToday(cfg.people, now),
    custody,
    legend: [
      ...cfg.people.map((p) => ({ name: p.name, color: p.color })),
      { name: "Familj", color: FAMILY_COLOR },
      ...(cfg.integrations.some((i) => i.category === "waste") ? [{ name: "Sopor", color: WASTE_COLOR }] : []),
    ],
    days,
    shopping,
    grocery: (() => {
      const g = groceryIntegration(cfg);
      return g ? { provider: g.provider.meta.id, name: g.provider.meta.name } : undefined;
    })(),
    prices: buildPrices(cfg, prices, now),
    energy: buildEnergy(cfg, stateMap, energySeries, prices),
    schoolFood: todaysFood(family.schoolFood, now),
    schoolDay: buildSchoolDays(all, people, now, (e, day) => visibleOn(e, people, day)),
    school: buildSchoolWeek(all, people, now, (e, day) => visibleOn(e, people, day)),
    lessonView: cfg.dashboard.lessons ?? "all",
    update: updateAvailable(),
    version: versionInfo(),
    cars: cfg.entities.cars.map((c) => {
      const smart = findSmartCharging(stateMap, c.name, { plan: c.plan, mode: c.mode });
      const base = buildCar(c, stateMap, now);
      return {
      ...base,
      status: smart?.state ? [base.status, smart.state].filter(Boolean).join(" · ") : base.status,
      smart,
      climate: c.climate ? { entityId: c.climate, on: isOnState(stateMap.get(c.climate)?.state) } : undefined,
      schedules: (cfg.schedules ?? [])
        .filter((s) => s.entityId === c.climate)
        .map(({ id, name, days, time, enabled }) => ({ id, name, days, time, enabled })),
      };
    }),
    smartModes: findAutoModes(stateMap),
    lights: cfg.entities.lights.map((l) => lamp(stateMap, l.entityId, l.name)),
    music: buildMusic(cfg, stateMap),
    security: buildSecurity(cfg, stateMap),
    robots: buildRobots(cfg, stateMap),
    appliances: buildAppliances(cfg, stateMap, now),
    lightGroups: (cfg.entities.lightGroups ?? []).map((g, index) => ({
      index,
      name: g.name,
      on: g.entities.filter((id) => stateMap.get(id)?.state === "on").length,
      total: g.entities.length,
      offline: g.entities.filter((id) => isOffline(stateMap, id)).map((id) => friendly(stateMap, id)),
      lamps: g.entities.map((id) => lamp(stateMap, id, friendly(stateMap, id), g.name)),
    })),
    buttons: cfg.entities.buttons ?? [],
    climates: (cfg.entities.climates ?? []).map((c) => ({
      ...buildClimate(c.entityId, c.name, stateMap),
      controls: (c.controls ?? []).map((id) => buildControl(stateMap, id, c.name)),
    })),
    temps: cfg.entities.temps.map((t) => {
      const offline = isOffline(stateMap, t.entityId);
      const since = stateMap.get(t.entityId)?.last_changed;
      return {
        name: t.name,
        value: formatTemp(stateMap, t.entityId),
        ...(offline ? { offline: true, days: since ? Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 86_400_000)) : undefined } : {}),
      };
    }),
    deviceCards: (cfg.entities.deviceCards ?? []).map((c, index) => ({
      index,
      title: c.title,
      primary: c.primary ? { name: shortName(friendly(stateMap, c.primary), c.title), value: display(stateMap, c.primary) } : undefined,
      rows: c.sensors.map((id) => ({ name: shortName(friendly(stateMap, id), c.title), value: display(stateMap, id), ok: !isOffline(stateMap, id) })),
      controls: c.controls.map((id) => buildControl(stateMap, id, c.title)),
    })),
    graphs: (cfg.entities.graphs ?? []).map((g, index) => ({ index, title: g.title })),
    accent: cfg.dashboard.accent,
    theme: cfg.dashboard.theme ?? "auto",
    home: cfg.dashboard.home,
    tabs: cfg.dashboard.tabs,
    daypart: inTimeWindow(now, "07:00", "19:00") ? "day" : "night",
    night: inTimeWindow(now, cfg.dashboard.nightFrom, cfg.dashboard.nightTo),
    errors,
  };
}

/** "21.4" "°C" → "21,4 °C"; text states as-is. */
function display(states: Map<string, HaState>, id: string): string {
  const s = states.get(id);
  if (!s || s.state === "unavailable" || s.state === "unknown") return "–";
  const n = Number(s.state);
  const unit = s.attributes.unit_of_measurement ? ` ${s.attributes.unit_of_measurement}` : "";
  if (Number.isFinite(n) && s.state.trim() !== "") {
    const rounded = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
    return `${String(rounded).replace(".", ",")}${unit}`;
  }
  return `${s.state}${unit}`;
}

export function buildControl(states: Map<string, HaState>, id: string, prefix = ""): Control {
  const s = states.get(id);
  const a = (s?.attributes ?? {}) as Record<string, unknown>;
  const numOrUndef = (v: unknown) => (typeof v === "number" ? v : undefined);
  return {
    entityId: id,
    name: shortName(friendly(states, id), prefix),
    domain: id.split(".")[0],
    state: s?.state ?? "unavailable",
    on: isOnState(s?.state),
    offline: isOffline(states, id),
    options: Array.isArray(a.options) ? a.options.map(String) : undefined,
    min: numOrUndef(a.min),
    max: numOrUndef(a.max),
    step: numOrUndef(a.step),
    unit: typeof a.unit_of_measurement === "string" ? a.unit_of_measurement : undefined,
  };
}

function isOnState(state?: string): boolean {
  return state === "on" || state === "heat" || state === "heat_cool" || state === "auto" || state === "cool";
}

/** "Spabad Pump 1" → "Pump 1" when the card already says Spabad. */
function shortName(name: string, prefix: string): string {
  return name.toLowerCase().startsWith(prefix.toLowerCase()) ? name.slice(prefix.length).trim() || name : name;
}

/** A lamp with on/off, and brightness when Home Assistant says it can be dimmed. */
function lamp(states: Map<string, HaState>, id: string, name: string, room?: string): import("./types.js").Lamp {
  const st = states.get(id);
  const a = (st?.attributes ?? {}) as { brightness?: number; supported_color_modes?: string[] };
  const modes = a.supported_color_modes ?? [];
  const dimmable = id.startsWith("light.") && (typeof a.brightness === "number" || modes.some((m) => m !== "onoff"));
  const on = st?.state === "on";
  // "Kök Taklampa" in the room Kök reads better as "Taklampa".
  const short = room && name.toLowerCase().startsWith(`${room.toLowerCase()} `) ? name.slice(room.length + 1) : name;
  return {
    entityId: id,
    name: short.charAt(0).toUpperCase() + short.slice(1),
    on,
    offline: isOffline(states, id),
    dimmable,
    brightness: on && dimmable && typeof a.brightness === "number" ? Math.max(1, Math.round((a.brightness / 255) * 100)) : undefined,
  };
}

function isOffline(states: Map<string, HaState>, id: string): boolean {
  const s = states.get(id);
  return !s || s.state === "unavailable" || s.state === "unknown";
}

function friendly(states: Map<string, HaState>, id: string): string {
  return String(states.get(id)?.attributes.friendly_name ?? id.split(".")[1] ?? id);
}

function num(states: Map<string, HaState>, id?: string): number | null {
  const v = haValue(states, id);
  const n = Number(v);
  return v !== undefined && Number.isFinite(n) ? n : null;
}

function buildCar(c: Config["entities"]["cars"][number], states: Map<string, HaState>, now: Date): Omit<Dashboard["cars"][number], "schedules" | "climate"> {
  const battery = num(states, c.battery);
  const rangeKm = num(states, c.range);
  const loc = haValue(states, c.location);
  const home = loc === undefined ? null : loc === "home" || loc === "on" || loc === "true";
  const ch = haValue(states, c.charging);
  const charging = ch === "on" || ch === "charging" || ch === "true";
  const changed = states.get(c.battery)?.last_changed;
  // last_changed only moves when the value changes; last_reported/updated is closer to "fresh".
  const s = states.get(c.battery) as (HaState & { last_reported?: string; last_updated?: string }) | undefined;
  const stamp = s?.last_reported ?? s?.last_updated ?? changed;
  const ageHours = stamp ? Math.max(0, Math.round((now.getTime() - new Date(stamp).getTime()) / 3_600_000)) : null;
  const status = [
    home === null ? "" : home ? "Hemma" : "Borta",
    rangeKm !== null ? `${Math.round(rangeKm)} km` : "",
    charging ? "laddar" : "",
  ].filter(Boolean);
  return { name: c.name, battery: battery === null ? null : Math.round(battery), rangeKm, home, charging, ageHours, status: status.join(" · ") };
}

const MODE_LABELS: Record<string, string> = {
  auto: "Auto",
  heat: "Värme",
  cool: "Kyla",
  off: "Av",
  heat_cool: "Auto",
  dry: "Avfukta",
  fan_only: "Fläkt",
  home: "Hemma",
  away: "Borta",
  eco: "Eco",
  comfort: "Komfort",
  boost: "Boost",
  sleep: "Natt",
  none: "Normal",
  electric: "El",
  heat_pump: "Värmepump",
  performance: "Max",
  high_demand: "Hög",
  gas: "Gas",
  on: "Till",
  ready: "Klar",
  rest: "Vila",
  ready_in_rest: "Klar i vila",
  manual: "Manuell",
  schedule: "Schema",
  holiday: "Semester",
  vacation: "Semester",
};

function buildClimate(entityId: string, name: string, states: Map<string, HaState>): Omit<Dashboard["climates"][number], "controls"> {
  const s = states.get(entityId);
  const domain = entityId.startsWith("water_heater.") ? "water_heater" : "climate";
  const a = (s?.attributes ?? {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  let modes: Dashboard["climates"][number]["modes"] = [];
  let active: string | undefined;
  if (domain === "water_heater") {
    modes = list(a.operation_list).map((m) => ({ value: m, label: MODE_LABELS[m] ?? m, field: "operation_mode" as const }));
    active = String(a.operation_mode ?? s?.state ?? "");
  } else if (list(a.preset_modes).length) {
    modes = list(a.preset_modes).map((m) => ({ value: m, label: MODE_LABELS[m] ?? m, field: "preset_mode" as const }));
    active = String(a.preset_mode ?? "");
  } else {
    modes = list(a.hvac_modes).map((m) => ({ value: m, label: MODE_LABELS[m] ?? m, field: "hvac_mode" as const }));
    active = s?.state;
  }
  const n = (v: unknown) => (typeof v === "number" ? v : v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    entityId,
    name,
    domain,
    current: n(a.current_temperature),
    target: n(a.temperature ?? a.target_temp_high),
    action: typeof a.hvac_action === "string" ? a.hvac_action : undefined,
    modes: modes.slice(0, 5),
    active,
  };
}

async function loadShopping(cfg: Config, errors: SourceError[]): Promise<Dashboard["shopping"]> {
  if (cfg.shopping.source === "ha" && cfg.shopping.entityId) {
    const conn = haConnection();
    if (conn) {
      try {
        const items = await cached(`todo:${cfg.shopping.entityId}`, 15_000, () => ha.todoItems(conn, cfg.shopping.entityId!));
        return { source: "ha", items: items.map((i) => ({ id: i.uid, name: i.summary, done: i.status === "completed" })) };
      } catch (e) {
        errors.push({ source: "Inköpslista", message: (e as Error).message });
      }
    }
    return { source: "ha", items: [] };
  }
  return { source: "local", items: loadLocalList() };
}

const WEEKDAY_NAMES = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];

/** School lunch for today (or tomorrow after 14:00) – matched on the weekday name Vklass uses. */
function todaysFood(food: { child: string; day: string; dishes: string[] }[], now: Date): Dashboard["schoolFood"] {
  if (!food.length) return undefined;
  const target = now.getHours() >= 14 ? addDays(now, 1) : now;
  const name = WEEKDAY_NAMES[target.getDay()];
  const dm = new RegExp(`\\b${target.getDate()}/${target.getMonth() + 1}\\b`);
  const hits = food.filter((f) => f.day.toLowerCase().includes(name) || dm.test(f.day));
  const seen = new Set<string>();
  return hits.filter((f) => {
    const k = f.dishes.join("|");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Power in kW regardless of whether the sensor reports W or kW. */
function kw(states: Map<string, HaState>, id?: string): number | undefined {
  const v = haValue(states, id);
  const n = Number(v);
  if (v === undefined || !Number.isFinite(n)) return undefined;
  const unit = String(states.get(id!)?.attributes.unit_of_measurement ?? "");
  return Math.round((unit === "W" ? n / 1000 : unit === "MW" ? n * 1000 : n) * 100) / 100;
}

function buildEnergy(cfg: Config, states: Map<string, HaState>, series: Record<string, { t: number; v: number }[]>, spot: HourPrice[]): Dashboard["energy"] {
  const e = cfg.entities.energy ?? {};
  const units = Object.fromEntries([e.solarEnergy, e.importEnergy, e.exportEnergy].filter((x): x is string => Boolean(x)).map((id) => [id, String(states.get(id)?.attributes.unit_of_measurement ?? "kWh")]));
  const out = {
    ...energyLive(e, states),
    today: energyToday(e, series, units, spot, (p) => (hasPriceExtras(cfg) ? totalPrice(cfg, p) : p)),
  };
  return Object.values(out).some((v) => v !== undefined) ? out : undefined;
}

function buildPrices(cfg: Config, spot: HourPrice[], now: Date): Dashboard["prices"] {
  if (spot.length === 0) return undefined;
  const withExtras = hasPriceExtras(cfg);
  const prices = withExtras ? spot.map((p) => ({ ...p, price: totalPrice(cfg, p.price) })) : spot;
  const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).getTime();
  const upcoming = prices.filter((p) => p.start.getTime() >= currentHour).slice(0, 24);
  const nowPrice = upcoming[0]?.price ?? prices[prices.length - 1].price;
  const block = cheapestBlock(upcoming, Math.max(1, Math.min(8, cfg.electricity.cheapHours)), now);
  const cheapSet = new Set(block?.hours ?? []);
  return {
    now: nowPrice,
    kind: withExtras ? "total" : "spot",
    level: priceLevel(nowPrice, upcoming),
    bars: upcoming.map((p, i) => ({
      hour: String(p.start.getHours()).padStart(2, "0"),
      price: p.price,
      cheap: cheapSet.has(p.start.getTime()),
      current: i === 0,
    })),
    cheapest: block ? { from: hhmm(block.start).slice(0, 2), to: hhmm(block.end).slice(0, 2), avg: block.avg } : undefined,
  };
}

export function buildReminders(
  now: Date,
  events: SourcedEvent[],
  people: Map<string, Person>,
  waste: { date: Date; type: string }[],
  weather: Forecast | null,
  travel?: TravelCtx,
): Reminder[] {
  const out: Reminder[] = [];
  const today = startOfDay(now);
  const evening = now.getHours() >= 17;
  const focusDay = evening ? addDays(today, 1) : today; // after 17 we prepare for tomorrow
  const focusLabel = evening ? "imorgon" : "idag";

  // Rain
  if (weather) {
    const mm = evening ? rainBetween(weather, 1, 6, 18, now) : rainBetween(weather, 0, Math.max(now.getHours(), 7), 19, now);
    if (mm >= 0.8) {
      out.push({
        icon: "rain",
        title: evening ? "Regn imorgon" : now.getHours() < 12 ? "Regn under dagen" : "Regn i eftermiddag",
        sub: "Ta regnjackan",
        tone: "blue",
      });
    }
  }

  // Sick children (Sjuk/VAB): first, so nobody drives off to förskola.
  for (const e of events.filter((x) => x.sourceId === "sick" && daysBetween(focusDay, x.start) === 0)) {
    const p = e.personId ? people.get(e.personId) : undefined;
    if (p) out.push({ icon: "kids", title: `${p.name} är sjuk ${focusLabel}`, sub: "Förskola, skola och aktiviteter är strukna", tone: "amber", personId: p.id });
  }

  // Cold morning for the children on their way: mössa och vantar (also in the morning notification).
  if (weather && [...people.values()].some((p) => p.kind === "child")) {
    const cold = evening ? coldestBetween(weather, 1, 7, 9, now) : now.getHours() < 9 ? coldestBetween(weather, 0, Math.max(now.getHours(), 6), 9, now) : undefined;
    if (cold !== undefined && cold <= 5) {
      const deg = `${Math.round(cold)}°`.replace("-", "−");
      out.push({
        icon: "kids",
        title: cold <= 0 ? `Minusgrader ${evening ? "imorgon bitti" : "i morse"} (${deg})` : `Kallt ${evening ? "imorgon bitti" : "på morgonen"} (${deg})`,
        sub: cold <= 0 ? "Mössa, vantar och varma kläder" : "Mössa och vantar",
        tone: "blue",
      });
    }
  }

  // Custody handover (one line for all children arriving or leaving tomorrow)
  const tomorrow = addDays(today, 1);
  const kids = [...people.values()].filter((p) => p.kind === "child");
  const arriving = kids.filter((c) => !isHome(c.custody, today) && isHome(c.custody, tomorrow)).map((c) => c.name);
  const leaving = kids.filter((c) => isHome(c.custody, today) && !isHome(c.custody, tomorrow)).map((c) => c.name);
  if (arriving.length) out.push({ icon: "kids", title: `${joinNames(arriving)} kommer imorgon`, sub: "Barnvecka börjar", tone: "green" });
  if (leaving.length) out.push({ icon: "kids", title: `${joinNames(leaving)} byter hem imorgon`, sub: "Packa det som ska med", tone: "green" });

  // Förskola/fritids closed (planeringsdag, APT, studiedag …) – warn a week ahead.
  for (const c of closures(events, people, today, 7)) {
    const diff = daysBetween(today, c.date);
    const when = diff === 0 ? "idag" : diff === 1 ? "imorgon" : `${shortWeekday(c.date).toLowerCase()} ${shortDate(c.date)}`;
    const sub = c.early
      ? "Kolla när förskolan stänger – hämta tidigare?"
      : diff <= 1 ? "Ordna barnomsorg" : `Om ${diff} dagar – ordna barnomsorg`;
    out.push({ icon: "school", title: `${c.name} · ${c.title} ${when}`, sub, tone: "amber", personId: c.personId });
  }

  // Förskola/fritids: "saknas på hyllan" until it is cleared, and the weekday's own note.
  const shelf = loadShelf();
  for (const p of [...people.values()].filter((x) => x.kind === "child" && x.care)) {
    if (!isHome(p.custody, focusDay)) continue;
    const place = p.care!.name || "Förskola";
    if (shelf[p.id]?.length) out.push({ icon: "bag", title: `${p.name} · ta med ${careAt(place).replace(/^(på|hos) /, "till ")}: ${shelf[p.id].join(", ").toLowerCase()}`, sub: "Bocka av när det är lämnat – tryck på lämningen", tone: "amber", personId: p.id });
    const note = p.care!.notes?.[String(isoWeekday(focusDay))];
    if (note && careTimesFor(p.care, focusDay)) out.push({ icon: "bag", title: `${p.name} · ${note}`, sub: `${place} ${evening ? "imorgon" : "idag"}`, tone: "blue", personId: p.id });
  }

  // Förskola/fritids: who drops off and picks up (today, or tomorrow in the evening).
  for (const e of events.filter((x) => isCare(x.sourceId) && daysBetween(focusDay, x.start) === 0)) {
    const p = e.personId ? people.get(e.personId) : undefined;
    if (!p) continue;
    const who = travel ? travelSummary(resolveTravel(e, people, travel.calendars.get(e.sourceId), travel.saved)) : "";
    out.push({
      icon: "kids",
      title: `${p.name} · ${e.title.toLowerCase()} ${evening ? "imorgon " : ""}${hhmm(e.start)}–${hhmm(e.end)}`,
      sub: who || "Vem lämnar och hämtar? Tryck på lämningen i Nu",
      tone: "green",
      personId: p.id,
    });
  }

  // Sport and gym for the focus day, and sport tomorrow morning
  const horizonEnd = addDays(focusDay, 1);
  const upcoming = events
    .filter((e) => e.start >= (evening ? focusDay : now) && e.start < horizonEnd)
    .filter((e) => visibleOn(e, people, startOfDay(e.start)));
  const seen = new Set<string>();
  for (const e of upcoming) {
    const p = e.personId ? people.get(e.personId) : undefined;
    if (!p) continue;
    if (e.category === "sport") {
      const key = `sport:${p.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const asks = Boolean(travel && wantsTravel(e, people));
      const ride = asks ? travelSummary(resolveTravel(e, people, travel!.calendars.get(e.sourceId), travel!.saved)) : "";
      out.push({
        icon: "bag",
        title: `${p.name} · ${e.title} ${evening ? `${focusLabel} ` : ""}${e.allDay ? (evening ? "" : focusLabel) : hhmm(e.start)}`.trim(),
        sub: ride ? `Packa väskan · ${ride}` : asks ? "Packa väskan · tryck i kalendern för att välja skjuts" : "Packa träningsväskan",
        tone: "blue",
        personId: p.id,
      });
    } else if (e.gym) {
      const key = `gym:${p.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ icon: "gym", title: `${p.name} · Idrott ${focusLabel}`, sub: "Gympapåse · från Vklass", tone: "amber", personId: p.id });
    }
  }

  // Waste: today or tomorrow
  for (const w of waste) {
    const diff = daysBetween(today, w.date);
    if (diff === 0) out.push({ icon: "trash", title: `${w.type} hämtas idag`, sub: "Har kärlet ställts ut?", tone: "neutral" });
    else if (diff === 1) out.push({ icon: "trash", title: `${w.type} hämtas imorgon`, sub: "Ställ ut kärlet ikväll", tone: "neutral" });
  }

  return out.slice(0, 5);
}

/**
 * "Hos oss"-kortet. Barn med samma status och samma nästa byte slås ihop; har de olika rytm
 * (t.ex. dina barn byter måndag och bonusbarnen fredag) får varje grupp en egen rad.
 */
export function buildCustodyCard(children: Person[], now: Date): Dashboard["custody"] {
  const shared = children.filter((c) => c.custody && (c.custody.mode !== "always" || c.custody.overrides?.length));
  if (!shared.length) return undefined;
  const groups = new Map<string, { kids: Person[]; st: ReturnType<typeof custodyStatus> }>();
  for (const c of shared) {
    const st = custodyStatus(c.custody, now);
    if (!st.nextChange && c.custody?.mode === "always") continue; // only past overrides
    const key = `${st.home}|${st.nextChange ? dayKey(st.nextChange) : ""}`;
    const g = groups.get(key) ?? { kids: [], st };
    g.kids.push(c);
    groups.set(key, g);
  }
  const list = [...groups.values()].sort((a, b) => a.st.daysLeft - b.st.daysLeft);
  if (!list.length) return undefined;
  const changeLabel = (d: Date) => `${shortWeekday(d).toLowerCase()} ${shortDate(d)} · v${isoWeek(d)}`;

  if (list.length === 1) {
    const { kids, st } = list[0];
    const names = joinNames(kids.map((c) => c.name));
    const when = st.nextChange ? relativeDay(st.nextChange, now) : "";
    return {
      headline: st.home
        ? st.nextChange && st.daysLeft <= 1 ? `${names} byter hem ${when}` : `${names} är här`
        : st.daysLeft <= 1 ? `${names} kommer ${when}` : `${names} kommer om ${st.daysLeft} dagar`,
      sub: st.nextChange ? `Byte ${changeLabel(st.nextChange)}` : "",
      daysLeft: st.daysLeft,
      progress: st.progress,
    };
  }

  const here = list.filter((g) => g.st.home).flatMap((g) => g.kids.map((c) => c.name));
  return {
    headline: here.length ? `${joinNames(here)} är här` : "Barnen är i andra hemmet",
    sub: "",
    daysLeft: list[0].st.daysLeft,
    progress: list[0].st.progress,
    rows: list.map(({ kids, st }) => {
      const last = st.nextChange ? addDays(st.nextChange, -1) : null;
      return {
        names: joinNames(kids.map((c) => c.name)),
        color: kids[0].color,
        home: st.home,
        daysLeft: st.daysLeft,
        text: !st.nextChange
          ? st.home ? "här" : "i andra hemmet"
          : st.home
            ? st.daysLeft <= 1 ? `byter hem ${relativeDay(st.nextChange, now)}` : `här t.o.m. ${shortWeekday(last!).toLowerCase()}`
            : st.daysLeft <= 1 ? `kommer ${relativeDay(st.nextChange, now)}` : `kommer ${shortWeekday(st.nextChange).toLowerCase()} (om ${st.daysLeft} d)`,
      };
    }),
  };
}

// ---------- Förskola / fritids ----------

const CLOSED = /stängt|stängd|planeringsdag|studiedag|kompetensutveckling|studiedagar|lovdag/i;
/** APT or "stänger 15:00" usually means early closing: drop off as usual, pick up earlier. */
const EARLY = /\bapt\b|stänger tidigt|tidig stängning|stänger kl|stänger \d/i;
const TIME_RANGE = /(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})/;

/** Pseudo calendars so care days get a default "lämnar/hämtar" like a sport calendar. */
export function careCalendars(people: Person[]): [string, CalendarSource][] {
  return people
    .filter((p) => p.kind === "child" && p.care)
    .map((p) => [
      `care:${p.id}`,
      { id: `care:${p.id}`, name: p.care!.name || "Förskola", provider: "ics", kind: "ics", category: "school", personId: p.id, travel: p.care!.travel },
    ]);
}

/** School/förskola events that say the place is closed, per child at home that day. */
export function closures(events: SourcedEvent[], people: Map<string, Person>, today: Date, days: number) {
  const out: { name: string; personId: string; title: string; date: Date; early: boolean }[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (e.category !== "school" || !e.personId) continue;
    // Closed for the day only when it is an all-day "stängt/planeringsdag"; APT or a timed
    // "stänger 15:00" is early closing – care still happens, but pick-up may need to move.
    const early = EARLY.test(e.title) || (!e.allDay && CLOSED.test(e.title));
    if (!early && !CLOSED.test(e.title)) continue;
    const p = people.get(e.personId);
    const d = startOfDay(e.start);
    const diff = daysBetween(today, d);
    if (!p || diff < 0 || diff >= days || !isHome(p.custody, d)) continue;
    const key = `${p.id}@${dayKey(d)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: p.name, personId: p.id, title: e.title.replace(/\s+/g, " ").trim(), date: d, early });
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * One care event per child and day: the weekly schedule from the guide, today's times from Vklass
 * when it has them. Skipped on days the child is in the other home or the place is closed.
 */
export function buildCareEvents(
  people: Person[],
  vklass: { personId: string; text: string }[],
  events: SourcedEvent[],
  today: Date,
  days: number,
): SourcedEvent[] {
  const map = new Map(people.map((p) => [p.id, p]));
  const closed = new Set(closures(events, map, today, days).filter((c) => !c.early).map((c) => `${c.name}@${dayKey(c.date)}`));
  const out: SourcedEvent[] = [];
  for (const p of people.filter((x) => x.kind === "child")) {
    const live = vklass.find((v) => v.personId === p.id)?.text;
    if (!p.care && !live) continue;
    for (let i = 0; i < days; i++) {
      const day = addDays(today, i);
      const text = i === 0 && live && TIME_RANGE.test(live) ? live : careTimesFor(p.care, day);
      const m = text ? TIME_RANGE.exec(text) : null;
      if (!m || !isHome(p.custody, day) || closed.has(`${p.name}@${dayKey(day)}`)) continue;
      const at = (h: string, min: string) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(h), Number(min));
      out.push({
        sourceId: `care:${p.id}`,
        uid: "care",
        personId: p.id,
        category: "school",
        title: p.care?.name || "Förskola",
        start: at(m[1], m[2]),
        end: at(m[3], m[4]),
        allDay: false,
      });
    }
  }
  return out;
}

/** "2 saker de närmaste dagarna saknar ansvarig" – only what is close (today and tomorrow). */
export function planReminder(plan: Dashboard["plan"], now: Date): Reminder[] {
  // Today, only what is still ahead: a drop-off at 07:30 is not worth a nag at noon.
  const mins = now.getHours() * 60 + now.getMinutes();
  const at = (t?: string) => (t && /^\d{1,2}:\d{2}$/.test(t) ? Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]) : undefined);
  const stillAhead = (i: (typeof plan.items)[number]) => {
    if (i.dayLabel !== "idag") return needsAttention(i);
    const start = at(i.time);
    const end = at(i.end) ?? start;
    if (end !== undefined && end < mins) return false;
    if (start !== undefined && start < mins) {
      // Already dropped off: only the way home can still need someone.
      return !i.travel.home || (i.busy ?? []).some((b) => b.leg === "home" && i.travel.home?.mode === `adult:${b.personId}`);
    }
    return needsAttention(i);
  };
  const soon = plan.items.filter((i) => (i.dayLabel === "idag" || i.dayLabel === "imorgon") && stillAhead(i));
  if (!soon.length) return [];
  const first = soon[0];
  return [
    {
      icon: "kids",
      title: soon.length === 1 ? `${first.who} · ${first.title.replace(/^Lämning · /, "")} ${first.dayLabel} behöver någon` : `${soon.length} saker idag och imorgon behöver någon`,
      sub: "Tryck på Planera veckan",
      tone: "amber",
    },
  ];
}

/** In the afternoon: tonight's dinner, and a heads-up if the kids already had it for lunch. */
export function dinnerReminder(meals: Dashboard["meals"], now: Date): Reminder[] {
  const h = now.getHours();
  const today = meals[0];
  if (!today?.dinner || h < 13 || h >= 19) return [];
  const twice = sameAsLunch(today.dinner, today.lunch);
  return [{ icon: "food", title: `Middag ikväll: ${today.dinner}`, sub: twice ? `Obs – lunchen var ${twice.toLowerCase()}` : "Från veckans mat", tone: twice ? "amber" : "neutral" }];
}
