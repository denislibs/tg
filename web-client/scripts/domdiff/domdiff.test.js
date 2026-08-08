import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseLine, parseTree, parseDump, slugify } from './parseDump.js'
import { diffTrees, summarize } from './diff.js'
import { serializeElement } from './serialize.js'

const here = dirname(fileURLToPath(import.meta.url))

describe('parseDump', () => {
  it('разбирает тег, классы (сортированные), атрибуты и текст', () => {
    const { depth, node } = parseLine('    div.bubble.is-out.hide-name [data-mid="21335" style="--x: 1"] "привет"')
    expect(depth).toBe(2)
    expect(node.tag).toBe('div')
    expect(node.classes).toEqual(['bubble', 'hide-name', 'is-out'])
    expect(node.attrs).toEqual({ 'data-mid': '21335', style: '--x: 1' })
    expect(node.text).toBe('привет')
  })

  it('держит кастомные теги и узлы без классов', () => {
    expect(parseLine('reactions-element.reactions').node.tag).toBe('reactions-element')
    expect(parseLine('use [href="#message-tail-filled"]').node).toEqual({
      tag: 'use',
      classes: [],
      attrs: { href: '#message-tail-filled' },
    })
  })

  it('строит вложенность по отступам', () => {
    const tree = parseTree(['div.bubble', '  div.bubble-content-wrapper', '    div.bubble-content', '      span.time', '    svg.bubble-tail'].join('\n'))
    expect(tree.classes).toEqual(['bubble'])
    const wrapper = tree.children[0]
    expect(wrapper.children.map((c) => c.classes[0])).toEqual(['bubble-content', 'bubble-tail'])
    expect(wrapper.children[0].children[0].classes).toEqual(['time'])
  })

  it('режет файл на секции и пропускает пустые/NOT FOUND', () => {
    const sections = parseDump(['=== a ===', 'div.one', '=== пусто ===', '', '=== нет ===', 'NOT FOUND: .x', '=== computed ===', '{"a": 1}'].join('\n'))
    expect(sections.map((s) => s.title)).toEqual(['a', 'computed'])
    expect(sections[1].computed).toEqual({ a: 1 })
  })

  it('slugify', () => {
    expect(slugify('text out first+last (mid 21335)')).toBe('text-out-first-last-mid-21335')
  })
})

describe('diffTrees', () => {
  const tree = () => parseTree(['div.bubble.is-out', '  div.bubble-content-wrapper', '    div.bubble-content'].join('\n'))

  it('одинаковые деревья — ноль findings', () => {
    expect(diffTrees(tree(), tree())).toEqual([])
  })

  it('видит недостающий и лишний класс', () => {
    const actual = parseTree(['div.bubble.is-outgoing', '  div.bubble-content-wrapper', '    div.bubble-content'].join('\n'))
    const f = diffTrees(tree(), actual)
    expect(summarize(f)).toEqual({ 'missing-class': 1, 'extra-class': 1 })
    expect(f[0]).toMatchObject({ kind: 'missing-class', expected: 'is-out', path: 'div' })
  })

  it('видит другой тег и недостающий/лишний узел', () => {
    const actual = parseTree(['section.bubble.is-out', '  div.bubble-content-wrapper'].join('\n'))
    expect(summarize(diffTrees(tree(), actual))).toEqual({ 'wrong-tag': 1, 'missing-node': 1 })
    expect(summarize(diffTrees(actual, tree()))).toEqual({ 'wrong-tag': 1, 'extra-node': 1 })
  })

  it('ignoreClasses гасит наши технические классы, в т.ч. по регулярке', () => {
    const actual = parseTree(['div.bubble.is-out._hash_ab12', '  div.bubble-content-wrapper', '    div.bubble-content'].join('\n'))
    expect(diffTrees(tree(), actual, { ignoreClasses: ['/^_hash_/'] })).toEqual([])
  })

  it('сравнивает computed с допуском', () => {
    const e = { tag: 'div', classes: [], computed: { width: '100px', color: 'rgb(0, 0, 0)' } }
    const a = { tag: 'div', classes: [], computed: { width: '100.3px', color: 'rgb(1, 0, 0)' } }
    const f = diffTrees(e, a, { tolerance: { width: 0.5 } })
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ kind: 'computed', expected: 'color: rgb(0, 0, 0)' })
  })

  it('сверяет наличие ключевых атрибутов, не их значения', () => {
    const e = { tag: 'div', classes: [], attrs: { 'data-mid': '21335' } }
    expect(diffTrees(e, { tag: 'div', classes: [], attrs: { 'data-mid': '7' } }, { attrKeys: ['data-mid'] })).toEqual([])
    expect(diffTrees(e, { tag: 'div', classes: [] }, { attrKeys: ['data-mid'] })).toHaveLength(1)
  })
})

describe('serializeElement', () => {
  it('снимает теги/классы/порядок так же, как парсер дампа', () => {
    const host = document.createElement('div')
    host.innerHTML = '<div class="bubble is-out"><div class="bubble-content-wrapper"><div class="bubble-content"></div></div></div>'
    document.body.append(host)
    try {
      const actual = serializeElement(host.firstElementChild)
      expect(diffTrees(parseTree(['div.bubble.is-out', '  div.bubble-content-wrapper', '    div.bubble-content'].join('\n')), actual)).toEqual([])
    } finally {
      host.remove()
    }
  })
})

describe('expected/bubbles.json', () => {
  const expected = JSON.parse(readFileSync(resolve(here, 'expected/bubbles.json'), 'utf8'))

  it('содержит эталоны всех снятых типов баблов', () => {
    for (const key of ['text-out-first-last-mid-21335', 'text-in-first-last-mid-21395', 'voice-out-is-group-last-mid-21397', 'forwarded-channel-post-mid-21341', 'photo-out-mid-21393', 'service-date', 'sticker-bubble-full', 'album-channel-post-bubble-full', 'reply-bubble-full', 'audio-song-bubble-full', 'round-video-video-note', 'document-bubble-full', 'poll-bubble-full']) {
      expect(expected, key).toHaveProperty(key)
    }
  })

  it('каркас бабла tweb: bubble > bubble-content-wrapper > bubble-content — у всех типов', () => {
    for (const [key, v] of Object.entries(expected)) {
      if (key === 'service-date') continue // у даты обёртки нет: .bubble.service.is-date > .bubble-content
      expect(v.tree.classes, key).toContain('bubble')
      expect(v.tree.children[0].classes, key).toContain('bubble-content-wrapper')
      expect(v.tree.children[0].children[0].classes, key).toContain('bubble-content')
    }
  })
})
