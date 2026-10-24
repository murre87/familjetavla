import { fetchWithTimeout } from "../http.js";
import type { Product } from "./axfood.js";

/**
 * City Gross – unofficial, mapped from the site's own web app (citygross.se, React):
 *  - search is open: GET /api/v1/Loop54/search?SearchQuery=…[&storeNumber=…] (prices per store)
 *  - sign-in: POST /connect/token (password grant, scope "customerserviceapi epiapi") with the
 *    e-mail address and password → bearer token. A wrong password answers invalid_grant.
 *  - cart (paths at the site root, not under /api/v1): POST /carts {storeNumber} creates one, POST /carts/{id}/additems {items:[{itemNo,quantity}]} adds lines.
 *    The store number is not the site id: the site's own GraphQL (lindbakstorenumber) maps one to the other.
 * Search and the sign-in check are tested against the live site; the cart calls follow the web app's
 * own code and need an account to be proven (README: experimental).
 */

const BASE = "https://www.citygross.se";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

export class CityGrossAuthExpired extends Error {}

export interface CityGrossToken {
  token: string;
  expiresAt: number;
}

interface CgProduct {
  id: string;
  name: string;
  subtitle?: string;
  brand?: string;
  sellable?: boolean;
  images?: { url: string; type: number }[];
  productStoreDetails?: { prices?: { currentPrice?: { price?: number } } };
}

export async function cityGrossSearch(query: string, store: string, size = 6): Promise<Product[]> {
  const q = new URLSearchParams({ SearchQuery: query, take: String(size) });
  if (store) q.set("storeNumber", store);
  const res = await fetchWithTimeout(`${BASE}/api/v1/Loop54/search?${q}`, { headers: { accept: "application/json", "user-agent": UA }, timeoutMs: 15_000 });
  if (res.status === 400) return [];
  if (!res.ok) throw new Error(`City Gross svarade ${res.status} på sökningen`);
  const data = (await res.json()) as { searchResults?: { products?: CgProduct[] } };
  return (data.searchResults?.products ?? [])
    .filter((p) => p.sellable !== false)
    .slice(0, size)
    .map((p) => {
      const price = p.productStoreDetails?.prices?.currentPrice?.price;
      const img = p.images?.find((i) => i.type === 0) ?? p.images?.[0];
      return {
        code: p.id,
        name: p.name,
        brand: p.brand ?? undefined,
        volume: p.subtitle ?? undefined,
        price: typeof price === "number" ? `${price.toFixed(2).replace(".", ",")} kr` : undefined,
        image: img ? `${BASE}/images/products/${img.url}?w=120&h=120` : undefined,
      };
    });
}

export async function cityGrossLogin(email: string, password: string): Promise<CityGrossToken> {
  const res = await fetchWithTimeout(`${BASE}/connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "user-agent": UA },
    body: new URLSearchParams({ grant_type: "password", scope: "customerserviceapi epiapi", username: email, password }).toString(),
    timeoutMs: 20_000,
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (res.status === 400 && body.error_description === "invalid_username_or_password") throw new Error("City Gross nekade inloggningen – kontrollera e-post och lösenord.");
  if (!res.ok || !body.access_token) throw new Error(`City Gross svarade ${res.status} vid inloggningen.`);
  return { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
}

async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithTimeout(`${BASE}${path}`, {
    ...init,
    timeoutMs: 20_000,
    headers: {
      accept: "application/json",
      "user-agent": UA,
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
  if (res.status === 401 || res.status === 403) throw new CityGrossAuthExpired("City Gross-sessionen har gått ut");
  if (!res.ok) throw new Error(`City Gross svarade ${res.status} på ${path.split("?")[0]}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

interface Cart {
  id?: string;
  items?: { itemNo?: string; id?: string; quantity?: number | { value?: number } }[];
  totalPrice?: number | { value?: number };
  total?: number | { value?: number };
}

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : typeof v === "object" && v && typeof (v as { value?: unknown }).value === "number" ? (v as { value: number }).value : undefined);

/** Reuse the cart made earlier while it still exists, otherwise open a new one in the chosen store. */
export async function cityGrossCart(token: string, store: string, remembered: string | undefined): Promise<Cart> {
  if (remembered) {
    try {
      const c = await api<Cart>(token, `/carts/${encodeURIComponent(remembered)}`);
      if (c?.id) return c;
    } catch (e) {
      if (e instanceof CityGrossAuthExpired) throw e;
    }
  }
  if (!store) throw new Error("City Gross: ingen butik hittades – skriv ortens namn under Butik i inställningarna.");
  const c = await api<Cart>(token, "/carts", { method: "POST", body: JSON.stringify({ storeNumber: Number(store) || store }) });
  if (!c?.id) throw new Error("City Gross skapade ingen varukorg.");
  return c;
}

interface CgFull extends CgProduct {
  gtin?: string;
  netContent?: unknown;
  countryOfOriginIsoCode?: string | null;
}

/** The product the cart wants described: its gtin, name and content. */
async function cityGrossProduct(code: string): Promise<CgFull> {
  const res = await fetchWithTimeout(`${BASE}/api/v1/Loop54/products/${encodeURIComponent(code)}`, { headers: { accept: "application/json", "user-agent": UA }, timeoutMs: 15_000 });
  const data = res.ok ? ((await res.json()) as { items?: CgFull[] }) : {};
  const p = data.items?.find((x) => x.id === code);
  if (!p) throw new Error(`City Gross hittade inte varan ${code}.`);
  return p;
}

/** The site's own "additems" call: it adds to what is already in the cart. */
export async function cityGrossAdd(token: string, cart: Cart, lines: { code: string; qty: number }[]): Promise<Cart> {
  if (!cart.id) throw new Error("City Gross: varukorgen saknar id.");
  const items = await Promise.all(
    lines.map(async (l) => {
      const p = await cityGrossProduct(l.code);
      return {
        countryOfOrigin: p.countryOfOriginIsoCode ?? undefined,
        gtin: p.gtin,
        itemNo: p.id,
        name: p.name,
        netContent: p.netContent,
        quantity: { value: l.qty, unit: "Piece", originalUnit: "Piece" },
      };
    }),
  );
  const res = await api<Cart>(token, `/carts/${encodeURIComponent(cart.id)}/additems`, { method: "POST", body: JSON.stringify({ items }) });
  return res ?? cart;
}

export function cityGrossSummary(cart: Cart): { items: number | null; total: string | null } {
  const items = cart.items?.reduce((s, i) => s + (num(i.quantity) ?? 1), 0) ?? null;
  const total = num(cart.totalPrice) ?? num(cart.total) ?? num((cart as { totalAmount?: unknown }).totalAmount);
  return { items, total: total !== undefined ? `${total.toFixed(2).replace(".", ",")} kr` : null };
}

const stores = new Map<string, { site: number; no: number; name: string } | null>();

/**
 * A store from what a person writes: a number is used as is, a town is looked up on citygross.se
 * (the store pages) and gives the store's site number. Null when there is no such store.
 */
export async function cityGrossStore(input: string): Promise<{ site: number; no: number; name: string } | null> {
  const q = input.trim();
  if (!q) return null;
  if (/^\d{4}$/.test(q)) return { site: 0, no: Number(q), name: `butik ${q}` };
  const key = q.toLowerCase();
  if (stores.has(key)) return stores.get(key)!;
  let found: { site: number; no: number; name: string } | null = null;
  try {
    const res = await fetchWithTimeout(`${BASE}/api/v1/Loop54/search?${new URLSearchParams({ SearchQuery: q, take: "1" })}`, { headers: { accept: "application/json", "user-agent": UA }, timeoutMs: 15_000 });
    const data = (await res.json()) as { searchResults?: { stores?: { id: number; name: string; pagetype?: string }[] } };
    const hit = data.searchResults?.stores?.find((s) => s.pagetype === "StorePage" && s.name.toLowerCase().includes(key)) ?? data.searchResults?.stores?.find((s) => s.pagetype === "StorePage");
    if (hit) {
      const page = await fetchWithTimeout(`${BASE}/api/v1/pagedata/${hit.id}`, { headers: { accept: "application/json", "user-agent": UA }, timeoutMs: 15_000 });
      const pd = (await page.json()) as { data?: { siteId?: number; storeName?: string } };
      if (typeof pd.data?.siteId === "number") {
        // The cart and the prices use the store number, which the site's own GraphQL maps from the site id.
        const g = await fetchWithTimeout(`${BASE}/graphql`, {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": UA },
          body: JSON.stringify({ query: "query($siteId:String!){lindbakstorenumber(siteId:$siteId){storeNumber}}", variables: { siteId: String(pd.data.siteId) } }),
          timeoutMs: 15_000,
        });
        const no = ((await g.json()) as { data?: { lindbakstorenumber?: { storeNumber?: number } } }).data?.lindbakstorenumber?.storeNumber;
        if (typeof no === "number") found = { site: pd.data.siteId, no, name: pd.data.storeName ?? hit.name };
      }
    }
  } catch {
    found = null;
  }
  if (found) stores.set(key, found);
  return found;
}

/** What the account buys most (the site's own "mina mest köpta varor"), named from the product list. */
export async function cityGrossCommon(token: string, size = 16): Promise<{ name: string }[]> {
  const res = await fetchWithTimeout(`${BASE}/graphql`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ query: "query($size:Int!,$days:Int!){mostBoughtProducts(size:$size,days:$days)}", variables: { size, days: 365 } }),
    timeoutMs: 20_000,
  });
  if (res.status === 401 || res.status === 403) throw new CityGrossAuthExpired("City Gross-sessionen har gått ut");
  const ids = ((await res.json()) as { data?: { mostBoughtProducts?: string[] } }).data?.mostBoughtProducts ?? [];
  const named = await Promise.all(ids.slice(0, size).map((id) => cityGrossProduct(id).then((p) => p.name).catch(() => null)));
  return named.filter((n): n is string => Boolean(n)).map((name) => ({ name }));
}
