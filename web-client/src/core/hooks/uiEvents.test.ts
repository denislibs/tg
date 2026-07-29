// src/core/hooks/uiEvents.test.ts
import { describe, it, expect, vi } from 'vitest'
import { uiEvents } from './uiEvents'

describe('uiEvents (typed UI bus)', () => {
  it('delivers to subscribers and unsubscribes', () => {
    const cb = vi.fn()
    const off = uiEvents.on('ui:toast', cb)
    uiEvents.emit('ui:toast', 'hello')
    expect(cb).toHaveBeenCalledWith('hello')
    off()
    uiEvents.emit('ui:toast', 'again')
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
