const CACHE_NAME = 'qrpido-cache-v2'; // Subí la versión para forzar la actualización

const MAP_CACHE_NAME = 'qrpido-map-tiles-v1';

const MAX_MAP_TILES = 500;



// Lista corregida y sin errores de sintaxis

const urlsToCache = [

'/',

'/index.html',

'/negocio.html',

'/inmueble.html',

'/admin.html',

'/pulso.html',
'/offline.html',

'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css',

'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',

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

// force waiting SW to become active immediately

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

// Si el nombre del caché no es el actual, lo exterminamos

if (cacheName !== CACHE_NAME && cacheName !== MAP_CACHE_NAME) {

return caches.delete(cacheName);

}

})

);

}).then(() => self.clients.claim()) // Toma el control de la página inmediatamente

);

});



self.addEventListener('fetch', event => {

const url = new URL(event.request.url);



// =================================================================

// === 1. MAPAS: ESTRATEGIA CACHÉ PRIMERO (Ahorro de Ancho de Banda)

// =================================================================

if (url.hostname === 'tiles.stadiamaps.com') {

event.respondWith(

caches.match(event.request).then(cachedResponse => {

if (cachedResponse) return cachedResponse;



return fetch(event.request).then(networkResponse => {

if (!networkResponse || networkResponse.status !== 200 || (networkResponse.type !== 'basic' && networkResponse.type !== 'cors')) {

return networkResponse;

}


const responseToCache = networkResponse.clone();

caches.open(MAP_CACHE_NAME).then(cache => {

cache.put(event.request, responseToCache);

// Limitamos los tiles para no saturar el almacenamiento del celular

trimCache(MAP_CACHE_NAME, MAX_MAP_TILES);

});


return networkResponse;

}).catch(() => {

console.warn("Offline: No se pudo descargar el tile del mapa");

});

})

);

return;

}



// =================================================================

// === 2. APP SHELL (HTML/JS/CSS): STALE-WHILE-REVALIDATE

// =================================================================

// Carga ultra rápida offline, pero se actualiza en silencio para la próxima vez

if (event.request.method === 'GET') {

event.respondWith(

caches.match(event.request, { ignoreSearch: true }).then(cachedResponse => {


// Promesa para ir a buscar la versión más fresca a internet

const fetchPromise = fetch(event.request).then(networkResponse => {

// Solo guardamos en caché si la respuesta es válida y nuestra

if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {

caches.open(CACHE_NAME).then(cache => {

// ignoreSearch es clave aquí para que negocio.html?id=X actualice el HTML base

cache.put(event.request.url.split('?')[0], networkResponse.clone());

});

}

return networkResponse;

}); // Cerramos el then() del fetchPromise

        // Retornamos el caché inmediatamente si existe, o esperamos la red con un salvavidas
        return cachedResponse || fetchPromise.catch(() => {
            // 1. Si la app pidió un JSON estático y no hay red ni caché, devolvemos un array vacío.
            // Así el JavaScript no explota por un "Failed to fetch" o errores de JSON.parse.
            if (event.request.url.includes('.json') || event.request.headers.get('accept').includes('application/json')) {
                return new Response(JSON.stringify([]), { 
                    headers: { 'Content-Type': 'application/json' } 
                });
            }
            
            // 2. Si el usuario intentó navegar a una página HTML y no hay red ni caché, 
            // le mostramos la pantalla de emergencia.
            if (event.request.mode === 'navigate' || event.request.headers.get('accept').includes('text/html')) {
                return caches.match('/offline.html');
            }
        });


})

);

}

});
