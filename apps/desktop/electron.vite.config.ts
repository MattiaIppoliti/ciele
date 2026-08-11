import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

// Defaults everywhere they fit: entries at src/main, src/preload and
// src/renderer, output under out/. The one thing worth spelling out is that
// nothing is externalised — every dependency is bundled, so the packaged app
// ships no node_modules (see the note in package.json).
export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "src/main/index.ts") } },
    },
  },
  preload: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "src/preload/index.ts") } },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "src/renderer/index.html") } },
    },
  },
});
