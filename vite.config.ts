import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  plugins: [solid()],
  root: "src/client",
  build: { outDir: "../../dist", emptyOutDir: true, target: "es2023" },
  server: {
    host: "127.0.0.1",
    port: 12000,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:12001" },
  },
});
