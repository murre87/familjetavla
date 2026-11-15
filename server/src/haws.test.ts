import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HaSocket } from "./connectors/haws.js";

/** En WebSocket som inte gör något själv: testet bestämmer vad Home Assistant säger. */
class FakeWs {
  static made: FakeWs[] = [];
  sent: Record<string, unknown>[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeWs.made.push(this);
  }
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close() {
    this.closed = true;
  }
  say(msg: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const log = { info: () => {}, warn: () => {}, error: () => {} } as never;
const conn = { base: "http://ha:8123/api", token: "t" } as never;

describe("HA WebSocket vaktar sin anslutning", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWs.made = [];
    vi.stubGlobal("WebSocket", FakeWs);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("öppnar en ny anslutning när första försöket hänger sig (omstart på natten, HA startar fortfarande)", async () => {
    const s = new HaSocket(log);
    s.start(conn);
    expect(FakeWs.made).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(FakeWs.made[0]!.closed).toBe(true);
    expect(FakeWs.made).toHaveLength(2);
    s.stop();
  });

  const connect = async (s: HaSocket) => {
    s.start(conn);
    const ws = FakeWs.made.at(-1)!;
    ws.say({ type: "auth_required" });
    ws.say({ type: "auth_ok" });
    // get_states och prenumerationerna besvaras
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(0);
      const last = ws.sent.at(-1) as { id?: number };
      if (last?.id) ws.say({ type: "result", id: last.id, success: true, result: [] });
    }
    await vi.advanceTimersByTimeAsync(0);
    return ws;
  };

  it("ansluter igen när Home Assistant slutar svara på ping", async () => {
    const s = new HaSocket(log);
    const ws = await connect(s);
    expect(s.connected).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ws.sent.at(-1)).toMatchObject({ type: "ping" });
    await vi.advanceTimersByTimeAsync(10_500);
    expect(ws.closed).toBe(true);
    expect(FakeWs.made.length).toBeGreaterThan(1);
    s.stop();
  });

  it("behåller anslutningen när ping får sitt pong", async () => {
    const s = new HaSocket(log);
    const ws = await connect(s);
    for (let round = 0; round < 3; round++) {
      await vi.advanceTimersByTimeAsync(30_000);
      const ping = ws.sent.at(-1) as { id: number; type: string };
      expect(ping.type).toBe("ping");
      ws.say({ type: "pong", id: ping.id });
    }
    await vi.advanceTimersByTimeAsync(10_500);
    expect(ws.closed).toBe(false);
    expect(FakeWs.made).toHaveLength(1);
    expect(s.connected).toBe(true);
    s.stop();
  });
});
