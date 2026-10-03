/**
 * `RichInputHandler` — сохранённое выделение поля: эмодзи из дропдауна и
 * вставка встают туда, где стояла каретка до потери фокуса (tweb
 * `makeFocused`, `getSavedRange`).
 */
import { afterEach, describe, expect, test } from 'vitest'
import RichInputHandler from './richInputHandler'

function mountInput(text: string) {
  const input = document.createElement('div')
  input.contentEditable = 'true'
  input.tabIndex = 0
  input.textContent = text
  document.body.append(input)
  return input
}

function caretAt(node: Node, offset: number) {
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('RichInputHandler', () => {
  test('синглтон', () => {
    expect(RichInputHandler.getInstance()).toBe(RichInputHandler.getInstance())
  })

  test('selectionchange в фокусном поле запоминает диапазон', () => {
    const handler = RichInputHandler.getInstance()
    const input = mountInput('привет')
    input.focus()
    caretAt(input.firstChild!, 3)
    const saved = handler.getSavedRange(input)!
    expect(saved.startContainer).toBe(input.firstChild)
    expect(saved.startOffset).toBe(3)
  })

  test('выделение вне фокусного поля не запоминается за ним', () => {
    const handler = RichInputHandler.getInstance()
    const input = mountInput('a')
    const other = document.createElement('p')
    other.textContent = 'текст'
    document.body.append(other)
    caretAt(other.firstChild!, 2)
    expect(handler.getSavedRange(input)).toBeUndefined()
  })

  test('makeFocused возвращает сохранённую каретку полю без фокуса', () => {
    const handler = RichInputHandler.getInstance()
    const input = mountInput('привет')
    input.focus()
    caretAt(input.firstChild!, 2)
    input.blur()
    document.getSelection()!.removeAllRanges()

    handler.makeFocused(input)
    const range = document.getSelection()!.getRangeAt(0)
    expect(range.startContainer).toBe(input.firstChild)
    expect(range.startOffset).toBe(2)
  })

  test('restoreSavedRange без сохранённого — false и выделение не трогает', () => {
    const handler = RichInputHandler.getInstance()
    const input = mountInput('x')
    expect(handler.restoreSavedRange(input)).toBe(false)
  })
})
