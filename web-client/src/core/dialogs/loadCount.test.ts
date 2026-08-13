import { describe, expect, it, afterEach } from 'vitest'
import { DIALOG_LOAD_COUNT, guessLoadCount } from './loadCount'

const originalHeight = window.innerHeight

function setWindowHeight(height: number) {
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true })
}

afterEach(() => { setWindowHeight(originalHeight) })

describe('guessLoadCount — порт tweb base.ts:216-219', () => {
  it('DIALOG_LOAD_COUNT = 20 (base.ts:23)', () => {
    expect(DIALOG_LOAD_COUNT).toBe(20)
  })

  it('маленький экран — не меньше DIALOG_LOAD_COUNT', () => {
    setWindowHeight(600) // 600 / 64 * 1.25 = 11.7 -> 11
    expect(guessLoadCount()).toBe(20)
  })

  it('большой экран — ровно значение формулы max(h / 64 * 1.25 | 0, 20)', () => {
    setWindowHeight(2000)
    expect(guessLoadCount()).toBe(39) // 2000 / 64 * 1.25 = 39.0625 -> 39
    setWindowHeight(1080)
    expect(guessLoadCount()).toBe(21) // 1080 / 64 * 1.25 = 21.09 -> 21
  })
})
