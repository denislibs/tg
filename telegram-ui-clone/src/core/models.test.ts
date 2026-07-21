// src/core/models.test.ts
import { describe, it, expect } from 'vitest'
import { mapDialog, mapDraft, mapMessage, type RawDialog, type RawMessage } from './models'

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

  it('maps a valid effect and drops unknown/empty effects', () => {
    const mk = (effect: string | null | undefined): RawMessage => ({
      id: 20, chat_id: 1, seq: 6, sender_id: 1, type: 'text', text: 'party',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T10:01:00Z', effect,
    })
    expect(mapMessage(mk('confetti')).effect).toBe('confetti')
    expect(mapMessage(mk('fireworks')).effect).toBe('fireworks')
    // вне whitelist / пусто → undefined
    expect(mapMessage(mk('boom')).effect).toBeUndefined()
    expect(mapMessage(mk('')).effect).toBeUndefined()
    expect(mapMessage(mk(null)).effect).toBeUndefined()
    expect(mapMessage(mk(undefined)).effect).toBeUndefined()
  })

  it('maps web_page (server link preview) to webPage', () => {
    const raw: RawMessage = {
      id: 13, chat_id: 1, seq: 3, sender_id: 1, type: 'text', text: 'https://example.com',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T10:01:00Z',
      web_page: { url: 'https://example.com', site_name: 'Example', title: 'Заголовок', description: 'Описание', image_url: 'https://example.com/og.png' },
    }
    expect(mapMessage(raw).webPage).toEqual({
      url: 'https://example.com', siteName: 'Example', title: 'Заголовок',
      description: 'Описание', imageUrl: 'https://example.com/og.png',
    })
  })

  it('drops empty web_page fields and defaults webPage to undefined', () => {
    const base = {
      id: 14, chat_id: 1, seq: 4, sender_id: 1, type: 'text', text: 'x',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T10:01:00Z',
    }
    expect(mapMessage({ ...base }).webPage).toBeUndefined()
    expect(mapMessage({ ...base, web_page: null }).webPage).toBeUndefined()
    const wp = mapMessage({ ...base, web_page: { title: 't' } }).webPage
    expect(wp).toEqual({ url: undefined, siteName: '', title: 't', description: undefined, imageUrl: undefined })
  })
})

describe('mapDraft', () => {
  it('maps entities and reply_to_id (draft_update frame / GET /drafts)', () => {
    const d = mapDraft({
      chat_id: 3, text: '**жирный**',
      entities: [{ type: 'bold', offset: 0, length: 6 }],
      reply_to_id: 42, updated_at: '2026-07-21T10:00:00Z',
    })
    expect(d).toEqual({
      chatId: 3, text: '**жирный**',
      entities: [{ type: 'bold', offset: 0, length: 6 }],
      replyToId: 42, updatedAt: '2026-07-21T10:00:00Z',
    })
  })

  it('defaults absent/null entities and reply_to_id', () => {
    const d = mapDraft({ chat_id: 3, text: 'x', entities: null, reply_to_id: null, updated_at: 't' })
    expect(d.entities).toBeUndefined()
    expect(d.replyToId).toBeNull()
    const d2 = mapDraft({ chat_id: 3, text: 'x', updated_at: 't' })
    expect(d2.entities).toBeUndefined()
    expect(d2.replyToId).toBeNull()
  })

  it('drops an empty entities array', () => {
    expect(mapDraft({ chat_id: 1, text: 'x', entities: [], updated_at: 't' }).entities).toBeUndefined()
  })
})
