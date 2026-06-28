// src/stores/chatsStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useChatsStore, loadChats } from './chatsStore'
import type { Dialog } from '../core/models'

const dialogs: Dialog[] = [
  { chatId: 1, type: 'private', lastReadSeq: 0, peerReadSeq: 0, unread: 0, muted: false,
    peer: { id: 2, displayName: 'Bob', avatarUrl: '' } },
]

function fakeManagers(over: Partial<{ me: unknown; dialogs: Dialog[] }> = {}) {
  return {
    auth: { me: async () => over.me ?? { id: 7, phone: '+1', display_name: 'Me' } },
    chats: { listDialogs: async () => over.dialogs ?? dialogs },
  }
}

describe('chatsStore', () => {
  beforeEach(() => useChatsStore.setState({ dialogs: [], meId: null, loaded: false }))

  it('loadChats populates dialogs + meId', async () => {
    await loadChats(fakeManagers() as never)
    const s = useChatsStore.getState()
    expect(s.meId).toBe(7)
    expect(s.dialogs).toHaveLength(1)
    expect(s.loaded).toBe(true)
  })

  it('upsertDialogs replaces an existing dialog by chatId, prepends new', () => {
    useChatsStore.setState({ dialogs })
    useChatsStore.getState().upsertDialog({
      chatId: 1, type: 'private', lastReadSeq: 5, peerReadSeq: 0, unread: 1, muted: false,
    })
    expect(useChatsStore.getState().dialogs[0].lastReadSeq).toBe(5)
    expect(useChatsStore.getState().dialogs).toHaveLength(1)
  })

  it('applyNewMessage bumps preview, unread (incoming, not active), moves to top', () => {
    useChatsStore.setState({ dialogs: [
      { chatId: 1, type: 'private', lastReadSeq: 0, peerReadSeq: 0, unread: 0, muted: false },
      { chatId: 2, type: 'private', lastReadSeq: 0, peerReadSeq: 0, unread: 0, muted: false },
    ], meId: 7, activeChatId: null })
    useChatsStore.getState().applyNewMessage({ chat_id: 2, msg_id: 9, seq: 4, sender_id: 5, type: 'text', text: 'yo', media_id: null, created_at: 'now' })
    const s = useChatsStore.getState()
    expect(s.dialogs[0].chatId).toBe(2)
    expect(s.dialogs[0].unread).toBe(1)
    expect(s.dialogs[0].lastMessage?.text).toBe('yo')
  })

  it('applyNewMessage does not bump unread for my own message or the active chat', () => {
    useChatsStore.setState({ dialogs: [{ chatId: 2, type: 'private', lastReadSeq: 0, peerReadSeq: 0, unread: 0, muted: false }], meId: 7, activeChatId: 2 })
    useChatsStore.getState().applyNewMessage({ chat_id: 2, msg_id: 9, seq: 4, sender_id: 5, type: 'text', text: 'hi', media_id: null, created_at: 'now' })
    expect(useChatsStore.getState().dialogs[0].unread).toBe(0)
  })

  it('setDialogMuted flips muted on the matching dialog only', () => {
    useChatsStore.setState({ dialogs: [
      { chatId: 1, type: 'group', lastReadSeq: 0, peerReadSeq: 0, unread: 0, muted: false },
      { chatId: 2, type: 'group', lastReadSeq: 0, peerReadSeq: 0, unread: 0, muted: false },
    ] })
    useChatsStore.getState().setDialogMuted(1, true)
    const s = useChatsStore.getState()
    expect(s.dialogs[0].muted).toBe(true)
    expect(s.dialogs[1].muted).toBe(false)
  })

  it('setDialogMuted is a no-op for an unknown chatId', () => {
    useChatsStore.setState({ dialogs: [{ chatId: 1, type: 'group', lastReadSeq: 0, peerReadSeq: 0, unread: 0, muted: false }] })
    useChatsStore.getState().setDialogMuted(99, true)
    expect(useChatsStore.getState().dialogs[0].muted).toBe(false)
  })

  it('applyRead from me clears unread', () => {
    useChatsStore.setState({ dialogs: [{ chatId: 2, type: 'private', lastReadSeq: 0, peerReadSeq: 0, unread: 3, muted: false }], meId: 7 })
    useChatsStore.getState().applyRead({ chat_id: 2, user_id: 7, up_to_seq: 9 })
    expect(useChatsStore.getState().dialogs[0].unread).toBe(0)
    expect(useChatsStore.getState().dialogs[0].lastReadSeq).toBe(9)
  })

  it('applyRead from the peer advances peerReadSeq (not my unread)', () => {
    useChatsStore.setState({ dialogs: [{ chatId: 2, type: 'private', lastReadSeq: 0, peerReadSeq: 0, unread: 3, muted: false }], meId: 7 })
    useChatsStore.getState().applyRead({ chat_id: 2, user_id: 5, up_to_seq: 9 })
    const d = useChatsStore.getState().dialogs[0]
    expect(d.peerReadSeq).toBe(9) // peer's read horizon advanced → out ticks become ✓✓
    expect(d.unread).toBe(3) // my unread untouched by the peer's read
    // a stale (lower) peer read must not regress it
    useChatsStore.getState().applyRead({ chat_id: 2, user_id: 5, up_to_seq: 4 })
    expect(useChatsStore.getState().dialogs[0].peerReadSeq).toBe(9)
  })
})
