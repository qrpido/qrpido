import QRpidoDB from './core-db.js';
import { db } from './firebase-config.js'; 
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
 // 🌸 PROTOCOLO NIEVES
// === EL RESTO DE TU CÓDIGO (VARIABLES Y LÓGICA DEL MAPA) ===
let mapa, capaBase, capaRadar;
// === TORNIQUETE FINANCIERO FIREBASE ===
let ultimoCentroFetch = null;
let debounceFirebase = null;
let marcadoresActivos = {}; // Para no duplicar pines
let dbDirectorio = [], dbDirectorioMap = new Map();
let dbTroya = [];
let datosDescargados = false;
let cajaFuerteEspacial = null;
let zonaNecesitaDescarga = false;
let miUbicacionMarker = null;
window.marcadoresRadar = {};
window.sanitizarTexto = function(texto) {
if (texto === null || texto === undefined) return '';
const div = document.createElement('div');
div.textContent = texto;
return div.innerHTML;
};
// === MÓDULO DESEMPAQUETADO UI (GENOMA) ===
window.decodificarGenoma = function(uiPack) {
if (!uiPack || uiPack.length < 16) return null;
const f = uiPack[0]; // Forma geométrica / Animación
const codigoBase62 = uiPack.substring(1, 14); // Los 3 colores comprimidos
// Decodificación de Base62 a Hexadecimal
const base = BigInt(62);
let num = 0n;
for (let i = 0; i < codigoBase62.length; i++) {
num = num * base + BigInt("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".indexOf(codigoBase62[i]));
}
let hexRes = num.toString(16).padStart(18, '0');
return {
forma: `pin-${f}`,
c1: "#" + hexRes.substring(0, 6),
c2: "#" + hexRes.substring(6, 12),
c3: "#" + hexRes.substring(12, 18),
abre: uiPack[14],
cierra: uiPack[15]
};
};
// === MÓDULO DE FORMATO MONETARIO ===
// === MÓDULO DE FORMATO MONETARIO ===
window.formatearMoneda = function(valorInt64, moneda = 'COP') {
if (!valorInt64 || isNaN(valorInt64)) return moneda === 'USD' ? '$0.00' : '$0';
const valor = parseInt(valorInt64, 10);
if (moneda === 'USD') {
return (valor / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
return '$' + valor.toLocaleString('es-CO');
};
window.registrarClicVerDetalles = function(codigo, nicho) {
QRpidoDB.LocalService.registrarEventoAnalytics('clic_ver_negocio', { id_negocio: codigo, nicho: nicho });
};
// =================================================================
// 🛸 MOTOR DE INTERPOLACIÓN VECTORES (GPS FLUIDO A 60 FPS)
// =================================================================
window.animarPinFluido = function(marker, latDestino, lngDestino, duracionMs = 10000) {
    // 1. Si el pin ya se estaba moviendo, cancelamos la animación anterior para no cruzar cables
    if (marker._rafId) cancelAnimationFrame(marker._rafId);
    
    const posInicial = marker.getLatLng();
    const tiempoInicio = performance.now();


    function pasoAnimacion(tiempoActual) {
        // Calculamos qué porcentaje de la animación llevamos (de 0.0 a 1.0)
        let progreso = (tiempoActual - tiempoInicio) / duracionMs;
        if (progreso > 1) progreso = 1;


        // Ecuación lineal de movimiento (Vectorial)
        const latActual = posInicial.lat + (latDestino - posInicial.lat) * progreso;
        const lngActual = posInicial.lng + (lngDestino - posInicial.lng) * progreso;


        // Movemos el pin en el DOM
        marker.setLatLng([latActual, lngActual]);


        // Si no hemos llegado al 100%, pedimos el siguiente frame a la pantalla (60 FPS)
        if (progreso < 1) {
            marker._rafId = requestAnimationFrame(pasoAnimacion);
        }
    }
    
    // Disparamos el primer frame
    marker._rafId = requestAnimationFrame(pasoAnimacion);
};


// === LÓGICA DE HORARIOS BLINDADA ===
window.verificarHorarioOperativo = function(horaApertura, horaCierre) {
if (!horaApertura || !horaCierre || !horaApertura.includes(':') || !horaCierre.includes(':')) return true;
try {
const ahora = new Date();
const horaActual = ahora.getHours() * 60 + ahora.getMinutes();
const [hDesde, mDesde] = horaApertura.split(':').map(Number);
const [hHasta, mHasta] = horaCierre.split(':').map(Number);
if(isNaN(hDesde) || isNaN(mDesde) || isNaN(hHasta) || isNaN(mHasta)) return true;
const minDesde = hDesde * 60 + mDesde;
const minHasta = hHasta * 60 + mHasta;
if (minHasta < minDesde) {
return horaActual >= minDesde || horaActual <= minHasta;
} else {
return horaActual >= minDesde && horaActual <= minHasta;
}
} catch (e) { return true; }
};
window.toggleFavorito = function(id, nombre, precio, foto, whatsapp, event) {
if (event) { event.preventDefault(); event.stopPropagation(); }
if (navigator.vibrate) navigator.vibrate(30);
let favs = JSON.parse(localStorage.getItem('qrpido_favoritos_anon')) || [];
const index = favs.findIndex(x => x.id === id);
let isAdding = false;
if (index > -1) {
favs.splice(index, 1);
} else {
favs.push({ id, nombre, precio, foto, whatsapp });
isAdding = true;
QRpidoDB.LocalService.registrarEventoAnalytics('add_to_wishlist', { item_id: id, item_name: nombre });
}
localStorage.setItem('qrpido_favoritos_anon', JSON.stringify(favs));
if (event && event.target) {
const btn = event.target.closest('.btn-fav-popup, .btn-fav-card, .js-action-favorito');
if (!btn) return;
btn.style.animation = 'none';
requestAnimationFrame(() => {
requestAnimationFrame(() => {
btn.style.animation = 'saltoCorazon 0.6s ease-out forwards';
});
});
if (isAdding) {
btn.innerHTML = '❤️';
btn.style.background = 'rgba(255,68,68,0.2)';
btn.style.borderColor = '#ff4444';
} else {
btn.innerHTML = '🤍';
btn.style.background = 'rgba(0,0,0,0.6)';
btn.style.borderColor = 'rgba(255,255,255,0.2)';
}
}
if (typeof filtrandoFavoritos !== 'undefined' && filtrandoFavoritos && datosDescargados) {
const buscador = document.getElementById('input-buscador');
barridoRadar(buscador ? buscador.value : '');
}
};
window.abrirMisGuardados = function() {
const lista = document.getElementById('lista-favoritos');
let favs = JSON.parse(localStorage.getItem('qrpido_favoritos_anon')) || [];
lista.innerHTML = ''; // Limpiar el contenedor de forma segura
if (favs.length === 0) {
lista.innerHTML = '<p style="text-align:center; padding:20px; color:#888;">No tienes lugares guardados aún.</p>';
} else {
favs.forEach(f => {
// Construcción nativa del DOM (Blindaje anti-XSS)
const card = document.createElement('div');
card.className = "fav-card";
const h4 = document.createElement('h4');
h4.textContent = f.nombre; // textContent anula automáticamente scripts maliciosos
const img = document.createElement('img');
img.src = f.foto; // Blindado por el DOM nativo
const btnBorrar = document.createElement('button');
btnBorrar.textContent = '✖';
btnBorrar.onclick = (e) => {
if(window.toggleFavorito) {
window.toggleFavorito(f.id, null, null, null, null, e);
}
window.abrirMisGuardados();
};
card.append(img, h4, btnBorrar);
lista.appendChild(card);
});
}
if(window.abrirModal) {
window.abrirModal('modal-favoritos');
}
};
const categoriasEstaticas = [
{ id: 'negocios', nombre: 'Negocios', tipo: 'negocio' },
{ id: 'inmuebles', nombre: 'Inmuebles', tipo: 'inmueble', cta: 'Publica tu Inmueble' },
{ id: 'servicios', nombre: 'Servicios', tipo: 'servicio', cta: 'Ofrece tus Servicios' },
{ id: 'aliados', nombre: '🤝 Red Aliados', tipo: 'aliados', cta: 'Únete a la Red' },
{ id: 'pulso', nombre: 'PULSO', tipo: 'portal_externo', link: 'pulso.html' }
];
history.pushState(null, document.title, window.location.href);
window.addEventListener('popstate', function(event) {
let previnoSalida = false;
const modales = document.querySelectorAll('.bottom-sheet-overlay.activo');
if (modales.length > 0) { modales.forEach(m => m.classList.remove('activo')); previnoSalida = true; }
if (document.querySelector('.leaflet-popup')) { mapa.closePopup(); previnoSalida = true; }
const submenu = document.getElementById('submenu-llave');
if (submenu && submenu.classList.contains('activo')) { submenu.classList.remove('activo'); previnoSalida = true; }
if (previnoSalida) { history.pushState(null, document.title, window.location.href); }
else { if (confirm("¿Seguro que quieres salir de QRpido?")) { history.back(); } else { history.pushState(null, document.title, window.location.href); } }
});
const dbSimbologia = {
logo_portada: 'https://via.placeholder.com/220x80/0a0a0c/ff6b00?text=QRPIDO',
avatar_generico: 'https://via.placeholder.com/150/0a0a0c/ff6b00?text=Logo',
wallpaper_generico: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=1080',
pin_normal: 'https://via.placeholder.com/100/0a0a0c/ff6b00?text=Pin',
banner_noticias_generico: 'https://via.placeholder.com/600x300/0a0a0c/ff6b00?text=Promo'
};
function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
const R = 6371;
const dLat = (lat2 - lat1) * Math.PI / 180;
const dLon = (lon2 - lon1) * Math.PI / 180;
const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
window.obtenerDatosSemaforo = function(fechaIso) {
let color = '#FFD700'; let texto = '🟡 En mercado';
if (!fechaIso) return { color, texto };
const fecha = new Date(fechaIso);
if (isNaN(fecha)) return { color, texto };
const hoy = new Date();
const diffTime = Math.abs(hoy - fecha);
const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
if (diffDays <= 7) { color = '#00ff64'; texto = '🟢 Reciente'; }
else if (diffDays <= 21) { color = '#FFD700'; texto = '🟡 En mercado'; }
else if (diffDays <= 45) { color = '#ff4444'; texto = '🔴 Baja demanda'; }
else { color = '#555555'; texto = '⚫ Inactivo'; }
return { color, texto };
};
window.enfocarInmueble = function(codigo, lat, lng) {
mapa.flyTo([lat, lng], 16, { duration: 1.5 });
setTimeout(() => {
if (window.marcadoresRadar && window.marcadoresRadar[codigo]) {
window.marcadoresRadar[codigo].openPopup();
}
}, 1500);
};
window.arrancarMotor = async function() {
try {
if (typeof maplibregl === 'undefined') throw new Error("MapLibre no se descargó.");
construirMapa();

            setTimeout(() => {
                document.getElementById('pantalla-carga').style.opacity = '0';
                setTimeout(() => {
                    document.getElementById('pantalla-carga').style.display = 'none';
                    document.getElementById('wrapper-buscador').classList.remove('shimmer-box');
                    document.getElementById('contenedor-etiquetas').classList.remove('shimmer-box');
                    
                    // 🛸 MAGIA CINEMÁTICA: Detectamos si el usuario viene del Tinder de Inmuebles
                    const params = new URLSearchParams(window.location.search);
                    const idDron = params.get('enfocar');
                    const latDron = parseFloat(params.get('lat'));
                    const lngDron = parseFloat(params.get('lng'));


                    if (idDron && !isNaN(latDron) && !isNaN(lngDron)) {
                        // 1. Ajustamos el cerebro del mapa a modo 'inmuebles'
                        categoriaActivaGlobal = 'inmuebles';
                        document.querySelectorAll('#contenedor-etiquetas .tag-pill').forEach(p => {
                            p.classList.remove('activa');
                            if(p.innerText.toUpperCase().includes('INMUEBLES')) p.classList.add('activa');
                        });
                        
                        // 2. Ejecutamos la caída cinemática (Dron a 60 FPS)
                        mapa.flyTo([latDron, lngDron], 18, { duration: 2.5, easeLinearity: 0.25 });
                        
                        // 3. Forzamos al radar a escanear esa zona exacta al instante
                        zonaNecesitaDescarga = true;
                        if (window.descargarNegociosDeFirebase) window.descargarNegociosDeFirebase();


                        // 4. Calculamos el tiempo de impacto para abrir el popup de la casa justo al aterrizar
                        setTimeout(() => {
                            if (window.marcadoresRadar && window.marcadoresRadar[idDron]) {
                                window.marcadoresRadar[idDron].openPopup();
                            }
                        }, 2600); // 2.6 segundos (justo 100ms después de que termina el flyTo)


                        // 5. Borramos la URL silenciosamente para que no repita el vuelo si el usuario recarga la página
                        window.history.replaceState(null, '', window.location.pathname);
                    } else {
                        // Si no viene del Tinder, ejecutamos el inicio normal
                        iniciarTour(); 
                    }
                }, 500);
            }, 800);


try {
const { success, data } = await QRpidoDB.LocalService.obtenerCaballoTroya();
dbTroya = success && data ? data : [];
cargarCaballoTroya();
} catch (firebaseError) {
console.warn("Aviso: Iniciando en modo offline o sin banners.", firebaseError.message);
}
} catch (e) {
console.error("Error Crítico Motor:", e.message);
}
}
window.iniciarTour = function() {
if(localStorage.getItem('qrpido_tour_v10')) { solicitarGPSInicial(); return; }
document.body.classList.add('tour-active');
document.getElementById('wrapper-buscador').classList.add('tour-highlight-z');
const tooltip1 = document.getElementById('tour-step-1');
tooltip1.classList.add('activo');
}
window.siguienteTour1 = function() {
document.getElementById('wrapper-buscador').classList.remove('tour-highlight-z');
document.getElementById('tour-step-1').classList.remove('activo');
document.getElementById('btn-flotante-gps').classList.add('tour-highlight-z');
const tooltip2 = document.getElementById('tour-step-2');
tooltip2.classList.add('activo');
}
window.siguienteTour2 = function() {
document.getElementById('btn-flotante-gps').classList.remove('tour-highlight-z');
document.getElementById('tour-step-2').classList.remove('activo');
document.getElementById('btn-portal-mando-contenedor').classList.add('tour-highlight-z');
const tooltip3 = document.getElementById('tour-step-3');
tooltip3.classList.add('activo');
}
window.siguienteTour3 = function() {
document.getElementById('btn-portal-mando-contenedor').classList.remove('tour-highlight-z');
document.getElementById('tour-step-3').classList.remove('activo');
document.getElementById('contenedor-etiquetas').classList.add('tour-highlight-z');
const tooltip4 = document.getElementById('tour-step-4');
tooltip4.classList.add('activo');
}
window.finalizarTour = function() {
document.body.classList.remove('tour-active');
document.getElementById('contenedor-etiquetas').classList.remove('tour-highlight-z');
document.getElementById('tour-step-4').classList.remove('activo');
localStorage.setItem('qrpido_tour_v10', 'true');
solicitarGPSInicial();
}
// 🛡️ BISTURÍ: El panel se cierra pero respeta la categoría en la que está el usuario
window.cerrarPanelCristal = function(event) {
    if (event) {
        event.preventDefault(); 
        event.stopPropagation(); // Aniquila los clics fantasma que resetean la categoría
    }
    if (navigator.vibrate) navigator.vibrate(30);
    
    const panel = document.getElementById('panel-cristal');
    if (panel) panel.style.display = 'none';
};


window.centrarMapaHardware = function() {
const btnGps = document.getElementById('btn-flotante-gps');
const iconoOriginal = btnGps.innerHTML;
btnGps.innerHTML = '⏳';
btnGps.style.transform = 'scale(0.9)';
if (navigator.vibrate) navigator.vibrate(30);
if (navigator.geolocation) {
navigator.geolocation.getCurrentPosition((pos) => {
const lat = pos.coords.latitude; const lng = pos.coords.longitude;
mapa.flyTo([lat, lng], 16, { duration: 1.5 });
const iconoPunto = L.divIcon({
html: '<div class="punto-azul" style="margin: 0; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);"></div>',
className: '', iconSize: [24, 24], iconAnchor: [12, 12]
});
if(miUbicacionMarker) mapa.removeLayer(miUbicacionMarker);
miUbicacionMarker = L.marker([lat, lng], { icon: iconoPunto, zIndexOffset: 1000 }).addTo(mapa);
setTimeout(() => {
btnGps.innerHTML = iconoOriginal;
btnGps.style.transform = 'scale(1)';
}, 1000);
if (!cajaFuerteEspacial || !cajaFuerteEspacial.contains(L.latLng(lat, lng))) {
zonaNecesitaDescarga = true;
document.getElementById('btn-cargar-zona').style.display = 'block';
}
}, (err) => {
btnGps.innerHTML = iconoOriginal;
btnGps.style.transform = 'scale(1)';
const toast = document.getElementById('toast-fantasma');
toast.innerText = "Activa el GPS de tu móvil 📡";
toast.style.opacity = '1';
setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
}
};
window.solicitarGPSInicial = function() {
const btnGps = document.getElementById('btn-flotante-gps');
if (navigator.geolocation) {
navigator.geolocation.getCurrentPosition((pos) => {
const lat = pos.coords.latitude; const lng = pos.coords.longitude;
QRpidoDB.LocalService.registrarEventoAnalytics('demanda_oculta_gps', { latitud: lat, longitud: lng });
mapa.flyTo([lat, lng], 16, { duration: 2 });
const iconoPunto = L.divIcon({
html: '<div class="punto-azul" style="margin: 0; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);"></div>',
className: '',
iconSize: [24, 24],
iconAnchor: [12, 12]
});
if(miUbicacionMarker) mapa.removeLayer(miUbicacionMarker);
miUbicacionMarker = L.marker([lat, lng], { icon: iconoPunto, zIndexOffset: 1000 }).addTo(mapa);
setTimeout(() => { descargarNegociosDeFirebase(); }, 1500);
}, (err) => {
zonaNecesitaDescarga = true; document.getElementById('btn-cargar-zona').style.display = 'block';
});
} else {
zonaNecesitaDescarga = true; document.getElementById('btn-cargar-zona').style.display = 'block';
}
}
window.dibujarPinesDesdeJSONCache = function(boundsActuales) {
if (!window.DICCIONARIO_UNIVERSAL || window.DICCIONARIO_UNIVERSAL.length === 0) return;
requestAnimationFrame(() => {
let pinesDibujadosEnEsteFrame = 0;
const LIMITE_PINES_PANTALLA = 100; // Escudo protector de CPU
for (let i = 0; i < window.DICCIONARIO_UNIVERSAL.length; i++) {
if (pinesDibujadosEnEsteFrame >= LIMITE_PINES_PANTALLA) break;
const negocio = window.DICCIONARIO_UNIVERSAL[i];
if (negocio.lat && negocio.lng && boundsActuales.contains([negocio.lat, negocio.lng])) {
if (!marcadoresActivos[negocio.id_prod]) {
const marker = L.marker([negocio.lat, negocio.lng]).addTo(mapa);
marker.bindPopup(`<b>${sanitizarTexto(negocio.nombre)}</b><br><span id="precio-${sanitizarTexto(negocio.id_prod)}">Verificando...</span>`);
marcadoresActivos[negocio.id_prod] = marker;
}
pinesDibujadosEnEsteFrame++;
}
}
});
};
window.descargarNegociosDeFirebase = async function() {
    const btn = document.getElementById('btn-cargar-zona');
    if (btn) {
        btn.innerText = "⏳ Rastreando...";
        btn.style.background = "#ffcc00";
    }
    try {
        const center = [mapa.getCenter().lat, mapa.getCenter().lng];
        const boundsLeaflet = mapa.getBounds();
        let radiusInM = mapa.getCenter().distanceTo(boundsLeaflet.getNorthEast());
        // 🛡️ Límite estricto de radio (Máximo 2000m = 2km)
        if (radiusInM > 2000) radiusInM = 2000;
        
        let success, arrayNegocios, error;
        if (categoriaActivaGlobal === 'inmuebles') {
            const res = await QRpidoDB.RadarService.buscarInmueblesEnRadar(center[0], center[1], radiusInM);
            success = res.success; arrayNegocios = res.data; error = res.error;
        } else {
            const res = await QRpidoDB.RadarService.buscarEnRadar(center[0], center[1], radiusInM);
            success = res.success; arrayNegocios = res.data; error = res.error;
        }
        if (!success) throw new Error(error);
        
        if (dbDirectorioMap.size > 1500) {
            const llaves = Array.from(dbDirectorioMap.keys());
            for(let i = 0; i < 500; i++) {
                dbDirectorioMap.delete(llaves[i]);
            }
        }
        arrayNegocios.forEach(data => {
            const doc = { id: data.id || data.codigo };
            let lat, lng;
            if (data.Coordenadas) {
                if (typeof data.Coordenadas.latitude === 'function' || typeof data.Coordenadas.lat === 'function') {
                    lat = data.Coordenadas.latitude ? data.Coordenadas.latitude() : (data.Coordenadas.lat ? data.Coordenadas.lat() : data.Coordenadas._lat);
                    lng = data.Coordenadas.longitude ? data.Coordenadas.longitude() : (data.Coordenadas.lng ? data.Coordenadas.lng() : data.Coordenadas._long);
                } else if (data.Coordenadas.latitude !== undefined) {
                    lat = data.Coordenadas.latitude; lng = data.Coordenadas.longitude;
                }
            } else if (data.plusCode && typeof OpenLocationCode !== 'undefined') {
                try {
                    const decoded = OpenLocationCode.decode(data.plusCode);
                    lat = decoded.latitudeCenter; lng = decoded.longitudeCenter;
                } catch (e) {}
            }
            if (!lat || !lng || isNaN(lat) || isNaN(lng)) return;
            if (data.estado_moderacion !== "pendiente" && data.geohash) {
                const distanceInM = calcularDistanciaKm(lat, lng, center[0], center[1]) * 1000;
                if (distanceInM <= radiusInM) {
                    const safeData = { ...data, Coordenadas: { latitude: lat, longitude: lng } };
                    dbDirectorioMap.set(doc.id, { codigo: doc.id, ...safeData });
                }
            }
        });
        dbDirectorio = Array.from(dbDirectorioMap.values());
        datosDescargados = true;
        zonaNecesitaDescarga = false;
        cajaFuerteEspacial = mapa.getBounds().pad(0.5);

        if (typeof marcadoresActivos !== 'undefined') {
            for (let idClon in marcadoresActivos) {
                if (mapa.hasLayer(marcadoresActivos[idClon])) {
                    mapa.removeLayer(marcadoresActivos[idClon]);
                }
                delete marcadoresActivos[idClon];
            }
        }

        if (btn) {
            btn.style.display = 'none';
            btn.innerText = "🔍 Buscar en esta zona";
            btn.style.background = "linear-gradient(45deg, var(--naranja), #ffcc00)";
        }
        const catActualObj = window.categoriasEstaticas ? window.categoriasEstaticas.find(c => c.id === window.categoriaActivaGlobal) : null;
        if (catActualObj && window.renderizarPanel) {
            window.renderizarPanel(catActualObj);
        }
        if (typeof barridoRadar === "function") {
            const buscador = document.getElementById('input-buscador');
            barridoRadar(buscador ? buscador.value : '');
        }
    } catch (error) {
        if (btn) {
            btn.innerText = "🔍 Buscar en esta zona";
            btn.style.display = 'block';
        }
        console.error("Error en la descarga:", error);
    }
}; // <--- ¡Esta llave de cierre era la que se había borrado!

window.construirMapa = function() {
    // ========================================================================
    // 🌃 MOTOR WEBGL: GENERACIÓN PROCEDURAL DE LA CIUDAD (MODO SYPHON FILTER)
    // ========================================================================
    const PEREIRA_ZONA_CENTRO = [-75.6961, 4.8133]; 

    // Inicialización de la cámara cenital WebGL
    window.mapa = new maplibregl.Map({
        container: 'mapa-qrpido', // ID exacto de tu div en index.html
        style: 'https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json', // Estilo oscuro vectorial
        center: PEREIRA_ZONA_CENTRO,
        zoom: 15,
        pitch: 0, 
        bearing: 0, 
        antialias: true 
    });
    
    // Vinculamos la variable local para mantener compatibilidad con las funciones inferiores
    mapa = window.mapa; 

    // Cuando la estructura base termina de cargar, levantamos la extrusión 3D
    window.mapa.on('load', () => {
        console.log("🟢 [WebGL Engine] Mapa base cargado. Construyendo geometría urbana...");

        // Añadimos la fuente de datos vectoriales de edificios desde Stadia Maps
        window.mapa.addSource('edificios_3d', {
            'type': 'vector',
            'url': 'https://tiles.stadiamaps.com/data/buildings.json' 
        });

        // Extrusión de polígonos (Fachadas Oníricas / Syphon Filter)
        window.mapa.addLayer({
            'id': 'edificios-extrusion',
            'type': 'fill-extrusion',
            'source': 'edificios_3d',
            'source-layer': 'building',
            'paint': {
                'fill-extrusion-color': '#051005', 
                'fill-extrusion-height': [
                    'interpolate', ['linear'], ['zoom'],
                    15, 0,
                    15.05, ['get', 'height']
                ],
                'fill-extrusion-base': [
                    'interpolate', ['linear'], ['zoom'],
                    15, 0,
                    15.05, ['get', 'min_height']
                ],
                'fill-extrusion-opacity': 0.85
            }
        });

        // Ocultamos las etiquetas de texto por defecto de las calles
        window.mapa.getStyle().layers.forEach((layer) => {
            if (layer.id.includes('label')) {
                window.mapa.setLayoutProperty(layer.id, 'visibility', 'none');
            }
        });
    });

    
    let timerMovimiento;
    let ultimoCentroFetch = null;
    const UMBRAL_DISTANCIA_METROS = 1500; 
    
    mapa.on('moveend', () => {
        clearTimeout(timerMovimiento);
        const boundsActuales = mapa.getBounds();
        if (window.dibujarPinesDesdeJSONCache) window.dibujarPinesDesdeJSONCache(boundsActuales);
        
        if (mapa.getZoom() < 14) return; 
        
        timerMovimiento = setTimeout(() => {
            const currentCenter = mapa.getCenter();
            if (ultimoCentroFetch && currentCenter.distanceTo(ultimoCentroFetch) < UMBRAL_DISTANCIA_METROS) {
                if (datosDescargados && !zonaNecesitaDescarga && !document.querySelector('.leaflet-popup')) {
                    const buscador = document.getElementById('input-buscador');
                    if (typeof barridoRadar === "function") barridoRadar(buscador ? buscador.value : '');
                }
                return;
            }
            ultimoCentroFetch = currentCenter;
            
            if (datosDescargados && cajaFuerteEspacial && !cajaFuerteEspacial.contains(mapa.getBounds())) {
                zonaNecesitaDescarga = true;
            }
            
            if (zonaNecesitaDescarga) {
                const btnCargar = document.getElementById('btn-cargar-zona');
                if (btnCargar) btnCargar.style.display = 'block';
                if (window.descargarNegociosDeFirebase) window.descargarNegociosDeFirebase();
            } else if (datosDescargados && !document.querySelector('.leaflet-popup')) {
                const buscador = document.getElementById('input-buscador');
                if (typeof barridoRadar === "function") barridoRadar(buscador ? buscador.value : '');
            }
        }, 500);
    });
    
    mapa.on('zoomend', () => {
        const mHtml = document.getElementById('mapa-qrpido');
        if (mHtml) mHtml.setAttribute('data-zoom', mapa.getZoom());
    });
    
    const mHtmlInit = document.getElementById('mapa-qrpido');
    if (mHtmlInit) mHtmlInit.setAttribute('data-zoom', mapa.getZoom());
    
        mapa.on('click', () => {
        const panelCristal = document.getElementById('panel-cristal');
        if (panelCristal) panelCristal.classList.add('colapsado');
    });
}; // <--- ¡Y esta llave cierra el mapa correctamente!

window.buscarCiudadGlobal = async function() {

const texto = document.getElementById('input-buscador').value.trim();
if(!texto) return;
QRpidoDB.LocalService.registrarEventoAnalytics('busqueda_radar', { termino: texto });
const btnLupa = document.getElementById('btn-lupa'); btnLupa.innerText = "⏳";
try {
const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(texto)}&countrycodes=co,ve`);
const data = await response.json();
if (data && data.length > 0) {
if (data[0].boundingbox) mapa.flyToBounds(L.latLngBounds(L.latLng(data[0].boundingbox[0], data[0].boundingbox[2]), L.latLng(data[0].boundingbox[1], data[0].boundingbox[3])), { duration: 2, maxZoom: 13 });
else mapa.flyTo([data[0].lat, data[0].lon], 12, { duration: 2 });
document.getElementById('input-buscador').value = ''; zonaNecesitaDescarga = true;
setTimeout(() => document.getElementById('btn-cargar-zona').style.display = 'block', 2000);
} else { barridoRadar(texto); }
} catch(e) { console.error(e); } finally { btnLupa.innerText = "🔍"; }
}
window.compartirTienda = function(event, codigo, nombre, username) {
if (event) { event.preventDefault(); event.stopPropagation(); }
if(mapa) mapa.closePopup();
abrirModal('overlay-compartir');
setTimeout(() => {
try {
const baseOriginal = window.location.origin === "null" ? "" : window.location.origin;
// --- LÓGICA DE URL INTELIGENTE ---
if (username && username !== 'null') {
window.linkCompartirActual = baseOriginal + '/' + username;
} else {
window.linkCompartirActual = baseOriginal + window.location.pathname.replace('index.html', '') + 'negocio.html?id=' + codigo;
}
window.nombreCompartirActual = nombre;
const qrContainer = document.getElementById('qr-code-container');
qrContainer.innerHTML = ""; qrContainer.style.boxShadow = `0 0 15px var(--naranja)`;
try { new QRCode(qrContainer, { text: window.linkCompartirActual, width: 200, height: 200, colorDark: "#ff6b00", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.H }); }
catch (errQR) { qrContainer.innerHTML = "<span style='color:#ff4444; font-size:12px; font-weight:bold;'>El visor web no pudo dibujar el QR. Usa 'Copiar Link'.</span>"; }
} catch (e) { console.error("Error armando link:", e); }
}, 150);
}
window.copiarEnlace = function() { navigator.clipboard.writeText(window.linkCompartirActual).then(() => { alert('¡Enlace copiado al portapapeles! 🔗'); }); }
window.compartirNativo = async function() {
if (navigator.share) { try { await navigator.share({ title: window.nombreCompartirActual + ' | QRpido', url: window.linkCompartirActual }); } catch (err) {} } else { copiarEnlace(); }
}
window.descargarQR = async function() {
const btn = document.getElementById('btn-descargar-qr');
const textoOriginal = btn.innerText; btn.innerText = "⏳ GENERANDO ARCHIVO..."; btn.style.opacity = "0.7";
try {
const qrContainer = document.getElementById('qr-code-container'); const canvas = qrContainer.querySelector('canvas');
if (canvas) {
canvas.toBlob(function(blob) {
const urlObj = window.URL.createObjectURL(blob);
const nombreArchivo = `QR_${window.nombreCompartirActual.replace(/\s+/g, '_')}_${Date.now()}.png`;
const a = document.createElement('a'); a.style.display = 'none'; a.href = urlObj; a.download = nombreArchivo;
document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(urlObj);
}, "image/png");
} else { alert("Por favor espera un segundo mientras el QR termina de generarse."); }
} catch(e) { console.error(e); } finally { setTimeout(() => { btn.innerText = textoOriginal; btn.style.opacity = "1"; }, 1000); }
}
let categoriaActivaGlobal = 'negocios';
let filtrandoFavoritos = false;
window.toggleMapaFavoritos = function() {
if (navigator.vibrate) navigator.vibrate(30);
filtrandoFavoritos = !filtrandoFavoritos;
const btn = document.getElementById('btn-filtro-corazon');
if (filtrandoFavoritos) {
btn.style.background = '#ff4444';
btn.style.color = 'white';
btn.innerText = '❤️';
} else {
btn.style.background = 'rgba(255, 68, 68, 0.2)';
btn.style.color = '#ff4444';
btn.innerText = '🤍';
}
if (datosDescargados) barridoRadar(document.getElementById('input-buscador').value);
};
window.togglePanelAcordeon = function() {
const panel = document.getElementById('panel-cristal');
panel.classList.toggle('colapsado');
}
window.renderizarPanel = function(catObj) {
const panel = document.getElementById('panel-cristal');
const pFiltros = document.getElementById('panel-filtros');
const pVitrina = document.getElementById('vitrina-contenido');
const btnCTA = document.getElementById('btn-cta-panel');
const panelCaptacion = document.getElementById('panel-captacion');
panel.style.display = 'block';
panel.classList.remove('colapsado');
let htmlFiltros = '';
const elementosValidos = (dbDirectorio || []).filter(p => p.estado_moderacion !== "pendiente" && p.tipo_modelo === catObj.tipo && p.niche);
const conteoNichos = {};
elementosValidos.forEach(p => {
const nichoStr = sanitizarTexto(p.niche).toUpperCase();
conteoNichos[nichoStr] = (conteoNichos[nichoStr] || 0) + 1;
});
const subCatsOrdenadas = Object.keys(conteoNichos).sort((a, b) => conteoNichos[b] - conteoNichos[a]);
if (catObj.id === 'aliados') {
const aliados = (dbDirectorio || []).filter(p => p.estado_moderacion !== "pendiente" && (p.red_afiliados === true || p.red_afiliados === 'SI'));
const catServicios = [...new Set(aliados.filter(p => p.tipo_modelo === 'servicio').map(p => p.niche).filter(Boolean))];
const catProductos = [...new Set(aliados.filter(p => p.tipo_modelo !== 'servicio' && p.tipo_modelo !== 'inmueble').map(p => p.niche).filter(Boolean))];
htmlFiltros = `
<select id="f-aliados-servicios" class="select-glass" onchange="barridoRadar(this.value); if(document.getElementById('f-aliados-productos')) document.getElementById('f-aliados-productos').value='';">
<option value="">🛠️ Servicios Aliados</option>
${catServicios.map(c => `<option value="${sanitizarTexto(c)}">${sanitizarTexto(c).toUpperCase()}</option>`).join('')}
</select>
<select id="f-aliados-productos" class="select-glass" onchange="barridoRadar(this.value); if(document.getElementById('f-aliados-servicios')) document.getElementById('f-aliados-servicios').value='';">
<option value="">🛍️ Productos Aliados</option>
${catProductos.map(c => `<option value="${sanitizarTexto(c)}">${sanitizarTexto(c).toUpperCase()}</option>`).join('')}
</select>
`;
} else if (catObj.tipo === 'inmueble') {
htmlFiltros = `
<select id="f-presupuesto" class="select-glass" onchange="barridoRadar()">
<option value="">Presupuesto</option>
<option value="bajo">- 1 Millón</option>
<option value="medio">1 a 3 Millones</option>
<option value="alto">+ 3 Millones</option>
</select>
<select id="f-cuartos" class="select-glass" onchange="barridoRadar()">
<option value="">Habitaciones</option>
<option value="1hab">1 Hab</option>
<option value="2hab">2 Hab</option>
<option value="3hab">3+ Hab</option>
</select>
<select id="f-estrato" class="select-glass" onchange="barridoRadar()">
<option value="">Estrato</option>
<option value="e12">1 - 2</option>
<option value="e34">3 - 4</option>
<option value="e56">5 - 6</option>
</select>
`;
} else if (subCatsOrdenadas.length > 0) {
htmlFiltros += `<div style="display:flex; gap:var(--sp-micro); overflow-x:auto; scrollbar-width:none; padding-bottom:var(--sp-micro); width:100%;">`;
htmlFiltros += `<button class="tag-pill activa" style="font-size: var(--texto-sm); padding: 4px var(--sp-sm); border-radius: 13px; min-height: 26px; border: 1px solid rgba(255,255,255,0.1);" onclick="document.querySelectorAll('#panel-filtros .tag-pill').forEach(b=>b.classList.remove('activa')); this.classList.add('activa'); barridoRadar('')">Todas</button>`;
subCatsOrdenadas.forEach(sub => {
htmlFiltros += `<button class="tag-pill" style="font-size: var(--texto-sm); padding: 4px var(--sp-sm); border-radius: 13px; min-height: 26px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.05); color: #ccc;" onclick="document.querySelectorAll('#panel-filtros .tag-pill').forEach(b=>b.classList.remove('activa')); this.classList.add('activa'); barridoRadar('${sanitizarTexto(sub)}')">${sub}</button>`;
});
htmlFiltros += `</div>`;
} else {
htmlFiltros = `<p style="font-size:var(--texto-sm); color:#888; margin:0; text-align:center; width:100%; font-style: italic; letter-spacing: 0.5px;">Buscando radar en la zona...</p>`;
}
pFiltros.innerHTML = htmlFiltros;
const vitrinaPremium = (dbDirectorio || []).filter(p => {
if (!p.premium) return false;
if (catObj.id === 'aliados') return (p.red_afiliados === true || p.red_afiliados === 'SI');
return p.tipo_modelo === catObj.tipo;
});
const seleccionados = vitrinaPremium.sort(() => 0.5 - Math.random()).slice(0, 3);
if(seleccionados.length > 0) {
let htmlVitrina = '';
seleccionados.forEach(p => {
const c1 = p.color_hex ? p.color_hex.split(',')[0].trim() : 'var(--naranja)';
htmlVitrina += `
<a href="negocio.html?id=${sanitizarTexto(p.codigo)}" class="vitrina-card" style="border-color: ${c1}">
<img src="${p.portada || dbSimbologia['wallpaper_generico']}" class="vitrina-img" loading="lazy">
<div class="vitrina-info">
<p class="vitrina-titulo">${sanitizarTexto(p.nombre)}</p>
<p class="vitrina-precio">${p.precio > 0 ? formatearMoneda(p.precio, p.moneda) : 'VER CATÁLOGO'}</p>
</div>
</a>
`;
});
pVitrina.innerHTML = htmlVitrina;
document.getElementById('panel-vitrina').style.display = 'block';
} else {
document.getElementById('panel-vitrina').style.display = 'none';
}
if (catObj.id === 'negocios') {
panelCaptacion.style.display = 'none';
} else {
panelCaptacion.style.display = 'block';
btnCTA.innerText = catObj.cta ? `¿Eres dueño? ${catObj.cta}` : '¿Eres dueño? Anúnciate aquí';
}
}
window.construirCarrusel = function() {
const contenedor = document.getElementById('contenedor-etiquetas');
contenedor.innerHTML = '';
categoriasEstaticas.forEach(c => {
const div = document.createElement('div');
// Dejamos "Negocios" como el activo por defecto visualmente
div.className = `tag-pill ${c.id === 'negocios' ? 'activa' : ''}`;
div.innerHTML = sanitizarTexto(c.nombre);
div.onclick = (e) => {
e.stopPropagation();
if (c.tipo === 'portal_externo' && c.link) {
window.location.href = c.link;
} else {
// Limpieza del filtro de favoritos si estaba activo
if (typeof filtrandoFavoritos !== 'undefined' && filtrandoFavoritos === true) {
filtrandoFavoritos = false;
const btnFav = document.getElementById('btn-filtro-corazon');
if (btnFav) {
btnFav.style.background = 'rgba(255, 68, 68, 0.2)';
btnFav.style.color = '#ff4444';
btnFav.innerText = '🤍';
}
}
if (categoriaActivaGlobal === c.id) {
// FIX UX: Lógica de toggle blindada para el botón actual
const panel = document.getElementById('panel-cristal');
if (panel.style.display === 'none') {
// Si estaba cerrado (con la X o de inicio), lo mostramos y abrimos
panel.style.display = 'block';
panel.classList.remove('colapsado');
} else {
// Si ya está visible, hacemos el efecto acordeón normal
panel.classList.toggle('colapsado');
}
} else {
// Cambio a una categoría nueva
categoriaActivaGlobal = c.id;
document.querySelectorAll('#contenedor-etiquetas .tag-pill').forEach(t => t.classList.remove('activa'));
div.classList.add('activa');
renderizarPanel(c);
// 🚨 GATILLO: Forzamos al radar a descargar de nuevo si cambiamos entre Negocios e Inmuebles
if (c.id === 'inmuebles' || c.id === 'negocios') {
zonaNecesitaDescarga = true;
descargarNegociosDeFirebase();
} else {
if (typeof barridoRadar === "function") barridoRadar('');
}
}
}
};
contenedor.appendChild(div);
});
}
window.barridoRadar = window.barridoRadar = function(filtroTexto = "") {
if(!datosDescargados) return;


capaRadar.clearLayers();
window.marcadoresRadar = {};


let filtrados = (dbDirectorio || []).filter(p => p.estado_moderacion !== "pendiente");


const catActualObj = categoriasEstaticas.find(c => c.id === categoriaActivaGlobal);
const favsStorage = JSON.parse(localStorage.getItem('qrpido_favoritos_anon')) || [];
const favsIds = favsStorage.map(f => f.id);
filtrados = filtrados.filter(p => {
if(catActualObj && catActualObj.id !== 'todos') {
if (catActualObj.id === 'aliados') {
if (p.red_afiliados !== true && p.red_afiliados !== 'SI') return false;
} else if (p.tipo_modelo !== catActualObj.tipo) {
return false;
}
}
if (catActualObj && catActualObj.id === 'inmuebles') {
const vPresup = document.getElementById('f-presupuesto')?.value;
const vCuartos = document.getElementById('f-cuartos')?.value;
const vEstrato = document.getElementById('f-estrato')?.value;
const strData = `${p.nombre || ''} ${p.niche || ''} ${p.palabras_clave || ''}`.toLowerCase();
if (vPresup === 'bajo' && !strData.includes('barato')) return false;
if (vCuartos === '1hab' && !strData.includes('1 hab')) return false;
if (vEstrato === 'e34' && (!strData.includes('estrato 3') && !strData.includes('estrato 4'))) return false;
}
if (filtroTexto && typeof filtroTexto === 'string') {
const txt = filtroTexto.toLowerCase().trim();
const strCompleto = `${p.nombre || ''} ${p.niche || ''} ${p.palabras_clave || ''} ${p.categoria || ''}`.toLowerCase();
if(!strCompleto.includes(txt)) return false;
}
if (filtrandoFavoritos && !favsIds.includes(encodeURIComponent(p.codigo))) {
return false;
}
return true;
});
filtrados.sort((a, b) => {
const aVip = (a.premium === 'SI' || a.premium === true || a.promo === 'SI') ? 1 : 0;
const bVip = (b.premium === 'SI' || b.premium === true || b.promo === 'SI') ? 1 : 0;
return bVip - aVip;
});
const limiteMapa = mapa.getBounds().pad(0.5);
const userCenter = mapa.getCenter();
window.marcadoresRadar = {};
let tarjetasHibridasHtml = '';
const favs = favsIds;
let pinesEnPantalla = filtrados.filter(p => {
if(!p.Coordenadas || p.Coordenadas.latitude === undefined) return false;
return limiteMapa.contains(L.latLng(p.Coordenadas.latitude, p.Coordenadas.longitude));
});
// 🛡️ CIRUGÍA 3B: Estrategia de Rotación Áurea y Jerarquía Visual
const limiteAliados = 15;
const limitePremium = 25;
const limiteTotal = 40;
// 1. Separamos las 3 castas de negocios
const pinesAliados = pinesEnPantalla.filter(p => p.red_afiliados === true || p.red_afiliados === 'SI');
const pinesPremium = pinesEnPantalla.filter(p => (p.premium === 'SI' || p.premium === true || p.promo === 'SI') && !(p.red_afiliados === true || p.red_afiliados === 'SI'));
const pinesFreemium = pinesEnPantalla.filter(p => !(p.red_afiliados === true || p.red_afiliados === 'SI') && !(p.premium === 'SI' || p.premium === true || p.promo === 'SI'));
// 2. Barajamos a los VIPs (Ellos rotan 100% al azar entre los de su casta)
pinesAliados.sort(() => 0.5 - Math.random());
pinesPremium.sort(() => 0.5 - Math.random());
const seleccionAliados = pinesAliados.slice(0, limiteAliados);
const seleccionPremium = pinesPremium.slice(0, limitePremium);
// 3. Calculamos la capacidad restante para los negocios gratuitos
const asientosLibres = limiteTotal - (seleccionAliados.length + seleccionPremium.length);
let seleccionFreemium = [];
if (asientosLibres > 0) {
// --- INYECCIÓN DE DOPAMINA: PROPORCIÓN ÁUREA UX (61.8%) ---
window.memoriaRadar = window.memoriaRadar || []; // Memoria del frame anterior
// Separamos a los Freemium que el usuario estaba viendo, de los que están ocultos
const freemiumViejos = pinesFreemium.filter(p => window.memoriaRadar.includes(p.codigo));
const freemiumNuevos = pinesFreemium.filter(p => !window.memoriaRadar.includes(p.codigo));
// Desordenamos la baraja
freemiumViejos.sort(() => 0.5 - Math.random());
freemiumNuevos.sort(() => 0.5 - Math.random());
// MATEMÁTICA PURA:
// Sobrevive el 38.2% (Anclaje visual)
// Muere y es reemplazado el 61.8% (Efecto dopamina)
const cantidadSobrevivientes = Math.floor(asientosLibres * 0.382);
const sobrevivientes = freemiumViejos.slice(0, cantidadSobrevivientes);
// Buscamos sangre nueva para llenar el 61.8% restante
const cantidadNuevos = asientosLibres - sobrevivientes.length;
let reemplazos = freemiumNuevos.slice(0, cantidadNuevos);
// Si la base de datos de tu ciudad aún es pequeña y nos quedamos sin "nuevos", rellenamos con los viejos sobrantes
if (reemplazos.length < cantidadNuevos) {
const viejosSobrantes = freemiumViejos.slice(cantidadSobrevivientes);
reemplazos = [...reemplazos, ...viejosSobrantes].slice(0, cantidadNuevos - reemplazos.length);
}
seleccionFreemium = [...sobrevivientes, ...reemplazos];
// Guardamos la "fotografía" actual para el próximo zoom
window.memoriaRadar = seleccionFreemium.map(p => p.codigo);
}
// 4. Unimos las tropas para enviarlas al renderizador
pinesEnPantalla = [...seleccionAliados, ...seleccionPremium, ...seleccionFreemium];


if (pinesEnPantalla.length === 0) {
const toast = document.getElementById('toast-fantasma');
let nombreCat = categoriaActivaGlobal === 'inmuebles' ? 'inmuebles' : (categoriaActivaGlobal === 'servicios' ? 'servicios' : 'negocios');
toast.innerText = filtrandoFavoritos ? "No tienes guardados en esta zona ❤️" : `No encontramos ${nombreCat} aquí 📍`;
toast.style.opacity = '1';
setTimeout(() => { toast.style.opacity = '0'; }, 3000);
return;
}
pinesEnPantalla.forEach(p => {
const pos = L.latLng(p.Coordenadas.latitude, p.Coordenadas.longitude);
const pinUsado = dbSimbologia[p.link_pin] || dbSimbologia['pin_normal'];
// Si es inmueble usa "p.imagen", si es negocio usa "p.portada / p.logo"
const portadaUsada = p.es_inmueble_real ? p.imagen : (p.portada || dbSimbologia['wallpaper_generico']);
const logoUsado = p.es_inmueble_real ? p.imagen : (p.logo || dbSimbologia['avatar_generico']);
const nombreLimpio = sanitizarTexto(p.nombre || 'Negocio').replace(/'/g, "\\'");
const escapeQuotes = (str) => (str || '').replace(/'/g, "%27").replace(/"/g, "%22");
const logoSeguro = escapeQuotes(logoUsado);
const portadaSegura = escapeQuotes(portadaUsada);
let c1 = 'var(--naranja)';
let c2 = 'var(--naranja)';
let c3 = '#ffffff'; // Color de borde por defecto
let claseForma = p.es_inmueble_real ? 'pin-1' : 'pin-1'; // Pin estándar (pronto pondremos el 3D)
let textoNicho = sanitizarTexto(p.es_inmueble_real ? (p.categoria || 'Propiedad') : (p.niche || 'Local'));
// 1. PRIORIDAD: Sistema Empaquetado (Genoma)
if (p.ui_pack && p.ui_pack.length >= 16) {
const genoma = window.decodificarGenoma(p.ui_pack);
if (genoma) {
claseForma = genoma.forma;
c1 = genoma.c1;
c2 = genoma.c2;
c3 = genoma.c3;
// Aquí en el futuro enlazaremos genoma.abre y genoma.cierra a la lógica de horario
}
}
// 2. FALLBACK: Sistema Antiguo (Para negocios que no han actualizado)
else if (p.color_hex) {
const arrColores = p.color_hex.split(',').map(c => c.trim());
c1 = arrColores[0];
c2 = arrColores.length > 1 ? arrColores[1] : c1;
}
if (categoriaActivaGlobal === 'inmuebles') {
const datosSemaforo = obtenerDatosSemaforo(p.fecha_registro);
c1 = datosSemaforo.color; c2 = datosSemaforo.color; textoNicho = datosSemaforo.texto;
}
let badgeCobertura = '';
const radKm = parseFloat(p.cobertura_km) || 0;
if (radKm > 0 && radKm < 0.1) {
badgeCobertura = `<div class="badge-fuera-zona" style="background: rgba(255, 107, 0, 0.8);">Solo recogida en local</div>`;
} else if (radKm >= 0.1) {
const distKm = calcularDistanciaKm(userCenter.lat, userCenter.lng, p.Coordenadas.latitude, p.Coordenadas.longitude);
if (distKm > radKm) badgeCobertura = `<div class="badge-fuera-zona">Fuera de zona de reparto</div>`;
}
       const estaAbierto = window.verificarHorarioOperativo(p.horario_apertura, p.horario_cierre);
        if (!estaAbierto && p.tipo_modelo !== 'inmueble') {
            badgeCobertura += `<div class="badge-fuera-zona" style="background: #555; margin-left: 5px;">Cerrado ahora</div>`;
            c1 = '#555555';
            c2 = '#333333';
        }


        // 🚨 NUEVO: MOTOR DE INVENTARIO FANTASMA (MERMA / REMATE) 🚨
        let claseFuego = '';
        let badgeRemate = '';
        if (p.merma_activa === true || p.flash_sale === true) {
            claseFuego = 'pin-en-fuego'; 
            c1 = '#ff0044'; // Forzamos el color del pin a Rojo Alerta (Fuego)
            badgeRemate = `<div class="badge-fuego" style="background: #ff0044; color: white; padding: 2px 6px; border-radius: 10px; font-weight: 900; font-size: 10px; letter-spacing: 1px; animation: latidoNeon 1s infinite; margin-bottom: 5px; text-shadow: none;">🔥 REMATE DE INVENTARIO</div>`;
        }


        const numEstrellas = p.reputacion ? parseInt(p.reputacion) : 5;


const estrellasHtml = '★'.repeat(numEstrellas) + '☆'.repeat(5 - numEstrellas);
const esFav = favs.includes(encodeURIComponent(p.codigo));
const corazon = esFav ? '❤️' : '🤍';
const favStyleBtn = esFav ? 'color: #ff4444; border-color: #ff4444; background: rgba(255,68,68,0.2);' : '';
const esAliado = (p.red_afiliados === true || p.red_afiliados === 'SI');
                        let htmlPin = '';
        if (esAliado) {
            htmlPin = `<div class="pin-wrapper pin-moneda-magica ${claseFuego}" style="border-color: #FFD700;"><img src="${logoSeguro}" class="pin-img" onerror="window.imagenRotaToGlass(this, '${nombreLimpio}')"></div>`;
        } else {
            htmlPin = `
            <div class="pin-wrapper ${claseForma} ${claseFuego}"
            style="--color-main: ${c1}; --color-sec: ${c2}; --color-border: ${c3};">
            <img src="${logoSeguro}" class="pin-img" onerror="window.imagenRotaToGlass(this, '${nombreLimpio}')">
            </div>`;
        }

                const iconoLeaflet = L.divIcon({ html: htmlPin, className: '', iconSize: [44, 44], iconAnchor: [22, 22] });


        let tituloRenderizado = '';
        const urlSeguraPng = p.nombre_png ? escapeQuotes(p.nombre_png) : '';


        if (urlSeguraPng && urlSeguraPng.trim() !== '') {
            tituloRenderizado = `<img src="${urlSeguraPng}" alt="${nombreLimpio}" style="max-height: 35px; max-width: 90%; object-fit: contain; margin: 0 auto; display: block; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">`;
        } else {
            tituloRenderizado = `<h3 class="popup-title" style="text-shadow: 0 0 5px ${c1};">${sanitizarTexto(p.nombre || 'Negocio')}</h3>`;
        }


        const usaPublicidadPropia = p.publicidad_propia === true;
        let bloquePublicidad = '';


        if (usaPublicidadPropia) {
            const troyasActivos = dbTroya.filter(t => t.activo === true || t.activo === "SI");
            const anuncio = troyasActivos.length > 0 ? troyasActivos[Math.floor(Math.random() * troyasActivos.length)] : null;
            if (anuncio) {
                bloquePublicidad = `<a href="${anuncio.link_accion}" target="_blank"><img src="${anuncio.imagen_16_9}" style="width:100%; border-radius:10px; margin-top:10px; border: 1px solid var(--naranja);"></a>`;
            }
        } else {
            bloquePublicidad = `
            <div class="adsense-popup" style="margin-top:10px; min-height:50px; background: rgba(0,0,0,0.2); border-radius: 8px;">
            <ins class="adsbygoogle" style="display:inline-block;width:100%;height:50px" data-ad-client="ca-pub-XXXXX" data-ad-slot="YYYYY"></ins>
            </div>`;
        }


        // --- AQUÍ CREAMOS EL ENLACE INTELIGENTE ---
// 🔗 Enrutamos al cliente a la Agencia (id_negocio_padre) y le pasamos el inmueble específico (item)
const linkDestino = p.es_inmueble_real
? `inmueble.html?id=${encodeURIComponent(p.id_negocio_padre || p.codigo)}&item=${encodeURIComponent(p.codigo)}`
: (p.username ? `/${p.username.toLowerCase()}` : `negocio.html?id=${encodeURIComponent(p.codigo)}`);


        const usernameParaCompartir = p.username ? `'${p.username.toLowerCase()}'` : `null`;


        const htmlPopup = `
        <div style="position: relative;">
            <button class="btn-fav-popup js-action-favorito" style="${favStyleBtn}" data-codigo="${window.sanitizarAtributo(encodeURIComponent(p.codigo))}" data-nombre="${window.sanitizarAtributo(nombreLimpio)}" data-precio="${window.sanitizarAtributo(p.precio || 0)}" data-portada="${window.sanitizarAtributo(portadaSegura)}" data-whatsapp="${window.sanitizarAtributo(p.whatsapp || '')}">${corazon}</button>
            <button class="btn-compartir js-action-compartir" data-codigo="${window.sanitizarAtributo(encodeURIComponent(p.codigo))}" data-nombre="${window.sanitizarAtributo(nombreLimpio)}" data-username="${window.sanitizarAtributo(usernameParaCompartir)}"><svg style="pointer-events: none;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg></button>
            <img src="${portadaUsada}" class="popup-portada" style="border-color: ${c1}" onerror="window.imagenRotaToGlass(this, '${nombreLimpio}')">
        </div>
        <div class="popup-info">
            <img src="${logoSeguro}" class="popup-logo" style="border-color: ${c1};" onerror="window.imagenRotaToGlass(this, '${nombreLimpio}')">
            <div class="popup-title-wrapper" style="margin-bottom: 8px; display: flex; flex-wrap: wrap; justify-content: center; gap: 4px;">
                ${badgeRemate} ${badgeCobertura}
            </div>
            ${tituloRenderizado}
            <div class="estrellas" style="margin-top: 5px;">${estrellasHtml}</div>
            <p class="texto-piedra">${textoNicho}</p>
            <a href="${window.sanitizarURL(linkDestino)}" class="btn-catalogo js-action-ver-detalles" data-codigo="${window.sanitizarAtributo(encodeURIComponent(p.codigo))}" data-nicho="${window.sanitizarAtributo(sanitizarTexto(p.niche))}" style="background: ${c2}; color: ${estaAbierto ? '#ffffff' : '#aaaaaa'} !important; text-shadow: 0 1px 2px rgba(0,0,0,0.5); pointer-events: ${estaAbierto ? 'all' : 'none'};">${estaAbierto ? 'VER DETALLES' : 'CERRADO AHORA'}</a>
        </div>`;


// 🛡️ OBJECT POOLING: Solo creamos el marcador en el DOM si no existe en la RAM
if (!window.marcadoresRadar[p.codigo]) {
    const marker = L.marker([pos.lat, pos.lng], { icon: iconoLeaflet }).addTo(capaRadar).bindPopup(htmlPopup, { autoPan: false });
    if (esAliado) {
    marker.on('click', function(e) {
if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
const iconEl = e.target._icon.querySelector('.pin-moneda-magica');
if (iconEl) {
iconEl.style.animation = 'none';
requestAnimationFrame(() => {
requestAnimationFrame(() => {
iconEl.style.animation = 'saltoMoneda 0.6s ease-out forwards';
});
});
setTimeout(() => { iconEl.style.animation = 'flotarMoneda 2.5s infinite ease-in-out'; }, 600);
}
});
    }
    window.marcadoresRadar[p.codigo] = marker;
} // <- Cierre del If del Object Pooling


// ✖️ NUEVA FUNCIÓN GLOBAL PARA CERRAR CARDS INDIVIDUALES
window.cerrarTarjetaInmueble = function(event, elemento) {
    event.stopPropagation(); // Evita que al hacer clic en la X, el mapa haga zoom al inmueble
    elemento.closest('.tarjeta-hibrida').style.display = 'none';
};


if (categoriaActivaGlobal === 'inmuebles') {


tarjetasHibridasHtml += `


<div class="tarjeta-hibrida" style="border-color: ${c1}; position: relative;" onclick="enfocarInmueble('${sanitizarTexto(p.codigo)}', ${pos.lat}, ${pos.lng})">


<button class="btn-fav-card" style="${favStyleBtn}" onclick="window.toggleFavorito('${encodeURIComponent(p.codigo)}', '${nombreLimpio}', '${p.precio || 0}', '${portadaSegura}', '${sanitizarTexto(p.whatsapp || '')}', event)">${corazon}</button>


<button class="btn-cerrar-card" onclick="window.cerrarTarjetaInmueble(event, this)" style="position: absolute; top: 10px; left: 10px; background: rgba(0,0,0,0.6); color: white; border: 1px solid rgba(255,255,255,0.3); border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; z-index: 10; cursor: pointer; font-size: 12px; font-weight: bold;">✖</button>


<img src="${portadaUsada}" class="tarjeta-hibrida-img" onerror="this.src='${dbSimbologia['wallpaper_generico']}'">


<div class="tarjeta-hibrida-info">
<h4 class="tarjeta-hibrida-titulo">${sanitizarTexto(p.nombre || 'Inmueble')}</h4>
<p class="tarjeta-hibrida-nicho" style="color: ${c1};">${textoNicho}</p>
</div>
</div>`;
}
});
const sheetHibrido = document.getElementById('lista-inmuebles-sheet');
if (categoriaActivaGlobal === 'inmuebles' && tarjetasHibridasHtml !== '') {
sheetHibrido.innerHTML = tarjetasHibridasHtml;
sheetHibrido.classList.add('activo');
} else {
sheetHibrido.classList.remove('activo');
sheetHibrido.innerHTML = '';
}
}
window.cargarCaballoTroya = function() {
if(!dbTroya || dbTroya.length === 0) return;
const troyasActivos = dbTroya.filter(t => t.activo === true || t.activo === "SI");
if (troyasActivos.length > 0) {
document.getElementById('img-troya').src = troyasActivos[0].imagen_16_9 || dbSimbologia['banner_noticias_generico'];
document.getElementById('link-troya').href = troyasActivos[0].link_accion || '#';
document.getElementById('contenedor-troya').style.display = 'block';
}
}
document.getElementById('input-buscador').addEventListener('input', (e) => {
clearTimeout(window.timerBusqueda);
window.timerBusqueda = setTimeout(() => { if(datosDescargados) barridoRadar(e.target.value); }, 400);
});
window.toggleSubmenu = () => document.getElementById('submenu-llave').classList.toggle('activo');
window.abrirModal = (id) => document.getElementById(id).classList.add('activo');
window.cerrarModalFuera = (e, id) => { if(e.target.id === id) document.getElementById(id).classList.remove('activo'); }
function aplicarSwipeAbajo(modalId, contentId) {
const modal = document.getElementById(modalId);
const content = document.getElementById(contentId);
let startY = 0, currentY = 0;
content.addEventListener('touchstart', e => startY = e.touches[0].clientY, {passive: true});
content.addEventListener('touchmove', e => { currentY = e.touches[0].clientY; if(currentY > startY && content.scrollTop === 0) content.style.transform = `translateY(${currentY - startY}px)`; }, {passive: true});
content.addEventListener('touchend', () => { if (currentY - startY > 100 && content.scrollTop === 0) modal.classList.remove('activo'); content.style.transform = ''; });
}
aplicarSwipeAbajo('modal-login', 'sheet-login'); aplicarSwipeAbajo('overlay-compartir', 'sheet-compartir'); aplicarSwipeAbajo('modal-soporte', 'sheet-soporte');
// === MÓDULO DE RENDIMIENTO Y UX: RADAR GIROSCÓPICO ===
let gyroActivo = false;
let currentGamma = 0;
let targetGamma = 0;
let rafGyroId = null;
function manejarGiroscopio(e) {
if (!gyroActivo) return;
let gamma = e.gamma || 0;
if (gamma > 12) gamma = 12; 
if (gamma < -12) gamma = -12; 
targetGamma = gamma;
}
function animarRadar() {
if (!gyroActivo) return;
let diff = targetGamma - currentGamma;
if (Math.abs(diff) > 0.2) {
currentGamma += diff * 0.08;
const mapaContenedor = document.getElementById('mapa-qrpido');
if (mapaContenedor) {
// Forzar composición 3D para la GPU
mapaContenedor.style.transform = `translate3d(0,0,0) scale(1.15) rotateZ(${-currentGamma}deg)`;
}
}
rafGyroId = requestAnimationFrame(animarRadar);
}
// ========================================================================
// 🎥 CINEMÁTICA DE CÁMARA (TRANSICIÓN 2D A 2.5D)
// ========================================================================
window.isRadar3DActivo = false;

window.toggleRadarInmersivo = function(btnElement) {
    if (!window.mapa) return;
    
    if (navigator.vibrate) navigator.vibrate([30, 50, 30]);

    window.isRadar3DActivo = !window.isRadar3DActivo;

    if (window.isRadar3DActivo) {
        // BAJAR A MODO SYPHON FILTER (Street Level)
        btnElement.innerText = "🚁 Vista Aérea";
        btnElement.style.background = "rgba(255, 107, 0, 0.2)";
        btnElement.style.borderColor = "#ff6b00";
        btnElement.style.color = "#ff6b00";

        // Vuelo de cámara cinematográfico (FlyTo)
        window.mapa.flyTo({
            pitch: 65, 
            bearing: -45, 
            zoom: 17.5, 
            duration: 2500, 
            essential: true
        });

    } else {
        // SUBIR A MODO 2D CLÁSICO (Modo Dios)
        btnElement.innerText = "🧭 Activar Radar 3D";
        btnElement.style.background = "rgba(0, 255, 255, 0.1)";
        btnElement.style.borderColor = "#0ff";
        btnElement.style.color = "#0ff";

        window.mapa.flyTo({
            pitch: 0, 
            bearing: 0, 
            zoom: 15, 
            duration: 2000,
            essential: true
        });
    }
};

window.cambiarMapa = function(tipo, el) {
const servers = {
'clasico': 'https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}{r}.png',
'rayosx': 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png',
'neon': 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png',
'lite': 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png',
'satelite': 'https://tiles.stadiamaps.com/tiles/alidade_satellite/{z}/{x}/{y}{r}.jpg'
};
capaBase.setUrl(servers[tipo]);
const panel = document.querySelector('.leaflet-tile-pane');
if (tipo === 'rayosx') panel.style.filter = "invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%)";
else if (tipo === 'neon') panel.style.filter = "invert(100%) sepia(100%) hue-rotate(355deg) saturate(1500%) contrast(1.3) brightness(1.1)";
else panel.style.filter = "none";
if (['rayosx', 'satelite'].includes(tipo)) {
document.body.classList.add('ui-light');
} else {
document.body.classList.remove('ui-light');
}
document.querySelectorAll('.map-tag:not(#btn-giro-toggle)').forEach(t => t.classList.remove('active'));
el.classList.add('active');
const btnGiro = document.getElementById('btn-giro-toggle');
if (tipo === 'neon' || tipo === 'rayosx') {
btnGiro.style.display = 'block';
} else {
btnGiro.style.display = 'none';
if(gyroActivo) window.toggleRadarInmersivo(btnGiro);
}
}
// =================================================================
// 🌸 PROTOCOLO NIEVES: MATRIZ LEGIBLE + VISOR FOTOS + MENSAJE MEJORADO
// =================================================================

window.activarProtocoloNieves = async function() {
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    alert("🌸 Iniciando Protocolo Nieves..."); 

    try {
        const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        const docSnap = await getDoc(doc(db, "sistema", "protocolo_nieves"));
        
        if (!docSnap.exists() || !docSnap.data().activo) {
            alert("⚠️ La bóveda de Nieves no está activa.");
            return;
        }

        const urlsFotos = docSnap.data().fotos;
        if (!urlsFotos || urlsFotos.length === 0) return alert("⚠️ La bóveda está vacía.");

        alert("🚀 ¡Fotos listas! Desplegando sobre tu casa a gran escala...");

        // 📍 COORDENADAS EXACTAS DE TU CASA EN LOBATERA
        const centroLat = 7.9301874;
        const centroLng = -72.2442390;
        
        // Matriz "FELIZ DIA MAMA"
        const matriz = [
            "1111 0 1111 0 1000 0 1 0 1111   000   1110  0 1 0  10   000   111 0  10  0 111 0  10",
            "1000 0 1000 0 1000 0 1 0 0001   000   1001  0 1 0 101   000   101 0 101  0 101 0 101",
            "1110 0 1110 0 1000 0 1 0 0010   000   1001  0 1 0 111   000   101 0 111  0 101 0 111",
            "1000 0 1000 0 1000 0 1 0 0100   000   1001  0 1 0 101   000   101 0 101  0 101 0 101",
            "1000 0 1111 0 1111 0 1 0 1111   000   1110  0 1 0 101   000   101 0 101  0 101 0 101"
        ];

        let indexFoto = 0;
        
        // 📏 AJUSTE CRÍTICO DE LEGIBILIDAD: Pines más pequeños y más separados
        const tamañoPin = 22; 
        const latPaso = 0.00015; 
        const lngPaso = 0.00015;

        const offsetLat = (matriz.length * latPaso) / 2;
        const offsetLng = (matriz[0].length * lngPaso) / 2;

        for (let f = 0; f < matriz.length; f++) {
            const fila = matriz[f]; 
            for (let c = 0; c < fila.length; c++) {
                if (fila[c] === "1") {
                    const urlFoto = urlsFotos[indexFoto % urlsFotos.length]; 
                    indexFoto++;

                    const latPin = (centroLat + offsetLat) - (f * latPaso);
                    const lngPin = (centroLng - offsetLng) + (c * lngPaso);

                    const htmlInterno = `
                        <div class="pin-wrapper" style="width: ${tamañoPin}px !important; height: ${tamañoPin}px !important; border: 2px solid var(--naranja); box-shadow: 0 2px 4px rgba(0,0,0,0.5); overflow: hidden; margin: 0; padding: 0;">
                            <img src="${urlFoto}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">
                        </div>
                    `;

                    const iconoOptimizado = L.divIcon({
                        html: htmlInterno,
                        className: '', 
                        iconSize: [tamañoPin, tamañoPin],
                        iconAnchor: [tamañoPin/2, tamañoPin/2]
                    });

                    // 💌 TARJETA INTERACTIVA CON FUNCIÓN DE AMPLIAR FOTO
                    const tarjetaAmor = `
                        <div style="text-align: center; width: 140px; padding: 5px;">
                            <img src="${urlFoto}" onclick="window.abrirFotoNieves('${urlFoto}')" style="width:100%; height:130px; object-fit:cover; border-radius:8px; margin-bottom: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); cursor: zoom-in;">
                            <h4 style="color: var(--naranja); margin: 0; font-size: 14px; font-weight: 900;">¡FELIZ DÍA! 🌸</h4>
                            <p style="margin: 3px 0 5px 0; font-size: 10px; color: #ddd; font-weight: bold;">Toca la foto para ampliarla.</p>
                        </div>
                    `;

                    L.marker([latPin, lngPin], { icon: iconoOptimizado }).bindPopup(tarjetaAmor).addTo(mapa);
                }
            }
        }
        
        mapa.flyTo([centroLat, centroLng], 16, {
            animate: true,
            duration: 2.5 
        });

        setTimeout(window.detonarCelebracionNieves, 2600);

    } catch (error) {
        alert("⚠️ Error en el Protocolo Nieves: " + error.message);
        console.error(error);
    }
};

// =================================================================
// 📸 VISOR DE PANTALLA COMPLETA PARA LAS FOTOS
// =================================================================
window.abrirFotoNieves = function(url) {
    let visor = document.getElementById('visor-nieves-fs');
    if (!visor) {
        visor = document.createElement('div');
        visor.id = 'visor-nieves-fs';
        // Fondo oscuro y en la capa más alta posible
        visor.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.95); z-index: 99999999; display: flex; justify-content: center; align-items: center; opacity: 0; transition: opacity 0.3s ease; flex-direction: column;';
        
        // Cerrar si hace clic fuera de la foto
        visor.onclick = function(e) { if(e.target === visor) window.cerrarFotoNieves(); };

        const cerrarBtn = document.createElement('button');
        cerrarBtn.innerHTML = '✖';
        cerrarBtn.style.cssText = 'position: absolute; top: 20px; right: 20px; background: rgba(255,255,255,0.2); color: white; border: 1px solid white; border-radius: 50%; width: 40px; height: 40px; font-size: 18px; font-weight: bold; cursor: pointer; z-index: 2;';
        cerrarBtn.onclick = window.cerrarFotoNieves;

        const img = document.createElement('img');
        img.id = 'img-nieves-fs';
        img.style.cssText = 'max-width: 95vw; max-height: 85vh; object-fit: contain; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.8);';

        visor.appendChild(cerrarBtn);
        visor.appendChild(img);
        document.body.appendChild(visor);
    }
    
    document.getElementById('img-nieves-fs').src = url;
    visor.style.display = 'flex';
    requestAnimationFrame(() => visor.style.opacity = '1');
};

window.cerrarFotoNieves = function() {
    const visor = document.getElementById('visor-nieves-fs');
    if(visor) {
        visor.style.opacity = '0';
        setTimeout(() => visor.style.display = 'none', 300);
    }
};


// =================================================================
// 🎊 ANIMACIÓN DE FLORES Y MENSAJE PARA MAMÁ (EFECTO ANIME / LOTO)
// =================================================================
window.detonarCelebracionNieves = function() {
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 500]); 
    const frag = document.createDocumentFragment();

    // 1. EL MENSAJE CENTRAL (Rosado, borde blanco, sombra pesada)
    const cartelMensaje = document.createElement('div');
    cartelMensaje.innerHTML = `<h1 style="color: #ff007f; text-shadow: 2px 2px 0px #fff, -2px -2px 0px #fff, 2px -2px 0px #fff, -2px 2px 0px #fff, 0 8px 20px rgba(0,0,0,0.9); font-family: 'Georgia', serif; font-size: 32px; line-height: 1.3; font-weight: 900; margin: 0; letter-spacing: 1px;">El Dia de la Madre es todos los días.<br>Te amo mamá 💖</h1>`;
    cartelMensaje.style.cssText = `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.5); z-index: 9999999; text-align: center; width: 90%; pointer-events: none; opacity: 0; transition: all 1s cubic-bezier(0.175, 0.885, 0.32, 1.275);`;
    cartelMensaje.id = "mensaje-madre";
    frag.appendChild(cartelMensaje);

    requestAnimationFrame(() => {
        setTimeout(() => {
            cartelMensaje.style.opacity = '1';
            cartelMensaje.style.transform = 'translate(-50%, -50%) scale(1)';
        }, 100);
    });

    // 2. LA LLUVIA DE FLORES (CAÍDA LENTA Y DRAMÁTICA)
    const emojis = ['🌸', '✨', '💖', '🌺', '🌷', '💮'];
    for (let i = 0; i < 40; i++) {
        const conf = document.createElement('div');
        conf.className = "flor-voladora";
        conf.innerText = emojis[Math.floor(Math.random() * emojis.length)];
        
        // ⏱️ EL SECRETO ANIME: Tiempo de caída aleatorio entre 8 y 15 segundos
        const tiempoCaida = Math.random() * 7 + 8; 
        
        // linear para gravedad constante, ease-in-out para el balanceo suave
        conf.style.cssText = `position: fixed; top: -50px; left: ${Math.random() * 100}vw; font-size: ${Math.random() * 25 + 15}px; z-index: 999999; pointer-events: none; transition: top ${tiempoCaida}s linear, transform ${tiempoCaida}s ease-in-out; opacity: 0.9;`;
        frag.appendChild(conf);

        requestAnimationFrame(() => {
            // Escalonamos la salida hasta por 2 segundos para que no salgan todas juntas
            setTimeout(() => {
                conf.style.top = '120vh'; // Que caigan hasta bien abajo de la pantalla
                // Rotación suave y balanceo amplio de lado a lado (como una hoja al viento)
                conf.style.transform = `rotate(${Math.random() * 360 + 360}deg) translateX(${Math.random() * 200 - 100}px)`;
            }, Math.random() * 2000); 
        });
    }
    document.body.appendChild(frag);

    // ⏱️ LIMPIEZA ADAPTADA A LA LENTITUD
    // El mensaje desaparece suavemente a los 12 segundos
    setTimeout(() => {
        const mensaje = document.getElementById('mensaje-madre');
        if(mensaje) {
            mensaje.style.opacity = '0';
            mensaje.style.transform = 'translate(-50%, -50%) scale(1.2)';
            setTimeout(() => mensaje.remove(), 1000);
        }
    }, 12000);

    // Las flores tienen permiso de existir hasta 17 segundos antes de borrarlas de la RAM
        setTimeout(() => {
        document.querySelectorAll('.flor-voladora').forEach(el => el.remove());
    }, 17000);
};

// =================================================================
// 🗺️ MINIMAPA WIZARD BÓVEDA (Aislamiento Arquitectónico)
// =================================================================
window.instanciarMinimapaBoveda = function(contenedorId, lat = 4.8133, lng = -75.6961) {
    if (typeof L === 'undefined') return null;
    const miniMapa = L.map(contenedorId, { zoomControl: false, attributionControl: false }).setView([lat, lng], 16);
    L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', { maxZoom: 18 }).addTo(miniMapa);
    
    const iconoPin = L.divIcon({
        html: '<div class="pin-wrapper pin-1" style="--color-main: var(--naranja); --color-sec: #000; width: 34px; height: 34px;"><div class="pin-img" style="background: var(--naranja);"></div></div>',
        className: '', iconSize: [34, 34], iconAnchor: [17, 17]
    });
    const marker = L.marker([lat, lng], { icon: iconoPin, draggable: true }).addTo(miniMapa);
    marker.on('dragstart', () => document.getElementById(contenedorId).style.transform = 'scale(0.98)');
    marker.on('dragend', () => document.getElementById(contenedorId).style.transform = 'scale(1)');
    
    return { 
        mapa: miniMapa, marcador: marker,
        irUbicacionActual: function() {
            if(navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(pos => {
                    const nLat = pos.coords.latitude, nLng = pos.coords.longitude;
                    miniMapa.flyTo([nLat, nLng], 17); marker.setLatLng([nLat, nLng]);
                });
            }
        },
        buscarDireccion: async function(texto) {
            if(!texto) return;
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(texto)}&countrycodes=co`);
            const data = await res.json();
            if(data && data.length > 0) {
                miniMapa.flyTo([data[0].lat, data[0].lon], 17); marker.setLatLng([data[0].lat, data[0].lon]);
            }
        }
    };
};