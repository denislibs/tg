import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Алиасы должны совпадать с vite.config.ts, иначе тесты не резолвят @config/@lib/…
// (из-за отсутствия этого блока падал импорт @config/debug в lottie-модулях).
const r = (p: string) => resolve(__dirname, p)

export default defineConfig({
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
      '@': r('src'),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
