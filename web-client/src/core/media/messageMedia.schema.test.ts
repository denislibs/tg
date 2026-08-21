// Механическая сверка модели медиа со схемой TL.
//
// Заявление «структуры один в один с оригиналом» до сих пор держалось на чтении
// глазами, а именно этот класс расхождений чтением и пропускается: поведение
// самосогласованное, просто поле называется иначе или лежит уровнем выше.
// Здесь оно проверяется механически — по той же схеме, из которой генерируются
// типы (`schema/schema.json` в корне репозитория).
//
// Проверяется двумя утверждениями:
//
// 1. **Лишнего нет.** Каждый ключ объекта — либо параметр конструктора из схемы,
//    либо параметр из `schema_additional_params.json` (механизм оригинала для
//    клиентских полей: префикс `flags.-1?` = «на провод не идёт»). Придуманное
//    поле не пройдёт: его придётся сначала объявить в схеме надстроек, а это
//    ровно та дисциплина, которой мы добиваемся.
//
// 2. **Пропущенное — названо.** Обязательные параметры схемы, которых у нас нет,
//    сверяются с ЯВНЫМ списком: это поля транспорта MTProto, у которых в нашей
//    схеме доступа нет предмета. Новый молчаливый пропуск красит тест.
//
// Чего тест НЕ проверяет: типы значений и порядок полей. Это работа кодека
// (фаза 2) — там расхождение видно побайтово.
import { describe, expect, it } from 'vitest'

import schema from '../../../../schema/schema.json'
import additionalParams from '../../../../schema/schema_additional_params.json'

import { saveMessageMedia, type MessageMedia } from './messageMedia'

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

/** Булев флаг схемы: живёт в `pFlags`, а не на верхнем уровне. */
const isBooleanFlag = (type: string) => type.endsWith('?true')
/** Сама битовая маска: в объекте её быть не должно — она только на проводе. */
const isFlagsHolder = (type: string) => type === '#'
const isRequired = (type: string) => !type.includes('?') && !isFlagsHolder(type)

/**
 * Обязательные параметры схемы, которых мы сознательно не переносим: у них нет
 * предмета в нашей схеме доступа. Файл адресуется числовым id через собственный
 * эндпоинт, набор стикеров — числовым `set_id` своей ручкой, датацентров и
 * протухающих ссылок у нас нет вовсе.
 */
const OMITTED_WITHOUT_SUBJECT: Record<string, string[]> = {
  photo: ['access_hash', 'file_reference', 'date', 'dc_id'],
  document: ['access_hash', 'file_reference', 'date', 'dc_id'],
  documentAttributeSticker: ['stickerset'],
  // `access_hash` точки — токен, которым оригинал подписывает запрос картинки
  // карты в своём прокси; у нас карту рисует клиент по координатам.
  geoPoint: ['access_hash'],
  // Реквизиты СПРАВОЧНИКА мест (foursquare/gplaces): идентификатор заведения в
  // чужой базе и его категория. Справочника у нас нет вовсе — точку с подписью
  // присылает сам отправитель.
  messageMediaVenue: ['provider', 'venue_id', 'venue_type'],
  // Хэш для кэширования запроса; хэш-кэширования запросов у нас нет вовсе.
  poll: ['hash'],
  // `id` — идентификатор КЭШИРОВАННОЙ страницы на сервере оригинала (у нас
  // превью это снимок на сообщении, отдельного объекта нет), `hash` — тот же
  // случай, что у `poll.hash`.
  webPage: ['id', 'hash'],
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

  // Булевы флаги ИСКЛЮЧЕНЫ из набора верхнего уровня намеренно: их место —
  // только в `pFlags`. Иначе `{spoiler: true}` рядом с `document` проходил бы
  // как валидный, а это ровно то расхождение, которое мы ловим.
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

function check(media: MessageMedia | undefined) {
  const unexpected: Violation[] = []
  const omitted: Violation[] = []
  walk(media, 'media', unexpected, omitted)
  return { unexpected, omitted }
}

// Провод: ровно то, что кладёт бэкенд (`domain/mtmedia.go`), до нормализации.
const VIDEO_WITH_THUMB: MessageMedia = {
  _: 'messageMediaDocument',
  pFlags: { spoiler: true },
  document: {
    _: 'document',
    id: 12,
    mime_type: 'video/mp4',
    size: 1024,
    thumbs: [
      { _: 'photoStrippedSize', type: 'i', bytes: 'AQID' },
      { _: 'photoSize', type: 'y', w: 320, h: 180, size: 4096 },
    ],
    attributes: [
      { _: 'documentAttributeVideo', duration: 7, w: 1280, h: 720 },
      { _: 'documentAttributeFilename', file_name: 'clip.mp4' },
    ],
  },
}

const STICKER_WITH_PATH: MessageMedia = {
  _: 'messageMediaDocument',
  document: {
    _: 'document',
    id: 48,
    mime_type: 'image/webp',
    size: 30000,
    thumbs: [{ _: 'photoPathSize', type: 'j', bytes: 'TTAgMA==' }],
    attributes: [
      { _: 'documentAttributeSticker', alt: '🔥' },
      { _: 'documentAttributeImageSize', w: 512, h: 512 },
    ],
  },
}

const VOICE: MessageMedia = {
  _: 'messageMediaDocument',
  document: {
    _: 'document',
    id: 46,
    mime_type: 'audio/ogg',
    size: 4200,
    attributes: [
      { _: 'documentAttributeAudio', pFlags: { voice: true }, duration: 7, waveform: 'HwAq' },
      { _: 'documentAttributeFilename', file_name: 'voice.ogg' },
    ],
  },
}

const PHOTO: MessageMedia = {
  _: 'messageMediaPhoto',
  photo: {
    _: 'photo',
    id: 3,
    sizes: [
      { _: 'photoStrippedSize', type: 'i', bytes: 'AQID' },
      { _: 'photoSize', type: 'y', w: 1280, h: 640, size: 90000 },
      { _: 'photoSize', type: 'w', w: 4000, h: 2000, size: 900000 },
    ],
  },
}

// ── Конструкторы, которыми объединение доведено до конца ────────────────────
// Прежде каждый из них ехал собственным ключом СООБЩЕНИЯ (`geo`, `contact`,
// `poll`, `checklist`, `giveaway`, `web_page`, `paid_media`), то есть вид
// вложения подделывался наличием поля. Механическая сверка со схемой держит
// именно это: придуманное поле не пройдёт, а обязательный пропуск обязан быть
// назван выше.

const GEO: MessageMedia = {
  _: 'messageMediaGeo',
  geo: { _: 'geoPoint', long: 37.6, lat: 55.7 },
}

const VENUE: MessageMedia = {
  _: 'messageMediaVenue',
  geo: { _: 'geoPoint', long: 37.6, lat: 55.7 },
  title: 'Кафе',
  address: 'ул. Пушкина, 1',
}

const GEO_LIVE: MessageMedia = {
  _: 'messageMediaGeoLive',
  geo: { _: 'geoPoint', long: 37.6, lat: 55.7 },
  heading: 90,
  period: 900,
}

const CONTACT: MessageMedia = {
  _: 'messageMediaContact',
  phone_number: '79990000000',
  first_name: 'Маша',
  // Пустая строка здесь — ЗНАЧЕНИЕ («фамилии нет»), а не отсутствие параметра.
  last_name: '',
  vcard: '',
  user_id: 42,
}

const POLL: MessageMedia = {
  _: 'messageMediaPoll',
  poll: {
    _: 'poll',
    id: 5,
    pFlags: { public_voters: true, quiz: true },
    question: { _: 'textWithEntities', text: 'Сколько?', entities: [] },
    answers: [
      { _: 'pollAnswer', text: { _: 'textWithEntities', text: 'два', entities: [] }, option: 'AA==' },
      { _: 'pollAnswer', text: { _: 'textWithEntities', text: 'три', entities: [] }, option: 'AQ==' },
    ],
  },
  results: {
    _: 'pollResults',
    total_voters: 2,
    results: [
      { _: 'pollAnswerVoters', pFlags: { chosen: true }, option: 'AA==', voters: 1 },
      { _: 'pollAnswerVoters', pFlags: { correct: true }, option: 'AQ==', voters: 1 },
    ],
  },
}

const TODO: MessageMedia = {
  _: 'messageMediaToDo',
  todo: {
    _: 'todoList',
    id: 8,
    pFlags: { others_can_complete: true },
    title: { _: 'textWithEntities', text: 'Список', entities: [] },
    list: [{ _: 'todoItem', id: 1, title: { _: 'textWithEntities', text: 'Купить хлеб', entities: [] } }],
  },
  completions: [{ _: 'todoCompletion', id: 1, completed_by: { _: 'peerUser', user_id: 7 }, date: 1_750_000_000 }],
}

const GIVEAWAY: MessageMedia = {
  _: 'messageMediaGiveaway',
  id: 9,
  pFlags: { winners_are_visible: true },
  channels: [42],
  quantity: 3,
  months: 6,
  until_date: 1_750_000_000,
}

const GIVEAWAY_RESULTS: MessageMedia = {
  _: 'messageMediaGiveawayResults',
  id: 9,
  channel_id: 42,
  launch_msg_id: 11,
  winners_count: 3,
  unclaimed_count: 0,
  winners: [1, 2, 3],
  stars: 500,
  until_date: 1_750_000_000,
}

const WEB_PAGE: MessageMedia = {
  _: 'messageMediaWebPage',
  webpage: {
    _: 'webPage',
    url: 'https://example.com/post',
    display_url: 'example.com/post',
    site_name: 'Example',
    title: 'Заголовок',
    description: 'Описание',
    has_iv: true,
    photo: {
      _: 'photo',
      id: 7,
      sizes: [
        { _: 'photoStrippedSize', type: 'i', bytes: 'AQID' },
        { _: 'photoSize', type: 'w', w: 1280, h: 720, size: 90000 },
      ],
    },
  },
}

const PAID_LOCKED: MessageMedia = {
  _: 'messageMediaPaidMedia',
  stars_amount: 25,
  extended_media: [{
    _: 'messageExtendedMediaPreview',
    w: 800,
    h: 600,
    thumb: { _: 'photoStrippedSize', type: 'i', bytes: 'AQID' },
  }],
}

const PAID_UNLOCKED: MessageMedia = {
  _: 'messageMediaPaidMedia',
  stars_amount: 25,
  extended_media: [{ _: 'messageExtendedMedia', media: PHOTO }],
}

describe('модель медиа сходится со схемой TL', () => {
  const cases: [string, MessageMedia][] = [
    ['видео с превью и заслонкой', VIDEO_WITH_THUMB],
    ['стикер с векторным контуром', STICKER_WITH_PATH],
    ['голосовое', VOICE],
    ['фотография с лестницей размеров', PHOTO],
    ['точка на карте', GEO],
    ['место с подписью', VENUE],
    ['живая трансляция', GEO_LIVE],
    ['визитка', CONTACT],
    ['опрос с итогами', POLL],
    ['чек-лист с отметкой', TODO],
    ['идущий розыгрыш', GIVEAWAY],
    ['состоявшийся розыгрыш', GIVEAWAY_RESULTS],
    ['превью ссылки с лестницей ступеней', WEB_PAGE],
    ['платное медиа — не оплачено', PAID_LOCKED],
    ['платное медиа — оплачено', PAID_UNLOCKED],
  ]

  it.each(cases)('%s: лишних полей нет', (_name, media) => {
    expect(check(media).unexpected).toEqual([])
  })

  it.each(cases)('%s: пропущено только то, у чего нет предмета', (_name, media) => {
    expect(check(media).omitted).toEqual([])
  })

  it.each(cases)('%s: после нормализации модель по-прежнему сходится', (_name, media) => {
    // `saveDocument` дописывает клиентские поля (`type`/`w`/`h`/`duration`/…).
    // Все они обязаны быть объявлены в `schema_additional_params.json` — иначе
    // это придуманное поле, а не механизм оригинала.
    const normalized = saveMessageMedia(structuredClone(media))
    expect(check(normalized).unexpected).toEqual([])
  })

  it('поля flags в объекте нет — маска живёт только на проводе', () => {
    const withFlags = structuredClone(VIDEO_WITH_THUMB) as unknown as Record<string, unknown>
    ;(withFlags.document as Record<string, unknown>).flags = 1

    expect(check(withFlags as unknown as MessageMedia).unexpected).toEqual([
      { path: 'media.document', predicate: 'document', key: 'flags' },
    ])
  })

  // Прежние формы, каждая — «предмет был, а на провод выходил подделанным».
  // Тест обязан краснеть на их возвращении.
  it('ловит прежний булев флаг «трансляция остановлена»', () => {
    const stopped = { ...structuredClone(GEO_LIVE), live_stopped: true }
    expect(check(stopped as unknown as MessageMedia).unexpected).toEqual([
      { path: 'media', predicate: 'messageMediaGeoLive', key: 'live_stopped' },
    ])
  })

  it('ловит прежние плоские поля картинки превью ссылки', () => {
    const flat = structuredClone(WEB_PAGE) as unknown as Record<string, unknown>
    const page = (flat.webpage as Record<string, unknown>)
    delete page.photo
    page.photo_id = 7
    page.photo_w = 1280
    expect(check(flat as unknown as MessageMedia).unexpected).toEqual([
      { path: 'media.webpage', predicate: 'webPage', key: 'photo_id' },
      { path: 'media.webpage', predicate: 'webPage', key: 'photo_w' },
    ])
  })

  it('ловит прежний булев ключ «заблокировано» рядом с ценой', () => {
    const flat = { ...structuredClone(PAID_LOCKED), locked: true }
    expect(check(flat as unknown as MessageMedia).unexpected).toEqual([
      { path: 'media', predicate: 'messageMediaPaidMedia', key: 'locked' },
    ])
  })

  it('ловит прежний массив «мой выбор» рядом со счётчиками', () => {
    const flat = structuredClone(POLL) as unknown as Record<string, unknown>
    ;(flat.results as Record<string, unknown>).my_votes = [0]
    expect(check(flat as unknown as MessageMedia).unexpected).toEqual([
      { path: 'media.results', predicate: 'pollResults', key: 'my_votes' },
    ])
  })

  it('ловит прежнее «участвую ли» внутри розыгрыша (место ему — в ответе ручки)', () => {
    const flat = { ...structuredClone(GIVEAWAY), pFlags: { participating: true } }
    expect(check(flat as unknown as MessageMedia).unexpected).toEqual([
      { path: 'media.pFlags', predicate: 'messageMediaGiveaway', key: 'participating' },
    ])
  })

  it('булев флаг на верхнем уровне вместо pFlags — расхождение', () => {
    const flat = structuredClone(VIDEO_WITH_THUMB) as unknown as Record<string, unknown>
    delete flat.pFlags
    flat.spoiler = true

    expect(check(flat as unknown as MessageMedia).unexpected).toEqual([
      { path: 'media', predicate: 'messageMediaDocument', key: 'spoiler' },
    ])
  })
})
