import { describe, it, expect } from 'vitest'
import { mapMessage, type RawMessage } from './models'

// `recent` на проводе — вектор `Peer` (ссылок на пиров), как
// `recent_reactions:Vector<MessagePeerReaction>` в схеме; клиент выводит из него
// ЗНАКОВЫЙ ключ и берёт имя/фото из своего кэша пиров. Прежние мини-карточки
// `{id, name, avatar}` были третьей формой пользователя на проводе.
describe('mapMessage — реакции: вектор Peer → ключи пиров', () => {
  const base = {
    id: 1, peer_id: 2, seq: 1, sender_id: 3, type: 'text', text: 'hi', created_at: 0,
  }

  it('peerUser → положительный ключ, peerChannel → ОТРИЦАТЕЛЬНЫЙ (реагировать может и канал)', () => {
    const raw = { ...base, reactions: [{
      emoji: '👍', count: 2, mine: true,
      recent: [{ _: 'peerUser', user_id: 7 }, { _: 'peerChannel', channel_id: 8 }],
    }] } as unknown as RawMessage
    const m = mapMessage(raw)
    expect(m.reactions?.[0]).toEqual({ emoji: '👍', count: 2, mine: true, recent: [7, -8] })
  })

  it('recent = undefined когда бэк не прислал список', () => {
    const raw = { ...base, reactions: [{ emoji: '❤️', count: 1 }] } as unknown as RawMessage
    const m = mapMessage(raw)
    expect(m.reactions?.[0].recent).toBeUndefined()
    expect(m.reactions?.[0].mine).toBe(false)
  })
})
