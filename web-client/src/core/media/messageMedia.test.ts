import { describe, it, expect } from 'vitest'
import {
  saveDocument,
  saveMessageMedia,
  getMediaFromMessage,
  getDocumentFromMessage,
  getStrippedThumb,
  getPathThumb,
  getMediaDimensions,
  isMediaSpoiler,
  choosePhotoSize,
  type MessageMedia,
  type MyDocument,
} from './messageMedia'
import { mapMessage } from '../models'
import type { RawMessage } from '../models'

// Документ в форме провода: только поля схемы, без выведенных подсказок —
// ровно то, что отдаёт бэк (domain/mtmedia.go).
function doc(mime: string, attributes: MyDocument['attributes'], extra?: Partial<MyDocument>): MyDocument {
  return { _: 'document', id: 1, mime_type: mime, size: 0, attributes, ...extra }
}

describe('saveDocument — вывод типа документа из атрибутов и mime (порт appDocsManager.saveDoc)', () => {
  // Это и есть механизм, ради которого затевалась модель: раньше тип медиа
  // приезжал подделанным флагом витрины, теперь он ВЫВОДИТСЯ — из тех же
  // данных и тем же правилом, что в оригинале.
  it('video: documentAttributeVideo → type video + кадр и длительность', () => {
    const d = saveDocument(doc('video/mp4', [{ _: 'documentAttributeVideo', duration: 61, w: 1280, h: 720 }]))
    expect(d.type).toBe('video')
    expect([d.w, d.h, d.duration]).toEqual([1280, 720, 61])
  })

  it('round: тот же атрибут с pFlags.round_message → type round', () => {
    const d = saveDocument(doc('video/mp4', [
      { _: 'documentAttributeVideo', duration: 9, w: 384, h: 384, pFlags: { round_message: true } },
    ]))
    expect(d.type).toBe('round')
  })

  it('gif: documentAttributeAnimated при видео-mime → type gif (а не video)', () => {
    const d = saveDocument(doc('video/mp4', [
      { _: 'documentAttributeVideo', duration: 3, w: 320, h: 240 },
      { _: 'documentAttributeAnimated' },
    ]))
    expect(d.type).toBe('gif')
    expect(d.animated).toBe(true)
  })

  it('voice: pFlags.voice + audio/ogg → voice; тот же атрибут без флага → audio', () => {
    const voice = saveDocument(doc('audio/ogg', [
      { _: 'documentAttributeAudio', duration: 7, pFlags: { voice: true }, waveform: 'HwAq' },
    ]))
    expect(voice.type).toBe('voice')
    const music = saveDocument(doc('audio/mpeg', [
      { _: 'documentAttributeAudio', duration: 139, title: 'T', performer: 'P' },
    ]))
    expect(music.type).toBe('audio')
  })

  // Гейт оригинала: voice — это pFlags.voice И ogg-mime. mp3 с флагом голосового
  // остаётся музыкой (у бабла голосового другая вёрстка и другой плеер).
  it('voice-флаг при не-ogg mime не делает документ голосовым', () => {
    const d = saveDocument(doc('audio/mpeg', [
      { _: 'documentAttributeAudio', duration: 7, pFlags: { voice: true } },
    ]))
    expect(d.type).toBe('audio')
  })

  it('sticker: webp → static, webm → video-стикер, tgs-mime → lottie', () => {
    expect(saveDocument(doc('image/webp', [{ _: 'documentAttributeSticker', alt: '🔥' }])).sticker).toBe(1)
    const webm = saveDocument(doc('video/webm', [{ _: 'documentAttributeSticker', alt: '🔥' }]))
    expect([webm.type, webm.sticker, webm.animated]).toEqual(['sticker', 3, true])
    const tgs = saveDocument(doc('application/x-tgsticker', [{ _: 'documentAttributeSticker', alt: '🔥' }]))
    expect([tgs.type, tgs.sticker, tgs.animated]).toEqual(['sticker', 2, true])
  })

  it('эмодзи стикера доезжает из alt (doc.stickerEmojiRaw оригинала)', () => {
    expect(saveDocument(doc('image/webp', [{ _: 'documentAttributeSticker', alt: '🔥' }])).stickerEmojiRaw).toBe('🔥')
  })

  it('photo-документ: documentAttributeImageSize → type photo', () => {
    const d = saveDocument(doc('image/jpeg', [{ _: 'documentAttributeImageSize', w: 100, h: 50 }]))
    expect([d.type, d.w, d.h]).toEqual(['photo', 100, 50])
  })

  it('файл: имя из documentAttributeFilename, тип по mime (pdf)', () => {
    const d = saveDocument(doc('application/pdf', [{ _: 'documentAttributeFilename', file_name: 'doc.pdf' }]))
    expect([d.type, d.file_name]).toEqual(['pdf', 'doc.pdf'])
  })

  it('без атрибутов и без известного mime тип не выводится вовсе', () => {
    expect(saveDocument(doc('application/octet-stream', [])).type).toBeUndefined()
  })
})

describe('ступени лестницы', () => {
  const media: MessageMedia = {
    _: 'messageMediaDocument',
    document: doc('image/webp', [{ _: 'documentAttributeSticker', alt: '🔥' }], {
      thumbs: [
        { _: 'photoStrippedSize', type: 'i', bytes: 'STRIPPED' },
        { _: 'photoPathSize', type: 'j', bytes: 'M0 0' },
        { _: 'photoSize', type: 'y', w: 512, h: 512, size: 0 },
      ],
    }),
  }

  it('stripped и векторный контур читаются из thumbs, а не из отдельных полей', () => {
    const d = getMediaFromMessage({ media })
    expect(getStrippedThumb(d)).toBe('STRIPPED')
    // Контур раньше до сообщения не доезжал вовсе — теперь это просто ступень.
    expect(getPathThumb(d)).toBe('M0 0')
  })

  it('choosePhotoSize пропускает ступени без геометрии (гвард оригинала)', () => {
    const size = choosePhotoSize(getMediaFromMessage({ media }), 100, 100)
    expect(size?._).toBe('photoSize')
  })

  it('choosePhotoSize берёт первую ступень, покрывшую бокс', () => {
    const photo: MessageMedia = {
      _: 'messageMediaPhoto',
      photo: {
        _: 'photo', id: 1, sizes: [
          { _: 'photoStrippedSize', type: 'i', bytes: 'S' },
          { _: 'photoSize', type: 'y', w: 320, h: 240, size: 0 },
          { _: 'photoSize', type: 'w', w: 1600, h: 1200, size: 9 },
        ],
      },
    }
    expect(choosePhotoSize(getMediaFromMessage({ media: photo }), 2000, 2000)?.type).toBe('w')
  })

  it('размеры кадра: у фото — ступень оригинала, у документа — его атрибут', () => {
    const photo: MessageMedia = {
      _: 'messageMediaPhoto',
      photo: { _: 'photo', id: 1, sizes: [{ _: 'photoSize', type: 'w', w: 1600, h: 1200, size: 9 }] },
    }
    expect(getMediaDimensions(getMediaFromMessage({ media: photo }))).toEqual({ w: 1600, h: 1200 })

    const video = saveMessageMedia({
      _: 'messageMediaDocument',
      document: doc('video/mp4', [{ _: 'documentAttributeVideo', duration: 5, w: 640, h: 480 }]),
    })
    expect(getMediaDimensions(getMediaFromMessage({ media: video }))).toEqual({ w: 640, h: 480 })
  })
})

describe('вложение сообщения', () => {
  it('спойлер читается из pFlags, а не из отдельного флага витрины', () => {
    const hidden: MessageMedia = {
      _: 'messageMediaPhoto', pFlags: { spoiler: true },
      photo: { _: 'photo', id: 1, sizes: [] },
    }
    expect(isMediaSpoiler({ media: hidden })).toBe(true)
    expect(isMediaSpoiler({ media: { ...hidden, pFlags: undefined } })).toBe(false)
    expect(isMediaSpoiler({})).toBe(false)
  })

  it('getDocumentFromMessage отдаёт документ только у messageMediaDocument', () => {
    const photo: MessageMedia = { _: 'messageMediaPhoto', photo: { _: 'photo', id: 1, sizes: [] } }
    expect(getDocumentFromMessage({ media: photo })).toBeUndefined()
    expect(getMediaFromMessage({ media: photo })?._).toBe('photo')
  })
})

// Маппер: вложение с провода попадает в модель УЖЕ нормализованным — тип
// документа выведен. Без этого шага каждый потребитель выводил бы его сам.
describe('mapMessage — нормализация вложения', () => {
  const raw = (media: MessageMedia): RawMessage => ({
    id: 1, peer_id: 2, seq: 3, sender_id: 4, type: 'video', text: '',
    reply_to_id: null, media_id: 42, created_at: '2026-08-19T00:00:00Z', media,
  })

  it('doc.type выведен на границе маппинга', () => {
    const m = mapMessage(raw({
      _: 'messageMediaDocument',
      document: doc('video/mp4', [
        { _: 'documentAttributeVideo', duration: 61, w: 1280, h: 720 },
        { _: 'documentAttributeFilename', file_name: 'clip.mp4' },
      ]),
    }))
    const d = getDocumentFromMessage(m)
    expect(d?.type).toBe('video')
    expect(d?.file_name).toBe('clip.mp4')
    expect(getMediaDimensions(d)).toEqual({ w: 1280, h: 720 })
  })

  it('вложения нет — media остаётся undefined', () => {
    const m = mapMessage({
      id: 1, peer_id: 2, seq: 3, sender_id: 4, type: 'text', text: 'hi',
      reply_to_id: null, media_id: null, created_at: '2026-08-19T00:00:00Z',
    })
    expect(m.media).toBeUndefined()
    expect(getMediaFromMessage(m)).toBeUndefined()
  })
})
