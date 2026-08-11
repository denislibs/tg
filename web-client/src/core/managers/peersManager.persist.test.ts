// Второй наблюдаемый эффект владельца карточек — write-through в офлайн-стор
// (`saveUsers`): именно из него `getUsers` поднимает имена/аватары, когда сети
// нет (ветка catch → `loadUsers`). Строки `void saveUsers(...)` были не покрыты
// ничем: их удаление не красит ни одного теста, а приложение после перезагрузки
// без сети остаётся без единого имени. Проверяем оба пути записи — ответ /users
// и патч имени по realtime-кадру.
//
// Отдельный файл от peersManager.test.ts: `fake-indexeddb/auto` — глобальный
// побочный эффект на весь модуль, а тем тестам реальная IDB не нужна (там
// persist молча уходит в no-op, как и в happy-dom без полифилла).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect, beforeEach } from 'vitest'
import { newPeersManager } from './peersManager'
import { loadUsers } from '../store/persist'
import type { RestClient } from '../net/restClient'

function fakeRest(users: { id: number; username: string; display_name: string; avatar_url: string }[]) {
  return {
    async get<R>(_path: string, query?: Record<string, string | number>): Promise<R> {
      const requested = new Set(String(query?.ids ?? '').split(',').filter(Boolean).map(Number))
      return { users: users.filter((u) => requested.has(u.id)) } as unknown as R
    },
  } as unknown as RestClient
}

// Свежая БД на тест: persist держит модульные синглтоны (dbPromise/lockedCache),
// иначе записи одного кейса протекают в другой (приём из workerCore.test.ts).
// Через `globalThis.`, а не голым `indexedDB =` (как в authManager.test.ts:14 и
// workerCore.test.ts:25) — то же самое присваивание, но без находки oxlint
// `no-global-assign`, которую те две строки дают.
beforeEach(() => { globalThis.indexedDB = new IDBFactory() })

describe('PeersManager — write-through в офлайн-стор', () => {
  it('ответ /users уезжает на диск (офлайн-резолв имён после перезагрузки)', async () => {
    const mgr = newPeersManager({ rest: fakeRest([{ id: 2, username: 'bob', display_name: 'Боб', avatar_url: '/a.png' }]) })

    await mgr.getUsers([2])
    await new Promise((r) => setTimeout(r, 0)) // saveUsers — fire-and-forget

    expect(await loadUsers()).toEqual([{ id: 2, username: 'bob', displayName: 'Боб', avatarUrl: '/a.png' }])
  })

  it('патч имени по user_update тоже уезжает на диск', async () => {
    const mgr = newPeersManager({ rest: fakeRest([{ id: 2, username: 'bob', display_name: 'Боб', avatar_url: '/a.png' }]) })
    await mgr.getUsers([2])

    mgr.applyUserUpdate({ id: 2, username: 'bobby', display_name: 'Бобби', avatar_changed: false })
    await new Promise((r) => setTimeout(r, 0))

    expect(await loadUsers()).toEqual([{ id: 2, username: 'bobby', displayName: 'Бобби', avatarUrl: '/a.png' }])
  })
})
