import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, writeSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { HOME_WIDGETS, TAB_IDS, type Config, type SecretKey } from "./types.js";

/**
 * All state lives in one data directory (/data in the add-on, ./data in dev):
 *   config.json  – non-secret settings, safe to back up and inspect
 *   secrets.json – passwords, tokens and private calendar URLs, AES-256-GCM encrypted
 *   secret.key   – the encryption key, created on first start (chmod 600)
 *   local.json   – the built-in shopping list (when Home Assistant's is not used) and travel choices
 */
export const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");

const CONFIG_FILE = join(DATA_DIR, "config.json");
const SECRETS_FILE = join(DATA_DIR, "secrets.json");
const KEY_FILE = join(DATA_DIR, "secret.key");
const LOCAL_FILE = join(DATA_DIR, "local.json");
const DEVICES_FILE = join(DATA_DIR, "devices.json");

export function defaultConfig(): Config {
  return {
    version: 1,
    setupComplete: false,
    household: { name: "Familjen" },
    people: [],
    calendars: [],
    integrations: [{ id: "price", category: "price", provider: "spot", settings: { area: "SE3" } }],
    shopping: { source: "local", mappings: {} },
    electricity: { cheapHours: 4, markupOre: 0, gridOre: 0, taxOre: 0, vat: false },
    ha: { mode: process.env.SUPERVISOR_TOKEN ? "supervisor" : "none" },
    schedules: [],
    entities: { cars: [], energy: {}, lights: [], temps: [], lightGroups: [], buttons: [], climates: [], deviceCards: [], graphs: [] },
    dashboard: {
      accent: "#34e0a1",
      theme: "auto",
      home: HOME_WIDGETS.map((id) => ({ id, on: !["temps", "energy", "climates", "chores"].includes(id) })),
      tabs: TAB_IDS.map((id) => ({ id, on: true })),
      nightFrom: "22:00",
      nightTo: "06:00",
      idleMinutes: 10,
    },
  };
}

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/** Write to a temp file, flush it to disk, then rename – a power cut leaves the old or the new file, never half. */
function writeAtomic(file: string, data: string, mode?: number) {
  ensureDir();
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, "w", mode ?? 0o644);
  try {
    writeSync(fd, data, null, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (mode !== undefined) chmodSync(tmp, mode);
  renameSync(tmp, file);
}

/**
 * Missing file → fallback. A file that can't be read as the expected shape is kept aside as
 * <file>.corrupt-<time> (so nothing is lost when the next save overwrites it) and the fallback used.
 */
function readJson<T>(file: string, fallback: T, isValid: (v: unknown) => boolean = () => true): T {
  if (!existsSync(file)) return fallback;
  let raw = "";
  try {
    raw = readFileSync(file, "utf8");
    const v: unknown = JSON.parse(raw);
    if (isValid(v)) return v as T;
  } catch {
    /* handled below */
  }
  if (raw.trim() === "") return fallback;
  const aside = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    copyFileSync(file, aside);
  } catch {
    /* read-only fs */
  }
  console.error(`Familjetavla: kunde inte läsa ${file} – sparade en kopia som ${aside} och startar med standardvärden.`);
  return fallback;
}

const isObject = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);

// ---------- Config ----------

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  const stored = readJson<Partial<Config>>(CONFIG_FILE, {}, isObject);
  // Shallow-merge onto defaults so new fields in later versions get sane values.
  const base = defaultConfig();
  cached = {
    ...base,
    ...stored,
    household: { ...base.household, ...stored.household },
    shopping: { ...base.shopping, ...stored.shopping },
    electricity: { ...base.electricity, ...stored.electricity },
    ha: { ...base.ha, ...stored.ha },
    entities: { ...base.entities, ...stored.entities },
    dashboard: { ...base.dashboard, ...stored.dashboard },
  } as Config;
  // Widgets/tabs added in later versions are appended (off for widgets, on for tabs).
  const d = cached.dashboard;
  if (!Array.isArray(d.home)) d.home = [];
  if (!Array.isArray(d.tabs)) d.tabs = [];
  for (const k of ["people", "calendars", "integrations", "schedules"] as const) {
    if (!Array.isArray(cached[k])) (cached as unknown as Record<string, unknown[]>)[k] = [];
  }
  // "now" (the big Nu-zon) is the headline of the 2026 layout, so it goes first and on.
  if (!d.home.some((w) => w.id === "now")) d.home.unshift({ id: "now", on: true });
  // "Maten" (school lunch and tonight's dinner) is what the kids look for: on, and first under the Nu zone.
  if (!d.home.some((w) => w.id === "meals")) {
    const at = d.home.findIndex((w) => w.id === "reminders");
    d.home.splice(at >= 0 ? at : d.home.length, 0, { id: "meals", on: true });
  }
  // "Skolan idag" (when the school day ends) sits next to Maten; it hides itself without a schedule.
  if (!d.home.some((w) => w.id === "schoolday")) {
    const at = d.home.findIndex((w) => w.id === "meals");
    d.home.splice(at >= 0 ? at + 1 : d.home.length, 0, { id: "schoolday", on: true });
  }
  for (const id of HOME_WIDGETS) if (!d.home.some((w) => w.id === id)) d.home.push({ id, on: false });
  for (const id of TAB_IDS) if (!d.tabs.some((t) => t.id === id)) (id === "food" ? d.tabs.unshift.bind(d.tabs) : d.tabs.push.bind(d.tabs))({ id, on: true });
  return cached;
}

export function saveConfig(config: Config) {
  cached = config;
  // One step back, in case a save goes wrong: config.json.bak
  try {
    if (existsSync(CONFIG_FILE)) copyFileSync(CONFIG_FILE, `${CONFIG_FILE}.bak`);
  } catch {
    /* ignore */
  }
  writeAtomic(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ---------- Secrets ----------

let keyCache: Buffer | null = null;

function key(): Buffer {
  if (keyCache) return keyCache;
  ensureDir();
  if (!existsSync(KEY_FILE)) {
    // A new key would make every saved secret (including the PIN) unreadable – refuse instead.
    const saved = readJson<Record<string, string>>(SECRETS_FILE, {}, isObject);
    if (Object.keys(saved).length) {
      throw new Error(`secret.key saknas men secrets.json finns i ${DATA_DIR}. Återställ secret.key från backup, eller ta bort secrets.json och fyll i lösenorden igen.`);
    }
    writeAtomic(KEY_FILE, randomBytes(32).toString("base64"), 0o600);
  }
  try {
    chmodSync(KEY_FILE, 0o600);
  } catch {
    /* read-only fs: ignore */
  }
  const k = Buffer.from(readFileSync(KEY_FILE, "utf8").trim(), "base64");
  if (k.length !== 32) throw new Error(`secret.key i ${DATA_DIR} är skadad (fel längd).`);
  keyCache = k;
  return k;
}

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

function decrypt(blob: string): string {
  const [iv, tag, enc] = blob.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

function secretsFile(): Record<string, string> {
  return readJson<Record<string, string>>(SECRETS_FILE, {}, isObject);
}

export function getSecret(k: SecretKey): string | undefined {
  const blob = secretsFile()[k];
  if (!blob) return undefined;
  try {
    return decrypt(blob);
  } catch {
    return undefined;
  }
}

export function setSecret(k: SecretKey, value: string | null) {
  const all = secretsFile();
  if (value === null || value === "") delete all[k];
  else all[k] = encrypt(value);
  writeAtomic(SECRETS_FILE, JSON.stringify(all, null, 2), 0o600);
}

export function listSecretKeys(): string[] {
  return Object.keys(secretsFile());
}

// ---------- Local shopping list ----------

export interface LocalItem {
  id: string;
  name: string;
  done: boolean;
  /** Gjord av ett erbjudande: butikens kopplings-id och erbjudandets id (så ICA visar priset på raden). */
  offer?: { store: string; id: string };
}

export interface LocalFile {
  shopping?: LocalItem[];
  /** Varor som skickats till en butik: radens namn (gemener) → butiken och när (för märket i inköpslistan). */
  sentToStore?: Record<string, { store: string; at: string }>;
  /** Veckans middagar: YYYY-MM-DD → "Tacos". */
  dinners?: Record<string, string>;
  /** Hur ofta en middag valts (för favoriter) och vad man brukar handla till den. */
  dinnerStats?: Record<string, { count: number; shopping?: string; last: string }>;
  /** Händelser som utgår (bara på tavlan): travelKey → dagen (YYYY-MM-DD), för att rensa gamla. */
  cancelled?: Record<string, string>;
  /** Musik: the volume last chosen on the board per speaker (0–100), used again when music starts there. */
  volumes?: Record<string, number>;
  /** "Saknas på hyllan" per barn: ["Blöjor", "Extrakläder"]. */
  shelf?: Record<string, string[]>;
  /** Sysslor barnen ska göra (se chores.ts) och vilka som är avbockade per dag (YYYY-MM-DD → id:n). */
  chores?: import("./chores.js").Chore[];
  choreDone?: Record<string, string[]>;
  /** Senaste version som vi meddelat om (så att samma version bara ger en notis). */
  updateNotified?: string;
  /** Dit/hem-val per händelse, nyckel = travelKey(). */
  travel?: Record<string, import("./types.js").TravelChoice>;
  /** Andra som skjutsar ("Marina", "Ola"), senast använd först – snabbval i Planera veckan. */
  drivers?: string[];
  /** Skolnyheter som någon har läst (id). */
  newsSeen?: string[];
  /** Egna händelser, t.ex. från en skolnyhet: "Workshop på biblioteket" tis 26/10 14:30. */
  ownEvents?: OwnEvent[];
  /** Sjuk/VAB per barn: dagar (YYYY-MM-DD) då förskola, skola och aktiviteter stryks. */
  sick?: Record<string, string[]>;
}

export interface OwnEvent {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** "14:30", saknas = heldag. */
  time?: string;
  /** "16:30" */
  end?: string;
  title: string;
  personId?: string;
  note?: string;
}

export function loadLocal(): LocalFile {
  return readJson<LocalFile>(LOCAL_FILE, {}, isObject);
}

/** Merge into local.json so the shopping list and travel choices never overwrite each other. */
export function saveLocal(part: LocalFile) {
  writeAtomic(LOCAL_FILE, JSON.stringify({ ...loadLocal(), ...part }, null, 2));
}

export function loadLocalList(): LocalItem[] {
  return loadLocal().shopping ?? [];
}

export function saveLocalList(items: LocalItem[]) {
  saveLocal({ shopping: items });
}

// ---------- Photo frame ----------

export const PHOTO_DIR = join(DATA_DIR, "photos");
const PHOTO_NAME = /^[a-z0-9-]{1,40}\.(jpe?g|png|webp)$/i;

export function listPhotos(): string[] {
  try {
    return readdirSync(PHOTO_DIR).filter((f) => PHOTO_NAME.test(f)).sort();
  } catch {
    return [];
  }
}

export function savePhoto(name: string, data: Buffer) {
  if (!PHOTO_NAME.test(name)) throw new Error("Ogiltigt filnamn");
  if (!existsSync(PHOTO_DIR)) mkdirSync(PHOTO_DIR, { recursive: true });
  writeFileSync(join(PHOTO_DIR, name), data);
}

export function deletePhoto(name: string) {
  if (!PHOTO_NAME.test(name)) throw new Error("Ogiltigt filnamn");
  try {
    unlinkSync(join(PHOTO_DIR, name));
  } catch {
    /* already gone */
  }
}

export function photoPath(name: string): string | null {
  if (!PHOTO_NAME.test(name)) return null;
  const p = join(PHOTO_DIR, name);
  return existsSync(p) ? p : null;
}

// ---------- Paired screens ----------

/** Screens that unlocked the board with the PIN once. Only SHA-256 hashes of their tokens are stored. */
export interface PairedDevice {
  hash: string;
  name: string;
  created: string;
}

export function loadDevices(): PairedDevice[] {
  return readJson<PairedDevice[]>(DEVICES_FILE, [], Array.isArray);
}

export function saveDevices(list: PairedDevice[]) {
  writeAtomic(DEVICES_FILE, JSON.stringify(list, null, 2), 0o600);
}

// ---------- Backup ----------

/** All secrets in plain text – only for an encrypted backup file. */
export function exportSecrets(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(secretsFile())) {
    const v = getSecret(k as SecretKey);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Restore what a backup holds: settings, local lists and (when given) secrets. */
export function importBackup(config: Config, local: LocalFile, secrets?: Record<string, string>) {
  saveConfig(config);
  writeAtomic(LOCAL_FILE, JSON.stringify(local, null, 2));
  if (secrets) for (const [k, v] of Object.entries(secrets)) setSecret(k as SecretKey, v);
  cached = null;
}
