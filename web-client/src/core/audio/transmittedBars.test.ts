import { describe, it, expect } from 'vitest'
import { decodeTransmittedBars, WAVE_BARS } from './waveform'
import { pack5bit } from './voiceWaveformAnalyser'
import { b64FromBytes } from '../secret/crypto'

const b64 = (vals: number[]) => b64FromBytes(pack5bit(vals))

describe('decodeTransmittedBars (переданные пики → бары)', () => {
  it('пустая строка → []', () => {
    expect(decodeTransmittedBars('')).toEqual([])
  })

  it('ресэмплит к WAVE_BARS', () => {
    const vals = Array.from({ length: 100 }, (_, i) => i % 32)
    expect(decodeTransmittedBars(b64(vals)).length).toBe(WAVE_BARS)
  })

  it('макс (31) → ~1.0', () => {
    const vals = Array.from({ length: 100 }, () => 31)
    const bars = decodeTransmittedBars(b64(vals))
    expect(bars.every((b) => Math.abs(b - 1) < 1e-6)).toBe(true)
  })

  it('тишина (0) → пол 0.08', () => {
    const vals = Array.from({ length: 100 }, () => 0)
    const bars = decodeTransmittedBars(b64(vals))
    expect(bars.every((b) => b === 0.08)).toBe(true)
  })

  it('битый base64 → [] (не бросает)', () => {
    expect(decodeTransmittedBars('!!!not base64!!!')).toEqual([])
  })
})
