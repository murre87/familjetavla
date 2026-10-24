// Live check of the outside services the board reads without logging in.
//   node e2e/sources.mjs   (needs `npm run build -w server` first)
// - Every waste company in "Sök på adress" (EDP Future), SRV Återvinning, skolmaten.se,
//   elpriset, vädret and postnummer – with real requests.
// - Test addresses are read from Waste Collection Schedule's own sources, so they stay current.
// - Those upstream files are also watched: a change means our port should be looked over.
// Writes a Markdown report to $REPORT (default sources-report.md); exit 1 if anything fails.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { EDP_PARKED, EDP_PROVIDERS, edpSchedule, edpSearch, srvSchedule, srvSuggest, sthlmSchedule } from "../server/dist/connectors/waste.js";
import { fetchPrices } from "../server/dist/connectors/elpris.js";
import { forecast } from "../server/dist/connectors/weather.js";
import { lookupPostcode } from "../server/dist/connectors/geo.js";
import { detectGroups, fetchIcs } from "../server/dist/connectors/ics.js";
import { AXFOOD_SITES, axfoodLoginHttp, axfoodOffers, axfoodSearch } from "../server/dist/connectors/axfood.js";
import { cityGrossSearch, cityGrossStore } from "../server/dist/connectors/citygross.js";
import { vklassLogin, vklassWelcome } from "../server/dist/connectors/vklass.js";
import { skolmaten, vklass } from "../server/dist/providers/school.js";
import { findStations, swedishStations } from "../server/dist/music.js";

const cfg = JSON.parse(readFileSync(new URL("../.github/upstream-sources.json", import.meta.url), "utf8"));
const problems = [];
const ok = [];
const day = (d) => d.toISOString().slice(0, 10);

// ---- Upstream files: fetch once, watch the hash, read test addresses ----
const upstream = {};
for (const [file, info] of Object.entries(cfg.files)) {
  const raw = `https://raw.githubusercontent.com/${cfg.repo}/master/${cfg.path}/${file}`;
  try {
    const res = await fetch(raw);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    upstream[file] = text;
    const sha = createHash("sha256").update(text).digest("hex");
    if (sha === info.sha256) ok.push(`${file}: oförändrad`);
    else
      problems.push(
        `**${file} har ändrats i Waste Collection Schedule.** Se över ${info.ours} mot ändringen och uppdatera hashen i .github/upstream-sources.json.\n` +
          `  Historik: https://github.com/${cfg.repo}/commits/master/${cfg.path}/${file}\n  Ny sha256: \`${sha}\``,
      );
  } catch (e) {
    problems.push(`${file}: kunde inte hämtas från GitHub (${e.message}).`);
  }
}

/** Test cases in a Waste Collection Schedule source: [{ street_address, url, service_provider }]. */
function testCases(text = "") {
  const block = /TEST_CASES\s*=\s*\{([\s\S]*?)\n\}/.exec(text)?.[1] ?? "";
  return [...block.matchAll(/\{([^{}]*)\}/g)].map(([, body]) => {
    const get = (k) => new RegExp(`"${k}"\\s*:\\s*"([^"]*)"`).exec(body)?.[1];
    return { address: get("street_address"), url: get("url"), sp: get("service_provider") };
  });
}
const norm = (u = "") => u.toLowerCase().replace(/\/+$/, "");
const edpEvent = upstream["edpevent_se.py"] ?? "";
const spUrl = Object.fromEntries([...edpEvent.matchAll(/"([\w-]+)":\s*\{[^{}]*?"api_url":\s*"([^"]+)"/g)].map(([, k, u]) => [k, norm(u)]));

function addressesFor(key, apiUrl) {
  const own = cfg.edp?.[key];
  if (own) {
    const filter = own.filter ? new RegExp(own.filter, "i") : null;
    return testCases(upstream[own.file]).map((t) => t.address).filter((a) => a && (!filter || filter.test(a)));
  }
  return testCases(edpEvent)
    .filter((t) => t.address && (norm(t.url) === norm(apiUrl) || spUrl[t.sp] === norm(apiUrl)))
    .map((t) => t.address);
}

// ---- Every EDP Future company in the wizard's list (and the parked ones) ----
const edpRows = [];
const parkedNotes = [];
for (const [key, p] of [...Object.entries(EDP_PROVIDERS), ...Object.entries(EDP_PARKED)]) {
  const isParked = key in EDP_PARKED;
  const addresses = [...new Set([...(cfg.edp?.[key]?.extra ?? []), ...addressesFor(key, p.apiUrl)])].slice(0, 4);
  if (!addresses.length) {
    if (isParked) { parkedNotes.push(`${p.title}: ingen testadress`); continue; }
    problems.push(`**${p.title}:** ingen testadress finns – lägg till en under edp.${key}.extra i .github/upstream-sources.json.`);
    edpRows.push(`| ${p.title} | – | ingen testadress |`);
    continue;
  }
  const tried = [];
  let done = false;
  for (const address of addresses) {
    try {
      const found = await edpSearch(p.apiUrl, address);
      if (!found.length) {
        tried.push(`"${address}": ingen träff`);
        continue;
      }
      const pickups = await edpSchedule(p.apiUrl, found[0]);
      if (!pickups.length) {
        tried.push(`"${found[0]}": inga kommande hämtningar`);
        continue;
      }
      if (isParked) problems.push(`**${p.title} fungerar igen** (${found[0]} → ${pickups.length} kärl) – flytta tillbaka från EDP_PARKED till EDP_PROVIDERS.`);
      else ok.push(`${p.title}: ${found[0]} → ${pickups.length} kärl, nästa ${day(pickups[0].date)} ${pickups[0].type}`);
      edpRows.push(`| ${p.title} | ${found[0]} | ✅ ${pickups.length} kärl, nästa ${day(pickups[0].date)} |`);
      done = true;
      break;
    } catch (e) {
      tried.push(`"${address}": ${e.message}`);
    }
  }
  if (!done) {
    // Tell "the site is down or blocks us" apart from "the site answers but finds nothing".
    try {
      const r = await fetch(p.apiUrl, { signal: AbortSignal.timeout(15_000) });
      tried.push(`startsidan svarar ${r.status}`);
    } catch (e) {
      tried.push(`startsidan nås inte (${e.cause?.code ?? e.cause?.message ?? e.message})`);
    }
    if (isParked) {
      parkedNotes.push(`${p.title}: fortfarande ur funktion – ${tried[tried.length - 1]}`);
      continue;
    }
    problems.push(`**${p.title} fungerar inte:** ${tried.join("; ")}`);
    edpRows.push(`| ${p.title} | ${addresses[0]} | ❌ ${tried[tried.length - 1]} |`);
  }
}

// ---- SRV Återvinning ----
try {
  const found = await srvSuggest("Skolvägen 10");
  const pick = found[0];
  if (!pick) throw new Error("adressförslagen gav inga träffar för Skolvägen 10");
  const pickups = await srvSchedule(pick);
  if (!pickups.length) throw new Error(`inga kommande hämtningar för ${pick}`);
  ok.push(`SRV: ${pick} → ${pickups.length} hämtningar, nästa ${day(pickups[0].date)} ${pickups[0].type}`);
} catch (e) {
  problems.push(`**SRV Återvinning fungerar inte:** ${e.message}. Jämför med srvatervinning_se.py.`);
}

// ---- Other public services ----
async function check(name, fn) {
  try {
    ok.push(`${name}: ${await fn()}`);
  } catch (e) {
    problems.push(`**${name} fungerar inte:** ${e.message}`);
  }
}
// Stockholm Vatten och Avfall (experimental): the address format is checked – a wrong one answers
// "Invalid address format". Real villa addresses answer an empty list from GitHub's machines in the
// US (likely only answered from Sweden, like RIX FM), so an empty list is noted, not failed.
await check("Stockholm Vatten och Avfall", async () => {
  const p = await sthlmSchedule("Daltorpsvägen 28, Vällingby, 16244").catch((e) => {
    if (/Hittade ingen hämtning/.test(e.message)) return null;
    throw e;
  });
  if (!p) return "adressformatet godkänns; tom lista från GitHubs maskiner (experimentell, provas av användare i Stockholm)";
  return `Daltorpsvägen 28, Vällingby → ${[...new Set(p.map((x) => x.type))].join(", ")}, nästa ${day(p[0].date)} ${p[0].type}`;
});
await check("Elpris (elprisetjustnu.se)", async () => {
  const p = await fetchPrices("SE3");
  if (!p.length) throw new Error("inga priser");
  return `${p.length} timmar för SE3`;
});
await check("Väder (Open-Meteo)", async () => {
  const f = await forecast(57.78, 14.16);
  if (!f) throw new Error("ingen prognos");
  return "prognos för Jönköping";
});
await check("Postnummer (OpenStreetMap)", async () => {
  const r = await lookupPostcode("55318");
  if (!/jönköping/i.test(r.municipality ?? r.place ?? "")) throw new Error(`55318 gav ${r.place}/${r.municipality}`);
  return `55318 → ${r.place}, ${r.municipality}, sophämtning: ${r.wasteProvider ?? "–"}`;
});
// Musik: the radio directory finds the stations families ask for, and their streams play.
// Sveriges Radio comes from its own API (api.sr.se), the rest from radio-browser.info.
// GitHub runs in the US: commercial Swedish stations often stream only inside Sweden (401/403),
// which is noted, not counted as broken. Sveriges Radio streams everywhere and must play.
async function streamAnswer(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const type = res.headers.get("content-type") ?? "";
  const reader = res.body?.getReader();
  const first = reader ? await reader.read().catch(() => ({ value: undefined })) : { value: undefined };
  await reader?.cancel().catch(() => {});
  return { status: res.status, type, audio: res.ok && (/audio|mpegurl|ogg|aac|octet-stream/i.test(type) || res.headers.has("icy-name")) && Boolean(first.value?.length) };
}
for (const [q, mustPlay] of [["P4 Jönköping", true], ["P4 Östergötland", true], ["P3", true], ["RIX FM", false]]) {
  await check(`Radiokatalog: ${q}`, async () => {
    const hits = (await findStations(q)).filter((h) => h.country === "SE" && h.name.toLowerCase().includes(q.toLowerCase()));
    if (!hits.length) throw new Error("hittade ingen svensk kanal med det namnet");
    const tried = [];
    for (const hit of hits.slice(0, 4)) {
      const a = await streamAnswer(hit.url).catch((e) => ({ status: 0, type: e.message, audio: false }));
      if (a.audio) return `${hit.name} · ${hit.quality ?? ""} · ${a.type} · ${hit.url.startsWith("https://") ? "https" : "http"}`;
      tried.push(`${new URL(hit.url).host} ${a.status || a.type}`);
    }
    if (!mustPlay && tried.every((t) => / 40[13]$/.test(t))) return `${hits.length} träffar, strömmarna svarar bara i Sverige (${tried.join(", ")})`;
    throw new Error(`ingen ström spelade: ${tried.join(", ")}`);
  });
}
await check("Radiokatalog: alla svenska kanaler (fliken Musik)", async () => {
  const all = await swedishStations();
  const sr = all.filter((x) => x.group === "sr");
  const missing = ["P1", "P3", "P4 Jönköping", "P4 Östergötland", "Mix Megapol", "RIX FM"].filter((n) => !all.some((x) => x.name.toLowerCase() === n.toLowerCase()));
  if (sr.length < 20 || missing.length) throw new Error(`${all.length} kanaler, ${sr.length} från Sveriges Radio${missing.length ? `, saknas: ${missing.join(", ")}` : ""}`);
  return `${all.length} kanaler, ${sr.length} från Sveriges Radio, t.ex. ${all.filter((x) => x.group === "other").slice(0, 4).map((x) => x.name).join(", ")}`;
});
for (const url of cfg.skolmaten ?? []) {
  await check(`Skolmaten.se (${url})`, async () => {
    const ctx = { integration: {}, settings: { url }, str: (k) => (k === "url" ? url : ""), secret: () => undefined, remember: () => {} };
    const now = new Date();
    const { food } = await skolmaten.fetch(ctx, now, new Date(now.getTime() + 14 * 86_400_000));
    if (!food.length) throw new Error("ingen mat de kommande två veckorna");
    return `${food.length} dagar, t.ex. ${food[0].dishes[0]}`;
  });
}

// ---- Willys / Hemköp product search (works without logging in) ----
for (const site of Object.values(AXFOOD_SITES)) {
  await check(`${site.label} produktsökning`, async () => {
    const hits = await axfoodSearch(site, "", "mjölk");
    if (!hits.length) throw new Error("sökningen på mjölk gav inga varor");
    if (!hits.every((h) => h.code && h.name)) throw new Error("varorna saknar kod eller namn – svaret har ändrat format");
    return `"mjölk" → ${hits.length} varor, t.ex. ${hits[0].name}`;
  });
}

// ---- Store offers, the store lists and the login call (all open: they need no account) ----
for (const site of Object.values(AXFOOD_SITES)) {
  await check(`${site.label} veckans erbjudanden (butik på orten)`, async () => {
    const r = await axfoodOffers(site, "Jönköping", 6);
    if (!r.offers.length) throw new Error(`inga erbjudanden för någon butik i Jönköping (${r.store})`);
    if (!r.offers.every((o) => o.id && o.name)) throw new Error("erbjudandena saknar kod eller namn – svaret har ändrat format");
    return `${r.store}: ${r.offers.length} erbjudanden, t.ex. ${r.offers[0].name} ${r.offers[0].price ?? ""}`;
  });
  await check(`${site.label} inloggningsanropet (fel lösenord ska avvisas)`, async () => {
    try {
      await axfoodLoginHttp(site, "199001011234", "fel-losenord-kontroll");
    } catch (e) {
      if (/avvisade inloggningen/.test(e.message)) return "avvisar fel lösenord som väntat";
      throw e;
    }
    throw new Error("loggade in med ett påhittat lösenord?!");
  });
}
await check("City Gross sökning och butiksuppslag", async () => {
  const hits = await cityGrossSearch("mjölk", "");
  if (!hits.length || !hits.every((h) => h.code && h.name)) throw new Error("sökningen gav inga varor, eller varorna saknar kod/namn");
  const st = await cityGrossStore("Jönköping");
  if (!st?.no) throw new Error("hittade ingen butik för Jönköping (butiksnumret kommer från webbplatsens GraphQL)");
  return `${hits.length} varor, butik ${st.name} (nr ${st.no})`;
});

// ---- Real sport calendars (secrets SPORTADMIN_ICS / LAGET_ICS); counts only ----
for (const [name, key] of [["SportAdmin", "SPORTADMIN_ICS"], ["laget.se", "LAGET_ICS"]]) {
  const url = process.env[key];
  if (!url) {
    ok.push(`${name}: provas i det privata test-repot (riktig kalender)`);
    continue;
  }
  await check(`${name} (riktig kalender)`, async () => {
    const now = new Date();
    const evs = await fetchIcs(url, new Date(now.getTime() - 30 * 86_400_000), new Date(now.getTime() + 60 * 86_400_000));
    if (!evs.length) throw new Error("kalendern gick att läsa men hade inga händelser 30 dagar bakåt – 60 dagar framåt");
    const bad = evs.filter((e) => !(e.start instanceof Date) || Number.isNaN(e.start.getTime()) || !e.title);
    if (bad.length) throw new Error(`${bad.length} händelser utan giltig tid eller titel`);
    const groups = detectGroups(evs).length;
    const matches = evs.filter((e) => /match|cup|turnering|serie/i.test(e.title)).length;
    return `${evs.length} händelser (${matches} matcher/cuper), ${groups} lag/grupper för lagfiltret`;
  });
}

// ---- Vklass with a real account (repository secrets VKLASS_USERNAME / VKLASS_PASSWORD) ----
// Only counts are reported – never names or other details from the account.
if (process.env.VKLASS_USERNAME && process.env.VKLASS_PASSWORD) {
  await check("Vklass (riktigt konto)", async () => {
    const session = await vklassLogin(process.env.VKLASS_USERNAME, process.env.VKLASS_PASSWORD);
    const { children: kids, news } = await vklassWelcome(session);
    const withFood = kids.filter((k) => k.food.length).length;
    const days = kids.reduce((n, k) => n + k.food.length, 0);
    const care = kids.filter((k) => k.careTime).length;
    const withId = kids.filter((k) => k.id).length;
    // A school week always has a menu on the start page; weekends may not.
    const weekday = new Date().getDay() % 6 !== 0;
    if (weekday && withFood < kids.length) throw new Error(`matsedel för bara ${withFood} av ${kids.length} barn`);
    const settings = { username: process.env.VKLASS_USERNAME };
    const ctx = { integration: {}, settings, str: (k) => settings[k] ?? "", secret: (k) => (k === "password" ? process.env.VKLASS_PASSWORD : undefined), remember: () => {} };
    const now = new Date();
    const r = await vklass.fetch(ctx, now, new Date(now.getTime() + 14 * 86_400_000));
    if (withId && !r.events.length) throw new Error(`${withId} barn med schema men inga lektioner två veckor framåt`);
    // News: counts only. Every news item needs a title and a date or text, or the page has changed.
    const broken = news.filter((n) => !n.title || (!n.text && !n.files.length)).length;
    if (broken) throw new Error(`${broken} av ${news.length} nyheter saknar rubrik eller innehåll – Vklass nyhetssida kan ha ändrats`);
    const newsNote = `${news.length} nyheter (${news.filter((n) => n.published).length} med datum, ${news.filter((n) => n.files.length).length} med bilagor, ${news.filter((n) => n.badge || n.tags?.length).length} med mottagare)`;
    if (!news.length) {
      // Only in the private test repo (DETAILS=1): show the page code around the news data.
      if (process.env.DETAILS === "1") {
        const page = await fetch("https://custodian.vklass.se/Home/News", { headers: { cookie: session.jar.header(), "user-agent": "Mozilla/5.0" } }).then((r) => r.text());
        const spots = [...page.matchAll(/newsArticles/g)].map((m) => page.slice(Math.max(0, m.index - 120), m.index + 220).replace(/\s+/g, " "));
        ok.push(`Vklass nyhetsdata (privat detalj): ${spots.length} ställen\n${spots.map((x) => "    " + x).join("\n")}`);
      }
      throw new Error("inga nyheter hittades i Vklass – nyhetssidan kan ha ändrats");
    }
    return `${kids.length} barn (${withId} med schema), mat för ${withFood} barn (${days} dagar), omsorgstid för ${care}, ${r.events.filter((e) => !e.task).length} lektioner (${r.events.filter((e) => e.gym).length} med idrott), ${r.events.filter((e) => e.task).length} läxor/prov/uppgifter två veckor framåt, ${newsNote}`;
  });
} else {
  ok.push("Vklass: provas i det privata test-repot (riktigt konto)");
}

const report = [
  problems.length ? "## Behöver ses över\n" + problems.map((p) => `- ${p}`).join("\n") : "## Allt fungerar",
  "\n## Sopor – Sök på adress\n| Renhållare | Provad adress | Resultat |\n|---|---|---|\n" + edpRows.join("\n"),
  parkedNotes.length ? "\n## Ej valbara (provas varje vecka)\n" + parkedNotes.map((p) => `- ${p}`).join("\n") : "",
  ok.length ? "\n## OK\n" + ok.map((p) => `- ${p}`).join("\n") : "",
].join("\n");
writeFileSync(process.env.REPORT ?? "sources-report.md", report + "\n");
console.log(report);
process.exit(problems.length ? 1 : 0);
