SW.JS: const CACHE_NAME = 'qrpido-cache-v3'; // Subimos versión para limpiar el caché roto de los usuarios
const MAP_CACHE_NAME = 'qrpido-map-tiles-v1';
const MAX_MAP_TILES = 500;

// Lista limpia: Eliminamos Leaflet ya que ahora usas MapLibre nativo
const urlsToCache = [
    '/',
    '/index.html',
    '/negocio.html',
    '/inmueble.html',
    '/admin.html',
    '/pulso.html',
    '/offline.html',
    '/maplibre-gl.css',
    '/maplibre-gl.js',
    '/pmtiles.js',
    '/estilo-fresco.json',
    'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
];

async function trimCache(cacheName, maxItems) {
    try {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        if (keys.length > maxItems) {
            await cache.delete(keys[0]);
            await trimCache(cacheName, maxItems);
        }
    } catch (err) {
        console.warn('Error limpiando caché de mapas:', err);
    }
}

// Instalación
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
    );
});

// Activación y limpieza profunda
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME && cacheName !== MAP_CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim()) 
    );
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // =================================================================
    // 🛑 1. BYPASS CRÍTICO: Archivos de Rango de Bytes (PMTiles)
    // =================================================================
    // Si la petición es para el mapa masivo, el Service Worker se hace a un 
    // lado y deja que el navegador procese los bytes nativamente.
    if (url.pathname.endsWith('.pmtiles')) {
        return; 
    }

    // =================================================================
    // === 2. APP SHELL (HTML/JS/CSS): STALE-WHILE-REVALIDATE
    // =================================================================
    if (event.request.method === 'GET') {
        event.respondWith(
            caches.match(event.request, { ignoreSearch: true }).then(cachedResponse => {
                const fetchPromise = fetch(event.request).then(networkResponse => {
                    if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request.url.split('?')[0], networkResponse.clone());
                        });
                    }
                    return networkResponse;
                });

                return cachedResponse || fetchPromise.catch(() => {
                    if (event.request.url.includes('.json') || event.request.headers.get('accept').includes('application/json')) {
                        return new Response(JSON.stringify([]), { 
                            headers: { 'Content-Type': 'application/json' } 
                        });
                    }
                    
                    if (event.request.mode === 'navigate' || event.request.headers.get('accept').includes('text/html')) {
                        return caches.match('/offline.html');
                    }
                });
            })
        );
    }
});