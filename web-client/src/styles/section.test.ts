// Модель отступов секции — tweb `_section.scss` HEAD (812502980, 2556fc949):
// промежуток до следующей секции — `padding-bottom` КОНТЕЙНЕРА, а не `margin`
// карточки; подпись вне карточки отстоит от неё на `.625rem`; пустая подпись
// места не занимает; `captionTop` (первый ребёнок) и `captionOld` (внутри
// карточки) — свои правила. Пины разметки (`section.solid.test.tsx`,
// `SidebarSection.test.tsx`) зелёные при любом CSS, поэтому здесь — настоящий
// скомпилированный `styles/index.scss` поверх разметки секции, как в
// `styles/mediaGridTile.test.ts`. happy-dom отдаёт вычисленные значения в px
// (1rem = 16px, `--section-padding-bottom` = 1rem) и считает `:empty` по
// элементам-детям, поэтому непустая подпись здесь — со `span`, как её строит `i18n`.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
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

function mount(html: string) {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
  document.body.innerHTML = html
  const q = (selector: string) => getComputedStyle(document.querySelector(selector)!)
  return q
}

const CARD = '<div class="sidebar-left-section"><div class="sidebar-left-section-content"><div class="row"></div></div></div>'

describe('секция: отступ после — padding-bottom контейнера (tweb _section.scss:82-91)', () => {
  it('контейнер несёт padding-bottom, карточка — без margin-bottom', () => {
    const q = mount(`<div class="sidebar-left-section-container">${CARD}</div>`)

    expect(q('.sidebar-left-section-container').paddingBottom).toBe('16px')
    expect(q('.sidebar-left-section').marginBottom).toBe('') // не объявлен вовсе
  })

  it('no-margin-bottom на контейнере снимает этот padding', () => {
    const q = mount(`<div class="sidebar-left-section-container no-margin-bottom">${CARD}</div>`)

    expect(q('.sidebar-left-section-container').paddingBottom).toBe('0px')
  })
})

describe('секция: подпись (tweb _section.scss:53-80)', () => {
  it('подпись под карточкой отстоит от неё на .625rem и не тянет свой нижний отступ', () => {
    const q = mount(`<div class="sidebar-left-section-container">${CARD}
      <div class="sidebar-left-section-content sidebar-left-section-caption"><span>Текст</span></div></div>`)

    const caption = q('.sidebar-left-section-caption')
    expect(caption.marginTop).toBe('10px')
    expect(caption.marginBottom).toBe('0px')
  })

  it('пустая подпись места не занимает', () => {
    const q = mount(`<div class="sidebar-left-section-container">${CARD}
      <div class="sidebar-left-section-content sidebar-left-section-caption"></div></div>`)

    expect(q('.sidebar-left-section-caption').marginTop).toBe('0px')
  })

  it('captionTop (первый ребёнок контейнера) — сверху 0, снизу .8125rem', () => {
    const q = mount(`<div class="sidebar-left-section-container">
      <div class="sidebar-left-section-content sidebar-left-section-caption"><span>Текст</span></div>${CARD}</div>`)

    const caption = q('.sidebar-left-section-caption')
    expect(caption.marginTop).toBe('0px')
    expect(caption.marginBottom).toBe('13px')
  })

  it('captionOld (внутри карточки) — -.375rem сверху, отступ секции снизу', () => {
    const q = mount(`<div class="sidebar-left-section-container"><div class="sidebar-left-section">
      <div class="sidebar-left-section-content"><div class="row"></div></div>
      <div class="sidebar-left-section-content sidebar-left-section-caption"><span>Текст</span></div></div></div>`)

    const caption = q('.sidebar-left-section-caption')
    expect(caption.marginTop).toBe('-6px')
    expect(caption.marginBottom).toBe('16px')
  })
})

describe('секция: раскладку полей строки держит _row.scss, а не секция (tweb 803f9599d, ef41b29db)', () => {
  it('у секции нет своих правил для .checkbox-field / .radio-field', () => {
    expect(css).not.toMatch(/\.sidebar-left-section \.checkbox-field/)
    expect(css).not.toMatch(/\.sidebar-left-section \.radio-field/)
    expect(css).not.toMatch(/\.sidebar-left-section-content > \.checkbox-field/)
    expect(css).not.toMatch(/\.sidebar-left-section-content > \.checkbox-ripple/)
  })
})

describe('чатлист: группы поиска без отступа секции (tweb _chatlist.scss:580-590, 2556fc949)', () => {
  it('контейнер секции в .chatlist-bottom — без padding-bottom', () => {
    const q = mount(`<div class="chatlist-bottom"><div class="sidebar-left-section-container">${CARD}</div></div>`)

    expect(q('.sidebar-left-section-container').paddingBottom).toBe('0px')
    expect(q('.sidebar-left-section').paddingBottom).toBe('0px')
  })
})

describe('градиентная полоса над секцией (tweb base.scss:1391-1406)', () => {
  it('.gradient-delimiter — полоса .75rem над секцией', () => {
    const q = mount('<div class="gradient-delimiter"></div>')

    const d = q('.gradient-delimiter')
    expect(d.height).toBe('12px')
    expect(d.position).toBe('relative')
  })
})
