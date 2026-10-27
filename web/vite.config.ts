import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, "..");

const apiProxy = {
  "/api": {
    target: "http://127.0.0.1:3001",
    changeOrigin: true,
  },
};

export default defineConfig({
  root,
  envDir: projectRoot,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: apiProxy,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    proxy: apiProxy,
  },
  build: {
    outDir: path.resolve(projectRoot, "dist", "web"),
    emptyOutDir: true,
  },
});
