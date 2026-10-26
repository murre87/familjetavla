// Delade typer mellan server och webb. Importeras av webben med `import type`.

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7; // 1 = måndag … 7 = söndag (ISO)

export type CustodyMode =
  | "always" // bor alltid här
  | "oddWeeks" // udda ISO-veckor
  | "evenWeeks" // jämna ISO-veckor
  | "alternating" // varannan vecka räknat från ett startdatum (tål vecka 53)
  | "pattern"; // eget rullande 14-dagarsmönster (2-2-3, 2-2-5-5, varannan helg …)

export interface Custody {
  mode: CustodyMode;
  /** Ett datum (YYYY-MM-DD) som ligger i en vecka då barnet är här. Används av "alternating". */
  anchorDate?: string;
  /**
   * "pattern": 14 värden, måndag–söndag vecka A och sedan vecka B. true = barnet är här.
   * Vecka A är veckan som innehåller `anchorDate`.
   */
  pattern?: boolean[];
  /** Veckodag då bytet sker och "barnveckan" börjar. Standard måndag. */
  handoverDay?: Weekday;
  /** Manuella undantag som går före grundregeln: bytt helg, lov, klämdag. Datum inklusive. */
  overrides?: CustodyOverride[];
}

export interface CustodyOverride {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  home: boolean;
  note?: string;
}

export interface Person {
  id: string;
  name: string;
  color: string;
  kind: "adult" | "child";
  custody?: Custody;
  /** Förskola/fritids: fasta omsorgstider per veckodag. Vklass dagens tider går före när de finns. */
  care?: CareSchedule;
  /** Vuxna: påminnelser till telefonen via Home Assistant. */
  notify?: NotifySettings;
}

export interface NotifySettings {
  /** Home Assistants notify-tjänst utan "notify.", t.ex. "mobile_app_emils_iphone". */
  service?: string;
  /** Minuter före det man ansvarar för (lämna, hämta, skjutsa). 0 = av. */
  before?: number;
  /** Kl 20: vad man ansvarar för imorgon. */
  evening?: boolean;
  /** Barnen (id) den vuxna vill ha notiser om. Saknas = alla. Det man själv ansvarar för kommer alltid. */
  children?: string[];
  /** "06:45": dagens kom ihåg och det man ansvarar för idag. "" = av, saknas = 06:45. */
  morning?: string;
  /** Söndag kl 19: "Planera veckan" om något saknar ansvarig. */
  weekly?: boolean;
  /** Hemmet: tvätten klar, roboten har fastnat, dörren olåst kl 22, porten öppen, larmet. Saknas = på. */
  home?: boolean;
  /** En notis när en ny version av Familjetavlan finns (en gång per version). Saknas = på. */
  updates?: boolean;
}

export interface CareSchedule {
  /** Visas på tavlan, t.ex. "Förskola" eller "Fritids". */
  name?: string;
  /** ISO-veckodag "1"–"7" → "07:30-16:00". Saknas en dag = ingen omsorg den dagen. */
  days: Record<string, string>;
  /**
   * Rullande schema (skift): vecka 2, 3, 4 … i samma format som `days`, som då är vecka 1.
   * Saknas = samma tider varje vecka.
   */
  weeks?: Record<string, string>[];
  /** Ett datum (YYYY-MM-DD) i schemats vecka 1. Krävs när `weeks` finns. */
  anchorDate?: string;
  /** Vem som brukar lämna (to) och hämta (home). */
  travel?: TravelChoice;
  /** Återkommande per veckodag ("1"–"5"), t.ex. tisdag "Utflykt – packa ryggsäck och frukt". */
  notes?: Record<string, string>;
}

export type CalendarCategory = "family" | "sport" | "school" | "work" | "other";

export type CalendarProvider = "google" | "icloud" | "laget" | "sportadmin" | "svenskalag" | "infomentor" | "outlook" | "ics" | "ha";

export interface CalendarSource {
  id: string;
  name: string;
  provider: CalendarProvider;
  /** "ics": URL lagras som hemlighet `calendar.<id>.url`. "ha": entity_id. */
  kind: "ics" | "ha";
  entityId?: string;
  personId?: string;
  /** Flera personer som kalendern gäller ("Gäller": Emil + Elin). Är det en enda sätts även personId. */
  personIds?: string[];
  category: CalendarCategory;
  /** Visa bara händelser som matchar något av dessa (lag, grupp eller ord). Tomt = alla. */
  include?: string[];
  /** Dölj händelser som matchar något av dessa. */
  exclude?: string[];
  /**
   * Barnkalendrar: "custody" = bara barnets veckor (standard), "always" = alla veckor.
   * `alwaysShow` gör undantag, t.ex. ["match", "cup"] – matcher syns varje vecka men träningar bara barnveckor.
   */
  visibility?: "custody" | "always";
  alwaysShow?: string[];
  /** Standard för hur barnet tar sig till och från aktiviteterna i den här kalendern. */
  travel?: TravelChoice;
}

/**
 * Hur ett barn tar sig till/från en aktivitet:
 * "adult:<id>" = den vuxna skjutsar, "ride" = blir skjutsad av någon annan, "bus" = buss, "self" = cyklar/går.
 */
export type TravelMode = "bus" | "self" | "ride" | `adult:${string}`;
export interface TravelLeg {
  mode: TravelMode;
  /** Vem som skjutsar när mode är "ride", t.ex. "Saras pappa". */
  by?: string;
}
export interface TravelChoice {
  to?: TravelLeg;
  home?: TravelLeg;
}

export const HOME_WIDGETS = ["now", "meals", "schoolday", "chores", "reminders", "custody", "week", "shopping", "prices", "cars", "lights", "temps", "energy", "climates", "music"] as const;
export type HomeWidget = (typeof HOME_WIDGETS)[number];
/** Startskärmens rutor: "auto" följer hur många rutor som visas, annars liten/normal/stor. */
export type WidgetSize = "auto" | "s" | "m" | "l";
export const TAB_IDS = ["food", "cars", "lights", "house", "energy", "graphs", "music", "security", "household"] as const;
export type TabId = (typeof TAB_IDS)[number];

// ---------- Leverantörsmoduler (skola, mataffär, sopor, elpris) ----------

export type IntegrationCategory = "school" | "grocery" | "waste" | "price";

export type FieldType = "text" | "password" | "url" | "number" | "select" | "entity" | "toggle" | "schedule";

/** Egen sophämtning: ett kärl som töms med fast intervall. Lagras som JSON i fältet "schedule". */
export interface ManualPickup {
  type: string;
  /** Första (eller någon) hämtdag, YYYY-MM-DD. */
  firstDate: string;
  everyWeeks: number;
  /** Bara dessa månader (1–12). Tomt = hela året. */
  months?: number[];
}

/** Ett fält som installationsguiden ritar upp för en leverantör. */
export interface ProviderField {
  key: string;
  label: string;
  type: FieldType;
  /** Lagras krypterat och skickas aldrig tillbaka till webbläsaren. */
  secret?: boolean;
  optional?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  /** För "entity": vilka HA-domäner som listas. */
  domains?: string[];
  default?: string | number | boolean;
}

export interface ProviderMeta {
  id: string;
  category: IntegrationCategory;
  name: string;
  description: string;
  status: "stable" | "beta" | "experimental";
  /** Kräver Home Assistant. */
  needsHa?: boolean;
  fields: ProviderField[];
  /** Steg-för-steg-hjälp som visas i guiden. */
  guide?: string[];
  /** Skola: leverantören hittar själv barnen (t.ex. Vklass) i stället för en kalender per barn. */
  discoversChildren?: boolean;
  /** Butiker: fältet (nyckeln) där man väljer butik ur en lista, och om listan kräver inloggning. */
  storePicker?: { field: string; needsLogin?: boolean };
}

export type SettingValue = string | number | boolean;

export interface Integration {
  id: string;
  category: IntegrationCategory;
  provider: string;
  settings: Record<string, SettingValue>;
  /** Skola: namn hos leverantören → personens id. */
  personMap?: Record<string, string>;
  /** Skola via ICS: vilket barn kalendern gäller. */
  personId?: string;
}

/** Svar från "Testa" i guiden. */
export interface TestResult {
  ok: boolean;
  message?: string;
  /** Exempelrader att visa, t.ex. kommande händelser. */
  preview?: string[];
  /** Val som upptäcktes, t.ex. adresser hos renhållaren eller barn i Vklass. */
  choices?: { field: string; options: { value: string; label: string }[] };
  /** Namn som hittades (barn i skolplattformen) och kan kopplas till personer. */
  discovered?: string[];
}

// ---------- Home Assistant-entiteter (märkesoberoende) ----------

export interface CarEntity {
  name: string;
  battery: string;
  range?: string;
  location?: string; // device_tracker, binary_sensor eller sensor
  charging?: string;
  /** Förvärmning: climate.*, switch.* eller button.* på bilen. */
  climate?: string;
  /** Smart laddning: laddplan (sensor med attributet slots) och laddläge (select/input_select). Hittas annars av sig själva, se smartcharging.ts. */
  plan?: string;
  mode?: string;
}

export interface DeviceCard {
  title: string;
  /** Stort värde överst, t.ex. inomhustemperatur. */
  primary?: string;
  sensors: string[];
  /** switch, select, number, button, input_* … */
  controls: string[];
}

/** Tidsstyrning som servern kör, t.ex. värmestart i bilen eller spabad. */
export interface Schedule {
  id: string;
  name: string;
  entityId: string;
  action: "on" | "off" | "press";
  /** ISO-veckodagar 1–7. */
  days: number[];
  time: string; // "06:40"
  enabled: boolean;
}

export interface NamedEntity {
  name: string;
  entityId: string;
}

export interface EnergyEntities {
  /** Solproduktion (W eller kW) – valfri växelriktare. */
  solar?: string;
  /** Effekt från/till elnätet (positiv = köp). */
  grid?: string;
  /** Husets totala förbrukning. */
  house?: string;
  /** Hembatteri, laddnivå i %. */
  battery?: string;
  /** Effekt som säljs ut på nätet, när mätaren har den separat (t.ex. Tibber Pulse "Elproduktion"). */
  gridExport?: string;
  /** Mätarställningar (kWh/Wh) för dagens summor: solproduktion, köpt och såld el. */
  solarEnergy?: string;
  importEnergy?: string;
  exportEnergy?: string;
}

export interface Config {
  version: 1;
  setupComplete: boolean;
  household: {
    name: string;
    postcode?: string;
    place?: string;
    municipality?: string;
    lat?: number;
    lon?: number;
    /**
     * Valfri byteskalender (id i calendars): en heldagshändelse med barnets namn betyder hemma,
     * med barnets namn + "borta" betyder borta. Går före grundregeln.
     */
    custodyCalendarId?: string;
  };
  people: Person[];
  calendars: CalendarSource[];
  integrations: Integration[];
  shopping: {
    source: "local" | "ha";
    entityId?: string; // todo.* i Home Assistant
    /** Vilken butik (kopplingens id) listan skickas till när flera är valda. */
    sendTo?: string;
    /** Inköpsrad (gemener) → vald produkt per butik: mappings[provider][rad] */
    mappings: Record<string, Record<string, { code: string; name: string }>>;
  };
  electricity: {
    /** Antal billigaste timmar i följd som markeras. */
    cheapHours: number;
    /** Påslag från elbolaget, öre/kWh exkl. moms. */
    markupOre: number;
    /** Elöverföring/nätavgift, öre/kWh exkl. moms. */
    gridOre: number;
    /** Energiskatt, öre/kWh exkl. moms. */
    taxOre: number;
    vat: boolean;
  };
  ha: {
    mode: "none" | "supervisor" | "manual";
    url?: string;
  };
  schedules: Schedule[];
  entities: {
    cars: CarEntity[];
    energy: EnergyEntities;
    /** Snabbknappar på hemvyn. */
    lights: NamedEntity[];
    temps: NamedEntity[];
    /** Ljusfliken: grupper med Tänd alla / Släck alla. */
    lightGroups: { name: string; entities: string[] }[];
    /** Scener, skript och knappar, t.ex. "Godnatt – släck uppe". */
    buttons: { name: string; entityId: string; style: "accent" | "blue" | "amber" | "plain" }[];
    /** Hus-fliken: climate.* och water_heater.* (värmepump, termostat, varmvatten, spabad). */
    climates: (NamedEntity & { controls?: string[] })[];
    /** Hus-fliken: kort byggda av valfria sensorer och reglage (t.ex. värmepump via Husdata). */
    deviceCards: DeviceCard[];
    /** Grafer-fliken. */
    graphs: { title: string; series: { name: string; entityId: string; color: string }[] }[];
    /** Musik: högtalare (media_player.*), den första är förvald. */
    speakers?: NamedEntity[];
    /** Musik: favoritkanaler, t.ex. P4 Jönköping eller RIX FM. */
    stations?: RadioStation[];
    /** Säkerhet: kameror, lås, larm, portar och dörr-/fönstersensorer – vilket märke som helst i Home Assistant. */
    security?: SecurityEntities;
    /** Städ: robotdammsugare (vacuum.*) och robotgräsklippare (lawn_mower.*). */
    robots?: (NamedEntity & { battery?: string })[];
    /** Husgeråd: tvättmaskin, torktumlare, diskmaskin, ugn … */
    appliances?: ApplianceEntities[];
  };
  dashboard: {
    accent: string;
    theme: "auto" | "dark" | "light" | "eink" | "mirror";
    /** Startskärmens rutor i ordning; av/på per ruta. */
    home: { id: HomeWidget; on: boolean; size?: WidgetSize }[];
    /** Vilka flikar som visas. */
    tabs: { id: TabId; on: boolean }[];
    nightFrom: string; // "22:00"
    nightTo: string; // "06:00"
    /** Minuter utan beröring innan fotoramen visas. 0 = av. */
    idleMinutes: number;
    /** Solbågen under temperaturen i Nu-rutan (av som standard). */
    sunArc?: boolean;
    /** Sidan Skolan: "span" visar bara när skoldagen börjar och slutar (och idrott), inte varje lektion. */
    lessons?: "all" | "span";
  };
}

/** Hemligheter som aldrig skickas till webbläsaren. */
export type SecretKey =
  | "ha.token"
  | "admin.pin"
  | `calendar.${string}.url`
  | `feed.${string}`
  | `int.${string}.${string}`;

export interface ConfigResponse {
  config: Config;
  /** Vilka hemligheter som är satta (aldrig deras värden). */
  secretsSet: string[];
  /** Kopplingar (id) vars sparade uppgifter klarade senaste testet. */
  verified: string[];
  providers: ProviderMeta[];
  runtime: {
    supervisor: boolean;
    version: string;
    pinRequired: boolean;
  };
}

// ---------- Tavlan ----------

/** Ett reglage på tavlan, ritat efter HA-domän. */
export interface Control {
  entityId: string;
  name: string;
  domain: string;
  state: string;
  on: boolean;
  offline: boolean;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

/** Ikon per aktivitet, så att även barn som inte läser förstår tavlan. */
export type ActivityIcon =
  | "ball" | "swim" | "gym" | "music" | "school" | "trash" | "food" | "cake" | "health" | "car" | "kids" | "work" | "travel" | "event";

export interface DashEvent {
  time: string; // "17:30" eller "" för heldag
  end?: string; // "19:00"
  title: string;
  color: string;
  who: string;
  /** Alla personer händelsen gäller (kalenderns ägare/"Gäller" och namn som nämns i titeln). Saknas = hela familjen. */
  whoAll?: string[];
  /** Personens initial för avataren. */
  initial?: string;
  category: CalendarCategory | "waste";
  icon: ActivityIcon;
  location?: string;
  source?: string;
  /** Finns på barnens aktiviteter: valt sätt dit och hem. */
  travel?: DashTravel;
  /** Beskrivningen från kalendern (samlingstid, vad som behövs …). */
  /** Egen händelse (tillagd på tavlan) – id för att kunna ta bort den. */
  ownId?: string;
  /** Händelse från en kalender: nyckeln för "Utgår" (döljs bara på tavlan). */
  cancelKey?: string;
  /** Barnets händelse: kan markeras sjuk den dagen (on = det här är "Sjuk"-markeringen). */
  sick?: { personId: string; date: string; on: boolean };
  description?: string;
}

export interface MealDay {
  dayKey: string;
  /** "idag", "imorgon", "ons 21/10" */
  dayLabel: string;
  dinner?: string;
  lunch: { child: string; dishes: string[] }[];
}

export type PlanItem = DashEvent & {
  dayKey: string;
  dayLabel: string;
  travel: DashTravel;
  /** Grown-ups who have something else in their own calendar at drop-off/pick-up. */
  busy?: { personId: string; leg: "to" | "home"; title: string }[];
};

export interface DashTravel {
  key: string;
  calendarId?: string;
  calendarName?: string;
  to?: TravelLeg & { label: string };
  home?: TravelLeg & { label: string };
  /** Valen kommer från kalenderns standard, inte från just den här händelsen. */
  fromCalendar: boolean;
  /** "care" = förskola/fritids: Lämnar/Hämtar i stället för Dit/Hem. */
  kind?: "care";
}

export type Sky = "clear" | "partly" | "cloudy" | "rain" | "snow" | "fog";

export interface DashDay {
  key: string; // YYYY-MM-DD
  name: string; // "Idag", "Mån" …
  date: string; // "19 okt"
  isToday: boolean;
  childrenHome: string[];
  events: DashEvent[];
}

export interface Reminder {
  icon: "rain" | "bag" | "gym" | "trash" | "kids" | "info" | "school" | "food";
  title: string;
  sub: string;
  tone: "blue" | "amber" | "neutral" | "green";
  /** The child it is about – a grown-up who follows only some children gets only theirs in the phone. */
  personId?: string;
  /** A news item from the school: a tap opens it to read. */
  newsId?: string;
}

export interface PriceBar {
  hour: string; // "00"
  price: number;
  cheap: boolean;
  current: boolean;
}

export interface Dashboard {
  generatedAt: string;
  header: {
    dateLabel: string;
    week: number;
    weather?: string;
    sky?: Sky;
    tempNow?: number;
    /** Soluppgång och solnedgång idag ("07:35"), pos = hur långt solen kommit (0–1), saknas på natten. */
    sun?: { rise: string; set: string; pos?: number };
    /** Dygnsfas för den levande bakgrunden. */
    phase: "dawn" | "day" | "dusk" | "night";
  };
  /** Valen i "Dit/Hem" för barnens aktiviteter. */
  travelOptions: { mode: TravelMode; label: string }[];
  /** Others who drive ("Marina", "Ola"), most recent first. */
  knownDrivers: string[];
  /** "Nu"-zonen: det som händer de närmaste timmarna. */
  now: {
    headline: string;
    items: (DashEvent & { inMinutes: number; dayLabel: string })[];
  };
  people: { id: string; name: string; color: string; initial: string; home: boolean; kind: "adult" | "child" }[];
  /** Fotoram i viloläge. */
  idle: { minutes: number; photos: string[] };
  reminders: Reminder[];
  /** "Planera veckan": allt som behöver någon som lämnar/hämtar/skjutsar de kommande 7 dagarna. */
  plan: { missing: number; items: PlanItem[] };
  custody?: {
    headline: string;
    sub: string;
    daysLeft: number;
    progress: number; // 0–1
    /** När barnen har olika rytm: en rad per grupp av barn med samma status. */
    rows?: { names: string; color: string; home: boolean; text: string; daysLeft: number }[];
    /** De kommande fyra veckorna per barn som bor växelvis: true = hos oss. Visas på sidan Hos oss. */
    calendar?: { name: string; color: string; days: boolean[] }[];
  };
  legend: { name: string; color: string }[];
  days: DashDay[];
  shopping: { source: "local" | "ha"; items: { id: string; name: string; done: boolean; /** Skickad till den här butiken (senaste dygnen). */ sent?: string }[] };
  /** Butik att skicka inköpslistan till, om en är vald. */
  grocery?: { provider: string; name: string };
  /** Alla valda butiker (listan skickas till `grocery`). */
  groceries?: { id: string; provider: string; name: string }[];
  prices?: {
    now: number;
    level: "billigt" | "normalt" | "dyrt";
    /** "spot" = spotpris, "total" = med påslag, nät, skatt och moms. */
    kind: "spot" | "total";
    bars: PriceBar[];
    cheapest?: { from: string; to: string; avg: number };
  };
  energy?: {
    solarKw?: number;
    /** Positiv = köper från nätet, negativ = säljer. */
    gridKw?: number;
    /** Husets förbrukning: egen sensor, annars sol + köpt − såld. */
    houseKw?: number;
    /** Solel som används i huset just nu (sol − såld). */
    selfUseKw?: number;
    batteryPct?: number;
    /** Sedan midnatt, ur mätarställningarna i Home Assistant. */
    today?: {
      solarKwh?: number;
      importKwh?: number;
      exportKwh?: number;
      houseKwh?: number;
      selfUseKwh?: number;
      /** Andel av förbrukningen som solen täckt, 0–100. */
      selfSufficiencyPct?: number;
      /** Köpt el gånger timpriset (med påslag om sådant är inlagt). */
      costKr?: number;
    };
  };
  schoolFood?: { child: string; day: string; dishes: string[] }[];
  /** Nyheter från skolan (Vklass), nyast först. */
  schoolNews: SchoolNews[];
  /** Sidan Skolan: veckans schema, läxor och uppgifter per barn. */
  school?: SchoolChild[];
  /** "span": Skolan shows when the day starts and ends, not every lesson. */
  lessonView?: "all" | "span";
  /** En nyare version finns publicerad. */
  update?: { latest: string; current: string };
  /** Running version, and the published one when known: "v0.10.0 ✓ senaste" or "uppdatera till …" in the header. */
  version?: { current: string; latest?: string };
  /** "Skolan idag": when each child's school day starts and ends (today, or the next school day). */
  schoolDay?: { personId: string; name: string; color: string; dayLabel: string; start: string; end: string; gym: boolean }[];
  /** Veckans mat: skollunch per barn och familjens middag, kommande 7 dagar. */
  meals: MealDay[];
  /** Familjens vanligaste middagar (lärda från tidigare veckor) med det man brukar handla. */
  mealFavorites: { name: string; shopping?: string }[];
  /** Sjuk/VAB idag och framåt. */
  sick: { personId: string; name: string; date: string }[];
  /** "Saknas på hyllan" per barn på förskola/fritids. */
  shelf: { personId: string; name: string; items: string[] }[];
  /** Dagens sysslor per barn (bocka av på tavlan). */
  chores: import("./chores.js").ChoresForPerson[];
  cars: {
    name: string;
    battery: number | null;
    rangeKm: number | null;
    home: boolean | null;
    charging: boolean;
    /** Timmar sedan batterivärdet uppdaterades. */
    ageHours: number | null;
    status: string;
    climate?: { entityId: string; on: boolean };
    /** Smartstyrd laddning: plan och laddläge (samma överstyrning som smartstyrningens egen knapp). */
    smart?: import("./smartcharging.js").SmartCharging;
    schedules: { id: string; name: string; days: number[]; time: string; enabled: boolean }[];
  }[];
  lights: Lamp[];
  music?: Music;
  security?: Security;
  robots?: Robot[];
  appliances?: ApplianceView[];
  lightGroups: { index: number; name: string; on: number; total: number; offline: string[]; lamps: Lamp[] }[];
  buttons: { entityId: string; name: string; style: "accent" | "blue" | "amber" | "plain" }[];
  climates: {
    entityId: string;
    name: string;
    domain: "climate" | "water_heater";
    current: number | null;
    target: number | null;
    action?: string;
    /** Lägen att välja mellan (preset_modes, hvac_modes eller operation_list). */
    modes: { value: string; label: string; field: "preset_mode" | "hvac_mode" | "operation_mode" }[];
    active?: string;
    /** Pumpar, lampor, blåsare m.m. på samma enhet (t.ex. spabadets). */
    controls: Control[];
  }[];
  /** Lägesväljare för smart styrning (Auto först = följer sitt eget schema), hittade i Home Assistant. */
  smartModes: { entityId: string; name: string; mode: string; options: string[] }[];
  /** Temperatursensorer. `offline` när Home Assistant inte har något värde, och `days` = hur länge sedan sensorn senast ändrade sig (för "offline sedan 50 dagar"). */
  temps: { name: string; value: string; offline?: boolean; days?: number }[];
  deviceCards: {
    index: number;
    title: string;
    primary?: { name: string; value: string };
    rows: { name: string; value: string; ok: boolean }[];
    controls: Control[];
  }[];
  graphs: { index: number; title: string }[];
  accent: string;
  theme: "auto" | "dark" | "light" | "eink" | "mirror";
  home: { id: HomeWidget; on: boolean; size?: WidgetSize }[];
  tabs: { id: TabId; on: boolean }[];
  /** Dygnsfärger: "day" eller "night" utifrån klockan. */
  daypart: "day" | "night";
  night: boolean;
  errors: { source: string; message: string }[];
}

/** Sidan Skolan för ett barn. */
export interface SchoolChild {
  personId: string;
  name: string;
  color: string;
  /** Måndag–fredag den här veckan (nästa vecka på helgen). */
  days: { dayKey: string; label: string; today: boolean; lessons: { start: string; end: string; title: string; location?: string; gym: boolean }[] }[];
  /** Läxor, prov och uppgifter de kommande två veckorna. */
  tasks: {
    dayKey: string;
    label: string;
    title: string;
    kind: "läxa" | "prov" | "inlämning" | "uppgift";
    /** "12:35" when the task has a time. */
    time?: string;
    /** The teacher's description, as plain text with line breaks. */
    detail?: string;
    /** Opens the task on the school platform. */
    url?: string;
  }[];
}

/** A radio station or any audio stream the speakers can play. */
export interface RadioStation {
  name: string;
  url: string;
  logo?: string;
}

/** The Musik card: favourite stations and the speakers they play on. */
export interface Music {
  speakers: {
    entityId: string;
    name: string;
    offline: boolean;
    playing: boolean;
    /** What is playing now (station or song), if the speaker says. */
    title?: string;
    /** Index in stations when one of them is playing. */
    station?: number;
    /** 0–100. */
    volume?: number;
    /** The stream playing now, to mark it in the Musik tab's list of all stations. */
    playingUrl?: string;
    /** Låt, artist och album separat (när högtalaren säger det), omslag via /api/music/cover och hur långt låten har kommit. */
    paused?: boolean;
    /** Radio: texten som kanalen skickar med strömmen (artist – låt, "rullande texten"/RDS), om den skiljer sig från kanalens namn. */
    radioText?: string;
    track?: string;
    artist?: string;
    album?: string;
    cover?: boolean;
    position?: number;
    duration?: number;
    /** När `position` gällde (ISO), så att tavlan kan räkna fram var låten är nu. */
    positionAt?: string;
    canPause?: boolean;
    canNext?: boolean;
    canPrev?: boolean;
  }[];
  stations: { index: number; name: string; logo?: string; url: string }[];
  /** Home Assistant's Spotify integration: null when it is not installed (the tab then says how). */
  spotify: { entityId: string; playing: boolean; title?: string; device?: string; offline: boolean; devices: string[] } | null;
  /** Music Assistant is in Home Assistant: the Musik tab shows the library (playlists, albums, podcasts) as covers. */
  assistant: boolean;
}

/** One lamp on the board. brightness 1–100 when it is on and can be dimmed. */
export interface Lamp {
  entityId: string;
  name: string;
  on: boolean;
  offline: boolean;
  dimmable: boolean;
  brightness?: number;
}

export interface SchoolNews {
  id: string;
  personId?: string;
  /** Barnets namn och färg när nyheten gäller ett barn. */
  who?: string;
  color?: string;
  title: string;
  text: string;
  /** ISO */
  published?: string;
  /** "20 okt" */
  date?: string;
  /** Bilagor hämtas via tavlan: `url` är en adress på tavlan, inte i Vklass. */
  files: { name: string; url: string }[];
  seen: boolean;
}

export interface SecurityEntities {
  cameras: NamedEntity[];
  locks: NamedEntity[];
  alarms: NamedEntity[];
  /** Garage doors and gates (cover.*). */
  covers: NamedEntity[];
  /** Doors and windows (binary_sensor.* door/window/garage_door/opening). */
  openings: NamedEntity[];
  /** Unlocking from the board is off unless the family turns it on. */
  allowUnlock?: boolean;
}

export type LockState = "locked" | "unlocked" | "locking" | "unlocking" | "jammed" | "open" | "opening" | "unknown";
export type AlarmMode = "home" | "away" | "night" | "vacation";

/** The Säkerhet tab. */
export interface Security {
  cameras: { entityId: string; name: string; offline: boolean }[];
  locks: { entityId: string; name: string; state: LockState; offline: boolean; needsCode: boolean; canOpen: boolean }[];
  alarms: { entityId: string; name: string; state: string; label: string; armed: boolean; triggered: boolean; offline: boolean; modes: AlarmMode[]; needsCode: boolean }[];
  covers: { entityId: string; name: string; state: string; label: string; open: boolean; offline: boolean }[];
  openings: { entityId: string; name: string; open: boolean; offline: boolean }[];
  allowUnlock: boolean;
}

/** The Städ tab: one robot vacuum or mower. */
export interface Robot {
  entityId: string;
  name: string;
  kind: "vacuum" | "mower";
  state: string;
  /** In Swedish, e.g. "Städar", "Laddar", "Har fastnat". */
  label: string;
  busy: boolean;
  error: boolean;
  offline: boolean;
  battery?: number;
  canStart: boolean;
  canPause: boolean;
  canDock: boolean;
}

/** One machine: its state sensor and/or a power plug, with time left and progress when it has them. */
export interface ApplianceEntities {
  name: string;
  kind: "washer" | "dryer" | "dishwasher" | "oven" | "other";
  status?: string;
  remaining?: string;
  progress?: string;
  power?: string;
}

export interface ApplianceView {
  name: string;
  kind: ApplianceEntities["kind"];
  phase: "running" | "paused" | "done" | "idle" | "error" | "offline";
  /** "Tvättar – 42 min kvar", "Klar", "Av". */
  label: string;
  minutesLeft?: number;
  /** "11:20". */
  endsAt?: string;
  progress?: number;
}

/** Delar av en butik under fliken Mat. */
export type FoodPart = "list" | "cart" | "common" | "offers" | "recipes";

/** Fliken Mat, en butik: vilka delar som finns och är påslagna (innehållet hämtas först när delen öppnas). */
export interface StoreFood {
  id: string;
  provider: string;
  name: string;
  parts: FoodPart[];
}

/** Innehållet i en del, hämtat på begäran. */
export interface StoreFoodData {
  /** Butiken erbjudandena gäller (orten eller butiksnamnet). */
  store?: string;
  offers?: { id: string; name: string; brand?: string; size?: string; price?: string; note?: string; image?: string; validTo?: string }[];
  /** Vad som redan ligger i butikens varukorg. */
  cart?: { items: { name: string; qty: string; price?: string }[]; total?: string };
  /** "Mina vanligaste varor". */
  common?: { name: string }[];
  recipes?: { id: number; title: string; time?: string; ingredients?: number; image?: string; url: string }[];
  list?: { name: string; rows: { id: string; name: string; done: boolean }[]; /** Webbutikens sök-adress med {q} där varan ska stå (när man valt butik). */ webSearch?: string };
  errors?: Record<string, string>;
}
