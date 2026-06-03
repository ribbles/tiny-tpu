import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { createReadStream } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Vite dev-server middleware that serves /tiny_tpu.mjs as a raw static JS
 * file, bypassing Vite's transform pipeline.
 *
 * Why: Vite 6 rejects dynamic imports of public/ files at request time (it
 * adds ?import and then throws a 500). This middleware intercepts any request
 * whose path starts with /tiny_tpu.mjs and streams the file directly,
 * short-circuiting Vite's module resolution.
 *
 * In production the file is served by the static host; this plugin has no
 * effect there.
 */
const wasmJsPassthrough = {
  name: "wasm-js-passthrough",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url && req.url.startsWith("/tiny_tpu.mjs")) {
        const filePath = join(__dirname, "public", "tiny_tpu.mjs");
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        createReadStream(filePath).pipe(res);
      } else {
        next();
      }
    });
  },
};

export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tailwindcss(), wasmJsPassthrough],
    build: {
      rollupOptions: {
        // /tiny_tpu.mjs lives in public/ and is served at runtime from the web
        // root — Rollup must not attempt to bundle or resolve it at build time.
        external: ["/tiny_tpu.mjs"],
      },
    },
  },
});
