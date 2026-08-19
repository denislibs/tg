// src/core/managers/peersManager.test.ts
import { describe, it, expect } from 'vitest'
import { newPeersManager, type PeerOp } from './peersManager'
import type { RestClient } from '../net/restClient'
import type { Chat, UserReal } from '../peers/peer'

const user = (id: number, over: Partial<UserReal> = {}): UserReal => ({
  _: 'user', id, first_name: `U${id}`, username: `u${id}`,
  photo: { _: 'userProfilePhotoEmpty' }, ...over,
})

function fakeRest(users: UserReal[]) {
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
  // Маппера больше нет вовсе: форма провода и форма модели совпали — с /users
  // приезжает конструктор `user`, он же и кладётся в кэш. Проверяем именно это:
  // ответ отдаётся ВЕРБАТИМ, без плоской перекладки полей.
  it('карточка с /users отдаётся конструктором, без перекладки полей', async () => {
    const bob = user(2, { first_name: 'Боб', last_name: 'Бобров', photo: { _: 'userProfilePhoto', photo_id: 9, stripped_thumb: 'QUJD' } })
    const { rest, calls } = fakeRest([bob])
    const mgr = newPeersManager({ rest })
    const peers = await mgr.getUsers([2])
    expect(calls[0].path).toBe('/users')
    expect(calls[0].query).toEqual({ ids: '2' })
    expect(peers).toEqual([bob])
  })

  it('caches: two calls for the same id => one GET /users', async () => {
    const { rest, calls } = fakeRest([user(5)])
    const mgr = newPeersManager({ rest })
    const a = await mgr.getUsers([5])
    const b = await mgr.getUsers([5])
    expect(calls).toHaveLength(1)
    expect(a).toEqual(b)
    expect(b[0].username).toBe('u5')
  })

  it('only fetches missing ids on subsequent calls', async () => {
    const { rest, calls } = fakeRest([user(1), user(2)])
    const mgr = newPeersManager({ rest })
    await mgr.getUsers([1])
    await mgr.getUsers([1, 2])
    expect(calls).toHaveLength(2)
    expect(calls[0].query).toEqual({ ids: '1' })
    expect(calls[1].query).toEqual({ ids: '2' })
  })

  // Ключ чата отрицательный, батчевой ручки для чатов на проводе нет (её нет и
  // в оригинале — карточка чата приезжает с `/chats/{peerID}/card` или кадром
  // `chat_update`). Значит запрос ключа чата обязан НЕ порождать похода в
  // /users с отрицательным id: сервер такого пользователя не знает, а ответ был
  // бы пустым при каждом вызове.
  it('ключ чата в /users не уезжает', async () => {
    const { rest, calls } = fakeRest([user(1)])
    const mgr = newPeersManager({ rest })
    await mgr.getPeers([-42, 1])
    expect(calls).toHaveLength(1)
    expect(calls[0].query).toEqual({ ids: '1' })
  })
})

// Менеджер — владелец карточек, он же решает, что карточка изменилась. Правило
// инвалидации ОДНО и живёт здесь; сквозной сценарий «воркер и витрина не
// расходятся» — в client/realtime/storeProjection.peers.test.ts.
//
// Кадр `user_update` теперь несёт КОНСТРУКТОР целиком — абсолютный снимок.
// Прежней пары «патч имени из кадра + до-фетч аватара по флажку
// avatar_changed» больше нет, и вместе с ней ушёл механизм `stale`: сравнивать
// надо не «что изменилось в кадре», а карточку с карточкой.
describe('PeersManager — правило инвалидации (владелец карточек)', () => {
  function stand(users: UserReal[]) {
    const { rest, calls } = fakeRest(users)
    const ops: PeerOp[] = []
    const mgr = newPeersManager({ rest, onPeerOps: (o) => ops.push(...o) })
    return { mgr, calls, ops }
  }

  it('карточка не изменилась → операция не публикуется (витрина не пересобирается впустую)', async () => {
    const bob = user(2, { first_name: 'Боб' })
    const { mgr, ops } = stand([bob])
    await mgr.getUsers([2])
    ops.length = 0

    mgr.applyUserUpdate({ ...bob })

    expect(ops).toEqual([])
  })

  it('пир неизвестен воркеру → ни операции, ни похода в сеть', async () => {
    const { mgr, calls, ops } = stand([user(2)])

    mgr.applyUserUpdate(user(404))

    expect(ops).toEqual([])
    expect(calls).toEqual([])
  })

  it('кадр — абсолютный снимок: публикуется он сам, в сеть за карточкой не ходим', async () => {
    const { mgr, calls, ops } = stand([user(2, { first_name: 'Боб' })])
    await mgr.getUsers([2])
    ops.length = 0

    // Сменились и имя, и аватарка — всё это внутри одного кадра. Прежде за
    // аватаркой приходилось идти отдельным запросом (флажок `avatar_changed`
    // url не нёс), и на упавшем до-фетче витрина оставалась со старым фото.
    const fresh = user(2, { first_name: 'Бобби', username: 'bobby', photo: { _: 'userProfilePhoto', photo_id: 77 } })
    mgr.applyUserUpdate(fresh)

    expect(ops).toEqual([{ op: 'upsert', peers: [fresh] }])
    expect(calls).toHaveLength(1) // только первичный getUsers
  })

  // Пин границы сравнения: карточки сравниваются ЦЕЛИКОМ. Прежде `same()`
  // перечислял четыре поля руками, и добавленное пятое (превью аватарки)
  // молча выпадало из сравнения — вкладки навсегда оставались со старым.
  it('изменилось только stripped-превью аватарки → кадр публикуется', async () => {
    const before = user(2, { photo: { _: 'userProfilePhoto', photo_id: 9, stripped_thumb: 'AAA' } })
    const { mgr, ops } = stand([before])
    await mgr.getUsers([2])
    ops.length = 0

    const after = user(2, { photo: { _: 'userProfilePhoto', photo_id: 9, stripped_thumb: 'BBB' } })
    mgr.applyUserUpdate(after)

    expect(ops).toEqual([{ op: 'upsert', peers: [after] }])
  })
})

// Трафик веера. `getPeers`/`getUsers` зовут не только из витрины: инфо группы,
// права, закреплённые, звонки, тосты уведомлений — места, которые рисуют по
// возвращённому массиву и в зеркало (core/peerCache.ts) не смотрят. Каждый
// опубликованный кадр уходит structured-clone'ом в КАЖДЫЙ порт и заставляет
// каждую вкладку продиффить пачку, поэтому «объёмные» чтения обязаны молчать:
// разъехаться с зеркалом на впервые заведённой карточке невозможно (зеркало —
// подмножество кэша), а на повторном открытии не меняется вообще ничего.
describe('PeersManager — объёмные чтения не создают трафика веера', () => {
  const members = Array.from({ length: 500 }, (_, i) => user(i + 1))

  it('открытие экрана на 500 участников — ноль кадров, повторное — тоже ноль', async () => {
    const { rest } = fakeRest(members)
    const ops: PeerOp[] = []
    const mgr = newPeersManager({ rest, onPeerOps: (o) => ops.push(...o) })
    const ids = members.map((m) => m.id)

    await mgr.getUsers(ids) // первое открытие: 500 карточек заводятся впервые
    expect(ops).toEqual([])

    await mgr.getUsers(ids) // повторное: попадание в кэш, менять нечего
    expect(ops).toEqual([])
  })

  // Обратная сторона того же правила: ЗАМЕНУ уже лежавшей карточки объявить
  // обязаны — только на ней зеркало и может разъехаться с кэшем. Публикуется
  // ровно изменившееся, а не вся пачка.
  it('перечитывание пачки объявляет только реально изменившиеся карточки', async () => {
    const { rest } = fakeRest(members)
    const ops: PeerOp[] = []
    const mgr = newPeersManager({ rest, onPeerOps: (o) => ops.push(...o) })
    await mgr.getUsers(members.map((m) => m.id))

    const fresh = user(42, { photo: { _: 'userProfilePhoto', photo_id: 4242 } })
    mgr.applyUserUpdate(fresh)

    expect(ops).toEqual([{ op: 'upsert', peers: [fresh] }])
  })
})

// Границы объявления: обе стороны правила, а не одна. «Объявить изменившееся»
// пинится выше; здесь — «промолчать, когда отвечать нечем», и «ответить на
// объявленный пробел ВСЕГДА, включая попадание в кэш».
describe('PeersManager — границы объявления', () => {
  it('пробел зеркала не на что закрыть (сервер такого юзера не знает) → кадра нет', async () => {
    const { rest } = fakeRest([user(2)])
    const ops: PeerOp[] = []
    const mgr = newPeersManager({ rest, onPeerOps: (o) => ops.push(...o) })

    await mgr.fillMirror([404])

    expect(ops).toEqual([])
  })

  it('fillMirror отвечает и на попадание в кэш — иначе карточка не доедет никогда', async () => {
    const bob = user(2)
    const { rest, calls } = fakeRest([bob])
    const ops: PeerOp[] = []
    const mgr = newPeersManager({ rest, onPeerOps: (o) => ops.push(...o) })
    await mgr.getUsers([2]) // прогрели кэш «объёмным» чтением — кадра не было
    expect(ops).toEqual([])

    await mgr.fillMirror([2])

    expect(calls).toHaveLength(1) // в сеть не ходили
    expect(ops).toEqual([{ op: 'upsert', peers: [bob] }]) // но ответили
  })

  it('на один fillMirror уходит ровно один кадр', async () => {
    const { rest } = fakeRest([user(1), user(2)])
    const ops: PeerOp[] = []
    const mgr = newPeersManager({ rest, onPeerOps: (o) => ops.push(...o) })

    await mgr.fillMirror([1, 2])

    expect(ops).toHaveLength(1)
    expect(ops[0].peers).toHaveLength(2)
  })

  // Карточки приезжают попутно с ЛЮБЫМ ответом (карточка чата, кадр
  // `chat_update`, авторы комментариев) — порт `appPeersManager.saveApiPeers
  // (object: {chats?, users?})`. Здесь объявляется ВСЁ записанное, включая
  // впервые заведённую карточку: `saveApiChat`/`saveApiUser` оригинала зеркалят
  // в обеих ветках, и для чата иначе нельзя — батчевой ручки за карточками
  // чатов нет вовсе (см. докблок `saveApiPeers`).
  it('saveApiPeers объявляет и НОВУЮ карточку — иначе чат в зеркало не попадёт никогда', async () => {
    const { rest } = fakeRest([])
    const ops: PeerOp[] = []
    const mgr = newPeersManager({ rest, onPeerOps: (o) => ops.push(...o) })

    const fresh = user(2)
    mgr.saveApiPeers({ users: [fresh] })
    expect(ops).toEqual([{ op: 'upsert', peers: [fresh] }])

    const renamed = user(2, { first_name: 'Другое' })
    mgr.saveApiPeers({ users: [renamed] })
    expect(ops).toEqual([{ op: 'upsert', peers: [fresh] }, { op: 'upsert', peers: [renamed] }])
  })

  // Идемпотентность: повторный кадр `chat_update` с ТЕМ ЖЕ снимком не должен
  // будить подписчиков зеркала.
  it('saveApiPeers: тот же снимок второй раз — ни одной операции', async () => {
    const { rest } = fakeRest([])
    const ops: PeerOp[] = []
    const mgr = newPeersManager({ rest, onPeerOps: (o) => ops.push(...o) })

    mgr.saveApiPeers({ users: [user(2)] })
    ops.length = 0
    mgr.saveApiPeers({ users: [user(2)] })
    expect(ops).toEqual([])
  })

  // Оба вектора одного ответа (`messages.chatFull` / `users.userFull`) едут
  // ВМЕСТЕ — и уходят одним кадром, а не двумя.
  it('saveApiPeers: chats + users одного ответа — один кадр', async () => {
    const { rest } = fakeRest([])
    const ops: PeerOp[] = []
    const mgr = newPeersManager({ rest, onPeerOps: (o) => ops.push(...o) })

    const chat: Chat = { _: 'channel', id: 5, title: 'C', photo: { _: 'chatPhotoEmpty' }, date: 0 }
    mgr.saveApiPeers({ chats: [chat], users: [user(2)] })
    expect(ops).toHaveLength(1)
    expect(ops[0].peers).toEqual([chat, user(2)])
  })
})
