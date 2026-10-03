// src/components/chat/bubbles.heavyAnimation.test.ts
//
// Лента — ИСТОЧНИК тяжёлой анимации (порт tweb 812502980 `chat/bubbles.ts`):
//   • лестница открытия объявляет себя на `max(delays) + 300` (:11973);
//   • прокрутка к баблу/вниз — через `fastSmoothScroll`, тот объявляет полёт
//     (`helpers/fastSmoothScroll.ts:93`);
//   • смена окна (`cleanup`, :5692-5696) гасит полёт скролла и ОБРЫВАЕТ
//     текущую тяжёлую анимацию — «не ждать конца прошлой».
// Пауза проверяется на самом `animationIntersector` (группа 'lock' — tweb
// appImManager.ts:436-442) и на подписчике шины.
//
// Геометрия — фейковая, как в `bubbles.firstLoad.test.ts` (happy-dom не
// считает layout): вьюпорт 500px, бабл 100px.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { dispatchHeavyAnimationEvent, getHeavyAnimationPromise, interruptHeavyAnimation, onHeavyAnimation } from '@core/dom/heavyAnimation'
import { animateSingle } from '@helpers/animation'
import { useSettingsStore } from '@/settings'
import animationIntersector from '@components/animationIntersector'
import type { MyMessage } from '@core/models'
import { makeMessage } from '@core/messages/testMessage'
import type { HistoryResult } from '@core/managers/messagesManager'
import type ChatBubbles from './bubbles'
import type { BubblesManagers } from './bubbles'
import { createTestChat, mountTestBubbles } from './testChat'

const CHAT = 50
const VIEWPORT_H = 500
const BUBBLE_H = 100

const msg = (id: number): MyMessage =>
  makeMessage({ id, peerId: CHAT, fromId: 2, text: `m${id}`, createdAt: '2026-08-15T12:00:00Z' })

const page = (ids: number[]): HistoryResult => ({
  messages: ids.map(msg),
  count: ids.length,
  reachedTop: true,
  reachedBottom: true,
})

function managersFor(first: HistoryResult): BubblesManagers {
  return {
    messages: {
      getHistory: vi.fn(async () => first),
      getAround: vi.fn(async () => ({ messages: [] as MyMessage[], reachedTop: false, reachedBottom: false })),
      messageByDate: vi.fn(async () => null),
    },
    peers: { fillMirror: vi.fn(async () => {}) },
    dialogs: {
      getReadMaxSeqIfUnread: vi.fn(async () => 0),
      getHistoryMaxSeq: vi.fn(async () => first.messages[first.messages.length - 1]?.id ?? 0),
      getDialogReadState: vi.fn(async () => undefined),
    },
    realtime: { markRead: vi.fn(async () => ({ ok: true })) },
  }
}

const rect = (top: number, height: number): DOMRect => ({
  top, bottom: top + height, height, left: 0, right: 300, width: 300, x: 0, y: top,
  toJSON: () => ({}),
} as DOMRect)

function installFakeLayout(container: HTMLElement) {
  let scrollTop = 0
  Object.defineProperty(container, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => { scrollTop = Math.max(0, Math.min(v, container.scrollHeight - container.clientHeight)) },
  })
  Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => VIEWPORT_H })
  Object.defineProperty(container, 'offsetHeight', { configurable: true, get: () => VIEWPORT_H })
  Object.defineProperty(container, 'scrollHeight', {
    configurable: true,
    get: () => container.querySelectorAll('.bubble').length * BUBBLE_H,
  })
}

// eslint-disable-next-line @typescript-eslint/unbound-method
const originalRect = HTMLElement.prototype.getBoundingClientRect

let feed: ChatBubbles | undefined
let offHeavy: (() => void) | undefined

function mount(ids: number[]) {
  const container = document.createElement('div')
  container.classList.add('chat')
  const b = feed = mountTestBubbles(createTestChat({ peerId: CHAT, container }), managersFor(page(ids)))
  installFakeLayout(b.scrollable.container)
  return b
}

async function openFeed(b: ChatBubbles) {
  await (await b.setPeer())?.promise
}

async function settle(times = 6) {
  for(let i = 0; i < times; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

const isHeavy = () => !getHeavyAnimationPromise().isFulfilled

function spyHeavy() {
  const start = vi.fn()
  const end = vi.fn()
  offHeavy = onHeavyAnimation(start, end)
  return { start, end }
}

const setAnimations = (on: boolean) =>
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: !on } })

beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  interruptHeavyAnimation()
  rootScope.myId = 999
  HTMLElement.prototype.getBoundingClientRect = function(this: HTMLElement) {
    const container = feed?.scrollable.container
    if(!container) return rect(0, 0)
    if(this === container) return rect(0, VIEWPORT_H)
    if(this.classList.contains('bubble')) {
      const all = Array.from(container.querySelectorAll('.bubble'))
      const idx = all.indexOf(this)
      if(idx === -1) return rect(0, 0)
      return rect(idx * BUBBLE_H - container.scrollTop, BUBBLE_H)
    }

    return rect(0, 0)
  }
})

afterEach(() => {
  offHeavy?.()
  offHeavy = undefined
  feed?.destroy()
  feed = undefined
  HTMLElement.prototype.getBoundingClientRect = originalRect
  interruptHeavyAnimation()
  setAnimations(true)
})

describe('ChatBubbles — объявляет тяжёлую анимацию на свои анимации', () => {
  it('лестница открытия (tweb bubbles.ts:11973): пауза animationIntersector на время каскада, снята по концу', async () => {
    setAnimations(true)
    const b = mount([1, 2, 3])
    const { start, end } = spyHeavy()

    await openFeed(b)

    expect(b.chatInner.classList.contains('zoom-fading')).toBe(true)
    expect(start).toHaveBeenCalled()
    expect(isHeavy()).toBe(true)
    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('lock')

    // max(delays) + 300 = 80 + 300
    await settle(20)
    expect(end).toHaveBeenCalled()
    expect(isHeavy()).toBe(false)
    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('')
  })

  it('прокрутка вниз (scrollToEnd → fastSmoothScroll): пауза на время полёта, снята по концу', async () => {
    // Открываем без анимаций — лестницы нет, шина свободна.
    setAnimations(false)
    const b = mount([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    await openFeed(b)
    await settle(2)
    expect(isHeavy()).toBe(false)

    b.scrollable.container.scrollTop = 0
    setAnimations(true)
    const { start, end } = spyHeavy()

    const promise = b.scrollToEnd()
    expect(start).toHaveBeenCalledTimes(1)
    expect(isHeavy()).toBe(true)
    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('lock')

    await promise
    await settle(2)
    expect(end).toHaveBeenCalledTimes(1)
    expect(isHeavy()).toBe(false)
    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('')
  })
})

describe('ChatBubbles — подписка на шину (tweb bubbles.ts:1683-1704)', () => {
  const heavyFlag = (b: ChatBubbles) => (b as unknown as { isHeavyAnimationInProgress: boolean }).isHeavyAnimationInProgress

  it('живая лента держит флаг, после destroy подписку снимает listenerSetter', async () => {
    setAnimations(false)
    const b = mount([1, 2, 3])
    await openFeed(b)

    let finish!: () => void
    let promise = dispatchHeavyAnimationEvent(new Promise<void>((r) => { finish = r }))
    expect(heavyFlag(b)).toBe(true)
    finish()
    await promise
    expect(heavyFlag(b)).toBe(false)

    b.destroy()
    feed = undefined
    promise = dispatchHeavyAnimationEvent(new Promise<void>((r) => { finish = r }))
    expect(heavyFlag(b)).toBe(false)
    finish()
    await promise
  })
})

describe('ChatBubbles.cleanup — прерывает анимации прошлого окна (tweb bubbles.ts:5692-5696)', () => {
  it('обрывает идущую тяжёлую анимацию: подписчики получают end, animationIntersector отпущен', async () => {
    setAnimations(false)
    const b = mount([1, 2, 3])
    await openFeed(b)

    const { end } = spyHeavy()
    void dispatchHeavyAnimationEvent(new Promise<void>(() => {}))
    expect(isHeavy()).toBe(true)
    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('lock')

    b.cleanup()

    expect(end).toHaveBeenCalledTimes(1)
    expect(isHeavy()).toBe(false)
    expect(animationIntersector.getOnlyOnePlayableGroup()).toBe('')
  })

  it('гасит полёт скролла по ключу скролл-контейнера', async () => {
    setAnimations(false)
    const b = mount([1, 2, 3])
    await openFeed(b)

    const tick = vi.fn(() => true)
    const flight = animateSingle(tick, b.scrollable.container)
    expect(flight.isFulfilled).toBe(false)

    b.cleanup()

    expect(flight.isFulfilled).toBe(true)
  })
})
