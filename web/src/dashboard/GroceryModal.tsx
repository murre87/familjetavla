import { useEffect, useState } from "react";
import { api, type GroceryLine } from "../api";
import { Icon } from "../Icon";

/**
 * Send the shopping list to the store's cart. First time per item the user picks the product;
 * the choice is remembered and preselected next time.
 */
export function GroceryModal({ storeId, onClose, onDone }: { storeId?: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [store, setStore] = useState("");
  const [lines, setLines] = useState<GroceryLine[] | null>(null);
  const [choice, setChoice] = useState<Record<string, { code: string; name: string; qty: number } | null>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .groceryPreview(storeId)
      .then((r) => {
        setStore(r.store);
        setLines(r.lines);
        const init: typeof choice = {};
        for (const l of r.lines) {
          const pick = l.remembered ?? (l.candidates[0] ? { code: l.candidates[0].code, name: l.candidates[0].name } : null);
          init[l.item] = pick ? { ...pick, qty: 1 } : null;
        }
        setChoice(init);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      const picked = Object.entries(choice)
        .filter(([, v]) => v)
        .map(([item, v]) => ({ item, code: v!.code, name: v!.name, qty: v!.qty }));
      const r = await api.grocerySend(picked, storeId);
      onDone(`${picked.length} varor lagda i ${r.store}-varukorgen${r.total ? ` · ${r.total}` : ""}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Skicka till butik" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2 style={{ fontSize: 24 }}>Skicka till {store || "butiken"}</h2>
          <button className="btn icon" aria-label="Stäng" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        {!lines && !error && <p className="muted">Söker produkter…</p>}
        {error && <p className="error-text">{error}</p>}
        {lines?.map((l) => {
          const c = choice[l.item];
          const options = [...(l.remembered ? [l.remembered] : []), ...l.candidates.filter((x) => x.code !== l.remembered?.code)];
          return (
            <div className="item-row" key={l.item} style={{ flexWrap: "wrap" }}>
              <b style={{ minWidth: 110 }}>{l.item}</b>
              <label className="sr-only" htmlFor={`p-${l.item}`}>
                Produkt för {l.item}
              </label>
              <select
                id={`p-${l.item}`}
                className="input grow"
                value={c?.code ?? ""}
                onChange={(e) => {
                  const o = options.find((x) => x.code === e.target.value);
                  setChoice((prev) => ({ ...prev, [l.item]: o ? { code: o.code, name: o.name, qty: prev[l.item]?.qty ?? 1 } : null }));
                }}
              >
                <option value="">Hoppa över</option>
                {options.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.name}
                    {"volume" in o && o.volume ? ` ${o.volume}` : ""}
                    {"price" in o && o.price ? ` · ${o.price}` : ""}
                    {o.code === l.remembered?.code ? " (som förra gången)" : ""}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor={`q-${l.item}`}>
                Antal
              </label>
              <input
                id={`q-${l.item}`}
                className="input"
                style={{ width: 76 }}
                type="number"
                min={1}
                max={20}
                value={c?.qty ?? 1}
                disabled={!c}
                onChange={(e) => setChoice((prev) => ({ ...prev, [l.item]: prev[l.item] ? { ...prev[l.item]!, qty: Number(e.target.value) || 1 } : null }))}
              />
            </div>
          );
        })}
        {lines && (
          <div className="row gap" style={{ justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={onClose}>
              Avbryt
            </button>
            <button className="btn primary" disabled={busy || !Object.values(choice).some(Boolean)} onClick={send}>
              <Icon name="cart" size={20} />
              {busy ? "Skickar…" : "Lägg i varukorgen"}
            </button>
          </div>
        )}
        <p className="faint" style={{ fontSize: 13 }}>
          Varorna läggs i din varukorg. Leveranstid och betalning väljer du själv i butikens app.
        </p>
      </div>
    </div>
  );
}
