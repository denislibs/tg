// Сброс браузерной кнопки — tweb `components/_global.scss:31-43`. Предмет —
// «Enable Notifications» вкладки уведомлений (`button.btn-primary.primary.
// btn-transparent` в `.sidebar-left-section-content`): без сброса кнопка брала
// UA-шрифт 13.33px и выходила мельче строк секции (замер на стенде).
//
// Пин — по скомпилированному `styles/index.scss`, а не по `getComputedStyle`:
// у happy-dom нет UA-таблицы для `<button>` (размер шрифта у него наследуется и
// без правила), так что вычисленный стиль правило не отличает.
import { beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as sass from 'sass'

let css: string

beforeAll(() => {
  css = sass.compile(join(__dirname, 'index.scss'), {
    loadPaths: [__dirname, join(__dirname, '..', '..', 'node_modules')],
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api', 'slash-div'],
    quietDeps: true,
  }).css
})

describe('сброс браузерной кнопки (tweb _global.scss:31-43)', () => {
  it('элементное правило button: шрифт наследуется, рамки/фона/отступов UA нет', () => {
    const rule = /(?:^|\n)button\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/font-size:\s*inherit/)
    expect(rule).toMatch(/background:\s*none/)
    expect(rule).toMatch(/border:\s*none/)
    expect(rule).toMatch(/padding:\s*0/)
    expect(rule).toMatch(/cursor:\s*pointer/)
  })
})
