import { describe, it, expect } from 'vitest'
import {
  ENCODE_FPS, DEFAULT_CODEC, HIGH_RES_CODEC,
  trimRange, frameCount, frameMediaTime, frameTimestampUs, thumbnailTime, minTrimLength,
  calcCodecAndBitrate, outputSize,
} from './videoMath'

describe('trimRange', () => {
  it('полная длина при start=0 length=1', () => {
    const r = trimRange(10, 0, 1)
    expect(r).toEqual({ startSec: 0, endSec: 10, durationSec: 10 })
  })

  it('вырезает середину', () => {
    const r = trimRange(20, 0.25, 0.5)
    expect(r.startSec).toBeCloseTo(5)
    expect(r.endSec).toBeCloseTo(15)
    expect(r.durationSec).toBeCloseTo(10)
  })

  it('клампит выход за границы [0,1]', () => {
    const r = trimRange(10, 0.8, 0.5) // 0.8..1.3 → 8..10
    expect(r.startSec).toBeCloseTo(8)
    expect(r.endSec).toBeCloseTo(10)
    expect(r.durationSec).toBeCloseTo(2)
  })

  it('нулевая длительность у пустого/битого видео', () => {
    expect(trimRange(0, 0, 1)).toEqual({ startSec: 0, endSec: 0, durationSec: 0 })
    expect(trimRange(NaN, 0, 1).durationSec).toBe(0)
  })
})

describe('frameCount / frameMediaTime / frameTimestampUs', () => {
  it('число кадров = round(duration*fps), минимум 1', () => {
    expect(frameCount(2, 30)).toBe(60)
    expect(frameCount(0, 30)).toBe(1)
    expect(frameCount(0.01, 30)).toBe(1)
  })

  it('время кадра растёт на 1/fps и не выходит за endSec', () => {
    const trim = trimRange(10, 0, 0.3) // 0..3
    expect(frameMediaTime(trim, 0, 30)).toBeCloseTo(0)
    expect(frameMediaTime(trim, 30, 30)).toBeCloseTo(1)
    // за пределами — клампится к endSec
    expect(frameMediaTime(trim, 1000, 30)).toBeCloseTo(3)
  })

  it('таймстамп кадра относителен началу трима (мкс)', () => {
    expect(frameTimestampUs(0, 30)).toBe(0)
    expect(frameTimestampUs(30, 30)).toBe(1_000_000)
    expect(frameTimestampUs(15, 30)).toBe(500_000)
  })
})

describe('thumbnailTime / minTrimLength', () => {
  it('обложка = позиция * длительность (кламп 0..1)', () => {
    expect(thumbnailTime(10, 0.5)).toBeCloseTo(5)
    expect(thumbnailTime(10, 2)).toBeCloseTo(10)
    expect(thumbnailTime(0, 0.5)).toBe(0)
  })

  it('минимальная длина трима — 0.5с в долях, максимум 1', () => {
    expect(minTrimLength(10)).toBeCloseTo(0.05)
    expect(minTrimLength(0.3)).toBe(1)
    expect(minTrimLength(0)).toBe(0)
  })
})

describe('calcCodecAndBitrate', () => {
  it('720p и меньше → defaultCodec', () => {
    const r = calcCodecAndBitrate(1280, 720, ENCODE_FPS)
    expect(r.codec).toBe(DEFAULT_CODEC.codec)
    expect(r.bitrate).toBe(DEFAULT_CODEC.bitrate) // ровно множитель 1
  })

  it('больше 720p → highResCodec', () => {
    const r = calcCodecAndBitrate(1920, 1080, ENCODE_FPS)
    expect(r.codec).toBe(HIGH_RES_CODEC.codec)
    expect(r.bitrate).toBe(HIGH_RES_CODEC.bitrate)
  })

  it('битрейт масштабируется от площади', () => {
    const full = calcCodecAndBitrate(1280, 720, ENCODE_FPS).bitrate
    const half = calcCodecAndBitrate(640, 720, ENCODE_FPS).bitrate
    expect(half).toBeCloseTo(full / 2, -3)
  })
})

describe('outputSize', () => {
  it('нативный размер сохраняется, если влезает в бокс', () => {
    expect(outputSize(1280, 720)).toEqual({ width: 1280, height: 720 })
  })

  it('стороны приводятся к чётным', () => {
    expect(outputSize(641, 361)).toEqual({ width: 642, height: 362 })
  })

  it('крупный кадр вписывается в бокс 1920×1080 с сохранением пропорций', () => {
    const r = outputSize(3840, 2160)
    expect(r.width).toBe(1920)
    expect(r.height).toBe(1080)
  })

  it('портрет вписывается по высоте', () => {
    const r = outputSize(2160, 3840)
    expect(r.height).toBe(1080)
    expect(r.width).toBe(608) // 1080 * (2160/3840) = 607.5 → чётное 608
  })
})
