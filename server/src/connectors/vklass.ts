import * as cheerio from "cheerio";
import { fetchWithTimeout } from "../http.js";
import type { CalEvent } from "./ics.js";

/**
 * Vklass (vårdnadshavare) – unofficial, scrapes the custodian web.
 *
 * Login flow mapped by the community "Vklass scrape sensor" for Home Assistant
 * (community.home-assistant.io/t/vklass-scrape-sensor/939402):
 *   1. GET  auth.vklass.se/credentials → cookies + __RequestVerificationToken
 *   2. POST auth.vklass.se/credentials/signin (Username, Password, RememberMe) → 302 = ok, 200 = wrong password
 *   3. custodian.vklass.se/Home/Welcome lists the children (vk-student-card),
 *      /Events/FullCalendar returns events per student id.
 * Works only for accounts with a username + password (not BankID-only).
 */

const AUTH = "https://auth.vklass.se";
const CUSTODIAN = "https://custodian.vklass.se";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

class Jar {
  private c = new Map<string, string>();
  take(res: Response) {
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair] = sc.split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.c.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header() {
    return [...this.c].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

export interface VklassChild {
  id: string;
  name: string;
  attendance?: string;
  careTime?: string;
  food: { day: string; dishes: string[] }[];
}

export interface VklassSession {
  jar: Jar;
}

async function req(jar: Jar, url: string, init: RequestInit = {}) {
  const res = await fetchWithTimeout(url, {
    ...init,
    redirect: "manual",
    timeoutMs: 20_000,
    headers: { "user-agent": BROWSER_UA, cookie: jar.header(), ...(init.headers as Record<string, string>) },
  });
  jar.take(res);
  return res;
}

/** Follow redirects by hand so cookies set on every hop are kept. */
async function follow(jar: Jar, url: string, init: RequestInit = {}, hops = 6): Promise<Response> {
  let res = await req(jar, url, init);
  let current = url;
  while (hops-- > 0 && res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (!loc) break;
    current = new URL(loc, current).toString();
    res = await req(jar, current);
  }
  return res;
}

export async function vklassLogin(username: string, password: string): Promise<VklassSession> {
  const jar = new Jar();
  const page = await req(jar, `${AUTH}/credentials`);
  const html = await page.text();
  const token = cheerio.load(html)('input[name="__RequestVerificationToken"]').attr("value");
  if (!token) throw new Error("Vklass inloggningssida ändrad – hittade ingen verifieringstoken.");

  const body = new URLSearchParams({
    __RequestVerificationToken: token,
    Username: username,
    Password: password,
    RememberMe: "false",
  });
  const res = await req(jar, `${AUTH}/credentials/signin`, {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  if (res.status === 200) throw new Error("Fel användarnamn eller lösenord för Vklass.");
  if (res.status < 300 || res.status >= 400) throw new Error(`Vklass svarade ${res.status} vid inloggning.`);

  // Follow the redirect chain into the custodian site to obtain its session cookie.
  const loc = res.headers.get("location");
  if (loc) await follow(jar, new URL(loc, AUTH).toString());
  await follow(jar, `${CUSTODIAN}/Home/Welcome`);
  return { jar };
}

export async function vklassChildren(s: VklassSession): Promise<VklassChild[]> {
  return (await vklassWelcome(s)).children;
}

/** The start page: the children's cards and, below them, the school's news. */
export async function vklassWelcome(s: VklassSession): Promise<{ children: VklassChild[]; news: VklassNews[] }> {
  const res = await follow(s.jar, `${CUSTODIAN}/Home/Welcome`);
  const html = await res.text();
  const children = parseVklassWelcome(html);
  if (children.length === 0) throw new Error("Inloggad i Vklass men hittade inga barn. Sidan kan ha ändrats.");
  // The news page carries all news as data (newsArticles); the start page is the fallback.
  let news: VklassNews[] = [];
  try {
    const page = await follow(s.jar, `${CUSTODIAN}/Home/News`);
    if (page.ok) news = parseVklassNewsData(await page.text());
  } catch {
    // keep the start page's news below
  }
  if (!news.length) news = parseVklassNews(html);
  return { children, news };
}

/**
 * The JSON array that follows `key` in a page's script, read with bracket matching. The key can
 * appear several times (an empty `newsArticles: []` in the component, then the data): the longest wins.
 */
export function jsonArrayAfter(text: string, key: string): unknown[] | undefined {
  const re = new RegExp(`["']?${key}["']?\\s*[:=]\\s*\\[`, "g");
  let best: unknown[] | undefined;
  for (const m of text.matchAll(re)) {
    const arr = readArray(text, text.indexOf("[", m.index!));
    if (arr && (!best || arr.length > best.length)) best = arr;
  }
  return best;
}

function readArray(text: string, start: number): unknown[] | undefined {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") inStr = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        try {
          const v = JSON.parse(text.slice(start, i + 1));
          return Array.isArray(v) ? v : undefined;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/** The JSON model passed as the third, quoted argument of Vklass's ServerHtml(…) for a template. */
export function serverHtmlData(html: string, template: string): unknown {
  const re = /ServerHtml\(\s*(['"])[^'"]*\1\s*,\s*(['"])([^'"]*)\2\s*,\s*(['"])/g;
  for (const m of html.matchAll(re)) {
    if (!m[3].includes(template)) continue;
    const quote = m[4];
    let i = m.index! + m[0].length;
    let raw = "";
    for (; i < html.length; i++) {
      const c = html[i];
      if (c === "\\") {
        const n = html[i + 1];
        // JavaScript escapes → JSON-safe: \' is just ', \xHH becomes \u00HH, the rest is valid JSON.
        if (n === "'") raw += "'";
        else if (n === "x") raw += `\\u00${html.slice(i + 2, i + 4)}`, (i += 2);
        else raw += c + n;
        i++;
        continue;
      }
      if (c === quote) break;
      raw += c === '"' && quote === "'" ? '\\"' : c;
    }
    try {
      return JSON.parse(JSON.parse(`"${raw}"`));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

type RawFile = { name?: string; nameWithExtension?: string; fileName?: string; url?: string; extension?: string };
type RawArticle = { id?: number | string; title?: string; publishDate?: string; introText?: string; text?: string; tags?: unknown; files?: RawFile[]; imagePath?: string };

/**
 * The news page (custodian /Home/News) has the news as data in a script:
 * newsArticles: [{ id, title, publishDate, introText, text (HTML), tags, imagePath, files: [{ name, nameWithExtension, url, … }] }]
 * (field names checked against a real account, 2026-10-20 – only the names, never the contents).
 */
export function parseVklassNewsData(html: string): VklassNews[] {
  // Vklass renders it as ServerHtml('id', '…/news-feed-model', '{"newsArticles":[…]}') – JSON inside a
  // JavaScript string. Read that string first; fall back to looking for the array in the page as is.
  const fromString = serverHtmlData(html, "news-feed-model");
  const list = ((fromString && Array.isArray((fromString as { newsArticles?: unknown }).newsArticles) ? (fromString as { newsArticles: unknown[] }).newsArticles : undefined) ??
    jsonArrayAfter(html, "newsArticles")) as RawArticle[] | undefined;
  if (!Array.isArray(list)) return [];
  return list
    .filter((a) => a && typeof a === "object" && a.title)
    .map((a) => {
      const files = [
        ...(a.imagePath ? [{ name: "Bild", url: a.imagePath }] : []),
        ...(a.files ?? []).filter((f) => f?.url).map((f) => ({ name: f.nameWithExtension || f.name || f.fileName || "Bilaga", url: f.url! })),
        // Links written in the text itself ("Ladda ner veckobrevet", a PDF, a form) – kept as files to open.
        ...textLinks(`${a.introText ?? ""} ${a.text ?? ""}`),
      ]
        .map((f) => ({ name: f.name, url: new URL(f.url, CUSTODIAN).toString() }))
        .filter((f, i, all) => all.findIndex((x) => x.url === f.url) === i);
      const text = [a.introText, a.text].map((t) => htmlText(t ?? "")).filter(Boolean);
      const published = a.publishDate && !Number.isNaN(Date.parse(a.publishDate)) ? new Date(a.publishDate).toISOString() : undefined;
      return {
        id: String(a.id ?? `n${hash(`${a.title}|${a.publishDate}`)}`),
        title: String(a.title).replace(/\s+/g, " ").trim(),
        // The intro is often the start of the text: keep it only when it adds something.
        text: (text.length === 2 && text[1].startsWith(text[0].replace(/…$/, "").slice(0, 40)) ? text[1] : text.join("\n\n")).slice(0, 4000),
        published,
        tags: tagNames(a.tags),
        files: files.slice(0, 10),
      };
    });
}

/** Links in a news text's HTML: their text (or the file name) and where they go. */
export function textLinks(html: string): { name: string; url: string }[] {
  if (!/<a\s/i.test(html)) return [];
  const $ = cheerio.load(html);
  const out: { name: string; url: string }[] = [];
  $("a[href]").each((_, a) => {
    const href = ($(a).attr("href") ?? "").trim();
    if (!/^(https?:\/\/|\/)/i.test(href)) return;
    let file = href.split(/[?#]/)[0]!.split("/").pop() ?? "";
    try {
      file = decodeURIComponent(file);
    } catch {
      /* keep it as written */
    }
    const name = $(a).text().replace(/\s+/g, " ").trim() || file || "Länk";
    out.push({ name: name.slice(0, 80), url: href });
  });
  return out.slice(0, 10);
}

function tagNames(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => (typeof t === "string" ? t : t && typeof t === "object" ? String((t as Record<string, unknown>).name ?? (t as Record<string, unknown>).title ?? "") : ""))
    .filter(Boolean);
}

/** HTML from Vklass's editor → plain text with line breaks. */
function htmlText(h: string): string {
  return cheerio
    .load(h.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n"))
    .text()
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Fetch a news attachment with the logged-in session (only Vklass addresses). */
export async function vklassFile(s: VklassSession, url: string): Promise<Response> {
  const u = new URL(url, CUSTODIAN);
  if (!/(^|\.)vklass\.se$/.test(u.hostname) || u.protocol !== "https:") throw new Error("Bara filer från Vklass.");
  return follow(s.jar, u.toString());
}

export interface VklassNews {
  /** Stable id: the news link's id when there is one, else a hash of title + published. */
  id: string;
  title: string;
  /** The text as plain text with line breaks. */
  text: string;
  /** "20 oktober 13:50" → ISO, when it could be read. */
  published?: string;
  /** The round badge on the news, e.g. "ES": the first letters of the child it concerns. */
  badge?: string;
  /** Groups the news was sent to ("Fröarpsskolan 1-6", "Björnen 3-5") – used to find the child. */
  tags?: string[];
  files: { name: string; url: string }[];
}

const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

/** "Publicerat 20 oktober 13:50 av …" → ISO date (this year, or last year if that would be in the future). */
export function vklassPublished(text: string, now = new Date()): string | undefined {
  const m = /(\d{1,2})\s+([a-zåäö]+)(?:\s+(\d{4}))?\s+(\d{1,2})[:.](\d{2})/i.exec(text);
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return undefined;
  let year = m[3] ? Number(m[3]) : now.getFullYear();
  let d = new Date(year, month, Number(m[1]), Number(m[4]), Number(m[5]));
  if (!m[3] && d.getTime() > now.getTime() + 2 * 86_400_000) d = new Date(--year, month, Number(m[1]), Number(m[4]), Number(m[5]));
  return d.toISOString();
}

const META = /^(publicerat|länkat material|personal|elever|vårdnadshavare|visa (mer|mindre)|läs mer)\b/i;

/**
 * News on the custodian start page. Each news item has a heading, the text, a line
 * "Publicerat 20 oktober 13:50 av …" and sometimes "Länkat material" with files.
 * Rather than relying on Vklass's class names, an item is the smallest element that holds
 * exactly one "Publicerat" line and a heading – so a renamed class does not break it.
 */
export function parseVklassNews(html: string, now = new Date()): VklassNews[] {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const out: VklassNews[] = [];
  const seen = new Set<any>();
  const pubs = $("body *")
    .filter((_, el) => {
      const own = $(el).clone().children().remove().end().text().trim();
      return /^Publicerat\b/i.test(own) || (/^Publicerat\b/i.test($(el).text().trim()) && $(el).children().length === 0);
    })
    .toArray();
  for (const pub of pubs) {
    let item = $(pub).parent();
    while (item.length && !item.is("body")) {
      const count = item.find("*").filter((_, e) => /^Publicerat\b/i.test($(e).clone().children().remove().end().text().trim())).length;
      if (count > 1) break;
      if (item.find("h1, h2, h3, h4").length) break;
      item = item.parent();
    }
    if (!item.length || item.is("body") || seen.has(item.get(0))) continue;
    seen.add(item.get(0));
    const heading = item.find("h1, h2, h3, h4").first();
    const title = heading.text().replace(/\s+/g, " ").trim();
    if (!title) continue;
    const pubText = $(pub).text().replace(/\s+/g, " ").trim();
    // Files: links under "Länkat material" or that look like downloads.
    const files: VklassNews["files"] = [];
    item.find("a[href]").each((_, a) => {
      const href = $(a).attr("href") ?? "";
      const name = $(a).text().replace(/\s+/g, " ").trim();
      if (!href || href.startsWith("#") || href.startsWith("javascript:") || /^mailto:/i.test(href)) return;
      const looksFile = /download|file|fil|attachment|document|getfile|material/i.test(href) || $(a).is("[download]") || $(a).closest("[class*=attach], [class*=file], [class*=material]").length > 0;
      if (looksFile && !files.some((f) => f.url === href)) files.push({ name: name || "Bilaga", url: new URL(href, CUSTODIAN).toString() });
    });
    // Text: paragraphs and line blocks that are not the heading, meta lines or file names.
    const skip = new Set([title, pubText, ...files.map((f) => f.name)]);
    const lines: string[] = [];
    item.find("p, li, div, span").each((_, el) => {
      const e = $(el);
      if (e.find("p, li, div, h1, h2, h3, h4, h5, h6").length) return; // only leaf blocks
      if (e.closest("h1, h2, h3, h4, h5, h6, a").length) return;
      const t = e.text().replace(/[ \t]+/g, " ").trim();
      if (!t || skip.has(t) || META.test(t) || /\boch \d+ till$/i.test(t) || /^[A-ZÅÄÖ]{1,3}$/.test(t)) return;
      if (!lines.includes(t)) lines.push(t);
    });
    const badge = item
      .find("*")
      .toArray()
      .map((e) => $(e).clone().children().remove().end().text().trim())
      .find((t) => /^[A-ZÅÄÖ]{2}$/.test(t));
    const link = heading.find("a").attr("href") ?? item.find("a[href*=News], a[href*=news]").attr("href") ?? "";
    const published = vklassPublished(pubText.replace(/^Publicerat\s*/i, ""), now);
    out.push({
      id: /(\d{3,}|[0-9a-f-]{20,})/i.exec(link)?.[1] ?? `n${hash(`${title}|${published ?? pubText}`)}`,
      title,
      text: lines.join("\n").slice(0, 4000),
      published,
      badge,
      files: files.slice(0, 10),
    });
  }
  return out;
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const WEEKDAY_NAMES = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];

/** "Idag", "Imorgon", "onsdag" on the card → "onsdag 21/10" so the menu lands on the right date. */
export function vklassDayLabel(raw: string, today: Date): string {
  const t = raw.trim().toLowerCase();
  const at = (n: number) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);
    return `${WEEKDAY_NAMES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
  };
  if (t === "idag") return at(0);
  if (t === "imorgon") return at(1);
  const wd = WEEKDAY_NAMES.indexOf(t);
  if (wd >= 0) return at(((wd - today.getDay() + 7) % 7) || 7);
  return raw.trim();
}

/**
 * The custodian start page: one .vk-student-card per child with the name, care time
 * ("Omsorgstid 07:15 - 16:00") and the menu per day:
 *   .vk-student-card__day > h3 "Idag" + .vk-student-card__day__food > h4 "Matsedel" + ul > li
 * (structure checked against a real account, 2026-10-19).
 */
export function parseVklassWelcome(html: string, today = new Date()): VklassChild[] {
  const $ = cheerio.load(html);
  const children: VklassChild[] = [];
  $(".vk-student-card").each((i, card) => {
    const c = $(card);
    const name = c.find(".vk-student-card-header__text, h2").first().text().trim();
    if (!name) return;
    const id = studentId($, c) ?? "";
    const food: VklassChild["food"] = [];
    c.find(".vk-student-card__day").each((__, dayEl) => {
      const d = $(dayEl);
      const label = d.children("h3").first().text().trim() || d.find("h3").first().text().trim();
      const dishes = d
        .find("li")
        .map((___, li) => ($(li).html() ?? "").split(/<br\s*\/?>/i).map((part) => cheerio.load(part).text().replace(/\s+/g, " ").trim()))
        .get()
        .flat()
        .filter(Boolean);
      if (label && dishes.length) food.push({ day: vklassDayLabel(label, today), dishes: [...new Set(dishes)] });
    });
    const care = c.find('a[href*="CareSchedule"]').first().text().replace(/\s+/g, " ").trim().replace(/[–—]/g, "-");
    children.push({
      id,
      name,
      attendance: c.find(".text-bold").first().text().trim() || undefined,
      careTime: /\d{1,2}[:.]\d{2}\s*-\s*\d{1,2}[:.]\d{2}/.exec(care)?.[0] || undefined,
      food,
    });
  });
  return children;
}

/** The child's id: from a schedule link, or from a data attribute on the card (preschool children have no lessons). */
function studentId($: cheerio.CheerioAPI, c: cheerio.Cheerio<any>): string | undefined {
  const link = c.find('a[href*="studentIds="], a[href*="studentId="], a[href*="StudentId="]').attr("href") ?? "";
  const fromLink = /student[Ii]ds?=(\d+)/.exec(link)?.[1];
  if (fromLink) return fromLink;
  for (const el of [c, ...c.find("*").toArray().map((e) => $(e))]) {
    const attrs = (el.get(0) as { attribs?: Record<string, string> } | undefined)?.attribs ?? {};
    for (const [k, v] of Object.entries(attrs)) if (/student/i.test(k) && /^\d+$/.test(v)) return v;
  }
  return undefined;
}

/** Raw calendar items as Vklass sends them (used by the live check to see which kinds exist). */
export async function vklassRawEvents(s: VklassSession, studentId: string, from: Date, to: Date): Promise<Record<string, unknown>[]> {
  const body = new URLSearchParams({ students: studentId, start: from.toISOString(), end: to.toISOString() });
  const res = await follow(s.jar, `${CUSTODIAN}/Events/FullCalendar`, {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json, text/html" },
  });
  if (!res.ok) throw new Error(`Vklass kalender svarade ${res.status}`);
  return (await res.json()) as Record<string, unknown>[];
}

/** "Svenska (5:a:TH-26__SV)" / "Matematik (KLA.5_MA)" → "Svenska" / "Matematik". */
export function cleanLessonTitle(t: string): string {
  return t.replace(/\s*\((?=[^)]*[_:.])[^()\s]+\)\s*$/, "").trim() || t.trim();
}

type VklassItem = { title?: string; text?: string; start: string; end?: string; allDay?: boolean; eventType?: number; className?: string; location?: string; detailUrl?: string };

/** HTML from Vklass → plain text with line breaks and bullets. */
export function htmlToText(html: string): string {
  if (!/<[a-z]/i.test(html)) return html.trim();
  const $ = cheerio.load(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|h\d|ul|ol)>/gi, "\n\n").replace(/<li[^>]*>/gi, "\n• "));
  return $.root()
    .text()
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Calendar items per child. Vklass marks the kind (checked against a real account):
 * eventType 1 = lesson, 2 = assignment ("Uppgift": läxa, prov, inlämning), 8 = day off, 16 = teacher's planning.
 */
export async function vklassEvents(s: VklassSession, studentId: string, from: Date, to: Date): Promise<(CalEvent & { task?: boolean; url?: string })[]> {
  return mapVklassItems((await vklassRawEvents(s, studentId, from, to)) as VklassItem[]);
}

export function mapVklassItems(list: VklassItem[]): (CalEvent & { task?: boolean; url?: string })[] {
  return list
    .filter((e) => e.eventType !== 16 && !/plan/.test(e.className ?? ""))
    .map((e) => {
      const start = new Date(e.start);
      const task = e.eventType === 2 || /assignment/.test(e.className ?? "");
      const raw = (e.title || e.text || "Skola").trim();
      return {
        start,
        end: e.end ? new Date(e.end) : new Date(start.getTime() + 3_600_000),
        // Vklass sends "2026-11-02 08:10" (space) – earlier "…T08:10". A date without a time is an all-day item.
        allDay: Boolean(e.allDay) || !/[T ]\d{1,2}:\d{2}/.test(e.start),
        title: task ? raw : cleanLessonTitle(raw),
        location: typeof e.location === "string" && e.location.trim() ? e.location.trim() : undefined,
        description: e.text ? htmlToText(e.text) : undefined,
        task,
        url: typeof e.detailUrl === "string" && e.detailUrl.startsWith("/") ? `${CUSTODIAN}${e.detailUrl}` : undefined,
      };
    });
}

/**
 * The attachments of a task page (Calendar/Assignment/…): Vklass puts them in the page as JSON
 * (`files.bind="[{name, url, …}]"`). Only addresses on vklass.se are kept.
 */
export function parseAssignmentFiles(html: string): { name: string; url: string }[] {
  const m = /files\.bind="([^"]*)"/.exec(html) ?? /files\.bind='([^']*)'/.exec(html);
  if (!m) return [];
  const raw = m[1]!.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
  try {
    const list = JSON.parse(raw) as { name?: string; nameWithExtension?: string; url?: string; isFolder?: boolean }[];
    return list.flatMap((f) => {
      if (f.isFolder || !f.url) return [];
      try {
        const u = new URL(f.url);
        if (u.protocol !== "https:" || !/(^|\.)vklass\.se$/.test(u.hostname)) return [];
        return [{ name: f.nameWithExtension || f.name || "Bilaga", url: u.toString() }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

const assignmentFiles = new Map<string, { at: number; files: { name: string; url: string }[] }>();

/** Attachments of one task, remembered for six hours (a failed look is not remembered). */
export async function vklassAssignmentFiles(s: VklassSession, taskUrl: string): Promise<{ name: string; url: string }[]> {
  const hit = assignmentFiles.get(taskUrl);
  if (hit && Date.now() - hit.at < 6 * 3_600_000) return hit.files;
  try {
    const res = await vklassFile(s, taskUrl);
    if (!res.ok) return [];
    const files = parseAssignmentFiles(await res.text());
    assignmentFiles.set(taskUrl, { at: Date.now(), files });
    return files;
  } catch {
    return [];
  }
}

/** Lessons that mean "bring gym clothes". Vklass uses short codes like "idh". */
export function isGymLesson(ev: CalEvent): boolean {
  const s = `${ev.title} ${ev.description ?? ""}`.toLowerCase();
  return /\bidh\b|idrott|gympa|\bidr\b/.test(s);
}

