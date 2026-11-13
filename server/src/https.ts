import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { X509Certificate } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { join } from "node:path";

/**
 * https on a second port (8443) with the same certificate as Home Assistant – Let's Encrypt,
 * DuckDNS or your own. Only over https will Chrome install the board as a real app. Plain http on
 * 8099 stays as it is (Home Assistant's own window and older tablets use it).
 *
 * The add-on reads Home Assistant's /ssl folder; with Docker, mount the folder with the
 * certificate on /ssl (or set SSL_CERT and SSL_KEY).
 */

const SSL_DIR = process.env.SSL_DIR ?? "/ssl";

export function certPaths(env = process.env): { cert: string; key: string } | null {
  const cert = env.SSL_CERT ?? join(SSL_DIR, env.SSL_CERTFILE ?? "fullchain.pem");
  const key = env.SSL_KEY ?? join(SSL_DIR, env.SSL_KEYFILE ?? "privkey.pem");
  return existsSync(cert) && existsSync(key) ? { cert, key } : null;
}

/** The names the certificate is valid for, e.g. "hemma.duckdns.org" – the address to open on the tablet. */
export function certNames(pem: string): string[] {
  try {
    const c = new X509Certificate(pem);
    const alt = (c.subjectAltName ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.startsWith("DNS:"))
      .map((s) => s.slice(4));
    const cn = /CN=([^\n,]+)/.exec(c.subject)?.[1];
    return [...new Set([...alt, ...(cn ? [cn] : [])])].filter((n) => /^[a-z0-9.-]+$/i.test(n) && !n.startsWith("*"));
  } catch {
    return [];
  }
}

/**
 * The address to show for https: HTTPS_HOST when set, else the certificate's own name (CN), else its first other name.
 * A certificate for several sites (here also a work domain) listed another name first, and the board showed that.
 */
export function httpsName(pem: string, env = process.env): string | undefined {
  const fixed = env.HTTPS_HOST?.trim();
  if (fixed && /^[a-z0-9.-]+$/i.test(fixed)) return fixed;
  const names = certNames(pem);
  try {
    const cn = /CN=([^\n,]+)/.exec(new X509Certificate(pem).subject)?.[1];
    if (cn && names.includes(cn)) return cn;
  } catch {
    /* not a certificate */
  }
  return names[0];
}

let secure: { url: string } | null = null;
/** "https://hemma.duckdns.org:8443/" when https runs, else null. */
export const secureUrl = () => secure?.url ?? null;

export async function startHttps(app: FastifyInstance, log: FastifyBaseLogger): Promise<Server | null> {
  const paths = certPaths();
  if (!paths) return null;
  const port = Number(process.env.HTTPS_PORT ?? 8443);
  const read = () => ({ cert: readFileSync(paths.cert), key: readFileSync(paths.key) });
  let files: { cert: Buffer; key: Buffer };
  try {
    files = read();
  } catch (e) {
    log.warn({ err: e }, "https: certifikatet kunde inte läsas – tavlan körs bara på http");
    return null;
  }
  const server = createServer(files, (req, res) => app.routing(req, res));
  server.on("tlsClientError", () => undefined);
  try {
    await new Promise<void>((ok, fail) => {
      server.once("error", fail);
      server.listen(port, "0.0.0.0", () => ok());
    });
  } catch (e) {
    log.warn({ err: e }, `https: port ${port} gick inte att öppna – tavlan körs bara på http`);
    return null;
  }
  const name = httpsName(files.cert.toString());
  secure = name ? { url: `https://${name}:${port}/` } : null;
  log.info(`https på port ${port}${secure ? ` – öppna ${secure.url}` : ""}`);

  // Let's Encrypt renews every 60–90 days: pick up the new certificate without a restart.
  let stamp = statSync(paths.cert).mtimeMs;
  const t = setInterval(() => {
    try {
      const now = statSync(paths.cert).mtimeMs;
      if (now === stamp) return;
      stamp = now;
      server.setSecureContext(read());
      log.info("https: nytt certifikat inläst");
    } catch (e) {
      log.warn({ err: e }, "https: det nya certifikatet kunde inte läsas");
    }
  }, 6 * 3600_000);
  t.unref();
  return server;
}
