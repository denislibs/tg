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

describe('модель медиа сходится со схемой TL', () => {
  const cases: [string, MessageMedia][] = [
    ['видео с превью и заслонкой', VIDEO_WITH_THUMB],
    ['стикер с векторным контуром', STICKER_WITH_PATH],
    ['голосовое', VOICE],
    ['фотография с лестницей размеров', PHOTO],
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

  it('булев флаг на верхнем уровне вместо pFlags — расхождение', () => {
    const flat = structuredClone(VIDEO_WITH_THUMB) as unknown as Record<string, unknown>
    delete flat.pFlags
    flat.spoiler = true

    expect(check(flat as unknown as MessageMedia).unexpected).toEqual([
      { path: 'media', predicate: 'messageMediaDocument', key: 'spoiler' },
    ])
  })
})
