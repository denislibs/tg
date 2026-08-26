// Механическая сверка модели сообщения со схемой TL.
//
// Зеркало `core/dialogs/dialog.schema.test.ts`, `core/peers/peer.schema.test.ts`
// и `mtmessage_schema_test.go` на бэкенде: заявление «сообщение один в один с
// оригиналом» проверяется по той же схеме, из которой генерируются типы, а не
// чтением глазами.
//
// Два утверждения, те же, что у пиров и диалогов:
//  1. **Лишнего нет.** Каждый ключ — параметр конструктора схемы либо клиентский
//     параметр из `schema_additional_params.json`, либо назван в `OURS` ниже.
//  2. **Пропущенное — названо.** Обязательные параметры, которых у нас нет,
//     сверяются с явным списком; новый молчаливый пропуск красит тест.
import { describe, expect, it } from 'vitest'

import schema from '../../../../schema/schema.json'
import additionalParams from '../../../../schema/schema_additional_params.json'

import { makeMessage, makeServiceMessage } from './testMessage'

interface SchemaParam { name: string; type: string }
interface SchemaConstructor { id: string; predicate: string; params: SchemaParam[]; type: string }

const constructors = new Map<string, SchemaConstructor>(
  (schema.API.constructors as SchemaConstructor[]).map((c) => [c.predicate, c]),
)

const additional = new Map<string, string[]>(
  (additionalParams as { predicate: string; params?: SchemaParam[] }[]).map((c) => [
    c.predicate,
    (c.params ?? []).map((p) => p.name),
  ]),
)

const isBooleanFlag = (type: string) => type.endsWith('?true')
const isFlagsHolder = (type: string) => type === '#'
const isRequired = (type: string) => !type.includes('?') && !isFlagsHolder(type)

/**
 * Обязательные параметры схемы, которых мы не производим, — каждый с причиной.
 */
const OMITTED_WITHOUT_SUBJECT: Record<string, string[]> = {
  // `call_id` у нас uuid сигнальных кадров (callEngine) и на сообщение не
  // сохраняется — то же названо в `mtmessage.go`.
  messageActionPhoneCall: ['call_id'],
  // Реквизиты транспорта MTProto — решение подсистемы МЕДИА, повторено здесь
  // потому, что обход заходит во вложение (список 1:1 с
  // `core/media/messageMedia.schema.test.ts`).
  photo: ['access_hash', 'file_reference', 'date', 'dc_id'],
  document: ['access_hash', 'file_reference', 'date', 'dc_id'],
  // Журнала апдейтов У ТРЕДА у нас нет (pts на чат, а не на тред), горизонта
  // чтения внутри треда — тоже: прочитанность считается по чату обсуждения
  // целиком. То же названо на бэкенде — `domain/mtmessage.go`, докблок
  // MessageReplies.
  messageReplies: ['replies_pts'],
  // Внешность подарка в схеме — АНИМИРОВАННЫЙ СТИКЕР, у нас unicode-символ;
  // класть символ в поле документа нельзя, он едет клиентским `emoji`
  // (`schema_additional_params.json`, предикат `starGift`).
  starGift: ['sticker'],
}

/**
 * Клиентские параметры СВЕРХ `schema_additional_params.json`.
 *
 * Первая группа — НАШИ параметры вне схемы (секретные чаты, пометка неудачной
 * отправки, локальное превью, кэш расшифровки голосового): предмета в схеме у
 * них нет, механизм объявления штатный.
 *
 * Второй группы (ДОЛГ «объединение MessageMedia не доведено») здесь БОЛЬШЕ НЕТ:
 * гео, визитка, опрос, чек-лист, розыгрыш, превью ссылки и платное медиа стали
 * конструкторами того же `media`, а подарок — служебным сообщением с действием
 * `messageActionStarGift` (конструктора `messageMediaStarGift` в схеме нет
 * вовсе). Восемь строк allow-list'а ушли вместе с восемью полями.
 *
 * Плоской проекции агрегатов реакций здесь БОЛЬШЕ НЕТ: `reactions` — тот же
 * конструктор `messageReactions`, что и на проводе, а платная ⭐-реакция едет
 * чипом того же вектора, а не отдельным полем рядом.
 */
const OURS: Record<string, string[]> = {
  message: ['failed', 'secret', 'secretMedia', 'localUrl', 'transcription'],
  messageService: ['failed', 'secret', 'secretMedia'],
}

interface Violation { path: string; predicate: string; key: string }

function walk(value: unknown, path: string, unexpected: Violation[], omitted: Violation[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, unexpected, omitted))
    return
  }
  if (typeof value !== 'object' || value === null) return

  const object = value as Record<string, unknown>
  const predicate = object._
  if (typeof predicate !== 'string') return

  const constructor = constructors.get(predicate)
  if (!constructor) {
    unexpected.push({ path, predicate, key: '<конструктора нет в схеме>' })
    return
  }

  const wireParams = new Set(
    constructor.params.filter((p) => !isFlagsHolder(p.type) && !isBooleanFlag(p.type)).map((p) => p.name),
  )
  const booleanFlags = new Set(constructor.params.filter((p) => isBooleanFlag(p.type)).map((p) => p.name))
  const clientParams = new Set([...(additional.get(predicate) ?? []), ...(OURS[predicate] ?? [])])

  for (const key of Object.keys(object)) {
    if (key === '_') continue
    if (key === 'pFlags') {
      const flags = object.pFlags as Record<string, unknown>
      for (const flag of Object.keys(flags)) {
        if (!booleanFlags.has(flag) && !clientParams.has(flag)) {
          unexpected.push({ path: `${path}.pFlags`, predicate, key: flag })
        }
      }
      continue
    }
    if (!wireParams.has(key) && !clientParams.has(key)) unexpected.push({ path, predicate, key })
    walk(object[key], `${path}.${key}`, unexpected, omitted)
  }

  for (const param of constructor.params) {
    if (!isRequired(param.type)) continue
    if (param.name in object) continue
    if (OMITTED_WITHOUT_SUBJECT[predicate]?.includes(param.name)) continue
    omitted.push({ path, predicate, key: param.name })
  }
}

function check(value: unknown, root: string) {
  const unexpected: Violation[] = []
  const omitted: Violation[] = []
  walk(value, root, unexpected, omitted)
  return { unexpected, omitted }
}

describe('модель сообщения совпадает со схемой TL', () => {
  it.each([
    ['message (минимальный)', makeMessage({ id: 5, peerId: 1 }) as unknown],
    ['message (полный)', makeMessage({
      id: 5, peerId: -42, fromId: 7, text: 'привет', date: 1_750_000_000, out: true,
      entities: [{ _: 'messageEntityBold', offset: 0, length: 6 }],
      replyToMsgId: 4, threadRootId: 1, groupedId: 12345, randomId: 'c-1', editDate: 1_750_000_100,
      mediaUnread: true,
      media: {
        _: 'messageMediaDocument',
        pFlags: { spoiler: true },
        document: { _: 'document', id: 42, mime_type: 'video/mp4', size: 10, attributes: [], thumbs: [] },
      },
    }) as unknown],
    // ТРЕД поста канала — параметр самого сообщения (`replies`), а не своя
    // карта рядом: обход спускается в `messageReplies` и сверяет его наравне с
    // сообщением, включая ССЫЛКИ `recent_repliers` (Vector<Peer>).
    ['message (пост канала с тредом комментариев)', makeMessage({
      id: 11, peerId: -100, text: 'пост',
      replies: {
        _: 'messageReplies',
        pFlags: { comments: true },
        replies: 3,
        recent_repliers: [{ _: 'peerUser', user_id: 8 }, { _: 'peerUser', user_id: 9 }],
        channel_id: 77,
      },
    }) as unknown],
    // ОТВЕТЫ В ГРУППЕ — тот же конструктор без флага и без группы обсуждения:
    // комментарии канала это другой предмет (bubbles.ts:9699).
    ['message (ответы в группе)', makeMessage({
      id: 12, peerId: -42, fromId: 7, text: 'вопрос',
      replies: { _: 'messageReplies', replies: 2 },
    }) as unknown],
    ['messageService (пилюля закрепления)', makeServiceMessage({
      id: 6, peerId: -42, fromId: 7, replyToMsgId: 4, action: { _: 'messageActionPinMessage' },
    }) as unknown],
    ['messageService (лог звонка)', makeServiceMessage({
      id: 7, peerId: 9, fromId: 9,
      action: { _: 'messageActionPhoneCall', pFlags: { video: true }, reason: { _: 'phoneCallDiscardReasonHangup' }, duration: 42 },
    }) as unknown],
    ['messageService (добавление участников)', makeServiceMessage({
      id: 8, peerId: -42, fromId: 7, action: { _: 'messageActionChatAddUser', users: [1, 2] },
    }) as unknown],
    // ПОДАРОК — служебное сообщение с действием, а не вид вложения:
    // конструктора `messageMediaStarGift` в схеме нет вовсе.
    ['messageService (подарок за звёзды)', makeServiceMessage({
      id: 9, peerId: 7, fromId: 7,
      action: {
        _: 'messageActionStarGift',
        pFlags: { saved: true },
        gift: {
          _: 'starGift',
          pFlags: { limited: true },
          id: 3,
          emoji: '🎁',
          stars: 100,
          availability_remains: 5,
          availability_total: 10,
          convert_stars: 50,
          title: 'Подарок',
        },
        message: { _: 'textWithEntities', text: 'с днём рождения', entities: [] },
        convert_stars: 50,
        from_id: { _: 'peerUser', user_id: 7 },
        peer: { _: 'peerUser', user_id: 1 },
        saved_id: 77,
      },
    }) as unknown],
    // Агрегат реакций проверяется ТЕМ ЖЕ обходом, что и вложение: обход
    // рекурсивный, и каждый вложенный конструктор (`reactionCount`,
    // `reactionEmoji`, `reactionPaid`, `messagePeerReaction`, `messageReactor`)
    // сверяется со схемой наравне с самим сообщением. До порта здесь была
    // плоская проекция, которую сверять было не с чем.
    ['message (с агрегатом реакций)', {
      ...makeMessage({ id: 10, peerId: 1, fromId: 2, text: 'hi' }),
      reactions: {
        _: 'messageReactions',
        results: [
          { _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 2, chosen_order: 0 },
          { _: 'reactionCount', reaction: { _: 'reactionPaid' }, count: 50 },
        ],
        recent_reactions: [
          { _: 'messagePeerReaction', peer_id: { _: 'peerUser', user_id: 8 }, date: 0, reaction: { _: 'reactionEmoji', emoticon: '👍' } },
        ],
        top_reactors: [{ _: 'messageReactor', pFlags: { my: true }, count: 30 }],
      },
    } as unknown],
  ])('%s: лишних ключей нет и обязательные на месте', (_name, value) => {
    const { unexpected, omitted } = check(value, 'message')
    expect(unexpected).toEqual([])
    expect(omitted).toEqual([])
  })

  it('ловит снятое поле вида сообщения (прежний `type`)', () => {
    const { unexpected } = check({ ...makeMessage({ id: 1, peerId: 1 }), type: 'photo' }, 'message')
    expect(unexpected).toEqual([{ path: 'message', predicate: 'message', key: 'type' }])
  })

  it('ловит снятый снимок отвечаемого (прежний `reply_to` с текстом автора)', () => {
    const { unexpected } = check({ ...makeMessage({ id: 1, peerId: 1 }), reply_snapshot_name: 'Алиса' }, 'message')
    expect(unexpected).toEqual([{ path: 'message', predicate: 'message', key: 'reply_snapshot_name' }])
  })

  it('ловит снятый снимок send-as рядом с настоящим автором', () => {
    const { unexpected } = check({ ...makeMessage({ id: 1, peerId: 1 }), send_as: { peer_id: 9 } }, 'message')
    expect(unexpected).toEqual([{ path: 'message', predicate: 'message', key: 'send_as' }])
  })

  it('ловит флаг схемы, вынесенный из pFlags на верхний уровень', () => {
    const { unexpected } = check({ ...makeMessage({ id: 1, peerId: 1 }), out: true }, 'message')
    expect(unexpected).toEqual([{ path: 'message', predicate: 'message', key: 'out' }])
  })

  it('ловит пропущенный обязательный параметр', () => {
    const m = { ...makeMessage({ id: 1, peerId: 1 }) } as unknown as Record<string, unknown>
    delete m.peer_id
    const { omitted } = check(m, 'message')
    expect(omitted).toEqual([{ path: 'message', predicate: 'message', key: 'peer_id' }])
  })

  // Подарка КАК МЕДИА в схеме нет: `messageMediaStarGift` не существует, и
  // конструктор, названный так, обязан краснеть — вместе с прежним полем `gift`
  // у обычного сообщения.
  it('ловит подарок, положенный вложением вместо действия', () => {
    const asMedia = { ...makeMessage({ id: 1, peerId: 1 }), media: { _: 'messageMediaStarGift', gift: { _: 'starGift' } } }
    const { unexpected } = check(asMedia, 'message')
    expect(unexpected).toEqual([
      { path: 'message.media', predicate: 'messageMediaStarGift', key: '<конструктора нет в схеме>' },
    ])
  })

  it('ловит прежнее поле `gift` рядом с текстом сообщения', () => {
    const { unexpected } = check({ ...makeMessage({ id: 1, peerId: 1 }), gift: { id: 1 } }, 'message')
    expect(unexpected).toEqual([{ path: 'message', predicate: 'message', key: 'gift' }])
  })

  it('ловит прежние собственные ключи вложения рядом с `media`', () => {
    const flat = { ...makeMessage({ id: 1, peerId: 1 }), geo: {}, poll: {}, web_page: {}, paid_media: {} }
    const { unexpected } = check(flat, 'message')
    expect(unexpected.map((v) => v.key)).toEqual(['geo', 'poll', 'web_page', 'paid_media'])
  })

  it('ловит серверную склейку имени дарителя (имя собирает клиент)', () => {
    const svc = makeServiceMessage({
      id: 1, peerId: 1, fromId: 1,
      action: { _: 'messageActionStarGift', gift: { _: 'starGift', id: 1, stars: 1, convert_stars: 1 } },
    }) as unknown as { action: Record<string, unknown> }
    svc.action = { ...svc.action, from_name: 'Маша' }
    const { unexpected } = check(svc, 'message')
    expect(unexpected).toEqual([{ path: 'message.action', predicate: 'messageActionStarGift', key: 'from_name' }])
  })

  it('ловит служебное действие, подделанное JSON-строкой внутри текста', () => {
    const svc = { ...makeServiceMessage({ id: 1, peerId: -1, action: { _: 'messageActionPinMessage' } }), message: '{"action":"pin_message"}' }
    const { unexpected } = check(svc, 'message')
    expect(unexpected).toEqual([{ path: 'message', predicate: 'messageService', key: 'message' }])
  })
})
