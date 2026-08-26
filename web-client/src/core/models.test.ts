// src/core/models.test.ts
import { describe, it, expect } from 'vitest'
import {
  isOurMessage, isOutMessage, mapMessage, mapMyMessage,
  type RawMessageReal, type RawMessageService,
} from './models'
import { getMediaFromMessage, isMediaSpoiler } from './media/messageMedia'
import { generateMessageId } from './history/messageId'
import { makeRawMessage, makeRawServiceMessage } from './messages/testMessage'

/** Проводное сообщение с нужными полями поверх минимального. */
const raw = (over: Partial<RawMessageReal> = {}): RawMessageReal =>
  ({ ...makeRawMessage({ id: 5, peerId: 1, fromId: 1, text: 'hello', date: 1_750_000_000 }), ...over })

describe('mapMessage', () => {
  // Маппер УСОХ: формы совпали, и переводить осталось ровно три вещи —
  // пространство номеров, знаковые ключи пиров и не пройденные программой
  // подсистемы. Этот тест держит первые две.
  it('переводит номер в клиентское пространство и выводит ключи пиров', () => {
    const m = mapMessage(raw())
    expect(m).toEqual({
      _: 'message',
      pFlags: {},
      id: generateMessageId(5),
      from_id: { _: 'peerUser', user_id: 1 },
      peer_id: { _: 'peerUser', user_id: 1 },
      peerId: 1,
      fromId: 1,
      date: 1_750_000_000,
      message: 'hello',
      reply_to: undefined,
      ttl_period: undefined,
      random_id: undefined,
      secret: undefined,
      secretMedia: undefined,
      fwd_from: undefined,
      media: undefined,
      reply_markup: undefined,
      entities: undefined,
      views: undefined,
      forwards: undefined,
      edit_date: undefined,
      grouped_id: undefined,
      effect_name: undefined,
      factcheck: undefined,
      send_at: undefined,
      when_online: undefined,
      enc_body: undefined,
      destruct_at: undefined,
    })
  })

  // Ссылка на отвечаемое и корень треда — номера сообщений, значит живут в том
  // же пространстве, что и `id`: сравнивать их с ним иначе было бы нельзя.
  it('переводит номера внутри reply_to тем же приведением', () => {
    const m = mapMessage(raw({ reply_to: { _: 'messageReplyHeader', reply_to_msg_id: 3, reply_to_top_id: 1 } }))
    expect(m._ === 'message' && m.reply_to).toEqual({
      _: 'messageReplyHeader',
      reply_to_msg_id: generateMessageId(3),
      reply_to_top_id: generateMessageId(1),
    })
  })

  // Третий номер сообщения на проводе живёт ВНУТРИ вложения: у состоявшегося
  // розыгрыша `launch_msg_id` адресует сообщение-запуск. Пространство у него то
  // же самое, что у `id` и `reply_to_msg_id`, — значит и приведение то же
  // (порт `appMessagesManager.saveMessageMedia`). Пока перевода не было, первый
  // же «перейти к сообщению-запуску» промахнулся бы мимо.
  it('переводит launch_msg_id розыгрыша тем же приведением', () => {
    const m = mapMessage(raw({
      media: {
        _: 'messageMediaGiveawayResults', id: 9, channel_id: 3, launch_msg_id: 42,
        winners_count: 1, unclaimed_count: 0, winners: [7], months: 3, until_date: 0,
      },
    }))
    const media = m._ === 'message' ? m.media : undefined
    expect(media?._ === 'messageMediaGiveawayResults' && media.launch_msg_id).toBe(generateMessageId(42))
  })

  // Ноль — это «сообщение-запуск неизвестно», а не адрес: приведение его не
  // трогает, ровно как оригинал (`generateMessageId` возвращает `messageId <= 0`
  // как есть).
  it('нулевой launch_msg_id остаётся нулём', () => {
    const m = mapMessage(raw({
      media: {
        _: 'messageMediaGiveawayResults', id: 9, channel_id: 3, launch_msg_id: 0,
        winners_count: 0, unclaimed_count: 0, winners: [], months: 3, until_date: 0,
      },
    }))
    const media = m._ === 'message' ? m.media : undefined
    expect(media?._ === 'messageMediaGiveawayResults' && media.launch_msg_id).toBe(0)
  })

  it('дыра остаётся дырой: ни даты, ни автора у неё нет', () => {
    const m = mapMessage({ _: 'messageEmpty', id: 4, peer_id: { _: 'peerUser', user_id: 1 } })
    expect(m).toEqual({ _: 'messageEmpty', id: generateMessageId(4), peer_id: { _: 'peerUser', user_id: 1 }, peerId: 1 })
  })

  it('маппит валидный эффект и отбрасывает неизвестный', () => {
    const eff = (effect_name?: string) => {
      const m = mapMessage(raw({ effect_name }))
      return m._ === 'message' ? m.effect_name : undefined
    }
    expect(eff('confetti')).toBe('confetti')
    expect(eff('fireworks')).toBe('fireworks')
    expect(eff('boom')).toBeUndefined()
    expect(eff('')).toBeUndefined()
    expect(eff(undefined)).toBeUndefined()
  })

  // Превью ссылки — КОНСТРУКТОР `messageMediaWebPage` в том же поле `media`, а
  // не собственный ключ `web_page` рядом. Разбирать его нечем и незачем: форма
  // провода и форма модели совпали, маппер обязан отдать объект как есть.
  it('превью ссылки приезжает вложением и не разбирается', () => {
    const media = {
      _: 'messageMediaWebPage' as const,
      webpage: {
        _: 'webPage' as const,
        url: 'https://example.com/', display_url: 'example.com',
        site_name: 'Example', title: 'Заголовок', description: 'Описание', has_iv: true,
        photo: {
          _: 'photo' as const,
          id: 42,
          sizes: [
            { _: 'photoStrippedSize' as const, type: 'i', bytes: 'Ymx1cg==' },
            { _: 'photoSize' as const, type: 'y', w: 1280, h: 720, size: 0 },
            { _: 'photoSize' as const, type: 'w', w: 1280, h: 720, size: 0 },
          ],
        },
      },
    }
    const m = mapMessage(raw({ media }))
    expect(m._ === 'message' && m.media).toEqual(media)
    // Картинка карточки идёт ТОЙ ЖЕ лестницей, что фотография сообщения.
    expect(getMediaFromMessage(m._ === 'message' ? m : undefined)).toBe(media.webpage.photo)
  })

  // «Проверка фактов» — текст и его разметка ОДНИМ объектом `textWithEntities`,
  // а не парой полей рядом.
  it('проверка фактов приезжает конструктором и не разбирается', () => {
    const factcheck = {
      _: 'factCheck' as const,
      country: 'DE',
      text: { _: 'textWithEntities' as const, text: 'clarification', entities: [{ _: 'messageEntityBold' as const, offset: 0, length: 4 }] },
    }
    const m = mapMessage(raw({ factcheck }))
    expect(m._ === 'message' && m.factcheck).toEqual(factcheck)
  })

  // Вложение — то, из чего бабл строится ЦЕЛИКОМ, без отдельного запроса меты
  // медиа. Маппер обязан прогнать его через `saveMessageMedia`: сам провод несёт
  // только атрибуты и ступени, а `doc.type`/`doc.w`/`doc.h`/`doc.duration`
  // выводит клиент — ровно как `appDocsManager.saveDoc` в оригинале.
  it('нормализует вложение: тип и геометрия выводятся из атрибутов', () => {
    const m = mapMessage(raw({
      media: {
        _: 'messageMediaDocument',
        document: {
          _: 'document', id: 42, mime_type: 'video/mp4', size: 9000000,
          thumbs: [
            { _: 'photoStrippedSize', type: 'i', bytes: 'AAECAw==' },
            { _: 'photoSize', type: 'y', w: 320, h: 180, size: 4096 },
          ],
          attributes: [
            { _: 'documentAttributeVideo', duration: 61, w: 1600, h: 900 },
            { _: 'documentAttributeFilename', file_name: 'clip.mp4' },
          ],
        },
      },
    }))
    const media = m._ === 'message' ? m.media : undefined
    expect(media?._).toBe('messageMediaDocument')
    const doc = media?._ === 'messageMediaDocument' ? media.document : undefined
    expect({ type: doc?.type, w: doc?.w, h: doc?.h, duration: doc?.duration, file_name: doc?.file_name })
      .toEqual({ type: 'video', w: 1600, h: 900, duration: 61, file_name: 'clip.mp4' })
    expect(doc?.thumbs?.map((t) => t._)).toEqual(['photoStrippedSize', 'photoSize'])
  })

  // Признак скрытого медиа ОДНОСТОРОННИЙ: ключ есть только когда true, поэтому
  // «нет ключа» обязано давать undefined, а не false.
  it('признак скрытого медиа живёт в pFlags и односторонний', () => {
    const media = {
      _: 'messageMediaPhoto' as const,
      pFlags: { spoiler: true as const },
      photo: { _: 'photo' as const, id: 43, sizes: [{ _: 'photoStrippedSize' as const, type: 'i', bytes: 'AAECAw==' }] },
    }
    const m = mapMessage(raw({ media }))
    expect(isMediaSpoiler(m._ === 'message' ? m : undefined)).toBe(true)
    const bare = mapMessage(raw({ media: { ...media, pFlags: {} } }))
    expect(isMediaSpoiler(bare._ === 'message' ? bare : undefined)).toBe(false)
  })

  // Агрегат реакций маппер НЕ РАЗБИРАЕТ: форма провода и форма модели совпали,
  // и платная ⭐-реакция едет чипом того же вектора, а не отдельным полем.
  // Операции над агрегатом — core/reactions/messageReactions.ts (свой тест).
  it('агрегат реакций доезжает конструктором, без плоской проекции', () => {
    const reactions = {
      _: 'messageReactions' as const,
      results: [
        { _: 'reactionCount' as const, reaction: { _: 'reactionEmoji' as const, emoticon: '👍' }, count: 2, chosen_order: 0 },
        { _: 'reactionCount' as const, reaction: { _: 'reactionPaid' as const }, count: 50 },
      ],
      top_reactors: [{ _: 'messageReactor' as const, pFlags: { my: true as const }, count: 30 }],
    }
    expect(mapMyMessage(raw({ reactions })).reactions).toBe(reactions)
  })

  // ТРЕД поста канала — параметр самого сообщения, и переводить в нём нечего:
  // номеров внутри (`max_id`/`read_max_id`) сервер не производит. Что ломается
  // без этой строки маппера: счётчик комментариев и стек аватаров в футере
  // поста пропадают вовсе — витрина читает их из сообщения
  // (components/messages/ChatFeed.tsx), а карты из отдельной ручки больше нет.
  it('тред комментариев доезжает конструктором и не разбирается', () => {
    const replies = {
      _: 'messageReplies' as const,
      pFlags: { comments: true as const },
      replies: 3,
      recent_repliers: [{ _: 'peerUser' as const, user_id: 8 }],
      channel_id: 77,
    }
    const m = mapMyMessage(raw({ replies }))
    expect(m._ === 'message' ? m.replies : undefined).toBe(replies)
  })
})

// Служебное действие: сервер производит НАСТОЯЩИЕ конструкторы схемы, клиент
// уточняет их до синтетических (порт appMessagesManager.ts:5215-5238).
describe('mapMessage — уточнение служебного действия', () => {
  const svc = (action: RawMessageService['action'], fromId: number) =>
    mapMessage(makeRawServiceMessage({ id: 1, peerId: -10, fromId, action }))

  it('удаление САМОГО СЕБЯ становится «покинул(а) группу»', () => {
    const m = svc({ _: 'messageActionChatDeleteUser', user_id: 7 }, 7)
    expect(m._ === 'messageService' && m.action._).toBe('messageActionChatLeave')
  })

  it('удаление ДРУГОГО остаётся messageActionChatDeleteUser', () => {
    const m = svc({ _: 'messageActionChatDeleteUser', user_id: 8 }, 7)
    expect(m._ === 'messageService' && m.action._).toBe('messageActionChatDeleteUser')
  })

  it('добавление НЕСКОЛЬКИХ становится messageActionChatAddUsers', () => {
    const m = svc({ _: 'messageActionChatAddUser', users: [8, 9] }, 7)
    expect(m._ === 'messageService' && m.action._).toBe('messageActionChatAddUsers')
  })

  it('добавление САМОГО СЕБЯ становится «присоединился(ась)»', () => {
    const m = svc({ _: 'messageActionChatAddUser', users: [7] }, 7)
    expect(m._ === 'messageService' && m.action._).toBe('messageActionChatJoined')
  })

  it('присоединился ЗРИТЕЛЬ — вариант с суффиксом You', () => {
    const m = mapMessage(
      makeRawServiceMessage({ id: 1, peerId: -10, fromId: 7, action: { _: 'messageActionChatAddUser', users: [7] } }),
      7,
    )
    expect(m._ === 'messageService' && m.action._).toBe('messageActionChatJoinedYou')
  })

  it('добавление ОДНОГО ДРУГОГО конструктор не меняет', () => {
    const m = svc({ _: 'messageActionChatAddUser', users: [8] }, 7)
    expect(m._ === 'messageService' && m.action._).toBe('messageActionChatAddUser')
  })
})

/**
 * Порт `Chat.isOurMessage` (tweb chat.ts:1374-1390). `pFlags.out` производит
 * СЕРВЕР (решение Р7 отменено) и отвечает «я ли отправил»; сторона бабла —
 * ДРУГОЙ вопрос, и ответ на него зависит от ВИДА ЧАТА, который предикату
 * приносит вызывающий.
 */
describe('isOurMessage — сторона бабла', () => {
  const ME = 7
  const withFrom = (out: boolean, fromId?: PeerId) =>
    mapMessage(makeRawMessage({ id: 1, peerId: -10, fromId, out })) as never

  /** Пост вещательного канала: `pFlags.post` фикстура не умеет — ставим руками. */
  const post = (fromId?: PeerId) => {
    const m = mapMessage(makeRawMessage({ id: 1, peerId: -10, fromId, out: true })) as RawMessageReal
    return { ...m, pFlags: { ...m.pFlags, post: true as const } } as never
  }

  const group = { myId: ME, isMegagroup: true }
  const broadcast = { myId: ME, isMegagroup: false }

  it('моё сообщение от человека — справа', () => {
    expect(isOurMessage(withFrom(true, ME), group)).toBe(true)
    expect(isOurMessage(withFrom(true, ME), broadcast)).toBe(true)
  })

  it('чужое сообщение — слева', () => {
    expect(isOurMessage(withFrom(false, 2), group)).toBe(false)
    expect(isOurMessage(withFrom(false, 2), broadcast)).toBe(false)
  })

  // Ветка `if(this.isMegagroup) return !!message.pFlags.out` (chat.ts:1375-1377).
  // Отправка от лица канала остаётся `out` у своего автора (бэкенд объявляет это
  // прямо, `MessageContext.Out`) — значит бабл ИСХОДЯЩИЙ, с именем канала.
  it('send-as в мегагруппе: автор — КАНАЛ, но бабл исходящий (сырой out)', () => {
    expect(isOurMessage(withFrom(true, -9), group)).toBe(true)
  })

  // Вне мегагруппы работает вторая ветка (`fromId === myId`), и там автор-канал
  // моим не является.
  it('вне мегагруппы автор-канал своим не считается', () => {
    expect(isOurMessage(withFrom(true, -9), broadcast)).toBe(false)
  })

  // `&& !message.pFlags.post` (chat.ts:1379): пост вещательного канала `out` у
  // выложившего его админа, но рисуется входящим у всех.
  it('пост канала — входящий даже у своего автора', () => {
    expect(isOurMessage(post(ME), broadcast)).toBe(false)
  })

  // `fromId` у поста «от самого пира» у нас нет, а у tweb он равен `peerId`
  // (appMessagesManager.ts:5090) — фолбэк держит сравнение осмысленным.
  it('пост без автора вовсе — входящий', () => {
    expect(isOurMessage(withFrom(true), broadcast)).toBe(false)
  })

  // Личность ещё не приехала (`myId === null`): своим не считается ничего, но
  // мегагруппа продолжает читать сырой `out` — ветка от личности не зависит.
  it('личность неизвестна: вне мегагруппы своих нет, в мегагруппе решает out', () => {
    expect(isOurMessage(withFrom(true, ME), { myId: null })).toBe(false)
    expect(isOurMessage(withFrom(true, ME), { myId: null, isMegagroup: true })).toBe(true)
  })
})

/**
 * Порт `Chat.isOutMessage` (tweb chat.ts:1392-1396) — именно ЭТОТ предикат
 * решает `is-out`/`is-in` (bubbles.ts:7613 → :9669), а не `isOurMessage`.
 * Разница ровно одна: самопересылка в «Избранное».
 */
describe('isOutMessage — сторона бабла', () => {
  const ME = 7
  const chat = { myId: ME }

  /** сообщение В «ИЗБРАННОМ» (`peerId === myId`) */
  const saved = (over: Partial<RawMessageReal> = {}) =>
    ({ ...mapMessage(makeRawMessage({ id: 1, peerId: ME, fromId: ME, out: true })), ...over }) as never

  const FWD = { _: 'messageFwdHeader' as const, date: 1_750_000_000, from_id: { _: 'peerUser' as const, user_id: 42 } }

  it('своё сообщение в «Избранном» — справа', () => {
    expect(isOutMessage(saved(), chat)).toBe(true)
  })

  // Пересылка в чат с самим собой рисуется СЛЕВА, от лица оригинального автора.
  it('пересылка в «Избранное» — слева, хотя сообщение своё', () => {
    const m = saved({ fwd_from: FWD })
    expect(isOurMessage(m, chat)).toBe(true) // «моё» — да
    expect(isOutMessage(m, chat)).toBe(false) // но бабл входящий
  })

  // Вне «Избранного» второй множитель тождественно истинен.
  it('пересылка в обычный чат остаётся исходящей', () => {
    const m = { ...mapMessage(makeRawMessage({ id: 1, peerId: 42, fromId: ME, out: true })), fwd_from: FWD } as never
    expect(isOutMessage(m, chat)).toBe(true)
  })

  it('чужое сообщение остаётся входящим и здесь', () => {
    const m = mapMessage(makeRawMessage({ id: 1, peerId: 42, fromId: 42 })) as never
    expect(isOutMessage(m, chat)).toBe(false)
  })
})
