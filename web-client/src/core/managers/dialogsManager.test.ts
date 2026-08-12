// Task 1 (перенос владения списком диалогов в воркер): тест владельца порядка —
// dialogsManager считает индекс через ту же чистую dialogIndex(), что и прежний
// applyDialogs на главном потоке (см. core/dialogs/dialogIndex.ts), и отдаёт
// снимок отсортированным (свежие/закреплённые выше). Зеркало (chatsStore) пока
// НЕ переведено на эти операции (Task 2) — тест проверяет только владельца.
import { describe, expect, it, vi } from 'vitest'
import { newDialogsManager } from './dialogsManager'
import { newGroupsManager } from './groupsManager'
import type { Dialog } from '../models'
import type { NewMessageEvt, ReadEvt, ChatUpdateEvt } from '../realtime/events'
import type { DialogOp } from '../dialogs/dialogOps'

const dialog = (chatId: number, at: string, pinned = false): Dialog => ({
  chatId, type: 'private', title: 't' + chatId, unread: 0, unreadMentions: 0, unreadReactions: 0,
  lastReadSeq: 0, peerReadSeq: 0, muted: false, pinned, archived: false,
  lastMessage: { seq: 1, text: 'x', senderId: 1, at },
} as Dialog)

const restStub = (chats: unknown[]) => ({ get: vi.fn(async () => ({ chats })) })

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
    expect((op as { items: { dialog: Dialog }[] }).items.map((i) => i.dialog.chatId)).toEqual([2, 1])
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
    expect((op as { items: { dialog: Dialog }[] }).items.map((i) => i.dialog.chatId)).toEqual([1, 2])
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
    expect((op as { items: { dialog: Dialog }[] }).items.map((i) => i.dialog.chatId)).toEqual([1])
  })
})

// Task 3 (realtime-кадры применяет владелец): тела applyNewMessage/applyRead/
// applyChatMeta/bumpUnreadReactions переехали из chatsStore сюда как есть — меняется
// только выход (publish patch/remove вместо set({dialogs})). Зеркало (chatsStore)
// эти операции только зеркалит (проверено storeProjection.dialogs.test.ts).
describe('dialogsManager: realtime-кадры применяет владелец', () => {
  it('new_message публикует patch с новым индексом и превью', async () => {
    const ops: DialogOp[] = []
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z'), dialog(2, '2026-08-02T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })
    await mgr.fillMirror()
    ops.length = 0

    mgr.applyNewMessage({ chat_id: 1, seq: 7, text: 'привет', sender_id: 9,
      created_at: '2026-08-03T00:00:00Z', type: 'text' } as NewMessageEvt)

    expect(ops).toHaveLength(1)
    const op = ops[0] as Extract<DialogOp, { op: 'patch' }>
    expect(op.chatId).toBe(1)
    expect(op.fields.lastMessage?.text).toBe('привет')
    expect(op.index).toBeGreaterThan(mgr.getSnapshot()[1].index) // диалог 1 теперь выше
  })

  it('read моего пользователя гасит непрочитанное и не двигает порядок', async () => {
    const ops: DialogOp[] = []
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z'), dialog(2, '2026-08-02T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })
    await mgr.fillMirror()
    // dialog(1) стартует с unread:0 — сперва накопим непрочитанное живым
    // сообщением, иначе применение read было бы тривиальным no-op'ом.
    mgr.applyNewMessage({ chat_id: 1, seq: 2, text: 'hi', sender_id: 9,
      created_at: '2026-08-01T00:00:01Z', type: 'text' } as NewMessageEvt)
    const indexBefore = mgr.getSnapshot().find((i) => i.dialog.chatId === 1)!.index
    ops.length = 0

    mgr.applyRead({ chat_id: 1, user_id: 7, up_to_seq: 2, unread: 0 } as ReadEvt, 7)

    expect(ops).toHaveLength(1)
    const op = ops[0] as Extract<DialogOp, { op: 'patch' }>
    expect(op.chatId).toBe(1)
    expect(op.fields.unread).toBe(0)
    expect(op.index).toBeUndefined() // метаданные прочтения не двигают dialogIndex
    expect(mgr.getSnapshot().find((i) => i.dialog.chatId === 1)!.index).toBe(indexBefore)

    // Идемпотентность: повторное эхо того же прочтения не публикует новую операцию
    // (иначе на зеркале бесконечно перезапускался бы mark-read-эффект).
    ops.length = 0
    mgr.applyRead({ chat_id: 1, user_id: 7, up_to_seq: 2, unread: 0 } as ReadEvt, 7)
    expect(ops).toHaveLength(0)
  })

  it('chat_update сливает абсолютный снимок метаданных, index не меняется', async () => {
    const ops: DialogOp[] = []
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z'), dialog(2, '2026-08-02T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })
    await mgr.fillMirror()
    const indexBefore = mgr.getSnapshot().find((i) => i.dialog.chatId === 1)!.index
    ops.length = 0

    mgr.applyChatMeta({ chat_id: 1, title: 'Новое имя', photo_media_id: 42 } as ChatUpdateEvt)

    expect(ops).toHaveLength(1)
    const op = ops[0] as Extract<DialogOp, { op: 'patch' }>
    expect(op.chatId).toBe(1)
    expect(op.fields.title).toBe('Новое имя')
    expect(op.fields.photoUrl).toBe('/media/42/content')
    expect(op.index).toBeUndefined()
    expect(mgr.getSnapshot().find((i) => i.dialog.chatId === 1)!.index).toBe(indexBefore)

    // photo_media_id: null — фото снято (абсолютный снимок), photoUrl сбрасывается.
    ops.length = 0
    mgr.applyChatMeta({ chat_id: 1, photo_media_id: null } as ChatUpdateEvt)
    expect((ops[0] as Extract<DialogOp, { op: 'patch' }>).fields.photoUrl).toBeUndefined()
  })

  // Fix (ревью Task 3, Important): `patchDialog` публиковал `patch` безусловно —
  // повторный ИДЕНТИЧНЫЙ `chat_update` (backend publishChatUpdate зовётся из 13
  // мест и прилетает каждому участнику чата) пересоздавал объект диалога в кэше
  // владельца при нулевом изменении данных. Патч теперь публикуется, только если
  // смерженные поля структурно отличаются от текущего значения (`equal()` —
  // общий структурный компаратор `core/store/reconcile.ts`, тот же, что
  // `reconcileEntity` использует для сохранения ссылок в зеркале).
  it('повторный идентичный chat_update НЕ публикует операцию и не пересоздаёт объект диалога', async () => {
    const ops: DialogOp[] = []
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })
    await mgr.fillMirror()

    mgr.applyChatMeta({ chat_id: 1, title: 'Новое имя' } as ChatUpdateEvt)
    const dialogAfterFirst = mgr.getSnapshot().find((i) => i.dialog.chatId === 1)!.dialog
    ops.length = 0

    mgr.applyChatMeta({ chat_id: 1, title: 'Новое имя' } as ChatUpdateEvt) // тот же снимок повторно

    expect(ops).toHaveLength(0) // patch не опубликован
    expect(mgr.getSnapshot().find((i) => i.dialog.chatId === 1)!.dialog).toBe(dialogAfterFirst) // ссылка сохранена
  })

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
    expect((ops[0] as Extract<DialogOp, { op: 'patch' }>).fields.unreadReactions).toBe(1)

    mgr.bumpUnreadReactions(1, 5) // авторитетный счётчик из кадра — verbatim
    expect((ops[1] as Extract<DialogOp, { op: 'patch' }>).fields.unreadReactions).toBe(5)

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
    expect(ops).toEqual([{ op: 'remove', chatId: 1 }])
    expect(mgr.getSnapshot().find((i) => i.dialog.chatId === 1)).toBeUndefined()
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

    mgr.applyNewMessage({ chat_id: 99, seq: 1, text: 'x', sender_id: 9, created_at: '2026-08-01T00:00:01Z', type: 'text' } as NewMessageEvt)
    mgr.applyRead({ chat_id: 99, user_id: 7, up_to_seq: 1 } as ReadEvt, 7)
    mgr.applyChatMeta({ chat_id: 99, title: 'x' } as ChatUpdateEvt)
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

    mgr.applyNewMessage({ chat_id: 1, seq: 2, text: 'hi', sender_id: 7, created_at: '2026-08-01T00:00:01Z', type: 'text' } as NewMessageEvt)

    expect((ops[0] as Extract<DialogOp, { op: 'patch' }>).fields.unread).toBe(0)
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
    mgr.applyNewMessage({ chat_id: 1, seq: 2, text: 'a', sender_id: 9, created_at: '2026-08-01T00:00:01Z', type: 'text', unread: 5 } as NewMessageEvt)
    expect((ops[0] as Extract<DialogOp, { op: 'patch' }>).fields.unread).toBe(5)

    ops.length = 0
    mgr.applyNewMessage({ chat_id: 1, seq: 3, text: 'b', sender_id: 9, created_at: '2026-08-01T00:00:02Z', type: 'text' } as NewMessageEvt)
    // поля unread в кадре нет — fallback: текущий unread(5) + 1
    expect((ops[0] as Extract<DialogOp, { op: 'patch' }>).fields.unread).toBe(6)
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
    expect(mgr.getSnapshot().map((i) => i.dialog.chatId)).toEqual([1, 2, 3])
    ops.length = 0

    mgr.applyNewMessage({ chat_id: 2, seq: 4, text: 'yo', sender_id: 5, created_at: '2026-08-09T23:00:00Z', type: 'text' } as NewMessageEvt)

    // закреплённые держатся своим порядком (pinnedOrders), а не датой
    expect(mgr.getSnapshot().map((i) => i.dialog.chatId)).toEqual([1, 2, 3])
    expect(ops).toHaveLength(1)
    const op = ops[0] as Extract<DialogOp, { op: 'patch' }>
    expect(op.chatId).toBe(2)
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
    mgr.applyNewMessage({ chat_id: 1, seq: 2, text: 'x', sender_id: 9, created_at: '2026-08-01T00:00:01Z', type: 'text', unread: 5 } as NewMessageEvt)
    ops.length = 0

    mgr.applyRead({ chat_id: 1, user_id: 7, up_to_seq: 2 } as ReadEvt, 7)
    expect((ops[0] as Extract<DialogOp, { op: 'patch' }>).fields.unread).toBe(0)

    ops.length = 0
    mgr.applyRead({ chat_id: 1, user_id: 5, up_to_seq: 9 } as ReadEvt, 7)
    const opPeer = ops[0] as Extract<DialogOp, { op: 'patch' }>
    expect(opPeer.fields.peerReadSeq).toBe(9)
    expect(opPeer.fields.unread).toBeUndefined() // чужое прочтение мой unread не трогает

    ops.length = 0
    mgr.applyRead({ chat_id: 1, user_id: 5, up_to_seq: 4 } as ReadEvt, 7)
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

    mgr.applyRead({ chat_id: 1, user_id: 7, up_to_seq: 1 } as ReadEvt, 7)

    expect((ops[0] as Extract<DialogOp, { op: 'patch' }>).fields.unreadReactions).toBe(0)
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
    const groups = newGroupsManager({ rest: { post: vi.fn(async () => { throw new Error('offline') }) } as never, dialogs })

    await expect(groups.setMute(1, true)).rejects.toThrow()

    expect(ops).toEqual([])
    expect(dialogs.getSnapshot().find((i) => i.dialog.chatId === 1)!.dialog.muted).toBe(false)
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
    const groups = newGroupsManager({ rest: { post: vi.fn(async () => { await posted }) } as never, dialogs })

    const call = groups.setMute(1, true)
    expect(ops).toEqual([]) // ответ сети ещё не пришёл — кэш и зеркало не тронуты
    resolvePost()
    await call

    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'patch', chatId: 1, fields: { muted: true } })
    expect(dialogs.getSnapshot().find((i) => i.dialog.chatId === 1)!.dialog.muted).toBe(true)
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

  it('applyMute патчит поле muted', async () => {
    const { mgr, ops } = setup([dialog(1, '2026-08-01T00:00:00Z')])
    await mgr.fillMirror()
    ops.length = 0

    mgr.applyMute(1, true)

    expect(ops).toEqual([{ op: 'patch', chatId: 1, fields: { muted: true } }])
    expect(mgr.getSnapshot().find((i) => i.dialog.chatId === 1)!.dialog.muted).toBe(true)
  })

  it('applyArchived архивирует и сбрасывает пин (как на бэке)', async () => {
    const { mgr, ops } = setup([dialog(1, '2026-08-01T00:00:00Z', true)])
    await mgr.fillMirror()
    expect(mgr.getSnapshot()[0].dialog.pinned).toBe(true)
    ops.length = 0

    mgr.applyArchived(1, true)

    // Диалог был закреплён — сброс pinned выкидывает его из «закреплённого»
    // блока индекса в обычный (по дате активности), поэтому index в патче
    // ТОЖЕ участвует (moved=true внутри patchDialog) — сверяем fields отдельно.
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'patch', chatId: 1, fields: { archived: true, pinned: false } })
    const d = mgr.getSnapshot().find((i) => i.dialog.chatId === 1)!.dialog
    expect(d.archived).toBe(true)
    expect(d.pinned).toBe(false)
  })

  it('applyTheme ставит themeId; пустая строка сбрасывает к дефолту (undefined)', async () => {
    const { mgr, ops } = setup([dialog(1, '2026-08-01T00:00:00Z')])
    await mgr.fillMirror()
    ops.length = 0

    mgr.applyTheme(1, 'sunset')
    expect((ops[0] as Extract<DialogOp, { op: 'patch' }>).fields.themeId).toBe('sunset')

    ops.length = 0
    mgr.applyTheme(1, '')
    expect((ops[0] as Extract<DialogOp, { op: 'patch' }>).fields.themeId).toBeUndefined()
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

    expect(mgr.getSnapshot().map((i) => i.dialog.chatId)).toEqual([1, 3, 2])
    expect(mgr.getSnapshot().find((i) => i.dialog.chatId === 1)!.dialog.pinned).toBe(true)
    expect(saved[saved.length - 1]).toEqual({ 0: [1] })
    expect(mirrored[mirrored.length - 1]).toEqual({ key: 'pinnedOrders', value: { 0: [1] } })
    expect(ops.some((o) => o.op === 'patch' && o.chatId === 1 && o.fields.pinned === true)).toBe(true)

    ops.length = 0
    mgr.applyPinned(2, true) // второй пин встаёт ПЕРВЫМ (unshift)
    expect(mgr.getSnapshot().map((i) => i.dialog.chatId)).toEqual([2, 1, 3])
    expect(saved[saved.length - 1]).toEqual({ 0: [2, 1] })
  })

  it('applyPinned(false): анпин выпадает из порядка и возвращается к дате активности', async () => {
    const { mgr, saved } = setup(
      [dialog(1, '2026-08-09T10:00:00Z', true), dialog(2, '2026-08-09T12:00:00Z')],
      { 0: [1] },
    )
    await mgr.fillMirror()
    expect(mgr.getSnapshot().map((i) => i.dialog.chatId)).toEqual([1, 2])

    mgr.applyPinned(1, false)

    expect(mgr.getSnapshot().map((i) => i.dialog.chatId)).toEqual([2, 1])
    expect(mgr.getSnapshot().find((i) => i.dialog.chatId === 1)!.dialog.pinned).toBe(false)
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
    expect(mgr.getSnapshot().map((i) => i.dialog.chatId)).toEqual([2, 1, 3])
    ops.length = 0
    saved.length = 0
    mirrored.length = 0

    mgr.applyPinned(1, true) // запоздавшее собственное WS-эхо ПЕРВОГО действия (dialog_pin)

    expect(mgr.getSnapshot().map((i) => i.dialog.chatId)).toEqual([2, 1, 3]) // порядок не меняется
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
