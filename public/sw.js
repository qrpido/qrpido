const CACHE_NAME = 'geokatu-cache-v4';
const MAP_CACHE_NAME = 'geokatu-map-tiles-v1';

// Módulos esenciales de la arquitectura GEOKATU
const urlsToCache = [
    '/',
    '/oficina',
    '/pos',
    '/stock',
    '/inventario',
    '/mapatienda',
    '/negocio',
    '/manifest.json',
    '/estilo-fresco.json',
    '/catalogo_matriz.json',
    '/maplibre-gl.css',
    '/maplibre-gl.js',
    '/pmtiles.js',
    '/html5-qrcode.min.js',
    '/ui-estilos.css',
    '/pines.css',
    '/core-db.js',
    '/firebase-config.js',
    '/auth-mando.js',
    '/motor-mapa.js',
    '/motor-movilidad.js',
    '/profiler.js'
];

// Instalación resiliente: no colapsa el caché si un recurso estático falla
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            for (const url of urlsToCache) {
                try {
                    await cache.add(url);
                } catch (err) {
                    console.warn(`[SW Precaché Omitido]: ${url} no se pudo cargar.`);
                }
            }
        })
    );
});

// Activación y purga de versiones obsoletas
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME && cacheName !== MAP_CACHE_NAME) {
                        console.log(`[SW] Purgando caché antiguo: ${cacheName}`);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // 1. Bypass para mapas vectoriales pesados (.pmtiles) y streaming de Firebase/Google APIs
    if (
        url.pathname.endsWith('.pmtiles') ||
        url.hostname.includes('firestore.googleapis.com') ||
        url.hostname.includes('firebase') ||
        url.hostname.includes('identitytoolkit') ||
        url.hostname.includes('googleapis.com')
    ) {
        return; // Deja que el navegador o el SDK maneje su propia cola/caché
    }

    // 2. Estrategia Stale-While-Revalidate para App Shell local
    if (event.request.method === 'GET') {
        event.respondWith(
            caches.match(event.request, { ignoreSearch: true }).then(cachedResponse => {
                const fetchPromise = fetch(event.request).then(networkResponse => {
                    if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request.url.split('?')[0], responseToCache);
                        });
                    }
                    return networkResponse;
                }).catch(() => {
                    // Fallback JSON si falla la red y se pedían datos
                    if (event.request.headers.get('accept')?.includes('application/json') || url.pathname.endsWith('.json')) {
                        return new Response(JSON.stringify({ offline: true, data: [] }), { 
                            headers: { 'Content-Type': 'application/json' } 
                        });
                    }
                });

                return cachedResponse || fetchPromise;
            })
        );
    }
});


