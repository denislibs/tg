import { beforeEach, describe, expect, it } from 'vitest'
import { useChatStackStore, selectOpenThread } from './chatStackStore'
import { useNavigationStore } from './navigationStore'

const thread = { rootMsgId: 7, title: 'Comments', kind: 'comments' as const }

beforeEach(() => {
  useChatStackStore.setState({ stack: [] }, false)
  useNavigationStore.setState({ selectedId: null, draftPeer: null }, false)
})

describe('навигация колонки чата идёт через стек', () => {
  it('выбор чата из списка кладёт корневой инстанс', () => {
    useNavigationStore.getState().selectChat('42')

    expect(useChatStackStore.getState().stack).toEqual([
      { key: '42_0_chat', peerId: 42, threadId: undefined, type: 'chat', query: undefined, thread: undefined },
    ])
  })

  it('выбор другого чата схлопывает открытый тред', () => {
    useNavigationStore.getState().selectChat('42')
    useChatStackStore.getState().setInnerPeer({ peerId: 100, threadId: 7, type: 'discussion', thread })

    useNavigationStore.getState().selectChat('43')

    expect(useChatStackStore.getState().stack.map((d) => d.peerId)).toEqual([43])
    expect(selectOpenThread(useChatStackStore.getState())).toBeNull()
  })

  it('selectChat(null) очищает стек', () => {
    useNavigationStore.getState().selectChat('42')
    useNavigationStore.getState().selectChat(null)
    expect(useChatStackStore.getState().stack).toEqual([])
  })
})
