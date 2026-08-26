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
import type { Chat } from '../../data'
import type { MyMessage } from '../models'
import { makeMessage } from '../messages/testMessage'
import { putMirrorPage, resetMessagesMirror, winKey } from '../history/messagesMirror'

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

// Окно приходит из ЗЕРКАЛА (`core/history/messagesMirror.ts`) — единственного
// источника сообщений слоя действий.
function renderActions(msgs: MyMessage[], managers: ReturnType<typeof mockManagers>) {
  putMirrorPage(winKey(1), msgs)
  return renderHook(
    () =>
      useMessageActions({
        chat, numericChatId: 1, isRealChat: true,
        isGroup: false, meId: 10, pins: [], accent: '#000',
        setReply: () => {}, setEditing: () => {}, setSelectionMode: () => {},
        setSelected: () => {}, clearSelection: () => {},
      }),
    { wrapper: wrapper(managers) },
  )
}

describe('useMessageActions.toggleReaction → reactionEffectStore', () => {
  beforeEach(() => {
    // Стор и зеркало модульные (переживают тесты) — без сброса прошлый прогон
    // протекает в этот.
    useReactionEffectStore.setState({ active: new Set() })
    resetMessagesMirror()
  })

  it('пользователь ставит свою реакцию — триггерит эффект (add)', () => {
    const managers = mockManagers()
    const { result } = renderActions([rawMsg({ reactions: { _: 'messageReactions', results: [] } })], managers)

    act(() => result.current.toggleReaction(5, '❤'))

    expect(useReactionEffectStore.getState().active.has('5:❤')).toBe(true)
    expect(managers.messages.react).toHaveBeenCalledWith(1, 5, '❤')
  })

  it('пользователь снимает свою реакцию — эффект НЕ триггерится (remove)', () => {
    const managers = mockManagers()
    const { result } = renderActions(
      [rawMsg({ reactions: {
        _: 'messageReactions',
        // «Моя» — наличие chosen_order, а не булев флаг рядом.
        results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '❤' }, count: 1, chosen_order: 0 }],
      } })],
      managers,
    )

    act(() => result.current.toggleReaction(5, '❤'))

    expect(useReactionEffectStore.getState().active.has('5:❤')).toBe(false)
    expect(managers.messages.unreact).toHaveBeenCalledWith(1, 5, '❤')
  })

  it('реакция на другое сообщение/эмодзи не отмечается — ключ строго msgId:emoji', () => {
    const managers = mockManagers()
    const { result } = renderActions([rawMsg({ reactions: { _: 'messageReactions', results: [] } })], managers)

    act(() => result.current.toggleReaction(5, '❤'))

    const active = useReactionEffectStore.getState().active
    expect(active.has('5:👍')).toBe(false)
    expect(active.has('6:❤')).toBe(false)
  })
})
