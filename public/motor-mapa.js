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

// === ESPIA DE SESION PARA REGLA DEL DUENO ===
window.idUsuarioActual = null;
GeokatuDB.SecurityService.observarEstadoSesion(async (user) => {
    if (user) {
        window.idUsuarioActual = user.uid;
        try {
            const resDetalles = await GeokatuDB.LocalService.getDetails(user.uid);
            if (resDetalles.success && resDetalles.data && resDetalles.data.Coordenadas) {
                const c = resDetalles.data.Coordenadas;
                const latPropia = c.latitude || c._lat || c.lat;
                const lngPropia = c.longitude || c._long || c.lng;
                if (latPropia && lngPropia) {
                    const docPropio = {
                        ...resDetalles.data,
                        codigo: user.uid,
                        Coordenadas: { latitude: Number(latPropia), longitude: Number(lngPropia) }
                    };
                    dbDirectorioMap.set(user.uid, docPropio);
                    dbDirectorio = Array.from(dbDirectorioMap.values());
                    datosDescargados = true;
                }
            }
        } catch (e) {
            console.warn("[Radar] Precarga directa del comercio propio no completada:", e.message);
        }

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
    if (!valorInt64 || isNaN(valorInt64)) return moneda === 'USD' ? '0.00':'0';
    const valor = parseInt(valorInt64, 10);
    if (moneda === 'USD') {
        return (valor / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    }
    return '$' + valor.toLocaleString('es-CO');
};

window.calcularPaletaAureaSilenciosa = function(c1, c2, c3, c4) {
    var primario = c1 || '#ff6b00';
    var grisGeokatu = '#8a909d';
    var blanco = '#ffffff';
    var oscuro = '#0a0a0c';

    var final1 = primario;
    var final2 = c2 ? c2 : grisGeokatu;
    // Botón CATÁLOGO asume c2 si solo hay 2 colores, o c1 si solo hay 1 color
    var final3 = c3 ? c3 : (c2 ? c2 : primario);
    var final4 = c4 ? c4 : (c3 ? grisGeokatu : (c2 ? grisGeokatu : blanco));

    return {
        c1: final1,
        c2: final2,
        c3: final3,
        c4: final4
    };
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

// =========================================================================
// MOTOR DE EVALUACIÓN DE HORARIOS & BANNERS EN POPUP (MAPLIBRE)
// =========================================================================
window.evaluarHorarioComercio = function(p) {
    if (!p) return { abierto: true, texto: "Horario no especificado", color: "#8a909d", icono: "🕒" };

    // 1. Caso 24 Horas
    if (p.es_24_horas === true || (p.horario && p.horario.toLowerCase().includes("24"))) {
        return {
            abierto: true,
            texto: "Abierto 24 Horas",
            color: "#00ff64",
            icono: "⚡",
            abreA: null,
            cierraA: null
        };
    }

    // 2. Extraer horas de apertura y cierre desde formato estándar o string "08:00 - 20:00"
    let hDesde = p.horario_apertura || null;
    let hHasta = p.horario_cierre || null;

    if (!hDesde || !hHasta) {
        const horarioRaw = String(p.horario || '');
        const matches = horarioRaw.match(/(\d{1,2}:\d{2}(?:\s*[AaPp][Mm])?)/g);
        if (matches && matches.length >= 2) {
            hDesde = matches[0];
            hHasta = matches[1];
        }
    }

    if (!hDesde || !hHasta) {
        const texto = (p.horario && p.horario !== "No registra") ? `Horario: ${p.horario}` : "Horario no especificado";
        return { abierto: true, texto: texto, color: "#8a909d", icono: "🕒" };
    }

    // 3. Conversión matemática a minutos del día
    const parsearMinutos = (str) => {
        const esPM = /pm/i.test(str);
        const esAM = /am/i.test(str);
        const partes = str.replace(/[a-zA-Z]/g, '').trim().split(':');
        let h = parseInt(partes[0], 10);
        let m = parseInt(partes[1] || 0, 10);
        if (esPM && h < 12) h += 12;
        if (esAM && h === 12) h = 0;
        return h * 60 + m;
    };

    try {
        const ahora = new Date();
        const minActual = ahora.getHours() * 60 + ahora.getMinutes();
        const minDesde = parsearMinutos(hDesde);
        const minHasta = parsearMinutos(hHasta);

        let abierto = false;
        if (minHasta < minDesde) {
            // Turno nocturno que cruza medianoche (ej: 18:00 a 02:00)
            abierto = (minActual >= minDesde || minActual <= minHasta);
        } else {
            abierto = (minActual >= minDesde && minActual <= minHasta);
        }

        if (abierto) {
            return {
                abierto: true,
                texto: `Abierto ahora • Cierra a las ${hHasta.trim()}`,
                color: "#00ff64",
                icono: "🟢"
            };
        } else {
            return {
                abierto: false,
                texto: `Cerrado ahora • Abre a las ${hDesde.trim()}`,
                color: "#ffaa00",
                icono: "🕒"
            };
        }
    } catch (e) {
        return { abierto: true, texto: `Horario: ${p.horario}`, color: "#8a909d", icono: "🕒" };
    }
};

// Controladores de carteles temporizados (3.5s verificación / 4.5s horario)
window.mostrarAvisoVerificacionModal = function(idModalOverlay, idOtroOverlay) {
    if (idOtroOverlay) {
        const otro = document.getElementById(idOtroOverlay);
        if (otro) otro.style.display = 'none';
    }
    const el = document.getElementById(idModalOverlay);
    if (!el) return;
    if (navigator.vibrate) navigator.vibrate(25);
    el.style.display = 'flex';
    clearTimeout(el._timerDesvanecer);
    el._timerDesvanecer = setTimeout(() => {
        if (el) el.style.display = 'none';
    }, 3500);
};

window.mostrarAvisoHorarioModal = function(idModalOverlay, idOtroOverlay) {
    if (idOtroOverlay) {
        var otro = document.getElementById(idOtroOverlay);
        if (otro) otro.style.display = 'none';
    }
    var el = document.getElementById(idModalOverlay);
    if (!el) return;
    if (navigator.vibrate) navigator.vibrate(25);
    el.style.display = 'flex';
    clearTimeout(el._timerDesvanecer);
    el._timerDesvanecer = setTimeout(function() {
        if (el) el.style.display = 'none';
    }, 4500);
};

// --- MOTOR DE CONTRASTE YIQ DINÁMICO ---
window.obtenerLuminanciaYIQ = function(hexColor) {
    if (!hexColor || typeof hexColor !== 'string') return 128;
    var clean = hexColor.replace('#', '').trim();
    if (clean.length === 3) {
        clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
    }
    if (clean.length !== 6) return 128;
    var r = parseInt(clean.substring(0, 2), 16) || 0;
    var g = parseInt(clean.substring(2, 4), 16) || 0;
    var b = parseInt(clean.substring(4, 6), 16) || 0;
    return ((r * 299) + (g * 587) + (b * 114)) / 1000;
};

window.resolverEstiloBotonAccion = function(colorBoton, esTemaClasico) {
    var cBtn = colorBoton || '#ff6b00';
    var yiq = window.obtenerLuminanciaYIQ(cBtn);

    // Si el fondo del botón es claro (ej: blanco en Domino's), texto negro. Si es oscuro, texto blanco.
    var colorTexto = (yiq >= 145) ? '#0a0a0c' : '#ffffff';
    var estiloBorde = 'border: none;';
    var estiloSombra = 'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);';

    if (!esTemaClasico && yiq < 40) {
        estiloBorde = 'border: 1px solid rgba(255, 255, 255, 0.3);';
        estiloSombra = 'box-shadow: 0 4px 14px rgba(0, 0, 0, 0.85);';
    } else if (esTemaClasico && yiq > 215) {
        estiloBorde = 'border: 1px solid rgba(0, 0, 0, 0.22);';
        estiloSombra = 'box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);';
    }

    return {
        bg: cBtn,
        color: colorTexto,
        borde: estiloBorde,
        sombra: estiloSombra
    };
};

// --- CONTROLADOR DE LA VENTANA EMERGENTE DE CONTACTO DELICADA ---
window.abrirHubContactoDinamico = async function(codigoComercio, hubId, e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    if (navigator.vibrate) navigator.vibrate(25);
    var hub = document.getElementById(hubId);
    if (!hub) return;

    var yaAbierto = hub.classList.contains('activo');
    document.querySelectorAll('.popup-hub-menu').forEach(function(m) {
        m.classList.remove('activo');
    });
    if (yaAbierto) return;

    // Estado visual de carga inmediata
    hub.innerHTML = '<span style="font-size:10px; color:#aaa; padding:6px 10px; display:block;">Conectando... ⏳</span>';
    hub.classList.add('activo');

    // 1. Respaldo en memoria del radar (0 ms)
    var localMem = dbDirectorioMap.get(String(codigoComercio)) || {};
    var waMem = (localMem.whatsapp || localMem.whatsApp || (localMem.telefonos && localMem.telefonos[0]) || '').toString().replace(/\D/g, '');
    var pbxMem = (localMem.pbx || '').toString().trim();

    // 2. Hidratacion bajo demanda con fallback automatico a memoria local
    var c = {};
    try {
        var res = await GeokatuDB.LocalService.obtenerContactoComercio(codigoComercio);
        if (res && res.success && res.data) {
            c = res.data;
        }
    } catch (eHub) {}

    var fonoWa = (c.whatsapp || c.whatsApp || (c.telefonos && c.telefonos[0]) || waMem || '').toString().replace(/\D/g, '');
    var fonoPbx = (c.pbx || pbxMem || '').toString().trim();
    if (!fonoWa && !fonoPbx) {
        hub.innerHTML = '<span style="font-size:10px; color:#ffaa00; padding:6px 10px; display:block;">Sin canales activos</span>';
        setTimeout(function() { hub.classList.remove('activo'); }, 2200);
        return;
    }
    var htmlCanales = '';

    if (fonoWa && fonoWa.length >= 7) {
        var numWaFinal = fonoWa.length === 10 ? ('57' + fonoWa) : fonoWa;
        htmlCanales += 
            '<a href="https://wa.me/' + numWaFinal + '" target="_blank" class="item-hub-canal item-hub-wa" onclick="window.cerrarHubContactoPopup(event)">' +
                '<svg width="15" height="15" viewBox="0 0 24 24" fill="#25D366"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>' +
                '<span>WhatsApp</span>' +
            '</a>';
    }
    if (fonoPbx && fonoPbx.length >= 5) {
        htmlCanales += 
            '<a href="tel:' + fonoPbx.replace(/\D/g, '') + '" class="item-hub-canal item-hub-pbx" onclick="window.cerrarHubContactoPopup(event)">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>' +
                '<span>PBX: ' + window.sanitizarTexto(fonoPbx) + '</span>' +
            '</a>';
    }

    hub.innerHTML = htmlCanales || '<span style="font-size:10px; color:#aaa; padding:6px 10px; display:block;">Sin canales disponibles</span>';
};


window.cerrarHubContactoPopup = function(e) {
    if (e) e.stopPropagation();
    document.querySelectorAll('.popup-hub-menu').forEach(function(m) {
        m.classList.remove('activo');
    });
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
    { id: 'pulso', nombre: 'PULSO', tipo: 'portal_externo', link: '/pulso' }
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
// =========================================================================
// 🚀 CONECTORES DE MATRIZ OFFLINE (0 MS) Y DELTA REACTIVO
// =========================================================================
window.desempaquetarComercioMatriz = function(item) {
    if (!item) return null;
    var idStr = String(item.id || item.codigo || '');
    var lat = null, lng = null;

    if (Array.isArray(item.g) && item.g.length >= 2) {
        lat = item.g[0];
        lng = item.g[1];
    } else if (item.Coordenadas) {
        lat = item.Coordenadas.latitude || item.Coordenadas._lat || item.Coordenadas.lat;
        lng = item.Coordenadas.longitude || item.Coordenadas._long || item.Coordenadas.lng;
    } else {
        lat = item.lat;
        lng = item.lng;
    }

    lat = parseFloat(lat);
lng = parseFloat(lng);
if (isNaN(lat) || isNaN(lng)) return null;

    var colores = Array.isArray(item.b) ? item.b : [
        item.color_principal || '#ff6b00',
        item.color_acento || '#8a909d',
        item.color_terciario || '#ffffff',
        item.color_cuaternario || '#0a0a0c'
    ];
    var flags = Number(item.f || 0);

    return {
        id: idStr,
        codigo: idStr,
        nombre: item.n || item.nombre || 'Comercio Aliado',
        slogan: item.s || item.slogan || '',
        nicho: item.c || item.nicho || item.categoria || 'General',
        categoria: item.c || item.categoria || item.nicho || 'General',
        Coordenadas: { latitude: Number(lat), longitude: Number(lng) },
        lat: Number(lat),
        lng: Number(lng),
        pin_pack: item.p || item.pin_pack || 'forma-gota|anim-salto',
        color_principal: colores[0] || '#ff6b00',
        color_acento: colores[1] || '#8a909d',
        color_terciario: colores[2] || '#ffffff',
        color_cuaternario: colores[3] || '#0a0a0c',
        paleta_aurea: {
            c1: colores[0] || '#ff6b00',
            c2: colores[1] || '#8a909d',
            c3: colores[2] || '#ffffff',
            c4: colores[3] || '#0a0a0c'
        },
        logo: item.logo || item.l || '',
        portada: item.portada || item.l || '',
        link_pin: item.link_pin || item.logo || item.l || '',
        nombre_png: item.nombre_png || item.logo_nombre || '',
        tema_popup: item.tema_popup || 'carbon',
        whatsapp: item.whatsapp || item.whatsApp || '',
        whatsApp: item.whatsapp || item.whatsApp || '',
        pbx: item.pbx || '',
        horario: item.horario || ((flags & 4) ? '24 Horas' : ''),
        es_24_horas: Boolean((flags & 4) || item.es_24_horas),
        verificado_geokatu: Boolean((flags & 8) || item.verificado_maps === 'SI' || item.verificado_geokatu),
        tipo_modelo: item.tipo_modelo || 'negocio',
        estado_moderacion: item.estado_moderacion || 'aprobado'
    };
};

window.cargarDirectorioMatrizOffline = async function() {
    try {
        if (!GeokatuDB || !GeokatuDB.DirectorioMatrizService) return;

        // 1. Hidratación en IndexedDB desde directorio_matriz.json (0 ms)
        await GeokatuDB.DirectorioMatrizService.inicializarDirectorio();
        var comerciosMatriz = await GeokatuDB.DirectorioMatrizService.obtenerTodosComercios();

        if (comerciosMatriz && comerciosMatriz.length > 0) {
            comerciosMatriz.forEach(function(item) {
                var seguro = window.desempaquetarComercioMatriz(item);
                if (seguro) dbDirectorioMap.set(seguro.codigo, seguro);
            });

            dbDirectorio = Array.from(dbDirectorioMap.values());
            datosDescargados = true;

            // 2. Renderizado instantáneo de pines en el canvas
            if (typeof window.barridoRadar === 'function') {
                window.barridoRadar();
            }
            console.log('[Radar 0ms] ' + comerciosMatriz.length + ' comercios renderizados desde almacenamiento local.');
        }
    } catch (err) {
        console.warn('[Radar] Fallo inicializando matriz offline:', err.message);
    }
};

window.iniciarSincronizacionDelta = function() {
    try {
        if (!GeokatuDB || !GeokatuDB.DirectorioMatrizService) return;

        // Corte temporal de las últimas 24 horas por defecto
        var timestampCorte = localStorage.getItem('geokatu_matriz_timestamp') || new Date(Date.now() - 86400000).toISOString();

        GeokatuDB.DirectorioMatrizService.sincronizarDeltaNube(timestampCorte, function(nuevoComercio) {
            var seguro = window.desempaquetarComercioMatriz(nuevoComercio);
            if (!seguro) return;

            // Inyección atómica en memoria viva
            dbDirectorioMap.set(seguro.codigo, seguro);
            dbDirectorio = Array.from(dbDirectorioMap.values());
            datosDescargados = true;

            if (typeof window.barridoRadar === 'function') {
                var buscador = document.getElementById('input-buscador');
                window.barridoRadar(buscador ? buscador.value : '');
            }
            console.log('[Delta Vivo] Comercio integrado al radar: ' + seguro.nombre);
        });
    } catch (err) {
        console.warn('[Radar] Fallo iniciando sincronización delta:', err.message);
    }
};

window.apagarVeloTour = function() {
    document.querySelectorAll('.tour-parent-lift').forEach(function(el) { el.classList.remove('tour-parent-lift'); });
    document.querySelectorAll('.tour-highlight-z').forEach(function(el) { el.classList.remove('tour-highlight-z'); });
    document.querySelectorAll('.tour-tooltip').forEach(function(el) { el.classList.remove('activo'); });
    document.body.classList.remove('tour-active');
    const tourOv = document.getElementById('tour-overlay');
    if (tourOv) {
        tourOv.classList.remove('activo');
        tourOv.style.opacity = '0';
        tourOv.style.pointerEvents = 'none';
        tourOv.style.display = 'none';
    }
};

window.apagarVeloTour = function() {
    document.querySelectorAll('.tour-parent-lift').forEach(function(el) { el.classList.remove('tour-parent-lift'); });
    document.querySelectorAll('.tour-highlight-z').forEach(function(el) { el.classList.remove('tour-highlight-z'); });
    document.querySelectorAll('.tour-tooltip').forEach(function(el) { el.classList.remove('activo'); });
    document.body.classList.remove('tour-active');
    const tourOv = document.getElementById('tour-overlay');
    if (tourOv) {
        tourOv.classList.remove('activo');
        tourOv.style.opacity = '0';
        tourOv.style.pointerEvents = 'none';
        tourOv.style.display = 'none';
    }
};

window.arrancarMotor = async function() {
    try {
        if (typeof maplibregl === 'undefined') throw new Error("MapLibre no se descargó. Revisa la conexión o el index.html");
        
        if (typeof pmtiles !== 'undefined') {
            const protocol = new pmtiles.Protocol();
            window.maplibregl.addProtocol("pmtiles", protocol.tile);
        }

        // Limpiar cualquier residuo visual antes de evaluar si corresponde el tour
        window.apagarVeloTour();
        const modalCiudadInit = document.getElementById('modal-selector-ciudad');
        if (modalCiudadInit) {
            modalCiudadInit.classList.remove('activo');
            modalCiudadInit.style.display = 'none';
        }

        construirMapa();

        // CARGA ULTRA-RÁPIDA A 0 MS + SINCRONIZACIÓN DIRECTA CON FIRESTORE
        mapa.once('load', async function() {
            await window.cargarDirectorioMatrizOffline();
            window.iniciarSincronizacionDelta();
            if (typeof window.descargarNegociosDeFirebase === 'function') {
                window.descargarNegociosDeFirebase();
            }
        });

        if (typeof window.construirCarrusel === 'function') {
            window.construirCarrusel();
        }
        sessionStorage.setItem('geokatu_ram_warm', '1');

        setTimeout(function() {
            const pantallaCarga = document.getElementById('pantalla-carga');
            if (pantallaCarga) {
                pantallaCarga.style.opacity = '0';
                pantallaCarga.style.pointerEvents = 'none';
                pantallaCarga.style.display = 'none';
            }
            const buscador = document.getElementById('wrapper-buscador');
            if (buscador) buscador.classList.remove('shimmer-box');

            const params = new URLSearchParams(window.location.search);
            const idDron = params.get('enfocar');
            const latDron = parseFloat(params.get('lat'));
            const lngDron = parseFloat(params.get('lng'));

            if (idDron && !isNaN(latDron) && !isNaN(lngDron)) {
                categoriaActivaGlobal = (params.get('tipo') === 'inmueble') ? 'inmuebles' : 'negocios';
                mapa.flyTo({ center: [lngDron, latDron], zoom: 17.5, duration: 1200 });
                zonaNecesitaDescarga = true;
                if (typeof window.descargarNegociosDeFirebase === 'function') {
                    window.descargarNegociosDeFirebase();
                }
                setTimeout(function() {
                    if (window.marcadoresRadar && window.marcadoresRadar[idDron]) {
                        window.marcadoresRadar[idDron].togglePopup();
                    }
                }, 1300);
                window.history.replaceState(null, '', window.location.pathname);
            } else {
                // Si el usuario borró caché y entra desde cero, lanzar el Tour Inicial
                const tourYaVisto = localStorage.getItem('geokatu_tour_v1') === 'true';
                if (!tourYaVisto) {
                    if (typeof window.descargarNegociosDeFirebase === 'function') {
                        window.descargarNegociosDeFirebase();
                    }
                    setTimeout(function() {
                        window.iniciarTour();
                    }, 350);
                } else {
                    window.solicitarGPSInicial();
                }
            }
        }, 120);

        try {
            const resTroya = await GeokatuDB.LocalService.obtenerCaballoTroya();
            dbTroya = (resTroya && resTroya.success && resTroya.data) ? resTroya.data : [];
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

window.validarGeocercaOperativa = function(lat, lng) {
    const dentroLat = lat >= -4.5 && lat <= 16.0;
    const dentroLng = lng >= -82.0 && lng <= -59.5;
    return dentroLat && dentroLng;
};

window.mostrarCartelFueraDeZona = function() {
    const toast = document.getElementById('toast-fantasma');
    if (toast) {
        toast.innerText = "Esta plataforma funciona solo en Colombia o Venezuela";
        toast.style.background = "rgba(180, 20, 20, 0.95)";
        toast.style.borderColor = "#ff4444";
        toast.style.opacity = '1';
        setTimeout(function() {
            toast.style.opacity = '0';
            toast.style.background = "";
            toast.style.borderColor = "";
        }, 6000);
    }
};

const CIUDADES_REFERENCIA_GEO = [
    { nombre: "Bogotá, Colombia", lat: 4.6097, lng: -74.0817 },
    { nombre: "Medellín, Colombia", lat: 6.2476, lng: -75.5658 },
    { nombre: "Cali, Colombia", lat: 3.4516, lng: -76.5320 },
    { nombre: "Barranquilla, Colombia", lat: 10.9685, lng: -74.7813 },
    { nombre: "Pereira, Colombia", lat: 4.8133, lng: -75.6961 },
    { nombre: "Caracas, Venezuela", lat: 10.4806, lng: -66.9036 },
    { nombre: "Maracaibo, Venezuela", lat: 10.6666, lng: -71.6124 },
    { nombre: "Valencia, Venezuela", lat: 10.1620, lng: -68.0077 },
    { nombre: "Táchira (Lobatera / San Cristóbal), Venezuela", lat: 7.7794, lng: -72.2247 }
];

window.filtrarCiudadesSugeridas = function(texto) {
    const queryTxt = String(texto || '').toLowerCase().trim();
    const contenedor = document.getElementById('lista-ciudades-sugeridas');
    if (!contenedor) return;
    
    const filtradas = CIUDADES_REFERENCIA_GEO.filter(function(c) {
        return c.nombre.toLowerCase().includes(queryTxt);
    });
    if (filtradas.length === 0) {
        contenedor.innerHTML = '<div style="padding: 8px; font-size: 11px; color: #888; text-align: center;">No hay coincidencias en la lista rápida. Usa la lupa superior del mapa para buscar cualquier lugar.</div>';
        return;
    }
    
    contenedor.innerHTML = filtradas.map(function(c) {
        const nombreSeguro = String(c.nombre || '').replace(/'/g, "\\'");
        return '<div onclick="window.fijarCiudadManual(' + c.lat + ', ' + c.lng + ', \'' + nombreSeguro + '\')" style="padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: bold;">' +
            '📍 ' + window.sanitizarTexto(c.nombre) +
        '</div>';
    }).join('');
};

window.fijarCiudadManual = function(lat, lng, nombre) {
    localStorage.setItem('geokatu_ciudad_manual', JSON.stringify({ lat: lat, lng: lng, nombre: nombre }));
    const modal = document.getElementById('modal-selector-ciudad');
    if (modal) {
        modal.classList.remove('activo');
        modal.style.display = 'none';
    }
    const pantallaCarga = document.getElementById('pantalla-carga');
    if (pantallaCarga) {
        pantallaCarga.style.opacity = '0';
        pantallaCarga.style.pointerEvents = 'none';
        setTimeout(function() { pantallaCarga.style.display = 'none'; }, 300);
    }
    if (window.mapa) {
        window.mapa.flyTo({ center: [lng, lat], zoom: 15, duration: 1500 });
    }
    setTimeout(function() {
        if (typeof window.descargarNegociosDeFirebase === 'function') {
            window.descargarNegociosDeFirebase();
        }
    }, 1200);
};

window.usarUbicacionPorDefectoPereira = function() {
    window.fijarCiudadManual(4.8133, -75.6961, 'Pereira, Colombia');
};

window.solicitarGPSInicial = function() {
    const pantallaCarga = document.getElementById('pantalla-carga');
    if (pantallaCarga) {
        pantallaCarga.style.opacity = '0';
        pantallaCarga.style.pointerEvents = 'none';
        setTimeout(function() { pantallaCarga.style.display = 'none'; }, 300);
    }

    if (typeof window.descargarNegociosDeFirebase === 'function') {
        window.descargarNegociosDeFirebase();
    }

    const guardada = localStorage.getItem('geokatu_ciudad_manual');
    if (guardada) {
        try {
            const parsed = JSON.parse(guardada);
            if (parsed && !isNaN(parsed.lat) && !isNaN(parsed.lng)) {
                if (window.mapa) {
                    window.mapa.flyTo({ center: [parsed.lng, parsed.lat], zoom: 15, duration: 1200 });
                }
                return;
            }
        } catch (e) {}
    }

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function(pos) {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                if (window.mapa) {
                    window.mapa.flyTo({ center: [lng, lat], zoom: 15, duration: 1200 });
                }
                setTimeout(function() {
                    if (typeof window.descargarNegociosDeFirebase === 'function') {
                        window.descargarNegociosDeFirebase();
                    }
                }, 1250);
            },
            function() {
                // Si el usuario rechaza o no tiene GPS activo, operamos fluidamente en Pereira por defecto sin bloquear la pantalla con overlays
                localStorage.setItem('geokatu_ciudad_manual', JSON.stringify({ lat: 4.8133, lng: -75.6961, nombre: 'Pereira, Colombia' }));
            },
            { enableHighAccuracy: false, timeout: 4500, maximumAge: 300000 }
        );
    }
};

window.iniciarTour = function() {
    const modalCiudad = document.getElementById('modal-selector-ciudad');
    if (modalCiudad) {
        modalCiudad.classList.remove('activo');
        modalCiudad.style.display = 'none';
    }

    document.body.classList.add('tour-active');
    const tourOv = document.getElementById('tour-overlay');
    if (tourOv) {
        tourOv.style.display = 'block';
        tourOv.style.opacity = '1';
        tourOv.style.pointerEvents = 'auto';
        tourOv.classList.add('activo');
    }

    const cajaTop = document.getElementById('caja-buscador');
    const wrapper = document.getElementById('wrapper-buscador');
    if (cajaTop) cajaTop.classList.add('tour-parent-lift');
    if (wrapper) wrapper.classList.add('tour-highlight-z');

    const tooltip1 = document.getElementById('tour-step-1');
    if (tooltip1) tooltip1.classList.add('activo');
};

window.siguienteTour1 = function() {
    const cajaTop = document.getElementById('caja-buscador');
    const wrapper = document.getElementById('wrapper-buscador');
    if (cajaTop) cajaTop.classList.remove('tour-parent-lift');
    if (wrapper) wrapper.classList.remove('tour-highlight-z');
    document.getElementById('tour-step-1')?.classList.remove('activo');

    const btnHerramientas = document.getElementById('btn-herramientas-contenedor');
    if (btnHerramientas) {
        btnHerramientas.classList.add('tour-parent-lift');
        btnHerramientas.classList.add('tour-highlight-z');
    }

    const tooltipScan = document.getElementById('tour-step-escaner');
    if (tooltipScan) tooltipScan.classList.add('activo');
};

window.siguienteTourEscaner = function() {
    const btnHerramientas = document.getElementById('btn-herramientas-contenedor');
    if (btnHerramientas) {
        btnHerramientas.classList.remove('tour-parent-lift');
        btnHerramientas.classList.remove('tour-highlight-z');
    }
    document.getElementById('tour-step-escaner')?.classList.remove('activo');

    const parentCtrl = document.querySelector('.maplibregl-ctrl-bottom-right');
    if (parentCtrl && parentCtrl.parentElement !== document.body) {
        document.body.appendChild(parentCtrl);
    }
    const btnGps = document.querySelector('.maplibregl-ctrl-group') || document.querySelector('.maplibregl-ctrl-geolocate');
    if (parentCtrl) parentCtrl.classList.add('tour-parent-lift');
    if (btnGps) btnGps.classList.add('tour-highlight-z');

    const tooltip2 = document.getElementById('tour-step-2');
    if (tooltip2) tooltip2.classList.add('activo');
};

window.siguienteTour2 = function() {
    const parentCtrl = document.querySelector('.maplibregl-ctrl-bottom-right');
    const btnGps = document.querySelector('.maplibregl-ctrl-geolocate') || document.querySelector('.maplibregl-ctrl-group');
    if (parentCtrl) parentCtrl.classList.remove('tour-parent-lift');
    if (btnGps) btnGps.classList.remove('tour-highlight-z');
    document.getElementById('tour-step-2')?.classList.remove('activo');

    const cajaTop = document.getElementById('caja-buscador');
    const btnLlave = document.getElementById('btn-portal-mando-contenedor');
    if (cajaTop) cajaTop.classList.add('tour-parent-lift');
    if (btnLlave) btnLlave.classList.add('tour-highlight-z');

    const tooltip3 = document.getElementById('tour-step-3');
    if (tooltip3) tooltip3.classList.add('activo');
};

window.siguienteTour3 = function() {
    const cajaTop = document.getElementById('caja-buscador');
    const btnLlave = document.getElementById('btn-portal-mando-contenedor');
    if (cajaTop) cajaTop.classList.remove('tour-parent-lift');
    if (btnLlave) btnLlave.classList.remove('tour-highlight-z');
    document.getElementById('tour-step-3')?.classList.remove('activo');

    const brujula = document.getElementById('btn-brujula-contenedor');
    if (brujula) {
        brujula.classList.add('tour-parent-lift');
        const btnB = document.getElementById('btn-brujula');
        if (btnB) btnB.classList.add('tour-highlight-z');
    }

    const tooltip4 = document.getElementById('tour-step-4');
    if (tooltip4) tooltip4.classList.add('activo');
};

window.finalizarTour = function() {
    window.apagarVeloTour();
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

window.centrarMapaHardware = function(esArranque = false) {
    if (navigator.vibrate) navigator.vibrate(30);

    const btnNativo = document.querySelector('.maplibregl-ctrl-geolocate');
    if (btnNativo) {
        // Disparar el control oficial de MapLibre para activar el punto y halo del usuario
        btnNativo.click();
    } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;

            if (mapa) {
                mapa.flyTo({ center: [lng, lat], zoom: 16, duration: 2000 });
            }

            if (typeof window.validarGeocercaOperativa === 'function' && !window.validarGeocercaOperativa(lat, lng)) {
                window.mostrarCartelFueraDeZona();
            }

            setTimeout(() => {
                if (window.descargarNegociosDeFirebase) {
                    window.descargarNegociosDeFirebase();
                }
            }, 1200);
        }, (err) => {
            console.warn("[GPS] Permiso no concedido o error:", err.message);
            zonaNecesitaDescarga = true;
            const btnCargar = document.getElementById('btn-cargar-zona');
            if (btnCargar) btnCargar.style.display = 'block';
            if (esArranque && window.descargarNegociosDeFirebase) {
                window.descargarNegociosDeFirebase();
            }
        }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
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
        radiusInM = Math.max(3000, radiusInM);

       let success, arrayNegocios, error;
       if (categoriaActivaGlobal === 'inmuebles') {
            const res = await GeokatuDB.RadarService.buscarInmueblesEnRadar(center[0], center[1], radiusInM);
            success = res.success; arrayNegocios = res.data; error = res.error;
        } else {
            // Solo omitir lectura si ya se hidrato la ciudad completa (> 1 comercio) y no se pidio descarga de zona
            if (window.radarCiudadHidratado === true && dbDirectorioMap.size > 1 && !zonaNecesitaDescarga) {
                if (btn) btn.style.display = 'none';
                if (typeof barridoRadar === "function") {
                    var buscador = document.getElementById('input-buscador');
                    barridoRadar(buscador ? buscador.value : '');
                }
                return;
            }
            const res = await GeokatuDB.RadarService.buscarEnRadar(center[0], center[1], radiusInM);
            success = res.success; arrayNegocios = res.data; error = res.error;
            if (success && Array.isArray(arrayNegocios) && arrayNegocios.length > 0) {
                window.radarCiudadHidratado = true;
            }
        }


        if (!success) throw new Error(error);
        
        if (dbDirectorioMap.size > 1500) {
            const llaves = Array.from(dbDirectorioMap.keys());
            for(let i = 0; i < 500; i++) {
                dbDirectorioMap.delete(llaves[i]);
            }
        }
        arrayNegocios.forEach(data => {
            // ==================== REEMPLAZO QUIRÚRGICO PASO 1 ====================
            const docId = data.id || data.codigo || data.uid;
            if (!docId) return;

            let lat = null, lng = null;

            // 1. Extracción polimórfica (GeoPoint, Coordenadas, minúsculas o plano)
            const coordsObj = data.Coordenadas || data.coordenadas || data.ubicacion;
            if (coordsObj) {
                if (typeof coordsObj.latitude === 'function') lat = coordsObj.latitude();
                else if (coordsObj.latitude !== undefined) lat = coordsObj.latitude;
                else if (coordsObj.lat !== undefined) lat = coordsObj.lat;
                else if (coordsObj._lat !== undefined) lat = coordsObj._lat;

                if (typeof coordsObj.longitude === 'function') lng = coordsObj.longitude();
                else if (coordsObj.longitude !== undefined) lng = coordsObj.longitude;
                else if (coordsObj.lng !== undefined) lng = coordsObj.lng;
                else if (coordsObj._long !== undefined) lng = coordsObj._long;
            } else if (data.lat !== undefined && data.lng !== undefined) {
                lat = data.lat;
                lng = data.lng;
            } else if (data.latitude !== undefined && data.longitude !== undefined) {
                lat = data.latitude;
                lng = data.longitude;
            } else if (data.plusCode && typeof OpenLocationCode !== 'undefined') {
                try {
                    const decoded = OpenLocationCode.decode(data.plusCode);
                    lat = decoded.latitudeCenter;
                    lng = decoded.longitudeCenter;
                } catch (e) {}
            }

            lat = parseFloat(lat);
            lng = parseFloat(lng);
            if (isNaN(lat) || isNaN(lng)) return;

            // 2. Validación de distancia sin descartar por ausencia de geohash
            const distanceInM = calcularDistanciaKm(lat, lng, center[0], center[1]) * 1000;
            if (distanceInM <= (radiusInM * 1.5)) { // Margen de seguridad visual
                const safeData = { 
                    ...data, 
                    codigo: docId,
                    Coordenadas: { latitude: lat, longitude: lng } 
                };
                dbDirectorioMap.set(docId, safeData);
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
    let centroInicial = [-75.6961, 4.8133];
    let zoomInicial = 15;
    try {
        const camRam = sessionStorage.getItem('geokatu_last_cam');
        if (camRam) {
            const parsedCam = JSON.parse(camRam);
            if (parsedCam && !isNaN(parsedCam.lng) && !isNaN(parsedCam.lat)) {
                centroInicial = [Number(parsedCam.lng), Number(parsedCam.lat)];
                zoomInicial = Number(parsedCam.zoom) || 15;
            }
        }
    } catch (eCam) {}

    window.mapa = new maplibregl.Map({
        container: 'mapa-qrpido', 
        style: './estilo-fresco.json', 
        center: centroInicial,
        zoom: zoomInicial,
        minZoom: 13.5,
        maxZoom: 19,
        pitch: 0, 
        bearing: 0, 
        antialias: false 
    });

    mapa = window.mapa; 
    const geolocateControl = new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,       
        showUserHeading: true,         
        fitBoundsOptions: { maxZoom: 16 } 
    });
    geolocateControl.on('geolocate', (e) => {
        if (e && e.coords) {
            const lat = e.coords.latitude;
            const lng = e.coords.longitude;
            if (!window.validarGeocercaOperativa(lat, lng)) {
                window.mostrarCartelFueraDeZona();
            }
        }
        if (window.descargarNegociosDeFirebase) {
            window.descargarNegociosDeFirebase();
        }
    });
    mapa.addControl(geolocateControl, 'bottom-right');
    const ctrlGps = document.querySelector('.maplibregl-ctrl-bottom-right');
    if (ctrlGps && ctrlGps.parentElement !== document.body) {
        document.body.appendChild(ctrlGps);
    }
    window.mapa.on('load', () => {
        console.log("🟢 [WebGL Engine] Mapa base cargado con techo 13.5 - 19.");
    });
    
    let timerMovimiento;
    const UMBRAL_DISTANCIA_METROS = 1500; 
    
    // Hidratador reactivo instantaneo cuando el usuario regresa desde Oficina o Negocio (bfcache / RAM)
    window.sincronizarComerciosEditadosEnRAM = function() {
        let huboCambio = false;
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.indexOf('geokatu_cache_neg_') === 0) {
                    const idNeg = k.replace('geokatu_cache_neg_', '');
                    const rawNeg = localStorage.getItem(k);
                    if (rawNeg) {
                        const datosNuevos = JSON.parse(rawNeg);
                        const previo = dbDirectorioMap.get(idNeg) || {};
                        const latN = (datosNuevos.Coordenadas && datosNuevos.Coordenadas.latitude) || datosNuevos.lat || (previo.Coordenadas && previo.Coordenadas.latitude);
                        const lngN = (datosNuevos.Coordenadas && datosNuevos.Coordenadas.longitude) || datosNuevos.lng || (previo.Coordenadas && previo.Coordenadas.longitude);
                        if (latN && lngN) {
                            const fusionado = Object.assign({}, previo, datosNuevos, {
                                id: idNeg,
                                codigo: idNeg,
                                Coordenadas: { latitude: Number(latN), longitude: Number(lngN) }
                            });
                            dbDirectorioMap.set(idNeg, fusionado);
                            huboCambio = true;
                        }
                    }
                }
            }
        } catch (eSync) {}

        if (huboCambio) {
            dbDirectorio = Array.from(dbDirectorioMap.values());
            datosDescargados = true;
        }
        if (mapa) {
            mapa.resize();
            const idEnfocarRam = sessionStorage.getItem('geokatu_enfocar_ram');
            if (idEnfocarRam) {
                sessionStorage.removeItem('geokatu_enfocar_ram');
                const comercioTarget = dbDirectorioMap.get(idEnfocarRam);
                if (comercioTarget && comercioTarget.Coordenadas) {
                    categoriaActivaGlobal = 'negocios';
                    mapa.flyTo({
                        center: [comercioTarget.Coordenadas.longitude, comercioTarget.Coordenadas.latitude],
                        zoom: 17.5,
                        duration: 900
                    });
                    setTimeout(function() {
                        if (window.marcadoresRadar && window.marcadoresRadar[idEnfocarRam]) {
                            const pop = window.marcadoresRadar[idEnfocarRam].getPopup();
                            if (pop && !pop.isOpen()) window.marcadoresRadar[idEnfocarRam].togglePopup();
                        }
                    }, 950);
                }
            }
            if (typeof window.barridoRadar === 'function' && datosDescargados) {
                const buscador = document.getElementById('input-buscador');
                window.barridoRadar(buscador ? buscador.value : '');
            }
        }
    };

    window.addEventListener('pageshow', function(evt) {
        const pc = document.getElementById('pantalla-carga');
        if (pc) pc.style.display = 'none';
        window.sincronizarComerciosEditadosEnRAM();
    });

    window.addEventListener('storage', function(evt) {
        if (evt.key && evt.key.indexOf('geokatu_cache_neg_') === 0) {
            window.sincronizarComerciosEditadosEnRAM();
        }
    });

    mapa.on('moveend', () => {
        clearTimeout(timerMovimiento);
        try {
            const c = mapa.getCenter();
            sessionStorage.setItem('geokatu_last_cam', JSON.stringify({
                lat: Number(c.lat.toFixed(6)),
                lng: Number(c.lng.toFixed(6)),
                zoom: Number(mapa.getZoom().toFixed(2))
            }));
        } catch (eC) {}
        const mHtml = document.getElementById('mapa-qrpido');
        if (mHtml) mHtml.setAttribute('data-zoom', Math.round(mapa.getZoom()));


        const boundsActuales = mapa.getBounds();
        if (typeof dibujarPinesDesdeJSONCache === "function") {
            dibujarPinesDesdeJSONCache(boundsActuales);
        }
        
        if (mapa.getZoom() < 13.5) return; 
        
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
            
            if (datosDescargados && cajaFuerteEspacial && categoriaActivaGlobal === 'inmuebles') {
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
        }, 220);
    });
    
    const mHtmlInit = document.getElementById('mapa-qrpido');
    if (mHtmlInit) mHtmlInit.setAttribute('data-zoom', Math.round(mapa.getZoom()));
    
    mapa.on('click', () => {
        const panelCristal = document.getElementById('panel-cristal');
        if (panelCristal) panelCristal.classList.add('colapsado');
    });
};
window.resolverUbicacionLocalOffline = function(textoCrudo) {
    const input = String(textoCrudo || '').trim();
    if (!input) return null;
    // 1. Coordenadas directas "lat, lng"
    const regexCoords = /^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/;
    const matchCoords = input.match(regexCoords);
    if (matchCoords) {
        return { lat: parseFloat(matchCoords[1]), lng: parseFloat(matchCoords[2]), zoom: 17, tipo: 'coords' };
    }
    // 2. Plus Code local
    if (typeof OpenLocationCode !== 'undefined' && OpenLocationCode.isValid(input) && OpenLocationCode.isFull(input)) {
        try {
            const decoded = OpenLocationCode.decode(input);
            return { lat: decoded.latitudeCenter, lng: decoded.longitudeCenter, zoom: 17, tipo: 'pluscode' };
        } catch (e) {}
    }
    // 3. Diccionario local de ciudades COL / VEN (0 ms)
    const txtLower = input.toLowerCase();
    const ciudadMatch = CIUDADES_REFERENCIA_GEO.find(function(c) {
        return c.nombre.toLowerCase().includes(txtLower);
    });
    if (ciudadMatch) {
        return { lat: ciudadMatch.lat, lng: ciudadMatch.lng, zoom: 14.5, tipo: 'ciudad' };
    }
    // 4. Busqueda en el directorio local indexado (direcciones, barrios o comercios en RAM)
    if (Array.isArray(dbDirectorio) && dbDirectorio.length > 0) {
        const localMatch = dbDirectorio.find(function(p) {
            const bolsa = ((p.nombre || '') + ' ' + (p.direccion || '') + ' ' + (p.nicho || '') + ' ' + (p.categoria || '')).toLowerCase();
            return bolsa.includes(txtLower);
        });
        if (localMatch && localMatch.Coordenadas && localMatch.Coordenadas.latitude && localMatch.Coordenadas.longitude) {
            return {
                lat: Number(localMatch.Coordenadas.latitude),
                lng: Number(localMatch.Coordenadas.longitude),
                zoom: 16.5,
                tipo: 'directorio'
            };
        }
    }
    return null;
};

window.buscarCiudadGlobal = function() {
    const inputEl = document.getElementById('input-buscador');
    const texto = inputEl ? inputEl.value.trim() : '';
    if (!texto) return;
    GeokatuDB.LocalService.registrarEventoAnalytics('busqueda_radar', { termino: texto });
    const destino = window.resolverUbicacionLocalOffline(texto);
    if (destino && window.mapa) {
        window.mapa.flyTo({ center: [destino.lng, destino.lat], zoom: destino.zoom, duration: 1500 });
        if (destino.tipo === 'ciudad') {
            inputEl.value = '';
        }
        setTimeout(function() {
            if (typeof window.barridoRadar === 'function') {
                window.barridoRadar(destino.tipo === 'ciudad' ? '' : texto);
            }
        }, 1550);
    } else if (typeof window.barridoRadar === 'function') {
        window.barridoRadar(texto);
    }
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
                window.linkCompartirActual = baseOriginal + window.location.pathname.replace('index.html', '') + 'negocio?id=' + codigo;
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
                if (categoriaActivaGlobal === 'inmuebles') {
            const esInm = p.tipo_modelo === 'inmueble' || p.es_inmueble_real === true;
            if (!esInm) return false;

            const fi = window.filtrosInmueblesEstado || {};
            const strDatos = `${p.nombre || ''} ${p.niche || ''} ${p.categoria || ''} ${p.subtipo_inmueble || ''} ${p.palabras_clave || ''}`.toLowerCase();

            if (fi.operacion && fi.operacion !== 'todos') {
                if ((p.tipo_operacion || '').toLowerCase() !== fi.operacion && !strDatos.includes(fi.operacion)) return false;
            }
            if (fi.tipo && fi.tipo !== 'todos') {
                if ((p.subtipo_inmueble || '').toLowerCase() !== fi.tipo && !strDatos.includes(fi.tipo)) return false;
            }
            if (fi.atributo && fi.atributo !== 'todos') {
                if (['1', '2', '3+'].includes(fi.atributo)) {
                    const habs = Number(p.habitaciones) || 0;
                    if (fi.atributo === '1' && habs !== 1) return false;
                    if (fi.atributo === '2' && habs !== 2) return false;
                    if (fi.atributo === '3+' && habs < 3) return false;
                } else if (!strDatos.includes(fi.atributo.toLowerCase())) {
                    return false;
                }
            }
        } else if (categoriaActivaGlobal === 'comercios' || categoriaActivaGlobal === 'negocios') {
            const esCom = ['negocio', 'comercio', 'tienda'].includes(p.tipo_modelo) || p.categoria_maestra === 'comercio' || Boolean(p.nombre && !p.es_inmueble_real && p.tipo_modelo !== 'conductor');
            if (!esCom) return false;

            const fc = window.filtrosComerciosEstado || {};
            const strCom = `${p.nombre || ''} ${p.niche || ''} ${p.categoria || ''} ${p.palabras_clave || ''}`.toLowerCase();

            if (fc.categoria && fc.categoria !== 'todos' && !strCom.includes(fc.categoria.toLowerCase())) return false;
            if (fc.subtipo && fc.subtipo !== 'todos' && !strCom.includes(fc.subtipo.toLowerCase())) return false;
            if (fc.domicilio === 'si' && p.domicilio_activo === false) return false;
            if (fc.domicilio === 'local' && p.solo_recogida !== true) return false;
        } else if (categoriaActivaGlobal === 'servicios') {
            const esServ = p.tipo_modelo === 'servicio' || p.categoria_maestra === 'servicio';
            if (!esServ) return false;

            const fs = window.filtrosServiciosEstado || {};
            const strServ = `${p.nombre || ''} ${p.niche || ''} ${p.categoria || ''} ${p.palabras_clave || ''}`.toLowerCase();

            if (fs.categoria && fs.categoria !== 'todos' && !strServ.includes(fs.categoria.toLowerCase())) return false;
            if (fs.subtipo && fs.subtipo !== 'todos' && !strServ.includes(fs.subtipo.toLowerCase())) return false;
            if (fs.modalidad === 'domicilio' && !strServ.includes('domicilio')) return false;
            if (fs.modalidad === 'sede' && !strServ.includes('local') && !strServ.includes('sede')) return false;
        }

        if (filtroTexto && typeof filtroTexto === 'string') {
            const txt = filtroTexto.toLowerCase().trim();
            const tagsStr = Array.isArray(p.tags_busqueda) ? p.tags_busqueda.join(' ') : (p.tags_busqueda || '');
            const strCompleto = `${p.nombre || ''} ${p.niche || ''} ${p.categoria || ''} ${p.palabras_clave || ''} ${tagsStr} ${p.slogan || ''}`.toLowerCase();
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

    const zoomActual = mapa ? mapa.getZoom() : 15;
    const UMBRAL_ZOOM_MAX_DETALLE = 17.5;

    // REGIMEN 1: En maximo Zoom In (>= 17.5) se muestran TODOS los comercios inscritos en el encuadre sin restriccion artificial
    // REGIMEN 2: Al hacer Zoom Out (< 17.5) se activa el tope de 62 pines dispersos (15 Aliados + 25 Premium + resto Freemium) con rotacion del 38.2%
    if (zoomActual < UMBRAL_ZOOM_MAX_DETALLE && pinesEnPantalla.length > 62) {
        const limiteAliados = 15;
        const limitePremium = 25;
        const limiteTotal = 62;
        const TASA_ROTACION_DESVANECIDO = 0.382; // 38.2% se desvanece y rota por nuevos en cada movimiento/zoom
        const TASA_SUPERVIVENCIA = 1 - TASA_ROTACION_DESVANECIDO; // 61.8% permanece estable

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

            // Dispersion espacial por celdas del encuadre para evitar que los nuevos se tapen entre si
            const sw = limiteMapa.getSouthWest();
            const ne = limiteMapa.getNorthEast();
            const spanLat = Math.max(0.0001, ne.lat - sw.lat);
            const spanLng = Math.max(0.0001, ne.lng - sw.lng);
            const celdasOcupadas = new Set();

            const cantidadSobrevivientes = Math.floor(Math.min(freemiumViejos.length, asientosLibres) * TASA_SUPERVIVENCIA);
            const sobrevivientes = freemiumViejos.slice(0, cantidadSobrevivientes);
            sobrevivientes.forEach(p => {
                const cX = Math.floor(((p.Coordenadas.longitude - sw.lng) / spanLng) * 8);
                const cY = Math.floor(((p.Coordenadas.latitude - sw.lat) / spanLat) * 8);
                celdasOcupadas.add(cX + ':' + cY);
            });

            freemiumNuevos.sort(() => 0.5 - Math.random());
            const candidatosPrioritarios = [];
            const candidatosSecundarios = [];
            freemiumNuevos.forEach(p => {
                const cX = Math.floor(((p.Coordenadas.longitude - sw.lng) / spanLng) * 8);
                const cY = Math.floor(((p.Coordenadas.latitude - sw.lat) / spanLat) * 8);
                const claveCelda = cX + ':' + cY;
                if (!celdasOcupadas.has(claveCelda)) {
                    celdasOcupadas.add(claveCelda);
                    candidatosPrioritarios.push(p);
                } else {
                    candidatosSecundarios.push(p);
                }
            });

            const poolOrdenadoNuevos = candidatosPrioritarios.concat(candidatosSecundarios);
            const cantidadNuevos = asientosLibres - sobrevivientes.length;
            let reemplazos = poolOrdenadoNuevos.slice(0, cantidadNuevos);

            if (reemplazos.length < cantidadNuevos) {
                const viejosSobrantes = freemiumViejos.slice(cantidadSobrevivientes);
                reemplazos = reemplazos.concat(viejosSobrantes.slice(0, cantidadNuevos - reemplazos.length));
            }
            seleccionFreemium = sobrevivientes.concat(reemplazos);
            window.memoriaRadar = seleccionFreemium.map(p => p.codigo);
        }

        pinesEnPantalla = seleccionAliados.concat(seleccionPremium, seleccionFreemium);
    } else {
        window.memoriaRadar = pinesEnPantalla.map(p => p.codigo);
    }

    const codigosEnPantalla = new Set(pinesEnPantalla.map(p => p.codigo));
    for (let idClon in window.marcadoresRadar) {
        if (!codigosEnPantalla.has(idClon)) {
            const markerSaliente = window.marcadoresRadar[idClon];
            if (markerSaliente && !markerSaliente._desvaneciendo) {
                markerSaliente._desvaneciendo = true;
                const elPinOut = markerSaliente.getElement ? markerSaliente.getElement() : null;
                if (elPinOut) {
                    elPinOut.style.transition = 'opacity 0.26s ease-out';
                    elPinOut.style.opacity = '0';
                    elPinOut.style.pointerEvents = 'none';
                }
                markerSaliente._timerFadeOut = setTimeout(() => {
                    try { markerSaliente.remove(); } catch (eR) {}
                    if (window.marcadoresRadar[idClon] === markerSaliente) {
                        delete window.marcadoresRadar[idClon];
                    }
                }, 260);
            }
        } else {
            // Si el pin estaba desvaneciendose pero volvio a entrar al encuadre, rescatarlo suavemente
            const markerActivo = window.marcadoresRadar[idClon];
            if (markerActivo && markerActivo._desvaneciendo) {
                clearTimeout(markerActivo._timerFadeOut);
                markerActivo._desvaneciendo = false;
                const elPinRescate = markerActivo.getElement ? markerActivo.getElement() : null;
                if (elPinRescate) {
                    elPinRescate.style.opacity = '1';
                    elPinRescate.style.pointerEvents = 'auto';
                }
            }
        }
    }

    
        if (pinesEnPantalla.length === 0) {
        const toast = document.getElementById('toast-fantasma');
        if (toast) {
            let mensajeToast = "No encontramos resultados en esta zona";
            if (filtrandoFavoritos) {
                mensajeToast = "No tienes guardados en esta zona";
            } else if (typeof window.obtenerMensajeSinResultados === 'function') {
                mensajeToast = window.obtenerMensajeSinResultados();
            }
            toast.innerText = mensajeToast;
            toast.style.opacity = '1';
            setTimeout(() => { toast.style.opacity = '0'; }, 3200);
        }
        return;
    }
    // Separador visual en espiral áurea por si en la base de datos existen comercios previos con coordenada idéntica
    const conteoPorCoord = {};
    pinesEnPantalla.forEach(p => {
        const latBase = Number(p.Coordenadas.latitude);
        const lngBase = Number(p.Coordenadas.longitude);
        const clavePos = latBase.toFixed(5) + ':' + lngBase.toFixed(5);
        const repeticion = conteoPorCoord[clavePos] || 0;
        conteoPorCoord[clavePos] = repeticion + 1;

        if (repeticion > 0) {
            const angulo = repeticion * 2.39996; // Ángulo áureo en radianes (137.5°)
            const radioGrados = 0.000065 * Math.sqrt(repeticion); // ~7 metros de separación visual
            p._latRender = Number((latBase + Math.sin(angulo) * radioGrados).toFixed(6));
            p._lngRender = Number((lngBase + Math.cos(angulo) * radioGrados).toFixed(6));
        } else {
            p._latRender = latBase;
            p._lngRender = lngBase;
        }
    });

    pinesEnPantalla.forEach(p => {
        const pos = { lat: p._latRender || p.Coordenadas.latitude, lng: p._lngRender || p.Coordenadas.longitude };
        const portadaUsada = p.es_inmueble_real ? p.imagen : (p.portada || dbSimbologia['wallpaper_generico']);
        const logoUsado = p.es_inmueble_real ? p.imagen : (p.logo || dbSimbologia['avatar_generico']);
        const nombreTextoHTML = sanitizarTexto(p.nombre || 'Negocio');
        const nombreLimpio = nombreTextoHTML.replace(/'/g, "\\'");
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

       var paleta = null;
        if (p.paleta_aurea && typeof p.paleta_aurea === 'object') {
            paleta = window.calcularPaletaAureaSilenciosa(p.paleta_aurea.c1, p.paleta_aurea.c2, p.paleta_aurea.c3, p.paleta_aurea.c4);
        } else if (p.color_principal) {
            paleta = window.calcularPaletaAureaSilenciosa(p.color_principal, p.color_acento, p.color_terciario, p.color_cuaternario);
        } else if (p.color_hex) {
            var arrColores = p.color_hex.split(',').map(function(c) { return c.trim(); });
            paleta = window.calcularPaletaAureaSilenciosa(arrColores[0], arrColores[1], arrColores[2], arrColores[3]);
        } else if (p.ui_pack && p.ui_pack.length >= 16) {
            var genoma = window.decodificarGenoma(p.ui_pack);
            paleta = genoma ? window.calcularPaletaAureaSilenciosa(genoma.c1, genoma.c2, genoma.c3) : window.calcularPaletaAureaSilenciosa('#ff6b00');
        } else {
            paleta = window.calcularPaletaAureaSilenciosa('#ff6b00');
        }

        c1 = paleta.c1;
        c2 = paleta.c2;

        if (categoriaActivaGlobal === 'inmuebles') {
            var datosSemaforo = obtenerDatosSemaforo(p.fecha_registro);
            paleta = window.calcularPaletaAureaSilenciosa(datosSemaforo.color, datosSemaforo.color);
            c1 = paleta.c1;
            c2 = paleta.c2;
            textoNicho = datosSemaforo.texto;
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
        
        const evalHorarioPre = window.evaluarHorarioComercio(p);
        const estaAbierto = typeof window.verificarHorarioOperativo === 'function'
            ? window.verificarHorarioOperativo(p.horario_apertura, p.horario_cierre)
            : evalHorarioPre.abierto;
        if (!estaAbierto && p.tipo_modelo !== 'inmueble') {
            badgeCobertura += '<div class="badge-fuera-zona" style="background: #555; margin-left: 5px;">Cerrado ahora</div>';
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

      
       var esTemaClasico = (p.tema_popup === 'clasico');
        var colorBotonRaw = (paleta && paleta.c3) ? paleta.c3 : (c2 || '#ff6b00');
        var estiloBoton = window.resolverEstiloBotonAccion(colorBotonRaw, esTemaClasico);

        // Contraste dinámico del eslogan según el tema del popup
        var colorSlogan = (paleta && paleta.c2) ? paleta.c2 : '#8a909d';
        if (esTemaClasico && window.obtenerLuminanciaYIQ(colorSlogan) > 170) {
            colorSlogan = '#334155';
        } else if (!esTemaClasico && window.obtenerLuminanciaYIQ(colorSlogan) < 40) {
            colorSlogan = '#cbd5e1';
        }

        // Selección polimórfica del logotipo evitando duplicar el avatar circular
        var candidataPng = p.nombre_png || p.logo_pin || p.logo_nombre || '';
        var urlSeguraPng = '';
        if (candidataPng && candidataPng !== p.logo && candidataPng !== p.portada && candidataPng !== logoSeguro) {
            urlSeguraPng = escapeQuotes(candidataPng);
        }

        // Micro-halo adaptativo: permite que letras oscuras (ej: Éxito) resalten sobre fondo negro
        var filtroHaloLogo = esTemaClasico
            ? 'filter: drop-shadow(0 0 1px rgba(0,0,0,0.45));'
            : 'filter: drop-shadow(0 0 1.5px rgba(255,255,255,0.85)) drop-shadow(0 2px 4px rgba(0,0,0,0.9));';

        var tituloRenderizado = '';
        if (urlSeguraPng && urlSeguraPng.trim() !== '') {
            tituloRenderizado = 
                '<div class="popup-nombre-png-box">' +
                    '<img src="' + urlSeguraPng + '" alt="' + nombreTextoHTML + '" class="popup-nombre-png" style="' + filtroHaloLogo + '" onerror="this.parentElement.style.display=\'none\'; this.parentElement.nextElementSibling.style.display=\'block\';">' +
                '</div>' +
                '<h3 class="popup-title" style="display:none; color: ' + (esTemaClasico ? '#0f172a' : '#ffffff') + ' !important; font-size: 13px; font-weight: 900; margin: 4px 0 2px 0; text-transform: uppercase; letter-spacing: 0.5px;">' + nombreTextoHTML + '</h3>';
        } else {
            tituloRenderizado = '<h3 class="popup-title" style="color: ' + (esTemaClasico ? '#0f172a' : '#ffffff') + ' !important; font-size: 13px; font-weight: 900; margin: 4px 0 2px 0; text-transform: uppercase; letter-spacing: 0.5px;">' + nombreTextoHTML + '</h3>';
        }


        var bloqueSlogan = '';
        if (p.slogan && String(p.slogan).trim() !== '') {
            bloqueSlogan = '<p class="popup-slogan" style="color: ' + colorSlogan + ' !important;">' + sanitizarTexto(String(p.slogan).trim()) + '</p>';
        }

       // Determinar existencia de canales según flags binarios o datos mínimos
        var flagsP = Number(p.f || p.flags || 0);
        var tieneCanales = Boolean((flagsP & 1) || (flagsP & 2) || p.whatsapp || p.pbx);
        var hubId = 'hub-contacto-' + String(p.codigo).replace(/[^a-zA-Z0-9_-]/g, '');
        var bloqueHubContacto = '<div id="' + hubId + '" class="popup-hub-menu"></div>';
        var botonHubTrigger = '';

        if (tieneCanales) {
            botonHubTrigger = 
                '<button type="button" class="btn-popup-contacto-hub" onclick="window.abrirHubContactoDinamico(\'' + String(p.codigo).replace(/'/g, "\\'") + '\', \'' + hubId + '\', event)" title="Canales de Contacto">' +
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>' +
                '</button>';
        }


        var usaPublicidadPropia = p.publicidad_propia === true;
        var bloquePublicidad = '';

        if (usaPublicidadPropia) {
            var troyasActivos = dbTroya.filter(function(t) { return t.activo === true || t.activo === "SI"; });
            var anuncio = troyasActivos.length > 0 ? troyasActivos[Math.floor(Math.random() * troyasActivos.length)] : null;
            if (anuncio) {
                bloquePublicidad = '<a href="' + anuncio.link_accion + '" target="_blank"><img src="' + anuncio.imagen_16_9 + '" style="width:100%; border-radius:10px; margin-top:8px; border: 1px solid var(--naranja);"></a>';
            }
        }

        var linkDestino = p.es_inmueble_real
            ? ('inmueble?id=' + encodeURIComponent(p.id_negocio_padre || p.codigo) + '&item=' + encodeURIComponent(p.codigo))
            : (p.username ? ('/' + p.username.toLowerCase()) : ('negocio?id=' + encodeURIComponent(p.codigo)));

        var usernameParaCompartir = p.username ? ("'" + p.username.toLowerCase() + "'") : "null";

        var mod = p.estado_moderacion || 'pendiente';
        var semaforoColor = '#ff4444';
        var semaforoTexto = 'comercio clausurado';

        if (mod === 'aprobado' || mod === 'aprobado_activo' || p.verificado_geokatu === true) {
            semaforoColor = '#00ff64';
            semaforoTexto = 'comercio verificado';
        } else if (mod === 'en_revision' || mod === 'pendiente') {
            semaforoColor = '#ffcc00';
            semaforoTexto = 'en proceso de verificación';
        }

        var evalHorario = evalHorarioPre || window.evaluarHorarioComercio(p);
        var telWhatsapp = String(p.whatsapp || p.whatsApp || '').replace(/\D/g, '');
        var fnSanitizarAttr = window.sanitizarAtributo || function(v) { return String(v === undefined || v === null ? '' : v).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); };
        var fnSanitizarUrl = window.sanitizarURL || function(u) { return String(u || '#'); };
        window.sanitizarAtributo = fnSanitizarAttr;
        window.sanitizarURL = fnSanitizarUrl;
        var semaforoOverlayId = 'sem-modal-' + p.codigo;
        var horarioOverlayId = 'horario-modal-' + p.codigo;
        var htmlPopup = 
            '<div style="position: relative; width: 100%; border-radius: 15px; overflow: hidden;" onclick="window.cerrarHubContactoPopup(event)">' +
                '<div style="position: relative;">' +
                    '<button class="btn-fav-popup js-action-favorito" style="' + favStyleBtn + '" data-codigo="' + fnSanitizarAttr(encodeURIComponent(p.codigo)) + '" data-nombre="' + fnSanitizarAttr(nombreLimpio) + '" data-precio="' + fnSanitizarAttr(p.precio || 0) + '" data-portada="' + fnSanitizarAttr(portadaSegura) + '" data-whatsapp="' + fnSanitizarAttr(telWhatsapp) + '">' + corazon + '</button>' +

                    '<button class="btn-compartir js-action-compartir" data-codigo="' + window.sanitizarAtributo(encodeURIComponent(p.codigo)) + '" data-nombre="' + window.sanitizarAtributo(nombreLimpio) + '" data-username="' + window.sanitizarAtributo(usernameParaCompartir) + '"><svg style="pointer-events: none;" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg></button>' +
                    '<img src="' + portadaUsada + '" class="popup-portada" style="border-color: ' + c1 + '" onerror="window.imagenRotaToGlass(this, \'' + nombreLimpio + '\')">' +
                '</div>' +
                '<div class="popup-info" style="padding: 0 10px 10px 10px; position: relative;">' +
                    '<img src="' + logoSeguro + '" class="popup-logo" style="border-color: ' + c1 + ';" onerror="window.imagenRotaToGlass(this, \'' + nombreLimpio + '\')">' +
                    '<div class="popup-title-wrapper" style="margin-bottom: 3px; display: flex; flex-wrap: wrap; justify-content: center; gap: 4px;">' +
                        badgeRemate + ' ' + badgeCobertura +
                    '</div>' +
                    tituloRenderizado +
                    bloqueSlogan +
                    '<div class="estrellas" style="margin-top: 2px;">' + estrellasHtml + '</div>' +
                    '<p class="texto-piedra" style="margin: 2px 0 8px 0; color: ' + colorSlogan + ' !important;">' + textoNicho + '</p>' +
                    '<div class="popup-acciones-fila" style="position: relative;">' +
                        '<a href="' + window.sanitizarURL(linkDestino) + '" class="btn-popup-catalogo js-action-ver-detalles" data-codigo="' + window.sanitizarAtributo(encodeURIComponent(p.codigo)) + '" data-nicho="' + window.sanitizarAtributo(sanitizarTexto(p.niche)) + '" style="background: ' + estiloBoton.bg + ' !important; color: ' + estiloBoton.color + ' !important; ' + estiloBoton.borde + ' ' + estiloBoton.sombra + '">' + (estaAbierto ? 'CATÁLOGO' : 'CERRADO') + '</a>' +
                        botonHubTrigger +
                        bloqueHubContacto +
                    '</div>' +

                    // FILA DE INDICADORES MINIMALISTAS CENTRADOS (VERIFICACIÓN & HORARIO)
                    '<div class="popup-micro-fila-status">' +
                        '<button type="button" class="btn-micro-status" onclick="window.mostrarAvisoVerificacionModal(\'' + semaforoOverlayId + '\', \'' + horarioOverlayId + '\')" title="' + semaforoTexto + '">' +
                            '<span class="dot-status" style="background: ' + semaforoColor + '; box-shadow: 0 0 6px ' + semaforoColor + ';"></span>' +
                        '</button>' +
                        '<button type="button" class="btn-micro-status" onclick="window.mostrarAvisoHorarioModal(\'' + horarioOverlayId + '\', \'' + semaforoOverlayId + '\')" title="' + evalHorario.texto + '">' +
                            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="' + evalHorario.color + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 4px ' + evalHorario.color + ');"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>' +
                        '</button>' +
                    '</div>' +

                    // BANNER FLOTANTE 1: ESTADO DE VERIFICACIÓN (3.5s)
                    '<div id="' + semaforoOverlayId + '" class="popup-aviso-verificacion" style="display: none; border-color: ' + semaforoColor + ';">' +
                        '<span style="color: ' + semaforoColor + '; font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; line-height: 1.2;">' + semaforoTexto + '</span>' +
                    '</div>' +

                    // BANNER FLOTANTE 2: HORARIO OPERATIVO (4.5s)
                    '<div id="' + horarioOverlayId + '" class="popup-aviso-verificacion" style="display: none; border-color: ' + evalHorario.color + ';">' +
                        '<span style="color: ' + evalHorario.color + '; font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; line-height: 1.2;">' + evalHorario.texto + '</span>' +
                    '</div>' +

                    bloquePublicidad +
                '</div>' +
            '</div>';






        const firmaVisualActual = (p.pin_pack || '') + '|' + c1 + '|' + c2 + '|' + (p.link_pin || p.portada || '');
        if (window.marcadoresRadar[p.codigo] && window.marcadoresRadar[p.codigo]._firmaVisual !== firmaVisualActual) {
            try { window.marcadoresRadar[p.codigo].remove(); } catch (eRem) {}
            delete window.marcadoresRadar[p.codigo];
        }
        if (!window.marcadoresRadar[p.codigo]) {
            const elDOM = document.createElement('div');

            elDOM.style.width = '60px';
            elDOM.style.height = '60px';
            elDOM.style.display = 'flex';
            elDOM.style.justifyContent = 'center';
            elDOM.style.alignItems = 'center';
            elDOM.style.cursor = 'pointer';

            // Fábrica SVG de silueta idéntica a la de boveda-comercio.html
            let svgSilueta = '<path d="M 30,57 C 30,57 10,38 10,20 C 10,9 19,3 30,3 C 41,3 50,9 50,20 C 50,38 30,57 30,57 Z" />';
            if (claseForma === 'forma-esfera') svgSilueta = '<circle cx="30" cy="30" r="26" />';
            else if (claseForma === 'forma-triangulo') svgSilueta = '<polygon points="6,8 54,8 30,54" stroke-linejoin="round" />';
            else if (claseForma === 'forma-estrella') svgSilueta = '<polygon points="30,4 38,23 57,23 42,34 48,53 30,42 12,53 18,34 3,23 22,23" stroke-linejoin="round" />';
            else if (claseForma === 'forma-hexagono') svgSilueta = '<polygon points="30,4 53,17 53,43 30,56 7,43 7,17" stroke-linejoin="round" />';
            else if (claseForma === 'forma-corazon') svgSilueta = '<path d="M 30 16 C 22 2 10 6 10 20 C 10 35 25 45 30 57 C 35 45 50 35 50 20 C 50 6 38 2 30 16 Z" stroke-linejoin="round" />';
            else if (claseForma === 'forma-arbol') svgSilueta = '<polygon points="26,56 34,56 34,42 50,42 30,6 10,42 26,42" stroke-linejoin="round" />';
            else if (claseForma === 'forma-hongo') svgSilueta = '<path d="M 24 56 L 36 56 L 36 36 L 52 36 C 52 15 44 8 30 8 C 16 8 8 15 8 36 L 24 36 Z" stroke-linejoin="round" />';
            else if (claseForma === 'forma-paleta') svgSilueta = '<path d="M 28 56 L 32 56 L 32 37 A 16 16 0 1 0 28 37 Z" stroke-linejoin="round" />';

            // 💉 REQ 8: Prioridad #1 estricta para la imagen exclusiva del PIN (link_pin) independiente de la portada
            const urlCandidata = p.link_pin || p.logo || p.portada || p.imagen_perfil || p.foto_portada || logoSeguro;
            const tieneFotoValida = typeof urlCandidata === 'string' && urlCandidata.trim().length > 5 && urlCandidata !== 'null' && urlCandidata !== 'undefined';

            // SVG Fallback Corporativo (#111 de fondo con acento áureo #ff6b00)
            const inicialesFallback = (sanitizarTexto(p.nombre) || 'GK').substring(0, 2).toUpperCase();
            const fallbackSVGAureo = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60"><rect width="60" height="60" rx="30" fill="%23111111"/><text x="30" y="36" font-size="20" font-weight="900" font-family="system-ui, sans-serif" fill="%23ff6b00" text-anchor="middle" dominant-baseline="middle">${inicialesFallback}</text><circle cx="30" cy="30" r="27" stroke="%23ff6b00" stroke-width="2" fill="none" opacity="0.6"/></svg>`;

            const urlFondoFinal = tieneFotoValida ? urlCandidata : fallbackSVGAureo;

            var claseVisualPin = esAliado ? ('pin-moneda-magica ' + claseFuego) : (claseForma + ' ' + claseAnimacion + ' ' + claseFuego);
            var colorPinMain = esAliado ? '#FFD700' : c1;
            var colorPinSec = esAliado ? '#1a1600' : c2;

            var idPinSanitizado = 'pin-radar-' + String(p.codigo).replace(/[^a-zA-Z0-9_-]/g, '');
            var clipId = 'clip-' + idPinSanitizado;

            var imgClipNode = '<image href="' + urlFondoFinal + '" x="0" y="0" width="60" height="60" preserveAspectRatio="xMidYMid slice" clip-path="url(#' + clipId + ')" />';

            var svgSiluetaCompleta = 
                '<svg class="svg-pin-fondo" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">' +
                    '<defs><clipPath id="' + clipId + '">' + svgSilueta + '</clipPath></defs>' +
                    svgSilueta +
                    imgClipNode +
                '</svg>';

            var cssVarsPin = '--color-main: ' + colorPinMain + '; --color-sec: ' + colorPinSec + '; --color-ter: ' + paleta.c3 + '; --color-cuat: ' + paleta.c4 + ';';

            elDOM.innerHTML = 
                '<div class="pin-wrapper ' + claseVisualPin + '" data-forma="' + claseForma + '" style="' + cssVarsPin + '" ' + htmlAtributosGorras + '>' +
                    svgSiluetaCompleta +
                '</div>';


            // Respaldo asíncrono si el servidor arroja error 404 o falla de red
            if (tieneFotoValida) {
                const imgPreload = new Image();
                imgPreload.onerror = () => {
                    const contenedorImg = elDOM.querySelector('.img-pin-interior');
                    if (contenedorImg) {
                        contenedorImg.style.backgroundImage = `url('${fallbackSVGAureo}')`;
                    }
                };
                imgPreload.src = urlCandidata;
            }

                                  // Anclaje dinamico vertical y soporte para toda la coleccion de Cuarzos Traslucidos
            const rawTemaP = String(p.tema_popup || 'carbon').trim();
            const esCustomTema = rawTemaP.indexOf('custom:') === 0;
            const temaElegido = esCustomTema ? 'popup-tema-carbon' : ('popup-tema-' + rawTemaP);
            const popup = new maplibregl.Popup({ 
                anchor: 'bottom',
                offset: [0, -75],
                closeButton: false, 
                closeOnClick: true, 
                maxWidth: '164px',
                className: 'popup-boveda-estricto ' + temaElegido
            }).setHTML(htmlPopup);
            if (esCustomTema) {
                popup.on('open', () => {
                    const hexC = rawTemaP.replace('custom:', '').replace('#', '').trim();
                    const rC = parseInt(hexC.substring(0, 2), 16) || 255;
                    const gC = parseInt(hexC.substring(2, 4), 16) || 107;
                    const bC = parseInt(hexC.substring(4, 6), 16) || 0;
                    const elContent = popup.getElement() ? popup.getElement().querySelector('.maplibregl-popup-content') : null;
                    if (elContent) {
                        elContent.style.setProperty('background', 'linear-gradient(145deg, rgba(' + rC + ',' + gC + ',' + bC + ',0.34), rgba(' + Math.round(rC * 0.16) + ',' + Math.round(gC * 0.16) + ',' + Math.round(bC * 0.16) + ',0.92))', 'important');
                        elContent.style.setProperty('border-color', 'rgba(' + rC + ',' + gC + ',' + bC + ',0.55)', 'important');
                    }
                });
            }


            // Ajuste de orientacion vertical previo a la apertura (solo top o bottom, centrado en X)
            const calibrarOrientacionVertical = () => {
                if (!mapa) return;
                const posPixel = mapa.project([pos.lng, pos.lat]);
                // Si el pin esta en los primeros 330px de la pantalla, nace hacia abajo desde la punta
                if (posPixel.y < 330) {
                    popup.options.anchor = 'top';
                    popup.setOffset([0, 8]);
                } else {
                    popup.options.anchor = 'bottom';
                    popup.setOffset([0, -75]);
                }
            };

            elDOM.addEventListener('click', calibrarOrientacionVertical, true);
            popup.on('open', calibrarOrientacionVertical);

            // Entrada con desvanecido elegante (Fade-In)
            elDOM.style.opacity = '0';
            elDOM.style.transition = 'opacity 0.28s ease-out';

            const marker = new maplibregl.Marker({ element: elDOM, anchor: 'bottom' })
                .setLngLat([pos.lng, pos.lat])
                .setPopup(popup)
                .addTo(mapa);

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    elDOM.style.opacity = '1';
                });
            });

            if (esAliado) {
                elDOM.addEventListener('click', function(e) {
                    if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
                    elDOM.style.animation = 'none';
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            elDOM.style.animation = 'saltoMoneda 0.6s ease-out forwards';
                        });
                    });
                    setTimeout(() => { elDOM.style.animation = 'flotarMoneda 2.5s infinite ease-in-out'; }, 600);
                });
            }
            marker._firmaVisual = firmaVisualActual;
            window.marcadoresRadar[p.codigo] = marker;
        }




        window.cerrarTarjetaInmueble = function(event, elemento) {
            event.stopPropagation(); 
            elemento.closest('.tarjeta-hibrida').style.display = 'none';
        };


       if (categoriaActivaGlobal === 'inmuebles') {
            var titularInmueble = (urlSeguraPng && urlSeguraPng.trim() !== '')
                ? ('<img src="' + urlSeguraPng + '" alt="' + nombreLimpio + '" style="max-height: 22px; max-width: 140px; object-fit: contain; margin-bottom: 2px; display: block;">')
                : ('<h4 class="tarjeta-hibrida-titulo">' + sanitizarTexto(p.nombre || 'Inmueble') + '</h4>');

            tarjetasHibridasHtml += 
                '<div class="tarjeta-hibrida" style="border-color: ' + c1 + '; position: relative;" onclick="enfocarInmueble(\'' + sanitizarTexto(p.codigo) + '\', ' + pos.lat + ', ' + pos.lng + ')">' +
                    '<button class="btn-fav-card" style="' + favStyleBtn + '" onclick="window.toggleFavorito(\'' + encodeURIComponent(p.codigo) + '\', \'' + nombreLimpio + '\', \'' + (p.precio || 0) + '\', \'' + portadaSegura + '\', \'' + sanitizarTexto(p.whatsapp || '') + '\', event)">' + corazon + '</button>' +
                    '<button class="btn-cerrar-card" onclick="window.cerrarTarjetaInmueble(event, this)" style="position: absolute; top: 10px; left: 10px; background: rgba(0,0,0,0.6); color: white; border: 1px solid rgba(255,255,255,0.3); border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; z-index: 10; cursor: pointer; font-size: 12px; font-weight: bold;">✖</button>' +
                    '<img src="' + portadaUsada + '" class="tarjeta-hibrida-img" onerror="this.src=\'' + dbSimbologia['wallpaper_generico'] + '\'">' +
                    '<div class="tarjeta-hibrida-info">' +
                        titularInmueble +
                        '<p class="tarjeta-hibrida-nicho" style="color: ' + c1 + ';">' + textoNicho + '</p>' +
                    '</div>' +
                '</div>';
        }

    });
    
        const sheetHibrido = document.getElementById('lista-inmuebles-sheet');
    if (sheetHibrido) {
        if (categoriaActivaGlobal === 'inmuebles' && tarjetasHibridasHtml !== '') {
            sheetHibrido.innerHTML = tarjetasHibridasHtml;
            sheetHibrido.classList.add('activo');
        } else {
            sheetHibrido.classList.remove('activo');
            sheetHibrido.innerHTML = '';
        }
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
        
       mapa.flyTo({ center: [centroLng, centroLat], zoom: 16, duration: 2500 });
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
        style: './estilo-fresco.json',
        center: [lng, lat],
        zoom: 16,
        minZoom: 13.5,
        maxZoom: 19,
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
        buscarDireccion: function(texto) {
            if (!texto) return;
            const destino = window.resolverUbicacionLocalOffline(texto);
            if (destino) {
                miniMapa.flyTo({ center: [destino.lng, destino.lat], zoom: 17 });
                marker.setLngLat([destino.lng, destino.lat]);
            }
        }

    };
};
/* =========================================================================
   PUENTE DE FILTRADO DE PINES POR CÓDIGO DE BARRAS (motor-mapa.js)
   ========================================================================= */
window.addEventListener('ejecutar-filtro-mapa-producto', (e) => {
    const { barcode, idsComercios } = e.detail;

    if (!window.mapa) return;

    if (!idsComercios || idsComercios.length === 0) {
        const toast = document.getElementById('toast-fantasma');
        if (toast) {
            toast.innerText = "No hay comercios locales con stock activo de este artículo.";
            toast.classList.add('activo');
            setTimeout(() => toast.classList.remove('activo'), 3500);
        }
        return;
    }

    // Filtrar capa de pines vectoriales en MapLibre GL JS
    if (window.mapa.getLayer('pines-comercios-layer')) {
        window.mapa.setFilter('pines-comercios-layer', [
            'in',
            ['get', 'id_comercio'],
            ['literal', idsComercios]
        ]);
    } else if (window.mapa.getLayer('capa-comercios-pines')) {
        window.mapa.setFilter('capa-comercios-pines', [
            'in',
            ['get', 'id_comercio'],
            ['literal', idsComercios]
        ]);
    }

    // Actualizar input del buscador principal con el resultado
    const inputBuscador = document.getElementById('input-buscador');
    if (inputBuscador) {
        inputBuscador.value = `Stock: ${barcode} (${idsComercios.length} tiendas)`;
    }

    if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
});








