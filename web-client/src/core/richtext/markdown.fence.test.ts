// Язык fenced-блока в `parseMarkdown` (порт tweb `lib/richTextProcessor/
// parseMarkdown.ts:66-79`).
//
// Правило оригинала: первая строка fence — это ЯЗЫК только когда она одиночный
// идентификатор (```json). Иначе это код. Без проверки ```{"a":1}``` терял
// содержимое целиком — язык съедал первую строку, а код оставался пустым.
// Разбор идёт на ОТПРАВКЕ (Composer), то есть потеря необратима.
import { describe, expect, it } from 'vitest'

import { parseMarkdown } from './markdown'

describe('parseMarkdown — язык fenced-блока', () => {
  it('одиночный идентификатор становится языком', () => {
    const { text, entities } = parseMarkdown('```json\n{"a":1}\n```')
    expect(text).toBe('{"a":1}')
    expect(entities).toEqual([
      { _: 'messageEntityPre', offset: 0, length: 7, language: 'json' },
    ])
  })

  it('не-идентификатор остаётся кодом, а не языком', () => {
    const { text, entities } = parseMarkdown('```{"a":1}\n```')
    expect(text).toBe('{"a":1}')
    expect(entities).toEqual([
      { _: 'messageEntityPre', offset: 0, length: 7, language: '' },
    ])
  })

  it('многострочный код с открывающей фигурной скобкой на строке fence не теряет первую строку', () => {
    const { text } = parseMarkdown('```<div>\nhello\n```')
    expect(text).toBe('<div>\nhello')
  })

  it('fence без языка работает как прежде', () => {
    const { text, entities } = parseMarkdown('```\nplain\n```')
    expect(text).toBe('plain')
    expect(entities).toEqual([
      { _: 'messageEntityPre', offset: 0, length: 5, language: '' },
    ])
  })
})
