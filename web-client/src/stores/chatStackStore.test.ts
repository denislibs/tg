import { beforeEach, describe, expect, it } from 'vitest'
import { useChatStackStore, descKey, selectActive, selectRoot, selectOpenThread } from './chatStackStore'

const thread = { rootMsgId: 7, title: 'Comments', kind: 'comments' as const }

beforeEach(() => {
  useChatStackStore.setState({ stack: [] }, false)
})

describe('chatStackStore', () => {
  it('setPeer кладёт единственный инстанс и схлопывает стек', () => {
    const { setPeer, setInnerPeer } = useChatStackStore.getState()
    setPeer({ peerId: 1, type: 'chat' })
    setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })

    setPeer({ peerId: 3, type: 'chat' })

    const { stack } = useChatStackStore.getState()
    expect(stack.map((d) => d.peerId)).toEqual([3])
  })

  it('setInnerPeer кладёт инстанс сверху', () => {
    const { setPeer, setInnerPeer } = useChatStackStore.getState()
    setPeer({ peerId: 1, type: 'chat' })
    setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })

    const { stack } = useChatStackStore.getState()
    expect(stack).toHaveLength(2)
    expect(selectActive(useChatStackStore.getState())?.key).toBe(descKey({ peerId: 2, threadId: 7, type: 'discussion' }))
  })

  it('setInnerPeer на пир, который уже в стеке, срезает всё выше него', () => {
    const { setPeer, setInnerPeer } = useChatStackStore.getState()
    setPeer({ peerId: 1, type: 'chat' })
    setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
    setInnerPeer({ peerId: 5, type: 'chat' })

    setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })

    expect(useChatStackStore.getState().stack.map((d) => d.peerId)).toEqual([1, 2])
  })

  it('closeTop снимает верхний, но не опустошает стек', () => {
    const { setPeer, setInnerPeer, closeTop } = useChatStackStore.getState()
    setPeer({ peerId: 1, type: 'chat' })
    setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })

    closeTop()
    expect(useChatStackStore.getState().stack.map((d) => d.peerId)).toEqual([1])

    closeTop()
    expect(useChatStackStore.getState().stack.map((d) => d.peerId)).toEqual([1])
  })

  it('ключ различает корневой чат и его тред', () => {
    expect(descKey({ peerId: 2, type: 'chat' })).not.toBe(descKey({ peerId: 2, threadId: 7, type: 'chat' }))
  })

  it('selectRoot — дно стека (подсветка в списке), selectOpenThread — только при глубине > 1', () => {
    const { setPeer, setInnerPeer } = useChatStackStore.getState()
    setPeer({ peerId: 1, type: 'chat' })
    expect(selectOpenThread(useChatStackStore.getState())).toBeNull()

    setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
    expect(selectRoot(useChatStackStore.getState())?.peerId).toBe(1)
    expect(selectOpenThread(useChatStackStore.getState())).toEqual({ chatId: 2, thread })
  })
})
