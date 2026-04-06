self.addEventListener('fetch', e => {})

self.addEventListener('push', e => {
  let data = {}
  try { data = e.data?.json() } catch { data = { title: 'Clocks', body: e.data?.text() || '' } }
  self.registration.showNotification(data.title || 'Clocks Estudio', {
    body: data.body || '',
    icon: '/images/icon-192.png',
    badge: '/images/icon-192.png',
    data: { url: data.url || '/' }
  })
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(clients.openWindow(e.notification.data.url))
})
