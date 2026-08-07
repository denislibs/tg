import { describe, it, expect } from 'vitest'
import { pack5bit, unpack5bit, normalizePeaks, WAVEFORM_BYTES_LENGTH } from './voiceWaveformAnalyser'

// 5-битная упаковка/распаковка — 1:1 tweb voiceWaveformAnalyser.
describe('5-bit waveform pack/unpack', () => {
  it('100 значений → 63 байта', () => {
    const vals = Array.from({ length: 100 }, (_, i) => i % 32)
    expect(pack5bit(vals).length).toBe(WAVEFORM_BYTES_LENGTH)
    expect(WAVEFORM_BYTES_LENGTH).toBe(63)
  })

  it('round-trip сохраняет значения 0..31', () => {
    const vals = Array.from({ length: 100 }, (_, i) => (i * 7) % 32)
    expect(unpack5bit(pack5bit(vals))).toEqual(vals)
  })

  it('крайние значения 0 и 31 переживают round-trip', () => {
    const vals = Array.from({ length: 100 }, (_, i) => (i % 2 ? 31 : 0))
    expect(unpack5bit(pack5bit(vals))).toEqual(vals)
  })

  it('обрезает значения по 5 битам (маска &31)', () => {
    expect(unpack5bit(pack5bit([32, 33, 63]), 3)).toEqual([0, 1, 31])
  })
})

describe('normalizePeaks', () => {
  it('дополняет до 100 и клампит в 0..31', () => {
    const out = normalizePeaks([1000, 2000, 3000])
    expect(out.length).toBe(100)
    expect(out.every((v) => v >= 0 && v <= 31)).toBe(true)
  })

  it('тишина (все 0) → все 0 (пол normPeak 2500 не делит на ноль)', () => {
    const out = normalizePeaks(Array(100).fill(0))
    expect(out.every((v) => v === 0)).toBe(true)
  })

  it('пик на пол-максимума масштабируется к 31', () => {
    // один большой пик → normPeak = max·1.8/100 но пол 2500; при большом пике
    // clamped=normPeak → 31.
    const peaks = Array(100).fill(0)
    peaks[0] = 100000
    expect(normalizePeaks(peaks)[0]).toBe(31)
  })
})
