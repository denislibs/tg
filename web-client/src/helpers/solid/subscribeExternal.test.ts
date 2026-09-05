// Пин нового примитива: он должен вести себя как React `useSyncExternalStore`
// — читать снимок сразу, обновляться по уведомлению подписки и снимать её
// самостоятельно на `onCleanup` реактивного владельца.
import { describe, expect, it } from 'vitest'
import { createRoot } from 'solid-js'
import { subscribeExternal } from './subscribeExternal'

function fakeStore<T>(initial: T) {
  let value = initial
  const subs = new Set<() => void>()
  return {
    get: () => value,
    set: (v: T) => {
      value = v
      subs.forEach((f) => f())
    },
    subscribe: (cb: () => void) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    subCount: () => subs.size,
  }
}

describe('subscribeExternal', () => {
  it('отдаёт снимок сразу — без ожидания первого уведомления', () => {
    const store = fakeStore(1)
    createRoot((dispose) => {
      const value = subscribeExternal(store.subscribe, store.get)
      expect(value()).toBe(1)
      dispose()
    })
  })

  it('обновляется по уведомлению подписки', () => {
    const store = fakeStore('a')
    createRoot((dispose) => {
      const value = subscribeExternal(store.subscribe, store.get)
      store.set('b')
      expect(value()).toBe('b')
      dispose()
    })
  })

  it('снимает подписку на onCleanup владельца — второй set не должен падать и не должен будить снятый accessor', () => {
    const store = fakeStore(0)
    let value!: () => number
    const dispose = createRoot((dispose) => {
      value = subscribeExternal(store.subscribe, store.get)
      return dispose
    })
    expect(store.subCount()).toBe(1)
    dispose()
    expect(store.subCount()).toBe(0) // МУТАЦИЯ: убери onCleanup(unsubscribe) — упадёт здесь
    store.set(42) // не должно бросить, хотя accessor больше никто не слушает
    expect(value()).toBe(0) // значение осталось прежним — сигнал больше не питается
  })
})
