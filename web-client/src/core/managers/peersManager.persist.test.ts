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
import { loadUsers, saveUsers } from '../store/persist'
import { HttpError, type RestClient } from '../net/restClient'

function fakeRest(users: { id: number; username: string; display_name: string; avatar_url: string }[]) {
  return {
    async get<R>(_path: string, query?: Record<string, string | number>): Promise<R> {
      const requested = new Set(String(query?.ids ?? '').split(',').filter(Boolean).map(Number))
      return { users: users.filter((u) => requested.has(u.id)) } as unknown as R
    },
  } as unknown as RestClient
}

/** Клиент, у которого /users всегда падает заданной ошибкой. */
function failingRest(err: Error) {
  return { async get<R>(): Promise<R> { throw err } } as unknown as RestClient
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

// Обратная сторона того же офлайн-фолбэка: он должен ловить ТОЛЬКО «сети нет».
// `if (e instanceof HttpError) throw e` отличает это от «сервер ответил 401/500»
// (RestClient кидает HttpError на любой не-2xx, restClient.ts:118). Снять
// пробрасывание — и отозванная сессия молча превращается в офлайн-режим:
// getUsers отдаёт вчерашние карточки с диска, а вызывающий так и не узнает, что
// его разлогинили. Строка предсуществующая, но норма построчная и от даты
// появления не освобождает.
describe('PeersManager — офлайн-фолбэк ловит только отсутствие сети', () => {
  it('HTTP-ошибка пробрасывается, а не подменяется карточками с диска', async () => {
    // Диск прогрет предыдущей (успешной) сессией.
    const warm = newPeersManager({ rest: fakeRest([{ id: 2, username: 'bob', display_name: 'Боб', avatar_url: '/a.png' }]) })
    await warm.getUsers([2])
    await new Promise((r) => setTimeout(r, 0))
    expect(await loadUsers()).toHaveLength(1) // фолбэку есть чем подменить — иначе пин был бы вакуумным

    // Новая сессия: память пуста, токен отозван.
    const mgr = newPeersManager({ rest: failingRest(new HttpError(401, 'HTTP 401')) })

    await expect(mgr.getUsers([2])).rejects.toBeInstanceOf(HttpError)
  })

  it('сетевая ошибка → карточки поднимаются с диска', async () => {
    const warm = newPeersManager({ rest: fakeRest([{ id: 2, username: 'bob', display_name: 'Боб', avatar_url: '/a.png' }]) })
    await warm.getUsers([2])
    await new Promise((r) => setTimeout(r, 0))

    const mgr = newPeersManager({ rest: failingRest(new TypeError('Failed to fetch')) })

    expect(await mgr.getUsers([2])).toEqual([{ id: 2, username: 'bob', displayName: 'Боб', avatarUrl: '/a.png' }])
  })

  // Подъём с диска НЕ должен затирать то, что уже в памяти: диск бывает старее
  // (запись другой сессии; собственный `void saveUsers` ещё в полёте — он
  // fire-and-forget, а loadUsers поднимает СРАЗУ ВСЕХ персистнутых, не только
  // запрошенных). Без охраны `if (!cache.has(u.id))` первая же сетевая ошибка по
  // ЧУЖОМУ id откатывала бы свежие карточки к вчерашним — молча и во всех
  // вкладках сразу (владелец опубликует откат операцией).
  it('подъём с диска не затирает более свежую карточку в памяти', async () => {
    // Один и тот же менеджер: сначала прогревает память по сети, потом уходит в
    // офлайн — иначе затирать было бы нечего.
    const net = { offline: false }
    const rest = {
      async get<R>(_path: string, query?: Record<string, string | number>): Promise<R> {
        if (net.offline) throw new TypeError('Failed to fetch')
        const requested = new Set(String(query?.ids ?? '').split(',').filter(Boolean).map(Number))
        return { users: [{ id: 2, username: 'bobby', display_name: 'Бобби', avatar_url: '/new.png' }].filter((u) => requested.has(u.id)) } as unknown as R
      },
    } as unknown as RestClient
    const mgr = newPeersManager({ rest })
    await mgr.getUsers([2]) // память: свежая карточка
    // На диске — копия постарше (запись другой сессии / ещё не долетевший write-through).
    await saveUsers([{ id: 2, username: 'bob', displayName: 'Боб', avatarUrl: '/old.png' }])

    // Сетевая ошибка по ЧУЖОМУ id: фолбэк поднимает с диска ВСЕХ, включая id 2.
    net.offline = true
    expect(await mgr.getUsers([3])).toEqual([])

    expect(await mgr.getUsers([2])).toEqual([{ id: 2, username: 'bobby', displayName: 'Бобби', avatarUrl: '/new.png' }])
  })
})
