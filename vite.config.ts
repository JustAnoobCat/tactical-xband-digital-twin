
import { defineConfig } from "vite";

export default defineConfig({
  base:
    process.env.GITHUB_ACTIONS === "true"
      ? "/tactical-xband-digital-twin/"
      : "/",

  server: {
    port: 8000,
    open: true,
    host: "0.0.0.0",
  },

  preview: {
    port: 8000,
    open: true,
    host: "0.0.0.0",
  },

  worker: {
    format: "es",
  },

  build: {
    target: "esnext",
    sourcemap: true,
  },
});
