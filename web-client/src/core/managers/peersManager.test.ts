// src/core/managers/peersManager.test.ts
import { describe, it, expect } from 'vitest'
import { newPeersManager } from './peersManager'
import type { RestClient } from '../net/restClient'

function fakeRest(users: { id: number; username: string; display_name: string; avatar_url: string }[]) {
  const calls: { path: string; query?: Record<string, string | number> }[] = []
  const rest = {
    async get<R>(path: string, query?: Record<string, string | number>): Promise<R> {
      calls.push({ path, query })
      // Echo back only the requested ids, like the real /users endpoint.
      const requested = new Set(String(query?.ids ?? '').split(',').filter(Boolean).map(Number))
      return { users: users.filter((u) => requested.has(u.id)) } as unknown as R
    },
  } as unknown as RestClient
  return { rest, calls }
}

describe('PeersManager', () => {
  it('maps GET /users payload snake->camel', async () => {
    const { rest, calls } = fakeRest([
      { id: 2, username: 'bob', display_name: 'Bob', avatar_url: 'a.png' },
    ])
    const mgr = newPeersManager({ rest })
    const peers = await mgr.getUsers([2])
    expect(calls[0].path).toBe('/users')
    expect(calls[0].query).toEqual({ ids: '2' })
    expect(peers).toEqual([{ id: 2, username: 'bob', displayName: 'Bob', avatarUrl: 'a.png' }])
  })

  it('caches: two calls for the same id => one GET /users', async () => {
    const { rest, calls } = fakeRest([
      { id: 5, username: 'cy', display_name: 'Cy', avatar_url: '' },
    ])
    const mgr = newPeersManager({ rest })
    const a = await mgr.getUsers([5])
    const b = await mgr.getUsers([5])
    expect(calls).toHaveLength(1)
    expect(a).toEqual(b)
    expect(b[0].displayName).toBe('Cy')
  })

  it('only fetches missing ids on subsequent calls', async () => {
    const { rest, calls } = fakeRest([
      { id: 1, username: 'a', display_name: 'A', avatar_url: '' },
      { id: 2, username: 'b', display_name: 'B', avatar_url: '' },
    ])
    const mgr = newPeersManager({ rest })
    await mgr.getUsers([1])
    await mgr.getUsers([1, 2])
    expect(calls).toHaveLength(2)
    expect(calls[0].query).toEqual({ ids: '1' })
    expect(calls[1].query).toEqual({ ids: '2' })
  })
})

// Stage 1C.2 (Task 2): менеджер — владелец карточек, он же решает, что карточка
// изменилась. Правило инвалидации теперь ОДНО и живёт здесь; проверяем его
// границы прямо на владельце (сквозной сценарий «воркер и витрина не
// расходятся» — в client/realtime/storeProjection.peers.test.ts).
describe('PeersManager — правило инвалидации (владелец карточек)', () => {
  function stand(users: { id: number; username: string; display_name: string; avatar_url: string }[]) {
    const { rest, calls } = fakeRest(users)
    const ops: unknown[] = []
    const mgr = newPeersManager({ rest, onPeerOps: (o) => ops.push(...o) })
    return { mgr, calls, ops }
  }

  it('имя не изменилось → операция не публикуется (витрина не пересобирается впустую)', async () => {
    const { mgr, ops } = stand([{ id: 2, username: 'bob', display_name: 'Боб', avatar_url: '' }])
    await mgr.getUsers([2])
    ops.length = 0

    mgr.applyUserUpdate({ id: 2, username: 'bob', display_name: 'Боб', avatar_changed: false })

    expect(ops).toEqual([])
  })

  it('пир неизвестен воркеру → ни операции, ни похода в сеть', async () => {
    const { mgr, calls, ops } = stand([{ id: 2, username: 'bob', display_name: 'Боб', avatar_url: '' }])

    mgr.applyUserUpdate({ id: 404, username: 'x', display_name: 'X', avatar_changed: true })
    await new Promise((r) => setTimeout(r, 0))

    expect(ops).toEqual([])
    expect(calls).toEqual([])
  })

  it('avatar_changed: имя патчится из кадра, аватар до-фетчится одним запросом', async () => {
    const users = [{ id: 2, username: 'bob', display_name: 'Боб', avatar_url: '/old.png' }]
    const { mgr, calls, ops } = stand(users)
    await mgr.getUsers([2])
    ops.length = 0
    // Кадр несёт новое имя, /users отдаст его же вместе с новым аватаром —
    // до-фетч приходит ПОСЛЕ патча и перекрывает его карточкой сервера.
    Object.assign(users[0], { avatar_url: '/new.png', username: 'bobby', display_name: 'Бобби' })

    mgr.applyUserUpdate({ id: 2, username: 'bobby', display_name: 'Бобби', avatar_changed: true })
    await new Promise((r) => setTimeout(r, 0))

    expect(ops).toEqual([
      { op: 'patch', id: 2, fields: { username: 'bobby', displayName: 'Бобби' } },
      { op: 'upsert', peers: [{ id: 2, username: 'bobby', displayName: 'Бобби', avatarUrl: '/new.png' }] },
    ])
    expect(calls).toHaveLength(2) // первичный getUsers + один до-фетч
  })
})

// Метка «протухла» (замена прежнего cache.delete) — состояние, и снимать его
// обязан успешный до-фетч. Не снять — не «чуть медленнее»: пир, ОДИН РАЗ
// сменивший аватар, до конца жизни воркера остаётся протухшим, и КАЖДЫЙ
// последующий getUsers с этим id заново бьёт в /users. В списке чатов и ленте
// это происходит постоянно. Результат при этом всегда верный, поэтому ловить
// надо не карточку, а число походов в сеть.
describe('PeersManager — метка «протухла» снимается успешным перечитыванием', () => {
  it('после avatar_changed повторные getUsers идут из кэша, а не в сеть', async () => {
    const { rest, calls } = fakeRest([{ id: 2, username: 'bob', display_name: 'Боб', avatar_url: '/old.png' }])
    const mgr = newPeersManager({ rest })
    await mgr.getUsers([2]) // запрос 1: первичный
    mgr.applyUserUpdate({ id: 2, username: 'bob', display_name: 'Боб', avatar_changed: true })
    await new Promise((r) => setTimeout(r, 0)) // запрос 2: до-фетч аватара

    await mgr.getUsers([2])
    await mgr.getUsers([2])

    expect(calls).toHaveLength(2)
  })
})
