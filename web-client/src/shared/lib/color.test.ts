import { describe, it, expect } from 'vitest'
import { hexToRgb, rgbToHex, mixColors } from './color'

describe('color', () => {
  it('hexToRgb', () => {
    expect(hexToRgb('#3390ec')).toEqual([51, 144, 236])
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255])
  })
  it('rgbToHex round-trips', () => {
    expect(rgbToHex([51, 144, 236]).toLowerCase()).toBe('#3390ec')
  })
  it('mixColors half blends channels', () => {
    // tweb: out[i] = Math.floor(v2 + (v1 - v2) * weight) — для 0/255 при
    // weight=0.5 даёт floor(255 - 127.5) = 127, а не 128 (не round). Формула
    // портирована 1:1 из tweb helpers/color.ts — тест подогнан под неё.
    expect(mixColors([0, 0, 0], [255, 255, 255], 0.5)).toEqual([127, 127, 127])
  })
})
