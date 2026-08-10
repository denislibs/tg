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
      chatId: 1, type: 'private', lastReadSeq: 5, peerReadSeq: 0, unread: 1, muted: false, pinned: false, archived: false,
    })
    expect(useChatsStore.getState().dialogs[0].lastReadSeq).toBe(5)
    expect(useChatsStore.getState().dialogs).toHaveLength(1)
  })

  it('applyNewMessage bumps preview, unread (incoming, not active), moves to top', () => {
    // У chatId 1 более свежая дата: без бампа он и остался бы сверху (порядок —
    // производная от lastMessage.at, см. chatsStore.order.test.ts).
    useChatsStore.setState({ dialogs: [
      { chatId: 1, type: 'private', lastReadSeq: 0, peerReadSeq: 0, unread: 0, muted: false, pinned: false, archived: false,
        lastMessage: { seq: 1, text: 'x', senderId: 5, at: '2026-08-09T12:00:00Z' } },
      { chatId: 2, type: 'private', lastReadSeq: 0, peerReadSeq: 0, unread: 0, muted: false, pinned: false, archived: false,
        lastMessage: { seq: 1, text: 'x', senderId: 5, at: '2026-08-09T10:00:00Z' } },
    ], meId: 7, activeChatId: null })
    useChatsStore.getState().applyNewMessage({ chat_id: 2, msg_id: 9, seq: 4, sender_id: 5, type: 'text', text: 'yo', media_id: null, created_at: '2026-08-09T13:00:00Z' })
    const s = useChatsStore.getState()
    expect(s.dialogs[0].chatId).toBe(2)
    expect(s.dialogs[0].unread).toBe(1)
    expect(s.dialogs[0].lastMessage?.text).toBe('yo')
  })

  it('applyNewMessage does not bump unread for my own message or the active chat', () => {
    useChatsStore.setState({ dialogs: [{ chatId: 2, type: 'private', lastReadSeq: 0, peerReadSeq: 0, unread: 0, muted: false, pinned: false, archived: false }], meId: 7, activeChatId: 2 })
    useChatsStore.getState().applyNewMessage({ chat_id: 2, msg_id: 9, seq: 4, sender_id: 5, type: 'text', text: 'hi', media_id: null, created_at: 'now' })
    expect(useChatsStore.getState().dialogs[0].unread).toBe(0)
  })

  it('applyNewMessage takes unread from the frame verbatim (Wave 3 projection)', () => {
    useChatsStore.setState({ dialogs: [{ chatId: 2, type: 'private', lastReadSeq: 0, peerReadSeq: 0, unread: 0, muted: false, pinned: false, archived: false }], meId: 7, activeChatId: null })
    // server-authoritative unread=5 wins over the local +1
    useChatsStore.getState().applyNewMessage({ chat_id: 2, msg_id: 9, seq: 4, sender_id: 5, type: 'text', text: 'yo', media_id: null, created_at: 'now', unread: 5 })
    expect(useChatsStore.getState().dialogs[0].unread).toBe(5)
  })

  it('applyNewMessage falls back to local +1 when the frame omits unread', () => {
    useChatsStore.setState({ dialogs: [{ chatId: 2, type: 'private', lastReadSeq: 0, peerReadSeq: 0, unread: 2, muted: false, pinned: false, archived: false }], meId: 7, activeChatId: null })
    useChatsStore.getState().applyNewMessage({ chat_id: 2, msg_id: 9, seq: 4, sender_id: 5, type: 'text', text: 'yo', media_id: null, created_at: 'now' })
    expect(useChatsStore.getState().dialogs[0].unread).toBe(3)
  })

  it('applyRead takes unread from the frame verbatim (fallback 0)', () => {
    useChatsStore.setState({ dialogs: [{ chatId: 2, type: 'private', lastReadSeq: 0, peerReadSeq: 0, unread: 5, muted: false, pinned: false, archived: false }], meId: 7 })
    useChatsStore.getState().applyRead({ chat_id: 2, user_id: 7, up_to_seq: 3, unread: 2 })
    expect(useChatsStore.getState().dialogs[0].unread).toBe(2)
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

  it('applyRead from me clears unread', () => {
    useChatsStore.setState({ dialogs: [{ chatId: 2, type: 'private', lastReadSeq: 0, peerReadSeq: 0, unread: 3, muted: false, pinned: false, archived: false }], meId: 7 })
    useChatsStore.getState().applyRead({ chat_id: 2, user_id: 7, up_to_seq: 9 })
    expect(useChatsStore.getState().dialogs[0].unread).toBe(0)
    expect(useChatsStore.getState().dialogs[0].lastReadSeq).toBe(9)
  })

  it('applyRead from the peer advances peerReadSeq (not my unread)', () => {
    useChatsStore.setState({ dialogs: [{ chatId: 2, type: 'private', lastReadSeq: 0, peerReadSeq: 0, unread: 3, muted: false, pinned: false, archived: false }], meId: 7 })
    useChatsStore.getState().applyRead({ chat_id: 2, user_id: 5, up_to_seq: 9 })
    const d = useChatsStore.getState().dialogs[0]
    expect(d.peerReadSeq).toBe(9) // peer's read horizon advanced → out ticks become ✓✓
    expect(d.unread).toBe(3) // my unread untouched by the peer's read
    // a stale (lower) peer read must not regress it
    useChatsStore.getState().applyRead({ chat_id: 2, user_id: 5, up_to_seq: 4 })
    expect(useChatsStore.getState().dialogs[0].peerReadSeq).toBe(9)
  })

  it('bumpUnreadReactions increments the dialog reactions badge', () => {
    useChatsStore.setState({ dialogs: [{ chatId: 2, type: 'private', lastReadSeq: 0, peerReadSeq: 0, unread: 0, muted: false, pinned: false, archived: false }], meId: 7 })
    useChatsStore.getState().bumpUnreadReactions(2)
    expect(useChatsStore.getState().dialogs[0].unreadReactions).toBe(1)
    useChatsStore.getState().bumpUnreadReactions(2)
    expect(useChatsStore.getState().dialogs[0].unreadReactions).toBe(2)
  })

  it('applyRead from me clears the reactions badge too', () => {
    useChatsStore.setState({ dialogs: [{ chatId: 2, type: 'private', lastReadSeq: 0, peerReadSeq: 0, unread: 3, unreadReactions: 2, muted: false, pinned: false, archived: false }], meId: 7 })
    useChatsStore.getState().applyRead({ chat_id: 2, user_id: 7, up_to_seq: 9 })
    expect(useChatsStore.getState().dialogs[0].unreadReactions).toBe(0)
  })
})
