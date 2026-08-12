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
// в dialogsManager.test.ts (describe «realtime-кадры применяет владелец»). Здесь
// остаются mute-мутатор (легаси-путь, Task 4) и loadChats (me/дефолтная гидрация).
describe('chatsStore', () => {
  beforeEach(() => useChatsStore.setState({ dialogs: [], meId: null, loaded: false }))

  it('loadChats populates dialogs + meId', async () => {
    await loadChats(fakeManagers() as never)
    const s = useChatsStore.getState()
    expect(s.meId).toBe(7)
    expect(s.dialogs).toHaveLength(1)
    expect(s.loaded).toBe(true)
  })

  it('setDialogMuted flips muted on the matching dialog only', () => {
    useChatsStore.setState({ dialogs: [
      { chatId: 1, type: 'group', lastReadSeq: 0, peerReadSeq: 0, unread: 0, muted: false, pinned: false, archived: false },
      { chatId: 2, type: 'group', lastReadSeq: 0, peerReadSeq: 0, unread: 0, muted: false, pinned: false, archived: false },
    ] })
    useChatsStore.getState().setDialogMuted(1, true)
    // Ищем по chatId, а не по позиции: порядок теперь производный (dialogIndex),
    // и у диалогов без lastMessage ничью разводит chatId — «первый» тут не chatId 1.
    const s = useChatsStore.getState()
    expect(s.dialogs.find((d) => d.chatId === 1)?.muted).toBe(true)
    expect(s.dialogs.find((d) => d.chatId === 2)?.muted).toBe(false)
  })

  it('setDialogMuted is a no-op for an unknown chatId', () => {
    useChatsStore.setState({ dialogs: [{ chatId: 1, type: 'group', lastReadSeq: 0, peerReadSeq: 0, unread: 0, muted: false, pinned: false, archived: false }] })
    useChatsStore.getState().setDialogMuted(99, true)
    expect(useChatsStore.getState().dialogs[0].muted).toBe(false)
  })
})
