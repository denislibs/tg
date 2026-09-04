// Пин на `syncContentEditableValue` — см. её докблок для полного разбора.
// Строковое сравнение `el.textContent === value` не отличает ЧИСТЫЙ узел от
// узла с одиноким `<br>` (Chrome/Safari оставляют его внутри contenteditable
// после удаления ПОСЛЕДНЕГО символа — `textContent` при этом всё равно '').
// Найдено при разборе двух регрессов Solid-порта поля телефона
// (`TelInput.solid.tsx`): не отражённый `<br>` — лишняя строка внутри
// однострочного поля (поле «росло вдвое») и повод полю выглядеть пустым.
import { describe, expect, it } from 'vitest'
import { syncContentEditableValue } from './caret'

describe('syncContentEditableValue', () => {
  it('чистит одинокий <br>, оставленный браузером после удаления последнего символа', () => {
    const el = document.createElement('div')
    el.append(document.createElement('br'))

    syncContentEditableValue(el, '')

    expect(el.childNodes).toHaveLength(0)
  })

  it('чистит <br>, даже если целевое значение ТО ЖЕ, что el.textContent (пустая строка)', () => {
    // Голое `el.textContent === value` здесь совпало бы ('' === ''), и guard
    // строкового равенства пропустил бы <br> навсегда — ровно тот случай,
    // который отличает структурную сверку от строковой.
    const el = document.createElement('div')
    el.append(document.createElement('br'))
    expect(el.textContent).toBe('')

    syncContentEditableValue(el, '')

    expect(el.childNodes).toHaveLength(0)
    expect(el.querySelector('br')).toBeNull()
  })

  it('не трогает DOM, когда узел уже чист (ровно один текстовый узел с нужным значением)', () => {
    const el = document.createElement('div')
    el.append(document.createTextNode('+7'))
    const textNode = el.firstChild

    syncContentEditableValue(el, '+7')

    // Тот же узел, не пересобранный заново — иначе на каждый повторный вызов
    // сбрасывалась бы каретка без необходимости.
    expect(el.firstChild).toBe(textNode)
  })

  it('перестраивает узел, когда значение реально изменилось', () => {
    const el = document.createElement('div')
    el.append(document.createTextNode('+7'))

    syncContentEditableValue(el, '+79')

    expect(el.childNodes).toHaveLength(1)
    expect(el.textContent).toBe('+79')
  })
})
