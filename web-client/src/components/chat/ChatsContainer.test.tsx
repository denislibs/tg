import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

const runNavigationTransition = vi.fn()
vi.mock('../../core/dom/navigationTransition', () => ({
  NAVIGATION_TRANSITION_TIME: 250,
  runNavigationTransition: (...args: unknown[]) => runNavigationTransition(...args),
}))

import ChatsContainer from './ChatsContainer'
import { useChatStackStore, type ChatInstanceDesc } from '../../stores/chatStackStore'

const thread = { rootMsgId: 7, title: 'Comments', kind: 'comments' as const }
const renderInstance = (d: ChatInstanceDesc) => <div data-testid={`body-${d.key}`}>{d.type}</div>

beforeEach(() => {
  vi.useFakeTimers()
  runNavigationTransition.mockClear()
  useChatStackStore.setState({ stack: [] }, false)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ChatsContainer', () => {
  it('рендерит по узлу на дескриптор, активен только верхний', () => {
    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' })
    })
    const { container } = render(<ChatsContainer renderInstance={renderInstance} />)

    act(() => {
      useChatStackStore.getState().setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
    })

    const tabs = container.querySelectorAll('.chats-container > .chat')
    expect(tabs).toHaveLength(2)
    expect(tabs[0].getAttribute('data-type')).toBe('chat')
    expect(tabs[1].getAttribute('data-type')).toBe('discussion')
  })

  it('контейнер размечен как навигационный вкладочник tweb', () => {
    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' })
    })
    const { container } = render(<ChatsContainer renderInstance={renderInstance} />)

    const el = container.querySelector('.chats-container')
    expect(el?.classList.contains('tabs-container')).toBe(true)
    expect(el?.getAttribute('data-animation')).toBe('navigation')
  })

  it('push играет переход вперёд, pop — назад', () => {
    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' })
    })
    render(<ChatsContainer renderInstance={renderInstance} />)
    runNavigationTransition.mockClear()

    act(() => {
      useChatStackStore.getState().setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
    })
    expect(runNavigationTransition).toHaveBeenCalledTimes(1)
    expect(runNavigationTransition.mock.calls[0][0]).toMatchObject({ toRight: true })

    act(() => {
      useChatStackStore.getState().closeTop()
    })
    expect(runNavigationTransition).toHaveBeenCalledTimes(2)
    expect(runNavigationTransition.mock.calls[1][0]).toMatchObject({ toRight: false })
  })

  it('на pop через уровень промежуточный узел убирается сразу', () => {
    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' })
      useChatStackStore.getState().setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
      useChatStackStore.getState().setInnerPeer({ peerId: 3, type: 'chat' })
    })
    const { container } = render(<ChatsContainer renderInstance={renderInstance} />)

    act(() => {
      useChatStackStore.getState().popTo(0)
    })

    // остаются дно стека и уходящий верхний; средний (peerId 2) уходит сразу
    const keys = Array.from(container.querySelectorAll('.chats-container > .chat')).map((n) => n.getAttribute('data-type'))
    expect(keys).toHaveLength(2)
    expect(container.querySelector('[data-testid="body-2_7_discussion"]')).toBeNull()
  })

  it('на pop уходящий узел остаётся в DOM до конца перехода', () => {
    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' })
    })
    const { container } = render(<ChatsContainer renderInstance={renderInstance} />)
    act(() => {
      useChatStackStore.getState().setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
    })

    act(() => {
      useChatStackStore.getState().closeTop()
    })
    expect(container.querySelectorAll('.chats-container > .chat')).toHaveLength(2)

    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(container.querySelectorAll('.chats-container > .chat')).toHaveLength(1)
  })
})
