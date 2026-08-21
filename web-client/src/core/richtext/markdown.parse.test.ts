// Разбор маркеров на отправке — порт tweb `lib/richTextProcessor/parseMarkdown.ts`
// (`MARKDOWN_REG_EXP` + `MARKDOWN_ENTITIES` + `findConflictingEntity`/
// `mergeEntities`/`combineSameEntities`) и резка длинного сообщения — порт
// `helpers/string/splitStringByLength.ts` + `helpers/sliceMessageEntities.ts`.
//
// Разбор идёт НА ОТПРАВКЕ: инпут хранит сырые маркеры, и всё, что здесь съедено
// или переформатировано неверно, уезжает на сервер уже испорченным. Поэтому
// каждое правило оригинала пиним отдельно.
import { describe, expect, it } from 'vitest'
import type { MessageEntity } from '@layer'

import { parseMarkdown, serialize, splitRich } from './markdown'

describe('parseMarkdown — границы выражения (группы 1/5/6/9 MARKDOWN_REG_EXP)', () => {
  it('маркер посреди слова НЕ форматирует (`a**b**c` уезжает как есть)', () => {
    expect(parseMarkdown('a**b**c')).toEqual({ text: 'a**b**c', entities: [] })
  })

  it('тот же маркер на границе слова — форматирует', () => {
    expect(parseMarkdown('**b**')).toEqual({
      text: 'b',
      entities: [{ _: 'messageEntityBold', offset: 0, length: 1 }],
    })
  })
})

describe('parseMarkdown — таблица MARKDOWN_ENTITIES целиком', () => {
  it('`_-_` — подчёркивание (маркер, которого не знал прежний разбор)', () => {
    expect(parseMarkdown('x _-_под_-_ y')).toEqual({
      text: 'x под y',
      entities: [{ _: 'messageEntityUnderline', offset: 2, length: 3 }],
    })
  })

  it('fence из ЧЕТЫРЁХ бэктиков — тот же pre', () => {
    expect(parseMarkdown('````\ncode\n````')).toEqual({
      text: 'code',
      entities: [{ _: 'messageEntityPre', language: '', offset: 0, length: 4 }],
    })
  })

  it('упоминание по id (`@123 (Имя)`) — messageEntityMentionName', () => {
    expect(parseMarkdown('привет @123 (Денис) пока')).toEqual({
      text: 'привет Денис пока',
      entities: [{ _: 'messageEntityMentionName', user_id: 123, offset: 7, length: 5 }],
    })
  })
})

describe('parseMarkdown — конфликты с уже готовыми сущностями', () => {
  it('маркер внутри тулбарного `code` не ставится, и текст остаётся дословным', () => {
    const current: MessageEntity[] = [{ _: 'messageEntityCode', offset: 0, length: 5 }]

    expect(parseMarkdown('**b** x', current)).toEqual({
      text: '**b** x',
      entities: [{ _: 'messageEntityCode', offset: 0, length: 5 }],
    })
  })

  it('сущности ПРАВЕЕ съеденного маркера сдвигаются на его длину', () => {
    const current: MessageEntity[] = [{ _: 'messageEntityItalic', offset: 6, length: 4 }]

    expect(parseMarkdown('**b** tail', current)).toEqual({
      text: 'b tail',
      entities: [
        { _: 'messageEntityBold', offset: 0, length: 1 },
        { _: 'messageEntityItalic', offset: 2, length: 4 },
      ],
    })
  })

  it('входной массив сущностей не мутируется', () => {
    const current: MessageEntity[] = [{ _: 'messageEntityItalic', offset: 6, length: 4 }]

    parseMarkdown('**b** tail', current)

    expect(current).toEqual([{ _: 'messageEntityItalic', offset: 6, length: 4 }])
  })
})

describe('parseMarkdown — гвард пустого результата', () => {
  it('из одних маркеров и пробелов сообщения не выходит (текст пуст, сущностей нет)', () => {
    // Без гварда отправился бы текст из двух пробелов с сущностью-жирным на них.
    expect(parseMarkdown('**  **')).toEqual({ text: '', entities: [] })
  })
})

describe('serialize — блочные теги вставки (tweb BLOCK_TAGS)', () => {
  const withChildren = (spec: [tag: string, text: string][]) => {
    const root = document.createElement('div')
    for (const [tag, text] of spec) {
      const element = document.createElement(tag)
      element.textContent = text
      root.append(element)
    }
    return root
  }

  it('пункты списка — разные строки, а не склеенное слово', () => {
    const root = document.createElement('div')
    const list = document.createElement('ul')
    for (const text of ['раз', 'два']) {
      const item = document.createElement('li')
      item.textContent = text
      list.append(item)
    }
    root.append(list)

    expect(serialize(root).text).toBe('раз\nдва')
  })

  it('заголовки — разные строки и ЖИРНЫЙ (markdownTags.bold: h1…h6)', () => {
    const { text, entities } = serialize(withChildren([['h1', 'Заголовок'], ['h2', 'Подзаголовок']]))

    expect(text).toBe('Заголовок\nПодзаголовок')
    expect(entities).toEqual([
      { _: 'messageEntityBold', offset: 0, length: 9 },
      { _: 'messageEntityBold', offset: 10, length: 12 },
    ])
  })
})

describe('splitRich — порт splitStringByLength + sliceMessageEntities', () => {
  it('режет по пробелу, а не по окну: слово не рвётся посреди', () => {
    expect(splitRich('aaa bbb ccc ddd', [], 8).map((part) => part.text)).toEqual(['aaa bbb ', 'ccc ddd'])
  })

  it('склейка кусков возвращает исходную строку буква в букву', () => {
    const text = 'слово ещё слово и хвост'
    expect(splitRich(text, [], 10).map((part) => part.text).join('')).toBe(text)
  })

  it('слово длиннее лимита рубится жёстко', () => {
    expect(splitRich('aaaaaaaaaaaaaaa', [], 6).map((part) => part.text)).toEqual(['aaaaaa', 'aaaaaa', 'aaa'])
  })

  it('сущность на границе становится сущностью в каждом куске', () => {
    const entities: MessageEntity[] = [{ _: 'messageEntityBold', offset: 0, length: 15 }]

    expect(splitRich('aaa bbb ccc ddd', entities, 8)).toEqual([
      { text: 'aaa bbb ', entities: [{ _: 'messageEntityBold', offset: 0, length: 8 }] },
      { text: 'ccc ddd', entities: [{ _: 'messageEntityBold', offset: 0, length: 7 }] },
    ])
  })

  it('текст в лимите — один кусок с теми же сущностями', () => {
    const entities: MessageEntity[] = [{ _: 'messageEntityBold', offset: 0, length: 3 }]

    expect(splitRich('aaa', entities, 8)).toEqual([{ text: 'aaa', entities }])
  })
})
