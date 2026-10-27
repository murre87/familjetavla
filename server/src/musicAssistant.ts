import { ha, type HaConn, type HaState } from "./connectors/ha.js";
import { haSocket } from "./connectors/haws.js";

/**
 * Music Assistant (a free Home Assistant app): the family's Spotify playlists, albums and podcasts
 * as covers on the board, played on any speaker – Google/Nest, Sonos, AirPlay, Echo … Home
 * Assistant's own Spotify integration can only browse while something already plays, and Google
 * speakers rarely show up as Spotify Connect devices, so the library goes through Music Assistant.
 */

export const MA_APP = "d5369777_music_assistant";
export const MA_REPO = "https://github.com/music-assistant/home-assistant-addon";

/** Music Assistant marks its own players with this attribute. */
export const isMaPlayer = (s: HaState | undefined) => Boolean(s && s.entity_id.startsWith("media_player.") && (s.attributes as Record<string, unknown>).mass_player_type !== undefined);

export interface Tile {
  uri: string;
  type: MediaType;
  title: string;
  subtitle?: string;
  image?: string;
}

export const MEDIA_TYPES = ["playlist", "album", "artist", "track", "podcast", "audiobook", "radio"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** The shelves on the left, like the car's: what you played last, your playlists, albums, podcasts. */
export const SHELVES = {
  recent: { media_type: "playlist", order_by: "last_played_desc" },
  playlists: { media_type: "playlist", order_by: "name" },
  albums: { media_type: "album", order_by: "timestamp_added_desc" },
  podcasts: { media_type: "podcast", order_by: "name" },
  radios: { media_type: "radio", order_by: "name" },          // Music Assistants egna radiokanaler (TuneIn, Radio Browser …)
} as const;
export type Shelf = keyof typeof SHELVES;

interface MaItem {
  uri?: string;
  name?: string;
  media_type?: string;
  image?: string | null;
  version?: string;
  artists?: { name?: string }[];
}

export function toTile(x: MaItem): Tile | null {
  const type = MEDIA_TYPES.find((t) => t === x.media_type);
  if (!x.uri || !x.name || !type || !/^[a-z0-9_-]+:\/\/\S{1,300}$/i.test(x.uri)) return null;
  const by = (x.artists ?? []).map((a) => a.name).filter(Boolean).join(", ");
  return {
    uri: x.uri,
    type,
    title: x.name.slice(0, 80),
    subtitle: (by || (x.version ?? "")).slice(0, 60) || undefined,
    // Spotify's covers are https; Music Assistant's own image proxy on the home network is http.
    image: x.image && /^https?:\/\//.test(x.image) ? x.image : undefined,
  };
}

const tiles = (list: unknown): Tile[] => (Array.isArray(list) ? list.map((x) => toTile(x as MaItem)).filter((t): t is Tile => t !== null) : []);

interface MaSetup {
  entryId: string;
  players: { e: string; d: string | null; n: string }[];
  speakers: Record<string, string | null>;
}

/** Music Assistant's config entry, its players and the device of each board speaker – one template. */
async function setup(conn: HaConn, speakers: string[]): Promise<MaSetup | null> {
  const ids = JSON.stringify(speakers.filter((s) => /^media_player\.[a-z0-9_]+$/.test(s)));
  const tpl = `{% set ns = namespace(p=[], c=none, s=[]) %}{% for e in integration_entities('music_assistant') %}{% if e.startswith('media_player.') %}{% set ns.c = ns.c or config_entry_id(e) %}{% set ns.p = ns.p + [{'e': e, 'd': device_id(e), 'n': state_attr(e, 'friendly_name') or e}] %}{% endif %}{% endfor %}{% for e in ${ids} %}{% set ns.s = ns.s + [[e, device_id(e)]] %}{% endfor %}{{ {'entryId': ns.c, 'players': ns.p, 'speakers': ns.s} | tojson }}`;
  const r = await ha.template(conn, tpl);
  const raw = (typeof r === "string" ? JSON.parse(r) : r) as Omit<MaSetup, "speakers"> & { speakers: [string, string | null][] };
  return raw.entryId ? { ...raw, speakers: Object.fromEntries(raw.speakers) } : null;
}

let cache: { at: number; key: string; value: MaSetup | null } | null = null;
async function cachedSetup(conn: HaConn, speakers: string[]) {
  const key = speakers.join(",");
  if (cache && cache.key === key && Date.now() - cache.at < 5 * 60_000) return cache.value;
  const value = await setup(conn, speakers);
  cache = { at: Date.now(), key, value };
  return value;
}
export function clearMaCache() {
  cache = null;
}

const simple = (n: string) => n.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

/**
 * Which Music Assistant player is the board's speaker: the speaker itself if it is one, else the
 * player on the same device (Music Assistant joins its players to the speaker's device), else the
 * one with the same name.
 */
export function playerFor(s: MaSetup, speaker: { entityId: string; name: string }, names: Map<string, string>): string | undefined {
  if (s.players.some((p) => p.e === speaker.entityId)) return speaker.entityId;
  const dev = s.speakers[speaker.entityId];
  const byDevice = dev ? s.players.find((p) => p.d === dev) : undefined;
  if (byDevice) return byDevice.e;
  const want = [speaker.name, names.get(speaker.entityId) ?? ""].map(simple).filter(Boolean);
  return s.players.find((p) => want.includes(simple(p.n)))?.e;
}

const respond = async (conn: HaConn, service: string, data: Record<string, unknown>) =>
  ((await ha.service(conn, "music_assistant", service, data, true)) as { service_response?: Record<string, unknown> }).service_response ?? {};

export async function library(conn: HaConn, speakers: string[], shelf: Shelf, offset = 0): Promise<Tile[]> {
  const s = await cachedSetup(conn, speakers);
  if (!s) throw new Error("Music Assistant finns inte i Home Assistant.");
  const r = await respond(conn, "get_library", { config_entry_id: s.entryId, ...SHELVES[shelf], limit: 60, offset });
  return tiles(r.items);
}

export async function search(conn: HaConn, speakers: string[], q: string): Promise<Tile[]> {
  const s = await cachedSetup(conn, speakers);
  if (!s) throw new Error("Music Assistant finns inte i Home Assistant.");
  const r = await respond(conn, "search", { config_entry_id: s.entryId, name: q, media_type: ["playlist", "artist", "album", "track", "podcast", "radio"], limit: 8 });
  // Playlists and artists first – what a family picks from a wall – then albums, songs, podcasts and radio stations (TuneIn …).
  return ["playlists", "artists", "albums", "tracks", "podcasts", "radio"].flatMap((k) => tiles(r[k] ?? r.radios));
}

export interface Track {
  uri: string;
  title: string;
  artist?: string;
  image?: string;
}

interface Browsed {
  title?: string;
  thumbnail?: string | null;
  media_content_id?: string;
  media_class?: string;
  children?: Browsed[];
}

/** Music Assistant names a track "Artist - Title" when it browses; split it back. */
export function toTrack(x: Browsed): Track | null {
  if (!x.media_content_id || !x.title || !/^[a-z0-9_-]+:\/\/\S{1,300}$/i.test(x.media_content_id)) return null;
  const at = x.title.indexOf(" - ");
  return {
    uri: x.media_content_id,
    title: (at > 0 ? x.title.slice(at + 3) : x.title).slice(0, 120),
    artist: at > 0 ? x.title.slice(0, at).slice(0, 80) : undefined,
    image: x.thumbnail && /^https?:\/\//.test(x.thumbnail) ? x.thumbnail : undefined,
  };
}

/** Every track in a playlist or album (Music Assistant browses it on one of its players). */
export async function tracksOf(conn: HaConn, speakers: string[], uri: string): Promise<{ title: string; tracks: Track[] }> {
  const s = await cachedSetup(conn, speakers);
  const player = s?.players[0]?.e;
  const sock = haSocket();
  if (!s || !player) throw new Error("Music Assistant finns inte i Home Assistant.");
  if (!sock?.connected) throw new Error("Home Assistant svarar inte just nu.");
  const node = (await sock.call({ type: "media_player/browse_media", entity_id: player, media_content_id: uri, media_content_type: "music" }, 20_000)) as Browsed;
  return { title: node.title ?? "", tracks: (node.children ?? []).map(toTrack).filter((t): t is Track => t !== null).slice(0, 500) };
}

export async function playOn(conn: HaConn, states: Map<string, HaState>, speaker: { entityId: string; name: string }, tile: { uri: string; type: MediaType; start?: string; shuffle?: boolean }) {
  const s = await cachedSetup(conn, [speaker.entityId]);
  if (!s) throw new Error("Music Assistant finns inte i Home Assistant.");
  const names = new Map([...states.values()].map((x) => [x.entity_id, String((x.attributes as { friendly_name?: string }).friendly_name ?? "")]));
  const player = playerFor(s, speaker, names);
  if (!player) throw new Error(`Music Assistant känner inte igen ${speaker.name}. Lägg till högtalaren i Music Assistant, eller välj dess Music Assistant-spelare under Huset → Musik.`);
  // A soundbar or speaker in standby: wake it first (any brand that Home Assistant can turn on).
  if (states.get(player)?.state === "off") await ha.service(conn, "media_player", "turn_on", { entity_id: player }).catch(() => undefined);
  // In order or shuffled – set on the player's queue before it starts.
  if (tile.shuffle !== undefined) await ha.service(conn, "media_player", "shuffle_set", { entity_id: player, shuffle: tile.shuffle }).catch(() => undefined);
  // Music Assistant väntar upp till 15 s om en annan Spotify-ström fortfarande är öppen (Spotify tillåter en åt gången) och hämtar sedan spellistan: ge det tid
  // i stället för att ge upp efter 10 s med ett missvisande "Tidsgräns nådd".
  try {
    await ha.service(conn, "music_assistant", "play_media", { entity_id: player, media_id: tile.uri, media_type: tile.type, enqueue: "replace", ...(tile.start ? { start_item: tile.start } : {}) }, false, 60_000);
  } catch (e) {
    if (/svarade 500/.test((e as Error).message))
      throw new Error(`${speaker.name} kunde inte spela det. Spotify tillåter bara en ström åt gången – stoppa uppspelningen på någon annan högtalare och försök igen.`);
    throw e;
  }
  return player;
}


// ---------- Which music service the family's library comes from ----------

/** Music Assistant's provider domain (the URI scheme of an item) → the name people know it by. */
const PROVIDER_NAMES: Record<string, string> = {
  spotify: "Spotify",
  spotify_connect: "Spotify",
  apple_music: "Apple Music",
  tidal: "Tidal",
  qobuz: "Qobuz",
  deezer: "Deezer",
  ytmusic: "YouTube Music",
  soundcloud: "SoundCloud",
  audible: "Audible",
  tunein: "TuneIn",
  radiobrowser: "Radio Browser",
  filesystem_local: "Lokala filer",
  filesystem_smb: "Lokala filer",
  plex: "Plex",
  jellyfin: "Jellyfin",
  subsonic: "Subsonic",
  opensubsonic: "Subsonic",
  nugs: "Nugs",
  podcastfeed: "Poddar",
  podcastindex: "Poddar",
  itunes_podcasts: "Poddar",
  builtin: "",
  url: "",
};

/** "apple_music://playlist/abc" → "Apple Music"; an unknown service gets its own domain, tidied. */
export function providerOf(uri: string): string {
  const d = uri.match(/^([a-z0-9_-]+):\/\//i)?.[1]?.toLowerCase();
  if (!d) return "";
  if (d in PROVIDER_NAMES) return PROVIDER_NAMES[d]!;
  return d.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** The music services behind a list of tiles, most common first ("Apple Music", or "Apple Music · Tidal"). */
export function libraryNameOf(list: { uri: string }[]): string | undefined {
  const count = new Map<string, number>();
  for (const t of list) {
    const n = providerOf(t.uri);
    if (n) count.set(n, (count.get(n) ?? 0) + 1);
  }
  const names = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  return names.length ? names.slice(0, 2).join(" · ") : undefined;
}

let nameCache: { at: number; name: string | undefined; busy: boolean } = { at: 0, name: undefined, busy: false };

/** The library's name for the Musik tab; the answer comes from the cache and a refresh runs in the background (at most every 30 minutes). */
export function libraryName(conn: HaConn | null, speakers: string[]): string | undefined {
  if (conn && !nameCache.busy && Date.now() - nameCache.at > 30 * 60_000) {
    nameCache.busy = true;
    void (async () => {
      try {
        const [a, b] = await Promise.all([library(conn, speakers, "playlists"), library(conn, speakers, "albums")]);
        nameCache.name = libraryNameOf([...a.slice(0, 30), ...b.slice(0, 30)]) ?? nameCache.name;
      } catch {
        /* Music Assistant not ready: try again later */
      } finally {
        nameCache = { at: Date.now(), name: nameCache.name, busy: false };
      }
    })();
  }
  return nameCache.name;
}
