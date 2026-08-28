import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/* App-shell кэш service worker'а (`public/sw.js`, ветка `handleImmutable`).
 *
 * Почему воркер поднимается ИСХОДНИКОМ. `public/sw.js` — не модуль: он живёт вне
 * графа сборки, стартует с `importScripts` и вешает обработчики на `self`.
 * Импортировать его нельзя, а проверять копию логики — значит проверять копию.
 * Поэтому текст файла исполняется здесь в подставленном окружении (`self`,
 * `caches`, `fetch`, `importScripts`), и тест видит НАСТОЯЩИЙ обработчик.
 *
 * Что здесь ловится. Ветка `/assets/` кэшировала любой `res.ok`, а 206 — тоже
 * `ok`. Cache Storage частичный ответ не принимает, `put` бросает, обработчик
 * отклоняется, и `respondWith` отдаёт браузеру network error. Под это попадал
 * каждый `<audio src="/assets/audio/*.mp3">`: медиаэлемент просит
 * `Range: bytes=0-`, nginx отвечает 206 — звук отправки не играл ни разу.
 * Эталон — tweb `src/lib/serviceWorker/cache.ts:6-8` (`isCorrectResponse` требует
 * `response.ok && response.status === 200`) и `cache.ts:40-42` (весь корпус под
 * try/catch с `return fetch(...)`: кэш не имеет права уронить запрос). */

const SW_SOURCE = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8')

/* Ограничение настоящего Cache Storage, а не выдумка теста: снято живьём в
 * браузере на стенде ветки —
 *   caches.open('probe').then(c => c.put(new Request('/x'), new Response('x', {status: 206})))
 *   → TypeError: Failed to execute 'put' on 'Cache': Partial response (status code 206) is unsupported
 * Без этой строки фейк принимал бы 206 молча, и тест не увидел бы дефекта. */
class FakeCache {
  readonly entries = new Map<string, Response>()
  readonly puts: string[] = []
  putError: Error | null = null

  async match(req: { url: string }): Promise<Response | undefined> {
    return this.entries.get(req.url)
  }

  async put(req: { url: string }, res: Response): Promise<void> {
    if (res.status === 206) {
      throw new TypeError(
        "Failed to execute 'put' on 'Cache': Partial response (status code 206) is unsupported",
      )
    }
    if (this.putError) throw this.putError
    this.puts.push(req.url)
    this.entries.set(req.url, res)
  }

  async keys(): Promise<{ url: string }[]> {
    return [...this.entries.keys()].map((url) => ({ url }))
  }

  async delete(): Promise<boolean> {
    return true
  }
}

type FetchEventLike = { request: unknown; respondWith(p: Promise<Response>): void }
type Handlers = { fetch?: (e: FetchEventLike) => void }

function loadServiceWorker(cache: FakeCache, fetchImpl: (req: unknown) => Promise<Response>) {
  const handlers: Handlers = {}
  const self = {
    addEventListener(type: string, fn: (e: never) => void) {
      ;(handlers as Record<string, unknown>)[type] = fn
    },
    location: { origin: 'https://localhost' },
    clients: { matchAll: async () => [], claim: async () => undefined },
    skipWaiting: async () => undefined,
  }
  const caches = {
    open: async () => cache,
    keys: async () => [],
    delete: async () => true,
  }
  // Как в проде без sw-bridge.js/sw-stream.js: воркер обязан пережить их отсутствие.
  const importScripts = () => {
    throw new Error('нет sw-bridge.js')
  }

  // Тело — файл ИЗ РЕПОЗИТОРИЯ, прочитанный целиком; интерполяции в него нет,
  // внешних данных тоже. Это единственный способ исполнить неимпортируемый воркер.
  // oxlint-disable-next-line no-implied-eval
  new Function('self', 'caches', 'fetch', 'importScripts', SW_SOURCE)(
    self,
    caches,
    fetchImpl,
    importScripts,
  )
  return handlers
}

function makeRequest(url: string, headers: Record<string, string> = {}) {
  return { url, method: 'GET', headers: new Headers(headers) }
}

function dispatchFetch(handlers: Handlers, req: unknown): Promise<Response> | undefined {
  let responded: Promise<Response> | undefined
  handlers.fetch?.({
    request: req,
    respondWith(p) {
      responded = Promise.resolve(p)
    },
  })
  return responded
}

const MP3 = 'https://localhost/assets/audio/message_sent.mp3'

describe('sw.js — app-shell кэш ассетов', () => {
  it('ассет, отданный по Range, доезжает до медиаэлемента: 206 мимо кэша и без второго запроса', async () => {
    const cache = new FakeCache()
    const net = vi.fn(async () => new Response('mp3', { status: 206 }))
    const handlers = loadServiceWorker(cache, net)

    const res = await dispatchFetch(handlers, makeRequest(MP3, { Range: 'bytes=0-' }))!

    expect(res.status).toBe(206)
    // Гейт `res.status === 200`: 206 не пытаются положить в кэш вовсе. Ослабление
    // гейта до `res.ok` роняет `put`, и запрос уходит в сеть ВТОРОЙ раз (аварийным
    // catch'ем) — это и краснит счётчик ниже.
    expect(cache.puts).toEqual([])
    expect(net).toHaveBeenCalledTimes(1)
  })

  it('отказ кэша не роняет запрос: ответ отдаётся из сети', async () => {
    const cache = new FakeCache()
    cache.putError = new DOMException('Quota exceeded', 'QuotaExceededError')
    const net = vi.fn(async () => new Response('js', { status: 200 }))
    const handlers = loadServiceWorker(cache, net)

    // Без внешнего try/catch (tweb cache.ts:40-42) отклонение `put` уехало бы в
    // respondWith и браузер получил бы network error на живой ассет.
    const res = await dispatchFetch(handlers, makeRequest('https://localhost/assets/app-abc123.js'))!

    expect(res.status).toBe(200)
  })

  it('обычный ассет по-прежнему кэшируется и второй раз идёт из кэша', async () => {
    const cache = new FakeCache()
    const net = vi.fn(async () => new Response('js', { status: 200 }))
    const handlers = loadServiceWorker(cache, net)
    const req = makeRequest('https://localhost/assets/app-abc123.js')

    await dispatchFetch(handlers, req)!
    expect(cache.puts).toEqual(['https://localhost/assets/app-abc123.js'])

    const second = await dispatchFetch(handlers, req)!
    expect(second.status).toBe(200)
    expect(net).toHaveBeenCalledTimes(1) // второй раз в сеть не ходили
  })
})
