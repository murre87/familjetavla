import fastifyStatic from "@fastify/static";
import Fastify, { LogController } from "fastify";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { haConnection } from "./connectors/ha.js";
import { initHaSocket } from "./connectors/haws.js";
import { startNotifier } from "./notify.js";
import { checkOwnPort } from "./portguard.js";
import { startPublisher } from "./publisher.js";
import { registerRoutes } from "./routes.js";
import { startScheduler } from "./scheduler.js";

process.env.TZ ??= "Europe/Stockholm";

const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(process.env.WEB_DIST ?? join(here, "../../web/dist"));
const port = Number(process.env.PORT ?? 8099);

// Every request at info level would flood the add-on log; errors and warnings still show.
const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  logController: new LogController({ disableRequestLogging: process.env.LOG_LEVEL !== "debug" }),
  bodyLimit: 256 * 1024,
  trustProxy: false,
});

// A stray rejected promise in a background job must not take the whole board down.
process.on("unhandledRejection", (e) => app.log.error({ err: e }, "Ohanterat fel i bakgrunden"));
process.on("uncaughtException", (e) => app.log.error({ err: e }, "Oväntat fel"));

const socket = initHaSocket(app.log);
socket.start(haConnection());

await registerRoutes(app);

if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, prefix: "/" });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Hittades inte" });
    // A missing script or image is a 404 – never index.html, which a cached old page would choke on.
    if (/\.[a-z0-9]{1,8}(\?|$)/i.test(req.url)) return reply.code(404).send("Hittades inte");
    return reply.sendFile("index.html");
  });
} else {
  app.log.warn(`Webben är inte byggd (${webDist}). Kör "npm run build".`);
}

await app.listen({ host: "0.0.0.0", port });
// Verifies that localhost actually reaches us – see portguard.ts for why it can silently not.
await checkOwnPort(port, app.log);
startScheduler(app.log);
startPublisher(app.log);
startNotifier(app.log);

// Home Assistant and Docker stop the add-on with SIGTERM; without this it waits for the kill timeout.
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, () => {
    app.log.info(`${sig} – stänger av`);
    socket.stop();
    const force = setTimeout(() => process.exit(0), 3000);
    force.unref();
    void app.close().finally(() => process.exit(0));
  });
}
