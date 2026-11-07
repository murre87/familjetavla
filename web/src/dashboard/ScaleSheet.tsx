import { useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon";
import { BOX_TITLE, BoxSheet, HIDEABLE } from "./BoxSheet";
import { BOX_IDS, type BoxId } from "../../../server/src/boxprefs";
import { useBoxPrefs } from "../boxprefs";
import { startArranging } from "../layout";
import { SCALE_MAX, SCALE_MIN, getDesignOverride, readScale, saveScale, screensaverOff, setDesignOverride, setScreensaverOff, type Design } from "../uiscale";

const PRESETS = [0.7, 0.8, 0.9, 1, 1.15];

/** "Skärmstorlek": gör allt mindre eller större på just den här skärmen. Syns direkt medan man drar. */
export function ScaleSheet({ onClose, names = [], all = names }: { onClose: () => void; names?: string[]; all?: string[] }) {
  const [z, setZ] = useState(readScale);
  const [saverOff, setSaverOff] = useState(screensaverOff);
  const [design, setDesign] = useState<Design | null>(getDesignOverride);
  const set = (v: number) => setZ(saveScale(v));
  const pct = Math.round(z * 100);
  const { prefs, setPref, resetAll } = useBoxPrefs();
  const [box, setBox] = useState<BoxId | null>(null);
  const hiddenBoxes = HIDEABLE.filter((id) => prefs[id]?.hidden);
  const anyBoxPrefs = Object.keys(prefs).length > 0;
  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="sheet scale-sheet" role="dialog" aria-modal="true" aria-label="Skärm" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="row gap">
          <h2 className="grow" style={{ fontSize: 24 }}>
            Skärm
          </h2>
          <button className="btn icon" aria-label="Stäng" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Storlek: mindre ger plats åt fler kort utan att behöva bläddra. Gäller bara den här skärmen.
        </p>
        <div className="scale-row">
          <button className="btn icon" aria-label="Mindre" onClick={() => set(z - 0.05)} disabled={z <= SCALE_MIN}>
            <Icon name="minus" />
          </button>
          <input type="range" min={SCALE_MIN * 100} max={SCALE_MAX * 100} step={5} value={pct} aria-label="Skärmstorlek i procent" onChange={(e) => set(Number(e.target.value) / 100)} />
          <button className="btn icon" aria-label="Större" onClick={() => set(z + 0.05)} disabled={z >= SCALE_MAX}>
            <Icon name="plus" />
          </button>
          <b className="scale-pct">{pct} %</b>
        </div>
        <div className="row gap wrap">
          {PRESETS.map((p) => (
            <button key={p} className={`btn small ${Math.abs(z - p) < 0.01 ? "primary" : ""}`} onClick={() => set(p)}>
              {Math.round(p * 100)} %{p === 1 ? " (standard)" : ""}
            </button>
          ))}
        </div>
        <div className="design-row">
          <b>Utseende på den här skärmen</b>
          <div className="seg-btns" role="radiogroup" aria-label="Utseende">
            {([[null, "Som i inställningarna"], ["flat", "Ny, platt"], ["glass", "Klassisk, glasig"]] as [Design | null, string][]).map(([v, label]) => (
              <button
                key={String(v)}
                role="radio"
                aria-checked={design === v}
                className={`btn small ${design === v ? "primary" : ""}`}
                onClick={() => {
                  setDesignOverride(v);
                  setDesign(v);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="design-row boxes-row">
          <b>Rutor</b>
          <small className="muted">Tryck på kugghjulet uppe till höger i en ruta, håll fingret på rutan, eller välj den här, för att ändra just den: textstorlek, täthet, antal dagar, vad som visas eller dölja den.</small>
          <div>
            <button
              className="btn small primary"
              onClick={() => {
                onClose();
                startArranging();
              }}
            >
              <Icon name="move" size={16} /> Ordna startsidan
            </button>
          </div>
          <div className="seg-btns">
            {BOX_IDS.map((id) => (
              <button key={id} className="btn small" onClick={() => setBox(id)}>
                {BOX_TITLE[id]}
              </button>
            ))}
          </div>
          {hiddenBoxes.length > 0 && (
            <div className="seg-btns">
              {hiddenBoxes.map((id) => (
                <button key={id} className="btn small" onClick={() => setPref(id, { hidden: undefined })}>
                  Visa {BOX_TITLE[id].toLowerCase()}
                </button>
              ))}
            </div>
          )}
          {anyBoxPrefs && (
            <div>
              <button className="btn small" onClick={resetAll}>
                Återställ alla rutor
              </button>
            </div>
          )}
        </div>
        {box && <BoxSheet id={box} names={names} all={all} onClose={() => setBox(null)} />}
        <label className="saver-row">
          <input
            type="checkbox"
            checked={!saverOff}
            onChange={(e) => {
              setScreensaverOff(!e.target.checked);
              setSaverOff(!e.target.checked);
            }}
          />
          <span>
            <b>Skärmsläckare på den här skärmen</b>
            <small className="muted"> Svart skärm med klocka på natten (tiderna ställs i Inställningar, standard 22–06) och fotoramen om den är på. Avstängd här även om det är på i inställningarna.</small>
          </span>
        </label>
      </div>
    </div>,
    document.body,
  );
}
