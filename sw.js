// Service Worker — LexGuard
// Auto-elimina versiones antiguas en todos los navegadores

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => {
        self.clients.matchAll({ type: 'window' }).then(clients =>
          clients.forEach(c => c.navigate(c.url))
        );
      })
  );
});
