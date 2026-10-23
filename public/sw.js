/**
 * GEOKATU SERVICE WORKER - ARQUITECTURA OFFLINE-FIRST Y VECTORIAL
 * Versión: geokatu-cache-v7
 * Soporte: PMTiles (Range Requests), Matriz Comercial y URLs Limpias
 */

const CACHE_NAME = 'geokatu-cache-v9';
const MAP_CACHE_NAME = 'geokatu-map-tiles-v2';

// 1. Módulos esenciales del ecosistema GEOKATU (Cero 404, precarga inmediata)
const urlsToCache = [
    '/',
    '/oficina',
    '/oficina.html',
    '/oficina.js',
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
    '/lector-motor.js',
    '/stock',
    '/stock.html',
    '/inventario',
    '/inventario.html',
    '/inventario.js',
    '/mapatienda',
    '/mapatienda.html',
    '/negocio',
    '/negocio.html',
    '/manifest.json',
    '/estilo-fresco.json',
    '/catalogo_matriz.json',
    '/directorio_matriz.json',
    '/maplibre-gl.css',
    '/maplibre-gl.js',
    '/pmtiles.js',
    '/html5-qrcode.min.js',
    '/qrcode.min.js',
    '/admin-boveda.css',
    '/ui-estilos.css',
    '/pines.css',
    '/negocio.css',
    '/mapatienda.css',
    '/inventario.css',
    '/core-db.js',
    '/auth-gate.js',
    '/firebase-config.js',
    '/billing-guard.js',
    '/motor-mapa.js',
    '/motor-movilidad.js',
    '/profiler.js'
];

// Instalación atómica y tolerante a fallos
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

// Activación y depuración de cachés antiguos
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

// Interceptor de tráfico de red
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Bypass obligatorio para Firestore, Auth y llamadas de metadatos de Firebase Storage (evita corromper imagenes con el JSON de getDownloadURL)
    if (
        url.hostname.includes('firestore.googleapis.com') ||
        url.hostname.includes('identitytoolkit') ||
        url.hostname.includes('securetoken.googleapis.com') ||
        url.hostname.includes('firebasestorage.googleapis.com')
    ) {
        return;
    }


    // A. ESTRATEGIA PARA MAPAS VECTORIALES (PMTILES CON HTTP RANGE REQUESTS)
    if (url.pathname.endsWith('.pmtiles')) {
        event.respondWith(
            caches.open(MAP_CACHE_NAME).then(async mapCache => {
                // Generar clave de fragmento por rango de bytes
                const rangeHeader = event.request.headers.get('range') || 'bytes=all';
                const cacheKey = new Request(event.request.url + '&range=' + rangeHeader);

                const cachedFragment = await mapCache.match(cacheKey);
                if (cachedFragment) {
                    return cachedFragment;
                }

                try {
                    const networkResponse = await fetch(event.request);
                    if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 206)) {
                        mapCache.put(cacheKey, networkResponse.clone());
                    }
                    return networkResponse;
                } catch (err) {
                    // Si está offline y no tiene ese cuadrante específico, retornar respuesta vacía sin romper el mapa
                    return new Response(new ArrayBuffer(0), { status: 204, statusText: 'Tile Offline No Disponible' });
                }
            })
        );
        return;
    }

    // B. ESTRATEGIA STALE-WHILE-REVALIDATE PARA APP, SCRIPTS Y MATRICES JSON
    if (event.request.method === 'GET') {
        event.respondWith(
            caches.match(event.request, { ignoreSearch: true }).then(cachedResponse => {
                const fetchPromise = fetch(event.request).then(networkResponse => {
                    if (networkResponse && networkResponse.status === 200 && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request.url.split('?')[0], responseToCache);
                        });
                    }
                    return networkResponse;
                }).catch(() => {
                    }).catch(() => {
                    // Fallback exclusivo para catalogo_matriz.json (jamas mezclar con catalogo_base.json de tiendas)
                    if (url.pathname.endsWith('/catalogo_matriz.json')) {
                        return caches.match('/catalogo_matriz.json');
                    }
                    if (url.pathname.endsWith('/directorio_matriz.json')) {
                        return caches.match('/directorio_matriz.json');
                    }
                    if (event.request.headers.get('accept')?.includes('application/json') || url.pathname.endsWith('.json')) {
                        return new Response(JSON.stringify({ offline: true, p: [], data: [] }), {
                            status: 503,
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }

                    // Fallback para navegación entre páginas HTML (URLs limpias sin .html)
                    if (event.request.mode === 'navigate') {
                        const cleanPath = url.pathname;
                        return caches.match(cleanPath, { ignoreSearch: true })
                            .then(pageMatch => pageMatch || caches.match(cleanPath + '.html', { ignoreSearch: true }))
                            .then(extMatch => extMatch || caches.match('/'));
                    }
                });

                return cachedResponse || fetchPromise;
            })
        );
    }
});


