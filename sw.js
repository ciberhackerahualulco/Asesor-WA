/* Asesora X WhatsApp - Offline First v38, revisión de estabilidad.
   Almacena SOLO recursos estáticos, nunca los datos, Excel importados, mensajes o respaldos.
   Primer uso: visita el sitio con una conexión permitida para instalar y preparar los archivos.
*/
'use strict';
const SHELL_CACHE = 'asesora-x-shell-v38-offers-inline-1';
const VENDOR_CACHE = 'asesora-x-sheetjs-v1';
const APP_CACHE_PREFIX = 'asesora-x-shell-';
const SCOPE = self.registration.scope;
const APP_URL = new URL('index.html', SCOPE).href;
const MANIFEST_URL = new URL('manifest.json', SCOPE).href;
const ICONS = ['icons/icon-192.png', 'icons/icon-512.png'];
const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js';

async function getOfflineState() {
  const shell = await caches.open(SHELL_CACHE);
  const vendor = await caches.open(VENDOR_CACHE);
  return {
    type:'ASESORA_OFFLINE_STATUS',
    shellReady:!!(await shell.match(APP_URL)) && !!(await shell.match(MANIFEST_URL)),
    excelReady:!!(await vendor.match(SHEETJS_URL))
  };
}
async function notifyClient(client) {
  if (!client || !client.postMessage) return;
  client.postMessage(await getOfflineState());
}
async function prepareExcel() {
  const cache = await caches.open(VENDOR_CACHE);
  if (await cache.match(SHEETJS_URL)) return true;
  // El script clásico se solicita con no-cors; la respuesta opaca puede guardarse.
  const request = new Request(SHEETJS_URL, {mode:'no-cors',credentials:'omit'});
  const aborter=new AbortController();
  const timer=setTimeout(() => aborter.abort(), 12000);
  try {
    const response = await fetch(new Request(request,{signal:aborter.signal}));
    if (!response || (!response.ok && response.type !== 'opaque')) throw new Error('SheetJS no disponible');
    await cache.put(request, response.clone());
    return true;
  } finally { clearTimeout(timer); }
}
async function validAppPage(response) {
  if (!response || !response.ok || response.type === 'opaque') return false;
  const html = await response.clone().text();
  // Evitar guardar una página de inicio de sesión de un proxy/captive portal.
  return html.includes('<title>Asesora X WhatsApp</title>') &&
         /<meta name="app-version" content="\d+">/.test(html);
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const page = await fetch(new Request(APP_URL,{cache:'reload'}));
    if (!await validAppPage(page)) throw new Error('HTML principal no valido');
    const manifest = await fetch(new Request(MANIFEST_URL,{cache:'reload'}));
    if (!manifest.ok || (await manifest.clone().json()).name !== 'Asesora X WhatsApp') {
      throw new Error('Manifiesto no valido');
    }
    await cache.put(APP_URL,page.clone());
    await cache.put(MANIFEST_URL,manifest.clone());
    await Promise.all(ICONS.map(async p => {
      try {await cache.add(new URL(p,SCOPE).href);} catch (_) {}
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(APP_CACHE_PREFIX) && k !== SHELL_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  const d = event.data || {};
  if (d.type !== 'OFFLINE_STATUS' && d.type !== 'PREPARE_OFFLINE') return;
  event.waitUntil((async () => {
    if (d.type === 'PREPARE_OFFLINE') {
      try { await prepareExcel(); } catch (_) { /* interfaz sigue offline aunque Excel no se guarde */ }
    }
    await notifyClient(event.source);
  })());
});
async function cacheVersionIfAvailable(request) {
  try {
    const response = await fetch(request);
    if (await validAppPage(response)) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(APP_URL, response.clone());
      return response;
    }
  } catch (_) {}
  const cache = await caches.open(SHELL_CACHE);
  return (await cache.match(APP_URL)) || Response.error();
}
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Única dependencia externa en caché: la librería de Excel (sin datos de clientes).
  if (url.href === SHEETJS_URL) {
    event.respondWith((async () => {
      const cache = await caches.open(VENDOR_CACHE);
      const saved = await cache.match(SHEETJS_URL);
      if (saved) return saved;
      try {
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') await cache.put(SHEETJS_URL, response.clone());
        return response;
      } catch (_) { return Response.error(); }
    })());
    return;
  }
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;
  // La consulta de versiones usa cache:no-store: intenta red y actualiza la copia.
  if (url.href === APP_URL && request.cache === 'no-store') {
    event.respondWith(cacheVersionIfAvailable(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const saved = await cache.match(APP_URL);
      if (saved) return saved;
      return cacheVersionIfAvailable(request);
    })());
    return;
  }
  const staticAsset = url.href === APP_URL || url.href === MANIFEST_URL || ICONS.some(p => url.href === new URL(p,SCOPE).href);
  if (!staticAsset) return;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const saved = await cache.match(request);
    if (saved) return saved;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
      return response;
    } catch (_) {return Response.error();}
  })());
});
