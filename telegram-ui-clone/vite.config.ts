import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// `base` must match the GitHub Pages project path in production builds
// (https://denislibs.github.io/telegram-remake/), but the dev server serves at
// root so `npm run dev` opens at http://localhost:5173 directly.
export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : '/telegram-remake/',
  plugins: [react()],
  // Dev server proxies the API + WebSocket to the running verify stack (nginx
  // redirects http :38080 → https :38443 with a self-signed dev cert, hence
  // secure:false), so `npm run dev` gives hot-reload while talking to the real backend.
  server: {
    proxy: {
      '/api': { target: 'https://localhost:38443', changeOrigin: true, secure: false },
      '/ws': { target: 'wss://localhost:38443', ws: true, changeOrigin: true, secure: false },
    },
  },
}))
