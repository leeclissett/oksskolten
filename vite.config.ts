import path from 'path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const port = Number(env.VITE_PORT || 5173)

  return {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
      chunkSizeWarningLimit: 3000,
    },
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port,
      watch: env.CHOKIDAR_USEPOLLING === 'true'
        ? { usePolling: true, interval: 300 }
        : undefined,
      proxy: {
        '/api': env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3000',
      },
    },
  }
})
