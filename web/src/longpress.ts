import { useRef, type MouseEvent, type PointerEvent, type TouchEvent } from "react";

/**
 * Holding a finger still on something for a moment (the gesture for "settings for just this box").
 *
 * A finger is followed with touch events and a mouse or pen with pointer events: Safari on an iPad
 * can cancel the pointer of a held finger (pointercancel) when its own long-press gesture starts,
 * and that gesture starts at about half a second, so the hold here is shorter than that.
 */
export function useLongPress(onLong: () => void, ms = 450) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
    start.current = null;
  };
  const begin = (x: number, y: number) => {
    clear();
    fired.current = false;
    start.current = { x, y };
    timer.current = window.setTimeout(() => {
      fired.current = true;
      clear();
      onLong();
    }, ms);
  };
  const moved = (x: number, y: number) => {
    const s = start.current;
    if (s && Math.hypot(x - s.x, y - s.y) > 12) clear();
  };
  return {
    onTouchStart: (e: TouchEvent) => {
      if (e.touches.length !== 1) return clear();
      begin(e.touches[0]!.clientX, e.touches[0]!.clientY);
    },
    onTouchMove: (e: TouchEvent) => moved(e.touches[0]!.clientX, e.touches[0]!.clientY),
    onTouchEnd: (e: TouchEvent) => {
      // Lifting the finger after the hold would "click" whatever is under it now: the new sheet's backdrop, which closes it.
      if (fired.current && e.cancelable) e.preventDefault();
      clear();
    },
    onTouchCancel: clear,
    onPointerDown: (e: PointerEvent) => {
      // Fingers go through the touch handlers above.
      if (e.pointerType === "touch") return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      begin(e.clientX, e.clientY);
    },
    onPointerMove: (e: PointerEvent) => {
      if (e.pointerType !== "touch") moved(e.clientX, e.clientY);
    },
    onPointerUp: (e: PointerEvent) => {
      if (e.pointerType !== "touch") clear();
    },
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType !== "touch") clear();
    },
    // No Safari/Android menu for a held finger.
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
    // The press that opened the settings must not also tap the button under the finger.
    onClickCapture: (e: MouseEvent) => {
      if (fired.current) {
        fired.current = false;
        e.stopPropagation();
        e.preventDefault();
      }
    },
  };
}
