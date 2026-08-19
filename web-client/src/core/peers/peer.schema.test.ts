// Механическая сверка модели пиров и чатов со схемой TL.
//
// Зеркало `core/media/messageMedia.schema.test.ts` и
// `core/markup/replyMarkup.schema.test.ts` (на бэкенде ту же роль играет
// `mtpeer_schema_test.go`): заявление «структуры один в один с оригиналом»
// проверяется по той же схеме, из которой генерируются типы, а не чтением
// глазами.
//
// Два утверждения:
//  1. **Лишнего нет.** Каждый ключ объекта — параметр конструктора из схемы
//     либо клиентский параметр из `schema_additional_params.json`. Булевы
//     флаги проверяются ТОЛЬКО внутри `pFlags`.
//  2. **Пропущенное — названо.** Обязательные параметры схемы, которых у нас
//     нет, сверяются с явным списком «нет предмета»; новый молчаливый пропуск
//     красит тест.
//
// ── Почему тип из `@layer` здесь не годится напрямую ────────────────────────
// Тот же вопрос задавался у медиа и у разметки; у сущностей ответ был «годится»
// и рукописный тип был удалён. У пиров — НЕ годится, и причин три:
//
//  • `userProfilePhoto.stripped_thumb` и `chatPhoto.stripped_thumb` в схеме
//    `bytes`, то есть `Uint8Array`, а на нашем проводе фазы 0 (JSON) байты едут
//    base64-строкой — ровно как `photoStrippedSize.bytes` у медиа и
//    `keyboardButtonCallback.data` у разметки;
//  • у тех же конструкторов ОБЯЗАТЕЛЕН `dc_id: int`, у `channelForbidden` —
//    `access_hash: long`, у `chat` — `version: int`. Это реквизиты транспорта
//    и синхронизации MTProto, которых мы не производим по решению программы;
//  • `id` в `@layer` объявлен как `string | number` (в схеме `long`), а у нас
//    всюду число — ключ пира это `PeerId = number`, и `string | number` протёк
//    бы в арифметику знака.
//
// Переход к `@layer` для пиров становится естественным на фазе 2 вместе с
// кодеком, когда `bytes` перестанет быть строкой, а заглушки обязательных
// параметров начнёт писать сам кодек. До тех пор рукописные типы остаются — и
// это не дыра: их совпадение со схемой проверяется механически с обеих сторон
// провода, что сильнее любого совпадения типов.
import { describe, expect, it } from 'vitest'

import schema from '../../../../schema/schema.json'
import additionalParams from '../../../../schema/schema_additional_params.json'

import type { Chat, MessagesChatFull, User, UsersUserFull } from './peer'

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
 * Список не «чтобы тест позеленел»: он и есть перечень мест, где наша модель
 * заведомо у́же схемы, и на фазе 2 к каждому добавится вопрос «а что пишется
 * вместо» (см. `docs/readiness/tl-program.md`, раздел про заглушки).
 */
const OMITTED_WITHOUT_SUBJECT: Record<string, string[]> = {
  // Реквизиты транспорта MTProto: dc_id адресует датацентр, которого у нас нет
  // (медиа адресуется числовым id через собственный эндпоинт).
  userProfilePhoto: ['dc_id'],
  chatPhoto: ['dc_id'],
  // version — счётчик синхронизации участников базовой группы; сама базовая
  // группа не производится (решение №2), а апдейты у нас свои с pts на чат.
  chat: ['version'],
  // access_hash — реквизит транспорта.
  channelForbidden: ['access_hash'],
  // Настройки уведомлений, кнопки «Добавить в контакты»/«Заблокировать»,
  // счётчик общих чатов, участники, карточки ботов — своих подсистем у нас нет
  // либо они живут отдельными ручками (участники — со страницами).
  userFull: ['settings', 'notify_settings', 'common_chats_count'],
  chatFull: ['participants', 'notify_settings'],
  channelFull: ['notify_settings', 'bot_info', 'pts', 'chat_photo'],
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

function check(value: unknown, root: string) {
  const unexpected: Violation[] = []
  const omitted: Violation[] = []
  walk(value, root, unexpected, omitted)
  return { unexpected, omitted }
}

// Провод: ровно то, что кладут витрины бэкенда после шага C.
const USER: User = {
  _: 'user',
  pFlags: { contact: true, verified: true, premium: true },
  id: 7,
  first_name: 'Аня',
  last_name: 'Петрова',
  username: 'anna',
  phone: '+79990000000',
  // `stripped_thumb` в схеме — bytes; на проводе фазы 0 это base64-строка.
  photo: { _: 'userProfilePhoto', pFlags: { has_video: true }, photo_id: 9, stripped_thumb: 'AQIDBA==' },
  status: { _: 'userStatusOnline', expires: 1700000000 },
  emoji_status_emoticon: '🌚',
}

const CHANNEL: Chat = {
  _: 'channel',
  pFlags: { megagroup: true, forum: true, creator: true },
  id: 42,
  title: 'Команда',
  username: 'team',
  photo: { _: 'chatPhoto', photo_id: 11, stripped_thumb: 'AQIDBA==' },
  date: 1700000000,
  admin_rights: { _: 'chatAdminRights', pFlags: { change_info: true, pin_messages: true } },
  default_banned_rights: { _: 'chatBannedRights', pFlags: { send_media: true }, until_date: 0 },
  participants_count: 5,
}

const USERS_USER_FULL: UsersUserFull = {
  _: 'users.userFull',
  full_user: {
    _: 'userFull',
    pFlags: { blocked: true },
    id: 7,
    about: 'био',
    ttl_period: 86400,
    birthday: { _: 'birthday', day: 3, month: 5, year: 1990 },
  },
  chats: [],
  users: [USER as never],
}

const MESSAGES_CHAT_FULL: MessagesChatFull = {
  _: 'messages.chatFull',
  full_chat: {
    _: 'channelFull',
    pFlags: { hidden_prehistory: true },
    id: 42,
    about: 'о группе',
    read_inbox_max_id: 0,
    read_outbox_max_id: 0,
    unread_count: 0,
    chat_photo: null,
    participants_count: 5,
    slowmode_seconds: 0,
    available_reactions: { _: 'chatReactionsSome', reactions: [{ _: 'reactionEmoji', emoticon: '👍' }] },
  },
  chats: [CHANNEL],
  users: [],
}

describe('модель пиров совпадает со схемой TL', () => {
  it.each([
    ['user', USER as unknown, 'user'],
    ['channel', CHANNEL as unknown, 'chat'],
    ['users.userFull', USERS_USER_FULL as unknown, 'users_user_full'],
    ['messages.chatFull', MESSAGES_CHAT_FULL as unknown, 'messages_chat_full'],
    ['userStatusRecently', { _: 'userStatusRecently', pFlags: { by_me: true } } as unknown, 'status'],
    ['chatReactionsAll', { _: 'chatReactionsAll', pFlags: { allow_custom: true } } as unknown, 'reactions'],
    ['channelForbidden', { _: 'channelForbidden', pFlags: { broadcast: true }, id: 1, title: 'x' } as unknown, 'chat'],
    ['chatForbidden', { _: 'chatForbidden', id: 1, title: 'x' } as unknown, 'chat'],
    ['userEmpty', { _: 'userEmpty', id: 1 } as unknown, 'user'],
    ['chatEmpty', { _: 'chatEmpty', id: 1 } as unknown, 'chat'],
  ])('%s: лишних ключей нет и обязательные на месте', (_name, value, root) => {
    const { unexpected, omitted } = check(value, root)
    expect(unexpected).toEqual([])
    expect(omitted).toEqual([])
  })

  it('ловит ключ, которого в схеме нет', () => {
    const { unexpected } = check({ ...USER, display_name: 'Аня Петрова' }, 'user')
    expect(unexpected).toEqual([{ path: 'user', predicate: 'user', key: 'display_name' }])
  })

  it('ловит булев флаг, вынесенный из pFlags на верхний уровень', () => {
    const { unexpected } = check({ ...CHANNEL, megagroup: true }, 'chat')
    expect(unexpected).toEqual([{ path: 'chat', predicate: 'channel', key: 'megagroup' }])
  })

  it('ловит выдуманный флаг внутри pFlags', () => {
    const { unexpected } = check({ ...USER, pFlags: { online: true } }, 'user')
    expect(unexpected).toEqual([{ path: 'user.pFlags', predicate: 'user', key: 'online' }])
  })
})
