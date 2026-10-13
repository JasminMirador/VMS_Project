import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
// import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig(({ mode }) => {
  // '' prefix = load ALL variables from .env, not only VITE_ ones
  const env = loadEnv(mode, process.cwd(), "");

  const API_HOST = env.VITE_API_HOST;
  const API_PORT = env.VITE_API_PORT || "8000";

  const BACKEND_HTTP = `http://${API_HOST}:${API_PORT}`;
  const BACKEND_WS   = `ws://${API_HOST}:${API_PORT}`;
  const EXTERNAL_AI  = `http://${env.EXTERNAL_AI_HOST}:${env.EXTERNAL_AI_PORT}`;
  const MEDIAMTX     = `http://${env.MEDIAMTX_HOST}:${env.MEDIAMTX_PORT}`;

  return {
    plugins: [
      react(),
      // basicSsl()
    ],
    server: {
      host: true,
      allowedHosts: true,
      proxy: {
        "/api": {
          target: BACKEND_HTTP,
          changeOrigin: true,
          secure: false,
          xfwd: true,
        },
        "/external-ai-api": {
          target: EXTERNAL_AI,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/external-ai-api/, "/api"),
          secure: false,
        },
        "/whep": {
          target: MEDIAMTX,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/whep/, ""),
          secure: false,
        },
        "/ws": {
          target: BACKEND_WS,
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});