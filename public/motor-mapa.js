import GeokatuDB from './core-db.js';
import { db } from './firebase-config.js'; 
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// === VARIABLES Y LÓGICA DEL MAPA ===
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

// === ESPÍA DE SESIÓN PARA REGLA DEL DUEÑO ===
window.idUsuarioActual = null;
GeokatuDB.SecurityService.observarEstadoSesion((user) => {
    if (user) {
        window.idUsuarioActual = user.uid;
        // 💉 Redibujar el radar apenas confirmamos que el dueño entró
        if (typeof window.barridoRadar === 'function' && datosDescargados) {
            window.barridoRadar();
        }
    } else {
        window.idUsuarioActual = null;
    }
});


window.sanitizarTexto = function(texto) {
    if (texto === null || texto === undefined) return '';
    const div = document.createElement('div');
    div.textContent = texto;
    return div.innerHTML;
};

// === MÓDULO DESEMPAQUETADO UI (GENOMA) ===
window.decodificarGenoma = function(uiPack) {
    if (!uiPack || uiPack.length < 16) return null;
    const f = uiPack[0]; 
    const codigoBase62 = uiPack.substring(1, 14); 
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

window.formatearMoneda = function(valorInt64, moneda = 'COP') {
    if (!valorInt64 || isNaN(valorInt64)) return moneda === 'USD' ? '$0.00' : '$0';
    const valor = parseInt(valorInt64, 10);
    if (moneda === 'USD') {
        return (valor / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    }
    return '$' + valor.toLocaleString('es-CO');
};

window.registrarClicVerDetalles = function(codigo, nicho) {
    GeokatuDB.LocalService.registrarEventoAnalytics('clic_ver_negocio', { id_negocio: codigo, nicho: nicho });
};

// =================================================================
// 🛸 MOTOR DE INTERPOLACIÓN VECTORES (GPS FLUIDO A 60 FPS)
// =================================================================
window.animarPinFluido = function(marker, latDestino, lngDestino, duracionMs = 10000) {
    if (marker._rafId) cancelAnimationFrame(marker._rafId);
    
    const posInicial = marker.getLngLat();
    const tiempoInicio = performance.now();

    function pasoAnimacion(tiempoActual) {
        let progreso = (tiempoActual - tiempoInicio) / duracionMs;
        if (progreso > 1) progreso = 1;

        const latActual = posInicial.lat + (latDestino - posInicial.lat) * progreso;
        const lngActual = posInicial.lng + (lngDestino - posInicial.lng) * progreso;

        marker.setLngLat([lngActual, latActual]);

        if (progreso < 1) {
            marker._rafId = requestAnimationFrame(pasoAnimacion);
        }
    }
    
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
    
    let favs = JSON.parse(localStorage.getItem('geokatu_favoritos_anon')) || [];
    const index = favs.findIndex(x => x.id === id);
    let isAdding = false;
    
    if (index > -1) {
        favs.splice(index, 1);
    } else {
        favs.push({ id, nombre, precio, foto, whatsapp });
        isAdding = true;
        GeokatuDB.LocalService.registrarEventoAnalytics('add_to_wishlist', { item_id: id, item_name: nombre });
    }
    
    localStorage.setItem('geokatu_favoritos_anon', JSON.stringify(favs));
    
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
    let favs = JSON.parse(localStorage.getItem('geokatu_favoritos_anon')) || [];
    lista.innerHTML = ''; 
    if (favs.length === 0) {
        lista.innerHTML = '<p style="text-align:center; padding:20px; color:#888;">No tienes lugares guardados aún.</p>';
    } else {
        favs.forEach(f => {
            const card = document.createElement('div');
            card.className = "fav-card";
            const h4 = document.createElement('h4');
            h4.textContent = f.nombre; 
            const img = document.createElement('img');
            img.src = f.foto; 
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
    
    const popupActivo = document.querySelector('.maplibregl-popup');
    if (popupActivo) { popupActivo.remove(); previnoSalida = true; }
    
    const submenu = document.getElementById('submenu-llave');
    if (submenu && submenu.classList.contains('activo')) { submenu.classList.remove('activo'); previnoSalida = true; }
    
    if (previnoSalida) { 
        history.pushState(null, document.title, window.location.href); 
    } else { 
        if (confirm("¿Seguro que quieres salir de Geokatu?")) { 
            history.back(); 
        } else { 
            history.pushState(null, document.title, window.location.href); 
        } 
    }
});

const dbSimbologia = {
    logo_portada: 'https://via.placeholder.com/220x80/0a0a0c/ff6b00?text=GEOKATU',
    avatar_generico: 'https://via.placeholder.com/150/0a0a0c/ff6b00?text=Geokatu',
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
    mapa.flyTo({ center: [lng, lat], zoom: 16, duration: 1500 });
    setTimeout(() => {
        if (window.marcadoresRadar && window.marcadoresRadar[codigo]) {
            window.marcadoresRadar[codigo].togglePopup();
        }
    }, 1500);
};

window.arrancarMotor = async function() {
    try {
        if (typeof maplibregl === 'undefined') throw new Error("MapLibre no se descargó. Revisa la conexión o el index.html");
        
        if (typeof pmtiles !== 'undefined') {
            const protocol = new pmtiles.Protocol();
            window.maplibregl.addProtocol("pmtiles", protocol.tile);
        }

        construirMapa();
        
        if (typeof window.construirCarrusel === 'function') {
            window.construirCarrusel();
        }

        setTimeout(() => {
            const pantallaCarga = document.getElementById('pantalla-carga');
            if (pantallaCarga) pantallaCarga.style.opacity = '0';
            
            setTimeout(() => {
                if (pantallaCarga) pantallaCarga.style.display = 'none';
                
                const buscador = document.getElementById('wrapper-buscador');
                const etiquetas = document.getElementById('contenedor-etiquetas');
                if (buscador) buscador.classList.remove('shimmer-box');
                if (etiquetas) etiquetas.classList.remove('shimmer-box');
                
                const params = new URLSearchParams(window.location.search);
                const idDron = params.get('enfocar');
                const latDron = parseFloat(params.get('lat'));
                const lngDron = parseFloat(params.get('lng'));

                if (idDron && !isNaN(latDron) && !isNaN(lngDron)) {
                    categoriaActivaGlobal = 'inmuebles';
                    document.querySelectorAll('#contenedor-etiquetas .tag-pill').forEach(p => {
                        p.classList.remove('activa');
                        if(p.innerText.toUpperCase().includes('INMUEBLES')) p.classList.add('activa');
                    });
                    
                    mapa.flyTo({ center: [lngDron, latDron], zoom: 18, duration: 2500 });
                    
                    zonaNecesitaDescarga = true;
                    if (typeof window.descargarNegociosDeFirebase === 'function') {
                        window.descargarNegociosDeFirebase();
                    }

                    setTimeout(() => {
                        if (window.marcadoresRadar && window.marcadoresRadar[idDron]) {
                            window.marcadoresRadar[idDron].togglePopup();
                        }
                    }, 2600);

                    window.history.replaceState(null, '', window.location.pathname);
                } else {
                    if (typeof window.iniciarTour === 'function') {
                        window.iniciarTour(); 
                    } else {
                        window.solicitarGPSInicial();
                    }
                }
            }, 500);
        }, 800);

        try {
            const { success, data } = await GeokatuDB.LocalService.obtenerCaballoTroya();
            dbTroya = success && data ? data : [];
            if (typeof window.cargarCaballoTroya === 'function') window.cargarCaballoTroya();
        } catch (firebaseError) {
            console.warn("Aviso: Iniciando en modo offline o sin banners.", firebaseError.message);
        }
    } catch (e) {
        console.error("Error Crítico Motor:", e);
        if (typeof mostrarCartelErrorYDescargar === 'function') {
            mostrarCartelErrorYDescargar('CRASH EN EL NÚCLEO DEL MAPA', e.message + '\n\n' + (e.stack || ''));
        } else {
            alert("ERROR FATAL AL ARRANCAR: " + e.message);
        }
    }
};

window.solicitarGPSInicial = function() {
    if (typeof window.centrarMapaHardware === 'function') {
        window.centrarMapaHardware();
    }
};

window.iniciarTour = function() {
    if(localStorage.getItem('geokatu_tour_v1')) { solicitarGPSInicial(); return; }
    document.body.classList.add('tour-active');
    document.getElementById('wrapper-buscador').classList.add('tour-highlight-z');
    const tooltip1 = document.getElementById('tour-step-1');
    if(tooltip1) tooltip1.classList.add('activo');
};

window.siguienteTour1 = function() {
    document.getElementById('wrapper-buscador').classList.remove('tour-highlight-z');
    document.getElementById('tour-step-1').classList.remove('activo');
    
    const btnGps = document.getElementById('btn-flotante-gps') || document.querySelector('.maplibregl-ctrl-geolocate');
    if (btnGps) btnGps.classList.add('tour-highlight-z');
    
    const tooltip2 = document.getElementById('tour-step-2');
    if(tooltip2) tooltip2.classList.add('activo');
};

window.siguienteTour2 = function() {
    const btnGps = document.getElementById('btn-flotante-gps') || document.querySelector('.maplibregl-ctrl-geolocate');
    if (btnGps) btnGps.classList.remove('tour-highlight-z');
    
    document.getElementById('tour-step-2').classList.remove('activo');
    document.getElementById('btn-portal-mando-contenedor').classList.add('tour-highlight-z');
    
    const tooltip3 = document.getElementById('tour-step-3');
    if(tooltip3) tooltip3.classList.add('activo');
};

// 💉 CIRUGÍA: Iluminamos la nueva burbuja en lugar del menú viejo
window.siguienteTour3 = function() {
    document.getElementById('btn-portal-mando-contenedor').classList.remove('tour-highlight-z');
    document.getElementById('tour-step-3').classList.remove('activo');
    
    const fam = document.getElementById('fam-burbuja');
    if (fam) fam.classList.add('tour-highlight-z');
    
    const tooltip4 = document.getElementById('tour-step-4');
    if(tooltip4) tooltip4.classList.add('activo');
};

// 💉 CIRUGÍA: Apagamos la nueva burbuja al final
window.finalizarTour = function() {
    document.body.classList.remove('tour-active');
    
    const fam = document.getElementById('fam-burbuja');
    if (fam) fam.classList.remove('tour-highlight-z');
    
    const tooltip4 = document.getElementById('tour-step-4');
    if(tooltip4) tooltip4.classList.remove('activo');
    
    localStorage.setItem('geokatu_tour_v1', 'true');
    window.solicitarGPSInicial();
};

window.cerrarPanelCristal = function(event) {
    if (event) {
        event.preventDefault(); 
        event.stopPropagation();
    }
    if (navigator.vibrate) navigator.vibrate(30);
    
    const panel = document.getElementById('panel-cristal');
    if (panel) panel.style.display = 'none';
};

window.centrarMapaHardware = function() {
    if (navigator.vibrate) navigator.vibrate(30);
    
    const btnNativo = document.querySelector('.maplibregl-ctrl-geolocate');
    
    if (btnNativo) {
        btnNativo.click(); 
    } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
            mapa.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 16, duration: 2000 });
            setTimeout(() => { if (window.descargarNegociosDeFirebase) window.descargarNegociosDeFirebase(); }, 1500);
        }, () => {
            zonaNecesitaDescarga = true; 
            const btnCargar = document.getElementById('btn-cargar-zona');
            if (btnCargar) btnCargar.style.display = 'block';
        });
    }
};

window.dibujarPinesDesdeJSONCache = function(boundsActuales) {
    if (!window.DICCIONARIO_UNIVERSAL || window.DICCIONARIO_UNIVERSAL.length === 0) return;
    requestAnimationFrame(() => {
        let pinesDibujadosEnEsteFrame = 0;
        const LIMITE_PINES_PANTALLA = 100;
        for (let i = 0; i < window.DICCIONARIO_UNIVERSAL.length; i++) {
            if (pinesDibujadosEnEsteFrame >= LIMITE_PINES_PANTALLA) break;
            const negocio = window.DICCIONARIO_UNIVERSAL[i];
            if (negocio.lat && negocio.lng && boundsActuales.contains([negocio.lng, negocio.lat])) {
                if (!marcadoresActivos[negocio.id_prod]) {
                    const popupInfo = new maplibregl.Popup({ offset: 25, closeButton: false })
                        .setHTML(`<b>${sanitizarTexto(negocio.nombre)}</b><br><span id="precio-${sanitizarTexto(negocio.id_prod)}">Verificando...</span>`);
                    const marker = new maplibregl.Marker()
                        .setLngLat([negocio.lng, negocio.lat])
                        .setPopup(popupInfo)
                        .addTo(mapa);
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
        const centroActual = mapa.getCenter();
        const center = [centroActual.lat, centroActual.lng];
        const limites = mapa.getBounds();
        const ne = limites.getNorthEast();

        let radiusInM = calcularDistanciaKm(centroActual.lat, centroActual.lng, ne.lat, ne.lng) * 1000;
        if (radiusInM > 2000) radiusInM = 2000;
        
        let success, arrayNegocios, error;
        if (categoriaActivaGlobal === 'inmuebles') {
            const res = await GeokatuDB.RadarService.buscarInmueblesEnRadar(center[0], center[1], radiusInM);
            success = res.success; arrayNegocios = res.data; error = res.error;
        } else {
            const res = await GeokatuDB.RadarService.buscarEnRadar(center[0], center[1], radiusInM);
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
            
            // 💉 CIRUGÍA: Permitir el paso a los locales nuevos sin importar el estado de moderación aquí.
            if (data.geohash) {
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
        cajaFuerteEspacial = mapa.getBounds();

        if (typeof marcadoresActivos !== 'undefined') {
            for (let idClon in marcadoresActivos) {
                if (marcadoresActivos[idClon] && typeof marcadoresActivos[idClon].remove === 'function') {
                    marcadoresActivos[idClon].remove(); 
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
};

window.construirMapa = function() {
    const PEREIRA_ZONA_CENTRO = [-75.6961, 4.8133]; 

    window.mapa = new maplibregl.Map({
        container: 'mapa-qrpido', 
        style: './estilo-fresco.json', 
        center: PEREIRA_ZONA_CENTRO,
        zoom: 15,
        pitch: 0, 
        bearing: 0, 
        antialias: false 
    });

    mapa = window.mapa; 

    mapa.addControl(new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,       
        showUserHeading: true,         
        fitBoundsOptions: { maxZoom: 16 } 
    }), 'bottom-right');

    window.mapa.on('load', () => {
        console.log("🟢 [WebGL Engine] Mapa base cargado. Aplicando filtro inicial...");
        const canvasInicial = document.querySelector('.maplibregl-canvas');
    });
    
    let timerMovimiento;
    const UMBRAL_DISTANCIA_METROS = 1500; 
    
    mapa.on('moveend', () => {
        clearTimeout(timerMovimiento);
        const boundsActuales = mapa.getBounds();
        if (typeof dibujarPinesDesdeJSONCache === "function") {
            dibujarPinesDesdeJSONCache(boundsActuales);
        }
        
        if (mapa.getZoom() < 14) return; 
        
        timerMovimiento = setTimeout(() => {
            const currentCenter = mapa.getCenter();
            if (ultimoCentroFetch && currentCenter.distanceTo(ultimoCentroFetch) < UMBRAL_DISTANCIA_METROS) {
                if (datosDescargados && !zonaNecesitaDescarga && !document.querySelector('.maplibregl-popup')) {
                    const buscador = document.getElementById('input-buscador');
                    if (typeof barridoRadar === "function") barridoRadar(buscador ? buscador.value : '');
                }
                return;
            }
            ultimoCentroFetch = currentCenter;
            
            if (datosDescargados && cajaFuerteEspacial) {
                const b = mapa.getBounds();
                if (!cajaFuerteEspacial.contains(b.getSouthWest()) || !cajaFuerteEspacial.contains(b.getNorthEast())) {
                    zonaNecesitaDescarga = true;
                }
            }
            
            if (zonaNecesitaDescarga) {
                const btnCargar = document.getElementById('btn-cargar-zona');
                if (btnCargar) btnCargar.style.display = 'block';
                if (window.descargarNegociosDeFirebase) window.descargarNegociosDeFirebase();
            } else if (datosDescargados && !document.querySelector('.maplibregl-popup')) {
                const buscador = document.getElementById('input-buscador');
                if (typeof barridoRadar === "function") barridoRadar(buscador ? buscador.value : '');
            }
        }, 500);
    });
    
    const mHtmlInit = document.getElementById('mapa-qrpido');
    if (mHtmlInit) mHtmlInit.setAttribute('data-zoom', Math.round(mapa.getZoom()));
    
    mapa.on('click', () => {
        const panelCristal = document.getElementById('panel-cristal');
        if (panelCristal) panelCristal.classList.add('colapsado');
    });
};

window.buscarCiudadGlobal = async function() {
    const texto = document.getElementById('input-buscador').value.trim();
    if(!texto) return;
    GeokatuDB.LocalService.registrarEventoAnalytics('busqueda_radar', { termino: texto });
    const btnLupa = document.getElementById('btn-lupa'); btnLupa.innerText = "⏳";
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(texto)}&countrycodes=co,ve`);
        const data = await response.json();
        if (data && data.length > 0) {
            if (data[0].boundingbox) {
                mapa.fitBounds([
                    [parseFloat(data[0].boundingbox[2]), parseFloat(data[0].boundingbox[0])], 
                    [parseFloat(data[0].boundingbox[3]), parseFloat(data[0].boundingbox[1])]
                ], { duration: 2000, maxZoom: 13 });
            } else { 
                mapa.flyTo({ center: [parseFloat(data[0].lon), parseFloat(data[0].lat)], zoom: 12, duration: 2000 }); 
            }
            document.getElementById('input-buscador').value = ''; zonaNecesitaDescarga = true;
            setTimeout(() => document.getElementById('btn-cargar-zona').style.display = 'block', 2000);
        } else { barridoRadar(texto); }
    } catch(e) { console.error(e); } finally { btnLupa.innerText = "🔍"; }
};

window.compartirTienda = function(event, codigo, nombre, username) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    const popupActivo = document.querySelector('.maplibregl-popup');
    if (popupActivo) popupActivo.remove();
    abrirModal('overlay-compartir');
    setTimeout(() => {
        try {
            const baseOriginal = window.location.origin === "null" ? "" : window.location.origin;
            if (username && username !== 'null') {
                window.linkCompartirActual = baseOriginal + '/' + username;
            } else {
                window.linkCompartirActual = baseOriginal + window.location.pathname.replace('index.html', '') + 'negocio.html?id=' + codigo;
            }
            window.nombreCompartirActual = nombre;
            const qrContainer = document.getElementById('qr-code-container');
            qrContainer.innerHTML = ""; qrContainer.style.boxShadow = `0 0 15px var(--naranja)`;
            try { 
                new QRCode(qrContainer, { text: window.linkCompartirActual, width: 200, height: 200, colorDark: "#ff6b00", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.H }); 
            }
            catch (errQR) { qrContainer.innerHTML = "<span style='color:#ff4444; font-size:12px; font-weight:bold;'>El visor web no pudo dibujar el QR. Usa 'Copiar Link'.</span>"; }
        } catch (e) { console.error("Error armando link:", e); }
    }, 150);
};

window.copiarEnlace = function() { 
    navigator.clipboard.writeText(window.linkCompartirActual).then(() => { alert('¡Enlace copiado al portapapeles! 🔗'); }); 
};

window.compartirNativo = async function() {
    if (navigator.share) { 
        try { await navigator.share({ title: window.nombreCompartirActual + ' | Geokatu', url: window.linkCompartirActual }); } 
        catch (err) {} 
    } else { copiarEnlace(); }
};

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
};

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
    if(panel) panel.classList.toggle('colapsado');
};

// 💉 CIRUGÍA: Apagamos el panel viejo (ahora se gestiona en la burbuja FAM)
window.renderizarPanel = function(catObj) {
    return;
};

// 💉 CIRUGÍA: Apagamos las pastillas viejas
window.construirCarrusel = function() {
    return; 
};

window.barridoRadar = function(filtroTexto = "") {
    if(!datosDescargados) return;

    // 💉 ESCUDO DE VISIBILIDAD: Dejamos pasar todo para que veas tu pin sin importar la moderación
    let filtrados = (dbDirectorio || []).filter(p => true); 

    const catActualObj = categoriasEstaticas.find(c => c.id === categoriaActivaGlobal);
    const favsStorage = JSON.parse(localStorage.getItem('geokatu_favoritos_anon')) || [];
    const favsIds = favsStorage.map(f => f.id);
    
    filtrados = filtrados.filter(p => {
        if(catActualObj && catActualObj.id !== 'todos') {
            if (catActualObj.id === 'aliados') {
                if (p.red_afiliados !== true && p.red_afiliados !== 'SI') return false;
            } else if (catActualObj.id === 'negocios') {
                // 💉 LA CURA DEL ASESINO: Ahora el mapa acepta "comercio" y "negocio" por igual
                if (p.tipo_modelo !== 'negocio' && p.tipo_modelo !== 'comercio' && p.categoria_maestra !== 'comercio') return false;
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
    
    const limiteMapa = mapa.getBounds();
    const userCenter = mapa.getCenter();
    window.marcadoresRadar = window.marcadoresRadar || {};
    let tarjetasHibridasHtml = '';
    const favs = favsIds;
    
    let pinesEnPantalla = filtrados.filter(p => {
        if(!p.Coordenadas || p.Coordenadas.latitude === undefined || p.Coordenadas.longitude === undefined) return false;
        const latSegura = Number(p.Coordenadas.latitude);
        const lngSegura = Number(p.Coordenadas.longitude);
        if (isNaN(latSegura) || isNaN(lngSegura)) return false;
        return limiteMapa.contains([lngSegura, latSegura]);
    });
    
    const limiteAliados = 15;
    const limitePremium = 25;
    const limiteTotal = 40;
    
    const pinesAliados = pinesEnPantalla.filter(p => p.red_afiliados === true || p.red_afiliados === 'SI');
    const pinesPremium = pinesEnPantalla.filter(p => (p.premium === 'SI' || p.premium === true || p.promo === 'SI') && !(p.red_afiliados === true || p.red_afiliados === 'SI'));
    const pinesFreemium = pinesEnPantalla.filter(p => !(p.red_afiliados === true || p.red_afiliados === 'SI') && !(p.premium === 'SI' || p.premium === true || p.promo === 'SI'));
    
    pinesAliados.sort(() => 0.5 - Math.random());
    pinesPremium.sort(() => 0.5 - Math.random());
    const seleccionAliados = pinesAliados.slice(0, limiteAliados);
    const seleccionPremium = pinesPremium.slice(0, limitePremium);
    
    const asientosLibres = limiteTotal - (seleccionAliados.length + seleccionPremium.length);
    let seleccionFreemium = [];
    
    if (asientosLibres > 0) {
        window.memoriaRadar = window.memoriaRadar || []; 
        const freemiumViejos = pinesFreemium.filter(p => window.memoriaRadar.includes(p.codigo));
        const freemiumNuevos = pinesFreemium.filter(p => !window.memoriaRadar.includes(p.codigo));
        
        freemiumViejos.sort(() => 0.5 - Math.random());
        freemiumNuevos.sort(() => 0.5 - Math.random());
        
        const cantidadSobrevivientes = Math.floor(asientosLibres * 0.382);
        const sobrevivientes = freemiumViejos.slice(0, cantidadSobrevivientes);
        
        const cantidadNuevos = asientosLibres - sobrevivientes.length;
        let reemplazos = freemiumNuevos.slice(0, cantidadNuevos);
        
        if (reemplazos.length < cantidadNuevos) {
            const viejosSobrantes = freemiumViejos.slice(cantidadSobrevivientes);
            reemplazos = [...reemplazos, ...viejosSobrantes].slice(0, cantidadNuevos - reemplazos.length);
        }
        seleccionFreemium = [...sobrevivientes, ...reemplazos];
        window.memoriaRadar = seleccionFreemium.map(p => p.codigo);
    }
    
    pinesEnPantalla = [...seleccionAliados, ...seleccionPremium, ...seleccionFreemium];

    const codigosEnPantalla = pinesEnPantalla.map(p => p.codigo);
    for (let idClon in window.marcadoresRadar) {
        if (!codigosEnPantalla.includes(idClon)) {
            window.marcadoresRadar[idClon].remove();
            delete window.marcadoresRadar[idClon];
        }
    }
    
    if (pinesEnPantalla.length === 0) {
        const toast = document.getElementById('toast-fantasma');
        let nombreCat = categoriaActivaGlobal === 'inmuebles' ? 'inmuebles' : (categoriaActivaGlobal === 'servicios' ? 'servicios' : 'negocios');
        toast.innerText = filtrandoFavoritos ? "No tienes guardados en esta zona ❤️" : `No encontramos ${nombreCat} aquí 📍`;
        toast.style.opacity = '1';
        setTimeout(() => { toast.style.opacity = '0'; }, 3000);
        return;
    }
    
    pinesEnPantalla.forEach(p => {
        const pos = { lat: p.Coordenadas.latitude, lng: p.Coordenadas.longitude };
        const portadaUsada = p.es_inmueble_real ? p.imagen : (p.portada || dbSimbologia['wallpaper_generico']);
        const logoUsado = p.es_inmueble_real ? p.imagen : (p.logo || dbSimbologia['avatar_generico']);
        const nombreLimpio = sanitizarTexto(p.nombre || 'Negocio').replace(/'/g, "\\'");
        const escapeQuotes = (str) => (str || '').replace(/'/g, "%27").replace(/"/g, "%22");
        const logoSeguro = escapeQuotes(logoUsado);
        const portadaSegura = escapeQuotes(portadaUsada);
        
        let c1 = '#ff6b00';
        let c2 = '#ff6b00';
        let textoNicho = sanitizarTexto(p.es_inmueble_real ? (p.categoria || 'Propiedad') : (p.niche || 'Local'));
        
        let claseForma = 'forma-gota';
        let claseAnimacion = 'anim-salto';
        let claseAnclaje = '';
        let emojiGorra = '';

        // 💉 EXTRACCIÓN DEL PIN EMPAQUETADO CON GORRA
        if (p.pin_pack) {
            const partes = p.pin_pack.split('|');
            claseForma = partes[0] || 'forma-gota';
            claseAnimacion = partes[1] || 'anim-salto';
            claseAnclaje = partes[2] || '';
            emojiGorra = partes[3] || '';
        } else if (p.ui_pack && p.ui_pack.length >= 16) {
            const genoma = window.decodificarGenoma(p.ui_pack);
            if (genoma) {
                claseForma = 'forma-gota'; 
                c1 = genoma.c1;
                c2 = genoma.c2;
            }
        } else if (p.pin_forma || p.pin_animacion) {
            claseForma = p.pin_forma || 'forma-gota';
            claseAnimacion = p.pin_animacion || 'anim-salto';
            if (p.pin_efecto) {
                const partesEfecto = p.pin_efecto.split('|');
                claseAnclaje = partesEfecto[0] || '';
                emojiGorra = partesEfecto[1] || '';
            }
        }

        if (p.color_principal) {
            c1 = p.color_principal;
            c2 = p.color_acento || c1;
        } else if (p.color_hex) {
            const arrColores = p.color_hex.split(',').map(c => c.trim());
            c1 = arrColores[0];
            c2 = arrColores.length > 1 ? arrColores[1] : c1;
        }
        
        if (categoriaActivaGlobal === 'inmuebles') {
            const datosSemaforo = obtenerDatosSemaforo(p.fecha_registro);
            c1 = datosSemaforo.color; c2 = datosSemaforo.color; textoNicho = datosSemaforo.texto;
            claseForma = 'forma-esfera'; 
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

        let claseFuego = '';
        let badgeRemate = '';
        if (p.merma_activa === true || p.flash_sale === true) {
            claseFuego = 'pin-en-fuego'; 
            c1 = '#ff0044'; 
            badgeRemate = `<div class="badge-fuego" style="background: #ff0044; color: white; padding: 2px 6px; border-radius: 10px; font-weight: 900; font-size: 10px; letter-spacing: 1px; animation: latidoNeon 1s infinite; margin-bottom: 5px; text-shadow: none;">🔥 REMATE DE INVENTARIO</div>`;
        }

        const numEstrellas = p.reputacion ? parseInt(p.reputacion) : 5;
        const estrellasHtml = '★'.repeat(numEstrellas) + '☆'.repeat(5 - numEstrellas);
        const esFav = favs.includes(encodeURIComponent(p.codigo));
        const corazon = esFav ? '❤️' : '🤍';
        const favStyleBtn = esFav ? 'color: #ff4444; border-color: #ff4444; background: rgba(255,68,68,0.2);' : '';
        const esAliado = (p.red_afiliados === true || p.red_afiliados === 'SI');
        
        // 💉 APLICACIÓN DE LA GORRA EN EL HTML
        let htmlAtributosGorras = '';
        if (emojiGorra) {
            htmlAtributosGorras = `data-emoji="${emojiGorra}" data-anclaje="${claseAnclaje}"`;
        }

        let htmlPin = '';
        if (esAliado) {
            htmlPin = `<div class="pin-wrapper pin-moneda-magica ${claseFuego}" style="border-color: #FFD700;" ${htmlAtributosGorras}><img src="${p.link_pin || logoSeguro}" class="pin-img" onerror="window.imagenRotaToGlass(this, '${nombreLimpio}')"></div>`;
        } else {
            htmlPin = `
            <div class="pin-wrapper ${claseForma} ${claseAnimacion} ${claseFuego}"
            style="--color-main: ${c1}; --color-sec: ${c2};" ${htmlAtributosGorras}>
            <img src="${p.link_pin || logoSeguro}" class="pin-img" onerror="window.imagenRotaToGlass(this, '${nombreLimpio}')">
            </div>`;
        }

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

        if (!window.marcadoresRadar[p.codigo]) {
            // 1. elDOM ya no es un contenedor fantasma, es directamente el pin-wrapper
            const elDOM = document.createElement('div');
            elDOM.className = `pin-wrapper ${claseForma} ${claseAnimacion} ${claseFuego}`;
            
            // 2. Le inyectamos la gorra y las variables CSS directo a la raíz
            if (emojiGorra) {
                elDOM.setAttribute('data-emoji', emojiGorra);
                elDOM.setAttribute('data-anclaje', claseAnclaje);
            }
            elDOM.style.setProperty('--color-main', c1);
            elDOM.style.setProperty('--color-sec', c2);
            
            // 3. El HTML interno es SOLO la imagen (nada de divs anidados)
            elDOM.innerHTML = `<img src="${p.link_pin || logoSeguro}" class="pin-img" onerror="window.imagenRotaToGlass(this, '${nombreLimpio}')">`;

            const popup = new maplibregl.Popup({ offset: 22, closeButton: false, closeOnClick: true, maxWidth: 'none' })
                .setHTML(htmlPopup);

            const marker = new maplibregl.Marker({ element: elDOM, anchor: 'center' })
                .setLngLat([pos.lng, pos.lat])
                .setPopup(popup)
                .addTo(mapa);

            if (esAliado) {
                elDOM.addEventListener('click', function(e) {
                    if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
                    elDOM.style.animation = 'none'; // Aplicamos animación directo a elDOM
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            elDOM.style.animation = 'saltoMoneda 0.6s ease-out forwards';
                        });
                    });
                    setTimeout(() => { elDOM.style.animation = 'flotarMoneda 2.5s infinite ease-in-out'; }, 600);
                });
            }
            window.marcadoresRadar[p.codigo] = marker;
        }

        window.cerrarTarjetaInmueble = function(event, elemento) {
            event.stopPropagation(); 
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
};


window.cargarCaballoTroya = function() {
    if(!dbTroya || dbTroya.length === 0) return;
    const troyasActivos = dbTroya.filter(t => t.activo === true || t.activo === "SI");
    if (troyasActivos.length > 0) {
        document.getElementById('img-troya').src = troyasActivos[0].imagen_16_9 || dbSimbologia['banner_noticias_generico'];
        document.getElementById('link-troya').href = troyasActivos[0].link_accion || '#';
        document.getElementById('contenedor-troya').style.display = 'block';
    }
};

document.getElementById('input-buscador').addEventListener('input', (e) => {
    clearTimeout(window.timerBusqueda);
    window.timerBusqueda = setTimeout(() => { if(datosDescargados) barridoRadar(e.target.value); }, 400);
});

window.toggleSubmenu = () => document.getElementById('submenu-llave').classList.toggle('activo');
window.abrirModal = (id) => document.getElementById(id).classList.add('activo');
window.cerrarModalFuera = (e, id) => { if(e.target.id === id) document.getElementById(id).classList.remove('activo'); };

function aplicarSwipeAbajo(modalId, contentId) {
    const modal = document.getElementById(modalId);
    const content = document.getElementById(contentId);
    let startY = 0, currentY = 0;
    content.addEventListener('touchstart', e => startY = e.touches[0].clientY, {passive: true});
    content.addEventListener('touchmove', e => { 
        currentY = e.touches[0].clientY; 
        if(currentY > startY && content.scrollTop === 0) content.style.transform = `translateY(${currentY - startY}px)`; 
    }, {passive: true});
    content.addEventListener('touchend', () => { 
        if (currentY - startY > 100 && content.scrollTop === 0) modal.classList.remove('activo'); 
        content.style.transform = ''; 
    });
}

aplicarSwipeAbajo('modal-login', 'sheet-login'); 
aplicarSwipeAbajo('overlay-compartir', 'sheet-compartir'); 
aplicarSwipeAbajo('modal-soporte', 'sheet-soporte');

// ========================================================================
// 🧭 MÓDULO DE BRÚJULA Y GIROSCOPIO NATIVO (MapLibre Bearing)
// ========================================================================
window.orientacionActiva = false;

window.manejarOrientacion = function(e) {
    if (!window.orientacionActiva || !window.mapa) return;
    
    let compassHeading;
    if (e.webkitCompassHeading !== undefined) {
        compassHeading = e.webkitCompassHeading;
    } else if (e.absolute === true && e.alpha !== null) {
        compassHeading = 360 - e.alpha;
    }

    if (compassHeading !== undefined) {
        window.mapa.setBearing(compassHeading);
    }
};

// ========================================================================
// 🎥 CINEMÁTICA DE CÁMARA (TRANSICIÓN 2D A 2.5D) CON GIROSCOPIO
// ========================================================================
window.isRadar3DActivo = false;

window.toggleRadarInmersivo = function(btnElement) {
    if (!window.mapa) return;
    if (navigator.vibrate) navigator.vibrate([30, 50, 30]);

    window.isRadar3DActivo = !window.isRadar3DActivo;

    if (window.isRadar3DActivo) {
        btnElement.innerText = "🚁 Vista Aérea";
        btnElement.style.background = "rgba(255, 107, 0, 0.2)";
        btnElement.style.borderColor = "#ff6b00";
        btnElement.style.color = "#ff6b00";

        window.mapa.flyTo({
            pitch: 65, 
            zoom: 17.5, 
            duration: 2000, 
            essential: true
        });

        window.orientacionActiva = true;
        
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            DeviceOrientationEvent.requestPermission().then(response => {
                if (response === 'granted') {
                    window.addEventListener('deviceorientation', window.manejarOrientacion, true);
                } else {
                    alert("Para girar el mapa, necesitas permitir el acceso a la brújula.");
                }
            }).catch(console.error);
        } else {
            window.addEventListener('deviceorientationabsolute', window.manejarOrientacion, true);
            window.addEventListener('deviceorientation', window.manejarOrientacion, true);
        }

    } else {
        btnElement.innerText = "🧭 Activar Radar 3D";
        btnElement.style.background = "rgba(0, 255, 255, 0.1)";
        btnElement.style.borderColor = "#0ff";
        btnElement.style.color = "#0ff";

        window.orientacionActiva = false;
        window.removeEventListener('deviceorientationabsolute', window.manejarOrientacion, true);
        window.removeEventListener('deviceorientation', window.manejarOrientacion, true);

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
    const styles = {
        'satelite': './estilo-fresco.json',
        'rayosx': './estilo-fresco.json',
        'lite': './estilo-fresco.json'
    };
    if (window.mapa) window.mapa.setStyle(styles[tipo]);
    
    const panel = document.querySelector('.maplibregl-canvas');
    
    if (tipo === 'satelite') {
        panel.style.filter = "invert(95%) hue-rotate(180deg) brightness(125%) contrast(80%)";
    } else if (tipo === 'rayosx') {
        panel.style.filter = "invert(100%) sepia(100%) hue-rotate(355deg) saturate(1500%) contrast(1.3) brightness(1.1)";
    } else {
        panel.style.filter = "none";
    }
    
    if (['satelite'].includes(tipo)) {
        document.body.classList.add('ui-light');
    } else {
        document.body.classList.remove('ui-light');
    }
    
    document.querySelectorAll('.map-tag:not(#btn-giro-toggle)').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    
    const btnGiro = document.getElementById('btn-giro-toggle');
    if (tipo === 'rayosx') {
        btnGiro.style.display = 'block';
    } else {
        btnGiro.style.display = 'none';
        if(window.isRadar3DActivo) window.toggleRadarInmersivo(btnGiro);
    }
};

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

        const centroLat = 7.9301874;
        const centroLng = -72.2442390;
        
        const matriz = [
            "1111 0 1111 0 1000 0 1 0 1111   000   1110  0 1 0  10   000   111 0  10  0 111 0  10",
            "1000 0 1000 0 1000 0 1 0 0001   000   1001  0 1 0 101   000   101 0 101  0 101 0 101",
            "1110 0 1110 0 1000 0 1 0 0010   000   1001  0 1 0 111   000   101 0 111  0 101 0 111",
            "1000 0 1000 0 1000 0 1 0 0100   000   1001  0 1 0 101   000   101 0 101  0 101 0 101",
            "1000 0 1111 0 1111 0 1 0 1111   000   1110  0 1 0 101   000   101 0 101  0 101 0 101"
        ];

        let indexFoto = 0;
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

                    const tarjetaAmor = `
                        <div style="text-align: center; width: 140px; padding: 5px;">
                            <img src="${urlFoto}" onclick="window.abrirFotoNieves('${urlFoto}')" style="width:100%; height:130px; object-fit:cover; border-radius:8px; margin-bottom: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); cursor: zoom-in;">
                            <h4 style="color: var(--naranja); margin: 0; font-size: 14px; font-weight: 900;">¡FELIZ DÍA! 🌸</h4>
                            <p style="margin: 3px 0 5px 0; font-size: 10px; color: #ddd; font-weight: bold;">Toca la foto para ampliarla.</p>
                        </div>
                    `;

                    const elDOMNieves = document.createElement('div');
                    elDOMNieves.innerHTML = htmlInterno;

                    const popupNieves = new maplibregl.Popup({ offset: 15, closeButton: false }).setHTML(tarjetaAmor);

                    new maplibregl.Marker({ element: elDOMNieves, anchor: 'center' })
                        .setLngLat([lngPin, latPin])
                        .setPopup(popupNieves)
                        .addTo(mapa);
                }
            }
        }
        
        mapa.flyTo([centroLat, centroLng], 16, { animate: true, duration: 2.5 });
        setTimeout(window.detonarCelebracionNieves, 2600);

    } catch (error) {
        alert("⚠️ Error en el Protocolo Nieves: " + error.message);
        console.error(error);
    }
};

window.abrirFotoNieves = function(url) {
    let visor = document.getElementById('visor-nieves-fs');
    if (!visor) {
        visor = document.createElement('div');
        visor.id = 'visor-nieves-fs';
        visor.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.95); z-index: 99999999; display: flex; justify-content: center; align-items: center; opacity: 0; transition: opacity 0.3s ease; flex-direction: column;';
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

window.detonarCelebracionNieves = function() {
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 500]); 
    const frag = document.createDocumentFragment();

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

    const emojis = ['🌸', '✨', '💖', '🌺', '🌷', '💮'];
    for (let i = 0; i < 40; i++) {
        const conf = document.createElement('div');
        conf.className = "flor-voladora";
        conf.innerText = emojis[Math.floor(Math.random() * emojis.length)];
        const tiempoCaida = Math.random() * 7 + 8; 
        conf.style.cssText = `position: fixed; top: -50px; left: ${Math.random() * 100}vw; font-size: ${Math.random() * 25 + 15}px; z-index: 999999; pointer-events: none; transition: top ${tiempoCaida}s linear, transform ${tiempoCaida}s ease-in-out; opacity: 0.9;`;
        frag.appendChild(conf);

        requestAnimationFrame(() => {
            setTimeout(() => {
                conf.style.top = '120vh'; 
                conf.style.transform = `rotate(${Math.random() * 360 + 360}deg) translateX(${Math.random() * 200 - 100}px)`;
            }, Math.random() * 2000); 
        });
    }
    document.body.appendChild(frag);

    setTimeout(() => {
        const mensaje = document.getElementById('mensaje-madre');
        if(mensaje) {
            mensaje.style.opacity = '0';
            mensaje.style.transform = 'translate(-50%, -50%) scale(1.2)';
            setTimeout(() => mensaje.remove(), 1000);
        }
    }, 12000);

    setTimeout(() => {
        document.querySelectorAll('.flor-voladora').forEach(el => el.remove());
    }, 17000);
};

// =================================================================
// 🗺️ MINIMAPA WIZARD BÓVEDA (Aislamiento Arquitectónico)
// =================================================================
window.instanciarMinimapaBoveda = function(contenedorId, lat = 4.8133, lng = -75.6961) {
    if (typeof maplibregl === 'undefined') return null;
    
    const miniMapa = new maplibregl.Map({
        container: contenedorId,
        style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        center: [lng, lat],
        zoom: 16,
        attributionControl: false
    });
    
    const elPunto = document.createElement('div');
    elPunto.innerHTML = '<div class="pin-wrapper pin-1" style="--color-main: var(--naranja); --color-sec: #000; width: 34px; height: 34px;"><div class="pin-img" style="background: var(--naranja);"></div></div>';
    
    const marker = new maplibregl.Marker({ element: elPunto, draggable: true })
        .setLngLat([lng, lat])
        .addTo(miniMapa);
        
    marker.on('dragstart', () => document.getElementById(contenedorId).style.transform = 'scale(0.98)');
    marker.on('dragend', () => document.getElementById(contenedorId).style.transform = 'scale(1)');
    
    return { 
        mapa: miniMapa, marcador: marker,
        irUbicacionActual: function() {
            if(navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(pos => {
                    const nLat = pos.coords.latitude, nLng = pos.coords.longitude;
                    miniMapa.flyTo({ center: [nLng, nLat], zoom: 17 }); 
                    marker.setLngLat([nLng, nLat]);
                });
            }
        },
        buscarDireccion: async function(texto) {
            if(!texto) return;
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(texto)}&countrycodes=co`);
            const data = await res.json();
            if(data && data.length > 0) {
                miniMapa.flyTo({ center: [parseFloat(data[0].lon), parseFloat(data[0].lat)], zoom: 17 }); 
                marker.setLngLat([parseFloat(data[0].lon), parseFloat(data[0].lat)]);
            }
        }
    };
};
