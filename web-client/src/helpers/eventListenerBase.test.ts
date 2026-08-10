// Пины семантики вендореного из tweb EventListenerBase (файл не менять).
import { describe, expect, it, vi } from 'vitest'
import EventListenerBase from './eventListenerBase'

type L = { evt: (a: number, b?: string) => void }

describe('EventListenerBase: пины семантики tweb', () => {
  it('доставляет все аргументы события подписчику', () => {
    const b = new EventListenerBase<L>()
    const cb = vi.fn()
    b.addEventListener('evt', cb)
    b.dispatchEvent('evt', 1, 'x')
    expect(cb).toHaveBeenCalledWith(1, 'x')
  })

  it('reuseResults: подписчик, пришедший ПОСЛЕ события, получает его немедленно', () => {
    const b = new EventListenerBase<L>(true)
    b.dispatchEvent('evt', 7)
    const late = vi.fn()
    b.addEventListener('evt', late)
    expect(late).toHaveBeenCalledWith(7)
  })

  it('без reuseResults поздний подписчик ничего не получает', () => {
    const b = new EventListenerBase<L>()
    b.dispatchEvent('evt', 7)
    const late = vi.fn()
    b.addEventListener('evt', late)
    expect(late).not.toHaveBeenCalled()
  })

  it('once снимает подписку после первой доставки', () => {
    const b = new EventListenerBase<L>()
    const cb = vi.fn()
    b.addEventListener('evt', cb, { once: true })
    b.dispatchEvent('evt', 1)
    b.dispatchEvent('evt', 2)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('исключение в одном подписчике не мешает остальным', () => {
    const b = new EventListenerBase<L>()
    const ok = vi.fn()
    b.addEventListener('evt', () => { throw new Error('boom') })
    b.addEventListener('evt', ok)
    b.dispatchEvent('evt', 1)
    expect(ok).toHaveBeenCalled()
  })

  it('removeEventListener снимает конкретный колбэк', () => {
    const b = new EventListenerBase<L>()
    const cb = vi.fn()
    b.addEventListener('evt', cb)
    b.removeEventListener('evt', cb)
    b.dispatchEvent('evt', 1)
    expect(cb).not.toHaveBeenCalled()
  })

  it('addMultipleEventsListeners подписывает пачкой', () => {
    const b = new EventListenerBase<L>()
    const cb = vi.fn()
    b.addMultipleEventsListeners({ evt: cb })
    b.dispatchEvent('evt', 3)
    expect(cb).toHaveBeenCalledWith(3)
  })
})
