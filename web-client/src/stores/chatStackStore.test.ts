import { beforeEach, describe, expect, it } from 'vitest'
import { useChatStackStore, descKey, selectActive, selectRoot, selectOpenThreadDesc } from './chatStackStore'

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
    expect(descKey(selectActive(useChatStackStore.getState())!)).toBe(descKey({ peerId: 2, threadId: 7, type: 'discussion' }))
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

  it('selectRoot — дно стека (подсветка в списке), selectOpenThreadDesc — только при глубине > 1', () => {
    const { setPeer, setInnerPeer } = useChatStackStore.getState()
    setPeer({ peerId: 1, type: 'chat' })
    expect(selectOpenThreadDesc(useChatStackStore.getState())).toBeUndefined()

    setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
    expect(selectRoot(useChatStackStore.getState())?.peerId).toBe(1)
    expect(selectOpenThreadDesc(useChatStackStore.getState())).toMatchObject({ peerId: 2, thread })
  })

  it('popTo(index) срезает всё выше индекса', () => {
    const { setPeer, setInnerPeer, popTo } = useChatStackStore.getState()
    setPeer({ peerId: 1, type: 'chat' })
    setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
    setInnerPeer({ peerId: 3, type: 'chat' })

    popTo(0)
    expect(useChatStackStore.getState().stack.map((d) => d.peerId)).toEqual([1])

    setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
    setInnerPeer({ peerId: 3, type: 'chat' })

    popTo(-1)
    expect(useChatStackStore.getState().stack).toEqual([])
  })

  it('clear() опустошает стек', () => {
    const { setPeer, setInnerPeer, clear } = useChatStackStore.getState()
    setPeer({ peerId: 1, type: 'chat' })
    setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })

    clear()
    expect(useChatStackStore.getState().stack).toEqual([])
  })
})
