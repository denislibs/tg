/* Web Push + медиакэш + app-shell service worker. Scope: / (build root). */

/* DNP-мост к SharedWorker (§ PR-2a): байты медиа для 206-стриминга. Грузим
 * защищённо — если sw-bridge.js недоступен (нестыковка деплоя/CDN), деградируем
 * DNP-стриминг, но НЕ роняем install SW (иначе push/кэш легли бы у всех). */
let dnpBridge = null
try {
  importScripts('/sw-bridge.js')
  dnpBridge = self.createDnpBridge()
} catch (_e) { /* нет моста — DNP-стриминг недоступен, остальное работает */ }

/* Переустановка моста (§ handoff-robustness, эталон tweb 'startup check'):
 * если у dnpBridge нет порта — просим активные окна переотдать. Вызывается на старте SW
 * (в т.ч. после рестарта — порт in-memory теряется) и на dnp-ping от окна. */
function requestBridgePortIfNeeded(client) {
  if (!dnpBridge || dnpBridge.hasPort()) return
  if (client) { client.postMessage({ type: 'dnp-request-port' }); return }
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    cs.forEach(function (c) { c.postMessage({ type: 'dnp-request-port' }) })
  })
}
// Стартовая инициатива SW (top-level: исполняется при каждом запуске SW, включая рестарт).
if (dnpBridge) { try { requestBridgePortIfNeeded(null) } catch (_e) {} }

/* 206-стриминг (§ PR-2b): грузим защищённо тем же try/catch — битый sw-stream не
 * должен ронять install SW (push/кэш важнее DNP-стриминга). Хендлер живёт лишь
 * когда есть мост (dnpBridge). */
let dnpStreamHandler = null
try {
  importScripts('/sw-stream.js')
  if (dnpBridge && self.dnpStream) {
    dnpStreamHandler = self.dnpStream.createStreamHandler(
      (mediaId, offset, limit) => dnpBridge.requestPart(mediaId, offset, limit),
    )
  }
} catch (_e) { /* нет sw-stream — DNP-стриминг недоступен, остальное работает */ }

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) =>
  e.waitUntil(
    (async () => {
      // Подчищаем предыдущие версии app-shell кэша (media-кэш не трогаем).
      const names = await caches.keys()
      await Promise.all(
        names.filter((n) => n.startsWith('app-shell-') && n !== APP_SHELL).map((n) => caches.delete(n)),
      )
      await self.clients.claim()
    })(),
  ),
)

/* ---- Медиакэш (tweb CacheStorage 'cachedFiles') ----------------------------
 * Ответы /api/media/{id}/content складываются в caches со штампами
 * Content-Length/Time-Cached (как tweb cacheStorage.save) — по ним экран
 * «Данные и память» считает объём, а clearOldCache чистит по TTL/лимиту. */
const CACHED_FILES = 'cachedFiles'
const MEDIA_RE = /^\/api\/media\/\d+\/content$/

/* ---- App-shell кэш (мгновенный повторный старт на медленной сети) -----------
 * Хешированные ассеты (/assets/) и шрифты (/fonts/) контентно-адресуемы и отдаются
 * с Cache-Control: immutable — их безопасно держать cache-first без ревалидации.
 * index.html — network-first (онлайн всегда свежий, оффлайн — из кэша).
 * Имя app-shell-<build> штампует scripts/write-version.mjs на сборке: новый деплой →
 * новое имя → activate удаляет старые app-shell-* (см. ниже) → свежая оболочка. */
const APP_SHELL = 'app-shell-1'
const IMMUTABLE_RE = /^\/(assets|fonts)\//
const SHELL_MAX = 80 // потолок записей (старые хеш-чанки после деплоев — под нож)

// Ключ кэша — URL без короткоживущего token (иначе каждая ротация токена
// плодит дубликаты); v=thumb остаётся — превью и оригинал живут раздельно.
function mediaCacheKey(rawUrl) {
  const u = new URL(rawUrl)
  u.searchParams.delete('token')
  return u.pathname + u.search
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // DNP-стрим (§ PR-2b): видео/аудио через Noise-канал. 206 собирает SW из чанков.
  if (dnpStreamHandler && url.pathname.startsWith('/dnp-stream/')) {
    event.respondWith(
      Promise.race([
        dnpStreamHandler.handleStreamFetch(req),
        new Promise((resolve) => setTimeout(() => resolve(Response.error()), 45000)),
      ]),
    )
    return
  }

  // Медиа — свой cache-first (Range-стриминг проходит мимо кэша).
  if (MEDIA_RE.test(url.pathname)) {
    if (req.headers.has('range')) return
    event.respondWith(handleMedia(req))
    return
  }

  // API/WS и публичные @username-страницы — никогда не перехватываем и не кэшируем.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws') || url.pathname.startsWith('/@')) return

  // Навигации (SPA) — network-first, оффлайн-фолбэк на закэшированный index.html.
  if (req.mode === 'navigate') {
    event.respondWith(handleNavigation(req))
    return
  }

  // Хешированные ассеты и шрифты — immutable, cache-first (мгновенный ре-старт).
  if (IMMUTABLE_RE.test(url.pathname)) {
    event.respondWith(handleImmutable(req))
    return
  }
})

async function handleMedia(req) {
  const cache = await caches.open(CACHED_FILES)
  const key = mediaCacheKey(req.url)
  const hit = await cache.match(key)
  if (hit) return hit
  const res = await fetch(req)
  if (res.status === 200) {
    try {
      const blob = await res.clone().blob()
      const headers = new Headers()
      const ct = res.headers.get('content-type')
      if (ct) headers.set('Content-Type', ct)
      headers.set('Content-Length', String(blob.size))
      headers.set('Time-Cached', String(Math.floor(Date.now() / 1000)))
      await cache.put(key, new Response(blob, { status: 200, headers }))
    } catch (_e) { /* quota — не мешаем ответу */ }
  }
  return res
}

async function handleNavigation(req) {
  const cache = await caches.open(APP_SHELL)
  try {
    const res = await fetch(req)
    if (res.ok) cache.put('/index.html', res.clone()) // свежая оболочка для оффлайна
    return res
  } catch (_e) {
    const fallback = await cache.match('/index.html')
    return fallback || Response.error()
  }
}

async function handleImmutable(req) {
  const cache = await caches.open(APP_SHELL)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) {
    await cache.put(req, res.clone())
    trimShell(cache) // fire-and-forget: держим кэш в пределах SHELL_MAX
  }
  return res
}

// Хеш-имена уникальны, ревалидация не нужна — но старые чанки после деплоев
// копятся. Держим потолок: сверх лимита выбрасываем старейшие (index.html — нет).
async function trimShell(cache) {
  try {
    const keys = await cache.keys()
    if (keys.length <= SHELL_MAX) return
    const evictable = keys.filter((k) => !k.url.endsWith('/index.html'))
    const over = keys.length - SHELL_MAX
    for (let i = 0; i < over && i < evictable.length; i++) await cache.delete(evictable[i])
  } catch (_e) { /* не роняем SW */ }
}

/* Очистка по TTL/лимиту размера (tweb serviceWorker/clearOldCache.ts).
 * Настройки приходят postMessage'ем из вкладки при старте и при изменении
 * (localStorage в SW недоступен). */
self.addEventListener('message', (event) => {
  const d = event.data
  if (d && d.type === 'cache-settings') {
    event.waitUntil(clearOldCache(d.cacheTTL | 0, d.cacheSize || 0))
  }
  if (d && d.type === 'dnp-bridge-port' && dnpBridge && event.ports && event.ports[0]) {
    dnpBridge.setPort(event.ports[0])
    return
  }
  if (d && d.type === 'dnp-ping') {
    requestBridgePortIfNeeded(event.source)
    return
  }
})

async function clearOldCache(ttlSeconds, maxSize) {
  try {
    const cache = await caches.open(CACHED_FILES)
    const requests = await cache.keys()
    const ref = ttlSeconds > 0 ? Math.floor(Date.now() / 1000) - ttlSeconds : 0
    const kept = []
    let total = 0
    for (const req of requests) {
      const res = await cache.match(req)
      if (!res) continue
      const time = parseInt(res.headers.get('Time-Cached')) || 0
      if (time < ref) { await cache.delete(req); continue }
      const size = parseInt(res.headers.get('Content-Length')) || 0
      total += size
      kept.push({ req, time, size })
    }
    if (!maxSize || total <= maxSize) return // 0 = без лимита
    kept.sort((a, b) => a.time - b.time) // старые — первыми под нож
    for (const entry of kept) {
      if (total <= maxSize) break
      await cache.delete(entry.req)
      total -= entry.size
    }
  } catch (_e) { /* не роняем SW */ }
}

self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch (_e) { d = {} }
  const title = (d.sender && d.sender.name) || 'New message'
  // Пустой text = Message Preview выключен на бэке — показываем generic-текст
  const body = d.text || 'New message'
  const chatId = d.chat_id
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: chatId != null ? 'chat-' + chatId : undefined,
      renotify: true,
      data: { chatId },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const chatId = event.notification.data && event.notification.data.chatId
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if ('focus' in c) { c.focus(); c.postMessage({ type: 'open-chat', chatId }); return }
      }
      if (self.clients.openWindow) return self.clients.openWindow('/')
    }),
  )
})
