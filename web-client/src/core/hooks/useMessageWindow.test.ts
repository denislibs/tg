// src/core/hooks/useMessageWindow.test.ts
import { createElement, type ReactNode } from 'react'
import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useMessageWindow } from './useMessageWindow'
import { ManagersProvider } from './useManagers'
import { useMessagesStore } from '../../stores/messagesStore'
import type { MessageReal, MyMessage } from '../models'
import { generateMessageId, generateTempMessageId } from '../history/messageId'
import { makeMessage } from '../messages/testMessage'
import type { HistoryArgs, HistoryResult } from '../managers/messagesManager'

/** Номер в КЛИЕНТСКОМ пространстве — окно живёт только в нём. */
const cid = generateMessageId

function msg(id: number, over: Partial<MessageReal> = {}): MyMessage {
  return { ...makeMessage({ id: cid(id), peerId: 1, fromId: 1, text: `m${id}`, date: 1_750_000_000 }), ...over }
}

const real = (m: MyMessage | undefined): MessageReal | undefined => (m?._ === 'message' ? m : undefined)

function fakeManagers(handler: (a: HistoryArgs) => HistoryResult) {
  return { messages: { getHistory: async (a: HistoryArgs) => handler(a), sendMessage: async () => msg(99) } }
}

// useMessageWindow now reads managers from context (useManagers); mount the hook
// under a ManagersProvider carrying the test's fake managers.
function mount(managers: unknown) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ManagersProvider, { managers: managers as never, children })
  return renderHook(() => useMessageWindow(1, 40), { wrapper })
}

describe('useMessageWindow', () => {
  it('loads the newest window on mount (ascending)', async () => {
    const managers = fakeManagers(() => ({
      messages: [msg(3), msg(4), msg(5)], count: 3, reachedBottom: true, reachedTop: false,
    }))
    const { result } = mount(managers)
    await waitFor(() => expect(result.current.msgs.length).toBe(3))
    expect(result.current.msgs.map((m) => m.id)).toEqual([cid(3), cid(4), cid(5)])
    expect(result.current.reachedBottom).toBe(true)
  })

  it('loadOlder prepends and dedups', async () => {
    let call = 0
    const managers = fakeManagers((a) => {
      call++
      if (a.offsetId === 0) return { messages: [msg(3), msg(4), msg(5)], count: 3, reachedBottom: true, reachedTop: false }
      return { messages: [msg(1), msg(2)], count: 2, reachedBottom: false, reachedTop: true }
    })
    const { result } = mount(managers)
    await waitFor(() => expect(result.current.msgs.length).toBe(3))
    await act(async () => { await result.current.loadOlder() })
    expect(result.current.msgs.map((m) => m.id)).toEqual([cid(1), cid(2), cid(3), cid(4), cid(5)])
    expect(result.current.reachedTop).toBe(true)
    expect(call).toBe(2)
  })

  it('does not load older once reachedTop', async () => {
    let call = 0
    const managers = fakeManagers((a) => {
      call++
      if (a.offsetId === 0) return { messages: [msg(1), msg(2)], count: 2, reachedBottom: true, reachedTop: true }
      return { messages: [], count: 0, reachedBottom: false, reachedTop: true }
    })
    const { result } = mount(managers)
    await waitFor(() => expect(result.current.reachedTop).toBe(true))
    await act(async () => { await result.current.loadOlder() })
    expect(call).toBe(1)
  })

  // Хук — тонкая обёртка над окном: неотправленный бабл и его ack приезжают
  // операциями владельца (воркер), хук обязан отдать их наверх как есть.
  it('операции неотправленного бабла и его ack доезжают до хука', async () => {
    const managers = fakeManagers(() => ({ messages: [], count: 0, reachedTop: true, reachedBottom: true }))
    const { result } = mount(managers)
    await waitFor(() => expect(result.current.reachedBottom).toBe(true))
    // Номер бабла — ДРОБЬ поверх последнего занятого (порт tweb
    // `generateTempMessageId`), отрицательных номеров больше нет.
    const temp: MyMessage = makeMessage({
      id: generateTempMessageId(cid(0)), peerId: 1, fromId: 7, text: 'hi', randomId: 'c1',
    })
    act(() => { useMessagesStore.getState().applyOps([{ op: 'insert', key: '1', msg: temp }]) })
    const lastOf = () => result.current.msgs[result.current.msgs.length - 1]
    expect(real(lastOf())?.message).toBe('hi')
    expect(lastOf()?.random_id).toBe('c1')
    act(() => { useMessagesStore.getState().applyOps([{ op: 'insert', key: '1', msg: { ...temp, id: cid(12) } }]) })
    expect(lastOf()!.id).toBe(cid(12))
  })

  it('applyIncoming appends and dedups by id', async () => {
    const managers = fakeManagers(() => ({ messages: [], count: 0, reachedTop: true, reachedBottom: true }))
    const { result } = mount(managers)
    await waitFor(() => expect(result.current.reachedBottom).toBe(true))
    const m = msg(9, { fromId: 5, message: 'yo' })
    act(() => { result.current.applyIncoming(m) })
    act(() => { result.current.applyIncoming(m) })
    expect(result.current.msgs.filter((x) => x.id === cid(9))).toHaveLength(1)
  })

  it('applyIncoming echo of our own message keeps the optimistic random_id (stable key)', async () => {
    const managers = fakeManagers(() => ({ messages: [], count: 0, reachedTop: true, reachedBottom: true }))
    const { result } = mount(managers)
    await waitFor(() => expect(result.current.reachedBottom).toBe(true))
    // Отправка → оптимистичный бабл с устойчивым `random_id` под клиентским
    // (дробным) номером; владелец собирает его в воркере, здесь кладём ту же форму.
    act(() => {
      useMessagesStore.getState().appendLocal('1', makeMessage({
        id: generateTempMessageId(cid(0)), peerId: 1, fromId: 7, text: 'hey', randomId: 'c-stable',
      }))
    })
    // Эхо несёт НАСТОЯЩИЙ номер и тот же `random_id` — по нему оно и сливается с
    // баблом (дубля нет, даже если номер сервера иной), а сам `random_id`
    // сохраняется, чтобы ключ строки не менялся посреди анимации появления.
    const echo = msg(500, { fromId: 7, message: 'hey', random_id: 'c-stable' })
    act(() => { result.current.applyIncoming(echo) })
    const merged = result.current.msgs.filter((x) => x.random_id === 'c-stable')
    expect(merged).toHaveLength(1)
    expect(merged[0]!.id).toBe(cid(500))
  })

  it('applyEdit patches text + editedAt in place', async () => {
    const managers = fakeManagers(() => ({ messages: [msg(3)], count: 1, reachedTop: true, reachedBottom: true }))
    const { result } = mount(managers)
    await waitFor(() => expect(result.current.msgs.length).toBe(1))
    act(() => { result.current.applyEdit(cid(3), 'edited!', 1_750_000_100) })
    const m = real(result.current.msgs.find((x) => x.id === cid(3)))!
    expect(m.message).toBe('edited!')
    expect(m.edit_date).toBe(1_750_000_100)
  })

  it('applyDelete drops the row (deleted messages are never shown)', async () => {
    const managers = fakeManagers(() => ({ messages: [msg(3), msg(4)], count: 2, reachedTop: true, reachedBottom: true }))
    const { result } = mount(managers)
    await waitFor(() => expect(result.current.msgs.length).toBe(2))
    act(() => { result.current.applyDelete(cid(3), false) }) // revoke
    expect(result.current.msgs.find((x) => x.id === cid(3))).toBeUndefined()
    act(() => { result.current.applyDelete(cid(4), true) }) // for me
    expect(result.current.msgs.find((x) => x.id === cid(4))).toBeUndefined()
  })
})
