// useMessageActions — действия с ЯВНЫМ адресом `(peerId, mid[s])`.
//
// Предмет теста — инвариант «один вопрос — один ответчик»: у ванильного меню
// сообщения (`components/chat/contextMenu.ts`, порт tweb `ChatContextMenu`)
// СВОЯ цель, `openMsgMenu` оно не зовёт, и второго набора действий у него нет —
// оно приходит в те же функции, что и пункты React-меню. Поэтому каждый случай
// ниже проверяется ДВАЖДЫ: прямой вызов с адресом (путь ванильного меню) и
// клик по пункту React-меню (путь `menuRawMsg()`), и оба обязаны привести к
// одному и тому же вызову владельца.
//
// Формы адресов — из порта: `PopupPinMessage(peerId, mid)` / `(…, true)`
// (contextMenu.ts:1994-2000), `PopupDeleteMessages(peerId, mids)` (:2056),
// `showMessageReport(peerId, mids)` (:1216-1220),
// `chat.input.initMessageEditing(mid)` (:1912).
import type { ReactNode } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMessageActions } from './useMessageActions'
import { ManagersProvider } from './useManagers'
import { useReportStore } from '../../stores/reportStore'
import type { Chat, ConvMsg } from '../../data'
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
    chats: { getReadDate: vi.fn().mockResolvedValue(null) },
  }
}

const chat: Chat = { id: String(CHAT), name: 'Test', avatar: '', date: '', preview: '', type: 'private' }

const rawMsg = (): MyMessage => makeMessage({ id: MID, peerId: CHAT, fromId: 2, text: 'hi' })
const convMsg = (): ConvMsg => ({ id: MID, type: 'text', text: 'hi', at: '', out: false }) as ConvMsg

/** Единственный источник сообщений слоя действий — ЗЕРКАЛО окна
 *  (`core/history/messagesMirror.ts`), тот же, из которого цель берёт ванильное
 *  меню. Стор сообщений сюда больше не участвует. */
function renderActions(managers: ReturnType<typeof mockManagers>, over: { pins?: { id?: number }[] } = {}) {
  putMirrorPage(winKey(CHAT), [rawMsg()])
  const rows = [convMsg()]
  const setEditing = vi.fn()
  const view = renderHook(
    () =>
      useMessageActions({
        chat, numericChatId: CHAT, isRealChat: true,
        isGroup: false, meId: 10, pins: over.pins ?? [], accent: '#000',
        setReply: () => {}, setEditing, setSelectionMode: () => {}, setSelected: () => {},
        clearSelection: () => {},
      }),
    { wrapper: wrapper(managers) },
  )
  return { ...view, rows, setEditing }
}

/** Открыть React-меню на единственном сообщении окна (ставит `msgMenu.mid`). */
function openMenu(view: ReturnType<typeof renderActions>) {
  act(() => {
    view.result.current.openMsgMenu(
      { preventDefault: () => {}, clientX: 0, clientY: 0 } as unknown as React.MouseEvent,
      view.rows[0],
    )
  })
}

/** Клик по пункту React-меню с этой подписью. */
function clickItem(view: ReturnType<typeof renderActions>, label: string) {
  const item = view.result.current.msgMenuItems.find((it) => it.label === label)
  expect(item, `пункт «${label}» не найден`).toBeTruthy()
  act(() => {
    item!.onClick?.({} as React.MouseEvent)
  })
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

  it('пункт React-меню «Pin» ведёт в ТУ ЖЕ функцию', () => {
    const managers = mockManagers()
    const view = renderActions(managers)
    openMenu(view)

    clickItem(view, 'Pin')

    expect(managers.messages.pin).toHaveBeenCalledWith(CHAT, MID)
  })

  it('у закреплённого пункт называется «Unpin» и снимает закрепление', () => {
    const managers = mockManagers()
    const view = renderActions(managers, { pins: [{ id: MID }] })
    openMenu(view)

    clickItem(view, 'Unpin')

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

  it('пункт React-меню «Delete» открывает тот же конфирм парой «пир + номера»', () => {
    const managers = mockManagers()
    const view = renderActions(managers)
    openMenu(view)

    clickItem(view, 'Delete')

    expect(view.result.current.delIds).toEqual({ peerId: CHAT, ids: [MID], canRevoke: true })
  })
})

describe('useMessageActions — жалоба (`openReportFor`)', () => {
  it('прямой вызов адресует попап парой «пир + номер»', () => {
    const view = renderActions(mockManagers())

    act(() => view.result.current.openReportFor(CHAT, [MID]))

    expect(useReportStore.getState().target).toEqual({ peerId: CHAT, msgId: MID })
  })

  it('пункт React-меню «Report» ведёт в ТУ ЖЕ функцию', () => {
    const view = renderActions(mockManagers())
    openMenu(view)

    clickItem(view, 'Report')

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
