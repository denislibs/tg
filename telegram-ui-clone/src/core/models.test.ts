// src/core/models.test.ts
import { describe, it, expect } from 'vitest'
import { mapDialog, mapMessage, type RawDialog, type RawMessage } from './models'

describe('mapDialog', () => {
  it('maps a private dialog with peer + last_message', () => {
    const raw: RawDialog = {
      chat_id: 1, type: 'private', last_read_seq: 4, peer_read_seq: 3, unread: 2, muted: false,
      peer: { id: 2, display_name: 'Bob', avatar_url: '' },
      last_message: { seq: 4, text: 'hi', sender_id: 2, at: '2026-06-24T10:00:00Z' },
    }
    const d = mapDialog(raw)
    expect(d).toEqual({
      chatId: 1, type: 'private', lastReadSeq: 4, peerReadSeq: 3, unread: 2, muted: false, pinned: false, archived: false,
      notifyPreview: true, notifySound: 'default',
      autoDeletePeriod: 0, title: undefined, username: undefined, photoUrl: undefined,
      peer: { id: 2, displayName: 'Bob', avatarUrl: '', verified: undefined, premium: undefined, emojiStatus: undefined },
      lastMessage: {
        seq: 4, text: 'hi', senderId: 2, at: '2026-06-24T10:00:00Z',
        mediaId: undefined, mediaType: undefined, forwarded: undefined, senderName: undefined,
      },
    })
  })

  it('handles missing peer / last_message / muted', () => {
    const d = mapDialog({ chat_id: 7, type: 'group', last_read_seq: 0, unread: 0 })
    expect(d.peer).toBeUndefined()
    expect(d.lastMessage).toBeUndefined()
    expect(d.muted).toBe(false)
  })

  it('maps unread_reactions → unreadReactions (undefined when 0/absent)', () => {
    expect(mapDialog({ chat_id: 1, type: 'private', last_read_seq: 0, unread: 0, unread_reactions: 3 }).unreadReactions).toBe(3)
    expect(mapDialog({ chat_id: 1, type: 'private', last_read_seq: 0, unread: 0, unread_reactions: 0 }).unreadReactions).toBeUndefined()
    expect(mapDialog({ chat_id: 1, type: 'private', last_read_seq: 0, unread: 0 }).unreadReactions).toBeUndefined()
  })
})

describe('mapMessage', () => {
  it('maps a raw message and computes seq/ids', () => {
    const raw: RawMessage = {
      id: 10, chat_id: 1, seq: 5, sender_id: 1, type: 'text', text: 'hello',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T10:01:00Z',
    }
    expect(mapMessage(raw)).toEqual({
      id: 10, chatId: 1, seq: 5, senderId: 1, type: 'text', text: 'hello',
      replyToId: null, mediaId: null, createdAt: '2026-06-24T10:01:00Z', threadRootId: null,
      groupedId: null, editedAt: null, deleted: false,
      fwdFromUserId: null, fwdFromChatId: null, fwdFromMsgId: null, fwdDate: null,
      replyTo: null,
    })
  })

  it('maps thread_root_id to threadRootId', () => {
    const raw: RawMessage = {
      id: 11, chat_id: 99, seq: 1, sender_id: 1, type: 'text', text: 'c',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T10:01:00Z', thread_root_id: 5,
    }
    expect(mapMessage(raw).threadRootId).toBe(5)
  })

  it('defaults threadRootId to null when thread_root_id absent', () => {
    const raw: RawMessage = {
      id: 12, chat_id: 1, seq: 2, sender_id: 1, type: 'text', text: 'x',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T10:01:00Z',
    }
    expect(mapMessage(raw).threadRootId).toBeNull()
  })
})
