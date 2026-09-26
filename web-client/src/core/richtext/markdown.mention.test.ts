// text_mention (упоминание юзера без username): round-trip композера —
// <a data-mention-id> → serialize() → entity → entitiesToFragment() → тот же DOM.
import { describe, it, expect } from 'vitest'
import { serialize, entitiesToFragment } from './markdown'

describe('text_mention', () => {
  it('serialize: <a data-mention-id> → entity с user_id', () => {
    const root = document.createElement('div')
    const a = document.createElement('a')
    a.className = 'md-mention'
    a.dataset.mentionId = '42'
    a.textContent = 'Денис'
    root.appendChild(a)
    root.appendChild(document.createTextNode(' привет'))
    const { text, entities } = serialize(root)
    expect(text).toBe('Денис привет')
    expect(entities).toEqual([{ _: 'messageEntityMentionName', offset: 0, length: 5, user_id: 42 }])
  })

  it('entitiesToFragment: entity → <a data-mention-id> (round-trip)', () => {
    const frag = entitiesToFragment('Денис привет', [{ _: 'messageEntityMentionName', offset: 0, length: 5, user_id: 42 }])
    const div = document.createElement('div')
    div.appendChild(frag)
    const a = div.querySelector('a.md-mention') as HTMLAnchorElement
    expect(a).toBeTruthy()
    expect(a.dataset.mentionId).toBe('42')
    expect(a.textContent).toBe('Денис')
    // и обратно
    const { entities } = serialize(div)
    expect(entities[0]).toMatchObject({ _: 'messageEntityMentionName', offset: 0, length: 5, user_id: 42 })
  })
})

// Порт tweb `src/tests/getRichElementValueMention.test.ts` (ed51d0c09).
// `data-mention-id` приезжает и во вставленном HTML (`composer/helpers.ts::htmlToRich`
// → `serialize`), то есть он недоверенный: сущность даёт только положительный
// целый id, иначе текст остаётся простым текстом. Раньше мусор превращался в
// упоминание с `user_id: 0` (или `Number('1.5')`).
describe('text_mention из вставленного HTML', () => {
  // Тот же путь, что у обработчика вставки композера: чужой HTML → DOMParser → body.
  const parsePastedHtml = (html: string) => serialize(new DOMParser().parseFromString(html, 'text/html').body)

  it('упоминание с числовым user id становится messageEntityMentionName', () => {
    const { text, entities } = parsePastedHtml('<a class="md-mention" data-mention-id="61004386">Eduard</a> hi')
    expect(text).toBe('Eduard hi')
    expect(entities).toEqual([{ _: 'messageEntityMentionName', offset: 0, length: 6, user_id: 61004386 }])
  })

  it.each([
    ['пустой', ' data-mention-id=""'],
    ['ноль', ' data-mention-id="0"'],
    ['не число', ' data-mention-id="abc"'],
    ['отрицательный', ' data-mention-id="-1"'],
    ['не целое', ' data-mention-id="1.5"'],
    ['с хвостом', ' data-mention-id="1e3"'],
  ])('текст остаётся, сущности нет, когда data-mention-id %s', (_, attr) => {
    const { text, entities } = parsePastedHtml(`<a class="md-mention"${attr}>text</a>`)
    expect(text).toBe('text')
    expect(entities).toEqual([])
  })
})
