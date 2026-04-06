self.addEventListener('fetch', e => {})

self.addEventListener('push', e => {
  const data = e.data?.json() || {}
  self.registration.showNotification(data.title || 'Clocks Estudio', {
    body: data.body || 'Tienes una cita próximamente',
    icon: '/images/icon-192.png',
    badge: '/images/icon-192.png',
    data: { url: data.url || '/' }
  })
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(clients.openWindow(e.notification.data.url))
})
