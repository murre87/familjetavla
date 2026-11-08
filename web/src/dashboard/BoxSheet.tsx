import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon";
import { BOX_SIZE_MAX, BOX_SIZE_MIN, type BoxId, type BoxPref } from "../../../server/src/boxprefs";
import { useBoxPrefs } from "../boxprefs";
import { startArranging } from "../layout";

export const BOX_TITLE: Record<BoxId, string> = {
  nu: "Nu",
  idag: "Idag",
  mat: "Maten",
  vecka: "Veckan",
  teknik: "Rutorna längst ner",
  person: "Veckan för personen",
  todo: "Att göra",
};

/** The small cog in a box's top right corner: opens the settings for just that box (the same as holding the box). */
export function BoxGear({ title, onOpen, inline = false }: { title: string; onOpen: () => void; inline?: boolean }) {
  return (
    <button
      type="button"
      className={`box-gear ${inline ? "inline" : ""}`}
      aria-label={`Inställningar för ${title}`}
      title={`Inställningar för ${title}`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      <Icon name="gear" size={16} />
    </button>
  );
}

/** The boxes that can be hidden (the week is the main content and stays). */
export const HIDEABLE: BoxId[] = ["nu", "idag", "mat", "teknik", "todo"];

function Seg<T extends string | number | undefined>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={`seg-btn ${value === v ? "on" : ""}`} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Settings for just one box, opened by holding it: text size, density, days, people, what to show, hide. */
/** `names`: the people who have a column in the week now; `all`: everyone on the board. */
export function BoxSheet({ id, names = [], all = names, onClose, arrange = false }: { id: BoxId; names?: string[]; all?: string[]; onClose: () => void; arrange?: boolean }) {
  const { prefs, setPref, resetPref } = useBoxPrefs();
  // The finger that held the box is still coming up when the sheet appears: a tap on the backdrop just then is not "close".
  const opened = useRef(0);
  useEffect(() => {
    opened.current = Date.now();
  }, []);
  const settling = () => Date.now() - opened.current < 600;
  // Nothing in the sheet reacts to that lifting finger, neither the backdrop nor a button that happens to lie under it.
  const swallow = (e: React.MouseEvent) => {
    if (settling()) {
      e.stopPropagation();
      e.preventDefault();
    }
  };
  const p: BoxPref = prefs[id] ?? {};
  const pct = Math.round((p.size ?? 1) * 100);
  const week = id === "vecka" || id === "person";
  const shownNames = p.people ?? all;
  const toggleName = (n: string) => {
    const on = shownNames.includes(n);
    // Saved as everyone except those turned off, so someone who gets their own column later is shown.
    const next = on ? shownNames.filter((x) => x !== n) : [...shownNames, n];
    const allOn = all.every((x) => next.includes(x));
    const noneOn = !names.some((x) => next.includes(x));
    // Everyone chosen (or nobody) means "all": nothing is saved.
    setPref(id, { people: allOn || noneOn ? undefined : next });
  };
  return createPortal(
    <div className="overlay" onClickCapture={swallow} onClick={onClose}>
      <div className="sheet box-sheet" role="dialog" aria-modal="true" aria-label={`Inställningar för ${BOX_TITLE[id]}`} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="row gap">
          <h2 className="grow" style={{ fontSize: 24 }}>
            {BOX_TITLE[id]}
          </h2>
          <button className="btn icon" aria-label="Stäng" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Gäller bara den här rutan på den här skärmen.
        </p>
        <div className="field">
          <span>Textstorlek: {pct} %</span>
          <div className="scale-row">
            <button className="btn icon" aria-label="Mindre text" onClick={() => setPref(id, { size: (p.size ?? 1) - 0.05 })} disabled={(p.size ?? 1) <= BOX_SIZE_MIN}>
              <Icon name="minus" />
            </button>
            <input type="range" min={BOX_SIZE_MIN * 100} max={BOX_SIZE_MAX * 100} step={5} value={pct} aria-label="Textstorlek i procent" onChange={(e) => setPref(id, { size: Number(e.target.value) / 100 })} />
            <button className="btn icon" aria-label="Större text" onClick={() => setPref(id, { size: (p.size ?? 1) + 0.05 })} disabled={(p.size ?? 1) >= BOX_SIZE_MAX}>
              <Icon name="plus" />
            </button>
          </div>
          <small className="muted">Texten blir så stor som rutan har plats för. Dölj en annan ruta eller visa färre dagar för att få mer plats.</small>
        </div>
        <Seg label="Täthet" value={p.density} options={[["compact", "Kompakt"], [undefined, "Normal"], ["airy", "Luftig"]]} onChange={(v) => setPref(id, { density: v })} />
        {week && (
          <Seg
            label="Antal dagar"
            value={p.days}
            options={[[3, "3"], [4, "4"], [5, "5"], [6, "6"], [7, "7"], [undefined, "Alla"]] as [number | undefined, string][]}
            onChange={(v) => setPref(id, { days: v })}
          />
        )}
        {week && (
          <Seg label="Visa" value={p.show} options={[[undefined, "Allt"], ["tasks", "Bara läxor"], ["activities", "Bara träningar och matcher"]]} onChange={(v) => setPref(id, { show: v })} />
        )}
        {week && (
          <Seg
            label="När skolan slutar"
            value={p.schoolEnd}
            options={[[undefined, "Alla dagar"], ["home", "Bara dagar hos oss"], ["off", "Visa inte"]]}
            onChange={(v) => setPref(id, { schoolEnd: v })}
          />
        )}
        {id === "person" && (
          <Seg
            label="Dagar"
            value={p.scope}
            options={[[undefined, "Alla, även hos den andra föräldern"], ["home", "Bara dagar hos oss"]]}
            onChange={(v) => setPref(id, { scope: v })}
          />
        )}
        {id === "vecka" && names.length > 1 && (
          <div className="field">
            <span>Personer</span>
            <div className="seg" role="group" aria-label="Personer">
              {names.map((n) => (
                <button key={n} type="button" aria-pressed={shownNames.includes(n)} className={`seg-btn ${shownNames.includes(n) ? "on" : ""}`} onClick={() => toggleName(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
        {HIDEABLE.includes(id) && (
          <label className="saver-row">
            <input type="checkbox" checked={Boolean(p.hidden)} onChange={(e) => setPref(id, { hidden: e.target.checked ? true : undefined })} />
            <span>
              <b>Dölj rutan</b>
              <small className="muted"> Du får tillbaka den under Aa-knappen, under Rutor.</small>
            </span>
          </label>
        )}
        {arrange && (
          <button
            className="btn"
            onClick={() => {
              onClose();
              startArranging();
            }}
          >
            <Icon name="move" size={18} /> Flytta och ändra storlek på rutorna
          </button>
        )}
        <div className="row gap">
          <button className="btn" onClick={() => resetPref(id)}>
            Återställ rutan
          </button>
          <span className="grow" />
          <button className="btn primary" onClick={onClose}>
            Klar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
