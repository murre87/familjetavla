import { describe, expect, it } from "vitest";
import type { HaState } from "./connectors/ha.js";
import { buildMusic, cleanName, clearStationCache, directory, srChannels, pickStations, playCall, searchStations, stationIndex, swedishStations } from "./music.js";
import type { Config } from "./types.js";

const stations = [
  { name: "P4 Jönköping", url: "https://sverigesradio.se/topsy/direkt/srapi/203.mp3" },
  { name: "RIX FM", url: "http://fm01-ice.stream.khz.se/fm01_mp3" },
];
const cfg = { entities: { speakers: [{ name: "Köket", entityId: "media_player.kok" }, { name: "Vardagsrum", entityId: "media_player.vardagsrum" }], stations } } as unknown as Config;
const st = (entity_id: string, state: string, attributes: Record<string, unknown> = {}): [string, HaState] => [entity_id, { entity_id, state, attributes } as HaState];

describe("buildMusic", () => {
  it("is absent without speakers", () => {
    expect(buildMusic({ entities: { stations } } as unknown as Config, new Map())).toBeUndefined();
  });

  it("passes on the station's rolling text (artist – title) but not the station name itself", () => {
    const url = "http://sverigesradio.se/topsy/direkt/srapi/203.mp3";
    const withText = buildMusic(cfg, new Map([st("media_player.kok", "playing", { media_content_id: url, media_artist: "Avicii", media_title: "Waiting For Love" })]))!;
    expect(withText.speakers[0]!.radioText).toBe("Avicii – Waiting For Love");
    const nameOnly = buildMusic(cfg, new Map([st("media_player.kok", "playing", { media_content_id: url, media_title: "P4 Jönköping" })]))!;
    expect(nameOnly.speakers[0]!.radioText).toBeUndefined();
  });

  it("keeps the song, artist and transport buttons for a track, also while paused", () => {
    const m = buildMusic(cfg, new Map([st("media_player.kok", "paused", { media_title: "Dancing Queen", media_artist: "ABBA", media_album_name: "Arrival", media_duration: 231, media_position: 40, supported_features: 1 | 16 | 32 })]))!;
    expect(m.speakers[0]).toMatchObject({ playing: false, paused: true, track: "Dancing Queen", artist: "ABBA", album: "Arrival", duration: 231, canPause: true, canNext: true, canPrev: true });
  });

  it("knows which favourite plays where, and the volume", () => {
    const m = buildMusic(
      cfg,
      new Map([
        st("media_player.kok", "playing", { media_content_id: "http://sverigesradio.se/topsy/direkt/srapi/203.mp3?token=1", volume_level: 0.35 }),
        st("media_player.vardagsrum", "unavailable"),
      ]),
    )!;
    expect(m.speakers[0]).toMatchObject({ playing: true, station: 0, title: "P4 Jönköping", volume: 35, offline: false });
    expect(m.speakers[1]).toMatchObject({ playing: false, offline: true });
    expect(m.speakers[1]!.title).toBeUndefined();
    expect(m.stations.map((s) => s.name)).toEqual(["P4 Jönköping", "RIX FM"]);
  });

  it("shows what else is playing, e.g. Spotify from a phone", () => {
    const m = buildMusic(cfg, new Map([st("media_player.kok", "playing", { media_artist: "Veronica Maggio", media_title: "Jag kommer", app_name: "Spotify" })]))!;
    expect(m.speakers[0]).toMatchObject({ title: "Veronica Maggio – Jag kommer", station: undefined });
  });
});

describe("stationIndex", () => {
  it("matches across http/https, query strings and a trailing slash", () => {
    expect(stationIndex(stations, "https://fm01-ice.stream.khz.se/fm01_mp3/")).toBe(1);
    expect(stationIndex(stations, "spotify:track:1")).toBe(-1);
    expect(stationIndex(stations, undefined)).toBe(-1);
  });
});

describe("playCall", () => {
  it("is a plain play_media any speaker understands", () => {
    expect(playCall("media_player.kok", { ...stations[0]!, logo: "https://x/logo.png" })).toEqual({
      domain: "media_player",
      service: "play_media",
      data: {
        entity_id: "media_player.kok",
        media_content_id: stations[0]!.url,
        media_content_type: "music",
        extra: { title: "P4 Jönköping", thumb: "https://x/logo.png" },
      },
    });
  });
});

describe("pickStations", () => {
  it("keeps working streams, Swedish and https first, one per name", () => {
    const hits = pickStations([
      { name: "RIX FM", url_resolved: "http://a/rix", countrycode: "SE", clickcount: 50, lastcheckok: 1, codec: "MP3", bitrate: 128 },
      { name: "RIX  FM", url_resolved: "https://b/rix", countrycode: "SE", clickcount: 10, lastcheckok: 1, favicon: "https://b/logo.png" },
      { name: "Rix FM Bayern", url_resolved: "https://c/x", countrycode: "DE", clickcount: 900, lastcheckok: 1 },
      { name: "Trasig", url_resolved: "https://d/x", countrycode: "SE", clickcount: 999, lastcheckok: 0 },
      { name: "Ingen länk", url_resolved: "", countrycode: "SE", lastcheckok: 1 },
      { name: "Gammal logga", url_resolved: "https://e/x", countrycode: "SE", lastcheckok: 1, favicon: "http://e/logo.png" },
    ]);
    expect(hits.map((h) => h.name)).toEqual(["RIX FM", "Gammal logga", "Rix FM Bayern"]);
    expect(hits[0]).toMatchObject({ url: "https://b/rix", logo: "https://b/logo.png", country: "SE" });
    expect(hits[1]!.logo).toBeUndefined();
  });
});

describe("searchStations", () => {
  it("tries the next mirror when one is down", async () => {
    const asked: string[] = [];
    const fake = (async (url: string) => {
      asked.push(new URL(url).host);
      if (asked.length === 1) throw new Error("nere");
      return [{ name: "P4 Jönköping", url_resolved: "https://sr/203", countrycode: "SE", lastcheckok: 1 }];
    }) as never;
    const hits = await searchStations("p4 jönköping", fake);
    expect(hits).toHaveLength(1);
    expect(asked).toHaveLength(2);
  });

  it("says so in plain words when the directory is unreachable", async () => {
    const down = (async () => {
      throw new Error("Tidsgräns nådd");
    }) as never;
    await expect(searchStations("rix", down)).rejects.toThrow(/Radiokatalogen svarar inte/);
  });

  it("does not search for a single letter", async () => {
    expect(await searchStations(" p ")).toEqual([]);
  });
});

describe("speaker discovery", () => {
  it("suggests speakers by room, never TVs, Spotify's own player or the home's own groups", async () => {
    const { discover } = await import("./discovery.js");
    const e = (id: string, n: string, a: string | null, m: string | null, extra: Partial<import("./discovery.js").HaEntityInfo> = {}) =>
      ({ e: id, n, a, d: `dev-${id}`, dn: n, m, mo: null, dc: null, u: null, st: "idle", lu: "", ...extra }) as import("./discovery.js").HaEntityInfo;
    const d = discover([
      e("media_player.google_home_mini", "Google Home Mini", "Kök", "Google Inc."),
      e("media_player.sonos_one", "Sonos One", "Vardagsrum", "Sonos"),
      e("media_player.nest_audio", "Nest Audio", "Vardagsrum", "Google Inc."),
      e("media_player.vardagsrum_tv", "Vardagsrum TV", "Vardagsrum", "Samsung", { dc: "tv" }),
      e("media_player.spotify_anna", "Spotify Anna", null, "Spotify AB"),
      e("media_player.mitt_hus", "Mitt hus", null, null, { o: true }),
      e("media_player.gammal", "Gammal", "Hall", "Google Inc.", { st: "unavailable" }),
    ]);
    expect(d.speakers).toEqual([
      { name: "Kök", entityId: "media_player.google_home_mini" },
      { name: "Sonos One", entityId: "media_player.sonos_one" },
      { name: "Nest Audio", entityId: "media_player.nest_audio" },
    ]);
    expect(d.summary).toContain("Högtalare: Kök, Sonos One, Nest Audio");
  });
});

describe("all Swedish stations", () => {
  const rb = (stationuuid: string, name: string, url: string, clickcount = 0, extra = {}) => ({ stationuuid, name, url_resolved: url, countrycode: "SE", lastcheckok: 1, clickcount, ...extra });

  it("reads Sveriges Radio names plainly", () => {
    expect(cleanName("SR P4 Jönköping")).toEqual({ name: "P4 Jönköping", sr: true });
    expect(cleanName("Sveriges Radio - P3")).toEqual({ name: "P3", sr: true });
    expect(cleanName("P4 Östergötland")).toEqual({ name: "P4 Östergötland", sr: true });
    expect(cleanName("Mix Megapol")).toEqual({ name: "Mix Megapol", sr: false });
    expect(cleanName("Sr")).toEqual({ name: "Sr", sr: false });
  });

  it("puts Sveriges Radio first in P1–P4 order, then the rest by popularity, one per name", () => {
    const list = directory([
      rb("a", "Mix Megapol", "https://m/1", 900),
      rb("b", "SR P4 Östergötland", "https://sr/p4og", 50),
      rb("c", "Sveriges Radio - P3", "https://sr/p3", 300),
      rb("d", "SR P4 Jönköping", "http://sr/p4j-old", 80),
      rb("e", "SR P4 Jönköping", "https://sr/p4j", 10),
      rb("f", "RIX FM", "https://rix", 1000),
      rb("g", "SR P1", "https://sr/p1", 200),
      rb("h", "Trasig", "https://x", 5000, { lastcheckok: 0 }),
      rb("", "Utan id", "https://y", 5),
    ]);
    expect(list.map((x) => `${x.group}:${x.name}`)).toEqual(["sr:P1", "sr:P3", "sr:P4 Jönköping", "sr:P4 Östergötland", "other:RIX FM", "other:Mix Megapol"]);
    expect(list.find((x) => x.name === "P4 Jönköping")).toMatchObject({ id: "e", url: "https://sr/p4j" });
  });

  it("takes Sveriges Radio from its own API, the rest from the directory, once a day", async () => {
    clearStationCache();
    const asked: string[] = [];
    const up = (async (url: string) => {
      asked.push(new URL(url).host);
      if (url.includes("api.sr.se"))
        return { channels: [{ id: 210, name: "P4 Östergötland", channeltype: "Lokal kanal", liveaudio: { url: "https://sr/p4og" } }, { id: 164, name: "P3", channeltype: "Rikskanal", liveaudio: { url: "https://sr/p3" } }] };
      return [rb("rb-p3", "SR P3", "https://rb/p3"), rb("mix", "Mix Megapol", "https://m")];
    }) as never;
    const t0 = Date.UTC(2026, 9, 21, 8);
    expect((await swedishStations(up, t0)).map((x) => `${x.group}:${x.name}`)).toEqual(["sr:P3", "sr:P4 Östergötland", "other:Mix Megapol"]);
    await swedishStations(up, t0 + 3600_000);
    expect(asked).toEqual(["api.sr.se", "de1.api.radio-browser.info"]);
  });

  it("keeps working when one source is down, and keeps the last good list when both are", async () => {
    clearStationCache();
    const srDown = (async (url: string) => {
      if (url.includes("api.sr.se")) throw new Error("nere");
      return [rb("rb-p3", "SR P3", "https://rb/p3")];
    }) as never;
    const down = (async () => {
      throw new Error("nere");
    }) as never;
    const t0 = Date.UTC(2026, 9, 21, 8);
    expect((await swedishStations(srDown, t0)).map((x) => x.name)).toEqual(["P3"]);
    expect((await swedishStations(down, t0 + 25 * 3600_000)).map((x) => x.name)).toEqual(["P3"]);
    clearStationCache();
    await expect(swedishStations(down, t0)).rejects.toThrow(/Radiokanalerna går inte att hämta/);
  });

  it("orders Sveriges Radio: national channels, then the local P4s", () => {
    expect(
      srChannels([
        { id: 1, name: "P4 Jönköping", channeltype: "Lokal kanal", liveaudio: { url: "https://a" } },
        { id: 2, name: "P1", channeltype: "Rikskanal", liveaudio: { url: "https://b" }, image: "https://img" },
        { id: 3, name: "Utan ström", channeltype: "Rikskanal" },
        { id: 4, name: "SR Sápmi", channeltype: "Minoritet och språk", liveaudio: { url: "https://c" } },
      ]).map((x) => x.name),
    ).toEqual(["P1", "P4 Jönköping", "SR Sápmi"]);
  });
});

describe("Spotify", () => {
  it("is null without the integration, so the tab can say how to add it", () => {
    expect(buildMusic(cfg, new Map([st("media_player.kok", "idle")]))!.spotify).toBeNull();
  });
  it("shows what plays and where", () => {
    const m = buildMusic(cfg, new Map([st("media_player.kok", "playing"), st("media_player.spotify_anna", "playing", { media_artist: "Laleh", media_title: "Some Die Young", source: "Kök", source_list: ["Kök", "Q-Series Soundbar"] })]))!;
    expect(m.spotify).toEqual({ entityId: "media_player.spotify_anna", playing: true, title: "Laleh – Some Die Young", device: "Kök", offline: false, devices: ["Kök", "Q-Series Soundbar"] });
  });
  it("turns library links into Spotify URIs", async () => {
    const { spotifyUri } = await import("./music.js");
    expect(spotifyUri("spotify://playlist/37i9dQZF1DXcBWIGoYBM5M")).toBe("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M");
    expect(spotifyUri("spotify:album:4aawyAB9vmqN3uQ7FjRGTy")).toBe("spotify:album:4aawyAB9vmqN3uQ7FjRGTy");
    expect(spotifyUri("tidal://playlist/1")).toBeUndefined();
  });
});
