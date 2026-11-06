import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// The version this bundle was built as: a board left open reloads itself when the server runs a newer one.
const version = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version;

const demo = Boolean(process.env.VITE_DEMO);

// base "./" so the app also works under Home Assistant ingress (/api/hassio_ingress/<token>/).
// VITE_DEMO=1 builds a self-contained demo on sample data (npm run build:demo).
export default defineConfig({
  base: "./",
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: { "@demo": fileURLToPath(new URL(demo ? "./src/demo/demoApi.ts" : "./src/demo/noDemo.ts", import.meta.url)) },
  },
  server: { port: 5173, proxy: { "/api": "http://localhost:8099" } },
  build: { outDir: demo ? "dist-demo" : "dist", emptyOutDir: true },
});
