import { AXFOOD_SITES, AuthExpired, axfoodAddToCart, axfoodLogin, axfoodSearch } from "../connectors/axfood.js";
import { CityGrossAuthExpired, cityGrossAdd, cityGrossCart, cityGrossLogin, cityGrossSearch, cityGrossStore, cityGrossSummary } from "../connectors/citygross.js";
import { IcaAuthExpired, icaAddRows, icaFresh, icaListId, icaLogin, icaRefresh, icaSearch, type IcaSession } from "../connectors/ica.js";
import type { GroceryProvider, ProviderCtx } from "./types.js";

function axfoodProvider(id: "willys" | "hemkop", status: "beta" | "experimental"): GroceryProvider {
  const site = AXFOOD_SITES[id];

  async function session(ctx: ProviderCtx, force = false): Promise<string> {
    const existing = ctx.secret("session");
    if (existing && !force) return existing;
    const username = ctx.str("username");
    const password = ctx.secret("password");
    if (!username || !password) throw new Error(`${site.label} är inte inställt.`);
    const cookies = await axfoodLogin(site, username, password);
    ctx.remember("session", cookies);
    return cookies;
  }

  return {
    meta: {
      id,
      category: "grocery",
      name: site.label,
      description: `Skicka inköpslistan till varukorgen på ${site.base.replace("https://www.", "")}. Du väljer produkt första gången, sedan kommer den ihåg.`,
      status,
      fields: [
        { key: "username", label: "Personnummer eller kundkortsnummer", type: "text", placeholder: "ÅÅMMDDXXXX", help: "10 eller 12 siffror, eller 16 siffror för kundkort. E-post fungerar inte." },
        { key: "password", label: "Lösenord", type: "password", secret: true, help: "Kontot behöver ett lösenord – BankID går inte att automatisera." },
      ],
      guide: [
        "Inloggningen görs av en dold webbläsare på servern, precis som när du loggar in själv.",
        "Varorna läggs i varukorgen – du väljer tid och betalar själv i appen.",
        "Inofficiell koppling: kan sluta fungera om butiken ändrar sin webb.",
      ],
    },
    async test(ctx) {
      await session(ctx, true);
      return { ok: true, message: `Inloggad hos ${site.label}.` };
    },
    async search(ctx, query) {
      // Search works anonymously; with a session the prices match the user's own store.
      return axfoodSearch(site, ctx.secret("session") ?? "", query);
    },
    async addToCart(ctx, lines) {
      try {
        return await axfoodAddToCart(site, await session(ctx), lines);
      } catch (e) {
        if (e instanceof AuthExpired) return axfoodAddToCart(site, await session(ctx, true), lines);
        throw e;
      }
    },
  };
}

export const willys = axfoodProvider("willys", "beta");
export const hemkop = axfoodProvider("hemkop", "experimental");
hemkop.meta.description = "Fungerar inte just nu: Hemköp har bytt inloggning. " + hemkop.meta.description;

export const ICA_LIST = "Familjetavlan";

// The preview searches every item at once: one sign-in/refresh at a time, the rest reuse it.
const icaPending = new Map<string, Promise<IcaSession>>();
/** The signed-in ICA session of this integration: saved, refreshed or a fresh login. */
export function icaSession(ctx: ProviderCtx, force = false): Promise<IcaSession> {
  const key = `${ctx.integration.id}:${force}`;
  let p = icaPending.get(key);
  if (!p) {
    p = icaObtain(ctx, force).finally(() => icaPending.delete(key));
    icaPending.set(key, p);
  }
  return p;
}
async function icaObtain(ctx: ProviderCtx, force: boolean): Promise<IcaSession> {
  let s: IcaSession | null = null;
  const saved = ctx.secret("session");
  if (saved && !force) {
    try {
      s = JSON.parse(saved) as IcaSession;
    } catch {
      s = null;
    }
    if (s && !icaFresh(s)) s = await icaRefresh(s);
  }
  if (!s) {
    const id = ctx.str("username");
    const pin = ctx.secret("password");
    if (!id || !pin) throw new Error("ICA är inte inställt.");
    s = await icaLogin(id, pin);
  }
  ctx.remember("session", JSON.stringify(s));
  return s;
}
/** Run against ICA; one new sign-in if the saved session was refused. */
export async function icaRun<T>(ctx: ProviderCtx, run: (s: IcaSession) => Promise<T>): Promise<T> {
  try {
    return await run(await icaSession(ctx));
  } catch (e) {
    if (e instanceof IcaAuthExpired) return run(await icaSession(ctx, true));
    throw e;
  }
}

/** ICA has no web shop cart to fill: the list goes into one of the ICA app's own shopping lists. */
export const ica: GroceryProvider = {
  meta: {
    id: "ica",
    category: "grocery",
    name: "ICA",
    description: "Lägg inköpslistan i en inköpslista i ICA-appen (och på ica.se) – du handlar sedan med appen i butiken.",
    status: "experimental",
    fields: [
      { key: "username", label: "Personnummer", type: "text", placeholder: "ÅÅÅÅMMDDXXXX", help: "12 siffror." },
      { key: "password", label: "PIN-kod i ICA-appen", type: "password", secret: true, help: "Den kod du har i ICA-appen – inte BankID." },
      { key: "list", label: "Namn på listan i ICA-appen", type: "text", optional: true, default: ICA_LIST, help: "Skapas om den inte finns." },
    ],
    guide: [
      "Varorna hamnar i en lista i ICA-appen som heter som du valt. Där får du dem sorterade efter butikens gång.",
      "Inofficiell koppling som använder ICA-appens egna anrop – den kan sluta fungera när ICA ändrar något.",
    ],
  },
  async test(ctx) {
    await icaSession(ctx, true);
    return { ok: true, message: "Inloggad hos ICA." };
  },
  search: (ctx, query) => icaRun(ctx, (s) => icaSearch(s, query)),
  async addToCart(ctx, lines) {
    const title = ctx.str("list") || ICA_LIST;
    const n = await icaRun(ctx, async (s) => icaAddRows(s, await icaListId(s, title), lines.map((l) => ({ name: l.code, qty: l.qty }))));
    return { items: n, total: null };
  },
};

export const citygross: GroceryProvider = (() => {
  async function token(ctx: ProviderCtx, force = false): Promise<string> {
    const saved = ctx.secret("session");
    if (saved && !force) {
      const [t, exp] = saved.split("|");
      if (t && Number(exp) - 60_000 > Date.now()) return t;
    }
    const email = ctx.str("username");
    const password = ctx.secret("password");
    if (!email || !password) throw new Error("City Gross är inte inställt.");
    const t = await cityGrossLogin(email, password);
    ctx.remember("session", `${t.token}|${t.expiresAt}`);
    return t.token;
  }
  return {
    meta: {
      id: "citygross",
      category: "grocery",
      name: "City Gross",
      description: "Skicka inköpslistan till varukorgen på citygross.se. Du väljer produkt första gången, sedan kommer den ihåg.",
      status: "experimental",
      fields: [
        { key: "username", label: "E-postadress", type: "text", placeholder: "namn@exempel.se" },
        { key: "password", label: "Lösenord", type: "password", secret: true, help: "Kontot behöver ett lösenord – BankID går inte att automatisera." },
        { key: "store", label: "Butik (ort)", type: "text", optional: true, placeholder: "t.ex. Jönköping", help: "Skriv orten så hittar tavlan butiken. Tomt = orten där ni bor. Priserna och varukorgen hör till butiken." },
      ],
      guide: [
        "Varorna läggs i varukorgen – du väljer tid och betalar själv på citygross.se eller i appen.",
        "Inofficiell koppling som följer webbplatsens egna anrop: kan sluta fungera om City Gross ändrar den.",
      ],
    },
    async test(ctx) {
      await token(ctx, true);
      const st = await cityGrossStore(ctx.str("store") || ctx.str("__place"));
      return { ok: true, message: st ? `Inloggad hos City Gross. Butik: ${st.name}.` : "Inloggad hos City Gross, men ingen butik hittades på orten – skriv ortens namn under Butik." };
    },
    // Search is open; with a store the prices are that store's.
    search: async (ctx, query) => cityGrossSearch(query, String((await cityGrossStore(ctx.str("store") || ctx.str("__place")))?.site ?? "")),
    async addToCart(ctx, lines) {
      const run = async (force: boolean) => {
        const t = await token(ctx, force);
        const st = await cityGrossStore(ctx.str("store") || ctx.str("__place"));
        const cart = await cityGrossCart(t, String(st?.site ?? ""), ctx.secret("cart"));
        if (cart.id) ctx.remember("cart", cart.id);
        return cityGrossSummary(await cityGrossAdd(t, cart, lines));
      };
      try {
        return await run(false);
      } catch (e) {
        if (e instanceof CityGrossAuthExpired) return run(true);
        throw e;
      }
    },
  };
})();
