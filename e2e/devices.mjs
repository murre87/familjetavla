// Self-check on every device class: no page scroll on tablets, nothing behind the tab bar,
// no sideways overflow, no console errors, readable scale. Writes screenshots + a report.
//   node e2e/devices.mjs [url]   (default: the demo build, docs/demo/familjetavla-demo.html)
// Exit code 1 if any check fails. Screenshots in $SHOTS/devices (default e2e/shots/devices).
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright-core");
const fs = require("node:fs");
const S = `${process.env.SHOTS ?? "e2e/shots"}/devices`;
fs.mkdirSync(S, { recursive: true });
const URL = process.argv[2] ?? pathToFileURL(resolve("docs/demo/familjetavla-demo.html")).href;
const LIST = [
  ["iPad liggande", "iPad Pro 11 landscape", true],
  ["iPad stående", "iPad Pro 11", true],
  ["iPad mini stående", "iPad Mini", true],
  ["Android-platta liggande", "Galaxy Tab S4 landscape", true],
  ["Android-platta stående", "Galaxy Tab S4", true],
  ["Android-mobil", "Pixel 7", false],
  ["iPhone", "iPhone 15 Pro", false],
  ["iPhone SE", "iPhone SE (3rd gen)", false],
  ["iPhone liggande", "iPhone 15 Pro landscape", false],
  // A MagicMirror-style screen behind glass: Full HD on its side, no touch.
  ["Spegel 1080×1920", { viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, userAgent: "Mozilla/5.0 (X11; Linux aarch64) Chrome/130 Safari/537.36" }, true],
];
// PART=1/3 runs every third device (for running in parallel).
const [partNo, parts] = (process.env.PART ?? "1/1").split("/").map(Number);
const only = process.env.ONLY ? new RegExp(process.env.ONLY, "i") : null;
const DEVICES = LIST.filter((_, i) => i % parts === partNo - 1).filter(([n]) => !only || only.test(n));
const ROUTES = [
  ["guide-hem", "#/setup/hem"], ["guide-familj", "#/setup/familj"], ["guide-kalendrar", "#/setup/kalendrar"], ["guide-omsorg", "#/setup/familj", "care4"], ["guide-skola", "#/setup/skola"], ["guide-huset", "#/setup/huset"], ["guide-musik", "#/setup/huset", "radio"], ["guide-edlevo", "#/setup/skola", "edlevo"], ["guide-startskarm", "#/setup/visning"], ["guide-klart", "#/setup/klart"],
  ["planera", "", "plan"], ["handelse", "", "event"], ["handelse-utgar", "", "eventCancel"], ["skjuts", "#/sida/veckan", "sport"], ["uppgift", "#/sida/skolan", "task"], ["nyhet", "#/sida/skolan", "news"], ["nyhet-vecka", "#/sida/skolan", "newsadd"], ["lagg-till", "#/lagg-till"],
  ["start", ""], ["ordna", "", "arrange"], ["veckan", "#/sida/veckan"], ["kort", "#/sida/kort"], ["maten", "#/sida/maten"], ["skolan", "#/sida/skolan"], ["skolan-tider", "?lektioner=tider#/sida/skolan"], ["komihag", "#/sida/komihag"], ["komihag-nyhet", "#/sida/komihag", "reminderNews"], ["inkop", "#/sida/inkop"], ["hososs", "#/sida/hososs"], ["energi", "#/flik/energy"], ["bil", "#/flik/cars"], ["ljus", "#/flik/lights"], ["musik", "#/flik/music"], ["musik-ovriga", "#/flik/music", "otherStations"], ["musik-spotify", "#/flik/music", "library"], ["musik-poddar", "#/flik/music", "podcasts"], ["musik-spellista", "#/flik/music", "playlist"], ["musik-utan-ma", "?utan-ma#/flik/music", "noAssistant"], ["sakerhet", "#/flik/security"], ["sakerhet-kamera", "#/flik/security", "bigCamera"], ["hushall", "#/flik/household"], ["eink-start", "?tema=eink"], ["eink-veckan", "?tema=eink#/sida/veckan"], ["eink-ljus", "?tema=eink#/flik/lights"], ["spegel-start", "?tema=spegel"]];
// ROUTES_ONLY=ljus,uppgift checks just those views (quick local runs).
const routeOnly = process.env.ROUTES_ONLY?.split(",");
if (routeOnly) ROUTES.splice(0, ROUTES.length, ...ROUTES.filter(([r]) => routeOnly.includes(r)));
const report = [];
const line = (row) => {
  if (row.issues.length || row.more?.length) console.log(`${row.issues.length ? "FEL " : "obs "} ${row.device} · ${row.route}: ${row.issues.join("; ")} ${row.more?.length ? `[knappar: ${row.more.join(" / ")}]` : ""}`);
};
for (const [theme, clock] of [["ljust", "2026-10-18T16:00:00+02:00"], ["mörkt", "2026-10-18T20:30:00+02:00"]])
for (const [name0, dev, tablet] of DEVICES) {
  const name = `${name0} ${theme}`;
  const d = typeof dev === "string" ? devices[dev] : dev;
  // A fresh browser per device keeps memory in check over 300 views.
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await b.newContext({ ...d, locale: "sv-SE", timezoneId: "Europe/Stockholm" });
  const p = await ctx.newPage();
  const errors = [];
  let at = "";
  p.on("pageerror", (e) => errors.push(`${e.message} (${at}) ${(e.stack ?? "").split("\n")[1]?.trim() ?? ""}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`${m.text()} (${at}) ${m.location().url?.slice(-40)}:${m.location().lineNumber}`));
  await p.clock.install({ time: new Date(clock) });
  const slug = name.replace(/[^a-zåäö]+/gi, "-").toLowerCase();
  for (const [r, hash, open] of ROUTES) {
   try {
    at = r;
    await p.goto("about:blank");
    await p.goto(URL + hash);
    // Measure like a real board: the demo's extra header buttons don't exist there.
    await p.addStyleTag({ content: ".demo-only{display:none!important}" });
    await p.waitForTimeout(1400);
    if (open === "plan") await p.getByRole("button", { name: /Planera veckan/ }).first().click();
    if (open === "event") await p.locator(".now-item").first().click();
    if (open === "edlevo") {
      await p.getByRole("button", { name: /Har ni Edlevo/ }).click();
      await p.locator(".edlevo-help").scrollIntoViewIfNeeded();
    }
    if (open === "sport") {
      await p.locator(".event", { hasText: "F14" }).first().click();
      await p.locator(".event-text").scrollIntoViewIfNeeded();
    }
    if (open === "care4") {
      await p.locator(".care-box").first().locator("label.field", { has: p.locator("span", { hasText: /^Schema$/ }) }).locator("select").selectOption("4");
      await p.locator(".care-box").first().scrollIntoViewIfNeeded();
    }
    if (open === "news" || open === "newsadd") {
      await p.locator(".news-strip").first().click();
      await p.waitForTimeout(300);
      if (await p.locator(".news-row").count()) await p.locator(".news-row").first().click();
      await p.waitForTimeout(400);
      if (open === "newsadd") {
        await p.getByRole("button", { name: /Lägg i veckan/ }).click();
        await p.locator(".news-add").scrollIntoViewIfNeeded();
      }
    }
    if (open === "radio") {
      await p.getByLabel("Sök radiokanal").fill("P4");
      await p.getByRole("button", { name: "Sök", exact: true }).click();
      await p.locator(".station-hits").scrollIntoViewIfNeeded();
    }
    if (open === "arrange") {
      // Hold a card: the home screen goes into "Ordna startsidan".
      const card = p.locator(".wsize > .card").first();
      await card.scrollIntoViewIfNeeded();
      const b = await card.boundingBox();
      // A card taller than the screen is centred, so its top can be off screen: hold the visible part.
      await p.mouse.move(b.x + b.width / 2, Math.max(b.y, 0) + 20);
      await p.mouse.down();
      await p.waitForTimeout(800);
      await p.mouse.up();
      await p.locator(".arrange-bar").waitFor();
      // On a phone, look at the whole list like a person scrolling down it.
      if (!tablet) await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    }
    if (open === "otherStations") {
      await p.getByRole("button", { name: /Fler kanaler/ }).click();
      await p.getByRole("radio", { name: "Övriga" }).click();
      await p.locator(".station-row").first().waitFor();
      // On a phone the list is further down: scroll there like a person would.
      await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    }
    if (open === "playlist") {
      await p.getByRole("tab", { name: /Spotify|Bibliotek/ }).click();
      await p.locator(".cover").first().click();
      await p.locator(".track-row").first().waitFor();
      await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    }
    if (open === "library" || open === "podcasts") {
      await p.getByRole("tab", { name: /Spotify|Bibliotek/ }).click();
      if (open === "podcasts") await p.getByRole("tab", { name: "Poddar" }).click();
      await p.locator(".cover").first().waitFor();
      await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    }
    if (open === "noAssistant") {
      await p.getByRole("tab", { name: /Spotify|Bibliotek/ }).click();
      await p.locator(".lib-setup .btn").first().waitFor();
      await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    }
    if (open === "eventCancel") {
      await p.locator(".event").first().click();
      await p.getByRole("button", { name: "Utgår" }).click();
    }
    if (open === "reminderNews") await p.locator(".reminder-link").first().click();
    if (open === "bigCamera") {
      await p.locator(".camera").first().click();
      // On a phone, look at the whole page like a person scrolling down it.
      if (!tablet) await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    }
    if (open === "task") await p.locator(".task-row", { hasText: "Prov i NO" }).first().click();
    if (open) await p.waitForTimeout(600);
    if (!tablet && !open && !hash.startsWith("#/setup")) await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await p.waitForTimeout(300);
    const m = await p.evaluate((tablet) => {
      const de = document.documentElement;
      const out = { covered: [], overlap: [], cut: [], more: [...document.querySelectorAll(".fit-more")].map((m) => m.textContent.trim()), pageScroll: de.scrollHeight - window.innerHeight, sideways: de.scrollWidth - window.innerWidth, behind: [], overflow: [], scales: [], small: 0 };
      const bar = document.querySelector(".tabbar")?.getBoundingClientRect();
      const overlay = document.querySelector(".overlay");
      if (bar && overlay) {
        // A sheet must lie on top of the tab bar, not under it.
        const hit = document.elementFromPoint(bar.left + bar.width / 2, bar.top + bar.height / 2);
        if (hit && !hit.closest(".overlay")) out.behind.push("rutan ligger under flikraden");
      } else if (bar) {
        // Visible content (cards, events, lessons, buttons) that sits under the floating tab bar.
        for (const el of document.querySelectorAll(".board .card, .board .event, .board .lesson, .board .btn, .board h2")) {
          if (el.closest(".tabbar")) continue;
          const r = el.getBoundingClientRect();
          if (r.height === 0) continue;
          // Ignore what is clipped away by a fit area (not visible) – check the visible part only.
          const clip = el.closest(".fit")?.getBoundingClientRect();
          const bottom = clip ? Math.min(r.bottom, clip.bottom) : r.bottom;
          const top = clip ? Math.max(r.top, clip.top) : r.top;
          if (bottom - top < 4) continue;
          if (bottom > bar.top + 2 && top < bar.bottom && r.right > bar.left && r.left < bar.right) out.behind.push((el.textContent || el.className).trim().slice(0, 30));
        }
      }
      // Text checks: every visible piece of text must be on top (not covered), not overlap other
      // text, and not be cut by the edge of its card. Ellipsis (…) on purpose is fine.
      const texts = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim()) continue;
        const el = n.parentElement;
        if (!el || el.closest("svg, script, style, .sky, [aria-hidden=true], .fit-more")) continue;
        // With a sheet open, the board behind it is meant to be covered: check the sheet only.
        if (document.querySelector(".overlay") && !el.closest(".overlay")) continue;
        // Inside a closed <details> or otherwise not rendered.
        if (el.checkVisibility && !el.checkVisibility()) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (let r of range.getClientRects()) {
          if (r.width < 2 || r.height < 2) continue;
          if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
          // A radio station's scrolling text slides on purpose.
          if (el.closest(".ticker")) continue;
          // Hidden by a fit area or a scroll box? Then it is not shown – skip.
          let clipped = false;
          for (let a = el; a && a !== document.body; a = a.parentElement) {
            const s2 = getComputedStyle(a);
            if (s2.display === "none") { clipped = true; break; }
            if (s2.overflowY !== "visible" || s2.overflowX !== "visible") {
              const cr = a.getBoundingClientRect();
              if (r.bottom <= cr.top + 1 || r.top >= cr.bottom - 1 || r.right <= cr.left + 1 || r.left >= cr.right - 1) { clipped = true; break; }
              // Partly outside its box (cut text) – unless that box shows an ellipsis on purpose.
              const cut = r.bottom > cr.bottom + 2 || r.top < cr.top - 2 || ((r.right > cr.right + 2 || r.left < cr.left - 2) && s2.textOverflow !== "ellipsis" && cs.textOverflow !== "ellipsis");
              const scroller = s2.overflowY === "auto" || s2.overflowY === "scroll";
              if (cut && !scroller && !a.classList.contains("fit")) out.cut.push(n.textContent.trim().slice(0, 24));
            }
          }
          if (clipped) continue;
          // What is actually visible: the part of the text inside every clipping box (ellipsis, line clamp).
          for (let a = el; a && a !== document.body; a = a.parentElement) {
            const s3 = getComputedStyle(a);
            if (s3.overflowX === "visible" && s3.overflowY === "visible") continue;
            const cr = a.getBoundingClientRect();
            r = new DOMRect(Math.max(r.left, cr.left), Math.max(r.top, cr.top), Math.max(0, Math.min(r.right, cr.right) - Math.max(r.left, cr.left)), Math.max(0, Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top)));
          }
          if (r.width < 2 || r.height < 2) continue;
          // Line boxes are taller than the letters (big numbers especially): compare the middle of the line.
          const pad = r.height * 0.22;
          texts.push({ el, r: { left: r.left, right: r.right, width: r.width, top: r.top + pad, bottom: r.bottom - pad, height: r.height - 2 * pad }, t: n.textContent.trim().slice(0, 24) });
        }
      }
      for (const { el, r, t } of texts) {
        const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 2);
        const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 2);
        const top = document.elementFromPoint(x, y);
        if (top && top !== el && !el.contains(top) && !top.contains(el)) {
          const what = top.closest(".tabbar") ? "flikraden" : top.closest(".overlay, .sheet") ? "en ruta" : (top.className?.baseVal ?? top.className ?? top.tagName).toString().split(" ")[0];
          if (!el.closest(".overlay") || top.closest(".overlay")) out.covered.push(`"${t}" under ${what}`);
        }
      }
      for (let i = 0; i < texts.length; i++) {
        for (let j = i + 1; j < texts.length; j++) {
          const A = texts[i], B = texts[j];
          if (A.el === B.el || A.el.contains(B.el) || B.el.contains(A.el)) continue;
          const w = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
          const h = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
          if (w > 3 && h > 3 && w * h > 0.25 * Math.min(A.r.width * A.r.height, B.r.width * B.r.height)) out.overlap.push(`"${A.t}" / "${B.t}"`);
        }
      }
      for (const f of document.querySelectorAll(".fit")) {
        const z = Number(f.firstElementChild?.style.zoom || 1);
        out.scales.push(Math.round(z * 100));
        if (f.classList.contains("fit-overflow")) out.overflow.push(f.className.replace("fit", "").trim());
      }
      for (const btn of document.querySelectorAll("button, a.btn")) {
        const r = btn.getBoundingClientRect();
        if (r.width && r.height && r.height < 32 && r.top < window.innerHeight && r.bottom > 0) out.small++;
      }
      return out;
    }, tablet);
    await p.screenshot({ path: `${S}/${slug}-${r}.png` });
    const issues = [];
    if (tablet && !r.startsWith("guide") && m.pageScroll > 2) issues.push(`sidan scrollar ${m.pageScroll}px`);
    if (m.sideways > 2) issues.push(`sticker ut ${m.sideways}px åt sidan`);
    if (m.behind.length) issues.push(`bakom flikraden: ${[...new Set(m.behind)].slice(0, 3).join(" | ")}`);
    if (m.covered.length) issues.push(`täckt text: ${[...new Set(m.covered)].slice(0, 4).join(" | ")}`);
    if (m.overlap.length) issues.push(`text på text: ${[...new Set(m.overlap)].slice(0, 4).join(" | ")}`);
    if (m.cut.length) issues.push(`kapad text: ${[...new Set(m.cut)].slice(0, 4).join(" | ")}`);
    // "Alla kort" and "Kommande 7 dagar" are the show-everything pages: scrolling there is allowed as a last resort.
    if (tablet && m.overflow.length && !["kort", "veckan"].includes(r)) issues.push(`ryms inte ens på 70 %: ${m.overflow.join(", ")}`);
    const minScale = m.scales.length ? Math.min(...m.scales) : 100;
    const row = { device: name, route: r, issues, minScale, small: m.small, more: m.more };
    report.push(row);
    line(row);
   } catch (e) {
    const row = { device: name, route: r, issues: [`kunde inte provas: ${e.message.split("\n")[0]}`], minScale: 100 };
    report.push(row);
    line(row);
   }
  }
  const crow = { device: name, route: "konsol", issues: errors.slice(0, 3), minScale: 100, small: 0 };
  report.push(crow);
  line(crow);
  await ctx.close();
  await b.close();
}
fs.writeFileSync(`${S}/report-${partNo}.json`, JSON.stringify(report, null, 1));
const bad = report.filter((r) => r.issues.length).length;
console.log(`\n${report.length} kontroller, ${bad} med fel`);
if (bad) process.exit(1);
