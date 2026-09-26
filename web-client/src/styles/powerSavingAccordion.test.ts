// Стили «Энергосбережения» (план 2D, задача 11): аккордеон групп тумблеров —
// tweb `scss/base.scss:1786-1872` (`.accordion`, счётчик, стрелка, раскрытие) — и
// `html.no-backdrop` (`base.scss:403-407`), который включает ключ `liteMode.blur`.
// Пин — по скомпилированному `styles/index.scss`, как `globalButtonReset.test.ts`.
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

const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
}

describe('аккордеон групп (tweb base.scss:1786-1872)', () => {
  it('свёрнут — высота 0 и обрезка, раскрыт — высота из --max-height', () => {
    expect(rule('.accordion')).toMatch(/overflow:\s*hidden/)
    expect(rule('.accordion')).toMatch(/height:\s*0/)
    expect(rule('.accordion.is-expanded')).toMatch(/height:\s*var\(--max-height\)/)
  })

  it('стрелка поворачивается у раскрытой группы, заголовок строки — flex с зазором', () => {
    expect(rule('.accordion-toggler-expanded .accordion-icon')).toMatch(/rotate\(180deg\)/)
    expect(rule('.accordion-row .row-title')).toMatch(/display:\s*flex/)
    expect(rule('.accordion-row .row-title')).toMatch(/gap:\s*0?\.25rem/)
  })

  it('высота анимируется только на animation-level-2', () => {
    expect(css).toMatch(/body\.animation-level-2 \.accordion\s*\{[^}]*transition:\s*height/)
  })
})

describe('html.no-backdrop (tweb base.scss:403-407)', () => {
  it('гасит размытие меню и тостов', () => {
    const body = rule('html.no-backdrop')
    expect(body).toMatch(/--menu-backdrop-filter:\s*none/)
    expect(body).toMatch(/--blur-off:\s*none/)
    expect(body).toMatch(/--menu-background-color:\s*var\(--surface-color\)/)
  })
})
