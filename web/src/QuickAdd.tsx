import { Fit } from "./dashboard/Fit";
import { useEffect, useState } from "react";
import type { Person } from "../../server/src/types";
import { api } from "./api";
import { Icon } from "./Icon";
import { navigate } from "./route";

/**
 * "Lägg till från mobilen" (#/lagg-till): a small page for the phone. Type an event or something
 * to buy, and it is on the board at once. Save it to the home screen for a one-tap shortcut.
 */
export function QuickAdd({ people }: { people: Person[] }) {
  const [tab, setTab] = useState<"event" | "shop" | "sick">("event");
  const kids = people.filter((p) => p.kind === "child");
  // The phone's own light/dark, unless the board's theme button was used on this device.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("familjetavla.theme");
    } catch {
      /* private mode */
    }
    const dark = saved ? saved === "dark" : window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.phase = dark ? "night" : "day";
  }, []);
  const [done, setDone] = useState<string[]>([]);
  const added = (text: string) => setDone((d) => [text, ...d].slice(0, 6));
  return (
    <main className="quick-add">
      <Fit className="qa-fit" deps={[tab, done.length]}>
      <header className="row gap" style={{ alignItems: "center" }}>
        <h1 className="grow">Lägg till på tavlan</h1>
        <button className="btn small ghost" onClick={() => navigate("/")}>
          Till tavlan
        </button>
      </header>
      <div className="seg" role="tablist">
        <button className={`seg-btn ${tab === "event" ? "on" : ""}`} role="tab" aria-selected={tab === "event"} onClick={() => setTab("event")}>
          <Icon name="calendar" size={20} /> Händelse
        </button>
        <button className={`seg-btn ${tab === "shop" ? "on" : ""}`} role="tab" aria-selected={tab === "shop"} onClick={() => setTab("shop")}>
          <Icon name="cart" size={20} /> Handla
        </button>
        {kids.length > 0 && (
          <button className={`seg-btn ${tab === "sick" ? "on" : ""}`} role="tab" aria-selected={tab === "sick"} onClick={() => setTab("sick")}>
            <Icon name="health" size={20} /> Sjuk
          </button>
        )}
      </div>
      {tab === "event" ? <EventForm people={people} onAdded={added} /> : tab === "shop" ? <ShopForm onAdded={added} /> : <SickForm kids={kids} onAdded={added} />}
      {done.length > 0 && (
        <section className="card qa-done" aria-live="polite">
          {done.map((t, i) => (
            <p key={i}>
              <Icon name="check" size={18} /> {t}
            </p>
          ))}
        </section>
      )}
      </Fit>
    </main>
  );
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayLabel = (s: string) => {
  const d = new Date(`${s}T12:00`);
  const t = new Date();
  if (s === iso(t)) return "idag";
  if (s === iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1))) return "imorgon";
  return d.toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" });
};

function EventForm({ people, onAdded }: { people: Person[]; onAdded: (t: string) => void }) {
  const today = new Date();
  const days = Array.from({ length: 5 }, (_, i) => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)));
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(days[0]);
  const [time, setTime] = useState("");
  const [end, setEnd] = useState("");
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return setError("Skriv vad det gäller.");
        setBusy(true);
        setError("");
        try {
          await api.addOwnEvent({ title: title.trim(), date, time: time || undefined, end: time && end ? end : undefined, personId: who || undefined });
          const name = people.find((p) => p.id === who)?.name;
          onAdded(`${title.trim()} · ${dayLabel(date)}${time ? ` ${time}` : ""}${name ? ` · ${name}` : ""}`);
          setTitle("");
          setTime("");
          setEnd("");
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>Vad?</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tandläkare, kalas hos Elsa…" maxLength={80} enterKeyHint="next" />
      </label>
      <div className="field">
        <span>Dag</span>
        <div className="seg">
          {days.map((d) => (
            <button type="button" key={d} className={`seg-btn ${date === d ? "on" : ""}`} onClick={() => setDate(d)}>
              {dayLabel(d)}
            </button>
          ))}
          <label className={`seg-btn qa-date ${days.includes(date) ? "" : "on"}`}>
            {days.includes(date) ? "Annan dag…" : dayLabel(date)}
            <input type="date" aria-label="Annan dag" value={date} min={days[0]} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
        </div>
      </div>
      <div className="row gap">
        <label className="field grow">
          <span>Från (valfritt)</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label className="field grow">
          <span>Till</span>
          <input type="time" value={end} disabled={!time} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      {people.length > 0 && (
        <div className="field">
          <span>Vem gäller det?</span>
          <div className="seg">
            <button type="button" className={`seg-btn ${who === "" ? "on" : ""}`} onClick={() => setWho("")}>
              Alla
            </button>
            {people.map((p) => (
              <button type="button" key={p.id} className={`seg-btn ${who === p.id ? "on" : ""}`} onClick={() => setWho(p.id)}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      <button className="btn primary big" disabled={busy || !title.trim()}>
        {busy ? "Lägger till…" : "Lägg på tavlan"}
      </button>
    </form>
  );
}

function ShopForm({ onAdded }: { onAdded: (t: string) => void }) {
  const [name, setName] = useState("");
  const [items, setItems] = useState<string[]>([]);
  const [error, setError] = useState("");
  const load = () =>
    api
      .dashboard()
      .then((d) => setItems(d.shopping.items.filter((i) => !i.done).map((i) => i.name)))
      .catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const n = name.trim();
        if (!n) return;
        setError("");
        try {
          await api.addItem(n);
          onAdded(`${n} · på inköpslistan`);
          setName("");
          void load();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <label className="field">
        <span>Vad behöver ni?</span>
        <div className="row gap">
          <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mjölk, blöjor…" maxLength={80} enterKeyHint="send" autoFocus />
          <button className="btn primary" disabled={!name.trim()}>
            Lägg till
          </button>
        </div>
      </label>
      {error && <p className="error-text">{error}</p>}
      {items.length > 0 && (
        <p className="muted qa-list">
          På listan: {items.slice(0, 12).join(", ")}
          {items.length > 12 ? ` och ${items.length - 12} till` : ""}
        </p>
      )}
    </form>
  );
}

/** Sjuk/VAB: strikes the child's förskola, school and activities that day and tells the grown-ups. */
function SickForm({ kids, onAdded }: { kids: Person[]; onAdded: (t: string) => void }) {
  const t = new Date();
  const days = [iso(t), iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1))];
  const [who, setWho] = useState(kids[0]?.id ?? "");
  const [date, setDate] = useState(days[0]);
  const [sick, setSickList] = useState<{ personId: string; name: string; date: string }[]>([]);
  const [error, setError] = useState("");
  const load = () =>
    api
      .dashboard()
      .then((d) => setSickList(d.sick ?? []))
      .catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  const mark = async (personId: string, day: string, on: boolean) => {
    setError("");
    try {
      await api.setSick(personId, day, on);
      const name = kids.find((k) => k.id === personId)?.name ?? "";
      onAdded(on ? `${name} är sjuk ${dayLabel(day)} – allt är struket` : `${name} är frisk igen ${dayLabel(day)}`);
      void load();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <div className="card stack">
      <div className="field">
        <span>Vem är sjuk?</span>
        <div className="seg">
          {kids.map((k) => (
            <button type="button" key={k.id} className={`seg-btn ${who === k.id ? "on" : ""}`} onClick={() => setWho(k.id)}>
              {k.name}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>När?</span>
        <div className="seg">
          {days.map((d) => (
            <button type="button" key={d} className={`seg-btn ${date === d ? "on" : ""}`} onClick={() => setDate(d)}>
              {dayLabel(d)}
            </button>
          ))}
        </div>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Förskola, skola och aktiviteter stryks den dagen, ingen behöver lämna eller hämta, och de vuxna får en notis.
      </p>
      {error && <p className="error-text">{error}</p>}
      <button className="btn primary big" disabled={!who} onClick={() => void mark(who, date, true)}>
        Sjuk {dayLabel(date)}
      </button>
      {sick.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {sick.map((x) => (
            <div key={`${x.personId}${x.date}`} className="row gap" style={{ alignItems: "center" }}>
              <span className="grow">
                {x.name} sjuk {dayLabel(x.date)}
              </span>
              <button className="btn small" onClick={() => void mark(x.personId, x.date, false)}>
                Frisk igen
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
