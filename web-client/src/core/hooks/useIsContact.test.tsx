// src/core/hooks/useIsContact.test.tsx
//
// Порт проверки tweb `appPeersManager.isContact` (812502980
// `appPeersManager.ts:162-164` → `appUsersManager.ts:897-899`: книга ИЛИ
// `pFlags.contact` карточки) для React-потребителей: гейт пункта «Добавить в
// контакты» ⋮ шапки (`topbar.ts:605-610`) и карандаша профиля
// (`sharedMedia.tsx::toggleEditBtn`, перечитывается на `contacts_update`).
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import rootScope from '@lib/rootScope'
import { applyPeerOps, resetPeerMirror } from '../peerCache'
import { ManagersProvider } from './useManagers'
import { useIsContact } from './useIsContact'

const BOB = 42

let book: Set<number>
let calls: number[]
let pending: Map<number, (v: boolean) => void> | null

const managers = {
  contacts: {
    isContact: (userId: number) => {
      calls.push(userId)
      if (pending) return new Promise<boolean>((resolve) => { pending!.set(userId, resolve) })
      return Promise.resolve(book.has(userId))
    },
  },
  peers: { fillMirror: async () => {} },
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <ManagersProvider managers={managers as never}>{children}</ManagersProvider>
)

beforeEach(() => {
  book = new Set()
  calls = []
  pending = null
})

afterEach(() => {
  cleanup()
  resetPeerMirror()
})

describe('useIsContact — appPeersManager.isContact для React', () => {
  it('пока ответа нет — undefined, затем ответ менеджера', async () => {
    book.add(BOB)
    const { result } = renderHook(() => useIsContact(BOB), { wrapper })
    expect(result.current).toBeUndefined()
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('не пользователь — не контакт, без запроса', () => {
    const { result } = renderHook(() => useIsContact(-100), { wrapper })
    expect(result.current).toBe(false)
    expect(calls).toEqual([])
  })

  it('contacts_update этого пользователя перечитывает ответ', async () => {
    const { result } = renderHook(() => useIsContact(BOB), { wrapper })
    await waitFor(() => expect(result.current).toBe(false))
    book.add(BOB)
    act(() => { rootScope.dispatchEventSingle('contacts_update', BOB) })
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('смена карточки (pFlags.contact с сервера) перечитывает ответ', async () => {
    const { result } = renderHook(() => useIsContact(BOB), { wrapper })
    await waitFor(() => expect(result.current).toBe(false))
    book.add(BOB)
    act(() => { applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: BOB, first_name: 'Боб', pFlags: { contact: true } }] }]) })
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('ответ прежнего пира не выдаётся за ответ нового', async () => {
    book.add(BOB)
    pending = new Map()
    const { result, rerender } = renderHook(({ id }) => useIsContact(id), { wrapper, initialProps: { id: BOB } })
    await act(async () => { pending!.get(BOB)!(true) })
    expect(result.current).toBe(true)
    rerender({ id: 7 })
    expect(result.current).toBeUndefined()
    await act(async () => { pending!.get(7)!(false) })
    expect(result.current).toBe(false)
  })

  it('запоздавший ответ прошлого прогона не затирает свежий (middleware)', async () => {
    const resolvers: ((v: boolean) => void)[] = []
    pending = { set: (_id: number, r: (v: boolean) => void) => { resolvers.push(r) } } as never
    const { result } = renderHook(() => useIsContact(BOB), { wrapper })
    act(() => { rootScope.dispatchEventSingle('contacts_update', BOB) })
    expect(resolvers).toHaveLength(2)
    await act(async () => { resolvers[1](true) })
    expect(result.current).toBe(true)
    await act(async () => { resolvers[0](false) })
    expect(result.current).toBe(true)
  })
})
