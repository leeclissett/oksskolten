// The app no longer ships a service worker. This file replaces the one that
// earlier versions registered at /sw.js: it clears their caches, unregisters
// itself and reloads open tabs so they load the current app from the network.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
    await self.registration.unregister()
    const clients = await self.clients.matchAll({ type: 'window' })
    clients.forEach((client) => client.navigate(client.url))
  })())
})
