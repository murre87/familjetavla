import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon";
import { PAGE_SIZE_MAX, PAGE_SIZE_MIN, usePagePrefs } from "../pageprefs";

/** The cog on a tab or page (next to Hem): settings for just that page on this screen. */
export function PageGear({ id, title }: { id: string; title: string }) {
  const [sheet, setSheet] = useState(false);
  return (
    <>
      <button className="btn icon page-gear" aria-label={`Inställningar för ${title}`} title={`Inställningar för ${title}`} onClick={() => setSheet(true)}>
        <Icon name="gear" size={22} />
      </button>
      {sheet && <PageSheet id={id} title={title} onClose={() => setSheet(false)} />}
    </>
  );
}

export function PageSheet({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  const { prefs, setSize } = usePagePrefs();
  const size = prefs[id]?.size ?? 1;
  const pct = Math.round(size * 100);
  // The tap that opened the sheet is not a tap on its backdrop.
  const opened = useRef(0);
  useEffect(() => {
    opened.current = Date.now();
  }, []);
  return createPortal(
    <div className="overlay" onClick={() => Date.now() - opened.current > 600 && onClose()}>
      <div className="sheet box-sheet" role="dialog" aria-modal="true" aria-label={`Inställningar för ${title}`} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="row gap">
          <h2 className="grow" style={{ fontSize: 24 }}>
            {title}
          </h2>
          <button className="btn icon" aria-label="Stäng" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Gäller bara den här sidan på den här skärmen.
        </p>
        <div className="field">
          <span>Textstorlek: {pct} %</span>
          <div className="scale-row">
            <button className="btn icon" aria-label="Mindre text" onClick={() => setSize(id, size - 0.1)} disabled={size <= PAGE_SIZE_MIN}>
              <Icon name="minus" />
            </button>
            <input type="range" min={PAGE_SIZE_MIN * 100} max={PAGE_SIZE_MAX * 100} step={5} value={pct} aria-label="Textstorlek i procent" onChange={(e) => setSize(id, Number(e.target.value) / 100)} />
            <button className="btn icon" aria-label="Större text" onClick={() => setSize(id, size + 0.1)} disabled={size >= PAGE_SIZE_MAX}>
              <Icon name="plus" />
            </button>
          </div>
          <small className="muted">Får inte allt plats rullar du på sidan.</small>
        </div>
        <div className="row gap">
          <button className="btn" onClick={() => setSize(id, 1)} disabled={size === 1}>
            Återställ
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
