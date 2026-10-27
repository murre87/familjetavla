import { useState } from "react";
import type { Config, RadioStation } from "../../../server/src/types";
import { api, type StationHit } from "../api";
import { Icon } from "../Icon";
import { EntityPicker, Text } from "./parts";
import { haAddIntegration } from "../widgets/music";

/**
 * Huset → Musik: which speakers the board plays on, and the favourite stations.
 * Stations come from an open radio directory, so every Swedish channel is a search away.
 */
export function MusicCard({ cfg, set, saveNow }: { cfg: Config; set: (c: Config | ((prev: Config) => Config)) => void; saveNow: () => Promise<void> }) {
  const speakers = cfg.entities.speakers ?? [];
  const stations = cfg.entities.stations ?? [];
  const setEn = (patch: Partial<Config["entities"]>) =>
    set((c) => {
      const entities = { ...c.entities, ...patch };
      // The first speaker turns the Musik card on – otherwise nobody finds it under Startskärm.
      const turnOn = !(c.entities.speakers ?? []).length && (entities.speakers ?? []).length > 0;
      const home = turnOn ? c.dashboard.home.map((w) => (w.id === "music" ? { ...w, on: true } : w)) : c.dashboard.home;
      return { ...c, entities, dashboard: { ...c.dashboard, home } };
    });

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<StationHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [own, setOwn] = useState({ name: "", url: "" });
  const search = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    setError("");
    try {
      setHits((await api.searchStations(q.trim())).stations);
    } catch (e) {
      setError((e as Error).message);
      setHits(null);
    } finally {
      setBusy(false);
    }
  };
  const has = (url: string) => stations.some((s) => s.url === url);
  const add = (s: RadioStation) => !has(s.url) && stations.length < 16 && setEn({ stations: [...stations, { name: s.name, url: s.url, ...(s.logo ? { logo: s.logo } : {}) }] });
  const move = (i: number, d: -1 | 1) => {
    const next = [...stations];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    setEn({ stations: next });
  };
  const ownOk = own.name.trim() && /^https?:\/\/\S+$/.test(own.url.trim());
  // "Prova": play it on the default speaker right now, so a dead stream is found before it is added.
  const [trying, setTrying] = useState<{ url: string; msg: string; ok: boolean } | null>(null);
  const tryIt = async (s: RadioStation) => {
    const sp = speakers[0];
    if (!sp) return setTrying({ url: s.url, ok: false, msg: "Lägg till en högtalare först." });
    setTrying({ url: s.url, ok: true, msg: `Startar i ${sp.name} …` });
    try {
      await saveNow();
      await api.tryStation(s.name, s.url, sp.entityId);
      setTrying({ url: s.url, ok: true, msg: `Spelar i ${sp.name}? Hörs inget efter några sekunder fungerar inte strömmen där – välj en annan träff.` });
    } catch (e) {
      setTrying({ url: s.url, ok: false, msg: (e as Error).message });
    }
  };
  const stopTry = async () => {
    if (speakers[0]) await api.stopMusic(speakers[0].entityId).catch(() => {});
    setTrying(null);
  };
  const tryNote = (url: string) =>
    trying?.url === url && (
      <p className={trying.ok ? "muted" : "error-text"} style={{ margin: 0, flexBasis: "100%" }} role="status">
        {trying.msg}{" "}
        {trying.ok && (
          <button type="button" className="btn small ghost" onClick={() => void stopTry()}>
            Stoppa
          </button>
        )}
      </p>
    );

  return (
    <section className="card stack">
      <div>
        <h2>Musik</h2>
        <p className="muted" style={{ margin: 0 }}>
          Tryck på en kanal på tavlan så spelar den i vald högtalare – Google Home/Nest, Chromecast, Sonos eller annat som finns i Home Assistant.
        </p>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <b>Högtalare</b>
        {speakers.map((s, i) => (
          <div className="row gap" key={s.entityId} style={{ alignItems: "center" }}>
            <div className="grow">
              <Text label={s.entityId} value={s.name} onChange={(v) => setEn({ speakers: speakers.map((x, j) => (j === i ? { ...x, name: v } : x)) })} />
            </div>
            {i === 0 ? (
              <span className="chip on" title="Spelar här om ingen väljer annat">Förvald</span>
            ) : (
              <button className="btn small" onClick={() => setEn({ speakers: [s, ...speakers.filter((_, j) => j !== i)] })}>
                Gör förvald
              </button>
            )}
            <button className="btn small ghost" aria-label={`Ta bort ${s.name}`} onClick={() => setEn({ speakers: speakers.filter((_, j) => j !== i) })}>
              <Icon name="x" size={18} />
            </button>
          </div>
        ))}
        <EntityPicker
          label={speakers.length ? "Lägg till högtalare" : "Högtalare"}
          domains={["media_player"]}
          value={undefined}
          onChange={(v, o) => v && !speakers.some((s) => s.entityId === v) && setEn({ speakers: [...speakers, { entityId: v, name: o?.name ?? v }] })}
          help="Den förvalda spelar när man bara trycker på en kanal. Väljer man en annan högtalare på tavlan gäller det i fem minuter, sedan är den förvalda vald igen."
        />
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <b>Kanaler på tavlan</b>
        {stations.length === 0 && <p className="muted" style={{ margin: 0 }}>Inga än – sök nedan, t.ex. "P4 Jönköping" eller "RIX FM".</p>}
        {stations.map((s, i) => (
          <div className="row gap wrap" key={s.url} style={{ alignItems: "center" }}>
            <div className="grow">
              <Text label={`Kanal ${i + 1}`} value={s.name} onChange={(v) => setEn({ stations: stations.map((x, j) => (j === i ? { ...x, name: v } : x)) })} />
            </div>
            <button className="btn small" disabled={!speakers.length} onClick={() => void tryIt(s)}>
              Prova
            </button>
            <button className="btn small ghost" aria-label={`Flytta upp ${s.name}`} disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button className="btn small ghost" aria-label={`Ta bort ${s.name}`} onClick={() => setEn({ stations: stations.filter((_, j) => j !== i) })}>
              <Icon name="x" size={18} />
            </button>
            {tryNote(s.url)}
          </div>
        ))}
      </div>

      <form
        className="stack"
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <label className="field">
          <span>Sök radiokanal</span>
          <div className="row gap">
            <input className="grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="P4 Jönköping, RIX FM, Mix Megapol …" maxLength={60} enterKeyHint="search" />
            <button className="btn" disabled={busy || q.trim().length < 2}>
              {busy ? "Söker…" : "Sök"}
            </button>
          </div>
        </label>
        {error && <p className="error-text">{error}</p>}
        {hits && hits.length === 0 && <p className="muted">Hittade ingen kanal som heter så. Prova en kortare sökning.</p>}
        {hits && hits.length > 0 && (
          <div className="station-hits">
            {hits.map((h) => (
              <div key={h.url} className="row gap wrap" style={{ alignItems: "center" }}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <b>{h.name}</b>
                  <small className="muted" style={{ display: "block" }}>
                    {[h.country, h.quality].filter(Boolean).join(" · ")}
                  </small>
                </span>
                <button type="button" className="btn small ghost" disabled={!speakers.length} onClick={() => void tryIt(h)}>
                  Prova
                </button>
                <button type="button" className="btn small" disabled={has(h.url) || stations.length >= 16} onClick={() => add(h)}>
                  {has(h.url) ? "Tillagd" : "Lägg till"}
                </button>
                {tryNote(h.url)}
              </div>
            ))}
          </div>
        )}
      </form>

      <details>
        <summary>Egen länk till en ström</summary>
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          <Text label="Namn" value={own.name} onChange={(v) => setOwn({ ...own, name: v })} placeholder="Skolradion" />
          <Text label="Länk (http eller https)" value={own.url} onChange={(v) => setOwn({ ...own, url: v })} placeholder="https://…/stream.mp3" />
          <button
            className="btn small"
            style={{ alignSelf: "flex-start" }}
            disabled={!ownOk}
            onClick={() => {
              add({ name: own.name.trim().slice(0, 40), url: own.url.trim() });
              setOwn({ name: "", url: "" });
            }}
          >
            Lägg till
          </button>
        </div>
      </details>

      <div className="stack" style={{ gap: 8 }}>
        <b>Spotify, Apple Music m.fl. – spellistor, album och poddar</b>
        <p className="muted" style={{ margin: 0 }}>
          För att välja och spela spellistor, album och poddar på tavlan behövs <b>Music Assistant</b> (gratis). Fliken Musik (biblioteket) visar steg för steg hur det installeras – med en knapp i Home Assistant OS, och för Home Assistant i Docker en text att klistra in i Portainer, Synology eller Unraid. Radion fungerar utan.
        </p>
        <a className="btn small" style={{ alignSelf: "flex-start" }} href={haAddIntegration("music_assistant")} target="_top" rel="noopener">
          <Icon name="plus" size={16} /> Koppla Music Assistant till Home Assistant
        </a>
      </div>
    </section>
  );
}
