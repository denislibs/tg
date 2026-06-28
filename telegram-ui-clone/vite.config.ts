import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// `base` must match the GitHub Pages project path in production builds
// (https://denislibs.github.io/telegram-remake/), but the dev server serves at
// root so `npm run dev` opens at http://localhost:5173 directly.
export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : '/telegram-remake/',
  plugins: [react()],
  // Dev server proxies the API + WebSocket to the running verify stack (nginx on
  // :38080), so `npm run dev` gives hot-reload while talking to the real backend.
  server: {
    proxy: {
      '/api': { target: 'http://localhost:38080', changeOrigin: true },
      '/ws': { target: 'ws://localhost:38080', ws: true, changeOrigin: true },
    },
  },
}))
