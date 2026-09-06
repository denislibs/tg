import { describe, it, expect } from 'vitest'
import { SuperMessagePort } from './superMessagePort'
import { createManagers, registerManagers } from './managersProxy'

describe('managers proxy', () => {
  it('routes managers.x.y(args) to the registered manager method', async () => {
    const ch = new MessageChannel()
    const ui = new SuperMessagePort(ch.port1)
    const worker = new SuperMessagePort(ch.port2)
    registerManagers(worker, {
      health: { async check() { return { status: 'ok' } } },
    })
    const managers = createManagers<{ health: { check(): Promise<{ status: string }> } }>(ui)
    await expect(managers.health.check()).resolves.toEqual({ status: 'ok' })
  })

  it('memoizes manager and method proxies (stable identity between accesses)', () => {
    const ch = new MessageChannel()
    const ui = new SuperMessagePort(ch.port1)
    const managers = createManagers<{ health: { check: () => unknown }; auth: Record<string, unknown> }>(ui)
    expect(managers.health).toBe(managers.health)            // тот же прокси менеджера
    expect(managers.health.check).toBe(managers.health.check) // та же функция метода
    expect(managers.health).not.toBe(managers.auth)          // разные менеджеры — разные прокси
  })

  // Символы — служебный протокол чужих рантаймов, а не имена менеджеров/методов.
  // Ответ «менеджером» на $RAW/$PROXY ломал прокси в Solid-сторе (пин на исход —
  // shared/solid/mountSolid.solid.test.tsx).
  it('на символьные ключи отвечает undefined, а не менеджером/методом', () => {
    const ch = new MessageChannel()
    const ui = new SuperMessagePort(ch.port1)
    const managers = createManagers<Record<string, unknown>>(ui) as Record<PropertyKey, unknown>

    expect(managers[Symbol.for('store-raw')]).toBeUndefined()
    expect((managers.auth as Record<PropertyKey, unknown>)[Symbol.iterator]).toBeUndefined()
  })
})
