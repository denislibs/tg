// Менеджер сессий: провод — конструкторы схемы, плоской проекции больше нет.
//
// Оба теста пинят решения задачи 7, которые иначе не краснеют нигде: `list()`
// отдаёт `authorization` КАК ЕСТЬ (возвращение `mapSession` сразу покрасит
// первый), а `terminate`/`terminateOthers` разворачивают ответный `Bool` в
// исход — именно по нему вкладка решает, снимать ли строку.
import { describe, it, expect, vi } from 'vitest'
import { newSessionsManager } from './sessionsManager'
import type { RestClient } from '../net/restClient'

const authorization = {
  _: 'authorization',
  pFlags: { current: true },
  hash: 7,
  device_model: 'Chrome',
  platform: 'browser',
  date_created: 1_700_000_000,
  date_active: 1_700_000_100,
  ip: '1.2.3.4',
  country: 'Germany',
}

describe('SessionsManager', () => {
  it('list отдаёт конструкторы authorization без перекладывания в плоскую форму', async() => {
    const get = vi.fn(async () => ({
      _: 'account.authorizations',
      authorization_ttl_days: 0,
      authorizations: [authorization],
    }))

    const list = await newSessionsManager({ rest: { get } as unknown as RestClient }).list()

    expect(list).toEqual([authorization])
    expect(get).toHaveBeenCalledWith('/sessions')
  })

  it('пустой ответ — пустой список, а не падение', async() => {
    const rest = { get: vi.fn(async () => ({ _: 'account.authorizations', authorization_ttl_days: 0 })) } as unknown as RestClient

    await expect(newSessionsManager({ rest }).list()).resolves.toEqual([])
  })

  it('terminate адресует сессию её hash и отдаёт исход из конструктора Bool', async() => {
    const del = vi.fn(async () => ({ _: 'boolTrue' }))
    const mgr = newSessionsManager({ rest: { del } as unknown as RestClient })

    await expect(mgr.terminate(7)).resolves.toBe(true)
    expect(del).toHaveBeenCalledWith('/sessions/7')

    del.mockResolvedValueOnce({ _: 'boolFalse' })
    await expect(mgr.terminate(7)).resolves.toBe(false)
  })

  it('terminateOthers бьёт в /sessions/others и отдаёт исход', async() => {
    const del = vi.fn(async () => ({ _: 'boolTrue' }))
    const mgr = newSessionsManager({ rest: { del } as unknown as RestClient })

    await expect(mgr.terminateOthers()).resolves.toBe(true)
    expect(del).toHaveBeenCalledWith('/sessions/others')

    del.mockResolvedValueOnce({ _: 'boolFalse' })
    await expect(mgr.terminateOthers()).resolves.toBe(false)
  })
})
