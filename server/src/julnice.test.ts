import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "ft-julnice-"));

describe("snällistan", () => {
  it("lägger till, byter namn, bockar av och tar bort, och sparar mellan anrop", async () => {
    const { applyJulNice, loadJulNice } = await import("./julnice.js");
    expect(loadJulNice()).toEqual([]);
    const a = applyJulNice("add_item", { item: "Maja", description: '{"emoji":"🧒","score":75}' }) as { items: { uid: string; summary: string; status: string }[] };
    expect(a.items.map((i) => i.summary)).toEqual(["Maja"]);
    expect(a.items[0].status).toBe("needs_action");
    const uid = a.items[0].uid;
    applyJulNice("update_item", { item: uid, description: '{"score":80}' });
    applyJulNice("update_item", { item: "Maja", rename: "Majsan", status: "completed" });
    const now = loadJulNice();
    expect(now).toHaveLength(1);
    expect(now[0]).toMatchObject({ uid, summary: "Majsan", status: "completed", description: '{"score":80}' });
    applyJulNice("remove_item", { item: [uid] });
    expect(loadJulNice()).toEqual([]);
  });
  it("vägrar tomma och dubbla namn, okända poster och en full lista", async () => {
    const { applyJulNice, loadJulNice } = await import("./julnice.js");
    expect(applyJulNice("add_item", { item: "  " })).toEqual({ error: "Namn saknas." });
    applyJulNice("add_item", { item: "Ola" });
    expect(applyJulNice("add_item", { item: "Ola" })).toEqual({ error: "Finns redan." });
    expect(applyJulNice("update_item", { item: "finns-inte", status: "completed" })).toEqual({ error: "Hittar inte posten." });
    expect(applyJulNice("update_item", { item: "Ola", rename: "" })).toEqual({ error: "Namn saknas." });
    for (let i = 0; i < 80; i++) applyJulNice("add_item", { item: `Barn ${i}` });
    expect(loadJulNice()).toHaveLength(60);
    expect(applyJulNice("add_item", { item: "En till" })).toEqual({ error: "Listan är full." });
  });
  it("kortar långa namn och beskrivningar", async () => {
    const { applyJulNice } = await import("./julnice.js");
    (await import("./store.js")).saveLocal({ julNice: [] });
    const r = applyJulNice("add_item", { item: "x".repeat(200), description: "y".repeat(9000) }) as { items: { summary: string; description?: string }[] };
    const it = r.items.find((i) => i.summary.startsWith("xxx"))!;
    expect(it.summary).toHaveLength(60);
    expect(it.description).toHaveLength(4000);
  });
});
