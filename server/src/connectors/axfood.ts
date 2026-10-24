import { chromium } from "playwright-core";
import { fetchWithTimeout } from "../http.js";

/**
 * Axfood e-commerce (Willys, Hemköp) – unofficial, same SAP Hybris platform on both hosts.
 *
 * Endpoints and the login quirks are mapped by willys-mcp
 * (github.com/oscarthroedsson/willys-mcp, MIT, docs/endpoints.md):
 *  - login only works through the real form at /anvandare/inloggning; a headless browser
 *    fills it in (BankID cannot be automated – the account needs a password)
 *  - username is personnummer (10/12 digits) or a loyalty number (16 digits), never e-mail
 *  - every cart call needs `x-csrf-token` from GET /axfood/rest/csrf-token
 *  - POST /axfood/rest/cart/addProducts adds; quantity 0 removes
 * Endpoints may change without notice.
 */

export interface AxfoodSite {
  base: string;
  label: string;
}

export const AXFOOD_SITES: Record<string, AxfoodSite> = {
  willys: { base: "https://www.willys.se", label: "Willys" },
  hemkop: { base: "https://www.hemkop.se", label: "Hemköp" },
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const FUNCTIONAL_COOKIES = ["JSESSIONID", "axfoodRememberMe", "__Host-csrf-token", "ROUTE"];
export const AXFOOD_USERNAME = /^\d{10}$|^\d{12}$|^\d{16}$/;

export interface Product {
  code: string;
  name: string;
  brand?: string;
  volume?: string;
  price?: string;
  image?: string;
}

export class AuthExpired extends Error {}

function headers(cookies: string, csrf?: string): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/json, */*",
    "accept-language": "sv-SE,sv;q=0.9",
    "content-type": "application/json",
    "user-agent": UA,
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    cookie: cookies,
  };
  if (csrf) h["x-csrf-token"] = csrf;
  return h;
}

async function api<T>(site: AxfoodSite, path: string, cookies: string, init: RequestInit & { csrf?: string } = {}): Promise<T> {
  const res = await fetchWithTimeout(`${site.base}${path}`, { ...init, timeoutMs: 15_000, headers: headers(cookies, init.csrf) });
  if (res.status === 401 || res.status === 403) throw new AuthExpired(`${site.label}-sessionen har gått ut`);
  if (!res.ok) throw new Error(`${site.label} svarade ${res.status} på ${path}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function axfoodLogin(site: AxfoodSite, username: string, password: string): Promise<string> {
  if (!AXFOOD_USERNAME.test(username)) {
    throw new Error(`${site.label}: användarnamnet ska vara personnummer (10 eller 12 siffror) eller kundkortsnummer (16 siffror), inte e-post.`);
  }
  // BROWSER_WS_URL lets small machines (e.g. a Raspberry Pi) use an external browser such as
  // browserless/chromium instead of running Chromium locally.
  const browser = process.env.BROWSER_WS_URL
    ? await chromium.connect(process.env.BROWSER_WS_URL, { timeout: 30_000 })
    : await chromium.launch({
        headless: true,
        executablePath: process.env.CHROMIUM_PATH || undefined,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--window-size=1920,1080"],
      });
  try {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1920, height: 1080 }, locale: "sv-SE" });
    const page = await ctx.newPage();
    await page.goto(`${site.base}/anvandare/inloggning`, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(1500);
    const consent = page.locator('button[id*="accept"]').first();
    if (await consent.isVisible().catch(() => false)) {
      await consent.click();
      await page.waitForTimeout(1200);
    }
    const user = page.locator('input[name="j_username"], input[type="text"]').first();
    const pass = page.locator('input[name="j_password"], input[type="password"]').first();
    try {
      await pass.waitFor({ timeout: 10_000 });
    } catch {
      throw new Error(
        site.label === "Hemköp"
          ? "Hemköp har bytt inloggning (ny webbplats med BankID/lösenord i en ruta) – kopplingen behöver byggas om och fungerar inte just nu. Använd Willys, ICA eller City Gross."
          : `${site.label}: hittade inget inloggningsformulär – webbplatsen kan ha ändrats.`,
      );
    }
    await user.pressSequentially(username, { delay: 30 });
    await pass.pressSequentially(password, { delay: 30 });

    const button = page.getByRole("button", { name: /^logga in$/i }).first();
    if (await button.isVisible().catch(() => false)) await button.click();
    await page.waitForTimeout(5000);
    // Fallback documented by willys-mcp: if the click did nothing, submit the form itself.
    if (await page.locator('input[type="password"]').count()) {
      await page.evaluate(() => {
        const form = document.querySelector('input[type="password"]')?.closest("form") as HTMLFormElement | null;
        if (form?.requestSubmit) form.requestSubmit();
        else form?.submit();
      });
      await page.waitForTimeout(5000);
    }
    if (await page.locator('input[type="password"]').count()) {
      const errors = await page.locator('[class*="error"],[role="alert"]').allInnerTexts().catch(() => [] as string[]);
      const msg = errors.map((t) => t.trim()).filter((t) => t && t.length < 200).slice(0, 3).join(" | ");
      throw new Error(msg ? `${site.label} avvisade inloggningen: ${msg}` : `${site.label}-inloggningen gick inte igenom.`);
    }

    const jar = (await ctx.cookies(site.base)).filter((c) => FUNCTIONAL_COOKIES.includes(c.name));
    const cookies = jar.map((c) => `${c.name}=${c.value}`).join("; ");
    if (!cookies.includes("JSESSIONID")) throw new Error(`${site.label} gav ingen session efter inloggning.`);
    // JSESSIONID exists for anonymous visitors too – only an authenticated endpoint proves login.
    await api(site, "/axfood/rest/account/orders", cookies);
    return cookies;
  } finally {
    await browser.close();
  }
}

export async function axfoodSearch(site: AxfoodSite, cookies: string, query: string, size = 6): Promise<Product[]> {
  type R = {
    results?: { code: string; name: string; manufacturer?: string; displayVolume?: string; price?: string; image?: { url?: string } }[];
  };
  const data = await api<R>(site, `/search?q=${encodeURIComponent(query)}&page=0&size=${size}`, cookies);
  return (data.results ?? []).map((r) => ({
    code: r.code,
    name: r.name,
    brand: r.manufacturer,
    volume: r.displayVolume,
    price: r.price,
    image: r.image?.url,
  }));
}

export async function axfoodAddToCart(site: AxfoodSite, cookies: string, lines: { code: string; qty: number }[]) {
  const csrf = String(await api<string>(site, "/axfood/rest/csrf-token", cookies));
  await api(site, "/axfood/rest/cart/addProducts", cookies, {
    method: "POST",
    csrf,
    body: JSON.stringify({
      products: lines.map((l) => ({
        productCodePost: l.code,
        qty: l.qty,
        pickUnit: "pieces",
        hideDiscountToolTip: false,
        noReplacementFlag: false,
      })),
    }),
  });
  const cart = await api<{ totalItems?: number; totalPrice?: string }>(site, "/axfood/rest/cart", cookies, { csrf });
  return { items: cart?.totalItems ?? null, total: cart?.totalPrice ?? null };
}

// ---------- Offers (open, no login): the campaigns of a store ----------

export interface AxfoodOffer {
  id: string;
  name: string;
  brand?: string;
  size?: string;
  price?: string;
  note?: string;
  image?: string;
  validTo?: string;
}

interface AxStore {
  storeId: string;
  name?: string;
  address?: { town?: string | null } | null;
}

const storeLists = new Map<string, { at: number; list: AxStore[] }>();

async function axfoodStoreList(site: AxfoodSite): Promise<AxStore[]> {
  const hit = storeLists.get(site.base);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.list;
  const res = await fetchWithTimeout(`${site.base}/axfood/rest/store`, { headers: { accept: "application/json", "user-agent": UA }, timeoutMs: 20_000 });
  if (!res.ok) throw new Error(`${site.label} svarade ${res.status} på butikslistan`);
  const list = (await res.json()) as AxStore[];
  storeLists.set(site.base, { at: Date.now(), list });
  return list;
}

/** The stores in a town, then the offers of the first one that has any (not every store sells online). */
export async function axfoodOffers(site: AxfoodSite, place: string, size = 24): Promise<{ store: string; offers: AxfoodOffer[] }> {
  const want = place.trim().toLowerCase();
  if (!want) throw new Error(`Ange en ort för ${site.label} (Butik (ort)) – eller sätt orten under Hem.`);
  const stores = (await axfoodStoreList(site)).filter((s) => (s.address?.town ?? "").toLowerCase() === want || (s.name ?? "").toLowerCase().includes(want));
  if (!stores.length) throw new Error(`${site.label} har ingen butik som heter ${place}.`);
  type Promo = { rewardLabel?: string; conditionLabel?: string; validUntil?: number };
  type R = { code: string; name: string; manufacturer?: string; displayVolume?: string; image?: { url?: string }; potentialPromotions?: Promo[] };
  for (const st of stores.slice(0, 5)) {
    const res = await fetchWithTimeout(`${site.base}/search/campaigns/online?${new URLSearchParams({ q: st.storeId, type: "PERSONAL_GENERAL", size: String(size), page: "0" })}`, { headers: { accept: "application/json", "user-agent": UA }, timeoutMs: 20_000 });
    if (!res.ok) continue;
    const data = (await res.json()) as { results?: R[] };
    const offers: AxfoodOffer[] = (data.results ?? []).map((r) => {
      const p = r.potentialPromotions?.[0];
      return {
        id: r.code,
        name: r.name,
        brand: r.manufacturer || undefined,
        size: r.displayVolume || undefined,
        price: p?.rewardLabel || undefined,
        note: p?.conditionLabel || undefined,
        image: r.image?.url,
        validTo: p?.validUntil ? new Date(p.validUntil).toISOString() : undefined,
      };
    });
    if (offers.length) return { store: st.name ?? place, offers };
  }
  return { store: stores[0]!.name ?? place, offers: [] };
}
