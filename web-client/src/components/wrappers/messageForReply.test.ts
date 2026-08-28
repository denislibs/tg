// Таблица лейблов превью — порт tweb `wrapMessageForReply`.
//
// Пин на СОСТАВ строки: превью это список частей, склеенных «, » (лейбл
// вложения + текст), а не два независимых правила «есть подпись» / «нет
// подписи». Плюс на те ветки, где лейбл ЗАМЕНЯЕТ текст (стикер, аудио).
import { describe, expect, it } from 'vitest'
import { saveDocument, THUMB_TYPE_FULL, type DocumentAttribute, type MessageMedia } from '@core/media/messageMedia'
import { makeMessage } from '@core/messages/testMessage'
import type { MyMessage } from '@core/models'
import wrapMessageForReply from './messageForReply'

const msg = (over: { text?: string; media?: MessageMedia; groupedId?: number }): MyMessage =>
  makeMessage({
    peerId: 7, fromId: 2, id: 1, text: over.text ?? '',
    createdAt: '2026-08-15T12:00:00Z', media: over.media, groupedId: over.groupedId,
  })

const photo: MessageMedia = {
  _: 'messageMediaPhoto',
  photo: { _: 'photo', id: 1, sizes: [{ _: 'photoSize', type: THUMB_TYPE_FULL, w: 8, h: 6, size: 1 }] },
}

const doc = (mime: string, attributes: DocumentAttribute[], fileName?: string): MessageMedia => ({
  _: 'messageMediaDocument',
  document: saveDocument({
    _: 'document', id: 2, mime_type: mime, size: 10,
    attributes: fileName ? [...attributes, { _: 'documentAttributeFilename', file_name: fileName }] : attributes,
  }),
})

describe('wrapMessageForReply — лейбл вложения', () => {
  it('фото без подписи — только лейбл, с подписью — лейбл И текст через запятую', () => {
    expect(wrapMessageForReply({ message: msg({ media: photo }) })).toBe('Photo')
    expect(wrapMessageForReply({ message: msg({ media: photo, text: 'привет' }) })).toBe('Photo, привет')
  })

  it('текст без вложения едет один', () => {
    expect(wrapMessageForReply({ message: msg({ text: 'просто текст' }) })).toBe('просто текст')
  })

  it('видео, gif и кружок различаются лейблом', () => {
    const video = doc('video/mp4', [{ _: 'documentAttributeVideo', duration: 5, w: 4, h: 3 }])
    // Порядок атрибутов НЕ произволен: `documentAttributeVideo` ставит
    // `type='video'`, и `documentAttributeAnimated` уточняет его до `gif`
    // только идя ПОСЛЕ (tweb appDocsManager.ts:161-218 — тот же порядок).
    const gif = doc('video/mp4', [{ _: 'documentAttributeVideo', duration: 2, w: 4, h: 3 }, { _: 'documentAttributeAnimated' }])
    const round = doc('video/mp4', [{ _: 'documentAttributeVideo', duration: 3, w: 4, h: 4, pFlags: { round_message: true } }])

    expect(wrapMessageForReply({ message: msg({ media: video }) })).toBe('Video')
    expect(wrapMessageForReply({ message: msg({ media: gif }) })).toBe('GIF')
    expect(wrapMessageForReply({ message: msg({ media: round }) })).toBe('Video message')
  })

  it('стикер несёт эмодзи И лейбл ОДНОЙ частью, а текст сообщения гасит', () => {
    const sticker = doc('image/webp', [
      { _: 'documentAttributeSticker', alt: '🙂', stickerset: { _: 'inputStickerSetEmpty' } },
    ])
    // Оригинал сливает эмодзи и лейбл `parts.splice(i, 2)` — иначе между ними
    // встала бы запятая.
    expect(wrapMessageForReply({ message: msg({ media: sticker, text: 'подпись' }) })).toBe('🙂 Sticker')
  })

  it('аудио показывает исполнителя и название, а не имя файла', () => {
    const audio = doc('audio/mpeg', [
      { _: 'documentAttributeAudio', duration: 100, title: 'Песня', performer: 'Артист' },
    ], 'track.mp3')
    expect(wrapMessageForReply({ message: msg({ media: audio }) })).toBe('🎵 Песня - Артист')
  })

  it('файл говорит за себя именем — отдельного лейбла у него нет', () => {
    const file = doc('application/pdf', [], 'смета.pdf')
    expect(wrapMessageForReply({ message: msg({ media: file }) })).toBe('смета.pdf')
  })

  it('опрос — вопрос с иконкой', () => {
    const poll: MessageMedia = {
      _: 'messageMediaPoll',
      poll: { _: 'poll', id: 5, question: { _: 'textWithEntities', text: 'Кто?', entities: [] }, answers: [] },
      results: { _: 'pollResults' },
    }
    expect(wrapMessageForReply({ message: msg({ media: poll }) })).toBe('📊 Кто?')
  })

  it('альбом даёт ОДИН лейбл на группу и подпись того сообщения, где она есть', () => {
    const group = [
      msg({ media: photo, groupedId: 900 }),
      { ...msg({ media: photo, groupedId: 900, text: 'общая подпись' }), id: 2 } as MyMessage,
    ]
    expect(wrapMessageForReply({ message: group[0], groupedMessages: group })).toBe('Album, общая подпись')
  })

  it('длинный текст обрезается до 100 символов (tweb limitSymbols)', () => {
    const long = 'я'.repeat(150)
    expect(wrapMessageForReply({ message: msg({ text: long }) })).toHaveLength(100)
  })
})
