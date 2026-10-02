// Строка списка чатов лежит НАД списком, а не в потоке: `.item` ядра виртуального
// списка (`position: absolute`) против `.row`/`.rp` (`position: relative`) той же
// специфичности. Порядок, в котором стили ложатся в наш бандл: CSS-модуль ядра
// РАНЬШЕ глобальных (`App` импортирован в `main.tsx` до `styles/index.scss`), —
// разбор в `_chatlistRow.scss` над правилом `.virtual-chatlist > .chatlist-chat`.
// Без него `top` ядра прибавлялся к месту строки в потоке: строки шли через одну
// высоту (стенд задачи 1-4 волны 7).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import * as sass from 'sass'

const stylesDir = join(__dirname, '..')
let globalCss: string
let moduleCss: string

beforeAll(() => {
  globalCss = sass.compile(join(stylesDir, 'index.scss'), {
    loadPaths: [stylesDir, join(stylesDir, '..', '..', 'node_modules')],
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api', 'slash-div'],
    quietDeps: true,
  }).css
  // имя класса модуля в тесте не хешируется — берём исходник как есть
  moduleCss = readFileSync(join(stylesDir, '..', 'components', 'verticalVirtualList.module.scss'), 'utf-8')
    .replace(/^\s*\/\/.*$/gm, '')
})

afterEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

describe('каскад строки списка чатов (`_chatlistRow.scss`)', () => {
  it('модуль ядра раньше глобальных стилей — строка всё равно `absolute`', () => {
    for(const css of [moduleCss, globalCss]) {
      const style = document.createElement('style')
      style.textContent = css
      document.head.append(style)
    }
    const ul = document.createElement('ul')
    ul.className = 'chatlist virtual-chatlist'
    const row = document.createElement('a')
    row.className = 'rp row chatlist-chat item'
    ul.append(row)
    document.body.append(ul)

    expect(getComputedStyle(row).position).toBe('absolute')
  })
})
