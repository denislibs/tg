// Stage 1C.2 (Task 2): владелец карточек пиров — воркерный peersManager. За
// хуком остаётся ЗАПРОС недостающих (read-путь), применение ответа — за
// проектором по rt:peer_op. Обе стороны этого разделения и пинятся здесь:
// строка объявления пробела иначе не покрыта ничем (её удаление оставляет приложение без
// имён и аватаров, не покрасив ни одного теста — построчная норма,
// web-client/CLAUDE.md «Тесты»), а возврат прежнего `.then(upsert)` вернул бы
// второго писателя стора.
//
// Отдельный файл от usePeers.test.ts (там чистые тесты peersKey) — потому что
// этим нужен React-рендер и JSX-обёртка ManagersProvider.
import type { ReactNode } from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePeers } from './usePeers'
import { ManagersProvider } from './useManagers'
import { usePeersStore } from '../../stores/peersStore'

function wrapper(managers: unknown) {
  return ({ children }: { children: ReactNode }) => (
    <ManagersProvider managers={managers as never}>{children}</ManagersProvider>
  )
}

describe('usePeers — запрос недостающих карточек', () => {
  beforeEach(() => { usePeersStore.setState({ byId: {} }) })

  it('спрашивает у воркера ровно те id, которых нет в сторе', async () => {
    usePeersStore.setState({ byId: { 2: { id: 2, username: 'bob', displayName: 'Боб', avatarUrl: '' } } })
    const asked: number[][] = []
    const managers = { peers: { fillMirror: async (ids: number[]) => { asked.push(ids) } } }

    renderHook(() => usePeers([2, 3]), { wrapper: wrapper(managers) })
    await act(async () => {})

    expect(asked).toEqual([[3]])
  })

  it('хук сам в стор не пишет — это делает проектор по операции', async () => {
    const managers = { peers: { fillMirror: async () => {} } }

    renderHook(() => usePeers([3]), { wrapper: wrapper(managers) })
    await act(async () => {})

    expect(usePeersStore.getState().byId[3]).toBeUndefined()
  })
})
