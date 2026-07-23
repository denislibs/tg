// Геометрия слоёв-стикеров: базовый размер, hit-тест по повёрнутому боксу и
// трансформация угловой ручкой (поворот atan2 + масштаб по отношению гипотенуз).
import { describe, it, expect } from 'vitest'
import { stickerBaseSize } from './sceneRender'
import { hitSticker, resizeSticker } from './stickerLayer'
import type { StickerLayer } from './sceneRender'

const L = (over: Partial<StickerLayer> = {}): StickerLayer =>
  ({ id: 1, mediaId: 10, x: 100, y: 100, scale: 1, rotation: 0, ...over })

describe('stickerBaseSize', () => {
  it('доля 0.4 от меньшей стороны, округлённая', () => {
    expect(stickerBaseSize(1000, 500)).toBe(200) // 500 * 0.4
    expect(stickerBaseSize(300, 800)).toBe(120) // 300 * 0.4
  })
  it('минимум 1', () => {
    expect(stickerBaseSize(1, 1)).toBe(1)
    expect(stickerBaseSize(0, 0)).toBe(1)
  })
})

describe('hitSticker', () => {
  const base = 100 // бокс 100×100 при scale=1

  it('попадание внутрь неповёрнутого бокса', () => {
    expect(hitSticker([L()], { x: 100, y: 100 }, base)?.id).toBe(1) // центр
    expect(hitSticker([L()], { x: 149, y: 149 }, base)?.id).toBe(1) // почти угол
  })

  it('промах вне бокса', () => {
    expect(hitSticker([L()], { x: 160, y: 100 }, base)).toBeNull()
  })

  it('учитывает scale', () => {
    // при scale=2 бокс 200×200 (half=100) — точка (190,100) попадает
    expect(hitSticker([L({ scale: 2 })], { x: 190, y: 100 }, base)?.id).toBe(1)
  })

  it('учитывает поворот бокса', () => {
    // бокс повёрнут на 45°: угол по диагонали дальше, но по оси — ближняя грань
    const rot = L({ rotation: Math.PI / 4 })
    // точка на 60px вправо по горизонтали: в локальной системе это ~42px по обеим
    // осям (внутри half=50) → попадание
    expect(hitSticker([rot], { x: 135, y: 100 }, base)?.id).toBe(1)
    // 80px вправо: в локальной системе ~57px по оси — за гранью half=50
    expect(hitSticker([rot], { x: 180, y: 100 }, base)).toBeNull()
  })

  it('возвращает верхний (последний) слой при перекрытии', () => {
    const a = L({ id: 1 })
    const b = L({ id: 2 })
    expect(hitSticker([a, b], { x: 100, y: 100 }, base)?.id).toBe(2)
  })
})

describe('resizeSticker — поворот + масштаб угловой ручкой', () => {
  const center = { x: 0, y: 0 }
  const half = 10 // половина стороны при scale=1 (экранные px)

  it('тянем правый-нижний угол ровно по диагонали от центра — угол 0, масштаб растёт', () => {
    // указатель в (20,20): вектор от него к центру (-20,-20); угол initial (10,10)
    const r = resizeSticker({ corner: { cornerX: 1, cornerY: 1 }, half, center, pointer: { x: 20, y: 20 }, sceneRotation: 0 })
    expect(r.rotation).toBeCloseTo(0)
    expect(r.scale).toBeCloseTo(Math.hypot(20, 20) / Math.hypot(10, 10)) // ~2
  })

  it('масштаб = 1, когда указатель на исходном угле', () => {
    const r = resizeSticker({ corner: { cornerX: 1, cornerY: 1 }, half, center, pointer: { x: 10, y: 10 }, sceneRotation: 0 })
    expect(r.scale).toBeCloseTo(1)
    expect(r.rotation).toBeCloseTo(0)
  })

  it('поворот на 90°: правый-нижний угол уводим туда, где был левый-нижний', () => {
    // Повернём указатель на +90° вокруг центра: (10,10) → (-10,10)
    const r = resizeSticker({ corner: { cornerX: 1, cornerY: 1 }, half, center, pointer: { x: -10, y: 10 }, sceneRotation: 0 })
    expect(r.scale).toBeCloseTo(1)
    expect(r.rotation).toBeCloseTo(Math.PI / 2)
  })

  it('поворот сцены вычитается из собственного угла слоя', () => {
    const r = resizeSticker({ corner: { cornerX: 1, cornerY: 1 }, half, center, pointer: { x: 20, y: 20 }, sceneRotation: Math.PI / 6 })
    expect(r.rotation).toBeCloseTo(-Math.PI / 6)
  })
})
