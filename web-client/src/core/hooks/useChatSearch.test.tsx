// src/core/hooks/useChatSearch.test.tsx
//
// Поиск в чате листается КУРСОРОМ — номером последнего сообщения в списке, а
// не его длиной: выдача пополняется сверху живыми апдейтами, и числовое
// смещение отдало бы вторую страницу с дублем. Фейк менеджера устроен как
// ручка `/chats/{id}/search`: знает только `offsetId` и отдаёт строго ниже.
import { createElement, type ReactNode } from 'react'
import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useMessageSearchLoader } from './useChatSearch'
import { ManagersProvider } from './useManagers'
import type { MyMessage } from '../models'
import { makeMessage } from '../messages/testMessage'

const msg = (id: number): MyMessage => makeMessage({ id, peerId: 1, fromId: 1, text: `кот ${id}` })

function fakeServer(initial: number[]) {
  const ids = [...initial] // новые сверху
  const calls: { offsetId?: number; limit?: number }[] = []
  const managers = {
    messages: {
      searchMessages: async (_peerId: number, _q: string, opts: { offsetId?: number; limit?: number }) => {
        calls.push(opts)
        const below = ids.filter((id) => !opts.offsetId || id < opts.offsetId)
        return { messages: below.slice(0, opts.limit ?? 20).map(msg), count: ids.length }
      },
    },
  }
  return { managers, calls, insertOnTop: (id: number) => ids.unshift(id) }
}

describe('useMessageSearchLoader', () => {
  it('следующая страница — по номеру последнего, вставка сверху не даёт дубля', async () => {
    const server = fakeServer(Array.from({ length: 45 }, (_, i) => 45 - i))
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(ManagersProvider, { managers: server.managers as never, children })
    const { result } = renderHook(() => useMessageSearchLoader(1, { enabled: true, query: 'кот' }), { wrapper })

    await waitFor(() => expect(result.current.messages).toHaveLength(30))
    expect(server.calls[0]!.offsetId ?? 0).toBe(0)

    server.insertOnTop(46) // живой апдейт между страницами
    act(() => { result.current.loadMore!() })
    await waitFor(() => expect(result.current.messages).toHaveLength(45))

    expect(server.calls[1]!.offsetId).toBe(16) // последний показанный
    const ids = result.current.messages.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(Array.from({ length: 45 }, (_, i) => 45 - i))
    expect(result.current.loadMore).toBeUndefined() // короткая страница — конец
  })
})
