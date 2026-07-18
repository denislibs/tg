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
    expect(entities).toEqual([{ type: 'text_mention', offset: 0, length: 5, url: undefined, language: undefined, user_id: 42 }])
  })

  it('entitiesToFragment: entity → <a data-mention-id> (round-trip)', () => {
    const frag = entitiesToFragment('Денис привет', [{ type: 'text_mention', offset: 0, length: 5, user_id: 42 }])
    const div = document.createElement('div')
    div.appendChild(frag)
    const a = div.querySelector('a.md-mention') as HTMLAnchorElement
    expect(a).toBeTruthy()
    expect(a.dataset.mentionId).toBe('42')
    expect(a.textContent).toBe('Денис')
    // и обратно
    const { entities } = serialize(div)
    expect(entities[0]).toMatchObject({ type: 'text_mention', offset: 0, length: 5, user_id: 42 })
  })
})
