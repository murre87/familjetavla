import { afterEach, describe, expect, it, vi } from "vitest";
import { icaAddRows, icaListId, icaLogin, icaRefresh, icaSearch, type IcaSession } from "./ica.js";
import { cityGrossAdd, cityGrossLogin, cityGrossSearch, cityGrossSummary } from "./citygross.js";

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];
function mock(handler: (url: string, init: RequestInit) => Response) {
  calls.length = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return handler(url, init);
  });
}
const json = (o: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });
const bodyOf = (c: Call) => String(c.init.body);

afterEach(() => vi.unstubAllGlobals());

const session: IcaSession = {
  client: { client_id: "c", client_secret: "s", scope: "openid" },
  token: { access_token: "AT", refresh_token: "RT", expires_at: Date.now() + 3_600_000 },
};

describe("ICA", () => {
  it("runs the PKCE login chain with cookies and returns a session", async () => {
    mock((url, init) => {
      if (url.endsWith("/oauth/v2/token") && bodyOf({ url, init }).includes("client_credentials")) return json({ access_token: "REG" });
      if (url.endsWith("/register")) return json({ client_id: "cid", client_secret: "sec", scope: "openid" });
      if (url.includes("/oauth/v2/authorize?") && !url.includes("forceAuthN"))
        return new Response(null, { status: 302, headers: { location: "/authn/authenticate?x=1&state=ST123", "set-cookie": "sid=abc; Path=/" } });
      if (url.includes("/authn/authenticate?")) return new Response("<html/>", { status: 200 });
      if (url.endsWith("/authn/authenticate/IcaCustomers")) return new Response('<input type="hidden" name="state" value="ST123"><input type="hidden" name="token" value="TK9">', { status: 200 });
      if (url.includes("forceAuthN")) return new Response(null, { status: 302, headers: { location: "icacurity://app?foo=1&code=CODE7" } });
      if (url.endsWith("/oauth/v2/token")) return json({ access_token: "ACC", refresh_token: "REF", expires_in: 100 });
      return new Response("?", { status: 404 });
    });
    const s = await icaLogin("199001011234", "1234");
    expect(s.token.access_token).toBe("ACC");
    expect(s.client.client_id).toBe("cid");
    const loginPost = calls.find((c) => c.url.endsWith("/IcaCustomers"))!;
    expect(bodyOf(loginPost)).toBe("userName=199001011234&password=1234");
    expect((loginPost.init.headers as Record<string, string>).cookie).toContain("sid=abc");
    const last = calls.at(-1)!;
    expect(bodyOf(last)).toContain("code=CODE7");
    expect(bodyOf(last)).toContain("code_verifier=");
  });

  it("says plainly when the PIN is refused", async () => {
    mock((url) => {
      if (url.endsWith("/oauth/v2/token")) return json({ access_token: "REG" });
      if (url.endsWith("/register")) return json({ client_id: "cid", client_secret: "sec", scope: "openid" });
      if (url.includes("/oauth/v2/authorize?")) return new Response(null, { status: 302, headers: { location: "/authn/authenticate?state=S" } });
      if (url.includes("/authn/authenticate?")) return new Response("", { status: 200 });
      return new Response("", { status: 400 });
    });
    await expect(icaLogin("1", "0")).rejects.toThrow(/personnummer och PIN/);
  });

  it("refreshes with basic auth and returns null when refused", async () => {
    mock(() => json({ access_token: "NEW", expires_in: 50 }));
    const r = await icaRefresh(session);
    expect(r?.token.access_token).toBe("NEW");
    expect(r?.token.refresh_token).toBe("RT");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toMatch(/^Basic /);
    mock(() => json({}, 400));
    expect(await icaRefresh(session)).toBeNull();
  });

  it("reads suggestions from several response shapes", async () => {
    mock(() => json({ articles: [{ name: "Mjölk" }, { productName: "Mjölk" }, { title: "Mjölkchoklad" }] }));
    expect((await icaSearch(session, "mjölk")).map((p) => p.name)).toEqual(["Mjölk", "Mjölkchoklad"]);
    mock(() => json({ documents: [{ name: "mjölk", articleGroupName: "Mejeri" }, { name: "mjölk grön", articleGroupName: "Mejeri" }] }));
    expect(await icaSearch(session, "mjölk")).toEqual([
      { code: "mjölk", name: "Mjölk", volume: "Mejeri" },
      { code: "mjölk grön", name: "Mjölk grön", volume: "Mejeri" },
    ]);
    mock(() => json([{ name: "Smör" }]));
    expect((await icaSearch(session, "smör"))[0]!.code).toBe("Smör");
  });

  it("finds the list by title or creates it, and syncs rows", async () => {
    mock(() => json({ shoppingLists: [{ offlineId: "L1", title: "familjetavlan" }] }));
    expect(await icaListId(session, "Familjetavlan")).toBe("L1");
    mock((url, init) => (init.method === "POST" ? new Response("", { status: 200 }) : json({ shoppingLists: [] })));
    const id = await icaListId(session, "Familjetavlan");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(bodyOf(calls[1]!)).title).toBe("Familjetavlan");
    mock(() => new Response("", { status: 200 }));
    expect(await icaAddRows(session, "L1", [{ name: "Mjölk", qty: 2 }, { name: "Bröd", qty: 1 }])).toBe(2);
    const sync = calls[0]!;
    expect(sync.url).toContain("/shoppinglists/L1/sync");
    const rows = JSON.parse(bodyOf(sync)).createdRows;
    expect(rows[0]).toMatchObject({ productName: "Mjölk", quantity: 2, unit: "st", sourceId: -1, isStrikedOver: false });
    expect(rows[1].quantity).toBeUndefined();
  });
});

describe("City Gross", () => {
  it("maps search results with price and image", async () => {
    mock(() =>
      json({
        searchResults: {
          products: [
            { id: "1_ST", name: "Mellanmjölk", subtitle: "1,5L", brand: "GARANT", sellable: true, images: [{ url: "a.jpeg", type: 0 }], productStoreDetails: { prices: { currentPrice: { price: 16.5 } } } },
            { id: "2_ST", name: "Slut", sellable: false },
          ],
        },
      }),
    );
    const out = await cityGrossSearch("mjölk", "0141");
    expect(out).toEqual([{ code: "1_ST", name: "Mellanmjölk", brand: "GARANT", volume: "1,5L", price: "16,50 kr", image: "https://www.citygross.se/images/products/a.jpeg?w=120&h=120" }]);
    expect(calls[0]!.url).toContain("storeNumber=0141");
  });

  it("an empty query is an empty result, a wrong password a clear message", async () => {
    mock(() => json("SearchQuery should not be empty", 400));
    expect(await cityGrossSearch("", "")).toEqual([]);
    mock(() => json({ error: "invalid_grant", error_description: "invalid_username_or_password" }, 400));
    await expect(cityGrossLogin("a@b.se", "x")).rejects.toThrow(/nekade inloggningen/);
    mock(() => json({ access_token: "T", expires_in: 60 }));
    expect((await cityGrossLogin("a@b.se", "x")).token).toBe("T");
    expect(bodyOf(calls[0]!)).toContain("grant_type=password");
  });

  it("adds to what is already in the cart", async () => {
    mock(() => json({ id: "C", items: [{ itemNo: "1_ST", quantity: 3 }], totalPrice: 49.5 }));
    const cart = { id: "C", items: [{ itemNo: "1_ST", quantity: 3 }] };
    const out = await cityGrossAdd("T", cart, [{ code: "1_ST", qty: 2 }]);
    expect(JSON.parse(bodyOf(calls[0]!))).toEqual({ quantity: 5 });
    expect(calls[0]!.url).toContain("/carts/C/items/1_ST");
    expect(cityGrossSummary(out)).toEqual({ items: 3, total: "49,50 kr" });
  });
});
