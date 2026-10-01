// heavyAnimation — шина «идёт тяжёлая анимация» (порт tweb
// hooks/useHeavyAnimationCheck.ts). Проверяем контракт, на который завязан
// animationIntersector: старт по первому dispatch, конец только когда доиграли
// ВСЕ объявленные промисы, страховочный timeout и досрочный обрыв.
//
// «Идёт ли анимация» спрашивается так же, как у потребителей tweb
// (`scrollable.ts:180`, `lazyLoadQueue.ts:42`): `!getHeavyAnimationPromise().isFulfilled`.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import ListenerSetter from '@helpers/listenerSetter'
import {
  dispatchHeavyAnimationEvent,
  getHeavyAnimationPromise,
  interruptHeavyAnimation,
  onHeavyAnimation,
} from './heavyAnimation'

const isAnimating = () => !getHeavyAnimationPromise().isFulfilled

// каждый тест начинает с «ничего не играет»
beforeEach(() => {
  interruptHeavyAnimation()
})

describe('heavyAnimation', () => {
  it('в покое не идёт, промис уже зарезолвен', async () => {
    expect(isAnimating()).toBe(false)
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
    expect(isAnimating()).toBe(true)

    // первый доиграл — событие ещё идёт, второй в очереди
    resolveA()
    await Promise.resolve()
    await Promise.resolve()
    expect(isAnimating()).toBe(true)
    expect(end).not.toHaveBeenCalled()

    resolveB()
    await a
    expect(end).toHaveBeenCalledTimes(1)
    expect(isAnimating()).toBe(false)

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
      expect(isAnimating()).toBe(true)

      await vi.advanceTimersByTimeAsync(60)
      await promise
      expect(end).toHaveBeenCalledTimes(1)
      expect(isAnimating()).toBe(false)
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
    expect(isAnimating()).toBe(false)

    // «опоздавший» промис не должен породить второй end
    resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(end).toHaveBeenCalledTimes(1)
    off()
  })

  it('функция отписки снимает слушателя', async () => {
    const start = vi.fn()
    const end = vi.fn()
    const off = onHeavyAnimation(start, end)
    off()

    const promise = dispatchHeavyAnimationEvent(Promise.resolve())
    await promise
    expect(start).not.toHaveBeenCalled()
    expect(end).not.toHaveBeenCalled()
  })

  // tweb useHeavyAnimationCheck.ts:79-91 — третий аргумент: подписку снимает
  // `listenerSetter.removeAll()` владельца (так её отдаёт лента, bubbles.ts:1704).
  it('подписка через listenerSetter снимается его removeAll', async () => {
    const start = vi.fn()
    const end = vi.fn()
    const listenerSetter = new ListenerSetter()
    onHeavyAnimation(start, end, listenerSetter)
    listenerSetter.removeAll()

    await dispatchHeavyAnimationEvent(Promise.resolve())
    expect(start).not.toHaveBeenCalled()
    expect(end).not.toHaveBeenCalled()
  })

  it('подписка через listenerSetter получает start и end', async () => {
    const start = vi.fn()
    const end = vi.fn()
    const listenerSetter = new ListenerSetter()
    onHeavyAnimation(start, end, listenerSetter)

    await dispatchHeavyAnimationEvent(Promise.resolve())
    expect(start).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledTimes(1)
    listenerSetter.removeAll()
  })

  // tweb useHeavyAnimationCheck.ts:58 — отладочная ручка в глобальном объекте.
  it('dispatchHeavyAnimationEvent выставлен на window', () => {
    expect((window as unknown as Record<string, unknown>).dispatchHeavyAnimationEvent).toBe(dispatchHeavyAnimationEvent)
  })
})
