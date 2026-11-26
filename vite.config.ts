
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base:
    process.env.GITHUB_ACTIONS === "true"
      ? "/tactical-xband-digital-twin/"
      : "./",

  server: {
    port: Number(process.env.PORT) || 3000,
    open: false,
    host: "0.0.0.0",
  },

  preview: {
    port: Number(process.env.PORT) || 3000,
    open: false,
    host: "0.0.0.0",
  },

  worker: {
    format: "es",
  },

  build: {
    target: "esnext",
    sourcemap: process.env.VITE_SOURCEMAP === "true",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        docs: resolve(__dirname, "docs.html"),
      },
      output: {
        manualChunks: {
          'vendor-three': ['three'],
          'vendor-maplibre': ['maplibre-gl'],
        },
      },
    },
  },
});
