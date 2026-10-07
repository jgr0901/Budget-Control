// Service worker: permite usar la app sin internet una vez instalada.
const CACHE = 'budget-control-v3';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './cloud.js',
  './cloud-config.js',
  './manifest.webmanifest',
  './logo.png',
  './icon-64.png',
  './icon-192.png',
  './icon-512.png'
];
const SUPABASE_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

self.addEventListener('install', event => {
  // Se guarda cada archivo por separado: si falta uno, los demás sí quedan disponibles sin internet.
  event.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.concat(SUPABASE_LIB).map(u => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Archivos propios y la librería de Supabase: primero red (para recibir actualizaciones),
// si no hay internet se usa la copia guardada. Las llamadas a Supabase y APIs van directo.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isOwn = url.origin === self.location.origin;
  const isLib = url.href.startsWith('https://cdn.jsdelivr.net/npm/@supabase/supabase-js');
  if (!isOwn && !isLib) return;
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || (isOwn ? caches.match('./index.html') : undefined)))
  );
});
