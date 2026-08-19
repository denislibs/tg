import { defineConfig } from 'vitest/config'

import { TWEB_ROOT } from './twebRoot'

// Отдельный прогон, НЕ входящий в `npm test`: он требует чекаута tweb рядом и
// грузит ЕГО исходники как есть. Запуск — `npm run crosscheck`.
//
// Алиасы скопированы из `tweb/tsconfig.json`. Ничего в оригинале не меняем и не
// вендорим: смысл проверки именно в том, что наши байты понимает ЧУЖОЙ,
// неизменённый разбор. Порт `tl_utils` к нам такой гарантии не дал бы — ошибка
// переехала бы вместе с портом.
export default defineConfig({
  resolve: {
    alias: {
      'solid-js/web': `${TWEB_ROOT}/src/vendor/solid/web`,
      'solid-js/store': `${TWEB_ROOT}/src/vendor/solid/store`,
      'solid-js': `${TWEB_ROOT}/src/vendor/solid`,
      '@components': `${TWEB_ROOT}/src/components`,
      '@helpers': `${TWEB_ROOT}/src/helpers`,
      '@hooks': `${TWEB_ROOT}/src/hooks`,
      '@stores': `${TWEB_ROOT}/src/stores`,
      '@appManagers': `${TWEB_ROOT}/src/lib/appManagers`,
      '@richTextProcessor': `${TWEB_ROOT}/src/lib/richTextProcessor`,
      '@customEmoji': `${TWEB_ROOT}/src/lib/customEmoji`,
      '@lib': `${TWEB_ROOT}/src/lib`,
      '@environment': `${TWEB_ROOT}/src/environment`,
      '@config': `${TWEB_ROOT}/src/config`,
      '@vendor': `${TWEB_ROOT}/src/vendor`,
      '@layer': `${TWEB_ROOT}/src/layer.d.ts`,
      '@types': `${TWEB_ROOT}/src/types.d.ts`,
      '@': `${TWEB_ROOT}/src`,
    },
  },
  test: {
    // Не 'node': `config/modes.ts` оригинала читает `location` на импорте.
    environment: 'happy-dom',
    include: ['scripts/crosscheck/*.test.ts'],
  },
})
