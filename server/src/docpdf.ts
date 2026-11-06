import { createHash } from "node:crypto";
import { chromium } from "playwright-core";
import { docxToHtml } from "./docview.js";

/** Word -> PDF with the browser that is already in the image (it is only started for the moment it takes, one file at a time). */
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, Buffer>();
const MAX_CACHED = 8;

export async function docxToPdf(buf: Buffer): Promise<Buffer> {
  const key = createHash("sha1").update(buf).digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;
  // One at a time: a second request waits for the first instead of starting a second browser (small machines).
  const run = queue.then(() => convert(buf));
  queue = run.catch(() => {});
  const pdf = await run;
  cache.set(key, pdf);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
  return pdf;
}

async function convert(buf: Buffer): Promise<Buffer> {
  const html = await docxToHtml(buf);
  const browser = process.env.BROWSER_WS_URL
    ? await chromium.connect(process.env.BROWSER_WS_URL, { timeout: 30_000 })
    : await chromium.launch({
        headless: true,
        executablePath: process.env.CHROMIUM_PATH || undefined,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        timeout: 30_000,
      });
  try {
    const page = await browser.newPage();
    // The page is plain (no scripts, nothing fetched): block every network request to be sure.
    await page.route("**/*", (r) => (r.request().url().startsWith("data:") || r.request().url() === "about:blank" ? r.continue() : r.abort()));
    await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "14mm", bottom: "14mm", left: "14mm", right: "14mm" } });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}
