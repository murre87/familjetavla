// End-to-end check of an installed Familjetavla, driven in a real browser.
//
//   node e2e/run.mjs <base-url> <scenario>
//
// Scenarios:
//   addon    first run through Home Assistant ingress (mock Supervisor), HA calendar on the board
//   docker   first run on port 8099 without Home Assistant, sets a PIN, pairs a second screen
//   restart  after a container restart: the board comes back with its settings
//
// Fails (exit 1) on any console error, failed page request or missing content.
// Screenshots go to $SHOTS (default e2e/shots).
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const [base, scenario] = process.argv.slice(2);
if (!base || !scenario) throw new Error("usage: node e2e/run.mjs <base-url> <addon|docker|restart>");
const shots = process.env.SHOTS ?? "e2e/shots";
mkdirSync(shots, { recursive: true });

const problems = [];
// External look-ups (postcode, weather, prices) depend on outside services; note them, don't fail on them.
const notes = [];
const external = (url) => /\/api\/(postcode|geocode)\b/.test(url);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

function watch(page, who) {
  // After 22:00 the board dims behind a night veil that needs a tap first – as on the wall.
  // CI runs at any hour, so tap it away whenever it shows up.
  page.addLocatorHandler(page.locator(".night-veil"), async (veil) => {
    await veil.click();
  });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // The browser logs every 4xx/5xx as a console error too; those are judged by the response handler.
    if (/Failed to load resource: the server responded with a status of/.test(m.text())) return;
    problems.push(`${who} console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`${who} page error: ${e.message}`));
  page.on("response", (r) => {
    const url = r.url();
    // A locked screen is expected to get 401 until it is unlocked.
    if (r.status() < 400 || (r.status() === 401 && who.includes("ny skärm"))) return;
    if (external(url)) notes.push(`${who} ${r.status()} ${url} (extern tjänst)`);
    else problems.push(`${who} ${r.status()} ${r.request().method()} ${url}`);
  });
  page.on("requestfailed", (r) => {
    // The event stream is cut when the page navigates or closes.
    if (!r.url().endsWith("/api/events")) problems.push(`${who} failed ${r.url()}: ${r.failure()?.errorText}`);
  });
}

async function shot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/${scenario}-${name}.png`, fullPage: true });
}

// The custody card says "Ella är här" most days, but "Ella byter hem imorgon" the day before a handover (Sundays in the demo):
// the check must not depend on which weekday the test happens to run.
const ELLA = /Ella är här|Ella byter hem/;

async function expectText(page, text, timeout = 30_000) {
  // The first match in the document can be a copy the board has hidden to make things fit: wait for one that shows.
  try {
    await page.getByText(text, { exact: false }).locator("visible=true").first().waitFor({ state: "visible", timeout });
  } catch (e) {
    throw new Error(`väntade ${timeout / 1000} s på texten ${text} men den syntes inte (${page.url()})`);
  }
}

async function next(page) {
  await page.getByRole("button", { name: /^(Nästa|Hoppa över)/ }).click();
  await page.waitForTimeout(500);
}

async function firstRun(page, { haCalendar }) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await expectText(page, "Välkommen till Familjetavlan");
  await page.getByLabel("Vad heter hushållet?").fill("Familjen Test");
  await page.getByLabel("Postnummer").fill("55318");
  await shot(page, "1-hem");
  await next(page);

  await expectText(page, "Vilka bor här?");
  for (const [kind, name] of [["Vuxen", "Anna"], ["Vuxen", "Emil"], ["Barn", "Maja"], ["Barn", "Ella"]]) {
    await page.getByRole("button", { name: kind, exact: true }).click();
    await page.getByLabel(kind === "Barn" ? "Barnets namn" : "Namn", { exact: true }).last().fill(name);
  }
  await page.getByLabel("Bor här").last().selectOption("alternating");
  // An extra row left without a name must not block the guide (it is dropped on save).
  await page.getByRole("button", { name: "Vuxen", exact: true }).click();
  await shot(page, "2-familj");
  await next(page);

  await expectText(page, "Lägg till familjens kalendrar");
  if (haCalendar) {
    await page.getByRole("button", { name: /Kalender i Home Assistant/ }).click();
    await page.getByLabel("Kalender", { exact: true }).selectOption("calendar.familj");
    await page.getByRole("button", { name: "Klar", exact: true }).click();
    await expectText(page, "Familjen");
  }
  await shot(page, "3-kalendrar");
  await next(page);

  await expectText(page, "Skola och förskola");
  await page.getByRole("button", { name: /SchoolSoft/ }).first().waitFor();
  await shot(page, "4-skola");
  await next(page);

  await expectText(page, "Tavlan är redo");
  await shot(page, "5-klart");
}

async function finish(page) {
  await page.getByRole("button", { name: "Spara och visa tavlan" }).click();
  await expectText(page, "Kommande 7 dagar");
  await page.waitForTimeout(3000);
  await checkBoard(page);
}

/** The iPad layout uses both side columns, and "Planera veckan" is always reachable. */
async function checkBoard(page) {
  const counts = await page.evaluate(() => ({
    left: document.querySelector(".area-left")?.children.length ?? 0,
    side: document.querySelector(".area-side")?.children.length ?? 0,
  }));
  if (!counts.left || !counts.side) problems.push(`tavlan: tom kolumn på iPad (vänster ${counts.left}, höger ${counts.side})`);
  await page.getByRole("button", { name: /Planera veckan/ }).first().waitFor({ timeout: 5000 });
  const people = await page.evaluate(() => fetch("api/config").then((r) => r.json()).then((c) => c.config.people.map((p) => p.name)));
  if (people.includes("")) problems.push("tavlan: en namnlös person sparades");
}

const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: "sv-SE", timezoneId: "Europe/Stockholm" });
const page = await ctx.newPage();
watch(page, "tavlan");

async function main() {
if (scenario === "addon") {
  await firstRun(page, { haCalendar: true });
  await finish(page);
  await expectText(page, "Middag hos mormor");
  await expectText(page, ELLA);
  await shot(page, "6-tavlan");
  await page.getByRole("button", { name: /Planera veckan/ }).first().click();
  await expectText(page, "Vem gör vad");
  await shot(page, "7-planera");
} else if (scenario === "docker") {
  await firstRun(page, { haCalendar: false });
  await page.getByLabel("PIN-kod", { exact: true }).fill("4321");
  await finish(page);
  await expectText(page, ELLA);
  await shot(page, "6-tavlan");

  // Every card opens its own page, with Tillbaka and Hem; the browser's back button works too.
  await page.locator(".custody").first().click();
  await expectText(page, "kommande fyra veckor");
  await page.getByRole("button", { name: "Tillbaka" }).click();
  await expectText(page, "Kommande 7 dagar");
  await page.locator(".card").filter({ hasText: "Inköpslista" }).first().locator("h2").click();
  await expectText(page, "Lägg till vara");
  await page.getByRole("button", { name: "Till startsidan" }).click();
  await expectText(page, ELLA);
  await page.locator(".custody").first().click();
  await page.goBack();
  await expectText(page, "Kommande 7 dagar");

  // A second screen on the network must unlock with the PIN before it sees anything.
  const other = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "sv-SE", timezoneId: "Europe/Stockholm" });
  const phone = await other.newPage();
  watch(phone, "ny skärm");
  await phone.goto(base, { waitUntil: "domcontentloaded" });
  await expectText(phone, "Lås upp skärmen");
  await shot(phone, "7-las-upp");
  const status = await phone.request.get(new URL("api/dashboard", base).toString());
  if (status.status() !== 401) problems.push(`ny skärm: api/dashboard gav ${status.status()} utan PIN, väntade 401`);
  await phone.getByLabel("PIN-kod").fill("0000");
  await phone.getByRole("button", { name: "Lås upp" }).click();
  await expectText(phone, "Fel PIN-kod");
  await phone.getByLabel("PIN-kod").fill("4321");
  await phone.getByRole("button", { name: "Lås upp" }).click();
  await expectText(phone, ELLA);
  await shot(phone, "8-telefon");
  } else if (scenario === "restart") {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await expectText(page, "Kommande 7 dagar");
  await expectText(page, ELLA);
  if (process.env.EXPECT_TEXT) await expectText(page, process.env.EXPECT_TEXT);
  await page.waitForTimeout(3000);
  await shot(page, "tavlan");
} else {
  throw new Error(`unknown scenario ${scenario}`);
}

}

try {
  await main();
} catch (e) {
  problems.push(`stopp: ${(e).message.split("\n")[0]}`);
  await page.screenshot({ path: `${shots}/${scenario}-FEL.png`, fullPage: true }).catch(() => {});
  console.error(`Sidan just då:\n${(await page.innerText("body").catch(() => "")).slice(0, 1200)}`);
}
await browser.close();
for (const n of notes) console.log(`  (notering) ${n}`);
if (problems.length) {
  console.error(`${scenario}: ${problems.length} problem`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`${scenario}: OK`);
