// Пины тултипа разметки (П-6, Б-33; порт tweb `chat/markupTooltip.ts`): выделение в
// поле ввода показывает тултип над ним, кнопки ставят жирный и курсив, кнопка ссылки
// открывает поле адреса, Enter ставит ссылку; Ctrl/Cmd+K открывает тот же редактор.
//
// Формат ставит браузер (`execCommand('fontName' | 'createLink')`), а в happy-dom
// `execCommand` нет — здесь он подменён тем, что браузер делает с выделением (как в
// `helpers/dom/markdown.test.ts`). Проверяется наш код: показ, кнопки, сущности из DOM.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import getRichValueWithCaret from '@helpers/dom/getRichValueWithCaret'
import { handleMarkdownShortcut } from '@helpers/dom/markdown'
import MarkupTooltip from './markupTooltip'

function mountField(text: string) {
  const rowsWrapper = document.createElement('div')
  rowsWrapper.classList.add('rows-wrapper')
  const input = document.createElement('div')
  input.classList.add('input-message-input')
  input.contentEditable = 'true'
  input.tabIndex = 0
  input.textContent = text
  rowsWrapper.append(input)
  document.body.append(rowsWrapper)
  input.focus()
  return input
}

function select(node: Node, start: number, end: number) {
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

// happy-dom не объявляет `execCommand` — то, что браузер делает с выделением
function stubExecCommand() {
  const exec = vi.fn((command: string, _showUI?: boolean, value?: string) => {
    if(command === 'styleWithCSS') return true
    const range = document.getSelection()!.getRangeAt(0)
    if(command === 'fontName') {
      const span = document.createElement('span')
      span.style.fontFamily = value!
      span.append(range.extractContents())
      range.insertNode(span)
      range.selectNodeContents(span)
      return true
    }

    if(command === 'createLink') {
      const a = document.createElement('a')
      a.href = value!
      a.append(range.extractContents())
      range.insertNode(a)
      range.selectNodeContents(a)
      return true
    }

    return false
  })
  Object.defineProperty(document, 'execCommand', { configurable: true, writable: true, value: exec })
  return exec
}

const tooltip = () => MarkupTooltip.getInstance()
const button = (index: number) => tooltip().container.querySelectorAll<HTMLElement>('.markup-tooltip-tools-regular .btn-icon')[index]
const mousedown = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

beforeAll(() => {
  tooltip().handleSelection()
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  tooltip().hide()
  vi.runAllTimers()
  vi.useRealTimers()
  delete (document as { execCommand?: unknown }).execCommand
  // * синглтон живёт между тестами — вернуть его узел в документ после очистки body
  const container = tooltip().container
  document.body.replaceChildren(container)
})

describe('MarkupTooltip', () => {
  test('выделение в поле ввода показывает тултип; пустое выделение прячет', () => {
    const input = mountField('привет мир')
    select(input.firstChild!, 0, 6)

    const { container } = tooltip()
    expect(container.isConnected).toBe(true)
    expect(container.classList.contains('is-visible')).toBe(true)
    // * кнопок восемь: без даты — расхождение 1 шапки
    expect(container.querySelectorAll('.markup-tooltip-tools-regular .btn-icon')).toHaveLength(8)

    select(input.firstChild!, 2, 2)
    expect(container.classList.contains('is-visible')).toBe(false)
  })

  test('выделение вне поля ввода тултип не показывает', () => {
    const div = document.createElement('div')
    div.textContent = 'просто текст'
    document.body.append(div)
    select(div.firstChild!, 0, 6)
    expect(tooltip().container?.classList.contains('is-visible') ?? false).toBe(false)
  })

  test('жирный и курсив: кнопка ставит формат, сущности читаются из DOM, кнопка активна', () => {
    const exec = stubExecCommand()
    const input = mountField('привет мир')
    select(input.firstChild!, 0, 6)

    mousedown(button(0))
    expect(exec).toHaveBeenCalledWith('fontName', false, 'markup-bold')
    expect(getRichValueWithCaret(input, true, false).entities).toEqual([
      { _: 'messageEntityBold', offset: 0, length: 6 },
    ])
    expect(button(0).classList.contains('active')).toBe(true)

    mousedown(button(1))
    expect(exec).toHaveBeenCalledWith('fontName', false, 'markup-bold-italic')
    expect(getRichValueWithCaret(input, true, false).entities).toEqual(expect.arrayContaining([
      { _: 'messageEntityBold', offset: 0, length: 6 },
      { _: 'messageEntityItalic', offset: 0, length: 6 },
    ]))
  })

  test('ссылка: кнопка открывает поле адреса, Enter ставит ссылку с протоколом', () => {
    const exec = stubExecCommand()
    const input = mountField('привет мир')
    select(input.firstChild!, 7, 10)

    const linkButton = button(7)
    linkButton.click()
    const { container } = tooltip()
    expect(container.classList.contains('is-link')).toBe(true)

    const linkInput = container.querySelector<HTMLInputElement>('.markup-tooltip-tools-link input')!
    linkInput.value = 'example.com/a'
    linkInput.dispatchEvent(new Event('input'))
    expect(linkInput.classList.contains('is-valid')).toBe(true)
    linkInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))

    expect(exec).toHaveBeenCalledWith('createLink', false, 'https://example.com/a')
    expect(getRichValueWithCaret(input, true, false).entities).toEqual([
      { _: 'messageEntityTextUrl', offset: 7, length: 3, url: 'https://example.com/a' },
    ])

    vi.runAllTimers()
    expect(container.classList.contains('is-visible')).toBe(false)
  })

  test('неверный адрес по Enter не применяется, поле подсвечено ошибкой', () => {
    const exec = stubExecCommand()
    const input = mountField('привет мир')
    select(input.firstChild!, 7, 10)

    button(7).click()
    const linkInput = tooltip().container.querySelector<HTMLInputElement>('.markup-tooltip-tools-link input')!
    linkInput.value = 'не ссылка'
    linkInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))

    expect(linkInput.classList.contains('error')).toBe(true)
    expect(exec).not.toHaveBeenCalledWith('createLink', false, expect.anything())
  })

  test('Ctrl/Cmd+K на выделении открывает редактор ссылки тултипа', () => {
    const exec = stubExecCommand()
    const input = mountField('привет мир')
    select(input.firstChild!, 0, 6)

    const e = new KeyboardEvent('keydown', { code: 'KeyK', ctrlKey: true, cancelable: true })
    handleMarkdownShortcut(input, e)

    expect(e.defaultPrevented).toBe(true)
    expect(tooltip().container.classList.contains('is-link')).toBe(true)
    expect(exec).not.toHaveBeenCalledWith('fontName', expect.anything(), expect.anything())
  })
})
