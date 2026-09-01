// Тесты единого контроллера вьювера (Task 16): один живой инстанс (аналог
// tweb window.appMediaViewer), Esc через LIFO-стек хоткеев, Back через слой
// navigationStack, повторное открытие после закрытия. Среда — как
// appMediaViewer.test.ts: happy-dom + fake timers, RPC managers замокан.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initHotkeys } from '@core/hotkeys'
import { setBaseHandler } from '@core/navigation/navigationStack'
import type { ViewerItem } from './appMediaViewer'
import { closeMediaViewer, isMediaViewerOpen, openMediaViewer } from './openMediaViewer'

const { downloadMediaURL, meta } = vi.hoisted(() => ({
  downloadMediaURL: vi.fn(async () => 'blob:full'),
  meta: vi.fn(async () => ({ fileName: 'photo.jpg' })),
}))

vi.mock('@/client/bootstrap', () => ({
  startClient: () => ({ managers: { media: { downloadMediaURL, meta } } }),
}))

vi.mock('@helpers/blur', () => ({
  default: vi.fn(() => {
    const canvas = document.createElement('canvas')
    canvas.className = 'canvas-thumbnail'
    return { canvas, promise: Promise.resolve() }
  }),
}))

const item = (mid: number): ViewerItem => ({
  element: null,
  mid,
  seq: mid,
  media: { mediaId: mid, width: 800, height: 600, kind: 'photo', blurPreview: 'AAAA' },
  author: { peerId: mid, name: 'Алиса', date: 1755255240 },
})

const wholeCount = () => document.querySelectorAll('.media-viewer-whole').length

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    writable: true,
    value: () => Promise.resolve(),
  })
})

afterEach(async () => {
  // добить возможный открытый инстанс, чтобы модульный синглтон не тёк между тестами
  closeMediaViewer()
  await vi.advanceTimersByTimeAsync(1000)
  vi.useRealTimers()
  document.body.replaceChildren()
})

// Полный доезд открытия/закрытия: doubleRaf + страховочный таймер + fastRaf.
async function settle(p?: Promise<void>) {
  await vi.advanceTimersByTimeAsync(800)
  await p
}

describe('openMediaViewer: один живой инстанс (аналог tweb window.appMediaViewer)', () => {
  it('повторный вызов при открытом — игнор: второй wholeDiv не плодится', async () => {
    const p = openMediaViewer({ items: [item(1)], index: 0 })
    await settle(p)
    expect(wholeCount()).toBe(1)
    expect(isMediaViewerOpen()).toBe(true)

    const p2 = openMediaViewer({ items: [item(2)], index: 0 })
    expect(p2).toBeUndefined()
    await settle()
    expect(wholeCount()).toBe(1)
  })

  it('после закрытия можно открыть снова (инстанс освобождён)', async () => {
    const onClosed = vi.fn()
    await settle(openMediaViewer({ items: [item(1)], index: 0, onClosed }))

    closeMediaViewer()
    await settle()
    expect(wholeCount()).toBe(0)
    expect(onClosed).toHaveBeenCalledTimes(1)
    expect(isMediaViewerOpen()).toBe(false)

    await settle(openMediaViewer({ items: [item(3)], index: 0 }))
    expect(wholeCount()).toBe(1)
  })
})

describe('Esc/Back закрывают вьювер с анимацией (проводка pushEsc/pushLayer)', () => {
  it('Esc (глобальный LIFO-стек хоткеев) зовёт close — вьювер уходит из DOM', async () => {
    const offHotkeys = initHotkeys({})
    await settle(openMediaViewer({ items: [item(1)], index: 0 }))
    expect(wholeCount()).toBe(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await settle()
    expect(wholeCount()).toBe(0)
    expect(isMediaViewerOpen()).toBe(false)
    offHotkeys()
  })

  it('Back (popstate снимает слой navigationStack) зовёт close', async () => {
    await settle(openMediaViewer({ items: [item(1)], index: 0 }))
    expect(wholeCount()).toBe(1)

    window.dispatchEvent(new PopStateEvent('popstate'))
    await settle()
    expect(wholeCount()).toBe(0)
  })

  it('после закрытия Esc-обработчик снят: чужой Escape не трогает следующий слой', async () => {
    const offHotkeys = initHotkeys({})
    const onClosed = vi.fn()
    await settle(openMediaViewer({ items: [item(1)], index: 0, onClosed }))
    closeMediaViewer()
    await settle()
    expect(onClosed).toHaveBeenCalledTimes(1)

    // стек пуст — Escape не находит обработчик вьювера (не бросает, не зовёт onClosed повторно)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await settle()
    expect(onClosed).toHaveBeenCalledTimes(1)
    offHotkeys()
  })
})

describe('навигация вьювера идёт через его navigationItem (tweb pushItem/removeItem)', () => {
  it('слой ставится ОДИН на открытие и снимается на закрытии', async () => {
    // Второй Back после закрытия уже никого не находит: слой снят, а не
    // «просто перекрыт» — иначе он копился бы от открытия к открытию.
    const onClosed = vi.fn()
    await settle(openMediaViewer({ items: [item(1)], index: 0, onClosed }))

    window.dispatchEvent(new PopStateEvent('popstate'))
    await settle()
    expect(wholeCount()).toBe(0)
    expect(onClosed).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new PopStateEvent('popstate'))
    await settle()
    expect(onClosed).toHaveBeenCalledTimes(1)
  })

  it('программное закрытие снимает слой: следующий Back уходит навигации чата', async () => {
    // Мёртвый слой в стеке проглатывал бы чужой Back — выход из чата переставал
    // работать после каждого закрытия вьювера крестиком.
    const base = vi.fn()
    setBaseHandler(base)
    await settle(openMediaViewer({ items: [item(1)], index: 0 }))

    closeMediaViewer()
    await settle()
    base.mockClear()

    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(base).toHaveBeenCalledTimes(1)
  })
})

describe('фолбэк размеров: у item без натуральных размеров бокс берётся от миниатюры', () => {
  it('нулевые width/height заменяются прямоугольником target', async () => {
    const el = document.createElement('div')
    el.getBoundingClientRect = () => ({ width: 320, height: 240, top: 0, left: 0, right: 320, bottom: 240, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    document.body.append(el)
    const it0 = item(1)
    it0.media.width = 0
    it0.media.height = 0
    const p = openMediaViewer({ items: [it0], index: 0, target: el })
    expect(it0.media.width).toBe(320)
    expect(it0.media.height).toBe(240)
    await settle(p)
  })
})
