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
  getBubbleMedia,
  getGeoFromMedia,
  isLiveGeoExpired,
  isPaidMediaLocked,
  pollOptionIndex,
  pollOptionKey,
  pollVotersFor,
  type MessageMedia,
  type MessageMediaGeoLive,
  type MyDocument,
} from './messageMedia'
import { mapMyMessage } from '../models'
import { makeRawMessage } from '../messages/testMessage'
import type { RawMessageReal } from '../models'

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
    expect(saveDocument(doc('image/webp', [{ _: 'documentAttributeSticker', alt: '🔥', stickerset: { _: 'inputStickerSetID', id: 9 } }])).sticker).toBe(1)
    const webm = saveDocument(doc('video/webm', [{ _: 'documentAttributeSticker', alt: '🔥', stickerset: { _: 'inputStickerSetID', id: 9 } }]))
    expect([webm.type, webm.sticker, webm.animated]).toEqual(['sticker', 3, true])
    const tgs = saveDocument(doc('application/x-tgsticker', [{ _: 'documentAttributeSticker', alt: '🔥', stickerset: { _: 'inputStickerSetID', id: 9 } }]))
    expect([tgs.type, tgs.sticker, tgs.animated]).toEqual(['sticker', 2, true])
  })

  it('эмодзи стикера доезжает из alt (doc.stickerEmojiRaw оригинала)', () => {
    expect(saveDocument(doc('image/webp', [{ _: 'documentAttributeSticker', alt: '🔥', stickerset: { _: 'inputStickerSetID', id: 9 } }])).stickerEmojiRaw).toBe('🔥')
  })

  // Набор стикера теперь приезжает В САМОМ документе, и это то, ради чего
  // отменено решение «stickerset не производим». Пока его не было, клик по
  // стикеру в чате шёл в сеть за набором отдельной ручкой по media_id.
  it('набор стикера доезжает из stickerset (doc.stickerSetInput оригинала)', () => {
    const d = saveDocument(doc('image/webp', [{ _: 'documentAttributeSticker', alt: '🔥', stickerset: { _: 'inputStickerSetID', id: 9 } }]))
    expect(d.stickerSetInput).toEqual({ _: 'inputStickerSetID', id: 9 })
  })

  // «Набора нет» — это ОТСУТСТВИЕ клиентского параметра, а не пустышка в нём
  // (порт tweb saveDoc:180-187). Иначе потребитель, спрашивающий `if
  // (doc.stickerSetInput)`, получил бы «набор есть» у стикера без набора и
  // открыл бы пустую панель.
  it('inputStickerSetEmpty не сохраняется вовсе', () => {
    const d = saveDocument(doc('image/webp', [{ _: 'documentAttributeSticker', alt: '🔥', stickerset: { _: 'inputStickerSetEmpty' } }]))
    expect(d.stickerSetInput).toBeUndefined()
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
    document: doc('image/webp', [{ _: 'documentAttributeSticker', alt: '🔥', stickerset: { _: 'inputStickerSetID', id: 9 } }], {
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
  const raw = (media: MessageMedia): RawMessageReal =>
    makeRawMessage({ id: 1, peerId: 2, fromId: 4, media })

  it('doc.type выведен на границе маппинга', () => {
    const m = mapMyMessage(raw({
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
    const m = mapMyMessage(makeRawMessage({ id: 1, peerId: 2, fromId: 4, text: 'hi' }))
    expect(m._ === 'message' && m.media).toBeUndefined()
    expect(getMediaFromMessage(m)).toBeUndefined()
  })
})

// ── Конструкторы, которыми объединение доведено до конца ────────────────────

describe('getMediaFromMessage — файл вложения, каким бы конструктором он ни был обёрнут', () => {
  const photoMedia = (id: number): MessageMedia => ({
    _: 'messageMediaPhoto',
    photo: { _: 'photo', id, sizes: [{ _: 'photoSize', type: 'w', w: 10, h: 10, size: 1 }] },
  })

  it('карточка ссылки: файл — картинка ВНУТРИ webpage, той же лестницей', () => {
    const media: MessageMedia = {
      _: 'messageMediaWebPage',
      webpage: {
        _: 'webPage', url: 'https://x/', display_url: 'x',
        photo: { _: 'photo', id: 7, sizes: [{ _: 'photoStrippedSize', type: 'i', bytes: 'AQID' }] },
      },
    }
    expect(getMediaFromMessage({ media })?.id).toBe(7)
    expect(getStrippedThumb(getMediaFromMessage({ media }))).toBe('AQID')
  })

  // Вопрос «какой у вложения файл» и вопрос «чем рисовать бабл» — РАЗНЫЕ, и
  // расходятся они ровно на карточке ссылки. Пока превью ехало собственным
  // ключом сообщения, разницы не было вовсе; теперь есть, и без неё сообщение
  // со ссылкой уехало бы в медиа-ветку и превратилось в картинку без текста.
  it('карточку ссылки бабл своим медиа НЕ считает', () => {
    const media: MessageMedia = {
      _: 'messageMediaWebPage',
      webpage: {
        _: 'webPage', url: 'https://x/', display_url: 'x',
        photo: { _: 'photo', id: 7, sizes: [] },
      },
    }
    expect(getMediaFromMessage({ media })?.id).toBe(7)
    expect(getBubbleMedia({ media })).toBeUndefined()
  })

  it('у остальных конструкторов оба вопроса дают один ответ', () => {
    const media = photoMedia(3)
    expect(getBubbleMedia({ media })).toBe(getMediaFromMessage({ media }))
  })

  it('платное оплаченное: файл лежит внутри вектора', () => {
    const media: MessageMedia = {
      _: 'messageMediaPaidMedia',
      stars_amount: 5,
      extended_media: [{ _: 'messageExtendedMedia', media: photoMedia(55) }],
    }
    expect(getMediaFromMessage({ media })?.id).toBe(55)
  })

  it('платное неоплаченное: файла нет ВОВСЕ — не псевдо-фото, а undefined', () => {
    const media: MessageMedia = {
      _: 'messageMediaPaidMedia',
      stars_amount: 5,
      extended_media: [{ _: 'messageExtendedMediaPreview', w: 8, h: 6 }],
    }
    expect(getMediaFromMessage({ media })).toBeUndefined()
    expect(isPaidMediaLocked(media)).toBe(true)
  })

  it('гео, визитка и розыгрыш файла не несут вовсе', () => {
    const noFile: MessageMedia[] = [
      { _: 'messageMediaGeo', geo: { _: 'geoPoint', long: 1, lat: 2 } },
      { _: 'messageMediaContact', phone_number: '', first_name: 'x', last_name: '', vcard: '', user_id: 1 },
      { _: 'messageMediaGiveaway', id: 1, channels: [1], quantity: 1, until_date: 0 },
    ]
    for (const media of noFile) expect(getMediaFromMessage({ media })).toBeUndefined()
  })

  it('заслонка есть только у фото и документа — у остальных конструкторов бита нет', () => {
    expect(isMediaSpoiler({ media: { _: 'messageMediaGeo', geo: { _: 'geoPoint', long: 1, lat: 2 } } })).toBe(false)
  })
})

// «Трансляция закончилась» — ЕДИНСТВЕННЫЙ способ ответить на этот вопрос:
// `date + period <= now`. Флага в схеме нет, и досрочная остановка приезжает
// УКОРОЧЕННЫМ period, то есть тем же истечением.
describe('isLiveGeoExpired — конец трансляции это истечение срока', () => {
  const live = (period: number): MessageMediaGeoLive =>
    ({ _: 'messageMediaGeoLive', geo: { _: 'geoPoint', long: 1, lat: 2 }, period })
  const DATE = 1_750_000_000

  it('срок ещё идёт', () => {
    expect(isLiveGeoExpired(live(900), DATE, DATE + 899)).toBe(false)
  })

  it('момент истечения уже считается концом', () => {
    expect(isLiveGeoExpired(live(900), DATE, DATE + 900)).toBe(true)
  })

  it('досрочная остановка = укороченный period, и это тот же вопрос', () => {
    // Отправитель остановил трансляцию через 60 секунд: сервер прислал period=60.
    expect(isLiveGeoExpired(live(60), DATE, DATE + 61)).toBe(true)
    expect(isLiveGeoExpired(live(60), DATE, DATE + 30)).toBe(false)
  })

  it('нулевой period — истекла в момент отправки', () => {
    expect(isLiveGeoExpired(live(0), DATE, DATE)).toBe(true)
  })
})

// Вариант опроса адресуется КЛЮЧОМ (`option:bytes`), а не позицией в массиве:
// позиции в схеме нет вовсе. У нас в ключе номер одним байтом.
describe('ключ варианта опроса', () => {
  it('перевод в обе стороны', () => {
    for (const i of [0, 1, 9, 255]) expect(pollOptionIndex(pollOptionKey(i))).toBe(i)
  })

  it('итог варианта ищется по ключу, а не по индексу', () => {
    const results = {
      _: 'pollResults' as const,
      results: [
        { _: 'pollAnswerVoters' as const, option: pollOptionKey(1), voters: 3 },
        { _: 'pollAnswerVoters' as const, option: pollOptionKey(0), voters: 1, pFlags: { chosen: true as const } },
      ],
    }
    // Порядок в векторе итогов НЕ обязан совпадать с порядком вариантов.
    expect(pollVotersFor(results, pollOptionKey(0))?.voters).toBe(1)
    expect(pollVotersFor(results, pollOptionKey(1))?.voters).toBe(3)
    expect(pollVotersFor(results, pollOptionKey(2))).toBeUndefined()
  })
})

// Гео-точка общая у трёх конструкторов — вопрос «где» задаётся один раз.
describe('getGeoFromMedia', () => {
  const point = { _: 'geoPoint' as const, long: 37.6, lat: 55.7 }

  it('отвечает у всех трёх конструкторов гео', () => {
    expect(getGeoFromMedia({ _: 'messageMediaGeo', geo: point })).toBe(point)
    expect(getGeoFromMedia({ _: 'messageMediaVenue', geo: point, title: 't', address: 'a' })).toBe(point)
    expect(getGeoFromMedia({ _: 'messageMediaGeoLive', geo: point, period: 60 })).toBe(point)
  })

  it('у не-гео вложения точки нет', () => {
    expect(getGeoFromMedia({ _: 'messageMediaPhoto', photo: { _: 'photo', id: 1, sizes: [] } })).toBeUndefined()
    expect(getGeoFromMedia(undefined)).toBeUndefined()
  })
})

// Нормализация обязана заходить ВНУТРЬ обёртки платного медиа: иначе у
// оплаченного документа нет выведенного типа, и оплаченная гифка рисуется
// видео-баблом до перезагрузки истории.
describe('saveMessageMedia заходит внутрь платного вложения', () => {
  it('тип вложенного документа выведен', () => {
    const media = saveMessageMedia({
      _: 'messageMediaPaidMedia',
      stars_amount: 5,
      extended_media: [{
        _: 'messageExtendedMedia',
        media: { _: 'messageMediaDocument', document: doc('image/gif', [{ _: 'documentAttributeAnimated' }]) },
      }],
    })
    expect(getDocumentFromMessage({ media })?.type).toBe('gif')
  })
})
