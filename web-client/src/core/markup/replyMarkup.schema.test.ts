// Механическая сверка модели разметки клавиатур со схемой TL.
//
// Зеркало `core/media/messageMedia.schema.test.ts` (тем же приёмом, что на
// бэкенде `mtentity_schema_test.go` зеркалит `mtmedia_schema_test.go`):
// заявление «структуры один в один с оригиналом» проверяется по той же схеме,
// из которой генерируются типы, а не чтением глазами.
//
// Два утверждения:
//
// 1. **Лишнего нет.** Каждый ключ объекта — параметр конструктора из схемы либо
//    клиентский параметр из `schema_additional_params.json` (механизм оригинала:
//    префикс `flags.-1?` = «на провод не идёт»). Булевы флаги проверяются ТОЛЬКО
//    внутри `pFlags` — тот же флаг на верхнем уровне считается расхождением,
//    иначе `{resize: true}` рядом с `rows` проходил бы как валидный.
// 2. **Пропущенное — названо.** Обязательные параметры схемы, которых у нас нет,
//    сверяются с явным списком «нет предмета». Новый молчаливый пропуск красит.
import { describe, expect, it } from 'vitest'

import schema from '../../../../schema/schema.json'
import additionalParams from '../../../../schema/schema_additional_params.json'

import type { ReplyMarkup } from './replyMarkup'

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
 * Обязательных параметров, которых мы не переносим, у этих конструкторов нет:
 * `rows`/`buttons`/`text`/`url`/`data` есть у нас все. Список оставлен пустым
 * НАМЕРЕННО — если он понадобится, значит появился молчаливый пропуск, и его
 * придётся назвать здесь вслух.
 */
const OMITTED_WITHOUT_SUBJECT: Record<string, string[]> = {}

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
  const clientParams = new Set(additional.get(predicate) ?? [])

  for (const key of Object.keys(object)) {
    if (key === '_') continue

    if (key === 'pFlags') {
      const flags = object.pFlags as Record<string, unknown>
      for (const flag of Object.keys(flags)) {
        if (!booleanFlags.has(flag)) unexpected.push({ path: `${path}.pFlags`, predicate, key: flag })
      }
      continue
    }

    if (!wireParams.has(key) && !clientParams.has(key)) {
      unexpected.push({ path, predicate, key })
    }

    walk(object[key], `${path}.${key}`, unexpected, omitted)
  }

  for (const param of constructor.params) {
    if (!isRequired(param.type)) continue
    if (param.name in object) continue
    if (OMITTED_WITHOUT_SUBJECT[predicate]?.includes(param.name)) continue
    omitted.push({ path, predicate, key: param.name })
  }
}

function check(markup: ReplyMarkup) {
  const unexpected: Violation[] = []
  const omitted: Violation[] = []
  walk(markup, 'reply_markup', unexpected, omitted)
  return { unexpected, omitted }
}

// Провод: ровно то, что кладёт бэкенд для демо-бота.
const INLINE: ReplyMarkup = {
  _: 'replyInlineMarkup',
  rows: [
    {
      _: 'keyboardButtonRow',
      buttons: [
        // `data` в схеме — bytes; на проводе фазы 0 это base64-строка.
        { _: 'keyboardButtonCallback', text: 'Alert', data: 'YWxlcnQ=' },
        { _: 'keyboardButtonUrl', text: 'Сайт', url: 'https://telegram.org' },
      ],
    },
    { _: 'keyboardButtonRow', buttons: [{ _: 'keyboardButtonWebView', text: 'App', url: 'https://example.com/app' }] },
  ],
}

const KEYBOARD: ReplyMarkup = {
  _: 'replyKeyboardMarkup',
  pFlags: { resize: true, single_use: true },
  placeholder: 'Выберите',
  rows: [
    { _: 'keyboardButtonRow', buttons: [{ _: 'keyboardButton', text: 'Кнопка A' }, { _: 'keyboardButton', text: 'Кнопка B' }] },
    { _: 'keyboardButtonRow', buttons: [{ _: 'keyboardButton', text: '/hide' }] },
  ],
}

const HIDE: ReplyMarkup = { _: 'replyKeyboardHide' }
const FORCE_REPLY: ReplyMarkup = { _: 'replyKeyboardForceReply', pFlags: { single_use: true }, placeholder: 'Ответьте' }

describe('модель разметки клавиатур сходится со схемой TL', () => {
  const cases: [string, ReplyMarkup][] = [
    ['инлайн-клавиатура под баблом', INLINE],
    ['reply-клавиатура над композером', KEYBOARD],
    ['снятие клавиатуры', HIDE],
    ['форс-ответ', FORCE_REPLY],
  ]

  it.each(cases)('%s: лишних полей нет', (_name, markup) => {
    expect(check(markup).unexpected).toEqual([])
  })

  it.each(cases)('%s: пропущено только то, у чего нет предмета', (_name, markup) => {
    expect(check(markup).omitted).toEqual([])
  })

  it('поля flags в объекте нет — маска живёт только на проводе', () => {
    const withFlags = structuredClone(KEYBOARD) as unknown as Record<string, unknown>
    withFlags.flags = 1

    expect(check(withFlags as unknown as ReplyMarkup).unexpected).toEqual([
      { path: 'reply_markup', predicate: 'replyKeyboardMarkup', key: 'flags' },
    ])
  })

  it('булев флаг на верхнем уровне вместо pFlags — расхождение', () => {
    const flat = structuredClone(KEYBOARD) as unknown as Record<string, unknown>
    delete flat.pFlags
    flat.resize = true

    expect(check(flat as unknown as ReplyMarkup).unexpected).toEqual([
      { path: 'reply_markup', predicate: 'replyKeyboardMarkup', key: 'resize' },
    ])
  })

  it('наши прежние имена (inline/keyboard/one_time) схеме неизвестны', () => {
    const ours = { _: 'replyInlineMarkup', inline: [], one_time: true } as unknown as ReplyMarkup

    expect(check(ours).unexpected).toEqual([
      { path: 'reply_markup', predicate: 'replyInlineMarkup', key: 'inline' },
      { path: 'reply_markup', predicate: 'replyInlineMarkup', key: 'one_time' },
    ])
    expect(check(ours).omitted).toEqual([
      { path: 'reply_markup', predicate: 'replyInlineMarkup', key: 'rows' },
    ])
  })
})
