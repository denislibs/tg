// Порядок диалогов — производная от данных (core/dialogs/dialogIndex.ts, порт
// tweb generateDialogIndex). Здесь проверяется ЕДИНСТВЕННЫЙ путь применения
// (applyDialogs): из одних и тех же данных всегда получается один и тот же
// список, независимо от того, порядок какого источника (персист/сеть/апдейт)
// пришёл первым.
import { beforeEach, describe, expect, it } from 'vitest'
import { useChatsStore } from './chatsStore'
import { useAppStateStore, setAppState } from './appState'
import { ALL_FOLDER_ID } from './foldersStore'
import { initialState } from '../core/state/state'
import type { Dialog, Draft } from '../core/models'

const dlg = (chatId: number, at: string, over: Partial<Dialog> = {}): Dialog => ({
  chatId,
  type: 'private',
  lastReadSeq: 0,
  peerReadSeq: 0,
  unread: 0,
  muted: false,
  pinned: false,
  archived: false,
  lastMessage: { seq: 1, text: 'x', senderId: 5, at },
  ...over,
})

const draft = (chatId: number, updatedAt: string): Draft => ({ chatId, text: 'чер', replyToId: null, updatedAt })

const ids = (): number[] => useChatsStore.getState().dialogs.map((d) => d.chatId)
const pinnedOrder = (): number[] => useAppStateStore.getState().pinnedOrders[ALL_FOLDER_ID] ?? []

beforeEach(() => {
  useChatsStore.setState({ dialogs: [], loaded: false, meId: 7, activeChatId: null, typing: {} })
  useAppStateStore.setState(initialState())
})

describe('chatsStore: порядок производный', () => {
  it('порядок не зависит от порядка входного массива', () => {
    useChatsStore.getState().setDialogs([
      dlg(1, '2026-08-09T10:00:00Z'),
      dlg(2, '2026-08-09T12:00:00Z'),
      dlg(3, '2026-08-09T11:00:00Z'),
    ])
    const first = ids()

    useChatsStore.getState().setDialogs([
      dlg(3, '2026-08-09T11:00:00Z'),
      dlg(1, '2026-08-09T10:00:00Z'),
      dlg(2, '2026-08-09T12:00:00Z'),
    ])

    expect(ids()).toEqual(first)
    expect(ids()).toEqual([2, 3, 1])
  })

  it('кэш и сеть с одинаковыми данными дают одинаковый список по ССЫЛКЕ', () => {
    useChatsStore.getState().setDialogs([dlg(1, '2026-08-09T10:00:00Z'), dlg(2, '2026-08-09T12:00:00Z')])
    const before = useChatsStore.getState().dialogs

    // тот же набор, но в порядке ответа сети — список не должен пересоздаться
    useChatsStore.getState().setDialogs([dlg(2, '2026-08-09T12:00:00Z'), dlg(1, '2026-08-09T10:00:00Z')])

    expect(useChatsStore.getState().dialogs).toBe(before)
  })

  it('закреплённые сверху независимо от даты', () => {
    useChatsStore.getState().setDialogs([
      dlg(1, '2026-08-09T12:00:00Z'),
      dlg(2, '2020-01-01T00:00:00Z', { pinned: true }),
    ])

    expect(ids()).toEqual([2, 1])
  })

  it('повторное применение списка со свежей датой поднимает диалог', () => {
    useChatsStore.getState().setDialogs([dlg(1, '2026-08-09T10:00:00Z'), dlg(2, '2026-08-09T12:00:00Z')])

    // тот же путь, что у ответа сети: список применяется целиком
    useChatsStore.getState().setDialogs([dlg(1, '2026-08-09T13:00:00Z'), dlg(2, '2026-08-09T12:00:00Z')])

    expect(ids()).toEqual([1, 2])
  })

  // Task 3 (перенос владения диалогами): applyNewMessage отсюда убран — тело
  // переехало в dialogsManager, «поднимает датой» и «закреплённые не мешаются»
  // перепроверены там же (dialogsManager.test.ts, describe «realtime-кадры
  // применяет владелец»), с той же чистой dialogIndex().
})

describe('chatsStore: черновик поднимает диалог', () => {
  it('свежий черновик перевешивает более старое последнее сообщение', () => {
    setAppState('drafts', [draft(1, '2026-08-09T13:00:00Z')])

    useChatsStore.getState().setDialogs([dlg(1, '2026-08-09T10:00:00Z'), dlg(2, '2026-08-09T12:00:00Z')])

    expect(ids()).toEqual([1, 2])
  })

  it('без черновика тот же набор даёт обратный порядок (черновик реально участвует)', () => {
    useChatsStore.getState().setDialogs([dlg(1, '2026-08-09T10:00:00Z'), dlg(2, '2026-08-09T12:00:00Z')])

    expect(ids()).toEqual([2, 1])
  })

  it('старый черновик диалог не поднимает', () => {
    setAppState('drafts', [draft(1, '2026-08-09T09:00:00Z')])

    useChatsStore.getState().setDialogs([dlg(1, '2026-08-09T10:00:00Z'), dlg(2, '2026-08-09T12:00:00Z')])

    expect(ids()).toEqual([2, 1])
  })
})

// Task 4 (действия без оптимистики): setDialogPinned/setDialogArchived (мутаторы
// chatsStore) убраны — тела переехали во владельца (dialogsManager.applyPinned/
// applyArchived), тесты на «свежий пин встаёт первым»/«анпин убирает из
// порядка»/«архивация снимает пин» — тоже туда (dialogsManager.test.ts, describe
// «действия без оптимистики»). Здесь остаётся только то, что по-прежнему живёт в
// applyDialogs/syncPinnedOrder (Task 6, ещё не тронуто): первичное засеивание
// pinnedOrders из ответа сети и переживание повторного применения списка.
describe('chatsStore: pinnedOrders засеивается из applyDialogs/setDialogs', () => {
  it('порядок закреплённых переживает повторное применение списка (кэш ↔ сеть)', () => {
    useChatsStore.getState().setDialogs([
      dlg(1, '2026-08-09T10:00:00Z', { pinned: true }),
      dlg(2, '2026-08-09T11:00:00Z', { pinned: true }),
      dlg(3, '2026-08-09T12:00:00Z'),
    ])
    const before = ids()

    // ответ сети: тот же набор, закреплённые пришли в другом порядке ответа
    useChatsStore.getState().setDialogs([
      dlg(2, '2026-08-09T11:00:00Z', { pinned: true }),
      dlg(1, '2026-08-09T10:00:00Z', { pinned: true }),
      dlg(3, '2026-08-09T12:00:00Z'),
    ])

    expect(ids()).toEqual(before)
  })

  // Порядок закреплённых сервер отдаёт только позицией в ответе /chats
  // (ORDER BY m.pinned_at DESC, chatsrepo.go:225) — в модели `Dialog` его нет.
  // Первый применённый список фиксирует его в State, дальше он авторитетен.
  it('первый список засеивает pinnedOrders порядком ответа сервера', () => {
    useChatsStore.getState().setDialogs([
      dlg(2, '2020-01-01T00:00:00Z', { pinned: true }),
      dlg(1, '2026-08-09T12:00:00Z', { pinned: true }),
      dlg(3, '2026-08-09T13:00:00Z'),
    ])

    expect(pinnedOrder()).toEqual([2, 1])
    expect(ids()).toEqual([2, 1, 3])
  })
})
