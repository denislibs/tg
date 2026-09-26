// Пины модели отступов шапки `MediaHeader` на СКОМПИЛИРОВАННОМ CSS (О-29 плана
// 2D). Модель tweb HEAD 812502980 (`components/mediaHeader.module.scss`, коммит
// 2556fc949 + `margin-block: 0` из 472e3e76b): ритм между частями держит сам
// блок (`gap: .5rem`), у частей вертикальных полей нет — и под неё же переписан
// `pages/authFlow.module.scss` (`.qrContainer`: `margin-block: 1rem 1rem` без
// `!important`, «блок сам добавит .5rem ниже»). Пины разметки
// (`mediaHeader.solid.test.tsx`) сверяют классы и остаются зелёными при любой
// модели, поэтому здесь — настоящий sass-вывод обоих модулей поверх разметки
// карточки, тем же способом, что `styles/mediaGridTile.test.ts` (имена классов
// модуля при прямой компиляции не хешируются).
//
// Особенность happy-dom, под которую написаны ожидания: физические свойства он
// отдаёт в px, а логические (`gap`, `margin-block`, `margin-inline`,
// `padding-inline`) — как записаны, без раскладки на стороны и без перевода
// единиц. Поэтому «у части нет вертикального поля» пинится пустым `marginTop`/
// `marginBottom` (физически не объявлено ничего), а логические значения — строкой.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as sass from 'sass'

let css: string

beforeAll(() => {
  const opts = {
    loadPaths: [join(__dirname, '..', 'styles'), join(__dirname, '..', '..', 'node_modules')],
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api', 'slash-div'] as sass.DeprecationOrId[],
    quietDeps: true,
    // `@charset` перед первым правилом happy-dom съедает вместе с этим правилом
    charset: false,
  }
  css = [
    sass.compile(join(__dirname, 'mediaHeader.module.scss'), opts).css,
    sass.compile(join(__dirname, 'auth', 'AuthFlow.module.scss'), opts).css,
  ].join('\n')
})

afterEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

/**
 * Шапка карточки, как её строят `MediaHeader` + `Sticker`/`Title`/`Subtitle`
 * (подпись — со `span` внутри: `:empty` в happy-dom срабатывает и на элементе с
 * одним текстом).
 */
function mountHeader(stickerClass?: string) {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)

  const block = document.createElement('div')
  block.className = 'container'
  const sticker = document.createElement('div')
  sticker.className = stickerClass ? `sticker ${stickerClass}` : 'sticker'
  const title = document.createElement('h1')
  title.className = 'title'
  title.append(Object.assign(document.createElement('span'), { textContent: 'Telegram' }))
  const subtitle = document.createElement('div')
  subtitle.className = 'subtitle secondary'
  subtitle.append(Object.assign(document.createElement('span'), { textContent: 'Please confirm' }))
  block.append(sticker, title, subtitle)
  document.body.append(block)
  return { block, sticker, title, subtitle }
}

describe('MediaHeader: ритм держит блок (tweb mediaHeader.module.scss:1-10)', () => {
  it('блок — колонка с gap .5rem и max-width 100%', () => {
    const { block } = mountHeader()
    const cs = getComputedStyle(block)

    expect(cs.display).toBe('flex')
    expect(cs.flexDirection).toBe('column')
    expect(cs.getPropertyValue('gap')).toBe('0.5rem')
    expect(cs.maxWidth).toBe('100%')
  })

  it('у стикера нет вертикальных полей — центрируется только по инлайн-оси (:103-108)', () => {
    const { sticker } = mountHeader()
    const cs = getComputedStyle(sticker)

    expect(cs.marginTop).toBe('')
    expect(cs.marginBottom).toBe('')
    expect(cs.getPropertyValue('margin-inline')).toBe('auto')
  })

  it('заголовок — без полей и у h1 (margin-block: 0, :70), текст — с инлайн-отступом 1rem по центру (:62-68)', () => {
    const { title } = mountHeader()
    const cs = getComputedStyle(title)

    expect(cs.marginTop).toBe('')
    expect(cs.marginBottom).toBe('')
    expect(cs.getPropertyValue('margin-block')).toBe('0')
    expect(cs.getPropertyValue('padding-inline')).toBe('1rem')
    expect(cs.textAlign).toBe('center')
  })

  it('подзаголовок — без полей, переносы строк из перевода (white-space: pre-line, :82-86)', () => {
    const { subtitle } = mountHeader()
    const cs = getComputedStyle(subtitle)

    expect(cs.marginTop).toBe('')
    expect(cs.marginBottom).toBe('')
    expect(cs.whiteSpace).toBe('pre-line')
    expect(cs.textAlign).toBe('center')
  })
})

describe('authFlow под модель gap (tweb authFlow.module.scss, 2556fc949)', () => {
  it('.qrContainer: 1rem сверху и снизу — .5rem под слотом добавляет блок (:265-267)', () => {
    const { sticker } = mountHeader('qrContainer')
    const cs = getComputedStyle(sticker)

    expect(cs.getPropertyValue('margin-block')).toBe('1rem 1rem')
    expect(cs.marginTop).toBe('')
    expect(cs.getPropertyValue('margin-inline')).toBe('auto')
  })

  it('.logoContainer у HEAD не тронут: 1rem / 1.5rem (:122-124)', () => {
    const { sticker } = mountHeader('logoContainer')
    const cs = getComputedStyle(sticker)

    expect(cs.getPropertyValue('margin-block')).toBe('1rem 1.5rem')
    expect(cs.marginTop).toBe('')
  })
})
