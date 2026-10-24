import { useCallback, useEffect, useState } from "react";
import type { Dashboard, FoodIca } from "../../../server/src/types";
import { api } from "../api";
import { Icon } from "../Icon";
import { Shopping } from "../widgets/shopping";
import type { Actions } from "./Dashboard";
import { MealsPage } from "./Detail";

/** Tab Mat: the week's food (school lunch per child and dinners), the shopping list and, with ICA, its offers, recipes and list. */
export function FoodPage({ data, actions }: { data: Dashboard; actions: Actions }) {
  const ica = data.grocery?.provider === "ica";
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
      {ica && <IcaFood actions={actions} />}
    </div>
  );
}

const until = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `till ${d.getDate()}/${d.getMonth() + 1}`;
};

function IcaFood({ actions }: { actions: Actions }) {
  const [f, setF] = useState<FoodIca | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api
      .foodIca()
      .then((r) => {
        setF(r);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  if (error) return <p className="faint">ICA gick inte att hämta: {error}</p>;
  if (!f) return <p className="faint" role="status">Hämtar från ICA…</p>;
  if (!f.enabled) return null;
  const err = f.errors ?? {};
  return (
    <>
      <section className="stack">
        <h2 className="fd-h">ICA{f.store ? ` · ${f.store}` : ""}</h2>
        {f.list && (
          <div className="card">
            <div className="card-head">
              <h2>Listan i ICA-appen – {f.list.name}</h2>
              <span className="muted">{f.list.rows.filter((r) => !r.done).length} kvar</span>
            </div>
            {f.list.rows.length === 0 && <p className="faint">Listan är tom. Skicka inköpslistan hit med knappen under Inköp.</p>}
            {f.list.rows.map((r) => (
              <label key={r.id} className={`shop-item ${r.done ? "done" : ""}`}>
                <input
                  type="checkbox"
                  checked={r.done}
                  onChange={(e) => {
                    const done = e.target.checked;
                    setF({ ...f, list: { ...f.list!, rows: f.list!.rows.map((x) => (x.id === r.id ? { ...x, done } : x)) } });
                    void actions.run("ICA-listan", () => api.foodIcaStrike(r.id, r.name, done));
                  }}
                />
                <span>{r.name}</span>
              </label>
            ))}
          </div>
        )}
        {err.list && <p className="faint">Listan: {err.list}</p>}
      </section>
      {f.offers && f.offers.length > 0 && (
        <section className="stack">
          <h2 className="fd-h">Erbjudanden</h2>
          <div className="fd-grid">
            {f.offers.map((o) => (
              <div key={o.id} className="card fd-offer">
                {o.image && <img src={o.image} alt="" loading="lazy" />}
                <b>{o.name}</b>
                <small className="muted">{[o.brand, o.size].filter(Boolean).join(" · ")}</small>
                <div className="row gap fd-offer-foot">
                  <span className="fd-price">{o.price ?? ""}</span>
                  <small className="muted">{until(o.validTo)}</small>
                </div>
                <button className="btn small" aria-label={`Lägg ${o.name} på inköpslistan`} onClick={() => void actions.run("Inköpslistan", () => api.addItem(o.name))}>
                  <Icon name="plus" size={16} /> På listan
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {err.offers && <p className="faint">Erbjudanden: {err.offers}</p>}
      {f.recipes && f.recipes.length > 0 && (
        <section className="stack">
          <h2 className="fd-h">Recept</h2>
          <div className="fd-grid">
            {f.recipes.map((r) => (
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
        </section>
      )}
      {err.recipes && <p className="faint">Recept: {err.recipes}</p>}
    </>
  );
}
