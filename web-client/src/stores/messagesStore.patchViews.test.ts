import { describe, it, expect, beforeEach } from 'vitest'
import { useMessagesStore } from './messagesStore'
import type { MessageReal, MyMessage } from '../core/models'
import { makeMessage } from '../core/messages/testMessage'

const msg = (id: number, views = 0): MessageReal =>
  ({ ...makeMessage({ id, peerId: 5, fromId: 1, text: `m${id}` }), views })

const viewsOf = (msgs: MyMessage[], id: number) => (msgs.find((m) => m.id === id) as MessageReal | undefined)?.views

describe('messagesStore.patchViews', () => {
  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
    useMessagesStore.getState().setWindow(String(5), {
      msgs: [msg(1), msg(2), msg(3)],
      reachedTop: true, reachedBottom: true,
    })
  })

  it('patches view counts onto the matching messages', () => {
    useMessagesStore.getState().patchViews(5, new Map([[1, 9200], [3, 5]]))
    const msgs = useMessagesStore.getState().byKey[String(5)].msgs
    expect(viewsOf(msgs, 1)).toBe(9200)
    expect(viewsOf(msgs, 2)).toBe(0)
    expect(viewsOf(msgs, 3)).toBe(5)
  })

  it('keeps references stable for unchanged rows (memoized bubbles do not re-render)', () => {
    const before = useMessagesStore.getState().byKey[String(5)].msgs
    useMessagesStore.getState().patchViews(5, new Map([[1, 42]]))
    const after = useMessagesStore.getState().byKey[String(5)].msgs
    expect(after[0]).not.toBe(before[0]) // id 1 changed → new ref
    expect(after[1]).toBe(before[1]) // id 2 unchanged → same ref
    expect(after[2]).toBe(before[2]) // id 3 unchanged → same ref
  })

  it('is a no-op when nothing changed (no counts differ)', () => {
    useMessagesStore.getState().patchViews(5, new Map([[1, 9200]]))
    const arr1 = useMessagesStore.getState().byKey[String(5)].msgs
    // same value again → array identity preserved
    useMessagesStore.getState().patchViews(5, new Map([[1, 9200]]))
    const arr2 = useMessagesStore.getState().byKey[String(5)].msgs
    expect(arr2).toBe(arr1)
  })

  it('ignores chats with no loaded window', () => {
    useMessagesStore.getState().patchViews(999, new Map([[1, 1]]))
    expect(useMessagesStore.getState().byKey[String(999)]).toBeUndefined()
  })
})
