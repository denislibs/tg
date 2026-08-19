import { describe, it, expect } from 'vitest'
import { mapMessage, type RawMessage } from './models'

// Маппинг recent-карточек {id,name,avatar} (бэк) → recent {id,name,avatarUrl}
// (клиент) для аватаров реагировавших.
describe('mapMessage — реакции с recent (карточки реагировавших)', () => {
  const base = {
    id: 1, peer_id: 2, seq: 1, sender_id: 3, type: 'text', text: 'hi', created_at: 0,
  }

  it('пробрасывает recent-карточки (avatar → avatarUrl, пустой → undefined)', () => {
    const raw = { ...base, reactions: [{
      emoji: '👍', count: 2, mine: true,
      recent: [{ id: 7, name: 'Ann', avatar: '/media/1/content' }, { id: 8, name: 'Bob', avatar: '' }],
    }] } as unknown as RawMessage
    const m = mapMessage(raw)
    expect(m.reactions?.[0]).toEqual({
      emoji: '👍', count: 2, mine: true,
      recent: [{ id: 7, name: 'Ann', avatarUrl: '/media/1/content' }, { id: 8, name: 'Bob', avatarUrl: undefined }],
    })
  })

  it('recent = undefined когда бэк не прислал список', () => {
    const raw = { ...base, reactions: [{ emoji: '❤️', count: 1 }] } as unknown as RawMessage
    const m = mapMessage(raw)
    expect(m.reactions?.[0].recent).toBeUndefined()
    expect(m.reactions?.[0].mine).toBe(false)
  })
})
