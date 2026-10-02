// Кнопка `AvatarEdit` (`components/avatarEdit.ts`: `button.avatar-edit`) —
// tweb `base.scss:800-818` (812502980). Предмет — стенд «Редактировать
// профиль» (задача 27 плана 2D): без `display: block` кнопка оставалась
// inline-block, и `margin: 1rem auto 2rem` колонки (`pages/_chats.scss:40-45`)
// её не центрировал — аватар прилипал к левому краю.
//
// Пин — по скомпилированному `styles/index.scss`, как `globalButtonReset.test.ts`:
// раскладки у happy-dom нет, вычисленный стиль центрирование не покажет.
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

describe('.avatar-edit — кнопка по центру колонки (tweb base.scss:800-818)', () => {
  it('блочная кнопка без UA-оформления, в колонке — margin auto', () => {
    const rule = /(?:^|\n)\.avatar-edit\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/display:\s*block/)
    expect(rule).toMatch(/padding:\s*0/)
    expect(rule).toMatch(/border:\s*none/)
    expect(rule).toMatch(/background:\s*none/)
    const column = /\.page-chats \.avatar-edit\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(column).toMatch(/margin:\s*1rem auto 2rem/)
  })
})
