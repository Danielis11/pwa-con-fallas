// Service Worker de Ruta SG. Al cambiar cualquier archivo del shell, sube VERSION.
importScripts('js/db.js'); // misma capa IndexedDB que usa la página (para Background Sync)

const VERSION = 'v14';
const CACHE_SHELL = 'shell-' + VERSION;
const CACHE_DATOS = 'datos-' + VERSION;
const CACHE_RECURSOS = 'recursos-' + VERSION;
const CACHES_VIGENTES = [CACHE_SHELL, CACHE_DATOS, CACHE_RECURSOS];

// App shell: estructura fija que debe abrir sin red desde la primera visita
const SHELL = [
  './',
  'index.html',
  'offline.html',
  'manifest.json',
  'data/destinos.json',
  'css/estilos.css',
  'js/app.js',
  'js/db.js',
  'js/dispositivo.js',
  'js/notificaciones.js',
  'img/icons/icon-192.png',
  'img/icons/icon-512.png',
];

// ---------- Ciclo de vida ----------
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_SHELL).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(claves => Promise.all(
        claves.filter(k => !CACHES_VIGENTES.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim()) // toma control de las pestañas ya abiertas
  );
});

// ---------- Estrategias de caché ----------
// Cache First: shell y recursos que casi no cambian
async function cacheFirst(peticion) {
  const enCache = await caches.match(peticion);
  return enCache || fetch(peticion);
}

// Network First: datos que cambian; si no hay red, la última copia guardada
async function networkFirst(peticion, nombreCache) {
  try {
    const respuesta = await fetch(peticion);
    if (respuesta.ok) {
      const cache = await caches.open(nombreCache);
      cache.put(peticion, respuesta.clone());
    }
    return respuesta;
  } catch (err) {
    const enCache = await caches.match(peticion, { ignoreSearch: true });
    if (enCache) return marcarDesdeCache(enCache);
    throw err;
  }
}

// Copia la respuesta guardada con un encabezado extra, para que la página sepa que no vino de la red
async function marcarDesdeCache(respuesta) {
  const encabezados = new Headers(respuesta.headers);
  encabezados.set('X-Origen', 'cache-sw');
  return new Response(await respuesta.blob(), {
    status: respuesta.status,
    statusText: respuesta.statusText,
    headers: encabezados,
  });
}

// Stale-While-Revalidate: responde ya con la caché y la actualiza en segundo plano
async function staleWhileRevalidate(peticion, nombreCache) {
  const cache = await caches.open(nombreCache);
  const enCache = await cache.match(peticion);
  const desdeRed = fetch(peticion)
    .then(respuesta => {
      if (respuesta.ok) cache.put(peticion, respuesta.clone());
      return respuesta;
    })
    .catch(() => enCache);
  return enCache || desdeRed;
}

self.addEventListener('fetch', e => {
  const peticion = e.request;
  const url = new URL(peticion.url);

  // Solo GET del mismo origen; lo demás (POST de reseñas, APIs externas) pasa directo a la red
  if (peticion.method !== 'GET' || url.origin !== self.location.origin) return;

  // 1) Navegación (abrir una página): Network First → copia guardada → offline.html
  if (peticion.mode === 'navigate') {
    e.respondWith(
      networkFirst(peticion, CACHE_DATOS).catch(() => caches.match('offline.html'))
    );
    return;
  }
  // 2) Datos (JSON del catálogo y API): Network First
  if (url.pathname.includes('/data/') || url.pathname.includes('/api/')) {
    e.respondWith(networkFirst(peticion, CACHE_DATOS));
    return;
  }
  // 3) Archivos del shell: Cache First
  const ruta = url.pathname.replace(new URL('./', self.location).pathname, '');
  if (SHELL.includes(ruta)) {
    e.respondWith(cacheFirst(peticion));
    return;
  }
  // 4) Todo lo demás (imágenes, scripts de fichas SSR, etc.): Stale-While-Revalidate
  e.respondWith(staleWhileRevalidate(peticion, CACHE_RECURSOS));
});

// ---------- Sincronización en segundo plano ----------
self.addEventListener('sync', e => {
  if (e.tag === 'enviar-resenas') {
    e.waitUntil(
      RutaDB.sincronizarResenas().then(async enviadas => {
        if (enviadas > 0) {
          // .catch: si el usuario no dio permiso de notificaciones, el envío ya se hizo igual
          await self.registration.showNotification('Reseñas enviadas', {
            body: `Se enviaron ${enviadas} reseña(s) que escribiste sin conexión.`,
            icon: 'img/icons/icon-192.png',
          }).catch(() => {});
          const ventanas = await self.clients.matchAll({ type: 'window' });
          ventanas.forEach(v => v.postMessage({ tipo: 'resenas-enviadas', enviadas }));
        }
      })
    );
  }
});

// ---------- Notificaciones push ----------
self.addEventListener('push', e => {
  // El servidor manda JSON; el botón Push de DevTools manda texto simple: se aceptan ambos
  let datos = { titulo: 'Ruta SG', cuerpo: 'Tienes una novedad.' };
  if (e.data) {
    try { datos = e.data.json(); } catch { datos.cuerpo = e.data.text(); }
  }
  e.waitUntil(self.registration.showNotification(datos.title, {
    body: datos.body,
    icon: 'img/icons/icon-192.png',
    badge: 'img/icons/icon-192.png',
    data: { url: datos.url || './' },
  }));
});

// Al tocar la notificación: enfocar la app si ya está abierta, o abrirla
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const destino = new URL(e.notification.data?.url || './', self.location).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ventanas => {
      const abierta = ventanas.find(v => v.url.startsWith(new URL('./', self.location).href));
      if (abierta) {
        abierta.navigate(destino);
        return abierta.focus();
      }
      return self.clients.openWindow(destino);
    })
  );
});
