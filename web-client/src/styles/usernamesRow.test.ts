// Строка ссылки-приглашения редактора папки — `Row.usernames-username.active` +
// `Row.Media.usernames-username-icon` (`sidebarLeft/tabs/editFolder.solid.tsx`,
// tweb `editFolder.tsx:586-606`). Круглая плашка иконки и её основной цвет у
// активной строки — партиал tweb `_usernames.scss` (812502980), портирован
// задачей 24 плана 2D; без него иконка ссылки была бы голым глифом. Пин — по
// скомпилированному `styles/index.scss`: happy-dom раскладку не считает.
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

describe('строка ссылки папки: плашка иконки (tweb _usernames.scss)', () => {
  it('.usernames-username-icon — круг цвета --secondary-color', () => {
    const body = rule('.usernames-username-icon')
    expect(body).toMatch(/border-radius:\s*50%/)
    expect(body).toMatch(/background-color:\s*var\(--secondary-color\)/)
  })

  it('у активной строки плашка — --primary-color', () => {
    expect(rule('.usernames-username.active .usernames-username-icon')).toMatch(/background-color:\s*var\(--primary-color\)/)
  })
})
