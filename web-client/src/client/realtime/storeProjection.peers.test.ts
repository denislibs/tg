// Stage 1C.2 (Task 2): карточки пиров — владелец воркерный peersManager, он же
// решает, ЧТО изменилось, и публикует это операцией (rt:peer_op).
// `core/peerCache.ts` — зеркало, единственный писатель которого проектор (см.
// также core/noDuplicatePeers.test.ts — что вторых писателей не завелось).
//
// Стенд склеивает настоящий менеджер с настоящим проектором тем же каналом, что
// и прод: peersManager.onPeerOps → (в проде: broadcast rt:peer_op → веер портов →
// realtimeBridge) → rootScope.dispatchEventSingle → storeProjection. Проверять
// стороны по отдельности тут бессмысленно: предмет задачи — что кэш воркера и
// витрина НЕ расходятся, а это свойство пары.
//
// Гейт-паттерн (registerStoreProjection один раз в beforeAll +
// dispatchEventSingle) — как в storeProjection.me.test.ts.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT } from '../../core/realtime/events'
import { cachedPeer, resetPeerMirror } from '../../core/peerCache'
import { newPeersManager } from '../../core/managers/peersManager'
import type { RestClient } from '../../core/net/restClient'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'

type RawUser = { id: number; username: string; display_name: string; avatar_url: string }

/** Фейковый /users с рубильником сети: `offline = true` — запрос падает так же,
 *  как реальный обрыв (не HttpError), т.е. по ветке офлайн-фолбэка getUsers. */
function stand(users: RawUser[]) {
  const net = { offline: false, calls: 0 }
  const rest = {
    async get<R>(_path: string, query?: Record<string, string | number>): Promise<R> {
      net.calls++
      if (net.offline) throw new TypeError('Failed to fetch')
      const requested = new Set(String(query?.ids ?? '').split(',').filter(Boolean).map(Number))
      return { users: users.filter((u) => requested.has(u.id)) } as unknown as R
    },
  } as unknown as RestClient
  // onPeerOps — та самая проводка, которую в проде задаёт workerCore
  // (broadcast(RT.peerOp, {ops})); здесь вместо веера портов сразу локальный
  // ре-эмит, как это делает realtimeBridge на вкладке.
  const mgr = newPeersManager({ rest, onPeerOps: (ops) => rootScope.dispatchEventSingle(RT.peerOp, { ops }) })
  return { mgr, net, users }
}

describe('storeProjection — карточки пиров: воркер владеет, витрина зеркалит', () => {
  beforeAll(() => registerStoreProjection({} as unknown as Managers))

  beforeEach(() => { resetPeerMirror() })

  // Базовый канал: витрина объявила пробел — карточка доезжает сама, без
  // `.then(upsert)` на вызывающей стороне (тот второй писатель убран из usePeers).
  it('fillMirror → карточка легла в стор через операцию', async () => {
    const { mgr } = stand([{ id: 2, username: 'bob', display_name: 'Боб', avatar_url: '/a.png' }])

    await mgr.fillMirror([2])

    expect(cachedPeer(2)).toEqual({ id: 2, username: 'bob', displayName: 'Боб', avatarUrl: '/a.png', avatarPreview: '' })
  })

  // Полнота канала: карточку мог уже вытянуть другой хук или другая вкладка —
  // тогда в кэше воркера попадание, менять нечего, и публикация «только
  // изменившегося» не доехала бы до витрины НИКОГДА. На объявленный пробел
  // отвечаем всегда — это и есть сценарий второй вкладки, открытой позже.
  it('пробел зеркала при попадании в кэш воркера всё равно наполняет пустую витрину', async () => {
    const { mgr, net } = stand([{ id: 2, username: 'bob', display_name: 'Боб', avatar_url: '/a.png' }])
    await mgr.getUsers([2])
    // Витрина «второй вкладки»: кэш воркера уже прогрет, зеркало пусто.
    resetPeerMirror()

    await mgr.fillMirror([2])

    expect(net.calls).toBe(1)
    expect(cachedPeer(2)).toMatchObject({ displayName: 'Боб' })
  })

  // user_update (имя) — точечная операция patch: чужие карточки не пересобираются
  // (ссылка та же), у затронутой меняются ровно имя/username, аватар цел.
  it('user_update → обновилась ровно одна карточка', async () => {
    const { mgr } = stand([
      { id: 2, username: 'bob', display_name: 'Боб', avatar_url: '/a.png' },
      { id: 3, username: 'eve', display_name: 'Ева', avatar_url: '/e.png' },
    ])
    await mgr.fillMirror([2, 3])
    const before3 = cachedPeer(3)

    mgr.applyUserUpdate({ id: 2, username: 'bobby', display_name: 'Бобби', avatar_changed: false })

    expect(cachedPeer(2)).toEqual({ id: 2, username: 'bobby', displayName: 'Бобби', avatarUrl: '/a.png', avatarPreview: '' })
    // чужая карточка не пересобрана — та же ссылка
    expect(cachedPeer(3)).toBe(before3)
  })

  // ГЛАВНЫЙ ПИН задачи. Раньше кадр правил два кэша порознь: воркер выселял
  // запись (cache.delete), витрина патчила имя и шла за аватаром сама
  // (refresh().then(upsert)). Упавший до-фетч возвращал [] — upsert([]) no-op, и
  // получалось ДВА разных состояния одного факта: у воркера карточки нет вовсе,
  // у витрины старый avatarUrl, причём навсегда (ни таймера, ни повтора, а
  // usePeers за уже лежащим в сторе id второй раз не сходит).
  // Теперь правило инвалидации одно и живёт у владельца: карточка помечается
  // протухшей, но остаётся отданной — обе стороны показывают одно и то же.
  it('avatar_changed при упавшем до-фетче: воркер и витрина держат ОДНУ И ТУ ЖЕ карточку', async () => {
    const { mgr, net, users } = stand([{ id: 2, username: 'bob', display_name: 'Боб', avatar_url: '/old.png' }])
    await mgr.fillMirror([2])

    net.offline = true
    mgr.applyUserUpdate({ id: 2, username: 'bob', display_name: 'Боб', avatar_changed: true })
    await vi_flush()

    // Что отдаёт воркер (сеть всё ещё лежит — до-фетч падает снова) против того,
    // что показывает витрина. Расхождение здесь — ровно тот дефект.
    const [fromWorker] = await mgr.getUsers([2])
    const fromStore = cachedPeer(2)
    expect(fromWorker).toEqual(fromStore)
    expect(fromStore).toMatchObject({ avatarUrl: '/old.png' })

    // Сеть вернулась — метка «протухла» не потерялась: следующий же getUsers
    // перечитывает /users, и новый аватар доезжает до обеих сторон разом.
    users[0].avatar_url = '/new.png'
    net.offline = false
    const [refreshed] = await mgr.getUsers([2])
    expect(refreshed).toMatchObject({ avatarUrl: '/new.png' })
    expect(cachedPeer(2)).toEqual(refreshed)
  })

  // Тот же инвариант «не расходятся», но по оси ИМЕНИ, а не аватара, и он
  // отдельный: на name-only-кадре до-фетча нет, поэтому разойтись стороны могут
  // навсегда и молча. Проверять надо не витрину (её патч виден в тесте выше), а
  // то, что кадр лёг В КЭШ ВЛАДЕЛЬЦА: иначе прямые потребители getUsers
  // (useGroupInfo, тост уведомления) до конца жизни воркера рисуют старое имя,
  // пока витрина показывает новое. Ответ владельца берём заведомо из кэша —
  // число запросов не изменилось, значит в сеть за ним не ходили.
  it('user_update без аватара: воркер и витрина держат ОДНУ И ТУ ЖЕ карточку', async () => {
    const { mgr, net } = stand([{ id: 2, username: 'bob', display_name: 'Боб', avatar_url: '/a.png' }])
    await mgr.fillMirror([2])

    mgr.applyUserUpdate({ id: 2, username: 'bobby', display_name: 'Бобби', avatar_changed: false })

    const [fromWorker] = await mgr.getUsers([2])
    expect(net.calls).toBe(1)
    expect(fromWorker).toEqual(cachedPeer(2))
    expect(fromWorker).toMatchObject({ displayName: 'Бобби' })
  })

  // Успешный до-фетч аватара: витрина получает новый url без единого запроса со
  // своей стороны (раньше в /users ходили двое — usePeers и проектор).
  it('avatar_changed при живой сети → новый аватар доезжает до витрины сам', async () => {
    const { mgr, net, users } = stand([{ id: 2, username: 'bob', display_name: 'Боб', avatar_url: '/old.png' }])
    await mgr.fillMirror([2])
    users[0].avatar_url = '/new.png'

    mgr.applyUserUpdate({ id: 2, username: 'bob', display_name: 'Боб', avatar_changed: true })
    await vi_flush()

    expect(cachedPeer(2)).toMatchObject({ avatarUrl: '/new.png' })
    expect(net.calls).toBe(2) // первичный getUsers + один до-фетч, не два
  })

  // Уход активной сессии. Зеркало читают СИНХРОННО на рендере (императивная
  // лента строит имя автора прямо из него), а `avatarUrl` приватен per-viewer —
  // без сброса следующий аккаунт увидит чужие карточки. Строка
  // `resetPeerMirror()` в APPLY[RT.loggingOut] иначе не покрыта ничем.
  it('кадр rt:logging_out сбрасывает зеркало', async () => {
    const { mgr } = stand([{ id: 2, username: 'bob', display_name: 'Боб', avatar_url: '/a.png' }])
    await mgr.fillMirror([2])
    expect(cachedPeer(2)).toBeDefined()

    rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: null })

    expect(cachedPeer(2)).toBeUndefined()
  })
})

/** applyUserUpdate запускает до-фетч фоном (void) — даём микрозадачам добежать. */
function vi_flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
