// Измерения для оверлея спойлеров: порт tweb
// `components/messageSpoilerOverlay/utils.ts`.
//
// Всё считается в CSS-пикселях ОТНОСИТЕЛЬНО самого оверлея (`.message-spoiler-overlay`),
// поэтому оверлею неважно, к какому предку он растянулся: координаты слов всегда
// меряются от его собственного бокса.
import type { SpoilerOverlayRect } from './spoilerRenderer.worker'

const MAX_SPACE_BETWEEN_SPOILER_LINES = 2
const RESIZE_PAINT_CHECK_ATTEMPTS = 100
const RESIZE_PAINT_SKIP_FRAMES = 5
const GENEROUS_COMPARISON_ERROR = 0.1

interface RGBA { r: number; g: number; b: number; a: number }

export function getInnerCustomRect(parentRect: DOMRect, rect: DOMRect): SpoilerOverlayRect {
  return {
    left: Math.floor(rect.left - parentRect.left),
    top: Math.floor(rect.top - parentRect.top),
    width: Math.ceil(rect.width + 0.99),
    height: Math.ceil(rect.height + 0.99),
  }
}

export function getActualRectForCustomRect(parentRect: DOMRect, rect: SpoilerOverlayRect) {
  return {
    left: parentRect.left + rect.left,
    top: parentRect.top + rect.top,
    width: rect.width,
    height: rect.height,
  }
}

/** Радиус, которого кругу раскрытия хватит, чтобы накрыть все слова спойлера. */
export function computeMaxDistToMargin(
  clientX: number,
  clientY: number,
  parentRect: DOMRect,
  rects: SpoilerOverlayRect[],
) {
  const actualRects = rects.map((rect) => getActualRectForCustomRect(parentRect, rect))

  return Math.max(
    ...actualRects.map((rect) =>
      Math.max(
        Math.hypot(clientX - rect.left, clientY - rect.top),
        Math.hypot(clientX - rect.left, clientY - (rect.top + rect.height)),
        Math.hypot(clientX - (rect.left + rect.width), clientY - rect.top),
        Math.hypot(clientX - (rect.left + rect.width), clientY - (rect.top + rect.height)),
      ),
    ),
  )
}

export function getTimeForDist(dist: number) {
  return Math.max(600, Math.sqrt(dist / 160) * 350)
}

/** Между строками спойлера есть зазор — курсор в нём не считается «над спойлером». */
export function isMouseCloseToAnySpoilerElement(
  clientX: number,
  clientY: number,
  overlayRect: DOMRect,
  spanRects: SpoilerOverlayRect[],
) {
  for (const rect of spanRects) {
    const actual = getActualRectForCustomRect(overlayRect, rect)
    if (
      actual.left <= clientX &&
      clientX <= actual.left + actual.width &&
      actual.top <= clientY &&
      clientY <= actual.top + actual.height
    ) {
      return true
    }
  }
  return false
}

/** tweb getParticleColor: `themeController.isNight()`; у нас — класс `night` на <html>. */
export function getParticleColor() {
  return document.documentElement.classList.contains('night') ? 'white' : '#101010'
}

function parseRgba(rgba: string): RGBA {
  const match = rgba.match(/rgba?\((\d+), (\d+), (\d+),?\s?(\d?.?\d+)?\)/)
  if (!match) return { r: 0, g: 0, b: 0, a: 0 }
  return {
    r: parseInt(match[1], 10),
    g: parseInt(match[2], 10),
    b: parseInt(match[3], 10),
    a: parseFloat(match[4] ?? '1'),
  }
}

function blendColors(base: RGBA, overlay: RGBA): RGBA {
  const a = overlay.a + base.a * (1 - overlay.a)
  const mix = (o: number, b: number) => Math.round((overlay.a * o + base.a * b * (1 - overlay.a)) / a)
  return { r: mix(overlay.r, base.r), g: mix(overlay.g, base.g), b: mix(overlay.b, base.b), a }
}

/** Непрозрачный фон под словом: складываем фоны предков, пока не наберётся alpha=1. */
export function computeFinalBackgroundColor(element: HTMLElement | null) {
  let color: RGBA = { r: 0, g: 0, b: 0, a: 0 }
  let maxDepth = 10

  while (element && color.a < 1 && maxDepth--) {
    const bgColor = window.getComputedStyle(element).backgroundColor
    if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
      color = blendColors(parseRgba(bgColor), color)
    }
    element = element.parentElement
  }

  return color.a === 1 ? `rgb(${color.r}, ${color.g}, ${color.b})` : undefined
}

/** Слово может переноситься — у инлайнового спана по прямоугольнику на строку. */
export function getCustomDOMRectsForSpoilerSpan(
  el: HTMLElement,
  parentRect: DOMRect,
): SpoilerOverlayRect[] {
  const color = computeFinalBackgroundColor(el)

  const normalized = [...el.getClientRects()].map((rect) => ({
    ...getInnerCustomRect(parentRect, rect),
    color,
  }))

  const blockquote = el.closest('blockquote')
  if (blockquote) {
    const bqRect = blockquote.getBoundingClientRect()
    // свёрнутая цитата: строки ниже её низа рисовать не нужно
    return normalized.filter((rect) => rect.top + parentRect.top + rect.height < bqRect.bottom)
  }

  return normalized
}

/** Строки идут с зазором — растягиваем соседние прямоугольники навстречу друг другу. */
export function adjustSpaceBetweenCloseRects(rects: SpoilerOverlayRect[]): SpoilerOverlayRect[] {
  rects = [...rects].sort((a, b) => a.top - b.top)

  for (let idx = 0; idx < rects.length - 1; idx++) {
    const rect = rects[idx]

    let nextIdx = idx
    while (++nextIdx < rects.length) {
      const nextRect = rects[nextIdx]

      const dist = nextRect.top - (rect.top + rect.height)
      if (dist <= MAX_SPACE_BETWEEN_SPOILER_LINES) {
        if (dist < 0) continue

        const flooredHalfDist = Math.floor(dist / 2) // стараемся попадать в целые пиксели
        const restHalfDist = dist - flooredHalfDist

        rects[nextIdx] = {
          ...nextRect,
          top: nextRect.top - flooredHalfDist,
          height: nextRect.height + flooredHalfDist,
        }
        rects[idx] = { ...rect, height: rect.height + restHalfDist }
      } else break
    }
  }

  return rects
}

/**
 * После колбэка ResizeObserver элемент ещё не обязательно того размера, который
 * нам нужен, — ждём, пока изменение доедет до DOM.
 *
 * отступление от tweb: там это `animate()` + deferredPromise из хелперов; здесь
 * тот же цикл на rAF без вспомогательной инфраструктуры. Константы — из tweb.
 */
export function waitResizeToBePainted(entry: ResizeObserverEntry): Promise<void> {
  return new Promise((resolve, reject) => {
    const entryRect = entry.contentRect
    let attempts = 0
    let skip = -1

    const tick = () => {
      skip = (skip + 1) % RESIZE_PAINT_SKIP_FRAMES
      if (skip) {
        requestAnimationFrame(tick)
        return
      }

      const targetRect = entry.target.getBoundingClientRect()
      if (
        Math.abs(targetRect.width - entryRect.width) < GENEROUS_COMPARISON_ERROR &&
        Math.abs(targetRect.height - entryRect.height) < GENEROUS_COMPARISON_ERROR
      ) {
        resolve()
        return
      }

      if (attempts++ < RESIZE_PAINT_CHECK_ATTEMPTS) requestAnimationFrame(tick)
      else reject(new Error('resize was not painted'))
    }

    requestAnimationFrame(tick)
  })
}
