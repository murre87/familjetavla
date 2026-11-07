import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon";
import { ARRANGE_EVENT, saveLayout } from "../layout";
import { COLS, DEFAULT_LAYOUT, gridOf, moveInRow, moveRow, resizeBox, swapBoxes, type Layout, type LayoutBox } from "../../../server/src/layout";
import { BOX_TITLE } from "./BoxSheet";

/**
 * "Ordna startsidan": the start page as a puzzle. Drag a box onto another to swap them, drag the edge between two
 * boxes to make one wider (the other gets narrower), or use the arrows. Nothing is saved until Klar.
 */
export function useArrange(saved: Layout, hidden: LayoutBox[]) {
  const [draft, setDraft] = useState<Layout | null>(null);
  const [history, setHistory] = useState<Layout[]>([]);
  const [drag, setDrag] = useState<{ id: LayoutBox; over?: LayoutBox } | null>(null);
  const resize = useRef<{ id: LayoutBox; x0: number; colW: number; base: Layout } | null>(null);

  useEffect(() => {
    const open = () => {
      setDraft(saved);
      setHistory([]);
    };
    window.addEventListener(ARRANGE_EVENT, open);
    return () => window.removeEventListener(ARRANGE_EVENT, open);
  }, [saved]);

  const arranging = draft !== null;
  const layout = draft ?? saved;
  const change = (next: Layout, from: Layout = layout) => {
    if (next === from) return;
    setHistory((h) => [...h, from].slice(-30));
    setDraft(next);
  };
  const places = gridOf(layout, hidden);
  const place = (id: LayoutBox) => places.find((p) => p.id === id);
  const rowOf = (id: LayoutBox) => layout.rows.findIndex((r) => r.ids.includes(id));

  const coverFor = (id: LayoutBox): ReactNode => {
    if (!arranging) return null;
    const p = place(id);
    if (!p) return null;
    const sameRow = places.filter((x) => x.row === p.row);
    const k = sameRow.findIndex((x) => x.id === id);
    const r = rowOf(id);
    const alone = layout.rows[r]!.ids.length === 1;
    const canUp = !(alone && r === 0);
    const canDown = !(alone && r === layout.rows.length - 1);
    const title = BOX_TITLE[id];
    return (
      <div
        className={`arr-cover ${drag?.id === id ? "arr-drag" : ""} ${drag?.over === id ? "arr-over" : ""}`}
        onPointerDown={(e: RPointerEvent<HTMLDivElement>) => {
          if ((e.target as HTMLElement).closest("button, .arr-edge")) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag({ id });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          const under = (document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-box]") as HTMLElement | null)?.dataset.box as LayoutBox | undefined;
          const over = under && under !== drag.id ? under : undefined;
          if (over !== drag.over) setDrag({ id: drag.id, over });
        }}
        onPointerUp={() => {
          if (drag?.over) change(swapBoxes(layout, drag.id, drag.over));
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <div className="arr-title">
          <Icon name="move" size={18} /> {title}
        </div>
        <div className="arr-tools" role="toolbar" aria-label={`Flytta ${title}`}>
          <button className="btn small icon" aria-label={`Flytta ${title} åt vänster`} disabled={k === 0} onClick={() => change(moveInRow(layout, id, -1))}>
            <Icon name="chevronLeft" size={18} />
          </button>
          <button className="btn small icon" aria-label={`Flytta ${title} upp`} disabled={!canUp} onClick={() => change(moveRow(layout, id, -1))}>
            <Icon name="chevronUp" size={18} />
          </button>
          <button className="btn small icon" aria-label={`Flytta ${title} ner`} disabled={!canDown} onClick={() => change(moveRow(layout, id, 1))}>
            <Icon name="chevronDown" size={18} />
          </button>
          <button className="btn small icon" aria-label={`Flytta ${title} åt höger`} disabled={k === sameRow.length - 1} onClick={() => change(moveInRow(layout, id, 1))}>
            <Icon name="chevronRight" size={18} />
          </button>
        </div>
        {sameRow.length > 1 && (
          <div className="arr-tools arr-size" role="group" aria-label={`Bredd för ${title}`}>
            <button className="btn small" aria-label={`Smalare ${title}`} disabled={p.span <= 2} onClick={() => change(resizeBox(layout, id, -1, hidden))}>
              Smalare
            </button>
            <span className="arr-span">{Math.round((p.span / COLS) * 100)} %</span>
            <button className="btn small" aria-label={`Bredare ${title}`} onClick={() => change(resizeBox(layout, id, 1, hidden))}>
              Bredare
            </button>
          </div>
        )}
        {/* The edge to the next box in the row: drag sideways to share the width between the two. */}
        {k < sameRow.length - 1 && (
          <div
            className="arr-edge"
            role="separator"
            aria-label={`Dra för att ändra bredden mellan ${title} och ${BOX_TITLE[sameRow[k + 1]!.id]}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              const grid = (e.currentTarget.closest(".hf") as HTMLElement | null)?.clientWidth ?? window.innerWidth;
              resize.current = { id, x0: e.clientX, colW: grid / COLS, base: layout };
            }}
            onPointerMove={(e) => {
              const s = resize.current;
              if (!s) return;
              const cols = Math.round((e.clientX - s.x0) / s.colW);
              setDraft(resizeBox(s.base, s.id, cols, hidden));
            }}
            onPointerUp={() => {
              const s = resize.current;
              resize.current = null;
              if (s && draft && draft !== s.base) setHistory((h) => [...h, s.base].slice(-30));
            }}
            onPointerCancel={() => {
              const s = resize.current;
              resize.current = null;
              if (s) setDraft(s.base);
            }}
          >
            <span />
          </div>
        )}
      </div>
    );
  };

  const bar = arranging
    ? createPortal(
        <div className="arr-bar" role="toolbar" aria-label="Ordna startsidan">
          <div className="arr-help">
            <b>Ordna startsidan</b>
            <small>Dra en ruta till en annan för att byta plats. Dra i strecket mellan två rutor för att göra en bredare.</small>
          </div>
          <button className="btn" disabled={!history.length} onClick={() => {
            const prev = history[history.length - 1];
            if (!prev) return;
            setHistory((h) => h.slice(0, -1));
            setDraft(prev);
          }}>
            Ångra
          </button>
          <button className="btn" onClick={() => change(DEFAULT_LAYOUT)}>
            Återställ
          </button>
          <button className="btn" onClick={() => setDraft(null)}>
            Avbryt
          </button>
          <button
            className="btn primary"
            onClick={() => {
              if (draft) saveLayout(draft);
              setDraft(null);
            }}
          >
            Klar
          </button>
        </div>,
        document.body,
      )
    : null;

  return { arranging, layout, coverFor, bar };
}
