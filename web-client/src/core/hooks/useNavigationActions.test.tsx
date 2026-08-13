// src/core/hooks/useNavigationActions.test.ts
//
// Task 5 (стек инстансов колонки чата): App.tsx больше не читает
// selectedId/draftPeer напрямую — колонка чата целиком рисуется по
// chatStackStore.stack (ChatsContainer). Поэтому любой путь, который раньше
// звал голый navigationStore.setSelectedId(...), обязан теперь идти через
// selectChat(...) — иначе стек не обновится, и ChatsContainer ничего не
// покажет, хотя selectedId формально сменился. Три сценария ниже — ровно те
// строки проводки, что были переведены с setSelectedId на selectChat при
// переезде на стек: openPeer (черновик с новым собеседником), onChatCreated
// (первое сообщение в черновике создало реальный чат), openPublicChannel
// (вступление в канал из «похожих»).
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, act } from '@testing-library/react'
import { useNavigationActions } from './useNavigationActions'
import { ManagersProvider } from './useManagers'
import type { Managers } from '../../client/bootstrap'
import { useChatsStore } from '../../stores/chatsStore'
import { useNavigationStore } from '../../stores/navigationStore'
import { useChatStackStore } from '../../stores/chatStackStore'

afterEach(cleanup)

function testManagers(overrides: Partial<Managers> = {}): Managers {
  return {
    presence: { get: vi.fn().mockResolvedValue([]) },
    dialogs: { refresh: vi.fn().mockResolvedValue(undefined) },
    channels: { join: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  } as unknown as Managers
}

function withManagers(managers: Managers) {
  return ({ children }: { children: ReactNode }) => (
    <ManagersProvider managers={managers}>{children}</ManagersProvider>
  )
}

beforeEach(() => {
  useChatStackStore.setState({ stack: [] }, false)
  useNavigationStore.setState({ selectedId: null, draftPeer: null }, false)
  useChatsStore.setState({ meId: 1, dialogs: [] })
})

describe('useNavigationActions ↔ chatStackStore (переезд с голого setSelectedId на selectChat)', () => {
  it('openPeer с новым собеседником (нет диалога) кладёт черновик-инстанс в стек и сохраняет draftPeer', () => {
    const managers = testManagers()
    const { result } = renderHook(() => useNavigationActions(), { wrapper: withManagers(managers) })

    act(() => { result.current.openPeer({ id: 42, displayName: 'Новый контакт' }) })

    expect(useNavigationStore.getState().selectedId).toBe('draft:42')
    expect(useNavigationStore.getState().draftPeer?.id).toBe(42)
    expect(useChatStackStore.getState().stack.map((d) => d.peerId)).toEqual([42])
  })

  it('onChatCreated переключает стек с черновика на реальный peerId и чистит draftPeer', () => {
    const managers = testManagers()
    const { result } = renderHook(() => useNavigationActions(), { wrapper: withManagers(managers) })

    act(() => { result.current.openPeer({ id: 42, displayName: 'Новый контакт' }) })
    act(() => { result.current.onChatCreated(777) })

    expect(useNavigationStore.getState().selectedId).toBe('777')
    expect(useNavigationStore.getState().draftPeer).toBeNull()
    expect(useChatStackStore.getState().stack.map((d) => d.peerId)).toEqual([777])
  })

  it('openPublicChannel после вступления кладёт канал в стек', async () => {
    const managers = testManagers()
    const { result } = renderHook(() => useNavigationActions(), { wrapper: withManagers(managers) })

    await act(async () => { await result.current.openPublicChannel(555, 'somechannel') })

    expect(useNavigationStore.getState().selectedId).toBe('555')
    expect(useChatStackStore.getState().stack.map((d) => d.peerId)).toEqual([555])
  })
})
