// useMessageActions.toggleReaction — проводка «эффект вокруг чипа реакции»
// (см. ReactionAroundEffect.tsx, MessageReactions.tsx): единственный писатель
// reactionEffectStore — эта строка (`useMessageActions.tsx`, ветка `action
// === 'add'`). По норме тестов (web-client/CLAUDE.md «Тесты»: «если удаление
// строки не красит ни одного теста, а приложение при этом ломается — строка
// нарушает норму») эта проводка обязана иметь тест, который краснеет на её
// удалении — раньше не имела ни одного (ревью R6, Important 2).
import type { ReactNode } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMessageActions } from './useMessageActions'
import { ManagersProvider } from './useManagers'
import { useReactionEffectStore } from '../../stores/reactionEffectStore'
import type { Chat, ConvMsg } from '../../data'
import type { MessageWindow } from './useMessageWindow'
import type { MyMessage } from '../models'
import { makeMessage } from '../messages/testMessage'

function wrapper(managers: unknown) {
  return ({ children }: { children: ReactNode }) => (
    <ManagersProvider managers={managers as never}>{children}</ManagersProvider>
  )
}

function mockManagers() {
  return {
    messages: {
      react: vi.fn().mockResolvedValue(undefined),
      unreact: vi.fn().mockResolvedValue(undefined),
    },
  }
}

const chat: Chat = { id: '1', name: 'Test', avatar: '', date: '', preview: '', type: 'private' }

function rawMsg(over: Partial<MyMessage> = {}): MyMessage {
  return { ...makeMessage({ id: 5, peerId: 1, fromId: 2, text: 'hi' }), reactions: [], ...over } as MyMessage
}

function makeWin(msgs: MyMessage[]): MessageWindow {
  return {
    msgs, reachedTop: true, reachedBottom: true, loadingOlder: false, loadingNewer: false,
    loading: false, loadedFromCache: true,
    loadOlder: async () => {}, loadNewer: async () => {},
    appendLocal: () => {}, applyIncoming: () => {}, applyEdit: () => {},
    jumpTo: async () => {}, reloadNewest: async () => {}, applyDelete: () => {},
  }
}

function convMsg(over: Partial<ConvMsg> = {}): ConvMsg {
  return { id: 5, type: 'text', text: 'hi', at: '', out: false, ...over } as ConvMsg
}

function renderActions(win: MessageWindow, managers: ReturnType<typeof mockManagers>) {
  return renderHook(
    () =>
      useMessageActions({
        chat, numericChatId: 1, isRealChat: true,
        win, msgs: [convMsg()], meId: 10, pins: [], accent: '#000',
        setReply: () => {}, setEditing: () => {}, setSelectionMode: () => {},
        setSelected: () => {}, clearSelection: () => {},
      }),
    { wrapper: wrapper(managers) },
  )
}

describe('useMessageActions.toggleReaction → reactionEffectStore', () => {
  beforeEach(() => {
    // Стор модульный (переживает тесты) — без сброса прошлый прогон протекает в этот.
    useReactionEffectStore.setState({ active: new Set() })
  })

  it('пользователь ставит свою реакцию — триггерит эффект (add)', () => {
    const managers = mockManagers()
    const { result } = renderActions(makeWin([rawMsg({ reactions: [] })]), managers)

    act(() => result.current.toggleReaction(5, '❤'))

    expect(useReactionEffectStore.getState().active.has('5:❤')).toBe(true)
    expect(managers.messages.react).toHaveBeenCalledWith(1, 5, '❤')
  })

  it('пользователь снимает свою реакцию — эффект НЕ триггерится (remove)', () => {
    const managers = mockManagers()
    const { result } = renderActions(
      makeWin([rawMsg({ reactions: [{ emoji: '❤', count: 1, mine: true }] })]),
      managers,
    )

    act(() => result.current.toggleReaction(5, '❤'))

    expect(useReactionEffectStore.getState().active.has('5:❤')).toBe(false)
    expect(managers.messages.unreact).toHaveBeenCalledWith(1, 5, '❤')
  })

  it('реакция на другое сообщение/эмодзи не отмечается — ключ строго msgId:emoji', () => {
    const managers = mockManagers()
    const { result } = renderActions(makeWin([rawMsg({ reactions: [] })]), managers)

    act(() => result.current.toggleReaction(5, '❤'))

    const active = useReactionEffectStore.getState().active
    expect(active.has('5:👍')).toBe(false)
    expect(active.has('6:❤')).toBe(false)
  })
})
