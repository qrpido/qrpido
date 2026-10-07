const CACHE_NAME = 'geokatu-cache-v6';
const MAP_CACHE_NAME = 'geokatu-map-tiles-v1';

// Módulos esenciales de la arquitectura GEOKATU
const urlsToCache = [
    '/',
    '/oficina',
    '/oficina.html',
    '/metricas',
    '/metricas.html',
    '/metricas.js',
    '/pos',
    '/pos.html',
    '/pos.js',
    '/posven',
    '/posven.html',
    '/posven.js',
    '/estilos-pos.css',
    '/factura',
    '/factura.html',
    '/facturaven',
    '/facturaven.html',
    '/cajon-motor.js',
    '/balanza-motor.js',
    '/stock',
    '/stock.html',
    '/inventario',
    '/inventario.html',
    '/mapatienda',
    '/mapatienda.html',
    '/negocio',
    '/negocio.html',
    '/manifest.json',
    '/estilo-fresco.json',
    '/catalogo_matriz.json',
    '/maplibre-gl.css',
    '/maplibre-gl.js',
    '/pmtiles.js',
    '/html5-qrcode.min.js',
    '/admin-boveda.css',
    '/ui-estilos.css',
    '/pines.css',
    '/negocio.css',
    '/core-db.js',
    '/firebase-config.js',
    '/billing-guard.js',
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
                    console.warn(`[SW Precache Omitido]: ${url} no se pudo precargar.`);
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
                        console.log(`[SW] Purgando cache antiguo: ${cacheName}`);
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
        return;
    }

    // 2. Estrategia Stale-While-Revalidate con Fallback de Navegación
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
                    // Fallback para APIs o peticiones de datos JSON fuera de línea
                    if (event.request.headers.get('accept')?.includes('application/json') || url.pathname.endsWith('.json')) {
                        return new Response(JSON.stringify({ offline: true, data: [] }), { 
                            headers: { 'Content-Type': 'application/json' } 
                        });
                    }

                    // Fallback para navegación de páginas HTML
                    if (event.request.mode === 'navigate') {
                        const cleanPath = url.pathname;
                        return caches.match(cleanPath, { ignoreSearch: true })
                            .then(pageMatch => pageMatch || caches.match('/'));
                    }
                });

                return cachedResponse || fetchPromise;
            })
        );
    }
});


