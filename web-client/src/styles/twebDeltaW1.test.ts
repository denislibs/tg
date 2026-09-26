// Пины на СКОМПИЛИРОВАННЫЙ `styles/index.scss` для CSS-правок волны 1 дельты
// tweb e52b5d931 → 812502980 (docs/tweb/delta/README.md, «Одиночные S»).
// Приём — тот же, что у `styles/mediaGridTile.test.ts`: настоящая компиляция
// sass, проверяется то, что уедет в браузер, а не исходник партиала. Каждый
// describe — отдельный коммит tweb; правило, которого нет в скомпилированном
// CSS, красит свой describe.
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

/** Тела всех правил с ТОЧНО таким селектором (склеены), `undefined` — нет ни одного. */
function rule(selector: string): string | undefined {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const bodies = [...css.matchAll(new RegExp(`(?:^|[}\\n])\\s*${esc}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1])
  return bodies.length ? bodies.join('\n') : undefined
}

describe('круговое раскрытие темы (tweb base.scss:1960-1972, 7082e1a18 → 091b476a9)', () => {
  it('кроссфейд гасится только под классом на время раскрытия, а не глобально', () => {
    expect(rule('.no-view-transition::view-transition-old(root)')).toMatch(/animation:\s*none/)
    expect(rule('.no-view-transition::view-transition-new(root)')).toMatch(/animation:\s*none/)
    expect(rule('::view-transition-old(root),\n::view-transition-new(root)')).toBeUndefined()
  })

  it('при уходе в ночь старый снапшот поверх нового', () => {
    expect(rule('.reverse::view-transition-old(root)')).toMatch(/z-index:\s*2/)
  })
})

describe('выделение служебных сообщений (tweb e9428f2a9, _chatBubble.scss)', () => {
  it('пока идёт выделение, контент служебной пилюли не ловит клики — кроме даты', () => {
    expect(rule('.bubbles.is-selecting .bubble.service:not(.is-date) .bubble-content-wrapper'))
      .toMatch(/pointer-events:\s*none/)
  })

  it('смещение чекбокса — одно правило .1875rem, отдельной ветки «рядом с аватаром» нет', () => {
    expect(rule('.bubble > .bubble-select-checkbox')).toMatch(/bottom:\s*0?\.1875rem/)
    expect(css).not.toMatch(/\.bubbles-inner\.is-chat \.bubble\.is-group-last\.is-in > \.bubble-select-checkbox/)
  })
})

describe('contenteditable переносит неразрывный текст (tweb 469b191f0, base.scss:988-992)', () => {
  it('overflow-wrap: break-word — Gecko не ставит его в UA-стилях', () => {
    expect(rule("[contenteditable='true']") ?? rule('[contenteditable=true]')).toMatch(/overflow-wrap:\s*break-word/)
  })
})
