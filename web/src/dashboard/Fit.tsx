import { useLayoutEffect, useRef, useState } from "react";

/** Smallest scale we accept – below this text gets too small to read across the room. */
const MIN = 0.7;
/** Room kept free at the bottom for the "+N till" button when items are hidden. */
const HINT = 40;

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
        const height = () => i.getBoundingClientRect().height;
        if (avail) {
          let h = height();
          let scale = 1;
          // Scaling changes line breaks, so measure again and adjust once more.
          for (let pass = 0; pass < 3 && h > avail + 1 && scale > min; pass++) {
            scale = Math.max(min, scale * (avail / h));
            i.style.zoom = String(scale);
            h = height();
          }
          if (h > avail + 1 && more) {
            // Still too tall: hide whole items from the end – never half an item – and offer the rest behind a button.
            while (cut < kids.length - 1 && height() > avail - HINT) {
              kids[kids.length - 1 - cut].style.display = "none";
              cut++;
            }
            // The last card is still too tall to leave room for the button: let it drop its extras (".fit-tight").
            if (height() > avail - HINT) {
              o.classList.add("fit-tight");
              height();
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
