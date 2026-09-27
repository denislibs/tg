import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* S10 — корзина медиа service worker'а под код-паролем (`public/sw.js`, ветка
 * `handleMedia`; порт tweb `files/cacheStorage.ts:215-262` +
 * `serviceWorker/index.service.ts:143-162`).
 *
 * SW поднимается ИСХОДНИКОМ, как в `serviceWorker.appShell.test.ts` (он не модуль:
 * импортировать нельзя, проверять копию логики — значит проверять копию).
 * IndexedDB — fake: флаг «код включён» SW читает из записи `passcode` в `msgr/kv`.
 *
 * Предмет: при включённом коде на диск не ложится ни одного открытого байта —
 * без ключа корзина обходится, с ключом тело шифруется (заголовки исходника
 * остаются: по `Content-Length` экран «Данные и память» считает объём). */

const SW_SOURCE = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8')
const MEDIA = 'https://localhost/api/media/7/content?token=abc'
const PLAIN = 'PLAINTEXT-JPEG-BYTES-0123456789'

class FakeCache {
  readonly entries = new Map<string, Response>()
  async match(key: string) { return this.entries.get(key)?.clone() }
  async put(key: string, res: Response) { this.entries.set(key, res) }
  async delete(key: string) { return this.entries.delete(key) }
  async keys() { return [...this.entries.keys()].map((url) => ({ url })) }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>()
  async open(name: string) {
    let cache = this.caches.get(name)
    if(!cache) this.caches.set(name, cache = new FakeCache())
    return cache
  }
  async keys() { return [...this.caches.keys()] }
  async delete(name: string) { return this.caches.delete(name) }
}

type Handlers = {
  fetch?: (e: { request: unknown, respondWith(p: Promise<Response>): void }) => void
  message?: (e: { data: unknown, ports?: MessagePort[], waitUntil?(p: Promise<unknown>): void }) => void
}

function loadServiceWorker(net: (req: unknown) => Promise<Response>) {
  const handlers: Handlers = {}
  const storage = new FakeCacheStorage()
  const self = {
    addEventListener(type: string, fn: never) { (handlers as Record<string, unknown>)[type] = fn },
    location: { origin: 'https://localhost' },
    clients: { matchAll: async() => [], claim: async() => {} },
    skipWaiting: async() => {},
  }
  const importScripts = () => { throw new Error('нет sw-bridge.js') }
  // Тело — файл ИЗ РЕПОЗИТОРИЯ целиком, без интерполяции (см. serviceWorker.appShell.test.ts).
  // oxlint-disable-next-line no-implied-eval
  new Function('self', 'caches', 'fetch', 'importScripts', SW_SOURCE)(self, storage, net, importScripts)
  return { handlers, storage }
}

function request(handlers: Handlers, url = MEDIA): Promise<Response> {
  let responded: Promise<Response> | undefined
  handlers.fetch!({ request: { url, method: 'GET', headers: new Headers() }, respondWith(p) { responded = Promise.resolve(p) } })
  return responded!
}

/** Сообщение вкладки с подтверждением через MessageChannel — как `postToServiceWorker`. */
function post(handlers: Handlers, data: Record<string, unknown>): Promise<unknown> {
  const channel = new MessageChannel()
  const acked = new Promise((resolve) => { channel.port1.onmessage = (e) => resolve(e.data) })
  handlers.message!({ data, ports: [channel.port2], waitUntil() {} })
  return acked
}

async function writePasscodeRecord() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('msgr', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  await new Promise<void>((resolve) => {
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put({ verificationHash: [1], verificationSalt: [2], encryptionSalt: [3] }, 'passcode')
    tx.oncomplete = () => resolve()
  })
  db.close()
}

const netOk = () => vi.fn(async() => new Response(PLAIN, { status: 200, headers: { 'Content-Type': 'image/jpeg' } }))
const cached = (storage: FakeCacheStorage) => storage.caches.get('cachedFiles')?.entries.get('/api/media/7/content')

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()) })
afterEach(() => { vi.unstubAllGlobals() })

describe('sw.js — корзина медиа под код-паролем', () => {
  it('без кода — как раньше: открытое тело в корзине, второй раз из кэша', async() => {
    const net = netOk()
    const { handlers, storage } = loadServiceWorker(net)

    expect(await (await request(handlers)).text()).toBe(PLAIN)
    expect(await cached(storage)!.clone().text()).toBe(PLAIN)
    expect(await (await request(handlers)).text()).toBe(PLAIN)
    expect(net).toHaveBeenCalledTimes(1)
  })

  it('код включён, ключа нет (замок или перезапуск SW) — мимо корзины: ничего не пишется и не читается', async() => {
    await writePasscodeRecord()
    const net = netOk()
    const { handlers, storage } = loadServiceWorker(net)

    expect(await (await request(handlers)).text()).toBe(PLAIN)
    expect(await (await request(handlers)).text()).toBe(PLAIN)
    expect(cached(storage)).toBeUndefined()
    expect(net).toHaveBeenCalledTimes(2)
  })

  it('ключ пришёл — тело на диске зашифровано (iv ‖ ct), заголовки исходника; отдаётся расшифрованным', async() => {
    await writePasscodeRecord()
    const net = netOk()
    const { handlers, storage } = loadServiceWorker(net)
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])

    expect(await post(handlers, { type: 'passcode-state', isUsingPasscode: true, encryptionKey: key })).toBe(true)
    expect(await (await request(handlers)).text()).toBe(PLAIN)

    const stored = cached(storage)!
    const onDisk = new Uint8Array(await stored.clone().arrayBuffer())
    expect(new TextDecoder().decode(onDisk)).not.toContain('PLAINTEXT')
    expect(onDisk.length).toBe(12 + PLAIN.length + 16)
    expect(stored.headers.get('Content-Length')).toBe(String(PLAIN.length))

    const again = await request(handlers)
    expect(await again.text()).toBe(PLAIN)
    expect(net).toHaveBeenCalledTimes(1)
  })

  it('перезапуск SW под кодом: без ключа зашифрованную корзину не трогает — ни чтения, ни стирания', async() => {
    await writePasscodeRecord()
    const net = netOk()
    const first = loadServiceWorker(net)
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    await post(first.handlers, { type: 'passcode-state', isUsingPasscode: true, encryptionKey: key })
    await request(first.handlers)
    const stored = cached(first.storage)!

    // браузер перезапустил SW: ключ в памяти потерян, корзина на диске та же
    const restarted = loadServiceWorker(net)
    restarted.storage.caches.set('cachedFiles', first.storage.caches.get('cachedFiles')!)

    expect(await (await request(restarted.handlers)).text()).toBe(PLAIN)
    expect(net).toHaveBeenCalledTimes(2) // в сеть, а не из корзины
    expect(cached(restarted.storage)).toBe(stored) // запись цела — придёт ключ, прочитается
  })

  it('пауза корзины: запрос ждёт снятия паузы (идёт включение/смена кода)', async() => {
    const net = netOk()
    const { handlers } = loadServiceWorker(net)

    await post(handlers, { type: 'passcode-toggle-cache', enabled: false })
    let done = false
    const pending = request(handlers).then(() => { done = true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(done).toBe(false)
    expect(net).not.toHaveBeenCalled()

    await post(handlers, { type: 'passcode-toggle-cache', enabled: true })
    await pending
    expect(done).toBe(true)
  })
})
