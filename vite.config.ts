import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
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
