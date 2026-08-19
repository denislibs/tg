// Task 6 (медиа-суперпорт, стадия C): проводка воркера вокруг downloadMediaURL.
//
// Прогон настоящий: createWorkerCore() — тот же mediaManager (с настоящим
// RestClient и настоящим CacheStorageController поверх застабленного caches),
// тот же веер workerScope, что в проде. Пины:
//  • onMediaUrl → broadcast(RT.mediaUrl): созданный воркером objectURL доезжает
//    вкладке кадром rt:media_url (без этой строки зеркала витрин слепы навсегда);
//  • байты идут worker-fetch'ем с Bearer-заголовком, БЕЗ токена в URL (прежний
//    путь картинок нёс медиа-токен query-параметром);
//  • onLoggingOut/onLoggedIn зовут media.resetDownloads(): без этого контекст
//    отдаёт blob:-URL медиа прошлого аккаунта, а корзина cachedFiles переживает
//    сессию (остаточный риск PR #191).
//
// fake-indexeddb — ПЕРВОЙ строкой: newCursor()/newConnectionManager() читают
// IndexedDB прямо в конструкторе, RestClient гейтит запросы на tokens.ready().
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkerCore } from './workerCore'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'
import { RT } from './realtime/events'
import type { MediaUrlEvt } from './managers/mediaManager'

let mediaFetches: Array<{ url: string; auth?: string }> = []

// Пара связанных эндпоинтов с синхронной доставкой (порт из workerCore.test.ts).
function pair(): [Endpoint, Endpoint] {
  const listenersA: Array<(ev: MessageEvent) => void> = []
  const listenersB: Array<(ev: MessageEvent) => void> = []
  const epA: Endpoint = {
    postMessage: (m) => { for (const l of listenersB) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersA.push(l) },
  }
  const epB: Endpoint = {
    postMessage: (m) => { for (const l of listenersA) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersB.push(l) },
  }
  return [epA, epB]
}

// Cache API (happy-dom его не даёт): Map-бэкенд с журналом caches.delete —
// настоящий CacheStorageController работает поверх него как поверх браузерного.
function fakeCaches() {
  const buckets = new Map<string, Map<string, Response>>()
  const deletes: string[] = []
  return {
    deletes,
    async open(name: string) {
      let b = buckets.get(name)
      if (!b) { b = new Map(); buckets.set(name, b) }
      const bucket = b
      return {
        async match(key: string) { return bucket.get(key) },
        async put(key: string, res: Response) { bucket.set(key, res) },
        async delete(key: string) { return bucket.delete(key) },
      }
    },
    async delete(name: string) { deletes.push(name); return buckets.delete(name) },
  }
}

let cachesStub: ReturnType<typeof fakeCaches>

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  cachesStub = fakeCaches()
  vi.stubGlobal('caches', cachesStub)
  mediaFetches = []
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    if (/\/media\/\d+\/content/.test(u)) {
      const h = (init?.headers ?? {}) as Record<string, string>
      mediaFetches.push({ url: u, auth: h.Authorization })
      return new Response('imgbytes', { status: 200 })
    }
    if (u.endsWith('/auth/logout')) return new Response('{}', { status: 200 })
    if (u.endsWith('/auth/sign_in')) {
      return new Response(JSON.stringify({
        token: 'session-b',
        user: { user_full: { _: 'users.userFull', full_user: { _: 'userFull', id: 5 }, chats: [], users: [{ _: 'user', pFlags: { self: true }, id: 5, phone: '+79990000005' }] }, can_message: true },
      }), { status: 200 })
    }
    throw new Error('unexpected fetch ' + u + ' ' + String(init?.method ?? 'GET'))
  }))
})

afterEach(() => { vi.unstubAllGlobals() })

describe('workerCore — rt:media_url и сброс конвейера на смене сессии', () => {
  it('objectURL воркера доезжает вкладке кадром rt:media_url; байты идут с Bearer-заголовком без токена в URL', async () => {
    const core = createWorkerCore()
    const [epWorker, epTab] = pair()
    core.bind(epWorker)
    const tab = new SuperMessagePort(epTab)
    const got: MediaUrlEvt[] = []
    tab.on(RT.mediaUrl, (p) => got.push(p as MediaUrlEvt))

    await core.registry.auth.signIn('+79990000005', '12345', 'dev', 'web')
    const url = await core.registry.media.downloadMediaURL(7)

    expect(got).toEqual([{ id: 7, thumb: false, url, size: 8 }])
    expect(mediaFetches).toHaveLength(1)
    expect(mediaFetches[0].url).toBe('/api/media/7/content')
    expect(mediaFetches[0].url).not.toContain('token=')
    expect(mediaFetches[0].auth).toBe('Bearer session-b')
  })

  it('уход сессии: конвейер сброшен — свежий запрос качает заново, корзина cachedFiles стёрта', async () => {
    const core = createWorkerCore()
    const url = await core.registry.media.downloadMediaURL(7)
    expect(mediaFetches).toHaveLength(1)

    await core.registry.auth.logout()

    expect(cachesStub.deletes).toContain('cachedFiles')
    const after = await core.registry.media.downloadMediaURL(7)
    expect(after).not.toBe(url)
    expect(mediaFetches).toHaveLength(2)
  })

  it('вход под новым аккаунтом сбрасывает конвейер так же, как логаут', async () => {
    const core = createWorkerCore()
    const url = await core.registry.media.downloadMediaURL(7)

    await core.registry.auth.signIn('+79990000005', '12345', 'dev', 'web')

    const after = await core.registry.media.downloadMediaURL(7)
    expect(after).not.toBe(url)
    expect(mediaFetches).toHaveLength(2)
  })
})
