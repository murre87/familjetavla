import type { Dashboard } from "../../../server/src/types";
import { api } from "../api";
import { Icon } from "../Icon";
import type { Actions } from "../dashboard/Dashboard";
import type { WidgetModule } from "./types";

// ---------- Hemmet: the house at a glance – lights, locks and the machines in one small card ----------

const LOCK_LABEL: Record<string, string> = {
  locked: "Låst",
  unlocked: "Olåst",
  locking: "Låser …",
  unlocking: "Låser upp …",
  jammed: "Har fastnat",
  open: "Öppen",
  opening: "Öppnas …",
  unknown: "Okänt",
};

const machinesOf = (data: Dashboard) => (data.appliances ?? []).filter((m) => m.phase !== "offline");
const locksOf = (data: Dashboard) => data.security?.locks ?? [];

function HomeStatus({ data, actions }: { data: Dashboard; actions: Actions }) {
  const lights = data.lights.filter((l) => !l.offline);
  const lit = lights.filter((l) => l.on).length;
  const locks = locksOf(data);
  const machines = machinesOf(data);
  return (
    <section className="card">
      <h2>Hemmet</h2>
      <div className="stack" style={{ gap: 10 }}>
        {lights.length > 0 && (
          <div className="sec-row">
            <Icon name="bulb" size={22} />
            <span className="sec-name">
              Lampor <b className={lit ? "" : "muted"}>{lit ? `${lit} av ${lights.length} tända` : "Alla släckta"}</b>
            </span>
            {lit > 0 && (
              <button className="btn small" onClick={() => actions.run("Släck allt", () => api.lightsOff(), { done: "Allt släckt", check: (d) => d.lights.every((l) => !l.on || l.offline) })}>
                Släck allt
              </button>
            )}
          </div>
        )}
        {locks.map((l) => (
          <div key={l.entityId} className="sec-row">
            <Icon name="lock" size={22} />
            <span className="sec-name">
              {l.name} <b className={l.state === "locked" ? "ok-text" : "warn-text"}>{l.offline ? "Svarar inte" : LOCK_LABEL[l.state]}</b>
            </span>
            {/* Locking is always safe from the board; unlocking stays on the Säkerhet tab (and needs a code there if set). */}
            {l.state !== "locked" && !l.needsCode && (
              <button className="btn small primary" disabled={l.offline} onClick={() => actions.run(`${l.name} låses`, () => api.lock(l.entityId, "lock"), { done: `${l.name} är låst`, check: (d) => d.security?.locks.find((x) => x.entityId === l.entityId)?.state === "locked" })}>
                Lås
              </button>
            )}
          </div>
        ))}
        {machines.map((m) => (
          <div key={m.name} className={`machine m-${m.phase}`}>
            <div className="sec-row">
              <span className="sec-name">
                <b>{m.name}</b> <span className={m.phase === "done" ? "ok-text" : m.phase === "error" ? "warn-text" : m.phase === "running" ? "" : "muted"}>{m.label}</span>
              </span>
              {m.endsAt && m.phase === "running" && <span className="muted">klar {m.endsAt}</span>}
            </div>
            {m.phase === "running" && m.progress !== undefined && (
              <div className="machine-bar" role="progressbar" aria-valuenow={m.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${m.name} ${m.progress} %`}>
                <span style={{ width: `${Math.max(2, Math.min(100, m.progress))}%` }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

const widget: WidgetModule = {
  id: "homestatus",
  label: "Hemmet – lampor, lås och maskiner",
  size: (data) => {
    const rows = (data.lights.some((l) => !l.offline) ? 1 : 0) + locksOf(data).length + machinesOf(data).length;
    return rows ? 1 + Math.ceil(rows / 2) : 0;
  },
  render: ({ data, actions }) => <HomeStatus data={data} actions={actions} />,
};
export default widget;
