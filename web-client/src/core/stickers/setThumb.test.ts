import { describe, expect, it } from 'vitest'
import { setThumbMediaId } from './setThumb'

const sticker = (mediaId: number) => ({
  id: mediaId, setId: 1, mediaId, emoji: '🦆', position: 0,
  width: 512, height: 512, mime: 'application/x-tgsticker',
})

describe('setThumbMediaId', () => {
  it('берёт обложку набора, когда она есть', () => {
    expect(setThumbMediaId({ coverMediaId: 77 }, [sticker(5)])).toBe(77)
  })

  it('падает на первый стикер, когда обложки нет', () => {
    expect(setThumbMediaId({ coverMediaId: undefined }, [sticker(5), sticker(6)])).toBe(5)
  })

  it('отдаёт undefined у пустого набора без обложки', () => {
    expect(setThumbMediaId({ coverMediaId: undefined }, [])).toBeUndefined()
  })
})
