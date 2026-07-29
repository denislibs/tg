// Wave 3: сверка оптимистичного бабла с сервером по client_msg_id (не по фабричному
// tentative seq). Оба порядка — ack-then-echo и echo-then-ack — сходятся на ОДНОМ
// бабле без дубля.
import { beforeEach, describe, expect, it } from 'vitest'
import { useMessagesStore } from './messagesStore'
import type { Message } from '../core/models'

const CHAT = 5
const ME = 7

// Серверный эхо-кадр своей отправки: несёт положительный id/seq И client_msg_id.
function serverEcho(clientId: string, id = 100, seq = 5): Message {
  return {
    id, chatId: CHAT, seq, senderId: ME, type: 'text', text: 'hi',
    replyToId: null, mediaId: null, createdAt: '2026-07-19T10:00:00Z', threadRootId: null, clientId,
  }
}

function bubbles() {
  return useMessagesStore.getState().byKey[String(CHAT)].msgs
}

describe('ack vs echo reconcile by client_msg_id', () => {
  beforeEach(() => {
    useMessagesStore.setState({ byKey: {} })
    useMessagesStore.getState().setWindow(String(CHAT), { msgs: [], reachedTop: true, reachedBottom: true })
  })

  it('ack-then-echo: single bubble, server id, no duplicate', () => {
    const st = useMessagesStore.getState()
    st.appendOptimistic(String(CHAT), 'hi', ME, 'c1')
    st.reconcileAckByClient('c1', { msgId: 100, seq: 5, createdAt: '2026-07-19T10:00:00Z' })
    st.applyIncoming(CHAT, serverEcho('c1'))
    expect(bubbles()).toHaveLength(1)
    expect(bubbles()[0].id).toBe(100)
    expect(bubbles()[0].seq).toBe(5)
    expect(bubbles()[0].clientId).toBe('c1')
  })

  it('echo-then-ack: single bubble, server id, no duplicate', () => {
    const st = useMessagesStore.getState()
    st.appendOptimistic(String(CHAT), 'hi', ME, 'c1')
    st.applyIncoming(CHAT, serverEcho('c1'))
    // echo already replaced the optimistic bubble (server seq differs from tentative)
    expect(bubbles()).toHaveLength(1)
    expect(bubbles()[0].id).toBe(100)
    st.reconcileAckByClient('c1', { msgId: 100, seq: 5, createdAt: '2026-07-19T10:00:00Z' })
    expect(bubbles()).toHaveLength(1)
    expect(bubbles()[0].id).toBe(100)
    expect(bubbles()[0].seq).toBe(5)
  })

  it('echo carries clientId over so the React key stays stable', () => {
    const st = useMessagesStore.getState()
    st.appendOptimistic(String(CHAT), 'hi', ME, 'c1')
    st.applyIncoming(CHAT, serverEcho('c1'))
    expect(bubbles()[0].clientId).toBe('c1')
  })
})
