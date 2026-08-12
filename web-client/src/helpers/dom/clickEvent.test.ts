// Тесты порта tweb `helpers/dom/clickEvent.ts` (см. `clickEvent.ts` рядом).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachClickEvent, hasMouseMovedSinceDown, CLICK_EVENT_NAME } from './clickEvent'

afterEach(() => {
  document.body.replaceChildren()
})

function mount(): HTMLElement {
  const el = document.createElement('div')
  document.body.append(el)
  return el
}

describe('clickEvent', () => {
  it('строка проводки: глобальный mousedown-трекер модуля — preventDefault внутри [cancel-mouse-down]', () => {
    const el = mount()
    el.setAttribute('cancel-mouse-down', '')
    const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    el.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
  })

  it('hasMouseMovedSinceDown: trusted click по другому таргету после mousedown подавляется', () => {
    const a = mount()
    const b = mount()
    a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    // isTrusted у синтетических событий happy-dom всегда false — проверяем функцию напрямую
    expect(hasMouseMovedSinceDown({ isTrusted: true, type: 'click', target: b } as unknown as Event)).toBe(true)
    expect(hasMouseMovedSinceDown({ isTrusted: true, type: 'click', target: a } as unknown as Event)).toBeUndefined()
  })

  it('attachClickEvent вешает обработчик на CLICK_EVENT_NAME, возвращённая функция снимает', () => {
    const el = mount()
    const cb = vi.fn()
    const detach = attachClickEvent(el, cb)
    el.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    expect(cb).toHaveBeenCalledTimes(1)

    detach()
    el.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('cancelMouseDown проставляет атрибут cancel-mouse-down', () => {
    const el = mount()
    attachClickEvent(el, () => {}, { cancelMouseDown: true })
    expect(el.hasAttribute('cancel-mouse-down')).toBe(true)
  })
})
