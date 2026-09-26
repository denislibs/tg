/**
 * `helpers/liteMode.ts` — порт tweb `helpers/liteMode.ts` (812502980). Формула
 * оригинала (`:16-35`): режим включён = `liteMode.all`; анимация ключа доступна =
 * `!all && !liteMode[key]` — у каждого ключа своя галочка, `all` глушит все.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULTS, useSettingsStore } from '@/settings'
import liteMode from './liteMode'

const set = (patch: Partial<typeof DEFAULTS.liteMode>) =>
  useSettingsStore.getState().update({ liteMode: { ...DEFAULTS.liteMode, ...patch } })

afterEach(() => set({}))

describe('liteMode — формула tweb', () => {
  it('ключ выключен — недоступен только он', () => {
    set({ gif: true })
    expect(liteMode.isAvailable('gif')).toBe(false)
    expect(liteMode.isAvailable('video')).toBe(true)
    expect(liteMode.isAvailable('animations')).toBe(true)
    expect(liteMode.isEnabled()).toBe(false)
  })

  it('all — недоступно всё, режим включён', () => {
    set({ all: true })
    expect(liteMode.isEnabled()).toBe(true)
    expect(liteMode.isAvailable('video')).toBe(false)
    expect(liteMode.isAvailable('animations')).toBe(false)
  })
})
