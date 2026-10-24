import { secureUrl } from "./https.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { cached, invalidate } from "./cache.js";
import { fetchWithTimeout } from "./http.js";
import { lookupPostcode } from "./connectors/geo.js";
import { detectGroups, fetchIcs, filterEvents } from "./connectors/ics.js";
import { ha, haConnection } from "./connectors/ha.js";
import { geocode } from "./connectors/weather.js";
import { buildDashboard, gatherFamily } from "./dashboard.js";
import { duties, dutiesIcs } from "./plan.js";
import { loadShelf, saveDinner, saveShelf } from "./meals.js";
import { carActions, carCharging, carRows, deviceEntities, discover, readRegistry } from "./discovery.js";
import { runEntityAction } from "./scheduler.js";
import { findAutoModes, findSmartCharging } from "./smartcharging.js";
import { loadChores, saveChores, setChoreDone } from "./chores.js";
import { haSocket } from "./connectors/haws.js";
import { energyLive, liveEnergyIds } from "./energy.js";
import { publishToHa } from "./publisher.js";
import { MULTIPLE, allMeta, findProvider, makeCtx, secretKey } from "./providers/registry.js";
import { calendarEvents, groceryIntegration, groceryIntegrations, newsFiles } from "./sources.js";
import { icaListId, icaStrike } from "./connectors/ica.js";
import { ICA_LIST, SHOW, icaRun } from "./providers/grocery.js";
import { addOwnEvent, markNewsSeen, removeOwnEvent } from "./news.js";
import { vklassFile, vklassLogin } from "./connectors/vklass.js";
import { saveTravel } from "./travel.js";
import {
  deletePhoto,
  getSecret,
  listPhotos,
  listSecretKeys,
  loadConfig,
  loadDevices,
  saveDevices,
  loadLocal,
  loadLocalList,
  photoPath,
  saveConfig,
  saveLocal,
  saveLocalList,
  savePhoto,
  setSecret,
} from "./store.js";
import { readFileSync } from "node:fs";
import { addDays, dayKey, hhmm, shortDate, shortWeekday, startOfDay } from "./time.js";
import { setSick } from "./sick.js";
import { makeBackup, restoreBackup } from "./backup.js";
import { follows } from "./notify.js";
import { findStations, playCall, spotifyPlayer, spotifyUri, swedishStations } from "./music.js";
import { alarmCall, robotCall } from "./security.js";
import { MEDIA_TYPES, SHELVES, type Shelf, library as maLibrary, playOn as maPlayOn, search as maSearch, tracksOf as maTracks } from "./musicAssistant.js";
import { HOME_WIDGETS, TAB_IDS, type Config, type FoodPart, type StoreFood, type StoreFoodData, type ConfigResponse, type Integration, type IntegrationCategory, type Schedule, type SecretKey } from "./types.js";

export { VERSION } from "./version.js";
import { VERSION } from "./version.js";

/** Names that may come straight from Home Assistant (friendly_name) are shortened, not rejected. */
const label = (max: number) => z.string().max(500).transform((s) => (s.trim().length > max ? `${s.trim().slice(0, max - 1).trimEnd()}…` : s.trim()));
const ID = /^[a-z0-9-]{1,40}$/;
const SUPERVISOR_IP = "172.30.32.2";

function pinOk(req: FastifyRequest): boolean {
  // Inside the HA add-on, ingress requests arrive from the Supervisor and are already authenticated.
  if (process.env.SUPERVISOR_TOKEN && req.ip === SUPERVISOR_IP) return true;
  const pin = getSecret("admin.pin");
  if (!pin) return true;
  const given = String(req.headers["x-admin-pin"] ?? "");
  const a = Buffer.from(pin);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- Paired screens ----------
// With a PIN set, the board itself (not only the settings) answers only screens that have been
// unlocked with the PIN once. They get a long-lived HttpOnly cookie; other devices on the network get 401.

const DEVICE_COOKIE = "ft_device";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function fromIngress(req: FastifyRequest) {
  return Boolean(process.env.SUPERVISOR_TOKEN) && req.ip === SUPERVISOR_IP;
}

function deviceToken(req: FastifyRequest): string {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === DEVICE_COOKIE) return decodeURIComponent(v.join("="));
  }
  return "";
}

function trusted(req: FastifyRequest): boolean {
  if (fromIngress(req) || !getSecret("admin.pin")) return true;
  const t = deviceToken(req);
  if (t && loadDevices().some((d) => d.hash === sha(t))) return true;
  return pinOk(req) && Boolean(req.headers["x-admin-pin"]);
}

/** Remember this browser as a paired screen. */
function issueDevice(req: FastifyRequest, reply: FastifyReply, name: string) {
  const token = randomBytes(32).toString("base64url");
  const list = loadDevices();
  list.push({ hash: sha(token), name: name.slice(0, 60), created: new Date().toISOString() });
  saveDevices(list.slice(-20));
  const secure = req.protocol === "https" ? "; Secure" : "";
  reply.header("set-cookie", `${DEVICE_COOKIE}=${token}; Path=/; Max-Age=${5 * 365 * 86_400}; HttpOnly; SameSite=Strict${secure}`);
}

const OPEN = new Set(["/api/health", "/api/auth/status", "/api/auth/pair"]);
// Calendar subscriptions on the phones carry their own secret token in the URL.
const OPEN_PREFIX = "/api/feed/";

async function guard(req: FastifyRequest, reply: FastifyReply) {
  if (!pinOk(req)) await reply.code(401).send({ error: "PIN krävs för inställningar." });
}

function fail(reply: FastifyReply, e: unknown, code = 400) {
  return reply.code(code).send({ error: (e as Error).message ?? String(e) });
}

// ---------- Validation ----------

const careDays = z.record(z.enum(["1", "2", "3", "4", "5", "6", "7"]), z.string().regex(/^\d{1,2}[:.]\d{2}\s*[-–]\s*\d{1,2}[:.]\d{2}$/));
const personSchema = z.object({
  id: z.string().regex(ID),
  name: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  kind: z.enum(["adult", "child"]),
  custody: z
    .object({
      mode: z.enum(["always", "oddWeeks", "evenWeeks", "alternating", "pattern"]),
      pattern: z.array(z.boolean()).length(14).optional(),
      anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      handoverDay: z.number().int().min(1).max(7).optional(),
      overrides: z
        .array(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), home: z.boolean(), note: z.string().max(60).optional() }))
        .max(60)
        .optional(),
    })
    .optional(),
  notify: z
    .object({
      service: z.string().regex(/^[a-z0-9_]{1,80}$/).optional(),
      before: z.number().int().min(0).max(240).optional(),
      evening: z.boolean().optional(),
      weekly: z.boolean().optional(),
      home: z.boolean().optional(),
      updates: z.boolean().optional(),
      morning: z.union([z.literal(""), z.string().regex(/^\d{2}:\d{2}$/)]).optional(),
      children: z.array(z.string().regex(ID)).max(20).optional(),
    })
    .optional(),
  care: z
    .object({
      name: z.string().max(30).optional(),
      days: careDays,
      weeks: z.array(careDays).max(3).optional(),
      anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      travel: z.lazy(() => travelChoiceSchema).optional(),
      notes: z.record(z.enum(["1", "2", "3", "4", "5", "6", "7"]), z.string().max(60)).optional(),
    })
    .optional(),
});

const calendarSchema = z.object({
  id: z.string().regex(ID),
  name: z.string().min(1).max(60),
  provider: z.enum(["google", "icloud", "laget", "sportadmin", "svenskalag", "infomentor", "outlook", "ics", "ha"]),
  kind: z.enum(["ics", "ha"]),
  entityId: z.string().optional(),
  personId: z.string().optional(),
  category: z.enum(["family", "sport", "school", "work", "other"]),
  include: z.array(z.string().max(60)).max(20).optional(),
  exclude: z.array(z.string().max(60)).max(20).optional(),
  visibility: z.enum(["custody", "always"]).optional(),
  alwaysShow: z.array(z.string().max(60)).max(20).optional(),
  travel: z.lazy(() => travelChoiceSchema).optional(),
});

const travelLegSchema = z.object({
  mode: z.union([z.enum(["bus", "self", "ride"]), z.custom<`adult:${string}`>((v) => typeof v === "string" && /^adult:[a-z0-9-]{1,40}$/i.test(v))]),
  by: z.string().trim().max(40).optional(),
});
const travelChoiceSchema = z.object({ to: travelLegSchema.optional(), home: travelLegSchema.optional() });

const integrationSchema = z.object({
  id: z.string().regex(ID),
  category: z.enum(["school", "grocery", "waste", "price"]),
  provider: z.string().max(40),
  settings: z.record(z.union([z.string().max(4000), z.number(), z.boolean()])),
  personMap: z.record(z.string()).optional(),
  personId: z.string().optional(),
});

const entity = z.string().max(120);
const scheduleSchema = z.object({
  id: z.string().regex(ID),
  name: z.string().min(1).max(40),
  entityId: entity,
  action: z.enum(["on", "off", "press"]),
  days: z.array(z.number().int().min(1).max(7)).max(7),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  enabled: z.boolean(),
});
/** Only lamps that are on the board can be switched from it. */
function knownLamp(cfg: Config, id: string): boolean {
  return cfg.entities.lights.some((l) => l.entityId === id) || (cfg.entities.lightGroups ?? []).some((g) => g.entities.includes(id));
}

export const configSchema = z
  .object({
    version: z.literal(1),
    setupComplete: z.boolean(),
    household: z.object({
      name: z.string().max(60),
      postcode: z.string().max(6).optional(),
      place: z.string().max(80).optional(),
      municipality: z.string().max(80).optional(),
      lat: z.number().optional(),
      lon: z.number().optional(),
      custodyCalendarId: z.string().optional(),
    }),
    people: z.array(personSchema).max(12),
    calendars: z.array(calendarSchema).max(40),
    integrations: z.array(integrationSchema).max(20),
    shopping: z.object({
      source: z.enum(["local", "ha"]),
      entityId: entity.optional(),
      sendTo: z.string().regex(ID).optional(),
      mappings: z.record(z.record(z.object({ code: z.string(), name: z.string() }))),
    }),
    electricity: z.object({
      cheapHours: z.number().int().min(1).max(8),
      markupOre: z.number().min(0).max(500),
      gridOre: z.number().min(0).max(500),
      taxOre: z.number().min(0).max(500),
      vat: z.boolean(),
    }),
    ha: z.object({ mode: z.enum(["none", "supervisor", "manual"]), url: z.string().url().optional() }),
    schedules: z.array(scheduleSchema).max(40),
    entities: z.object({
      cars: z
        .array(z.object({ name: label(40), battery: entity, range: entity.optional(), location: entity.optional(), charging: entity.optional(), climate: entity.optional(), plan: entity.optional(), mode: entity.optional() }))
        .max(6),
      energy: z.object({
        solar: entity.optional(),
        grid: entity.optional(),
        gridExport: entity.optional(),
        house: entity.optional(),
        battery: entity.optional(),
        solarEnergy: entity.optional(),
        importEnergy: entity.optional(),
        exportEnergy: entity.optional(),
      }),
      lights: z.array(z.object({ name: label(40), entityId: entity })).max(16),
      temps: z.array(z.object({ name: label(40), entityId: entity })).max(8),
      lightGroups: z.array(z.object({ name: label(40), entities: z.array(entity).max(40) })).max(12),
      buttons: z
        .array(z.object({ name: label(40), entityId: entity.regex(/^(scene|script|button|input_button|automation)\./), style: z.enum(["accent", "blue", "amber", "plain"]) }))
        .max(12),
      climates: z
        .array(z.object({ name: label(40), entityId: entity.regex(/^(climate|water_heater)\./), controls: z.array(entity).max(8).optional() }))
        .max(8),
      deviceCards: z
        .array(z.object({ title: label(40), primary: entity.optional(), sensors: z.array(entity).max(16), controls: z.array(entity).max(12) }))
        .max(8),
      graphs: z
        .array(z.object({ title: label(40), series: z.array(z.object({ name: label(30), entityId: entity, color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })).max(6) }))
        .max(6),
      speakers: z.array(z.object({ name: label(40), entityId: entity.regex(/^media_player\./) })).max(12).optional(),
      stations: z
        .array(z.object({ name: label(40), url: z.string().url().max(500).regex(/^https?:\/\//), logo: z.string().url().max(500).regex(/^https:\/\//).optional() }))
        .max(16)
        .optional(),
      security: z
        .object({
          cameras: z.array(z.object({ name: label(40), entityId: entity.regex(/^camera\./) })).max(16),
          locks: z.array(z.object({ name: label(40), entityId: entity.regex(/^lock\./) })).max(12),
          alarms: z.array(z.object({ name: label(40), entityId: entity.regex(/^alarm_control_panel\./) })).max(4),
          covers: z.array(z.object({ name: label(40), entityId: entity.regex(/^cover\./) })).max(8),
          openings: z.array(z.object({ name: label(40), entityId: entity.regex(/^binary_sensor\./) })).max(40),
          allowUnlock: z.boolean().optional(),
        })
        .optional(),
      robots: z
        .array(z.object({ name: label(40), entityId: entity.regex(/^(vacuum|lawn_mower)\./), battery: entity.regex(/^sensor\./).optional() }))
        .max(8)
        .optional(),
      appliances: z
        .array(
          z.object({
            name: label(40),
            kind: z.enum(["washer", "dryer", "dishwasher", "oven", "other"]),
            status: entity.optional(),
            remaining: entity.optional(),
            progress: entity.optional(),
            power: entity.optional(),
          }),
        )
        .max(10)
        .optional(),
    }),
    dashboard: z.object({
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      theme: z.enum(["auto", "dark", "light", "eink", "mirror"]),
      home: z.array(z.object({ id: z.enum(HOME_WIDGETS), on: z.boolean(), size: z.enum(["auto", "s", "m", "l"]).optional() })).max(20),
      tabs: z.array(z.object({ id: z.enum(TAB_IDS), on: z.boolean() })).max(12),
      nightFrom: z.string().regex(/^\d{2}:\d{2}$/),
      nightTo: z.string().regex(/^\d{2}:\d{2}$/),
      idleMinutes: z.number().int().min(0).max(240).default(10),
      sunArc: z.boolean().optional(),
      lessons: z.enum(["all", "span"]).optional(),
    }),
  })
  .superRefine((c, ctx) => {
    for (const i of c.integrations) {
      if (!findProvider(i.category as IntegrationCategory, i.provider)) ctx.addIssue({ code: "custom", message: `okänd leverantör ${i.provider}`, path: ["integrations"] });
    }
    for (const cat of ["waste", "price"] as const) {
      if (c.integrations.filter((i) => i.category === cat).length > 1) ctx.addIssue({ code: "custom", message: `bara en ${cat} åt gången`, path: ["integrations"] });
    }
    // Several stores are fine, but each only once.
    const stores = c.integrations.filter((i) => i.category === "grocery").map((i) => i.provider);
    if (new Set(stores).size !== stores.length) ctx.addIssue({ code: "custom", message: "samma butik två gånger", path: ["integrations"] });
  });

function allowedSecret(k: string): k is SecretKey {
  return ["ha.token", "admin.pin"].includes(k) || /^calendar\.[a-z0-9-]{1,40}\.url$/.test(k) || /^int\.[a-z0-9-]{1,40}\.[a-zA-Z]{1,30}$/.test(k);
}

/** Secrets that belong to provider fields marked secret – the only ones the browser may set. */
function isUserSecret(k: string, cfg: Config): boolean {
  const m = /^int\.([a-z0-9-]+)\.([a-zA-Z]+)$/.exec(k);
  if (!m) return allowedSecret(k);
  const integ = cfg.integrations.find((i) => i.id === m[1]);
  const provider = integ && findProvider(integ.category, integ.provider);
  return Boolean(provider?.meta.fields.some((f) => f.key === m[2] && f.secret));
}

/** What a test vouches for: the provider and every field (secrets from `typed` or the stored ones). Any edit changes it. */
function fingerprint(integ: Integration, typed: Record<string, string> = {}): string | null {
  const provider = findProvider(integ.category, integ.provider);
  if (!provider) return null;
  // Only what the sign-in depends on: changing a display choice (which shop, what Mat shows) keeps the "logged in" mark.
  const values = provider.meta.fields
    .filter((f) => f.type !== "toggle" && f.key !== "store" && f.key !== "list")
    .map((f) => (f.secret ? (typed[f.key] || getSecret(secretKey(integ.id, f.key)) || "") : String(integ.settings[f.key] ?? "").trim()));
  return createHash("sha256").update(JSON.stringify([integ.provider, values])).digest("hex");
}

function configResponse(): ConfigResponse {
  const config = loadConfig();
  return {
    config,
    verified: config.integrations.filter((i) => {
      const fp = fingerprint(i);
      return fp !== null && getSecret(secretKey(i.id, "ok")) === fp;
    }).map((i) => i.id),
    secretsSet: listSecretKeys().filter((k) => !k.endsWith(".session") && !k.endsWith(".ok")),
    providers: allMeta(),
    runtime: { supervisor: Boolean(process.env.SUPERVISOR_TOKEN), version: VERSION, pinRequired: Boolean(getSecret("admin.pin")) },
  };
}

const previewEvent = (e: { start: Date; allDay: boolean; title: string }) =>
  `${shortWeekday(e.start)} ${shortDate(e.start)}${e.allDay ? "" : ` ${hhmm(e.start)}`} · ${e.title}`;

export async function registerRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => ({ ok: true, version: VERSION }));
  // Where the board runs over https (same certificate as Home Assistant), for "Installera som app".
  app.get("/api/secure-url", async () => ({ url: secureUrl() }));

  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0];
    if (!path.startsWith("/api/") || OPEN.has(path) || path.startsWith(OPEN_PREFIX) || trusted(req)) return;
    await reply.code(401).send({ error: "Den här skärmen är inte upplåst. Ange PIN-koden en gång.", code: "pair" });
  });

  app.get("/api/auth/status", async (req) => ({
    paired: trusted(req),
    pinRequired: Boolean(getSecret("admin.pin")),
    supervisor: Boolean(process.env.SUPERVISOR_TOKEN),
  }));

  /** Unlock this screen with the PIN: stores a hashed token and sets a long-lived cookie. */
  app.post("/api/auth/pair", async (req, reply) => {
    const { pin, name } = (req.body ?? {}) as { pin?: string; name?: string };
    const stored = getSecret("admin.pin");
    if (!stored) return { ok: true };
    const a = Buffer.from(stored);
    const b = Buffer.from(String(pin ?? ""));
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      await new Promise((r) => setTimeout(r, 800)); // slow down guessing
      return reply.code(401).send({ error: "Fel PIN-kod" });
    }
    issueDevice(req, reply, String(name ?? "Skärm"));
    return { ok: true };
  });

  /** Forget all paired screens (e.g. a lost tablet). Needs the PIN. */
  app.delete("/api/auth/devices", { preHandler: guard }, async () => {
    saveDevices([]);
    return { ok: true };
  });

  // ---------- Config ----------
  app.get("/api/config", async () => configResponse());

  app.post("/api/auth/check", async (req, reply) => (pinOk(req) ? { ok: true } : reply.code(401).send({ error: "Fel PIN" })));

  app.put("/api/config", { preHandler: guard }, async (req, reply) => {
    const body = req.body as { config: Config; secrets?: Record<string, string | null> };
    const parsed = configSchema.safeParse(body?.config);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(reply, new Error(readableIssue(issue?.path ?? [], issue?.message ?? "")));
    }
    const prev = loadConfig();
    const next = parsed.data as unknown as Config;
    for (const [k, v] of Object.entries(body.secrets ?? {})) {
      if (!isUserSecret(k, next)) return fail(reply, new Error(`Okänd hemlighet ${k}`));
      if (k === "admin.pin" && v && !/^\d{4,8}$/.test(String(v))) return fail(reply, new Error("PIN-koden ska vara 4–8 siffror."));
    }
    // Another provider in the same slot must not inherit the old one's password or session.
    for (const i of next.integrations) {
      const was = prev.integrations.find((x) => x.id === i.id);
      if (was && was.provider !== i.provider) for (const k of listSecretKeys()) if (k.startsWith(`int.${i.id}.`)) setSecret(k as SecretKey, null);
    }
    for (const [k, v] of Object.entries(body.secrets ?? {})) setSecret(k as SecretKey, v);
    // Setting a PIN here must not lock out the screen doing it.
    if (body.secrets?.["admin.pin"] && !fromIngress(req)) issueDevice(req, reply, "Skärmen där PIN sattes");

    // Clean up secrets of removed calendars and integrations; a new login drops the old session.
    const cals = new Set(next.calendars.map((c) => c.id));
    for (const c of prev.calendars) if (!cals.has(c.id)) setSecret(`calendar.${c.id}.url`, null);
    const adults = new Set(next.people.filter((p) => p.kind === "adult").map((p) => p.id));
    for (const k of listSecretKeys()) if (k.startsWith("feed.") && !adults.has(k.slice(5))) setSecret(k as SecretKey, null);
    const ints = new Set(next.integrations.map((i) => i.id));
    for (const k of listSecretKeys()) {
      const m = /^int\.([a-z0-9-]+)\./.exec(k);
      if (m && !ints.has(m[1])) setSecret(k as SecretKey, null);
    }
    for (const k of Object.keys(body.secrets ?? {})) {
      const m = /^int\.([a-z0-9-]+)\.password$/.exec(k);
      if (m) setSecret(secretKey(m[1], "session"), null);
    }
    saveConfig(next);
    invalidate();
    return configResponse();
  });

  // ---------- Reminders to the phones ----------

  /** Home Assistant's notify services (the Companion app registers notify.mobile_app_<telefon>). */
  app.get("/api/ha/notify-services", { preHandler: guard }, async (_req, reply) => {
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Anslut Home Assistant först."));
    try {
      const domains = await ha.services(conn);
      const names = Object.keys(domains.find((d) => d.domain === "notify")?.services ?? {});
      return names.filter((n) => n !== "notify" && n !== "send_message" && n !== "persistent_notification").sort((a, b) => Number(b.startsWith("mobile_app_")) - Number(a.startsWith("mobile_app_")) || a.localeCompare(b));
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/notify/test", { preHandler: guard }, async (req, reply) => {
    const { service } = (req.body ?? {}) as { service?: string };
    const conn = haConnection();
    if (!conn || !service || !/^[a-z0-9_]{1,80}$/.test(service)) return fail(reply, new Error("Välj en telefon."));
    try {
      await ha.service(conn, "notify", service, { title: "Familjetavla", message: "Så här ser påminnelserna ut. Du får dem för det du lämnar, hämtar eller skjutsar." });
      return { ok: true, message: "Skickat – titta i telefonen." };
    } catch (e) {
      return fail(reply, e);
    }
  });

  /** Create (or replace) a private calendar link for one grown-up: what they drop off, pick up and drive. */
  app.post("/api/feed/:personId/new", { preHandler: guard }, async (req, reply) => {
    const id = (req.params as { personId: string }).personId;
    if (!loadConfig().people.some((p) => p.id === id && p.kind === "adult")) return fail(reply, new Error("Okänd person"));
    const token = randomBytes(18).toString("base64url");
    setSecret(`feed.${id}`, token);
    return { ok: true, path: `api/feed/${token}.ics` };
  });

  app.get("/api/feed/:file", async (req, reply) => {
    const token = (req.params as { file: string }).file.replace(/\.ics$/, "");
    const cfg = loadConfig();
    const person = cfg.people.find((p) => p.kind === "adult" && token.length > 10 && getSecret(`feed.${p.id}`) === token);
    if (!person) return reply.code(404).send("Hittades inte");
    const now = new Date();
    const fam = await gatherFamily(cfg, now, []);
    const mine = duties(fam.withCare, fam.people, fam.travelCtx, startOfDay(now), addDays(startOfDay(now), 7), loadShelf()).filter((d) => d.personId === person.id);
    reply.header("content-type", "text/calendar; charset=utf-8").header("cache-control", "no-store");
    return dutiesIcs(person.name, mine, person.notify?.before);
  });

  // ---------- Dashboard ----------
  app.get("/api/dashboard", async () => buildDashboard());

  /**
   * Server-Sent Events: tells open boards to refresh when something on the board changes in HA
   * (a lamp, the car, the shopping list). Throttled so a burst of changes is one refresh.
   */
  const clients = new Set<import("node:http").ServerResponse>();
  let pendingPush: NodeJS.Timeout | null = null;
  const watched = () => {
    const c = loadConfig();
    const e = c.entities;
    return new Set<string>([
      ...e.lights.map((l) => l.entityId),
      ...e.temps.map((t) => t.entityId),
      ...e.cars.flatMap((x) => [x.battery, x.range, x.location, x.charging, x.climate].filter(Boolean) as string[]),
      // Energy is not here: it changes every few seconds and goes out as its own small "energy" event.
      ...(e.lightGroups ?? []).flatMap((g) => g.entities),
      ...(e.climates ?? []).flatMap((x) => [x.entityId, ...(x.controls ?? [])]),
      ...(e.deviceCards ?? []).flatMap((x) => [x.primary, ...x.sensors, ...x.controls].filter(Boolean) as string[]),
      ...(c.shopping.entityId ? [c.shopping.entityId] : []),
      ...(e.speakers ?? []).map((x) => x.entityId),
    ]);
  };
  let watchSet = watched();
  let energySet = new Set(liveEnergyIds(loadConfig().entities.energy ?? {}));
  let pendingEnergy: NodeJS.Timeout | null = null;
  /** Live power flow: at most once a second, only the numbers, so the board need not reload. */
  const pushEnergy = () => {
    if (pendingEnergy || clients.size === 0) return;
    pendingEnergy = setTimeout(() => {
      pendingEnergy = null;
      const sock = haSocket();
      if (!sock?.connected) return;
      const live = energyLive(loadConfig().entities.energy ?? {}, sock.states);
      const msg = `event: energy\ndata: ${JSON.stringify(live)}\n\n`;
      for (const res of clients) res.write(msg);
    }, 1000);
  };
  haSocket()?.onChange((id) => {
    if (energySet.has(id)) pushEnergy();
    if (id !== "*" && !watchSet.has(id)) return;
    if (id === c_shopping()) invalidate("todo:");
    if (pendingPush || clients.size === 0) return;
    pendingPush = setTimeout(() => {
      pendingPush = null;
      for (const res of clients) res.write(`data: change\n\n`);
    }, 400);
  });
  const c_shopping = () => loadConfig().shopping.entityId;
  app.addHook("onResponse", async (req) => {
    if (req.method === "PUT" && req.url.startsWith("/api/config")) {
      watchSet = watched();
      energySet = new Set(liveEnergyIds(loadConfig().entities.energy ?? {}));
      haSocket()?.start(haConnection());
      publishToHa().catch(() => {});
    }
  });

  app.get("/api/events", (req, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write(`retry: 5000\n\n`);
    clients.add(reply.raw);
    const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 25_000);
    req.raw.on("close", () => {
      clearInterval(ping);
      clients.delete(reply.raw);
    });
    reply.hijack();
  });

  // ---------- Providers ----------
  app.get("/api/providers", async () => allMeta());

  /**
   * Test a provider with the values typed in the wizard. Body: { integration, secrets }
   * where secrets holds fields typed but not yet saved (falls back to stored ones).
   */
  app.post("/api/providers/test", { preHandler: guard }, async (req, reply) => {
    const { integration, secrets } = (req.body ?? {}) as { integration?: Integration; secrets?: Record<string, string> };
    const parsed = integrationSchema.safeParse(integration);
    if (!parsed.success) return fail(reply, new Error("Ogiltig koppling"));
    const integ = parsed.data as Integration;
    const provider = findProvider(integ.category, integ.provider);
    if (!provider) return fail(reply, new Error("Okänd leverantör"));
    if (provider.meta.needsHa && !haConnection()) return fail(reply, new Error("Anslut Home Assistant först."));
    try {
      // A shop that never answers must not leave the screen waiting.
      const result = await Promise.race([
        provider.test(makeCtx(integ, secrets ?? {})),
        new Promise<never>((_, no) => setTimeout(() => no(new Error("Testet tog för lång tid – butikens sida svarar inte. Försök igen om en stund.")), 85_000).unref()),
      ]);
      // A test that went through (and does not ask for more) is remembered for exactly these values.
      const fp = fingerprint(integ, secrets ?? {});
      setSecret(secretKey(integ.id, "ok"), result.ok && !result.choices && fp ? fp : null);
      return result;
    } catch (e) {
      setSecret(secretKey(integ.id, "ok"), null);
      return fail(reply, e);
    }
  });

  /** The shops to pick from, for a provider that has a list (the sign-in typed in the wizard is used when it is needed). */
  app.post("/api/providers/stores", { preHandler: guard }, async (req, reply) => {
    const { integration, secrets } = (req.body ?? {}) as { integration?: Integration; secrets?: Record<string, string> };
    const parsed = integrationSchema.safeParse(integration);
    if (!parsed.success) return fail(reply, new Error("Ogiltig koppling"));
    const integ = parsed.data as Integration;
    const provider = findProvider(integ.category, integ.provider);
    if (!provider || !("stores" in provider) || !provider.stores) return [];
    try {
      return await provider.stores(makeCtx(integ, secrets ?? {}));
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get("/api/providers/multiple", async () => MULTIPLE);

  // ---------- Home Assistant ----------
  app.post("/api/test/ha", { preHandler: guard }, async (req, reply) => {
    const { url, token } = (req.body ?? {}) as { url?: string; token?: string };
    const conn = haConnection(url ? { url, token: token || getSecret("ha.token") } : undefined);
    if (!conn) return fail(reply, new Error("Ange adress och token till Home Assistant."));
    try {
      await ha.ping(conn);
      const states = await ha.states(conn);
      return { ok: true, message: `Ansluten – ${states.length} entiteter.` };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get("/api/ha/entities", { preHandler: guard }, async (req, reply) => {
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
    const { domains } = req.query as { domains?: string };
    const want = (domains ?? "").split(",").filter(Boolean);
    try {
      const states = await ha.states(conn);
      return states
        .filter((s) => want.length === 0 || want.includes(s.entity_id.split(".")[0]))
        .map((s) => ({
          entityId: s.entity_id,
          name: s.attributes.friendly_name ?? s.entity_id,
          state: s.state,
          unit: s.attributes.unit_of_measurement,
          deviceClass: s.attributes.device_class as string | undefined,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "sv"));
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ---------- Calendars ----------
  app.post("/api/test/calendar", { preHandler: guard }, async (req, reply) => {
    const { url, entityId, sourceId, include, exclude } = (req.body ?? {}) as {
      url?: string;
      entityId?: string;
      sourceId?: string;
      include?: string[];
      exclude?: string[];
    };
    const from = startOfDay(new Date());
    const to = addDays(from, 45);
    try {
      let events;
      if (entityId) {
        const conn = haConnection();
        if (!conn) throw new Error("Home Assistant är inte anslutet.");
        events = await ha.calendarEvents(conn, entityId, from, to);
      } else if (url) {
        events = await fetchIcs(url, from, to);
      } else if (sourceId) {
        const src = loadConfig().calendars.find((c) => c.id === sourceId);
        if (!src) throw new Error("Okänd kalender");
        events = await calendarEvents(src, from, to);
      } else throw new Error("Klistra in en länk.");
      const shown = filterEvents(events, include, exclude);
      return {
        ok: true,
        message: `${shown.length} av ${events.length} händelser kommande 45 dagar visas.`,
        groups: detectGroups(events),
        preview: shown.slice(0, 6).map(previewEvent),
      };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ---------- Places ----------
  app.get("/api/postcode", async (req, reply) => {
    const { q } = req.query as { q?: string };
    try {
      return await lookupPostcode(q ?? "");
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.get("/api/geocode", async (req, reply) => {
    const { q } = req.query as { q?: string };
    if (!q || q.length < 2) return [];
    try {
      return await geocode(q);
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ---------- Grocery: send the shopping list to a store ----------
  /** The store named in the request (its integration id), else the one the list is set to go to. */
  const storeFor = (cfg: Config, body: unknown) => {
    const id = (body as { store?: string } | null)?.store;
    return (id ? groceryIntegrations(cfg).find((x) => x.integ.id === id) : undefined) ?? groceryIntegration(cfg);
  };
  app.post("/api/grocery/preview", async (req, reply) => {
    const cfg = loadConfig();
    const g = storeFor(cfg, req.body);
    if (!g) return fail(reply, new Error("Ingen butik vald."));
    const dash = await buildDashboard();
    const remembered = cfg.shopping.mappings[g.provider.meta.id] ?? {};
    const ctx = makeCtx(g.integ);
    const lines = await Promise.all(
      dash.shopping.items
        .filter((i) => !i.done)
        .map(async (i) => ({
          item: i.name,
          remembered: remembered[i.name.trim().toLowerCase()] ?? null,
          candidates: await g.provider.search(ctx, i.name).catch(() => []),
        })),
    );
    return { store: g.provider.meta.name, lines };
  });

  // ---------- Mat: every chosen store; the content of a part is fetched when it is opened ----------
  const partOnFor = (settings: Record<string, unknown>, part: FoodPart) => settings[SHOW[part]] !== "false" && settings[SHOW[part]] !== false;
  app.get("/api/food/stores", async (): Promise<StoreFood[]> =>
    groceryIntegrations(loadConfig()).flatMap((g) =>
      g.provider.food ? [{ id: g.integ.id, provider: g.provider.meta.id, name: g.provider.meta.name, parts: g.provider.food.parts.filter((p) => partOnFor(g.integ.settings, p)) }] : [],
    ),
  );
  /** The shops to switch between on the Mat tab (the board's own, from what is saved). */
  app.get("/api/food/stores/:id/choices", async (req, reply) => {
    const id = String((req.params as { id?: string }).id ?? "");
    const g = groceryIntegrations(loadConfig()).find((x) => x.integ.id === id);
    if (!g?.provider.stores) return { options: [], value: "" };
    try {
      return { options: await g.provider.stores(makeCtx(g.integ)), value: String(g.integ.settings.store ?? "") };
    } catch (e) {
      return fail(reply, e, 502);
    }
  });
  app.post("/api/food/stores/:id/store", { preHandler: guard }, async (req, reply) => {
    const id = String((req.params as { id?: string }).id ?? "");
    const body = z.object({ value: z.string().max(80) }).safeParse(req.body);
    if (!body.success) return fail(reply, new Error("Ogiltig butik"));
    const cfg = loadConfig();
    const integ = cfg.integrations.find((i) => i.id === id && i.category === "grocery");
    if (!integ) return fail(reply, new Error("Okänd butik"));
    integ.settings = { ...integ.settings, store: body.data.value };
    saveConfig(cfg);
    invalidate();
    return { ok: true };
  });

  app.get("/api/food/stores/:id/:part", async (req, reply): Promise<StoreFoodData | void> => {
    const q = z.object({ id: z.string().regex(ID), part: z.enum(["list", "cart", "common", "offers", "recipes"]) }).safeParse(req.params);
    if (!q.success) return fail(reply, new Error("Okänd del"));
    const g = groceryIntegrations(loadConfig()).find((x) => x.integ.id === q.data.id);
    if (!g?.provider.food || !g.provider.food.parts.includes(q.data.part) || !partOnFor(g.integ.settings, q.data.part)) return fail(reply, new Error("Den delen visas inte."));
    try {
      return await g.provider.food.load(makeCtx(g.integ), q.data.part);
    } catch (e) {
      return { errors: { [q.data.part]: (e as Error).message } };
    }
  });

  app.post("/api/food/ica/strike", async (req, reply) => {
    const body = z.object({ id: z.string().min(1).max(80), name: z.string().min(1).max(120), done: z.boolean() }).safeParse(req.body);
    if (!body.success) return fail(reply, new Error("Ogiltig rad"));
    const g = groceryIntegrations(loadConfig()).find((x) => x.provider.meta.id === "ica");
    if (!g) return fail(reply, new Error("ICA är inte vald."));
    const ctx = makeCtx(g.integ);
    try {
      await icaRun(ctx, async (s) => icaStrike(s, await icaListId(s, ctx.str("list") || ICA_LIST), body.data, body.data.done));
      return { ok: true };
    } catch (e) {
      return fail(reply, e, 502);
    }
  });

  app.post("/api/grocery/send", async (req, reply) => {
    const { lines } = (req.body ?? {}) as { lines?: { item: string; code: string; name: string; qty?: number }[] };
    if (!lines?.length) return fail(reply, new Error("Inget att skicka."));
    const cfg = loadConfig();
    const g = storeFor(cfg, req.body);
    if (!g) return fail(reply, new Error("Ingen butik vald."));
    try {
      const result = await g.provider.addToCart(
        makeCtx(g.integ),
        lines.map((l) => {
          const local = loadLocalList().find((i) => !i.done && i.name.trim().toLowerCase() === l.item.trim().toLowerCase());
          return { code: l.code, qty: Math.max(1, Math.min(20, Math.round(l.qty ?? 1))), item: l.item, offerId: local?.offer?.store === g.integ.id ? local.offer.id : undefined };
        }),
      );
      const map = (cfg.shopping.mappings[g.provider.meta.id] ??= {});
      for (const l of lines) map[l.item.trim().toLowerCase()] = { code: l.code, name: l.name };
      saveConfig(cfg);
      // Remember what went where, so the shopping list can show it.
      const sent = { ...(loadLocal().sentToStore ?? {}) };
      const at = new Date().toISOString();
      for (const l of lines) sent[l.item.trim().toLowerCase()] = { store: g.provider.meta.name, at };
      saveLocal({ sentToStore: sent });
      invalidate();
      return { ok: true, store: g.provider.meta.name, ...result };
    } catch (e) {
      return fail(reply, e, 502);
    }
  });

  // ---------- Actions from the board ----------
  app.post("/api/lights/toggle", async (req, reply) => {
    const { entityId } = (req.body ?? {}) as { entityId?: string };
    const cfg = loadConfig();
    if (!entityId || !knownLamp(cfg, entityId)) return fail(reply, new Error("Okänd lampa"));
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
    await ha.service(conn, "homeassistant", "toggle", { entity_id: entityId });
    invalidate("ha:states");
    return { ok: true };
  });

  app.post("/api/lights/brightness", async (req, reply) => {
    const body = z.object({ entityId: entity, pct: z.number().int().min(0).max(100) }).safeParse(req.body);
    if (!body.success || !knownLamp(loadConfig(), body.data.entityId) || !body.data.entityId.startsWith("light.")) return fail(reply, new Error("Okänd lampa"));
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
    const { entityId, pct } = body.data;
    if (pct === 0) await ha.service(conn, "light", "turn_off", { entity_id: entityId });
    else await ha.service(conn, "light", "turn_on", { entity_id: entityId, brightness_pct: pct });
    invalidate("ha:states");
    return { ok: true };
  });

  /** Long press on the board: new order of the home cards, or one hidden. Same rights as the settings. */
  app.post("/api/home-layout", { preHandler: guard }, async (req, reply) => {
    const body = z.object({ home: z.array(z.object({ id: z.enum(HOME_WIDGETS), on: z.boolean() })).max(20) }).safeParse(req.body);
    if (!body.success) return fail(reply, new Error("Ogiltig ordning"));
    const cfg = loadConfig();
    const old = new Map(cfg.dashboard.home.map((w) => [w.id, w]));
    const seen = new Set<string>();
    const next = body.data.home.filter((w) => !seen.has(w.id) && seen.add(w.id)).map((w) => ({ ...old.get(w.id), id: w.id, on: w.on }));
    // Cards the board did not send (none should be missing) keep their place at the end.
    for (const w of cfg.dashboard.home) if (!seen.has(w.id)) next.push(w);
    cfg.dashboard.home = next;
    saveConfig(cfg);
    return { ok: true, home: next };
  });

  app.post("/api/lights/off", async (_req, reply) => {
    const cfg = loadConfig();
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
    if (cfg.entities.lights.length) {
      await ha.service(conn, "homeassistant", "turn_off", { entity_id: cfg.entities.lights.map((l) => l.entityId) });
    }
    invalidate("ha:states");
    return { ok: true };
  });

  // ---------- Musik ----------
  /** Only speakers on the board can be played on. */
  /** A speaker or soundbar in standby is turned on before it is asked to play. */
  const wake = async (conn: NonNullable<ReturnType<typeof haConnection>>, id: string) => {
    const st = await ha.state(conn, id).catch(() => undefined);
    if (st?.state === "off") await ha.service(conn, "media_player", "turn_on", { entity_id: id }).catch(() => undefined);
    // The volume last chosen on the board for this speaker, so the kitchen is never suddenly too loud.
    const last = loadLocal().volumes?.[id];
    const now = (st?.attributes as { volume_level?: number } | undefined)?.volume_level;
    if (typeof last === "number" && (typeof now !== "number" || Math.round(now * 100) !== last))
      await ha.service(conn, "media_player", "volume_set", { entity_id: id, volume_level: last / 100 }).catch(() => undefined);
  };
  const speakerOf = (id: unknown) => (typeof id === "string" ? (loadConfig().entities.speakers ?? []).find((x) => x.entityId === id) : undefined);

  app.post("/api/music/play", async (req, reply) => {
    const body = z.object({ index: z.number().int().min(0), speaker: entity }).safeParse(req.body);
    const station = body.success ? loadConfig().entities.stations?.[body.data.index] : undefined;
    if (!body.success || !station || !speakerOf(body.data.speaker)) return fail(reply, new Error("Okänd kanal eller högtalare"));
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
    await wake(conn, body.data.speaker);
    const c = playCall(body.data.speaker, station);
    try {
      await ha.service(conn, c.domain, c.service, c.data);
    } catch (e) {
      return fail(reply, new Error(`${speakerOf(body.data.speaker)!.name} kunde inte spela ${station.name}: ${(e as Error).message}`), 502);
    }
    invalidate("ha:states");
    return { ok: true };
  });

  app.post("/api/music/stop", async (req, reply) => {
    const { speaker } = (req.body ?? {}) as { speaker?: string };
    if (!speakerOf(speaker)) return fail(reply, new Error("Okänd högtalare"));
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
    // Not every speaker can stop (some only pause); media_stop falls back to pause there.
    try {
      await ha.service(conn, "media_player", "media_stop", { entity_id: speaker });
    } catch {
      await ha.service(conn, "media_player", "media_pause", { entity_id: speaker });
    }
    invalidate("ha:states");
    return { ok: true };
  });

  // Omslaget till det som spelas, via tavlans server (token når aldrig webbläsaren).
  app.get("/api/music/cover/:entityId", async (req, reply) => {
    const id = (req.params as { entityId: string }).entityId;
    const conn = haConnection();
    if (!speakerOf(id) || !conn) return fail(reply, new Error("Okänd högtalare"));
    try {
      const res = await fetchWithTimeout(`${conn.base}/media_player_proxy/${encodeURIComponent(id)}`, { timeoutMs: 8000, headers: { authorization: `Bearer ${conn.token}` } });
      if (!res.ok) throw new Error(`Omslaget svarade ${res.status}`);
      return reply.header("cache-control", "private, max-age=300").type(res.headers.get("content-type") ?? "image/jpeg").send(Buffer.from(await res.arrayBuffer()));
    } catch (e) {
      return fail(reply, e, 404);
    }
  });

  // Spela/paus, nästa och föregående på en högtalare.
  app.post("/api/music/transport", async (req, reply) => {
    const body = z.object({ speaker: entity, action: z.enum(["play_pause", "next", "previous"]) }).safeParse(req.body);
    if (!body.success || !speakerOf(body.data.speaker)) return fail(reply, new Error("Okänd högtalare"));
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
    const svc = { play_pause: "media_play_pause", next: "media_next_track", previous: "media_previous_track" }[body.data.action];
    try {
      await ha.service(conn, "media_player", svc, { entity_id: body.data.speaker });
    } catch (e) {
      return fail(reply, e);
    }
    invalidate("ha:states");
    return { ok: true };
  });

  app.post("/api/music/volume", async (req, reply) => {
    const body = z.object({ speaker: entity, pct: z.number().int().min(0).max(100) }).safeParse(req.body);
    if (!body.success || !speakerOf(body.data.speaker)) return fail(reply, new Error("Okänd högtalare"));
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
    await ha.service(conn, "media_player", "volume_set", { entity_id: body.data.speaker, volume_level: body.data.pct / 100 });
    saveLocal({ volumes: { ...loadLocal().volumes, [body.data.speaker]: body.data.pct } });
    invalidate("ha:states");
    return { ok: true };
  });

  // The Musik tab: every Swedish station, played by its directory id (never an arbitrary link from the board).
  app.get("/api/music/stations", async (_req, reply) => {
    try {
      return { stations: await swedishStations() };
    } catch (e) {
      return fail(reply, e, 502);
    }
  });

  app.post("/api/music/play-id", async (req, reply) => {
    const body = z.object({ id: z.string().max(64), speaker: entity }).safeParse(req.body);
    if (!body.success || !speakerOf(body.data.speaker)) return fail(reply, new Error("Okänd högtalare"));
    const station = (await swedishStations().catch(() => [])).find((x) => x.id === body.data.id);
    if (!station) return fail(reply, new Error("Kanalen finns inte i katalogen längre"));
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
    await wake(conn, body.data.speaker);
    const c = playCall(body.data.speaker, station);
    try {
      await ha.service(conn, c.domain, c.service, c.data);
    } catch (e) {
      return fail(reply, new Error(`${speakerOf(body.data.speaker)!.name} kunde inte spela ${station.name}: ${(e as Error).message}`), 502);
    }
    invalidate("ha:states");
    return { ok: true };
  });

  /** ★ in the Musik tab: a favourite is on the home card. Only stations from the directory can be added. */
  app.post("/api/music/favorite", async (req, reply) => {
    const body = z.object({ id: z.string().max(64).optional(), url: z.string().max(500).optional(), on: z.boolean() }).safeParse(req.body);
    if (!body.success) return fail(reply, new Error("Okänd kanal"));
    const cfg = loadConfig();
    const favs = cfg.entities.stations ?? [];
    if (body.data.on) {
      const station = (await swedishStations().catch(() => [])).find((x) => x.id === body.data.id);
      if (!station) return fail(reply, new Error("Kanalen finns inte i katalogen längre"));
      if (favs.length >= 16) return fail(reply, new Error("Högst 16 favoriter – ta bort någon först."));
      if (!favs.some((f) => f.url === station.url)) cfg.entities.stations = [...favs, { name: station.name, url: station.url, ...(station.logo ? { logo: station.logo } : {}) }];
    } else {
      cfg.entities.stations = favs.filter((f) => f.url !== body.data.url);
    }
    saveConfig(cfg);
    return { ok: true, stations: cfg.entities.stations };
  });

  /** Spotify: play/pause and next on the account's player (whatever device it plays on). */
  app.post("/api/music/spotify", async (req, reply) => {
    const body = z.object({ op: z.enum(["playpause", "next"]) }).safeParse(req.body);
    if (!body.success) return fail(reply, new Error("Okänd knapp"));
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
    const player = spotifyPlayer(new Map((await ha.states(conn)).map((s) => [s.entity_id, s])));
    if (!player) return fail(reply, new Error("Spotify finns inte i Home Assistant."));
    await ha.service(conn, "media_player", body.data.op === "next" ? "media_next_track" : "media_play_pause", { entity_id: player.entity_id });
    invalidate("ha:states");
    return { ok: true };
  });

  // Music Assistant: the library as covers (Spotify playlists, albums, podcasts) and search.
  const boardSpeakers = () => (loadConfig().entities.speakers ?? []).map((s) => s.entityId);
  app.get("/api/music/library", async (req, reply) => {
    const q = z.object({ shelf: z.enum(Object.keys(SHELVES) as [Shelf, ...Shelf[]]), offset: z.coerce.number().int().min(0).max(5000).optional() }).safeParse(req.query);
    if (!q.success) return fail(reply, new Error("Okänd hylla"));
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
    try {
      return { tiles: await maLibrary(conn, boardSpeakers(), q.data.shelf, q.data.offset ?? 0) };
    } catch (e) {
      return fail(reply, e, 502);
    }
  });

  app.get("/api/music/search", async (req, reply) => {
    const q = z.object({ q: z.string().trim().min(2).max(60) }).safeParse(req.query);
    if (!q.success) return { tiles: [] };
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
    try {
      return { tiles: await maSearch(conn, boardSpeakers(), q.data.q) };
    } catch (e) {
      return fail(reply, e, 502);
    }
  });

  // A playlist or album opened like in Spotify: every track.
  app.get("/api/music/items", async (req, reply) => {
    const q = z.object({ uri: z.string().max(300).regex(/^[a-z0-9_-]+:\/\/\S+$/i) }).safeParse(req.query);
    if (!q.success) return fail(reply, new Error("Okänd spellista"));
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
    try {
      return await maTracks(conn, boardSpeakers(), q.data.uri);
    } catch (e) {
      return fail(reply, e, 502);
    }
  });

  app.post("/api/music/play-media", async (req, reply) => {
    const body = z
      .object({ uri: z.string().max(300).regex(/^[a-z0-9_-]+:\/\/\S+$/i), type: z.enum(MEDIA_TYPES), title: label(80).optional(), speaker: entity, start: z.string().max(300).regex(/^[a-z0-9_-]+:\/\/\S+$/i).optional(), shuffle: z.boolean().optional() })
      .safeParse(req.body);
    const sp = body.success ? speakerOf(body.data.speaker) : undefined;
    if (!body.success || !sp) return fail(reply, new Error("Okänd låt eller högtalare"));
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
    try {
      await wake(conn, sp.entityId);
      await maPlayOn(conn, new Map((await ha.states(conn)).map((s) => [s.entity_id, s])), sp, body.data);
    } catch (e) {
      return fail(reply, new Error(`${sp.name} kunde inte spela ${body.data.title ?? "det"}: ${(e as Error).message}`), 502);
    }
    invalidate("ha:states");
    return { ok: true };
  });

  // ---------- Säkerhet och Städ ----------
  const sec = () => loadConfig().entities.security;
  const inList = <T extends { entityId: string }>(list: T[] | undefined, id: unknown): T | undefined => (typeof id === "string" ? list?.find((x) => x.entityId === id) : undefined);
  const haCall = async (reply: FastifyReply, name: string, domain: string, service: string, data: Record<string, unknown>) => {
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
    try {
      await ha.service(conn, domain, service, data);
    } catch (e) {
      return fail(reply, new Error(`${name}: ${(e as Error).message}`), 502);
    }
    invalidate("ha:states");
    return { ok: true };
  };

  app.get("/api/camera/:id", async (req, reply) => {
    const cam = inList(sec()?.cameras, (req.params as { id: string }).id);
    if (!cam) return fail(reply, new Error("Okänd kamera"), 404);
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
    try {
      const img = await ha.cameraImage(conn, cam.entityId);
      return reply.header("cache-control", "no-store").type(img.type.startsWith("image/") ? img.type : "image/jpeg").send(img.body);
    } catch (e) {
      return fail(reply, e, 502);
    }
  });

  app.post("/api/security/lock", async (req, reply) => {
    const body = z.object({ entityId: entity, op: z.enum(["lock", "unlock", "open"]), code: z.string().max(20).optional() }).safeParse(req.body);
    const lock = body.success ? inList(sec()?.locks, body.data.entityId) : undefined;
    if (!body.success || !lock) return fail(reply, new Error("Okänt lås"));
    // Unlocking from a wall anyone can touch is off unless the family turned it on.
    if (body.data.op !== "lock" && !sec()?.allowUnlock) return fail(reply, new Error("Upplåsning från tavlan är avstängd (Inställningar → Säkerhet)."), 403);
    return haCall(reply, lock.name, "lock", body.data.op, { entity_id: lock.entityId, ...(body.data.code ? { code: body.data.code } : {}) });
  });

  app.post("/api/security/alarm", async (req, reply) => {
    const body = z.object({ entityId: entity, mode: z.enum(["home", "away", "night", "vacation", "off"]), code: z.string().max(20).optional() }).safeParse(req.body);
    const alarm = body.success ? inList(sec()?.alarms, body.data.entityId) : undefined;
    if (!body.success || !alarm) return fail(reply, new Error("Okänt larm"));
    const c = alarmCall(body.data.mode);
    return haCall(reply, alarm.name, c.domain, c.service, { entity_id: alarm.entityId, ...(body.data.code ? { code: body.data.code } : {}) });
  });

  app.post("/api/security/cover", async (req, reply) => {
    const body = z.object({ entityId: entity, op: z.enum(["open", "close", "stop"]) }).safeParse(req.body);
    const cover = body.success ? inList(sec()?.covers, body.data.entityId) : undefined;
    if (!body.success || !cover) return fail(reply, new Error("Okänd port"));
    return haCall(reply, cover.name, "cover", `${body.data.op}_cover`, { entity_id: cover.entityId });
  });

  app.post("/api/robots", async (req, reply) => {
    const body = z.object({ entityId: entity, op: z.enum(["start", "pause", "dock"]) }).safeParse(req.body);
    const robot = body.success ? inList(loadConfig().entities.robots, body.data.entityId) : undefined;
    if (!body.success || !robot) return fail(reply, new Error("Okänd robot"));
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
    const st = await ha.state(conn, robot.entityId).catch(() => undefined);
    const c = robotCall(robot.entityId, body.data.op, Number(st?.attributes.supported_features ?? 0));
    return haCall(reply, robot.name, c.domain, c.service, { entity_id: robot.entityId });
  });

  // Spotify Connect: play a cover from the library on a device the Spotify account sees (any brand).
  app.post("/api/music/play-connect", async (req, reply) => {
    const body = z.object({ uri: z.string().max(300), type: z.enum(MEDIA_TYPES), title: label(80).optional(), device: z.string().min(1).max(80), shuffle: z.boolean().optional() }).safeParse(req.body);
    const uri = body.success ? spotifyUri(body.data.uri) : undefined;
    if (!body.success || !uri) return fail(reply, new Error("Bara Spotify kan spelas på en Spotify Connect-enhet"));
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
    const player = spotifyPlayer(new Map((await ha.states(conn)).map((s) => [s.entity_id, s])));
    const devices = ((player?.attributes as { source_list?: string[] } | undefined)?.source_list ?? []) as string[];
    if (!player || !devices.includes(body.data.device)) return fail(reply, new Error(`${body.data.device} syns inte i Spotify just nu – väck den (nätverksstandby) och försök igen.`));
    try {
      await ha.service(conn, "media_player", "select_source", { entity_id: player.entity_id, source: body.data.device });
      if (body.data.shuffle !== undefined) await ha.service(conn, "media_player", "shuffle_set", { entity_id: player.entity_id, shuffle: body.data.shuffle }).catch(() => undefined);
      const kind = uri.split(":")[1];
      await ha.service(conn, "media_player", "play_media", { entity_id: player.entity_id, media_content_id: uri, media_content_type: kind });
    } catch (e) {
      return fail(reply, new Error(`${body.data.device} kunde inte spela ${body.data.title ?? "det"}: ${(e as Error).message}`), 502);
    }
    invalidate("ha:states");
    return { ok: true };
  });

  // Settings: try a station before adding it (admin only, any http(s) stream, a known speaker).
  app.post("/api/music/try", { preHandler: guard }, async (req, reply) => {
    const body = z.object({ name: label(40), url: z.string().url().max(500).regex(/^https?:\/\//), speaker: entity }).safeParse(req.body);
    if (!body.success || !speakerOf(body.data.speaker)) return fail(reply, new Error("Välj en högtalare först"));
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
    const c = playCall(body.data.speaker, { name: body.data.name, url: body.data.url });
    try {
      await ha.service(conn, c.domain, c.service, c.data);
    } catch (e) {
      return fail(reply, new Error(`${speakerOf(body.data.speaker)!.name} kunde inte spela ${body.data.name}: ${(e as Error).message}`), 502);
    }
    return { ok: true };
  });

  app.get("/api/radio/search", { preHandler: guard }, async (req, reply) => {
    const { q } = (req.query ?? {}) as { q?: string };
    try {
      return { stations: await findStations(String(q ?? "")) };
    } catch (e) {
      return fail(reply, e, 502);
    }
  });

  // ---------- Auto-discovery from Home Assistant ----------
  app.get("/api/ha/discover", { preHandler: guard }, async (_req, reply) => {
    const conn = haConnection();
    if (!conn) return fail(reply, new Error("Anslut Home Assistant först."));
    try {
      return discover(await readRegistry(conn));
    } catch (e) {
      return fail(reply, new Error(`Kunde inte läsa Home Assistant: ${(e as Error).message}. Token behöver administratörsrättighet.`));
    }
  });

  // ---------- Car: all entities of the car's device, and its actions ----------
  const carDevice = async (index: number) => {
    const car = loadConfig().entities.cars[index];
    const conn = haConnection();
    if (!car || !conn) throw new Error(car ? "Home Assistant är inte anslutet." : "Okänd bil");
    const ents = await cached(`car:${index}`, 30_000, () => deviceEntities(conn, car.battery));
    return { car, ents, deviceName: ents[0]?.dn ?? car.name };
  };

  app.get("/api/car/:index", async (req, reply) => {
    try {
      const { car, ents, deviceName } = await carDevice(Number((req.params as { index: string }).index));
      const rows = carRows(ents, deviceName);
      return { name: car.name, valid: rows.filter((r) => r.ok).length, total: rows.length, rows, actions: carActions(ents, deviceName), charging: carCharging(ents, deviceName) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/car/:index/action", async (req, reply) => {
    const { entityId, action } = (req.body ?? {}) as { entityId?: string; action?: "on" | "off" | "press" };
    try {
      const { ents } = await carDevice(Number((req.params as { index: string }).index));
      if (!entityId || !ents.some((x) => x.e === entityId)) throw new Error("Entiteten hör inte till bilen.");
      await runEntityAction(entityId, action ?? "on");
      invalidate("car:");
      invalidate("ha:states");
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // Laddläge hos en smartstyrning (t.ex. Auto / Ladda nu / Pausa): samma överstyrning som smartstyrningens egen knapp, via Home Assistant.
  app.post("/api/car/:index/mode", async (req, reply) => {
    const { option } = (req.body ?? {}) as { option?: string };
    try {
      const car = loadConfig().entities.cars[Number((req.params as { index: string }).index)];
      const conn = haConnection();
      if (!car || !conn) throw new Error(car ? "Home Assistant är inte anslutet." : "Okänd bil");
      const states = new Map((await cached("ha:states", 5_000, () => ha.states(conn))).map((s) => [s.entity_id, s]));
      const sc = findSmartCharging(states, car.name, { plan: car.plan, mode: car.mode });
      if (!sc?.modeEntity) throw new Error("Bilen har ingen smart laddning med laddläge.");
      if (!option || !sc.options.includes(option)) throw new Error("Okänt laddläge.");
      const d = sc.modeEntity.startsWith("input_select.") ? "input_select" : "select";
      await ha.service(conn, d, "select_option", { entity_id: sc.modeEntity, option });
      invalidate("ha:states");
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // Ändra bilens laddschema (klar kl T med mål %, per veckodag). Skrivs som JSON i smartstyrningens kommandofält i Home Assistant; styrningen sparar det som sitt eget schema, så ändringen slår igenom hos den.
  app.post("/api/car/:index/schedule", async (req, reply) => {
    const b = (req.body ?? {}) as { day?: number; time?: string; soc?: number; enabled?: boolean };
    try {
      const car = loadConfig().entities.cars[Number((req.params as { index: string }).index)];
      const conn = haConnection();
      if (!car || !conn) throw new Error(car ? "Home Assistant är inte anslutet." : "Okänd bil");
      const day = Number(b.day);
      const soc = Number(b.soc);
      if (!Number.isInteger(day) || day < 0 || day > 6 || !/^\d{2}:\d{2}$/.test(String(b.time)) || !Number.isFinite(soc) || soc < 20 || soc > 100) throw new Error("Ogiltigt schema.");
      const states = new Map((await cached("ha:states", 5_000, () => ha.states(conn))).map((s) => [s.entity_id, s]));
      const sc = findSmartCharging(states, car.name, { plan: car.plan, mode: car.mode });
      if (!sc?.scheduleEntity || !sc.scheduleCar) throw new Error("Laddschemat går inte att ändra härifrån – smartstyrningen saknar kommandofält.");
      await ha.service(conn, "input_text", "set_value", { entity_id: sc.scheduleEntity, value: JSON.stringify({ car: sc.scheduleCar, day, time: b.time, soc: Math.round(soc), enabled: Boolean(b.enabled) }) });
      invalidate("ha:states");
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ---------- Generic controls on climate/device cards ----------
  app.post("/api/control", async (req, reply) => {
    const { entityId, op, value } = (req.body ?? {}) as { entityId?: string; op?: "toggle" | "select" | "set" | "press"; value?: string | number };
    const cfg = loadConfig();
    const allowed = new Set([
      ...(cfg.entities.climates ?? []).flatMap((c) => c.controls ?? []),
      ...(cfg.entities.deviceCards ?? []).flatMap((c) => c.controls),
    ]);
    const conn = haConnection();
    if (conn && entityId && op === "select" && !allowed.has(entityId)) {              // lägesväljare (Auto först) som tavlan hittat själv
      const st = new Map((await cached("ha:states", 5_000, () => ha.states(conn))).map((s) => [s.entity_id, s]));
      if (findAutoModes(st).some((m) => m.entityId === entityId)) allowed.add(entityId);
    }
    if (!entityId || !allowed.has(entityId)) return fail(reply, new Error("Okänt reglage"));
    if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
    const domain = entityId.split(".")[0];
    try {
      if (op === "select") {
        const d = domain === "input_select" ? "input_select" : "select";
        await ha.service(conn, d, "select_option", { entity_id: entityId, option: String(value) });
      } else if (op === "set") {
        const d = domain === "input_number" ? "input_number" : "number";
        await ha.service(conn, d, "set_value", { entity_id: entityId, value: Number(value) });
      } else if (op === "press") {
        await runEntityAction(entityId, "press");
      } else {
        await ha.service(conn, "homeassistant", "toggle", { entity_id: entityId });
      }
      invalidate("ha:states");
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ---------- Schedules (e.g. car preheat) – editable from the board ----------
  app.put("/api/schedules/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = scheduleSchema.safeParse({ ...(req.body as object), id });
    if (!parsed.success) return fail(reply, new Error("Ogiltigt schema"));
    const cfg = loadConfig();
    const s = parsed.data as Schedule;
    // Only entities already configured somewhere on the board may be scheduled.
    const known = new Set([
      ...cfg.entities.cars.flatMap((c) => (c.climate ? [c.climate] : [])),
      ...(cfg.entities.climates ?? []).flatMap((c) => [c.entityId, ...(c.controls ?? [])]),
      ...(cfg.entities.deviceCards ?? []).flatMap((c) => c.controls),
      ...(cfg.entities.buttons ?? []).map((b) => b.entityId),
      ...cfg.entities.lights.map((l) => l.entityId),
    ]);
    if (!known.has(s.entityId)) return fail(reply, new Error("Entiteten finns inte på tavlan."));
    cfg.schedules = [...(cfg.schedules ?? []).filter((x) => x.id !== id), s];
    saveConfig(cfg);
    return { ok: true, schedules: cfg.schedules };
  });

  app.delete("/api/schedules/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const cfg = loadConfig();
    cfg.schedules = (cfg.schedules ?? []).filter((x) => x.id !== id);
    saveConfig(cfg);
    return { ok: true };
  });

  app.post("/api/run", async (req, reply) => {
    // "Starta värme nu" etc. – same allow-list as schedules.
    const { entityId, action } = (req.body ?? {}) as { entityId?: string; action?: "on" | "off" | "press" };
    const cfg = loadConfig();
    const known = new Set([...cfg.entities.cars.flatMap((c) => (c.climate ? [c.climate] : [])), ...(cfg.schedules ?? []).map((s) => s.entityId)]);
    if (!entityId || !known.has(entityId)) return fail(reply, new Error("Okänd enhet"));
    try {
      await runEntityAction(entityId, action ?? "on");
      invalidate("ha:states");
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ---------- Photo frame ----------
  app.get("/api/photos", async () => listPhotos());

  app.get("/api/photos/:name", async (req, reply) => {
    const p = photoPath((req.params as { name: string }).name);
    if (!p) return reply.code(404).send({ error: "Hittades inte" });
    const ext = p.split(".").pop()!.toLowerCase();
    reply.header("cache-control", "public, max-age=86400");
    reply.type(ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
    return reply.send(readFileSync(p));
  });

  // Upload as base64 JSON (the wizard downsizes images in the browser first).
  app.post("/api/photos", { preHandler: guard, bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    const { data, type } = (req.body ?? {}) as { data?: string; type?: string };
    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    if (!data) return fail(reply, new Error("Ingen bild"));
    const buf = Buffer.from(data.replace(/^data:[^,]+,/, ""), "base64");
    if (buf.length > 8 * 1024 * 1024) return fail(reply, new Error("Bilden är för stor"));
    const name = `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
    savePhoto(name, buf);
    return { ok: true, name, photos: listPhotos() };
  });

  app.delete("/api/photos/:name", { preHandler: guard }, async (req) => {
    deletePhoto((req.params as { name: string }).name);
    return { ok: true, photos: listPhotos() };
  });

  app.post("/api/lights/group", async (req, reply) => {
    const { index, on } = (req.body ?? {}) as { index?: number; on?: boolean };
    const group = loadConfig().entities.lightGroups?.[Number(index)];
    const conn = haConnection();
    if (!group || !conn) return fail(reply, new Error(group ? "Home Assistant är inte anslutet." : "Okänd grupp"));
    if (group.entities.length) {
      await ha.service(conn, "homeassistant", on ? "turn_on" : "turn_off", { entity_id: group.entities });
    }
    invalidate("ha:states");
    return { ok: true };
  });

  app.post("/api/button", async (req, reply) => {
    const { entityId } = (req.body ?? {}) as { entityId?: string };
    const btn = loadConfig().entities.buttons?.find((b) => b.entityId === entityId);
    const conn = haConnection();
    if (!btn || !conn) return fail(reply, new Error(btn ? "Home Assistant är inte anslutet." : "Okänd knapp"));
    const domain = btn.entityId.split(".")[0];
    const service = domain === "button" || domain === "input_button" ? "press" : domain === "automation" ? "trigger" : "turn_on";
    await ha.service(conn, domain, service, { entity_id: btn.entityId });
    invalidate("ha:states");
    return { ok: true };
  });

  app.post("/api/climate/mode", async (req, reply) => {
    const { entityId, field, value } = (req.body ?? {}) as { entityId?: string; field?: string; value?: string };
    const known = loadConfig().entities.climates?.some((c) => c.entityId === entityId);
    const conn = haConnection();
    if (!known || !conn || !entityId || !value) return fail(reply, new Error("Okänd enhet"));
    if (field === "operation_mode") await ha.service(conn, "water_heater", "set_operation_mode", { entity_id: entityId, operation_mode: value });
    else if (field === "preset_mode") await ha.service(conn, "climate", "set_preset_mode", { entity_id: entityId, preset_mode: value });
    else await ha.service(conn, "climate", "set_hvac_mode", { entity_id: entityId, hvac_mode: value });
    invalidate("ha:states");
    return { ok: true };
  });

  app.post("/api/climate/target", async (req, reply) => {
    const { entityId, temperature } = (req.body ?? {}) as { entityId?: string; temperature?: number };
    const known = loadConfig().entities.climates?.some((c) => c.entityId === entityId);
    const conn = haConnection();
    if (!known || !conn || !entityId || !Number.isFinite(temperature)) return fail(reply, new Error("Okänd enhet"));
    const domain = entityId.startsWith("water_heater.") ? "water_heater" : "climate";
    await ha.service(conn, domain, "set_temperature", { entity_id: entityId, temperature });
    invalidate("ha:states");
    return { ok: true };
  });

  app.get("/api/graph/:index", async (req, reply) => {
    const g = loadConfig().entities.graphs?.[Number((req.params as { index: string }).index)];
    const conn = haConnection();
    if (!g || !conn) return fail(reply, new Error(g ? "Home Assistant är inte anslutet." : "Okänd graf"));
    const to = new Date();
    const from = new Date(to.getTime() - 24 * 3_600_000);
    try {
      const data = await cached(`graph:${(req.params as { index: string }).index}:${Math.floor(to.getTime() / 300_000)}`, 300_000, () =>
        ha.history(conn, g.series.map((s) => s.entityId), from, to, 30),
      );
      return {
        title: g.title,
        from: from.toISOString(),
        to: to.toISOString(),
        series: g.series.map((s) => ({ name: s.name, color: s.color, points: data[s.entityId] ?? [] })),
      };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post("/api/shopping/add", async (req, reply) => {
    const { name, offer } = (req.body ?? {}) as { name?: string; offer?: { store?: string; id?: string } };
    const clean = name?.trim().slice(0, 80);
    if (!clean) return fail(reply, new Error("Skriv en vara."));
    const cfg = loadConfig();
    if (cfg.shopping.source === "ha" && cfg.shopping.entityId) {
      const conn = haConnection();
      if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
      await ha.service(conn, "todo", "add_item", { entity_id: cfg.shopping.entityId, item: clean });
      invalidate("todo:");
    } else {
      const list = loadLocalList();
      list.push({ id: Math.random().toString(36).slice(2, 10), name: clean, done: false, ...(offer?.store && offer.id ? { offer: { store: String(offer.store).slice(0, 40), id: String(offer.id).slice(0, 80) } } : {}) });
      saveLocalList(list);
    }
    return { ok: true };
  });

  app.post("/api/shopping/toggle", async (req, reply) => {
    const { id, done } = (req.body ?? {}) as { id?: string; done?: boolean };
    if (!id) return fail(reply, new Error("Saknar id"));
    const cfg = loadConfig();
    if (cfg.shopping.source === "ha" && cfg.shopping.entityId) {
      const conn = haConnection();
      if (!conn) return fail(reply, new Error("Home Assistant är inte anslutet."));
      await ha.service(conn, "todo", "update_item", { entity_id: cfg.shopping.entityId, item: id, status: done ? "completed" : "needs_action" });
      invalidate("todo:");
    } else {
      saveLocalList(loadLocalList().map((i) => (i.id === id ? { ...i, done: Boolean(done) } : i)));
    }
    return { ok: true };
  });

  // Veckans mat: tonight's (or any day's) dinner, from the board.
  app.post("/api/dinner", async (req, reply) => {
    const body = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), text: z.string().max(80), shopping: z.string().max(200).optional() }).safeParse(req.body);
    if (!body.success) return fail(reply, new Error("Ogiltig middag"));
    saveDinner(body.data.day, body.data.text, new Date(), body.data.shopping);
    return { ok: true };
  });

  // "Saknas på hyllan" for a child on förskola/fritids, from the board.
  app.post("/api/shelf", async (req, reply) => {
    const body = z.object({ personId: z.string().regex(ID), items: z.array(z.string().max(30)).max(10) }).safeParse(req.body);
    if (!body.success || !loadConfig().people.some((p) => p.id === body.data.personId && p.care)) return fail(reply, new Error("Okänt barn"));
    saveShelf(body.data.personId, body.data.items);
    return { ok: true };
  });

  // ---------- Sysslor: bocka av på tavlan (alla), ändra listan (PIN) ----------
  app.post("/api/chores/toggle", async (req, reply) => {
    const body = z.object({ id: z.string().max(40), done: z.boolean() }).safeParse(req.body);
    if (!body.success) return fail(reply, new Error("Ogiltigt"));
    if (!setChoreDone(body.data.id, dayKey(new Date()), body.data.done)) return fail(reply, new Error("Okänd syssla"));
    invalidate("ha:states");
    return { ok: true };
  });
  app.get("/api/chores", async () => ({ chores: loadChores() }));
  app.put("/api/chores", { preHandler: guard }, async (req, reply) => {
    const body = z.object({ chores: z.array(z.object({ id: z.string().regex(ID), personId: z.string().regex(ID), title: z.string().min(1).max(40), days: z.array(z.number().int().min(1).max(7)).max(7) })).max(80) }).safeParse(req.body);
    if (!body.success) return fail(reply, new Error("Ogiltig lista"));
    const kids = new Set(loadConfig().people.filter((p) => p.kind === "child").map((p) => p.id));
    if (body.data.chores.some((c) => !kids.has(c.personId))) return fail(reply, new Error("Sysslor kan bara läggas på barn."));
    saveChores(body.data.chores);
    return { ok: true };
  });

  // ---------- Backup ----------
  // Download a backup (passwords only with a backup password, then encrypted), and restore one.
  app.post("/api/backup", { preHandler: guard }, async (req, reply) => {
    const body = z.object({ password: z.string().max(200).optional() }).safeParse(req.body ?? {});
    if (!body.success) return fail(reply, new Error("Ogiltigt"));
    return makeBackup(body.data.password || undefined);
  });
  app.post("/api/restore", { preHandler: guard, bodyLimit: 5 * 1024 * 1024 }, async (req, reply) => {
    const body = z.object({ backup: z.unknown(), password: z.string().max(200).optional() }).safeParse(req.body);
    if (!body.success) return fail(reply, new Error("Ogiltigt"));
    // The settings in the file go through the same check as a normal save.
    const raw = body.data.backup as { config?: unknown } | null;
    const parsed = configSchema.safeParse(raw?.config);
    if (raw && typeof raw === "object" && raw.config && !parsed.success) return fail(reply, new Error("Inställningarna i säkerhetskopian gick inte att läsa."));
    try {
      const r = restoreBackup(parsed.success ? { ...raw, config: parsed.data } : raw, body.data.password || undefined);
      invalidate("");
      watchSet = watched();
      haSocket()?.start(haConnection());
      return { ok: true, secrets: r.secrets };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // Sjuk/VAB: strike a child's förskola, school and activities that day, and tell the grown-ups.
  app.post("/api/sick", async (req, reply) => {
    const body = z.object({ personId: z.string().regex(ID), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), sick: z.boolean() }).safeParse(req.body);
    const cfg = loadConfig();
    const child = body.success ? cfg.people.find((p) => p.id === body.data.personId && p.kind === "child") : undefined;
    if (!body.success || !child) return fail(reply, new Error("Okänt barn"));
    setSick(child.id, body.data.date, body.data.sick);
    const today = dayKey(new Date());
    const tomorrow = dayKey(addDays(new Date(), 1));
    const conn = haConnection();
    if (body.data.sick && conn && (body.data.date === today || body.data.date === tomorrow)) {
      const when = body.data.date === today ? "idag" : "imorgon";
      for (const a of cfg.people.filter((p) => p.kind === "adult" && p.notify?.service && follows(p, child.id))) {
        await ha
          .service(conn, "notify", a.notify!.service!, { title: "Sjuk", message: `${child.name} är sjuk ${when} – förskola, skola och aktiviteter är strukna på tavlan.` })
          .catch(() => {});
      }
    }
    return { ok: true };
  });

  // ---------- School news and own events ----------
  app.post("/api/news/seen", async (req, reply) => {
    const body = z.object({ ids: z.array(z.string().min(1).max(80)).min(1).max(50) }).safeParse(req.body);
    if (!body.success) return fail(reply, new Error("Ogiltigt"));
    markNewsSeen(body.data.ids);
    return { ok: true };
  });

  // An attachment of a news item, fetched with the integration's own login. Only addresses that
  // were in the latest news are allowed, so the board cannot be used to fetch anything else.
  app.get("/api/school/file", async (req, reply) => {
    const u = String((req.query as { u?: string }).u ?? "");
    const integId = newsFiles.get(u);
    const integ = integId ? loadConfig().integrations.find((i) => i.id === integId) : undefined;
    if (!integ || integ.provider !== "vklass") return reply.code(404).send({ error: "Hittades inte" });
    try {
      const ctx = makeCtx(integ);
      const session = await cached(`vklass-session:${integ.id}`, 15 * 60_000, () => vklassLogin(ctx.str("username"), ctx.secret("password")!));
      const res = await vklassFile(session, u);
      if (!res.ok) throw new Error(`Vklass svarade ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 20 * 1024 * 1024) throw new Error("Filen är för stor");
      const type = res.headers.get("content-type") ?? "application/octet-stream";
      reply.header("cache-control", "private, max-age=3600");
      const disp = res.headers.get("content-disposition");
      if (disp) reply.header("content-disposition", disp.replace(/^attachment/i, "inline"));
      reply.type(type);
      return reply.send(buf);
    } catch (e) {
      invalidate(`vklass-session:${integ.id}`);
      return fail(reply, e);
    }
  });

  const ownEventSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    title: z.string().trim().min(1).max(80),
    personId: z.string().regex(ID).optional(),
    note: z.string().max(500).optional(),
  });
  // "Utgår": hide one occurrence on the board (the family's calendar itself is not changed).
  app.post("/api/events/cancel", async (req, reply) => {
    const body = z.object({ key: z.string().min(3).max(400), on: z.boolean() }).safeParse(req.body);
    if (!body.success) return fail(reply, new Error("Okänd händelse"));
    const today = new Date().toISOString().slice(0, 10);
    const old = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    // Old ones are forgotten after a month so the list never grows.
    const next = Object.fromEntries(Object.entries(loadLocal().cancelled ?? {}).filter(([, d]) => d >= old));
    if (body.data.on) next[body.data.key] = today;
    else delete next[body.data.key];
    saveLocal({ cancelled: next });
    invalidate("dashboard");
    return { ok: true };
  });

  app.post("/api/own-events", async (req, reply) => {
    const body = ownEventSchema.safeParse(req.body);
    if (!body.success) return fail(reply, new Error("Fyll i dag och vad det gäller."));
    if (body.data.personId && !loadConfig().people.some((p) => p.id === body.data.personId)) return fail(reply, new Error("Okänd person"));
    return addOwnEvent(body.data);
  });
  app.delete("/api/own-events/:id", async (req) => {
    removeOwnEvent((req.params as { id: string }).id);
    return { ok: true };
  });

  // Dit/hem for a child's activity: this occurrence, or (forCalendar) the default for the whole calendar.
  app.post("/api/travel", async (req, reply) => {
    const body = z
      .object({ key: z.string().min(3).max(200), choice: travelChoiceSchema.nullable(), forCalendar: z.boolean().optional() })
      .safeParse(req.body);
    if (!body.success) return fail(reply, new Error("Ogiltigt val"));
    const { key, choice, forCalendar } = body.data;
    if (forCalendar) {
      const calId = key.slice(0, key.indexOf("@"));
      const cfg = loadConfig();
      if (calId.startsWith("care:")) {
        // Förskola: the default lives on the child.
        const child = cfg.people.find((p) => p.id === calId.slice(5));
        if (!child?.care) return fail(reply, new Error("Hittar inte barnets omsorgstider"));
        child.care.travel = choice ?? undefined;
        saveConfig(cfg);
        saveTravel(key, null);
        return { ok: true };
      }
      const cal = cfg.calendars.find((c) => c.id === calId);
      if (!cal) return fail(reply, new Error("Hittar inte kalendern"));
      cal.travel = choice ?? undefined;
      saveConfig(cfg);
      saveTravel(key, null); // the event now follows the calendar
    } else {
      saveTravel(key, choice);
    }
    return { ok: true };
  });

  app.post("/api/shopping/clear-done", async () => {
    const cfg = loadConfig();
    if (cfg.shopping.source === "ha" && cfg.shopping.entityId) {
      const conn = haConnection();
      if (conn) await ha.service(conn, "todo", "remove_completed_items", { entity_id: cfg.shopping.entityId });
      invalidate("todo:");
    } else {
      saveLocalList(loadLocalList().filter((i) => !i.done));
    }
    return { ok: true };
  });
}

/** "people.1.name String must contain…" → "Person 2 saknar namn." */
function readableIssue(path: (string | number)[], message: string): string {
  const [area, i, field] = path;
  const n = typeof i === "number" ? i + 1 : undefined;
  const what: Record<string, string> = { people: "Person", calendars: "Kalender", integrations: "Koppling", schedules: "Schema" };
  if (typeof area === "string" && what[area] && n) {
    if (field === "name") return `${what[area]} ${n} saknar namn.`;
    return `${what[area]} ${n}: något är inte rätt ifyllt (${path.slice(2).join(".")}).`;
  }
  return `Något är inte rätt ifyllt (${path.join(".") || "inställningar"}: ${message}).`;
}
