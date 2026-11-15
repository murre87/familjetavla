import type { FastifyBaseLogger } from "fastify";
import type { HaConn, HaState } from "./ha.js";

/**
 * Persistent WebSocket to Home Assistant (/api/websocket).
 *  - keeps a live copy of all states (get_states + state_changed), so the board reads states
 *    from memory and taps on the tablet are reflected within a second
 *  - gives structured access to the device/entity/area registries
 * Uses Node's built-in WebSocket (Node 22+). Reconnects with backoff.
 */
type Listener = (entityId: string) => void;
type ActionListener = (action: string) => void;

export class HaSocket {
  states = new Map<string, HaState>();
  connected = false;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private listeners = new Set<Listener>();
  private actionListeners = new Set<ActionListener>();
  private retry = 0;
  private timer: NodeJS.Timeout | null = null;
  private conn: HaConn | null = null;
  private stopped = false;
  /** Vakthund: ett försök som aldrig ansluter, eller en länk som slutat svara, stängs och öppnas igen. */
  private watchdog: NodeJS.Timeout | null = null;

  constructor(private log: FastifyBaseLogger) {}

  static wsUrl(conn: HaConn): string {
    // http://supervisor/core/api → ws://supervisor/core/websocket ; https://x:8123/api → wss://x:8123/api/websocket
    const base = conn.base.replace(/^http/, "ws");
    return base.endsWith("/core/api") ? base.replace(/\/core\/api$/, "/core/websocket") : `${base}/websocket`;
  }

  start(conn: HaConn | null) {
    this.stop();
    this.stopped = false;
    this.conn = conn;
    if (conn) this.open();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    for (const p of this.pending.values()) p.reject(new Error("WebSocket stängd"));
    this.pending.clear();
  }

  /** A button pressed in a notification on a phone (Home Assistant companion app). */
  onAction(fn: ActionListener) {
    this.actionListeners.add(fn);
    return () => this.actionListeners.delete(fn);
  }

  onChange(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Send a command and wait for its result. */
  call<T>(msg: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
    if (!this.ws || !this.connected) return Promise.reject(new Error("Inte ansluten till Home Assistant via WebSocket"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Home Assistant svarade inte"));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
      this.ws!.send(JSON.stringify({ id, ...msg }));
    });
  }

  private open() {
    const conn = this.conn!;
    let ws: WebSocket;
    try {
      ws = new WebSocket(HaSocket.wsUrl(conn));
    } catch (e) {
      this.log.warn(`HA WebSocket: ${(e as Error).message}`);
      return this.schedule();
    }
    this.ws = ws;
    // 2026-11-15: efter en omstart på natten hängde försöket medan Home Assistant fortfarande startade – inget fel,
    // ingen stängning, inget nytt försök – och tavlan blev utan sin livelänk (Musik: "Home Assistant svarar inte").
    // Därför: ansluten inom 20 s, och sedan en ping var 30:e sekund som måste besvaras inom 10 s.
    const opened = Date.now();
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (this.ws !== ws || this.stopped) return;
      if (!this.connected) {
        if (Date.now() - opened > 20_000) this.restart(ws, "fick ingen anslutning inom 20 s");
        return;
      }
      this.call({ type: "ping" }, 10_000).catch(() => this.restart(ws, "svarade inte på ping"));
    }, 30_000);
    // Events from a socket that has since been replaced (config saved → start()) are ignored,
    // otherwise its late onclose would open a second, duplicate connection.
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      try {
        void this.handle(ws, conn, JSON.parse(String(ev.data)));
      } catch {
        /* not JSON */
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      const was = this.connected;
      this.connected = false;
      if (was) this.log.warn("HA WebSocket stängdes – försöker igen");
      else if (this.retry === 0 && !this.stopped) this.log.warn(`Kunde inte ansluta till Home Assistant (${HaSocket.wsUrl(conn)}) – försöker igen`);
      if (!this.stopped) this.schedule();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  /** Ge upp den här anslutningen (den hänger) och öppna en ny. */
  private restart(ws: WebSocket, why: string) {
    if (this.ws !== ws || this.stopped) return;
    this.log.warn(`HA WebSocket ${why} – ansluter igen`);
    this.connected = false;
    this.ws = null;
    for (const p of this.pending.values()) p.reject(new Error("WebSocket stängd"));
    this.pending.clear();
    try {
      ws.close();
    } catch {
      /* already closed */
    }
    this.retry = 0;
    this.open();
  }

  private schedule() {
    if (this.stopped) return;
    const delay = Math.min(60_000, 1000 * 2 ** this.retry++);
    this.timer = setTimeout(() => this.open(), delay);
  }

  private async handle(ws: WebSocket, conn: HaConn, msg: { type: string; id?: number; success?: boolean; result?: unknown; error?: { message: string }; event?: { event_type?: string; data: { entity_id: string; new_state: HaState | null; action?: string } } }) {
    if (msg.type === "auth_required") {
      ws.send(JSON.stringify({ type: "auth", access_token: conn.token }));
    } else if (msg.type === "auth_invalid") {
      // A wrong token won't fix itself quickly, but a restored HA backup can: try again in 5 minutes.
      this.log.error("HA WebSocket: Home Assistant godkände inte token – försöker igen om 5 minuter");
      this.stopped = true;
      ws.close();
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.stopped = false;
        this.retry = 0;
        this.open();
      }, 5 * 60_000);
    } else if (msg.type === "auth_ok") {
      this.connected = true;
      this.retry = 0;
      this.log.info("Ansluten till Home Assistant via WebSocket");
      try {
        const states = await this.call<HaState[]>({ type: "get_states" });
        this.states = new Map(states.map((s) => [s.entity_id, s]));
        await this.call({ type: "subscribe_events", event_type: "state_changed" });
        for (const fn of this.listeners) fn("*");
        await this.call({ type: "subscribe_events", event_type: "mobile_app_notification_action" }).catch(() => {});
      } catch (e) {
        this.log.warn(`HA WebSocket: ${(e as Error).message}`);
      }
    } else if (msg.type === "pong" && msg.id !== undefined) {
      // Svaret på vakthundens ping (Home Assistant skickar "pong", inte "result").
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      p?.resolve(true);
    } else if (msg.type === "result" && msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.success) p.resolve(msg.result);
      else p.reject(new Error(msg.error?.message ?? "Fel från Home Assistant"));
    } else if (msg.type === "event" && msg.event?.event_type === "mobile_app_notification_action") {
      const action = msg.event.data.action;
      if (action) for (const fn of this.actionListeners) fn(action);
    } else if (msg.type === "event" && msg.event?.data) {
      const { entity_id, new_state } = msg.event.data;
      if (new_state) this.states.set(entity_id, new_state);
      else this.states.delete(entity_id);
      for (const fn of this.listeners) fn(entity_id);
    }
  }
}

let socket: HaSocket | null = null;

export function initHaSocket(log: FastifyBaseLogger) {
  socket = new HaSocket(log);
  return socket;
}

export function haSocket(): HaSocket | null {
  return socket;
}
