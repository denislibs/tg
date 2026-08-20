import { describe, it, expect } from 'vitest'
import { mapMyMessage, type RawMessageReal, type WireMessageReactions } from './models'
import { makeRawMessage } from './messages/testMessage'

// `recent_reactions` на проводе — вектор `messagePeerReaction`, у которого автор
// это ССЫЛКА `peer_id: Peer`; клиент выводит из неё ЗНАКОВЫЙ ключ и берёт
// имя/фото из своего кэша пиров. Прежние мини-карточки `{id, name, avatar}`
// были третьей формой пользователя на проводе, вклеенной в jsonb прямо в SQL.
describe('mapMessage — реакции: вектор Peer → ключи пиров', () => {
  const withReactions = (reactions: WireMessageReactions): RawMessageReal =>
    ({ ...makeRawMessage({ id: 1, peerId: 2, fromId: 3, text: 'hi' }), reactions })

  it('peerUser → положительный ключ, peerChannel → ОТРИЦАТЕЛЬНЫЙ (реагировать может и канал)', () => {
    const m = mapMyMessage(withReactions({
      _: 'messageReactions',
      results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 2, chosen_order: 0 }],
      recent_reactions: [
        { _: 'messagePeerReaction', peer_id: { _: 'peerUser', user_id: 7 }, date: 0, reaction: { _: 'reactionEmoji', emoticon: '👍' } },
        { _: 'messagePeerReaction', peer_id: { _: 'peerChannel', channel_id: 8 }, date: 0, reaction: { _: 'reactionEmoji', emoticon: '👍' } },
      ],
    }))
    expect(m.reactions?.[0]).toEqual({ emoji: '👍', count: 2, mine: true, recent: [7, -8] })
  })

  it('recent = undefined когда список не приехал', () => {
    const m = mapMyMessage(withReactions({
      _: 'messageReactions',
      results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '❤️' }, count: 1 }],
    }))
    expect(m.reactions?.[0].recent).toBeUndefined()
    expect(m.reactions?.[0].mine).toBe(false)
  })
})
