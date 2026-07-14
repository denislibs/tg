// Жизненный цикл статуса отправки (tweb sendingStatus): оптимистичный бабл —
// sending (id < 0), message_error помечает failed (бабл остаётся), retry
// снимает failed, remove удаляет бабл.
import { describe, it, expect, beforeEach } from 'vitest'
import { useMessagesStore } from './messagesStore'
import { messageToConvMsg } from '../core/messageToConvMsg'

const CHAT = 9
const ME = 7

describe('messagesStore send status lifecycle', () => {
  beforeEach(() => {
    useMessagesStore.setState({ byChat: {} })
    useMessagesStore.getState().setWindow(CHAT, { msgs: [], reachedTop: true, reachedBottom: true })
  })

  it('optimistic message renders as sending (clock), not sent', () => {
    useMessagesStore.getState().appendOptimistic(CHAT, 'hi', ME, 'c1')
    const m = useMessagesStore.getState().byChat[CHAT].msgs[0]
    expect(m.id).toBeLessThan(0)
    expect(messageToConvMsg(m, ME).status).toBe('sending')
  })

  it('failOptimistic keeps the bubble and marks it error', () => {
    useMessagesStore.getState().appendOptimistic(CHAT, 'hi', ME, 'c1')
    useMessagesStore.getState().failOptimisticByClient('c1')
    const m = useMessagesStore.getState().byChat[CHAT].msgs[0]
    expect(m).toBeDefined()
    expect(m.failed).toBe(true)
    expect(messageToConvMsg(m, ME).status).toBe('error')
  })

  it('retryOptimistic clears failed → back to sending', () => {
    useMessagesStore.getState().appendOptimistic(CHAT, 'hi', ME, 'c1')
    useMessagesStore.getState().failOptimisticByClient('c1')
    useMessagesStore.getState().retryOptimistic(CHAT, 'c1')
    const m = useMessagesStore.getState().byChat[CHAT].msgs[0]
    expect(m.failed).toBeUndefined()
    expect(messageToConvMsg(m, ME).status).toBe('sending')
  })

  it('ack after a retry still reconciles the same bubble to sent', () => {
    useMessagesStore.getState().appendOptimistic(CHAT, 'hi', ME, 'c1')
    useMessagesStore.getState().failOptimisticByClient('c1')
    useMessagesStore.getState().retryOptimistic(CHAT, 'c1')
    useMessagesStore.getState().reconcileAckByClient('c1', { msgId: 100, seq: 1, createdAt: '2026-07-14T00:00:00Z' })
    const m = useMessagesStore.getState().byChat[CHAT].msgs[0]
    expect(m.id).toBe(100)
    expect(messageToConvMsg(m, ME).status).toBe('sent')
  })

  it('removeOptimistic drops the failed bubble', () => {
    useMessagesStore.getState().appendOptimistic(CHAT, 'hi', ME, 'c1')
    useMessagesStore.getState().failOptimisticByClient('c1')
    useMessagesStore.getState().removeOptimistic(CHAT, 'c1')
    expect(useMessagesStore.getState().byChat[CHAT].msgs).toHaveLength(0)
  })
})
