import type { ButtonPlace, Dashboard, QuickButton } from "../../../server/src/types";
import { api } from "../api";
import { Hide } from "../hide";
import type { Actions } from "./Dashboard";

/** Where a Snabbknapp shows (#101). A button without a choice stays under Ljus, as it always has. */
export const placeOf = (b: QuickButton): ButtonPlace => b.place ?? "lights";
export const buttonsAt = (data: Dashboard, place: ButtonPlace) => data.buttons.filter((b) => placeOf(b) === place);

/** The choices in the settings, in the order of the tabs. */
export const BUTTON_PLACE_OPTIONS: { value: ButtonPlace; label: string }[] = [
  { value: "lights", label: "Ljus" },
  { value: "house", label: "Hus" },
  { value: "household", label: "Hushåll" },
  { value: "security", label: "Säkerhet" },
  { value: "home", label: "Startsidan" },
];

/** The Snabbval card: the buttons placed on this page, or nothing when there are none. */
export function QuickButtons({ data, actions, place, title = "Snabbval" }: { data: Dashboard; actions: Actions; place: ButtonPlace; title?: string }) {
  const buttons = buttonsAt(data, place);
  if (!buttons.length) return null;
  return (
    <section className="card">
      <h2>{title}</h2>
      <div className="big-buttons">
        {buttons.map((b) => (
          <Hide key={b.entityId} k={b.entityId} label={b.name} data={data} actions={actions}>
            <button className={`big-btn wide ${b.style}`} onClick={() => actions.run(b.name, () => api.button(b.entityId))}>
              {b.name}
            </button>
          </Hide>
        ))}
      </div>
    </section>
  );
}
