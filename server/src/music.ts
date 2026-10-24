import type { HaState } from "./connectors/ha.js";
import { getJson } from "./http.js";
import { isMaPlayer } from "./musicAssistant.js";
import type { Config, Music, RadioStation } from "./types.js";

/**
 * Musik: favourite radio stations played on any speaker Home Assistant knows (Google/Nest,
 * Chromecast, Sonos, Echo via Music Assistant …) with media_player.play_media. Nothing here is
 * brand specific: a station is just a stream URL.
 */

export function buildMusic(cfg: Config, states: Map<string, HaState>): Music | undefined {
  const speakers = cfg.entities.speakers ?? [];
  const stations = cfg.entities.stations ?? [];
  if (!speakers.length) return undefined;
  return {
    speakers: speakers.map((s) => {
      const st = states.get(s.entityId);
      const a = (st?.attributes ?? {}) as { media_content_id?: string; media_title?: string; media_artist?: string; media_album_name?: string; app_name?: string; volume_level?: number; entity_picture?: string; media_position?: number; media_duration?: number; media_position_updated_at?: string; supported_features?: number };
      const feat = Number(a.supported_features ?? 0);
      const offline = !st || st.state === "unavailable" || st.state === "unknown";
      const playing = st?.state === "playing" || st?.state === "buffering";
      const paused = st?.state === "paused";
      const live = playing || paused; // låtinfo och omslag finns kvar när den pausats, så att man kan trycka Spela igen
      const station = playing ? stationIndex(stations, a.media_content_id) : -1;
      const title = playing ? (station >= 0 ? stations[station]!.name : [a.media_artist, a.media_title].filter(Boolean).join(" – ") || a.app_name) : undefined;
      return {
        entityId: s.entityId,
        name: s.name,
        offline,
        playing,
        title: title || undefined,
        station: station >= 0 ? station : undefined,
        volume: typeof a.volume_level === "number" ? Math.round(a.volume_level * 100) : undefined,
        playingUrl: playing && a.media_content_id && /^https?:\/\//.test(a.media_content_id) ? a.media_content_id : undefined,
        track: live && station < 0 ? a.media_title || undefined : undefined,
        artist: live && station < 0 ? a.media_artist || undefined : undefined,
        album: live && station < 0 ? a.media_album_name || undefined : undefined,
        cover: live && station < 0 && Boolean(a.entity_picture),
        position: live && station < 0 && typeof a.media_position === "number" && typeof a.media_duration === "number" && a.media_duration > 0 ? a.media_position : undefined,
        duration: live && station < 0 && typeof a.media_duration === "number" && a.media_duration > 0 ? a.media_duration : undefined,
        positionAt: a.media_position_updated_at,
        radioText: (() => {
          if (!playing || station < 0) return undefined;
          const t = [a.media_artist, a.media_title].filter(Boolean).join(" – ").trim();
          const name = stations[station]!.name.toLowerCase();
          return t && t.toLowerCase() !== name && !t.toLowerCase().includes(name) ? t : undefined;
        })(),
        paused,
        canPause: live ? (feat & 1) === 1 : undefined,
        canNext: live ? (feat & 32) === 32 : undefined,
        canPrev: live ? (feat & 16) === 16 : undefined,
      };
    }),
    stations: stations.map((s, index) => ({ index, name: s.name, logo: s.logo, url: s.url })),
    spotify: spotifyInfo(states),
    assistant: [...states.values()].some(isMaPlayer),
  };
}

/** The player Home Assistant's Spotify integration makes (media_player.spotify_<account>). */
export function spotifyPlayer(states: Map<string, HaState>): HaState | undefined {
  return [...states.values()].find((s) => s.entity_id.startsWith("media_player.spotify"));
}

function spotifyInfo(states: Map<string, HaState>): Music["spotify"] {
  const s = spotifyPlayer(states);
  if (!s) return null;
  const a = s.attributes as { media_title?: string; media_artist?: string; source?: string; source_list?: string[] };
  const playing = s.state === "playing";
  return {
    entityId: s.entity_id,
    playing,
    title: [a.media_artist, a.media_title].filter(Boolean).join(" – ") || undefined,
    device: a.source || undefined,
    offline: s.state === "unavailable",
    // Spotify Connect devices the account sees right now (soundbars, Sonos, TVs …) – awake ones only.
    devices: (a.source_list ?? []).filter((x) => typeof x === "string").slice(0, 20),
  };
}

/** Which favourite is playing: speakers report the stream URL back, sometimes with a changed scheme or query. */
export function stationIndex(stations: RadioStation[], contentId?: string): number {
  if (!contentId) return -1;
  const norm = (u: string) => u.replace(/^https?:\/\//, "").replace(/[?#].*$/, "").replace(/\/$/, "");
  const id = norm(contentId);
  return stations.findIndex((s) => norm(s.url) === id);
}

/** The service call that starts a station on a speaker. */
export function playCall(speaker: string, station: RadioStation) {
  return {
    domain: "media_player",
    service: "play_media",
    data: {
      entity_id: speaker,
      media_content_id: station.url,
      media_content_type: "music",
      // Shown on speakers with a screen (Nest Hub) and in the Home Assistant app.
      extra: { title: station.name, ...(station.logo ? { thumb: station.logo } : {}) },
    },
  };
}

// ---------- Finding stations ----------

interface RbStation {
  stationuuid?: string;
  name: string;
  url_resolved: string;
  favicon?: string;
  countrycode?: string;
  codec?: string;
  bitrate?: number;
  lastcheckok?: number;
  clickcount?: number;
}

export interface StationHit extends RadioStation {
  country?: string;
  /** e.g. "MP3 128 kbit/s". */
  quality?: string;
}

/** radio-browser.info: an open directory of ~50 000 stations, all Sveriges Radio and the big commercial ones included. */
const MIRRORS = ["https://de1.api.radio-browser.info", "https://de2.api.radio-browser.info", "https://fi1.api.radio-browser.info"];

export async function searchStations(q: string, fetchJson: typeof getJson = getJson): Promise<StationHit[]> {
  const query = q.trim().slice(0, 60);
  if (query.length < 2) return [];
  const path = `/json/stations/search?name=${encodeURIComponent(query)}&hidebroken=true&order=clickcount&reverse=true&limit=40`;
  let last: Error | undefined;
  for (const m of MIRRORS) {
    try {
      return pickStations(await fetchJson<RbStation[]>(m + path, { timeoutMs: 8000 }));
    } catch (e) {
      last = e as Error;
    }
  }
  throw new Error(`Radiokatalogen svarar inte just nu. ${last?.message ?? ""}`.trim());
}

/** Working streams only, Swedish first, one entry per name (the https one when there is a choice). */
export function pickStations(list: RbStation[]): StationHit[] {
  const ok = list.filter((s) => s.lastcheckok !== 0 && /^https?:\/\//.test(s.url_resolved ?? "") && s.name?.trim());
  const rank = (s: RbStation) => (s.countrycode === "SE" ? 0 : 1) * 2 + (s.url_resolved.startsWith("https://") ? 0 : 1);
  const sorted = [...ok].sort((a, b) => rank(a) - rank(b) || (b.clickcount ?? 0) - (a.clickcount ?? 0));
  const seen = new Set<string>();
  const out: StationHit[] = [];
  for (const s of sorted) {
    const name = s.name.trim().replace(/\s+/g, " ").slice(0, 40);
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      url: s.url_resolved,
      logo: s.favicon && /^https:\/\//.test(s.favicon) ? s.favicon : undefined,
      country: s.countrycode || undefined,
      quality: [s.codec, s.bitrate ? `${s.bitrate} kbit/s` : ""].filter(Boolean).join(" ") || undefined,
    });
    if (out.length >= 12) break;
  }
  return out;
}

// ---------- All Swedish stations (the Musik tab) ----------

export interface DirStation extends RadioStation {
  /** The directory's id: the board plays by id, so only stations from the directory can be started. */
  id: string;
  group: "sr" | "other";
  quality?: string;
}

const SR = /^(sr|sveriges radio)\b[\s:–-]*/i;
/** "SR P4 Jönköping" and "Sveriges Radio - P3" read as "P4 Jönköping" and "P3". */
export function cleanName(name: string): { name: string; sr: boolean } {
  const n = name.trim().replace(/\s+/g, " ");
  if (SR.test(n)) {
    const rest = n.replace(SR, "").trim();
    if (rest) return { name: rest.slice(0, 40), sr: true };
  }
  return { name: n.slice(0, 40), sr: /^p[1-4]\b/i.test(n) };
}

/** Sveriges Radio first in P1, P2, P3, P4 … order, then the rest by popularity. One entry per name. */
export function directory(list: RbStation[]): DirStation[] {
  const ok = list.filter((s) => s.stationuuid && s.lastcheckok !== 0 && /^https?:\/\//.test(s.url_resolved ?? "") && s.name?.trim());
  const sorted = [...ok].sort((a, b) => Number(b.url_resolved.startsWith("https://")) - Number(a.url_resolved.startsWith("https://")) || (b.clickcount ?? 0) - (a.clickcount ?? 0));
  const seen = new Set<string>();
  const out: (DirStation & { clicks: number })[] = [];
  for (const s of sorted) {
    const { name, sr } = cleanName(s.name);
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: s.stationuuid!,
      name,
      url: s.url_resolved,
      logo: s.favicon && /^https:\/\//.test(s.favicon) ? s.favicon : undefined,
      group: sr ? "sr" : "other",
      quality: [s.codec, s.bitrate ? `${s.bitrate} kbit/s` : ""].filter(Boolean).join(" ") || undefined,
      clicks: s.clickcount ?? 0,
    });
  }
  const srRank = (n: string) => (/^p1\b/i.test(n) ? 1 : /^p2\b/i.test(n) ? 2 : /^p3\b/i.test(n) ? 3 : /^p4\b/i.test(n) ? 4 : 5);
  out.sort((a, b) =>
    a.group !== b.group ? (a.group === "sr" ? -1 : 1) : a.group === "sr" ? srRank(a.name) - srRank(b.name) || a.name.localeCompare(b.name, "sv") : b.clicks - a.clicks,
  );
  return out.map(({ clicks: _c, ...s }) => s);
}

let dirCache: { at: number; list: DirStation[] } | null = null;
const DAY = 24 * 3600_000;

interface SrChannel {
  id: number;
  name: string;
  image?: string;
  channeltype?: string;
  liveaudio?: { url?: string };
}

/**
 * Sveriges Radio's own channel list (api.sr.se): every SR channel with its live stream, all P4
 * included. The open directory lacks some of them (P4 Östergötland), so SR comes from the source.
 */
export function srChannels(list: SrChannel[]): DirStation[] {
  const rank = (c: SrChannel) => (c.channeltype === "Rikskanal" ? 0 : c.channeltype === "Lokal kanal" ? 1 : 2);
  return list
    .filter((c) => c.name && /^https?:\/\//.test(c.liveaudio?.url ?? ""))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "sv", { numeric: true }))
    .map((c) => ({
      id: `sr-${c.id}`,
      name: c.name.trim().slice(0, 40),
      url: c.liveaudio!.url!,
      logo: c.image && /^https:\/\//.test(c.image) ? c.image : undefined,
      group: "sr" as const,
    }));
}

/**
 * Every Swedish station, fetched once a day: Sveriges Radio from its own API, the rest from
 * radio-browser.info. If one of them is down, the other still counts, and the last good list is kept.
 */
export async function swedishStations(fetchJson: typeof getJson = getJson, now = Date.now()): Promise<DirStation[]> {
  if (dirCache && now - dirCache.at < DAY) return dirCache.list;
  const errors: string[] = [];
  const sr = await fetchJson<{ channels: SrChannel[] }>("https://api.sr.se/api/v2/channels?format=json&pagination=false&audioquality=hi", { timeoutMs: 10_000 })
    .then((r) => srChannels(r.channels ?? []))
    .catch((e: Error) => (errors.push(`Sveriges Radio: ${e.message}`), [] as DirStation[]));
  let rb: DirStation[] = [];
  const path = "/json/stations/search?countrycode=SE&hidebroken=true&order=clickcount&reverse=true&limit=500";
  for (const m of MIRRORS) {
    try {
      rb = directory(await fetchJson<RbStation[]>(m + path, { timeoutMs: 10_000 }));
      break;
    } catch (e) {
      if (m === MIRRORS[MIRRORS.length - 1]) errors.push(`radiokatalogen: ${(e as Error).message}`);
    }
  }
  // With Sveriges Radio's own list, the directory's copies of SR channels are left out.
  const list = sr.length ? [...sr, ...rb.filter((x) => x.group !== "sr")] : rb;
  if (list.length) {
    dirCache = { at: now, list };
    return list;
  }
  if (dirCache) return dirCache.list;
  throw new Error(`Radiokanalerna går inte att hämta just nu (${errors.join("; ")}).`);
}

/** For tests. */
export function clearStationCache() {
  dirCache = null;
}

/** Settings search: Swedish stations (all of Sveriges Radio included) first, then the rest of the world's. */
export async function findStations(q: string): Promise<StationHit[]> {
  const words = q.trim().toLowerCase();
  if (words.length < 2) return [];
  const [se, world] = await Promise.all([swedishStations().catch(() => [] as DirStation[]), searchStations(q).catch(() => null)]);
  const ours = se.filter((x) => x.name.toLowerCase().includes(words)).map((x) => ({ name: x.name, url: x.url, logo: x.logo, country: "SE", quality: x.quality }));
  if (!ours.length && !world) throw new Error("Radiokanalerna går inte att hämta just nu.");
  const names = new Set(ours.map((x) => x.name.toLowerCase()));
  return [...ours, ...(world ?? []).filter((x) => !names.has(x.name.toLowerCase()))].slice(0, 12);
}

/** "spotify://playlist/abc" (Music Assistant) or "spotify:playlist:abc" → the Spotify URI the Spotify integration plays. */
export function spotifyUri(uri: string): string | undefined {
  const m = uri.match(/^spotify(?::\/\/|:)(playlist|album|track|artist|show|episode)[/:]([A-Za-z0-9]{10,40})$/);
  return m ? `spotify:${m[1]}:${m[2]}` : undefined;
}
