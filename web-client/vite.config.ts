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
  // Воркеры инстанцируются как `new Worker(new URL('./x.worker.ts', import.meta.url),
  // { type: 'module' })` (см. core/worker.ts). format:'es' заставляет Rolldown собирать
  // каждый воркер отдельным ESM-чанком (как в tweb), а не инлайнить/оборачивать в iife.
  worker: {
    format: 'es',
  },
})
