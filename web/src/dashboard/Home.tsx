import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { WIDGET_LABELS } from "../widgets";
import type { Dashboard } from "../../../server/src/types";
import { Fit } from "./Fit";
import { Icon, type IconName } from "../Icon";
import { AnimatedNumber, Avatar, EventIcon, eventLabel, TravelBadge, travelText } from "./bits";
import type { Actions } from "./Dashboard";
import { widget } from "../widgets";

const SKY_LABEL: Record<string, string> = { clear: "Klart", partly: "Halvklart", cloudy: "Mulet", rain: "Regn", snow: "Snö", fog: "Dimma" };
const SKY_ICON: Record<string, IconName> = { clear: "sun", partly: "partly", cloudy: "cloud", rain: "rain", snow: "snow", fog: "cloud" };

/** One home card. `full` (on the "Alla kort" page) shows lists in full instead of the home-screen summary. */
export function renderWidget(id: Dashboard["home"][number]["id"], data: Dashboard, actions: Actions, full = false): React.ReactNode {
  const w = widget(id);
  return w ? <Fragment key={id}>{w.render({ data, actions, full })}</Fragment> : null;
}

/** The big "Nu" zone: what happens in the next few hours, readable from across the room. */
function NowZone({ data, actions, edit }: { data: Dashboard; actions: Actions; edit?: EditProps }) {
  const { now, header } = data;
  return (
    <section className={`card strong now area-now ${edit?.className ?? ""}`} aria-label="Nu" {...edit?.handlers}>
      {edit?.bar}
      <div style={{ minWidth: 0 }}>
        <span className="eyebrow">Nu</span>
        <div className="now-headline">{now.headline}</div>
        {now.items.length > 0 && (
          <div className="now-list">
            {now.items.map((e, i) => (
              <button key={i} className={`now-item ${i === 0 ? "first" : ""}`} onClick={() => actions.openEvent(e)}>
                <EventIcon icon={e.icon} color={e.color} size={24} />
                <span className="time">{e.time}</span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="what" style={{ display: "block" }}>
                    {e.title}
                  </span>
                  <span className="when">
                    {e.dayLabel === "idag" ? (e.inMinutes > 0 && e.inMinutes < 120 ? `om ${e.inMinutes} min` : "idag") : e.dayLabel}
                    {e.location ? ` · ${e.location}` : ""}
                    {e.travel && ` · ${travelText(e.travel) || (e.travel.kind === "care" ? "vem lämnar och hämtar?" : "välj skjuts")}`}
                  </span>
                </span>
                {e.who && e.initial && <Avatar initial={e.initial} color={e.color} name={e.who} size="lg" />}
              </button>
            ))}
          </div>
        )}
      </div>
      {(header.tempNow !== undefined || header.sky) && (
        <div className="weather-now">
          {header.sky && (
            <span className="sky-ico">
              <Icon name={SKY_ICON[header.sky] ?? "partly"} size={44} strokeWidth={1.6} />
            </span>
          )}
          {header.tempNow !== undefined && (
            <span className="temp">
              <AnimatedNumber value={header.tempNow} />°
            </span>
          )}
          {header.sky && <span className="muted">{SKY_LABEL[header.sky]}</span>}
          {header.sun && <SunArc sun={header.sun} />}
        </div>
      )}
    </section>
  );
}

/** Today's sun as a bow from sunrise to sunset, with the sun where it is now. */
function SunArc({ sun }: { sun: NonNullable<Dashboard["header"]["sun"]> }) {
  const p = sun.pos;
  const x = p === undefined ? 0 : 60 - 50 * Math.cos(p * Math.PI);
  const y = p === undefined ? 0 : 48 - 38 * Math.sin(p * Math.PI);
  const arc = "M10 48 A50 38 0 0 1 110 48";
  return (
    <div className={`sun-arc ${p === undefined ? "night" : ""}`} aria-label={`Solen går upp ${sun.rise} och ner ${sun.set}`}>
      <svg viewBox="0 0 120 54" aria-hidden="true">
        <line x1="4" y1="48" x2="116" y2="48" className="sa-horizon" />
        <path d={arc} className="sa-track" />
        {p !== undefined && <path d={arc} className="sa-done" pathLength={1} strokeDasharray={`${p} 1`} />}
        {p !== undefined && <circle cx={x} cy={y} r="6" className="sa-sun" />}
      </svg>
      <span className="sa-times">
        <span>↑ {sun.rise}</span>
        <span>↓ {sun.set}</span>
      </span>
    </div>
  );
}

function MoreButton({ n, what, label, onClick }: { n: number; what: string; label?: string; onClick: () => void }) {
  return (
    <button className="btn small more-btn" onClick={onClick}>
      +{n} {what} {label ? `– ${label}` : "till"} <Icon name="chevronRight" size={16} />
    </button>
  );
}

type WeekEvent = Dashboard["days"][number]["events"][number];
interface WeekCol {
  key: string;
  name: string;
  initial: string;
  color: string;
  family?: boolean;
}

/** Whom an event is about: the people it names, none = the whole family. */
const eventPeople = (e: WeekEvent, known: Set<string>) => (e.whoAll?.length ? e.whoAll : e.who ? [e.who] : []).filter((n) => known.has(n));

/** One column per person who has something this week (or a school day), and "Familjen" first for what is for everyone. */
export function weekColumns(data: Dashboard): WeekCol[] {
  const known = new Set(data.people.map((p) => p.name));
  const used = new Set<string>();
  let family = false;
  for (const d of data.days)
    for (const e of d.events) {
      const who = eventPeople(e, known);
      if (who.length === 1) used.add(who[0]!);
      else family = true; // nobody named, or several: one shared entry instead of the same thing under each person
    }
  for (const k of data.school ?? []) if (k.days.some((d) => d.lessons.length)) used.add(k.name);
  const people = data.people.filter((p) => used.has(p.name)).map((p) => ({ key: p.id, name: p.name, initial: p.initial, color: p.color }));
  return [...(family ? [{ key: "family", name: "Gemensamt", initial: "G", color: "var(--accent)", family: true }] : []), ...people];
}

/** When the child's school day ends (and whether there is gym), for the week's columns. */
function schoolEnd(data: Dashboard, name: string, dayKey: string): { end: string; gym: boolean } | undefined {
  const lessons = data.school?.find((k) => k.name === name)?.days.find((d) => d.dayKey === dayKey)?.lessons;
  if (!lessons?.length) return undefined;
  return { end: lessons[lessons.length - 1]!.end, gym: lessons.some((l) => l.gym) };
}

export function Week({ data, actions, full = false, edit }: { data: Dashboard; actions: Actions; full?: boolean; edit?: EditProps }) {
  const cols = weekColumns(data);
  const known = new Set(data.people.map((p) => p.name));
  return (
    <section className={`card area-week week-swipe ${edit?.className ?? ""}`} {...edit?.handlers}>
      {edit?.bar}
      <div className="card-head" style={{ flexWrap: "wrap" }}>
        {/* On its own page the page title already says it – the room goes to the days. */}
        {full ? <h2 className="sr-only">Kommande 7 dagar</h2> : <h2>Kommande 7 dagar</h2>}
        {full && <span className="grow" />}
        {/* Always there: it is also where the week's dinners are planned, even with nothing to drive to. */}
        <button
          className={`btn small plan-btn ${data.plan.missing ? "warn" : ""}`}
          aria-label={data.plan.missing ? `Planera veckan, ${data.plan.missing} att lösa` : "Planera veckan"}
          onClick={() => actions.openPlan()}
        >
          <Icon name="kids" size={18} />
          <span className="plan-long">
            {data.plan.missing ? `Planera veckan · ${data.plan.missing} att lösa` : data.plan.items.length ? "Planera veckan" : "Planera veckans mat"}
          </span>
          <span className="plan-short">
            <span className="plan-word">Planera</span>
            {data.plan.missing ? <span className="plan-count">{data.plan.missing}</span> : null}
          </span>
        </button>
        <div className="legend">
          {data.legend
            .filter((l) => !data.people.some((p) => p.name === l.name))
            .map((l) => (
              <span key={l.name}>
                <span className="dot" style={{ background: l.color }} />
                {l.name}
              </span>
            ))}
        </div>
      </div>
      {cols.length > 1 && (
        <div className={`wk-head ${full ? "" : "compact"}`} aria-hidden="true" style={{ ["--cols" as string]: cols.length }}>
          {cols.map((c) => (
            <span className="wk-who" key={c.key} title={c.name}>
              <i className="wk-dot" style={{ background: c.color }} />
              <b>{c.name}</b>
            </span>
          ))}
        </div>
      )}
      <Fit className={`${full ? "week-full" : "week-body"} ${cols.length > 1 ? "wk-matrix" : ""}`} deps={[data]} min={0.8} more={full ? undefined : (n) => <MoreButton n={n} what={n === 1 ? "dag" : "dagar"} label="visa hela veckan" onClick={() => actions.openPage("veckan")} />}>
        {cols.length > 1
          ? data.days.map((d, di) => (
              <div key={d.key} className={`day wk-row ${d.isToday ? "today" : ""} ${di < 2 ? "big" : ""}`}>
                <div className="day-name">
                  <b>{d.name}</b>
                  <small>{d.date}</small>
                </div>
                <div className="wk-cells" style={{ ["--cols" as string]: cols.length }}>
                  {cols.map((c) => {
                    const evs = d.events.filter((e) => {
                      const who = eventPeople(e, known);
                      return c.family ? who.length !== 1 : who[0] === c.name;
                    });
                    const sch = c.family ? undefined : schoolEnd(data, c.name, d.key);
                    const shown = full ? evs : evs.slice(0, 2);
                    return (
                      <div className="wk-cell" key={c.key} data-who={c.name}>
                        {sch && (
                          <span className="wk-school" title="När skoldagen slutar">
                            <Icon name="school" size={14} /> slutar {sch.end}
                            {sch.gym ? " · idrott" : ""}
                          </span>
                        )}
                        {shown.map((e, i) => (
                          <button className="wk-evt" key={i} style={{ borderLeftColor: e.color }} onClick={() => actions.openEvent({ ...e, dayLabel: d.name.toLowerCase() })} aria-label={eventLabel(e)}>
                            {e.time && <span className="t">{e.time}</span>}
                            <span className="ti">{e.title}</span>
                            {c.family && eventPeople(e, known).length > 1 && (
                              <span className="wk-with" aria-label={eventPeople(e, known).join(", ")}>
                                {eventPeople(e, known).map((n) => (
                                  <i key={n} style={{ background: data.people.find((p) => p.name === n)?.color }} title={n} />
                                ))}
                              </span>
                            )}
                          </button>
                        ))}
                        {!full && evs.length > shown.length && (
                          <button className="more-chip" aria-label={`${evs.length - shown.length} till – visa hela veckan`} onClick={() => actions.openPage("veckan")}>
                            +{evs.length - shown.length}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          : data.days.map((d, di) => (
          <div key={d.key} className={`day ${d.isToday ? "today" : ""} ${di < 2 ? "big" : ""}`}>
            <div className="day-name">
              <b>{d.name}</b>
              <small>{d.date}</small>
            </div>
            <div className="events">
              {d.events.length === 0 && <span className="empty-day">Inget inplanerat</span>}
              {d.events.slice(0, full ? undefined : 3).map((e, i) => (
                <button className="event" key={i} onClick={() => actions.openEvent({ ...e, dayLabel: d.name.toLowerCase() })} aria-label={eventLabel(e)}>
                  <EventIcon icon={e.icon} color={e.color} size={di < 2 ? 17 : 15} />
                  {e.time && <span className="t">{e.time}</span>}
                  <span className="title">{e.title}</span>
                  <TravelBadge t={e.travel} />
                  {e.who && e.initial && <Avatar initial={e.initial} color={e.color} name={e.who} />}
                </button>
              ))}
              {!full && d.events.length > 3 && (
                <button className="more-chip" aria-label={`${d.events.length - 3} till – visa hela veckan`} onClick={() => actions.openPage("veckan")}>
                  +{d.events.length - 3}
                </button>
              )}
            </div>
          </div>
        ))}
      </Fit>
    </section>
  );
}

type HomeId = Dashboard["home"][number]["id"];

/** While arranging, every card is a calm box with its name – everything fits and is easy to move. */
function ArrangeBox({ title, className = "", edit }: { title: string; className?: string; edit?: EditProps }) {
  return (
    <section className={`card arrange-box ${className} ${edit?.className ?? ""}`} {...edit?.handlers}>
      {edit?.bar}
      <h2>{title}</h2>
    </section>
  );
}
interface EditProps {
  className: string;
  handlers: React.HTMLAttributes<HTMLElement>;
  bar: React.ReactNode;
}

const HOLD_MS = 550;

/**
 * Hold a card (about half a second) to arrange the home screen: drag it by its handle or move it
 * with the arrows, or hide it. A normal tap still opens the card. "Klar" saves, "Ångra" goes back.
 */
function useArrange(data: Dashboard, actions: Actions) {
  const [order, setOrder] = useState<{ id: HomeId; on: boolean }[] | null>(null);
  const [asking, setAsking] = useState<HomeId | null>(null);
  const [drag, setDrag] = useState<{ id: HomeId; over?: HomeId } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swallow = useRef(false);
  const editing = order !== null;
  useEffect(() => {
    if (!editing) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOrder(null);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [editing]);

  const begin = () => {
    swallow.current = true;
    navigator.vibrate?.(15);
    setOrder(data.home.map((w) => ({ id: w.id, on: w.on })));
  };
  const cancelHold = () => {
    clearTimeout(timer.current);
    start.current = null;
  };
  const holdHandlers: React.HTMLAttributes<HTMLElement> = {
    onPointerDown: (e) => {
      if (editing || e.button > 0 || (e.target as HTMLElement).closest("input, select, textarea")) return;
      start.current = { x: e.clientX, y: e.clientY };
      clearTimeout(timer.current);
      timer.current = setTimeout(begin, HOLD_MS);
    },
    onPointerMove: (e) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancelHold();
    },
    onPointerUp: cancelHold,
    onPointerCancel: cancelHold,
    onPointerLeave: cancelHold,
    // The finger lifts after the long press: that is not a tap on the card or its buttons.
    onClickCapture: (e) => {
      if (swallow.current || editing) {
        swallow.current = false;
        if (!(e.target as HTMLElement).closest(".edit-bar")) {
          e.stopPropagation();
          e.preventDefault();
        }
      }
    },
    onContextMenu: (e) => e.preventDefault(),
  };

  const move = (id: HomeId, to: number) =>
    setOrder((o) => {
      if (!o) return o;
      const from = o.findIndex((w) => w.id === id);
      if (from < 0 || to < 0 || to >= o.length) return o;
      const next = [...o];
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x!);
      return next;
    });
  /** Up/down among the cards that are shown, skipping hidden ones. */
  const step = (id: HomeId, dir: -1 | 1) => {
    if (!order) return;
    const visible = order.filter((w) => w.on && w.id !== "now" && w.id !== "week");
    const i = visible.findIndex((w) => w.id === id);
    const other = visible[i + dir];
    if (other) move(id, order.findIndex((w) => w.id === other.id));
  };
  const hide = (id: HomeId) => setOrder((o) => o && o.map((w) => (w.id === id ? { ...w, on: false } : w)));
  const show = (id: HomeId) => setOrder((o) => o && o.map((w) => (w.id === id ? { ...w, on: true } : w)));
  const save = () => {
    const next = order;
    setOrder(null);
    if (next) void actions.run("Startsidan", () => api.saveHomeLayout(next));
  };

  const handle = (id: HomeId): React.HTMLAttributes<HTMLElement> => ({
    onPointerDown: (e) => {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDrag({ id });
    },
    onPointerMove: (e) => {
      if (!drag) return;
      const over = (document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-wid]") as HTMLElement | null)?.dataset.wid as HomeId | undefined;
      if (over !== drag.over) setDrag({ id: drag.id, over: over && over !== drag.id ? over : undefined });
    },
    onPointerUp: () => {
      if (drag?.over && order) move(drag.id, order.findIndex((w) => w.id === drag.over));
      setDrag(null);
    },
    onPointerCancel: () => setDrag(null),
  });

  const label = (id: HomeId) => (WIDGET_LABELS[id] ?? id).split(" – ")[0]!;
  const edit = (id: HomeId, movable: boolean): EditProps => ({
    className: [editing ? "arranging" : "", drag?.id === id ? "dragging" : "", drag?.over === id ? "drop-here" : ""].join(" "),
    handlers: holdHandlers,
    bar: editing ? (
      <div className="edit-bar no-open" role="toolbar" aria-label={`Ordna ${label(id)}`}>
        {movable && (
          <>
            <button className="btn small drag-handle" aria-label={`Dra ${label(id)}`} {...handle(id)}>
              ⠿
            </button>
            <button className="btn small" aria-label={`Flytta upp ${label(id)}`} onClick={() => step(id, -1)}>
              ↑
            </button>
            <button className="btn small" aria-label={`Flytta ner ${label(id)}`} onClick={() => step(id, 1)}>
              ↓
            </button>
          </>
        )}
        <button className="btn small remove" aria-label={`Ta bort ${label(id)} från startsidan`} onClick={() => setAsking(id)}>
          Ta bort
        </button>
      </div>
    ) : null,
  });

  const bottom = editing ? (
    <div className="arrange-bar" role="region" aria-label="Ordna startsidan">
      <span className="grow">
        <b>Ordna startsidan</b>
        <small className="muted"> · dra i ⠿ eller använd pilarna</small>
      </span>
      {order!
        .filter((w) => !w.on)
        .map((w) => (
          <button key={w.id} className="btn small ghost" onClick={() => show(w.id)} aria-label={`Visa ${label(w.id)} igen`}>
            + {label(w.id)}
          </button>
        ))}
      <button className="btn small" onClick={() => setOrder(null)}>
        Ångra
      </button>
      <button className="btn small primary" onClick={save}>
        Klar
      </button>
    </div>
  ) : null;

  // On top of everything (the tab bar too), like the board's other questions.
  const question = asking ? createPortal(
    <div className="overlay" onClick={() => setAsking(null)}>
      <div className="sheet" role="alertdialog" aria-modal="true" aria-label={`Ta bort ${label(asking)}?`} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h2 style={{ fontSize: 22 }}>Ta bort {label(asking)} från startsidan?</h2>
        <p className="muted">Inget raderas. Du kan lägga tillbaka den här (+ {label(asking)}) eller under Inställningar → Startskärm.</p>
        <div className="row gap" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => setAsking(null)}>
            Avbryt
          </button>
          <button
            className="btn primary"
            onClick={() => {
              hide(asking);
              setAsking(null);
            }}
          >
            Ta bort
          </button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return { order, editing, edit, bottom, question, label };
}

/**
 * The home screen is a bento grid built from the user's chosen widgets, in their order:
 * the "Nu" zone across the top, the week in the wide middle, the rest split between the
 * side columns. Each card is a module in web/src/widgets/; one without data is left out.
 * Hold a card to move or hide it (see useArrange).
 */
export function Home({ data, actions }: { data: Dashboard; actions: Actions }) {
  const arrange = useArrange(data, actions);
  const home = arrange.order ? arrange.order.map((w) => ({ ...data.home.find((x) => x.id === w.id), ...w })) : data.home;
  const chosen = home.filter((w) => w.on);
  const nowOn = chosen.some((w) => w.id === "now");
  const weekOn = chosen.some((w) => w.id === "week");
  // Which cards have something to show, and roughly how tall they are, before splitting into columns.
  const size = (id: HomeId) => widget(id)?.size(data) ?? 0;
  // Size per card: chosen in Startskärm, or "auto" – few cards get bigger, many get more compact.
  const withData = chosen.filter((w) => w.id !== "week" && w.id !== "now" && size(w.id) > 0);
  const autoSize = withData.length <= 2 ? "l" : withData.length <= 5 ? "m" : "s";
  const scale = { s: 0.88, m: 1, l: 1.18 } as const;
  const shown = withData.map((w) => {
    const sz = !w.size || w.size === "auto" ? autoSize : w.size;
    return { id: w.id, sz, h: size(w.id) * scale[sz] };
  });
  // The first cards in the user's order go to the tall side column (top right on the iPad, right
  // under Nu on a phone), so what matters most is always in view. The rest goes under the Nu zone.
  const total = shown.reduce((a, w) => a + w.h, 0);
  let acc = 0;
  let cut = shown.length;
  for (let i = 0; i < shown.length - 1; i++) {
    acc += shown[i].h;
    cut = i + 1;
    if (acc >= total * 0.65) break;
  }
  // A tap anywhere on a card (but not on its buttons, boxes and fields) opens its own page or tab.
  const open = (id: HomeId) => {
    const to = widget(id)?.opens;
    if (to && "page" in to) actions.openPage(to.page);
    else if (to) actions.openTab(to.tab);
  };
  const rest = shown.map((w) => {
    const ed = arrange.edit(w.id, true);
    return (
      <div
        className={`wsize wsize-${w.sz} opens ${ed.className}`}
        key={w.id}
        data-wid={w.id}
        {...ed.handlers}
        onClick={(e) => {
          if (arrange.editing || (e.target as HTMLElement).closest("button, input, select, textarea, a, label, .no-open")) return;
          open(w.id);
        }}
      >
        {ed.bar}
        {arrange.editing ? <ArrangeBox title={arrange.label(w.id)} /> : renderWidget(w.id, data, actions)}
      </div>
    );
  });
  const half = cut;
  return (
    <>
      {arrange.bottom}
      <main className={`home-grid ${arrange.editing ? "is-arranging" : ""}`}>
        {nowOn &&
          (arrange.editing ? (
            <ArrangeBox title={arrange.label("now")} className="strong area-now" edit={arrange.edit("now", false)} />
          ) : (
            <NowZone data={data} actions={actions} edit={arrange.edit("now", false)} />
          ))}
        <Fit className="col area-left" deps={[data, arrange.order]} min={0.7} more={(n) => <MoreButton n={n} what="kort" onClick={() => actions.openPage("kort")} />}>
          {rest.slice(half)}
        </Fit>
        {weekOn ? (
          arrange.editing ? (
            <ArrangeBox title={arrange.label("week")} className="area-week" edit={arrange.edit("week", false)} />
          ) : (
            <Week data={data} actions={actions} edit={arrange.edit("week", false)} />
          )
        ) : (
          <div className="area-week" />
        )}
        <Fit className="col area-side" deps={[data, arrange.order]} min={0.7} more={(n) => <MoreButton n={n} what="kort" onClick={() => actions.openPage("kort")} />}>
          {rest.slice(0, half)}
        </Fit>
      </main>
      {arrange.question}
    </>
  );
}
