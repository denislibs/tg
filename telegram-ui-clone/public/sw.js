/* Web Push service worker. Scope: / (served from the build root). */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

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
