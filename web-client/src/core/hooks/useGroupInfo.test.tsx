// Пункт 6 задачи 13 плана `docs/superpowers/plans/2026-09-07-solid-wave-3-shared-media.md`:
// список участников грузит САМ класс `AppSearchSuper` (`loadMembers` →
// `groups.channelParticipants`), а не хук панели. Здесь пин на то, что хук
// плоский `groups.members` для профиля больше НЕ дёргает — иначе один и тот же
// список ходил бы по сети дважды, из двух владельцев. Мутация «вернуть
// `managers.groups.members(numericId)` в эффект» красит первый тест.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Managers } from '@/client/bootstrap'
import type { Chat } from '@/data'
import { ManagersProvider } from './useManagers'
import { useGroupInfo } from './useGroupInfo'

const GROUP: Chat = { id: '77', type: 'group', name: 'Кружок', avatar: '', avatarText: 'К' } as unknown as Chat

function makeManagers() {
  const members = vi.fn(async () => [])
  const managers = {
    groups: {
      card: vi.fn(async () => null),
      members,
      listInvites: vi.fn(async () => []),
      listJoinRequests: vi.fn(async () => []),
    },
    peers: { getUsers: vi.fn(async () => []) },
    channels: {},
  } as unknown as Managers
  return { managers, members }
}

afterEach(() => cleanup())

describe('useGroupInfo — участников грузит класс, не хук', () => {
  it('groups.members не вызывается ни на маунте, ни после ответа карточки', async () => {
    const { managers, members } = makeManagers()
    const wrapper = ({ children }: { children: ReactNode }) => <ManagersProvider managers={managers}>{children}</ManagersProvider>
    renderHook(() => useGroupInfo(GROUP), { wrapper })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(members).not.toHaveBeenCalled()
  })

  it('в результате хука нет ни realMembers, ни refreshMembers', async () => {
    const { managers } = makeManagers()
    const wrapper = ({ children }: { children: ReactNode }) => <ManagersProvider managers={managers}>{children}</ManagersProvider>
    const { result } = renderHook(() => useGroupInfo(GROUP), { wrapper })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(result.current).not.toHaveProperty('realMembers')
    expect(result.current).not.toHaveProperty('refreshMembers')
  })
})
