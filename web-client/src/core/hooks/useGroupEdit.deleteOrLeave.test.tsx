// Fix (ревью Task 4, Important): self-leave (deleteOrLeave у не-создателя) шёл
// через removeMember(chatId, me.id) и ждал WS-кадр chat_removed — в отличие от
// deleteGroup (который сам зовёт dialogs.applyRemoved после успеха,
// groupsManager.ts) и от tweb (appChatsManager.leaveChat/leaveChannel зовут
// onChatUpdated тем же путём, что deleteChannel). Здесь контекст однозначен
// (userId===me.id — я сам ухожу, не кик другого участника), поэтому
// deleteOrLeave обязан звать managers.dialogs.applyRemoved(chatId) сразу после
// успешного removeMember — не дожидаясь WS-круга.
import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useGroupEdit } from './useGroupEdit'
import { ManagersProvider } from './useManagers'

const CHAT_ID = 5

function wrapper(managers: unknown) {
  return ({ children }: { children: ReactNode }) => (
    <ManagersProvider managers={managers as never}>{children}</ManagersProvider>
  )
}

// Обычный участник (нет `pFlags.creator`, нет `admin_rights`) → deleteOrLeave
// идёт self-leave-веткой (removeMember), а не deleteGroup; админских разделов
// нет — mount-эффект не зовёт listInvites/listBans/listRestrictions, фейку не
// нужно их отдавать.
function fakeManagers(overrides: { removeMember?: () => Promise<void>; applyRemoved?: () => Promise<void> } = {}) {
  return {
    groups: {
      // Карточка — ПАРА конструкторов (`channel` + `channelFull`), как её
      // отдаёт владелец: роли отдельным полем больше нет.
      card: async () => ({
        peerId: -CHAT_ID,
        chat: {
          _: 'channel', id: CHAT_ID, title: 't',
          photo: { _: 'chatPhotoEmpty' }, date: 0,
          pFlags: { megagroup: true }, participants_count: 2,
        },
        fullChat: {
          _: 'channelFull', id: CHAT_ID, about: '',
          read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null,
        },
        muted: false, creatorId: 1,
      }),
      members: async () => [],
      removeMember: overrides.removeMember ?? vi.fn(async () => {}),
      deleteGroup: vi.fn(async () => { throw new Error('deleteGroup не должен зваться в self-leave ветке') }),
    },
    peers: { getUsers: async () => [] },
    // Своя личность — ПАРА конструкторов (`user` + `userFull`), та же, что у
    // любого профиля: третьей формы «свой пользователь» больше нет.
    auth: { me: async () => ({ user: { _: 'user', id: 7, phone: '+1', first_name: 'Me' }, fullUser: { _: 'userFull', id: 7 }, canMessage: true }) },
    dialogs: { applyRemoved: overrides.applyRemoved ?? vi.fn(async () => {}), refresh: vi.fn(async () => {}) },
  }
}

describe('useGroupEdit: deleteOrLeave (self-leave) — действия без оптимистики (Task 4)', () => {
  it('успешный self-leave зовёт dialogs.applyRemoved СРАЗУ после removeMember — не дожидаясь WS chat_removed', async () => {
    const applyRemoved = vi.fn(async () => {})
    const managers = fakeManagers({ applyRemoved })

    const { result } = renderHook(() => useGroupEdit(CHAT_ID), { wrapper: wrapper(managers) })
    await waitFor(() => expect(result.current.card).not.toBeNull())

    await act(async () => { await result.current.deleteOrLeave() })

    expect(managers.dialogs.applyRemoved).toHaveBeenCalledWith(CHAT_ID)
    expect(managers.groups.deleteGroup).not.toHaveBeenCalled()
  })

  it('провалившийся removeMember — dialogs.applyRemoved НЕ зовётся', async () => {
    const removeMember = vi.fn(async () => { throw new Error('offline') })
    const applyRemoved = vi.fn(async () => {})
    const managers = fakeManagers({ removeMember, applyRemoved })

    const { result } = renderHook(() => useGroupEdit(CHAT_ID), { wrapper: wrapper(managers) })
    await waitFor(() => expect(result.current.card).not.toBeNull())

    await expect(act(async () => { await result.current.deleteOrLeave() })).rejects.toThrow('offline')

    expect(managers.dialogs.applyRemoved).not.toHaveBeenCalled()
  })
})
