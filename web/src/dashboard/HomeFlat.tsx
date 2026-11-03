import { Fragment } from "react";
import type { Dashboard } from "../../../server/src/types";
import { api } from "../api";
import { Icon, type IconName } from "../Icon";
import { Meals } from "../widgets/meals";
import type { Actions } from "./Dashboard";
import { Avatar, travelText } from "./bits";
import { Week } from "./Home";

const SKY_LABEL: Record<string, string> = { clear: "Klart", partly: "Halvklart", cloudy: "Mulet", rain: "Regn", snow: "Snö", fog: "Dimma" };
const REMINDER_ICON: Record<string, IconName> = { rain: "umbrella", bag: "bag", gym: "gym", trash: "trash", kids: "kids", info: "info", school: "school", food: "food" };

/** "Smartbox Utetemperatur" → "Ute", "Timmerflott 2 Temperatur" → "Timmerflott 2". */
const shortTemp = (n: string) => n.replace(/^Smartbox\s*/i, "").replace(/\s*temperatur$/i, "").trim() || n;

/** What is next, as at most two plain rows: time, what, where, who. */
function Nu({ data, actions }: { data: Dashboard; actions: Actions }) {
  const rows = data.now.items.slice(0, 2);
  return (
    <section className="card hf-now" aria-label="Nu">
      <div className="hf-label">
        Nu{data.now.headline ? <span> · {data.now.headline}</span> : null}
      </div>
      {rows.length === 0 && <div className="hf-empty">Inget det närmaste.</div>}
      {rows.map((e, i) => (
        <button key={i} className="hf-row" onClick={() => actions.openEvent(e)}>
          <span className="hf-time num">
            {e.time}
            <small>{e.dayLabel === "idag" ? (e.inMinutes > 0 && e.inMinutes < 120 ? `om ${e.inMinutes} min` : "idag") : e.dayLabel}</small>
          </span>
          <span className="hf-what">
            <b>{e.title}</b>
            <span>
              {[e.location, e.travel && (travelText(e.travel) || (e.travel.kind === "care" ? "vem lämnar och hämtar?" : "välj skjuts"))].filter(Boolean).join(" · ")}
            </span>
          </span>
          {e.who && e.initial && <Avatar initial={e.initial} color={e.color} name={e.who} />}
        </button>
      ))}
    </section>
  );
}

/** Weather and the one or two things worth remembering today. */
function Idag({ data, actions }: { data: Dashboard; actions: Actions }) {
  const { header } = data;
  // Care times and the dinner are already in Nu, the week and Maten.
  // The waste has its own line below.
  const tips = data.reminders.filter((r) => r.icon !== "kids" && r.icon !== "trash" && !(r.icon === "food" && r.tone === "neutral")).slice(0, 1);
  return (
    <section className="card hf-idag" aria-label="Idag">
      <div className="hf-weather">
        {header.tempNow !== undefined && (
          <span className="hf-temp num">
            {Math.round(header.tempNow)}°
          </span>
        )}
        {header.sky && <span>{SKY_LABEL[header.sky] ?? ""}</span>}
      </div>
      {data.waste.length > 0 && (
        <div className="hf-tip hf-waste" aria-label="Sophämtning">
          <Icon name="trash" size={16} />
          <span>
            <b>Sopor</b>{" "}
            {data.waste.map((w, i) => (
              <Fragment key={w.type}>
                {i > 0 ? " · " : ""}
                <span className={w.label === "idag" || w.label === "imorgon" ? "soon" : ""}>
                  {w.type} {w.label}
                </span>
              </Fragment>
            ))}
          </span>
        </div>
      )}
      {data.schoolDay && data.schoolDay.length > 0 && (
        <div className="hf-tip" aria-label="När skolan slutar">
          <Icon name="school" size={16} />
          <span>
            <b>Skolan slutar</b>{" "}
            {data.schoolDay.map((r, i) => (
              <Fragment key={r.personId}>
                {i > 0 ? " · " : ""}
                {r.name} <b className="num">{r.end}</b>
                {r.dayLabel !== "idag" ? ` ${r.dayLabel}` : ""}
              </Fragment>
            ))}
          </span>
        </div>
      )}
      {tips.map((r, i) => (
        <button key={i} className="hf-tip" onClick={() => actions.openPage("komihag")}>
          <Icon name={REMINDER_ICON[r.icon] ?? "info"} size={16} />
          <span>{r.sub && !/tryck|bocka|tavlan/i.test(r.sub) ? `${r.title} – ${r.sub.charAt(0).toLowerCase()}${r.sub.slice(1)}` : r.title}</span>
        </button>
      ))}
    </section>
  );
}

/** Temperature, lights and music in one row at the bottom: small buttons that open their own tab. */
function Teknik({ data, actions }: { data: Dashboard; actions: Actions }) {
  const lamps = new Map([...data.lights, ...data.lightGroups.flatMap((g) => g.lamps)].map((l) => [l.entityId, l]));
  const total = [...lamps.values()].filter((l) => !l.offline).length;
  const on = [...lamps.values()].filter((l) => l.on).length;
  const sp = data.music?.speakers.find((s) => s.playing && !s.offline) ?? data.music?.speakers.find((s) => !s.offline);
  const transport = (action: "play_pause" | "next" | "previous", label: string) => sp && actions.run(label, () => api.musicTransport(sp.entityId, action), { done: label, check: () => true });
  if (!data.temps.length && !total && !sp) return null;
  return (
    <div className="hf-tech">
      {data.temps.slice(0, 3).map((t) => (
        <button key={t.name} className="hf-pill" onClick={() => actions.openTab("house")}>
          <Icon name="sun" size={18} />
          <span>{shortTemp(t.name)}</span>
          <b className="num">{t.value}</b>
        </button>
      ))}
      {total > 0 && (
        <button className="hf-pill" onClick={() => actions.openTab("lights")}>
          <Icon name="bulb" size={18} />
          <span>Ljus</span>
          <b className="num">{on}</b>
          <span>av {total} tända</span>
        </button>
      )}
      {sp && (
        <div className="hf-pill hf-music grow">
          <button className="hf-music-text" onClick={() => actions.openTab("music")}>
            <Icon name="music" size={18} />
            <span>
              {sp.playing ? (
                <>
                  <b>{sp.track ?? sp.title ?? "Spelar"}</b>
                  {sp.artist ? ` · ${sp.artist}` : ""}
                </>
              ) : (
                <>{sp.name} · tyst</>
              )}
            </span>
          </button>
          {sp.playing && (
            <span className="hf-ctl">
              {sp.canPrev !== false && (
                <button aria-label="Föregående" onClick={() => transport("previous", "Föregående")}>
                  <Icon name="prev" size={14} />
                </button>
              )}
              <button className="on" aria-label={sp.paused ? "Spela" : "Pausa"} onClick={() => transport("play_pause", sp.paused ? "Spela" : "Pausa")}>
                <Icon name={sp.paused ? "play" : "pause"} size={14} strokeWidth={3} />
              </button>
              {sp.canNext !== false && (
                <button aria-label="Nästa" onClick={() => transport("next", "Nästa")}>
                  <Icon name="next" size={14} />
                </button>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** The new start page: a fixed grid, one line per thing, technology in a row at the bottom. */
export function HomeFlat({ data, actions }: { data: Dashboard; actions: Actions }) {
  return (
    <main className="hf">
      <Nu data={data} actions={actions} />
      <Idag data={data} actions={actions} />
      <Week data={data} actions={actions} />
      <Meals data={data} />
      <Teknik data={data} actions={actions} />
    </main>
  );
}
