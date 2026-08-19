// Форма сущностей композера — как в схеме (TL): дискриминатор `_`, булевы флаги
// в `pFlags` («выключено» = ключа НЕТ), обязательные поля конструктора на месте.
// Разбор идёт на ОТПРАВКЕ, поэтому форма здесь — ровно то, что уходит на провод.
import { describe, expect, it } from 'vitest'

import { entitiesToFragment, parseMarkdown, serialize } from './markdown'

function span(cls: string, text: string): HTMLSpanElement {
  const el = document.createElement('span')
  el.className = cls
  el.textContent = text
  return el
}

describe('serialize — конструкторы сущностей', () => {
  it('<b> → messageEntityBold без лишних ключей', () => {
    const root = document.createElement('div')
    const b = document.createElement('b')
    b.textContent = 'жир'
    root.appendChild(b)

    expect(serialize(root).entities).toEqual([{ _: 'messageEntityBold', offset: 0, length: 3 }])
  })

  it('.md-quote → messageEntityBlockquote с pFlags (collapsed выключен = ключа нет)', () => {
    const root = document.createElement('div')
    root.appendChild(span('md-quote', 'цитата'))

    const [entity] = serialize(root).entities

    expect(entity).toEqual({ _: 'messageEntityBlockquote', offset: 0, length: 6, pFlags: {} })
    // «выключено» — это отсутствие ключа, а не false/null
    expect(Object.keys((entity as { pFlags: object }).pFlags)).toEqual([])
  })

  it('.md-pre без языка → messageEntityPre с обязательным language: ""', () => {
    const root = document.createElement('div')
    root.appendChild(span('md-pre', 'code'))

    expect(serialize(root).entities).toEqual([
      { _: 'messageEntityPre', offset: 0, length: 4, language: '' },
    ])
  })

  it('.md-spoiler → messageEntitySpoiler', () => {
    const root = document.createElement('div')
    root.appendChild(span('md-spoiler', 'секрет'))

    expect(serialize(root).entities).toEqual([{ _: 'messageEntitySpoiler', offset: 0, length: 6 }])
  })
})

describe('parseMarkdown — конструкторы сущностей на отправке', () => {
  it('парные маркеры дают bold/italic/strike/spoiler (таблица MARKDOWN_ENTITIES)', () => {
    expect(parseMarkdown('**b** __i__ ~~s~~ ||sp||').entities).toEqual([
      { _: 'messageEntityBold', offset: 0, length: 1 },
      { _: 'messageEntityItalic', offset: 2, length: 1 },
      { _: 'messageEntityStrike', offset: 4, length: 1 },
      { _: 'messageEntitySpoiler', offset: 6, length: 2 },
    ])
  })

  it('`код` → messageEntityCode, [текст](url) → messageEntityTextUrl', () => {
    expect(parseMarkdown('`c` [t](https://example.com)').entities).toEqual([
      { _: 'messageEntityCode', offset: 0, length: 1 },
      { _: 'messageEntityTextUrl', offset: 2, length: 1, url: 'https://example.com' },
    ])
  })
})

describe('entitiesToFragment — сущность → разметка композера (round-trip)', () => {
  it('messageEntityBlockquote → span.md-quote и обратно', () => {
    const frag = entitiesToFragment('цитата', [
      { _: 'messageEntityBlockquote', offset: 0, length: 6, pFlags: {} },
    ])
    const div = document.createElement('div')
    div.appendChild(frag)

    expect(div.querySelector('span.md-quote')?.textContent).toBe('цитата')
    expect(serialize(div).entities).toEqual([
      { _: 'messageEntityBlockquote', offset: 0, length: 6, pFlags: {} },
    ])
  })
})
