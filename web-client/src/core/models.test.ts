// src/core/models.test.ts
import { describe, it, expect } from 'vitest'
import {
  isOurMessage, mapChecklist, mapDraft, mapMessage, mapMyMessage,
  type RawChecklist, type RawMessageReal, type RawMessageService,
} from './models'
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
      geo: undefined,
      contact: undefined,
      poll: undefined,
      checklist: undefined,
      giveaway: undefined,
      gift: undefined,
      web_page: undefined,
      paid_media: undefined,
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

  it('превью ссылки приводится из проводной формы (подсистема WebPage не пройдена)', () => {
    const m = mapMessage(raw({
      web_page: {
        url: 'https://example.com', site_name: 'Example', title: 'Заголовок', description: 'Описание',
        photo_id: 42, photo_w: 1280, photo_h: 720, photo_blur: 'Ymx1cg==', photo_has_thumb: true, has_iv: true,
      },
    }))
    expect(m._ === 'message' && m.web_page).toEqual({
      url: 'https://example.com', siteName: 'Example', title: 'Заголовок', description: 'Описание',
      photoId: 42, photoW: 1280, photoH: 720, photoBlur: 'Ymx1cg==', photoHasThumb: true, hasIV: true,
    })
    expect(mapMessage(raw())).toMatchObject({ web_page: undefined })
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
    expect(m._ === 'message' && m.media?.pFlags?.spoiler).toBe(true)
    const bare = mapMessage(raw({ media: { ...media, pFlags: {} } }))
    expect(bare._ === 'message' && bare.media?.pFlags?.spoiler).toBeUndefined()
  })

  // Плоская проекция объединения `MessageReactions` — единственное, что маппер
  // ещё разбирает сверх номеров и ключей: подсистема реакций программой TL не
  // пройдена, кадры `reaction` по-прежнему плоские.
  it('агрегаты реакций приводятся из объединения MessageReactions', () => {
    const m = mapMyMessage(raw({
      reactions: {
        _: 'messageReactions',
        results: [
          { _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 2, chosen_order: 0 },
          { _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '🔥' }, count: 1 },
          { _: 'reactionCount', reaction: { _: 'reactionPaid' }, count: 50 },
        ],
        recent_reactions: [
          { _: 'messagePeerReaction', peer_id: { _: 'peerUser', user_id: 8 }, date: 0, reaction: { _: 'reactionEmoji', emoticon: '👍' } },
        ],
        top_reactors: [{ _: 'messageReactor', pFlags: { my: true }, count: 30 }],
      },
    }))
    expect(m.reactions).toEqual([
      { emoji: '👍', count: 2, mine: true, recent: [8] },
      { emoji: '🔥', count: 1, mine: false },
    ])
    expect(m.starReaction).toEqual({ total: 50, mine: 30 })
  })

  // «Моя» реакция — это НАЛИЧИЕ chosen_order, а не его истинность: ноль там
  // значит «моя первая», и склеивать его с «не моя» нельзя.
  it('chosen_order = 0 это «моя», а не «не моя»', () => {
    const m = mapMyMessage(raw({
      reactions: {
        _: 'messageReactions',
        results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 1, chosen_order: 0 }],
      },
    }))
    expect(m.reactions?.[0].mine).toBe(true)
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

describe('mapDraft', () => {
  it('maps entities and reply_to_id (draft_update frame / GET /drafts)', () => {
    const d = mapDraft({
      peer_id: 3, text: '**жирный**',
      entities: [{ _: 'messageEntityBold', offset: 0, length: 6 }],
      reply_to_id: 42, updated_at: '2026-07-21T10:00:00Z',
    })
    expect(d).toEqual({
      peerId: 3, text: '**жирный**',
      entities: [{ _: 'messageEntityBold', offset: 0, length: 6 }],
      replyToId: 42, updatedAt: '2026-07-21T10:00:00Z',
    })
  })

  it('defaults absent/null entities and reply_to_id', () => {
    const d = mapDraft({ peer_id: 3, text: 'x', entities: null, reply_to_id: null, updated_at: 't' })
    expect(d.entities).toBeUndefined()
    expect(d.replyToId).toBeNull()
    const d2 = mapDraft({ peer_id: 3, text: 'x', updated_at: 't' })
    expect(d2.entities).toBeUndefined()
    expect(d2.replyToId).toBeNull()
  })

  it('drops an empty entities array', () => {
    expect(mapDraft({ peer_id: 1, text: 'x', entities: [], updated_at: 't' }).entities).toBeUndefined()
  })
})

describe('mapChecklist', () => {
  it('maps items with marks and permission flags (snake_case → camelCase)', () => {
    const rawChecklist: RawChecklist = {
      id: 7, title: 'todo',
      items: [
        { id: 1, text: 'a', marked_by: [10, 11] },
        { id: 2, text: 'b', marked_by: [] },
      ],
      others_can_add: true, others_can_mark: false,
    }
    expect(mapChecklist(rawChecklist)).toEqual({
      id: 7, title: 'todo',
      items: [
        { id: 1, text: 'a', markedBy: [10, 11] },
        { id: 2, text: 'b', markedBy: [] },
      ],
      othersCanAdd: true, othersCanMark: false,
    })
  })

  it('defaults absent items/marks to empty arrays', () => {
    const c = mapChecklist({ id: 1, title: 't' } as unknown as RawChecklist)
    expect(c.items).toEqual([])
    expect(c.othersCanAdd).toBe(false)
    expect(c.othersCanMark).toBe(false)
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
