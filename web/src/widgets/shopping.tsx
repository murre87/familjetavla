import { useState } from "react";
import type { Dashboard } from "../../../server/src/types";
import { api } from "../api";
import { Icon } from "../Icon";
import type { Actions } from "../dashboard/Dashboard";
import type { WidgetModule } from "./types";

export function Shopping({ data, actions, limit }: { data: Dashboard; actions: Actions; limit?: number }) {
  const [text, setText] = useState("");
  const all = data.shopping.items;
  // Home screen: the first few to buy; the Inköpslista page shows everything.
  const items = limit ? all.filter((i) => !i.done).slice(0, limit) : all;
  const hidden = all.filter((i) => !i.done).length - items.filter((i) => !i.done).length;
  const open = all.filter((i) => !i.done).length;
  const done = all.length - open;
  return (
    <section className="card" style={{ flexGrow: 1 }}>
      <div className="card-head">
        <h2>Inköpslista</h2>
        <span className="muted">
          {open} {open === 1 ? "vara" : "varor"}
        </span>
      </div>
      <div className="stack" style={{ gap: 2 }}>
        {all.length === 0 && <p className="faint">Listan är tom.</p>}
        {items.map((i) => (
          <label key={i.id} className={`shop-item ${i.done ? "done" : ""}`}>
            <input type="checkbox" checked={i.done} onChange={(e) => actions.run("Inköpslistan", () => api.toggleItem(i.id, e.target.checked))} />
            <span className="grow">{i.name}</span>
            {i.sent && <small className="sent-chip" title={`Skickad till ${i.sent}`}>✓ {i.sent}</small>}
          </label>
        ))}
        {hidden > 0 && <div className="more-hint">+{hidden} till – tryck för hela listan</div>}
      </div>
      <form
        className="row gap"
        onSubmit={(e) => {
          e.preventDefault();
          const name = text.trim();
          if (!name) return;
          setText("");
          actions.run("Lägg till", () => api.addItem(name));
        }}
      >
        <label className="sr-only" htmlFor="add-item">
          Lägg till vara
        </label>
        <input id="add-item" className="input grow" placeholder="Lägg till vara…" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn icon" style={{ width: 52, height: 52 }} aria-label="Lägg till">
          <Icon name="plus" />
        </button>
      </form>
      <div className="row gap wrap">
        {done > 0 && (
          <button className="btn small" onClick={() => actions.run("Rensa", () => api.clearDone())}>
            Rensa avbockade
          </button>
        )}
        {open > 0 &&
          // One button per chosen store, so the list goes to the one you press.
          (data.groceries && data.groceries.length > 1 ? data.groceries : data.grocery ? [{ id: undefined, provider: data.grocery.provider, name: data.grocery.name }] : []).map((g, i) => (
            <button key={g.id ?? g.provider} className={`btn grow ${i === 0 ? "primary" : ""}`} onClick={() => actions.openGrocery(g.id)}>
              <Icon name="cart" size={20} />
              Skicka till {g.name}
            </button>
          ))}
      </div>
    </section>
  );
}

const widget: WidgetModule = {
  id: "shopping",
  label: "Inköpslista",
  size: (data) => 2 + Math.min(5, data.shopping?.items?.filter((i) => !i.done).length ?? 0),
  render: ({ data, actions, full }) => <Shopping data={data} actions={actions} limit={full ? undefined : 5} />,
  opens: { page: "inkop" },
};
export default widget;
