import { useEffect, useRef, useState } from "react";
import type { Dashboard } from "../../../server/src/types";
import { api } from "../api";
import { JUL_STORE, makeJulHass, type JulBridge } from "./hass";

type CardElement = HTMLElement & { setConfig: (c: unknown) => void; hass: unknown };

/** Fliken Jul: Nordpol Card (nedräkning, tomtekameror, släde, snällista och dagens tomte) i tavlan. Se README.md i den här mappen. */
export function JulPage({ jul }: { jul: NonNullable<Dashboard["jul"]> }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dead = false;
    let bridge: JulBridge | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const box = host.current;
    (async () => {
      try {
        await import("./nordpol-card.js");
        const first = await api.julNice().catch(() => ({ items: [] }));
        if (dead || !box) return;
        bridge = makeJulHass({ lat: jul.lat, lon: jul.lon, place: jul.place }, first.items);
        const el = document.createElement("nordpol-board-card") as CardElement;
        el.setConfig({
          language: "sv",
          nice: { store: JUL_STORE },
          // Kortet letar först efter lokala filmer i Home Assistants www-mapp. Här finns ingen sådan; ett data:-värde ger ingen träff utan nätverksanrop (annars ett 404 i konsolen per kamera). Klippen hämtas från kortets egen sida.
          cams: { file_dir: "data:," },
          sleigh: { home: { name: jul.place || "Hemma", lat: jul.lat, lon: jul.lon } },
        });
        el.hass = bridge.hass;
        box.replaceChildren(el);
        timer = setInterval(() => void bridge?.refresh(), 15_000); // flera skärmar följer samma snällista
      } catch {
        if (!dead) setFailed(true);
      }
    })();
    return () => {
      dead = true;
      if (timer) clearInterval(timer);
      bridge?.dispose();
      box?.replaceChildren();
    };
  }, [jul.lat, jul.lon, jul.place]);

  return (
    <div className="jul-page">
      <div ref={host} className="jul-host" />
      {failed && <p className="muted">Julkortet gick inte att ladda just nu.</p>}
    </div>
  );
}
