import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import solid from 'vite-plugin-solid'
import { SOLID_FILE_PATTERN } from './src/shared/solid/fileRuntime'

// Алиасы должны совпадать с vite.config.ts, иначе тесты не резолвят @config/@lib/…
// (из-за отсутствия этого блока падал импорт @config/debug в lottie-модулях).
const r = (p: string) => resolve(__dirname, p)

export default defineConfig({
  // Тот же паттерн, что и в vite.config.ts — единственный источник истины,
  // см. src/shared/solid/fileRuntime.ts.
  plugins: [solid({ include: [SOLID_FILE_PATTERN] })],
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
  test: {
    environment: 'happy-dom',
    // Заглушка `fetch` для `/assets/tgs/*.json` на всю среду — см. докблок файла.
    setupFiles: [r('src/test/setup.ts')],
    // scripts/** — DOM-diff харнес (обычный JS вне tsconfig), его тесты гоняем тем же прогоном.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.js'],
  },
})
