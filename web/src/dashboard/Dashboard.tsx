import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import type { DashEvent, Dashboard as Dash, TravelChoice, TravelLeg } from "../../../server/src/types";
import { sameAsLunch } from "../../../server/src/mealwords";
import { api, isDemo } from "../api";
import { Icon, type IconName } from "../Icon";
import { INNER_NAME } from "../IpadFrame";
import { Avatar, EventIcon } from "./bits";
import { PersonPage } from "./Person";
import { GroceryModal } from "./GroceryModal";
import { Home } from "./Home";
import { Fit } from "./Fit";
import { DetailPage, PageBar, PAGE_TITLES, type PageId } from "./Detail";
import { navigate, useHash } from "../route";
import { InstallHelp, quickAddUrl } from "../InstallHelp";
import { canPrompt, inIngress, isInstalled, onInstallChange, platform, promptInstall, useSecureUrl } from "../install";
import { CarsPage, EnergyPage, GraphsPage, HousePage, LightsPage } from "./Pages";
import { FoodPage } from "./Food";
import { MusicPage } from "../widgets/music";
import { HouseholdPage, SecurityPage } from "../widgets/security";

export type Tab = "home" | "food" | "cars" | "lights" | "house" | "energy" | "graphs" | "music" | "security" | "household";
const TAB_IDS: Tab[] = ["home", "food", "cars", "lights", "house", "energy", "graphs", "music", "security", "household"];
const PAGE_IDS = Object.keys(PAGE_TITLES) as PageId[];

const TABS: { id: Tab; label: string; icon: IconName; show: (d: Dash) => boolean }[] = [
  { id: "home", label: "Hem", icon: "calendar", show: () => true },
  { id: "food", label: "Mat", icon: "food", show: (d) => d.meals.length > 0 || Boolean(d.grocery) || d.shopping.items.length > 0 },
  { id: "cars", label: "Bil", icon: "car", show: (d) => d.cars.length > 0 },
  { id: "lights", label: "Ljus", icon: "bulb", show: (d) => d.lightGroups.length + d.buttons.length + d.lights.length > 0 },
  { id: "house", label: "Hus", icon: "home", show: (d) => d.climates.length + d.temps.length > 0 },
  { id: "energy", label: "Energi", icon: "bolt", show: (d) => Boolean(d.energy || d.prices) },
  { id: "graphs", label: "Grafer", icon: "graph", show: (d) => d.graphs.length > 0 || Boolean(d.prices) },
  { id: "music", label: "Musik", icon: "music", show: (d) => Boolean(d.music?.speakers.length) },
  { id: "security", label: "Säkerhet", icon: "shield", show: (d) => Boolean(d.security) },
  { id: "household", label: "Hushåll", icon: "robot", show: (d) => Boolean(d.robots?.length || d.appliances?.length) },
];

/** Phones fit six tabs side by side; the rest sit under "Mer" (tablets show them all). */
const NARROW = "(max-width: 640px)";
function TabBar({ tabs, tab, go }: { tabs: typeof TABS; tab: Tab; go: (id: Tab) => void }) {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const split = narrow && tabs.length > 6;
  const shown = split ? tabs.slice(0, 5) : tabs;
  const rest = split ? tabs.slice(5) : [];
  const inRest = rest.some((t) => t.id === tab);
  return (
    <>
      <nav className="tabbar" aria-label="Flikar">
        {shown.map((t) => (
          <button key={t.id} aria-current={tab === t.id ? "page" : undefined} onClick={() => go(t.id)}>
            <Icon name={t.icon} size={24} />
            {t.label}
          </button>
        ))}
        {split && (
          <button aria-current={inRest ? "page" : undefined} aria-expanded={more} onClick={() => setMore(true)}>
            <Icon name="plus" size={24} />
            {inRest ? rest.find((t) => t.id === tab)!.label : "Mer"}
          </button>
        )}
      </nav>
      {more &&
        createPortal(
          <div className="overlay" onClick={() => setMore(false)}>
            <div className="sheet more-tabs" role="dialog" aria-modal="true" aria-label="Fler flikar" onClick={(e) => e.stopPropagation()}>
              {rest.map((t) => (
                <button
                  key={t.id}
                  className={`big-btn ${tab === t.id ? "accent" : ""}`}
                  onClick={() => {
                    setMore(false);
                    go(t.id);
                  }}
                >
                  <Icon name={t.icon} size={24} /> {t.label}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

const THEME_KEY = "familjetavla.theme";

function readThemeOverride(): "dark" | "light" | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

export interface Actions {
  refresh: () => Promise<unknown>;
  run: (label: string, fn: () => Promise<unknown>, verify?: Verify) => Promise<void>;
  /** Like run, but asks "Är du säker?" first – for heating, locks and similar. */
  confirm: (question: string, label: string, fn: () => Promise<unknown>) => void;
  openGrocery: (store?: string) => void;
  /** Tap on an event: show its details in a sheet. */
  openEvent: (e: DashEvent & { dayLabel?: string }) => void;
  /** "Planera veckan": set who drops off / picks up / drives for the whole week (or plan the food). */
  openPlan: (tab?: "who" | "food") => void;
  /** Open a card's own page (Veckans mat, Skolan …) or one of the tabs. */
  openPage: (page: PageId) => void;
  openTab: (tab: Tab) => void;
}

/** After an action: what to say when it worked, and how to tell from fresh data that it really did. */
export interface Verify {
  done: string;
  check: (d: Dash) => boolean;
  /** Shown instead of the warning when the state did not change in time. */
  slow?: string;
}

const SKY_ICON: Record<string, IconName> = { clear: "sun", partly: "partly", cloudy: "cloud", rain: "rain", snow: "snow", fog: "cloud" };

/** Photo frame shown after a while without touch: family photos (or the sky) with clock and what's next. */
function IdleFrame({ data, clock, onWake }: { data: Dash; clock: string; onWake: () => void }) {
  const photos = data.idle.photos;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (photos.length < 2) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % photos.length), 12_000);
    return () => clearInterval(t);
  }, [photos.length]);
  const next = data.now.items[0];
  return (
    <button className="idle" onClick={onWake} aria-label="Visa tavlan">
      {photos.length ? (
        photos.map((p, k) => <span key={p} className={`photo ${k === i ? "show" : ""}`} style={{ backgroundImage: `url("api/photos/${encodeURIComponent(p)}")` }} />)
      ) : (
        <span className="ambient sky">
          <i />
          <i />
          <i />
        </span>
      )}
      <span className="overlay-info">
        <span>
          <span className="clock">{clock}</span>
          <span className="next">
            {data.header.dateLabel}
            {next && (
              <small>
                {next.dayLabel === "idag" ? "" : `${next.dayLabel} `}
                {next.time} · {next.title}
                {next.who ? ` · ${next.who}` : ""}
              </small>
            )}
          </span>
        </span>
        {data.header.tempNow !== undefined && (
          <span className="clock" style={{ fontSize: "clamp(56px, 7vw, 96px)" }}>
            {data.header.tempNow}°
          </span>
        )}
      </span>
    </button>
  );
}

/** The calendar's own notes ("Samling 11:50 …"), line breaks kept and links clickable. */
function EventText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g);
  return (
    <div className="event-text">
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer">
            {p.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}
            {p.length > 48 ? "…" : ""}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </div>
  );
}

/** Latest copy of an event (after a travel change the dashboard is reloaded). */
function findEvent(data: Dash, key: string): DashEvent | undefined {
  for (const day of data.days) for (const e of day.events) if (e.travel?.key === key) return e;
  return data.now.items.find((e) => e.travel?.key === key);
}

const MODE_ICON = (mode: string): IconName => (mode === "bus" ? "bus" : mode === "self" ? "bike" : "car");

/** "Vem skjutsar?" – earlier names as chips plus free text (Marina, Ola, Therese …). */
function RideBy({ by, drivers, onPick }: { by?: string; drivers: string[]; onPick: (by: string | undefined) => void }) {
  const [text, setText] = useState(by ?? "");
  useEffect(() => setText(by ?? ""), [by]);
  const commit = () => text.trim() !== (by ?? "") && onPick(text.trim() || undefined);
  return (
    <div className="ride-by">
      {drivers.length > 0 && (
        <div className="fav-chips">
          {drivers.map((n) => {
            const on = n.toLowerCase() === (by ?? "").toLowerCase();
            return (
              <button key={n} className={`chip-btn ${on ? "on" : ""}`} aria-pressed={on} onClick={() => onPick(on ? undefined : n)}>
                {on && <Icon name="check" size={14} />} {n}
              </button>
            );
          })}
        </div>
      )}
      <input
        className="input"
        placeholder="Vem skjutsar? Skriv ett namn"
        value={text}
        maxLength={40}
        enterKeyHint="done"
        onChange={(x) => setText(x.target.value)}
        onBlur={commit}
        onKeyDown={(x) => x.key === "Enter" && (x.currentTarget as HTMLInputElement).blur()}
      />
    </div>
  );
}

function TravelPicker({
  label,
  leg,
  options,
  drivers,
  onPick,
}: {
  label: string;
  leg?: TravelLeg;
  options: Dash["travelOptions"];
  drivers: string[];
  onPick: (leg: TravelLeg | undefined) => void;
}) {
  return (
    <div className="travel-pick">
      <div className="travel-pick-label">
        <Icon name={label === "Dit" || label === "Lämnar" ? "arrowRight" : "arrowLeft"} size={18} />
        {label}
      </div>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const on = leg?.mode === o.mode;
          return (
            <button
              key={o.mode}
              role="radio"
              aria-checked={on}
              className={`seg-btn ${on ? "on" : ""}`}
              onClick={() => onPick(on ? undefined : { mode: o.mode })}
            >
              <Icon name={MODE_ICON(o.mode)} size={18} />
              {o.mode === "ride" && on && leg?.by ? (o.label.endsWith(" skjutsar") ? `${leg.by} skjutsar` : leg.by) : o.label}
            </button>
          );
        })}
      </div>
      {leg?.mode === "ride" && <RideBy by={leg.by} drivers={drivers} onPick={(by) => onPick({ mode: "ride", ...(by ? { by } : {}) })} />}
    </div>
  );
}

const SHELF_ITEMS = ["Blöjor", "Extrakläder", "Regnkläder", "Stövlar", "Mössa och vantar", "Våtservetter", "Solkräm", "Napp"];

/** "Saknas på hyllan": tap what the staff said was missing; it stays in Kom ihåg until tapped off. */
function ShelfPicker({ data, personId, onChanged }: { data: Dash; personId: string; onChanged: () => Promise<unknown> }) {
  const current = data.shelf.find((s) => s.personId === personId)?.items ?? [];
  const toggle = async (item: string) => {
    const next = current.includes(item) ? current.filter((x) => x !== item) : [...current, item];
    await api.shelf(personId, next);
    await onChanged();
  };
  return (
    <div className="shelf-box">
      <h3>Saknas på hyllan?</h3>
      <div className="fav-chips">
        {SHELF_ITEMS.map((it) => (
          <button key={it} className={`chip-btn ${current.includes(it) ? "on" : ""}`} aria-pressed={current.includes(it)} onClick={() => toggle(it)}>
            {current.includes(it) && <Icon name="check" size={14} />} {it}
          </button>
        ))}
      </div>
      <small className="faint">Det du markerar står i Kom ihåg tills du trycker bort det här.</small>
    </div>
  );
}

/** For förskola: grown-ups by name and "Någon annan"; for activities: every way to get there. */
function legOptions(data: Dash, care: boolean): Dash["travelOptions"] {
  return care
    ? data.travelOptions.filter((o) => o.mode.startsWith("adult:") || o.mode === "ride").map((o) => ({ ...o, label: o.mode === "ride" ? "Någon annan" : o.label.replace(/ skjutsar$/, "") }))
    : data.travelOptions.map((o) => ({ ...o, label: o.label.replace(/ skjutsar$/, "") }));
}

/** Small row of choices inside the week plan. Grown-ups who are busy then get a ⚠ and the reason below. */
function MiniPick({
  label,
  leg,
  options,
  onPick,
  drivers = [],
  busy = [],
}: {
  label: string;
  leg?: TravelLeg;
  options: Dash["travelOptions"];
  onPick: (l: TravelLeg | undefined) => void;
  drivers?: string[];
  busy?: { personId: string; title: string }[];
}) {
  const busyOf = (mode: string) => busy.find((b) => mode === `adult:${b.personId}`);
  const chosenBusy = leg ? busyOf(leg.mode) : undefined;
  return (
    <div className={`mini-pick ${leg ? "" : "unset"} ${chosenBusy ? "conflict" : ""}`}>
      <span className="mini-label">{label}</span>
      <div className="seg small" role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const on = leg?.mode === o.mode;
          const b = busyOf(o.mode);
          return (
            <button
              key={o.mode}
              role="radio"
              aria-checked={on}
              className={`seg-btn ${on ? "on" : ""} ${b ? "busy" : ""}`}
              title={b ? `Upptagen: ${b.title}` : undefined}
              onClick={() => onPick(on ? undefined : { mode: o.mode })}
            >
              {o.mode === "ride" && on && leg?.by ? leg.by : o.label}
              {b && <span aria-label="upptagen"> ⚠</span>}
            </button>
          );
        })}
      </div>
      {leg?.mode === "ride" && <RideBy by={leg.by} drivers={drivers} onPick={(by) => onPick({ mode: "ride", ...(by ? { by } : {}) })} />}
      {busy.length > 0 && (
        <small className="busy-note">
          {busy.map((b) => `${options.find((o) => o.mode === `adult:${b.personId}`)?.label ?? "?"}: ${b.title}`).join(" · ")}
        </small>
      )}
    </div>
  );
}

/** One day in "Veckans mat": the kids' lunch, tonight's dinner and what to buy for it. */
function MealRow({
  day,
  favorites,
  onChanged,
  toast,
}: {
  day: Dash["meals"][number];
  favorites: Dash["mealFavorites"];
  onChanged: () => Promise<unknown>;
  toast: (m: string) => void;
}) {
  const [dinner, setDinner] = useState(day.dinner ?? "");
  const [buy, setBuy] = useState("");
  const [shopping, setShopping] = useState(false);
  useEffect(() => setDinner(day.dinner ?? ""), [day.dinner]);
  const save = async () => {
    if (dinner.trim() === (day.dinner ?? "")) return;
    await api.dinner(day.dayKey, dinner.trim());
    await onChanged();
  };
  const twice = dinner.trim() ? sameAsLunch(dinner, day.lunch) : null;
  const pick = async (name: string) => {
    setDinner(name);
    await api.dinner(day.dayKey, name);
    await onChanged();
  };
  const fav = favorites.find((f) => f.name.toLowerCase() === dinner.trim().toLowerCase());
  const addToList = async (text: string) => {
    const items = text.split(",").map((x) => x.trim()).filter(Boolean);
    if (!items.length) return;
    for (const it of items) await api.addItem(it);
    await api.dinner(day.dayKey, dinner.trim(), text);
    toast(`${items.length} ${items.length === 1 ? "vara" : "varor"} i inköpslistan`);
    await onChanged();
  };
  return (
    <div className="meal-day">
      <span className="eyebrow">{day.dayLabel}</span>
      {day.lunch.length > 0 ? (
        day.lunch.map((l) => (
          <div key={l.child + l.dishes.join()} className="meal-lunch">
            <Icon name="school" size={16} />
            <span>
              <b>{l.child ? `${l.child}: ` : "Lunch: "}</b>
              {l.dishes.join(" · ")}
            </span>
          </div>
        ))
      ) : (
        <div className="meal-lunch faint">Ingen skollunch</div>
      )}
      <div className="row gap">
        <Icon name="food" size={20} />
        <input
          className="input grow"
          placeholder="Middag…"
          value={dinner}
          maxLength={80}
          onChange={(e) => setDinner(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </div>
      {!dinner.trim() && favorites.length > 0 && (
        <div className="fav-chips" aria-label="Favoriter">
          {favorites.slice(0, 8).map((f) => (
            <button key={f.name} className="chip-btn" onClick={() => pick(f.name)}>
              {f.name}
            </button>
          ))}
        </div>
      )}
      {twice && <span className="chip warn">Samma som lunchen ({twice.toLowerCase()})</span>}
      {dinner.trim() && !shopping && (
        <div className="row gap wrap">
          {fav?.shopping && (
            <button className="btn small ghost" onClick={() => addToList(fav.shopping!)}>
              <Icon name="plus" size={16} /> Som vanligt: {fav.shopping}
            </button>
          )}
          <button className="btn small ghost" onClick={() => setShopping(true)}>
            <Icon name="plus" size={16} /> {fav?.shopping ? "Annat" : "Att handla"}
          </button>
        </div>
      )}
      {dinner.trim() && shopping && (
        <form
          className="row gap"
          onSubmit={async (e) => {
            e.preventDefault();
            await addToList(buy);
            setBuy("");
            setShopping(false);
          }}
        >
          <input className="input grow" autoFocus placeholder="T.ex. tacoskal, ost, gräddfil" value={buy} onChange={(e) => setBuy(e.target.value)} />
          <button className="btn small" disabled={!buy.trim()}>
            <Icon name="plus" size={16} /> Inköpslistan
          </button>
        </form>
      )}
    </div>
  );
}

/** "Planera veckan": everything in the next 7 days that needs someone, one tap per choice. */
function PlanSheet({ data, onClose, onChanged, toast, startTab = "who" }: { data: Dash; onClose: () => void; onChanged: () => Promise<unknown>; toast: (m: string) => void; startTab?: "who" | "food" }) {
  const [tab, setTab] = useState<"who" | "food">(startTab);
  const [busy, setBusy] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(data.plan.missing > 0);
  // Rows you just filled in stay put (so "Alltid så" can be tapped) until the sheet is closed.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const conflict = (i: Dash["plan"]["items"][number]) =>
    (i.busy ?? []).some((b) => (b.leg === "to" ? i.travel.to : i.travel.home)?.mode === `adult:${b.personId}`);
  const items = data.plan.items.filter((i) => !onlyMissing || !i.travel.to || !i.travel.home || conflict(i) || touched.has(i.travel.key));
  const days = [...new Set(items.map((i) => i.dayKey))];
  const save = async (key: string, choice: TravelChoice, forCalendar = false) => {
    setBusy(key);
    setTouched((t) => new Set(t).add(key));
    try {
      await api.travel(key, choice.to || choice.home ? choice : null, forCalendar);
      await onChanged();
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet plan-sheet" role="dialog" aria-modal="true" aria-label="Planera veckan" onClick={(x) => x.stopPropagation()}>
        <div className="row gap">
          <h2 className="grow" style={{ fontSize: 26 }}>
            Planera veckan
          </h2>
          <button className="btn icon" aria-label="Stäng" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="seg small" role="tablist" aria-label="Planera">
          <button role="tab" aria-selected={tab === "who"} className={`seg-btn ${tab === "who" ? "on" : ""}`} onClick={() => setTab("who")}>
            Vem gör vad{data.plan.missing ? ` · ${data.plan.missing}` : ""}
          </button>
          <button role="tab" aria-selected={tab === "food"} className={`seg-btn ${tab === "food" ? "on" : ""}`} onClick={() => setTab("food")}>
            Veckans mat
          </button>
        </div>
        {tab === "food" && (
          <div className="stack plan-list">
            <p className="muted">Skriv in middagarna – barnens lunch står bredvid så ni slipper laga samma sak.</p>
            {data.meals.map((m) => (
              <MealRow key={m.dayKey} day={m} favorites={data.mealFavorites} onChanged={onChanged} toast={toast} />
            ))}
          </div>
        )}
        {tab === "who" && <>
        <div className="row gap wrap">
          <span className={`chip ${data.plan.missing ? "warn" : "good"}`}>
            {data.plan.missing ? `${data.plan.missing} att lösa` : "Allt har någon som ansvarar ✓"}
          </span>
          <button className="btn small ghost" onClick={() => setOnlyMissing(!onlyMissing)}>
            {onlyMissing ? "Visa allt" : "Bara det som saknas"}
          </button>
        </div>
        {items.length === 0 && <p className="muted">{onlyMissing ? "Klart! Allt den här veckan har någon som lämnar, hämtar eller skjutsar." : "Inga aktiviteter eller förskoledagar de kommande 7 dagarna."}</p>}
        <div className="stack plan-list">
          {days.map((dk) => (
            <div key={dk} className="stack" style={{ gap: 8 }}>
              <span className="eyebrow">{items.find((i) => i.dayKey === dk)!.dayLabel}</span>
              {items
                .filter((i) => i.dayKey === dk)
                .map((i) => {
                  const t = i.travel;
                  const care = t.kind === "care";
                  const cur: TravelChoice = { to: t.to && { mode: t.to.mode, by: t.to.by }, home: t.home && { mode: t.home.mode, by: t.home.by } };
                  const opts = legOptions(data, care);
                  return (
                    <div key={t.key} className={`plan-item ${!t.to || !t.home || conflict(i) ? "missing" : ""} ${busy === t.key ? "saving" : ""}`}>
                      <div className="row gap">
                        <EventIcon icon={i.icon} color={i.color} size={22} />
                        <b className="time">{i.time}</b>
                        <span className="grow">{i.title.replace(/^Lämning · /, "")}</span>
                        {i.initial && <Avatar initial={i.initial} color={i.color} name={i.who} />}
                      </div>
                      <MiniPick label={care ? "Lämnar" : "Dit"} leg={cur.to} options={opts} drivers={data.knownDrivers ?? []} busy={i.busy?.filter((b) => b.leg === "to")} onPick={(to) => save(t.key, { ...cur, to })} />
                      <MiniPick label={care ? "Hämtar" : "Hem"} leg={cur.home} options={opts} drivers={data.knownDrivers ?? []} busy={i.busy?.filter((b) => b.leg === "home")} onPick={(home) => save(t.key, { ...cur, home })} />
                      {t.calendarId && t.to && t.home && !t.fromCalendar && (
                        <button className="btn small ghost" style={{ justifySelf: "start" }} onClick={() => save(t.key, cur, true)}>
                          {care ? `Gör till standard för ${i.who}` : `Alltid så för ${t.calendarName ?? "kalendern"}`}
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
        <small className="faint">Valen gäller bara den dagen. Tryck "Alltid så" för att göra dem till standard – standard räknas som planerat och syns inte här igen.</small>
        </>}
      </div>
    </div>
  );
}

function EventSheet({
  e: initial,
  data,
  onClose,
  onChanged,
}: {
  e: DashEvent & { dayLabel?: string };
  data: Dash;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const fresh = initial.travel ? findEvent(data, initial.travel.key) : undefined;
  const e = { ...initial, ...(fresh ? { travel: fresh.travel } : {}) };
  const t = e.travel;
  const [busy, setBusy] = useState(false);
  const save = async (choice: TravelChoice, forCalendar = false) => {
    if (!t) return;
    setBusy(true);
    try {
      await api.travel(t.key, choice.to || choice.home ? choice : null, forCalendar);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };
  const current: TravelChoice = { to: t?.to && { mode: t.to.mode, by: t.to.by }, home: t?.home && { mode: t.home.mode, by: t.home.by } };
  // Förskola: who drops off and picks up – adults by name, or someone else.
  const care = t?.kind === "care";
  const options = care ? legOptions(data, true) : data.travelOptions;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={e.title} onClick={(x) => x.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="row gap">
          <EventIcon icon={e.icon} color={e.color} size={26} />
          <h2 className="grow" style={{ fontSize: 24 }}>
            {e.title}
          </h2>
          <button className="btn icon" aria-label="Stäng" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="stack" style={{ gap: 10, fontSize: 17 }}>
          <div className="row gap">
            <Icon name="event" size={20} />
            <span>
              {e.dayLabel ? `${e.dayLabel[0].toUpperCase()}${e.dayLabel.slice(1)} ` : ""}
              {e.time ? `${e.time}${e.end ? `–${e.end}` : ""}` : "Hela dagen"}
            </span>
          </div>
          {e.who && (
            <div className="row gap">
              <Avatar initial={e.initial ?? e.who[0]} color={e.color} name={e.who} />
              <span>{e.who}</span>
            </div>
          )}
          {e.location && (
            <div className="row gap">
              <Icon name="pin" size={20} />
              <a className="event-place" href={`https://maps.google.com/?q=${encodeURIComponent(e.location)}`} target="_blank" rel="noreferrer">
                {e.location}
              </a>
            </div>
          )}
          {e.description && <EventText text={e.description} />}
          {e.sick && (
            <button
              className={`btn small ${e.sick.on ? "" : "ghost"}`}
              style={{ alignSelf: "flex-start" }}
              onClick={async () => {
                await api.setSick(e.sick!.personId, e.sick!.date, !e.sick!.on);
                await onChanged();
                onClose();
              }}
            >
              <Icon name={e.sick.on ? "check" : "health"} size={18} /> {e.sick.on ? `${e.who} är frisk igen` : `${e.who} är sjuk ${e.dayLabel ?? "den dagen"} – stryk allt`}
            </button>
          )}
          {e.ownId && (
            <button
              className="btn small ghost"
              style={{ alignSelf: "flex-start" }}
              onClick={async () => {
                await api.removeOwnEvent(e.ownId!);
                await onChanged();
                onClose();
              }}
            >
              <Icon name="trashSmall" size={18} /> Ta bort från veckan
            </button>
          )}
          {e.cancelKey && <CancelEvent e={e} onDone={async () => (await onChanged(), onClose())} />}
        </div>
        {care && t?.calendarId && <ShelfPicker data={data} personId={t.calendarId.slice(5)} onChanged={onChanged} />}
        {t && (
          <div className={`travel-box ${busy ? "busy" : ""}`}>
            <h3>{care ? `Vem lämnar och hämtar ${e.who || "barnet"}?` : `Hur tar sig ${e.who || "barnet"} dit och hem?`}</h3>
            <TravelPicker label={care ? "Lämnar" : "Dit"} leg={current.to} options={options} drivers={data.knownDrivers ?? []} onPick={(to) => save({ ...current, to })} />
            <TravelPicker label={care ? "Hämtar" : "Hem"} leg={current.home} options={options} drivers={data.knownDrivers ?? []} onPick={(home) => save({ ...current, home })} />
            <div className="row gap wrap travel-foot">
              <span className="muted grow">
                {t.fromCalendar ? (care ? "Brukar vara så." : `Standard för ${t.calendarName ?? "kalendern"}.`) : t.to || t.home ? (care ? "Gäller bara den här dagen." : "Gäller bara det här tillfället.") : "Inget valt än."}
              </span>
              {t.calendarId && (t.to || t.home) && !t.fromCalendar && (
                <button className="btn small ghost" onClick={() => save(current, true)}>
                  {care ? "Gör till standard" : `Använd för alla i ${t.calendarName ?? "kalendern"}`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** "Utgår": the training is cancelled, the meeting moved – gone from the board, the calendar itself untouched. */
function CancelEvent({ e, onDone }: { e: DashEvent; onDone: () => Promise<unknown> }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!ask)
    return (
      <button className="btn small ghost" style={{ alignSelf: "flex-start" }} onClick={() => setAsk(true)}>
        <Icon name="x" size={18} /> Utgår
      </button>
    );
  return (
    <div className="cancel-ask">
      <span>
        <b>{e.title}</b> tas bort från tavlan och påminnelserna. Kalendern ändras inte.
      </span>
      <div className="row gap">
        <button
          className="btn small primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.cancelEvent(e.cancelKey!, true);
              await onDone();
            } finally {
              setBusy(false);
            }
          }}
        >
          Ja, utgår
        </button>
        <button className="btn small ghost" onClick={() => setAsk(false)}>
          Avbryt
        </button>
      </div>
    </div>
  );
}

const SHOW_UPDATE = "familjetavla:visa-uppdatering";

const NUDGE_KEY = "familjetavla.installera";
/**
 * "Installera appen" when the board is opened in a browser that can install it: Chrome/Edge/Samsung
 * offer a real install prompt, Safari on iPad/iPhone gets the share-menu steps. "Inte nu" waits 30 days.
 */
function InstallNudge({ onHelp }: { onHelp: () => void }) {
  const [, redraw] = useState(0);
  useEffect(() => {
    const off = onInstallChange(() => redraw((n) => n + 1));
    return () => {
      off();
    };
  }, []);
  const [hidden, setHidden] = useState(() => {
    try {
      return Number(localStorage.getItem(NUDGE_KEY) ?? 0) > Date.now();
    } catch {
      return false;
    }
  });
  const secureUrl = useSecureUrl(api);
  if (hidden || isInstalled() || inIngress() || !(canPrompt() || platform() === "ios" || secureUrl)) return null;
  const later = () => {
    setHidden(true);
    try {
      localStorage.setItem(NUDGE_KEY, String(Date.now() + 30 * 86_400_000));
    } catch {
      /* private mode */
    }
  };
  return (
    <div className="card update-banner install-nudge" role="status">
      <div className="row gap wrap" style={{ alignItems: "center" }}>
        <Icon name="install" size={20} />
        <b className="grow">Installera Familjetavlan som app – öppnas i helskärm från hemskärmen</b>
        <button
          className="btn small primary"
          onClick={async () => {
            if (canPrompt()) {
              if (await promptInstall()) setHidden(true);
            } else if (secureUrl && platform() !== "ios") location.href = secureUrl;
            else onHelp();
          }}
        >
          Installera
        </button>
        <button className="btn small ghost" onClick={later}>
          Inte nu
        </button>
      </div>
    </div>
  );
}

/** Small, top of the board: which version runs, and whether it is the latest. */
function VersionBadge({ version, update }: { version: NonNullable<Dash["version"]>; update?: Dash["update"] }) {
  if (update)
    return (
      <button className="version-badge old" onClick={() => window.dispatchEvent(new Event(SHOW_UPDATE))} aria-label={`Version ${version.current}. Ny version ${update.latest} finns – visa hur du uppdaterar`}>
        v{version.current} · uppdatera till {update.latest}
      </button>
    );
  return (
    <span className={`version-badge ${version.latest ? "ok" : ""}`} title={version.latest ? "Ni har den senaste versionen" : "Kunde inte se om det finns en nyare version"}>
      v{version.current}
      {version.latest ? (
        <>
          {" ✓"}
          <span className="badge-long"> senaste</span>
        </>
      ) : null}
    </span>
  );
}

/** "Ny version finns": how to update depends on how the board is installed. */
function UpdateBanner({ update }: { update: NonNullable<Dash["update"]> }) {
  const [open, setOpen] = useState(false);
  const key = `familjetavla.update.${update.latest}`;
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(key) === "dold";
    } catch {
      return false;
    }
  });
  // The version badge in the header brings the banner back, opened.
  useEffect(() => {
    const show = () => {
      setHidden(false);
      setOpen(true);
    };
    window.addEventListener(SHOW_UPDATE, show);
    return () => window.removeEventListener(SHOW_UPDATE, show);
  }, []);
  if (hidden) return null;
  return (
    <div className="card update-banner" role="status">
      <div className="row gap" style={{ alignItems: "center" }}>
        <Icon name="alert" size={20} />
        <b className="grow">Ny version {update.latest} finns (ni har {update.current})</b>
        <button className="btn small" onClick={() => setOpen(!open)}>
          {open ? "Stäng" : "Så uppdaterar du"}
        </button>
        <button
          className="btn small ghost"
          aria-label="Dölj tills nästa version"
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem(key, "dold");
            } catch {
              /* ignore */
            }
          }}
        >
          <Icon name="x" size={18} />
        </button>
      </div>
      {open && (
        <div className="stack" style={{ gap: 6, marginTop: 10 }}>
          <span>
            <b>Home Assistant-tillägg:</b> Inställningar → Tillägg → Familjetavla → Uppdatera. (Syns ingen uppdatering: tryck ⋮ → Sök efter
            uppdateringar i tilläggsbutiken.)
          </span>
          <span>
            <b>Docker:</b> kör <code>docker compose pull &amp;&amp; docker compose up -d</code> i mappen med docker-compose.yml.
          </span>
          <small className="muted">Inställningarna ligger kvar. Vad som är nytt står i ändringsloggen på GitHub.</small>
        </div>
      )}
    </div>
  );
}

function personHintUsed() {
  try {
    return localStorage.getItem("ft_person_used") === "1";
  } catch {
    return false;
  }
}

export function Dashboard() {
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState("");
  // Where we are comes from the address: #/flik/ljus-style tabs and #/sida/maten-style pages,
  // so Android's back button and "Tillbaka" walk back the same way.
  const hash = useHash();
  const [, kind, id] = hash.split("/");
  const page = kind === "sida" && PAGE_IDS.includes(id as PageId) ? (id as PageId) : null;
  const personId = kind === "person" && id ? decodeURIComponent(id) : null;
  const tab: Tab = kind === "flik" && TAB_IDS.includes(id as Tab) ? (id as Tab) : "home";
  const setTab = (t: Tab) => navigate(t === "home" ? "/" : `/flik/${t}`);
  const [planTab, setPlanTab] = useState<"who" | "food">("who");
  const [installOpen, setInstallOpen] = useState(false);
  const [now, setNow] = useState(new Date());
  const [toast, setToast] = useState("");
  const [grocery, setGrocery] = useState<{ store?: string } | null>(null);
  const [awakeUntil, setAwakeUntil] = useState(0);
  const [themeOverride, setThemeOverride] = useState(readThemeOverride);
  const [asking, setAsking] = useState<{ question: string; label: string; fn: () => Promise<unknown> } | null>(null);
  const [eventOpen, setEventOpen] = useState<(DashEvent & { dayLabel?: string }) | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [idle, setIdle] = useState(false);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const toastTimer = useRef<number>(0);
  const lastTouch = useRef(Date.now());

  const refresh = useCallback(async (): Promise<Dash | null> => {
    try {
      const d = await api.dashboard();
      setData(d);
      setError("");
      return d;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
    const poll = window.setInterval(refresh, 60_000);
    const tick = window.setInterval(() => setNow(new Date()), 15_000);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    // Live updates: the server pushes "change" when something on the board changes in HA.
    let es: EventSource | null = null;
    let soon = 0;
    try {
      if (!isDemo) es = new EventSource("api/events");
      if (es) {
        es.onmessage = () => {
          window.clearTimeout(soon);
          soon = window.setTimeout(refresh, 150);
        };
        // Live power flow, about once a second: only the numbers change, the board is not reloaded.
        es.addEventListener("energy", (ev) => {
          try {
            const live = JSON.parse((ev as MessageEvent<string>).data) as NonNullable<Dash["energy"]>;
            setData((d) => (d?.energy ? { ...d, energy: { ...d.energy, ...live } } : d));
          } catch {
            /* the next full refresh has it */
          }
        });
      }
    } catch {
      /* polling still works */
    }
    // The demo has no Home Assistant: let the power wander a little so the live flow can be seen.
    const demoLive = isDemo
      ? window.setInterval(() => {
          setData((d) => {
            const e = d?.energy;
            if (!e || e.solarKw === undefined || e.houseKw === undefined) return d;
            const solar = Math.round(Math.max(0, 1.84 + (Math.random() - 0.5) * 0.3) * 100) / 100;
            const house = Math.round(Math.max(0.3, 2.44 + (Math.random() - 0.5) * 0.4) * 100) / 100;
            const grid = Math.round((house - solar) * 100) / 100;
            return { ...d, energy: { ...e, solarKw: solar, houseKw: house, gridKw: grid, selfUseKw: Math.min(solar, house) } };
          });
        }, 2000)
      : 0;
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      clearInterval(demoLive);
      es?.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3500);
  };

  // Anything that fails without its own message (a sheet save, a shelf tick) still tells the user.
  useEffect(() => {
    const onFail = (ev: PromiseRejectionEvent) => {
      ev.preventDefault();
      showToast(`Det gick inte att spara: ${(ev.reason as Error)?.message ?? "okänt fel"}`);
    };
    window.addEventListener("unhandledrejection", onFail);
    return () => window.removeEventListener("unhandledrejection", onFail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Home Assistant accepts the call before the lamp has switched, so check the state again a
  // few times and say clearly whether it worked.
  const run: Actions["run"] = async (label, fn, verify) => {
    try {
      try {
        navigator.vibrate?.(12); // kort känsla i fingret på telefoner som kan (inte iPhone)
      } catch {
        /* ingen vibrator: inget händer */
      }
      await fn();
      let d = await refresh();
      if (!verify) return;
      for (let i = 0; i < 6 && d && !verify.check(d); i++) {
        await new Promise((r) => setTimeout(r, 1000));
        d = await refresh();
      }
      showToast(d && verify.check(d) ? `✓ ${verify.done}` : (verify.slow ?? `⚠ ${label} svarade inte – är den offline eller strömlös?`));
    } catch (e) {
      showToast(`⚠ ${label}: ${(e as Error).message}`);
    }
  };
  const actions: Actions = {
    refresh,
    openGrocery: (store) => setGrocery({ store }),
    run,
    confirm: (question, label, fn) => setAsking({ question, label, fn }),
    openEvent: setEventOpen,
    openPlan: (t = "who") => {
      setPlanTab(t);
      setPlanOpen(true);
    },
    openPage: (p) => {
      navigate(`/sida/${p}`);
      window.scrollTo({ top: 0 });
    },
    openTab: (t) => {
      setTab(t);
      window.scrollTo({ top: 0 });
    },
  };

  // Theme: explicit choice (button) wins, else config: auto follows "dygnsfärger" (light dawn/day, dark dusk/night).
  const phase = data?.header.phase ?? "night";
  // E-ink is a property of the screen, so it wins over the light/dark button too.
  // "?tema=spegel" or "?tema=eink" in the address sets the look for this screen only (a mirror, an e-ink frame).
  const screenTheme = ({ spegel: "mirror", mirror: "mirror", eink: "eink" } as const)[new URLSearchParams(location.search).get("tema") ?? ""] as "mirror" | "eink" | undefined;
  const fixed = screenTheme ?? (data?.theme === "eink" || data?.theme === "mirror" ? data.theme : undefined);
  const theme = fixed ?? themeOverride ?? (data?.theme === "auto" || !data ? (phase === "dawn" || phase === "day" ? "light" : "dark") : data.theme);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.phase = theme === "light" || theme === "eink" ? (phase === "dawn" ? "dawn" : "day") : theme === "mirror" ? "night" : phase === "dusk" ? "dusk" : "night";
    root.dataset.sky = data?.header.sky ?? "partly";
  }, [theme, phase, data?.header.sky]);

  // Photo frame after N minutes without touch.
  useEffect(() => {
    const touch = () => {
      lastTouch.current = Date.now();
    };
    window.addEventListener("pointerdown", touch, { passive: true });
    window.addEventListener("keydown", touch);
    const t = window.setInterval(() => {
      const mins = data?.idle.minutes ?? 0;
      if (mins > 0 && Date.now() - lastTouch.current > mins * 60_000) setIdle(true);
    }, 10_000);
    return () => {
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      clearInterval(t);
    };
  }, [data?.idle.minutes]);

  // Switch tab with a sliding view transition where the browser supports it.
  const goTab = (next: Tab, list: Tab[]) => {
    const root = next === "home" ? "/" : `/flik/${next}`;
    if (next === tab && hash === root) {
      // Already on the tab's first page: tapping it again goes back to the top of it.
      window.dispatchEvent(new Event("familjetavla:tab-reset"));
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const dir = list.indexOf(next) > list.indexOf(tab) ? 1 : -1;
    document.documentElement.style.setProperty("--dir", String(dir));
    // The tab lives in the address now (so Android's back button works); the slide comes from CSS.
    setTab(next);
    window.scrollTo({ top: 0 });
  };

  // Gestures: swipe sideways between tabs, pull down at the top to refresh.
  const gesture = useRef<{ x: number; y: number; t: number; pulling: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    const target = e.target as HTMLElement;
    if (target.closest("input, select, textarea, .bars, .chart")) return;
    gesture.current = { x: e.clientX, y: e.clientY, t: Date.now(), pulling: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (document.documentElement.dataset.volDrag) {
      // Ett volymsvep pågår (Musik): inget laddar om sidan och inget byter flik.
      gesture.current = null;
      setPull(0);
      return;
    }
    const dy = e.clientY - g.y;
    const dx = e.clientX - g.x;
    if (g.pulling && dy > 0 && Math.abs(dy) > Math.abs(dx)) setPull(Math.min(110, dy * 0.6));
  };
  const onPointerUp = async (e: React.PointerEvent, list: Tab[]) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(dy) * 1.8 && Date.now() - g.t < 600) {
      const i = list.indexOf(tab) + (dx < 0 ? 1 : -1);
      if (i >= 0 && i < list.length) goTab(list[i], list);
    }
  };

  // The tablet's volume buttons turn the music that plays, when the board runs in Fully Kiosk Browser
  // (a plain browser never passes the hardware keys on). Fully reports them as the events volumeUp/volumeDown.
  const musicRef = useRef(data?.music);
  musicRef.current = data?.music;
  useEffect(() => {
    const fully = (window as unknown as { fully?: { bind?: (ev: string, js: string) => void } }).fully;
    if (!fully?.bind) return;
    const step = (dir: 1 | -1) => {
      const sp = musicRef.current?.speakers.find((x) => x.playing && !x.offline && typeof x.volume === "number");
      if (!sp) return;
      const pct = Math.max(0, Math.min(100, Math.round((sp.volume as number) + dir * 5)));
      void api.volume(sp.entityId, pct).then(() => refresh());
    };
    (window as unknown as Record<string, unknown>).__ftVolume = step;
    fully.bind("volumeUp", "window.__ftVolume(1)");
    fully.bind("volumeDown", "window.__ftVolume(-1)");
    return () => {
      delete (window as unknown as Record<string, unknown>).__ftVolume;
    };
  }, [refresh]);

  // Pull down at the top to reload. Touch events (not pointer events): the browser takes over a
  // vertical pan and cancels the pointer ones. A volume swipe in Musik (only while music plays) wins.
  useEffect(() => {
    let y0: number | null = null;
    let dist = 0;
    const start = (e: TouchEvent) => {
      const t = e.target as HTMLElement;
      y0 = window.scrollY <= 0 && e.touches.length === 1 && !t.closest("input, select, textarea, .bars, .chart, .overlay, .vol-overlay") ? e.touches[0]!.clientY : null;
      dist = 0;
    };
    const move = (e: TouchEvent) => {
      if (y0 === null) return;
      if (document.documentElement.dataset.volDrag || window.scrollY > 0) {
        y0 = null;
        setPull(0);
        return;
      }
      const dy = e.touches[0]!.clientY - y0;
      if (dy > 8) {
        dist = Math.min(110, (dy - 8) * 0.6);
        if (e.cancelable) e.preventDefault();
        setPull(dist);
      }
    };
    const end = async () => {
      const go = y0 !== null && dist >= 80;
      y0 = null;
      setPull(0);
      if (go) {
        setRefreshing(true);
        await refresh();
        setRefreshing(false);
      }
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, [refresh]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setThemeOverride(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
  };

  if (!data) {
    return (
      <div className="center-screen">
        {error ? (
          <div className="card">
            <h2>Kunde inte hämta tavlan</h2>
            <p className="muted">{error}</p>
            <button className="btn primary" onClick={refresh}>
              Försök igen
            </button>
          </div>
        ) : (
          <div className="skeleton-board" role="status" aria-label="Laddar tavlan">
            <div className="skel skel-head" />
            <div className="skel skel-hero" />
            <div className="skel-grid">
              <div className="skel skel-card" />
              <div className="skel skel-card" />
              <div className="skel skel-card" />
            </div>
          </div>
        )}
      </div>
    );
  }

  const tabOn = (id: Tab) => id === "home" || data.tabs.find((t) => t.id === id)?.on !== false;
  const order = (id: Tab) => (id === "home" ? -1 : data.tabs.findIndex((t) => t.id === id));
  const tabs = TABS.filter((t) => t.show(data) && tabOn(t.id)).sort((a, b) => order(a.id) - order(b.id));
  const clock = now.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  const sleeping = data.night && data.theme !== "eink" && data.theme !== "mirror" && !screenTheme && Date.now() > awakeUntil;

  const tabIds = tabs.map((t) => t.id);

  return (
    <div
      className="app-bg"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => onPointerUp(e, tabIds)}
      onPointerCancel={() => {
        gesture.current = null;
        setPull(0);
      }}
    >
      <div className="sky" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className={`pull ${refreshing ? "spin" : ""}`} style={{ ["--pull" as string]: `${refreshing ? 30 : pull - 80}px` }} aria-hidden="true">
        <Icon name="refresh" size={22} />
      </div>
      <div className={`board ${tabs.length > 1 ? "" : "no-tabs"}`}>
        <header className="board-header">
          <div className="grow">
            <h1>
              <span className={`status-dot ${data.errors.length ? "warn" : ""}`} aria-hidden="true" />
              {data.header.dateLabel}
            </h1>
            <p className="sub">
              {data.header.sky && <Icon name={SKY_ICON[data.header.sky] ?? "partly"} size={20} />}
              <span>Vecka {data.header.week}</span>
              {isDemo && (
                <span className="demo-only">
                  <button className="btn small ghost" style={{ minHeight: 30, color: "var(--blue)" }} onClick={() => setIdle(true)}>
                    Visa viloläge
                  </button>
                  <span className="chip warn" style={{ padding: "2px 10px", fontSize: 12 }}>Demo · låtsasdata</span>
                  <button
                    className="btn small ghost"
                    style={{ minHeight: 30, color: "var(--blue)" }}
                    onClick={() => {
                      location.hash = "forsta";
                      location.reload();
                    }}
                  >
                    Prova första starten
                  </button>
                  {window.name !== INNER_NAME && (
                    <button
                      className="btn small ghost"
                      style={{ minHeight: 30, color: "var(--blue)" }}
                      onClick={() => {
                        location.hash = "ipad";
                        location.reload();
                      }}
                    >
                      Visa som iPad
                    </button>
                  )}
                </span>
              )}
              {data.header.weather && <span className="sub-weather">· {data.header.weather}</span>}
              {data.version && <VersionBadge version={data.version} update={data.update} />}
            </p>
          </div>
          {data.people.length > 0 && (
            <div className={`people ${!personId && !personHintUsed() ? "fresh" : ""}`} aria-label="Vem är hemma – tryck på en person för hens vecka">
              {data.people.map((p) => (
                <button
                  key={p.name}
                  className={`avatar-btn ${personId === p.id ? "on" : ""}`}
                  aria-label={`Visa ${p.name}s vecka`}
                  title={`Visa ${p.name}s vecka: skola, läxor, träningar och mat`}
                  onClick={() => {
                    try {
                      localStorage.setItem("ft_person_used", "1");
                    } catch {
                      /* ingen lagring: tipset visas bara igen */
                    }
                    navigate(`/person/${p.id}`);
                  }}
                >
                  <Avatar initial={p.initial} color={p.color} name={p.name} away={!p.home} size="lg" />
                </button>
              ))}
            </div>
          )}
          <div className="clock" aria-label={`Klockan är ${clock}`}>
            {clock}
          </div>
          <div className="row gap">
            <button className="btn icon" aria-label={theme === "dark" ? "Byt till ljust tema" : "Byt till mörkt tema"} onClick={toggleTheme}>
              <Icon name={theme === "dark" ? "moon" : "sun"} size={24} />
            </button>
            <button className="btn icon" aria-label="Ladda om tavlan" title="Ladda om tavlan (hämtar också senaste versionen)" onClick={() => window.location.reload()}>
              <Icon name="refresh" size={24} />
            </button>
            {!isInstalled() && !isDemo && (
              <button className="btn icon" aria-label="Installera som app" title="Lägg tavlan på hemskärmen" onClick={() => setInstallOpen(true)}>
                <Icon name="install" size={24} />
              </button>
            )}
            <a className="btn icon" aria-label="Inställningar" href="#/setup">
              <Icon name="gear" size={24} />
            </a>
          </div>
        </header>

        {error && (
          <div className="card result bad" role="status" style={{ padding: "12px 18px" }}>
            Ingen kontakt med tavlan just nu – visar det som hämtades {new Date(data.generatedAt ?? Date.now()).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}. Försöker igen.
          </div>
        )}
        {data.errors.length > 0 && (
          <details className="card" style={{ padding: "12px 18px" }}>
            <summary className="muted" style={{ cursor: "pointer" }}>
              {data.errors.length} {data.errors.length === 1 ? "källa" : "källor"} svarar inte just nu
            </summary>
            <ul className="muted" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {data.errors.map((e, i) => (
                <li key={i}>
                  <b>{e.source}:</b> {e.message}
                </li>
              ))}
            </ul>
          </details>
        )}

        {data.update && <UpdateBanner update={data.update} />}
        {!isDemo && <InstallNudge onHelp={() => setInstallOpen(true)} />}

        {personId ? (
          <PersonPage data={data} personId={personId} />
        ) : page ? (
          <DetailPage page={page} data={data} actions={actions} />
        ) : (
        <div className="tab-page">
          {tab !== "home" && <PageBar title={TABS.find((t) => t.id === tab)?.label ?? ""} />}
          {tab === "home" && <Home data={data} actions={actions} />}
          {tab !== "home" && (
            <Fit className="tab-body view-in" key={tab} deps={[data, tab]}>
              {tab === "cars" && <CarsPage data={data} actions={actions} />}
              {tab === "lights" && <LightsPage data={data} actions={actions} />}
              {tab === "security" && <SecurityPage data={data} actions={actions} />}
              {tab === "household" && <HouseholdPage data={data} actions={actions} />}
              {tab === "food" && <FoodPage data={data} actions={actions} />}
              {tab === "house" && <HousePage data={data} actions={actions} />}
              {tab === "energy" && <EnergyPage data={data} />}
              {tab === "graphs" && <GraphsPage data={data} />}
              {tab === "music" && <MusicPage data={data} actions={actions} />}
            </Fit>
          )}
        </div>
        )}
      </div>

      {tabs.length > 1 && <TabBar tabs={tabs} tab={tab} go={(id) => goTab(id, tabIds)} />}

      {grocery && (
        <GroceryModal
          storeId={grocery.store}
          onClose={() => setGrocery(null)}
          onDone={(msg) => {
            setGrocery(null);
            showToast(msg);
            refresh();
          }}
        />
      )}

      {asking && (
        <div className="overlay" onClick={() => setAsking(null)}>
          <div className="sheet" role="alertdialog" aria-modal="true" aria-label={asking.question} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <h2 style={{ fontSize: 22 }}>{asking.question}</h2>
            <div className="row gap" style={{ justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setAsking(null)}>
                Avbryt
              </button>
              <button
                className="btn primary"
                autoFocus
                onClick={() => {
                  const a = asking;
                  setAsking(null);
                  run(a.label, a.fn);
                }}
              >
                Ja
              </button>
            </div>
          </div>
        </div>
      )}

      {installOpen && (
        <div className="overlay" onClick={() => setInstallOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Lägg tavlan på hemskärmen" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="row gap" style={{ alignItems: "center" }}>
              <h2 className="grow" style={{ fontSize: 24 }}>
                Lägg tavlan på hemskärmen
              </h2>
              <button className="btn icon" aria-label="Stäng" onClick={() => setInstallOpen(false)}>
                <Icon name="x" size={22} />
              </button>
            </div>
            <InstallHelp />
            <h3 style={{ marginTop: 18 }}>Lägg till från mobilen</h3>
            <p className="muted">
              Öppna den här adressen på telefonen och lägg den på hemskärmen. Där skriver ni in en händelse eller något att handla, och det syns på
              tavlan direkt.
            </p>
            <p>
              <b style={{ wordBreak: "break-all" }}>{quickAddUrl()}</b>
            </p>
            <div className="row gap">
              <button className="btn small" onClick={() => navigator.clipboard?.writeText(quickAddUrl()).then(() => showToast("Länken kopierad"))}>
                Kopiera länken
              </button>
              <button className="btn small ghost" onClick={() => navigate("/lagg-till")}>
                Prova här
              </button>
            </div>
          </div>
        </div>
      )}

      {eventOpen && <EventSheet e={eventOpen} data={data} onClose={() => setEventOpen(null)} onChanged={refresh} />}
      {planOpen && <PlanSheet data={data} onClose={() => setPlanOpen(false)} onChanged={refresh} toast={showToast} startTab={planTab} />}

      {idle && !sleeping && (
        <IdleFrame
          data={data}
          clock={clock}
          onWake={() => {
            lastTouch.current = Date.now();
            setIdle(false);
          }}
        />
      )}

      {sleeping && (
        <button className="night-veil" onClick={() => setAwakeUntil(Date.now() + 2 * 60_000)} aria-label="Väck skärmen">
          {/* Pixel shift: the clock wanders slowly so an OLED panel does not burn in. */}
          <span className="clock" style={{ transform: `translate(${((now.getMinutes() * 37) % 41) - 20}vw, ${((now.getMinutes() * 23) % 31) - 15}vh)` }}>
            {clock}
          </span>
        </button>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
