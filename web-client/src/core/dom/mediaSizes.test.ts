import { describe, it, expect } from 'vitest'
import { DESKTOP, HANDHELDS, mediaSizes, setAttachmentSize, EXPAND_TEXT_WIDTH, MIN_SIDE_SIZE, MIN_VIDEO_SIDE_SIZE } from './mediaSizes'

describe('mediaSizes', () => {
  it('наборы 1:1 с tweb (mediaSizes.ts:64-101)', () => {
    expect(DESKTOP.regular).toEqual({ width: 420, height: 400 })
    expect(DESKTOP.album).toEqual({ width: 420, height: 0 })
    expect(DESKTOP.staticSticker).toEqual({ width: 200, height: 200 })
    expect(DESKTOP.emojiSticker).toEqual({ width: 112, height: 112 })
    expect(DESKTOP.round).toEqual({ width: 280, height: 280 })
    expect(HANDHELDS.regular).toEqual({ width: 340, height: 340 })
    expect(HANDHELDS.round).toEqual({ width: 240, height: 240 })
    expect(HANDHELDS.staticSticker).toEqual({ width: 180, height: 180 })
  })

  it('брейкпоинт — 600px (tweb MOBILE_SIZE)', () => {
    expect(mediaSizes(600)).toBe(HANDHELDS)
    expect(mediaSizes(601)).toBe(DESKTOP)
  })
})

describe('setAttachmentSize', () => {
  const box = { boxWidth: DESKTOP.regular.width, boxHeight: DESKTOP.regular.height }

  it('вертикальное фото вписывается по высоте бокса', () => {
    const { size } = setAttachmentSize({ width: 1080, height: 1920, ...box })
    expect(size.height).toBe(400)
    expect(size.width).toBe(225)
  })

  it('горизонтальное фото вписывается по ширине бокса', () => {
    const { size } = setAttachmentSize({ width: 1920, height: 1080, ...box })
    expect(size.width).toBe(420)
    expect(size.height).toBe(236)
  })

  it('маленькая картинка растягивается покрытием минимум до 200 по стороне', () => {
    const { size } = setAttachmentSize({ width: 90, height: 60, ...box })
    expect(Math.max(size.width, size.height)).toBeGreaterThanOrEqual(MIN_SIDE_SIZE)
  })

  it('с подписью бокс расширяется до 320 (читаемость блока)', () => {
    const narrow = setAttachmentSize({ width: 200, height: 600, ...box })
    expect(narrow.size.width).toBeLessThan(EXPAND_TEXT_WIDTH)
    const withText = setAttachmentSize({ width: 200, height: 600, ...box, hasMessageBlock: true })
    expect(withText.size.width).toBe(EXPAND_TEXT_WIDTH)
    expect(withText.isFit).toBe(false)
  })

  it('видео с плеером не уже 368', () => {
    const { size, isFit } = setAttachmentSize({ width: 200, height: 600, ...box, isVideoWithPlayer: true })
    expect(size.width).toBe(MIN_VIDEO_SIDE_SIZE)
    expect(isFit).toBe(false)
  })

  it('noMinSize отключает все минимумы (стикеры/кружки)', () => {
    const { size } = setAttachmentSize({ width: 90, height: 60, ...box, noMinSize: true })
    expect(size).toEqual({ width: 90, height: 60 })
  })
})
