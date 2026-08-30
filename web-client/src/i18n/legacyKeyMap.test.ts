import { describe, expect, it } from 'vitest'

import lang from '../lang'
import { en } from './dict'
import ru from './dict.ru'
import { LEGACY_ALIASES, LEGACY_KEY_MAP, LEGACY_PLURAL_GROUPS } from './legacyKeyMap'

// Карта — единственное, что связывает старые ключи («ключ = английская строка») с
// символическими. Если она дырявая или неоднозначная, кодмод задачи 6 молча потеряет строки,
// поэтому проверяем именно полноту и однозначность, а не «файл импортируется».

const MERGED = { ...LEGACY_PLURAL_GROUPS, ...LEGACY_ALIASES }

describe('карта миграции ключей', () => {
  it('покрывает каждый ключ нынешнего словаря', () => {
    const missing = Object.keys(ru).filter((k) => !(k in LEGACY_KEY_MAP))
    expect(missing).toEqual([])
  })

  it('покрывает и английские исключения (текст не равен ключу)', () => {
    const missing = Object.keys(en).filter((k) => !(k in LEGACY_KEY_MAP))
    expect(missing).toEqual([])
  })

  it('не отображает два разных ключа в один', () => {
    const seen = new Map<string, string>()
    const collisions: string[] = []
    for (const [legacy, key] of Object.entries(LEGACY_KEY_MAP)) {
      if (key in MERGED) continue // объявленное слияние — проверяется отдельно ниже
      const prev = seen.get(key)
      if (prev && prev !== legacy) collisions.push(`${key}: ${prev} / ${legacy}`)
      seen.set(key, legacy)
    }
    expect(collisions).toEqual([])
  })

  it('каждый символический ключ есть в английском источнике', () => {
    const orphans = Object.values(LEGACY_KEY_MAP).filter((k) => !(k in lang))
    expect(orphans).toEqual([])
  })
})

// Списки слияний освобождают ключи от проверки однозначности — значит, они сами обязаны быть
// точными. Иначе достаточно вписать туда что угодно, чтобы проверка выше перестала ловить.
describe('объявленные слияния', () => {
  it('перечисляют ровно те старые ключи, что смотрят в этот символический', () => {
    const actual = new Map<string, string[]>()
    for (const [legacy, key] of Object.entries(LEGACY_KEY_MAP)) {
      if (!(key in MERGED)) continue
      actual.set(key, [...(actual.get(key) ?? []), legacy])
    }
    const wrong: string[] = []
    for (const [key, declared] of Object.entries(MERGED)) {
      const got = (actual.get(key) ?? []).slice().sort()
      const want = declared.slice().sort()
      if (got.join(' ') !== want.join(' ')) {
        wrong.push(`${key}: объявлено [${want.join(', ')}], в карте [${got.join(', ')}]`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('не бывают из одного ключа — иначе слияния нет и объявление лишнее', () => {
    const single = Object.entries(MERGED)
      .filter(([, keys]) => keys.length < 2)
      .map(([key]) => key)
    expect(single).toEqual([])
  })

  it('у формы числа значение в lang.ts — объект с формами, а не строка', () => {
    const flat = Object.keys(LEGACY_PLURAL_GROUPS).filter((key) => typeof lang[key as keyof typeof lang] === 'string')
    expect(flat).toEqual([])
  })
})
