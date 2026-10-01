// Порт tweb `src/helpers/appWindow.ts` (812502980): активное окно приложения и
// корень оверлеев в нём. Окно переключает вынос клиента в Document PiP
// (`core/pip.ts`), здесь — сама механика на фейковом окне: второй документ
// happy-dom, чьё body — корень оверлеев «выноса».
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindActiveWindowListener, getAppWindow, getOverlayRoot, onAppWindowChange, setAppWindow } from './appWindow'

/** Окно выноса: свой документ, в котором живёт перенесённый клиент. */
function fakeWindow(): Window {
  const doc = document.implementation.createHTMLDocument('pip')
  return { document: doc } as unknown as Window
}

afterEach(() => {
  setAppWindow(window)
})

describe('getAppWindow (tweb appWindow.ts:23-25)', () => {
  it('без выноса — окно вкладки; после setAppWindow — окно выноса', () => {
    expect(getAppWindow()).toBe(window)
    const pip = fakeWindow()
    setAppWindow(pip)
    expect(getAppWindow()).toBe(pip)
  })
})

describe('getOverlayRoot (tweb appWindow.ts:33-35)', () => {
  it('без выноса — body вкладки', () => {
    expect(getOverlayRoot()).toBe(document.body)
  })

  it('следует за активным окном: после setAppWindow — body окна выноса, после возврата — снова вкладки', () => {
    const pip = fakeWindow()
    setAppWindow(pip)
    expect(getOverlayRoot()).toBe(pip.document.body)
    setAppWindow(window)
    expect(getOverlayRoot()).toBe(document.body)
  })
})

describe('onAppWindowChange (tweb appWindow.ts:37-60)', () => {
  it('подписчик получает (новое, прежнее) окно; отписка снимает его', () => {
    const pip = fakeWindow()
    const cb = vi.fn()
    const off = onAppWindowChange(cb)
    setAppWindow(pip)
    expect(cb).toHaveBeenCalledExactlyOnceWith(pip, window)
    off()
    setAppWindow(window)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('то же окно ещё раз и пустое окно — не смена: подписчики молчат', () => {
    const cb = vi.fn()
    const off = onAppWindowChange(cb)
    setAppWindow(window)
    setAppWindow(null as unknown as Window)
    expect(cb).not.toHaveBeenCalled()
    off()
  })

  it('упавший подписчик не срывает смену окна и не глушит соседей (tweb :49-53)', () => {
    const pip = fakeWindow()
    const offBad = onAppWindowChange(() => { throw new Error('boom') })
    const good = vi.fn()
    const offGood = onAppWindowChange(good)
    expect(() => setAppWindow(pip)).not.toThrow()
    expect(getOverlayRoot()).toBe(pip.document.body)
    expect(good).toHaveBeenCalledOnce()
    offBad()
    offGood()
  })

  it('подписчик видит уже новое окно (смена — до рассылки, tweb :48-49)', () => {
    const pip = fakeWindow()
    let seen: HTMLElement | undefined
    const off = onAppWindowChange(() => { seen = getOverlayRoot() })
    setAppWindow(pip)
    expect(seen).toBe(pip.document.body)
    off()
  })
})

describe('bindActiveWindowListener (tweb appWindow.ts:83-122)', () => {
  it('слушатель переезжает за окном: на старом body событие не доходит, на новом — доходит; возврат — обратно', () => {
    const pip = fakeWindow()
    const fn = vi.fn()
    const dispose = bindActiveWindowListener((w) => w.document.body, 'keydown', fn)

    document.body.dispatchEvent(new KeyboardEvent('keydown'))
    expect(fn).toHaveBeenCalledTimes(1)

    setAppWindow(pip)
    document.body.dispatchEvent(new KeyboardEvent('keydown'))
    expect(fn).toHaveBeenCalledTimes(1)
    pip.document.body.dispatchEvent(new Event('keydown'))
    expect(fn).toHaveBeenCalledTimes(2)

    setAppWindow(window)
    pip.document.body.dispatchEvent(new Event('keydown'))
    expect(fn).toHaveBeenCalledTimes(2)
    document.body.dispatchEvent(new KeyboardEvent('keydown'))
    expect(fn).toHaveBeenCalledTimes(3)

    dispose()
  })

  it('диспоузер снимает слушатель и перестаёт следовать за окном', () => {
    const pip = fakeWindow()
    const fn = vi.fn()
    const dispose = bindActiveWindowListener((w) => w.document.body, 'keydown', fn)
    dispose()

    document.body.dispatchEvent(new KeyboardEvent('keydown'))
    setAppWindow(pip)
    pip.document.body.dispatchEvent(new Event('keydown'))
    expect(fn).not.toHaveBeenCalled()
  })

  it('опции слушателя сохраняются при переезде (capture)', () => {
    const pip = fakeWindow()
    const order: string[] = []
    setAppWindow(pip)
    const child = pip.document.createElement('div')
    pip.document.body.append(child)
    child.addEventListener('keydown', () => order.push('target'))
    const dispose = bindActiveWindowListener((w) => w.document.body, 'keydown', () => order.push('capture'), { capture: true })
    setAppWindow(window)
    setAppWindow(pip)
    child.dispatchEvent(new Event('keydown', { bubbles: true }))
    expect(order).toEqual(['capture', 'target'])
    dispose()
  })
})
