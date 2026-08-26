// useMessageActions — ЦЕЛЬ открытого меню адресуется НОМЕРОМ, а сообщение
// читается из зеркала окна (`core/history/messagesMirror.ts`).
//
// Предмет теста — ровно то, что ломал прежний адрес. Цель хранилась ИНДЕКСОМ
// ряда (`msgMenu.idx`) в параллельных массивах витрины и окна; индекс —
// свойство React-ленты (ряд существует потому, что лента рисует массив), и он
// сдвигается целиком, стоит окну вырасти СВЕРХУ: страница `loadOlder` встаёт
// перед уже загруженными сообщениями, каждое из них съезжает на N позиций, а
// открытое меню продолжает указывать на старую позицию — то есть на СОСЕДА.
// Номер сдвиг переживает, и тем же номером цель адресует ванильное меню
// (`components/chat/contextMenu.ts::getMessageByPeer`, порт tweb
// `chat.getMessageByPeer`) — второго набора действий у него нет.
import type { ReactNode } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMessageActions } from './useMessageActions'
import { ManagersProvider } from './useManagers'
import type { Chat, ConvMsg } from '../../data'
import type { MyMessage } from '../models'
import { makeMessage } from '../messages/testMessage'
import { putMirrorPage, resetMessagesMirror, winKey } from '../history/messagesMirror'
import { applyPeerOps, resetPeerMirror } from '../peerCache'
import { useSearchStore } from '../../stores/searchStore'

const CHAT = 1
const ME = 10
// Цель меню и её сосед СВЕРХУ, который приезжает позже (страница `loadOlder`).
const TARGET = 20
const OLDER = 10

function wrapper(managers: unknown) {
  return ({ children }: { children: ReactNode }) => (
    <ManagersProvider managers={managers as never}>{children}</ManagersProvider>
  )
}

function mockManagers() {
  return {
    messages: {
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      pin: vi.fn().mockResolvedValue(undefined),
      unpin: vi.fn().mockResolvedValue(undefined),
    },
    chats: { getReadDate: vi.fn().mockResolvedValue(null) },
  }
}

const chat: Chat = { id: String(CHAT), name: 'Test', avatar: '', date: '', preview: '', type: 'private' }

const incoming = (id: number, text: string): MyMessage =>
  makeMessage({ id, peerId: CHAT, fromId: 2, text })
const own = (id: number, text: string): MyMessage =>
  makeMessage({ id, peerId: CHAT, fromId: ME, text, out: true })

/** Вью-модельный ряд ленты: слой действий берёт из него ровно АДРЕС (`id`). */
const row = (id: number, text: string): ConvMsg =>
  ({ id, type: 'text', text, at: '', out: false }) as ConvMsg

function renderActions(page: MyMessage[]) {
  const managers = mockManagers()
  putMirrorPage(winKey(CHAT), page)
  const setReply = vi.fn()
  const setEditing = vi.fn()
  const view = renderHook(
    () =>
      useMessageActions({
        chat, numericChatId: CHAT, isRealChat: true,
        isGroup: false, meId: ME, pins: [], accent: '#000',
        setReply, setEditing, setSelectionMode: () => {}, setSelected: () => {},
        clearSelection: () => {},
      }),
    { wrapper: wrapper(managers) },
  )
  return { ...view, managers, setReply, setEditing }
}

type View = ReturnType<typeof renderActions>

function openMenu(view: View, m: ConvMsg) {
  act(() => {
    view.result.current.openMsgMenu(
      { preventDefault: () => {}, clientX: 0, clientY: 0 } as unknown as React.MouseEvent,
      m,
    )
  })
}

/** Страница истории СВЕРХУ (порт `loadOlder`): окно растёт в начало, все уже
 *  загруженные сообщения съезжают вниз на длину страницы. */
function prependOlderPage(msgs: MyMessage[]) {
  act(() => putMirrorPage(winKey(CHAT), msgs))
}

function clickItem(view: View, label: string) {
  const item = view.result.current.msgMenuItems.find((it) => it.label === label)
  expect(item, `пункт «${label}» не найден`).toBeTruthy()
  act(() => { item!.onClick?.({} as React.MouseEvent) })
}

beforeEach(() => {
  // Зеркала модульные (переживают тесты) — без сброса прошлый прогон протекает в этот.
  resetMessagesMirror()
  resetPeerMirror()
  useSearchStore.getState().clearPendingForward()
})

describe('useMessageActions — цель открытого меню переживает сдвиг окна', () => {
  it('«Удалить» после подгрузки страницы сверху удаляет ТО ЖЕ сообщение', () => {
    const view = renderActions([incoming(TARGET, 'цель')])
    openMenu(view, row(TARGET, 'цель'))

    // Пока меню открыто, окно выросло сверху: цель уехала с позиции 0 на 1.
    prependOlderPage([incoming(OLDER, 'сосед сверху')])
    expect(view.result.current.msgMenu?.mid).toBe(TARGET)

    clickItem(view, 'Delete')

    expect(view.result.current.delIds).toEqual({ peerId: CHAT, ids: [TARGET], canRevoke: true })
  })

  it('«Ответить» после сдвига собирает плашку ПО ЦЕЛИ, а не по соседу', () => {
    const view = renderActions([incoming(TARGET, 'цель')])
    openMenu(view, row(TARGET, 'цель'))

    prependOlderPage([incoming(OLDER, 'сосед сверху')])

    clickItem(view, 'Reply')

    expect(view.setReply).toHaveBeenCalledTimes(1)
    expect(view.setReply.mock.calls[0][0]).toMatchObject({ msgId: TARGET, text: 'цель' })
  })

  it('«Изменить» после сдвига правит ТЕКСТ ЦЕЛИ', () => {
    const view = renderActions([own(TARGET, 'моя цель')])
    openMenu(view, row(TARGET, 'моя цель'))

    prependOlderPage([own(OLDER, 'моё старое')])

    clickItem(view, 'Edit')

    expect(view.setEditing).toHaveBeenCalledWith({ msgId: TARGET, text: 'моя цель', entities: undefined })
  })

  it('состав пунктов считается по ЦЕЛИ: своё — «Изменить», чужое — «Пожаловаться»', () => {
    const view = renderActions([own(TARGET, 'моя цель'), incoming(TARGET + 1, 'чужая')])

    openMenu(view, row(TARGET, 'моя цель'))
    const mine = view.result.current.msgMenuItems.map((it) => it.label)
    expect(mine).toContain('Edit')
    expect(mine).not.toContain('Report')

    openMenu(view, row(TARGET + 1, 'чужая'))
    const theirs = view.result.current.msgMenuItems.map((it) => it.label)
    expect(theirs).not.toContain('Edit')
    expect(theirs).toContain('Report')
  })

  it('правка сообщения при открытом меню доезжает до пунктов — окно читается живым', () => {
    const view = renderActions([incoming(TARGET, 'до правки')])
    openMenu(view, row(TARGET, 'до правки'))

    // Тот же вход, что у операции `patch` проектора: сообщение в окне заменено.
    act(() => putMirrorPage(winKey(CHAT), [incoming(TARGET, 'после правки')]))

    clickItem(view, 'Reply')

    expect(view.setReply.mock.calls[0][0]).toMatchObject({ msgId: TARGET, text: 'после правки' })
  })
})

describe('useMessageActions — факты о цели берутся у сообщения, а не у ряда ленты', () => {
  // Read-date (tweb getOutboxReadDate, contextMenu.ts:1504-1541) спрашивают
  // только для СВОЕГО сообщения приватного чата, и адресуют его НОМЕРОМ цели.
  it('меню своего сообщения запрашивает дату прочтения по номеру ЦЕЛИ', () => {
    const view = renderActions([incoming(OLDER, 'чужое'), own(TARGET, 'моё')])

    openMenu(view, row(TARGET, 'моё'))

    expect(view.managers.chats.getReadDate).toHaveBeenCalledWith(CHAT, TARGET)
  })

  it('меню чужого сообщения дату прочтения не запрашивает', () => {
    const view = renderActions([incoming(TARGET, 'чужое')])

    openMenu(view, row(TARGET, 'чужое'))

    expect(view.managers.chats.getReadDate).not.toHaveBeenCalled()
  })

  // Превью плашки форварда — порт `initMessagesForward` (tweb input.ts:4471-4505):
  // отправитель берётся из КАРТОЧКИ пира, текст — из самого сообщения.
  it('превью форварда подписывается именем автора из карточки пира', async () => {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: 2, first_name: 'Алиса', pFlags: {} }] }])
    const view = renderActions([incoming(TARGET, 'привет')])

    act(() => view.result.current.openForwardFor(CHAT, [TARGET]))
    await act(async () => { await view.result.current.doForward([777]) })

    expect(useSearchStore.getState().pendingForward).toMatchObject({
      targetPeerId: 777, sourcePeerId: CHAT, msgIds: [TARGET], count: 1, text: 'Алиса: привет',
    })
  })

  it('превью форварда своего сообщения подписывается «You» (tweb Chat.Accessory.Forward.You)', async () => {
    const view = renderActions([own(TARGET, 'моё')])

    act(() => view.result.current.openForwardFor(CHAT, [TARGET]))
    await act(async () => { await view.result.current.doForward([777]) })

    expect(useSearchStore.getState().pendingForward).toMatchObject({ text: 'You: моё' })
  })
})
