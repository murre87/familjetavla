import { useCallback, useEffect, useState } from "react";
import type { Dashboard, FoodPart, StoreFood, StoreFoodData } from "../../../server/src/types";
import { api } from "../api";
import { Icon } from "../Icon";
import { Shopping } from "../widgets/shopping";
import type { Actions } from "./Dashboard";
import { MealsPage } from "./Detail";

/** Tab Mat: the week's food (school lunch per child and dinners), the shopping list and, per chosen store, its offers, usual items, recipes and own list. */
export function FoodPage({ data, actions }: { data: Dashboard; actions: Actions }) {
  return (
    <div className="stack fd-page">
      <section className="stack">
        <h2 className="fd-h">Veckans mat</h2>
        <MealsPage data={data} actions={actions} />
      </section>
      <section className="stack">
        <h2 className="fd-h">Inköp</h2>
        <Shopping data={data} actions={actions} />
      </section>
      {(data.groceries?.length ?? 0) > 0 && <Stores actions={actions} />}
    </div>
  );
}

const until = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `till ${d.getDate()}/${d.getMonth() + 1}`;
};

function Stores({ actions }: { actions: Actions }) {
  const [stores, setStores] = useState<StoreFood[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .foodStores()
      .then(setStores)
      .catch((e) => setError((e as Error).message));
  }, []);
  if (error) return <p className="faint">Butikerna gick inte att hämta: {error}</p>;
  if (!stores) return null;
  return (
    <>
      {stores
        .filter((s) => s.parts.length > 0)
        .map((s) => (
          <section key={s.id} className="stack">
            <h2 className="fd-h">{s.name}</h2>
            {s.parts.map((part) => (
              <Part key={part} store={s} part={part} actions={actions} />
            ))}
          </section>
        ))}
    </>
  );
}

const TITLES: Record<FoodPart, string> = { list: "Listan i appen", common: "Mina vanligaste varor", offers: "Erbjudanden", recipes: "Receptförslag" };

/** One dropdown: nothing is fetched until it is opened (the list opens by itself, it is what you shop from). */
function Part({ store, part, actions }: { store: StoreFood; part: FoodPart; actions: Actions }) {
  const [open, setOpen] = useState(part === "list");
  const [data, setData] = useState<StoreFoodData | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setBusy(true);
    api
      .foodPart(store.id, part)
      .then(setData)
      .catch((e) => setData({ errors: { [part]: (e as Error).message } }))
      .finally(() => setBusy(false));
  }, [store.id, part]);
  useEffect(() => {
    if (open && !data && !busy) load();
  }, [open, data, busy, load]);
  const err = data?.errors?.[part];
  const add = (name: string) => void actions.run("Inköpslistan", () => api.addItem(name));
  const title = `${TITLES[part]}${data?.store && part === "offers" ? ` · ${data.store}` : ""}`;
  return (
    <details className="card fd-part" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <b>{title}</b>
        {part === "list" && data?.list && <span className="muted"> · {data.list.rows.filter((r) => !r.done).length} kvar</span>}
      </summary>
      {busy && !data && <p className="faint" role="status">Hämtar…</p>}
      {err && <p className="faint">{err}</p>}
      {data?.list && (
        <div className="stack" style={{ gap: 2 }}>
          {data.list.rows.length === 0 && <p className="faint">Listan "{data.list.name}" är tom. Skicka inköpslistan hit med knappen under Inköp.</p>}
          {data.list.rows.map((r) => (
            <label key={r.id} className={`shop-item ${r.done ? "done" : ""}`}>
              <input
                type="checkbox"
                checked={r.done}
                onChange={(e) => {
                  const done = e.target.checked;
                  setData({ ...data, list: { ...data.list!, rows: data.list!.rows.map((x) => (x.id === r.id ? { ...x, done } : x)) } });
                  void actions.run(`${store.name}-listan`, () => api.foodIcaStrike(r.id, r.name, done));
                }}
              />
              <span>{r.name}</span>
            </label>
          ))}
        </div>
      )}
      {data?.common && (
        <div className="row gap wrap">
          {data.common.length === 0 && <p className="faint">Inget att visa ännu – det fylls på när ni handlat.</p>}
          {data.common.map((c) => (
            <button key={c.name} className="btn small" aria-label={`Lägg ${c.name} på inköpslistan`} onClick={() => add(c.name)}>
              <Icon name="plus" size={14} /> {c.name}
            </button>
          ))}
        </div>
      )}
      {data?.offers && (
        <div className="fd-grid">
          {data.offers.length === 0 && <p className="faint">Inga erbjudanden hittades.</p>}
          {data.offers.map((o) => (
            <div key={o.id} className="card fd-offer">
              {o.image && <img src={o.image} alt="" loading="lazy" />}
              <b>{o.name}</b>
              <small className="muted">{[o.brand, o.size].filter(Boolean).join(" · ")}</small>
              {o.note && <small className="muted">{o.note}</small>}
              <div className="row gap fd-offer-foot">
                <span className="fd-price">{o.price ?? ""}</span>
                <small className="muted">{until(o.validTo)}</small>
              </div>
              <button className="btn small" aria-label={`Lägg ${o.name} på inköpslistan`} onClick={() => add(o.name)}>
                <Icon name="plus" size={16} /> På listan
              </button>
            </div>
          ))}
        </div>
      )}
      {data?.recipes && (
        <>
          <div className="fd-grid">
            {data.recipes.map((r) => (
              <a key={r.id} className="card fd-recipe" href={r.url} target="_blank" rel="noreferrer">
                {r.image && <img src={r.image} alt="" loading="lazy" />}
                <b>{r.title}</b>
                <small className="muted">{[r.time, r.ingredients ? `${r.ingredients} ingredienser` : ""].filter(Boolean).join(" · ")}</small>
              </a>
            ))}
          </div>
          <button className="btn small" style={{ alignSelf: "flex-start" }} onClick={load}>
            <Icon name="refresh" size={16} /> Fler förslag
          </button>
        </>
      )}
    </details>
  );
}
