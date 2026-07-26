// src/core/dialogToChat.test.ts
import { describe, it, expect } from 'vitest'
import { dialogToChat, GRADIENTS } from './dialogToChat'
import type { Dialog } from './models'

const base: Dialog = { chatId: 1, type: 'private', lastReadSeq: 0, peerReadSeq: 0, unread: 0, muted: false, pinned: false, archived: false }

describe('dialogToChat', () => {
  it('uses peer display name + initial for private chats', () => {
    const c = dialogToChat({ ...base, peer: { id: 2, displayName: 'Bob', avatarUrl: '' } })
    expect(c.id).toBe('1')
    expect(c.name).toBe('Bob')
    expect(c.avatarText).toBe('B')
    expect(c.type).toBe('private')
  })

  it('falls back to "Chat N" for groups without a title', () => {
    const c = dialogToChat({ ...base, chatId: 9, type: 'group' })
    expect(c.name).toBe('Chat 9')
    expect(c.avatarText).toBe('C')
  })

  it('uses the group title when present', () => {
    const c = dialogToChat({ ...base, chatId: 9, type: 'group', title: 'My Group' })
    expect(c.name).toBe('My Group')
    expect(c.avatarText).toBe('M')
  })

  it('prefers a private peer display name over title', () => {
    const c = dialogToChat({
      ...base,
      peer: { id: 2, displayName: 'Bob', avatarUrl: '' },
      title: 'Ignored',
    })
    expect(c.name).toBe('Bob')
  })

  it('passes preview/date/unread from last_message', () => {
    const c = dialogToChat({
      ...base,
      unread: 3,
      lastMessage: { seq: 4, text: 'yo', senderId: 2, at: '2026-06-24T10:00:00Z' },
    })
    expect(c.preview).toBe('yo')
    expect(c.date).not.toBe('2026-06-24T10:00:00Z')
    expect(c.date.length).toBeGreaterThan(0)
    expect(c.unread).toBe(3)
  })

  it('omits unread badge when zero', () => {
    expect(dialogToChat(base).unread).toBeUndefined()
  })

  it('passes unreadReactions through only when > 0', () => {
    expect(dialogToChat({ ...base, unreadReactions: 2 }).unreadReactions).toBe(2)
    expect(dialogToChat({ ...base, unreadReactions: 0 }).unreadReactions).toBeUndefined()
    expect(dialogToChat(base).unreadReactions).toBeUndefined()
  })

  it('picks a stable gradient from the chat id', () => {
    const a = dialogToChat({ ...base, chatId: 5 })
    const b = dialogToChat({ ...base, chatId: 5 })
    expect(a.avatar).toBe(b.avatar)
    expect(GRADIENTS).toContain(a.avatar)
  })
})
