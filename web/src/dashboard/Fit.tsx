import { useLayoutEffect, useRef, useState } from "react";

/** Smallest scale we accept – below this text gets too small to read across the room. */
const MIN = 0.7;
/** Room kept free at the bottom for the "+N till" button when items are hidden. */
const HINT = 52;
/** Last resort when a single remaining card still collides with the "+N" button. */
const FLOOR = 0.55;

/**
 * An area that fits its content on a tablet. When CSS puts it in fit mode (fixed height, see `.fit`
 * in styles.css) and the content is taller, the content is scaled down until it fits. If even the
 * smallest readable scale is too big:
 *  - with `more`, the last items are hidden and `more(n)` renders a button for them (no scrolling);
 *  - without, the area scrolls as a last resort.
 * On phones the area is a normal block and the page scrolls as usual.
 */
export function Fit({
  className = "",
  children,
  deps = [],
  more,
  min = MIN,
}: {
  className?: string;
  children: React.ReactNode;
  deps?: unknown[];
  more?: (hidden: number) => React.ReactNode;
  /** Smallest scale for this area; where items can be hidden behind "+N", keep text bigger. */
  min?: number;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(0);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const fit = () => {
      const kids = [...i.children] as HTMLElement[];
      kids.forEach((k) => (k.style.display = ""));
      i.style.zoom = "1";
      o.classList.remove("fit-overflow", "fit-tight");
      let cut = 0;
      if (getComputedStyle(o).overflowY === "auto") {
        const avail = o.clientHeight;
        // The page can be zoomed as a whole (skärmstorlek): the rectangle is then in screen pixels while the area's height is in the page's own.
        const pageZoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        const height = () => i.getBoundingClientRect().height / pageZoom;
        if (avail) {
          let h = height();
          let scale = 1;
          // Scaling changes line breaks, so measure again and adjust once more.
          // (A few more passes and a hair of margin: text re-wraps as it shrinks, so one step rarely lands exactly.)
          for (let pass = 0; pass < 6 && h > avail + 1 && scale > min; pass++) {
            scale = Math.max(min, scale * (avail / h) * 0.99);
            i.style.zoom = String(scale);
            h = height();
          }
          if (h > avail + 1 && more) {
            // Still too tall: hide whole items that don't fit – never half an item – and offer the rest behind a button.
            // First fit: keep the order, but a card that doesn't fit is skipped so a smaller one after it can use the room.
            kids.forEach((k) => (k.style.display = "none"));
            let shown = 0;
            for (const k of kids) {
              k.style.display = "";
              if (shown > 0 && height() > avail - HINT) k.style.display = "none";
              else shown++;
            }
            cut = kids.length - shown;
            // The last card is still too tall to leave room for the button: let it drop its extras (".fit-tight").
            if (height() > avail - HINT) {
              o.classList.add("fit-tight");
              h = height();
              // Still in the way of the button (one big card): shrink it a little more rather than let the button cover it.
              for (let pass = 0; pass < 4 && h > avail - HINT && scale > FLOOR; pass++) {
                scale = Math.max(FLOOR, scale * ((avail - HINT) / h) * 0.99);
                i.style.zoom = String(scale);
                h = height();
              }
            }
          } else if (h > avail + 1) o.classList.add("fit-overflow");
        }
      }
      setHidden(cut);
    };
    fit();
    const ro = new ResizeObserver(() => fit());
    ro.observe(o);
    window.addEventListener("resize", fit);
    // Text measured before the web font has loaded is the wrong size: measure again once it has.
    let alive = true;
    document.fonts?.ready.then(() => alive && fit());
    return () => {
      alive = false;
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return (
    <div ref={outer} className={`fit ${className}`}>
      <div ref={inner} className="fit-inner">
        {children}
      </div>
      {hidden > 0 && more && <div className="fit-more">{more(hidden)}</div>}
    </div>
  );
}
