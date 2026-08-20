// Task 1 (перенос владения списком диалогов в воркер): тест владельца порядка —
// dialogsManager считает индекс через ту же чистую dialogIndex(), что и прежний
// applyDialogs на главном потоке (см. core/dialogs/dialogIndex.ts), и отдаёт
// снимок отсортированным (свежие/закреплённые выше). Зеркало (chatsStore) пока
// НЕ переведено на эти операции (Task 2) — тест проверяет только владельца.
import { describe, expect, it, vi } from 'vitest'
import { newDialogsManager } from './dialogsManager'
import { newGroupsManager } from './groupsManager'
import { isDialogArchived, mapMyMessage, type Dialog, type MyMessage, type RawDialog, type RawMyMessage } from '../models'
import { makeRawMessage } from '../messages/testMessage'
import { generateMessageId, getServerMessageId } from '../history/messageId'
import { makeDialog, makeLastMessage } from '../dialogs/testDialog'
import { isPeerMuted, MUTE_UNTIL_FOREVER } from '../dialogs/notifySettings'
import type { ReadEvt } from '../realtime/events'
import type { DialogOp } from '../dialogs/dialogOps'
import type { Draft } from '../models'

const dialog = (peerId: number, at: string, pinned = false): Dialog =>
  makeDialog({ peerId, pinned, lastMessage: makeLastMessage({ peerId, id: 1, fromId: 1, text: 'x', createdAt: at }) })

const draft = (peerId: number, updatedAt: string): Draft => ({ peerId, text: 'чер', replyToId: null, updatedAt })
const ids = (op: DialogOp): number[] => (op as { items: { dialog: Dialog }[] }).items.map((i) => i.dialog.peerId)

const isMuted = (d: Dialog): boolean => isPeerMuted(d.notify_settings, Math.floor(Date.now() / 1000))
const isPinned = (d: Dialog): boolean => !!d.pFlags?.pinned

/**
 * Ответ `/chats` — КОНТЕЙНЕР (`messages.dialogs` / `messages.dialogsSlice`).
 * `count` не передан — «список отдан целиком», то есть конец набора; это и
 * есть способ сказать «это всё» вместо снятого `is_end`.
 */
const container = (dialogs: unknown[] = [], count?: number, over: Record<string, unknown> = {}) => ({
  _: count === undefined ? 'messages.dialogs' : 'messages.dialogsSlice',
  ...(count === undefined ? {} : { count }),
  dialogs, messages: [], chats: [], users: [], ...over,
})
const restStub = (dialogs: unknown[] = [], count?: number) => ({ get: vi.fn(async () => container(dialogs, count)) })

/** «Навсегда» — не отдельный флаг, а далёкий срок; «снять» — отсутствие
 *  переопределения (пустой конструктор). Второго способа сказать то же самое на
 *  проводе больше нет. */
const MUTED = { _: 'peerNotifySettings', mute_until: MUTE_UNTIL_FOREVER } as const
const UNMUTED = { _: 'peerNotifySettings' } as const

/** Строка диалога НА ПРОВОДЕ — модель минус два клиентских параметра. */
const rawDialog = (peerId: number, seq: number): RawDialog => {
  const { peerId: _peerId, lastMessage: _lastMessage, ...wire } = makeDialog({ peerId, topMessage: seq })
  return wire
}

/** Закреплённая строка на проводе: «включено» у булева флага схемы — ключ в
 *  pFlags, а не поле `pinned: true` рядом. */
const pinnedRaw = (peerId: number): RawDialog => ({ ...rawDialog(peerId, 1), pFlags: { pinned: true } })

/** Сообщение на проводе — вектор `messages` контейнера. */
const rawMessage = (peerId: number, seq: number, text = 'x', senderId = 1, at = '2026-08-01T00:00:00Z'): RawMyMessage =>
  makeRawMessage({ id: seq, peerId, fromId: senderId, text, createdAt: at })

/** Владелец карточек: контейнер обязан отдать ему свои векторы целиком. */
function fakePeers() {
  return {
    saved: [] as unknown[],
    saveApiPeers(o: { chats?: readonly unknown[]; users?: readonly unknown[] } | undefined | null) {
      if (o && ((o.chats?.length ?? 0) || (o.users?.length ?? 0))) this.saved.push(o)
    },
    cachedPeer: () => undefined,
    hydrateFromDisk: async () => {},
  }
}

/** Владелец сообщений: SSOT воркера, куда втекает вектор `messages` и откуда
 *  разрешается `top_message` (решение Р11). */
function fakeMessages() {
  const byPeer = new Map<number, Map<number, MyMessage>>()
  return {
    saved: [] as MyMessage[],
    async saveApiMessages(list?: RawMyMessage[]): Promise<MyMessage[]> {
      const out = (list ?? []).map((r) => mapMyMessage(r))
      for (const m of out) {
        let c = byPeer.get(m.peerId)
        if (!c) { c = new Map(); byPeer.set(m.peerId, c) }
        c.set(m.id, m)
        this.saved.push(m)
      }
      return out
    },
    getMessageByPeer: (peerId: number, id: number) => (id ? byPeer.get(peerId)?.get(id) : undefined),
  }
}

describe('dialogsManager: владелец порядка', () => {
  it('fillMirror отдаёт reset, отсортированный по индексу (свежие выше)', async () => {
    const ops: unknown[] = []
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z'), dialog(2, '2026-08-02T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })

    const op = await mgr.fillMirror()

    expect(op.op).toBe('reset')
    expect((op as { items: { dialog: Dialog }[] }).items.map((i) => i.dialog.peerId)).toEqual([2, 1])
    // Пробел зеркала объявлен → владелец обязан ответить и веером тоже.
    expect(ops).toHaveLength(1)
  })

  it('закреплённый всегда выше незакреплённого, как бы стар он ни был', async () => {
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, '2020-01-01T00:00:00Z', true), dialog(2, '2026-08-02T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })

    const op = await mgr.fillMirror()
    expect((op as { items: { dialog: Dialog }[] }).items.map((i) => i.dialog.peerId)).toEqual([1, 2])
  })

  // Ревью (Important #1): `hydrated = true` ставился СИНХРОННО, до await
  // loadState()/loadCache(). Конкурентный вызов (две вкладки на общем
  // SharedWorker стартуют одновременно, или fillMirror()/refresh() идут
  // параллельно) видел hydrated===true и немедленно возвращался с ПУСТЫМ items —
  // до того, как первый вызов вообще успел их загрузить. Кэшируем сам промис
  // гидратации, а не булев флаг: конкурентные вызовы ждут ОДИН И ТОТ ЖЕ промис.
  it('конкурентный fillMirror не рассылает пустой reset (гонка гидратации)', async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: () => {},
      loadCache: async () => { await sleep(5); return [dialog(1, '2026-08-01T00:00:00Z')] },
      loadState: async () => { await sleep(5); return { pinnedOrders: {}, drafts: [] } },
    })

    const [op1, op2] = await Promise.all([mgr.fillMirror(), mgr.fillMirror()])

    expect((op1 as { items: unknown[] }).items).toHaveLength(1)
    expect((op2 as { items: unknown[] }).items).toHaveLength(1)
  })

  // Симметричный случай: гидратация упала (сеть/IDB недоступны) — следующий
  // вызов обязан попробовать снова, а не залипнуть на вечно pending промисе.
  it('упавшая гидратация не залипает — следующий fillMirror пробует снова', async () => {
    let attempt = 0
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z')],
      loadState: async () => {
        attempt++
        if (attempt === 1) throw new Error('IDB недоступен')
        return { pinnedOrders: {}, drafts: [] }
      },
    })

    await expect(mgr.fillMirror()).rejects.toThrow('IDB недоступен')
    const op = await mgr.fillMirror()
    expect((op as { items: { dialog: Dialog }[] }).items.map((i) => i.dialog.peerId)).toEqual([1])
  })
})

// Task 3 (realtime-кадры применяет владелец): тела applyNewMessage/applyRead/
// bumpUnreadReactions переехали из chatsStore сюда как есть — меняется только
// выход (publish patch/remove вместо set({dialogs})). Зеркало (chatsStore) эти
// операции только зеркалит (проверено storeProjection.dialogs.test.ts).
//
// `applyChatMeta` отсюда УБРАН вместе с полями, которые он перекладывал:
// title/username/photo/is_forum уехали из строки диалога в карточку чата
// (вектор `chats` контейнера `/chats`), и кадр `chat_update` кладёт их туда же
// одним `peers.saveApiPeers` — второго зеркала того же факта больше нет
// (проводка — workerCore.dialogFrames.test.ts).
describe('dialogsManager: realtime-кадры применяет владелец', () => {
  it('bumpUnreadReactions: verbatim из кадра, fallback +1 без поля', async () => {
    const ops: DialogOp[] = []
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })
    await mgr.fillMirror()
    ops.length = 0

    mgr.bumpUnreadReactions(1) // без count — fallback +1 (было 0)
    expect((ops[0] as Extract<DialogOp, { op: 'patch' }>).fields.unread_reactions_count).toBe(1)

    mgr.bumpUnreadReactions(1, 5) // авторитетный счётчик из кадра — verbatim
    expect((ops[1] as Extract<DialogOp, { op: 'patch' }>).fields.unread_reactions_count).toBe(5)

    // Fix (ревью Task 3, Important): тот же счётчик повторно — patch не публикуется.
    ops.length = 0
    mgr.bumpUnreadReactions(1, 5)
    expect(ops).toHaveLength(0)
  })

  it('applyRemoved публикует remove; диалога нет в кэше — тихий no-op', async () => {
    const ops: DialogOp[] = []
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })
    await mgr.fillMirror()
    ops.length = 0

    mgr.applyRemoved(99) // неизвестный чат — тихо выходим, без операции
    expect(ops).toHaveLength(0)

    mgr.applyRemoved(1)
    expect(ops).toEqual([{ op: 'remove', peerId: 1 }])
    expect(mgr.getSnapshot().find((i) => i.dialog.peerId === 1)).toBeUndefined()
  })

  it('кадр в неизвестный чат — тихий no-op (без операции), как и раньше', async () => {
    const ops: DialogOp[] = []
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })
    await mgr.fillMirror()
    ops.length = 0

    mgr.applyNewMessage({ message: makeRawMessage({ id: 1, peerId: 99, fromId: 9, text: 'x', createdAt: '2026-08-01T00:00:01Z' }) })
    mgr.applyRead({ peer_id: 99, user_id: 7, up_to_seq: 1 } as ReadEvt, 7)
    mgr.bumpUnreadReactions(99)

    expect(ops).toHaveLength(0)
  })

  // Портировано из stores/chatsStore.test.ts (мутатор applyNewMessage там
  // удалён вместе с телом — Task 3).
  it('applyNewMessage не бампит unread на моё же эхо (sender_id === meId)', async () => {
    const ops: DialogOp[] = []
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
      getMeId: () => 7,
    })
    await mgr.fillMirror()
    ops.length = 0

    mgr.applyNewMessage({ message: makeRawMessage({ id: 2, peerId: 1, fromId: 7, text: 'hi', createdAt: '2026-08-01T00:00:01Z' }) })

    expect((ops[0] as Extract<DialogOp, { op: 'patch' }>).fields.unread_count).toBe(0)
  })

  it('applyNewMessage: verbatim unread из кадра (Wave 3), fallback +1 без поля', async () => {
    const ops: DialogOp[] = []
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
      getMeId: () => 7,
    })
    await mgr.fillMirror()
    ops.length = 0

    // server-authoritative unread=5 выигрывает у локального +1
    mgr.applyNewMessage({ message: makeRawMessage({ id: 2, peerId: 1, fromId: 9, text: 'a', createdAt: '2026-08-01T00:00:01Z' }), unread: 5 })
    expect((ops[0] as Extract<DialogOp, { op: 'patch' }>).fields.unread_count).toBe(5)

    ops.length = 0
    mgr.applyNewMessage({ message: makeRawMessage({ id: 3, peerId: 1, fromId: 9, text: 'b', createdAt: '2026-08-01T00:00:02Z' }) })
    // поля unread в кадре нет — fallback: текущий unread(5) + 1
    expect((ops[0] as Extract<DialogOp, { op: 'patch' }>).fields.unread_count).toBe(6)
  })

  it('новое сообщение в закреплённом диалоге не двигает блок закреплённых', async () => {
    const ops: DialogOp[] = []
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [
        dialog(1, '2026-08-09T10:00:00Z', true),
        dialog(2, '2026-08-09T11:00:00Z', true),
        dialog(3, '2026-08-09T12:00:00Z'),
      ],
      loadState: async () => ({ pinnedOrders: { 0: [1, 2] }, drafts: [] }),
    })
    await mgr.fillMirror()
    expect(mgr.getSnapshot().map((i) => i.dialog.peerId)).toEqual([1, 2, 3])
    ops.length = 0

    mgr.applyNewMessage({ message: makeRawMessage({ id: 4, peerId: 2, fromId: 5, text: 'yo', createdAt: '2026-08-09T23:00:00Z' }) })

    // закреплённые держатся своим порядком (pinnedOrders), а не датой
    expect(mgr.getSnapshot().map((i) => i.dialog.peerId)).toEqual([1, 2, 3])
    expect(ops).toHaveLength(1)
    const op = ops[0] as Extract<DialogOp, { op: 'patch' }>
    expect(op.peerId).toBe(2)
    expect(op.index).toBeUndefined() // индекс внутри блока закреплённых не сдвинулся
  })

  it('applyRead: fallback unread=0 без поля в кадре; чужое прочтение двигает peerReadSeq, не мой unread; устаревший peer-read не регрессирует и не публикует операцию', async () => {
    const ops: DialogOp[] = []
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })
    await mgr.fillMirror()
    mgr.applyNewMessage({ message: makeRawMessage({ id: 2, peerId: 1, fromId: 9, text: 'x', createdAt: '2026-08-01T00:00:01Z' }), unread: 5 })
    ops.length = 0

    mgr.applyRead({ peer_id: 1, user_id: 7, up_to_seq: 2 } as ReadEvt, 7)
    expect((ops[0] as Extract<DialogOp, { op: 'patch' }>).fields.unread_count).toBe(0)

    ops.length = 0
    mgr.applyRead({ peer_id: 1, user_id: 5, up_to_seq: 9 } as ReadEvt, 7)
    const opPeer = ops[0] as Extract<DialogOp, { op: 'patch' }>
    expect(opPeer.fields.read_outbox_max_id).toBe(generateMessageId(9))
    expect(opPeer.fields.unread_count).toBeUndefined() // чужое прочтение мой unread не трогает

    ops.length = 0
    mgr.applyRead({ peer_id: 1, user_id: 5, up_to_seq: 4 } as ReadEvt, 7)
    expect(ops).toHaveLength(0)
  })

  it('applyRead от меня гасит и бейдж непрочитанных реакций', async () => {
    const ops: DialogOp[] = []
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })
    await mgr.fillMirror()
    mgr.bumpUnreadReactions(1, 2)
    ops.length = 0

    mgr.applyRead({ peer_id: 1, user_id: 7, up_to_seq: 1 } as ReadEvt, 7)

    expect((ops[0] as Extract<DialogOp, { op: 'patch' }>).fields.unread_reactions_count).toBe(0)
  })
})

// Task 4 (действия без оптимистики): порт tweb — сеть сначала, локальный апдейт
// (patchDialog/applyPinned) идёт ПОСЛЕ успешного ответа, а не до него. Стенд
// склеивает РЕАЛЬНЫЕ newDialogsManager + newGroupsManager тем же приёмом, что
// workerCore.ts (groupsManager получает владельца зависимостью), — проверяем
// сквозной путь «сеть → владелец», а не мок вместо владельца.
describe('dialogsManager × groupsManager: действия без оптимистики (Task 4)', () => {
  it('setMute: RPC упал — ни одной операции, кэш не изменился', async () => {
    const ops: DialogOp[] = []
    const dialogs = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })
    await dialogs.fillMirror()
    ops.length = 0
    const groups = newGroupsManager({ rest: { post: vi.fn(async () => { throw new Error('offline') }) } as never, dialogs, peers: { saveApiPeers: vi.fn() } })

    await expect(groups.setMute(1, true)).rejects.toThrow()

    expect(ops).toEqual([])
    expect(isMuted(dialogs.getSnapshot().find((i) => i.dialog.peerId === 1)!.dialog)).toBe(false)
  })

  it('setMute: успех — patch опубликован ПОСЛЕ ответа сервера', async () => {
    const ops: DialogOp[] = []
    const dialogs = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })
    await dialogs.fillMirror()
    ops.length = 0
    // rest.post не резолвится, пока тест сам не дёрнет resolvePost — так видно,
    // что apply СТОИТ ПОСЛЕ await, а не до него (мутация «apply перед await»
    // сдвинула бы патч ДО resolvePost и первый expect ниже покраснел бы).
    let resolvePost!: () => void
    const posted = new Promise<void>((res) => { resolvePost = res })
    const groups = newGroupsManager({ rest: { post: vi.fn(async () => { await posted }) } as never, dialogs, peers: { saveApiPeers: vi.fn() } })

    const call = groups.setMute(1, true)
    expect(ops).toEqual([]) // ответ сети ещё не пришёл — кэш и зеркало не тронуты
    resolvePost()
    await call

    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'patch', peerId: 1, fields: { notify_settings: MUTED } })
    expect(isMuted(dialogs.getSnapshot().find((i) => i.dialog.peerId === 1)!.dialog)).toBe(true)
  })
})

// Task 4: применялки владельца сами по себе (без сети) — тела, которые зовут
// сетевые менеджеры ПОСЛЕ успешного REST-ответа (см. groupsManager.ts/
// chatThemesManager.ts) и workerCore.ts::dispatch для realtime-эха с другого
// устройства (dialog_mute/dialog_pin/dialog_archive/chat_theme_update).
describe('dialogsManager: действия без оптимистики — применялки владельца', () => {
  const setup = (dialogs: Dialog[], pinnedOrders: Record<number, number[]> = {}) => {
    const ops: DialogOp[] = []
    const saved: Record<number, number[]>[] = []
    const mirrored: { key: string; value: unknown }[] = []
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => dialogs,
      loadState: async () => ({ pinnedOrders, drafts: [] }),
      savePinnedOrders: async (v) => { saved.push(v) },
      mirrorStateKey: (key, value) => mirrored.push({ key, value }),
    })
    return { mgr, ops, saved, mirrored }
  }

  it('applyNotifySettings несёт СРОК целиком, а не булево', async () => {
    const { mgr, ops } = setup([dialog(1, '2026-08-01T00:00:00Z')])
    await mgr.fillMirror()
    ops.length = 0

    mgr.applyNotifySettings(1, MUTED)

    expect(ops).toEqual([{ op: 'patch', peerId: 1, fields: { notify_settings: MUTED } }])
    expect(isMuted(mgr.getSnapshot().find((i) => i.dialog.peerId === 1)!.dialog)).toBe(true)
  })

  it('applyArchived архивирует НОМЕРОМ ПАПКИ и сбрасывает пин (как на бэке)', async () => {
    const { mgr, ops } = setup([dialog(1, '2026-08-01T00:00:00Z', true)])
    await mgr.fillMirror()
    expect(isPinned(mgr.getSnapshot()[0].dialog)).toBe(true)
    ops.length = 0

    mgr.applyArchived(1, true)

    // Диалог был закреплён — сброс пина выкидывает его из «закреплённого» блока
    // индекса в обычный (по дате активности), поэтому index в патче ТОЖЕ
    // участвует (moved=true внутри patchDialog) — сверяем fields отдельно.
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'patch', peerId: 1, fields: { folder_id: 1, pFlags: undefined } })
    const d = mgr.getSnapshot().find((i) => i.dialog.peerId === 1)!.dialog
    expect(isDialogArchived(d)).toBe(true)
    expect(isPinned(d)).toBe(false)

    // Обратно — «папка не указана» это ОТСУТСТВИЕ значения, а не третий член.
    mgr.applyArchived(1, false)
    expect(isDialogArchived(mgr.getSnapshot().find((i) => i.dialog.peerId === 1)!.dialog)).toBe(false)
  })

  // Р4: срок мьюта гасит КЛИЕНТ (порт appNotificationsManager.checkMuteUntil).
  // Без этого «заглушить на час» оставалось бы неотличимо от «навсегда»:
  // иконка не погасла бы в назначенный час, пересчёт случался бы только при
  // следующей полной загрузке списка.
  it('истёкший срок мьюта владелец снимает сам, по таймеру на ближайший срок', async () => {
    vi.useFakeTimers()
    const now = Math.floor(Date.now() / 1000)
    const muted = makeDialog({ peerId: 1, muteUntil: now + 60, lastMessage: makeLastMessage({ peerId: 1, id: 1 }) })
    const { mgr, ops } = setup([muted])
    await mgr.fillMirror()
    ops.length = 0

    expect(isMuted(mgr.getSnapshot()[0].dialog)).toBe(true)
    await vi.advanceTimersByTimeAsync(61_000)

    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'patch', peerId: 1 })
    // Переопределения больше нет — ключ снят, а не обнулён.
    const d = mgr.getSnapshot()[0].dialog
    expect(d.notify_settings.mute_until).toBeUndefined()
    expect(isMuted(d)).toBe(false)
    vi.useRealTimers()
  })

  it('«навсегда» таймера не заводит — срок есть, но не наступит', async () => {
    vi.useFakeTimers()
    const { mgr, ops } = setup([makeDialog({ peerId: 1, muteUntil: true })])
    await mgr.fillMirror()
    ops.length = 0

    await vi.advanceTimersByTimeAsync(3600_000)

    expect(ops).toEqual([])
    expect(isMuted(mgr.getSnapshot()[0].dialog)).toBe(true)
    vi.useRealTimers()
  })

  it('снятие уже снятого архива — тихий no-op: «выключено» это ОТСУТСТВИЕ ключа', async () => {
    const { mgr, ops } = setup([dialog(1, '2026-08-01T00:00:00Z')])
    await mgr.fillMirror()
    ops.length = 0

    mgr.applyArchived(1, false) // диалог и так не в архиве

    expect(ops).toEqual([])
    expect(isDialogArchived(mgr.getSnapshot()[0].dialog)).toBe(false)
  })

  it('applyPinned: свежий пин встаёт первым (tweb order.unshift), пишет pinnedOrders на диск и зеркалит ключ', async () => {
    const { mgr, ops, saved, mirrored } = setup([
      dialog(1, '2026-08-09T10:00:00Z'),
      dialog(2, '2026-08-09T11:00:00Z'),
      dialog(3, '2026-08-09T12:00:00Z'),
    ])
    await mgr.fillMirror()
    ops.length = 0

    mgr.applyPinned(1, true)

    expect(mgr.getSnapshot().map((i) => i.dialog.peerId)).toEqual([1, 3, 2])
    expect(isPinned(mgr.getSnapshot().find((i) => i.dialog.peerId === 1)!.dialog)).toBe(true)
    expect(saved[saved.length - 1]).toEqual({ 0: [1] })
    expect(mirrored[mirrored.length - 1]).toEqual({ key: 'pinnedOrders', value: { 0: [1] } })
    expect(ops.some((o) => o.op === 'patch' && o.peerId === 1 && !!o.fields.pFlags?.pinned)).toBe(true)

    ops.length = 0
    mgr.applyPinned(2, true) // второй пин встаёт ПЕРВЫМ (unshift)
    expect(mgr.getSnapshot().map((i) => i.dialog.peerId)).toEqual([2, 1, 3])
    expect(saved[saved.length - 1]).toEqual({ 0: [2, 1] })
  })

  it('applyPinned(false): анпин выпадает из порядка и возвращается к дате активности', async () => {
    const { mgr, saved } = setup(
      [dialog(1, '2026-08-09T10:00:00Z', true), dialog(2, '2026-08-09T12:00:00Z')],
      { 0: [1] },
    )
    await mgr.fillMirror()
    expect(mgr.getSnapshot().map((i) => i.dialog.peerId)).toEqual([1, 2])

    mgr.applyPinned(1, false)

    expect(mgr.getSnapshot().map((i) => i.dialog.peerId)).toEqual([2, 1])
    expect(isPinned(mgr.getSnapshot().find((i) => i.dialog.peerId === 1)!.dialog)).toBe(false)
    expect(saved[saved.length - 1]).toEqual({ 0: [] })
  })

  it('applyPinned: неизвестный чат — тихий no-op, pinnedOrders не пишется', async () => {
    const { mgr, ops, saved } = setup([dialog(1, '2026-08-01T00:00:00Z')])
    await mgr.fillMirror()
    ops.length = 0

    mgr.applyPinned(99, true)

    expect(ops).toEqual([])
    expect(saved).toEqual([])
  })

  // Fix (ревью Task 4, Critical): бэкенд шлёт dialog_pin на ВСЕ соединения
  // пользователя, включая инициировавшее действие (hub.go:203-209 — во фрейме
  // нет id соединения, фильтровать нечем), поэтому вкладка, которая только что
  // сама успешно запинила чат, гарантированно получает собственное эхо того же
  // факта позже. Без гварда «факт уже применён» это эхо безусловно двигало
  // order.unshift заново — воспроизведённый ревьюером баг: чат, запиненный
  // РАНЬШЕ, задним числом обгонял чат, запиненный ПОЗЖЕ.
  it('applyPinned идемпотентен: запоздавшее собственное WS-эхо не переставляет уже устоявшийся порядок', async () => {
    const { mgr, ops, saved, mirrored } = setup([
      dialog(1, '2026-08-09T10:00:00Z'),
      dialog(2, '2026-08-09T11:00:00Z'),
      dialog(3, '2026-08-09T12:00:00Z'),
    ])
    await mgr.fillMirror()

    mgr.applyPinned(1, true) // свой apply (после успешного REST, groupsManager.setPin)
    mgr.applyPinned(2, true) // apply другого чата — встаёт первым (unshift)
    expect(mgr.getSnapshot().map((i) => i.dialog.peerId)).toEqual([2, 1, 3])
    ops.length = 0
    saved.length = 0
    mirrored.length = 0

    mgr.applyPinned(1, true) // запоздавшее собственное WS-эхо ПЕРВОГО действия (dialog_pin)

    expect(mgr.getSnapshot().map((i) => i.dialog.peerId)).toEqual([2, 1, 3]) // порядок не меняется
    expect(ops).toEqual([]) // ни patch, ни reindex не публикуются
    expect(saved).toEqual([]) // pinnedOrders не пишется на диск повторно
    expect(mirrored).toEqual([]) // и не зеркалится повторно
  })

  // Симметричный случай для анпина — то же дублирующее эхо, но для pinned=false.
  it('applyPinned(false) идемпотентен: повторное эхо анпина уже открепленного чата — no-op', async () => {
    const { mgr, ops, saved } = setup(
      [dialog(1, '2026-08-09T10:00:00Z', true), dialog(2, '2026-08-09T12:00:00Z')],
      { 0: [1] },
    )
    await mgr.fillMirror()
    mgr.applyPinned(1, false)
    ops.length = 0
    saved.length = 0

    mgr.applyPinned(1, false) // повторное эхо того же анпина

    expect(ops).toEqual([])
    expect(saved).toEqual([])
  })
})

// Task 5 (персист диалогов переезжает к владельцу): раньше снапшот собирала
// main-thread-подписка `stores/dialogsPersist.ts` (дебаунс 800мс поверх
// зеркала chatsStore) и слала RPC `persist.dialogs(...)` воркеру — теперь
// владелец пишет СВОЙ кэш сам, дебаунсом, после каждой публикации операций.
// `saveCache` — та же роль, что `savePinnedOrders`/`mirrorStateKey` выше:
// опциональная зависимость, подставляемая в workerCore.ts (`saveDialogs`).
describe('dialogsManager: персист списка переезжает к владельцу (Task 5)', () => {
  it('после операции список пишется на диск с дебаунсом (один вызов на серию)', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => {})
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
      saveCache: save,
    })
    await mgr.fillMirror()

    mgr.applyNotifySettings(1, MUTED); mgr.applyNotifySettings(1, UNMUTED); mgr.applyNotifySettings(1, MUTED)

    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('дебаунс не теряет последнюю правку — пишет актуальный снимок списка', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async (_dialogs: Dialog[]) => {})
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
      saveCache: save,
    })
    await mgr.fillMirror()

    mgr.applyNotifySettings(1, MUTED)
    await vi.advanceTimersByTimeAsync(1000)

    expect(save).toHaveBeenCalledTimes(1)
    const written = save.mock.calls[0][0]
    expect(isMuted(written.find((d) => d.peerId === 1)!)).toBe(true)
    vi.useRealTimers()
  })

  // «Осторожно» (смена аккаунта/логаут): workerCore.ts зовёт `cancelPersist()`
  // из onLoggingOut/onLoggedIn (тем же приёмом, что media.resetToken/
  // resetDownloads) — гасит ОЖИДАЮЩИЙ (ещё не выстреливший) таймер, экономя
  // заведомо бессмысленную запись устаревших диалогов. Это НЕ защита от гонки
  // «запись уже в полёте, когда приходит persistClearAll()» — от неё
  // защищает порядок IndexedDB-транзакций в core/store/persist.ts (см. докблок
  // `cancelPersist()` в dialogsManager.ts и интеграционный тест
  // workerCore.dialogsPersist.test.ts, который гоняет именно этот сценарий).
  it('cancelPersist() отменяет ОЖИДАЮЩУЮ запись — планов на будущее не остаётся', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => {})
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
      saveCache: save,
    })
    await mgr.fillMirror()
    mgr.applyNotifySettings(1, MUTED)

    mgr.cancelPersist()
    await vi.advanceTimersByTimeAsync(5000)

    expect(save).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

// Шаг C диалогов: `/chats` стал КОНТЕЙНЕРОМ. Векторы `chats`/`users` втекают в
// владельца карточек, `messages` — в владельца сообщений, а `top_message`
// разрешается ОТТУДА ЖЕ (решение Р11): наверх едет целый `Message`, а не
// девятиполевая серверная выжимка.
describe('dialogsManager: контейнер /chats (шаг C)', () => {
  it('векторы chats/users уезжают владельцу карточек, messages — владельцу сообщений', async () => {
    const peers = fakePeers()
    const messages = fakeMessages()
    const mgr = newDialogsManager({
      rest: { get: vi.fn(async () => container([rawDialog(-9, 7)], undefined, {
        messages: [rawMessage(-9, 7, 'привет', 77)],
        chats: [{ _: 'channel', id: 9, title: 'Группа', pFlags: { megagroup: true } }],
        users: [{ _: 'user', id: 77, first_name: 'Аня' }],
      })) } as never,
      onDialogOps: () => {},
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
      peers, messages,
    })

    await mgr.refresh()

    expect(peers.saved).toEqual([{
      chats: [{ _: 'channel', id: 9, title: 'Группа', pFlags: { megagroup: true } }],
      users: [{ _: 'user', id: 77, first_name: 'Аня' }],
    }])
    expect(messages.saved.map((m) => getServerMessageId(m.id))).toEqual([7])
  })

  it('top_message разрешается в ЦЕЛОЕ сообщение из хранилища владельца сообщений', async () => {
    const messages = fakeMessages()
    const mgr = newDialogsManager({
      rest: { get: vi.fn(async () => container([rawDialog(-9, 7)], undefined, {
        messages: [rawMessage(-9, 7, 'привет', 77)],
      })) } as never,
      onDialogOps: () => {},
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
      peers: fakePeers(), messages,
    })

    await mgr.refresh()

    const d = mgr.getSnapshot()[0].dialog
    expect(d.top_message).toBe(generateMessageId(7))
    // Целое сообщение: у выжимки не было ни id, ни сущностей, ни `fwdFrom`.
    expect(d.lastMessage).toMatchObject({ id: generateMessageId(7), peerId: -9, fromId: 77, message: 'привет' })
  })

  it('«это всё» — ОТСУТСТВИЕ count, а не булев is_end (порт appMessagesManager.ts:3629)', async () => {
    const whole = newDialogsManager({
      rest: restStub([rawDialog(-9, 7)]) as never, // messages.dialogs — без count
      onDialogOps: () => {},
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
      peers: fakePeers(), messages: fakeMessages(),
    })
    await whole.refresh()
    // Выборка объявлена загруженной целиком — страница отвечает из кэша.
    expect((await whole.getDialogs({ limit: 20 })).isEnd).toBe(true)

    const slice = newDialogsManager({
      rest: restStub([rawDialog(-9, 7)], 50) as never, // messages.dialogsSlice{count:50}
      onDialogOps: () => {},
      loadCache: async () => [],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
      peers: fakePeers(), messages: fakeMessages(),
    })
    await slice.refresh()
    expect((await slice.getDialogs({ limit: 20 })).isEnd).toBe(false)
  })
})

// Task 6 (пины владения, приоритетная находка ревью Task 5): владелец обязан
// полностью сбрасывать in-memory кэш на логауте/смене аккаунта — иначе
// `dialogsManager` (живёт в SharedWorker, переживает `location.reload()`
// отдельной вкладки) отдал бы следующему `fillMirror()` (уже под ДРУГИМ
// пользователем) готовый список прошлого аккаунта вместо честной регидратации
// с диска. Проводка (вызов из workerCore.ts::onLoggingOut/onLoggedIn) покрыта
// отдельно — workerCore.dialogsReset.test.ts.
describe('dialogsManager: сброс кэша владельца при логауте (Task 6)', () => {
  it('resetForLogout() опустошает getSnapshot(); следующий fillMirror перечитывает кэш/State заново, а не отдаёт прошлые данные', async () => {
    let cacheGen = 1
    let stateGen = 1
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: () => {},
      loadCache: async () => (cacheGen === 1
        ? [dialog(1, '2026-08-01T00:00:00Z')]
        : [dialog(2, '2026-08-02T00:00:00Z')]),
      loadState: async () => (stateGen === 1
        ? { pinnedOrders: {}, drafts: [] }
        : { pinnedOrders: { 0: [2] } as Record<number, number[]>, drafts: [] }),
    })

    await mgr.fillMirror()
    expect(mgr.getSnapshot().map((i) => i.dialog.peerId)).toEqual([1])

    mgr.resetForLogout()
    expect(mgr.getSnapshot()).toEqual([])

    // «Другой пользователь» — другой офлайн-кэш и другой pinnedOrders на диске.
    cacheGen = 2
    stateGen = 2
    const op = await mgr.fillMirror()

    expect(mgr.getSnapshot().map((i) => i.dialog.peerId)).toEqual([2])
    expect((op as { items: { dialog: Dialog; index: number }[] }).items[0]!.dialog.peerId).toBe(2)
  })

  it('resetForLogout() без немедленного fillMirror — patch/mute на пустой кэш тихо no-op (кэш честно пуст, не подвешен)', () => {
    const ops: DialogOp[] = []
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })

    mgr.resetForLogout()
    mgr.applyNotifySettings(1, MUTED) // диалога нет в (уже пустом) кэше

    expect(ops).toEqual([])
    expect(mgr.getSnapshot()).toEqual([])
  })
})

// Task 6 (снос старого пути): порт `chatsStore: черновик поднимает диалог`
// (chatsStore.order.test.ts, снесён этой же задачей вместе с applyDialogs) —
// сценарии не менялись, только вход (fillMirror вместо setDialogs) и State
// (loadState().drafts вместо AppState напрямую). `sort()` владельца читает
// draftFor() из тех же `drafts`, что тут сеются.
describe('dialogsManager: черновик поднимает диалог (Task 6, порт chatsStore.order.test.ts)', () => {
  it('свежий черновик перевешивает более старое последнее сообщение', async () => {
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, '2026-08-09T10:00:00Z'), dialog(2, '2026-08-09T12:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [draft(1, '2026-08-09T13:00:00Z')] }),
    })

    const op = await mgr.fillMirror()

    expect(ids(op)).toEqual([1, 2])
  })

  it('без черновика тот же набор даёт обратный порядок (черновик реально участвует)', async () => {
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, '2026-08-09T10:00:00Z'), dialog(2, '2026-08-09T12:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })

    const op = await mgr.fillMirror()

    expect(ids(op)).toEqual([2, 1])
  })

  it('старый черновик диалог не поднимает', async () => {
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, '2026-08-09T10:00:00Z'), dialog(2, '2026-08-09T12:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [draft(1, '2026-08-09T09:00:00Z')] }),
    })

    const op = await mgr.fillMirror()

    expect(ids(op)).toEqual([2, 1])
  })
})

// Task 6 (снос старого пути): порт `chatsStore: pinnedOrders засеивается из
// applyDialogs/setDialogs` (chatsStore.order.test.ts, снесён этой же задачей) —
// последний кусок легаси-пути, явно помеченный предыдущей задачей как «Task 6,
// ещё не тронуто» (см. история файла). Перенесено в dialogsManager::setAll
// (см. докблок syncPinnedOrder в dialogsManager.ts).
describe('dialogsManager: засеивание pinnedOrders из первого списка (Task 6, порт applyDialogs/syncPinnedOrder)', () => {
  it('порядок закреплённых переживает повторное применение списка (кэш → сеть, закреплённые пришли в другом порядке ответа)', async () => {
    const mgr = newDialogsManager({
      rest: { get: vi.fn(async () => container(
        // сеть: тот же набор, но закреплённые пришли в ДРУГОМ порядке ответа
        [pinnedRaw(2), pinnedRaw(1), rawDialog(3, 1)],
        undefined,
        { messages: [rawMessage(2, 1, 'x', 1, '2026-08-09T11:00:00Z'), rawMessage(1, 1, 'x', 1, '2026-08-09T10:00:00Z'), rawMessage(3, 1, 'x', 1, '2026-08-09T12:00:00Z')] },
      )) } as never,
      onDialogOps: () => {},
      messages: fakeMessages(),
      loadCache: async () => [
        dialog(1, '2026-08-09T10:00:00Z', true),
        dialog(2, '2026-08-09T11:00:00Z', true),
        dialog(3, '2026-08-09T12:00:00Z'),
      ],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })

    const before = await mgr.fillMirror() // кэш: закреплённые [1, 2] — засеивает pinnedOrders=[1,2]
    expect(ids(before)).toEqual([1, 2, 3])

    // сеть: тот же набор, но закреплённые пришли в ДРУГОМ порядке ответа ([2, 1])
    await mgr.refresh()

    // pinnedOrders уже засеян кэшем [1,2] — ответ сети его не переигрывает.
    expect(mgr.getSnapshot().map((i) => i.dialog.peerId)).toEqual([1, 2, 3])
  })

  // Порядок закреплённых сервер отдаёт только позицией в ответе /chats (ORDER
  // BY m.pinned_at DESC, chatsrepo.go:225) — в модели `Dialog` его нет. Первый
  // применённый список фиксирует его в pinnedOrders, дальше он авторитетен.
  it('первый список засеивает pinnedOrders порядком ответа сервера', async () => {
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: () => {},
      loadCache: async () => [
        dialog(2, '2020-01-01T00:00:00Z', true),
        dialog(1, '2026-08-09T12:00:00Z', true),
        dialog(3, '2026-08-09T13:00:00Z'),
      ],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })

    const op = await mgr.fillMirror()

    expect(ids(op)).toEqual([2, 1, 3])
  })

  // Fix (находка ревью Task 6 при переносе этого блока): досеянный pinnedOrder
  // обязан остаться КОНСИСТЕНТНЫМ с индексами, которые уже отдал этот же
  // fillMirror — иначе ближайший точечный patch (не полный список) одного из
  // ранее-неотслеженных закреплённых пересчитает его индекс уже НОВЫМ
  // pinnedOrder, увидит расхождение с сохранённым (общим для всех
  // неотслеженных) и перетасует пин-блок на пустом месте — см. докблок
  // syncPinnedOrder в dialogsManager.ts.
  it('первичное засеивание переживает последующий точечный patch, не только повторный полный список', async () => {
    const ops: DialogOp[] = []
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [
        dialog(1, '2020-01-01T00:00:00Z', true), // topmost pinned
        dialog(2, '2020-01-01T00:00:00Z', true),
        dialog(3, '2020-01-01T00:00:00Z', true), // bottommost pinned
      ],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })
    await mgr.fillMirror()
    expect(mgr.getSnapshot().map((i) => i.dialog.peerId)).toEqual([1, 2, 3])
    ops.length = 0

    // Входящее сообщение в СРЕДНИЙ закреплённый — контентный patch, не трогает
    // `pinned`. Без консистентного pinnedOrder (см. докблок syncPinnedOrder)
    // recompute дал бы peerId=2 БОЛЬШИЙ индекс, чем ещё не пересчитанные
    // соседи (те остались бы на старом «общем для всех неотслеженных»
    // значении), и он ошибочно прыгнул бы наверх пин-блока: [1,2,3] → [2,1,3].
    mgr.applyNewMessage({ message: makeRawMessage({ id: 2, peerId: 2, fromId: 9, text: 'hi', createdAt: '2026-08-09T15:00:00Z' }) })

    expect(mgr.getSnapshot().map((i) => i.dialog.peerId)).toEqual([1, 2, 3])
  })
})

// ── Финальное ревью ветки ────────────────────────────────────────────────────
// Important #4: инвариант «совпавший ответ не даёт ни перерисовки, ни записи в
// IDB» (web-client/CLAUDE.md, «Применять ответ сети полной подменой коллекции»;
// порт tweb saveDialogFilter) на стороне ВЛАДЕЛЬЦА. До правки `refresh()`
// публиковал `reset` безусловно, а `publish()` безусловно планировал полную
// перезапись стора (clear + N put) — значит каждый колсайт `refresh()` (их
// больше десятка: Sidebar, deep-links, редактор контакта, resync-кадр…), каждый
// `reindex` и сам холодный старт переписывали весь S_DIALOGS. Половину зеркала
// держит stores/chatsStore.order.test.ts.
describe('dialogsManager: совпавший ответ не даёт ни операции, ни записи на диск (Important #4)', () => {
  const raw = (peerId: number) => rawDialog(peerId, 1)
  const at = (peerId: number) => (peerId === 1 ? '2026-08-01T00:00:00Z' : '2026-08-02T00:00:00Z')
  const msg = (peerId: number) => rawMessage(peerId, 1, 'x', 1, at(peerId))
  const cached = (peerId: number): Dialog =>
    makeDialog({
      peerId,
      topMessage: generateMessageId(1),
      // Горизонты чтения в КЭШЕ уже клиентские (их перевёл `toDialog` в прошлой
      // сессии) — иначе совпавший ответ сети выглядел бы изменившимся.
      readInboxMaxId: generateMessageId(0),
      readOutboxMaxId: generateMessageId(0),
      lastMessage: mapMyMessage(msg(peerId)),
    })

  it('ответ /chats совпал с кэшем — refresh() отдаёт null, ops пусты, saveCache не планируется, ссылки сохранены', async () => {
    vi.useFakeTimers()
    const ops: DialogOp[] = []
    const save = vi.fn(async () => {})
    const mgr = newDialogsManager({
      // сеть отдаёт РОВНО то же, что лежит в офлайн-кэше
      rest: { get: vi.fn(async () => container([raw(1), raw(2)], undefined, { messages: [msg(1), msg(2)] })) } as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [cached(1), cached(2)],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
      saveCache: save,
      messages: fakeMessages(),
    })
    await mgr.fillMirror()
    const before = mgr.getSnapshot()
    ops.length = 0

    const op = await mgr.refresh()

    expect(op).toBeNull()
    expect(ops).toEqual([])
    expect(mgr.getSnapshot()).toBe(before) // тот же массив по ССЫЛКЕ
    expect(mgr.getSnapshot()[0]).toBe(before[0]) // и те же элементы
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('ответ /chats отличается — reset публикуется, возвращается вызывающему и уезжает на диск', async () => {
    vi.useFakeTimers()
    const ops: DialogOp[] = []
    const save = vi.fn(async () => {})
    const mgr = newDialogsManager({
      rest: { get: vi.fn(async () => container([raw(1), raw(2)], undefined, { messages: [msg(1), msg(2)] })) } as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
      saveCache: save,
      messages: fakeMessages(),
    })
    await mgr.fillMirror()
    ops.length = 0

    const op = await mgr.refresh()

    // Important #2: ответ RPC — самостоятельный канал доставки (boot.ts применяет
    // его к зеркалу до того, как поднят насос rt:dialog_op).
    expect(op?.op).toBe('reset')
    expect(ids(op!)).toEqual([2, 1])
    expect(ops).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('fillMirror не планирует запись на диск — данные только что прочитаны с того же диска', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => {})
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
      saveCache: save,
    })

    await mgr.fillMirror()
    await vi.advanceTimersByTimeAsync(5000)

    expect(save).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('reindex (State-ключ сменился) рассылается, но диска не касается — значения диалогов те же', async () => {
    vi.useFakeTimers()
    const ops: DialogOp[] = []
    const save = vi.fn(async () => {})
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, '2026-08-09T10:00:00Z'), dialog(2, '2026-08-09T12:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
      saveCache: save,
    })
    await mgr.fillMirror()
    ops.length = 0

    mgr.setStateKey('drafts', [draft(1, '2026-08-09T13:00:00Z')])

    expect(ops).toHaveLength(1)
    expect(ops[0].op).toBe('reindex')
    expect(mgr.getSnapshot().map((i) => i.dialog.peerId)).toEqual([1, 2]) // черновик поднял диалог
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

// Minor #4: `resetForLogout()` опустошает кэш синхронно, но уже улетевшие
// `hydrate()`/`refresh()` этим не гасятся — ответ `/chats`, отправленный под
// ПРОШЛЫМ токеном, применился бы к кэшу нового аккаунта и разошёлся веером по
// вкладкам (SharedWorker переживает reload вкладки). Гвард — поколение сессии,
// по образцу `downloadGen` в mediaManager.ts.
describe('dialogsManager: поколение сессии гасит ответы прошлого аккаунта (Minor #4)', () => {
  // Операции владельца асинхронны с первого же шага (`await hydrate()`), поэтому
  // «запрос уже улетел» наступает не синхронно за вызовом — прокручиваем
  // микротаски, прежде чем имитировать смену сессии.
  const tick = async (n = 5) => { for (let i = 0; i < n; i++) await Promise.resolve() }

  it('ответ /chats, улетевший до логаута, не применяется и не рассылается', async () => {
    let resolveGet!: (v: { chats: unknown[] }) => void
    const ops: DialogOp[] = []
    const mgr = newDialogsManager({
      rest: { get: vi.fn(() => new Promise((res) => { resolveGet = res as never })) } as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })
    await mgr.fillMirror()
    ops.length = 0

    const inflight = mgr.refresh()
    await tick() // запрос ушёл под ПРОШЛЫМ токеном
    mgr.resetForLogout() // сессия сменилась, пока ответ летел
    resolveGet({ chats: [{ peer_id: 5, type: 'private', title: 't5', unread: 0, last_read_seq: 0 }] })

    await expect(inflight).resolves.toBeNull()
    expect(ops).toEqual([]) // чужой список не разошёлся по вкладкам
    expect(mgr.getSnapshot()).toEqual([]) // и не осел в кэше владельца
  })

  it('чтение диска, улетевшее до логаута, не применяется — гидратация переигрывается заново', async () => {
    let resolveCache!: (v: Dialog[]) => void
    const ops: DialogOp[] = []
    let gen = 1
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: () => (gen === 1
        ? new Promise<Dialog[]>((res) => { resolveCache = res })
        : Promise.resolve([dialog(2, '2026-08-02T00:00:00Z')])),
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })

    const inflight = mgr.fillMirror()
    await tick() // чтение кэша ПРОШЛОГО аккаунта уже в полёте
    mgr.resetForLogout()
    gen = 2
    resolveCache([dialog(1, '2026-08-01T00:00:00Z')])

    expect(ids(await inflight)).toEqual([]) // прошлый список никому не отдан
    expect(ops).toEqual([]) // и не разослан
    // Гидратация не «залипла» отменённой: следующий вызов честно читает диск
    // нового аккаунта.
    const op = await mgr.fillMirror()
    expect(ids(op)).toEqual([2])
  })
})

// Находка B (повторное ревью финальной волны): гвард `if (hydrating === p)` в
// `finally` у `hydrate()` (dialogsManager.ts) — без него безусловное
// `hydrating = null` в `finally` СТАРОЙ гидратации, дорезолвившейся ПОСЛЕ
// того, как `resetForLogout()` уже запустил НОВУЮ, обнулило бы ссылку на ещё
// не завершённую новую гидратацию. Третий параллельный вызов в этом окне
// увидел бы `hydrating === null` и запустил бы ЕЩЁ ОДНУ (третью) гидратацию
// вместо того, чтобы присоединиться к уже идущей новой — тот же класс гонки,
// что промис вместо булева флага уже закрыл для случая «конкурентный
// fillMirror» (см. describe выше), но с другой стороны: не ДВА параллельных
// первых вызова, а ХВОСТ отменённого предыдущего, наступающий на пятки уже
// стартовавшему следующему.
describe('dialogsManager: finally прошлой гидратации не сбивает hydrating новой (находка B)', () => {
  const tick = async (n = 5) => { for (let i = 0; i < n; i++) await Promise.resolve() }

  it('третий fillMirror() присоединяется к УЖЕ ИДУЩЕЙ новой гидратации, а не запускает третью', async () => {
    const cacheCalls: Array<{ resolve: (v: Dialog[]) => void }> = []
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: () => {},
      loadCache: () => new Promise<Dialog[]>((res) => { cacheCalls.push({ resolve: res }) }),
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })

    const p1 = mgr.fillMirror() // гидратация СТАРОЙ сессии начата
    await tick() // дошла до await loadCache() — cacheCalls[0] в полёте
    mgr.resetForLogout() // sessionGen++, hydrating сброшен СИНХРОННО

    const p2 = mgr.fillMirror() // гидратация НОВОЙ сессии начата (hydrating = pInternal2)
    await tick() // дошла до await loadCache() — cacheCalls[1] в полёте

    cacheCalls[0].resolve([]) // СТАРАЯ гидратация дорезолвилась ПОСЛЕ старта новой
    await tick(10) // даём отработать её .finally() — здесь и решается гвард

    // Пока НОВАЯ гидратация ещё не завершена (cacheCalls[1] не резолвлен) —
    // третий вызов обязан присоединиться к НЕЙ, а не начать третью гидратацию.
    const p3 = mgr.fillMirror()
    await tick()
    expect(cacheCalls).toHaveLength(2) // не 3 — красная строка на безусловном hydrating=null

    cacheCalls[1].resolve([dialog(9, '2026-08-09T00:00:00Z')])
    const [op1, op2, op3] = await Promise.all([p1, p2, p3])
    expect(ids(op1)).toEqual([]) // отменённая сессия — честно пустой ответ (gen-гвард)
    expect(ids(op2)).toEqual([9]) // дождалась своей же гидратации
    expect(ids(op3)).toEqual([9]) // присоединилась к ТОЙ ЖЕ гидратации, увидела её результат
  })
})
