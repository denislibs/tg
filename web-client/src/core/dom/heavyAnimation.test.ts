// heavyAnimation — шина «идёт тяжёлая анимация» (порт tweb
// hooks/useHeavyAnimationCheck.ts). Проверяем контракт, на который завязан
// animationIntersector: старт по первому dispatch, конец только когда доиграли
// ВСЕ объявленные промисы, страховочный timeout и досрочный обрыв.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  dispatchHeavyAnimationEvent,
  getHeavyAnimationPromise,
  interruptHeavyAnimation,
  isHeavyAnimationInProgress,
  offHeavyAnimation,
  onHeavyAnimation,
} from './heavyAnimation'

// каждый тест начинает с «ничего не играет»
beforeEach(() => {
  interruptHeavyAnimation()
})

describe('heavyAnimation', () => {
  it('в покое не идёт, промис уже зарезолвен', async () => {
    expect(isHeavyAnimationInProgress()).toBe(false)
    await expect(getHeavyAnimationPromise()).resolves.toBeUndefined()
  })

  it('start/end зовутся ровно по одному разу на событие', async () => {
    const start = vi.fn()
    const end = vi.fn()
    const off = onHeavyAnimation(start, end)

    let resolveA!: () => void
    let resolveB!: () => void
    const a = dispatchHeavyAnimationEvent(new Promise<void>((r) => { resolveA = r }))
    void dispatchHeavyAnimationEvent(new Promise<void>((r) => { resolveB = r }))

    expect(start).toHaveBeenCalledTimes(1)
    expect(isHeavyAnimationInProgress()).toBe(true)

    // первый доиграл — событие ещё идёт, второй в очереди
    resolveA()
    await Promise.resolve()
    await Promise.resolve()
    expect(isHeavyAnimationInProgress()).toBe(true)
    expect(end).not.toHaveBeenCalled()

    resolveB()
    await a
    expect(end).toHaveBeenCalledTimes(1)
    expect(isHeavyAnimationInProgress()).toBe(false)

    off()
  })

  it('подписка посреди события сразу получает start', () => {
    let resolve!: () => void
    void dispatchHeavyAnimationEvent(new Promise<void>((r) => { resolve = r }))

    const start = vi.fn()
    const end = vi.fn()
    const off = onHeavyAnimation(start, end)
    expect(start).toHaveBeenCalledTimes(1)

    resolve()
    off()
  })

  it('timeout заканчивает событие даже если промис завис', async () => {
    vi.useFakeTimers()
    try {
      const end = vi.fn()
      const off = onHeavyAnimation(() => {}, end)
      const promise = dispatchHeavyAnimationEvent(new Promise<void>(() => {}), 50)
      expect(isHeavyAnimationInProgress()).toBe(true)

      await vi.advanceTimersByTimeAsync(60)
      await promise
      expect(end).toHaveBeenCalledTimes(1)
      expect(isHeavyAnimationInProgress()).toBe(false)
      off()
    } finally {
      vi.useRealTimers()
    }
  })

  it('interrupt обрывает событие, зависший промис его больше не трогает', async () => {
    const end = vi.fn()
    const off = onHeavyAnimation(() => {}, end)

    let resolve!: () => void
    const promise = dispatchHeavyAnimationEvent(new Promise<void>((r) => { resolve = r }))
    interruptHeavyAnimation()
    await promise
    expect(end).toHaveBeenCalledTimes(1)
    expect(isHeavyAnimationInProgress()).toBe(false)

    // «опоздавший» промис не должен породить второй end
    resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(end).toHaveBeenCalledTimes(1)
    off()
  })

  it('off снимает слушателя', async () => {
    const start = vi.fn()
    const end = vi.fn()
    onHeavyAnimation(start, end)
    offHeavyAnimation(start, end)

    const promise = dispatchHeavyAnimationEvent(Promise.resolve())
    await promise
    expect(start).not.toHaveBeenCalled()
    expect(end).not.toHaveBeenCalled()
  })
})
