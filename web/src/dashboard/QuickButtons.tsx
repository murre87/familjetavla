import type { ButtonPlace, Dashboard, QuickButton } from "../../../server/src/types";
import { api } from "../api";
import { Hide } from "../hide";
import type { Actions } from "./Dashboard";
import { setGroups } from "./lightGroups";

/** Where a Snabbknapp shows (#101). A button without a choice stays under Ljus, as it always has. */
export const placeOf = (b: QuickButton): ButtonPlace => b.place ?? "lights";
export const buttonsAt = (data: Dashboard, place: ButtonPlace) => data.buttons.filter((b) => placeOf(b) === place);
/**
 * Light groups with their own Tänd / Släck buttons on another page ("Fönsterlampor" on the start page).
 * Every group is always on Ljus with its own card, so for "lights" there are none extra.
 */
export const groupsAt = (data: Dashboard, place: ButtonPlace) => (place === "lights" ? [] : data.lightGroups.filter((g) => g.place === place));
/** Anything to show on this page: a button or a group. */
export const quickCount = (data: Dashboard, place: ButtonPlace) => buttonsAt(data, place).length + groupsAt(data, place).length;

/** The choices in the settings, in the order of the tabs. */
export const BUTTON_PLACE_OPTIONS: { value: ButtonPlace; label: string }[] = [
  { value: "lights", label: "Ljus" },
  { value: "house", label: "Hus" },
  { value: "household", label: "Hushåll" },
  { value: "security", label: "Säkerhet" },
  { value: "home", label: "Startsidan" },
];

/** Tänd / Släck for one light group, used on the Snabbval card and in the start page's bottom row. */
export function groupSwitch(actions: Actions, g: Dashboard["lightGroups"][number], on: boolean) {
  return setGroups(actions, [g], on, `${on ? "Tänd" : "Släck"} ${g.name.toLowerCase()}`);
}

/** The Snabbval card: the buttons and light groups placed on this page, or nothing when there are none. */
export function QuickButtons({ data, actions, place, title = "Snabbval" }: { data: Dashboard; actions: Actions; place: ButtonPlace; title?: string }) {
  const buttons = buttonsAt(data, place);
  const groups = groupsAt(data, place);
  if (!buttons.length && !groups.length) return null;
  return (
    <section className="card">
      <h2>{title}</h2>
      {groups.length > 0 && (
        <div className="stack" style={{ gap: 10, marginBottom: buttons.length ? 12 : 0 }}>
          {groups.map((g) => (
            <Hide key={g.index} k={`quick:lightgroup:${g.name}`} label={g.name} data={data} actions={actions} block>
              <div className="stack" style={{ gap: 6 }}>
                <span>
                  <b>{g.name}</b>{" "}
                  <span className="muted">
                    {g.on} av {g.total - g.offline.length} tända
                  </span>
                </span>
                <div className="big-buttons">
                  <button className="big-btn amber" onClick={() => groupSwitch(actions, g, true)}>
                    Tänd
                  </button>
                  <button className="big-btn" onClick={() => groupSwitch(actions, g, false)}>
                    Släck
                  </button>
                </div>
              </div>
            </Hide>
          ))}
        </div>
      )}
      {buttons.length > 0 && (
        <div className="big-buttons">
          {buttons.map((b) => (
            <Hide key={b.entityId} k={b.entityId} label={b.name} data={data} actions={actions}>
              <button className={`big-btn wide ${b.style}`} onClick={() => actions.run(b.name, () => api.button(b.entityId))}>
                {b.name}
              </button>
            </Hide>
          ))}
        </div>
      )}
    </section>
  );
}
