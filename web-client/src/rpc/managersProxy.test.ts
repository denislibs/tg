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
})
