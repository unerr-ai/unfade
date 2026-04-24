import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: ".",
  publicDir: false,
  build: {
    outDir: "dist/ui",
    emptyOutDir: true,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src/ui") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:7654",
      "/unfade": "http://localhost:7654",
      "/mcp": "http://localhost:7654",
    },
  },
});
