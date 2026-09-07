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
  /** Опции последнего `match` — ими пинуется `{ignoreVary: true}` (tweb cache.ts:20). */
  readonly matchOptions: (Record<string, unknown> | undefined)[] = []
  putError: Error | null = null

  async match(req: { url: string }, options?: Record<string, unknown>): Promise<Response | undefined> {
    this.matchOptions.push(options)
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

  /** Порядок вставки — тот же, что у настоящего Cache Storage: по нему
   *  `trimShell` выбирает, кого вытеснить первым. */
  async keys(): Promise<{ url: string }[]> {
    return [...this.entries.keys()].map((url) => ({ url }))
  }

  /** ДЕЙСТВИТЕЛЬНО удаляет. Заглушка `async () => true` делала `trimShell`
   *  непроверяемым в принципе: потолок «срабатывал», ничего не выбрасывая. */
  async delete(req: { url: string }): Promise<boolean> {
    return this.entries.delete(req.url)
  }
}

/**
 * Настоящее хранилище кэшей: `caches.keys()/open()/delete()` обязаны быть
 * живыми, иначе ветка `activate` (снос `app-shell-*`) не проверяема вовсе —
 * прежний мок отдавал `keys(): []` и `delete()` заглушкой.
 */
class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>()

  constructor(seed: Record<string, FakeCache> = {}) {
    for (const [name, cache] of Object.entries(seed)) this.caches.set(name, cache)
  }

  async open(name: string): Promise<FakeCache> {
    let cache = this.caches.get(name)
    if (!cache) this.caches.set(name, cache = new FakeCache())
    return cache
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()]
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name)
  }
}

type FetchEventLike = { request: unknown; respondWith(p: Promise<Response>): void }
type LifecycleEventLike = { waitUntil(p: Promise<unknown>): void }
type Handlers = {
  fetch?: (e: FetchEventLike) => void
  install?: (e: LifecycleEventLike) => void
  activate?: (e: LifecycleEventLike) => void
}

interface Loaded {
  handlers: Handlers
  storage: FakeCacheStorage
  claimed: () => number
  skipped: () => number
}

function loadServiceWorker(
  cacheOrStorage: FakeCache | FakeCacheStorage,
  fetchImpl: (req: unknown) => Promise<Response>,
): Loaded {
  const storage = cacheOrStorage instanceof FakeCacheStorage
    ? cacheOrStorage
    // Одиночный кэш, как его подают старые тесты: он и есть `app-shell-*`.
    : new FakeCacheStorage({ 'app-shell-1': cacheOrStorage })

  const handlers: Handlers = {}
  let claimed = 0
  let skipped = 0
  const self = {
    addEventListener(type: string, fn: (e: never) => void) {
      ;(handlers as Record<string, unknown>)[type] = fn
    },
    location: { origin: 'https://localhost' },
    clients: { matchAll: async () => [], claim: async () => { claimed++ } },
    skipWaiting: async () => { skipped++ },
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
    storage,
    fetchImpl,
    importScripts,
  )
  return { handlers, storage, claimed: () => claimed, skipped: () => skipped }
}

function makeRequest(url: string, headers: Record<string, string> = {}, mode?: string) {
  return { url, method: 'GET', headers: new Headers(headers), mode }
}

/** Прогнать обработчик жизненного цикла и ДОЖДАТЬСЯ всего, что он отложил
 *  через `waitUntil`: без этого `activate` проверялся бы «до того, как». */
async function dispatchLifecycle(handler: ((e: LifecycleEventLike) => void) | undefined) {
  const pending: Promise<unknown>[] = []
  handler?.({ waitUntil(p) { pending.push(p) } })
  await Promise.all(pending)
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
    const { handlers } = loadServiceWorker(cache, net)

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
    const { handlers } = loadServiceWorker(cache, net)

    // Без внешнего try/catch (tweb cache.ts:40-42) отклонение `put` уехало бы в
    // respondWith и браузер получил бы network error на живой ассет.
    const res = await dispatchFetch(handlers, makeRequest('https://localhost/assets/app-abc123.js'))!

    expect(res.status).toBe(200)
  })

  it('обычный ассет по-прежнему кэшируется и второй раз идёт из кэша', async () => {
    const cache = new FakeCache()
    const net = vi.fn(async () => new Response('js', { status: 200 }))
    const { handlers } = loadServiceWorker(cache, net)
    const req = makeRequest('https://localhost/assets/app-abc123.js')

    await dispatchFetch(handlers, req)!
    expect(cache.puts).toEqual(['https://localhost/assets/app-abc123.js'])

    const second = await dispatchFetch(handlers, req)!
    expect(second.status).toBe(200)
    expect(net).toHaveBeenCalledTimes(1) // второй раз в сеть не ходили
  })

  /* Этап 0 плана «один движок lottie»
   * (docs/superpowers/plans/2026-09-05-lottie-single-engine.md) перенёс 11
   * встроенных json-ассетов из бандла в `public/assets/tgs/*.json`. У этих
   * файлов, В ОТЛИЧИЕ от остального `/assets/`, СТАБИЛЬНЫЕ имена без
   * контентного хеша — финальное ревью нашло, что общая immutable cache-first
   * ветка (`IMMUTABLE_RE`) из-за этого хоронит обновления навсегда: у
   * прогретого клиента дозалитый/поправленный json не долетит вовсе. Ниже —
   * НАСТОЯЩИЙ путь `/assets/tgs/` (`TGS_RE` → `handleTgs`, stale-while-
   * revalidate) прогоняется через НАСТОЯЩИЙ файл sw.js тем же приёмом, что и
   * соседние тесты. */
  it('json-ассет из public/assets/tgs кешируется по факту (первый заход — сеть)', async () => {
    const realJson = readFileSync(resolve(__dirname, '../../public/assets/tgs/Mailbox.json'), 'utf8')
    const cache = new FakeCache()
    const net = vi.fn(async () => new Response(realJson, { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const { handlers } = loadServiceWorker(cache, net)
    const req = makeRequest('https://localhost/assets/tgs/Mailbox.json')

    const first = await dispatchFetch(handlers, req)!
    expect(await first.text()).toBe(realJson)
    expect(cache.puts).toEqual(['https://localhost/assets/tgs/Mailbox.json'])
    expect(net).toHaveBeenCalledTimes(1)
  })

  it('обновление файла на «сервере» долетает: фоновая ревалидация реально ходит в сеть и обновляет кэш', async () => {
    const cache = new FakeCache()
    let payload = 'v1' // "старая" версия json
    const net = vi.fn(async () => new Response(payload, { status: 200 }))
    const { handlers } = loadServiceWorker(cache, net)
    const req = makeRequest('https://localhost/assets/tgs/Mailbox.json')

    const first = await dispatchFetch(handlers, req)!
    expect(await first.text()).toBe('v1')

    payload = 'v2' // деплой дозалил/поправил файл на "сервере"
    const second = await dispatchFetch(handlers, req)!
    // SWR: пока фон не догнал, второй ответ ещё может быть старым — это
    // ожидаемо и допустимо (сценарий задачи явно разрешает «либо новое
    // содержимое, либо хотя бы поход в сеть»). Важное здесь — сеть реально
    // была вызвана повторно, а не проигнорирована, как раньше с IMMUTABLE_RE.
    expect(await second.text()).toBe('v1')
    await vi.waitFor(() => expect(net).toHaveBeenCalledTimes(2))

    // Ревалидация долетела и легла в кэш — следующий показ уже свежий.
    const third = await dispatchFetch(handlers, req)!
    expect(await third.text()).toBe('v2')
  })

  it('при недоступной сети по-прежнему отдаёт закэшированную версию, не роняя ответ', async () => {
    const cache = new FakeCache()
    let online = true
    const net = vi.fn(async () => {
      if (!online) throw new TypeError('network unavailable')
      return new Response('v1', { status: 200 })
    })
    const { handlers } = loadServiceWorker(cache, net)
    const req = makeRequest('https://localhost/assets/tgs/Mailbox.json')

    await dispatchFetch(handlers, req) // прогреваем кэш, пока сеть есть

    online = false
    const res = await dispatchFetch(handlers, req)!
    expect(await res.text()).toBe('v1') // офлайн — но ответ есть, из кэша
  })

  // Правка не должна задеть хешированные ассеты: они — не /assets/tgs/,
  // остаются на IMMUTABLE_RE/handleImmutable и держат cache-first без похода
  // в сеть повторно (уже покрыто тестом выше «обычный ассет...», пин здесь —
  // явно по имени с хешем, как в задаче).
  it('хешированный ассет /assets/index-*.js остаётся cache-first — TGS-правка его не задевает', async () => {
    const cache = new FakeCache()
    const net = vi.fn(async () => new Response('js', { status: 200 }))
    const { handlers } = loadServiceWorker(cache, net)
    const req = makeRequest('https://localhost/assets/index-4f9a1c2b.js')

    await dispatchFetch(handlers, req)
    const second = await dispatchFetch(handlers, req)!
    expect(await second.text()).toBe('js')
    expect(net).toHaveBeenCalledTimes(1) // второй раз — из кэша, сеть не трогали
  })
})

/* ── Пустая страница при F5 после выката ────────────────────────────────────
 *
 * Симптом: после деплоя обновление УЖЕ ОТКРЫТОЙ вкладки часто даёт пустое
 * приложение (в консоли — расхождение service worker'а по файлу рантайма), а
 * новая вкладка стартует нормально.
 *
 * Корень был в стратегии, а не в частном промахе: воркер перехватывал
 * НАВИГАЦИЮ и клал `/index.html` в тот же кэш, что и ассеты. Оболочка ссылается
 * на хешированные чанки своей сборки, включая корневой
 * `assets/rolldown-runtime-<hash>.js` (проверено на сборке: он подключён прямо
 * из `dist/index.html` и стоит первым в `__vite__mapDeps` каждого ленивого
 * чанка). Деплой стирает старые хеши (`vite build --emptyOutDir`), nginx отдаёт
 * `/assets/` через `try_files $uri =404` — и любой возврат к старой оболочке
 * даёт 404 на РАНТАЙМЕ, то есть пустую страницу.
 *
 * Оригинал этой ветки не имеет вовсе: гейт кэша tweb требует расширения файла
 * (`serviceWorker/index.service.ts:274`), навигация под него не подпадает, а
 * `default` в его `switch` закомментирован (`:339-342`).
 *
 * Вторым слагаемым была мёртвая очистка версий: `activate` сносил все
 * `app-shell-*`, КРОМЕ текущего, а имя не менялось никогда (номер сборки
 * закоммичен единицей). Оригинал сносит свой кэш безусловно
 * (`index.service.ts:357-359`). */
describe('sw.js — выкат новой сборки', () => {
  const SHELL = 'https://localhost/'
  const RUNTIME_OLD = 'https://localhost/assets/rolldown-runtime-OLD.js'
  const RUNTIME_NEW = 'https://localhost/assets/rolldown-runtime-NEW.js'

  /** «Сервер» одной сборки: оболочка ссылается на свой рантайм, чужие хеши — 404
   *  (ровно `try_files $uri =404` из nginx поверх `--emptyOutDir`). */
  const server = (runtimeUrl: string) => async (req: unknown) => {
    const url = (req as { url: string }).url
    if (url === SHELL) return new Response(`<script src="${runtimeUrl}">`, { status: 200 })
    if (url === runtimeUrl) return new Response('runtime', { status: 200 })
    return new Response('not found', { status: 404 })
  }

  it('навигацию воркер НЕ перехватывает — оболочка всегда из сети', () => {
    const storage = new FakeCacheStorage()
    const { handlers } = loadServiceWorker(storage, server(RUNTIME_NEW))

    // `respondWith` не вызван вовсе — документ идёт мимо воркера, как в tweb.
    expect(dispatchFetch(handlers, makeRequest(SHELL, {}, 'navigate'))).toBeUndefined()
  })

  it('оболочка не попадает в кэш ни при каких обстоятельствах', async () => {
    const storage = new FakeCacheStorage()
    const { handlers } = loadServiceWorker(storage, server(RUNTIME_NEW))

    dispatchFetch(handlers, makeRequest(SHELL, {}, 'navigate'))
    await dispatchFetch(handlers, makeRequest(RUNTIME_NEW))

    const shell = await storage.open('app-shell-1')
    expect(shell.puts).toEqual([RUNTIME_NEW])
  })

  it('F5 после выката: старая оболочка не воскресает, рантайм новой сборки жив', async () => {
    // Вкладка прогрета сборкой A.
    const storage = new FakeCacheStorage()
    const a = loadServiceWorker(storage, server(RUNTIME_OLD))
    dispatchFetch(a.handlers, makeRequest(SHELL, {}, 'navigate'))
    await dispatchFetch(a.handlers, makeRequest(RUNTIME_OLD))

    // Выкат сборки B: старые хеши стёрты, на них 404.
    const b = loadServiceWorker(storage, server(RUNTIME_NEW))
    await dispatchLifecycle(b.handlers.install)
    await dispatchLifecycle(b.handlers.activate)

    // Документ идёт в сеть, значит приходит оболочка B со ссылкой на РАНТАЙМ B.
    expect(dispatchFetch(b.handlers, makeRequest(SHELL, {}, 'navigate'))).toBeUndefined()
    const runtime = await dispatchFetch(b.handlers, makeRequest(RUNTIME_NEW))!
    expect(runtime.status).toBe(200)
    expect(await runtime.text()).toBe('runtime')
  })

  it('activate сносит кэш оболочки ЦЕЛИКОМ, а не «все, кроме текущего»', async () => {
    // Имя кэша не менялось от выката к выкату (номер сборки заморожен), поэтому
    // фильтр `!== APP_SHELL` не удалял ничего: чанки всех сборок копились.
    const current = new FakeCache()
    await current.put({ url: RUNTIME_OLD }, new Response('old', { status: 200 }))
    const storage = new FakeCacheStorage({ 'app-shell-1': current, 'app-shell-0': new FakeCache() })

    const { handlers, claimed } = loadServiceWorker(storage, server(RUNTIME_NEW))
    await dispatchLifecycle(handlers.activate)

    expect(await storage.keys()).toEqual([])
    expect(claimed()).toBe(1)
  })

  it('media-кэш активацией не трогается — он не про оболочку', async () => {
    const storage = new FakeCacheStorage({ 'app-shell-1': new FakeCache(), cachedFiles: new FakeCache() })
    const { handlers } = loadServiceWorker(storage, server(RUNTIME_NEW))

    await dispatchLifecycle(handlers.activate)

    expect(await storage.keys()).toEqual(['cachedFiles'])
  })

  it('install объявляет skipWaiting, как оригинал (index.service.ts:352-355)', async () => {
    const { handlers, skipped } = loadServiceWorker(new FakeCacheStorage(), server(RUNTIME_NEW))
    await dispatchLifecycle(handlers.install)
    expect(skipped()).toBe(1)
  })
})

describe('sw.js — потолок кэша оболочки', () => {
  /* Сборка целиком обязана помещаться: 137 файлов под `/assets/`, 2 шрифта и 22
   * lottie-json — ~161 запись (числа сняты с `npx vite build` этой ветки).
   * Потолок 80 вытеснял живые чанки ТЕКУЩЕЙ сборки, ещё пока она грузилась. */
  const ONE_BUILD = 161

  const net = async () => new Response('js', { status: 200 })

  it('одна сборка помещается целиком — ни один её чанк не вытеснен', async () => {
    const storage = new FakeCacheStorage()
    const { handlers } = loadServiceWorker(storage, net)

    for (let i = 0; i < ONE_BUILD; i++) {
      await dispatchFetch(handlers, makeRequest(`https://localhost/assets/chunk-${i}.js`))
    }

    const shell = await storage.open('app-shell-1')
    await vi.waitFor(() => expect(shell.entries.size).toBe(ONE_BUILD))
  })

  it('сверх потолка выбрасываются САМЫЕ СТАРЫЕ записи', async () => {
    const storage = new FakeCacheStorage()
    const { handlers } = loadServiceWorker(storage, net)

    // 401 запись при потолке 400: первая обязана уйти.
    for (let i = 0; i < 401; i++) {
      await dispatchFetch(handlers, makeRequest(`https://localhost/assets/chunk-${i}.js`))
    }

    const shell = await storage.open('app-shell-1')
    await vi.waitFor(() => expect(shell.entries.size).toBe(400))
    expect(shell.entries.has('https://localhost/assets/chunk-0.js')).toBe(false)
    expect(shell.entries.has('https://localhost/assets/chunk-400.js')).toBe(true)
  })
})

describe('sw.js — Vary', () => {
  it('поиск в кэше игнорирует Vary (эталон tweb cache.ts:20)', async () => {
    // nginx работает с `gzip_vary on`, то есть ответы несут
    // `Vary: Accept-Encoding`. Без `ignoreVary` сохранённый ассет перестаёт
    // совпадать с запросом, у которого набор кодировок хоть чем-то отличается,
    // и cache-first промахивается на ровном месте.
    const cache = new FakeCache()
    const { handlers } = loadServiceWorker(cache, async () => new Response('js', { status: 200 }))

    await dispatchFetch(handlers, makeRequest('https://localhost/assets/app-abc123.js'))

    expect(cache.matchOptions).toContainEqual({ ignoreVary: true })
  })
})
