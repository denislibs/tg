// Мелкие витрины чата на конструкторах схемы.
//
// Все четыре ехали безымянными обёртками вокруг одного значения, и ни одну из
// них не читал ни один тест: полный прогон оставался зелёным на смене формы.
// Пины держат ровно то, что в этих ответах теперь есть тип — и что даты
// читаются в СЕКУНДАХ эпохи, а не строкой.
import { describe, expect, it, vi } from 'vitest'
import type { RestClient } from '../net/restClient'

import { newChatsManager } from './chatsManager'
import { newPrivacyManager } from './privacyManager'
import { newTranslationMethods } from './messages/translationMethods'
import { newReactionMethods } from './messages/reactionMethods'
import type { MessagesCtx } from './messages/ctx'

describe('мелкие витрины чата — конструкторы, а не обёртки', () => {
  it('период автоудаления читается из defaultHistoryTTL', async () => {
    const get = vi.fn(async () => ({ _: 'defaultHistoryTTL', period: 86400 }))
    const mgr = newPrivacyManager({ rest: { get } as unknown as RestClient })

    expect(await mgr.autoDelete()).toBe(86400)
    expect(get).toHaveBeenCalledWith('/me/auto_delete')
  })

  it('«когда прочитали моё» читается из outboxReadDate — СЕКУНДЫ эпохи', async () => {
    const get = vi.fn(async () => ({ _: 'outboxReadDate', date: 1787334148 }))
    const mgr = newChatsManager({ rest: { get } as unknown as RestClient } as never)

    const r = await mgr.getReadDate(5, 7)

    expect(r).toEqual({ readAt: new Date(1787334148 * 1000).toISOString() })
  })

  it('перевод читается из ВЕКТОРА строк, а не из пары {text, source}', async () => {
    const post = vi.fn(async () => ({ _: 'messages.translateResult', result: [{ _: 'textWithEntities', text: 'привет' }] }))
    const m = newTranslationMethods({ rest: { post } as unknown as RestClient, patchMsg: () => {} } as unknown as MessagesCtx)

    expect(await m.translate('hi', 'ru')).toEqual({ text: 'привет', source: '' })
  })

  it('«ещё расшифровывается» — ФЛАГ конструктора, а не булево поле', async () => {
    const done = vi.fn(async () => ({ _: 'messages.transcribedAudio', text: 'раз' }))
    const m1 = newTranslationMethods({ rest: { post: done } as unknown as RestClient, patchMsg: () => {}, opWindowsFor: () => [], emitOps: () => {} } as unknown as MessagesCtx)
    expect(await m1.transcribe(5, 7)).toEqual({ text: 'раз', pending: false })

    const pending = vi.fn(async () => ({ _: 'messages.transcribedAudio', text: '', pFlags: { pending: true } }))
    const m2 = newTranslationMethods({ rest: { post: pending } as unknown as RestClient, patchMsg: () => {}, opWindowsFor: () => [], emitOps: () => {} } as unknown as MessagesCtx)
    expect(await m2.transcribe(5, 7)).toEqual({ text: '', pending: true })
  })

  // «Кто отреагировал»: строки — ССЫЛКИ на пиры, карточки — вектором `users`.
  // Прежде карточка была вклеена в каждую строку.
  it('кто отреагировал: строка-ссылка + карточка из users', async () => {
    const user = { _: 'user', id: 9, first_name: 'Аня' }
    const get = vi.fn(async () => ({
      _: 'messages.messageReactionsList',
      count: 1,
      reactions: [{ _: 'messagePeerReaction', peer_id: { _: 'peerUser', user_id: 9 }, date: 1, reaction: { _: 'reactionEmoji', emoticon: '👍' } }],
      chats: [],
      users: [user],
    }))
    const m = newReactionMethods({ rest: { get } as unknown as RestClient, patchMsg: () => {} } as unknown as MessagesCtx)

    expect(await m.reactionUsers(5, 7)).toEqual([{ user, emoji: '👍' }])
  })

  // Реакция тега — ОБЪЕДИНЕНИЕ, а не строка эмодзи.
  it('теги «Избранного» читают реакцию из конструктора', async () => {
    const get = vi.fn(async () => ({
      _: 'messages.savedReactionTags',
      tags: [{ _: 'savedReactionTag', reaction: { _: 'reactionEmoji', emoticon: '🔥' }, title: 'важное', count: 3 }],
    }))
    const m = newReactionMethods({ rest: { get } as unknown as RestClient, patchMsg: () => {} } as unknown as MessagesCtx)

    expect(await m.getSavedTags()).toEqual([{ reaction: '🔥', title: 'важное', count: 3 }])
  })
})
