// src/core/dialogToChat.test.ts
import { describe, it, expect } from 'vitest'
import { dialogToChat, GRADIENTS } from './dialogToChat'
import { makeDialog, makeLastMessage } from './dialogs/testDialog'
import type { Chat, User } from './peers/peer'
import { MUTE_UNTIL_FOREVER } from './dialogs/notifySettings'

// Карточки пиров приезжают вектором `chats`/`users` контейнера `/chats`; здесь
// они подставляются напрямую — функция чистая и зеркало берёт аргументом.
const lookup = (map: Record<number, User | Chat>) => (id: PeerId) => map[id]
const NONE = lookup({})

describe('dialogToChat', () => {
  it('собирает имя приватного чата из конструктора user (display_name с провода убран)', () => {
    const c = dialogToChat(makeDialog({ peerId: 2 }), null, undefined,
      lookup({ 2: { _: 'user', id: 2, first_name: 'Bob' } }))
    expect(c.id).toBe('2')
    expect(c.name).toBe('Bob')
    expect(c.avatarText).toBe('B')
    expect(c.type).toBe('private')
  })

  it('без карточки пользователя — фолбэк оригинала, а не пустая строка', () => {
    const c = dialogToChat(makeDialog({ peerId: 2 }), null, undefined, NONE)
    expect(c.name).toBe('Удалённый аккаунт')
  })

  it('вид чата ВЫВОДИТСЯ из конструктора и флагов, а не приезжает строкой', () => {
    const group = makeDialog({ peerId: -9 })
    expect(dialogToChat(group, null, undefined, lookup({
      [-9]: { _: 'channel' as const, id: 9, title: 'My Group', photo: { _: 'chatPhotoEmpty' as const }, date: 0, pFlags: { megagroup: true as const } },
    })).type).toBe('group')
    expect(dialogToChat(group, null, undefined, lookup({
      [-9]: { _: 'channel' as const, id: 9, title: 'Канал', photo: { _: 'chatPhotoEmpty' as const }, date: 0, pFlags: { broadcast: true as const } },
    })).type).toBe('channel')
    // «Избранное» — пир, равный зрителю.
    expect(dialogToChat(makeDialog({ peerId: 5 }), 5, undefined, NONE).type).toBe('saved')
    // Секретный — наш параметр вне схемы (решение Р9).
    expect(dialogToChat(makeDialog({ peerId: 5, secret: true }), null, undefined, NONE).type).toBe('secret')
  })

  it('заголовок группы берётся из карточки чата, а не из строки диалога', () => {
    const c = dialogToChat(makeDialog({ peerId: -9 }), null, undefined, lookup({
      [-9]: { _: 'channel' as const, id: 9, title: 'My Group', photo: { _: 'chatPhotoEmpty' as const }, date: 0, pFlags: { megagroup: true as const } },
    }))
    expect(c.name).toBe('My Group')
    expect(c.avatarText).toBe('M')
  })

  it('группа без карточки — фолбэк «Chat N» (у чата пустое имя, не «Удалённый аккаунт»)', () => {
    const c = dialogToChat(makeDialog({ peerId: -9 }), null, undefined, NONE)
    expect(c.name).toBe('Chat -9')
  })

  it('превью/дата/непрочитанные — из ЦЕЛОГО последнего сообщения', () => {
    const c = dialogToChat(makeDialog({
      peerId: 1,
      unread: 3,
      lastMessage: makeLastMessage({ peerId: 1, seq: 4, senderId: 2, text: 'yo', createdAt: '2026-06-24T10:00:00Z' }),
    }), null, undefined, NONE)
    expect(c.preview).toBe('yo')
    expect(c.date).not.toBe('2026-06-24T10:00:00Z')
    expect(c.date.length).toBeGreaterThan(0)
    expect(c.unread).toBe(3)
  })

  it('имя автора превью в группе собирает КЛИЕНТ по пиру (sender_name с провода убран)', () => {
    const c = dialogToChat(makeDialog({
      peerId: -9,
      lastMessage: makeLastMessage({ peerId: -9, seq: 4, senderId: 77, text: 'привет' }),
    }), 1, undefined, lookup({
      [-9]: { _: 'channel' as const, id: 9, title: 'Группа', photo: { _: 'chatPhotoEmpty' as const }, date: 0, pFlags: { megagroup: true as const } },
      77: { _: 'user', id: 77, first_name: 'Аня', last_name: 'Петрова' },
    }))
    expect(c.preview).toBe('Аня: привет')
  })

  it('автора без карточки подписывает фолбэком оригинала, а не молчит', () => {
    const c = dialogToChat(makeDialog({
      peerId: -9,
      lastMessage: makeLastMessage({ peerId: -9, seq: 4, senderId: 77, text: 'привет' }),
    }), 1, undefined, lookup({
      [-9]: { _: 'channel' as const, id: 9, title: 'Группа', photo: { _: 'chatPhotoEmpty' as const }, date: 0, pFlags: { megagroup: true as const } },
    }))
    expect(c.preview).toBe('Удалён: привет')
  })

  it('«замьючен» — это СРОК, а не признак', () => {
    const now = 1_700_000_000
    expect(dialogToChat(makeDialog({ peerId: 1, muteUntil: now + 3600 }), null, undefined, NONE, now).muted).toBe(true)
    // Срок вышел — иконка гаснет сама, даже если поле в строке осталось.
    expect(dialogToChat(makeDialog({ peerId: 1, muteUntil: now - 1 }), null, undefined, NONE, now).muted).toBeUndefined()
    expect(dialogToChat(makeDialog({ peerId: 1, muteUntil: true }), null, undefined, NONE, now).muted).toBe(true)
    expect(dialogToChat(makeDialog({ peerId: 1 }), null, undefined, NONE, now).muted).toBeUndefined()
  })

  it('«навсегда» — тот же механизм, просто далёкий срок', () => {
    const d = makeDialog({ peerId: 1, muteUntil: true })
    expect(d.notify_settings.mute_until).toBe(MUTE_UNTIL_FOREVER)
  })

  it('архив — номер папки, а не булево строки', () => {
    expect(dialogToChat(makeDialog({ peerId: 1, archived: true }), null, undefined, NONE).archived).toBe(true)
    expect(dialogToChat(makeDialog({ peerId: 1 }), null, undefined, NONE).archived).toBeUndefined()
  })

  it('omits unread badge when zero', () => {
    expect(dialogToChat(makeDialog({ peerId: 1 }), null, undefined, NONE).unread).toBeUndefined()
  })

  it('passes unreadReactions through only when > 0', () => {
    expect(dialogToChat(makeDialog({ peerId: 1, unreadReactions: 2 }), null, undefined, NONE).unreadReactions).toBe(2)
    expect(dialogToChat(makeDialog({ peerId: 1, unreadReactions: 0 }), null, undefined, NONE).unreadReactions).toBeUndefined()
  })

  it('picks a stable gradient from the chat id', () => {
    const a = dialogToChat(makeDialog({ peerId: 5 }), null, undefined, NONE)
    const b = dialogToChat(makeDialog({ peerId: 5 }), null, undefined, NONE)
    expect(a.avatar).toBe(b.avatar)
    expect(GRADIENTS).toContain(a.avatar)
  })
})
