/**
 * Ett litet eget "hass" åt Nordpol Card (se README.md i den här mappen). Kortet är skrivet för Home Assistant och ber
 * hass om plats, tidszon och en att-göra-lista för snällistan. Här kommer platsen från tavlan och listan sparas i
 * tavlans egen fil via /api/jul/nice, så kortet fungerar även utan Home Assistant.
 */
import { api } from "../api";

export const JUL_STORE = "todo.nordpol_nice_list";

export interface JulItem {
  uid: string;
  summary: string;
  status: "needs_action" | "completed";
  description?: string;
}

export interface JulHome {
  lat: number;
  lon: number;
  place: string;
}

type Listener = (msg: { items: JulItem[] }) => void;

export interface JulHass {
  states: Record<string, { entity_id: string; state: string; attributes: Record<string, unknown> }>;
  config: { latitude: number; longitude: number; time_zone: string; location_name: string; language: string };
  language: string;
  locale: { language: string };
  callWS: (msg: { type: string; entity_id?: string }) => Promise<{ items: JulItem[] }>;
  callService: (domain: string, service: string, data?: Record<string, unknown>, target?: unknown, notify?: boolean, returnResponse?: boolean) => Promise<unknown>;
  connection: { subscribeMessage: (cb: Listener, msg: { type: string; entity_id?: string }) => Promise<() => void> };
}

export interface JulBridge {
  hass: JulHass;
  /** Hämtar listan på nytt (så att flera skärmar följer varandra) och lämnar tillbaka hass att ge kortet. */
  refresh: () => Promise<void>;
  dispose: () => void;
}

export function makeJulHass(home: JulHome, initial: JulItem[] = []): JulBridge {
  let items: JulItem[] = initial;
  const listeners = new Set<Listener>();
  let disposed = false;

  const state = () => ({ entity_id: JUL_STORE, state: String(items.length), attributes: { friendly_name: "Snällistan" } });
  const set = (next: JulItem[]) => {
    if (disposed) return;
    const same = JSON.stringify(next) === JSON.stringify(items);
    items = next;
    hass.states[JUL_STORE] = state();
    if (!same) listeners.forEach((l) => l({ items }));
  };

  const hass: JulHass = {
    states: { [JUL_STORE]: state() },
    config: {
      latitude: home.lat,
      longitude: home.lon,
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Stockholm",
      location_name: home.place || "Hemma",
      language: "sv",
    },
    language: "sv",
    locale: { language: "sv" },
    callWS: async (msg) => (msg.type === "todo/item/list" ? { items } : { items: [] }),
    callService: async (domain, service, data = {}, _target, _notify, returnResponse) => {
      if (domain !== "todo") return undefined; // input_text (kortets valfria tomteloggg) används inte här
      if (service === "get_items") return returnResponse ? { response: { [JUL_STORE]: { items } } } : undefined;
      const r = await api.julService(service, data);
      set(r.items);
      return undefined;
    },
    connection: {
      subscribeMessage: async (cb, msg) => {
        if (msg.type !== "todo/item/subscribe") return () => undefined;
        listeners.add(cb);
        cb({ items });
        return () => void listeners.delete(cb);
      },
    },
  };

  return {
    hass,
    refresh: async () => {
      try {
        set((await api.julNice()).items);
      } catch {
        /* tillfälligt nätfel: behåll listan som den är */
      }
    },
    dispose: () => {
      disposed = true;
      listeners.clear();
    },
  };
}
