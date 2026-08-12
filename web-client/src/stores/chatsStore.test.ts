// src/stores/chatsStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useChatsStore, loadChats } from './chatsStore'
import type { Dialog } from '../core/models'

const dialogs: Dialog[] = [
  { chatId: 1, type: 'private', lastReadSeq: 0, peerReadSeq: 0, unread: 0, muted: false, pinned: false, archived: false,
    peer: { id: 2, displayName: 'Bob', avatarUrl: '' } },
]

function fakeManagers(over: Partial<{ me: unknown; dialogs: Dialog[] }> = {}) {
  return {
    auth: { me: async () => over.me ?? { id: 7, phone: '+1', display_name: 'Me' } },
    chats: { listDialogs: async () => over.dialogs ?? dialogs },
  }
}

// Task 3 (перенос владения диалогами): applyNewMessage/applyRead/bumpUnreadReactions
// отсюда убраны — их тела переехали в core/managers/dialogsManager.ts, тесты на них —
// в dialogsManager.test.ts (describe «realtime-кадры применяет владелец»).
// Task 4 (действия без оптимистики): setDialogMuted (и setDialogPinned/
// setDialogTheme/setDialogArchived) отсюда тоже убраны — тела переехали во
// владельца (dialogsManager.applyMute/applyPinned/applyTheme/applyArchived),
// тесты на них — dialogsManager.test.ts (describe «действия без оптимистики»).
// Здесь остаётся только loadChats (me/дефолтная гидрация).
describe('chatsStore', () => {
  beforeEach(() => useChatsStore.setState({ dialogs: [], meId: null, loaded: false }))

  it('loadChats populates dialogs + meId', async () => {
    await loadChats(fakeManagers() as never)
    const s = useChatsStore.getState()
    expect(s.meId).toBe(7)
    expect(s.dialogs).toHaveLength(1)
    expect(s.loaded).toBe(true)
  })
})
