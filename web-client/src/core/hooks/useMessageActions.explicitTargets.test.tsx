// useMessageActions — действия с ЯВНЫМ адресом `(peerId, mid[s])`.
//
// Предмет теста — форма адреса. У ванильного меню сообщения
// (`components/chat/contextMenu.ts`, порт tweb `ChatContextMenu`) СВОЯ цель, и
// наружу оно отдаёт её ровно так же, как оригинал: `PopupPinMessage(peerId,
// mid)` / `(…, true)` (contextMenu.ts:1994-2000), `PopupDeleteMessages(peerId,
// mids)` (:2056), `showMessageReport(peerId, mids)` (:1216-1220),
// `chat.input.initMessageEditing(mid)` (:1912). Проверяется, что действие
// адресует ЗАПОМНЕННЫЙ пир, а не «открытый чат», и что по одному номеру оно
// само достаёт сообщение из зеркала окна.
//
// Прежде каждый случай проверялся ДВАЖДЫ — прямым вызовом и кликом по пункту
// React-меню того же хука. Второго меню больше нет: оно жило на React-ленте и
// снесено вместе с ней (этап 7), у клиента остался один набор пунктов.
import type { ReactNode } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMessageActions } from './useMessageActions'
import { ManagersProvider } from './useManagers'
import { useReportStore } from '../../stores/reportStore'
import type { Chat } from '../../data'
import type { MyMessage } from '../models'
import { makeMessage } from '../messages/testMessage'
import { putMirrorPage, resetMessagesMirror, winKey } from '../history/messagesMirror'

const CHAT = 1
const MID = 5

function wrapper(managers: unknown) {
  return ({ children }: { children: ReactNode }) => (
    <ManagersProvider managers={managers as never}>{children}</ManagersProvider>
  )
}

function mockManagers() {
  return {
    messages: {
      pin: vi.fn().mockResolvedValue(undefined),
      unpin: vi.fn().mockResolvedValue(undefined),
      deleteMessage: vi.fn().mockResolvedValue(undefined),
    },
  }
}

const chat: Chat = { id: String(CHAT), name: 'Test', avatar: '', preview: '', type: 'private' }

const rawMsg = (): MyMessage => makeMessage({ id: MID, peerId: CHAT, fromId: 2, text: 'hi' })

/** Единственный источник сообщений слоя действий — ЗЕРКАЛО окна
 *  (`core/history/messagesMirror.ts`), тот же, из которого цель берёт ванильное
 *  меню. Стор сообщений сюда больше не участвует. */
function renderActions(managers: ReturnType<typeof mockManagers>) {
  putMirrorPage(winKey(CHAT), [rawMsg()])
  const setEditing = vi.fn()
  const view = renderHook(
    () =>
      useMessageActions({
        chat, numericChatId: CHAT, isRealChat: true, meId: 10,
        setReply: () => {}, setEditing, clearSelection: () => {},
      }),
    { wrapper: wrapper(managers) },
  )
  return { ...view, setEditing }
}

beforeEach(() => {
  useReportStore.getState().close()
  // Зеркало модульное (переживает тесты) — без сброса прошлый прогон протекает в этот.
  resetMessagesMirror()
})

describe('useMessageActions — закрепление (`pinMessage`)', () => {
  it('прямой вызов с парой «пир + номер» закрепляет и открепляет', () => {
    const managers = mockManagers()
    const view = renderActions(managers)

    act(() => view.result.current.pinMessage(CHAT, MID))
    expect(managers.messages.pin).toHaveBeenCalledWith(CHAT, MID)

    act(() => view.result.current.pinMessage(CHAT, MID, true))
    expect(managers.messages.unpin).toHaveBeenCalledWith(CHAT, MID)
  })
})

describe('useMessageActions — удаление (`openDeleteFor`)', () => {
  it('удаляет по ЗАПОМНЕННОМУ пиру, а не по открытому чату', () => {
    const managers = mockManagers()
    const view = renderActions(managers)

    act(() => view.result.current.openDeleteFor(CHAT, [MID]))
    expect(view.result.current.delIds).toEqual({ peerId: CHAT, ids: [MID], canRevoke: true })

    act(() => view.result.current.doDelete(true))
    expect(managers.messages.deleteMessage).toHaveBeenCalledWith(CHAT, MID, true)
  })
})

describe('useMessageActions — жалоба (`openReportFor`)', () => {
  it('прямой вызов адресует попап парой «пир + номер»', () => {
    const view = renderActions(mockManagers())

    act(() => view.result.current.openReportFor(CHAT, [MID]))

    expect(useReportStore.getState().target).toEqual({ peerId: CHAT, msgId: MID })
  })
})

describe('useMessageActions — правка (`startEditFor`)', () => {
  // Порт `initMessageEditing(mid)` отдаёт ТОЛЬКО номер — текст и сущности
  // действие достаёт из окна само.
  it('по одному номеру собирает черновик правки из окна', () => {
    const view = renderActions(mockManagers())

    act(() => view.result.current.startEditFor(MID))

    expect(view.setEditing).toHaveBeenCalledWith({ msgId: MID, text: 'hi', entities: undefined })
  })

  it('чужой номер черновик не ставит', () => {
    const view = renderActions(mockManagers())

    act(() => view.result.current.startEditFor(MID + 100))

    expect(view.setEditing).not.toHaveBeenCalled()
  })
})

// «Кто отреагировал / просмотрел» — ОДИН список. У оригинала оба списка отдаёт
// один ответ `getMessageReactionsListAndReadParticipants`
// (tweb `lib/appManagers/appMessagesManager.ts:9037-9088`), и из него же
// кормится единственный `PopupReactedList` (`popups/reactedList.ts:221-224`).
// Прежде здесь спрашивались только реакции, поэтому клик по «Seen by N»
// открывал пустой попап.
describe('useMessageActions — общий список «отреагировал / просмотрел»', () => {
  const REACTED = { _: 'user' as const, id: 7, first_name: 'Аня' }
  const VIEWER = { _: 'user' as const, id: 8, first_name: 'Боря' }

  function listManagers(over: Partial<{ reactionUsers: unknown; viewers: unknown }> = {}) {
    return {
      messages: {
        ...mockManagers().messages,
        reactionUsers: vi.fn().mockResolvedValue([{ user: REACTED, emoji: '👍' }]),
        viewers: vi.fn().mockResolvedValue([REACTED.id, VIEWER.id]),
        ...over,
      },
      // Карточки просмотревших едут из воркера по ключам — ручка отдаёт
      // только их (вектор `readParticipantDate`, tweb :9089-9098).
      peers: { getUsers: vi.fn(async (ids: number[]) => [REACTED, VIEWER].filter((u) => ids.includes(u.id))) },
    }
  }

  it('сливает реагировавших и просмотревших: реакции первыми, у просмотревшего эмодзи нет', async () => {
    const managers = listManagers()
    const view = renderActions(managers as never)

    await act(async () => { await view.result.current.showReactedUsers(MID, 0, 0) })

    // Порядок tweb :9065-9078 — реакции, следом просмотревшие.
    expect(view.result.current.reacted?.rows).toEqual([
      { name: 'Аня', photoId: undefined, emoji: '👍' },
      { name: 'Боря', photoId: undefined },
    ])
    // Просмотревший, который УЖЕ отреагировал, вычеркнут (tweb :9058-9063):
    // за карточками ушёл ТОЛЬКО оставшийся.
    expect(managers.peers.getUsers).toHaveBeenCalledWith([VIEWER.id])
  })

  it('оба запроса уходят даже когда реакций нет — иначе «Seen by N» открывает пустое', async () => {
    const managers = listManagers({ reactionUsers: vi.fn().mockResolvedValue([]) })
    const view = renderActions(managers as never)

    await act(async () => { await view.result.current.showReactedUsers(MID, 0, 0) })

    expect(managers.messages.viewers).toHaveBeenCalledWith(CHAT, MID)
    expect(view.result.current.reacted?.rows).toEqual([
      { name: 'Аня', photoId: undefined },
      { name: 'Боря', photoId: undefined },
    ])
  })

  // tweb :9053-9057: список просмотревших идёт с `.catch(() => [])` — упавшая
  // ручка не должна ронять весь попап.
  it('упавший список просмотревших оставляет реакции', async () => {
    const managers = listManagers({ viewers: vi.fn().mockRejectedValue(new Error('403')) })
    const view = renderActions(managers as never)

    await act(async () => { await view.result.current.showReactedUsers(MID, 0, 0) })

    expect(view.result.current.reacted?.rows).toEqual([{ name: 'Аня', photoId: undefined, emoji: '👍' }])
  })
})

// Гейт «а вправе ли зритель видеть, КТО поставил реакцию». У оригинала это терм
// `canViewList` — `!!message.reactions?.pFlags.can_see_list ||
// message.peerId.isUser()` (tweb `components/chat/reactionContextMenu.ts:95`), и
// он гейтит сам вызов `getMessageReactionsList` (:99-106
// `canViewList ? … : undefined`). Тот же терм слово в слово стоит в
// `contextMenu.ts:404-407` и `reactions.ts:305-306`; у нас он посчитан ОДИН раз
// (`canViewReactionsList`, `core/reactions/messageReactions.ts`).
//
// Ручка `/reactions/users` теперь отказывает там, где права нет (403), поэтому
// безусловный вызов не «лишний запрос», а сломанный попап.
describe('useMessageActions — гейт списка реагировавших (`canViewList`)', () => {
  const REACTED = { _: 'user' as const, id: 7, first_name: 'Аня' }
  const CHANNEL: PeerId = -100

  function renderFor(peerId: PeerId, reactions?: MyMessage['reactions']) {
    const managers = {
      messages: {
        ...mockManagers().messages,
        reactionUsers: vi.fn().mockResolvedValue([{ user: REACTED, emoji: '👍' }]),
        viewers: vi.fn().mockResolvedValue([]),
      },
      peers: { getUsers: vi.fn().mockResolvedValue([]) },
    }
    putMirrorPage(winKey(peerId as unknown as number), [
      { ...makeMessage({ id: MID, peerId, fromId: 2, text: 'hi' }), ...(reactions ? { reactions } : {}) },
    ])
    const view = renderHook(
      () =>
        useMessageActions({
          chat, numericChatId: peerId as unknown as number, isRealChat: true, meId: 10,
          setReply: () => {}, setEditing: vi.fn(), clearSelection: () => {},
        }),
      { wrapper: wrapper(managers) },
    )
    return { managers, view }
  }

  const withFlag: MyMessage['reactions'] = {
    _: 'messageReactions',
    pFlags: { can_see_list: true },
    results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 1 }],
  }
  const noFlag: MyMessage['reactions'] = {
    _: 'messageReactions',
    results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 1 }],
  }

  it('вещательный канал без can_see_list — ручка НЕ зовётся, остаются просмотревшие', async () => {
    const { managers, view } = renderFor(CHANNEL, noFlag)

    await act(async () => { await view.result.current.showReactedUsers(MID, 0, 0) })

    expect(managers.messages.reactionUsers).not.toHaveBeenCalled()
    // Вторая половина того же списка правом на реакции не гейтится.
    expect(managers.messages.viewers).toHaveBeenCalledWith(CHANNEL, MID)
    expect(view.result.current.reacted?.rows).toEqual([])
  })

  it('группа с can_see_list — ручка зовётся', async () => {
    const { managers, view } = renderFor(CHANNEL, withFlag)

    await act(async () => { await view.result.current.showReactedUsers(MID, 0, 0) })

    expect(managers.messages.reactionUsers).toHaveBeenCalledWith(CHANNEL, MID)
    expect(view.result.current.reacted?.rows).toEqual([{ name: 'Аня', photoId: undefined, emoji: '👍' }])
  })

  // Второй терм условия: в личке флага не бывает вовсе, и отвечает на вопрос
  // клиент по ключу пира. Копия гейта, забывшая личку, молча отключила бы
  // список в личных чатах — ровно поэтому терм один на весь клиент.
  it('личка без can_see_list — ручка всё равно зовётся', async () => {
    const { managers, view } = renderFor(CHAT as unknown as PeerId, noFlag)

    await act(async () => { await view.result.current.showReactedUsers(MID, 0, 0) })

    expect(managers.messages.reactionUsers).toHaveBeenCalledWith(CHAT, MID)
  })
})
