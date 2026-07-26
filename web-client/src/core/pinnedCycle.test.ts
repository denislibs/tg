// src/core/pinnedCycle.test.ts
import { describe, it, expect } from 'vitest'
import { nextPinIndex, clampPinIndex, pinBadgeNumber } from './pinnedCycle'

describe('nextPinIndex', () => {
  it('листает вниз по индексу (к более старым пинам)', () => {
    expect(nextPinIndex(0, 3)).toBe(1)
    expect(nextPinIndex(1, 3)).toBe(2)
  })

  it('после самого старого пина возвращается к новейшему (циклически)', () => {
    expect(nextPinIndex(2, 3)).toBe(0)
    expect(nextPinIndex(0, 1)).toBe(0)
  })

  it('пустой список не двигает индекс', () => {
    expect(nextPinIndex(0, 0)).toBe(0)
  })

  it('полный круг кликов проходит все пины и замыкается', () => {
    const seen: number[] = []
    let i = 0
    for (let k = 0; k < 4; k++) { seen.push(i); i = nextPinIndex(i, 4) }
    expect(seen).toEqual([0, 1, 2, 3])
    expect(i).toBe(0)
  })
})

describe('clampPinIndex', () => {
  it('индекс в диапазоне сохраняется', () => {
    expect(clampPinIndex(2, 4)).toBe(2)
  })

  it('после сжатия списка (unpin) сбрасывается на новейший', () => {
    expect(clampPinIndex(3, 2)).toBe(0)
    expect(clampPinIndex(0, 0)).toBe(0)
    expect(clampPinIndex(-1, 3)).toBe(0)
  })
})

describe('pinBadgeNumber (подпись «#N», tweb count - index)', () => {
  it('единственный пин — без номера', () => {
    expect(pinBadgeNumber(0, 1)).toBeNull()
  })

  it('новейший пин при нескольких — без номера (tweb is-last)', () => {
    expect(pinBadgeNumber(0, 5)).toBeNull()
  })

  it('более старые пины нумеруются от старейшего: #N = count - index', () => {
    expect(pinBadgeNumber(1, 5)).toBe(4)
    expect(pinBadgeNumber(4, 5)).toBe(1) // самый старый — #1
    expect(pinBadgeNumber(1, 2)).toBe(1)
  })

  it('индекс вне диапазона — без номера', () => {
    expect(pinBadgeNumber(5, 5)).toBeNull()
    expect(pinBadgeNumber(-1, 5)).toBeNull()
  })
})
