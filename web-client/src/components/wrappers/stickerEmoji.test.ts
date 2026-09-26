/**
 * `wrapStickerEmoji` (порт tweb `wrappers/stickerEmoji.ts`): документ берётся из
 * набора анимированных эмодзи и уходит в `wrapSticker` с `play`/без цикла; нет
 * стикера — контейнер всё равно `media-sticker-wrapper`, промис отклонён.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getAnimatedEmoji = vi.hoisted(() => vi.fn())
vi.mock('@core/animatedEmoji', () => ({ getAnimatedEmoji }))
const wrapSticker = vi.hoisted(() => vi.fn(() => ({ render: Promise.resolve(), width: 0, height: 0, destroy: () => {} })))
vi.mock('./sticker', () => ({ default: wrapSticker }))

import wrapStickerEmoji from './stickerEmoji'

beforeEach(() => {
  getAnimatedEmoji.mockReset()
  wrapSticker.mockClear()
})

describe('wrapStickerEmoji', () => {
  it('нет стикера: класс контейнера и отказ «no sticker», wrapSticker не зовётся', async() => {
    getAnimatedEmoji.mockResolvedValue(null)
    const div = document.createElement('div')
    await expect(wrapStickerEmoji({ div, width: 168, height: 168, emoji: '🔐' })).rejects.toThrow('no sticker')
    expect(div.classList.contains('media-sticker-wrapper')).toBe(true)
    expect(wrapSticker).not.toHaveBeenCalled()
  })

  it('есть стикер: wrapSticker с номером документа, play и без цикла', async() => {
    getAnimatedEmoji.mockResolvedValue({ id: 77, w: 512, h: 512 })
    const div = document.createElement('div')
    await wrapStickerEmoji({ div, width: 160, height: 160, emoji: '🥳' })
    expect(getAnimatedEmoji).toHaveBeenCalledWith('🥳')
    expect(wrapSticker).toHaveBeenCalledWith(expect.objectContaining({
      mediaId: 77, div, width: 160, height: 160, emoji: '🥳', play: true, loop: false, docWidth: 512, docHeight: 512,
    }))
  })
})
