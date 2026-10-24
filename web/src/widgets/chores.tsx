import { useEffect, useState } from "react";
import type { Dashboard } from "../../../server/src/types";
import { api } from "../api";
import type { Actions } from "../dashboard/Dashboard";
import type { WidgetModule } from "./types";

const DAYS = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
type Chore = { id: string; personId: string; title: string; days: number[] };

/** Sysslor barnen ska göra innan skärmtid: tryck för att bocka av, hela listan nollställs varje dag. */
function Editor({ kids, done, actions }: { kids: Dashboard["people"]; done: () => void; actions: Actions }) {
  const [list, setList] = useState<Chore[] | null>(null);
  const [title, setTitle] = useState("");
  const [who, setWho] = useState(kids[0]?.id ?? "");
  const [days, setDays] = useState<number[]>([]);
  useEffect(() => {
    api.chores().then((r) => setList(r.chores)).catch(() => setList([]));
  }, []);
  if (list === null) return <p className="faint">Hämtar …</p>;
  const add = () => {
    const t = title.trim();
    if (!t || !who) return;
    setList([...list, { id: `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`, personId: who, title: t, days }]);
    setTitle("");
  };
  return (
    <div className="stack" style={{ gap: 10 }}>
      {kids.map((k) => (
        <div key={k.id} className="stack" style={{ gap: 4 }}>
          <b>{k.name}</b>
          {list.filter((c) => c.personId === k.id).map((c) => (
            <div key={c.id} className="row gap" style={{ alignItems: "center" }}>
              <span className="grow">
                {c.title}
                <small className="muted"> · {c.days.length === 0 || c.days.length === 7 ? "alla dagar" : c.days.map((d) => DAYS[d - 1]).join(" ")}</small>
              </span>
              <button className="btn small" aria-label={`Ta bort ${c.title}`} onClick={() => setList(list.filter((x) => x.id !== c.id))}>
                Ta bort
              </button>
            </div>
          ))}
          {list.every((c) => c.personId !== k.id) && <small className="faint">Inga sysslor än.</small>}
        </div>
      ))}
      <form
        className="stack"
        style={{ gap: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div className="row gap wrap">
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Barn">
            {kids.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
          <input value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} placeholder="Ny syssla, t.ex. Plocka undan" style={{ flex: 1, minWidth: 0 }} aria-label="Ny syssla" />
          <button className="btn small selected" disabled={!title.trim()}>
            Lägg till
          </button>
        </div>
        <div className="row gap wrap" aria-label="Vilka dagar">
          {DAYS.map((n, i) => (
            <button type="button" key={n} className={`btn small ${days.includes(i + 1) ? "selected" : ""}`} aria-pressed={days.includes(i + 1)} onClick={() => setDays(days.includes(i + 1) ? days.filter((d) => d !== i + 1) : [...days, i + 1])}>
              {n}
            </button>
          ))}
          <small className="faint">Inga valda = alla dagar</small>
        </div>
      </form>
      <div className="row gap">
        <button className="btn selected" onClick={() => actions.run("Sysslor", async () => { await api.saveChores(list); done(); })}>
          Spara
        </button>
        <button className="btn" onClick={done}>
          Avbryt
        </button>
      </div>
    </div>
  );
}

function Chores({ data, actions }: { data: Dashboard; actions: Actions }) {
  const [editing, setEditing] = useState(false);
  const kids = data.people.filter((p) => p.kind === "child");
  return (
    <section className="card">
      <div className="card-head">
        <h2>Sysslor</h2>
        {!editing && (
          <button className="btn small ghost" onClick={() => setEditing(true)}>
            {data.chores.length ? "Ändra" : "Lägg till"}
          </button>
        )}
      </div>
      {editing ? (
        <Editor kids={kids} done={() => setEditing(false)} actions={actions} />
      ) : data.chores.length === 0 ? (
        <p className="faint">Lägg till vad barnen ska göra innan de får sätta sig vid tv:n eller datorn. Bocka av här på tavlan.</p>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {data.chores.map((p) => (
            <div key={p.personId} className="stack" style={{ gap: 6 }}>
              <div className="row gap" style={{ alignItems: "center" }}>
                <b style={{ color: p.color }}>{p.name}</b>
                {p.allDone && <span className="chip good">Klart! 🎉</span>}
              </div>
              <div className="row gap wrap">
                {p.items.map((i) => (
                  <button
                    key={i.id}
                    className={`btn ${i.done ? "selected" : ""}`}
                    style={{ minHeight: "calc(48px / var(--wzoom, 1))", textDecoration: i.done ? "line-through" : "none" }}
                    aria-pressed={i.done}
                    onClick={() => actions.run(`${p.name}: ${i.title}`, () => api.choreToggle(i.id, !i.done))}
                  >
                    {i.done ? "✓ " : ""}
                    {i.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const widget: WidgetModule = {
  id: "chores",
  label: "Sysslor",
  // Visas när det finns sysslor, eller (som en liten uppmaning) när det finns barn men inga sysslor än.
  size: (data) => (data.chores.length ? 1 + data.chores.reduce((n, p) => n + 1 + Math.ceil(p.items.length / 3), 0) : data.people.some((p) => p.kind === "child") ? 2 : 0),
  render: ({ data, actions }) => <Chores data={data} actions={actions} />,
};
export default widget;
