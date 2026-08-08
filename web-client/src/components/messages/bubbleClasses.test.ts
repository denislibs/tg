import { describe, it, expect } from 'vitest'
import { bubbleClasses, type BubbleCtx } from './bubbleClasses'
import type { ConvMsg } from '../../data'

const msg = (over: Partial<ConvMsg> = {}): ConvMsg => ({ id: 1, type: 'text', text: 'hi', time: '12:00', ...over } as ConvMsg)
const ctx = (over: Partial<BubbleCtx> = {}): BubbleCtx => ({
  out: false, firstInGroup: true, lastInGroup: true, showName: false, isChannel: false,
  isSelected: false, isHighlighted: false, isFirstUnread: false, bigEmojiCount: 0, animatedSticker: false,
  ...over,
})

describe('bubbleClasses', () => {
  it('текст исходящий, один в серии — как живой tweb (mid 21335)', () => {
    const cls = bubbleClasses(msg({ status: 'read' }), ctx({ out: true }))
    expect(cls.sort()).toEqual(['bubble', 'can-have-tail', 'hide-name', 'is-group-first', 'is-group-last', 'is-out', 'is-read'].sort())
  })

  it('входящее в середине серии — без хвоста и без границ группы', () => {
    const cls = bubbleClasses(msg(), ctx({ firstInGroup: false, lastInGroup: false }))
    expect(cls).toContain('is-in')
    expect(cls).not.toContain('can-have-tail')
    expect(cls).not.toContain('is-group-first')
  })

  it('имя показывается — hide-name не ставится', () => {
    expect(bubbleClasses(msg({ sender: 'Алиса' }), ctx({ showName: true }))).not.toContain('hide-name')
  })

  it('голосовое: min-content + is-single-document (живой tweb, mid 21397)', () => {
    const cls = bubbleClasses(msg({ type: 'voice', text: '', mediaId: 7, status: 'read' }), ctx({ out: true, firstInGroup: false }))
    expect(cls).toEqual(expect.arrayContaining(['voice-message', 'min-content', 'is-single-document', 'can-have-tail', 'is-group-last', 'is-read']))
    // у голосового тело сообщения есть (волна+время) — не is-message-empty
    expect(cls).not.toContain('is-message-empty')
    expect(cls).not.toContain('just-media')
  })

  it('стикер: just-media + is-message-empty + has-floating-time, без хвоста', () => {
    const cls = bubbleClasses(msg({ type: 'sticker', text: '', mediaId: 5 }), ctx({ out: true, animatedSticker: true }))
    expect(cls).toEqual(expect.arrayContaining(['sticker', 'sticker-animated', 'is-message-empty', 'has-floating-time', 'just-media']))
    expect(cls).not.toContain('can-have-tail')
  })

  it('big-emoji: emoji-big + can-have-big-emoji + sticker + just-media', () => {
    const cls = bubbleClasses(msg({ text: '😀' }), ctx({ out: true, bigEmojiCount: 1 }))
    expect(cls).toEqual(expect.arrayContaining(['emoji-big', 'can-have-big-emoji', 'sticker', 'just-media', 'has-floating-time']))
  })

  it('фото без подписи: has-plain-media-tail; с подписью — обычный бабл', () => {
    const noCaption = bubbleClasses(msg({ type: 'photo', text: '', mediaId: 3 }), ctx({ out: true }))
    expect(noCaption).toEqual(expect.arrayContaining(['photo', 'is-message-empty', 'has-floating-time', 'can-have-tail', 'has-plain-media-tail']))
    expect(noCaption).not.toContain('just-media') // подложка бабла у фото остаётся

    const captioned = bubbleClasses(msg({ type: 'photo', text: 'подпись', mediaId: 3 }), ctx({ out: true }))
    expect(captioned).toContain('photo')
    expect(captioned).not.toContain('is-message-empty')
    expect(captioned).not.toContain('has-plain-media-tail')
  })

  it('кружок: round + just-media, хвоста нет никогда (bubbles.ts:9708)', () => {
    const cls = bubbleClasses(msg({ type: 'roundVideo', text: '', mediaId: 9 }), ctx())
    expect(cls).toEqual(expect.arrayContaining(['round', 'is-message-empty', 'has-floating-time', 'just-media']))
    expect(cls).not.toContain('can-have-tail')
  })

  it('альбом: is-album + is-grouped + photo/video по составу', () => {
    const cls = bubbleClasses(
      msg({ type: 'album', text: '', albumItems: [{ type: 'photo' }, { type: 'video' }] as ConvMsg[] }),
      ctx({ out: true }),
    )
    expect(cls).toEqual(expect.arrayContaining(['is-album', 'is-grouped', 'video']))
  })

  it('пересланное: forwarded + must-have-name, hide-name не ставится', () => {
    const cls = bubbleClasses(msg({ forwardFrom: { name: 'канал' } as ConvMsg['forwardFrom'] }), ctx({ out: true, isChannel: true }))
    expect(cls).toEqual(expect.arrayContaining(['forwarded', 'must-have-name', 'channel-post', 'with-beside-button']))
    expect(cls).not.toContain('hide-name')
  })

  it('ответ, клавиатура, выделение, подсветка, граница непрочитанных', () => {
    const cls = bubbleClasses(
      msg({ reply: { name: 'Алиса', text: 'что' } as ConvMsg['reply'], replyMarkup: { inline: [[{ text: 'ok' }]] } as ConvMsg['replyMarkup'] }),
      ctx({ isSelected: true, isHighlighted: true, isFirstUnread: true }),
    )
    expect(cls).toEqual(expect.arrayContaining(['is-reply', 'with-reply-markup', 'is-selected', 'is-highlighted', 'is-first-unread']))
  })

  it('опрос и чеклист — poll-message', () => {
    expect(bubbleClasses(msg({ type: 'poll', text: '' }), ctx())).toContain('poll-message')
    expect(bubbleClasses(msg({ type: 'checklist', text: '' }), ctx())).toContain('poll-message')
  })
})
