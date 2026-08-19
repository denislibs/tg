// Конвейер служебных сущностей (порт tweb parseEntities + mergeEntities).
// Без него однопроходный wrapRichText не увидит ни автолинков, ни переводов строк:
// сервер их не присылает.
//
// Сущность — TL-объект схемы: ветвление и проверки по конструктору `_`
// (`messageEntityUrl`, `messageEntityEmoji`, …), как в оригинале.
import { describe, it, expect } from 'vitest'
import type { MessageEntity } from '@core/models'
import parseEntities, { wrapMessageEntities } from './parseEntities'
import { mergeEntities, sortEntities } from './entities'

describe('parseEntities — служебные сущности', () => {
  it('находит @упоминание, #хэштег, url, перевод строки и эмодзи', () => {
    const found = parseEntities('hi @username1 #tag\nhttps://example.com 😀')

    expect(found.map((e) => e._)).toEqual([
      'messageEntityMention', 'messageEntityHashtag', 'messageEntityLinebreak',
      'messageEntityUrl', 'messageEntityEmoji',
    ])
  })

  it('offset/length указывают на сам текст сущности (UTF-16, как у бэка)', () => {
    const text = 'см. https://example.com/x'
    const [url] = parseEntities(text)

    expect(text.slice(url.offset, (url.offset ?? 0) + (url.length ?? 0))).toBe('https://example.com/x')
  })

  it('email отличается от url', () => {
    expect(parseEntities('mail user@example.com now')[0]._).toBe('messageEntityEmail')
  })

  it('незакрытая скобка не втягивается в url (checkBrackets)', () => {
    const text = '(см. https://example.com/x)'
    const url = parseEntities(text).find((e) => e._ === 'messageEntityUrl')!

    expect(text.slice(url.offset, url.offset + url.length)).toBe('https://example.com/x')
  })

  it('домен с неизвестным TLD не линкуется', () => {
    expect(parseEntities('файл archive.tarbomb рядом').some((e) => e._ === 'messageEntityUrl')).toBe(false)
  })
})

describe('mergeEntities — серверные сущности главнее найденных', () => {
  it('ссылка из сущности сервера вытесняет найденный на том же месте url', () => {
    const text = 'https://example.com'
    const server: MessageEntity[] = [{ _: 'messageEntityTextUrl', offset: 0, length: text.length, url: 'https://other.example' }]
    const merged = mergeEntities(server, parseEntities(text))

    expect(merged.filter((e) => e._ === 'messageEntityUrl').length).toBe(0)
    expect(merged.filter((e) => e._ === 'messageEntityTextUrl').length).toBe(1)
  })

  it('форматирование и эмодзи уживаются (PASS_CONFLICTING_ENTITIES)', () => {
    const merged = mergeEntities(
      [{ _: 'messageEntityBold', offset: 0, length: 2 }],
      parseEntities('😀'),
    )

    expect(merged.map((e) => e._).sort()).toEqual(['messageEntityBold', 'messageEntityEmoji'])
  })

  it('внутри code служебные сущности не создаются (SINGLE_ENTITIES)', () => {
    const text = 'https://example.com'
    const merged = mergeEntities([{ _: 'messageEntityCode', offset: 0, length: text.length }], parseEntities(text))

    expect(merged.map((e) => e._)).toEqual(['messageEntityCode'])
  })

  it('blockquote поверх code проходит (PASS_SINGLE_CONFLICTING_ENTITIES_WITH_QUOTE)', () => {
    const merged = mergeEntities(
      [{ _: 'messageEntityCode', offset: 0, length: 4 }],
      [{ _: 'messageEntityBlockquote', offset: 0, length: 4, pFlags: {} }],
    )

    expect(merged.map((e) => e._)).toEqual(['messageEntityCode', 'messageEntityBlockquote'])
  })
})

describe('sortEntities — порядок обхода однопроходной схемы', () => {
  it('по offset, при равном offset длинная раньше короткой', () => {
    const entities: MessageEntity[] = [
      { _: 'messageEntityBold', offset: 5, length: 1 },
      { _: 'messageEntityItalic', offset: 0, length: 2 },
      { _: 'messageEntityUnderline', offset: 0, length: 5 },
    ]
    sortEntities(entities)

    expect(entities.map((e) => e._)).toEqual([
      'messageEntityUnderline', 'messageEntityItalic', 'messageEntityBold',
    ])
  })
})

describe('wrapMessageEntities — сущности сообщения не мутируются', () => {
  it('fixEmoji правит копии, оригинал остаётся прежним', () => {
    // '❤' без VS16 — fixEmoji допишет его и сдвинет всё, что правее
    const entities: MessageEntity[] = [{ _: 'messageEntityBold', offset: 2, length: 4 }]
    const snapshot = JSON.stringify(entities)

    const { message, entities: copied } = wrapMessageEntities('❤ хвост', entities)

    expect(JSON.stringify(entities)).toBe(snapshot)
    expect(message).not.toBe('❤ хвост')
    expect(copied[0].offset).toBe(3)
  })
})
