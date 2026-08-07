import { describe, it, expect } from 'vitest'
import { mapMessage, type RawMessage } from './models'

// Маппинг recent_user_ids (бэк) → recent (клиент) для аватаров реагировавших.
describe('mapMessage — реакции с recent_user_ids', () => {
  const base = {
    id: 1, chat_id: 2, seq: 1, sender_id: 3, type: 'text', text: 'hi', created_at: 0,
  }

  it('пробрасывает recent_user_ids в recent', () => {
    const raw = { ...base, reactions: [{ emoji: '👍', count: 2, mine: true, recent_user_ids: [7, 8] }] } as unknown as RawMessage
    const m = mapMessage(raw)
    expect(m.reactions?.[0]).toEqual({ emoji: '👍', count: 2, mine: true, recent: [7, 8] })
  })

  it('recent = undefined когда бэк не прислал список', () => {
    const raw = { ...base, reactions: [{ emoji: '❤️', count: 1 }] } as unknown as RawMessage
    const m = mapMessage(raw)
    expect(m.reactions?.[0].recent).toBeUndefined()
    expect(m.reactions?.[0].mine).toBe(false)
  })
})
