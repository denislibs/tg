// Виджет ссылки-приглашения (`sidebarLeft/tabs/inviteLink.ts`) на вкладке
// «Share Folder» (`sharedFolder.solid.tsx`) — партиал tweb `_inviteLink.scss`
// (812502980) и правило `.cant-select` из tweb `base.scss:1869-1877`, портированы
// задачей 25 плана 2D. Без партиала плашка ссылки — голый текст без фона и
// высоты, без `.cant-select` нерасшариваемая строка селектора неотличима от
// выбираемой. Пин — по скомпилированному `styles/index.scss`: happy-dom раскладку
// не считает.
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

describe('ссылка-приглашение (tweb _inviteLink.scss)', () => {
  it('.invite-link — плашка 3rem на --background-color, текст слева, кнопка справа', () => {
    const body = rule('.invite-link')
    expect(body).toMatch(/height:\s*3rem/)
    expect(body).toMatch(/background-color:\s*var\(--background-color\)/)
    expect(body).toMatch(/justify-content:\s*space-between/)
    expect(body).toMatch(/padding-inline:\s*1rem 0?\.25rem/)
    expect(body).toMatch(/border-radius:\s*16px/)
  })

  it('.invite-link-container — поля .5rem, кнопка меню — отступ .375rem', () => {
    expect(rule('.invite-link-container')).toMatch(/padding:\s*0 0?\.5rem/)
    expect(rule('.invite-link-menu')).toMatch(/margin-inline-start:\s*0?\.375rem/)
  })
})

describe('нерасшариваемая строка селектора (tweb base.scss .cant-select)', () => {
  it('рамка чекбокса пунктиром', () => {
    expect(rule('.cant-select .checkbox-box-border')).toMatch(/border-style:\s*dotted/)
  })
})
