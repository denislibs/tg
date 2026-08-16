import { describe, it, expect } from 'vitest'
import { readDnpConfig, readVanillaFeed, AppConfig } from './app'

const env = (o: Record<string, string | undefined>) => o as unknown as ImportMetaEnv

describe('readDnpConfig', () => {
  it('disabled by default, empty keys', () => {
    const c = readDnpConfig(env({}))
    expect(c.enabled).toBe(false)
    expect(c.serverStaticPublicKeys).toEqual([])
  })
  it('enabled via VITE_DNP_ENABLED=1', () => {
    expect(readDnpConfig(env({ VITE_DNP_ENABLED: '1' })).enabled).toBe(true)
  })
  it('parses comma-separated pinned keys, trims, drops empties', () => {
    const c = readDnpConfig(env({ VITE_DNP_SERVER_PUBKEYS: ' a , b ,, c ' }))
    expect(c.serverStaticPublicKeys).toEqual(['a', 'b', 'c'])
  })
})

// Флаг переноса ленты на императивный DOM (порт tweb `chat/bubbles.ts`).
// Пин на «по умолчанию ВЫКЛЮЧЕН»: перенос идёт этапами 2-7, и до последнего из
// них живой лентой обязана оставаться React-версия — включённый по недосмотру
// дефолт увёз бы в прод недоделанную ленту (ни медиа, ни реакций, ни времени).
describe('readVanillaFeed', () => {
  it('выключен по умолчанию', () => {
    expect(readVanillaFeed(env({}))).toBe(false)
  })
  it('включается только точным VITE_VANILLA_FEED=1', () => {
    expect(readVanillaFeed(env({ VITE_VANILLA_FEED: '1' }))).toBe(true)
    expect(readVanillaFeed(env({ VITE_VANILLA_FEED: 'true' }))).toBe(false)
    expect(readVanillaFeed(env({ VITE_VANILLA_FEED: '0' }))).toBe(false)
  })
  it('AppConfig читает флаг из окружения сборки (в тестах он не выставлен)', () => {
    expect(AppConfig.vanillaFeed).toBe(false)
  })
})
