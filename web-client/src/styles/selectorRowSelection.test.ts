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

const ruleRe = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g')
}

const rule = (selector: string) => ruleRe(selector).exec(css)?.[1]

describe('селектор пиров: раскладка чекбоксов строки (tweb HEAD)', () => {
  it('.selector .selector-row-with-checkbox — полоса справа 1.125 + 1.25 + .5rem', () => {
    expect(rule('.selector .selector-row-with-checkbox')).toMatch(/padding-inline-end:\s*2\.875rem/)
  })

  it('row-with-checkbox-and-media / row-selection-media / row-selection-checkbox — отступы под ведущий чекбокс', () => {
    expect(rule('.row-with-checkbox-and-media.row-with-padding')).toMatch(/padding-inline-start:\s*7\.5rem\s*!important/)
    expect(rule('.row-selection-media')).toMatch(/margin-inline-start:\s*3rem\s*!important/)
    expect(rule('.row-selection-checkbox')).toMatch(/inset-inline-start:\s*1\.25rem\s*!important/)
  })

  // Оба правила — (0,2,0) и `!important`, поэтому побеждает то, что в собранном CSS позже.
  // В tweb `style.scss:3 @use "base"` (там `.chatlist-chat.row-with-padding`, base.scss:1645) стоит
  // до `partials/row` (style.scss:52), и строка с ведущим чекбоксом выигрывает: 7.5rem, а не 4.5rem.
  // Иначе аватар `.row-selection-media` ложится на `.row-title` («Добавить участников»).
  it('каскад: padding-inline-start строки с ведущим чекбоксом побеждает .chatlist-chat.row-with-padding', () => {
    const winner = '.row-with-checkbox-and-media.row-with-padding'
    const loser = '.chatlist-chat.row-with-padding'
    const lastDecl = (selector: string) => {
      const decls = [...css.matchAll(ruleRe(selector))]
        .filter((m) => /padding-inline-start:[^;}]*!important/.test(m[1]))
        .map((m) => m.index!)
      return decls.at(-1) ?? -1
    }
    expect(lastDecl(winner), `нет ${winner} с padding-inline-start !important`).toBeGreaterThan(-1)
    expect(lastDecl(loser), `нет ${loser} с padding-inline-start !important`).toBeGreaterThan(-1)
    expect(lastDecl(winner)).toBeGreaterThan(lastDecl(loser))
  })

  it('.selector-square больше не раскладывает строку (снято 690514225)', () => {
    expect(css).not.toMatch(/\.selector-square\s/)
  })
})
