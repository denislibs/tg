import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Dev-сервера нет: `npm run dev` — watch-сборка в ../client-build, которую раздаёт
// nginx стенда (:38080). `base` по умолчанию — путь GitHub Pages
// (https://denislibs.github.io/telegram-remake/); локальные сборки переопределяют
// его флагом --base=/.
export default defineConfig({
  base: '/telegram-remake/',
  plugins: [react()],
})
