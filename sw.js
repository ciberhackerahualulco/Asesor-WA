// Versión de caché: súbela (v6, v7...) cada vez que cambies la app.
const CACHE_NAME = 'asesora-wa-v5';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Librería de Excel usada por index.html (se guarda para funcionar sin internet)
const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Cada archivo se precarga por separado: si uno falla, los demás igual se guardan
    await Promise.all(APP_SHELL.map(url => cache.add(url).catch(() => {})));

    // El CDN puede no permitir CORS; se pide en modo no-cors (respuesta opaca, pero utilizable por <script>)
    try {
      const res = await fetch(XLSX_URL, { mode: 'no-cors' });
      await cache.put(XLSX_URL, res);
    } catch (e) { /* sin conexión durante la instalación: se reintentará en la siguiente carga */ }
  })().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // App propia: red primero (para recibir cambios), caché si no hay conexión
    event.respondWith(networkFirst(req));
  } else if (url.href === XLSX_URL) {
    // Librería de Excel: caché primero (no cambia)
    event.respondWith(cacheFirst(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response('Sin conexión', { status: 503, statusText: 'Offline' });
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  } catch (e) {
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}
