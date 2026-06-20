/* Operation HQ push service worker. Push + notification click only — no fetch
   handler, so it never interferes with the app's normal networking. */
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = {} }
  const title = data.title || 'Operation HQ'
  const body = data.body || ''
  const url = data.url || '/hq'
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url },
      tag: 'hq-brief',
      renotify: true,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/hq'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes('/hq') && 'focus' in w) return w.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
