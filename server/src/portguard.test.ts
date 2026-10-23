import { createServer } from "node:http";
import type { FastifyBaseLogger } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VERSION } from "./version.js";
import { checkOwnPort } from "./portguard.js";

const fakeLog = () => ({ warn: vi.fn() }) as unknown as FastifyBaseLogger & { warn: ReturnType<typeof vi.fn> };

/** Ephemeral stand-in on 127.0.0.1: either a foreign program or our own health route. */
async function onPort(answer: { status?: number; body: string; type?: string }): Promise<{ port: number; stop: () => Promise<void> }> {
  const srv = createServer((_req, res) => {
    res.writeHead(answer.status ?? 200, { "content-type": answer.type ?? "text/plain" });
    res.end(answer.body);
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = (srv.address() as { port: number }).port;
  return { port, stop: () => new Promise<void>((ok) => srv.close(() => ok())) };
}

describe("checkOwnPort", () => {
  let stop: () => Promise<void>;

  afterEach(async () => {
    await stop?.();
  });

  it("warns when a foreign server has taken the loopback address", async () => {
    // The exact failure observed in the wild: a Go server answers "404 page not found".
    const { port, stop: s } = await onPort({ status: 404, body: "404 page not found" });
    stop = s;
    const log = fakeLog();
    await checkOwnPort(port, log);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(log.warn).mock.calls[0][0])).toContain("Ett annat program");
  });

  it("stays quiet when we answer ourselves", async () => {
    const { port, stop: s } = await onPort({ body: JSON.stringify({ ok: true, version: VERSION }), type: "application/json" });
    stop = s;
    const log = fakeLog();
    await checkOwnPort(port, log);
    expect(log.warn).not.toHaveBeenCalled();
  });
});
