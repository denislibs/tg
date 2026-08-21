// «Что это за сообщение» — вопрос ВИТРИНЫ, и с провода на него больше не
// приходит ответа готовым полем `type`. Здесь проверяется сам вывод: по выбору
// конструктора сообщения, по его действию и по конструктору вложения.
//
// Тестов на этот вывод не было вовсе, хотя от него зависит ветка рендера
// каждого бабла: сломать `getMessageKind` можно было, не покраснев ни одним
// тестом (решающая процедура нормы покрытия, web-client/CLAUDE.md).
import { describe, expect, it } from 'vitest'

import { getFileName, getMediaId, getMessageKind, mediaKind } from './messageKind'
import { makeMessage, makeServiceMessage } from './testMessage'
import type { MessageMedia } from '../media/messageMedia'
import { saveMessageMedia } from '../media/messageMedia'

const msg = (media?: MessageMedia) =>
  makeMessage({ id: 1, peerId: 2, fromId: 2, media: media && saveMessageMedia(media) })

const doc = (mime: string, attributes: Extract<MessageMedia, { _: 'messageMediaDocument' }>['document']['attributes']): MessageMedia => ({
  _: 'messageMediaDocument',
  document: { _: 'document', id: 9, mime_type: mime, size: 1, attributes },
})

describe('getMessageKind — вид сообщения', () => {
  it('текст: вложения нет вовсе', () => {
    expect(getMessageKind(makeMessage({ id: 1, peerId: 2, text: 'hi' }))).toBe('text')
  })

  // ПОДАРОК — служебное сообщение с действием, а не вид вложения:
  // `messageMediaStarGift` в схеме отсутствует. До этого шага ветка выбиралась
  // по полю `gift` у обычного сообщения — то есть по наличию поля.
  it('подарок: пилюля с действием messageActionStarGift', () => {
    const gift = makeServiceMessage({
      id: 2, peerId: 7, fromId: 7,
      action: { _: 'messageActionStarGift', gift: { _: 'starGift', id: 3, stars: 100, convert_stars: 50 } },
    })
    expect(getMessageKind(gift)).toBe('gift')
  })

  it('лог звонка — тоже пилюля, но со своим действием', () => {
    const call = makeServiceMessage({ id: 3, peerId: 7, fromId: 7, action: { _: 'messageActionPhoneCall', duration: 4 } })
    expect(getMessageKind(call)).toBe('call')
  })

  it('прочая пилюля остаётся служебной', () => {
    const pin = makeServiceMessage({ id: 4, peerId: 7, fromId: 7, action: { _: 'messageActionPinMessage' } })
    expect(getMessageKind(pin)).toBe('service')
  })

  it('секретное: тела нет вовсе, едет шифртекст', () => {
    expect(getMessageKind({ ...makeMessage({ id: 5, peerId: 2 }), enc_body: 'AAAA' })).toBe('encrypted')
  })
})

describe('mediaKind — вид по КОНСТРУКТОРУ вложения', () => {
  const point = { _: 'geoPoint' as const, long: 1, lat: 2 }

  it.each<[string, MessageMedia, string]>([
    ['точка', { _: 'messageMediaGeo', geo: point }, 'geo'],
    ['место', { _: 'messageMediaVenue', geo: point, title: 't', address: 'a' }, 'geo'],
    ['трансляция', { _: 'messageMediaGeoLive', geo: point, period: 60 }, 'geo'],
    ['визитка', { _: 'messageMediaContact', phone_number: '', first_name: 'x', last_name: '', vcard: '', user_id: 1 }, 'contact'],
    ['опрос', {
      _: 'messageMediaPoll',
      poll: { _: 'poll', id: 1, question: { _: 'textWithEntities', text: 'q', entities: [] }, answers: [] },
      results: { _: 'pollResults' },
    }, 'poll'],
    ['чек-лист', {
      _: 'messageMediaToDo',
      todo: { _: 'todoList', id: 1, title: { _: 'textWithEntities', text: 't', entities: [] }, list: [] },
    }, 'checklist'],
    ['идущий розыгрыш', { _: 'messageMediaGiveaway', id: 1, channels: [1], quantity: 1, until_date: 0 }, 'giveaway'],
    ['состоявшийся розыгрыш', {
      _: 'messageMediaGiveawayResults', id: 1, channel_id: 1, launch_msg_id: 1,
      winners_count: 1, unclaimed_count: 0, winners: [], until_date: 0,
    }, 'giveaway'],
  ])('%s', (_name, media, kind) => {
    expect(getMessageKind(msg(media))).toBe(kind)
  })

  // Карточка ссылки — вложение, но бабл у неё ТЕКСТОВЫЙ: она рисуется внутри
  // тела сообщения (tweb bubbles.ts:8112), а не вместо него.
  it('карточка ссылки: бабл остаётся текстовым', () => {
    const media: MessageMedia = { _: 'messageMediaWebPage', webpage: { _: 'webPage', url: 'https://x/', display_url: 'x' } }
    expect(getMessageKind(msg(media))).toBe('text')
  })

  // Платное медиа своего вида не даёт: это ОБЁРТКА, вид берётся у того, что
  // лежит внутри вектора.
  it('платное оплаченное: вид берётся у вложения ВНУТРИ', () => {
    const media: MessageMedia = {
      _: 'messageMediaPaidMedia',
      stars_amount: 5,
      extended_media: [{ _: 'messageExtendedMedia', media: doc('video/mp4', [{ _: 'documentAttributeVideo', duration: 3, w: 4, h: 4 }]) }],
    }
    expect(getMessageKind(msg(media))).toBe('video')
  })

  it('платное неоплаченное: превью рисуется картиночным баблом', () => {
    const media: MessageMedia = {
      _: 'messageMediaPaidMedia',
      stars_amount: 5,
      extended_media: [{ _: 'messageExtendedMediaPreview', w: 8, h: 6 }],
    }
    expect(getMessageKind(msg(media))).toBe('photo')
  })

  it('вложения нет — вида нет', () => {
    expect(mediaKind(undefined)).toBeUndefined()
  })
})

describe('getMediaId / getFileName — адрес и имя файла спрашивают у вложения', () => {
  it('адрес фотографии — её id, а не плоское поле рядом', () => {
    const media: MessageMedia = { _: 'messageMediaPhoto', photo: { _: 'photo', id: 33, sizes: [] } }
    expect(getMediaId(msg(media))).toBe(33)
  })

  it('у вложения без файла адреса нет', () => {
    expect(getMediaId(msg({ _: 'messageMediaGeo', geo: { _: 'geoPoint', long: 1, lat: 2 } }))).toBeUndefined()
  })

  it('имя файла — атрибут документа', () => {
    expect(getFileName(msg(doc('application/pdf', [{ _: 'documentAttributeFilename', file_name: 'a.pdf' }])))).toBe('a.pdf')
  })
})
