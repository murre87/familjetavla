import { cloneElement, isValidElement, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import type { Dashboard } from "../../server/src/types";
import { api } from "./api";
import { Icon } from "./Icon";
import type { Actions } from "./dashboard/Dashboard";

/**
 * "Ta bort saker" under the cog on every page (Emil 2026-11-14: "på spasidan vill jag ta bort knappen Blower"):
 * the page shows a × on every card and button; what is taken away is gone on all screens (saved in the settings),
 * and while editing it stays visible but faded, with a button to bring it back.
 */
let editing = false;
const listeners = new Set<() => void>();
export function setEditing(on: boolean) {
  editing = on;
  listeners.forEach((l) => l());
}
export function useEditing() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => editing,
  );
}

/** Hides `children` when `k` (an entity_id, or entity_id#choice) has been taken away; shows a × or an undo while editing. */
export function Hide({ k, label, data, actions, children, block = false, card = false }: { k: string; label: string; data: Dashboard; actions: Actions; children: ReactNode; block?: boolean; card?: boolean }) {
  const on = useEditing();
  const gone = (data.hidden ?? []).includes(k);
  if (!on) return gone ? null : <>{children}</>;
  const set = (hidden: boolean) =>
    actions.run(hidden ? `Ta bort ${label}` : `Visa ${label}`, () => api.setHidden(k, hidden), {
      done: hidden ? `${label} borttagen` : `${label} visas igen`,
      check: (d) => (d.hidden ?? []).includes(k) === hidden,
    });
  const x = (
    <button key="hide-x" className="hide-x" aria-label={gone ? `Visa ${label} igen` : `Ta bort ${label}`} title={gone ? `Visa ${label} igen` : `Ta bort ${label}`} onClick={() => void set(!gone)}>
      <Icon name={gone ? "refresh" : "x"} size={16} />
    </button>
  );
  // A whole card: the × goes inside it, so the page's own grid is not disturbed by an extra box around the card.
  if (card && isValidElement(children)) {
    const el = children as ReactElement<{ className?: string; children?: ReactNode }>;
    return cloneElement(el, { className: `${el.props.className ?? ""} hideable-card ${gone ? "gone" : ""}` }, <>{el.props.children}</>, x);
  }
  return (
    <div className={`hideable ${block ? "block" : ""} ${gone ? "gone" : ""}`}>
      <div className="hideable-inner" aria-hidden={gone}>
        {children}
      </div>
      <button className="hide-x" aria-label={gone ? `Visa ${label} igen` : `Ta bort ${label}`} title={gone ? `Visa ${label} igen` : `Ta bort ${label}`} onClick={() => void set(!gone)}>
        <Icon name={gone ? "refresh" : "x"} size={16} />
      </button>
    </div>
  );
}

/** The bar on top of a page while editing. */
export function EditBar() {
  const on = useEditing();
  if (!on) return null;
  return (
    <div className="edit-bar" role="status">
      <span className="grow">Tryck på × för att ta bort en knapp eller ett kort. Borttaget syns bleknat medan du ändrar och kan tas tillbaka. Gäller alla skärmar.</span>
      <button className="btn primary" onClick={() => setEditing(false)}>
        Klar
      </button>
    </div>
  );
}
