// Demo mode (VITE_DEMO=1): the whole app runs in the browser on recorded sample data.
// Every button works against this in-memory copy; nothing leaves the page.
import type { Config, ConfigResponse, DashEvent, Dashboard, Integration, PlanItem, Schedule, TestResult, TravelChoice, TravelLeg } from "../../../server/src/types";
import type { CalendarTest, CarDetails, Discovery, EntityOption, GraphData, GroceryLine, PostcodeInfo, Shelf, Tile } from "../api";
import fixtures from "./fixtures.json";
import pkg from "../../package.json";

const fx = structuredClone(fixtures) as unknown as {
  config: ConfigResponse;
  dashboard: Dashboard;
  cars: CarDetails[];
  graphs: GraphData[];
  discover: Discovery;
  entities: EntityOption[];
  calendarTest: CalendarTest;
};

// "#forsta" opens the demo as a brand-new install: empty settings, the wizard from step one.
const firstRun = typeof location !== "undefined" && location.hash === "#forsta";
if (firstRun) {
  const c = fx.config.config;
  fx.config.config = {
    ...c,
    setupComplete: false,
    household: { name: "" },
    people: [],
    calendars: [],
    integrations: [{ id: "price", category: "price", provider: "spot", settings: { area: "SE3" } }],
    shopping: { source: "local", mappings: {} },
    electricity: { cheapHours: 4, markupOre: 0, gridOre: 0, taxOre: 0, vat: false },
    ha: { mode: "none" },
    schedules: [],
    entities: { cars: [], energy: {}, lights: [], temps: [], lightGroups: [], buttons: [], climates: [], deviceCards: [], graphs: [] },
  };
  fx.config.secretsSet = [];
  history.replaceState(null, "", location.pathname);
}

const wait = <T>(v: T, ms = 180) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), ms));
const d = fx.dashboard;
// "?tema=eink" shows the demo as on an e-ink screen.
const forcedTheme = typeof location !== "undefined" ? new URLSearchParams(location.search).get("tema") : null;
// Calendar events in the demo can be struck ("Utgår") like real ones.
for (const [di, day] of (d.days ?? []).entries()) for (const [ei, ev] of day.events.entries()) if (!ev.ownId && !ev.cancelKey) ev.cancelKey = `demo:${di}:${ei}`;
// ?lektioner=tider shows Skolan with only when the school day starts and ends.
if (typeof location !== "undefined" && new URLSearchParams(location.search).get("lektioner") === "tider") d.lessonView = "span";
// ?utan-ma shows the Musik tab of a home without Music Assistant (the device check uses it).
if (typeof location !== "undefined" && new URLSearchParams(location.search).has("utan-ma") && d.music) d.music.assistant = false;
if (forcedTheme === "eink" || forcedTheme === "light" || forcedTheme === "dark") d.theme = forcedTheme;
if (forcedTheme === "spegel") d.theme = "mirror";

// ---- Förskola days for Maja in the demo: Emil drops off, Anna picks up – except Thursday, where
// no one has said they pick up yet (shows the amber "saknar ansvarig" in Planera veckan). ----
function careTravelFor(dayKey: string): import("../../../server/src/types").DashTravel {
  const key = `care:maja@care@${dayKey}`;
  const c = careSaved[key] ?? (dayKey === "2026-10-22" ? { to: { mode: "adult:emil" as const } } : careDefault);
  const name = (l?: TravelLeg) => (!l ? "" : l.mode === "adult:anna" ? "Anna" : l.mode === "adult:emil" ? "Emil" : l.by || "Någon annan");
  return {
    key,
    calendarId: "care:maja",
    calendarName: "Förskola",
    to: c.to && { ...c.to, label: name(c.to) },
    home: c.home && { ...c.home, label: name(c.home) },
    fromCalendar: !careSaved[key],
    kind: "care",
  };
}
const careDefault: TravelChoice = { to: { mode: "adult:emil" }, home: { mode: "adult:anna" } };
const careSaved: Record<string, TravelChoice> = {};

// ---- A mixed family like the one we build for: two children every other week (Ella, Leo) and
// two at home all the time (Maja on förskola with drop-off/pick-up, Nils). Added on top of the
// recorded data so the demo shows care days, a planning day and "Hos oss". ----
{
  const c = fx.config.config;
  c.people = [
    ...c.people.slice(0, 1),
    { id: "anna", name: "Anna", color: "#ff8fa3", kind: "adult" },
    ...c.people.slice(1),
    {
      id: "maja",
      name: "Maja",
      color: "#34e0a1",
      kind: "child",
      custody: { mode: "always" },
      care: {
        name: "Förskola",
        days: { "1": "07:30-16:00", "2": "07:30-16:00", "3": "07:30-16:00", "4": "07:30-16:00", "5": "08:00-15:00" },
        travel: { to: { mode: "adult:emil" }, home: { mode: "adult:anna" } },
        notes: { "2": "Utflykt – packa ryggsäck och frukt" },
      },
    },
    { id: "nils", name: "Nils", color: "#ff9f5a", kind: "child", custody: { mode: "always" } },
  ];
  const dd = fx.dashboard;
  dd.people = ([
    dd.people[0],
    { name: "Anna", color: "#ff8fa3", initial: "A", home: true, kind: "adult" },
    ...dd.people.slice(1),
    { name: "Maja", color: "#34e0a1", initial: "M", home: true, kind: "child" },
    { name: "Nils", color: "#ff9f5a", initial: "N", home: true, kind: "child" },
  ] as Omit<Dashboard["people"][number], "id">[]).map((p) => ({ ...p, id: p.name.toLowerCase() }));
  dd.legend = [dd.legend[0], { name: "Anna", color: "#ff8fa3" }, ...dd.legend.slice(1, 3), { name: "Maja", color: "#34e0a1" }, { name: "Nils", color: "#ff9f5a" }, ...dd.legend.slice(3)];
  const careTravel = careTravelFor("2026-10-19");
  dd.now.items.push({
    time: "07:30",
    end: "16:00",
    title: "Lämning · Förskola",
    color: "#34e0a1",
    who: "Maja",
    initial: "M",
    category: "school",
    icon: "school",
    travel: careTravel,
    inMinutes: 0,
    dayLabel: "imorgon",
  });
  dd.reminders.splice(2, 0, { icon: "kids", title: "Maja · förskola imorgon 07:30–16:00", sub: "Emil lämnar · Anna hämtar", tone: "green" });
  dd.reminders.splice(1, 0, { icon: "school", title: "Maja · Planeringsdag – förskolan stängd fre 23 okt", sub: "Om 5 dagar – ordna barnomsorg", tone: "amber" });
  dd.reminders = dd.reminders.map((r) => (r.icon === "kids" && r.sub === "Barnvecka börjar" ? { ...r, sub: "Byte" } : r));
  if (dd.custody) dd.custody.sub = "Byte mån 19 okt · v43";
  dd.mealFavorites = [
    { name: "Tacos", shopping: "tacoskal, ost, gräddfil" },
    { name: "Lasagne", shopping: "lasagneplattor, krossade tomater, ost" },
    { name: "Lax i ugn" },
    { name: "Korv stroganoff" },
    { name: "Kycklinggryta" },
    { name: "Fiskpinnar" },
    { name: "Köttfärssås och spagetti" },
  ];
  dd.shelf = [{ personId: "maja", name: "Maja", items: ["Extrakläder"] }];
  dd.chores = [{ personId: "maja", name: "Maja", color: "#f59e0b", items: [{ id: "c1", title: "Plocka undan", done: true }, { id: "c2", title: "Borsta tänderna", done: false }, { id: "c3", title: "Packa väskan", done: false }], allDone: false }];
  dd.reminders.splice(3, 0, { icon: "bag", title: "Maja · ta med till förskolan: extrakläder", sub: "Bocka av när det är lämnat – tryck på lämningen", tone: "amber" });
  const fri = dd.days.find((x) => x.key === "2026-10-23");
  fri?.events.unshift({ time: "", title: "Planeringsdag – förskolan stängd", color: "#34e0a1", who: "Maja", initial: "M", category: "school", icon: "school" });
}

// ---- Veckans mat in the demo: school lunch for Maja and Nils, a few dinners (Wednesday = same as lunch). ----
const LUNCH: Record<string, string> = {
  "2026-10-19": "Fiskgratäng med potatis",
  "2026-10-20": "Kycklinggryta med ris",
  "2026-10-21": "Pannkakor med sylt",
  "2026-10-22": "Köttbullar och makaroner",
};
const dinners: Record<string, string> = { "2026-10-18": "Tacos", "2026-10-19": "Lasagne", "2026-10-21": "Pannkakor och bacon" };
// Demo Sunday: the school week starts tomorrow (Ella and Leo come back on Monday).
function syncSchoolDay() {
  d.schoolDay = [
    { personId: "ella", name: "Ella", color: "#5ab8ff", dayLabel: "imorgon", start: "08:10", end: "14:30", gym: true },
    { personId: "leo", name: "Leo", color: "#f5c84b", dayLabel: "imorgon", start: "08:20", end: "15:10", gym: false },
  ];
}
syncSchoolDay();

// Demo school week (Mon 19 – Fri 23 Oct) and homework for Ella and Leo.
const L = (start: string, end: string, title: string, location?: string, gym = false) => ({ start, end, title, location, gym });
const week = (rows: ReturnType<typeof L>[][]) =>
  ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag"].map((label, i) => ({ dayKey: `2026-10-${19 + i}`, label, today: false, lessons: rows[i] ?? [] }));
d.school = [
  {
    personId: "ella",
    name: "Ella",
    color: "#5ab8ff",
    days: week([
      [L("08:10", "09:00", "Matematik", "B12"), L("09:15", "10:30", "Svenska", "B12"), L("10:45", "11:30", "Engelska", "B14"), L("12:30", "14:30", "Idrott och hälsa", "Hallen", true)],
      [L("08:10", "09:30", "NO", "Lab 2"), L("09:45", "11:00", "Matematik", "B12"), L("12:20", "15:00", "Bild", "Ateljén")],
      [L("09:00", "10:00", "Svenska", "B12"), L("10:15", "11:30", "SO", "B10"), L("12:30", "13:40", "Musik", "Musiksalen")],
      [L("08:10", "09:00", "Engelska", "B14"), L("09:15", "11:30", "Slöjd", "Trä"), L("12:30", "15:10", "Matematik", "B12")],
      [L("08:10", "09:30", "Idrott och hälsa", "Hallen", true), L("09:45", "11:30", "Svenska", "B12")],
    ]),
    tasks: [
      { dayKey: "2026-10-20", label: "tis 20/10", title: "Glosor engelska kap 4", kind: "läxa" },
      {
        dayKey: "2026-10-22",
        label: "tor 22/10",
        title: "Prov i NO – kroppen",
        kind: "prov",
        time: "08:10",
        detail:
          "Inför provet ska du kunna:\n\n1. Hjärtat och blodet\n• Förklara hur hjärtat pumpar runt blodet i kroppen.\n• Kunna skillnaden mellan artärer och vener.\n\n2. Matsmältningen\n• Beskriva vägen från munnen till tarmarna.\n• Kunna vad levern och bukspottkörteln gör.\n\n3. Skelett och muskler\n• Namnge tio av kroppens ben.\n\nPlugga gärna med kapitel 3 i NO-boken. Lycka till!",
        url: "https://custodian.vklass.se/",
      },
      { dayKey: "2026-10-23", label: "fre 23/10", title: "Lämna in bokrecension", kind: "inlämning" },
    ],
  },
  {
    personId: "leo",
    name: "Leo",
    color: "#f5c84b",
    days: week([
      [L("08:20", "09:30", "Svenska", "A3"), L("09:45", "11:00", "Matematik", "A3"), L("12:20", "15:10", "Fritids-utflykt", "Skogen")],
      [L("08:20", "10:00", "Engelska", "A3"), L("10:15", "11:30", "Idrott", "Hallen", true), L("12:30", "14:00", "NO", "A5")],
      [L("08:20", "11:30", "Svenska", "A3"), L("12:30", "13:30", "Bild", "Ateljén")],
      [L("08:20", "09:30", "Matematik", "A3"), L("09:45", "11:30", "SO", "A4"), L("12:30", "14:30", "Musik", "Musiksalen")],
      [L("08:20", "10:00", "Svenska", "A3"), L("10:15", "11:30", "Idrott", "Hallen", true)],
    ]),
    tasks: [{ dayKey: "2026-10-21", label: "ons 21/10", title: "Läsläxa: 10 sidor", kind: "läxa" }],
  },
];
// Ella and Leo: here from Monday 19 Oct for a week, then a week at the other home.
if (d.custody) {
  const days = Array.from({ length: 28 }, (_, i) => i >= 1 && i <= 7 ? true : i >= 15 && i <= 21);
  d.custody.calendar = [
    { name: "Ella", color: "#5ab8ff", days },
    { name: "Leo", color: "#f5c84b", days },
  ];
}

function syncMeals() {
  d.meals = d.days.map((day, i) => ({
    dayKey: day.key,
    dayLabel: i === 0 ? "idag" : i === 1 ? "imorgon" : `${day.name.toLowerCase()} ${day.date}`,
    dinner: dinners[day.key],
    lunch: LUNCH[day.key] ? [{ child: "Maja och Nils", dishes: [LUNCH[day.key]] }] : [],
  }));
  for (const day of d.days) {
    day.events = day.events.filter((e) => !(e.icon === "food" && e.title.startsWith("Middag")) || day.isToday);
    if (!day.isToday && dinners[day.key]) day.events.push({ time: "", title: `Middag: ${dinners[day.key]}`, color: "#34e0a1", who: "", category: "family", icon: "food" });
  }
}

// ---- Dit/hem in the demo: the same rules as server/src/travel.ts, on the recorded events ----
d.travelOptions = [
  { mode: "adult:emil", label: "Emil skjutsar" },
  { mode: "adult:anna", label: "Anna skjutsar" },
  { mode: "ride", label: "Annan skjutsar" },
  { mode: "bus", label: "Buss" },
  { mode: "self", label: "Cyklar/går" },
];
d.knownDrivers = ["Saras pappa", "Marina", "Ola", "Therese"];
function rememberDriver(c: TravelChoice | null) {
  for (const n of [c?.to?.by, c?.home?.by]) if (n) d.knownDrivers = [n, ...d.knownDrivers.filter((x) => x.toLowerCase() !== n.toLowerCase())].slice(0, 12);
}
// Calendar notes, as SportAdmin/laget.se send them.
for (const day of d.days)
  for (const e of day.events)
    if (e.category === "sport")
      e.description = e.title.startsWith("F14")
        ? "Samling: 15 min innan\nPlats: Konstgräset, Heden\nTa med: vattenflaska, benskydd och mörk tröja\n\nhttps://www.sportadmin.se/"
        : "Samling i entrén 10 min innan.\nTa med: badmössa, handduk och schampo.";
// Charging from the car's own integration (Tesla-style switch and schedule).
fx.cars.forEach((c, i) => {
  c.charging = {
    switch: { entityId: `switch.car${i}_charger`, name: "Laddning", on: Boolean(d.cars[i]?.charging) },
    schedule: [
      { entityId: `time.car${i}_scheduled_charging`, name: "Schemalagd laddning", value: "01:00" },
      { entityId: `switch.car${i}_off_peak`, name: "Ladda billigaste timmarna", value: "På" },
      { entityId: `sensor.car${i}_ready_by`, name: "Klar till avgång", value: "tis 07:00" },
    ],
  };
});
// ---- Energy today in the demo (a sunny October day with solar and a grid meter) ----
if (d.energy) {
  d.energy.selfUseKw = Math.min(d.energy.solarKw ?? 0, d.energy.houseKw ?? 0);
  d.energy.today = { solarKwh: 13.7, importKwh: 23.6, exportKwh: 4.7, houseKwh: 32.6, selfUseKwh: 9, selfSufficiencyPct: 28, costKr: 41 };
}

// ---- Från skolan (Vklass news) in the demo, with a poster as attachment ----
const poster = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800"><rect width="600" height="800" fill="#f2dfb8"/><text x="300" y="150" font-family="sans-serif" font-size="72" font-weight="800" text-anchor="middle" fill="#3a2a14">HÖSTLOV</text><text x="300" y="215" font-family="sans-serif" font-size="30" font-weight="700" text-anchor="middle" fill="#2f6b1f">PÅ BIBLIOTEKET</text><g font-family="sans-serif" font-size="26" fill="#3a2a14"><text x="60" y="330" font-weight="700">Mån 26 okt 10–15</text><text x="60" y="370">Pärla figurer</text><text x="60" y="450" font-weight="700">Tis 27 okt 14.30–16.30</text><text x="60" y="490">Workshop, från 9 år. Anmälan!</text><text x="60" y="570" font-weight="700">Ons 28 okt 13–15</text><text x="60" y="610">Bygg figurer i papper</text></g><text x="300" y="740" font-family="sans-serif" font-size="28" font-weight="700" text-anchor="middle" fill="#3a2a14">Fri entré</text></svg>`,
)}`;
d.schoolNews = [
  {
    id: "n1",
    personId: "ella",
    who: "Ella",
    color: "#5ab8ff",
    title: "Höstlov på biblioteket",
    text: "Välkommen till biblioteket på höstlovet! Vi kör pärlcraft, workshop, bygger figurer och tipspromenad med vinster. Kom och levla upp lovet med oss!",
    published: "2026-10-18T11:50:00.000Z",
    date: "18 okt",
    files: [{ name: "Höstlov affisch", url: poster }],
    seen: false,
  },
  {
    id: "n2",
    personId: "maja",
    who: "Maja",
    color: "#34e0a1",
    title: "Presentation från vårdnadshavarmötet",
    text: "Enligt önskemål kommer här presentationen från mötet.\nHör av er om ni har frågor!",
    published: "2026-10-14T07:05:00.000Z",
    date: "14 okt",
    files: [],
    seen: true,
  },
];
d.reminders.unshift({ icon: "school", title: "Från skolan: Höstlov på biblioteket", sub: "Ella · tryck för att läsa", tone: "blue", newsId: "n1" });
d.reminders = d.reminders.slice(0, 5);

const demoCal = (title: string) => (title.startsWith("F14") ? { id: "ella-sport", name: "Fotboll F14" } : { id: "leo-sim", name: "Simning" });
const savedTravel: Record<string, TravelChoice> = {
  "ella-sport@2026-10-19T17:30": { to: { mode: "adult:emil" }, home: { mode: "ride", by: "Saras pappa" } },
};
const calTravel: Record<string, TravelChoice> = { "leo-sim": { to: { mode: "bus" }, home: { mode: "adult:emil" } } };
const legLabel = (l: TravelLeg) =>
  l.mode === "bus" ? "Buss" : l.mode === "self" ? "Cyklar/går" : l.mode === "ride" ? (l.by ? `${l.by} skjutsar` : "Annan skjutsar") : l.mode === "adult:anna" ? "Anna skjutsar" : "Emil skjutsar";
function decorate(e: DashEvent, dayKey: string) {
  if (e.category !== "sport" || !e.time) return;
  const cal = demoCal(e.title);
  const key = `${cal.id}@${dayKey}T${e.time}`;
  const own = savedTravel[key];
  const c = own ?? calTravel[cal.id] ?? {};
  const fmt = (l?: TravelLeg) => (l ? { ...l, label: legLabel(l) } : undefined);
  e.travel = { key, calendarId: cal.id, calendarName: cal.name, to: fmt(c.to), home: fmt(c.home), fromCalendar: !own && Boolean(calTravel[cal.id]) };
}
function summary(e: DashEvent) {
  const t = e.travel;
  if (!t || (!t.to && !t.home)) return "";
  if (t.to && t.home && t.to.label === t.home.label) return `${t.to.label} dit och hem`;
  const low = (x: string) => (/ skjutsar$/.test(x) ? x : x[0].toLowerCase() + x.slice(1));
  return [t.to && `${t.to.label} dit`, t.home && `${low(t.home.label)} hem`].filter(Boolean).join(" · ").replace(/^./, (c) => c.toUpperCase());
}
function syncTravel() {
  for (const day of d.days) for (const e of day.events) decorate(e, day.key);
  const tomorrow = d.days[1]?.key ?? "";
  for (const e of d.now.items) decorate(e, e.dayLabel === "imorgon" ? tomorrow : d.days[0].key);
  for (const r of d.reminders) {
    if (r.icon !== "bag") continue;
    const ev = d.days[1]?.events.find((e) => e.travel && r.title.includes(e.title));
    if (!ev) continue; // not a sport reminder (e.g. "ta med till förskolan")
    const s = ev ? summary(ev) : "";
    r.sub = s ? `Packa väskan · ${s}` : "Packa väskan · tryck i kalendern för att välja skjuts";
  }
  for (const e of d.now.items) if (e.travel?.kind === "care") e.travel = careTravelFor(e.travel.key.split("@")[2]);
  const mon = careTravelFor("2026-10-19");
  const r = d.reminders.find((x) => x.title.startsWith("Maja · förskola"));
  if (r) r.sub = [mon.to && `${mon.to.label} lämnar`, mon.home && `${mon.home.label} hämtar`].filter(Boolean).join(" · ") || "Vem lämnar och hämtar? Tryck på lämningen i Nu";
  syncPlan();
  syncMeals();
}

/** Planera veckan in the demo: the recorded activities plus Maja's förskola days (closed Friday). */
function syncPlan() {
  const items: PlanItem[] = [];
  for (const day of d.days) {
    const label = day.isToday ? "idag" : day.name === "Imorgon" ? "imorgon" : `${day.name.toLowerCase()} ${day.date}`;
    for (const e of day.events) if (e.travel) items.push({ ...e, travel: e.travel, dayKey: day.key, dayLabel: label });
    const wd = new Date(`${day.key}T12:00:00`).getDay();
    if (wd >= 1 && wd <= 5 && day.key !== "2026-10-23") {
      items.push({
        time: wd === 5 ? "08:00" : "07:30",
        end: wd === 5 ? "15:00" : "16:00",
        title: "Förskola",
        color: "#34e0a1",
        who: "Maja",
        initial: "M",
        category: "school",
        icon: "school",
        travel: careTravelFor(day.key),
        dayKey: day.key,
        dayLabel: label,
      });
    }
  }
  // Grown-ups' own calendars in the demo: Emil has a customer meeting before Wednesday's training,
  // Anna travels on Thursday.
  for (const it of items) {
    if (it.dayKey === "2026-10-21" && it.title.includes("Träning")) it.busy = [{ personId: "emil", leg: "to", title: "Kundmöte 16:00–17:15" }];
    if (it.dayKey === "2026-10-22" && it.title === "Förskola") it.busy = [{ personId: "anna", leg: "to", title: "Tjänsteresa Malmö" }, { personId: "anna", leg: "home", title: "Tjänsteresa Malmö" }];
  }
  items.sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.time.localeCompare(b.time));
  const attention = (i: PlanItem) => !i.travel.to || !i.travel.home || (i.busy ?? []).some((b) => (b.leg === "to" ? i.travel.to : i.travel.home)?.mode === `adult:${b.personId}`);
  d.plan = { missing: items.filter(attention).length, items };
}

const LAMP_NAMES: Record<string, string> = {
  "light.kok_tak": "Taklampa",
  "light.kok_bank": "Bänkbelysning",
  "light.vardagsrum": "Taklampa",
  "light.fonster_vardagsrum": "Fönsterlampa",
  "light.barnrum": "Barnrum",
};
const dimLevel = new Map<string, number>([
  ["light.kok_tak", 80],
  ["light.kok_bank", 45],
  ["light.vardagsrum", 60],
  ["light.fonster_vardagsrum", 30],
]);
function lampOn(id: string) {
  return d.lights.find((l) => l.entityId === id)?.on ?? groupState.get(id) ?? false;
}
function recountGroups() {
  const cfg = fx.config.config;
  d.lights = d.lights.map((l) => ({ ...l, dimmable: !l.offline && l.name !== "Ute", brightness: l.on && l.name !== "Ute" ? (dimLevel.get(l.entityId) ?? 100) : undefined }));
  d.lightGroups = d.lightGroups.map((g) => {
    const ids = cfg.entities.lightGroups[g.index]?.entities ?? [];
    const lamps = ids.map((id) => {
      const offline = d.lights.find((l) => l.entityId === id)?.offline ?? false;
      const on = !offline && lampOn(id);
      return { entityId: id, name: LAMP_NAMES[id] ?? id, on, offline, dimmable: !offline, brightness: on ? (dimLevel.get(id) ?? 100) : undefined };
    });
    return { ...g, on: lamps.filter((l) => l.on).length, lamps };
  });
}
const groupState = new Map<string, boolean>([
  ["light.kok_bank", true],
  ["light.fonster_vardagsrum", true],
]);
recountGroups();
// The demo is always the latest version.
d.version = { current: pkg.version, latest: pkg.version };

function syncDayParts() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  d.daypart = h >= 7 && h < 19 ? "day" : "night";
  d.header.phase = h >= 5 && h < 8 ? "dawn" : h >= 8 && h < 17.5 ? "day" : h >= 17.5 && h < 21 ? "dusk" : "night";
  // October in mid-Sweden: up 07:35, down 17:40.
  const rise = 7 + 35 / 60;
  const set = 17 + 40 / 60;
  d.header.sun = { rise: "07:35", set: "17:40", pos: h >= rise && h <= set ? Math.round(((h - rise) / (set - rise)) * 100) / 100 : undefined };
  d.night = false;
  syncNow();
}

/** Recompute the Nu-zon from the viewer's clock so "Om 45 min" is always true in the demo. */
const baseNow = structuredClone(fx.dashboard.now);
function syncNow() {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const at = (t: string, day: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m + (day === "imorgon" ? 1440 : 0) - mins;
  };
  const items = baseNow.items
    .map((e) => ({ ...e, inMinutes: at(e.time, e.dayLabel) }))
    .filter((e) => e.inMinutes > -60)
    .sort((a, b) => a.inMinutes - b.inMinutes)
    .slice(0, 3);
  const first = items[0];
  let headline = "Inget mer inplanerat idag";
  if (first) {
    const m = first.inMinutes;
    if (m <= 0) headline = `Pågår: ${first.title}`;
    else if (m < 60) headline = `Om ${m} min`;
    else if (m < 180) headline = `Om ${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim();
    else headline = first.dayLabel === "idag" ? `Senare idag kl ${first.time}` : `Imorgon kl ${first.time}`;
  }
  d.now = { headline, items };
  syncTravel();
}

const providerTest = (i: Integration): TestResult => {
  switch (i.provider) {
    case "vklass":
      return { ok: true, message: "Inloggad. Hittade 2 barn.", discovered: ["Ella Demo", "Leo Demo"], preview: ["Leo Demo · Måndag: Fiskgratäng med potatis"] };
    case "skolmaten":
    case "skolmat-ha":
      return { ok: true, preview: ["Måndag 19/10: Fiskgratäng med potatis", "Tisdag 20/10: Kycklinggryta med ris", "Onsdag 21/10: Pannkakor med sylt"] };
    case "school-ics":
      return { ok: true, message: "24 händelser kommande tre veckor.", preview: ["Tis 20 okt 08:10 · Idrott", "Tor 22 okt 08:10 · Idrott"] };
    case "edp":
      if (!i.settings.building)
        return {
          ok: true,
          message: "Hittade 2 adresser – välj din och testa igen.",
          choices: { field: "building", options: ["STORGATAN 1, DEMOSTAD", "STORGATAN 1 B, DEMOSTAD"].map((v) => ({ value: v, label: v })) },
        };
      return { ok: true, message: "Hämtdagar hittade.", preview: ["Tis 20 okt · Matavfall, Kärl 140L", "Fre 23 okt · Restavfall, Kärl 190L"] };
    case "manual":
      return { ok: true, preview: ["Tis 20 okt · Matavfall", "Tis 3 nov · Matavfall"] };
    case "willys":
    case "hemkop":
    case "ica":
    case "citygross":
      return { ok: true, message: `Inloggad hos ${{ willys: "Willys", hemkop: "Hemköp", ica: "ICA", citygross: "City Gross" }[i.provider]} (demo).` };
    case "spot":
      return { ok: true, preview: [`24 timmar · lägst 0,10 kr · högst 1,35 kr (spot) · ${i.settings.area ?? "SE3"}`] };
    default:
      return { ok: true, preview: ["Demo: allt ser bra ut"] };
  }
};

const CANDIDATES: Record<string, GroceryLine["candidates"]> = {
  mjölk: [
    { code: "101233933_ST", name: "Mellanmjölk 1,5%", brand: "Garant", volume: "1.5l", price: "17,90 kr" },
    { code: "101233934_ST", name: "Standardmjölk 3%", brand: "Arla", volume: "1.5l", price: "21,50 kr" },
  ],
  bananer: [{ code: "101205823_KG", name: "Bananer", brand: "Eko", volume: "ca 1kg", price: "24,90 kr/kg" }],
  tacoskal: [{ code: "100181519_ST", name: "Taco Shells 12-p", brand: "Santa Maria", volume: "135g", price: "26,90 kr" }],
  ost: [{ code: "101178452_ST", name: "Hushållsost 26%", brand: "Garant", volume: "1.1kg", price: "89,90 kr" }],
};

const SR_LOCAL = ["Blekinge", "Dalarna", "Gotland", "Gävleborg", "Göteborg", "Halland", "Jämtland", "Jönköping", "Kalmar", "Kristianstad", "Kronoberg", "Malmöhus", "Norrbotten", "Sjuhärad", "Skaraborg", "Stockholm", "Sörmland", "Uppland", "Värmland", "Väst", "Västerbotten", "Västernorrland", "Västmanland", "Örebro", "Östergötland"];
/** The Musik tab's list in the demo: what the radio directory gives for Sweden (no playing). */
const DEMO_STATIONS: { id: string; name: string; url: string; group: "sr" | "other"; logo?: string }[] = [
  ...["P1", "P2", "P3", "P3 Din gata"].map((n, i) => ({ id: `sr${i}`, name: n, url: `https://sverigesradio.se/topsy/direkt/srapi/${130 + i}.mp3`, group: "sr" as const })),
  ...SR_LOCAL.map((n, i) => ({ id: `p4${i}`, name: `P4 ${n}`, url: n === "Jönköping" ? "https://sverigesradio.se/topsy/direkt/srapi/203.mp3" : `https://sverigesradio.se/topsy/direkt/srapi/${300 + i}.mp3`, group: "sr" as const })),
  ...["RIX FM", "Mix Megapol", "Lugna Favoriter", "NRJ Sweden", "Bandit Rock", "Star FM", "Vinyl 107", "Power Hit Radio", "Radio Norrbotten", "Gamla Favoriter", "Retro FM", "Svensk Pop"].map((n, i) => ({
    id: `o${i}`,
    name: n,
    url: n === "RIX FM" ? "https://fm01-ice.stream.khz.se/fm01_mp3" : n === "Mix Megapol" ? "https://live-bauerse-fm.sharp-stream.com/mixmegapol_instream_se_mp3" : n === "Lugna Favoriter" ? "https://fm03-ice.stream.khz.se/fm03_mp3" : `https://example-stream.se/${i}.mp3`,
    group: "other" as const,
  })),
];

export const demoApi = {
  config: () => wait(fx.config),
  saveConfig: (config: Config, _secrets: Record<string, string | null> = {}) => {
    fx.config.config = config;
    d.home = config.dashboard.home;
    d.tabs = config.dashboard.tabs;
    d.theme = config.dashboard.theme;
    return wait(fx.config, 300);
  },
  checkPin: () => wait({ ok: true }),
  authStatus: () => wait({ paired: true, pinRequired: false, supervisor: false }),
  backup: (_password?: string) => wait({ app: "familjetavla", version: "demo", created: new Date().toISOString(), config: fx.config.config, local: {} } as unknown, 200),
  restore: (_backup: unknown, _password?: string) => wait({ ok: true as const, secrets: false }, 300),
  setSick: (personId: string, date: string, sick: boolean) => {
    const name = d.people.find((p) => p.id === personId)?.name ?? "Barnet";
    d.sick = (d.sick ?? []).filter((x) => !(x.personId === personId && x.date === date));
    d.reminders = d.reminders.filter((r) => r.title !== `${name} är sjuk idag`);
    if (sick) {
      d.sick.push({ personId, name, date });
      d.reminders.unshift({ icon: "kids", title: `${name} är sjuk idag`, sub: "Förskola, skola och aktiviteter är strukna", tone: "amber" });
    }
    return wait({ ok: true as const }, 150);
  },
  choreToggle: (id: string, done: boolean) => {
    for (const p of d.chores) {
      const i = p.items.find((x) => x.id === id);
      if (i) i.done = done;
      p.allDone = p.items.every((x) => x.done);
    }
    return wait({ ok: true as const }, 100);
  },
  chores: () => wait({ chores: d.chores.flatMap((p) => p.items.map((i) => ({ id: i.id, personId: p.personId, title: i.title, days: [] as number[] }))) }, 100),
  saveChores: (_c: { id: string; personId: string; title: string; days: number[] }[]) => wait({ ok: true as const }, 100),
  shelf: (personId: string, items: string[]) => {
    d.shelf = items.length ? [{ personId, name: "Maja", items }] : [];
    d.reminders = d.reminders.filter((r) => !r.title.startsWith("Maja · ta med"));
    if (items.length) d.reminders.splice(1, 0, { icon: "bag", title: `Maja · ta med till förskolan: ${items.join(", ").toLowerCase()}`, sub: "Bocka av när det är lämnat – tryck på lämningen", tone: "amber" });
    return wait({ ok: true as const }, 150);
  },
  dinner: (day: string, text: string, _shopping?: string) => {
    if (text.trim()) dinners[day] = text.trim();
    else delete dinners[day];
    syncMeals();
    return wait({ ok: true as const }, 150);
  },
  notifyServices: () => wait(["mobile_app_emils_iphone", "mobile_app_annas_pixel", "family_group"], 400),
  notifyTest: (_service: string) => wait<TestResult>({ ok: true, message: "Skickat – titta i telefonen. (demo)" }, 500),
  newFeed: (personId: string) => wait({ ok: true as const, path: `api/feed/demo-${personId}.ics` }, 300),
  pair: (_pin: string, _name: string) => wait({ ok: true as const }),
  forgetDevices: () => wait({ ok: true as const }),
  dashboard: () => {
    syncDayParts();
    return wait(d, 120);
  },

  testProvider: (integration: Integration, _secrets: Record<string, string>) => wait(providerTest(integration), 700),
  testHa: (_url?: string, _token?: string) => wait<TestResult>({ ok: true, message: "Ansluten – 40 entiteter (demo)." }, 500),
  entities: (domains: string[]) => wait(fx.entities.filter((e) => !domains.length || domains.includes(e.entityId.split(".")[0]))),
  testCalendar: (body: { include?: string[]; exclude?: string[] }) => {
    const r = structuredClone(fx.calendarTest);
    if (body.include?.length) {
      const inc = body.include.map((x) => x.toLowerCase());
      r.preview = (r.preview ?? []).filter((p) => inc.some((t) => p.toLowerCase().includes(t)));
      r.message = `${r.preview.length * 2} av 17 händelser kommande 45 dagar visas.`;
    }
    return wait(r, 500);
  },
  postcode: (q: string) =>
    wait<PostcodeInfo>({ postcode: q.replace(/\s/g, ""), place: "Lund", municipality: "Lunds kommun", lat: 55.7, lon: 13.19, area: "SE4", wasteProvider: "lund" }, 500),

  groceryPreview: () =>
    wait(
      {
        store: "Willys",
        lines: d.shopping.items
          .filter((i) => !i.done)
          .map((i) => ({ item: i.name, remembered: null, candidates: CANDIDATES[i.name.toLowerCase()] ?? [{ code: `demo_${i.id}`, name: i.name, price: "–" }] })),
      },
      700,
    ),
  grocerySend: (lines: { item: string; code: string; name: string; qty: number }[]) =>
    wait({ ok: true, store: "Willys", items: lines.reduce((s, l) => s + l.qty, 0), total: `${(lines.length * 23.4).toFixed(2).replace(".", ",")} kr` }, 900),

  discover: () => wait(fx.discover, 900),
  car: (index: number) => wait(fx.cars[index]),
  carAction: (index: number, entityId: string, action: "on" | "off" | "press") => {
    const ch = fx.cars[index].charging?.switch;
    if (ch && ch.entityId === entityId) {
      ch.on = action === "on";
      if (d.cars[index]) d.cars[index].charging = ch.on;
      return wait({});
    }
    const a = fx.cars[index].actions.find((x) => x.entityId === entityId);
    if (a && a.domain !== "button") a.state = a.domain === "lock" ? (action === "off" ? "unlocked" : "locked") : action === "off" ? "off" : "on";
    return wait({});
  },
  run: (entityId: string, action: "on" | "off" | "press" = "on") => {
    for (const c of d.cars) if (c.climate?.entityId === entityId) c.climate.on = action !== "off";
    return wait({});
  },
  saveSchedule: (s: Schedule) => {
    for (const c of d.cars) {
      if (c.climate?.entityId !== s.entityId) continue;
      c.schedules = [...c.schedules.filter((x) => x.id !== s.id), { id: s.id, name: s.name, days: s.days, time: s.time, enabled: s.enabled }].sort((a, b) =>
        a.time.localeCompare(b.time),
      );
    }
    return wait({});
  },
  deleteSchedule: (id: string) => {
    for (const c of d.cars) c.schedules = c.schedules.filter((s) => s.id !== id);
    return wait({});
  },
  control: (entityId: string, op: "toggle" | "select" | "set" | "press", value?: string | number) => {
    for (const c of [...d.deviceCards.flatMap((x) => x.controls), ...d.climates.flatMap((x) => x.controls)]) {
      if (c.entityId !== entityId) continue;
      if (op === "toggle") c.on = !c.on;
      if (op === "select" || op === "set") c.state = String(value);
    }
    return wait({});
  },
  climateMode: (entityId: string, _field: string, value: string) => {
    const c = d.climates.find((x) => x.entityId === entityId);
    if (c) c.active = value;
    return wait({});
  },
  climateTarget: (entityId: string, temperature: number) => {
    const c = d.climates.find((x) => x.entityId === entityId);
    if (c) c.target = temperature;
    return wait({});
  },
  lightGroup: (index: number, on: boolean) => {
    const ids = fx.config.config.entities.lightGroups[index]?.entities ?? [];
    for (const id of ids) {
      const l = d.lights.find((x) => x.entityId === id);
      if (l && !l.offline) l.on = on;
      else if (!l) groupState.set(id, on);
    }
    recountGroups();
    return wait({});
  },
  button: (_entityId: string) => {
    for (const l of d.lights) if (l.name !== "Ute") l.on = false;
    for (const k of groupState.keys()) groupState.set(k, false);
    recountGroups();
    return wait({});
  },
  graph: (index: number) => wait(fx.graphs[index]),
  photos: () => wait(d.idle.photos),
  uploadPhoto: (_data: string, _type: string) => wait({ photos: d.idle.photos }),
  deletePhoto: (_name: string) => wait({ photos: d.idle.photos }),
  toggleLight: (entityId: string) => {
    const l = d.lights.find((x) => x.entityId === entityId);
    if (l) l.on = !l.on;
    else groupState.set(entityId, !lampOn(entityId));
    recountGroups();
    return wait({});
  },
  brightness: (entityId: string, pct: number) => {
    const l = d.lights.find((x) => x.entityId === entityId);
    if (pct > 0) dimLevel.set(entityId, pct);
    if (l) l.on = pct > 0;
    else groupState.set(entityId, pct > 0);
    recountGroups();
    return wait({});
  },
  saveHomeLayout: (home: { id: string; on: boolean }[]) => {
    const old = new Map(d.home.map((w) => [w.id, w]));
    d.home = home.map((w) => ({ ...old.get(w.id as never), id: w.id as never, on: w.on }));
    fx.config.config.dashboard.home = d.home;
    return wait({});
  },
  cameraUrl: (entityId: string, _t: number) => demoCamera(entityId),
  lock: (entityId: string, op: "lock" | "unlock" | "open", _code?: string) => {
    const l = d.security?.locks.find((x) => x.entityId === entityId);
    if (l) l.state = op === "lock" ? "locked" : "unlocked";
    return wait({});
  },
  alarm: (entityId: string, mode: "home" | "away" | "night" | "vacation" | "off", _code?: string) => {
    const a = d.security?.alarms.find((x) => x.entityId === entityId);
    const names = { home: "På – hemma", away: "På – borta", night: "På – natt", vacation: "På – semester", off: "Av" };
    if (a) Object.assign(a, { state: mode === "off" ? "disarmed" : `armed_${mode}`, armed: mode !== "off", label: names[mode] });
    return wait({});
  },
  cover: (entityId: string, op: "open" | "close" | "stop") => {
    const c = d.security?.covers.find((x) => x.entityId === entityId);
    if (c && op !== "stop") Object.assign(c, { state: op === "open" ? "open" : "closed", open: op === "open", label: op === "open" ? "Öppen" : "Stängd" });
    return wait({});
  },
  robot: (entityId: string, op: "start" | "pause" | "dock") => {
    const r = d.robots?.find((x) => x.entityId === entityId);
    const mower = r?.kind === "mower";
    if (r) Object.assign(r, op === "start" ? { state: mower ? "mowing" : "cleaning", label: mower ? "Klipper" : "Städar", busy: true, error: false } : op === "pause" ? { state: "paused", label: "Pausad", busy: false } : { state: "returning", label: "Åker hem", busy: true, error: false });
    return wait({});
  },
  lightsOff: () => {
    for (const l of d.lights) l.on = false;
    recountGroups();
    return wait({});
  },
  playStation: (index: number, speaker: string) => {
    const sp = d.music?.speakers.find((x) => x.entityId === speaker);
    const st = d.music?.stations[index];
    if (sp && st) Object.assign(sp, { playing: true, station: index, title: st.name });
    return wait({});
  },
  tryStation: (_name: string, _url: string, _speaker: string) => wait({}),
  musicStations: () => wait({ stations: DEMO_STATIONS }),
  spotify: (_op: "playpause" | "next") => wait({}),
  musicLibrary: (shelf: Shelf) => wait({ tiles: demoTiles(shelf) }),
  musicSearch: (q: string) => wait({ tiles: demoTiles("playlists").filter((t) => t.title.toLowerCase().includes(q.toLowerCase())) }),
  cancelEvent: (key: string, on: boolean) => {
    if (on) for (const day of d.days ?? []) day.events = day.events.filter((x) => x.cancelKey !== key);
    return wait({});
  },
  musicItems: (uri: string) => {
    const songs: [string, string][] = [["Mamma Mu", "Barnens favoriter"], ["Idas sommarvisa", "Astrid Lindgren"], ["Här kommer Pippi Långstrump", "Astrid Lindgren"], ["Små grodorna", "Trazan & Banarne"], ["Bä bä vita lamm", "Barnkören"], ["Imse vimse spindel", "Barnkören"], ["Björnen sover", "Barnkören"], ["Lilla snigel", "Barnkören"], ["Fem små apor", "Trazan & Banarne"], ["Vi är vänner", "Barnens favoriter"], ["Sov du lilla videung", "Astrid Lindgren"], ["Gubben Noak", "Barnkören"], ["Huvud, axlar, knä och tå", "Barnkören"], ["Ekorrn satt i granen", "Barnkören"]];
    return wait({ title: "", tracks: songs.map(([title, artist], i) => ({ uri: `${uri}/track/${i}`, title, artist, image: cover(title, i + 3) })) });
  },
  playConnect: (t: Tile, device: string) => {
    if (d.music?.spotify) Object.assign(d.music.spotify, { playing: true, title: t.title, device });
    return wait({});
  },
  playMedia: (t: Tile, speaker: string, _start?: string) => {
    const sp = d.music?.speakers.find((x) => x.entityId === speaker);
    if (sp) Object.assign(sp, { playing: true, station: undefined, title: t.title, playingUrl: undefined });
    return wait({});
  },
  playStationId: (id: string, speaker: string) => {
    const sp = d.music?.speakers.find((x) => x.entityId === speaker);
    const st = DEMO_STATIONS.find((x) => x.id === id);
    const fav = d.music?.stations.findIndex((x) => x.url === st?.url) ?? -1;
    if (sp && st) Object.assign(sp, { playing: true, station: fav >= 0 ? fav : undefined, title: st.name, playingUrl: st.url });
    return wait({});
  },
  favoriteStation: (b: { id?: string; url?: string; on: boolean }) => {
    if (!d.music) return wait({});
    const st = DEMO_STATIONS.find((x) => x.id === b.id);
    const list = d.music.stations.map((x) => ({ name: x.name, url: x.url, logo: x.logo }));
    const next = b.on && st ? [...list, { name: st.name, url: st.url, logo: st.logo }] : list.filter((x) => x.url !== b.url);
    d.music.stations = next.map((x, index) => ({ index, ...x }));
    return wait({});
  },

  stopMusic: (speaker: string) => {
    const sp = d.music?.speakers.find((x) => x.entityId === speaker);
    if (sp) Object.assign(sp, { playing: false, station: undefined, title: undefined });
    return wait({});
  },
  volume: (speaker: string, pct: number) => {
    const sp = d.music?.speakers.find((x) => x.entityId === speaker);
    if (sp) sp.volume = pct;
    return wait({});
  },
  searchStations: (q: string) =>
    wait({
      stations: [
        { name: "P4 Jönköping", url: "https://sverigesradio.se/topsy/direkt/srapi/203.mp3", country: "SE", quality: "MP3 192 kbit/s" },
        { name: "P4 Jämtland", url: "https://sverigesradio.se/topsy/direkt/srapi/200.mp3", country: "SE", quality: "MP3 192 kbit/s" },
        { name: "RIX FM", url: "https://fm01-ice.stream.khz.se/fm01_mp3", country: "SE", quality: "MP3 128 kbit/s" },
      ].filter((x) => x.name.toLowerCase().includes(q.toLowerCase().slice(0, 2))),
    }),
  addItem: (name: string) => {
    d.shopping.items.push({ id: String(Date.now()), name, done: false });
    return wait({});
  },
  toggleItem: (id: string, done: boolean) => {
    d.shopping.items = d.shopping.items.map((i) => (i.id === id ? { ...i, done } : i));
    return wait({});
  },
  clearDone: () => {
    d.shopping.items = d.shopping.items.filter((i) => !i.done);
    return wait({});
  },
  newsSeen: (ids: string[]) => {
    for (const n of d.schoolNews) if (ids.includes(n.id)) n.seen = true;
    d.reminders = d.reminders.filter((r) => !(r.icon === "school" && d.schoolNews.some((n) => n.seen && r.title.endsWith(n.title))));
    return wait({ ok: true as const }, 100);
  },
  addOwnEvent: (e: { date: string; time?: string; end?: string; title: string; personId?: string; note?: string }) => {
    const id = `own${Date.now().toString(36)}`;
    const p = d.people.find((x) => x.id === e.personId);
    const day = d.days.find((x) => x.key === e.date);
    if (day) {
      day.events.push({ time: e.time ?? "", end: e.end, title: e.title, color: p?.color ?? "#34e0a1", who: p?.name ?? "", initial: p?.initial, category: "family", icon: "event", description: e.note, ownId: id });
      day.events.sort((x, y) => (x.time || "00:00").localeCompare(y.time || "00:00"));
    }
    return wait({ id }, 200);
  },
  removeOwnEvent: (id: string) => {
    for (const day of d.days) day.events = day.events.filter((x) => x.ownId !== id);
    return wait({ ok: true as const }, 150);
  },
  travel: (key: string, choice: TravelChoice | null, forCalendar = false) => {
    rememberDriver(choice);
    if (key.startsWith("care:")) {
      // Förskola in the demo: one day, or (forCalendar) the default for all days.
      if (forCalendar) {
        careDefault.to = choice?.to;
        careDefault.home = choice?.home;
        for (const k of Object.keys(careSaved)) delete careSaved[k];
      } else careSaved[key] = choice ?? {};
      for (const e of baseNow.items) if (e.travel?.kind === "care") e.travel = careTravelFor(e.travel.key.split("@")[2]);
      syncTravel();
      return wait({ ok: true as const }, 150);
    }
    if (forCalendar) {
      const calId = key.slice(0, key.lastIndexOf("@"));
      if (choice) calTravel[calId] = choice;
      else delete calTravel[calId];
      delete savedTravel[key];
    } else if (choice && (choice.to || choice.home)) savedTravel[key] = choice;
    else delete savedTravel[key];
    syncTravel();
    return wait({ ok: true as const }, 150);
  },
};


/** Made-up covers for the demo's library: a coloured square per playlist, no real artwork. */
const COVER_COLOURS = ["#1db954", "#e8115b", "#509bf5", "#f59b23", "#8d67ab", "#148a08", "#dc148c", "#0d73ec", "#e1118c", "#777777"];
function cover(title: string, i: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${COVER_COLOURS[i % COVER_COLOURS.length]}"/><text x="50" y="60" font-family="sans-serif" font-size="30" font-weight="700" fill="#fff" text-anchor="middle">${title.slice(0, 2).toUpperCase()}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
const DEMO_LIBRARY: Record<Shelf, [string, string?][]> = {
  recent: [["Fredagsmys"], ["Barnens favoriter"], ["Godnattsagor"], ["Melodifestivalen 2026"], ["Lugnt till middagen"], ["Bilresan"], ["Träning"], ["Julmusik"]],
  playlists: [["Barnens favoriter"], ["Bilresan"], ["Fredagsmys"], ["Godnattsagor"], ["Julmusik"], ["Lugnt till middagen"], ["Melodifestivalen 2026"], ["Morgonpigg"], ["Städa huset"], ["Sommarhits"], ["Träning"], ["Veckans topplista"]],
  albums: [["Främling", "Carola"], ["Hello Hello", "Laleh"], ["Vapen & ammunition", "Kent"], ["Arrival", "ABBA"], ["Pippi Långstrump", "Astrid Lindgren"], ["Sånger för barn", "Trazan & Banarne"]],
  podcasts: [["Sommar i P1", "Sveriges Radio"], ["Barnens nyheter", "Sveriges Radio"], ["Spöktimmen", "Sveriges Radio"], ["Godnattpodden", "Sveriges Radio"]],
};
function demoTiles(shelf: Shelf): Tile[] {
  const type = shelf === "albums" ? "album" : shelf === "podcasts" ? "podcast" : "playlist";
  return DEMO_LIBRARY[shelf].map(([title, subtitle], i) => ({ uri: `demo://${type}/${i}`, type, title, subtitle, image: cover(title, i) }));
}

/** Made-up camera pictures for the demo: a sky, a lawn and a house outline – no real camera. */
function demoCamera(entityId: string) {
  const hue = entityId.length * 37 % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,70%)"/><stop offset="1" stop-color="hsl(${hue},35%,88%)"/></linearGradient></defs><rect width="320" height="180" fill="url(#s)"/><rect y="120" width="320" height="60" fill="#5c8a4a"/><path d="M110 120V80l50-35 50 35v40z" fill="#c9b79c"/><rect x="148" y="92" width="24" height="28" fill="#6b4f3a"/><text x="8" y="16" font-family="monospace" font-size="11" fill="#fff">${new Date().toLocaleTimeString("sv-SE")}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
