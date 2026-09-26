// Общая слабая подписка всех `Scrollable` — порт tweb
// `src/tests/scrollableSharedListeners.test.ts` (ffd925068), B14 в
// `docs/tweb/delta/security-and-bugs.md`.
//
// Прежде каждый экземпляр в `setListeners` вешал СВОЙ `window.resize` и СВОЮ
// пару обработчиков тяжёлой анимации; оба замыкания держат `this`, поэтому
// скроллер, хозяин которого не позвал `destroy()`, оставался достижим из
// `window` вместе с `container` и всем деревом под ним. Контракт, который здесь
// закреплён: запись в реестре слабая, подписка на `window` одна на все
// экземпляры, оба события (resize и начало/конец тяжёлой анимации) доходят до
// каждого живого, экземпляр, рождённый посреди анимации, догоняет её, `destroy()`
// снимает запись, собранная сборщиком ссылка выбрасывается при обходе.
//
// Реестр достаём так же, как из консоли, — через `MOUNT_CLASS_TO`.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ctx = vi.hoisted(() => ({}) as Record<string, unknown>)

vi.mock('@config/debug', async (importOriginal) => ({
  ...await importOriginal<typeof import('@config/debug')>(),
  MOUNT_CLASS_TO: ctx,
}))

import Scrollable from '@components/scrollable'
import { dispatchHeavyAnimationEvent, interruptHeavyAnimation } from '@core/dom/heavyAnimation'

const registry = () => ctx.listeningScrollables as Set<WeakRef<Scrollable>>
const live = () => [...registry()].map((ref) => ref.deref()).filter((s): s is Scrollable => !!s)

const make = () => {
  const el = document.createElement('div')
  document.body.append(el)
  return new Scrollable(el)
}

const runHeavyAnimation = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => resolve = r)
  void dispatchHeavyAnimationEvent(promise)
  return {
    end: async () => {
      resolve()
      // конец идёт через promise.then → Promise.race → .then — даём очереди стечь
      await new Promise((r) => setTimeout(r, 0))
    },
  }
}

describe('Scrollable: общая слабая подписка (tweb ffd925068)', () => {
  beforeEach(() => {
    // состояние шины модульное: недоигранная анимация проглотила бы следующий старт
    interruptHeavyAnimation()
    registry()?.forEach((ref) => ref.deref()?.destroy())
    registry()?.clear()
    document.body.replaceChildren()
  })

  it('экземпляр лежит в реестре слабой ссылкой, а не сам', () => {
    const scrollable = make()
    const refs = [...registry()]
    expect(refs).toHaveLength(1)
    expect(refs[0]).toBeInstanceOf(WeakRef)
    expect(refs[0].deref()).toBe(scrollable)
    // ради этого всё и затевалось: модульный реестр не держит экземпляр сильно
    expect(refs.some((ref) => (ref as unknown) === scrollable)).toBe(false)
  })

  it('на window подписывается один раз, а не на каждый экземпляр', () => {
    const spy = vi.spyOn(window, 'addEventListener')
    make()
    make()
    make()
    // не больше одного при любом порядке тестов: подписка могла случиться в
    // предыдущем. Со слушателем на экземпляр здесь было бы три
    expect(spy.mock.calls.filter(([type]) => String(type) === 'resize').length).toBeLessThanOrEqual(1)
    spy.mockRestore()
  })

  it('настоящий resize окна доходит до каждого живого экземпляра', async () => {
    const a = make(), b = make()
    const calls: string[] = []
    // resize → `onScroll` → отложенное измерение → `onAdditionalScroll`
    a.onAdditionalScroll = () => { calls.push('a') }
    b.onAdditionalScroll = () => { calls.push('b') }

    window.dispatchEvent(new Event('resize'))
    // измерение троттлится (`SCROLL_THROTTLE` 24 мс или кадр) — ждём с запасом
    await new Promise((r) => setTimeout(r, 50))

    expect(calls.sort()).toEqual(['a', 'b'])
  })

  it('начало и конец тяжёлой анимации доходят до каждого живого экземпляра', async () => {
    const a = make(), b = make()
    const animation = runHeavyAnimation()
    expect(a.isHeavyAnimationInProgress).toBe(true)
    expect(b.isHeavyAnimationInProgress).toBe(true)

    await animation.end()
    expect(a.isHeavyAnimationInProgress).toBe(false)
    expect(b.isHeavyAnimationInProgress).toBe(false)
  })

  it('экземпляр, созданный посреди анимации, её догоняет', async () => {
    const animation = runHeavyAnimation()
    const late = make()
    // общая подписка старт повторить не может — `setListeners` обязан спросить сам
    expect(late.isHeavyAnimationInProgress).toBe(true)

    await animation.end()
    expect(late.isHeavyAnimationInProgress).toBe(false)
  })

  it('destroy() снимает запись, и события до экземпляра больше не доходят', () => {
    const scrollable = make()
    scrollable.destroy()
    expect(registry().size).toBe(0)

    runHeavyAnimation()
    expect(scrollable.isHeavyAnimationInProgress).toBe(false)
  })

  it('ссылка на собранный экземпляр выбрасывается при обходе', () => {
    const kept = make()
    const collected = { deref: () => undefined } as unknown as WeakRef<Scrollable>
    registry().add(collected)
    expect(registry().size).toBe(2)

    runHeavyAnimation()
    expect(registry().has(collected)).toBe(false)
    expect(live()).toEqual([kept])
  })
})
