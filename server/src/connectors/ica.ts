import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fetchWithTimeout } from "../http.js";
import type { Product } from "./axfood.js";

/**
 * ICA (Sverige) – unofficial. The sign-in and the shopping-list API are the ones the ICA app uses,
 * mapped by the Home Assistant integration github.com/lazytarget/ha-ica-todo (no licence file, so
 * this is a fresh implementation of the same protocol, not a copy):
 *   1. client_credentials token with the app-registration client, then POST /register → own client
 *   2. OAuth authorization-code + PKCE against ims.icagruppen.se, with the personal number and the
 *      app PIN as userName/password in the login form (cookies must follow along)
 *   3. apimgw-pub.ica.se/sverige/digx/mobile/shoppinglistservice/v1/… with the bearer token
 * The token lives about 30 days and is renewed with the refresh token.
 */

const IMS = "https://ims.icagruppen.se";
const API = "https://apimgw-pub.ica.se/sverige/digx";
const REG_CLIENT = "ica-app-dcr-registration";
const REG_SECRET = "uxLHTBvZ-Z2fV-SbrHl1E-tz7vB3jQFrwAdSLlbVMMu1rxDdvJU0s8KGu9d1wLS4";
const ACR = "urn:se:curity:authentication:html-form:IcaCustomers";
const REDIRECT = "icacurity://app";
/** The article group ICA files an item under when it is not known ("Övrigt"). */
const DEFAULT_GROUP = 12;
const UA = "ICA/ ANDROID";

export class IcaAuthExpired extends Error {}

export interface IcaSession {
  client: { client_id: string; client_secret: string; scope: string };
  token: { access_token: string; refresh_token?: string; expires_at: number };
}

class Jar {
  private c = new Map<string, string>();
  take(res: Response) {
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair] = sc.split(";");
      const i = pair!.indexOf("=");
      if (i > 0) this.c.set(pair!.slice(0, i).trim(), pair!.slice(i + 1).trim());
    }
  }
  header() {
    return [...this.c].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

async function call(jar: Jar, url: string, init: RequestInit & { form?: Record<string, string> } = {}): Promise<Response> {
  const headers: Record<string, string> = { "user-agent": UA, ...(init.headers as Record<string, string>) };
  if (jar.header()) headers.cookie = jar.header();
  let body = init.body;
  if (init.form) {
    body = form(init.form);
    headers["content-type"] = "application/x-www-form-urlencoded";
  }
  const res = await fetchWithTimeout(url, { ...init, body, headers, redirect: "manual", timeoutMs: 20_000 });
  jar.take(res);
  return res;
}

function location(res: Response, what: string): string {
  const loc = res.headers.get("location");
  if (!loc) throw new Error(`ICA: inloggningen stannade vid ${what} (${res.status}).`);
  return loc;
}

const pick = (text: string, re: RegExp, what: string): string => {
  const m = re.exec(text);
  if (!m?.[1]) throw new Error(`ICA: hittade inte ${what} i inloggningssvaret.`);
  return m[1];
};

async function registerClient(jar: Jar): Promise<IcaSession["client"]> {
  const t = await call(jar, `${IMS}/oauth/v2/token`, {
    method: "POST",
    form: { client_id: REG_CLIENT, client_secret: REG_SECRET, grant_type: "client_credentials", scope: "dcr", response_type: "token" },
  });
  if (!t.ok) throw new Error(`ICA svarade ${t.status} när appen skulle registreras.`);
  const { access_token } = (await t.json()) as { access_token: string };
  const r = await call(jar, `${IMS}/register`, {
    method: "POST",
    headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ software_id: "dcr-ica-app-template" }),
  });
  if (!r.ok) throw new Error(`ICA svarade ${r.status} när appen skulle registreras.`);
  return (await r.json()) as IcaSession["client"];
}

function toSession(client: IcaSession["client"], tok: { access_token: string; refresh_token?: string; expires_in?: number }): IcaSession {
  return {
    client,
    token: {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: Date.now() + (tok.expires_in ?? 2_592_000) * 1000,
    },
  };
}

/** Full sign-in with personal number + app PIN. */
export async function icaLogin(personalNumber: string, pin: string): Promise<IcaSession> {
  const jar = new Jar();
  const client = await registerClient(jar);
  const verifier = randomBytes(40).toString("base64url").replace(/[^a-zA-Z0-9]/g, "");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const auth = new URL(`${IMS}/oauth/v2/authorize`);
  for (const [k, v] of Object.entries({
    client_id: client.client_id,
    scope: client.scope,
    redirect_uri: REDIRECT,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "login",
    acr: ACR,
  }))
    auth.searchParams.set(k, v);
  const start = await call(jar, auth.toString());
  const loc = new URL(location(start, "start"), IMS).toString();
  const state = pick(loc, /[?&]state=(\w+)/, "state");
  await call(jar, loc);

  const login = await call(jar, `${IMS}/authn/authenticate/IcaCustomers`, { method: "POST", form: { userName: personalNumber, password: pin } });
  if (login.status === 400 || login.status === 401) throw new Error("ICA nekade inloggningen – kontrollera personnummer och PIN-kod.");
  if (!login.ok) throw new Error(`ICA svarade ${login.status} vid inloggningen.`);
  const html = await login.text();
  const token = pick(html, /name="token" value="(\w+)/, "token");

  const code = await call(jar, `${IMS}/oauth/v2/authorize?${form({ client_id: client.client_id, forceAuthN: "true", acr: ACR })}`, {
    method: "POST",
    form: { token, state },
  });
  const authCode = pick(location(code, "koden"), /[?&]code=(\w+)/, "koden");

  const t = await call(jar, `${IMS}/oauth/v2/token`, {
    method: "POST",
    form: {
      code: authCode,
      client_id: client.client_id,
      client_secret: client.client_secret,
      grant_type: "authorization_code",
      scope: client.scope,
      response_type: "token",
      code_verifier: verifier,
      redirect_uri: REDIRECT,
    },
  });
  if (!t.ok) throw new Error(`ICA svarade ${t.status} när inloggningen skulle slutföras.`);
  return toSession(client, (await t.json()) as { access_token: string; refresh_token?: string; expires_in?: number });
}

/** Renew with the refresh token; null if ICA refuses (sign in again then). */
export async function icaRefresh(s: IcaSession): Promise<IcaSession | null> {
  if (!s.token.refresh_token) return null;
  const basic = Buffer.from(`${s.client.client_id}:${s.client.client_secret}`).toString("base64");
  const res = await call(new Jar(), `${IMS}/oauth/v2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${basic}` },
    form: { grant_type: "refresh_token", refresh_token: s.token.refresh_token },
  });
  if (!res.ok) return null;
  const tok = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  return toSession(s.client, { refresh_token: s.token.refresh_token, ...tok });
}

export const icaFresh = (s: IcaSession) => s.token.expires_at - 60_000 > Date.now();

async function api<T>(s: IcaSession, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithTimeout(`${API}/${path}`, {
    ...init,
    timeoutMs: 20_000,
    headers: {
      "user-agent": UA,
      accept: "application/json",
      authorization: `Bearer ${s.token.access_token}`,
      ...(init.body ? { "content-type": "application/json; charset=utf-8" } : {}),
      ...(init.headers as Record<string, string>),
    },
  });
  if (res.status === 401 || res.status === 403) throw new IcaAuthExpired("ICA-sessionen har gått ut");
  if (!res.ok) throw new Error(`ICA svarade ${res.status} på ${path.split("?")[0]}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

const LISTS = "mobile/shoppinglistservice/v1/shoppinglists";

interface IcaList {
  offlineId?: string | number;
  id?: number;
  title?: string;
}

/** Suggestions from ICA's own article search (what the app offers when you type). */
export async function icaSearch(s: IcaSession, query: string, size = 6): Promise<Product[]> {
  const data = await api<unknown>(s, `shoppinglistarticlesearch/v1/search?${form({ query })}`);
  const rows = Array.isArray(data)
    ? data
    : Array.isArray((data as Record<string, unknown>)?.articles)
      ? ((data as Record<string, unknown>).articles as unknown[])
      : Array.isArray((data as Record<string, unknown>)?.results)
        ? ((data as Record<string, unknown>).results as unknown[])
        : [];
  const out: Product[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const name = String(r.name ?? r.productName ?? r.title ?? r.articleName ?? "").trim();
    if (!name || out.some((p) => p.name === name)) continue;
    out.push({ code: name, name, brand: typeof r.brand === "string" ? r.brand : undefined });
    if (out.length >= size) break;
  }
  return out;
}

/** The list the board writes to: found by title, created when missing. */
export async function icaListId(s: IcaSession, title: string): Promise<string> {
  const data = await api<{ shoppingLists?: IcaList[] } | IcaList[]>(s, LISTS);
  const lists = Array.isArray(data) ? data : (data?.shoppingLists ?? []);
  const want = title.trim().toLowerCase();
  const hit = lists.find((l) => (l.title ?? "").trim().toLowerCase() === want);
  if (hit?.offlineId !== undefined) return String(hit.offlineId);
  const offlineId = randomUUID();
  await api(s, LISTS, {
    method: "POST",
    body: JSON.stringify({
      offlineId,
      title,
      commentText: "",
      sortingStore: 1,
      rows: [],
      latestChange: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    }),
  });
  return offlineId;
}

export async function icaAddRows(s: IcaSession, listId: string, lines: { name: string; qty: number }[]): Promise<number> {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const createdRows = lines.map((l) => ({
    offlineId: randomUUID(),
    productName: l.name,
    ...(l.qty > 1 ? { quantity: l.qty, unit: "st" } : {}),
    isStrikedOver: false,
    sourceId: -1,
    internalOrder: 999,
    articleGroupId: DEFAULT_GROUP,
    articleGroupIdExtended: DEFAULT_GROUP,
    latestChange: now,
  }));
  await api(s, `${LISTS}/${encodeURIComponent(listId)}/sync`, { method: "POST", body: JSON.stringify({ createdRows }) });
  return createdRows.length;
}
