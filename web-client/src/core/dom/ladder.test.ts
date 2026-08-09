// ladder — «лестница» появления баблов (порт tweb bubbles.ts:10363-10460).
// Проверяем ровно тот контракт, на который завязан портированный CSS
// (_chatBubble.scss:3210-3222): стартовое состояние ставится классом `zoom-fade`,
// шаг задержки — 40 мс с offsetIndex 1, а по концу перехода все служебные классы
// и инлайновый transition-delay снимаются.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { animateLadder } from './ladder'
import { interruptHeavyAnimation } from './heavyAnimation'

// jsdom не крутит кадры — гоняем rAF как микро-таймер и прокручиваем вручную.
let rafQueue: FrameRequestCallback[] = []

function flushRaf() {
  const queue = rafQueue
  rafQueue = []
  for (const cb of queue) cb(0)
}

/** дать отработать микрозадачам (промисы heavyAnimation) */
const tick = () => new Promise<void>((r) => { setTimeout(r, 0) })

function build(count: number) {
  const inner = document.createElement('div')
  inner.className = 'bubbles-inner'
  const wrappers: HTMLElement[] = []
  for (let i = 0; i < count; ++i) {
    const bubble = document.createElement('div')
    bubble.className = 'bubble'
    const wrapper = document.createElement('div')
    wrapper.className = 'bubble-content-wrapper'
    bubble.append(wrapper)
    inner.append(bubble)
    wrappers.push(wrapper)
  }
  document.body.append(inner)
  return { inner, wrappers }
}

beforeEach(() => {
  interruptHeavyAnimation()
  rafQueue = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb)
    return rafQueue.length
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('animateLadder', () => {
  it('ставит стартовое состояние: zoom-fade + can-zoom-fade на обёртках, zoom-fading на ленте', () => {
    const { inner, wrappers } = build(3)
    void animateLadder(inner, wrappers)

    expect(inner.classList.contains('zoom-fading')).toBe(true)
    for (const w of wrappers) {
      expect(w.classList.contains('zoom-fade')).toBe(true)
      expect(w.classList.contains('can-zoom-fade')).toBe(true)
    }
  })

  it('шаг задержки — 40мс с offsetIndex 1 (tweb bubbles.ts:10363-10375)', () => {
    const { inner, wrappers } = build(3)
    void animateLadder(inner, wrappers)

    expect(wrappers.map((w) => w.style.transitionDelay)).toEqual(['40ms', '80ms', '120ms'])
  })

  it('после первого кадра zoom-fade снят, can-zoom-fade остался — это и запускает переход', () => {
    const { inner, wrappers } = build(3)
    void animateLadder(inner, wrappers)

    flushRaf()

    for (const w of wrappers) {
      expect(w.classList.contains('zoom-fade')).toBe(false)
      expect(w.classList.contains('can-zoom-fade')).toBe(true)
    }
  })

  it('по transitionend последней обёртки + кадр снимает can-zoom-fade, delay и zoom-fading', async () => {
    const { inner, wrappers } = build(3)
    const promise = animateLadder(inner, wrappers)

    flushRaf()
    const last = wrappers[wrappers.length - 1]
    last.dispatchEvent(new Event('transitionend'))

    await tick()
    flushRaf()
    await promise

    for (const w of wrappers) {
      expect(w.classList.contains('can-zoom-fade')).toBe(false)
      expect(w.style.transitionDelay).toBe('')
    }
    expect(inner.classList.contains('zoom-fading')).toBe(false)
  })

  it('пустой список — ничего не трогает', async () => {
    const { inner } = build(0)
    await animateLadder(inner, [])
    expect(inner.classList.contains('zoom-fading')).toBe(false)
  })

  it('аватар группы едет вместе со своим баблом — одна задержка на шаг (tweb bubbles.ts:10384-10391)', () => {
    const { inner, wrappers } = build(2)
    const avatar = document.createElement('div')
    avatar.className = 'bubbles-group-avatar'
    inner.append(avatar)

    void animateLadder(inner, [wrappers[0], [wrappers[1], avatar]])

    expect(wrappers[1].style.transitionDelay).toBe('80ms')
    expect(avatar.style.transitionDelay).toBe('80ms')
    expect(avatar.classList.contains('zoom-fade')).toBe(true)
    expect(avatar.classList.contains('can-zoom-fade')).toBe(true)
  })
})
