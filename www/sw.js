const CACHE_NAME = 'love-alarm-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// Background alarm notification
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'ALARM_TRIGGER') {
    self.registration.showNotification('Love Alarm ♥', {
      body: e.data.label || '알람이 울리고 있습니다',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [800, 400, 800, 400, 800],
      tag: 'love-alarm',
      requireInteraction: true,
      actions: [
        { action: 'dismiss', title: '끄기' },
        { action: 'snooze', title: '5분 후' }
      ]
    });
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      const action = e.action;
      clients.forEach(client => {
        client.postMessage({ type: 'ALARM_ACTION', action });
      });
      if (clients.length === 0) {
        self.clients.openWindow('/');
      }
    })
  );
});
