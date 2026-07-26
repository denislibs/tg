import { describe, it, expect } from 'vitest'
import { clampIndex, pickZone, stepIndex, indexAfterSwipe } from './photoPager'

describe('clampIndex (стоп на краях)', () => {
  it('клампит в [0, count-1]', () => {
    expect(clampIndex(-3, 4)).toBe(0)
    expect(clampIndex(0, 4)).toBe(0)
    expect(clampIndex(2, 4)).toBe(2)
    expect(clampIndex(4, 4)).toBe(3)
    expect(clampIndex(99, 4)).toBe(3)
  })
  it('пустой/одиночный список → 0', () => {
    expect(clampIndex(5, 0)).toBe(0)
    expect(clampIndex(5, 1)).toBe(0)
  })
})

describe('pickZone (зоны тапа, tweb 1/3)', () => {
  it('центральная треть — просмотрщик', () => {
    expect(pickZone(150, 300, true)).toBe('viewer') // ровно центр
    expect(pickZone(110, 300, true)).toBe('viewer') // >100 (1/3)
    expect(pickZone(190, 300, true)).toBe('viewer') // <200 (2/3)
  })
  it('левая треть — prev, правая — next', () => {
    expect(pickZone(20, 300, true)).toBe('prev')
    expect(pickZone(280, 300, true)).toBe('next')
  })
  it('границы третей включены в просмотрщик', () => {
    expect(pickZone(100, 300, true)).toBe('viewer')
    expect(pickZone(200, 300, true)).toBe('viewer')
  })
  it('если листать нельзя (одно фото) — всегда просмотрщик', () => {
    expect(pickZone(10, 300, false)).toBe('viewer')
    expect(pickZone(290, 300, false)).toBe('viewer')
  })
})

describe('stepIndex (тап зациклен, tweb)', () => {
  it('вперёд/назад в середине', () => {
    expect(stepIndex(1, 4, 'next')).toBe(2)
    expect(stepIndex(2, 4, 'prev')).toBe(1)
  })
  it('зацикливание на краях', () => {
    expect(stepIndex(3, 4, 'next')).toBe(0)
    expect(stepIndex(0, 4, 'prev')).toBe(3)
  })
  it('один элемент никуда не двигается', () => {
    expect(stepIndex(0, 1, 'next')).toBe(0)
    expect(stepIndex(0, 1, 'prev')).toBe(0)
  })
})

describe('indexAfterSwipe (свайп со стопом на краях)', () => {
  const W = 300
  it('свайп влево (dx<0) сверх порога → следующий', () => {
    expect(indexAfterSwipe(1, 4, -80, W)).toBe(2)
  })
  it('свайп вправо (dx>0) сверх порога → предыдущий', () => {
    expect(indexAfterSwipe(2, 4, 80, W)).toBe(1)
  })
  it('меньше порога — индекс не меняется', () => {
    expect(indexAfterSwipe(2, 4, -40, W)).toBe(2)
    expect(indexAfterSwipe(2, 4, 40, W)).toBe(2)
  })
  it('стоп на краях (не зацикливает)', () => {
    expect(indexAfterSwipe(3, 4, -100, W)).toBe(3) // последний, влево — стоп
    expect(indexAfterSwipe(0, 4, 100, W)).toBe(0) // первый, вправо — стоп
  })
})
