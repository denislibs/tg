// Тесты порта tweb CacheStorageController (`core/files/cacheStorage.ts`).
// happy-dom не реализует Cache API, поэтому `globalThis.caches` замокан
// Map-бэкендом (match/put/delete + open/delete на уровне CacheStorage).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CacheStorageController from './cacheStorage'
import DeferredIsUsingPasscode from '@lib/passcode/deferredIsUsingPasscode'
import EncryptionKeyStore from '@lib/passcode/keyStore'

class FakeCache {
  public store = new Map<string, Response>()
  public match = vi.fn((key: string) => Promise.resolve(this.store.get(key)))
  public put = vi.fn((key: string, response: Response) => {
    this.store.set(key, response)
    return Promise.resolve()
  })
  public delete = vi.fn((key: string) => Promise.resolve(this.store.delete(key)))
}

class FakeCacheStorage {
  public buckets = new Map<string, FakeCache>()
  public open = vi.fn((name: string) => {
    let bucket = this.buckets.get(name)
    if(!bucket) {
      bucket = new FakeCache()
      this.buckets.set(name, bucket)
    }
    return Promise.resolve(bucket)
  })
  public delete = vi.fn((name: string) => Promise.resolve(this.buckets.delete(name)))
}

describe('CacheStorageController', () => {
  let fake: FakeCacheStorage

  beforeEach(async() => {
    fake = new FakeCacheStorage()
    vi.stubGlobal('caches', fake)
    // STORAGES — статический реестр, живёт на модуль: возвращаем всем
    // инстансам useStorage=true после тестов выключения
    await CacheStorageController.toggleStorage(true, false)
    // без кода-пароля (шифрование — отдельный describe ниже)
    DeferredIsUsingPasscode.resolveDeferred(false)
    EncryptionKeyStore.save(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('saveFile → getFile: то же содержимое; ключ "/"+entryName; заголовки Time-Cached (секунды) и Content-Length', async() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_766_000_000_000)
    const storage = new CacheStorageController('cachedFiles')
    const blob = new Blob(['hello media'], { type: 'image/jpeg' })
    await storage.saveFile('media_1', blob)

    const bucket = fake.buckets.get('cachedFiles')!
    // ключ хранится с префиксом '/' — как в tweb (cache.put('/' + entryName))
    expect([...bucket.store.keys()]).toEqual(['/media_1'])
    const stored = bucket.store.get('/media_1')!
    expect(stored.headers.get('Time-Cached')).toBe('1766000000')
    expect(stored.headers.get('Content-Length')).toBe('11')

    const got = await storage.getFile('media_1', 'blob')
    expect(await got.text()).toBe('hello media')
  })

  it('getFile несуществующего ключа → reject NO_ENTRY_FOUND', async() => {
    const storage = new CacheStorageController('cachedFiles')
    await expect(storage.getFile('missing')).rejects.toMatchObject({ type: 'NO_ENTRY_FOUND' })
  })

  it('has/delete ходят по тому же ключу с префиксом "/"', async() => {
    const storage = new CacheStorageController('cachedFiles')
    await storage.saveFile('media_2', new Blob(['x']))
    expect(await storage.has('media_2')).toBe(true)

    await storage.delete('media_2')
    const bucket = fake.buckets.get('cachedFiles')!
    expect(bucket.delete).toHaveBeenCalledWith('/media_2')
    expect(await storage.has('media_2')).toBe(false)
  })

  it('deleteAll сносит корзину целиком через caches.delete(dbName), не перебором ключей', async() => {
    const storage = new CacheStorageController('cachedFiles')
    await storage.saveFile('media_3', new Blob(['x']))

    await storage.deleteAll()
    expect(fake.delete).toHaveBeenCalledWith('cachedFiles')
    const bucket = fake.buckets.get('cachedFiles')
    // ключи корзины не перечислялись (tweb cacheStorage.ts:390-394)
    expect(bucket).toBeUndefined()
  })

  it('deleteAllStorages удаляет все корзины конфига', async() => {
    await CacheStorageController.deleteAllStorages()
    expect(fake.delete).toHaveBeenCalledWith('cachedFiles')
  })

  it('toggleStorage(false) → мгновенный reject STORAGE_OFFLINE без похода в caches', async() => {
    const storage = new CacheStorageController('cachedFiles')
    const opens = fake.open.mock.calls.length
    await CacheStorageController.toggleStorage(false, false)

    // fake timers не проматываются: reject обязан прийти без таймеров
    vi.useFakeTimers()
    await expect(storage.getFile('media_1')).rejects.toMatchObject({ type: 'STORAGE_OFFLINE' })
    expect(fake.open.mock.calls.length).toBe(opens)
  })

  it('операция дольше 15 секунд → reject по таймауту', async() => {
    vi.useFakeTimers()
    fake.open = vi.fn(() => new Promise<FakeCache>(() => {})) // caches.open висит навсегда
    const storage = new CacheStorageController('cachedFiles')

    const caught = storage.getFile('media_1').then(
      () => {
        throw new Error('должен был отклониться')
      },
      (err: unknown) => err,
    )
    await vi.advanceTimersByTimeAsync(15_000)
    // tweb зовёт reject() без значения (cacheStorage.ts:290)
    await expect(caught).resolves.toBeUndefined()
  })

  it('falsy результат caches.open выключает хранилище перманентно: повтор — STORAGE_OFFLINE без нового open', async() => {
    fake.open = vi.fn(() => Promise.resolve(undefined as unknown as FakeCache))
    const storage = new CacheStorageController('cachedFiles')

    await expect(storage.getFile('media_1')).rejects.toBe('no cache?')

    const opens = fake.open.mock.calls.length
    await expect(storage.getFile('media_1')).rejects.toMatchObject({ type: 'STORAGE_OFFLINE' })
    expect(fake.open.mock.calls.length).toBe(opens)
  })
})

// S10 — шифрование корзины под код-паролем (tweb cacheStorage.ts:17-47, :108-146,
// :215-262, :370-430): тело на диске — AES-GCM, заголовки (исходный
// Content-Length — по нему считает объём «Данные и память») — открыто.
describe('CacheStorageController: под код-паролем', () => {
  let fake: FakeCacheStorage
  let key: CryptoKey

  beforeEach(async() => {
    fake = new FakeCacheStorage()
    vi.stubGlobal('caches', fake)
    await CacheStorageController.toggleStorage(true, false)
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    DeferredIsUsingPasscode.resolveDeferred(true)
    EncryptionKeyStore.save(key)
  })

  afterEach(() => {
    CacheStorageController.temporarilyToggle(true)
    DeferredIsUsingPasscode.resolveDeferred(false)
    EncryptionKeyStore.save(null)
    vi.unstubAllGlobals()
  })

  it('на диске — шифртекст (iv ‖ ct), заголовки исходника; getFile отдаёт открытое', async() => {
    const storage = new CacheStorageController('cachedFiles')
    const plain = 'PLAINTEXT media bytes 1234567890'
    await storage.saveFile('media_1', new Blob([plain], { type: 'image/jpeg' }))

    const stored = fake.buckets.get('cachedFiles')!.store.get('/media_1')!
    const onDisk = new Uint8Array(await stored.clone().arrayBuffer())
    expect(new TextDecoder().decode(onDisk)).not.toContain('PLAINTEXT')
    expect(onDisk.length).toBe(12 + plain.length + 16) // IV + текст + тег GCM
    expect(stored.headers.get('Content-Length')).toBe(String(plain.length))

    const got = await storage.getFile('media_1', 'blob')
    expect(await got.text()).toBe(plain)
  })

  it('пауза temporarilyToggle(false): get/save ждут снятия (идёт включение/смена кода)', async() => {
    const storage = new CacheStorageController('cachedFiles')
    CacheStorageController.temporarilyToggle(false)
    let saved = false
    const saving = storage.saveFile('media_2', new Blob(['x'])).then(() => { saved = true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(saved).toBe(false)
    expect(fake.buckets.get('cachedFiles')?.put ?? vi.fn()).not.toHaveBeenCalled()

    CacheStorageController.temporarilyToggle(true)
    await saving
    expect(saved).toBe(true)
  })

  it('clearEncryptableStorages сносит шифруемую корзину целиком', async() => {
    await CacheStorageController.clearEncryptableStorages()
    expect(fake.delete).toHaveBeenCalledWith('cachedFiles')
  })
})
