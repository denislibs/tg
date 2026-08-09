import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { animateStoryViewer, type StoryMorphElements } from './storyViewerMorph'

// Записываем вызовы Element.animate: в jsdom WAAPI нет, а проверять надо ровно
// то, что уходит в браузер (tweb viewer.tsx:3199-3294).
interface Call { el: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions }
let calls: Call[]

function rect(el: Element, r: { top: number; left: number; width: number; height: number }) {
  el.getBoundingClientRect = () => ({
    top: r.top, left: r.left, width: r.width, height: r.height,
    right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top,
    toJSON: () => ({}),
  }) as DOMRect
}

function div(className = '') {
  const el = document.createElement('div')
  if (className) el.className = className
  document.body.append(el)
  return el
}

/** Полное дерево морфа: вьюер + фон + close + активный контейнер + шапка + клон. */
function makeElements(): StoryMorphElements & { target: HTMLElement } {
  const root = div()
  const background = div()
  const closeButton = div()
  const activeContainer = div()
  const headerAvatar = div()
  const flyAvatar = div()
  const target = div('avatar')
  root.append(background, closeButton, activeContainer)
  activeContainer.append(headerAvatar)
  rect(activeContainer, { top: 40, left: 620, width: 484, height: 861 })
  rect(headerAvatar, { top: 56, left: 636, width: 32, height: 32 })
  rect(target, { top: 100, left: 20, width: 54, height: 54 })
  return { root, background, closeButton, containers: [activeContainer], activeContainer, headerAvatar, flyAvatar, target }
}

describe('animateStoryViewer', () => {
  beforeEach(() => {
    calls = []
    Element.prototype.animate = function (keyframes, options) {
      calls.push({ el: this, keyframes: keyframes as Keyframe[], options: options as KeyframeAnimationOptions })
      return { finished: Promise.resolve() } as unknown as Animation
    }
    document.body.classList.add('animation-level-2')
  })

  afterEach(() => {
    document.body.innerHTML = ''
    document.body.className = ''
    vi.restoreAllMocks()
  })

  it('открытие: 250 ms cubic-bezier(.4,0,.6,1) на клоне, контейнере, фоне и close', async () => {
    const els = makeElements()
    await animateStoryViewer(els, true)

    expect(calls).toHaveLength(4)
    for (const c of calls) {
      expect(c.options).toEqual({ duration: 250, easing: 'cubic-bezier(0.4, 0.0, 0.6, 1)' })
    }
    expect(calls.map((c) => c.el)).toEqual(
      expect.arrayContaining([els.flyAvatar, els.activeContainer, els.background, els.closeButton]),
    )

    // Клон: из масштаба аватарки ряда (54/32) в 1, со сдвигом в аватарку шапки.
    const fly = calls.find((c) => c.el === els.flyAvatar)!
    expect(fly.keyframes[0].transform).toBe(`translate(0, 0) scale(${54 / 32})`)
    expect(fly.keyframes[1].transform).toBe('translate(616px, -44px) scale(1)')
    expect(els.flyAvatar!.style.left).toBe('20px')
    expect(els.flyAvatar!.style.top).toBe('100px')

    // Контейнер: border-radius 50% → 0%, opacity 0 → 1 к 30 %.
    const container = calls.find((c) => c.el === els.activeContainer)!
    expect(container.keyframes[0].borderRadius).toBe('50%')
    expect(container.keyframes[0].opacity).toBe(0)
    expect(container.keyframes[1]).toEqual({ opacity: 1, offset: 0.3 })
    expect(container.keyframes[2].borderRadius).toBe('0%')
    expect(container.keyframes[2].transform).toBe('translate3d(0, 0, 0) scale3d(1, 1, 1)')

    // Фон и close — простой opacity.
    const bg = calls.find((c) => c.el === els.background)!
    expect(bg.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }])
  })

  it('закрытие: те же кадры, развёрнутые вручную', async () => {
    const els = makeElements()
    await animateStoryViewer(els, false)

    const bg = calls.find((c) => c.el === els.background)!
    expect(bg.keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }])
    const container = calls.find((c) => c.el === els.activeContainer)!
    expect(container.keyframes[0].borderRadius).toBe('0%')
    expect(container.keyframes[2].borderRadius).toBe('50%')
  })

  it('без аватарки-источника: только opacity вьюера и контейнера, полёта нет', async () => {
    const els = { ...makeElements(), target: null, flyAvatar: null }
    await animateStoryViewer(els, true)

    expect(calls).toHaveLength(2)
    expect(calls.map((c) => c.el)).toEqual([els.activeContainer, els.root])
    for (const c of calls) expect(c.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }])
  })

  it('аватарка уехала из своего скроллера: морф вырождается в fade', async () => {
    const els = makeElements()
    const scrollable = div('scrollable')
    scrollable.append(els.target)
    rect(scrollable, { top: 90, left: 0, width: 400, height: 80 })
    rect(els.target, { top: 100, left: 900, width: 54, height: 54 }) // правее скроллера

    await animateStoryViewer(els, true)
    expect(calls.map((c) => c.el)).toEqual([els.activeContainer, els.root])
  })

  // «Без анимаций» = App.tsx снимает body.animation-level-2 и ставит
  // animation-level-0 (tweb appImManager.ts:2209-2211) — гейт ровно один.
  it('анимации выключены — ничего не проигрывается', async () => {
    document.body.classList.remove('animation-level-2')
    document.body.classList.add('animation-level-0')
    await animateStoryViewer(makeElements(), true)
    expect(calls).toHaveLength(0)
  })
})
