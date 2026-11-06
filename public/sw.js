/**
 * GEOKATU SERVICE WORKER - ARQUITECTURA OFFLINE-FIRST Y VECTORIAL
 * Versión: geokatu-cache-v16-unificacion
 * Soporte: PMTiles (Range Requests), Matriz Comercial y URLs Limpias
 */

const CACHE_NAME = 'geokatu-cache-v16-unificacion';
const MAP_CACHE_NAME = 'geokatu-map-tiles-v3';

// 1. Módulos esenciales del ecosistema GEOKATU (Cero 404, precarga inmediata)
const urlsToCache = [
    '/', '/negocio', '/negocio.html', '/negocio.css', '/catalogo-experiencia.css',
    '/catalogo-experiencia.js', '/branding-cuarzos.js', '/arranque-geokatu.js',
    '/marca-geokatu.svg', '/onboarding-core.js', '/estudio-imagen-universal.js', '/core-db.js', '/firebase-config.js', '/motor-mapa.js',
    '/auth-mando.js', '/profiler.js', '/ui-estilos.css', '/pines.css', '/maplibre-gl.js', '/maplibre-gl.css', '/pmtiles.js', '/estilo-fresco.json', '/operaciones-integridad.js',
    ...['app','firestore','auth','analytics','storage','database','functions','app-check'].map(name =>
        'https://www.gstatic.com/firebasejs/10.8.0/firebase-' + name + '.js')
];

// Instalación atómica y tolerante a fallos
self.addEventListener('install', event => {
    // La nueva versión toma el control en la próxima sesión sin pestañas de la versión anterior, sin mezclar módulos abiertos.
    event.waitUntil(
        caches.open(CACHE_NAME).then(async cache => {
            // Cuatro descargas simultáneas: sin bloquear una detrás de otra.
            const pendientes = urlsToCache.slice();
            await Promise.all(Array.from({length: 4}, async () => {
              while (pendientes.length) {
                const url = pendientes.shift();
                try {
                    await cache.add(url);
                } catch (err) {
                    console.warn(`[SW Precache Omitido]: ${url} no se pudo precargar.`);
                }
              }
            }));
        })
    );
});

// Activación y depuración de cachés antiguos
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(async cacheNames => {
            const actual = await caches.open(CACHE_NAME);
            // Conserva recursos visitados. No toca IndexedDB, pedidos ni cachés ajenas.
            for (const name of cacheNames.filter(n => n.startsWith('geokatu-cache-') && n !== CACHE_NAME)) {
                const anterior = await caches.open(name);
                for (const req of await anterior.keys()) {
                    if (!(await actual.match(req))) {
                        const response = await anterior.match(req);
                        if (response) await actual.put(req, response);
                    }
                }
                await caches.delete(name);
            }
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
        (url.hostname.includes('firebasestorage.googleapis.com') && url.searchParams.get('alt') !== 'media')
    ) {
        return;
    }


    // A. ESTRATEGIA PARA MAPAS VECTORIALES (PMTILES CON HTTP RANGE REQUESTS)
    if (url.pathname.endsWith('.pmtiles')) {
        event.respondWith(
            caches.open(MAP_CACHE_NAME).then(async mapCache => {
                // Generar clave de fragmento por rango de bytes
                const rangeHeader = event.request.headers.get('range') || 'bytes=all';
                const keyURL = new URL(event.request.url);
                keyURL.searchParams.set('__gk_range', rangeHeader);
                const cacheKey = new Request(keyURL.href);
                const cachedFragment = await mapCache.match(cacheKey);
                if (cachedFragment) {
                    const headers = new Headers(cachedFragment.headers);
                    const status = Number(headers.get('x-gk-range-status') || 200);
                    headers.delete('x-gk-range-status');
                    return new Response(cachedFragment.body, {status, headers});
                }
                try {
                    const response = await fetch(event.request);
                    if (response.status === 200 || response.status === 206) {
                        const copy = response.clone();
                        const save = (async () => {
                            const headers = new Headers(copy.headers);
                            headers.set('x-gk-range-status', String(copy.status));
                            // Cache Storage rechaza 206; se reconstruye al leer, con Content-Range intacto.
                            await mapCache.put(cacheKey, new Response(await copy.arrayBuffer(), {status:200, headers}));
                            const keys = await mapCache.keys();
                            if (keys.length > 1200) await mapCache.delete(keys[0]);
                        })().catch(() => {});
                        await save;
                    }
                    return response;
                } catch (err) {
                    return new Response('Esta zona no está descargada', {status:503});
                }
            })
        );
        return;
    }

    // Solo recursos públicos conocidos. Las consultas conservan su identidad completa.
    const publico = url.origin === self.location.origin ||
        (['geokatu.com','www.geokatu.com'].includes(url.hostname) && /^\/(fonts|sprites)\//.test(url.pathname)) ||
        (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) ||
        url.hostname === 'storage.googleapis.com' ||
        (url.hostname === 'firebasestorage.googleapis.com' && url.searchParams.get('alt') === 'media');
    if (event.request.method !== 'GET' || !publico || event.request.headers.has('authorization')) return;
    const key = event.request.mode === 'navigate'
        ? new Request(url.origin + (url.pathname === '/index.html' ? '/' : url.pathname))
        : event.request;
    // Registrar waitUntil durante el evento mantiene vivas las actualizaciones de fondo.
    const work = (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(key);
        const update = fetch(event.request).then(async response => {
            if (response.ok && response.status === 200 && response.type !== 'opaque') {
                try { await cache.put(key, response.clone()); } catch (_) {}
            }
            return response;
        }).catch(async () => {
            if (cached) return cached;
            if (event.request.mode === 'navigate') {
                const page = await cache.match(url.pathname + '.html');
                if (page) return page;
                return new Response('Esta página aún no está descargada. Conéctate para abrirla por primera vez.',
                    {status:503, headers:{'Content-Type':'text/plain; charset=utf-8'}});
            }
            return new Response('Recurso no disponible sin conexión', {status:503});
        });
        return {response: cached || update, update};
    })();
    event.respondWith(work.then(result => result.response));
    event.waitUntil(work.then(result => result.update).then(() => undefined));
});
