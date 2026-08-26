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

const chat: Chat = { id: String(CHAT), name: 'Test', avatar: '', date: '', preview: '', type: 'private' }

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
