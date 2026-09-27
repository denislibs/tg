// S10 — действия код-пароля вкладки (`lib/passcode/actions.ts`, порт tweb
// `lib/passcode/actions.ts`): порядок шагов 1:1 с оригиналом (пауза корзин →
// очистка шифруемых корзин → воркер → SW → ключ себе → снятие паузы), что
// лежит в записи кода, миграция записи без соли ключа и передача ключа через
// перезагрузку только в `window.sessionStorage`.
//
// Границы — заглушки: канал к воркеру (`invokePasscode`), SW, корзина медиа,
// `msgr/kv` (словарь в памяти). Криптография — настоящая (WebCrypto).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const log = vi.hoisted(() => [] as string[])
const idb = vi.hoisted(() => new Map<string, unknown>())
const invokePasscode = vi.hoisted(() => vi.fn(async(task: { method: string, payload?: unknown }) => {
  log.push(`worker:${task.method}${task.method === 'toggleCacheStorage' ? `(${String(task.payload)})` : ''}`)
  return undefined
}))

vi.mock('@core/store/idbKv', () => ({
  idbGet: async(key: string) => idb.get(key),
  idbSet: async(key: string, val: unknown) => { log.push(`idbSet:${key}`); idb.set(key, val) },
  idbDel: async(key: string) => { log.push(`idbDel:${key}`); idb.delete(key) },
}))
vi.mock('@/client/passcodeClient', () => ({ invokePasscode }))
vi.mock('@/client/passcodeServiceWorker', () => ({
  sendPasscodeStateToServiceWorker: vi.fn(async() => { log.push('sw:state') }),
  toggleServiceWorkerCacheStorage: vi.fn(async(enabled: boolean) => { log.push(`sw:toggleCache(${enabled})`) }),
}))
vi.mock('@core/mediaCache', () => ({ clearCachedFiles: vi.fn(async() => { log.push('caches:clear') }) }))

import { changePasscode, disablePasscode, enablePasscode, isMyPasscode, unlockWithPasscode } from './actions'
import { saveEncryptionKeyForHandoff, takeEncryptionKeyHandoff, importHandoffKey } from './keyHandoff'
import EncryptionKeyStore from './keyStore'
import DeferredIsUsingPasscode from './deferredIsUsingPasscode'
import { useSettingsStore } from '@/settings'

const persist = { clearAll: vi.fn(async() => { log.push('persist:clearAll') }) }

beforeEach(() => {
  log.length = 0
  idb.clear()
  invokePasscode.mockClear()
  localStorage.clear()
  sessionStorage.clear()
  useSettingsStore.getState().update({ passcodeEnabled: false })
})

const payloadOf = (method: string) =>
  invokePasscode.mock.calls.filter(([t]) => t.method === method).pop()![0].payload as Record<string, unknown>

/** В localStorage (там лежат настройки) и sessionStorage нет ключа ни в каком виде. */
async function expectKeyNotInWebStorage(key: CryptoKey) {
  const raw = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('raw', key))))
  for(const store of [localStorage, sessionStorage]) {
    for(let i = 0; i < store.length; i++) expect(store.getItem(store.key(i)!)).not.toContain(raw)
  }
}

describe('включение', () => {
  it('порядок шагов tweb actions.ts:42-79; ключ — воркеру и себе, на диске — только соли и хеш', async() => {
    await enablePasscode('1234', persist)

    expect(log).toEqual([
      'idbSet:passcode',
      'persist:clearAll',
      'worker:toggleCacheStorage(false)', 'sw:toggleCache(false)',
      'caches:clear', 'worker:resetEncryptableCacheStorages',
      'worker:toggleUsingPasscode',
      'sw:state',
      'worker:toggleCacheStorage(true)', 'sw:toggleCache(true)',
    ])
    const stored = idb.get('passcode') as Record<string, Uint8Array>
    expect(Object.keys(stored).sort()).toEqual(['encryptionSalt', 'verificationHash', 'verificationSalt'])
    expect(stored.encryptionSalt).not.toEqual(stored.verificationSalt)

    const { encryptionKey } = payloadOf('toggleUsingPasscode') as { encryptionKey: CryptoKey }
    expect(payloadOf('toggleUsingPasscode').isUsingPasscode).toBe(true)
    expect(EncryptionKeyStore.getUndeferred()).toBe(encryptionKey)
    expect(DeferredIsUsingPasscode.isUsingPasscodeUndeferred()).toBe(true)
    expect(useSettingsStore.getState().passcodeEnabled).toBe(true)
    // ключ выведен из кода и соли записи
    const { deriveEncryptionKey } = await import('./utils')
    const again = await deriveEncryptionKey('1234', stored.encryptionSalt)
    expect(new Uint8Array(await crypto.subtle.exportKey('raw', again)))
      .toEqual(new Uint8Array(await crypto.subtle.exportKey('raw', encryptionKey)))
    // ни localStorage, ни sessionStorage ключа не видели
    await expectKeyNotInWebStorage(encryptionKey)
    expect(sessionStorage.length).toBe(0)
  })

  it('сверка кода: верный — да, неверный — нет', async() => {
    await enablePasscode('1234', persist)
    expect(await isMyPasscode('1234')).toBe(true)
    expect(await isMyPasscode('4321')).toBe(false)
  })
})

describe('смена и выключение', () => {
  it('смена: новые соли, запись и перешифровку делает воркер, корзины чистятся под паузой', async() => {
    await enablePasscode('1234', persist)
    log.length = 0

    await changePasscode('5555')

    expect(log).toEqual([
      'worker:toggleCacheStorage(false)', 'sw:toggleCache(false)',
      'caches:clear', 'worker:resetEncryptableCacheStorages',
      'worker:changePasscode',
      'sw:state',
      'worker:toggleCacheStorage(true)', 'sw:toggleCache(true)',
    ])
    const { toStore, encryptionKey } = payloadOf('changePasscode') as { toStore: Record<string, unknown>, encryptionKey: CryptoKey }
    expect(Object.keys(toStore).sort()).toEqual(['encryptionSalt', 'verificationHash', 'verificationSalt'])
    expect(EncryptionKeyStore.getUndeferred()).toBe(encryptionKey)
  })

  it('выключение: воркер расшифровывает, ключ забыт, запись кода удаляется последней', async() => {
    await enablePasscode('1234', persist)
    log.length = 0

    await disablePasscode()

    expect(log).toEqual([
      'worker:toggleCacheStorage(false)', 'sw:toggleCache(false)',
      'caches:clear', 'worker:resetEncryptableCacheStorages',
      'worker:toggleUsingPasscode',
      'sw:state',
      'worker:toggleCacheStorage(true)', 'sw:toggleCache(true)',
      'idbDel:passcode',
    ])
    expect(payloadOf('toggleUsingPasscode')).toEqual({ isUsingPasscode: false })
    expect(EncryptionKeyStore.getUndeferred()).toBeNull()
    expect(useSettingsStore.getState().passcodeEnabled).toBe(false)
  })
})

describe('разблокировка', () => {
  it('ключ из соли записи — воркеру, соседям снимается замок', async() => {
    await enablePasscode('1234', persist)
    const salt = (idb.get('passcode') as { encryptionSalt: Uint8Array }).encryptionSalt
    EncryptionKeyStore.save(null)
    log.length = 0

    await unlockWithPasscode('1234')

    expect(log).toEqual(['worker:saveEncryptionKey', 'sw:state', 'worker:toggleLockOthers'])
    const key = payloadOf('saveEncryptionKey') as unknown as CryptoKey
    const { deriveEncryptionKey } = await import('./utils')
    expect(new Uint8Array(await crypto.subtle.exportKey('raw', key)))
      .toEqual(new Uint8Array(await crypto.subtle.exportKey('raw', await deriveEncryptionKey('1234', salt))))
    expect(payloadOf('toggleLockOthers')).toBe(false)
  })

  it('миграция: у записи до шифрования нет соли — создаётся и дописывается, открытая корзина чистится', async() => {
    const { hashPasscode } = await import('./utils')
    const verificationSalt = [...crypto.getRandomValues(new Uint8Array(16))]
    // старый формат — number[] и без encryptionSalt
    idb.set('passcode', { verificationHash: [...await hashPasscode('1234', new Uint8Array(verificationSalt))], verificationSalt })
    expect(await isMyPasscode('1234')).toBe(true)

    await unlockWithPasscode('1234')

    const stored = idb.get('passcode') as { encryptionSalt?: Uint8Array, verificationSalt: number[] }
    expect(stored.encryptionSalt).toBeInstanceOf(Uint8Array)
    expect(stored.verificationSalt).toEqual(verificationSalt)
    expect(log).toEqual([
      'idbSet:passcode',
      'worker:saveEncryptionKey',
      'worker:toggleCacheStorage(false)', 'sw:toggleCache(false)',
      'caches:clear', 'worker:resetEncryptableCacheStorages',
      'worker:toggleCacheStorage(true)', 'sw:toggleCache(true)',
      'sw:state',
      'worker:toggleLockOthers',
    ])
  })
})

describe('передача ключа через перезагрузку (tweb 65c6ea8f8)', () => {
  it('только window.sessionStorage, забирается один раз; localStorage и msgr/kv не трогаются', async() => {
    await enablePasscode('1234', persist)
    const key = EncryptionKeyStore.getUndeferred()!
    log.length = 0

    const localBefore = localStorage.length
    await saveEncryptionKeyForHandoff()

    expect(localStorage.length).toBe(localBefore)
    expect(log).toEqual([]) // ни одной записи в IndexedDB
    expect(sessionStorage.length).toBe(1)
    const taken = takeEncryptionKeyHandoff()!
    expect(sessionStorage.length).toBe(0)
    expect(takeEncryptionKeyHandoff()).toBeNull()
    await expectKeyNotInWebStorage(key)
    const imported = await importHandoffKey(taken)
    expect(new Uint8Array(await crypto.subtle.exportKey('raw', imported)))
      .toEqual(new Uint8Array(await crypto.subtle.exportKey('raw', key)))
  })

  it('без кода — ничего не пишется', async() => {
    DeferredIsUsingPasscode.resolveDeferred(false)
    EncryptionKeyStore.save(null)
    await saveEncryptionKeyForHandoff()
    expect(sessionStorage.length).toBe(0)
  })
})
