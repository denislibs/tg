// Корень экрана блокировки — глобальный партиал tweb `_passcodeLockScreen.scss`
// (`styles/tweb/_passcodeLockScreen.scss`): во весь экран поверх всего
// (`--passcode-lock-screen-z-index`, tweb base.scss:226), фон темы, пока грузится
// ленивый модуль экрана, и гашение `--hidden` при разблокировке. Проверяется
// НАСТОЯЩИЙ скомпилированный `styles/index.scss` (как `pollClickableArea.test.ts`).
import { beforeAll, afterEach, describe, expect, it } from 'vitest'
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

afterEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

describe('.passcode-lock-screen (tweb _passcodeLockScreen.scss)', () => {
  it('во весь экран над всем, на фоне темы; `--hidden` гасит', () => {
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
    const root = document.createElement('div')
    root.className = 'passcode-lock-screen'
    document.body.append(root)

    const cs = getComputedStyle(root)
    expect(cs.position).toBe('fixed')
    expect([cs.top, cs.right, cs.bottom, cs.left]).toEqual(['0px', '0px', '0px', '0px'])
    expect(cs.zIndex).toBe('100000')
    expect(css).toMatch(/\.passcode-lock-screen\s*\{[^}]*background-color:\s*var\(--surface-color\)/)
    expect(css).toContain('--passcode-lock-screen-z-index: 100000')
    expect(cs.opacity).toBe('1')

    root.classList.add('passcode-lock-screen--hidden')
    expect(getComputedStyle(root).opacity).toBe('0')
  })
})
