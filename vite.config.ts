import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The FastAPI application serves the built bundle from `app/static/dist` and
// mounts it under `/static`, so every generated asset URL must carry that base.
export default defineConfig({
  base: "/static/dist/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./frontend/src", import.meta.url)),
    },
  },
  root: fileURLToPath(new URL("./frontend", import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL("./app/static/dist", import.meta.url)),
    emptyOutDir: true,
    // Production bundles ship inside the container image and are served
    // publicly; source maps would expose the full frontend source with them.
    sourcemap: false,
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000",
    },
  },
});
