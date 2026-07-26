import { describe, it, expect } from 'vitest'
import { hasVideoCodecs, hasAudioCodecs, supportsVideoEncoding, supportsAudioEncoding } from './videoSupport'

// Мокаем «глобал» с WebCodecs-конструкторами (в jsdom их нет).
const fakeVideoGlobal = () => ({
  VideoEncoder: Object.assign(function () {}, { isConfigSupported: () => {} }),
  VideoFrame: function () {},
})
const fakeAudioGlobal = () => ({
  AudioEncoder: Object.assign(function () {}, { isConfigSupported: () => {} }),
  AudioData: function () {},
})

describe('hasVideoCodecs', () => {
  it('true при наличии VideoEncoder/VideoFrame/isConfigSupported', () => {
    expect(hasVideoCodecs(fakeVideoGlobal() as never)).toBe(true)
  })
  it('false без конструкторов', () => {
    expect(hasVideoCodecs({} as never)).toBe(false)
  })
  it('false без статик isConfigSupported', () => {
    expect(hasVideoCodecs({ VideoEncoder: function () {}, VideoFrame: function () {} } as never)).toBe(false)
  })
})

describe('hasAudioCodecs', () => {
  it('true при наличии AudioEncoder/AudioData/isConfigSupported', () => {
    expect(hasAudioCodecs(fakeAudioGlobal() as never)).toBe(true)
  })
  it('false без конструкторов', () => {
    expect(hasAudioCodecs({} as never)).toBe(false)
  })
})

describe('деградация без WebCodecs (jsdom)', () => {
  it('supportsVideoEncoding резолвится в false, не бросая', async () => {
    await expect(supportsVideoEncoding()).resolves.toBe(false)
  })
  it('supportsAudioEncoding резолвится в false, не бросая', async () => {
    await expect(supportsAudioEncoding()).resolves.toBe(false)
  })
})
