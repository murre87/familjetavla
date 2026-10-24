import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Dashboard, Music as MusicData } from "../../../server/src/types";
import { api, type DirStation, type Shelf, type Tile, type Track } from "../api";
import { Icon } from "../Icon";
import type { Actions } from "../dashboard/Dashboard";
import type { WidgetModule } from "./types";

// ---------- Which speaker ----------
// The default speaker (first under Huset → Musik) is always one tap away: "RIX FM" plays in the
// kitchen. Picking another one in the Musik tab holds for a few minutes after the last tap, then the
// board goes back to the default. Shared by the home card and the tab.

const BACK_TO_DEFAULT_MS = 5 * 60_000;
let chosen: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function choose(id: string | null) {
  chosen = id;
  clearTimeout(timer);
  if (id) timer = setTimeout(() => choose(null), BACK_TO_DEFAULT_MS);
  emit();
}
/** Any tap in the tab keeps a picked speaker a little longer. */
const keep = () => {
  if (chosen) choose(chosen);
};
function useSpeaker(m: MusicData) {
  const id = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => chosen,
  );
  const sp = m.speakers.find((s) => s.entityId === id) ?? m.speakers[0]!;
  return { sp, choose: (x: string) => choose(x === m.speakers[0]!.entityId ? null : x) };
}

type Speaker = MusicData["speakers"][number];

const norm = (u: string) => u.replace(/^https?:\/\//, "").replace(/[?#].*$/, "").replace(/\/$/, "");
const sameStream = (a?: string, b?: string) => Boolean(a && b && norm(a) === norm(b));

function useControls(sp: Speaker, actions: Actions) {
  const now = (d: Dashboard) => d.music?.speakers.find((s) => s.entityId === sp.entityId);
  const started = (name: string, isIt: (s: Speaker | undefined) => boolean) => ({
    done: `${name} spelar i ${sp.name}`,
    check: (d: Dashboard) => isIt(now(d)),
    slow: `${name} är skickad till ${sp.name} – vissa högtalare tar en stund att starta.`,
  });
  return {
    playFav: (index: number, name: string) => {
      keep();
      return actions.run(name, () => api.playStation(index, sp.entityId), started(name, (s) => s?.station === index));
    },
    playDir: (st: DirStation) => {
      keep();
      return actions.run(st.name, () => api.playStationId(st.id, sp.entityId), started(st.name, (s) => sameStream(s?.playingUrl, st.url)));
    },
    stop: () => actions.run(`Stopp i ${sp.name}`, () => api.stopMusic(sp.entityId), { done: `Tyst i ${sp.name}`, check: (d) => !now(d)?.playing }),
    volume: (pct: number) => {
      keep();
      return actions.run(`Volym i ${sp.name}`, () => api.volume(sp.entityId, Math.max(0, Math.min(100, pct))));
    },
  };
}

/**
 * "P4 Jönköping · Kök" with − volume + and Stopp. While something plays, a long swipe up or down also
 * turns the volume (a bar shows over the page while swiping); a short touch does nothing, so it never fights a tap.
 */
/** Volymreglage: en riktig skjutreglage med fylld bana, stor tumme och tydligt värde. Skickar medan man drar (högst fem gånger i sekunden) och slutvärdet när man släpper. */
function VolumeSlider({ value, onCommit, label }: { value: number; onCommit: (v: number) => void; label: string }) {
  const [local, setLocal] = useState(value);
  const dragging = useRef(false);
  const last = useRef({ sent: value, at: 0 });
  useEffect(() => {
    if (!dragging.current) setLocal(value);
  }, [value]);
  const send = (v: number, force = false) => {
    const now = Date.now();
    if (v !== last.current.sent && (force || now - last.current.at > 200)) {
      last.current = { sent: v, at: now };
      onCommit(v);
    }
  };
  return (
    <div className="vol-slider" onClick={(e) => e.stopPropagation()}>
      <button className="vol-ico" aria-label={local === 0 ? "Ljudet är av" : "Stäng av ljudet"} onClick={() => { const v = local === 0 ? 20 : 0; setLocal(v); send(v, true); }}>
        <Icon name={local === 0 ? "speakerMute" : local < 35 ? "speakerLow" : "speaker"} size={22} />
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={local}
        aria-label={label}
        style={{ ["--v" as string]: `${local}%` }}
        onPointerDown={() => (dragging.current = true)}
        onInput={(e) => {
          const v = Number((e.target as HTMLInputElement).value);
          setLocal(v);
          send(v);
        }}
        onPointerUp={() => {
          dragging.current = false;
          send(local, true);
        }}
        onKeyUp={() => send(local, true)}
        onBlur={() => {
          dragging.current = false;
          send(local, true);
        }}
      />
      <b className="vol-val">{local}</b>
    </div>
  );
}

/** Omslag (eller kanalens logga). Faller tillbaka på en färgad ruta med not om bilden saknas. */
function NowCover({ sp, logo }: { sp: Speaker; logo?: string }) {
  const [bad, setBad] = useState(false);
  const key = `${sp.track ?? ""}|${sp.artist ?? ""}|${sp.album ?? ""}`;
  useEffect(() => setBad(false), [key, logo]);
  const src = logo ?? (sp.cover ? `api/music/cover/${encodeURIComponent(sp.entityId)}?k=${encodeURIComponent(key)}` : undefined);
  return (
    <div className="now-cover" aria-hidden="true">
      {src && !bad ? <img src={src} alt="" onError={() => setBad(true)} /> : <Icon name="music" size={30} />}
    </div>
  );
}

/** Förloppsfält som räknar fram var låten är nu mellan svaren från Home Assistant. */
function NowProgress({ sp }: { sp: Speaker }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (sp.duration === undefined || sp.paused) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [sp.duration, sp.paused]);
  if (sp.duration === undefined || sp.position === undefined) return null;
  const since = sp.paused || !sp.positionAt ? 0 : Math.max(0, (Date.now() - Date.parse(sp.positionAt)) / 1000);
  const pos = Math.min(sp.duration, sp.position + since);
  const mmss = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
  return (
    <div className="now-prog" role="progressbar" aria-valuemin={0} aria-valuemax={Math.round(sp.duration)} aria-valuenow={Math.round(pos)}>
      <span>{mmss(pos)}</span>
      <i>
        <b style={{ width: `${(pos / sp.duration) * 100}%` }} />
      </i>
      <span>{mmss(sp.duration)}</span>
    </div>
  );
}

/** En rad text som rullar fram och tillbaka när den inte får plats (kanalens "rullande text"). */
function Ticker({ text, className }: { text: string; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const b = box.current;
    const i = inner.current;
    if (b && i) setShift(Math.min(0, b.clientWidth - i.scrollWidth));
  }, [text]);
  return (
    <span ref={box} className={`ticker ${className ?? ""}`} title={text}>
      <span ref={inner} className={shift < 0 ? "moving" : ""} style={{ ["--shift" as string]: `${shift}px` }}>
        {text}
      </span>
    </span>
  );
}

function NowPlaying({ sp, actions, showName, logo }: { sp: Speaker; actions: Actions; showName: boolean; logo?: string }) {
  const c = useControls(sp, actions);
  const vol = sp.volume ?? null;
  const canDrag = sp.playing && !sp.offline && vol !== null;
  const rich = !sp.offline && (Boolean(sp.track) || (sp.playing && (Boolean(logo) || Boolean(sp.radioText))));
  const transport = (action: "play_pause" | "next" | "previous", label: string) => actions.run(label, () => api.musicTransport(sp.entityId, action), { done: label, check: () => true });
  if (rich) {
    return (
      <div className={`music-now now-rich ${canDrag ? "can-drag" : ""}`}>
        <NowCover sp={sp} logo={logo} />
        <div className="now-main">
          <b className="now-title">{sp.track ?? sp.title}</b>
          <Ticker className="now-sub" text={sp.radioText ?? ([sp.artist, sp.album].filter(Boolean).join(" · ") || (showName ? "" : sp.name) || sp.name)} />
          <NowProgress sp={sp} />
        </div>
        <div className="now-row">
        <div className="now-ctl">
          {sp.canPrev && (
            <button className="now-btn" aria-label="Föregående" onClick={() => void transport("previous", "Föregående")}>
              <Icon name="prev" size={22} />
            </button>
          )}
          {(sp.canPause || sp.paused) && (
            <button className="now-btn big" aria-label={sp.paused ? "Spela" : "Pausa"} onClick={() => void transport("play_pause", sp.paused ? "Spela" : "Paus")}>
              <Icon name={sp.paused ? "play" : "pause"} size={26} />
            </button>
          )}
          {sp.canNext && (
            <button className="now-btn" aria-label="Nästa" onClick={() => void transport("next", "Nästa")}>
              <Icon name="next" size={22} />
            </button>
          )}
          <button className="now-btn" aria-label="Stopp" onClick={() => void c.stop()}>
            <Icon name="stop" size={20} />
          </button>
        </div>
        {!sp.offline && vol !== null && (
          <div className="now-vol">
            <VolumeSlider value={vol} label={`Volym i ${sp.name}`} onCommit={(v) => void c.volume(v)} />
          </div>
        )}
        </div>
      </div>
    );
  }
  return (
    <div className={`music-now ${canDrag ? "can-drag" : ""}`}>
      <Icon name="speaker" size={20} />
      <span className="music-title">
        {sp.offline ? `${sp.name} svarar inte` : sp.playing ? `${sp.title ?? "Spelar"}${showName ? ` · ${sp.name}` : ""}` : `${sp.name} · tyst`}
      </span>
      <span className="music-ctl">
        {!sp.offline && vol !== null && (
          <span className="music-vol">
            <VolumeSlider value={vol} label={`Volym i ${sp.name}`} onCommit={(v) => void c.volume(v)} />
          </span>
        )}
        {sp.playing && (
          <button className="btn small" onClick={() => void c.stop()}>
            <Icon name="stop" size={16} /> Stopp
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * Volume like a video player: a long drag up or down while music plays. On tablets anywhere in the
 * Musik tab (it never scrolls), on phones on the row with what plays (the page scrolls there).
 * It takes over only after a clear vertical move, so taps on buttons and covers work as before.
 */
function useVolumeDrag(sp: Speaker, set: (pct: number) => unknown) {
  const [shown, setShown] = useState<number | null>(null);
  const st = useRef<{ x: number; y: number; from: number; on: boolean; id: number } | null>(null);
  const swallow = useRef(0);
  const active = sp.playing && !sp.offline && typeof sp.volume === "number";
  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (!active) return;
      const tablet = window.matchMedia(TABLET).matches;
      if (!tablet && !(e.target as HTMLElement).closest(".music-now")) return;
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      st.current = { x: e.clientX, y: e.clientY, from: sp.volume!, on: false, id: e.pointerId };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = st.current;
      if (!d || d.id !== e.pointerId) return;
      const dy = d.y - e.clientY;
      if (!d.on) {
        if (Math.abs(dy) < 30 || Math.abs(dy) < Math.abs(e.clientX - d.x) * 1.5) return;
        d.on = true;
        document.documentElement.dataset.volDrag = "1"; // tavlans "dra ner för att ladda om" ska inte tro att det är för den
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      // 1 % per 4 px after the first 30.
      setShown(Math.max(0, Math.min(100, d.from + Math.round((dy - Math.sign(dy) * 30) / 4))));
    },
    onPointerUp: () => {
      const d = st.current;
      st.current = null;
      delete document.documentElement.dataset.volDrag;
      if (d?.on) {
        swallow.current = Date.now();
        if (shown !== null && shown !== d.from) void set(shown);
      }
      setShown(null);
    },
    onPointerCancel: () => {
      st.current = null;
      delete document.documentElement.dataset.volDrag;
      setShown(null);
    },
    // A drag that started on a button must not also press it.
    onClickCapture: (e: React.MouseEvent) => {
      if (Date.now() - swallow.current < 400) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
  };
  // Läggs direkt på sidan (portal): kort med glas-effekt skulle annars bli en egen "fixed"-yta och klippa reglaget.
  const overlay =
    shown !== null
      ? createPortal(
          <div className="vol-overlay" role="status" aria-live="polite" aria-label={`Volym ${shown} procent`}>
            <div className="vol-card">
              <Icon name="speaker" size={26} />
              <div className="vol-track">
                <div className="vol-fill" style={{ height: `${shown}%` }} />
              </div>
              <b className="vol-pct">
                {shown}
                <small>%</small>
              </b>
            </div>
          </div>,
          document.body,
        )
      : null;
  return { handlers, overlay, active };
}

function StationButton({ name, logo, on, disabled, onPlay }: { name: string; logo?: string; on: boolean; disabled: boolean; onPlay: () => void }) {
  return (
    <button className={`light-btn station-btn ${on ? "on" : ""}`} aria-pressed={on} disabled={disabled} onClick={onPlay}>
      {logo ? <img src={logo} alt="" width={24} height={24} loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} /> : <Icon name="music" size={20} />}
      <span className="station-name">{name}</span>
    </button>
  );
}

// ---------- Home card: just the favourites ----------

/** Musik on the home screen: the favourites, one tap plays them on the default speaker. */
export function Music({ data, actions }: { data: Dashboard; actions: Actions }) {
  const m = data.music;
  if (!m?.speakers.length) return null;
  return <MusicCard m={m} actions={actions} />;
}

function MusicCard({ m, actions }: { m: MusicData; actions: Actions }) {
  const { sp } = useSpeaker(m);
  const c = useControls(sp, actions);
  const drag = useVolumeDrag(sp, (pct) => c.volume(pct));
  return (
    <section className={`card music-card ${drag.active ? "vol-drag" : ""}`} style={{ flexGrow: 1 }} {...drag.handlers}>
      {drag.overlay}
      <div className="card-head">
        <h2>Musik</h2>
      </div>
      <NowPlaying sp={sp} actions={actions} showName={false} logo={sp.station !== undefined ? m.stations[sp.station]?.logo : undefined} />
      {m.stations.length > 0 ? (
        <div className="grid-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 160px), 1fr))" }}>
          {m.stations.map((s) => (
            <StationButton key={s.index} name={s.name} logo={s.logo} on={sp.playing && sp.station === s.index} disabled={sp.offline} onPlay={() => void c.playFav(s.index, s.name)} />
          ))}
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          Tryck här och välj kanaler med ☆.
        </p>
      )}
    </section>
  );
}

// ---------- Pages instead of scrolling ----------
// Tablets never scroll: the list shows as many stations as fit its box, and "Fler" turns the page.
// Phones show the whole list and the page scrolls as usual.

const TABLET = "(min-width: 1000px) and (min-height: 600px), (min-width: 700px) and (min-height: 900px)";

function usePages(count: number, reset: unknown) {
  const box = useRef<HTMLDivElement>(null);
  const [per, setPer] = useState(0);
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [reset]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      if (!window.matchMedia(TABLET).matches) return setPer(0);
      const first = el.firstElementChild as HTMLElement | null;
      if (!first) return;
      const cs = getComputedStyle(el);
      const gap = parseFloat(cs.rowGap) || 0;
      const cols = Math.max(1, cs.gridTemplateColumns.split(" ").filter(Boolean).length);
      const rows = Math.max(1, Math.floor((el.clientHeight + gap) / (first.offsetHeight + gap)));
      setPer(rows * cols);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count]);
  const pages = per ? Math.max(1, Math.ceil(count / per)) : 1;
  const at = Math.min(page, pages - 1);
  return { box, from: per ? at * per : 0, to: per ? (at + 1) * per : count, at, pages, setPage };
}

// ---------- The Musik tab: speakers, favourites and every Swedish station ----------

export function MusicPage({ data, actions }: { data: Dashboard; actions: Actions }) {
  const m = data.music;
  if (!m?.speakers.length) return <p className="muted">Välj högtalare under Inställningar → Huset → Musik.</p>;
  return <MusicTab m={m} actions={actions} />;
}

function MusicTab({ m, actions }: { m: MusicData; actions: Actions }) {
  const { sp, choose: pick } = useSpeaker(m);
  const c = useControls(sp, actions);
  const [source, setSource] = useState<"radio" | "library">("radio");
  const libName = "Spotify";
  const drag = useVolumeDrag(sp, (pct) => c.volume(pct));

  return (
    <div className={`music-tab ${drag.active ? "vol-drag" : ""}`} {...drag.handlers}>
      {drag.overlay}
      <section className="card">
        {m.speakers.length > 1 && (
          <div className="seg music-speakers" role="radiogroup" aria-label="Högtalare">
            {m.speakers.map((s) => (
              <button key={s.entityId} className={`seg-btn ${s.entityId === sp.entityId ? "on" : ""}`} role="radio" aria-checked={s.entityId === sp.entityId} onClick={() => pick(s.entityId)}>
                <Icon name="speaker" size={18} /> {s.name}
              </button>
            ))}
          </div>
        )}
        <NowPlaying sp={sp} actions={actions} showName={m.speakers.length < 2} logo={sp.station !== undefined ? m.stations[sp.station]?.logo : undefined} />
        {m.stations.length > 0 && (
          <div className="music-favs">
            {m.stations.map((s) => (
              <StationButton key={s.index} name={s.name} logo={s.logo} on={sp.playing && sp.station === s.index} disabled={sp.offline} onPlay={() => void c.playFav(s.index, s.name)} />
            ))}
          </div>
        )}
      </section>

      <section className="card music-all">
        <div className="card-head">
          <div className="seg" role="tablist" aria-label="Lyssna på">
            <button className={`seg-btn ${source === "radio" ? "on" : ""}`} role="tab" aria-selected={source === "radio"} onClick={() => setSource("radio")}>
              <Icon name="music" size={18} /> Radio
            </button>
            <button className={`seg-btn ${source === "library" ? "on" : ""}`} role="tab" aria-selected={source === "library"} onClick={() => setSource("library")}>
              <Icon name="play" size={18} /> {libName}
            </button>
          </div>
        </div>
        {source === "radio" ? <AllStations m={m} sp={sp} actions={actions} /> : m.assistant ? <Library sp={sp} connect={m.spotify?.devices ?? []} actions={actions} /> : <AssistantSetup />}
      </section>

      {source === "library" && m.spotify && <SpotifyBox sp={m.spotify} actions={actions} />}
    </div>
  );
}

function Pager({ pg, hint }: { pg: ReturnType<typeof usePages>; hint?: string }) {
  return (
    <div className="music-pager">
      <span className="muted music-hint">{hint}</span>
      {pg.pages > 1 && (
        <span className="row gap" style={{ alignItems: "center" }}>
          <button className="btn small" aria-label="Föregående sida" disabled={pg.at === 0} onClick={() => pg.setPage(pg.at - 1)}>
            ‹
          </button>
          <span className="muted">
            {pg.at + 1} av {pg.pages}
          </span>
          <button className="btn small" disabled={pg.at >= pg.pages - 1} onClick={() => pg.setPage(pg.at + 1)}>
            Fler ›
          </button>
        </span>
      )}
    </div>
  );
}

/** Every Swedish station: Sveriges Radio or the others, or a search across both. */
function AllStations({ m, sp, actions }: { m: MusicData; sp: Speaker; actions: Actions }) {
  const c = useControls(sp, actions);
  const [all, setAll] = useState<DirStation[] | null>(null);
  const [error, setError] = useState("");
  const [group, setGroup] = useState<"sr" | "other">("sr");
  const [q, setQ] = useState("");
  // Every other station hides behind one button: the favourites are what a family taps.
  const [open, setOpen] = useState(m.stations.length === 0);
  useEffect(() => {
    if (!open) return;
    api
      .musicStations()
      .then((r) => setAll(r.stations))
      .catch((e: Error) => setError(e.message));
  }, [open]);
  const favUrls = useMemo(() => m.stations.map((s) => s.url ?? ""), [m.stations]);
  const isFav = (url: string) => favUrls.some((u) => sameStream(u, url));
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase();
    return (all ?? []).filter((s) => (words ? s.name.toLowerCase().includes(words) : s.group === group));
  }, [all, group, q]);
  const pg = usePages(shown.length, `${group}|${q}`);
  const star = (s: DirStation) => {
    keep();
    const on = !isFav(s.url);
    return actions.run(on ? `${s.name} på startsidan` : `${s.name} borttagen`, () => api.favoriteStation(on ? { id: s.id, on } : { url: m.stations.find((x) => sameStream(x.url, s.url))?.url ?? s.url, on }), {
      done: on ? `${s.name} ligger nu på startsidan` : `${s.name} är borttagen från startsidan`,
      check: (d) => (d.music?.stations ?? []).some((x) => sameStream(x.url, s.url)) === on,
    });
  };
  if (!open)
    return (
      <div className="more-stations">
        <button className="btn" onClick={() => setOpen(true)} aria-expanded={false}>
          Fler kanaler ▾
        </button>
        <small className="muted">Alla Sveriges Radios kanaler och de andra svenska – ☆ lägger en kanal bland favoriterna.</small>
      </div>
    );
  return (
    <>
      <div className="music-filter">
        <button className="btn small" onClick={() => setOpen(false)} aria-expanded={true} aria-label="Dölj kanallistan">
          ▴ Dölj
        </button>
        <div className="seg small" role="radiogroup" aria-label="Kanaler">
          <button className={`seg-btn ${!q && group === "sr" ? "on" : ""}`} role="radio" aria-checked={!q && group === "sr"} onClick={() => (setQ(""), setGroup("sr"))}>
            Sveriges Radio
          </button>
          <button className={`seg-btn ${!q && group === "other" ? "on" : ""}`} role="radio" aria-checked={!q && group === "other"} onClick={() => (setQ(""), setGroup("other"))}>
            Övriga
          </button>
        </div>
        <input className="music-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sök, t.ex. Östergötland" aria-label="Sök kanal" maxLength={40} enterKeyHint="search" />
      </div>
      {error && <p className="error-text">{error}</p>}
      {!all && !error && <p className="muted">Hämtar kanaler …</p>}
      {all && shown.length === 0 && <p className="muted">Ingen kanal heter så.</p>}
      <div className="station-list" ref={pg.box}>
        {shown.slice(pg.from, pg.to).map((s) => {
          const fav = isFav(s.url);
          return (
            <div key={s.id} className="station-row">
              <StationButton name={s.name} logo={s.logo} on={sp.playing && sameStream(sp.playingUrl, s.url)} disabled={sp.offline} onPlay={() => void c.playDir(s)} />
              <button className={`btn small ghost star ${fav ? "on" : ""}`} aria-pressed={fav} aria-label={fav ? `Ta bort ${s.name} från startsidan` : `Lägg ${s.name} på startsidan`} onClick={() => void star(s)}>
                {fav ? "★" : "☆"}
              </button>
            </div>
          );
        })}
      </div>
      <Pager pg={pg} hint="☆ lägger kanalen på startsidan." />
    </>
  );
}

// ---------- The library: covers like the car's music player ----------

const SHELF_NAMES: { id: Shelf | "search" | "home"; name: string }[] = [
  { id: "home", name: "Hem" },
  { id: "playlists", name: "Spellistor" },
  { id: "albums", name: "Album" },
  { id: "podcasts", name: "Poddar" },
  { id: "search", name: "Sök" },
];

/** Shelves on the left, covers on the right; a tap plays the cover on the chosen speaker. */
function Library({ sp, connect, actions }: { sp: Speaker; connect: string[]; actions: Actions }) {
  // Where it plays: the chosen speaker (via Music Assistant), or a Spotify Connect device (soundbar, Sonos, TV …).
  const [device, setDevice] = useState<string | null>(null);
  const others = connect.filter((d) => d.toLowerCase() !== sp.name.toLowerCase());
  const target = device && others.includes(device) ? device : null;
  const [shelf, setShelf] = useState<Shelf | "search" | "home">("home");
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const [tiles, setTiles] = useState<Tile[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (shelf === "home" || (shelf === "search" && asked.length < 2)) return setTiles([]);
    let live = true;
    setTiles(null);
    setError("");
    (shelf === "search" ? api.musicSearch(asked) : api.musicLibrary(shelf))
      .then((r) => live && setTiles(r.tiles))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [shelf, asked]);
  // Searching as you type, a moment after the last key.
  useEffect(() => {
    const t = setTimeout(() => setAsked(q.trim()), 450);
    return () => clearTimeout(t);
  }, [q]);
  const list = tiles ?? [];
  const pg = usePages(list.length, `${shelf}|${asked}`);
  const [open, setOpen] = useState<Tile | null>(null);
  // Playlists and albums open like in Spotify; a song, artist or podcast plays at once.
  const pick = (t: Tile) => (t.type === "playlist" || t.type === "album" ? setOpen(t) : play(t));
  const [shuffle, setShuffleState] = useState(() => {
    try {
      return localStorage.getItem(SHUFFLE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const setShuffle = (v: boolean) => {
    setShuffleState(v);
    try {
      localStorage.setItem(SHUFFLE_KEY, v ? "1" : "0");
    } catch {
      /* private window */
    }
  };
  const play = (t: Tile, start?: Track) => {
    keep();
    // Ordning only matters for a playlist or album; a single song just plays.
    const mix = t.type === "playlist" || t.type === "album" ? shuffle : undefined;
    if (target)
      return actions.run(start?.title ?? t.title, () => api.playConnect(start ? { ...t, uri: start.uri, type: "track", title: start.title } : t, target, start ? undefined : mix), {
        done: `${t.title} spelar i ${target}`,
        check: (d) => Boolean(d.music?.spotify?.playing && d.music.spotify.device === target),
        slow: `${t.title} är skickad till ${target} – det kan ta en stund att starta.`,
      });
    return actions.run(start?.title ?? t.title, () => api.playMedia(t, sp.entityId, start?.uri, mix), {
      done: `${start?.title ?? t.title} spelar i ${sp.name}`,
      check: (d) => Boolean(d.music?.speakers.find((s) => s.entityId === sp.entityId)?.playing),
      slow: `${t.title} är skickad till ${sp.name} – det kan ta en stund att starta.`,
    });
  };
  const empty = shelf === "search" ? (asked.length < 2 ? "Skriv vad du vill lyssna på." : "Inget hittades.") : shelf === "podcasts" ? "Inga poddar i biblioteket än." : "Inget här än – lägg till musiktjänsten i Music Assistant.";
  return (
    <div className="lib">
      {others.length > 0 && (
        <div className="seg small lib-targets" role="radiogroup" aria-label="Spela i">
          <button className={`seg-btn ${!target ? "on" : ""}`} role="radio" aria-checked={!target} onClick={() => setDevice(null)}>
            <Icon name="speaker" size={16} /> {sp.name}
          </button>
          {others.map((d) => (
            <button key={d} className={`seg-btn ${target === d ? "on" : ""}`} role="radio" aria-checked={target === d} onClick={() => setDevice(d)}>
              <Icon name="speaker" size={16} /> {d}
            </button>
          ))}
        </div>
      )}
      <nav className="seg lib-shelves" role="tablist" aria-label="Hyllor">
        {SHELF_NAMES.map((x) => (
          <button key={x.id} className={`seg-btn ${shelf === x.id ? "on" : ""}`} role="tab" aria-selected={shelf === x.id} onClick={() => (setShelf(x.id), setOpen(null))}>
            {x.name}
          </button>
        ))}
      </nav>
      {open ? (
        <TrackList t={open} sp={sp} where={target ?? sp.name} play={play} back={() => setOpen(null)} shuffle={shuffle} setShuffle={setShuffle} />
      ) : shelf === "home" ? (
        <LibraryHome sp={sp} play={pick} />
      ) : (
      <div className="lib-main">
        {shelf === "search" && (
          <input className="music-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Artist, låt, spellista eller podd" aria-label="Sök musik" maxLength={60} enterKeyHint="search" autoFocus />
        )}
        {error && <p className="error-text">{error}</p>}
        {!tiles && !error && <p className="muted">Hämtar …</p>}
        {tiles && list.length === 0 && !error && <p className="muted">{empty}</p>}
        <div className="cover-grid" ref={pg.box}>
          {list.slice(pg.from, pg.to).map((t) => (
            <Cover key={t.uri} t={t} sp={sp} play={pick} />
          ))}
        </div>
        <Pager pg={pg} hint={`Spelar i ${target ?? sp.name}`} />
      </div>
      )}
    </div>
  );
}

/** A playlist or album opened like in Spotify: cover, Spela and every track – a tap starts from that song. */
const SHUFFLE_KEY = "familjetavla.blanda";

function TrackList({ t, sp, where, play, back, shuffle, setShuffle }: { t: Tile; sp: Speaker; where: string; play: (t: Tile, start?: Track) => unknown; back: () => void; shuffle: boolean; setShuffle: (v: boolean) => void }) {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api.musicItems(t.uri).then(
      (r) => live && setTracks(r.tracks),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [t.uri]);
  const list = tracks ?? [];
  const pg = usePages(list.length, t.uri);
  return (
    <div className="lib-main track-view">
      <div className="track-head">
        <button className="btn small" onClick={back} aria-label="Tillbaka till biblioteket">
          ‹
        </button>
        <span className="cover-img track-cover">{t.image ? <img src={t.image} alt="" /> : <Icon name="music" size={28} />}</span>
        <span className="track-meta">
          <b>{t.title}</b>
          <small className="muted">{[t.subtitle, tracks ? `${tracks.length} låtar` : ""].filter(Boolean).join(" · ")}</small>
        </span>
        <button className="btn primary play-all" disabled={sp.offline} onClick={() => void play(t)} aria-label={`Spela ${t.title} i ${where}${shuffle ? ", blandat" : ""}`}>
          <Icon name="play" size={20} /> Spela
        </button>
      </div>
      <div className="seg small track-order" role="radiogroup" aria-label="Ordning">
        <button className={`seg-btn ${!shuffle ? "on" : ""}`} role="radio" aria-checked={!shuffle} onClick={() => setShuffle(false)}>
          I ordning
        </button>
        <button className={`seg-btn ${shuffle ? "on" : ""}`} role="radio" aria-checked={shuffle} onClick={() => setShuffle(true)}>
          Blandat
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {!tracks && !error && <p className="muted">Hämtar låtarna …</p>}
      <div className="track-list" ref={pg.box}>
        {list.slice(pg.from, pg.to).map((x, i) => (
          <button key={`${x.uri}${i}`} className="track-row" disabled={sp.offline} onClick={() => void play(t, x)} aria-label={`Spela ${x.title}${x.artist ? ` med ${x.artist}` : ""} i ${where}`}>
            <span className="track-thumb">{x.image ? <img src={x.image} alt="" loading="lazy" /> : <span className="muted">{pg.from + i + 1}</span>}</span>
            <span className="track-text">
              <span className="cover-title">{x.title}</span>
              {x.artist && <span className="cover-sub">{x.artist}</span>}
            </span>
          </button>
        ))}
      </div>
      <Pager pg={pg} hint={`Spelar i ${where}`} />
    </div>
  );
}

function Cover({ t, sp, play }: { t: Tile; sp: Speaker; play: (t: Tile) => unknown }) {
  return (
    <button className="cover" disabled={sp.offline} onClick={() => void play(t)} aria-label={`${t.type === "playlist" || t.type === "album" ? "Öppna" : "Spela"} ${t.title}${t.subtitle ? ` – ${t.subtitle}` : ""}`}>
      <span className="cover-img">
        {t.image ? <img src={t.image} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} /> : null}
        <Icon name={t.type === "podcast" ? "speaker" : "music"} size={28} />
      </span>
      <span className="cover-title">{t.title}</span>
      {t.subtitle && <span className="cover-sub">{t.subtitle}</span>}
    </button>
  );
}

/** A row that shows as many covers as fit across, with ‹ › instead of scrolling sideways. */
function useRow(count: number) {
  const box = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(0);
  const [page, setPage] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setCols(Math.max(1, getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count]);
  const per = cols || count;
  const pages = Math.max(1, Math.ceil(count / per));
  const at = Math.min(page, pages - 1);
  return { box, from: at * per, to: (at + 1) * per, at, pages, setPage };
}

/** Hem, like the car: what you played last as small rows on top, then your playlists as covers. */
function LibraryHome({ sp, play }: { sp: Speaker; play: (t: Tile) => unknown }) {
  const [recent, setRecent] = useState<Tile[] | null>(null);
  const [lists, setLists] = useState<Tile[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.musicLibrary("recent").then((r) => setRecent(r.tiles), (e: Error) => setError(e.message));
    api.musicLibrary("playlists").then((r) => setLists(r.tiles), (e: Error) => setError(e.message));
  }, []);
  const row = useRow(lists?.length ?? 0);
  if (error) return <p className="error-text">{error}</p>;
  if (!recent || !lists) return <p className="muted">Hämtar …</p>;
  if (!recent.length && !lists.length) return <p className="muted">Biblioteket är tomt – lägg till Spotify under Musikleverantörer i Music Assistant.</p>;
  return (
    <div className="lib-home">
      {recent.length > 0 && (
        <>
          <h3 className="lib-h">Senast spelat</h3>
          <div className="chip-grid">
            {recent.slice(0, 6).map((t) => (
              <button key={t.uri} className="cover-chip" disabled={sp.offline} onClick={() => void play(t)} aria-label={`${t.type === "playlist" || t.type === "album" ? "Öppna" : "Spela"} ${t.title}`}>
                <span className="cover-img">
                  {t.image ? <img src={t.image} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} /> : null}
                  <Icon name="music" size={20} />
                </span>
                <span className="cover-title">{t.title}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {lists.length > 0 && (
        <>
          <div className="lib-row-head">
            <h3 className="lib-h">Dina spellistor</h3>
            {row.pages > 1 && (
              <span className="row gap" style={{ alignItems: "center" }}>
                <button className="btn small" aria-label="Föregående spellistor" disabled={row.at === 0} onClick={() => row.setPage(row.at - 1)}>
                  ‹
                </button>
                <button className="btn small" aria-label="Fler spellistor" disabled={row.at >= row.pages - 1} onClick={() => row.setPage(row.at + 1)}>
                  ›
                </button>
              </span>
            )}
          </div>
          <div className="cover-row" ref={row.box}>
            {lists.slice(row.from, row.to).map((t) => (
              <Cover key={t.uri} t={t} sp={sp} play={play} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const MA_APP = "d5369777_music_assistant";
const MA_REPO = "https://github.com/music-assistant/home-assistant-addon";

const MA_COMPOSE = `services:
  music-assistant:
    image: ghcr.io/music-assistant/server:latest
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./music-assistant:/data`;

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn small"
      style={{ marginTop: 6 }}
      onClick={() =>
        navigator.clipboard?.writeText(text).then(
          () => setDone(true),
          () => setDone(false),
        )
      }
    >
      {done ? "Kopierat ✓" : "Kopiera texten"}
    </button>
  );
}

/**
 * Without Music Assistant: what it gives and how to get it. Home Assistant OS/Supervised gets a
 * button to the app store; Home Assistant in Docker (no app store) gets the container to add.
 */
function AssistantSetup() {
  const [store, setStore] = useState<boolean | null>(null);
  useEffect(() => {
    api.authStatus().then(
      (r) => setStore(r.supervisor),
      () => setStore(false),
    );
  }, []);
  return (
    <div className="lib-setup">
      <p style={{ margin: "0 0 10px" }}>
        För att välja <b>spellistor, album och poddar</b> på tavlan – och spela dem i vilken högtalare som helst – behövs <b>Music Assistant</b> (gratis). Det fungerar med Spotify, YouTube Music, Tidal med flera och med Google/Nest, Sonos, AirPlay och Echo.
      </p>
      {store === null ? null : store ? (
        <>
          <div className="row gap" style={{ flexWrap: "wrap" }}>
            <a className="btn primary" href={haMy("supervisor_addon", { addon: MA_APP, repository_url: MA_REPO })} target="_top" rel="noopener">
              <Icon name="plus" size={18} /> Installera Music Assistant
            </a>
            <a className="btn" href={haAddIntegration("music_assistant")} target="_top" rel="noopener">
              Koppla till Home Assistant
            </a>
          </div>
          <ol className="muted" style={{ margin: "10px 0 0", paddingLeft: 20 }}>
            <li>Installera och starta tillägget.</li>
            <li>Öppna Music Assistant, lägg till Spotify under Inställningar → Musikleverantörer och logga in.</li>
            <li>Home Assistant hittar Music Assistant själv – tryck Konfigurera, eller Koppla till Home Assistant här.</li>
          </ol>
        </>
      ) : (
        <>
          <p style={{ margin: "0 0 6px" }}>
            Home Assistant i Docker har ingen tilläggsbutik, så Music Assistant startas som en egen container. Det går utan terminal:
          </p>
          <ul className="muted" style={{ margin: "0 0 8px", paddingLeft: 20 }}>
            <li>
              <b>Portainer:</b> Stacks → Add stack → klistra in texten → Deploy.
            </li>
            <li>
              <b>Synology:</b> Container Manager → Projekt → Skapa → klistra in texten.
            </li>
            <li>
              <b>Unraid:</b> Apps → sök Music Assistant → Install.
            </li>
            <li>
              <b>Terminal:</b> lägg texten i docker-compose.yml och kör <code>docker compose up -d</code>.
            </li>
          </ul>
          <pre className="code-box">{MA_COMPOSE}</pre>
          <CopyButton text={MA_COMPOSE} />
          <ol className="muted" style={{ margin: "10px 0", paddingLeft: 20 }}>
            <li>Öppna http://&lt;serverns-adress&gt;:8095 och lägg till Spotify under Inställningar → Musikleverantörer.</li>
            <li>Tryck Koppla till Home Assistant och skriv samma adress, t.ex. http://192.168.1.10:8095.</li>
          </ol>
          <a className="btn primary" href={haAddIntegration("music_assistant")} target="_top" rel="noopener">
            <Icon name="plus" size={18} /> Koppla till Home Assistant
          </a>
        </>
      )}
      <p className="muted" style={{ margin: "10px 0 0" }}>
        Radio fungerar redan utan Music Assistant.
      </p>
    </div>
  );
}

/**
 * Opens "Add integration → <domain>" in Home Assistant. Inside Home Assistant (ingress) that is the
 * same window; elsewhere Home Assistant's own My link asks once which Home Assistant is yours.
 */
export function haAddIntegration(domain: string): string {
  return haMy("config_flow_start", { domain });
}

/** A Home Assistant "My" link: straight into this Home Assistant under ingress, else via my.home-assistant.io. */
export function haMy(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  const inHa = /\/api\/hassio_ingress\//.test(location.pathname);
  return inHa ? `${location.origin}/_my_redirect/${path}?${qs}` : `https://my.home-assistant.io/redirect/${path}/?${qs}`;
}

/** Spotify: controls when Home Assistant has the Spotify integration, otherwise how to add it. */
function SpotifyBox({ sp, actions }: { sp: MusicData["spotify"]; actions: Actions }) {
  if (!sp)
    return (
      <section className="card spotify-box">
        <h2>Spotify</h2>
        <p style={{ margin: "0 0 10px" }}>
          Lägg till integrationen <b>Spotify</b> i Home Assistant, så syns det som spelas här med Spela/Paus och Nästa.
        </p>
        <a className="btn primary" href={haAddIntegration("spotify")} target="_top" rel="noopener">
          <Icon name="plus" size={18} /> Lägg till Spotify i Home Assistant
        </a>
        <p className="muted" style={{ margin: "10px 0 0" }}>
          Home Assistant leder dig genom resten: en nyckel hos Spotify och inloggning med ert konto (Premium behövs).
        </p>
      </section>
    );
  const label = sp.offline ? "Spotify svarar inte" : sp.title ? `${sp.title}${sp.device ? ` · ${sp.device}` : ""}` : "Inget spelas i Spotify";
  return (
    <section className="card spotify-box">
      <div className="music-now" style={{ marginBottom: 0 }}>
        <Icon name="music" size={20} />
        <span className="music-title">
          <b>Spotify</b> · {label}
        </span>
        <span className="music-ctl">
          <button className="btn small" disabled={sp.offline} onClick={() => void actions.run("Spotify", () => api.spotify("playpause"))}>
            <Icon name={sp.playing ? "stop" : "play"} size={16} /> {sp.playing ? "Paus" : "Spela"}
          </button>
          <button className="btn small" disabled={sp.offline || !sp.title} onClick={() => void actions.run("Spotify", () => api.spotify("next"))}>
            Nästa
          </button>
        </span>
      </div>
    </section>
  );
}

const widget: WidgetModule = {
  id: "music",
  label: "Musik",
  size: (data) => (data.music?.speakers.length ? 1 + Math.ceil(Math.max(1, data.music.stations.length) / 2) : 0),
  render: ({ data, actions }) => <Music data={data} actions={actions} />,
  opens: { tab: "music" },
};
export default widget;
