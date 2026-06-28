// src/core/dom/scrollSaver.test.ts
import { describe, it, expect } from 'vitest'
import ScrollSaver from './scrollSaver'

function makeContainer(scrollHeight: number, scrollTop: number): HTMLElement {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => (el as any)._sh })
  ;(el as any)._sh = scrollHeight
  el.scrollTop = scrollTop
  return el
}

describe('ScrollSaver (reverse / bottom-anchored)', () => {
  it('keeps the viewport pinned to the bottom when content is prepended', () => {
    const el = makeContainer(1000, 200) // 800px below the fold
    const saver = new ScrollSaver(el, true)
    saver.save() // scrollHeightMinusTop = 1000 - 200 = 800
    ;(el as any)._sh = 1500 // prepended 500px of older content above
    saver.restore()
    expect(el.scrollTop).toBe(700) // 1500 - 800, same distance from bottom
  })

  it('non-reverse mode preserves absolute scrollTop', () => {
    const el = makeContainer(1000, 200)
    const saver = new ScrollSaver(el, false)
    saver.save()
    ;(el as any)._sh = 1500
    saver.restore()
    expect(el.scrollTop).toBe(200)
  })
})
