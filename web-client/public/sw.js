/* Web Push + медиакэш service worker. Scope: / (served from the build root). */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

/* ---- Медиакэш (tweb CacheStorage 'cachedFiles') ----------------------------
 * Ответы /api/media/{id}/content складываются в caches со штампами
 * Content-Length/Time-Cached (как tweb cacheStorage.save) — по ним экран
 * «Данные и память» считает объём, а clearOldCache чистит по TTL/лимиту. */
const CACHED_FILES = 'cachedFiles'
const MEDIA_RE = /^\/api\/media\/\d+\/content$/

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
  if (url.origin !== self.location.origin || !MEDIA_RE.test(url.pathname)) return
  if (req.headers.has('range')) return // потоковое видео с Range — мимо кэша
  const key = mediaCacheKey(req.url)
  event.respondWith(
    caches.open(CACHED_FILES).then(async (cache) => {
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
    }),
  )
})

/* Очистка по TTL/лимиту размера (tweb serviceWorker/clearOldCache.ts).
 * Настройки приходят postMessage'ем из вкладки при старте и при изменении
 * (localStorage в SW недоступен). */
self.addEventListener('message', (event) => {
  const d = event.data
  if (d && d.type === 'cache-settings') {
    event.waitUntil(clearOldCache(d.cacheTTL | 0, d.cacheSize || 0))
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
