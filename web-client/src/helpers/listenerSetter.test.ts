// `ListenerSetter.addCleanup` (tweb helpers/listenerSetter.ts:99-110): уборка
// исполняется вместе со снятием слушателей и ровно один раз; возвращённая
// функция её отзывает. Первый вызывающий — `checkboxFields.solid.tsx` (Solid-корни
// строк живут столько же, сколько слушатели вкладки).
import { describe, expect, it, vi } from 'vitest'
import ListenerSetter from './listenerSetter'

describe('ListenerSetter.addCleanup', () => {
  it('removeAll зовёт уборку один раз, повторный removeAll — ноль', () => {
    const listenerSetter = new ListenerSetter()
    const cleanup = vi.fn()
    listenerSetter.addCleanup(cleanup)

    listenerSetter.removeAll()
    listenerSetter.removeAll()

    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('отозванная уборка не исполняется', () => {
    const listenerSetter = new ListenerSetter()
    const cleanup = vi.fn()
    listenerSetter.addCleanup(cleanup)()

    listenerSetter.removeAll()

    expect(cleanup).not.toHaveBeenCalled()
  })
})
