import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "ft-jul-"));
process.env.DATA_DIR = dir;

describe("befintliga inställningar får julkortet", () => {
  it("en config från före julkortet får rutan Jul påslagen och fliken Jul, utan att något annat ändras", async () => {
    const store = await import("./store.js");
    const old = store.defaultConfig();
    old.dashboard.home = old.dashboard.home.filter((w) => w.id !== "jul").map((w) => ({ ...w, on: w.id === "meals" ? false : w.on }));
    old.dashboard.tabs = old.dashboard.tabs.filter((t) => t.id !== "jul");
    writeFileSync(join(dir, "config.json"), JSON.stringify(old));
    const now = store.loadConfig();
    const ids = now.dashboard.home.map((w) => w.id);
    expect(now.dashboard.home.find((w) => w.id === "jul")).toEqual({ id: "jul", on: true });
    expect(ids.indexOf("jul")).toBe(ids.indexOf("now") + 1); // direkt efter Nu
    expect(now.dashboard.home.find((w) => w.id === "meals")?.on).toBe(false); // familjens egna val rörs inte
    expect(now.dashboard.tabs.find((t) => t.id === "jul")).toEqual({ id: "jul", on: true });
    expect(now.dashboard.christmas).toBeUndefined(); // automatiskt tills familjen väljer
  });
});
