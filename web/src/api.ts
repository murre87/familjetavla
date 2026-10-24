import type { ApplianceEntities, CarEntity, Config, SecurityEntities, ConfigResponse, Dashboard, Integration, NamedEntity, Schedule, StoreFood, StoreFoodData, FoodPart, TestResult, TravelChoice } from "../../server/src/types";

/** A station in the Musik tab: every Swedish station from the radio directory. */
export interface DirStation {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group: "sr" | "other";
  quality?: string;
}

/** A cover in the Musik tab's library (Music Assistant: Spotify playlists, albums, podcasts …). */
export interface Tile {
  uri: string;
  type: "playlist" | "album" | "artist" | "track" | "podcast" | "audiobook" | "radio";
  title: string;
  subtitle?: string;
  image?: string;
}
export type Shelf = "recent" | "playlists" | "albums" | "podcasts";
/** One song in a playlist or album. */
export interface Track {
  uri: string;
  title: string;
  artist?: string;
  image?: string;
}

/** A station from the radio directory (Inställningar → Huset → Musik). */
export interface StationHit {
  name: string;
  url: string;
  logo?: string;
  country?: string;
  quality?: string;
}

export interface Discovery {
  cars: (CarEntity & { deviceName: string; maker?: string })[];
  energy: Config["entities"]["energy"];
  climates: (NamedEntity & { controls?: string[] })[];
  lightGroups: { name: string; entities: string[] }[];
  deviceCards: Config["entities"]["deviceCards"];
  temps: NamedEntity[];
  todo: NamedEntity[];
  calendars: (NamedEntity & { waste: boolean })[];
  priceSensors: NamedEntity[];
  buttons: { name: string; entityId: string }[];
  speakers?: NamedEntity[];
  security?: SecurityEntities;
  robots?: (NamedEntity & { battery?: string })[];
  appliances?: ApplianceEntities[];
  summary: string[];
}

export interface CarDetails {
  name: string;
  valid: number;
  total: number;
  rows: { entityId: string; name: string; value: string; group: string; ok: boolean; note?: string; domain: string }[];
  actions: { entityId: string; name: string; domain: string; state: string }[];
  charging?: {
    switch?: { entityId: string; name: string; on: boolean };
    start?: { entityId: string; name: string };
    stop?: { entityId: string; name: string };
    schedule: { entityId: string; name: string; value: string }[];
  };
}

export interface GraphData {
  title: string;
  from: string;
  to: string;
  series: { name: string; color: string; points: (number | null)[] }[];
}

const PIN_KEY = "familjetavla.pin";

export function getPin(): string {
  try {
    return sessionStorage.getItem(PIN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setPin(pin: string) {
  try {
    sessionStorage.setItem(PIN_KEY, pin);
  } catch {
    /* private mode */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Relative paths ("api/…", no leading slash) so the app works under Home Assistant ingress.
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`api/${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(100_000),
      headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      "x-admin-pin": getPin(),
      ...(init.headers as Record<string, string>),
    },
    });
  } catch (e) {
    // A request that never answers (the server restarted, the shop is slow) must not leave a button spinning.
    if ((e as Error).name === "TimeoutError" || (e as Error).name === "AbortError") throw new ApiError(0, "Svaret dröjde för länge – försök igen.");
    throw e;
  }
  const text = await res.text();
  let data: { error?: string; code?: string } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // An HTML error page, e.g. from Home Assistant while the add-on restarts.
    if (!res.ok) throw new ApiError(res.status, res.status >= 500 ? "Tavlan startar om eller går inte att nå just nu." : `Fel ${res.status}`);
    throw new ApiError(res.status, "Oväntat svar från servern.");
  }
  // The screen was un-paired (e.g. "Glöm alla skärmar"): start over so the app shows the unlock screen.
  if (res.status === 401 && data?.code === "pair" && path !== "config" && !path.startsWith("auth/")) location.reload();
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Fel ${res.status}`);
  return data as unknown as T;
}

const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export interface EntityOption {
  entityId: string;
  name: string;
  state: string;
  unit?: string;
  deviceClass?: string;
}

export interface CalendarTest extends TestResult {
  groups: { name: string; count: number }[];
}

export interface PostcodeInfo {
  postcode: string;
  place: string;
  municipality?: string;
  lat: number;
  lon: number;
  area: "SE1" | "SE2" | "SE3" | "SE4";
  wasteProvider?: string;
}

export interface GroceryLine {
  item: string;
  remembered: { code: string; name: string } | null;
  candidates: { code: string; name: string; brand?: string; volume?: string; price?: string; image?: string }[];
}

const realApi = {
  authStatus: () => request<{ paired: boolean; pinRequired: boolean; supervisor: boolean }>("auth/status"),
  pair: (pin: string, name: string) => post<{ ok: true }>("auth/pair", { pin, name }),
  forgetDevices: () => request<{ ok: true }>("auth/devices", { method: "DELETE" }),
  notifyServices: () => request<string[]>("ha/notify-services"),
  notifyTest: (service: string) => post<TestResult>("notify/test", { service }),
  newFeed: (personId: string) => post<{ ok: true; path: string }>(`feed/${personId}/new`),
  config: () => request<ConfigResponse>("config"),
  saveConfig: (config: ConfigResponse["config"], secrets: Record<string, string | null> = {}) =>
    request<ConfigResponse>("config", { method: "PUT", body: JSON.stringify({ config, secrets }) }),
  checkPin: () => post<{ ok: boolean }>("auth/check"),
  dashboard: () => request<Dashboard>("dashboard"),
  secureUrl: () => request<{ url: string | null }>("secure-url"),
  travel: (key: string, choice: TravelChoice | null, forCalendar = false) => post<{ ok: true }>("travel", { key, choice, forCalendar }),
  dinner: (day: string, text: string, shopping?: string) => post<{ ok: true }>("dinner", { day, text, shopping }),
  shelf: (personId: string, items: string[]) => post<{ ok: true }>("shelf", { personId, items }),
  backup: (password?: string) => post<unknown>("backup", { password }),
  restore: (backup: unknown, password?: string) => post<{ ok: true; secrets: boolean }>("restore", { backup, password }),
  setSick: (personId: string, date: string, sick: boolean) => post<{ ok: true }>("sick", { personId, date, sick }),
  newsSeen: (ids: string[]) => post<{ ok: true }>("news/seen", { ids }),
  addOwnEvent: (e: { date: string; time?: string; end?: string; title: string; personId?: string; note?: string }) => post<{ id: string }>("own-events", e),
  cancelEvent: (key: string, on: boolean) => post("events/cancel", { key, on }),
  removeOwnEvent: (id: string) => request<{ ok: true }>(`own-events/${encodeURIComponent(id)}`, { method: "DELETE" }),

  testProvider: (integration: Integration, secrets: Record<string, string>) => post<TestResult>("providers/test", { integration, secrets }),
  providerStores: (integration: Integration, secrets: Record<string, string>) => post<{ value: string; label: string }[]>("providers/stores", { integration, secrets }),
  testHa: (url?: string, token?: string) => post<TestResult>("test/ha", { url, token }),
  entities: (domains: string[]) => request<EntityOption[]>(`ha/entities?domains=${domains.join(",")}`),
  testCalendar: (body: { url?: string; entityId?: string; sourceId?: string; include?: string[]; exclude?: string[] }) =>
    post<CalendarTest>("test/calendar", body),
  postcode: (q: string) => request<PostcodeInfo>(`postcode?q=${encodeURIComponent(q)}`),

  groceryPreview: (store?: string) => post<{ store: string; lines: GroceryLine[] }>("grocery/preview", { store }),
  grocerySend: (lines: { item: string; code: string; name: string; qty: number }[], store?: string) =>
    post<{ ok: boolean; store: string; items: number | null; total: string | null }>("grocery/send", { lines, store }),

  foodStores: () => request<StoreFood[]>("food/stores"),
  foodChoices: (id: string) => request<{ options: { value: string; label: string }[]; value: string }>(`food/stores/${encodeURIComponent(id)}/choices`),
  foodSetStore: (id: string, value: string) => post(`food/stores/${encodeURIComponent(id)}/store`, { value }),
  foodPart: (id: string, part: FoodPart) => request<StoreFoodData>(`food/stores/${encodeURIComponent(id)}/${part}`),
  foodIcaStrike: (id: string, name: string, done: boolean) => post("food/ica/strike", { id, name, done }),

  discover: () => request<Discovery>("ha/discover"),
  car: (index: number) => request<CarDetails>(`car/${index}`),
  carAction: (index: number, entityId: string, action: "on" | "off" | "press") => post(`car/${index}/action`, { entityId, action }),
  choreToggle: (id: string, done: boolean) => post("chores/toggle", { id, done }),
  chores: () => request<{ chores: { id: string; personId: string; title: string; days: number[] }[] }>("chores"),
  saveChores: (chores: { id: string; personId: string; title: string; days: number[] }[]) => request("chores", { method: "PUT", body: JSON.stringify({ chores }) }),
  carMode: (index: number, option: string) => post(`car/${index}/mode`, { option }),
  carSchedule: (index: number, row: { day: number; time: string; soc: number; enabled: boolean }) => post(`car/${index}/schedule`, row),
  run: (entityId: string, action: "on" | "off" | "press" = "on") => post("run", { entityId, action }),
  saveSchedule: (s: Schedule) => request(`schedules/${s.id}`, { method: "PUT", body: JSON.stringify(s) }),
  deleteSchedule: (id: string) => request(`schedules/${id}`, { method: "DELETE" }),
  control: (entityId: string, op: "toggle" | "select" | "set" | "press", value?: string | number) => post("control", { entityId, op, value }),
  climateMode: (entityId: string, field: string, value: string) => post("climate/mode", { entityId, field, value }),
  climateTarget: (entityId: string, temperature: number) => post("climate/target", { entityId, temperature }),
  lightGroup: (index: number, on: boolean) => post("lights/group", { index, on }),
  button: (entityId: string) => post("button", { entityId }),
  graph: (index: number) => request<GraphData>(`graph/${index}`),
  photos: () => request<string[]>("photos"),
  uploadPhoto: (data: string, type: string) => post<{ photos: string[] }>("photos", { data, type }),
  deletePhoto: (name: string) => request<{ photos: string[] }>(`photos/${encodeURIComponent(name)}`, { method: "DELETE" }),
  toggleLight: (entityId: string) => post("lights/toggle", { entityId }),
  brightness: (entityId: string, pct: number) => post("lights/brightness", { entityId, pct }),
  lightsOff: () => post("lights/off"),
  lock: (entityId: string, op: "lock" | "unlock" | "open", code?: string) => post("security/lock", { entityId, op, code }),
  alarm: (entityId: string, mode: "home" | "away" | "night" | "vacation" | "off", code?: string) => post("security/alarm", { entityId, mode, code }),
  cover: (entityId: string, op: "open" | "close" | "stop") => post("security/cover", { entityId, op }),
  robot: (entityId: string, op: "start" | "pause" | "dock") => post("robots", { entityId, op }),
  /** A camera's still image; t makes the browser fetch a new one. */
  cameraUrl: (entityId: string, t: number) => `api/camera/${encodeURIComponent(entityId)}?t=${t}`,
  saveHomeLayout: (home: { id: string; on: boolean }[]) => post("home-layout", { home }),
  playStation: (index: number, speaker: string) => post("music/play", { index, speaker }),
  stopMusic: (speaker: string) => post("music/stop", { speaker }),
  tryStation: (name: string, url: string, speaker: string) => post("music/try", { name, url, speaker }),
  musicStations: () => request<{ stations: DirStation[] }>("music/stations"),
  playStationId: (id: string, speaker: string) => post("music/play-id", { id, speaker }),
  favoriteStation: (b: { id?: string; url?: string; on: boolean }) => post("music/favorite", b),
  spotify: (op: "playpause" | "next") => post("music/spotify", { op }),
  musicLibrary: (shelf: Shelf) => request<{ tiles: Tile[] }>(`music/library?shelf=${shelf}`),
  musicSearch: (q: string) => request<{ tiles: Tile[] }>(`music/search?q=${encodeURIComponent(q)}`),
  playConnect: (t: Tile, device: string, shuffle?: boolean) => post("music/play-connect", { uri: t.uri, type: t.type, title: t.title, device, ...(shuffle !== undefined ? { shuffle } : {}) }),
  playMedia: (t: Tile, speaker: string, start?: string, shuffle?: boolean) => post("music/play-media", { uri: t.uri, type: t.type, title: t.title, speaker, ...(start ? { start } : {}), ...(shuffle !== undefined ? { shuffle } : {}) }),
  musicItems: (uri: string) => request<{ title: string; tracks: Track[] }>(`music/items?uri=${encodeURIComponent(uri)}`),
  musicTransport: (speaker: string, action: "play_pause" | "next" | "previous") => post("music/transport", { speaker, action }),
  volume: (speaker: string, pct: number) => post("music/volume", { speaker, pct }),
  searchStations: (q: string) => request<{ stations: StationHit[] }>(`radio/search?q=${encodeURIComponent(q)}`),
  addItem: (name: string, offer?: { store: string; id: string }) => post("shopping/add", { name, offer }),
  toggleItem: (id: string, done: boolean) => post("shopping/toggle", { id, done }),
  clearDone: () => post("shopping/clear-done"),
};

// Demo build (VITE_DEMO=1): same interface, recorded sample data, no server.
import { demoApi } from "@demo";
export const isDemo = Boolean(import.meta.env.VITE_DEMO);
export const api: typeof realApi = isDemo && demoApi ? (demoApi as unknown as typeof realApi) : realApi;
