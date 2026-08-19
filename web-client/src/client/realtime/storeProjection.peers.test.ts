// Карточки пиров — владелец воркерный peersManager, он же решает, ЧТО
// изменилось, и публикует это операцией (rt:peer_op). `core/peerCache.ts` —
// зеркало, единственный писатель которого проектор (см. также
// core/noDuplicatePeers.test.ts — что вторых писателей не завелось).
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
import { cachedPeer, peerTitle, resetPeerMirror } from '../../core/peerCache'
import { newPeersManager } from '../../core/managers/peersManager'
import type { RestClient } from '../../core/net/restClient'
import type { UserReal } from '../../core/peers/peer'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'

const user = (id: number, over: Partial<UserReal> = {}): UserReal => ({
  _: 'user', id, first_name: `U${id}`, username: `u${id}`,
  photo: { _: 'userProfilePhotoEmpty' }, ...over,
})

/** Фейковый /users с рубильником сети: `offline = true` — запрос падает так же,
 *  как реальный обрыв (не HttpError), т.е. по ветке офлайн-фолбэка. */
function stand(users: UserReal[]) {
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

  // Базовый канал: витрина объявила пробел — карточка доезжает сама.
  it('fillMirror → карточка легла в зеркало через операцию', async () => {
    const bob = user(2, { first_name: 'Боб' })
    const { mgr } = stand([bob])

    await mgr.fillMirror([2])

    expect(cachedPeer(2)).toEqual(bob)
  })

  // Полнота канала: карточку мог уже вытянуть другой хук или другая вкладка —
  // тогда в кэше воркера попадание, менять нечего, и публикация «только
  // изменившегося» не доехала бы до витрины НИКОГДА. На объявленный пробел
  // отвечаем всегда — это и есть сценарий второй вкладки, открытой позже.
  it('пробел зеркала при попадании в кэш воркера всё равно наполняет пустую витрину', async () => {
    const { mgr, net } = stand([user(2, { first_name: 'Боб' })])
    await mgr.getUsers([2])
    // Витрина «второй вкладки»: кэш воркера уже прогрет, зеркало пусто.
    resetPeerMirror()

    await mgr.fillMirror([2])

    expect(net.calls).toBe(1)
    expect(peerTitle(2)).toBe('Боб')
  })

  it('user_update → пересобрана ровно одна карточка', async () => {
    const { mgr } = stand([user(2, { first_name: 'Боб' }), user(3, { first_name: 'Ева' })])
    await mgr.fillMirror([2, 3])
    const before3 = cachedPeer(3)

    const bobby = user(2, { first_name: 'Бобби', username: 'bobby' })
    mgr.applyUserUpdate(bobby)

    expect(cachedPeer(2)).toEqual(bobby)
    // чужая карточка не пересобрана — та же ссылка
    expect(cachedPeer(3)).toBe(before3)
  })

  // ГЛАВНЫЙ ПИН задачи. Раньше кадр правил два кэша порознь: воркер выселял
  // запись, витрина патчила имя и шла за аватаром сама. Упавший до-фетч давал
  // ДВА разных состояния одного факта: у воркера карточки нет вовсе, у витрины
  // старый аватар — и навсегда.
  //
  // Теперь расходиться нечему по построению: кадр несёт КОНСТРУКТОР целиком,
  // и обе стороны кладут один и тот же объект без единого похода в сеть. Пин
  // держит именно это — «кадр самодостаточен»: число запросов не выросло, а
  // ответ владельца совпадает с зеркалом.
  it('user_update: воркер и витрина держат ОДНУ И ТУ ЖЕ карточку, в сеть за ней не ходят', async () => {
    const { mgr, net } = stand([user(2, { first_name: 'Боб', photo: { _: 'userProfilePhoto', photo_id: 1 } })])
    await mgr.fillMirror([2])

    const fresh = user(2, { first_name: 'Бобби', username: 'bobby', photo: { _: 'userProfilePhoto', photo_id: 77 } })
    mgr.applyUserUpdate(fresh)

    const [fromWorker] = await mgr.getUsers([2])
    expect(net.calls).toBe(1) // ни одного дополнительного запроса
    expect(fromWorker).toEqual(cachedPeer(2))
    expect(fromWorker).toEqual(fresh)
  })

  // Кадр приходит на пира, которого воркер не знает: объявлять некому (зеркало
  // — подмножество кэша), и молчание тут — правило, а не потеря.
  it('user_update о неизвестном пире зеркало не наполняет', async () => {
    const { mgr } = stand([user(2)])

    mgr.applyUserUpdate(user(404, { first_name: 'Никто' }))

    expect(cachedPeer(404)).toBeUndefined()
  })

  // Уход активной сессии. Зеркало читают СИНХРОННО на рендере (императивная
  // лента строит имя автора прямо из него), а `photo` гасится правилом
  // приватности per-viewer — без сброса следующий аккаунт увидит чужие
  // карточки. Строка `resetPeerMirror()` в APPLY[RT.loggingOut] иначе не
  // покрыта ничем.
  it('кадр rt:logging_out сбрасывает зеркало', async () => {
    const { mgr } = stand([user(2)])
    await mgr.fillMirror([2])
    expect(cachedPeer(2)).toBeDefined()

    rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: null })

    expect(cachedPeer(2)).toBeUndefined()
  })
})
