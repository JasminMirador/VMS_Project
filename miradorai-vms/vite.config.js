import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// import basicSsl from "@vitejs/plugin-basic-ssl";
 
export default defineConfig({
  plugins: [
    react(),
    // basicSsl()
  ],
server: {
  host: true,
  allowedHosts: true,
  proxy: {
    '/api': {
      target: 'http://localhost:8000',
      changeOrigin: true,
    },
    '/ws': {
      target: 'ws://localhost:8000',
      ws: true,
    },
        '/synopsis-api': {
      target: 'http://localhost:8005',
      rewrite: (path) => path.replace(/^\/synopsis-api/, ''),
      changeOrigin: true,
    },
  },
}

});