// Глобальная модель коробки — tweb `components/_global.scss:3-11`: корень
// `border-box`, все элементы И псевдоэлементы наследуют. Предмет — радиокнопка
// tweb (`.radio-field-main::before` — кольцо 1.375rem с рамкой 2px, `::after` —
// точка .75rem на `left: .3125rem`): её геометрия посчитана на border-box, и при
// голом `* {box-sizing: border-box}` псевдоэлемент оставался content-box —
// кольцо шире на 4px, точка не в центре (замер на стенде).
//
// Пин — по скомпилированному `styles/index.scss`: happy-dom не вычисляет стили
// псевдоэлементов, так что `getComputedStyle(el, '::before')` правило не отличает.
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

describe('глобальная модель коробки (tweb _global.scss:3-11)', () => {
  it('корень html — border-box', () => {
    // элементных правил `html` в сборке несколько (тема, шрифт) — ищем среди всех
    const rules = [...css.matchAll(/(?:^|\n)html\s*\{([^}]*)\}/g)].map((m) => m[1])
    expect(rules.some((r) => /box-sizing:\s*border-box/.test(r))).toBe(true)
  })

  it('элементы и псевдоэлементы наследуют модель корня', () => {
    const rule = /(?:^|\n)\*,\s*\*:before,\s*\*:after\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/box-sizing:\s*inherit/)
  })
})
