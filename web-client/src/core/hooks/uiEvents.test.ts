// src/core/hooks/uiEvents.test.ts
import { describe, it, expect, vi } from 'vitest'
import { uiEvents } from './uiEvents'

describe('uiEvents', () => {
  it('delivers to subscribers and unsubscribes', () => {
    const cb = vi.fn()
    const off = uiEvents.on('rt:new_message', cb)
    uiEvents.emit('rt:new_message', { msg_id: 1 })
    expect(cb).toHaveBeenCalledWith({ msg_id: 1 })
    off()
    uiEvents.emit('rt:new_message', { msg_id: 2 })
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
