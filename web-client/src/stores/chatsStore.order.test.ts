// Ссылочная стабильность зеркала списка диалогов.
//
// Инвариант — web-client/CLAUDE.md, «Применять ответ сети полной подменой
// коллекции»: сводим через `core/store/reconcile`, и СОВПАВШИЙ с памятью ответ
// не даёт ни перерисовки, ни записи в IDB (порт tweb `saveDialogFilter`). Файл
// с этим именем существовал до переноса владения (пин «кэш и сеть с одинаковыми
// данными дают одинаковый список по ССЫЛКЕ» жил в нём при `setDialogs`/
// `applyDialogs`), был снесён вместе с легаси-путём — и инвариант остался без
// красного теста в обеих половинах. Здесь он возвращён для ЗЕРКАЛА: владельца
// держит `core/managers/dialogsManager.test.ts` (describe «совпавший ответ не
// даёт ни операции, ни записи на диск»), сценарии порядка (даты/пины/черновики)
// живут там же — сюда они не возвращаются, порядок main больше не считает
// (stores/noManualOrder.test.ts).
//
// Почему это ловится только так: `sortDialogsByIndex` аллоцирует ВСЕГДА
// (`[...dialogs].sort(...)`), поэтому даже полностью совпавший `reset` отдавал
// новую ссылку на массив — а на неё подписан весь список (`ChatList`), то есть
// каждый `refresh()` перерисовывал все строки.
import { beforeEach, describe, expect, it } from 'vitest'
import { useChatsStore } from './chatsStore'
import type { Dialog } from '../core/models'
import type { DialogOp } from '../core/dialogs/dialogOps'

const dlg = (chatId: number, at: string, over: Partial<Dialog> = {}): Dialog => ({
  chatId,
  type: 'private',
  title: 't' + chatId,
  lastReadSeq: 0,
  peerReadSeq: 0,
  unread: 0,
  unreadMentions: 0,
  unreadReactions: 0,
  muted: false,
  pinned: false,
  archived: false,
  lastMessage: { seq: 1, text: 'x', senderId: 5, at },
  ...over,
} as Dialog)

/** Ровно то, что публикует владелец: значения + готовый индекс. */
const reset = (items: { dialog: Dialog; index: number }[]): DialogOp => ({ op: 'reset', items })

const apply = (op: DialogOp) => useChatsStore.getState().applyDialogOps([op])

beforeEach(() => {
  useChatsStore.setState({ dialogs: [], dialogIndexById: {}, loaded: false })
})

describe('chatsStore (зеркало): совпавший reset не пересоздаёт список', () => {
  it('кэш и сеть с одинаковыми данными дают одинаковый список по ССЫЛКЕ', () => {
    apply(reset([
      { dialog: dlg(1, '2026-08-09T10:00:00Z'), index: 10 },
      { dialog: dlg(2, '2026-08-09T12:00:00Z'), index: 20 },
    ]))
    const before = useChatsStore.getState().dialogs
    const indexBefore = useChatsStore.getState().dialogIndexById

    // Ответ сети: те же данные (другие ОБЪЕКТЫ — они приехали из воркера
    // структурным клоном), тот же порядок.
    apply(reset([
      { dialog: dlg(1, '2026-08-09T10:00:00Z'), index: 10 },
      { dialog: dlg(2, '2026-08-09T12:00:00Z'), index: 20 },
    ]))

    expect(useChatsStore.getState().dialogs).toBe(before)
    expect(useChatsStore.getState().dialogIndexById).toBe(indexBefore)
  })

  it('те же данные, пришедшие в другом порядке массива, — тоже прежняя ссылка (порядок задаёт индекс)', () => {
    apply(reset([
      { dialog: dlg(1, '2026-08-09T10:00:00Z'), index: 10 },
      { dialog: dlg(2, '2026-08-09T12:00:00Z'), index: 20 },
    ]))
    const before = useChatsStore.getState().dialogs
    expect(before.map((d) => d.chatId)).toEqual([2, 1])

    apply(reset([
      { dialog: dlg(2, '2026-08-09T12:00:00Z'), index: 20 },
      { dialog: dlg(1, '2026-08-09T10:00:00Z'), index: 10 },
    ]))

    expect(useChatsStore.getState().dialogs).toBe(before)
  })

  it('реально изменившийся reset даёт НОВУЮ ссылку (сверка не «залипает» на первом списке)', () => {
    apply(reset([{ dialog: dlg(1, '2026-08-09T10:00:00Z'), index: 10 }]))
    const before = useChatsStore.getState().dialogs

    apply(reset([
      { dialog: dlg(1, '2026-08-09T10:00:00Z'), index: 10 },
      { dialog: dlg(2, '2026-08-09T12:00:00Z'), index: 20 },
    ]))

    expect(useChatsStore.getState().dialogs).not.toBe(before)
    expect(useChatsStore.getState().dialogs.map((d) => d.chatId)).toEqual([2, 1])
  })

  it('изменился только индекс (reindex) — ссылка на список новая, ссылки на диалоги прежние', () => {
    apply(reset([
      { dialog: dlg(1, '2026-08-09T10:00:00Z'), index: 10 },
      { dialog: dlg(2, '2026-08-09T12:00:00Z'), index: 20 },
    ]))
    const before = useChatsStore.getState().dialogs
    const dialog1 = before.find((d) => d.chatId === 1)!

    apply({ op: 'reindex', items: [{ chatId: 1, index: 30 }, { chatId: 2, index: 20 }] })

    const after = useChatsStore.getState().dialogs
    expect(after).not.toBe(before)
    expect(after.map((d) => d.chatId)).toEqual([1, 2])
    expect(after.find((d) => d.chatId === 1)).toBe(dialog1) // сами записи не пересозданы
  })
})
