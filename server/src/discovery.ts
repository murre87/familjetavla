import { ha, type HaConn, type HaState } from "./connectors/ha.js";
import { haSocket } from "./connectors/haws.js";
import type { CarEntity, Config, NamedEntity, SecurityEntities, ApplianceEntities } from "./types.js";

/**
 * Discover what a Home Assistant install already has, so the wizard can pre-fill cars,
 * inverter/solar, grid meter, climate devices, lights per room etc. – whatever brand.
 *
 * Uses one template render (POST /api/template) to read the device and area registries,
 * which the REST state API does not expose.
 */

export interface HaEntityInfo {
  e: string; // entity_id
  n: string; // friendly name
  a: string | null; // area
  d: string | null; // device id
  dn: string | null; // device name
  m: string | null; // manufacturer
  mo: string | null; // model
  dc: string | null; // device_class
  u: string | null; // unit
  st: string; // state
  lu: string; // last_updated
  o?: boolean; // made by the user in HA (template, helper, YAML sensor) – never suggested for energy
}

/**
 * Integrations whose entities a user builds by hand (templates and helpers). The board computes
 * energy itself from the real meters, so these are never suggested: they differ from home to home.
 */
const OWN_PLATFORMS = ["template", "integration", "utility_meter", "statistics", "derivative", "min_max", "group", "filter", "compensation", "threshold", "trend", "sql", "rest", "command_line", "scrape"];
const OWN_TEMPLATE = `{{ (${OWN_PLATFORMS.map((p) => `integration_entities('${p}')`).join(" + ")}) | tojson }}`;

const TEMPLATE = `{% set ns = namespace(out=[]) %}{% for s in states %}{% set d = device_id(s.entity_id) %}{% set ns.out = ns.out + [{"e": s.entity_id, "n": s.name, "a": area_name(s.entity_id), "d": d, "dn": (device_attr(d, 'name_by_user') or device_attr(d, 'name')) if d else none, "m": device_attr(d, 'manufacturer') if d else none, "mo": device_attr(d, 'model') if d else none, "dc": s.attributes.device_class | default(none), "u": s.attributes.unit_of_measurement | default(none), "st": s.state, "lu": s.last_updated | string}] %}{% endfor %}{{ ns.out | tojson }}`;

/** Registries over the WebSocket API – the structured way HA's own frontend builds its device tree. */
async function readRegistryWs(): Promise<HaEntityInfo[] | null> {
  const sock = haSocket();
  if (!sock?.connected) return null;
  type Ent = { entity_id: string; platform?: string; device_id: string | null; area_id: string | null; name: string | null; original_name: string | null; disabled_by: string | null; hidden_by: string | null };
  type Dev = { id: string; name: string | null; name_by_user: string | null; manufacturer: string | null; model: string | null; area_id: string | null };
  type Area = { area_id: string; name: string };
  const [ents, devs, areas] = await Promise.all([
    sock.call<Ent[]>({ type: "config/entity_registry/list" }),
    sock.call<Dev[]>({ type: "config/device_registry/list" }),
    sock.call<Area[]>({ type: "config/area_registry/list" }),
  ]);
  const devMap = new Map(devs.map((d) => [d.id, d]));
  const areaMap = new Map(areas.map((a) => [a.area_id, a.name]));
  const entMap = new Map(ents.map((e) => [e.entity_id, e]));
  const out: HaEntityInfo[] = [];
  for (const s of sock.states.values()) {
    const e = entMap.get(s.entity_id);
    if (e?.disabled_by || e?.hidden_by) continue;
    const d = e?.device_id ? devMap.get(e.device_id) : undefined;
    const areaId = e?.area_id ?? d?.area_id ?? null;
    const st = s as HaState & { last_updated?: string };
    out.push({
      e: s.entity_id,
      n: String(s.attributes.friendly_name ?? e?.name ?? e?.original_name ?? s.entity_id),
      a: areaId ? (areaMap.get(areaId) ?? null) : null,
      d: e?.device_id ?? null,
      dn: d ? (d.name_by_user ?? d.name) : null,
      // Not in the registry at all (YAML without unique_id) or from a helper/template platform.
      o: !e || OWN_PLATFORMS.includes(e.platform ?? ""),
      m: d?.manufacturer ?? null,
      mo: d?.model ?? null,
      dc: (s.attributes.device_class as string | undefined) ?? null,
      u: s.attributes.unit_of_measurement ?? null,
      st: s.state,
      lu: st.last_updated ?? s.last_changed,
    });
  }
  return out;
}

export async function readRegistry(conn: HaConn): Promise<HaEntityInfo[]> {
  const viaWs = await readRegistryWs().catch(() => null);
  if (viaWs) return viaWs;
  const list = await readRegistryRest(conn);
  const own = await ha
    .template(conn, OWN_TEMPLATE)
    .then((r) => new Set<string>(typeof r === "string" ? JSON.parse(r) : (r as string[])))
    .catch(() => new Set<string>());
  return list.map((x) => (own.has(x.e) ? { ...x, o: true } : x));
}

async function readRegistryRest(conn: HaConn): Promise<HaEntityInfo[]> {
  try {
    return parseTemplate(await ha.template(conn, TEMPLATE));
  } catch {
    // Large homes: Home Assistant refuses a template answer that is too big (400). Read it in parts.
    // A part that still fails (one odd entity) is read in smaller pieces and the odd one skipped.
    const total = (await ha.states(conn)).length;
    const part = (from: number, to: number) => ha.template(conn, TEMPLATE.replace("{% for s in states %}", `{% for s in (states | list)[${from}:${to}] %}`)).then(parseTemplate);
    const out: HaEntityInfo[] = [];
    for (let i = 0; i < total; i += 150) {
      try {
        out.push(...(await part(i, i + 150)));
      } catch {
        for (let j = i; j < Math.min(i + 150, total); j += 10) out.push(...(await part(j, j + 10).catch(() => [])));
      }
    }
    return out;
  }
}

function parseTemplate(res: unknown): HaEntityInfo[] {
  return (typeof res === "string" ? JSON.parse(res) : res) as HaEntityInfo[];
}

export async function deviceEntities(conn: HaConn, anyEntityOfDevice: string): Promise<HaEntityInfo[]> {
  const all = await readRegistry(conn);
  const dev = all.find((x) => x.e === anyEntityOfDevice)?.d;
  if (!dev) return all.filter((x) => x.e === anyEntityOfDevice);
  return all.filter((x) => x.d === dev);
}

/** The entity that names the car's device: battery for EVs, fuel for petrol/diesel, else whatever else is set. */
export const carAnchor = (c: CarEntity): string => (c.battery ?? c.fuel ?? c.range ?? c.location ?? c.climate) as string;

const has = (s: string | null | undefined, re: RegExp) => Boolean(s && re.test(s));
const domain = (e: string) => e.split(".")[0];

const CAR_MAKERS = /tesla|nissan|volvo|polestar|kia|hyundai|volkswagen|vw|skoda|audi|bmw|mini|mercedes|renault|peugeot|citro|opel|toyota|lexus|ford|mg |mg$|byd|porsche|cupra|seat|fiat|jaguar|zeekr|xpeng|nio|honda|mazda|subaru|smart/i;
const PHONE_MAKERS = /^(samsung|apple|google|oneplus|xiaomi|huawei|oppo|motorola|sony|nokia|nothing|fairphone|realme|vivo|honor)\b/i;
const SOLAR = /solar|sol(el|ar)?\b|pv\b|photovolt|inverter|växelriktare|produktion|production|yield/i;
const INVERTER_MAKERS = /solaredge|huawei|fronius|sma\b|growatt|enphase|goodwe|solis|sungrow|deye|victron|ferroamp|solax|kostal|apsystems/i;
const HEATPUMP = /husdata|h60|h66|nibe|thermia|ivt|ctc|bosch|daikin|mitsubishi|panasonic|vaillant|viessmann|heat ?pump|värmepump|bergvärme|luft.?vatten|ecoforest|qvantum|nordic/i;
const SPA = /balboa|gecko|spa\b|spabad|jacuzzi|hot ?tub|bubbelpool|lay-?z|intex|softub|arctic spa|bwa/i;
const GRID = /grid|nät|import|tibber pulse|power ?meter|elmätare|han\b|p1\b|consumption/i;

export interface Discovery {
  cars: (CarEntity & { deviceName: string; maker?: string })[];
  energy: Config["entities"]["energy"];
  climates: (NamedEntity & { controls?: string[] })[];
  lightGroups: { name: string; entities: string[] }[];
  deviceCards: { title: string; primary?: string; sensors: string[]; controls: string[] }[];
  temps: NamedEntity[];
  todo: NamedEntity[];
  calendars: (NamedEntity & { waste: boolean })[];
  priceSensors: NamedEntity[];
  buttons: { name: string; entityId: string }[];
  /** Speakers for Musik: Google/Nest, Chromecast, Sonos … – not TVs, not Spotify's own player. */
  speakers: NamedEntity[];
  /** Säkerhet: cameras, locks, alarms, garage doors/gates and door/window sensors – cars' own locks and windows left out. */
  security: SecurityEntities;
  /** Städ: robot vacuums and mowers, with the battery sensor on the same device when there is one. */
  robots: (NamedEntity & { battery?: string })[];
  /** Husgeråd: machines with a state sensor (Miele, Home Connect, SmartThings, LG …) or a power plug named after them. */
  appliances: ApplianceEntities[];
  summary: string[];
}

const APPLIANCE_KINDS: [ApplianceEntities["kind"], RegExp][] = [
  // Dishwasher first: "dishwasher" contains "washer".
  ["dishwasher", /diskmaskin|dishwasher|geschirrsp|spülmaschine|opvaskemaskine|oppvaskmaskin/i],
  ["dryer", /torktumlare|tumble|dryer|trockner|tørretumbler|torkskåp/i],
  ["washer", /tvättmaskin|washing ?machine|washer|waschmaschine|vaskemaskine|vaskemaskin|tvättare/i],
  ["oven", /\bugn\b|ugnen|oven|backofen|\bovn\b/i],
];

/** One appliance per device: its state, time left, progress and power – whichever it has. */
export function findAppliances(all: HaEntityInfo[]): ApplianceEntities[] {
  const groups = new Map<string, HaEntityInfo[]>();
  for (const x of all) if (x.d && x.st !== "unavailable" && !x.o) groups.set(x.d, [...(groups.get(x.d) ?? []), x]);
  const out: ApplianceEntities[] = [];
  for (const [, ents] of groups) {
    const who = `${ents[0]!.dn ?? ""} ${ents[0]!.mo ?? ""}`;
    const kind = APPLIANCE_KINDS.find(([, re]) => re.test(who) || ents.some((e) => re.test(e.n)))?.[0];
    if (!kind) continue;
    const sensors = ents.filter((e) => domain(e.e) === "sensor");
    const text = (e: HaEntityInfo) => !e.u && e.dc !== "timestamp" && !Number.isFinite(Number(e.st));
    // Miele names its state sensor just like the machine ("Tvättmaskin"), so any text sensor is the fallback.
    const status = sensors.find((e) => text(e) && /operation|status|state|tillstånd|machine|job|phase|fas\b|läge/i.test(`${e.n} ${e.e}`)) ?? sensors.find((e) => text(e) && e.dc === "enum") ?? sensors.find(text);
    const remaining = sensors.find((e) => (["min", "h", "s"].includes(e.u ?? "") || e.dc === "timestamp" || e.dc === "duration") && /remain|rest|återst|aterst|kvar|finish|complet|end|klar|left/i.test(`${e.n} ${e.e}`));
    const progress = sensors.find((e) => e.u === "%" && /progress|förlopp|framsteg/i.test(`${e.n} ${e.e}`));
    const power = sensors.find((e) => (e.u === "W" || e.u === "kW") && (e.dc === "power" || /power|effekt/i.test(`${e.n} ${e.e}`)));
    if (!status && !power) continue;
    out.push({
      name: ents[0]!.dn || kind,
      kind,
      ...(status ? { status: status.e } : {}),
      ...(remaining ? { remaining: remaining.e } : {}),
      ...(progress ? { progress: progress.e } : {}),
      ...(power ? { power: power.e } : {}),
    });
  }
  return out.slice(0, 10);
}

export function discover(all: HaEntityInfo[]): Discovery {
  const byDevice = new Map<string, HaEntityInfo[]>();
  for (const x of all) if (x.d) byDevice.set(x.d, [...(byDevice.get(x.d) ?? []), x]);

  // ---- Cars: a device with a battery % sensor (EV) or a fuel sensor (petrol/diesel) and a location (tracker) or a known car maker.
  const cars: Discovery["cars"] = [];
  const carDeviceIds = new Set<string>();
  for (const [devId, ents] of byDevice) {
    const battery = ents.find((x) => domain(x.e) === "sensor" && x.u === "%" && (x.dc === "battery" || has(x.n, /battery|batteri|state of charge|soc\b|laddniv/i)));
    // "Bränslemängd" in litres (Volvo, …) or "Fuel level" in %. Consumption (L/100 km) and prices are not the tank.
    const fuel = battery ? undefined : ents.find((x) => domain(x.e) === "sensor" && has(x.u, /^(l|L|liter|%|gal)$/) && has(x.n, /fuel|bränsle|tank/i) && !has(x.n, /consum|förbruk|price|pris|avstånd|distance|range|räckvidd|lock|lucka/i));
    if (!battery && !fuel) continue;
    const tracker = ents.find((x) => domain(x.e) === "device_tracker");
    const maker = ents[0].m ?? "";
    // Phones (Companion app) also have a battery, a location and "charging" – never a car.
    const phone = has(maker, PHONE_MAKERS) || has(ents[0].mo, /^(SM-|iPhone|iPad|Pixel|CPH|M\d{4})/i) || ents.some((x) => has(x.n, /app version|sim \d|wifi bssid|mobile data|android auto|carplay/i));
    const isCar = !phone && ((tracker && ents.some((x) => has(x.n, /range|räckvidd|odometer|mätarställ|charg|laddning|avstånd till tom/i))) || has(maker, CAR_MAKERS) || has(ents[0].mo, CAR_MAKERS));
    if (!isCar) continue;
    const range = ents.find((x) => domain(x.e) === "sensor" && has(x.u, /^(km|mi)$/) && has(x.n, /range|räckvidd|avstånd till tom|distance to empty/i) && !has(x.n, /ac on/i));
    const charging =
      ents.find((x) => domain(x.e) === "binary_sensor" && (x.dc === "battery_charging" || has(x.n, /charging|laddar/i))) ??
      ents.find((x) => domain(x.e) === "sensor" && has(x.n, /charging state|laddstatus/i));
    const plugged = ents.find((x) => domain(x.e) === "binary_sensor" && (x.dc === "plug" || has(x.n, /plugged|ansluten/i)));
    const climate =
      ents.find((x) => domain(x.e) === "climate") ??
      ents.find((x) => ["switch", "button"].includes(domain(x.e)) && has(x.n, /climate|klimat|precondition|förvärm|heat|värm|defrost/i));
    carDeviceIds.add(devId);
    cars.push({
      name: ents[0].dn ?? (battery ?? fuel)!.n.replace(/ ?(battery|bränsle|fuel).*$/i, ""),
      deviceName: ents[0].dn ?? "",
      maker: maker || undefined,
      battery: battery?.e,
      fuel: fuel?.e,
      range: range?.e,
      location: tracker?.e ?? plugged?.e,
      charging: charging?.e,
      climate: climate?.e,
    });
  }
  const carDevices: Set<string | null> = carDeviceIds;

  // ---- Energy
  // Sensors with a real value first: a meter that says "unknown" is no use on the board.
  const working = (x: HaEntityInfo) => Number.isFinite(Number(x.st));
  const power = all
    .filter((x) => domain(x.e) === "sensor" && x.dc === "power" && !carDevices.has(x.d) && !x.o)
    .sort((a, b) => Number(working(b)) - Number(working(a)) || Number(has(`${b.n} ${b.m ?? ""}`, /tibber pulse|p1|han\b/i)) - Number(has(`${a.n} ${a.m ?? ""}`, /tibber pulse|p1|han\b/i)));
  const solar =
    power.find((x) => has(x.n, SOLAR) && has(`${x.m} ${x.n}`, INVERTER_MAKERS)) ?? power.find((x) => has(x.n, SOLAR) || has(x.m, INVERTER_MAKERS));
  const grid = power.find((x) => x !== solar && has(`${x.n} ${x.m ?? ""}`, GRID) && !has(x.n, /produktion|production|export|sälj|max|min|genomsnitt|average/i));
  // Only needed without sun or meter: with both, the board counts the house itself.
  const house = solar && grid ? undefined : power.find((x) => x !== solar && x !== grid && has(x.n, /house|hus|home|hem|load|last|förbrukning|consumption/i));
  // Sold power, when the meter gives it separately (Tibber Pulse "Elproduktion", P1 "Power production").
  const SELL = /produktion|production|export|sälj|utmatning|returned|feed.?in|inmatning/i;
  const gridExport = grid ? power.find((x) => x !== grid && x !== solar && x.d === grid.d && has(x.n, SELL) && !has(x.n, /max|min|genomsnitt|average|medel/i)) : undefined;
  // Meter readings for today's kWh: on the grid meter (bought, sold) and on the inverter (made).
  const counters = all.filter((x) => domain(x.e) === "sensor" && has(x.u, /^(k|M)?Wh$/) && working(x) && !x.o);
  const lifetime = /mätar|meter|total|livstid|lifetime|ackumulerad|accumulated|senaste/i;
  const pick = (list: HaEntityInfo[]) => list.sort((a, b) => Number(has(b.n, lifetime)) - Number(has(a.n, lifetime)) || Number(has(a.n, /timme|hour/i)) - Number(has(b.n, /timme|hour/i)))[0];
  const meterDev = grid?.d;
  const importEnergy = meterDev ? pick(counters.filter((x) => x.d === meterDev && !has(x.n, SELL) && has(x.n, /förbruk|consumption|import|köpt|consumed|mätarställning/i) && !has(x.n, /beräknad|estimated|timme|hour/i))) : undefined;
  const exportEnergy = meterDev ? pick(counters.filter((x) => x.d === meterDev && has(x.n, SELL) && !has(x.n, /timme|hour/i))) : undefined;
  const solarEnergy = solar?.d ? pick(counters.filter((x) => x.d === solar.d && has(x.n, /energy|energi|producerad|produced|production|yield|lifetime|livstid|ac energy/i) && !has(x.n, /import|export|förbruk|consum|månad|month|år\b|year/i))) : undefined;

  const homeBattery = all.find(
    (x) => domain(x.e) === "sensor" && x.dc === "battery" && x.u === "%" && working(x) && !carDevices.has(x.d) && !x.o && has(`${x.n} ${x.m ?? ""}`, /storage|hembatteri|home battery|powerwall|battery soc|ferroamp|huawei|solaredge|sonnen|pixii|victron/i),
  );

  // ---- Climate devices (heat pump, thermostats, hot water, spa) with the device's pumps/lights/blowers
  const climates = all
    .filter((x) => (domain(x.e) === "climate" || domain(x.e) === "water_heater") && !carDevices.has(x.d))
    .map((x) => {
      const siblings = x.d ? (byDevice.get(x.d) ?? []) : [];
      const spa = has(`${x.m ?? ""} ${x.mo ?? ""} ${x.n} ${x.dn ?? ""}`, SPA);
      const controls = siblings
        .filter((s) => ["switch", "fan", "light"].includes(domain(s.e)) && s.e !== x.e)
        .map((s) => s.e)
        .slice(0, 6);
      return { name: spa && !has(x.n, /spa|bad|pool/i) ? "Spabad" : x.n, entityId: x.e, controls: controls.length ? controls : undefined };
    });

  // ---- Heat pumps etc. without a climate entity (Husdata H60/H66, Nibe, Thermia …): sensor cards
  const climateDevices = new Set(climates.map((c) => all.find((x) => x.e === c.entityId)?.d));
  const deviceCards: Discovery["deviceCards"] = [];
  for (const [dev, ents] of byDevice) {
    if (climateDevices.has(dev) || carDevices.has(dev)) continue;
    const head = ents[0];
    if (!has(`${head.m ?? ""} ${head.mo ?? ""} ${head.dn ?? ""}`, HEATPUMP)) continue;
    const sensors = ents.filter((x) => domain(x.e) === "sensor" && (x.dc === "temperature" || x.dc === "power" || has(x.n, /cop|kompressor|compressor|varmvatten|hot water|framledning|supply|retur|return|brine|köldbärare/i)));
    const primary = sensors.find((x) => x.dc === "temperature" && has(x.n, /inne|indoor|rum|room/i)) ?? sensors.find((x) => x.dc === "temperature");
    const controls = ents.filter((x) => ["switch", "select", "number", "button", "input_number", "input_select", "input_boolean"].includes(domain(x.e)));
    if (!sensors.length && !controls.length) continue;
    deviceCards.push({
      title: head.dn ?? "Värmepump",
      primary: primary?.e,
      sensors: sensors.filter((x) => x !== primary).slice(0, 8).map((x) => x.e),
      controls: controls.slice(0, 8).map((x) => x.e),
    });
  }

  // ---- Lights per area
  const areaLights = new Map<string, string[]>();
  for (const x of all.filter((y) => domain(y.e) === "light")) {
    const area = x.a ?? "Övriga";
    areaLights.set(area, [...(areaLights.get(area) ?? []), x.e]);
  }
  const lightGroups = [...areaLights].map(([name, entities]) => ({ name, entities })).sort((a, b) => a.name.localeCompare(b.name, "sv"));

  // ---- Temperatures (indoor/outdoor first)
  const temps = all
    .filter((x) => domain(x.e) === "sensor" && x.dc === "temperature" && !carDevices.has(x.d))
    .sort((a, b) => Number(has(b.n, /ute|outdoor|utomhus|inne|indoor|vardagsrum/i)) - Number(has(a.n, /ute|outdoor|utomhus|inne|indoor|vardagsrum/i)))
    .slice(0, 12)
    .map((x) => ({ name: x.n, entityId: x.e }));

  const live = (c: Discovery["cars"][number]) => (Number.isFinite(Number(all.find((x) => x.e === carAnchor(c))?.st)) ? 0 : 1);
  cars.sort((a, b) => live(a) - live(b));
  const todo = all.filter((x) => domain(x.e) === "todo").map((x) => ({ name: x.n, entityId: x.e }));
  const calendars = all
    .filter((x) => domain(x.e) === "calendar" && x.st !== "unavailable")
    .map((x) => ({ name: x.n, entityId: x.e, waste: has(`${x.n} ${x.e} ${x.m ?? ""}`, /waste|sop|avfall|renhåll|tömning|hämtning/i) }));
  const priceSensors = all
    // A price has a currency per kWh as its unit; the name alone ("spottar", Tibber's consumption) is not enough.
    .filter((x) => domain(x.e) === "sensor" && has(x.u, /^(SEK|öre|kr|EUR|NOK|DKK|€)\/kWh$/i) && !x.o)
    .sort((a, b) => Number(working(b)) - Number(working(a)) || Number(has(`${b.e} ${b.n}`, /nordpool|tibber|elpris|spot|price/i)) - Number(has(`${a.e} ${a.n}`, /nordpool|tibber|elpris|spot|price/i)))
    .map((x) => ({ name: x.n, entityId: x.e }));
  const buttons = all.filter((x) => domain(x.e) === "scene" || domain(x.e) === "script").map((x) => ({ name: x.n, entityId: x.e }));
  const speakers = all
    .filter((x) => domain(x.e) === "media_player" && !x.o && x.st !== "unavailable" && x.dc !== "tv" && x.dc !== "receiver" && !has(`${x.m ?? ""} ${x.e}`, /spotify/i) && !has(x.n, /\btv\b|television/i))
    // "Google Home Mini" in the area Kök reads as "Kök" – unless two speakers share the room.
    .map((x, _i, list) => ({ name: x.a && list.filter((y) => y.a === x.a).length === 1 ? x.a : x.n, entityId: x.e }));

  // Cars have their own locks, windows and trunks (Tesla, Volvo …): those belong on the car card (carDevices above).
  const ok = (x: HaEntityInfo) => !x.o && x.st !== "unavailable" && !(x.d && carDevices.has(x.d));
  const named = (x: HaEntityInfo) => ({ name: x.n, entityId: x.e });
  const security: SecurityEntities = {
    cameras: all.filter((x) => domain(x.e) === "camera" && ok(x)).map(named),
    locks: all.filter((x) => domain(x.e) === "lock" && ok(x)).map(named),
    alarms: all.filter((x) => domain(x.e) === "alarm_control_panel" && ok(x)).map(named),
    covers: all.filter((x) => domain(x.e) === "cover" && ok(x) && (x.dc === "garage" || x.dc === "gate")).map(named),
    openings: all
      .filter((x) => domain(x.e) === "binary_sensor" && ok(x) && ["door", "window", "garage_door", "opening"].includes(x.dc ?? ""))
      .sort((a, b) => Number(b.dc === "door" || b.dc === "garage_door") - Number(a.dc === "door" || a.dc === "garage_door"))
      .slice(0, 40)
      .map(named),
  };
  const robots = all
    .filter((x) => (domain(x.e) === "vacuum" || domain(x.e) === "lawn_mower") && ok(x))
    .map((x) => {
      const battery = x.d ? (byDevice.get(x.d) ?? []).find((y) => domain(y.e) === "sensor" && y.dc === "battery") : undefined;
      return { name: x.n, entityId: x.e, ...(battery ? { battery: battery.e } : {}) };
    });

  const appliances = findAppliances(all);

  const summary = [
    cars.length ? `${cars.length} bil${cars.length > 1 ? "ar" : ""}: ${cars.map((c) => c.name).join(", ")}` : "",
    solar ? `Solel: ${solar.n}${solar.m ? ` (${solar.m})` : ""}` : "",
    grid ? `Elnät: ${grid.n}` : "",
    homeBattery ? `Hembatteri: ${homeBattery.n}` : "",
    climates.length ? `${climates.length} värme/klimat-enheter` : "",
    deviceCards.length ? `Värmepump/enhet: ${deviceCards.map((d) => d.title).join(", ")}` : "",
    lightGroups.length ? `${lightGroups.reduce((s, g) => s + g.entities.length, 0)} lampor i ${lightGroups.length} rum` : "",
    priceSensors.length ? `Elpris-sensor: ${priceSensors[0].name}` : "",
    calendars.some((c) => c.waste) ? "Sopkalender hittad" : "",
    speakers.length ? `Högtalare: ${speakers.map((x) => x.name).join(", ")}` : "",
    security.cameras.length ? `${security.cameras.length} kamer${security.cameras.length > 1 ? "or" : "a"}` : "",
    security.locks.length ? `Lås: ${security.locks.map((x) => x.name).join(", ")}` : "",
    security.alarms.length ? `Larm: ${security.alarms.map((x) => x.name).join(", ")}` : "",
    security.covers.length ? `Port: ${security.covers.map((x) => x.name).join(", ")}` : "",
    robots.length ? `Robotar: ${robots.map((x) => x.name).join(", ")}` : "",
    appliances.length ? `Husgeråd: ${appliances.map((x) => x.name).join(", ")}` : "",
  ].filter(Boolean);

  return {
    cars,
    energy: { solar: solar?.e, grid: grid?.e, gridExport: gridExport?.e, house: house?.e, battery: homeBattery?.e, solarEnergy: solarEnergy?.e, importEnergy: importEnergy?.e, exportEnergy: exportEnergy?.e },
    climates,
    lightGroups,
    deviceCards,
    temps,
    todo,
    calendars,
    priceSensors,
    buttons,
    speakers,
    security,
    robots,
    appliances,
    summary,
  };
}

// ---------- Car "Alla data" ----------

const GROUPS: { name: string; re: RegExp }[] = [
  { name: "Batteri, bränsle & laddning", re: /batter|charg|ladd|soc|plug|kWh|state of charge|range|räckvidd|bränsle|fuel|tom tank/i },
  { name: "Klimat & temperatur", re: /climate|klimat|temp|heat|värm|defrost|seat|ac\b|hvac|preconditio/i },
  { name: "Körning & däck", re: /tire|tyre|däck|odometer|mätar|speed|hastighet|drive|shift|gear|trip/i },
  { name: "Lås & luckor", re: /lock|lås|door|dörr|window|fönster|trunk|frunk|bagage|sunroof|charge port|lucka/i },
  { name: "Plats", re: /location|position|plats|tracker|gps|heading|latitude|longitude|home|hemma/i },
  { name: "System", re: /software|firmware|update|version|online|sleep|status|signal|rssi|api|last|senast|asleep|wake/i },
];

export interface CarEntityRow {
  entityId: string;
  name: string;
  value: string;
  group: string;
  ok: boolean;
  note?: string;
  domain: string;
}

export function carRows(ents: HaEntityInfo[], deviceName: string, now = new Date(), staleHours = 12): CarEntityRow[] {
  const strip = (n: string) => (deviceName && n.startsWith(deviceName) ? n.slice(deviceName.length).trim() || n : n);
  return ents
    .filter((x) => !["button", "update", "image"].includes(domain(x.e)))
    .map((x) => {
      const name = strip(x.n);
      const unavailable = x.st === "unavailable" || x.st === "unknown";
      const age = (now.getTime() - new Date(x.lu).getTime()) / 3_600_000;
      const stale = !unavailable && domain(x.e) === "sensor" && age > staleHours;
      const group = GROUPS.find((g) => g.re.test(`${name} ${x.e}`))?.name ?? "Övrigt";
      const value = unavailable ? "otillgänglig" : `${x.st}${x.u ? ` ${x.u}` : ""}`;
      return {
        entityId: x.e,
        name,
        value,
        group,
        ok: !unavailable && !stale,
        note: stale ? `inte uppdaterad på ${Math.round(age)} h` : undefined,
        domain: domain(x.e),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));
}

export function carActions(ents: HaEntityInfo[], deviceName: string) {
  const strip = (n: string) => (deviceName && n.startsWith(deviceName) ? n.slice(deviceName.length).trim() || n : n);
  return ents
    .filter((x) => ["button", "switch", "lock", "climate", "cover"].includes(domain(x.e)) && x.st !== "unavailable")
    .map((x) => ({ entityId: x.e, name: strip(x.n), domain: domain(x.e), state: x.st }))
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));
}

/**
 * Charging on the car's own device: a switch or start/stop buttons to charge now, and whatever
 * schedule the integration exposes (scheduled charging, departure time, off-peak …). Read as is.
 */
/** "2026-10-20T06:30:00+02:00" → "tis 06:30", "on" → "På", "07:15:00" → "07:15". */
export function niceState(st: string, unit?: string | null): string {
  if (st === "on") return "På";
  if (st === "off") return "Av";
  if (/^\d{2}:\d{2}:\d{2}$/.test(st)) return st.slice(0, 5);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(st)) {
    const d = new Date(st);
    if (!Number.isNaN(d.getTime()))
      return d.toLocaleString("sv-SE", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: process.env.TZ || "Europe/Stockholm" });
  }
  return `${st}${unit ? ` ${unit}` : ""}`;
}

export function carCharging(ents: HaEntityInfo[], deviceName: string) {
  const strip = (n: string) => (deviceName && n.startsWith(deviceName) ? n.slice(deviceName.length).trim() || n : n);
  const live = ents.filter((x) => x.st !== "unavailable");
  const label = (x: HaEntityInfo) => `${x.n} ${x.e}`;
  const isCharge = (x: HaEntityInfo) => /charg|ladd/i.test(label(x)) && !/port|lucka|limit|gräns|amp|cable|kabel|current|ström/i.test(label(x));
  const SCHEDULE = /schedul|departure|avgång|off.?peak|laddschema|schema|charge.*(start|end|time)|ladd.*(start|slut|tid)|ready.?by|klar/i;
  const sw = live.find((x) => domain(x.e) === "switch" && isCharge(x) && !SCHEDULE.test(label(x)));
  const start = live.find((x) => domain(x.e) === "button" && /start/i.test(label(x)) && isCharge(x));
  const stop = live.find((x) => domain(x.e) === "button" && /stop/i.test(label(x)) && isCharge(x));
  const schedule = live
    .filter((x) => ["sensor", "time", "datetime", "select", "switch", "binary_sensor", "number", "input_datetime"].includes(domain(x.e)) && x.e !== sw?.e && SCHEDULE.test(label(x)))
    .map((x) => ({ entityId: x.e, name: strip(x.n), value: niceState(x.st, x.u) }))
    .sort((a, b) => a.name.localeCompare(b.name, "sv"))
    .slice(0, 12);
  return {
    switch: sw ? { entityId: sw.e, name: strip(sw.n), on: sw.st === "on" } : undefined,
    start: start ? { entityId: start.e, name: strip(start.n) } : undefined,
    stop: stop ? { entityId: stop.e, name: strip(stop.n) } : undefined,
    schedule,
  };
}
