import { fetchWithTimeout } from "../http.js";
import { getSecret, loadConfig } from "../store.js";
import type { CalEvent } from "./ics.js";

export interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown> & { friendly_name?: string; unit_of_measurement?: string };
  last_changed: string;
}

export interface HaConn {
  base: string; // ends with /api
  token: string;
}

/** Resolve how to reach Home Assistant: Supervisor proxy inside the add-on, else URL + token. */
export function haConnection(override?: { url?: string; token?: string }): HaConn | null {
  if (override?.url && override.token) {
    return { base: `${override.url.replace(/\/+$/, "")}/api`, token: override.token };
  }
  const cfg = loadConfig();
  if (cfg.ha.mode === "supervisor" && process.env.SUPERVISOR_TOKEN) {
    return { base: "http://supervisor/core/api", token: process.env.SUPERVISOR_TOKEN };
  }
  if (cfg.ha.mode === "manual" && cfg.ha.url) {
    const token = getSecret("ha.token");
    if (token) return { base: `${cfg.ha.url.replace(/\/+$/, "")}/api`, token };
  }
  return null;
}

async function call<T>(conn: HaConn, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithTimeout(`${conn.base}${path}`, {
    ...init,
    timeoutMs: 10_000,
    headers: { authorization: `Bearer ${conn.token}`, "content-type": "application/json" },
  });
  if (res.status === 401) throw new Error("Home Assistant nekade åtkomst – kontrollera token.");
  if (!res.ok) throw new Error(`Home Assistant svarade ${res.status} på ${path}`);
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("json") ? await res.json() : await res.text()) as T;
}

export const ha = {
  ping: (c: HaConn) => call<{ message: string }>(c, "/"),
  states: (c: HaConn) => call<HaState[]>(c, "/states"),
  services: (c: HaConn) => call<{ domain: string; services: Record<string, unknown> }[]>(c, "/services"),
  state: (c: HaConn, id: string) => call<HaState>(c, `/states/${encodeURIComponent(id)}`),
  service: (c: HaConn, domain: string, service: string, data: Record<string, unknown>, returnResponse = false) =>
    call<unknown>(c, `/services/${domain}/${service}${returnResponse ? "?return_response" : ""}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  async calendarEvents(c: HaConn, entityId: string, from: Date, to: Date): Promise<CalEvent[]> {
    type HaEv = { start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string }; summary: string; location?: string; description?: string; uid?: string };
    const q = `?start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(to.toISOString())}`;
    const list = await call<HaEv[]>(c, `/calendars/${encodeURIComponent(entityId)}${q}`).catch(async (e: Error) => {
      // An unavailable calendar answers 400 – say that instead of the bare status.
      const st = await call<HaState>(c, `/states/${encodeURIComponent(entityId)}`).catch(() => null);
      if (!st) throw new Error(`Kalendern ${entityId} finns inte i Home Assistant längre.`);
      if (st.state === "unavailable") throw new Error(`Kalendern ${st.attributes.friendly_name ?? entityId} är otillgänglig i Home Assistant – kontrollera integrationen.`);
      throw e;
    });
    return list.map((e) => {
      const allDay = !e.start.dateTime;
      const parse = (v: { dateTime?: string; date?: string }) => {
        if (v.dateTime) return new Date(v.dateTime);
        const [y, m, d] = (v.date ?? "").split("-").map(Number);
        return new Date(y, m - 1, d);
      };
      return { start: parse(e.start), end: parse(e.end), allDay, title: e.summary, location: e.location, description: e.description, uid: e.uid || undefined };
    });
  },

  /** Render a Jinja template – the only REST route to the device and area registries. */
  template: (c: HaConn, template: string) =>
    call<string>(c, "/template", { method: "POST", body: JSON.stringify({ template }) }),

  /** Raw numeric history points (the first one is the state at `from`). */
  async historyRaw(c: HaConn, entityIds: string[], from: Date, to: Date): Promise<Record<string, { t: number; v: number }[]>> {
    const q =
      `/history/period/${encodeURIComponent(from.toISOString())}` +
      `?filter_entity_id=${entityIds.map(encodeURIComponent).join(",")}` +
      `&end_time=${encodeURIComponent(to.toISOString())}&minimal_response&no_attributes`;
    const raw = await call<{ entity_id?: string; state: string; last_changed: string }[][]>(c, q);
    const out: Record<string, { t: number; v: number }[]> = {};
    raw.forEach((series, i) => {
      const id = series[0]?.entity_id ?? entityIds[i];
      out[id] = series.map((p) => ({ t: new Date(p.last_changed).getTime(), v: Number(p.state) })).filter((p) => Number.isFinite(p.v));
    });
    return out;
  },

  /** Numeric history, averaged into `bucketMin` buckets. */
  async history(c: HaConn, entityIds: string[], from: Date, to: Date, bucketMin = 30): Promise<Record<string, (number | null)[]>> {
    const q =
      `/history/period/${encodeURIComponent(from.toISOString())}` +
      `?filter_entity_id=${entityIds.map(encodeURIComponent).join(",")}` +
      `&end_time=${encodeURIComponent(to.toISOString())}&minimal_response&no_attributes`;
    const raw = await call<{ entity_id?: string; state: string; last_changed: string }[][]>(c, q);
    const buckets = Math.ceil((to.getTime() - from.getTime()) / (bucketMin * 60_000));
    const out: Record<string, (number | null)[]> = {};
    raw.forEach((series, i) => {
      const id = series[0]?.entity_id ?? entityIds[i];
      const sum = new Array(buckets).fill(0);
      const cnt = new Array(buckets).fill(0);
      let last: number | null = null;
      for (const p of series) {
        const v = Number(p.state);
        if (!Number.isFinite(v)) continue;
        const b = Math.floor((new Date(p.last_changed).getTime() - from.getTime()) / (bucketMin * 60_000));
        if (b >= 0 && b < buckets) {
          sum[b] += v;
          cnt[b] += 1;
        }
      }
      // Carry the previous value forward through buckets without changes (step function).
      out[id] = sum.map((s, b) => {
        if (cnt[b]) last = s / cnt[b];
        return last;
      });
    });
    return out;
  },

  /** Automations in automations.yaml – the same API HA's own editor uses. Needs an admin token. */
  automationConfig: (c: HaConn, id: string) => call<unknown>(c, `/config/automation/config/${encodeURIComponent(id)}`),
  saveAutomation: (c: HaConn, id: string, config: unknown) =>
    call<unknown>(c, `/config/automation/config/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(config) }),
  deleteAutomation: (c: HaConn, id: string) => call<unknown>(c, `/config/automation/config/${encodeURIComponent(id)}`, { method: "DELETE" }),

  async todoItems(c: HaConn, entityId: string): Promise<{ uid: string; summary: string; status: string }[]> {
    const res = (await ha.service(c, "todo", "get_items", { entity_id: entityId }, true)) as {
      service_response?: Record<string, { items: { uid: string; summary: string; status: string }[] }>;
    };
    return res.service_response?.[entityId]?.items ?? [];
  },
};
