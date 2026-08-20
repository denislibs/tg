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
}

/**
 * Клиентские параметры СВЕРХ `schema_additional_params.json`.
 *
 * Первая группа — НАШИ параметры вне схемы (секретные чаты, пометка неудачной
 * отправки, локальное превью, кэш расшифровки голосового): предмета в схеме у
 * них нет, механизм объявления штатный.
 *
 * Вторая — ДОЛГ «объединение MessageMedia не доведено»: гео, контакт, опрос,
 * чек-лист, розыгрыш, подарок, превью ссылки и платное медиа это КОНСТРУКТОРЫ
 * ТОГО ЖЕ объединения (`messageMediaGeo`/`Contact`/`Poll`/`ToDo`/`Giveaway`/
 * `WebPage`/`PaidMedia`), а у нас они по-прежнему собственные поля сообщения.
 * То же самое названо долгом и на бэкенде (`mediaUnionPending`).
 *
 * Третья — плоская проекция агрегатов реакций: подсистема реакций программой TL
 * ещё не пройдена, кадры `reaction`/`star_reaction` по-прежнему плоские.
 */
const OURS: Record<string, string[]> = {
  message: [
    'failed', 'secret', 'secretMedia', 'localUrl', 'transcription',
    'geo', 'contact', 'poll', 'checklist', 'giveaway', 'gift', 'web_page', 'paid_media',
    'starReaction',
  ],
  messageService: ['failed', 'secret', 'secretMedia', 'starReaction'],
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

  it('ловит служебное действие, подделанное JSON-строкой внутри текста', () => {
    const svc = { ...makeServiceMessage({ id: 1, peerId: -1, action: { _: 'messageActionPinMessage' } }), message: '{"action":"pin_message"}' }
    const { unexpected } = check(svc, 'message')
    expect(unexpected).toEqual([{ path: 'message', predicate: 'messageService', key: 'message' }])
  })
})
