// src/core/hooks/useMessageWindow.test.ts
import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useMessageWindow } from './useMessageWindow'
import type { Message } from '../models'
import type { HistoryArgs, HistoryResult } from '../managers/messagesManager'

function msg(seq: number): Message {
  return { id: seq, chatId: 1, seq, senderId: 1, type: 'text', text: `m${seq}`,
    replyToId: null, mediaId: null, createdAt: '2026-06-24T10:00:00Z', threadRootId: null }
}

function fakeManagers(handler: (a: HistoryArgs) => HistoryResult) {
  return { messages: { getHistory: async (a: HistoryArgs) => handler(a), sendMessage: async () => msg(99) } }
}

describe('useMessageWindow', () => {
  it('loads the newest window on mount (ascending)', async () => {
    const managers = fakeManagers(() => ({
      messages: [msg(3), msg(4), msg(5)], count: 3, reachedBottom: true, reachedTop: false,
    }))
    const { result } = renderHook(() => useMessageWindow(1, managers as never, 40))
    await waitFor(() => expect(result.current.msgs.length).toBe(3))
    expect(result.current.msgs.map((m) => m.seq)).toEqual([3, 4, 5])
    expect(result.current.reachedBottom).toBe(true)
  })

  it('loadOlder prepends and dedups', async () => {
    let call = 0
    const managers = fakeManagers((a) => {
      call++
      if (a.offsetSeq === 0) return { messages: [msg(3), msg(4), msg(5)], count: 3, reachedBottom: true, reachedTop: false }
      return { messages: [msg(1), msg(2)], count: 2, reachedBottom: false, reachedTop: true }
    })
    const { result } = renderHook(() => useMessageWindow(1, managers as never, 40))
    await waitFor(() => expect(result.current.msgs.length).toBe(3))
    await act(async () => { await result.current.loadOlder() })
    expect(result.current.msgs.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5])
    expect(result.current.reachedTop).toBe(true)
    expect(call).toBe(2)
  })

  it('does not load older once reachedTop', async () => {
    let call = 0
    const managers = fakeManagers((a) => {
      call++
      if (a.offsetSeq === 0) return { messages: [msg(1), msg(2)], count: 2, reachedBottom: true, reachedTop: true }
      return { messages: [], count: 0, reachedBottom: false, reachedTop: true }
    })
    const { result } = renderHook(() => useMessageWindow(1, managers as never, 40))
    await waitFor(() => expect(result.current.reachedTop).toBe(true))
    await act(async () => { await result.current.loadOlder() })
    expect(call).toBe(1)
  })

  it('appendOptimistic then reconcileAck swaps the tentative seq', async () => {
    const managers = fakeManagers(() => ({ messages: [], count: 0, reachedTop: true, reachedBottom: true }))
    const { result } = renderHook(() => useMessageWindow(1, managers as never, 40))
    await waitFor(() => expect(result.current.reachedBottom).toBe(true))
    act(() => { result.current.appendOptimistic('hi', 7, 'c1', 42) })
    expect(result.current.msgs[result.current.msgs.length - 1]?.text).toBe('hi')
    expect(result.current.msgs[result.current.msgs.length - 1]?.mediaId).toBe(42)
    act(() => { result.current.reconcileAck('c1', { msgId: 50, seq: 12, createdAt: 'now' }) })
    const last = result.current.msgs[result.current.msgs.length - 1]!
    expect(last.id).toBe(50); expect(last.seq).toBe(12)
  })

  it('applyIncoming appends and dedups by id', async () => {
    const managers = fakeManagers(() => ({ messages: [], count: 0, reachedTop: true, reachedBottom: true }))
    const { result } = renderHook(() => useMessageWindow(1, managers as never, 40))
    await waitFor(() => expect(result.current.reachedBottom).toBe(true))
    const m = { id: 9, chatId: 1, seq: 3, senderId: 5, type: 'text', text: 'yo', replyToId: null, mediaId: null, createdAt: 'now', threadRootId: null }
    act(() => { result.current.applyIncoming(m) })
    act(() => { result.current.applyIncoming(m) })
    expect(result.current.msgs.filter((x) => x.id === 9)).toHaveLength(1)
  })

  it('applyIncoming echo of our own message keeps the optimistic clientId (stable key)', async () => {
    const managers = fakeManagers(() => ({ messages: [], count: 0, reachedTop: true, reachedBottom: true }))
    const { result } = renderHook(() => useMessageWindow(1, managers as never, 40))
    await waitFor(() => expect(result.current.reachedBottom).toBe(true))
    // Send → optimistic entry carries a stable clientId at tentative seq 1.
    act(() => { result.current.appendOptimistic('hey', 7, 'c-stable') })
    const tentativeSeq = result.current.msgs[result.current.msgs.length - 1]!.seq
    // The realtime echo arrives with the real server id but the SAME seq and no
    // clientId — it must not strip the optimistic clientId (that would remount).
    const echo: Message = { id: 500, chatId: 1, seq: tentativeSeq, senderId: 7, type: 'text', text: 'hey', replyToId: null, mediaId: null, createdAt: 'now', threadRootId: null }
    act(() => { result.current.applyIncoming(echo) })
    const merged = result.current.msgs.filter((x) => x.seq === tentativeSeq)
    expect(merged).toHaveLength(1)
    expect(merged[0]!.id).toBe(500)
    expect(merged[0]!.clientId).toBe('c-stable')
  })

  it('applyEdit patches text + editedAt in place', async () => {
    const managers = fakeManagers(() => ({ messages: [msg(3)], count: 1, reachedTop: true, reachedBottom: true }))
    const { result } = renderHook(() => useMessageWindow(1, managers as never, 40))
    await waitFor(() => expect(result.current.msgs.length).toBe(1))
    act(() => { result.current.applyEdit(3, 'edited!', 'now') })
    const m = result.current.msgs.find((x) => x.id === 3)!
    expect(m.text).toBe('edited!')
    expect(m.editedAt).toBe('now')
  })

  it('applyDelete drops the row (deleted messages are never shown)', async () => {
    const managers = fakeManagers(() => ({ messages: [msg(3), msg(4)], count: 2, reachedTop: true, reachedBottom: true }))
    const { result } = renderHook(() => useMessageWindow(1, managers as never, 40))
    await waitFor(() => expect(result.current.msgs.length).toBe(2))
    act(() => { result.current.applyDelete(3, false) }) // revoke
    expect(result.current.msgs.find((x) => x.id === 3)).toBeUndefined()
    act(() => { result.current.applyDelete(4, true) }) // for me
    expect(result.current.msgs.find((x) => x.id === 4)).toBeUndefined()
  })
})
