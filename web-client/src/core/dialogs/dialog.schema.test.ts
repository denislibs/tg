// Механическая сверка модели диалогов со схемой TL.
//
// Зеркало `core/peers/peer.schema.test.ts` и `mtdialog_schema_test.go` на
// бэкенде: заявление «строка списка чатов один в один с оригиналом» проверяется
// по той же схеме, из которой генерируются типы, а не чтением глазами.
//
// Два утверждения, те же, что у пиров:
//  1. **Лишнего нет.** Каждый ключ — параметр конструктора схемы либо
//     клиентский параметр из `schema_additional_params.json` (для `dialog` это
//     `peerId` и `secret`; `lastMessage` — наш разрешённый `top_message`, см.
//     ниже).
//  2. **Пропущенное — названо.** Обязательные параметры, которых у нас нет,
//     сверяются с явным списком; новый молчаливый пропуск красит тест.
//
// ── Почему тип из `@layer` здесь не годится напрямую ────────────────────────
// По той же причине, что у пиров: `@layer` печатает `long` как `string | number`
// (у нас всюду число), а `dialog.draft` тянет за собой `DraftMessage`, которого
// мы не производим (решение Р10 — черновики живут своей ручкой и своим стором).
// `lastMessage` при этом ОСОЗНАННО отличается от клиентского `topMessage: any`
// оригинала: у нас это типизированный `Message`, разрешённый воркером (Р11).
import { describe, expect, it } from 'vitest'

import schema from '../../../../schema/schema.json'
import additionalParams from '../../../../schema/schema_additional_params.json'

import { makeDialog, makeLastMessage } from './testDialog'
import { EMPTY_NOTIFY_SETTINGS, MUTE_UNTIL_FOREVER } from './notifySettings'

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
 * Обязательные параметры схемы, которых мы не производим, — каждый с причиной
 * (решение Р10 разбора: пропуск НАЗЫВАЕТСЯ, а не забывается).
 */
const OMITTED_WITHOUT_SUBJECT: Record<string, string[]> = {
  // Непрочитанных голосов в опросах мы не считаем — ни колонки, ни счётчика.
  // Параметр обязательный, поэтому на фазе 2 его напишет кодек заглушкой-нулём.
  dialog: ['unread_poll_votes_count'],
}

/**
 * Клиентские параметры СВЕРХ `schema_additional_params.json`. Один: `lastMessage`
 * — разрешённый `top_message` (решение Р11). У оригинала на этом месте объявлен
 * `topMessage: any`, но имя другое и тип другой, поэтому объявляем своё, а не
 * притворяемся, что это оно.
 */
const OURS: Record<string, string[]> = {
  dialog: ['lastMessage'],
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
        if (!booleanFlags.has(flag)) unexpected.push({ path: `${path}.pFlags`, predicate, key: flag })
      }
      continue
    }
    if (!wireParams.has(key) && !clientParams.has(key)) unexpected.push({ path, predicate, key })
    // Вглубь идём только по объектам-конструкторам; `lastMessage` — наш
    // клиентский `Message`, у него своя (ещё не переведённая) форма.
    if (key !== 'lastMessage') walk(object[key], `${path}.${key}`, unexpected, omitted)
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

describe('модель диалогов совпадает со схемой TL', () => {
  it.each([
    ['dialog (полный)', makeDialog({
      peerId: -42,
      topMessage: 120,
      readInboxMaxId: 100,
      readOutboxMaxId: 90,
      unread: 3,
      unreadMentions: 1,
      unreadReactions: 2,
      pinned: true,
      archived: true,
      muteUntil: 1700000000,
      ttlPeriod: 86400,
      lastMessage: makeLastMessage({ peerId: -42, id: 120, text: 'привет' }),
    }) as unknown],
    ['dialog (пустой: только обязательное)', makeDialog({ peerId: 7 }) as unknown],
    ['dialog (замьючен навсегда)', makeDialog({ peerId: 7, muteUntil: true }) as unknown],
    ['peerNotifySettings (пустой)', EMPTY_NOTIFY_SETTINGS as unknown],
    ['peerNotifySettings (полный)', {
      _: 'peerNotifySettings',
      show_previews: false,
      silent: true,
      mute_until: MUTE_UNTIL_FOREVER,
      other_sound: { _: 'notificationSoundNone' },
    } as unknown],
    ['peerUser', { _: 'peerUser', user_id: 7 } as unknown],
    ['peerChannel', { _: 'peerChannel', channel_id: 42 } as unknown],
  ])('%s: лишних ключей нет и обязательные на месте', (_name, value) => {
    const { unexpected, omitted } = check(value, 'dialog')
    expect(unexpected).toEqual([])
    expect(omitted).toEqual([])
  })

  it('ловит снятое поле выжимки последнего сообщения', () => {
    const { unexpected } = check({ ...makeDialog({ peerId: 7 }), last_message: {} }, 'dialog')
    expect(unexpected).toEqual([{ path: 'dialog', predicate: 'dialog', key: 'last_message' }])
  })

  it('ловит вид чата, подделанный строкой', () => {
    const { unexpected } = check({ ...makeDialog({ peerId: 7 }), type: 'private' }, 'dialog')
    expect(unexpected).toEqual([{ path: 'dialog', predicate: 'dialog', key: 'type' }])
  })

  it('ловит булев мьют — в схеме его нет, есть срок', () => {
    const { unexpected } = check({ ...makeDialog({ peerId: 7 }), muted: true }, 'dialog')
    expect(unexpected).toEqual([{ path: 'dialog', predicate: 'dialog', key: 'muted' }])
  })

  it('ловит флаг схемы, вынесенный из pFlags на верхний уровень', () => {
    const { unexpected } = check({ ...makeDialog({ peerId: 7 }), pinned: true }, 'dialog')
    expect(unexpected).toEqual([{ path: 'dialog', predicate: 'dialog', key: 'pinned' }])
  })

  it('ловит пропущенный обязательный параметр', () => {
    const d = { ...makeDialog({ peerId: 7 }) } as unknown as Record<string, unknown>
    delete d.notify_settings
    const { omitted } = check(d, 'dialog')
    expect(omitted).toEqual([{ path: 'dialog', predicate: 'dialog', key: 'notify_settings' }])
  })
})
