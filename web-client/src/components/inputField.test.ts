/**
 * Rich-поле tweb (`InputField`, `wrapDraftText`, `getRichValueWithCaret`, глобальная
 * вставка): сущности читаются из DOM поля в UTF-16, черновик/правка возвращаются в
 * поле тем же DOM, вставка из буфера переносит разметку.
 *
 * `execCommand` в happy-dom не реализован, а вставка tweb идёт именно им
 * (`insertHTML` — ради родной истории undo). Здесь он подменён минимальной
 * реализацией «вставить разметку в точку выделения» — проверяется наш конвейер
 * (буфер → сущности → DOM поля), а не браузерный редактор.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { MessageEntity } from '@layer'
import InputField, { insertRichTextAsHTML } from './inputField'
import InputFieldAnimated from './inputFieldAnimated'
import getRichValueWithCaret from '@helpers/dom/getRichValueWithCaret'
import wrapDraftText from '@lib/richtext/wrapDraftText'

function mountField(options: ConstructorParameters<typeof InputField>[0] = {}) {
  const field = new InputField({ withLinebreaks: true, ...options })
  document.body.append(field.container)
  return field
}

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

// happy-dom не объявляет `execCommand` вовсе — ставим свой и снимаем в afterEach
function stubExecCommand(impl: (command: string, showUI?: boolean, value?: string) => boolean) {
  const exec = vi.fn(impl)
  Object.defineProperty(document, 'execCommand', { configurable: true, writable: true, value: exec })
  return exec
}

function stubInsertHTML() {
  return stubExecCommand((command, _showUI, value) => {
    if(command !== 'insertHTML') return false
    const selection = document.getSelection()!
    const range = selection.getRangeAt(0)
    const template = document.createElement('template')
    template.innerHTML = value!
    const last = template.content.lastChild
    range.deleteContents()
    range.insertNode(template.content)
    if(last) {
      range.setStartAfter(last)
      range.collapse(true)
    }
    const target = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement) as HTMLElement
    target.closest('[contenteditable="true"]')!.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })
}

function paste(target: HTMLElement, data: Record<string, string>) {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => data[type] ?? '' },
  })
  target.dispatchEvent(event)
  return event
}

afterEach(() => {
  delete (document as { execCommand?: unknown }).execCommand
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('сущности из DOM поля — UTF-16', () => {
  test('черновик с разметкой возвращается из DOM теми же сущностями', () => {
    // 😀 — суррогатная пара: два кода UTF-16, смещения после неё сдвинуты на 2
    const text = '😀 жир курсив код ссылка цитата'
    const entities: MessageEntity[] = [
      { _: 'messageEntityBold', offset: 3, length: 3 },
      { _: 'messageEntityItalic', offset: 7, length: 6 },
      { _: 'messageEntityCode', offset: 14, length: 3 },
      { _: 'messageEntityTextUrl', offset: 18, length: 6, url: 'https://example.com/' },
      { _: 'messageEntityBlockquote', offset: 25, length: 6, pFlags: {} },
    ]
    const field = mountField()
    field.setValueSilently(wrapDraftText(text, { entities }))

    const { value, entities: read } = getRichValueWithCaret(field.input, true, false)
    expect(value).toBe(text)
    expect(read).toEqual(entities)
    expect(field.value).toBe(text)
  })

  test('разметка поля — markup-span\'ы tweb, а не теги ленты', () => {
    const field = mountField()
    field.setValueSilently(wrapDraftText('жир', { entities: [{ _: 'messageEntityBold', offset: 0, length: 3 }] }))
    const span = field.input.querySelector<HTMLElement>('.is-markup')!
    expect(span.tagName).toBe('SPAN')
    expect(span.dataset.markup).toBe('markup-bold')
    expect(span.style.fontFamily).toBe('markup-bold')
    expect(field.input.querySelector('strong')).toBeNull()
  })

  test('блок кода с языком и упоминание без ника переживают круг', () => {
    const text = 'const a\n@Боб'
    const entities: MessageEntity[] = [
      { _: 'messageEntityPre', offset: 0, length: 7, language: 'ts' },
      { _: 'messageEntityMentionName', offset: 8, length: 4, user_id: 42 },
    ]
    const field = mountField()
    field.setValueSilently(wrapDraftText(text, { entities }))
    const { value, entities: read } = getRichValueWithCaret(field.input, true, false)
    expect(value).toBe(text)
    expect(read).toEqual(entities)
  })

  test('свой эмодзи — плейсхолдер с alt, читается в messageEntityCustomEmoji', () => {
    const text = 'a🔥b'
    const entities: MessageEntity[] = [{ _: 'messageEntityCustomEmoji', offset: 1, length: 2, document_id: '777' }]
    const field = mountField()
    field.setValueSilently(wrapDraftText(text, { entities }))
    const img = field.input.querySelector<HTMLImageElement>('img.custom-emoji-placeholder')!
    expect(img.alt).toBe('🔥')
    expect(field.isEmpty()).toBe(false)
    expect(getRichValueWithCaret(field.input, true, false)).toMatchObject({ value: text, entities })
  })

  test('сущность внутри кода снимается — код с форматом не комбинируется', () => {
    const field = mountField()
    field.setValueSilently(wrapDraftText('abcdef', {
      entities: [
        { _: 'messageEntityCode', offset: 0, length: 6 },
        { _: 'messageEntityBold', offset: 3, length: 3 },
      ],
    }))
    const { entities } = getRichValueWithCaret(field.input, true, false)
    expect(entities).toEqual([{ _: 'messageEntityCode', offset: 0, length: 6 }])
  })

  test('позиция каретки в UTF-16 — после эмодзи', () => {
    const field = mountField()
    field.setValueSilently('😀x')
    const text = field.input.firstChild!
    const range = document.createRange()
    range.setStart(text, 2)
    range.collapse(true)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    expect(getRichValueWithCaret(field.input).caretPos).toBe(2)
  })

  test('setDraftValue строит DOM черновика, isChanged сравнивает значение', () => {
    const field = mountField()
    field.setOriginalValue('привет', true)
    expect(field.value).toBe('привет')
    expect(field.isChanged()).toBe(false)
    field.setValueSilently('пока')
    expect(field.isChanged()).toBe(true)
  })
})

describe('вставка из буфера', () => {
  beforeEach(() => {
    // глобальный перехватчик ставит первый rich-InputField модуля
    mountField()
  })

  test('HTML с разметкой → сущности в поле', () => {
    const insert = stubInsertHTML()
    const field = mountField()
    placeCaretAtEnd(field.input)
    const event = paste(field.input, {
      'text/plain': 'жир и курсив',
      'text/html': '<html><body><b>жир</b> и <i>курсив</i></body></html>',
    })
    expect(event.defaultPrevented).toBe(true)
    expect(insert).toHaveBeenCalledWith('insertHTML', false, expect.any(String))
    expect(getRichValueWithCaret(field.input, true, false)).toEqual({
      value: 'жир и курсив',
      entities: [
        { _: 'messageEntityBold', offset: 0, length: 3 },
        { _: 'messageEntityItalic', offset: 6, length: 6 },
      ],
      caretPos: -1,
    })
  })

  test('markdown в text/plain и разметка в HTML — берётся разметка, не маркеры', () => {
    stubInsertHTML()
    const field = mountField()
    placeCaretAtEnd(field.input)
    paste(field.input, {
      'text/plain': '**жир** `код`',
      'text/html': '<b>жир</b> <code style="font-family: monospace">код</code>',
    })
    expect(getRichValueWithCaret(field.input, true, false)).toMatchObject({
      value: 'жир код',
      entities: [
        { _: 'messageEntityBold', offset: 0, length: 3 },
        { _: 'messageEntityCode', offset: 4, length: 3 },
      ],
    })
  })

  test('чужой data-follow без числового id не становится упоминанием', () => {
    stubInsertHTML()
    const field = mountField()
    placeCaretAtEnd(field.input)
    paste(field.input, {
      'text/plain': 'Боб',
      'text/html': '<a class="follow" data-follow="me" href="#x">Боб</a>',
    })
    const { entities } = getRichValueWithCaret(field.input, true, false)
    expect(entities.some((entity) => entity._ === 'messageEntityMentionName')).toBe(false)
  })

  test('поле без переносов: переводы строк из буфера вырезаются', () => {
    stubInsertHTML()
    const field = mountField({ withLinebreaks: false })
    placeCaretAtEnd(field.input)
    paste(field.input, { 'text/plain': 'раз\nдва' })
    expect(field.value).toBe('раздва')
  })

  test('insertRichTextAsHTML кладёт сущности в позицию каретки', () => {
    stubInsertHTML()
    const field = mountField()
    field.setValueSilently('до ')
    placeCaretAtEnd(field.input)
    void insertRichTextAsHTML(field.input, 'жир', [{ _: 'messageEntityBold', offset: 0, length: 3 }])
    expect(getRichValueWithCaret(field.input, true, false)).toMatchObject({
      value: 'до жир',
      entities: [{ _: 'messageEntityBold', offset: 3, length: 3 }],
    })
  })
})

describe('InputFieldAnimated', () => {
  test('двойник повторяет содержимое поля клонами, а не разметкой-строкой', () => {
    const field = new InputFieldAnimated({ withLinebreaks: true })
    document.body.append(field.container, field.inputFake)
    field.setValueSilently(wrapDraftText('жир', { entities: [{ _: 'messageEntityBold', offset: 0, length: 3 }] }))
    expect(field.inputFake.classList.contains('input-field-input-fake')).toBe(true)
    expect(field.inputFake.getAttribute('aria-hidden')).toBe('true')
    expect(field.inputFake.querySelector('[data-markup="markup-bold"]')?.textContent).toBe('жир')
    // узлы — копии: правка двойника не трогает поле
    expect(field.inputFake.firstChild).not.toBe(field.input.firstChild)
  })

  test('высота — по двойнику с потолком setMaxHeight, наружу — onChangeHeight', () => {
    const field = new InputFieldAnimated({ withLinebreaks: true })
    document.body.append(field.container, field.inputFake)
    const heights: number[] = []
    field.onChangeHeight = (height) => heights.push(height)
    Object.defineProperty(field.inputFake, 'scrollHeight', { configurable: true, get: () => 120 })
    field.setMaxHeight(80)
    expect(field.input.style.maxHeight).toBe('80px')
    expect(field.input.style.height).toBe('80px')
    expect(heights).toEqual([80])
  })
})
