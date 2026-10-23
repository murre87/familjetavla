import { useEffect, useMemo, useState } from "react";
import type { CarCharging, ChargeRule, Control, Dashboard, Lamp } from "../../../server/src/types";
import { api, type CarDetails, type ControlOp, type GraphData } from "../api";
import { Icon } from "../Icon";
import type { Actions } from "./Dashboard";
import { Ring } from "./bits";
import { PriceCard } from "../widgets/prices";

const DAYS = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
const fmtNum = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? "–" : String(Math.round(n * 10 ** d) / 10 ** d).replace(".", ","));

// ---------- Generic control (switch / select / number / button) ----------

export function ControlView({ c, actions, send }: { c: Control; actions: Actions; send?: (op: ControlOp, value?: string | number) => Promise<unknown> }) {
  const call = send ?? ((op: ControlOp, value?: string | number) => api.control(c.entityId, op as "toggle" | "select" | "set" | "press", value));
  if (c.domain === "time" || c.domain === "input_datetime") {
    return (
      <label className="field">
        <span>{c.name}</span>
        <input
          type="time"
          defaultValue={c.state.slice(0, 5)}
          key={c.state}
          disabled={c.offline}
          onBlur={(e) => e.target.value && e.target.value !== c.state.slice(0, 5) && actions.run(c.name, () => call("time", e.target.value))}
        />
      </label>
    );
  }
  if (c.domain === "select" || c.domain === "input_select") {
    return (
      <label className="field">
        <span>{c.name}</span>
        <select value={c.state} disabled={c.offline} onChange={(e) => actions.run(c.name, () => call("select", e.target.value))}>
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
    const set = (n: number) => actions.run(c.name, () => call("set", Math.min(c.max ?? Infinity, Math.max(c.min ?? -Infinity, n))));
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
      <button className="btn" disabled={c.offline} onClick={() => actions.run(c.name, () => call("press"))}>
        {c.name}
      </button>
    );
  }
  return (
    <button
      className={`light-btn ${c.on ? "on" : ""} ${c.offline ? "offline" : ""}`}
      aria-pressed={c.on}
      disabled={c.offline}
      onClick={() => actions.run(c.name, () => call("toggle"))}
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

// ---------- Charging plan (own schedule in HA, chargers, existing automations) ----------

/** [1,2,3,4,5] → "Mån–Fre", [6,7] → "Lör Sön". */
function daysText(days: number[]): string {
  if (days.length === 7) return "Alla dagar";
  const d = [...days].sort((a, b) => a - b);
  const run = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  return run && d.length >= 3 ? `${DAYS[d[0] - 1]}–${DAYS[d[d.length - 1] - 1]}` : d.map((x) => DAYS[x - 1]).join(" ");
}
const nextText = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("sv-SE", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
const ruleText = (r: ChargeRule) => (r.from === r.to ? `Hela dygnet` : `${r.from}–${r.to}`);

function DayPicker({ days, onChange }: { days: number[]; onChange: (d: number[]) => void }) {
  return (
    <div className="row gap wrap">
      {DAYS.map((d, i) => (
        <button
          key={d}
          className={`btn small ${days.includes(i + 1) ? "selected" : ""}`}
          aria-pressed={days.includes(i + 1)}
          onClick={() => onChange(days.includes(i + 1) ? days.filter((y) => y !== i + 1) : [...days, i + 1].sort())}
        >
          {d}
        </button>
      ))}
    </div>
  );
}

function ChargePlanCard({ index, car, refreshKey, actions }: { index: number; car: Dashboard["cars"][number]; refreshKey: string; actions: Actions }) {
  const [info, setInfo] = useState<CarCharging | null>(null);
  const [error, setError] = useState("");
  const [rules, setRules] = useState<ChargeRule[] | null>(null);
  const [target, setTarget] = useState("");
  const [limit, setLimit] = useState("");
  const load = () =>
    api
      .chargePlan(index)
      .then((i) => {
        setInfo(i);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    load();
  }, [index, refreshKey]);
  const run = (label: string, fn: () => Promise<unknown>) =>
    actions.run(label, async () => {
      await fn();
      await load();
    });
  const send = (entityId: string) => (op: ControlOp, value?: string | number) => api.chargePlanSet(index, entityId, op, value).then(load);

  if (error || !info) {
    return (
      <section className="card">
        <div className="card-head">
          <h2>Laddschema</h2>
        </div>
        <p className="muted">{error || "Hämtar laddschema från Home Assistant…"}</p>
      </section>
    );
  }

  const own = info.own;
  const startEdit = () => {
    setRules(own?.rules.length ? own.rules : [{ days: [1, 2, 3, 4, 5], from: "22:00", to: "06:00" }]);
    setTarget(own?.target ?? info.targetOptions[0]?.entityId ?? "");
    setLimit(own?.limit !== undefined ? String(own.limit) : "");
  };
  // Nothing to show or create: the "Laddning" card already says what the car offers.
  if (!info.canCreate && !info.limit && !info.settings.length && !info.existing.length && !own) return null;

  return (
    <section className="card">
      <div className="card-head">
        <h2>Laddschema</h2>
      </div>
      {info.limit && <ControlView c={{ ...info.limit, name: "Laddgräns" }} actions={actions} send={send(info.limit.entityId)} />}

      {/* The board's own plan: a schedule helper + automation that live in HA */}
      {rules ? (
        <div className="stack">
          <b>Tider</b>
          {rules.map((r, i) => (
            <div className="stack" key={i} style={{ gap: 8, paddingBottom: 10, borderBottom: "1px solid var(--card-border)" }}>
              <DayPicker days={r.days} onChange={(days) => setRules(rules.map((x, j) => (j === i ? { ...x, days } : x)))} />
              <div className="row gap">
                <label className="field grow">
                  <span>Från</span>
                  <input type="time" value={r.from} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
                </label>
                <label className="field grow">
                  <span>Till</span>
                  <input type="time" value={r.to} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
                </label>
                {rules.length > 1 && (
                  <button className="btn small ghost" style={{ alignSelf: "flex-end" }} aria-label="Ta bort tid" onClick={() => setRules(rules.filter((_, j) => j !== i))}>
                    <Icon name="x" size={18} />
                  </button>
                )}
              </div>
            </div>
          ))}
          <button className="btn small" onClick={() => setRules([...rules, { days: [6, 7], from: "22:00", to: "06:00" }])}>
            <Icon name="plus" size={18} /> Lägg till tid
          </button>
          {info.targetOptions.length > 1 && (
            <label className="field">
              <span>Styr laddningen med</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                {info.targetOptions.map((t) => (
                  <option key={t.entityId} value={t.entityId}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {info.limit && (
            <label className="field">
              <span>Ladda till (%) när schemat startar</span>
              <input type="number" min={10} max={100} step={5} placeholder="Ändra inte" value={limit} onChange={(e) => setLimit(e.target.value)} />
            </label>
          )}
          <p className="muted">Schemat sparas i Home Assistant och fungerar även när tavlan är avstängd. Tider över midnatt går bra, t.ex. 22:00–06:00.</p>
          <div className="row gap">
            <button className="btn grow" onClick={() => setRules(null)}>
              Avbryt
            </button>
            <button
              className="btn primary grow"
              disabled={!target || rules.some((r) => !r.days.length || !r.from || !r.to)}
              onClick={() => {
                const plan = { rules, target, limit: limit ? Number(limit) : undefined };
                setRules(null);
                run("Laddschema", () => api.saveChargePlan(index, plan));
              }}
            >
              Spara
            </button>
          </div>
        </div>
      ) : own ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row gap">
            <b className="grow">Eget schema i Home Assistant</b>
            {own.automationEntity && (
              <label className="switch" aria-label="Laddschema på/av">
                <input type="checkbox" checked={own.enabled} onChange={() => run("Laddschema", () => api.chargePlanSet(index, own.automationEntity!, own.enabled ? "off" : "on"))} />
                <span />
              </label>
            )}
          </div>
          {own.rules.map((r, i) => (
            <div className="item-row" key={i}>
              <b className="tabular" style={{ fontSize: 20 }}>
                {ruleText(r)}
              </b>
              <span className="grow muted">{daysText(r.days)}</span>
            </div>
          ))}
          <div className="chips">
            {own.active && own.enabled && <span className="chip good">Laddfönster nu</span>}
            {!own.active && own.next && own.enabled && <span className="chip">Nästa: {nextText(own.next)}</span>}
            {own.limit !== undefined && <span className="chip">Till {own.limit} %</span>}
            {!own.enabled && <span className="chip warn">Avstängt</span>}
            {own.missingAutomation && <span className="chip warn">Automationen saknas – tryck Ändra och Spara</span>}
          </div>
          <div className="row gap">
            <button className="btn grow" onClick={startEdit}>
              Ändra
            </button>
            <button className="btn ghost" onClick={() => actions.confirm(`Ta bort laddschemat för ${car.name}?`, "Laddschema", async () => { await api.deleteChargePlan(index); await load(); })}>
              Ta bort
            </button>
          </div>
        </div>
      ) : (
        info.canCreate && (
          <button className="btn" onClick={startEdit}>
            <Icon name="plus" size={20} /> {info.existing.length || info.settings.length ? "Gör ett eget laddschema" : "Lägg till laddschema"}
          </button>
        )
      )}

      {/* What already exists in HA */}
      {(info.existing.length > 0 || info.settings.length > 0) && (
        <div className="stack" style={{ gap: 8 }}>
          <b>Finns i Home Assistant</b>
          {info.existing.map((e) => (
            <div className="item-row" key={e.entityId}>
              {e.domain === "automation" ? (
                <label className="switch" aria-label={`${e.name} på/av`}>
                  <input type="checkbox" checked={e.on} onChange={() => run(e.name, () => api.chargePlanSet(index, e.entityId, e.on ? "off" : "on"))} />
                  <span />
                </label>
              ) : (
                <span className={`chip ${e.on ? "good" : ""}`}>{e.on ? "På" : "Av"}</span>
              )}
              <span className="grow">{e.name}</span>
              <span className="muted">{e.domain === "automation" ? "Automation" : e.next ? `Nästa ${nextText(e.next)}` : "Schema"}</span>
            </div>
          ))}
          {info.settings.map((c) => (
            <ControlView key={c.entityId} c={c} actions={actions} send={send(c.entityId)} />
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
        <ChargingCard index={data.cars.indexOf(car)} charging={Boolean(car.charging)} actions={actions} />
        <ChargePlanCard index={data.cars.indexOf(car)} car={car} refreshKey={data.generatedAt} actions={actions} />
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

function LineChart({ data }: { data: GraphData }) {
  const W = 600;
  const H = 180;
  const all = data.series.flatMap((s) => s.points.filter((p): p is number => p !== null));
  if (!all.length) return <p className="muted">Ingen historik ännu.</p>;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const n = Math.max(...data.series.map((s) => s.points.length));
  const x = (i: number) => (i / Math.max(1, n - 1)) * W;
  const y = (v: number) => H - 8 - ((v - min) / span) * (H - 16);
  const path = (pts: (number | null)[]) =>
    pts
      .map((p, i) => (p === null ? null : `${i === 0 || pts[i - 1] === null ? "M" : "L"}${x(i).toFixed(1)},${y(p).toFixed(1)}`))
      .filter(Boolean)
      .join(" ");
  const time = (iso: string) => new Date(iso).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={data.title}>
        {data.series.map((s) => (
          <path key={s.name} d={path(s.points)} fill="none" stroke={s.color} strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        ))}
      </svg>
      <div className="axis">
        <span>{time(data.from)}</span>
        <span>
          min {fmtNum(min)} · max {fmtNum(max)}
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
        <span className="muted tabular">
          {data?.series
            .map((s) => {
              const last = [...s.points].reverse().find((p) => p !== null);
              return last === undefined ? "–" : fmtNum(last);
            })
            .join(" · ")}
        </span>
      </div>
      {data && (
        <div className="legend">
          {data.series.map((s) => (
            <span key={s.name}>
              <span className="dot" style={{ background: s.color, width: 16, height: 4 }} />
              {s.name}
            </span>
          ))}
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
