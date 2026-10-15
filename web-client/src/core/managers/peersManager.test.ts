// src/core/managers/peersManager.test.ts
import { describe, it, expect } from 'vitest'
import { newPeersManager, type PeerOp } from './peersManager'
import { HttpError, type RestClient } from '../net/restClient'
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
      // Как настоящая ручка: голый вектор `Vector<User>` только запрошенных id
      // (`group_handler.go` Users). Обёртки `{users}` нет — прежняя подделка
      // её добавляла и прятала, что добор карточек возвращал пустоту.
      const requested = new Set(String(query?.ids ?? '').split(',').filter(Boolean).map(Number))
      return users.filter((u) => requested.has(u.id)) as unknown as R
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

  // Порт `saveApiUser` (tweb appUsersManager.ts:663-782): приёмник кладёт и
  // НОВУЮ карточку (`oldUser === undefined` → `mirrorUser`), не только замену.
  // Иначе кадр со второго устройства («добавил Алису в контакты») пропадал, пока
  // Алиса не попала в кэш чтением диалога. В сеть за карточкой ходить незачем —
  // она уже в кадре.
  it('пир неизвестен воркеру → карточка сохраняется и объявляется, в сеть не ходим', async () => {
    const { mgr, calls, ops } = stand([user(2)])
    const stranger = user(404)

    mgr.applyUserUpdate(stranger)

    expect(ops).toEqual([{ op: 'upsert', peers: [stranger] }])
    expect(mgr.cachedPeer(404)).toEqual(stranger)
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

// ── resolveUsername ──────────────────────────────────────────────────────────
// Порт `appUsersManager.resolveUsername` (tweb `appUsersManager.ts:380-410`):
// индекс имён, на промахе — ОДИН `contacts.resolveUsername` (у нас
// `GET /contacts/resolve_username`), ответ прогоняется через сохранение пиров
// (`processResolvedPeer`), пир достаётся по ссылке `peer`. Отказ сервера
// (`USERNAME_NOT_OCCUPIED`, `USERNAME_INVALID`) пробрасывается как есть. До
// него имя резолвил СКАН ВИТРИНЫ ДИАЛОГОВ на главном потоке, а затем префиксный
// `/search` с самодельным отказом — из-за чего открытие по ссылке стояло за
// чатлистом (tweb `appImManager.ts:834` против `appDialogsManager.ts:726`).
describe('PeersManager.resolveUsername', () => {
  const channel = (id: number, username: string): Chat =>
    ({ _: 'channel', id, title: `C${id}`, username, photo: { _: 'chatPhotoEmpty' }, date: 0 })

  /** Ручка `contacts.resolveUsername`: точное совпадение имени без регистра. */
  function resolver(chats: Chat[], users: UserReal[] = []) {
    const calls: { path: string; query?: Record<string, string | number> }[] = []
    const rest = {
      async get<R>(path: string, query?: Record<string, string | number>): Promise<R> {
        calls.push({ path, query })
        const name = String(query?.username ?? '').toLowerCase()
        const chat = chats.find((c) => 'username' in c && c.username?.toLowerCase() === name)
        if (chat) return { _: 'contacts.resolvedPeer', peer: { _: 'peerChannel', channel_id: chat.id }, chats: [chat], users: [] } as unknown as R
        const person = users.find((u) => u.username?.toLowerCase() === name)
        if (person) return { _: 'contacts.resolvedPeer', peer: { _: 'peerUser', user_id: person.id }, chats: [], users: [person] } as unknown as R
        throw new HttpError(400, 'USERNAME_NOT_OCCUPIED', 'USERNAME_NOT_OCCUPIED')
      },
    } as unknown as RestClient
    return { rest, calls }
  }

  it('имя, приехавшее попутно с ответом, резолвится БЕЗ запроса', async () => {
    const { rest, calls } = resolver([])
    const mgr = newPeersManager({ rest })
    // Порт `modifyUsernamesCache`: индекс ведётся там же, где карточка ложится
    // в кэш, — то есть на `saveApiPeers` любого ответа.
    mgr.saveApiPeers({ chats: [channel(42, 'durov')] })

    expect(await mgr.resolveUsername('@Durov')).toEqual(channel(42, 'durov'))
    expect(calls).toEqual([])
  })

  it('промах индекса — ровно ОДИН contacts.resolveUsername, /search не зовётся, ответ ложится в кэш', async () => {
    const { rest, calls } = resolver([channel(42, 'durov')])
    const mgr = newPeersManager({ rest })

    expect(await mgr.resolveUsername('Durov')).toEqual(channel(42, 'durov'))
    expect(calls).toEqual([{ path: '/contacts/resolve_username', query: { username: 'durov' } }])
    // Второй раз — уже из индекса.
    await mgr.resolveUsername('durov')
    expect(calls).toHaveLength(1)
  })

  it('отказ сервера USERNAME_NOT_OCCUPIED пробрасывается тем же типом', async () => {
    const { rest, calls } = resolver([])
    const mgr = newPeersManager({ rest })

    await expect(mgr.resolveUsername('nobody')).rejects.toMatchObject({ type: 'USERNAME_NOT_OCCUPIED' })
    expect(calls.map((c) => c.path)).toEqual(['/contacts/resolve_username'])
  })

  it('пустое имя — USERNAME_INVALID, в сеть не ходим', async () => {
    const { rest, calls } = resolver([])
    const mgr = newPeersManager({ rest })

    await expect(mgr.resolveUsername('@ ')).rejects.toMatchObject({ type: 'USERNAME_INVALID' })
    expect(calls).toEqual([])
  })

  // Порт `setUsernameToCache` (tweb :536-546): прежнее имя СНИМАЕТСЯ. Без
  // снятия переименованный канал вечно резолвился бы по имени, которого у него
  // уже нет, — и ссылка вела бы в чужой чат.
  it('переименование снимает прежнее имя с индекса', async () => {
    const { rest } = resolver([])
    const mgr = newPeersManager({ rest })
    mgr.saveApiPeers({ chats: [channel(42, 'durov')] })
    mgr.saveApiPeers({ chats: [channel(42, 'pavel')] })

    expect(await mgr.resolveUsername('pavel')).toEqual(channel(42, 'pavel'))
    await expect(mgr.resolveUsername('durov')).rejects.toMatchObject({ type: 'USERNAME_NOT_OCCUPIED' })
  })

  it('человек резолвится тем же вызовом', async () => {
    const petya = user(7, { username: 'petya' })
    const { rest } = resolver([], [petya])
    const mgr = newPeersManager({ rest })

    expect(await mgr.resolveUsername('@petya')).toEqual(petya)
  })
})

// Порт `appChatsManager.saveApiChat` (tweb :229-244, :163-177): пришедший
// `channel` не затирает то, чего в нём нет. Живой сценарий — смена фото
// группы: кадр `chat_update` несёт снимок БЕЗ зрителя (`pFlags.min`), и без
// слияния создатель терял `creator`/`admin_rights`, а шапка — число участников.
describe('PeersManager: слияние карточки чата (saveApiChat)', () => {
  const full: Chat = {
    _: 'channel', id: 6, title: 'Команда', photo: { _: 'chatPhotoEmpty' }, date: 1_700_000_000,
    pFlags: { megagroup: true, creator: true },
    admin_rights: { _: 'chatAdminRights', pFlags: { change_info: true } },
    default_banned_rights: { _: 'chatBannedRights', pFlags: {}, until_date: 0 },
    participants_count: 6,
  }
  const cached = (mgr: ReturnType<typeof newPeersManager>) => mgr.cachedPeer(-6)

  it('min-снимок: общее — из пришедшего, членство зрителя — из лежащего', () => {
    const mgr = newPeersManager({ rest: fakeRest([]).rest })
    mgr.saveApiPeers({ chats: [full] })
    mgr.saveApiPeers({ chats: [{
      _: 'channel', id: 6, title: 'Команда 2', photo: { _: 'chatPhoto', photo_id: 14290 }, date: 0,
      pFlags: { min: true, megagroup: true, slowmode_enabled: true },
      default_banned_rights: { _: 'chatBannedRights', pFlags: { send_media: true }, until_date: 0 },
      participants_count: 7,
    }] })
    expect(cached(mgr)).toEqual({
      _: 'channel', id: 6, title: 'Команда 2', photo: { _: 'chatPhoto', photo_id: 14290 }, date: 1_700_000_000,
      pFlags: { megagroup: true, slowmode_enabled: true, creator: true },
      admin_rights: { _: 'chatAdminRights', pFlags: { change_info: true } },
      default_banned_rights: { _: 'chatBannedRights', pFlags: { send_media: true }, until_date: 0 },
      participants_count: 7,
    })
  })

  // A1-01: `min` чата, который зрителю не читается (ссылка из чужого
  // контента), не несёт ни числа участников, ни `default_banned_rights` — и не
  // затирает их у лежащей карточки: иначе hasRights без прав блокировал ввод.
  it('min без default_banned_rights — права остаются от лежащей карточки', () => {
    const mgr = newPeersManager({ rest: fakeRest([]).rest })
    mgr.saveApiPeers({ chats: [full] })
    mgr.saveApiPeers({ chats: [{
      _: 'channel', id: 6, title: 'Команда', photo: { _: 'chatPhotoEmpty' }, date: 0,
      pFlags: { min: true, megagroup: true },
    }] })
    expect(cached(mgr)).toMatchObject({
      default_banned_rights: full.default_banned_rights,
      participants_count: 6,
      pFlags: { megagroup: true, creator: true },
    })
  })

  it('полный channel заменяет карточку целиком — включая снятые права', () => {
    const mgr = newPeersManager({ rest: fakeRest([]).rest })
    mgr.saveApiPeers({ chats: [full] })
    const demoted: Chat = { ...full, pFlags: { megagroup: true }, admin_rights: undefined }
    delete (demoted as { admin_rights?: unknown }).admin_rights
    mgr.saveApiPeers({ chats: [demoted] })
    expect(cached(mgr)).toEqual(demoted)
  })

  it('participants_count не приехал — остаётся прежний (tweb :239-244)', () => {
    const mgr = newPeersManager({ rest: fakeRest([]).rest })
    mgr.saveApiPeers({ chats: [full] })
    const { participants_count: _n, ...noCount } = full as Extract<Chat, { _: 'channel' }>
    mgr.saveApiPeers({ chats: [noCount] })
    expect(cached(mgr)).toMatchObject({ participants_count: 6 })
  })

  it('min без лежащей карточки кладётся как есть', () => {
    const mgr = newPeersManager({ rest: fakeRest([]).rest })
    const min: Chat = { ...full, pFlags: { min: true, megagroup: true } }
    delete (min as { admin_rights?: unknown }).admin_rights
    mgr.saveApiPeers({ chats: [min] })
    expect(cached(mgr)).toEqual(min)
  })

  // Порт `appUsersManager.saveApiUser → saveUserStatus` (tweb
  // `appUsersManager.ts:700`): статус пользователя едет ВНУТРИ его карточки, и
  // приёмник карточек — единственное место, где он становится известен
  // клиенту. У нас статус живёт отдельным стором присутствия, поэтому владелец
  // карточек обязан отдать его туда тем же кадром, что и сервер
  // (`updateUserStatus`). Без этого собеседник, чей диалог появился уже ПОСЛЕ
  // сида присутствия (новый человек написал первым), навсегда оставался «без
  // статуса» — шапка чата пустая, профиль «был(а) давно».
  it('saveApiPeers: статус из карточки уходит в присутствие кадром updateUserStatus', () => {
    const { rest } = fakeRest([])
    const statuses: unknown[] = []
    const mgr = newPeersManager({ rest, onUserStatus: (e) => statuses.push(e) })

    const status = { _: 'userStatusOnline', expires: 1790503807 } as const
    mgr.saveApiPeers({ users: [user(2, { status }), user(3)] })
    expect(statuses).toEqual([{ _: 'updateUserStatus', user_id: 2, status }])

    // Та же карточка второй раз — это СВЕЖИЙ снимок сервера, а не повтор:
    // присутствие между ними могло смениться кадром, и снимок его поправит.
    mgr.saveApiPeers({ users: [user(2, { status })] })
    expect(statuses).toHaveLength(2)
  })
})

// Статус — поле карточки, как у tweb (`appUsersManager.ts:90-102`): кадр
// `updateUserStatus` правит `user.status` известной карточки, и всё, что читает
// подпись из кэша воркера (селектор «Добавить участников», sortedUserList,
// appSearchSuper), видит живое присутствие. Карточка без `status` (ответ
// витрины, которая его не посчитала) живой статус не стирает.
describe('PeersManager — статус как поле карточки', () => {
  const online = { _: 'userStatusOnline', expires: 1790503807 } as const
  const offline = { _: 'userStatusOffline', was_online: 1790500000 } as const

  it('setUserStatus: карточка в кэше получает новый статус и объявляется операцией', async () => {
    const { rest } = fakeRest([user(2, { status: offline })])
    const ops: PeerOp[] = []
    const mgr = newPeersManager({ rest, onPeerOps: (o) => ops.push(...o) })
    await mgr.getUsers([2])

    mgr.setUserStatus(2, online)

    const [card] = await mgr.getUsers([2])
    expect(card.status).toEqual(online)
    expect(ops).toEqual([{ op: 'upsert', peers: [{ ...user(2), status: online }] }])
  })

  it('setUserStatus: неизвестный пользователь и тот же статус — без операции', async () => {
    const { rest } = fakeRest([user(2, { status: online })])
    const ops: PeerOp[] = []
    const mgr = newPeersManager({ rest, onPeerOps: (o) => ops.push(...o) })
    mgr.setUserStatus(9, online) // tweb :92-95: карточки нет — выход
    await mgr.getUsers([2])
    mgr.setUserStatus(2, online)
    expect(ops).toEqual([])
  })

  // Равенство по СОДЕРЖИМОМУ: порядок ключей в объекте с сервера не должен
  // рождать операцию.
  it('setUserStatus: тот же статус с другим порядком ключей — без операции', async () => {
    const { rest } = fakeRest([user(2, { status: { _: 'userStatusOffline', was_online: 5 } })])
    const ops: PeerOp[] = []
    const mgr = newPeersManager({ rest, onPeerOps: (o) => ops.push(...o) })
    await mgr.getUsers([2])
    mgr.setUserStatus(2, { was_online: 5, _: 'userStatusOffline' })
    expect(ops).toEqual([])
    mgr.setUserStatus(2, { _: 'userStatusOffline', was_online: 6 })
    expect(ops).toHaveLength(1)
  })

  // tweb `updateUsersStatuses`/`updateUserStatus` (appUsersManager.ts:990-1007).
  it('degradeExpiredStatuses: истёкший онлайн → offline{was_online: expires}, живой и прочие не трогаем', () => {
    const ops: PeerOp[] = []
    const mgr = newPeersManager({ rest: fakeRest([]).rest, onPeerOps: (o) => ops.push(...o) })
    mgr.saveApiPeers({ users: [
      user(2, { status: { _: 'userStatusOnline', expires: 100 } }),
      user(3, { status: { _: 'userStatusOnline', expires: 500 } }),
      user(4, { status: offline }),
      user(5),
    ] })
    ops.length = 0

    mgr.degradeExpiredStatuses(200)

    expect(mgr.cachedPeer(2 as PeerId)).toMatchObject({ status: { _: 'userStatusOffline', was_online: 100 } })
    expect(mgr.cachedPeer(3 as PeerId)).toMatchObject({ status: { _: 'userStatusOnline', expires: 500 } })
    expect(ops).toEqual([{ op: 'upsert', peers: [{ ...user(2), status: { _: 'userStatusOffline', was_online: 100 } }] }])
    ops.length = 0
    mgr.degradeExpiredStatuses(200) // повтор ничего не меняет
    expect(ops).toEqual([])
  })

  // Отступление от оригинала убрано: у tweb `saveApiUser` заменяет карточку целиком.
  it('карточка без status заменяет карточку целиком (как saveApiUser)', () => {
    const mgr = newPeersManager({ rest: fakeRest([]).rest })
    mgr.saveApiPeers({ users: [user(2, { status: online })] })
    mgr.saveApiPeers({ users: [user(2, { first_name: 'Новое' })] })
    expect(mgr.cachedPeer(2 as PeerId)).toEqual(user(2, { first_name: 'Новое' }))
  })
})

// Своя карточка (VA2-02): второе устройство получает `user_update` о самом себе —
// смену эмодзи-статуса, Premium, — а в кэше пиров своей карточки может не быть
// (в списках чатов «я» бывает только в «Избранном»). `me` воркера обновляется
// отдельным приёмником независимо от кэша пиров.
describe('PeersManager — своя карточка из user_update (onSelfUser)', () => {
  const me = (over: Partial<UserReal> = {}) => user(7, { pFlags: { self: true }, phone: '+79990000007', ...over })

  it('своей карточки нет в кэше → onSelfUser зовётся, карточка сохраняется и объявляется как любая неизвестная', () => {
    const selfs: UserReal[] = []
    const ops: PeerOp[] = []
    const mgr = newPeersManager({ rest: fakeRest([]).rest, onPeerOps: (o) => ops.push(...o), onSelfUser: (u) => selfs.push(u) })

    const card = me({ pFlags: { self: true, premium: true } })
    mgr.applyUserUpdate(card)

    expect(selfs).toEqual([card])
    expect(ops).toEqual([{ op: 'upsert', peers: [card] }])
  })

  it('своя карточка в кэше → и приёмник, и публикация', async () => {
    const selfs: UserReal[] = []
    const ops: PeerOp[] = []
    const mgr = newPeersManager({ rest: fakeRest([me()]).rest, onPeerOps: (o) => ops.push(...o), onSelfUser: (u) => selfs.push(u) })
    await mgr.getUsers([7])
    ops.length = 0

    const fresh = me({ emoji_status_emoticon: '🔥' })
    mgr.applyUserUpdate(fresh)

    expect(selfs).toEqual([fresh])
    expect(ops).toEqual([{ op: 'upsert', peers: [fresh] }])
  })

  it('чужая карточка приёмник не будит', () => {
    const selfs: UserReal[] = []
    const mgr = newPeersManager({ rest: fakeRest([]).rest, onSelfUser: (u) => selfs.push(u) })

    mgr.applyUserUpdate(user(404))

    expect(selfs).toEqual([])
  })
})

// Смена `pFlags.contact` на карточке — повод двигать книгу контактов (tweb
// saveApiUser :738-754 → onContactUpdated(userId, newContact, wasContact)).
// Через `onContactToggle` менеджер сообщает об этом владельцу книги, не зная о нём.
describe('PeersManager — переключение pFlags.contact', () => {
  function stand(users: UserReal[]) {
    const { rest } = fakeRest(users)
    const toggles: [number, boolean, boolean][] = []
    const mgr = newPeersManager({ rest, onContactToggle: (id, is, was) => toggles.push([id, is, was]) })
    return { mgr, toggles }
  }
  const asContact = (id: number) => user(id, { first_name: 'Бобби', pFlags: { contact: true } })

  it('замена карточки: чужой → контакт', async () => {
    const { mgr, toggles } = stand([user(2)])
    await mgr.getUsers([2])

    mgr.applyUserUpdate(asContact(2))

    expect(toggles).toEqual([[2, true, false]])
  })

  it('замена карточки: контакт → чужой', async () => {
    const { mgr, toggles } = stand([asContact(2)])
    await mgr.getUsers([2])
    toggles.length = 0

    mgr.applyUserUpdate(user(2))

    expect(toggles).toEqual([[2, false, true]])
  })

  it('имя сменилось, флаг тот же → переключения нет', async () => {
    const { mgr, toggles } = stand([asContact(2)])
    await mgr.getUsers([2])

    mgr.applyUserUpdate({ ...asContact(2), first_name: 'Бобик' })

    expect(toggles).toEqual([])
  })

  // Кадр user_update про неизвестного: контакт со второго устройства. tweb в
  // ветке «карточки не было» onContactUpdated не зовёт, но там книга — полный
  // список с getContacts; у нас она ленивая, и без вызова новый контакт не
  // попал бы в индекс. Отступление согласовано планом f6-contacts (задача 8).
  it('неизвестный пользователь с contact: true → переключение в книгу', () => {
    const { mgr, toggles } = stand([])

    mgr.applyUserUpdate(asContact(7))

    expect(toggles).toEqual([[7, true, false]])
  })

  it('неизвестный не-контакт → переключения нет', () => {
    const { mgr, toggles } = stand([])

    mgr.applyUserUpdate(user(7))

    expect(toggles).toEqual([])
  })

  // Пачка из ответа /contacts (fillContacts) идёт через saveApiPeers: новые
  // карточки контактов книгу не двигают (она перестраивается тем же вызовом),
  // иначе первое чтение книги порождало бы шторм contacts_update.
  it('saveApiPeers новой карточки контакта → переключения нет', () => {
    const { mgr, toggles } = stand([])

    mgr.saveApiPeers({ users: [asContact(7)] })

    expect(toggles).toEqual([])
  })

  // Книга двигается ПОСЛЕ объявления карточки зеркалу (tweb: `mirrorUser`, затем
  // `onContactUpdated`, :749-760): подписчик `contacts_update` читает свежую карточку.
  it('переключение книги — после rt:peer_op', async () => {
    const { rest } = fakeRest([user(2)])
    const order: string[] = []
    const mgr = newPeersManager({
      rest,
      onPeerOps: () => order.push('peer_op'),
      onContactToggle: () => order.push('toggle'),
    })
    await mgr.getUsers([2])
    order.length = 0

    mgr.applyUserUpdate(asContact(2))

    expect(order).toEqual(['peer_op', 'toggle'])
  })
})

// tweb `appUsersManager.getContactMediaInput` (:977-988): визитка пользователя
// глазами отправителя, `user_id: id` в том числе (:986) — из него бабл берёт
// `user_id` (`appMessagesManager.ts:4041`). На провод он не уходит
// (connectionManager.test.ts), сервер привязывает аккаунт по номеру (В-10).
describe('PeersManager — getContactMediaInput', () => {
  it('имя, фамилия, телефон отправителя; vcard пуст; user_id — id карточки', async () => {
    const { rest } = fakeRest([user(2, { first_name: 'Боб', last_name: 'Иванов', phone: '+79990000002' })])
    const mgr = newPeersManager({ rest })
    await mgr.getUsers([2])
    expect(mgr.getContactMediaInput(2)).toEqual({
      _: 'inputMediaContact', first_name: 'Боб', last_name: 'Иванов', phone_number: '+79990000002', vcard: '', user_id: 2,
    })
  })

  it('скрытый телефон и пустая фамилия — пустые строки, а не undefined', async () => {
    const { rest } = fakeRest([user(3, { first_name: 'Кэрол' })])
    const mgr = newPeersManager({ rest })
    await mgr.getUsers([3])
    expect(mgr.getContactMediaInput(3)).toEqual({
      _: 'inputMediaContact', first_name: 'Кэрол', last_name: '', phone_number: '', vcard: '', user_id: 3,
    })
  })

  it('неизвестная карточка — ошибка (tweb: getUser(id) без карточки падает)', () => {
    const { rest } = fakeRest([])
    expect(() => newPeersManager({ rest }).getContactMediaInput(9)).toThrow()
  })
})
