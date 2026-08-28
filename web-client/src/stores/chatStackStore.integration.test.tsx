import { beforeEach, describe, expect, it } from 'vitest'
import { useChatStackStore, selectOpenThreadDesc } from './chatStackStore'
import { useNavigationStore } from './navigationStore'

const thread = { rootMsgId: 7, title: 'Comments', kind: 'comments' as const }

beforeEach(() => {
  useChatStackStore.setState({ stack: [] }, false)
  useNavigationStore.setState({ selectedId: null, draftPeer: null }, false)
})

describe('навигация колонки чата идёт через стек', () => {
  it('выбор чата из списка кладёт корневой инстанс', () => {
    useNavigationStore.getState().selectChat('42')

    // `id` — личность инстанса, её выдаёт незануляемый счётчик, поэтому
    // сверяем содержимое инстанса, а не номер по порядку.
    const { stack } = useChatStackStore.getState()
    expect(stack).toHaveLength(1)
    expect(stack[0]).toMatchObject({ peerId: 42, threadId: undefined, type: 'chat' })
    expect(typeof stack[0].id).toBe('number')
  })

  it('выбор другого чата схлопывает открытый тред', () => {
    useNavigationStore.getState().selectChat('42')
    useChatStackStore.getState().setInnerPeer({ peerId: 100, threadId: 7, type: 'discussion', thread })

    useNavigationStore.getState().selectChat('43')

    expect(useChatStackStore.getState().stack.map((d) => d.peerId)).toEqual([43])
    expect(selectOpenThreadDesc(useChatStackStore.getState())).toBeUndefined()
  })

  it('selectChat(null) очищает стек', () => {
    useNavigationStore.getState().selectChat('42')
    useNavigationStore.getState().selectChat(null)
    expect(useChatStackStore.getState().stack).toEqual([])
  })
})
