/**
 * Форматирование поля tweb (`applyMarkdown`, `processCurrentFormatting`,
 * `handleMarkdownShortcut`) и починка разметки после родного undo/redo.
 *
 * Формат ставит браузер (`execCommand('fontName', …)` под `styleWithCSS`), а в
 * happy-dom `execCommand` не реализован — здесь он подменён тем, что делает
 * браузер с выделением: span с `font-family` вокруг выделенного текста (или смена
 * `font-family` у span'а, который выделен целиком). Проверяется наш код поверх
 * команды: что ставится, что снимается и что читается в сущности.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { applyMarkdown, handleMarkdownShortcut, processCurrentFormatting } from './markdown'
import getRichValueWithCaret from './getRichValueWithCaret'

function mountInput(...children: (Node | string)[]) {
  const input = document.createElement('div')
  input.contentEditable = 'true'
  input.append(...children)
  document.body.append(input)
  return input
}

function select(node: Node, start: number, end: number) {
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  return range
}

// happy-dom не объявляет `execCommand` вовсе — ставим свой и снимаем в afterEach
function stubFontName() {
  const exec = vi.fn((command: string, _showUI?: boolean, value?: string) => {
    if(command !== 'fontName') return command === 'styleWithCSS'
    const range = document.getSelection()!.getRangeAt(0)
    const container = range.commonAncestorContainer
    const owner = (container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement) as HTMLElement
    if(owner.style.fontFamily && owner.textContent === range.toString()) {
      owner.style.fontFamily = value!
      return true
    }

    const span = document.createElement('span')
    span.style.fontFamily = value!
    span.append(range.extractContents())
    range.insertNode(span)
    return true
  })
  Object.defineProperty(document, 'execCommand', { configurable: true, writable: true, value: exec })
  return exec
}

afterEach(() => {
  delete (document as { execCommand?: unknown }).execCommand
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('processCurrentFormatting', () => {
  test('span с markup-шрифтом получает .is-markup и data-markup, читается в сущности', () => {
    const span = document.createElement('span')
    span.style.fontFamily = 'markup-bold-italic'
    span.textContent = 'жир'
    const input = mountInput('a ', span)
    processCurrentFormatting(input)
    expect(span.classList.contains('is-markup')).toBe(true)
    expect(span.dataset.markup).toBe('markup-bold-italic')
    expect(getRichValueWithCaret(input, true, false).entities).toEqual([
      { _: 'messageEntityBold', offset: 2, length: 3 },
      { _: 'messageEntityItalic', offset: 2, length: 3 },
    ])
  })

  test('undo: восстановленный браузером узел без шрифта получает его обратно из data-markup', () => {
    // после нативного undo браузер вернул span, но inline-стиль снял
    const span = document.createElement('span')
    span.className = 'is-markup'
    span.dataset.markup = 'markup-underline'
    span.textContent = 'под'
    const input = mountInput(span)
    processCurrentFormatting(input, undefined, 'historyUndo')
    expect(span.style.fontFamily).toBe('markup-underline')
    expect(span.classList.contains('is-markup')).toBe(true)
    expect(getRichValueWithCaret(input, true, false).entities).toEqual([
      { _: 'messageEntityUnderline', offset: 0, length: 3 },
    ])
  })

  test('redo: цитата без шрифта и без детей-цитат перестаёт быть цитатой, остальной формат живёт', () => {
    const span = document.createElement('span')
    span.dataset.markup = 'markup-quote-bold'
    span.textContent = 'x'
    const input = mountInput(span)
    processCurrentFormatting(input, undefined, 'historyRedo')
    expect(span.dataset.markup).toBe('markup-bold')
    expect(span.classList.contains('quote')).toBe(false)
  })

  test('цитата получает классы quote-like, вложенная — нет', () => {
    const outer = document.createElement('span')
    outer.style.fontFamily = 'markup-quote'
    const inner = document.createElement('span')
    inner.style.fontFamily = 'markup-quote-bold'
    inner.textContent = 'q'
    outer.append(inner)
    const input = mountInput(outer)
    processCurrentFormatting(input)
    expect(outer.classList.contains('quote-like')).toBe(true)
    expect(inner.classList.contains('quote-like')).toBe(false)
  })
})

describe('applyMarkdown', () => {
  test('ставит формат на выделение и снимает его повторным вызовом', () => {
    const exec = stubFontName()
    const input = mountInput('один два')
    select(input.firstChild!, 5, 8)
    expect(applyMarkdown({ input, type: 'bold' })).toBe(true)
    expect(exec).toHaveBeenCalledWith('fontName', false, 'markup-bold')
    expect(getRichValueWithCaret(input, true, false)).toMatchObject({
      value: 'один два',
      entities: [{ _: 'messageEntityBold', offset: 5, length: 3 }],
    })

    const span = input.querySelector<HTMLElement>('.is-markup')!
    select(span.firstChild!, 0, 3)
    applyMarkdown({ input, type: 'bold' })
    expect(exec).toHaveBeenCalledWith('fontName', false, 'Roboto')
    expect(getRichValueWithCaret(input, true, false).entities).toEqual([])
  })

  test('формат складывается с уже стоящим комбинируемым', () => {
    const exec = stubFontName()
    const span = document.createElement('span')
    span.style.fontFamily = 'markup-bold'
    span.textContent = 'жир'
    const input = mountInput(span)
    processCurrentFormatting(input)
    select(span.firstChild!, 0, 3)
    applyMarkdown({ input, type: 'italic' })
    expect(exec).toHaveBeenCalledWith('fontName', false, 'markup-bold-italic')
    expect(getRichValueWithCaret(input, true, false).entities).toEqual([
      { _: 'messageEntityBold', offset: 0, length: 3 },
      { _: 'messageEntityItalic', offset: 0, length: 3 },
    ])
  })

  test('моноширинный не комбинируется с жирным — жирный снимается', () => {
    const exec = stubFontName()
    const span = document.createElement('span')
    span.style.fontFamily = 'markup-bold'
    span.textContent = 'код'
    const input = mountInput(span)
    processCurrentFormatting(input)
    select(span.firstChild!, 0, 3)
    applyMarkdown({ input, type: 'monospace' })
    expect(exec).toHaveBeenCalledWith('fontName', false, 'markup-monospace')
    expect(getRichValueWithCaret(input, true, false).entities).toEqual([
      { _: 'messageEntityCode', offset: 0, length: 3 },
    ])
  })

  test('поле получает одно синтетическое input после команды, промежуточные гасятся', () => {
    stubFontName()
    const input = mountInput('abc')
    const onInput = vi.fn()
    input.addEventListener('input', onInput)
    select(input.firstChild!, 0, 3)
    applyMarkdown({ input, type: 'spoiler' })
    expect(onInput).toHaveBeenCalledTimes(1)
  })
})

describe('handleMarkdownShortcut', () => {
  const key = (code: string) => new KeyboardEvent('keydown', { code, ctrlKey: true, cancelable: true })

  test('Ctrl+B на выделении — жирный', () => {
    const exec = stubFontName()
    const input = mountInput('abc')
    select(input.firstChild!, 0, 3)
    const e = key('KeyB')
    handleMarkdownShortcut(input, e)
    expect(e.defaultPrevented).toBe(true)
    expect(exec).toHaveBeenCalledWith('fontName', false, 'markup-bold')
  })

  test('без выделения хоткей не трогает поле', () => {
    const exec = stubFontName()
    const input = mountInput('abc')
    select(input.firstChild!, 1, 1)
    const e = key('KeyB')
    handleMarkdownShortcut(input, e)
    expect(e.defaultPrevented).toBe(false)
    expect(exec).not.toHaveBeenCalled()
  })

  test('Ctrl+K не ставит формат командой — открывает редактор ссылки тултипа (`chat/markupTooltip.test.ts`)', () => {
    const exec = stubFontName()
    const input = mountInput('abc')
    select(input.firstChild!, 0, 3)
    const e = key('KeyK')
    handleMarkdownShortcut(input, e)
    expect(e.defaultPrevented).toBe(true)
    expect(exec).not.toHaveBeenCalled()
  })
})
