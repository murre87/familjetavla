import { describe, expect, it } from "vitest";
import { isMaPlayer, libraryNameOf, playerFor, providerOf, SHELVES, toTile } from "./musicAssistant.js";

describe("Music Assistant", () => {
  it("turns library items into covers, web images only", () => {
    expect(toTile({ uri: "spotify://playlist/abc", name: "Fredagsmys", media_type: "playlist", image: "https://i.scdn.co/x.jpg" })).toEqual({
      uri: "spotify://playlist/abc",
      type: "playlist",
      title: "Fredagsmys",
      subtitle: undefined,
      image: "https://i.scdn.co/x.jpg",
    });
    expect(toTile({ uri: "spotify://album/1", name: "Hello", media_type: "album", artists: [{ name: "Laleh" }], image: "http://ma.local:8095/imageproxy?x=1" })).toMatchObject({ subtitle: "Laleh", image: "http://ma.local:8095/imageproxy?x=1" });
    expect(toTile({ uri: "spotify://album/2", name: "x", media_type: "album", image: "file:///etc/passwd" })).toMatchObject({ image: undefined });
    expect(toTile({ uri: "javascript:alert(1)", name: "x", media_type: "track" })).toBeNull();
    expect(toTile({ uri: "spotify://x/1", name: "x", media_type: "folder" })).toBeNull();
  });

  it("knows its own players", () => {
    expect(isMaPlayer({ entity_id: "media_player.kok_2", state: "idle", attributes: { mass_player_type: "player" } } as never)).toBe(true);
    expect(isMaPlayer({ entity_id: "media_player.kok", state: "idle", attributes: {} } as never)).toBe(false);
  });

  it("finds the speaker's Music Assistant player by device, then by name", () => {
    const setup = {
      entryId: "e1",
      players: [
        { e: "media_player.kok_ma", d: "dev-kok", n: "Kök" },
        { e: "media_player.vardagsrum_ma", d: "dev-other", n: "Vardagsrum Sonos" },
      ],
      speakers: { "media_player.kok": "dev-kok", "media_player.sonos": "dev-sonos" } as Record<string, string | null>,
    };
    const names = new Map([["media_player.sonos", "Vardagsrum Sonos"]]);
    expect(playerFor(setup, { entityId: "media_player.kok", name: "Köket" }, names)).toBe("media_player.kok_ma");
    expect(playerFor(setup, { entityId: "media_player.sonos", name: "Vardagsrum" }, names)).toBe("media_player.vardagsrum_ma");
    expect(playerFor(setup, { entityId: "media_player.kok_ma", name: "x" }, names)).toBe("media_player.kok_ma");
    expect(playerFor(setup, { entityId: "media_player.hall", name: "Hall" }, names)).toBeUndefined();
  });
});

describe("tracks in a playlist", () => {
  it("splits Music Assistant's 'Artist - Title' and keeps the cover", async () => {
    const { toTrack } = await import("./musicAssistant.js");
    expect(toTrack({ title: "Morgan Wallen - Last Thing You Need", media_content_id: "spotify://track/abc", thumbnail: "https://i.scdn.co/a.jpg" })).toEqual({
      uri: "spotify://track/abc",
      title: "Last Thing You Need",
      artist: "Morgan Wallen",
      image: "https://i.scdn.co/a.jpg",
    });
    expect(toTrack({ title: "Intro", media_content_id: "library://track/1" })).toMatchObject({ title: "Intro", artist: undefined });
    expect(toTrack({ title: "x", media_content_id: "javascript:alert(1)" })).toBeNull();
  });
});

describe("music service names and radio", () => {
  it("names the service from the item's URI", () => {
    expect(providerOf("spotify://playlist/abc")).toBe("Spotify");
    expect(providerOf("apple_music://playlist/p.1")).toBe("Apple Music");
    expect(providerOf("ytmusic://album/1")).toBe("YouTube Music");
    expect(providerOf("tunein://radio/s1")).toBe("TuneIn");
    expect(providerOf("builtin://playlist/favorites")).toBe("");
    expect(providerOf("brandnew_service://x/1")).toBe("Brandnew service");
    expect(providerOf("no scheme")).toBe("");
  });

  it("calls the library after the services behind it, most common first", () => {
    const apple = Array.from({ length: 5 }, (_, i) => ({ uri: `apple_music://playlist/${i}` }));
    expect(libraryNameOf(apple)).toBe("Apple Music");
    expect(libraryNameOf([...apple, { uri: "spotify://album/1" }])).toBe("Apple Music · Spotify");
    expect(libraryNameOf([{ uri: "builtin://playlist/1" }])).toBeUndefined();
    expect(libraryNameOf([])).toBeUndefined();
  });

  it("has a shelf for Music Assistant's radio stations (TuneIn …)", () => {
    expect(SHELVES.radios).toEqual({ media_type: "radio", order_by: "name" });
  });
});

