import { describe, it, expect, vi, afterEach } from 'vitest'
import { pushEsc, initHotkeys } from './hotkeys'

const tick = () => new Promise((r) => setTimeout(r, 1))

function press(key: string, opts: KeyboardEventInit = {}, target: EventTarget = window) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts })
  target.dispatchEvent(e)
  return e
}

let deactivate: (() => void) | null = null
afterEach(() => {
  deactivate?.()
  deactivate = null
  document.body.replaceChildren()
})

describe('pushEsc (LIFO-стек)', () => {
  it('Esc вызывает верхний обработчик, нижние не трогает', () => {
    deactivate = initHotkeys({})
    const a = vi.fn()
    const b = vi.fn()
    const offA = pushEsc(a)
    const offB = pushEsc(b)
    press('Escape')
    expect(b).toHaveBeenCalledTimes(1)
    expect(a).not.toHaveBeenCalled()
    offB()
    press('Escape')
    expect(a).toHaveBeenCalledTimes(1)
    offA()
  })

  it('unregister из середины стека не ломает порядок', () => {
    deactivate = initHotkeys({})
    const a = vi.fn()
    const b = vi.fn()
    const c = vi.fn()
    const offA = pushEsc(a)
    const offB = pushEsc(b)
    const offC = pushEsc(c)
    offB() // закрыли средний оверлей
    press('Escape')
    expect(c).toHaveBeenCalledTimes(1)
    offC()
    press('Escape')
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
    offA()
    offA() // повторный unregister — no-op
  })

  it('при непустом стеке событие гасится (preventDefault) и фолбэк не зовётся', async () => {
    const escFallback = vi.fn()
    deactivate = initHotkeys({ escFallback })
    const off = pushEsc(() => {})
    const e = press('Escape')
    expect(e.defaultPrevented).toBe(true)
    await tick()
    expect(escFallback).not.toHaveBeenCalled()
    off()
  })

  it('при пустом стеке зовётся escFallback (отложенно)', async () => {
    const escFallback = vi.fn()
    deactivate = initHotkeys({ escFallback })
    press('Escape')
    expect(escFallback).not.toHaveBeenCalled() // ещё не тик
    await tick()
    expect(escFallback).toHaveBeenCalledTimes(1)
  })

  it('фолбэк отступает, если событие забрал более поздний window-слушатель', async () => {
    const escFallback = vi.fn()
    deactivate = initHotkeys({ escFallback })
    const legacy = (e: KeyboardEvent) => { if (e.key === 'Escape') e.preventDefault() }
    window.addEventListener('keydown', legacy)
    press('Escape')
    await tick()
    expect(escFallback).not.toHaveBeenCalled()
    window.removeEventListener('keydown', legacy)
  })
})

describe('гейт текстовых полей', () => {
  it('Ctrl+K из инпута не срабатывает, со страницы — срабатывает', () => {
    const focusSearch = vi.fn()
    deactivate = initHotkeys({ focusSearch })
    const input = document.createElement('input')
    document.body.appendChild(input)
    press('k', { code: 'KeyK', ctrlKey: true }, input)
    expect(focusSearch).not.toHaveBeenCalled()
    press('k', { code: 'KeyK', ctrlKey: true }, document.body)
    expect(focusSearch).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+Shift+M из textarea не срабатывает, со страницы — срабатывает', () => {
    const muteChat = vi.fn()
    deactivate = initHotkeys({ muteChat })
    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    press('M', { code: 'KeyM', ctrlKey: true, shiftKey: true }, ta)
    expect(muteChat).not.toHaveBeenCalled()
    press('M', { code: 'KeyM', ctrlKey: true, shiftKey: true }, document.body)
    expect(muteChat).toHaveBeenCalledTimes(1)
  })

  it('Esc срабатывает и из инпута', () => {
    deactivate = initHotkeys({})
    const h = vi.fn()
    const off = pushEsc(h)
    const input = document.createElement('input')
    document.body.appendChild(input)
    press('Escape', {}, input)
    expect(h).toHaveBeenCalledTimes(1)
    off()
  })

  it('Ctrl+K без Ctrl или с Alt — не срабатывает', () => {
    const focusSearch = vi.fn()
    deactivate = initHotkeys({ focusSearch })
    press('k', { code: 'KeyK' }, document.body)
    press('k', { code: 'KeyK', ctrlKey: true, altKey: true }, document.body)
    expect(focusSearch).not.toHaveBeenCalled()
  })
})
