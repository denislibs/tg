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

// myRole:'member' (не creator/admin) → deleteOrLeave идёт self-leave-веткой
// (removeMember), а не deleteGroup; canInvite=false — мount-эффект не зовёт
// listInvites/listBans/listRestrictions, фейку не нужно их отдавать.
function fakeManagers(overrides: { removeMember?: () => Promise<void>; applyRemoved?: () => Promise<void> } = {}) {
  return {
    groups: {
      card: async () => ({
        id: CHAT_ID, type: 'group', title: 't', username: '', about: '',
        memberCount: 2, isPublic: false, myRole: 'member', myRights: 0, discussionChatId: 0,
        defaultPermissions: 31, slowmodeSeconds: 0, reactionsMode: 'all', reactionsAllowed: [],
        historyForNew: true, chargeStars: 0, signatures: false, signatureProfiles: false, muted: false,
      }),
      members: async () => [],
      removeMember: overrides.removeMember ?? vi.fn(async () => {}),
      deleteGroup: vi.fn(async () => { throw new Error('deleteGroup не должен зваться в self-leave ветке') }),
    },
    peers: { getUsers: async () => [] },
    auth: { me: async () => ({ id: 7, phone: '+1', username: null, firstName: '', lastName: '', displayName: 'Me', bio: '', birthday: null, avatarUrl: '', avatarPreview: '', phoneVisibility: 'contacts', premium: false, emojiStatus: '' }) },
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
