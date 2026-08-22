import { describe, expect, it } from 'vitest'
import { setThumbMediaId } from './setThumb'
import { makeSticker } from './testSticker'

const sticker = (id: number) => makeSticker({ id, setId: 1 })

describe('setThumbMediaId', () => {
  it('берёт обложку набора, когда она есть', () => {
    expect(setThumbMediaId({ thumb_document_id: 77 }, [sticker(5)])).toBe(77)
  })

  it('падает на первый стикер, когда обложки нет', () => {
    expect(setThumbMediaId({ thumb_document_id: undefined }, [sticker(5), sticker(6)])).toBe(5)
  })

  it('отдаёт undefined у пустого набора без обложки', () => {
    expect(setThumbMediaId({ thumb_document_id: undefined }, [])).toBeUndefined()
  })
})
