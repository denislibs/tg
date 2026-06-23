import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// `base` must match the GitHub Pages project path: https://denislibs.github.io/telegram-remake/
export default defineConfig({
  base: '/telegram-remake/',
  plugins: [react()],
})
