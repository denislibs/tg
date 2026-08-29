import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import solid from 'vite-plugin-solid'
import { SOLID_FILE_PATTERN } from './src/shared/solid/fileRuntime'
import { keepBackdropFilterUnprefixed } from './vite/keepBackdropFilterUnprefixed'
import { computeVersion, writeVersion } from './scripts/write-version.mjs'

const r = (p: string) => resolve(__dirname, p)

// Version-gate: versionFull вкомпиливаем в бандл (define → __APP_VERSION_FULL__),
// а writeVersion() в buildStart пишет public/version и штампует build в
// app-shell-кэш sw.js — так документированный `npx vite build` (без
// npm-скриптов) тоже поднимает свежую версию. Детали — scripts/write-version.mjs.
//
// Номер сборки в бандл НЕ подставляется: рантайму он не нужен — он живёт в
// versionFull («0.1.0 (7)») и в имени кэша app-shell.
const { versionFull } = computeVersion()

export default defineConfig({
  base: '/',
  define: {
    __APP_VERSION_FULL__: JSON.stringify(versionFull),
  },
  plugins: [
    // Два JSX-рантайма разведены по имени файла. `*.solid.tsx`/`*.solid.test.tsx`
    // — Solid, всё прочее — React. Оба плагина берут ОДИН И ТОТ ЖЕ паттерн
    // (`SOLID_FILE_PATTERN`) — include у solid, exclude у react, — поэтому
    // маски взаимоисключающие по конструкции, а не по совпадению двух текстов.
    solid({ include: [SOLID_FILE_PATTERN] }),
    react({ exclude: [SOLID_FILE_PATTERN] }),
    keepBackdropFilterUnprefixed(),
    { name: 'write-version', buildStart() { writeVersion() } },
  ],
  // Алиасы tweb (@lib/@helpers/@environment/@config/@vendor…): островок tlottie
  // переносится из tweb 1:1 с исходными путями импортов, чтобы легко ре-синкать.
  resolve: {
    alias: {
      '@lib': r('src/lib'),
      '@helpers': r('src/helpers'),
      '@environment': r('src/environment'),
      '@config': r('src/config'),
      '@vendor': r('src/vendor'),
      '@components': r('src/components'),
      '@customEmoji': r('src/lib/customEmoji'),
      '@core': r('src/core'),
      '@stores': r('src/stores'),
      '@shared': r('src/shared'),
      '@rpc': r('src/rpc'),
      '@types': r('src/types'),
      '@layer': r('src/layer'),
      '@': r('src'),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    // Раздаём только современным браузерам (Chrome/Firefox evergreen) — не даунлевелим
    // синтаксис, output чуть меньше и быстрее парсится.
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react'
          if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return 'motion'
        },
      },
    },
  },
})
