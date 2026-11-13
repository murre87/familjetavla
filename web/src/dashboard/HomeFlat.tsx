import { Fragment, useState, type CSSProperties } from "react";
import { Fit } from "./Fit";
import type { Dashboard } from "../../../server/src/types";
import { api } from "../api";
import { Icon, type IconName } from "../Icon";
import { Meals } from "../widgets/meals";
import { Todo } from "../widgets/todo";
import type { Actions } from "./Dashboard";
import { Avatar, travelText } from "./bits";
import { insideGroups, setGroups } from "./lightGroups";
import { Week, weekColumns } from "./Home";
import { BOX_TITLE, BoxGear, BoxSheet } from "./BoxSheet";
import { boxClass, useBoxPrefs, type BoxProps } from "../boxprefs";
import { useLongPress } from "../longpress";
import type { BoxId } from "../../../server/src/boxprefs";
import { gridOf, rowTemplate, LAYOUT_BOXES, type LayoutBox } from "../../../server/src/layout";
import { useLayout } from "../layout";
import { useArrange } from "./Arrange";

/** The boxes at the top never shrink their text below 85 %: below that it was 11 px, unreadable across a room. They scroll instead. */
const TOP_FLOOR = 0.85;

const SKY_LABEL: Record<string, string> = { clear: "Klart", partly: "Halvklart", cloudy: "Mulet", rain: "Regn", snow: "Snö", fog: "Dimma" };
const REMINDER_ICON: Record<string, IconName> = { rain: "umbrella", bag: "bag", gym: "gym", trash: "trash", kids: "kids", info: "info", school: "school", food: "food" };

/** "Smartbox Utetemperatur" → "Ute", "Timmerflott 2 Temperatur" → "Timmerflott 2". */
const shortTemp = (n: string) => n.replace(/^Smartbox\s*/i, "").replace(/\s*temperatur$/i, "").trim() || n;

/** What is next, as at most two plain rows: time, what, where, who. */
function Nu({ data, actions, box }: { data: Dashboard; actions: Actions; box: BoxProps }) {
  const rows = data.now.items.slice(0, 2);
  return (
    <section className={`card hf-now ${box.className}`} style={box.style} aria-label="Nu" {...box.handlers}>
      {box.gear}
      <div className="hf-label">
        Nu{data.now.headline ? <span> · {data.now.headline}</span> : null}
      </div>
      <Fit className="hf-fit" deps={[data]} base={box.base} floor={TOP_FLOOR}>
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
      </Fit>
    </section>
  );
}

/** Weather and the one or two things worth remembering today. */
function Idag({ data, actions, box }: { data: Dashboard; actions: Actions; box: BoxProps }) {
  const { header } = data;
  // Care times and the dinner are already in Nu, the week and Maten.
  // The waste has its own line below.
  const tips = data.reminders.filter((r) => r.icon !== "kids" && r.icon !== "trash" && !(r.icon === "food" && r.tone === "neutral")).slice(0, 1);
  return (
    <section className={`card hf-idag ${box.className}`} style={box.style} aria-label="Idag" {...box.handlers}>
      {box.gear}
      <Fit className="hf-fit" deps={[data]} base={box.base} floor={TOP_FLOOR}>
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
      </Fit>
    </section>
  );
}

/** Temperature, lights and music in one row at the bottom: small buttons that open their own tab. */
function Teknik({ data, actions, box }: { data: Dashboard; actions: Actions; box: BoxProps }) {
  const lamps = new Map([...data.lights, ...data.lightGroups.flatMap((g) => g.lamps)].map((l) => [l.entityId, l]));
  const total = [...lamps.values()].filter((l) => !l.offline).length;
  const on = [...lamps.values()].filter((l) => l.on).length;
  const sp = data.music?.speakers.find((s) => s.playing && !s.offline) ?? data.music?.speakers.find((s) => !s.offline);
  const transport = (action: "play_pause" | "next" | "previous", label: string) => sp && actions.run(label, () => api.musicTransport(sp.entityId, action), { done: label, check: () => true });
  if (!data.temps.length && !total && !sp) return null;
  return (
    <div className={`hf-tech-wrap ${box.className}`} style={box.style} {...box.handlers}>
    {box.gear}
    <Fit className="hf-fit hf-tech-fit" deps={[data]} base={box.base}>
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
      {insideGroups(data).length > 0 && (
        <>
          <button className="hf-pill hf-act" onClick={() => setGroups(actions, insideGroups(data), true, "Tänd inne")}>
            Tänd inne
          </button>
          <button className="hf-pill hf-act" onClick={() => setGroups(actions, insideGroups(data), false, "Släck allt inne")}>
            Släck inne
          </button>
        </>
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
    </Fit>
    </div>
  );
}

/** The new start page: a fixed grid, one line per thing, technology in a row at the bottom. */
export function HomeFlat({ data, actions }: { data: Dashboard; actions: Actions }) {
  const { prefs } = useBoxPrefs();
  const [sheet, setSheet] = useState<BoxId | null>(null);
  // One hold-to-open handler set per box (hooks cannot be made in a loop, so they are listed).
  const hold: Record<BoxId, ReturnType<typeof useLongPress>> = {
    nu: useLongPress(() => setSheet("nu")),
    idag: useLongPress(() => setSheet("idag")),
    mat: useLongPress(() => setSheet("mat")),
    vecka: useLongPress(() => setSheet("vecka")),
    teknik: useLongPress(() => setSheet("teknik")),
    person: useLongPress(() => setSheet("person")),
    todo: useLongPress(() => setSheet("todo")),
  };
  // The page is a puzzle (Ordna startsidan): rows of boxes with widths out of 12. The week can never be hidden.
  // "Att göra" only when a todo list is chosen in the settings.
  const hidden = LAYOUT_BOXES.filter((id) => id !== "vecka" && (prefs[id]?.hidden || (id === "todo" && !data.todo)));
  const saved = useLayout();
  const arrange = useArrange(saved, hidden);
  const places = gridOf(arrange.layout, hidden);
  const box = (id: LayoutBox): BoxProps => {
    const p = places.find((x) => x.id === id);
    return {
      className: `${boxClass(prefs[id])} ${arrange.arranging ? "arranging" : ""}`,
      // Variables, not grid-row/grid-column themselves: inline placement would beat the phone layout (one box per row).
      style: p ? ({ "--row": p.row, "--col": p.col, "--span": p.span, "--order": p.order } as CSSProperties) : undefined,
      handlers: { ...(arrange.arranging ? {} : hold[id]), "data-box": id } as unknown as Record<string, unknown>,
      base: prefs[id]?.size,
      // While arranging, the box's own controls give way to the puzzle's. The row at the bottom has no free corner
      // for a cog: its settings are held or under Aa → Rutor.
      gear: arrange.arranging ? arrange.coverFor(id) : id === "teknik" ? undefined : <BoxGear title={BOX_TITLE[id]} onOpen={() => setSheet(id)} />,
    };
  };
  const all = data.people.map((p) => p.name);
  const names = weekColumns(data).filter((c) => !c.family).map((c) => c.name);
  return (
    <main className={`hf ${arrange.arranging ? "hf-arranging" : ""}`} style={{ ["--hf-rows" as string]: rowTemplate(arrange.layout, hidden) } as CSSProperties}>
      {!prefs.nu?.hidden && <Nu data={data} actions={actions} box={box("nu")} />}
      {!prefs.idag?.hidden && <Idag data={data} actions={actions} box={box("idag")} />}
      <Week data={data} actions={actions} box={box("vecka")} pref={prefs.vecka} />
      {!prefs.mat?.hidden && <Meals data={data} fit box={box("mat")} />}
      {!prefs.teknik?.hidden && <Teknik data={data} actions={actions} box={box("teknik")} />}
      {!prefs.todo?.hidden && data.todo && <Todo data={data} actions={actions} box={box("todo")} fit />}
      {sheet && <BoxSheet id={sheet} names={names} all={all} onClose={() => setSheet(null)} arrange />}
      {arrange.bar}
    </main>
  );
}
