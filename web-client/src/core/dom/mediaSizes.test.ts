import { afterEach, describe, it, expect, vi } from 'vitest'
import mediaSizes, {
  DESKTOP, HANDHELDS, MediaSizes, ScreenSize,
  setAttachmentSize, EXPAND_TEXT_WIDTH, MIN_IMAGE_WIDTH, MIN_SIDE_SIZE, MIN_VIDEO_SIDE_SIZE,
} from './mediaSizes'

const setWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
}

// `mediaSizes` пересчитывается по window-`resize` через rAF (tweb :115-121).
// Тестам нужен синхронный снимок — зовём пересчёт напрямую (в tweb он приватный).
const refresh = (width: number) => {
  setWidth(width)
  ;(mediaSizes as unknown as { handleResize: () => void }).handleResize()
}

const INITIAL_WIDTH = window.innerWidth

afterEach(() => {
  refresh(INITIAL_WIDTH)
})

describe('mediaSizes', () => {
  it('наборы 1:1 с tweb (mediaSizes.ts:64-101)', () => {
    expect(DESKTOP.regular).toEqual({ width: 420, height: 400 })
    expect(DESKTOP.album).toEqual({ width: 420, height: 0 })
    expect(DESKTOP.staticSticker).toEqual({ width: 200, height: 200 })
    expect(DESKTOP.emojiSticker).toEqual({ width: 112, height: 112 })
    expect(DESKTOP.round).toEqual({ width: 280, height: 280 })
    expect(DESKTOP.esgSticker).toEqual({ width: 72, height: 72 })
    expect(DESKTOP.customEmoji).toEqual({ width: 20, height: 20 })
    expect(DESKTOP.emojiStatus).toEqual({ width: 18, height: 18 })
    expect(HANDHELDS.regular).toEqual({ width: 340, height: 340 })
    expect(HANDHELDS.round).toEqual({ width: 240, height: 240 })
    expect(HANDHELDS.staticSticker).toEqual({ width: 180, height: 180 })
    expect(HANDHELDS.esgSticker).toEqual({ width: 68, height: 68 })
  })

  it('брейкпоинт — 600px (tweb MOBILE_SIZE): активный набор и isMobile', () => {
    refresh(600)
    expect(mediaSizes.isMobile).toBe(true)
    expect(mediaSizes.activeScreen).toBe(ScreenSize.mobile)
    expect(mediaSizes.active).toBe(HANDHELDS)

    refresh(601)
    expect(mediaSizes.isMobile).toBe(false)
    expect(mediaSizes.active).toBe(DESKTOP)
  })

  // Разбор границ у tweb в комментарии mediaSizes.ts:35-38: medium↔large — это и
  // есть линия «плавающий ↔ пристыкованный сайдбар» (925), отдельного узкого
  // пристыкованного уровня нет.
  it('экраны: mobile ≤600, medium 601-925, large выше (tweb screenSizes)', () => {
    refresh(500)
    expect(mediaSizes.activeScreen).toBe(ScreenSize.mobile)
    refresh(900)
    expect(mediaSizes.activeScreen).toBe(ScreenSize.medium)
    expect(mediaSizes.isFloatingLeftSidebar).toBe(true)
    expect(mediaSizes.isLessThanFloatingLeftSidebar).toBe(true)
    refresh(1000)
    // >925 — сайдбар пристыкован, а не плавает
    expect(mediaSizes.activeScreen).toBe(ScreenSize.large)
    expect(mediaSizes.isFloatingLeftSidebar).toBe(false)
    expect(mediaSizes.isLessThanFloatingLeftSidebar).toBe(false)
    refresh(1800)
    expect(mediaSizes.activeScreen).toBe(ScreenSize.large)
  })

  // Ровно этим фактом живут потребители, которых нельзя перерисовать ре-рендером:
  // кольца кружков (tweb wrappers/video.ts:54-74) и ширины колонок (:385).
  it('смена экрана уведомляет подписчика — changeScreen(from, to) + resize', () => {
    refresh(1280)
    const changeScreen = vi.fn()
    const resize = vi.fn()
    mediaSizes.addEventListener('changeScreen', changeScreen)
    mediaSizes.addEventListener('resize', resize)
    try {
      refresh(500)
      expect(changeScreen).toHaveBeenCalledWith(ScreenSize.large, ScreenSize.mobile)
      expect(resize).toHaveBeenCalledTimes(1)

      // тот же экран — changeScreen молчит, resize приходит
      refresh(400)
      expect(changeScreen).toHaveBeenCalledTimes(1)
      expect(resize).toHaveBeenCalledTimes(2)

      refresh(1280)
      expect(changeScreen).toHaveBeenLastCalledWith(ScreenSize.mobile, ScreenSize.large)
    } finally {
      mediaSizes.removeEventListener('changeScreen', changeScreen)
      mediaSizes.removeEventListener('resize', resize)
    }
  })

  // Проводка: без window-слушателя (tweb :132) объект навсегда остался бы с
  // размерами первого кадра, и подписчики выше никогда бы не сработали.
  it('window-resize пересчитывает объект сам (через rAF)', async () => {
    refresh(1280)
    setWidth(500)
    window.dispatchEvent(new Event('resize'))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    expect(mediaSizes.isMobile).toBe(true)
    expect(mediaSizes.active).toBe(HANDHELDS)
  })

  it('без окна активен десктопный набор (воркер/SSR)', () => {
    const orig = globalThis.window
    // гасим window ровно как в воркере
    delete (globalThis as { window?: Window }).window
    try {
      const instance = new MediaSizes()
      expect(instance.isMobile).toBe(false)
      expect(instance.active).toBe(DESKTOP)
    } finally {
      globalThis.window = orig
    }
  })

})

describe('setAttachmentSize', () => {
  const box = { boxWidth: DESKTOP.regular.width, boxHeight: DESKTOP.regular.height }

  it('вертикальное фото вписывается по высоте бокса', () => {
    const { size, boxSize } = setAttachmentSize({ width: 1080, height: 1920, ...box })
    expect(size.height).toBe(400)
    expect(size.width).toBe(225)
    // минимумы этого кадра не касаются — бокс равен вписанному
    expect(boxSize).toEqual(size)
  })

  it('горизонтальное фото вписывается по ширине бокса', () => {
    const { size } = setAttachmentSize({ width: 1920, height: 1080, ...box })
    expect(size.width).toBe(420)
    expect(size.height).toBe(236)
  })

  it('маленькая картинка растягивается покрытием минимум до 200 по стороне', () => {
    const { size, boxSize } = setAttachmentSize({ width: 90, height: 60, ...box })
    expect(Math.max(size.width, size.height)).toBeGreaterThanOrEqual(MIN_SIDE_SIZE)
    // покрытие меняет ОБА размера (tweb: `boxSize = size = size.aspectCovered(...)`)
    expect(boxSize).toEqual(size)
  })

  // Тот самый дефект вписывания: расширение бокса НЕ должно попадать в аспектер.
  // Живой DOM tweb (dumps/03-video-poll.json): контейнер 320×400, аспектер 300×400.
  it('с подписью расширяется ТОЛЬКО boxSize, вписанный size остаётся вписанным', () => {
    const narrow = setAttachmentSize({ width: 200, height: 600, ...box })
    expect(narrow.boxSize.width).toBeLessThan(EXPAND_TEXT_WIDTH)

    const withText = setAttachmentSize({ width: 600, height: 800, ...box, hasMessageBlock: true })
    expect(withText.boxSize).toEqual({ width: EXPAND_TEXT_WIDTH, height: 400 })
    expect(withText.size).toEqual({ width: 300, height: 400 })
    expect(withText.isFit).toBe(false)
  })

  it('видео с плеером не уже 368 — и это тоже только boxSize', () => {
    const { size, boxSize, isFit } = setAttachmentSize({
      width: 200, height: 600, ...box, isVideoWithPlayer: true,
    })
    expect(boxSize.width).toBe(MIN_VIDEO_SIDE_SIZE)
    expect(size.width).toBe(133)
    expect(isFit).toBe(false)
  })

  it('слишком узкая картинка добивается до 120 (tweb MIN_IMAGE_WIDTH)', () => {
    const { size, boxSize, isFit } = setAttachmentSize({ width: 100, height: 900, ...box })
    expect(boxSize.width).toBe(MIN_IMAGE_WIDTH)
    expect(size.width).toBeLessThan(MIN_IMAGE_WIDTH)
    expect(isFit).toBe(false)
  })

  it('noMinSize отключает все минимумы (стикеры/кружки)', () => {
    const { size, boxSize } = setAttachmentSize({ width: 90, height: 60, ...box, noMinSize: true })
    expect(size).toEqual({ width: 90, height: 60 })
    expect(boxSize).toEqual({ width: 90, height: 60 })
  })

  // tweb setAttachmentSize.ts:102-103 — размер ставит САМА функция, и ставит
  // именно boxSize: контейнеру нужен расширенный бокс, а не вписанный размер.
  it('сама ставит элементу style — boxSize, не size', () => {
    const element = document.createElement('div')
    const { boxSize } = setAttachmentSize({ width: 600, height: 800, element, ...box, hasMessageBlock: true })

    expect(element.style.width).toBe(`${boxSize.width}px`)
    expect(element.style.height).toBe(`${boxSize.height}px`)
    expect(element.style.width).toBe('320px')
  })
})
