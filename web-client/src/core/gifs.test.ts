// src/core/gifs.test.ts — критерий «гифоподобного» медиа (isGifLike).
import { describe, it, expect } from 'vitest'
import { isGifLike } from './gifs'

describe('isGifLike', () => {
  it('true для настоящего image/gif независимо от имени', () => {
    expect(isGifLike({ mime: 'image/gif' })).toBe(true)
    expect(isGifLike({ mime: 'image/gif', fileName: 'funny.gif', duration: 3 })).toBe(true)
  })

  it('true для mp4 с маркерами tenor/giphy/.gif.mp4 в имени файла', () => {
    expect(isGifLike({ mime: 'video/mp4', fileName: 'tenor.mp4' })).toBe(true)
    expect(isGifLike({ mime: 'video/mp4', fileName: 'Giphy-download.MP4' })).toBe(true)
    expect(isGifLike({ mime: 'video/mp4', fileName: 'cat.gif.mp4' })).toBe(true)
  })

  it('обычное mp4-видео с именем файла — не гиф, даже с duration 0 (бэк не считает длительность)', () => {
    expect(isGifLike({ mime: 'video/mp4', fileName: 'holiday.mp4', duration: 0 })).toBe(false)
    expect(isGifLike({ mime: 'video/mp4', fileName: 'movie.mp4', duration: 120 })).toBe(false)
  })

  it('безымянное mp4 с duration===0 — гиф; с ненулевой длительностью — нет', () => {
    expect(isGifLike({ mime: 'video/mp4', duration: 0 })).toBe(true)
    expect(isGifLike({ mime: 'video/mp4', fileName: '', duration: 0 })).toBe(true)
    expect(isGifLike({ mime: 'video/mp4', duration: 15 })).toBe(false)
  })

  it('false для не-видео и не-gif медиа', () => {
    expect(isGifLike({ mime: 'image/jpeg', fileName: 'tenor.jpg' })).toBe(false)
    expect(isGifLike({ mime: 'video/webm', fileName: 'tenor.webm' })).toBe(false)
    expect(isGifLike({})).toBe(false)
  })
})
