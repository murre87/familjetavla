import { useEffect, useId, useMemo, useState } from "react";
import type { Control, Dashboard, Lamp } from "../../../server/src/types";
import { api, type CarDetails, type GraphData } from "../api";
import { Icon } from "../Icon";
import type { Actions } from "./Dashboard";
import { Ring } from "./bits";
import { PriceCard } from "../widgets/prices";

const DAYS = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
const fmtNum = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? "–" : String(Math.round(n * 10 ** d) / 10 ** d).replace(".", ","));

// ---------- Generic control (switch / select / number / button) ----------

export function ControlView({ c, actions }: { c: Control; actions: Actions }) {
  if (c.domain === "select" || c.domain === "input_select") {
    return (
      <label className="field">
        <span>{c.name}</span>
        <select value={c.state} disabled={c.offline} onChange={(e) => actions.run(c.name, () => api.control(c.entityId, "select", e.target.value))}>
          {(c.options ?? [c.state]).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (c.domain === "number" || c.domain === "input_number") {
    const v = Number(c.state);
    const step = c.step ?? 1;
    const set = (n: number) => actions.run(c.name, () => api.control(c.entityId, "set", Math.min(c.max ?? Infinity, Math.max(c.min ?? -Infinity, n))));
    return (
      <div className="row gap">
        <span className="grow">{c.name}</span>
        <button className="btn small" aria-label={`Sänk ${c.name}`} disabled={c.offline} onClick={() => set(v - step)}>
          −
        </button>
        <b className="tabular" style={{ minWidth: 70, textAlign: "center" }}>
          {Number.isFinite(v) ? `${fmtNum(v)}${c.unit ? ` ${c.unit}` : ""}` : "–"}
        </b>
        <button className="btn small" aria-label={`Höj ${c.name}`} disabled={c.offline} onClick={() => set(v + step)}>
          +
        </button>
      </div>
    );
  }
  if (c.domain === "button" || c.domain === "input_button") {
    return (
      <button className="btn" disabled={c.offline} onClick={() => actions.run(c.name, () => api.control(c.entityId, "press"))}>
        {c.name}
      </button>
    );
  }
  return (
    <button
      className={`light-btn ${c.on ? "on" : ""} ${c.offline ? "offline" : ""}`}
      aria-pressed={c.on}
      disabled={c.offline}
      onClick={() => actions.run(c.name, () => api.control(c.entityId, "toggle"))}
    >
      {c.name}
    </button>
  );
}

// ---------- Cars ----------

function ScheduleEditor({ car, actions }: { car: Dashboard["cars"][number]; actions: Actions }) {
  const [adding, setAdding] = useState(false);
  const [time, setTime] = useState("06:40");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  if (!car.climate) return null;
  const climate = car.climate;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Värmestart</h2>
        <button
          className={`btn ${climate.on ? "selected" : "primary"}`}
          onClick={() =>
            climate.on
              ? actions.run("Värme", () => api.run(climate.entityId, climate.entityId.startsWith("button.") ? "press" : "off"))
              : actions.confirm(`Starta värmen i ${car.name}?`, "Värme", () => api.run(climate.entityId, climate.entityId.startsWith("button.") ? "press" : "on"))
          }
        >
          <Icon name="sun" size={20} />
          {climate.on ? "Stäng av värmen" : "Starta värme nu"}
        </button>
      </div>
      {car.schedules.length === 0 && !adding && <p className="muted">Inget schema. Lägg till t.ex. vardagar 06:40.</p>}
      {car.schedules.map((s) => (
        <div className="item-row" key={s.id}>
          <label className="switch" aria-label={`Schema ${s.time} på/av`}>
            <input
              type="checkbox"
              checked={s.enabled}
              onChange={(e) => actions.run("Schema", () => api.saveSchedule({ ...s, entityId: climate.entityId, action: "on", enabled: e.target.checked }))}
            />
            <span />
          </label>
          <b className="tabular" style={{ fontSize: 22 }}>
            {s.time}
          </b>
          <span className="grow muted">{s.days.length === 7 ? "Alla dagar" : s.days.map((d) => DAYS[d - 1]).join(" ")}</span>
          <button className="btn small ghost" aria-label="Ta bort schema" onClick={() => actions.run("Schema", () => api.deleteSchedule(s.id))}>
            <Icon name="x" size={18} />
          </button>
        </div>
      ))}
      {adding ? (
        <div className="stack">
          <div className="row gap wrap">
            {DAYS.map((d, i) => (
              <button
                key={d}
                className={`btn small ${days.includes(i + 1) ? "selected" : ""}`}
                aria-pressed={days.includes(i + 1)}
                onClick={() => setDays((x) => (x.includes(i + 1) ? x.filter((y) => y !== i + 1) : [...x, i + 1].sort()))}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="row gap">
            <label className="field grow">
              <span>Starta kl.</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
            <button
              className="btn primary"
              style={{ alignSelf: "flex-end" }}
              disabled={!days.length}
              onClick={() => {
                setAdding(false);
                actions.run("Schema", () =>
                  api.saveSchedule({
                    id: `s${Date.now().toString(36)}`,
                    name: `${car.name} värme`,
                    entityId: climate.entityId,
                    action: climate.entityId.startsWith("button.") ? "press" : "on",
                    days,
                    time,
                    enabled: true,
                  }),
                );
              }}
            >
              Spara
            </button>
          </div>
        </div>
      ) : (
        <button className="btn" onClick={() => setAdding(true)}>
          <Icon name="plus" size={20} /> Lägg till tid
        </button>
      )}
    </section>
  );
}

function CarDetailsSheet({ index, onClose, actions }: { index: number; onClose: () => void; actions: Actions }) {
  const [data, setData] = useState<CarDetails | null>(null);
  const [error, setError] = useState("");
  const [group, setGroup] = useState("Batteri & laddning");
  const load = () =>
    api
      .car(index)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    load();
  }, [index]);
  const groups = useMemo(() => [...new Set(data?.rows.map((r) => r.group) ?? [])], [data]);
  const rows = data?.rows.filter((r) => r.group === group) ?? [];
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Alla data" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2 style={{ fontSize: 24 }}>{data?.name ?? "Bil"} – alla data</h2>
          <button className="btn icon" aria-label="Stäng" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
        {!data && !error && <p className="muted">Hämtar…</p>}
        {data && (
          <>
            <p className="muted">
              {data.valid} av {data.total} entiteter har giltigt värde. ✓ = färskt, ⚠ = otillgänglig eller gammal.
            </p>
            {data.actions.length > 0 && (
              <div className="grid-2" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                {data.actions.map((a) => (
                  <button
                    key={a.entityId}
                    className={`btn ${a.domain !== "button" && (a.state === "on" || a.state === "locked") ? "selected" : ""}`}
                    onClick={() =>
                      actions.confirm(`${a.name} – ${data.name}?`, a.name, async () => {
                        const action = a.domain === "button" ? "press" : a.state === "on" || a.state === "locked" ? "off" : "on";
                        await api.carAction(index, a.entityId, action);
                        await load();
                      })
                    }
                  >
                    {a.name}
                    {a.domain !== "button" && <span className="muted">· {a.state}</span>}
                  </button>
                ))}
              </div>
            )}
            <div className="row gap wrap" style={{ justifyContent: "center" }}>
              {groups.map((g) => (
                <button key={g} className={`btn small ${g === group ? "selected" : ""}`} onClick={() => setGroup(g)}>
                  {g}
                </button>
              ))}
            </div>
            <div className="stack" style={{ gap: 0 }}>
              {rows.map((r) => (
                <div key={r.entityId} className="row gap" style={{ padding: "12px 0", borderBottom: "1px solid var(--card-border)" }}>
                  <span aria-hidden="true">{r.ok ? "✓" : "⚠"}</span>
                  <span className="grow">{r.name}</span>
                  <span style={{ color: r.ok ? "var(--muted)" : "var(--amber)", textAlign: "right" }}>
                    {r.value}
                    {r.note ? ` · ${r.note}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

type Smart = NonNullable<Dashboard["cars"][number]["smart"]>;

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
const dayName = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "idag";
  if (same(d, new Date(today.getTime() + 86_400_000))) return "imorgon";
  return d.toLocaleDateString("sv-SE", { weekday: "short" });
};

/** Laddplanen för de kommande 24 timmarna som ett band, med blocken listade under. */
function PlanBar({ slots }: { slots: Smart["slots"] }) {
  const t0 = Date.now();
  const lastEnd = Math.max(0, ...slots.map((s) => Date.parse(s.end)));
  const span = Math.min(48, Math.max(24, Math.ceil((lastEnd - t0) / 3_600_000 / 6) * 6)) * 3_600_000;   // 24 h, men längre (högst 48 h) så att hela planen syns
  const t1 = t0 + span;
  const shown = slots.filter((s) => Date.parse(s.end) > t0 && Date.parse(s.start) < t1);
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - t0) / (t1 - t0)) * 100));
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div style={{ position: "relative", height: 22, borderRadius: 11, background: "rgba(120,130,150,0.22)", overflow: "hidden" }} aria-label="Planerad laddning">
        {shown.map((s) => (
          <div key={s.start} title={`${hhmm(s.start)}–${hhmm(s.end)}`} style={{ position: "absolute", top: 0, bottom: 0, left: `${pct(Date.parse(s.start))}%`, width: `${Math.max(1.2, pct(Date.parse(s.end)) - pct(Date.parse(s.start)))}%`, background: "var(--green, #04ce78)" }} />
        ))}
      </div>
      <div className="row" style={{ justifyContent: "space-between", fontSize: 12 }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <span key={f} className="muted">{f === 0 ? "nu" : hhmm(new Date(t0 + f * span).toISOString())}</span>
        ))}
      </div>
    </div>
  );
}

const SMART_DAYS = ["Mån", "Tis", "Ons", "Tors", "Fre", "Lör", "Sön"];

/** Veckoschemat ("klar kl T med mål %") som smartstyrningen följer. En ändring här sparas hos smartstyrningen och slår igenom i dess egen app. */
function SmartScheduleEditor({ index, s, actions }: { index: number; s: Smart; actions: Actions }) {
  const [rows, setRows] = useState(s.schedule ?? []);
  useEffect(() => setRows(s.schedule ?? []), [JSON.stringify(s.schedule)]);
  const editable = Boolean(s.scheduleEntity);
  const save = (day: number, patch: Partial<NonNullable<Smart["schedule"]>[number]>) => {
    const next = rows.map((r) => (r.day === day ? { ...r, ...patch } : r));
    setRows(next);
    const r = next.find((x) => x.day === day)!;
    actions.run(`Laddschema ${SMART_DAYS[day]}`, () => api.carSchedule(index, r), { done: `Laddschema ${SMART_DAYS[day]} sparat`, check: (d) => { const x = d.cars[index]?.smart?.schedule?.find((y) => y.day === day); return !!x && x.time === r.time && x.soc === r.soc && x.enabled === r.enabled; }, slow: "Skickat – smartstyrningen sparar det inom några sekunder." });
  };
  if (rows.length === 0) return null;
  return (
    <details>
      <summary className="muted" style={{ cursor: "pointer", fontWeight: 600 }}>
        Laddschema (klar kl) {editable ? "" : "· bara läsning"}
      </summary>
      <div className="stack" style={{ gap: 0, marginTop: 6 }}>
        {rows.map((r) => (
          <div key={r.day} className="row gap" style={{ padding: "6px 0", borderBottom: "1px solid var(--card-border)", alignItems: "center" }}>
            <b style={{ width: 38 }}>{SMART_DAYS[r.day]}</b>
            <button className={`btn small ${r.enabled ? "selected" : ""}`} aria-pressed={r.enabled} disabled={!editable} onClick={() => save(r.day, { enabled: !r.enabled })}>
              {r.enabled ? "På" : "Av"}
            </button>
            <input type="time" value={r.time} disabled={!editable || !r.enabled} onChange={(e) => e.target.value && save(r.day, { time: e.target.value })} style={{ minWidth: 0 }} aria-label={`${SMART_DAYS[r.day]} klar kl`} />
            <select value={r.soc} disabled={!editable || !r.enabled} onChange={(e) => save(r.day, { soc: Number(e.target.value) })} aria-label={`${SMART_DAYS[r.day]} mål`}>
              {Array.from(new Set([...[20, 30, 40, 50, 60, 70, 80, 90, 100], r.soc])).sort((a, b) => a - b).map((v) => (
                <option key={v} value={v}>
                  {v} %
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </details>
  );
}

/** Smartstyrd laddning: planen och laddläget (Auto / Ladda nu / Pausa) från bilens smartstyrning i Home Assistant. Laddknappen ger samma överstyrning som smartstyrningens egen app. */
function SmartChargingCard({ index, car, actions }: { index: number; car: Dashboard["cars"][number]; actions: Actions }) {
  const s = car.smart;
  if (!s) return null;
  const upcoming = s.slots.filter((x) => Date.parse(x.end) > Date.now()).slice(0, 10);
  const maxKwh = Math.max(0.1, ...upcoming.map((x) => ((x.kw ?? 0) * (Date.parse(x.end) - Date.parse(x.start))) / 3_600_000));
  const now = s.nowOption && s.mode === s.nowOption;
  const choose = (option: string, label: string) =>
    actions.run(label, () => api.carMode(index, option), { done: `${label}: klart`, check: (d) => d.cars[index]?.smart?.mode === option, slow: "Skickat – smartstyrningen kan ta en halv minut på sig." });
  const big = now ? s.pauseOption ?? s.autoOption : s.nowOption;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Laddplan</h2>
        <span className={`chip ${car.charging ? "good" : ""}`}>{s.state || (car.charging ? "Laddar" : "Ingen plan")}</span>
      </div>
      {s.modeEntity && big && (
        <button className={`big-btn ${now ? "" : "amber"}`} onClick={() => choose(big, now ? "Stoppa laddning" : "Starta laddning")}>
          {now ? "Stoppa laddning" : "Starta laddning"}
        </button>
      )}
      {s.modeEntity && s.options.length > 0 && (
        <div className="grid-2" style={{ gridTemplateColumns: `repeat(${Math.min(s.options.length, 3)}, minmax(0, 1fr))` }}>
          {s.options.map((o) => (
            <button key={o} className={`btn ${o === s.mode ? "selected" : ""}`} aria-pressed={o === s.mode} onClick={() => o !== s.mode && choose(o, o)}>
              {o}
            </button>
          ))}
        </div>
      )}
      <PlanBar slots={s.slots} />
      {upcoming.length > 0 ? (
        <div className="stack" style={{ gap: 0 }}>
          {upcoming.map((x, i) => {
            const kwh = ((x.kw ?? 0) * (Date.parse(x.end) - Date.parse(x.start))) / 3_600_000;
            const showDay = i === 0 || dayName(x.start) !== dayName(upcoming[i - 1].start);
            return (
              <div key={x.start} className="plan-row">
                <span className="plan-time">
                  <b>{hhmm(x.start)}–{hhmm(x.end)}</b>
                  <small className="muted">{showDay ? dayName(x.start) : "\u00a0"}</small>
                </span>
                <span className="plan-bar" aria-hidden="true"><i style={{ width: `${Math.max(6, Math.round((kwh / maxKwh) * 100))}%` }} /></span>
                <span className="plan-num">
                  <b>{x.socStart !== undefined ? `${x.socStart} → ${x.socEnd} %` : kwh > 0 ? `${kwh.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} kWh` : ""}</b>
                  <small className="muted">{x.kw !== null ? `${x.kw.toLocaleString("sv-SE")} kW` : ""}</small>
                </span>
              </div>
            );
          })}
          {s.morning && (
            <p className={`plan-floor ${s.morning.ok ? "ok" : "warn"}`}>
              {s.morning.ok ? "✓" : "⚠"} {s.morning.soc} % kl {s.morning.time}
              {s.morning.ok ? ` (golv ${s.morning.min} %)` : ` – under golvet ${s.morning.min} %`}
            </p>
          )}
          <p className="muted" style={{ marginTop: 8 }}>
            {s.plannedKwh !== null ? `${s.plannedKwh.toLocaleString("sv-SE")} kWh planerat` : ""}
            {s.socAfter !== null ? ` · ${s.socAfter} % efter planen` : ""}
            {s.source ? ` · ${s.source}` : ""}
          </p>
        </div>
      ) : (
        <p className="muted">Ingen laddning planerad just nu.</p>
      )}
      <SmartScheduleEditor index={index} s={s} actions={actions} />
    </section>
  );
}

/** Start/stop charging and the car's own charge schedule, read from its Home Assistant integration. */
function ChargingCard({ index, charging, actions }: { index: number; charging: boolean; actions: Actions }) {
  const [c, setC] = useState<CarDetails["charging"] | null>(null);
  const load = () =>
    api
      .car(index)
      .then((d) => setC(d.charging ?? null))
      .catch(() => setC(null));
  useEffect(() => {
    setC(null);
    load();
  }, [index]);
  if (!c || (!c.switch && !c.start && !c.stop && c.schedule.length === 0)) return null;
  const on = c.switch ? c.switch.on : charging;
  const target = on ? (c.switch ?? c.stop) : (c.switch ?? c.start);
  const toggle = () => {
    if (!target) return;
    const action = target.entityId.startsWith("button.") ? "press" : on ? "off" : "on";
    actions.confirm(on ? "Stoppa laddningen?" : "Starta laddningen?", on ? "Stoppa" : "Starta", () =>
      actions.run(
        on ? "Stoppa laddning" : "Starta laddning",
        async () => {
          await api.carAction(index, target.entityId, action);
          await load();
        },
        {
          done: on ? "Laddningen stoppad" : "Laddningen startad",
          check: (d) => Boolean(d.cars[index]?.charging) === !on,
          slow: "Skickat till bilen – den kan ta en minut att svara.",
        },
      ),
    );
  };
  return (
    <section className="card">
      <div className="card-head">
        <h2>Laddning</h2>
        <span className={`chip ${on ? "good" : ""}`}>{on ? "Laddar" : "Laddar inte"}</span>
      </div>
      {target && (
        <button className={`big-btn ${on ? "" : "amber"}`} onClick={toggle}>
          {on ? "Stoppa laddning" : "Starta laddning"}
        </button>
      )}
      {!target && <p className="muted">Bilen går inte att starta härifrån – integrationen saknar laddknapp.</p>}
      {c.schedule.length > 0 && (
        <div className="stack" style={{ gap: 0 }}>
          <h3 className="muted" style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Laddschema i bilen
          </h3>
          {c.schedule.map((r) => (
            <div key={r.entityId} className="row gap" style={{ padding: "10px 0", borderBottom: "1px solid var(--card-border)" }}>
              <span className="grow" style={{ minWidth: 0, overflowWrap: "anywhere" }}>{r.name}</span>
              <b style={{ textAlign: "right" }}>{r.value}</b>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function CarsPage({ data, actions }: { data: Dashboard; actions: Actions }) {
  const [sel, setSel] = useState(0);
  const [details, setDetails] = useState(false);
  const car = data.cars[Math.min(sel, data.cars.length - 1)];
  if (!car) return null;
  return (
    <main className="stack" style={{ gap: 18 }}>
      {data.cars.length > 1 && (
        <div className="grid-2" style={{ gridTemplateColumns: `repeat(${data.cars.length}, minmax(0, 1fr))` }}>
          {data.cars.map((c, i) => (
            <button key={c.name} className={`btn ${i === sel ? "selected" : ""}`} onClick={() => setSel(i)}>
              {c.name} · {c.battery ?? "–"} %
            </button>
          ))}
        </div>
      )}
      <div className="page-grid">
        <section className="card strong" style={{ alignItems: "center" }}>
          <div className="row gap">
            <span className="muted">{car.name}</span>
            <button className="btn small ghost" style={{ color: "var(--blue)" }} onClick={() => setDetails(true)}>
              Alla data
            </button>
          </div>
          <div className="car-ring">
            <Ring progress={(car.battery ?? 0) / 100} size={170} stroke={12}>
              <b style={{ fontSize: 48, fontWeight: 800, lineHeight: 1 }}>
                {car.battery ?? "–"}
                <small style={{ fontSize: 18 }}>%</small>
              </b>
              <small className="muted">batteri</small>
            </Ring>
          </div>
          <div className="chips">
            {car.home !== null && <span className="chip">{car.home ? "Hemma" : "Borta"}</span>}
            {car.rangeKm !== null && <span className="chip">Räckvidd {Math.round(car.rangeKm)} km</span>}
            {car.charging && <span className="chip good">Laddar</span>}
            {car.ageHours !== null && car.ageHours >= 3 && <span className="chip warn">Data {car.ageHours} h gammal</span>}
          </div>
        </section>
        {car.smart ? <SmartChargingCard index={data.cars.indexOf(car)} car={car} actions={actions} /> : <ChargingCard index={data.cars.indexOf(car)} charging={Boolean(car.charging)} actions={actions} />}
        <ScheduleEditor car={car} actions={actions} />
        {data.prices && <PriceCard prices={data.prices} />}
      </div>
      {details && <CarDetailsSheet index={data.cars.indexOf(car)} onClose={() => setDetails(false)} actions={actions} />}
    </main>
  );
}

// ---------- Lights ----------

/** One lamp: tap to switch, slide to dim (only lamps Home Assistant says can be dimmed). */
function LampRow({ lamp, actions }: { lamp: Lamp; actions: Actions }) {
  const [pct, setPct] = useState(lamp.brightness ?? 100);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging && lamp.brightness) setPct(lamp.brightness);
  }, [lamp.brightness, dragging]);
  const find = (d: Dashboard) => [...d.lights, ...d.lightGroups.flatMap((g) => g.lamps)].find((l) => l.entityId === lamp.entityId);
  const send = (v: number) => {
    setDragging(false);
    actions.run(lamp.name, () => api.brightness(lamp.entityId, v), {
      done: v ? `${lamp.name} ${v}%` : `${lamp.name} släckt`,
      check: (d) => (v ? Boolean(find(d)?.on) : !find(d)?.on),
    });
  };
  return (
    <div className={`lamp-row ${lamp.on ? "on" : ""} ${lamp.offline ? "offline" : ""}`}>
      <button
        className={`light-btn ${lamp.on ? "on" : ""}`}
        aria-pressed={lamp.on}
        disabled={lamp.offline}
        onClick={() =>
          actions.run(lamp.name, () => api.toggleLight(lamp.entityId), {
            done: `${lamp.name} ${lamp.on ? "släckt" : "tänd"}`,
            check: (d) => find(d)?.on === !lamp.on,
          })
        }
      >
        <Icon name="bulb" size={20} />
        <span className="lamp-name">{lamp.name}</span>
        {lamp.offline && <small className="muted">offline</small>}
      </button>
      {lamp.dimmable && !lamp.offline && (
        <label className="lamp-dim">
          <span className="sr-only">Ljusstyrka {lamp.name}</span>
          <input
            type="range"
            min={1}
            max={100}
            value={lamp.on ? pct : 0}
            onChange={(e) => {
              setDragging(true);
              setPct(Number(e.target.value));
            }}
            onPointerUp={(e) => send(Number((e.target as HTMLInputElement).value))}
            onKeyUp={(e) => send(Number((e.target as HTMLInputElement).value))}
            style={{ ["--fill" as string]: `${lamp.on ? pct : 0}%` }}
          />
          <span className="lamp-pct">{lamp.on ? `${pct}%` : "Av"}</span>
        </label>
      )}
    </div>
  );
}

export function LightsPage({ data, actions }: { data: Dashboard; actions: Actions }) {
  return (
    <main className="page-grid">
      {data.buttons.length > 0 && (
        <section className="card">
          <h2>Snabbval</h2>
          <div className="big-buttons">
            {data.buttons.map((b) => (
              <button key={b.entityId} className={`big-btn wide ${b.style}`} onClick={() => actions.run(b.name, () => api.button(b.entityId))}>
                {b.name}
              </button>
            ))}
          </div>
        </section>
      )}
      {data.lightGroups.map((g) => (
        <section className="card" key={g.index}>
          <h2>{g.name}</h2>
          <p className="muted">
            {g.on} av {g.total} tända{g.offline.length ? ` · offline: ${g.offline.join(", ")}` : ""}
          </p>
          <div className="big-buttons">
            <button
              className="big-btn amber"
              onClick={() =>
                actions.run(g.name, () => api.lightGroup(g.index, true), {
                  done: `${g.name}: alla tända`,
                  check: (d) => {
                    const x = d.lightGroups.find((y) => y.index === g.index);
                    return Boolean(x && x.on >= x.total - x.offline.length);
                  },
                })
              }
            >
              Tänd alla
            </button>
            <button
              className="big-btn"
              onClick={() =>
                actions.run(g.name, () => api.lightGroup(g.index, false), {
                  done: `${g.name}: alla släckta`,
                  check: (d) => d.lightGroups.find((y) => y.index === g.index)?.on === 0,
                })
              }
            >
              Släck alla
            </button>
          </div>
          {g.lamps.length > 1 && (
            <div className="lamp-list">
              {g.lamps.map((l) => (
                <LampRow key={l.entityId} lamp={l} actions={actions} />
              ))}
            </div>
          )}
          {g.lamps.length === 1 && g.lamps[0].dimmable && <LampRow lamp={g.lamps[0]} actions={actions} />}
        </section>
      ))}
      {data.lights.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Lampor</h2>
            <button className="btn small" onClick={() => actions.run("Släck allt", () => api.lightsOff(), { done: "Allt släckt", check: (d) => d.lights.every((l) => !l.on || l.offline) })}>
              Släck allt
            </button>
          </div>
          <div className="lamp-list">
            {data.lights.map((l) => (
              <LampRow key={l.entityId} lamp={l} actions={actions} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

// ---------- House ----------

export function HousePage({ data, actions }: { data: Dashboard; actions: Actions }) {
  return (
    <main className="page-grid">
      {(data.smartModes ?? []).length > 0 && (
        <section className="card strong">
          <span className="muted" style={{ fontWeight: 600 }}>
            Smart styrning
          </span>
          {data.smartModes.map((m) => (
            <div key={m.entityId} className="stack" style={{ gap: 6 }}>
              <span>{m.name}</span>
              <div className="row gap wrap">
                {m.options.map((o) => (
                  <button
                    key={o}
                    className={`btn small ${m.mode === o ? "selected" : ""}`}
                    aria-pressed={m.mode === o}
                    title={/^auto/i.test(o) ? "Följer sitt eget schema, som Home Assistant styr" : undefined}
                    onClick={() => m.mode !== o && actions.run(`${m.name}: ${o}`, () => api.control(m.entityId, "select", o), { done: `${m.name}: ${o}`, check: (d) => d.smartModes?.find((x) => x.entityId === m.entityId)?.mode === o })}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
      {data.climates.map((c) => (
        <section className="card strong" key={c.entityId}>
          <span className="muted" style={{ fontWeight: 600 }}>
            {c.name}
          </span>
          <span className="big-num" style={{ fontSize: 44 }}>
            {fmtNum(c.current ?? c.target)}
            <small>°C</small>
          </span>
          <div className="row gap">
            <span className="muted grow">
              {c.target !== null && `Mål ${fmtNum(c.target)}°`}
              {c.action ? ` · ${c.action}` : ""}
            </span>
            {c.target !== null && (
              <>
                <button className="btn small" aria-label="Sänk mål" onClick={() => actions.run(c.name, () => api.climateTarget(c.entityId, (c.target ?? 0) - 0.5))}>
                  −
                </button>
                <button className="btn small" aria-label="Höj mål" onClick={() => actions.run(c.name, () => api.climateTarget(c.entityId, (c.target ?? 0) + 0.5))}>
                  +
                </button>
              </>
            )}
          </div>
          {c.modes.length > 0 && (
            <div className="row gap wrap">
              {c.modes.map((m) => (
                <button
                  key={m.value}
                  className={`btn small ${c.active === m.value ? "selected" : ""}`}
                  aria-pressed={c.active === m.value}
                  onClick={() => actions.confirm(`Byt ${c.name} till ${m.label}?`, c.name, () => api.climateMode(c.entityId, m.field, m.value))}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
          {c.controls.length > 0 && (
            <div className="grid-2" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              {c.controls.map((ctl) => (
                <ControlView key={ctl.entityId} c={ctl} actions={actions} />
              ))}
            </div>
          )}
        </section>
      ))}
      {data.deviceCards.map((d) => (
        <section className="card strong" key={d.index}>
          <span className="muted" style={{ fontWeight: 600 }}>
            {d.title}
          </span>
          {d.primary && (
            <div>
              <span className="big-num" style={{ fontSize: 44 }}>
                {d.primary.value}
              </span>
              <div className="muted">{d.primary.name}</div>
            </div>
          )}
          {d.rows.length > 0 && (
            <div className="stack" style={{ gap: 0 }}>
              {d.rows.map((r) => (
                <div key={r.name} className="row gap" style={{ padding: "8px 0", borderBottom: "1px solid var(--card-border)" }}>
                  <span className="grow muted">{r.name}</span>
                  <b style={{ color: r.ok ? undefined : "var(--amber)" }}>{r.value}</b>
                </div>
              ))}
            </div>
          )}
          {d.controls.length > 0 && (
            <div className="stack">
              {d.controls.map((ctl) => (
                <ControlView key={ctl.entityId} c={ctl} actions={actions} />
              ))}
            </div>
          )}
        </section>
      ))}
      {data.temps.length > 0 && (
        <section className="card">
          <h2>Temperaturer</h2>
          <div className="stats">
            {data.temps.map((t) => (
              <div key={t.name}>
                <small>{t.name}</small>
                <b>{t.value}</b>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

// ---------- Energy ----------

export function EnergyPage({ data }: { data: Dashboard }) {
  const e = data.energy;
  const kw = (n?: number) => `${fmtNum(n ?? 0)} kW`;
  return (
    <main className="page-grid">
      {e && (e.solarKw !== undefined || e.gridKw !== undefined) && <PowerFlow e={e} price={data.prices?.now} spot={data.prices?.kind === "spot"} />}
      {(e?.houseKw !== undefined || e?.batteryPct !== undefined) && (
        <section className="card">
          <div className="stats" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            {e?.houseKw !== undefined && (
              <div>
                <small>Huset nu</small>
                <b className="big-num">{kw(e.houseKw)}</b>
              </div>
            )}
            {e?.houseKw && e.selfUseKw !== undefined ? (
              <div>
                <small>Solen täcker</small>
                <b className="big-num">{Math.round(Math.min(100, (e.selfUseKw / e.houseKw) * 100))} %</b>
              </div>
            ) : null}
            {e?.batteryPct !== undefined && (
              <div>
                <small>Hembatteri</small>
                <b className="big-num">{Math.round(e.batteryPct)} %</b>
              </div>
            )}
          </div>
        </section>
      )}
      {e?.today && (
        <section className="card">
          <h2>Idag</h2>
          <div className="stats" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            {e.today.houseKwh !== undefined && (
              <div>
                <small>Förbrukat</small>
                <b>{fmtNum(e.today.houseKwh)} kWh</b>
              </div>
            )}
            {e.today.solarKwh !== undefined && (
              <div>
                <small>Solel</small>
                <b>{fmtNum(e.today.solarKwh)} kWh</b>
              </div>
            )}
            {e.today.importKwh !== undefined && (
              <div>
                <small>Köpt</small>
                <b>{fmtNum(e.today.importKwh)} kWh</b>
              </div>
            )}
            {e.today.exportKwh !== undefined && (
              <div>
                <small>Sålt</small>
                <b>{fmtNum(e.today.exportKwh)} kWh</b>
              </div>
            )}
            {e.today.selfUseKwh !== undefined && (
              <div>
                <small>Egen solel</small>
                <b>{fmtNum(e.today.selfUseKwh)} kWh</b>
              </div>
            )}
            {e.today.selfSufficiencyPct !== undefined && (
              <div>
                <small>Självförsörjning</small>
                <b>{e.today.selfSufficiencyPct} %</b>
              </div>
            )}
            {e.today.costKr !== undefined && (
              <div>
                <small>Köpt el kostat</small>
                <b>{e.today.costKr} kr</b>
              </div>
            )}
          </div>
        </section>
      )}
      {data.prices && <PriceCard prices={data.prices} />}
    </main>
  );
}

/**
 * "Just nu": sun, grid and house with the power moving between them. The dots run faster and the
 * lines get thicker the more power flows; it follows Home Assistant live (about once a second).
 */
function PowerFlow({ e, price, spot }: { e: NonNullable<Dashboard["energy"]>; price?: number; spot?: boolean }) {
  const kw = (n: number) => `${fmtNum(n, n < 1 ? 2 : 1)} kW`;
  const solar = Math.max(0, e.solarKw ?? 0);
  const grid = e.gridKw ?? 0;
  const buy = Math.max(0, grid);
  const sell = Math.max(0, -grid);
  const toHouse = e.selfUseKw ?? Math.max(0, solar - sell);
  const house = e.houseKw ?? toHouse + buy;
  const hasSun = e.solarKw !== undefined;
  const hasGrid = e.gridKw !== undefined;
  const flows = [
    { id: "sun-house", on: hasSun && toHouse > 0.005, kw: toHouse, d: "M200 74 C200 130 270 150 318 176", cls: "sun" },
    { id: "sun-grid", on: hasSun && sell > 0.005, kw: sell, d: "M200 74 C200 130 130 150 82 176", cls: "sell" },
    { id: "grid-house", on: hasGrid && buy > 0.005, kw: buy, d: "M100 200 L300 200", cls: "buy" },
  ];
  // Faster and thicker with more power, within what still reads well.
  const style = (k: number) =>
    ({ strokeWidth: Math.min(11, 5 + k * 1.2), animationDuration: `${Math.max(0.35, 1.6 / (0.4 + k)).toFixed(2)}s` }) as React.CSSProperties;
  return (
    <section className="card strong power-flow">
      <div className="pf-head">
        <span className="muted" style={{ fontWeight: 600 }}>
          Just nu
        </span>
        <span className="pf-live">
          <i /> Live
        </span>
      </div>
      <svg viewBox="0 0 400 262" role="img" aria-label={`Sol ${kw(solar)}, ${grid >= 0 ? "köper" : "säljer"} ${kw(Math.abs(grid))}, huset ${kw(house)}`}>
        <defs>
          {["sun", "sell", "buy"].map((c) => (
            <marker key={c} id={`pf-arrow-${c}`} className={`pf-${c}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto">
              <path d="M0 0 L10 5 L0 10 z" />
            </marker>
          ))}
        </defs>
        {hasSun && <path className="pf-track" d="M200 74 C200 130 270 150 318 176" />}
        {hasSun && hasGrid && <path className="pf-track" d="M200 74 C200 130 130 150 82 176" />}
        {hasGrid && <path className="pf-track" d="M100 200 L300 200" />}
        {flows
          .filter((f) => f.on)
          .map((f) => (
            <path key={f.id} className={`pf-line pf-${f.cls}`} d={f.d} style={style(f.kw)} markerEnd={`url(#pf-arrow-${f.cls})`} />
          ))}
        {hasSun && (
          <g className={`pf-node pf-sun ${solar > 0.005 ? "" : "idle"}`}>
            <circle cx="200" cy="44" r="30" />
            <g transform="translate(182 26) scale(1.5)">
              <path d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" />
              <path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
            </g>
            <text x="250" y="40" className="pf-label">Sol</text>
            <text x="250" y="62" className="pf-value">{kw(solar)}</text>
          </g>
        )}
        {hasGrid && (
          <g className={`pf-node ${grid >= 0 ? "pf-buy" : "pf-sell"}`}>
            <circle cx="60" cy="200" r="30" />
            <g transform="translate(42 182) scale(1.5)">
              <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
            </g>
            <text x="60" y="250" textAnchor="middle" className="pf-label">
              {grid >= 0 ? "Köper" : "Säljer"} {kw(Math.abs(grid))}
            </text>
          </g>
        )}
        <g className="pf-node pf-house">
          <circle cx="340" cy="200" r="30" />
          <g transform="translate(322 182) scale(1.5)">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M9 22V12h6v10" />
          </g>
          <text x="340" y="250" textAnchor="middle" className="pf-label">
            Huset {kw(house)}
          </text>
        </g>
      </svg>
      {buy > 0.005 && price !== undefined ? (
        <p className="pf-cost">
          Kostar nu <b>{fmtNum(buy * price, 2)} kr/tim</b>
          <span className="muted">
            {" "}
            · {fmtNum(price, 2)} kr/kWh{spot ? " spot" : ""}
          </span>
        </p>
      ) : hasSun && solar > 0.005 && hasGrid ? (
        <p className="pf-cost">
          <b>Gratis just nu</b> <span className="muted">– solen räcker till huset</span>
        </p>
      ) : null}
    </section>
  );
}

// ---------- Graphs ----------

/** Jämna skalvärden (…, 20, 25, 30 …) i stället för 14,6 och 2666,7. */
function niceTicks(lo: number, hi: number, count: number): number[] {
  const range = hi - lo || Math.abs(hi) || 1;
  const rough = range / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= rough) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/** Mjuk kurva (horisontella tangenter: ingen översvängning), i segment när det saknas värden. */
function smoothPath(pts: ({ x: number; y: number } | null)[]): { line: string; area: string } {
  let line = "";
  let area = "";
  let run: { x: number; y: number }[] = [];
  const flush = (bottom: number) => {
    if (run.length < 2) {
      run = [];
      return;
    }
    let d = `M${run[0]!.x.toFixed(1)},${run[0]!.y.toFixed(1)}`;
    for (let i = 1; i < run.length; i++) {
      const p0 = run[i - 1]!;
      const p1 = run[i]!;
      const mx = (p0.x + p1.x) / 2;
      d += ` C${mx.toFixed(1)},${p0.y.toFixed(1)} ${mx.toFixed(1)},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
    }
    line += (line ? " " : "") + d;
    area += `${area ? " " : ""}${d} L${run[run.length - 1]!.x.toFixed(1)},${bottom} L${run[0]!.x.toFixed(1)},${bottom} Z`;
    run = [];
  };
  for (const p of pts) {
    if (p) run.push(p);
    else flush(180);
  }
  flush(180);
  return { line, area };
}

function LineChart({ data }: { data: GraphData }) {
  const W = 600;
  const H = 180;
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const all = data.series.flatMap((s) => s.points.filter((p): p is number => p !== null));
  if (!all.length) return <p className="muted">Ingen historik ännu.</p>;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo || 1) * 0.08;
  const min = lo - pad;
  const max = hi + pad;
  const span = max - min || 1;
  const n = Math.max(...data.series.map((s) => s.points.length));
  const x = (i: number) => (i / Math.max(1, n - 1)) * W;
  const y = (v: number) => H - 6 - ((v - min) / span) * (H - 12);
  const time = (iso: string) => new Date(iso).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  const stamp = (i: number) => {
    const t0 = new Date(data.from).getTime();
    const t1 = new Date(data.to).getTime();
    return time(new Date(t0 + ((t1 - t0) * i) / Math.max(1, n - 1)).toISOString());
  };
  const ticks = niceTicks(lo, hi, 4).filter((t) => t >= min && t <= max);
  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
  };
  return (
    <div className="chart">
      <div className="chart-plot" onPointerMove={at} onPointerDown={at} onPointerLeave={() => setHover(null)} onPointerCancel={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={data.title}>
          <defs>
            {data.series.map((s, i) => (
              <linearGradient key={s.name} id={`${id}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={s.color} stopOpacity="0.30" />
                <stop offset="1" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t, k) => (
            <line key={k} x1="0" x2={W} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity="0.1" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
          ))}
          {data.series.map((s, i) => {
            const { line, area } = smoothPath(s.points.map((p, j) => (p === null ? null : { x: x(j), y: y(p) })));
            return (
              <g key={s.name}>
                <path d={area} fill={`url(#${id}-${i})`} stroke="none" />
                <path d={line} fill="none" stroke={s.color} strokeWidth={2.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}
        </svg>
        {ticks.map((t, k) => (
          <span key={k} className="chart-y" style={{ top: `${(y(t) / H) * 100}%` }}>
            {fmtNum(t)}
          </span>
        ))}
        {/* Senaste värdet som punkt, och markören när man trycker eller drar */}
        {hover === null &&
          data.series.map((s) => {
            const last = s.points.length - 1;
            const v = s.points[last];
            return v === null || v === undefined ? null : <i key={s.name} className="chart-dot" style={{ left: `${(x(last) / W) * 100}%`, top: `${(y(v) / H) * 100}%`, background: s.color }} />;
          })}
        {hover !== null && (
          <>
            <i className="chart-cursor" style={{ left: `${(x(hover) / W) * 100}%` }} />
            {data.series.map((s) => {
              const v = s.points[hover];
              return v === null || v === undefined ? null : <i key={s.name} className="chart-dot on" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(v) / H) * 100}%`, background: s.color }} />;
            })}
            <div className="chart-tip" style={{ left: `${Math.min(78, Math.max(2, (x(hover) / W) * 100 - 10))}%` }}>
              <b>{stamp(hover)}</b>
              {data.series.map((s) => (
                <span key={s.name}>
                  <i style={{ background: s.color }} />
                  {s.name} {s.points[hover] === null || s.points[hover] === undefined ? "–" : fmtNum(s.points[hover] as number)}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="axis">
        <span>{time(data.from)}</span>
        <span>
          min {fmtNum(lo)} · max {fmtNum(hi)}
        </span>
        <span>{time(data.to)}</span>
      </div>
    </div>
  );
}

function GraphCard({ index }: { index: number }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .graph(index)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [index]);
  return (
    <section className="card">
      <div className="card-head">
        <h2>{data?.title ?? "Graf"}</h2>
      </div>
      {data && (
        <div className="graph-chips">
          {data.series.map((s) => {
            const last = [...s.points].reverse().find((p) => p !== null);
            return (
              <span key={s.name} className="graph-chip">
                <span className="dot" style={{ background: s.color }} />
                {s.name}
                <b className="tabular">{last === undefined ? "–" : fmtNum(last)}</b>
              </span>
            );
          })}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      {data && <LineChart data={data} />}
    </section>
  );
}

export function GraphsPage({ data }: { data: Dashboard }) {
  return (
    <main className="page-grid">
      {data.graphs.map((g) => (
        <GraphCard key={g.index} index={g.index} />
      ))}
      {data.prices && <PriceCard prices={data.prices} />}
    </main>
  );
}
