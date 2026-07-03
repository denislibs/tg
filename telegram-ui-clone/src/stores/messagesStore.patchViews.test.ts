import { describe, it, expect, beforeEach } from 'vitest'
import { useMessagesStore } from './messagesStore'
import { mapMessage, type RawMessage } from '../core/models'

const raw = (id: number, views = 0): RawMessage => ({
  id, chat_id: 5, seq: id, sender_id: 1, type: 'text', text: `m${id}`,
  reply_to_id: null, media_id: null, created_at: '2026-07-01T00:00:00Z', views,
})

describe('messagesStore.patchViews', () => {
  beforeEach(() => {
    useMessagesStore.setState({ byChat: {} })
    useMessagesStore.getState().setWindow(5, {
      msgs: [mapMessage(raw(1)), mapMessage(raw(2)), mapMessage(raw(3))],
      reachedTop: true, reachedBottom: true,
    })
  })

  it('patches view counts onto the matching messages', () => {
    useMessagesStore.getState().patchViews(5, new Map([[1, 9200], [3, 5]]))
    const msgs = useMessagesStore.getState().byChat[5].msgs
    expect(msgs.find((m) => m.id === 1)?.views).toBe(9200)
    expect(msgs.find((m) => m.id === 2)?.views).toBe(0)
    expect(msgs.find((m) => m.id === 3)?.views).toBe(5)
  })

  it('keeps references stable for unchanged rows (memoized bubbles do not re-render)', () => {
    const before = useMessagesStore.getState().byChat[5].msgs
    useMessagesStore.getState().patchViews(5, new Map([[1, 42]]))
    const after = useMessagesStore.getState().byChat[5].msgs
    expect(after[0]).not.toBe(before[0]) // id 1 changed → new ref
    expect(after[1]).toBe(before[1]) // id 2 unchanged → same ref
    expect(after[2]).toBe(before[2]) // id 3 unchanged → same ref
  })

  it('is a no-op when nothing changed (no counts differ)', () => {
    useMessagesStore.getState().patchViews(5, new Map([[1, 9200]]))
    const arr1 = useMessagesStore.getState().byChat[5].msgs
    // same value again → array identity preserved
    useMessagesStore.getState().patchViews(5, new Map([[1, 9200]]))
    const arr2 = useMessagesStore.getState().byChat[5].msgs
    expect(arr2).toBe(arr1)
  })

  it('ignores chats with no loaded window', () => {
    useMessagesStore.getState().patchViews(999, new Map([[1, 1]]))
    expect(useMessagesStore.getState().byChat[999]).toBeUndefined()
  })
})
