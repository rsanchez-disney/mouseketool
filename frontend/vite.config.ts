import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    watch: {
      usePolling: true,
    },
    proxy: {
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        timeout: 600000,
        configure: (proxy) => {
          proxy.on("proxyReq", (_proxyReq, req) => {
            if (req.url?.includes("/execute") || req.url?.includes("/batch-runs/simple")) {
              (req as any).socket?.setTimeout(600000);
            }
          });
          proxy.on("proxyRes", (proxyRes, req, res) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache";
              proxyRes.headers["x-accel-buffering"] = "no";
              // Flush proxy buffer for SSE
              (res as any).flushHeaders?.();
            }
          });
        },
      },
    },
  },
});
