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

export const HOME_WIDGETS = ["now", "meals", "schoolday", "reminders", "custody", "week", "shopping", "prices", "cars", "lights", "temps", "energy", "climates", "music"] as const;
export type HomeWidget = (typeof HOME_WIDGETS)[number];
/** Startskärmens rutor: "auto" följer hur många rutor som visas, annars liten/normal/stor. */
export type WidgetSize = "auto" | "s" | "m" | "l";
export const TAB_IDS = ["cars", "lights", "house", "energy", "graphs", "music"] as const;
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

/** Laddfönster: 22:00–06:00 går över midnatt, samma tid i båda = hela dygnet. */
export interface ChargeRule {
  days: number[];
  from: string; // "22:00"
  to: string; // "06:00"
}

/** Laddning för en bil: det som finns i Home Assistant och tavlans eget schema. */
export interface CarCharging {
  /** Det som startar och stoppar laddningen: bilens laddbrytare eller laddboxens. */
  target?: Control;
  targetOptions: { entityId: string; name: string }[];
  /** Bilens laddgräns i %. */
  limit?: Control;
  /** Laddboxens och laddappars inställningar (t.ex. EV Smart Charging). */
  settings: Control[];
  /** Scheman och automationer i HA som redan handlar om laddning. */
  existing: { entityId: string; name: string; domain: "schedule" | "automation"; on: boolean; next?: string }[];
  /** Tavlans eget schema: en schemahjälpare och en automation i HA. */
  own?: {
    scheduleEntity: string;
    automationEntity?: string;
    enabled: boolean;
    /** Schemat är på just nu (inne i ett laddfönster). */
    active: boolean;
    rules: ChargeRule[];
    target?: string;
    limit?: number;
    next?: string;
    missingAutomation: boolean;
  };
  /** Tavlan kan skapa ett eget schema (ansluten till HA och något att styra finns). */
  canCreate: boolean;
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
  shopping: { source: "local" | "ha"; items: { id: string; name: string; done: boolean }[] };
  /** Butik att skicka inköpslistan till, om en är vald. */
  grocery?: { provider: string; name: string };
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
    schedules: { id: string; name: string; days: number[]; time: string; enabled: boolean }[];
  }[];
  lights: Lamp[];
  music?: Music;
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
  temps: { name: string; value: string }[];
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
  }[];
  stations: { index: number; name: string; logo?: string; url: string }[];
  /** Home Assistant's Spotify integration: null when it is not installed (the tab then says how). */
  spotify: { entityId: string; playing: boolean; title?: string; device?: string; offline: boolean } | null;
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
