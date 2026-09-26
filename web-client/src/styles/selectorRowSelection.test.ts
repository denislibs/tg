// Раскладка чекбоксов селектора пиров — tweb HEAD (812502980):
//  • `_selector.scss:273-292` — правый круглый чекбокс лежит поверх строки, и
//    строка `.selector-row-with-checkbox` держит под него полосу справа;
//  • `_row.scss:476-502` (690514225) — ведущий квадратный чекбокс и аватар за ним
//    раскладывают классы строки `row-with-checkbox-and-media`/`row-selection-*`;
//    прежнее `.selector-square …` из `_selector.scss` снято.
// Классы ставит `components/appSelectPeers.solid.tsx` (и React-двойник
// `shared/ui/PeerSelector`). Пин — по скомпилированному `styles/index.scss`:
// happy-dom раскладку не считает.
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
  return new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1]
}

describe('селектор пиров: раскладка чекбоксов строки (tweb HEAD)', () => {
  it('.selector .selector-row-with-checkbox — полоса справа 1.125 + 1.25 + .5rem', () => {
    expect(rule('.selector .selector-row-with-checkbox')).toMatch(/padding-inline-end:\s*2\.875rem/)
  })

  it('row-with-checkbox-and-media / row-selection-media / row-selection-checkbox — отступы под ведущий чекбокс', () => {
    expect(rule('.row-with-checkbox-and-media.row-with-padding')).toMatch(/padding-inline-start:\s*7\.5rem\s*!important/)
    expect(rule('.row-selection-media')).toMatch(/margin-inline-start:\s*3rem\s*!important/)
    expect(rule('.row-selection-checkbox')).toMatch(/inset-inline-start:\s*1\.25rem\s*!important/)
  })

  it('.selector-square больше не раскладывает строку (снято 690514225)', () => {
    expect(css).not.toMatch(/\.selector-square\s/)
  })
})
