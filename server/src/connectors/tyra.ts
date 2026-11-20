import { fetchWithTimeout, HttpError } from "../http.js";
import type { CalEvent } from "./ics.js";

/**
 * Tyra (förskola, fritids) through the same Parse Server API as Tyra's own web app at
 * web.tyra.io (unofficial). The server address and the app's public keys are the ones
 * the web app ships in its env-config.js; they identify the app, not the family.
 * Not verified against a real account yet, so every answer is read defensively.
 */
const SERVER = "https://parse.se.tyra.app";
const APP_ID = "ydRCutPl8nhiTSRlam0gT5SEqFtuW6N2";
const JS_KEY = "EkyBfKUqQN8j17ePBmYssFXsAdxNEcIE";
/** user_roles.status for an accepted role (the web app's own filter). */
const ACTIVE = 40;
/** Tyra's loginMethod for a mobile number. */
const PHONE = 30;

export interface TyraKid {
  id: string;
  name: string;
  roleId: string;
  schoolId: string;
}

export interface TyraEvent {
  eventDate?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  topic?: string;
  title?: string;
  content?: string;
  eventTimeId?: string;
  eventGroupInfoId?: string;
  location?: string | { name?: string };
}

type ParseDate = string | { __type?: string; iso?: string } | null | undefined;

async function call<T>(path: string, body: unknown, session?: string, method = "POST"): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-parse-application-id": APP_ID,
    "x-parse-javascript-key": JS_KEY,
  };
  if (session) headers["x-parse-session-token"] = session;
  const res = await fetchWithTimeout(`${SERVER}/${path}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
  const data = (await res.json().catch(() => ({}))) as { result?: T; error?: string; code?: number } & T;
  if (!res.ok) {
    // 209: the saved session has ended (logged out in the app, or expired).
    if (data.code === 209) throw new HttpError(401, "Tyra-sessionen har gått ut.");
    if (res.status === 401 || res.status === 403) throw new HttpError(res.status, "Tyra godkände inte inloggningen.");
    throw new HttpError(res.status, `Tyra svarade ${res.status}${data.error ? `: ${data.error}` : ""}`);
  }
  return data as T;
}

const fn = async <T>(name: string, params: Record<string, unknown>, session?: string) => (await call<{ result?: T }>(`functions/${name}`, params, session)).result as T;

/**
 * "070-123 45 67", "0701234567" or "+46 70 123 45 67" → "+46701234567", the way Tyra's login
 * form sends a Swedish mobile number (country code, no leading zero).
 */
export function tyraPhone(input: string): string {
  let s = input.replace(/[\s\-()]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (s.startsWith("0")) s = `+46${s.slice(1)}`;
  if (/^46\d{8,}$/.test(s)) s = `+${s}`;
  if (s.startsWith("+460")) s = `+46${s.slice(4)}`;
  if (!/^\+\d{8,15}$/.test(s)) throw new Error("Skriv mobilnumret du loggar in i Tyra med, till exempel 070-123 45 67.");
  return s;
}

/** Log in with mobile number and password, as Tyra's web app does. Returns a session token. */
export async function tyraLogin(phoneInput: string, password: string): Promise<string> {
  const username = tyraPhone(phoneInput);
  const start = await fn<{ loginSessionId?: string; action?: string; otherLoginMethod?: number; noUser?: boolean }>("initiateLoginSession", {
    username,
    loginMethod: PHONE,
    clientType: "web",
  });
  if (start?.noUser || start?.otherLoginMethod === 0) throw new Error("Tyra hittar inget konto med det mobilnumret.");
  if (start?.action === "otherloginmethod") throw new Error("Kontot loggar in på annat sätt än mobilnummer och lösenord i Tyra (BankID eller e-post).");
  if (start?.action === "bankid") throw new Error("Kontot loggar bara in med BankID i Tyra. Tavlan behöver mobilnummer och lösenord.");
  if (start?.action === "verify") throw new Error("Tyra vill skicka en sms-kod för att logga in. Det kan tavlan inte ta emot än – berätta gärna i ärende #28 på GitHub.");
  if (start?.action === "become") throw new Error("Tyra loggade in utan lösenord, vilket tavlan inte kan hantera än.");
  if (!start?.loginSessionId) throw new Error("Tyra svarade inte som väntat på inloggningen.");
  const done = await fn<{ action?: string; parseSessionId?: string; retry?: boolean }>("pollLoginSession", {
    loginSessionId: start.loginSessionId,
    password,
    clientAction: "password",
    thisDevice: false,
  });
  if (done?.retry) throw new Error("Fel lösenord för Tyra.");
  if (done?.action === "multiWeb") throw new Error("Tyra säger att kontot är ett skolkonto som inte kan logga in på webben.");
  if (done?.action !== "become" || !done.parseSessionId) throw new Error("Tyra gav ingen inloggning. Kolla mobilnummer och lösenord.");
  return done.parseSessionId;
}

/** The account behind a session, or undefined when the session no longer works. */
export async function tyraMe(session: string): Promise<string | undefined> {
  try {
    const me = await call<{ objectId?: string }>("users/me", undefined, session, "GET");
    return me.objectId;
  } catch (e) {
    if ((e as HttpError).status === 401 || (e as HttpError).status === 403) return undefined;
    throw e;
  }
}

const pointer = (className: string, objectId: string) => ({ __type: "Pointer", className, objectId });

async function query<T>(className: string, where: Record<string, unknown>, session: string, include: string[] = []) {
  const qs = new URLSearchParams({ where: JSON.stringify(where), limit: "100" });
  if (include.length) qs.set("include", include.join(","));
  return (await call<{ results?: T[] }>(`classes/${className}?${qs}`, undefined, session, "GET")).results ?? [];
}

/** The children on the account: one active guardian role per child and preschool. */
export async function tyraKids(session: string, userId: string): Promise<TyraKid[]> {
  type Role = { objectId: string; kid?: { objectId?: string; kidName?: string; firstName?: string; lastName?: string }; school_pointer?: { objectId?: string } };
  const roles = await query<Role>("user_roles", { user: pointer("_User", userId), status: ACTIVE }, session, ["kid", "school_pointer"]);
  const kids: TyraKid[] = [];
  for (const r of roles) {
    const k = r.kid;
    if (!k?.objectId || !r.school_pointer?.objectId) continue; // staff role, or no child
    if (kids.some((x) => x.id === k.objectId)) continue;
    const name = (k.kidName || [k.firstName, k.lastName].filter(Boolean).join(" ")).trim() || "Barnet i Tyra";
    kids.push({ id: k.objectId, name, roleId: r.objectId, schoolId: r.school_pointer.objectId });
  }
  return kids;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The calendar of the child's preschool (Tyra's "Händelser"), as the web app fetches it. */
export async function tyraEvents(session: string, kid: TyraKid, from: Date, to: Date): Promise<TyraEvent[]> {
  const res = await fn<{ events?: TyraEvent[] } | TyraEvent[]>(
    "getEvents3",
    { schoolId: kid.schoolId, userRoleId: kid.roleId, dateStart: ymd(from), dateEnd: ymd(to), includeBookings: false },
    session,
  );
  return Array.isArray(res) ? res : (res?.events ?? []);
}

const HHMM = /^(\d{1,2})[:.](\d{2})/;

/** One Tyra event as a calendar event: a time when it has one, otherwise the whole day. */
export function tyraToEvent(e: TyraEvent): CalEvent | undefined {
  const title = (e.topic || e.title || "").trim();
  const m = (e.eventDate || e.date || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!title || !m) return undefined;
  const day = new Date(+m[1], +m[2] - 1, +m[3]);
  const s = e.startTime?.match(HHMM);
  const en = e.endTime?.match(HHMM);
  const location = typeof e.location === "string" ? e.location : e.location?.name;
  const base = { title, description: e.content?.trim() || undefined, location: location || undefined, uid: e.eventTimeId ? `tyra-${e.eventTimeId}` : undefined };
  if (!s) return { ...base, start: day, end: new Date(day.getTime() + 86_400_000), allDay: true };
  const start = new Date(day);
  start.setHours(+s[1], +s[2]);
  const end = new Date(day);
  if (en) end.setHours(+en[1], +en[2]);
  else end.setTime(start.getTime() + 3_600_000);
  if (end <= start) end.setTime(start.getTime() + 3_600_000);
  return { ...base, start, end, allDay: false };
}

function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
}

function clock(v: unknown): string | undefined {
  if (typeof v === "string") {
    const m = v.match(HHMM);
    return m ? `${m[1].padStart(2, "0")}:${m[2]}` : undefined;
  }
  const iso = (v as ParseDate & object)?.iso;
  if (typeof iso === "string") {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return undefined;
}

/**
 * Today's omsorgstid from a kids_schedule row (one per child and calendar year, as Tyra's web app saves it): `w_<week>` holds [[start mon–fri], [end mon–fri], …];
 * "ledig" marks a day off. Weekends and days without times give nothing.
 */
export function careToday(row: Record<string, unknown> | undefined, now: Date): string | undefined {
  const wd = now.getDay();
  if (!row || wd === 0 || wd === 6) return undefined;
  const w = row[`w_${isoWeek(now)}`] as unknown[][] | undefined;
  const s = w?.[0]?.[wd - 1];
  const e = w?.[1]?.[wd - 1];
  if (s === "ledig" || e === "ledig") return "Ledig";
  const a = clock(s);
  const b = clock(e);
  return a && b ? `${a} - ${b}` : undefined;
}

/** The child's omsorgstid today, or undefined when there is none (or Tyra doesn't let a guardian read it). */
export async function tyraCare(session: string, kid: TyraKid, now: Date): Promise<string | undefined> {
  try {
    const rows = await query<Record<string, unknown>>("kids_schedule", { kid_owner: pointer("kids", kid.id), year: String(now.getFullYear()) }, session);
    return careToday(rows[0], now);
  } catch {
    return undefined;
  }
}
