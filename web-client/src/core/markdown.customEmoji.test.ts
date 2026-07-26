// custom_emoji (анимированный кастом-эмодзи в тексте): round-trip композера —
// <span.md-custom-emoji data-doc-id> → serialize() → entity custom_emoji с
// document_id → entitiesToFragment() → тот же DOM. Проверяем UTF-16 offset/length
// (😎 = суррогатная пара, длина 2) и что document_id проходит через parseMarkdown.
import { describe, it, expect } from 'vitest'
import { serialize, entitiesToFragment, parseMarkdown } from './markdown'
import type { MessageEntity } from './models'

function customEmojiSpan(emoji: string, docId: number): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = 'md-custom-emoji'
  span.contentEditable = 'false'
  span.dataset.docId = String(docId)
  span.textContent = emoji
  return span
}

describe('custom_emoji', () => {
  it('serialize: <span.md-custom-emoji> → entity custom_emoji (UTF-16 offset/length)', () => {
    const root = document.createElement('div')
    root.appendChild(document.createTextNode('hi '))
    root.appendChild(customEmojiSpan('😎', 5))
    root.appendChild(document.createTextNode(' bye'))
    const { text, entities } = serialize(root)
    // "hi " = 3 code units; "😎" = 2 (суррогатная пара)
    expect(text).toBe('hi 😎 bye')
    expect(entities).toHaveLength(1)
    expect(entities[0]).toMatchObject({ type: 'custom_emoji', offset: 3, length: 2, document_id: 5 })
  })

  it('entitiesToFragment: entity → <span.md-custom-emoji> (round-trip)', () => {
    const ents: MessageEntity[] = [{ type: 'custom_emoji', offset: 3, length: 2, document_id: 5 }]
    const frag = entitiesToFragment('hi 😎 bye', ents)
    const div = document.createElement('div')
    div.appendChild(frag)
    const span = div.querySelector('span.md-custom-emoji') as HTMLSpanElement
    expect(span).toBeTruthy()
    expect(span.dataset.docId).toBe('5')
    expect(span.getAttribute('contenteditable')).toBe('false')
    expect(span.textContent).toBe('😎')
    // и обратно — те же text/entities
    const back = serialize(div)
    expect(back.text).toBe('hi 😎 bye')
    expect(back.entities[0]).toMatchObject({ type: 'custom_emoji', offset: 3, length: 2, document_id: 5 })
  })

  it('two identical adjacent custom emoji stay TWO separate entities', () => {
    const root = document.createElement('div')
    root.appendChild(customEmojiSpan('😎', 5))
    root.appendChild(customEmojiSpan('😎', 5))
    const { text, entities } = serialize(root)
    expect(text).toBe('😎😎')
    expect(entities).toHaveLength(2)
    expect(entities[0]).toMatchObject({ type: 'custom_emoji', offset: 0, length: 2, document_id: 5 })
    expect(entities[1]).toMatchObject({ type: 'custom_emoji', offset: 2, length: 2, document_id: 5 })
  })

  it('parseMarkdown preserves custom_emoji document_id (no marker syntax)', () => {
    const existing: MessageEntity[] = [{ type: 'custom_emoji', offset: 3, length: 2, document_id: 5 }]
    const { text, entities } = parseMarkdown('hi 😎 bye', existing)
    expect(text).toBe('hi 😎 bye')
    const ce = entities.find((e) => e.type === 'custom_emoji')
    expect(ce).toMatchObject({ type: 'custom_emoji', offset: 3, length: 2, document_id: 5 })
  })
})
