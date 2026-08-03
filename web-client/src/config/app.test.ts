import { describe, it, expect } from 'vitest'
import { readDnpConfig } from './app'

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
