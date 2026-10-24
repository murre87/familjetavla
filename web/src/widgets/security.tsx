import { useEffect, useState } from "react";
import type { AlarmMode, Dashboard, Robot, Security } from "../../../server/src/types";
import { api } from "../api";
import { Icon } from "../Icon";
import type { Actions } from "../dashboard/Dashboard";

// ---------- Säkerhet: cameras, locks, alarm, garage doors and doors/windows ----------

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
const MODE_LABEL: Record<AlarmMode, string> = { home: "Hemma", away: "Borta", night: "Natt", vacation: "Semester" };

/** A camera's still image, refreshed every 10 seconds while the tab is open. Tap for a bigger one. */
function Camera({ cam, big, onTap }: { cam: Security["cameras"][number]; big: boolean; onTap: () => void }) {
  const [tick, setTick] = useState(() => Date.now());
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), big ? 3000 : 10_000);
    return () => clearInterval(t);
  }, [big]);
  return (
    <button className={`camera ${big ? "big" : ""}`} onClick={onTap} aria-label={big ? `Mindre bild från ${cam.name}` : `Större bild från ${cam.name}`}>
      <span className="camera-img">
        {cam.offline || broken ? (
          <span className="muted">{cam.offline ? "Kameran svarar inte" : "Ingen bild just nu"}</span>
        ) : (
          <img src={api.cameraUrl(cam.entityId, tick)} alt="" onError={() => setBroken(true)} onLoad={() => setBroken(false)} />
        )}
      </span>
      <span className="camera-name">{cam.name}</span>
    </button>
  );
}

function CodeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input className="code-field" type="password" inputMode="numeric" autoComplete="off" maxLength={20} placeholder="Kod" aria-label="Kod" value={value} onChange={(e) => onChange(e.target.value)} />;
}

export function SecurityPage({ data, actions }: { data: Dashboard; actions: Actions }) {
  const s = data.security;
  const [big, setBig] = useState<string | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});
  if (!s) return <p className="muted">Välj kameror, lås och larm under Inställningar → Huset → Säkerhet.</p>;
  const code = (id: string) => codes[id] || undefined;
  const setCode = (id: string) => (v: string) => setCodes((c) => ({ ...c, [id]: v }));
  const openNow = s.openings.filter((o) => o.open);
  const cams = big ? s.cameras.filter((c) => c.entityId === big) : s.cameras;

  return (
    <main className="page-grid security">
      {s.cameras.length > 0 && (
        <section className="card cameras-card">
          <h2>{big ? "Kamera" : "Kameror"}</h2>
          {big && <p className="muted" style={{ margin: "-4px 0 8px" }}>Tryck på bilden för att se alla.</p>}
          <div className={`camera-grid ${big ? "one" : ""}`}>
            {cams.map((c) => (
              <Camera key={c.entityId} cam={c} big={big === c.entityId} onTap={() => {
                  setBig(big ? null : c.entityId);
                  // The page gets shorter: start from the top so nothing hides behind the tab bar on phones.
                  window.scrollTo(0, 0);
                }} />
            ))}
          </div>
        </section>
      )}

      {!big && s.alarms.map((a) => (
        <section key={a.entityId} className={`card alarm ${a.triggered ? "triggered" : a.armed ? "armed" : ""}`}>
          <h2>
            <Icon name="shield" size={22} /> {a.name}
            <span className={`chip ${a.triggered ? "warn" : a.armed ? "good" : ""}`}>{a.label}</span>
          </h2>
          {a.needsCode && <CodeField value={codes[a.entityId] ?? ""} onChange={setCode(a.entityId)} />}
          <div className="big-buttons">
            {a.armed || a.triggered ? (
              <button className="big-btn" disabled={a.offline} onClick={() => actions.confirm(`Stänga av ${a.name}?`, `${a.name} av`, () => api.alarm(a.entityId, "off", code(a.entityId)))}>
                Stäng av
              </button>
            ) : (
              a.modes.map((m) => (
                <button key={m} className="big-btn amber" disabled={a.offline} onClick={() => actions.run(`${a.name}: ${MODE_LABEL[m]}`, () => api.alarm(a.entityId, m, code(a.entityId)))}>
                  Slå på – {MODE_LABEL[m]}
                </button>
              ))
            )}
          </div>
        </section>
      ))}

      {!big && s.locks.length > 0 && (
        <section className="card">
          <h2>Lås</h2>
          <div className="stack" style={{ gap: 10 }}>
            {s.locks.map((l) => (
              <div key={l.entityId} className="sec-row">
                <Icon name="lock" size={22} />
                <span className="sec-name">
                  {l.name} <b className={l.state === "locked" ? "ok-text" : "warn-text"}>{l.offline ? "Svarar inte" : LOCK_LABEL[l.state]}</b>
                </span>
                {l.needsCode && <CodeField value={codes[l.entityId] ?? ""} onChange={setCode(l.entityId)} />}
                {l.state !== "locked" ? (
                  <button className="btn primary" disabled={l.offline} onClick={() => actions.run(`${l.name} låses`, () => api.lock(l.entityId, "lock", code(l.entityId)), { done: `${l.name} är låst`, check: (d) => d.security?.locks.find((x) => x.entityId === l.entityId)?.state === "locked" })}>
                    Lås
                  </button>
                ) : s.allowUnlock ? (
                  <button className="btn" disabled={l.offline} onClick={() => actions.confirm(`Låsa upp ${l.name}?`, `${l.name} låses upp`, () => api.lock(l.entityId, "unlock", code(l.entityId)))}>
                    Lås upp
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      )}

      {!big && s.covers.length > 0 && (
        <section className="card">
          <h2>Portar</h2>
          <div className="stack" style={{ gap: 10 }}>
            {s.covers.map((c) => (
              <div key={c.entityId} className="sec-row">
                <Icon name="home" size={22} />
                <span className="sec-name">
                  {c.name} <b className={c.open ? "warn-text" : "ok-text"}>{c.label}</b>
                </span>
                <button className="btn" disabled={c.offline} onClick={() => actions.confirm(c.open ? `Stänga ${c.name}?` : `Öppna ${c.name}?`, c.name, () => api.cover(c.entityId, c.open ? "close" : "open"))}>
                  {c.open ? "Stäng" : "Öppna"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {!big && s.openings.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Dörrar och fönster</h2>
            <span className={`chip ${openNow.length === 0 ? "good" : "warn"}`}>{openNow.length === 0 ? "Allt stängt" : `${openNow.length} öppet`}</span>
          </div>
          <div className="open-chips">
            {s.openings.map((o) => (
              <span key={o.name} className={`open-chip ${o.open ? "open" : ""}`}>
                <Icon name={o.open ? "unlock" : "lock"} size={16} /> {o.name}
              </span>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

// ---------- Hushåll: washing machine, dishwasher … and robot vacuums and mowers ----------

const KIND_NAME: Record<string, string> = { washer: "Tvättmaskin", dryer: "Torktumlare", dishwasher: "Diskmaskin", oven: "Ugn", other: "Maskin" };

export function HouseholdPage({ data, actions }: { data: Dashboard; actions: Actions }) {
  const robots = data.robots ?? [];
  const machines = data.appliances ?? [];
  if (!robots.length && !machines.length) return <p className="muted">Välj maskiner och robotar under Inställningar → Huset → Hushåll.</p>;
  const run = (r: Robot, op: "start" | "pause" | "dock", label: string) => actions.run(`${r.name}: ${label}`, () => api.robot(r.entityId, op));
  return (
    <main className="page-grid household">
      {machines.length > 0 && (
        <section className="card">
          <h2>Husgeråd</h2>
          <div className="stack" style={{ gap: 12 }}>
            {machines.map((m) => (
              <div key={m.name} className={`machine m-${m.phase}`}>
                <div className="sec-row machine-row">
                  <span className="machine-ico" aria-hidden="true">
                    <Icon name={(({ washer: "washer", dryer: "dryer", dishwasher: "dishwasher", oven: "oven" }) as Record<string, "washer" | "dryer" | "dishwasher" | "oven">)[m.kind] ?? "washer"} size={26} />
                  </span>
                  <span className="sec-name">
                    <b>{m.name}</b>
                    <span className={`machine-label ph-${m.phase}`}>{m.label}</span>
                  </span>
                  {m.endsAt && (
                    <span className="machine-end">
                      <small>klar</small>
                      <b>{m.endsAt}</b>
                    </span>
                  )}
                </div>
                {m.phase === "running" && m.progress !== undefined && (
                  <div className="machine-bar" role="progressbar" aria-valuenow={m.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${KIND_NAME[m.kind]} ${m.progress} %`}>
                    <span style={{ width: `${Math.max(2, Math.min(100, m.progress))}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {robots.map((r) => (
        <section key={r.entityId} className={`card robot ${r.error ? "error" : ""}`}>
          <h2>{r.name}</h2>
          <p className={r.error ? "warn-text" : "muted"} style={{ margin: "0 0 10px" }}>
            {r.label}
            {r.battery !== undefined ? ` · batteri ${r.battery} %` : ""}
          </p>
          <div className="big-buttons">
            {r.canStart && !r.busy && (
              <button className="big-btn accent" disabled={r.offline} onClick={() => run(r, "start", r.kind === "mower" ? "klipper" : "städar")}>
                {r.kind === "mower" ? "Klipp" : "Städa"}
              </button>
            )}
            {r.canPause && r.busy && (
              <button className="big-btn" disabled={r.offline} onClick={() => run(r, "pause", "pausad")}>
                Paus
              </button>
            )}
            {r.canDock && r.state !== "docked" && (
              <button className="big-btn" disabled={r.offline} onClick={() => run(r, "dock", "åker hem")}>
                Åk hem
              </button>
            )}
          </div>
        </section>
      ))}
    </main>
  );
}
