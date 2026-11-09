// Service worker: permite usar la app sin internet y que abra rápido aunque la señal sea mala.
const CACHE = 'budget-control-v9';
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
const SUPABASE_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap';

// Cuánto esperamos a la red antes de usar la copia guardada.
const NET_TIMEOUT = 2500;
// Si la página tardó en llegar, el resto de sus archivos sale directo de la copia guardada
// durante este tiempo (y se actualiza por detrás), para no esperar otra vez archivo por archivo.
const SLOW_WINDOW = 15000;
let slowUntil = 0;

self.addEventListener('install', event => {
  // Se guarda cada archivo por separado: si falta uno, los demás sí quedan disponibles sin internet.
  event.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all([
        ...ASSETS.concat(SUPABASE_LIB).map(u => c.add(u).catch(() => null)),
        fetch(FONTS_CSS, { mode: 'no-cors' }).then(r => c.put(FONTS_CSS, r)).catch(() => null)
      ]))
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

function saveCopy(req, res) {
  if (res && (res.ok || res.type === 'opaque')) {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => null);
  }
  return res;
}

// Copia guardada al instante; si no hay, se pide a la red. (Para lo que nunca cambia:
// la librería de Supabase tiene versión fija y las fuentes de Google tampoco cambian.)
function cacheFirst(event) {
  return caches.match(event.request).then(hit => hit || fetch(event.request).then(res => saveCopy(event.request, res)));
}

// Archivos propios: primero la red (para recibir actualizaciones), pero sin esperarla más de
// NET_TIMEOUT. Si tarda, se usa la copia guardada y la descarga sigue por detrás para la próxima vez.
function networkFirst(event, isPage) {
  const req = event.request;
  const net = fetch(req).then(res => saveCopy(req, res));
  event.waitUntil(net.catch(() => null));
  const fallback = () => caches.match(req).then(r => r || (isPage ? caches.match('./index.html') : undefined));

  if (!isPage && Date.now() < slowUntil) {
    return fallback().then(r => r || net);
  }
  return new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => {
      fallback().then(r => {
        if (!r) return; // no hay copia: seguir esperando a la red
        if (isPage) slowUntil = Date.now() + SLOW_WINDOW;
        finish(r);
      });
    }, NET_TIMEOUT);
    net.then(res => { clearTimeout(timer); finish(res); })
      .catch(() => {
        clearTimeout(timer);
        if (isPage) slowUntil = Date.now() + SLOW_WINDOW;
        fallback().then(r => { if (r) finish(r); else if (!done) { done = true; resolve(Response.error()); } });
      });
  });
}

// Las llamadas a Supabase y otras APIs van directo, sin pasar por aquí.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(event, req.mode === 'navigate'));
    return;
  }
  const isLib = url.href.startsWith('https://cdn.jsdelivr.net/npm/@supabase/supabase-js');
  const isFont = url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com';
  if (isLib || isFont) event.respondWith(cacheFirst(event));
});
