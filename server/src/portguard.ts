import type { FastifyBaseLogger } from "fastify";
import { VERSION } from "./version.js";

/**
 * Called right after listen: ask our own health route on the loopback address. A specific bind
 * on 127.0.0.1 beats our wildcard bind (macOS/BSD), so the port "works" while traffic to
 * localhost goes to another program – without a single log line. Warn when someone else answers.
 */
export async function checkOwnPort(port: number, log: FastifyBaseLogger): Promise<void> {
  type Health = { ok?: boolean; version?: string } | null;
  let who: Health = null;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3000) });
    who = (await res.json().catch(() => null)) as Health;
  } catch {
    return; // best effort – a refused self-connect cannot happen while we just bound the wildcard
  }
  if (who?.ok && who.version === VERSION) return;
  log.warn(`Ett annat program svarar på http://127.0.0.1:${port} – trafik till localhost når inte tavlan. Hitta processen med: lsof -nP -iTCP:${port} -sTCP:LISTEN (macOS/Linux), stäng av den – eller kör tavlan på en annan port: PORT=<nummer> npm start.`);
}
