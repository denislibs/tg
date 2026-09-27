// S10: скоуп офлайн-стора по токену (`persistScope`) под код-паролем не пишет
// токен в `msgr-store/meta` — это была бы открытая копия `session_token` рядом с
// зашифрованной. Отдельный файл со свежим модулем на каждый тест: гард `locked()`
// мемоизирован внутри `persist.ts` на 3 с (см. persist.test.ts).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.resetModules()
})

afterEach(() => { vi.unstubAllGlobals() })

describe('persistScope под код-паролем', () => {
  it('токен в meta не пишется, а оставшийся с до-кодовых времён — стирается', async() => {
    {
      const persist = await import('./persist')
      await persist.persistScope('tok-before-passcode')
      expect(await persist.persistGetToken()).toBe('tok-before-passcode')
    }

    vi.resetModules() // свежий гард locked()
    const { idbSet } = await import('./idbKv')
    await idbSet('passcode', { verificationHash: [1], verificationSalt: [2], encryptionSalt: [3] })
    const persist = await import('./persist')

    await persist.persistScope('tok-SECRET')

    expect(await persist.persistGetToken()).toBeNull()
  })

  it('scopeToSession воркера: скоуп по его токену, вкладке — только «сессия есть»', async() => {
    const { newPersistManager } = await import('../managers/persistManager')
    const persist = await import('./persist')
    const pm = newPersistManager(undefined, undefined, { ready: async() => {}, get: () => 'tok-A' })

    expect(await pm.scopeToSession()).toBe(true)
    expect(await persist.persistGetToken()).toBe('tok-A')

    const empty = newPersistManager(undefined, undefined, { ready: async() => {}, get: () => null })
    expect(await empty.scopeToSession()).toBe(false)
  })
})
