import { describe, it, expect } from 'vitest'
import { bubbleClasses, type BubbleCtx } from './bubbleClasses'
import { saveDocument, type DocumentAttribute, type MessageMedia } from '../../core/media/messageMedia'
import type { ConvMsg } from '../../data'

/** Вложение-фото. Ставится ВМЕСТО прежнего плоского `mediaId`: адрес файла
 *  спрашивают у вложения (`getMediaId`), поэтому «медиа есть» без самого
 *  вложения — форма, которой на проводе не существует. */
const photoMedia = (id: number): MessageMedia => ({
  _: 'messageMediaPhoto',
  photo: { _: 'photo', id, sizes: [{ _: 'photoSize', type: 'w', w: 100, h: 100, size: 1 }] },
})

/** Вложение-документ: `doc.type` выводит `saveDocument` из атрибутов + mime. */
const docMedia = (mime: string, attributes: DocumentAttribute[] = []): MessageMedia => ({
  _: 'messageMediaDocument',
  document: saveDocument({ _: 'document', id: 7, mime_type: mime, size: 100, attributes }),
})

const msg = (over: Partial<ConvMsg> = {}): ConvMsg => ({ id: 1, type: 'text', text: 'hi', time: '12:00', ...over } as ConvMsg)
const ctx = (over: Partial<BubbleCtx> = {}): BubbleCtx => ({
  out: false, firstInGroup: true, lastInGroup: true, showName: false, isChannel: false,
  isHighlighted: false, isFirstUnread: false, bigEmojiCount: 0, animatedSticker: false,
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
    const cls = bubbleClasses(msg({ type: 'voice', text: '', mediaId: 7, media: docMedia('audio/ogg', [{ _: 'documentAttributeAudio', pFlags: { voice: true }, duration: 3 }]), status: 'read' }), ctx({ out: true, firstInGroup: false }))
    expect(cls).toEqual(expect.arrayContaining(['voice-message', 'min-content', 'is-single-document', 'can-have-tail', 'is-group-last', 'is-read']))
    // у голосового тело сообщения есть (волна+время) — не is-message-empty
    expect(cls).not.toContain('is-message-empty')
    expect(cls).not.toContain('just-media')
  })

  it('стикер: just-media + is-message-empty + has-floating-time, без хвоста', () => {
    const cls = bubbleClasses(msg({ type: 'sticker', text: '', mediaId: 5, media: docMedia('image/webp', [{ _: 'documentAttributeSticker', alt: '🔥' }]) }), ctx({ out: true, animatedSticker: true }))
    expect(cls).toEqual(expect.arrayContaining(['sticker', 'sticker-animated', 'is-message-empty', 'has-floating-time', 'just-media']))
    expect(cls).not.toContain('can-have-tail')
  })

  // Карточка ссылки — вложение, но бабл у неё ТЕКСТОВЫЙ: её картинка рисуется
  // внутри тела сообщения (tweb bubbles.ts:8112). Пока превью ехало собственным
  // ключом сообщения, спутать было не с чем; теперь `media` у такого сообщения
  // есть, и бабл обязан остаться текстовым.
  it('сообщение с карточкой ссылки остаётся текстовым баблом', () => {
    const media: MessageMedia = {
      _: 'messageMediaWebPage',
      webpage: {
        _: 'webPage', url: 'https://x/', display_url: 'x', title: 'T',
        photo: { _: 'photo', id: 7, sizes: [{ _: 'photoSize', type: 'w', w: 10, h: 10, size: 1 }] },
      },
    }
    const cls = bubbleClasses(msg({ type: 'text', text: 'https://x/', mediaId: 7, media }), ctx({ out: true }))
    expect(cls).not.toContain('is-message-empty')
    expect(cls).not.toContain('just-media')
    expect(cls).toContain('can-have-tail')
  })

  it('big-emoji: emoji-big + can-have-big-emoji + sticker + just-media', () => {
    const cls = bubbleClasses(msg({ text: '😀' }), ctx({ out: true, bigEmojiCount: 1 }))
    expect(cls).toEqual(expect.arrayContaining(['emoji-big', 'can-have-big-emoji', 'sticker', 'just-media', 'has-floating-time']))
  })

  it('фото без подписи: has-plain-media-tail; с подписью — обычный бабл', () => {
    const noCaption = bubbleClasses(msg({ type: 'photo', text: '', mediaId: 3, media: photoMedia(3) }), ctx({ out: true }))
    expect(noCaption).toEqual(expect.arrayContaining(['photo', 'is-message-empty', 'has-floating-time', 'can-have-tail', 'has-plain-media-tail']))
    expect(noCaption).not.toContain('just-media') // подложка бабла у фото остаётся

    const captioned = bubbleClasses(msg({ type: 'photo', text: 'подпись', mediaId: 3, media: photoMedia(3) }), ctx({ out: true }))
    expect(captioned).toContain('photo')
    expect(captioned).not.toContain('is-message-empty')
    expect(captioned).not.toContain('has-plain-media-tail')
  })

  it('кружок: round + just-media, хвоста нет никогда (bubbles.ts:9708)', () => {
    const cls = bubbleClasses(msg({ type: 'roundVideo', text: '', mediaId: 9, media: docMedia('video/mp4', [{ _: 'documentAttributeVideo', pFlags: { round_message: true }, duration: 5, w: 384, h: 384 }]) }), ctx())
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

  // `is-selected` здесь не проверяется: он больше не из bubbleClasses, а из
  // SetTransition в MessageRow (tweb selection.ts:497-502) — иначе не было бы
  // фазы `backwards` на снятии выделения.
  it('ответ, клавиатура, подсветка, граница непрочитанных', () => {
    const cls = bubbleClasses(
      msg({ reply: { name: 'Алиса', text: 'что' } as ConvMsg['reply'], replyMarkup: { _: 'replyInlineMarkup', rows: [{ _: 'keyboardButtonRow', buttons: [{ _: 'keyboardButtonCallback', text: 'ok', data: 'b2s=' }] }] } }),
      ctx({ isHighlighted: true, isFirstUnread: true }),
    )
    expect(cls).toEqual(expect.arrayContaining(['is-reply', 'with-reply-markup', 'is-highlighted', 'is-first-unread']))
    expect(cls).not.toContain('is-selected')
  })

  // tweb bubbles.ts:8632-8642 — класс одиночного документа собирается ИЗ
  // `doc.type`, а его выводит saveDocument из атрибутов. Пин держит именно эту
  // деривацию: раньше трек угадывался по префиксу mime (`audio/`), и mp3,
  // отправленный «как файл» (без documentAttributeAudio), ошибочно получал
  // audio-message вместо строки файла.
  describe('класс одиночного документа — из doc.type (tweb bubbles.ts:8632-8642)', () => {
    it('трек (documentAttributeAudio) — audio-message + min-content', () => {
      const media = docMedia('audio/mpeg', [{ _: 'documentAttributeAudio', duration: 139 }])
      const cls = bubbleClasses(msg({ type: 'audio', text: '', mediaId: 7, media }), ctx())
      expect(cls).toEqual(expect.arrayContaining(['audio-message', 'min-content', 'is-single-document']))
    })

    it('тот же mp3 «как файл» (без атрибута аудио) — document-message, без min-content', () => {
      const media = docMedia('audio/mpeg', [{ _: 'documentAttributeFilename', file_name: 'track.mp3' }])
      const cls = bubbleClasses(msg({ type: 'document', text: '', mediaId: 7, media }), ctx())
      expect(cls).toContain('document-message')
      expect(cls).not.toContain('audio-message')
      expect(cls).not.toContain('min-content')
    })

    it('голосовое (documentAttributeAudio voice + ogg) — voice-message + min-content', () => {
      const media = docMedia('audio/ogg', [{ _: 'documentAttributeAudio', pFlags: { voice: true }, duration: 3 }])
      const cls = bubbleClasses(msg({ type: 'voice', text: '', mediaId: 7, media }), ctx())
      expect(cls).toEqual(expect.arrayContaining(['voice-message', 'min-content', 'is-single-document']))
    })

    it('pdf — тоже document-message (tweb исключает photo/pdf из имени класса)', () => {
      const cls = bubbleClasses(msg({ type: 'document', text: '', mediaId: 7, media: docMedia('application/pdf') }), ctx())
      expect(cls).toContain('document-message')
      expect(cls).not.toContain('pdf-message')
    })
  })

  it('опрос и чеклист — poll-message', () => {
    expect(bubbleClasses(msg({ type: 'poll', text: '' }), ctx())).toContain('poll-message')
    expect(bubbleClasses(msg({ type: 'checklist', text: '' }), ctx())).toContain('poll-message')
  })
})
