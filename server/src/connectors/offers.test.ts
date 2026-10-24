import { afterEach, describe, expect, it, vi } from "vitest";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { AXFOOD_SITES, axfoodCommon, axfoodEncrypt, axfoodFullPersonalNumber, axfoodLoginHttp, axfoodOffers } from "./axfood.js";
import { groceryIntegration, groceryIntegrations } from "../sources.js";
import type { Config } from "../types.js";

const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("Axfood offers", () => {
  it("takes the offers of the first store in the town that has any", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      if (url.endsWith("/axfood/rest/store"))
        return json([
          { storeId: "1", name: "Hemköp Kiruna C", address: { town: "Kiruna" } },
          { storeId: "4674", name: "Hemköp Jönköping C", address: { town: "Jönköping" } },
          { storeId: "4266", name: "Hemköp Jönköping Strandängen", address: { town: "Jönköping" } },
        ]);
      if (url.includes("q=4674")) return json({ results: [] });
      return json({
        results: [{ code: "101_ST", name: "Kaffe", manufacturer: "Zoégas", displayVolume: "450g", image: { url: "https://x/y" }, potentialPromotions: [{ rewardLabel: "49,00/st", conditionLabel: "Spara 10 kr", validUntil: 1792969199000 }] }],
      });
    });
    const r = await axfoodOffers(AXFOOD_SITES.hemkop!, "jönköping");
    expect(r.store).toBe("Hemköp Jönköping Strandängen");
    expect(r.offers).toEqual([{ id: "101_ST", name: "Kaffe", brand: "Zoégas", size: "450g", price: "49,00/st", note: "Spara 10 kr", image: "https://x/y", validTo: new Date(1792969199000).toISOString() }]);
    expect(asked.some((u) => u.includes("q=4266"))).toBe(true);
  });

  it("asks for a town when there is none, and says when the town has no store", async () => {
    vi.stubGlobal("fetch", async () => json([{ storeId: "1", name: "Willys Boden", address: { town: "Boden" } }]));
    await expect(axfoodOffers(AXFOOD_SITES.willys!, "")).rejects.toThrow(/Välj en butik/);
    await expect(axfoodOffers(AXFOOD_SITES.willys!, "Atlantis")).rejects.toThrow(/ingen butik/);
  });
});

describe("Axfood most bought", () => {
  it("counts products over the latest orders, once per order", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/axfood/rest/account/orders")) return json([{ code: "A" }, { code: "B" }]);
      if (url.includes("q=A")) return json({ categories: [{ entries: [{ product: { code: "1_ST", name: "Mjölk" }, quantity: 3 }, { product: { code: "2_ST", name: "Bröd" }, quantity: 1 }, { product: { code: "1_ST", name: "Mjölk" }, quantity: 1 }] }] });
      return json({ entries: [{ product: { code: "1_ST", name: "Mjölk" }, quantity: 2 }, { product: { code: "3_ST", name: "Ägg" }, quantity: 1 }] });
    });
    expect(await axfoodCommon(AXFOOD_SITES.willys!, "c=1")).toEqual([{ name: "Mjölk" }, { name: "Bröd" }, { name: "Ägg" }]);
  });
});

describe("Axfood login without a browser", () => {
  it("encrypts like the site's form (PBKDF2 + AES-128-CBC), so the shop can decrypt it", () => {
    const { key, encrypted } = axfoodEncrypt("lösen ord 123");
    const [iv, salt, data] = Buffer.from(encrypted, "base64").toString().split("::");
    const d = createDecipheriv("aes-128-cbc", pbkdf2Sync(key, Buffer.from(salt!, "hex"), 1000, 16, "sha1"), Buffer.from(iv!, "hex"));
    expect(Buffer.concat([d.update(Buffer.from(data!, "base64")), d.final()]).toString("utf8")).toBe("lösen ord 123");
    expect(key).toMatch(/^\d{16}$/);
  });

  it("gives a ten-digit personal number its century, leaves other numbers alone", () => {
    const now = new Date(2026, 9, 24);
    expect(axfoodFullPersonalNumber("8708302479", now)).toBe("198708302479");
    expect(axfoodFullPersonalNumber("1501011234", now)).toBe("201501011234");
    expect(axfoodFullPersonalNumber("198708302479", now)).toBe("198708302479");
    expect(axfoodFullPersonalNumber("9752299038061650", now)).toBe("9752299038061650");
  });

  it("posts the encrypted fields and reads login_successful", async () => {
    let sent: Record<string, string> = {};
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      if (url.endsWith("/login")) {
        sent = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ login_successful: "false" }), { status: 200 });
      }
      return new Response("<html/>", { status: 200, headers: { "set-cookie": "JSESSIONID=abc; Path=/" } });
    });
    await expect(axfoodLoginHttp(AXFOOD_SITES.hemkop!, "198708302479", "fel")).rejects.toThrow(/avvisade inloggningen/);
    expect(Object.keys(sent).sort()).toEqual(["j_password", "j_password_key", "j_remember_me", "j_username", "j_username_key"]);
    expect(sent.j_password).not.toContain("fel");
    await expect(axfoodLoginHttp(AXFOOD_SITES.hemkop!, "x@y.se", "p")).rejects.toThrow(/personnummer/);
  });
});

describe("several stores", () => {
  const cfg = (sendTo?: string) =>
    ({
      integrations: [
        { id: "grocery", category: "grocery", provider: "ica", settings: {} },
        { id: "g-citygross", category: "grocery", provider: "citygross", settings: {} },
        { id: "price", category: "price", provider: "spot", settings: {} },
      ],
      shopping: { source: "local", mappings: {}, sendTo },
    }) as unknown as Config;

  it("lists them all and sends to the chosen one, else the first", () => {
    expect(groceryIntegrations(cfg()).map((g) => g.provider.meta.id)).toEqual(["ica", "citygross"]);
    expect(groceryIntegration(cfg())?.provider.meta.id).toBe("ica");
    expect(groceryIntegration(cfg("g-citygross"))?.provider.meta.id).toBe("citygross");
    expect(groceryIntegration(cfg("finns-inte"))?.provider.meta.id).toBe("ica");
  });
});
