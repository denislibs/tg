/**
 * `eachMinute`/`eachTimeout` — порт tweb `helpers/eachMinute.ts`,
 * `helpers/eachTimeout.ts` (812502980). Таймаут, а не интервал: следующий запуск
 * — ровно на границе минуты, считая от текущих секунд (`60 - getSeconds()`), и
 * первый запуск — сразу (`runFirst` по умолчанию у `eachTimeout`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import eachMinute from './eachMinute'

afterEach(() => {
  vi.useRealTimers()
})

describe('eachMinute', () => {
  it('зовёт сразу и затем на каждой границе минуты; отмена останавливает', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 27, 22, 16, 45))
    const callback = vi.fn()

    const cancel = eachMinute(callback)
    expect(callback).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(14_999)
    expect(callback).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(callback).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(60_000)
    expect(callback).toHaveBeenCalledTimes(3)

    cancel()
    vi.advanceTimersByTime(120_000)
    expect(callback).toHaveBeenCalledTimes(3)
  })
})
