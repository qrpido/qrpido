import GeokatuDB from './core-db.js';
import { db } from './firebase-config.js'; 
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// === ARQUITECTURA DE ESTADO COORDINADO (SECCIÓN 5 LIBRO TÉCNICO) ===
let mapa;
let ultimoCentroFetch = null;
let debounceFirebase = null;
let marcadoresActivos = {};
let dbDirectorio = [], dbDirectorioMap = new Map();
window.dbDirectorio = dbDirectorio;
let dbTroya = [];
let datosDescargados = false;
let cajaFuerteEspacial = null;
let zonaNecesitaDescarga = false;
let miUbicacionMarker = null;
window.marcadoresRadar = {};

// Puente reactivo para categoriaActivaGlobal entre index.html, movilidad y motor-mapa.js
let _categoriaActivaGlobal = 'negocios';
Object.defineProperty(window, 'categoriaActivaGlobal', {
    get: () => _categoriaActivaGlobal,
    set: (val) => { _categoriaActivaGlobal = val || 'negocios'; },
    configurable: true
});

export const EstadoMapa = {
    vista: {
        estiloActual: 'clasico',
        interaccionUsuario: false,
        vueloCancelableId: null,
        modoZoomActual: 'barrio',
        ultimoCentroRotacion: null,
        ultimoZoomRotacion: null
    },
    cobertura: {
        celdas: new Map(), // claveCelda -> { centro, radioM, categoria, fecha, completo, truncado }
        ordenLRU: []       // Control de presupuesto de memoria (máx 1500 registros por uso reciente)
    },
    consulta: {
        generacionActual: 0,
        promesasEnVuelo: new Map(),
        estadoUI: 'iniciando'
    },
    sesion: {
        uid: null,
        comercioPropio: null
    },
    seleccion: {
        pinAbiertoId: null,
        colaExposicion: [],
        ultimaExposicionTs: new Map(),
        semillaSesion: Math.floor(Math.random() * 2147483647)
    }
};
window.EstadoMapaGeokatu = EstadoMapa;

// Indicador explícito de estados del contrato de experiencia (Sección 4)
window.actualizarEstadoRadar = function(estado, textoManual = null) {
    EstadoMapa.consulta.estadoUI = estado;
    const pill = document.getElementById('radar-status-pill');
    if (!pill) return;
    const mapaTextos = {
        'iniciando': '⏳ Iniciando mapa...',
        'mostrando_cache': '⚡ Mostrando caché local • Actualizando...',
        'consultando': '🛰️ Actualizando esta zona...',
        'cobertura_parcial': '⚠️ Cobertura parcial en esta vista',
        'sin_conexion': '📴 Sin conexión • Mostrando datos guardados',
        'error': '⚠️ Fallo temporal de consulta • Datos previos conservados',
        'listo': ''
    };
    const msg = textoManual !== null ? textoManual : (mapaTextos[estado] || '');
    if (!msg || estado === 'listo') {
        pill.classList.remove('visible');
    } else {
        pill.textContent = msg;
        pill.classList.add('visible');
    }
};

// Validación estricta de coordenadas finitas (0 es coordenada válida)
window.esCoordenadaValida = function(lat, lng) {
    const nLat = Number(lat), nLng = Number(lng);
    return Number.isFinite(nLat) && Number.isFinite(nLng) && nLat >= -90 && nLat <= 90 && nLng >= -180 && nLng <= 180;
};

// Registro en directorio público con evacuación LRU (Sección 7)
window.registrarEntidadDirectorio = function(id, obj) {
    if (!id || !obj) return;
    const idStr = String(id);
    dbDirectorioMap.set(idStr, obj);
    const idxPrev = EstadoMapa.cobertura.ordenLRU.indexOf(idStr);
    if (idxPrev !== -1) EstadoMapa.cobertura.ordenLRU.splice(idxPrev, 1);
    EstadoMapa.cobertura.ordenLRU.push(idStr);

    if (dbDirectorioMap.size > 1500) {
        const excedente = dbDirectorioMap.size - 1500;
        let eliminados = 0;
        for (let i = 0; i < EstadoMapa.cobertura.ordenLRU.length && eliminados < excedente; i++) {
            const candidatoId = EstadoMapa.cobertura.ordenLRU[i];
            if (candidatoId !== EstadoMapa.seleccion.pinAbiertoId && candidatoId !== EstadoMapa.sesion.uid) {
                dbDirectorioMap.delete(candidatoId);
                EstadoMapa.cobertura.ordenLRU.splice(i, 1);
                i--;
                eliminados++;
            }
        }
    }
};

// Curva Quintic E(u) = 6u^5 - 15u^4 + 10u^3 cancelable por gesto (Sección 6)
window.volarCamaraHonesta = function(lngDestino, latDestino, zoomDestino = 15, duracionMs = 950) {
    if (!mapa || !window.esCoordenadaValida(latDestino, lngDestino)) return;
    if (EstadoMapa.vista.vueloCancelableId) {
        cancelAnimationFrame(EstadoMapa.vista.vueloCancelableId);
        EstadoMapa.vista.vueloCancelableId = null;
    }
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
        mapa.jumpTo({ center: [lngDestino, latDestino], zoom: zoomDestino });
        return;
    }
    const c0 = mapa.getCenter();
    const distMetros = calcularDistanciaKm(c0.lat, c0.lng, latDestino, lngDestino) * 1000;
    if (distMetros > 18000) {
        mapa.flyTo({ center: [lngDestino, latDestino], zoom: zoomDestino, duration: Math.min(1100, duracionMs) });
        return;
    }
    const z0 = mapa.getZoom();
    const t0 = performance.now();
    const T = Math.max(700, Math.min(1100, duracionMs));
    function stepCamara(now) {
        if (EstadoMapa.vista.interaccionUsuario) {
            EstadoMapa.vista.vueloCancelableId = null;
            return;
        }
        const u = Math.max(0, Math.min(1, (now - t0) / T));
        const E = 6 * Math.pow(u, 5) - 15 * Math.pow(u, 4) + 10 * Math.pow(u, 3);
        let dLng = lngDestino - c0.lng;
        if (dLng > 180) dLng -= 360;
        if (dLng < -180) dLng += 360;
        const lngActual = c0.lng + dLng * E;
        const latActual = c0.lat + (latDestino - c0.lat) * E;
        const zoomActual = z0 + (zoomDestino - z0) * E;
        mapa.jumpTo({ center: [lngActual, latActual], zoom: zoomActual });
        if (u < 1) {
            EstadoMapa.vista.vueloCancelableId = requestAnimationFrame(stepCamara);
        } else {
            EstadoMapa.vista.vueloCancelableId = null;
        }
    }
    EstadoMapa.vista.vueloCancelableId = requestAnimationFrame(stepCamara);
};

// === ESPÍA DE SESIÓN DESACOPLADO DEL DIRECTORIO PÚBLICO (SECCIÓN 3.1 Y 5) ===
window.idUsuarioActual = null;
GeokatuDB.SecurityService.observarEstadoSesion(async (user) => {
    if (user) {
        window.idUsuarioActual = user.uid;
        EstadoMapa.sesion.uid = user.uid;
        try {
            const resDetalles = await GeokatuDB.LocalService.getDetails(user.uid);
            if (resDetalles.success && resDetalles.data && resDetalles.data.Coordenadas) {
                const c = resDetalles.data.Coordenadas;
                const latPropia = c.latitude ?? c._lat ?? c.lat;
                const lngPropia = c.longitude ?? c._long ?? c.lng;
                if (window.esCoordenadaValida(latPropia, lngPropia)) {
                    const docPropio = {
                        ...resDetalles.data,
                        codigo: user.uid,
                        Coordenadas: { latitude: Number(latPropia), longitude: Number(lngPropia) }
                    };
                    EstadoMapa.sesion.comercioPropio = docPropio;
                    window.registrarEntidadDirectorio(user.uid, docPropio);
                    dbDirectorio = Array.from(dbDirectorioMap.values());
                    window.dbDirectorio = dbDirectorio;
                }
            }
        } catch (e) {
            console.warn("[Radar] Precarga del comercio propio omitida:", e.message);
        }
        // Jamás marcar el directorio público como completado solo por el perfil propio
        if (typeof window.barridoRadar === 'function' && datosDescargados) {
            window.barridoRadar(document.getElementById('input-buscador')?.value || '', { conservarRotacion: true });
        }
    } else {
        window.idUsuarioActual = null;
        EstadoMapa.sesion.uid = null;
        EstadoMapa.sesion.comercioPropio = null;
        if (typeof window.barridoRadar === 'function' && datosDescargados) {
            window.barridoRadar(document.getElementById('input-buscador')?.value || '', { conservarRotacion: true });
        }
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


// === DISTANCIA HAVERSINE NUMÉRICAMENTE ESTABLE (SECCIÓN 7 LIBRO TÉCNICO) ===
function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
    if (!window.esCoordenadaValida(lat1, lon1) || !window.esCoordenadaValida(lat2, lon2)) return Infinity;
    const R = 6371; // Radio terrestre en km (6.371.000 m)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const rawA = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                 Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                 Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const a = Math.min(1, Math.max(0, rawA)); // Acotado a [0,1] por estabilidad numérica
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// === CUADRÍCULA ESPACIAL DE COBERTURA Y CÍRCULO DE PRECISIÓN GPS ===
function obtenerClaveCeldaEspacial(lat, lng, categoria = 'negocios') {
    // Celdas de ~1.6 km para reutilizar consultas entre vistas próximas
    const step = 0.015;
    const cLat = Math.floor(Number(lat) / step);
    const cLng = Math.floor(Number(lng) / step);
    const catNorm = (categoria === 'comercios' || categoria === 'negocios') ? 'comercios' : categoria;
    return `${catNorm}:${cLat}:${cLng}`;
}

function viewportCubiertoPorCeldas(bounds, categoria) {
    if (!bounds) return false;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const c = bounds.getCenter();
    const puntosMuestra = [
        [c.lat, c.lng],
        [sw.lat, sw.lng],
        [ne.lat, ne.lng],
        [sw.lat, ne.lng],
        [ne.lat, sw.lng]
    ];
    const ahora = Date.now();
    const TTL_CELDA_MS = 10 * 60 * 1000; // 10 minutos de vigencia de caché espacial
    for (let i = 0; i < puntosMuestra.length; i++) {
        const [pLat, pLng] = puntosMuestra[i];
        const clave = obtenerClaveCeldaEspacial(pLat, pLng, categoria);
        const infoCelda = EstadoMapa.cobertura.celdas.get(clave);
        if (!infoCelda || (ahora - infoCelda.fecha) > TTL_CELDA_MS) {
            return false;
        }
    }
    return true;
}

// Escalado continuo e histéresis de 0.2 niveles (Sección 8 Libro Técnico)
window.actualizarEscalaContinuaZoom = function() {
    if (!mapa) return;
    const z = mapa.getZoom();
    const mHtml = document.getElementById('mapa-qrpido');
    if (!mHtml) return;

    mHtml.setAttribute('data-zoom', Math.round(z));

    // Histéresis de 0.2 niveles alrededor de fronteras 12, 14 y 16
    const modoPrevio = EstadoMapa.vista.modoZoomActual || 'barrio';
    let nuevoModo = modoPrevio;
    if (z >= 16.2 || (modoPrevio === 'cercano' && z >= 15.8)) {
        nuevoModo = 'cercano';
    } else if (z >= 14.2 || (modoPrevio === 'barrio' && z >= 13.8 && z < 16.2)) {
        nuevoModo = 'barrio';
    } else if (z >= 12.2 || (modoPrevio === 'penultima' && z >= 11.8 && z < 14.2)) {
        nuevoModo = 'penultima';
    } else {
        nuevoModo = 'ultima';
    }
    EstadoMapa.vista.modoZoomActual = nuevoModo;
    mHtml.setAttribute('data-modo-zoom', nuevoModo);

    // Cálculo continuo de escala entre z=12 (0.22) y z=18 (1.0)
    const t = Math.max(0, Math.min(1, (z - 12) / 6));
    const escalaContinua = Number((0.22 + 0.78 * Math.pow(t, 1.35)).toFixed(3));
    mHtml.style.setProperty('--pin-zoom-scale', String(escalaContinua));
};

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
    EstadoMapa.vista.interaccionUsuario = false;
    window.volarCamaraHonesta(lng, lat, 16.5, 950);
    setTimeout(() => {
        if (window.marcadoresRadar && window.marcadoresRadar[codigo]) {
            window.marcadoresRadar[codigo].togglePopup();
        }
    }, 1000);
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
        lat = item.Coordenadas.latitude ?? item.Coordenadas._lat ?? item.Coordenadas.lat;
        lng = item.Coordenadas.longitude ?? item.Coordenadas._long ?? item.Coordenadas.lng;
    } else {
        lat = item.lat;
        lng = item.lng;
    }

    lat = parseFloat(lat);
    lng = parseFloat(lng);
    if (!window.esCoordenadaValida(lat, lng)) {
        lat = 4.81333;
        lng = -75.69611;
    }

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
        window.actualizarEstadoRadar('mostrando_cache');

        await GeokatuDB.DirectorioMatrizService.inicializarDirectorio();
        var comerciosMatriz = await GeokatuDB.DirectorioMatrizService.obtenerTodosComercios();

        if (comerciosMatriz && comerciosMatriz.length > 0) {
            comerciosMatriz.forEach(function(item) {
                var seguro = window.desempaquetarComercioMatriz(item);
                if (seguro) window.registrarEntidadDirectorio(seguro.codigo, seguro);
            });

            dbDirectorio = Array.from(dbDirectorioMap.values());
            window.dbDirectorio = dbDirectorio;
            datosDescargados = true;

            if (typeof window.barridoRadar === 'function') {
                window.barridoRadar();
            }
            window.actualizarEstadoRadar('listo');
            console.log('[Radar 0ms] ' + comerciosMatriz.length + ' comercios renderizados desde caché local.');
        }
    } catch (err) {
        console.warn('[Radar] Fallo inicializando matriz offline:', err.message);
    }
};

window.iniciarSincronizacionDelta = function() {
    try {
        if (!GeokatuDB || !GeokatuDB.DirectorioMatrizService) return;
        var timestampCorte = localStorage.getItem('geokatu_matriz_timestamp') || new Date(Date.now() - 86400000).toISOString();

        GeokatuDB.DirectorioMatrizService.sincronizarDeltaNube(timestampCorte, function(nuevoComercio) {
            var seguro = window.desempaquetarComercioMatriz(nuevoComercio);
            if (!seguro) return;

            window.registrarEntidadDirectorio(seguro.codigo, seguro);
            dbDirectorio = Array.from(dbDirectorioMap.values());
            window.dbDirectorio = dbDirectorio;
            datosDescargados = true;

            if (!window.frameDeltaRadar) {
                window.frameDeltaRadar = requestAnimationFrame(() => {
                    window.frameDeltaRadar = null;
                    var buscador = document.getElementById('input-buscador');
                    if (typeof window.barridoRadar === 'function') {
                        window.barridoRadar(buscador ? buscador.value : '', { conservarRotacion: true });
                    }
                });
            }
        });
    } catch (err) {
        console.warn('[Radar] Fallo iniciando sincronización delta:', err.message);
    }
};

// === ARRANQUE PARALELO HONESTO SIN BLOQUEO DE TOUR NI DE GPS (SECCIÓN 6) ===
window.arrancarMotor = async function() {
    try {
        if (typeof maplibregl === 'undefined') throw new Error("MapLibre no se descargó. Revisa la conexión o el index.html");
        
        if (typeof pmtiles !== 'undefined') {
            const protocol = new pmtiles.Protocol();
            window.maplibregl.addProtocol("pmtiles", protocol.tile);
        }

        window.actualizarEstadoRadar('iniciando');
        construirMapa();

        // Liberar pantalla de carga pronto sin ocultar averías ni esperar al GPS
        const liberarPantallaCarga = () => {
            const pantallaCarga = document.getElementById('pantalla-carga');
            if (pantallaCarga && pantallaCarga.style.display !== 'none') {
                pantallaCarga.style.opacity = '0';
                setTimeout(() => { pantallaCarga.style.display = 'none'; }, 280);
            }
            const buscador = document.getElementById('wrapper-buscador');
            if (buscador) buscador.classList.remove('shimmer-box');
        };

        const esArranqueCaliente = Boolean(sessionStorage.getItem('geokatu_ram_warm') === '1' || localStorage.getItem('geokatu_matriz_timestamp'));
        sessionStorage.setItem('geokatu_ram_warm', '1');
        if (esArranqueCaliente) liberarPantallaCarga();
        else setTimeout(liberarPantallaCarga, 350);

        // 1. Hidratación local e inicio de delta en paralelo a las teselas
        window.GeokatuArranque?.estado('Recuperando comercios descargados…');
        window.cargarDirectorioMatrizOffline().then(() => {
            window.GeokatuArranque?.directorio(dbDirectorioMap.size);
            liberarPantallaCarga();
            window.iniciarSincronizacionDelta();
        });

        mapa.once('load', () => {
            window.GeokatuArranque?.mapa();
            liberarPantallaCarga();
            window.actualizarEscalaContinuaZoom();
            if (datosDescargados) window.barridoRadar();
        });
        mapa.on('error', () => window.GeokatuArranque?.error());

        // 2. Resolver foco por URL o lanzar consulta pública + GPS no bloqueante
        const params = new URLSearchParams(window.location.search);
        const idDron = params.get('enfocar');
        const latDron = parseFloat(params.get('lat'));
        const lngDron = parseFloat(params.get('lng'));

        if (idDron && window.esCoordenadaValida(latDron, lngDron)) {
            window.categoriaActivaGlobal = (params.get('tipo') === 'inmueble') ? 'inmuebles' : 'negocios';
            window.volarCamaraHonesta(lngDron, latDron, 17.5, 950);
            zonaNecesitaDescarga = true;
            window.descargarNegociosDeFirebase({ forzar: true });
            setTimeout(() => {
                if (window.marcadoresRadar && window.marcadoresRadar[idDron]) {
                    window.marcadoresRadar[idDron].togglePopup();
                }
            }, 1050);
            window.history.replaceState(null, '', window.location.pathname);
        } else {
            // Jamás bloquear la primera visita con el tour oculto en CSS
            localStorage.setItem('geokatu_tour_v1', 'true');
            window.solicitarGPSInicial();
        }

        // 3. Banners informativos en segundo plano
        GeokatuDB.LocalService.obtenerCaballoTroya().then(({ success, data }) => {
            dbTroya = success && data ? data : [];
            if (typeof window.cargarCaballoTroya === 'function') window.cargarCaballoTroya();
        }).catch(() => {});

    } catch (e) {
        console.error("Error Crítico Motor:", e);
        if (typeof mostrarCartelErrorYDescargar === 'function') {
            mostrarCartelErrorYDescargar('CRASH EN EL NÚCLEO DEL MAPA', e.message + '\n\n' + (e.stack || ''));
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
        setTimeout(() => {
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
    if (!window.esCoordenadaValida(lat, lng)) return;
    localStorage.setItem('geokatu_ciudad_manual', JSON.stringify({ lat, lng, nombre }));
    const modal = document.getElementById('modal-selector-ciudad');
    if (modal) modal.style.display = 'none';
    const pantallaCarga = document.getElementById('pantalla-carga');
    if (pantallaCarga) {
        pantallaCarga.style.opacity = '0';
        setTimeout(() => { pantallaCarga.style.display = 'none'; }, 280);
    }
    EstadoMapa.vista.interaccionUsuario = false;
    window.volarCamaraHonesta(lng, lat, 15, 950);
    window.descargarNegociosDeFirebase({ centroExplicito: [lat, lng], forzar: true });
};

window.usarUbicacionPorDefectoPereira = function() {
    window.fijarCiudadManual(4.8133, -75.6961, 'Pereira, Colombia');
};

window.solicitarGPSInicial = function() {
    const pantallaCarga = document.getElementById('pantalla-carga');
    if (pantallaCarga) {
        pantallaCarga.style.opacity = '0';
        setTimeout(() => { pantallaCarga.style.display = 'none'; }, 280);
    }
    
    // Descarga inicial de la zona actual sin esperas
    if (typeof window.descargarNegociosDeFirebase === 'function') {
        window.descargarNegociosDeFirebase();
    }

    const guardada = localStorage.getItem('geokatu_ciudad_manual');
    if (guardada && !sessionStorage.getItem('geokatu_last_cam')) {
        try {
            const parsed = JSON.parse(guardada);
            if (window.esCoordenadaValida(parsed.lat, parsed.lng)) {
                window.volarCamaraHonesta(parsed.lng, parsed.lat, 15, 900);
                window.descargarNegociosDeFirebase({ centroExplicito: [parsed.lat, parsed.lng] });
            }
        } catch (e) {}
    }

    // Activa directamente el punto y halo palpitante nativo de MapLibre
    if (window.geolocateControl) {
        window.geolocateControl.trigger();
    } else {
        const btnNativo = document.querySelector('.maplibregl-ctrl-geolocate');
        if (btnNativo) btnNativo.click();
    }
};


window.iniciarTour = function() {
    localStorage.setItem('geokatu_tour_v1', 'true');
};
window.siguienteTour1 = function() {};
window.siguienteTourEscaner = function() {};
window.siguienteTour2 = function() {};
window.siguienteTour3 = function() {};
window.finalizarTour = function() {
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
    EstadoMapa.vista.interaccionUsuario = false;

    if (window.geolocateControl) {
        window.geolocateControl.trigger();
    } else {
        const btnNativo = document.querySelector('.maplibregl-ctrl-geolocate');
        if (btnNativo) btnNativo.click();
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
            if (window.esCoordenadaValida(negocio.lat, negocio.lng) && boundsActuales.contains([negocio.lng, negocio.lat])) {
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

// === CONSULTAS POR CELDA CON GENERACIÓN Y PROMESAS COMPARTIDAS (SECCIÓN 5 Y 7) ===
window.descargarNegociosDeFirebase = async function(opciones = {}) {
    if (!mapa) return;
    const btn = document.getElementById('btn-cargar-zona');
    const centroMapa = mapa.getCenter();
    const center = Array.isArray(opciones.centroExplicito)
        ? opciones.centroExplicito
        : [centroMapa.lat, centroMapa.lng];

    if (!window.esCoordenadaValida(center[0], center[1])) return;

    const categoriaConsulta = window.categoriaActivaGlobal || 'negocios';
    const claveCelda = obtenerClaveCeldaEspacial(center[0], center[1], categoriaConsulta);

    // Si la celda ya fue consultada recientemente y no se fuerza recarga, reutilizar cobertura
    const infoPrevia = EstadoMapa.cobertura.celdas.get(claveCelda);
    if (!opciones.forzar && !zonaNecesitaDescarga && infoPrevia && (Date.now() - infoPrevia.fecha) < 600000) {
        if (btn) btn.style.display = 'none';
        if (typeof window.barridoRadar === 'function' && datosDescargados) {
            const buscador = document.getElementById('input-buscador');
            window.barridoRadar(buscador ? buscador.value : '', { conservarRotacion: true });
        }
        return;
    }

    // Si ya existe la misma consulta en vuelo, compartir la promesa pendiente
    if (EstadoMapa.consulta.promesasEnVuelo.has(claveCelda)) {
        return EstadoMapa.consulta.promesasEnVuelo.get(claveCelda);
    }

    if (!navigator.onLine) {
        window.actualizarEstadoRadar('sin_conexion');
        return;
    }

    const miGeneracion = ++EstadoMapa.consulta.generacionActual;
    window.actualizarEstadoRadar('consultando');

    if (btn) {
        btn.innerText = "⏳ Rastreando...";
        btn.style.background = "#ffcc00";
    }

    const limites = mapa.getBounds();
    const ne = limites.getNorthEast();
    let radiusInM = calcularDistanciaKm(center[0], center[1], ne.lat, ne.lng) * 1000;
    radiusInM = Math.max(2500, Math.min(8000, radiusInM));

    const promesaActual = (async () => {
        try {
            let res;
            if (categoriaConsulta === 'inmuebles') {
                res = await GeokatuDB.RadarService.buscarInmueblesEnRadar(center[0], center[1], radiusInM);
            } else {
                res = await GeokatuDB.RadarService.buscarEnRadar(center[0], center[1], radiusInM);
            }

            if (!res || !res.success) {
                throw new Error((res && res.error) || 'Error en consulta espacial');
            }

            const arrayNegocios = Array.isArray(res.data) ? res.data : [];
            let integrados = 0;

            arrayNegocios.forEach(data => {
                const docId = data.id || data.codigo || data.uid;
                if (!docId) return;

                let lat = null, lng = null;
                const coordsObj = data.Coordenadas || data.coordenadas || data.ubicacion;
                if (coordsObj) {
                    if (typeof coordsObj.latitude === 'function') lat = coordsObj.latitude();
                    else lat = coordsObj.latitude ?? coordsObj.lat ?? coordsObj._lat;

                    if (typeof coordsObj.longitude === 'function') lng = coordsObj.longitude();
                    else lng = coordsObj.longitude ?? coordsObj.lng ?? coordsObj._long;
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
                if (!window.esCoordenadaValida(lat, lng)) return;

                // Filtro exacto de distancia Haversine sobre candidatos geohash
                const distanceInM = calcularDistanciaKm(lat, lng, center[0], center[1]) * 1000;
                if (distanceInM <= (radiusInM * 1.15)) {
                    const existente = dbDirectorioMap.get(String(docId)) || {};
                    const safeData = Object.assign({}, existente, data, {
                        id: String(docId),
                        codigo: String(docId),
                        Coordenadas: { latitude: lat, longitude: lng },
                        lat: lat,
                        lng: lng
                    });
                    window.registrarEntidadDirectorio(docId, safeData);
                    integrados++;
                }
            });

            // Guardar metadatos honestos de la celda consultada (incluso si fue generación anterior)
            EstadoMapa.cobertura.celdas.set(claveCelda, {
                centro: center,
                radioM: radiusInM,
                categoria: categoriaConsulta,
                fecha: Date.now(),
                completo: true,
                truncado: arrayNegocios.length >= 450,
                registros: integrados
            });

            dbDirectorio = Array.from(dbDirectorioMap.values());
            window.dbDirectorio = dbDirectorio;
            datosDescargados = true;

            // Solo la generación vigente actualiza el estado visual de la vista
            if (miGeneracion !== EstadoMapa.consulta.generacionActual) return;

            zonaNecesitaDescarga = false;
            cajaFuerteEspacial = mapa.getBounds();

            if (btn) {
                btn.style.display = 'none';
                btn.innerText = "🔍 Buscar en esta zona";
                btn.style.background = "linear-gradient(45deg, var(--naranja), #ffcc00)";
            }

            const infoVista = EstadoMapa.cobertura.celdas.get(claveCelda);
            if (infoVista && infoVista.truncado) {
                window.actualizarEstadoRadar('cobertura_parcial');
            } else {
                window.actualizarEstadoRadar('listo');
            }

            if (typeof window.barridoRadar === "function") {
                const buscador = document.getElementById('input-buscador');
                window.barridoRadar(buscador ? buscador.value : '', { conservarRotacion: true });
            }
        } catch (error) {
            console.warn("[Radar] Fallo en consulta espacial, conservando datos previos:", error.message);
            if (miGeneracion === EstadoMapa.consulta.generacionActual) {
                window.actualizarEstadoRadar('error');
                setTimeout(() => {
                    if (EstadoMapa.consulta.estadoUI === 'error') window.actualizarEstadoRadar('listo');
                }, 3500);
            }
            if (btn) {
                btn.innerText = "🔍 Reintentar en esta zona";
                btn.style.display = 'block';
            }
        } finally {
            EstadoMapa.consulta.promesasEnVuelo.delete(claveCelda);
        }
    })();

    EstadoMapa.consulta.promesasEnVuelo.set(claveCelda, promesaActual);
    return promesaActual;
};

window.construirMapa = function() {
    let centroInicial = [-75.6961, 4.8133];
    let zoomInicial = 15;
    try {
        const camRam = sessionStorage.getItem('geokatu_last_cam');
        if (camRam) {
            const parsedCam = JSON.parse(camRam);
            if (parsedCam && window.esCoordenadaValida(parsedCam.lat, parsedCam.lng)) {
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
        minZoom: 9,
        maxZoom: 19,
        pitch: 0, 
        bearing: 0, 
        antialias: false 
    });

    mapa = window.mapa; 

    // Cancelar cualquier vuelo automático en cuanto el usuario toque o arrastre el mapa
    const marcarInteraccionHumana = (e) => {
        if (e && e.originalEvent) {
            EstadoMapa.vista.interaccionUsuario = true;
            if (EstadoMapa.vista.vueloCancelableId) {
                cancelAnimationFrame(EstadoMapa.vista.vueloCancelableId);
                EstadoMapa.vista.vueloCancelableId = null;
            }
        }
    };
    mapa.on('dragstart', marcarInteraccionHumana);
    mapa.on('zoomstart', marcarInteraccionHumana);
    mapa.on('pitchstart', marcarInteraccionHumana);
    mapa.on('rotatestart', marcarInteraccionHumana);

    const geolocateControl = new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,       
        showUserHeading: true,         
        fitBoundsOptions: { maxZoom: 16 } 
    });
    window.geolocateControl = geolocateControl;

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

    mapa.on('zoom', window.actualizarEscalaContinuaZoom);

    window.mapa.on('load', () => {
        window.actualizarEscalaContinuaZoom();
        console.log("🟢 [WebGL Engine] Mapa base cargado con niveles 9 - 19.");
    });
    
    let timerMovimiento;
    
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
                        const latN = (datosNuevos.Coordenadas && datosNuevos.Coordenadas.latitude) ?? datosNuevos.lat ?? (previo.Coordenadas && previo.Coordenadas.latitude);
                        const lngN = (datosNuevos.Coordenadas && datosNuevos.Coordenadas.longitude) ?? datosNuevos.lng ?? (previo.Coordenadas && previo.Coordenadas.longitude);
                        if (window.esCoordenadaValida(latN, lngN)) {
                            const fusionado = Object.assign({}, previo, datosNuevos, {
                                id: idNeg,
                                codigo: idNeg,
                                Coordenadas: { latitude: Number(latN), longitude: Number(lngN) }
                            });
                            window.registrarEntidadDirectorio(idNeg, fusionado);
                            huboCambio = true;
                        }
                    }
                }
            }
        } catch (eSync) {}

        if (huboCambio) {
            dbDirectorio = Array.from(dbDirectorioMap.values());
            window.dbDirectorio = dbDirectorio;
            datosDescargados = true;
        }
        if (mapa) {
            mapa.resize();
            const idEnfocarRam = sessionStorage.getItem('geokatu_enfocar_ram');
            if (idEnfocarRam) {
                sessionStorage.removeItem('geokatu_enfocar_ram');
                const comercioTarget = dbDirectorioMap.get(idEnfocarRam);
                if (comercioTarget && comercioTarget.Coordenadas) {
                    window.categoriaActivaGlobal = 'negocios';
                    window.volarCamaraHonesta(comercioTarget.Coordenadas.longitude, comercioTarget.Coordenadas.latitude, 17.5, 900);
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
                window.barridoRadar(buscador ? buscador.value : '', { conservarRotacion: true });
            }
        }
    };

    window.addEventListener('pageshow', function() {
        const pc = document.getElementById('pantalla-carga');
        if (pc) pc.style.display = 'none';
        window.sincronizarComerciosEditadosEnRAM();
    });

    window.addEventListener('storage', function(evt) {
        if (evt.key && evt.key.indexOf('geokatu_cache_neg_') === 0) {
            window.sincronizarComerciosEditadosEnRAM();
        }
    });

    // Debounce de 240 ms tras finalizar gesto con verificación de cobertura por celdas
    mapa.on('moveend', () => {
        clearTimeout(timerMovimiento);
        window.actualizarEscalaContinuaZoom();
        try {
            const c = mapa.getCenter();
            sessionStorage.setItem('geokatu_last_cam', JSON.stringify({
                lat: Number(c.lat.toFixed(6)),
                lng: Number(c.lng.toFixed(6)),
                zoom: Number(mapa.getZoom().toFixed(2))
            }));
        } catch (eC) {}

        const boundsActuales = mapa.getBounds();
        if (typeof dibujarPinesDesdeJSONCache === "function") {
            dibujarPinesDesdeJSONCache(boundsActuales);
        }
        
        timerMovimiento = setTimeout(() => {
            const currentCenter = mapa.getCenter();
            const catActiva = window.categoriaActivaGlobal || 'negocios';
            const cubierto = viewportCubiertoPorCeldas(mapa.getBounds(), catActiva);

            if (!cubierto && mapa.getZoom() >= 11.5) {
                zonaNecesitaDescarga = true;
                window.descargarNegociosDeFirebase({ centroExplicito: [currentCenter.lat, currentCenter.lng] });
            } else if (datosDescargados) {
                const buscador = document.getElementById('input-buscador');
                if (typeof window.barridoRadar === "function") {
                    window.barridoRadar(buscador ? buscador.value : '');
                }
            }
            ultimoCentroFetch = currentCenter;
        }, 240);
    });
    
    window.actualizarEscalaContinuaZoom();
    
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
    // 4. Búsqueda en el directorio local indexado (direcciones, barrios o comercios en RAM)
    if (Array.isArray(dbDirectorio) && dbDirectorio.length > 0) {
        const localMatch = dbDirectorio.find(function(p) {
            const bolsa = ((p.nombre || '') + ' ' + (p.direccion || '') + ' ' + (p.nicho || '') + ' ' + (p.categoria || '')).toLowerCase();
            return bolsa.includes(txtLower);
        });
        if (localMatch && localMatch.Coordenadas && window.esCoordenadaValida(localMatch.Coordenadas.latitude, localMatch.Coordenadas.longitude)) {
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
        EstadoMapa.vista.interaccionUsuario = false;
        window.volarCamaraHonesta(destino.lng, destino.lat, destino.zoom, 1000);
        if (destino.tipo === 'ciudad') {
            inputEl.value = '';
            window.descargarNegociosDeFirebase({ centroExplicito: [destino.lat, destino.lng], forzar: true });
        }
        setTimeout(function() {
            if (typeof window.barridoRadar === 'function') {
                window.barridoRadar(destino.tipo === 'ciudad' ? '' : texto);
            }
        }, 1050);
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

                            
// =========================================================================
// 🎲 BARAJADO FISHER-YATES, CAPACIDAD DINÁMICA Y COLISIONES (SECCIONES 8 Y 9)
// =========================================================================
function hashDeterminista(str) {
    let h = 2166136261 >>> 0;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function barajarFisherYates(arreglo, semillaBase = 1) {
    const copia = arreglo.slice();
    let seed = (Number(semillaBase) || 1) >>> 0;
    const rand = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = copia[i];
        copia[i] = copia[j];
        copia[j] = tmp;
    }
    return copia;
}

function calcularCapacidadPantalla() {
    const w = Math.max(280, window.innerWidth || 360);
    // Descontar controles superiores (~72px) e inferiores (~64px)
    const h = Math.max(240, (window.innerHeight || 640) - 136);
    const q = 0.5;
    const s = 52;
    const cCalc = Math.floor((q * w * h) / (s * s));
    return Math.max(12, Math.min(40, cCalc));
}

function esGestoSignificativo() {
    if (!mapa) return false;
    const centro = mapa.getCenter();
    const zoom = mapa.getZoom();
    const prevCentro = EstadoMapa.vista.ultimoCentroRotacion;
    const prevZoom = EstadoMapa.vista.ultimoZoomRotacion;

    if (!prevCentro || prevZoom === null) {
        EstadoMapa.vista.ultimoCentroRotacion = { lat: centro.lat, lng: centro.lng };
        EstadoMapa.vista.ultimoZoomRotacion = zoom;
        return true;
    }
    if (Math.abs(zoom - prevZoom) >= 0.35) {
        EstadoMapa.vista.ultimoCentroRotacion = { lat: centro.lat, lng: centro.lng };
        EstadoMapa.vista.ultimoZoomRotacion = zoom;
        return true;
    }
    const pActual = mapa.project([centro.lng, centro.lat]);
    const pPrevio = mapa.project([prevCentro.lng, prevCentro.lat]);
    const distPx = Math.hypot(pActual.x - pPrevio.x, pActual.y - pPrevio.y);
    const umbralPx = Math.max(75, (window.innerWidth || 360) * 0.25);

    if (distPx >= umbralPx) {
        EstadoMapa.vista.ultimoCentroRotacion = { lat: centro.lat, lng: centro.lng };
        EstadoMapa.vista.ultimoZoomRotacion = zoom;
        return true;
    }
    return false;
}

// Inyección de estilos base para caída lunar, micropines y lista de agrupaciones
(function inyectarEstilosDinamicosMapa() {
    if (document.getElementById('geokatu-lunar-styles')) return;
    const st = document.createElement('style');
    st.id = 'geokatu-lunar-styles';
    st.textContent = `
        #mapa-qrpido .pin-wrapper {
            transform: scale(var(--pin-zoom-scale, 0.75)) !important;
            pointer-events: auto !important;
        }
        .pin-lunar-drop {
            position: relative;
            width: 60px;
            height: 60px;
            display: flex;
            justify-content: center;
            align-items: center;
            transform: translate3d(var(--spider-dx, 0px), var(--spider-dy, 0px), 0);
            will-change: transform, opacity;
        }
        @keyframes caidaLunarGeokatu {
            0% { transform: translate3d(var(--spider-dx, 0px), calc(var(--spider-dy, 0px) - 24px), 0); opacity: 0; }
            32% { opacity: 1; }
            78% { transform: translate3d(var(--spider-dx, 0px), var(--spider-dy, 0px), 0); opacity: 1; }
            100% { transform: translate3d(var(--spider-dx, 0px), calc(var(--spider-dy, 0px) - 4px), 0); opacity: 1; }
        }
        .pin-lunar-drop.anim-entrada-lunar {
            animation: caidaLunarGeokatu 0.7s cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
            animation-delay: var(--lunar-delay, 0ms);
        }
        .pin-lunar-drop.aterrizado-fijo {
            transform: translate3d(var(--spider-dx, 0px), calc(var(--spider-dy, 0px) - 4px), 0);
            filter: drop-shadow(0 3px 5px rgba(0,0,0,0.45));
        }
        @media (prefers-reduced-motion: reduce) {
            .pin-lunar-drop.anim-entrada-lunar {
                animation: none !important;
                opacity: 1 !important;
                transform: translate3d(var(--spider-dx, 0px), var(--spider-dy, 0px), 0) !important;
            }
        }
        #radar-status-pill {
            position: fixed;
            top: 72px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(12, 12, 18, 0.9);
            border: 1px solid rgba(255, 107, 0, 0.45);
            color: #f8fafc;
            font-size: 11px;
            font-weight: 800;
            padding: 5px 14px;
            border-radius: 20px;
            z-index: 3200;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.25s ease;
            box-shadow: 0 4px 14px rgba(0,0,0,0.6);
            white-space: nowrap;
        }
        #radar-status-pill.visible { opacity: 1; }
        #modal-agrupacion-lista {
            position: fixed;
            bottom: 70px;
            left: 50%;
            transform: translateX(-50%);
            width: 92vw;
            max-width: 390px;
            max-height: 52vh;
            background: rgba(16, 16, 22, 0.96);
            backdrop-filter: blur(16px);
            border: 1.5px solid var(--naranja, #ff6b00);
            border-radius: 20px;
            padding: 14px;
            z-index: 4500;
            display: none;
            flex-direction: column;
            gap: 8px;
            box-shadow: 0 15px 40px rgba(0,0,0,0.85);
            box-sizing: border-box;
        }
        #modal-agrupacion-lista.activo { display: flex; }
    `;
    document.head.appendChild(st);

    window.addEventListener('DOMContentLoaded', () => {
        if (!document.getElementById('radar-status-pill')) {
            const pill = document.createElement('div');
            pill.id = 'radar-status-pill';
            document.body.appendChild(pill);
        }
        if (!document.getElementById('modal-agrupacion-lista')) {
            const modalAgrup = document.createElement('div');
            modalAgrup.id = 'modal-agrupacion-lista';
            document.body.appendChild(modalAgrup);
        }
    });
})();

// =========================================================================
// 🌌 CAPAS WEBGL DE ÚLTIMA Y PENÚLTIMA ALTURA + LISTA PAGINADA (SECCIÓN 8)
// =========================================================================
window.abrirListaAgrupacion = function(listaComercios, pagina = 0) {
    const contenedor = document.getElementById('modal-agrupacion-lista');
    if (!contenedor || !Array.isArray(listaComercios) || listaComercios.length === 0) return;

    const POR_PAGINA = 8;
    const totalPaginas = Math.ceil(listaComercios.length / POR_PAGINA);
    const pagActual = Math.max(0, Math.min(pagina, totalPaginas - 1));
    const lote = listaComercios.slice(pagActual * POR_PAGINA, (pagActual + 1) * POR_PAGINA);

    window._listaAgrupacionActiva = listaComercios;

    const itemsHtml = lote.map(p => {
        const nombreSeg = window.sanitizarTexto(p.nombre || 'Comercio');
        const nichoSeg = window.sanitizarTexto(p.nicho || p.categoria || 'Local');
        const codSeg = String(p.codigo || p.id || '').replace(/'/g, "\\'");
        const lat = Number(p.Coordenadas?.latitude ?? p.lat ?? 4.8133);
        const lng = Number(p.Coordenadas?.longitude ?? p.lng ?? -75.6961);
        return `
            <div onclick="window.seleccionarComercioDesdeAgrupacion('${codSeg}', ${lat}, ${lng})" style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); border-radius:10px; cursor:pointer;">
                <div style="overflow:hidden;">
                    <div style="font-size:12px; font-weight:800; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${nombreSeg}</div>
                    <div style="font-size:10px; color:#ff6b00; font-weight:700; text-transform:uppercase;">${nichoSeg}</div>
                </div>
                <span style="font-size:11px; color:#cbd5e1; font-weight:900; padding-left:8px;">Ver 📍</span>
            </div>
        `;
    }).join('');

    const navHtml = totalPaginas > 1 ? `
        <div style="display:flex; justify-content:space-between; align-items:center; padding-top:4px;">
            <button onclick="window.abrirListaAgrupacion(window._listaAgrupacionActiva, ${pagActual - 1})" ${pagActual === 0 ? 'disabled style="opacity:0.35; background:transparent; border:none; color:#fff;"' : 'style="background:rgba(255,107,0,0.2); border:1px solid #ff6b00; color:#fff; border-radius:8px; padding:4px 10px; font-size:11px; font-weight:800; cursor:pointer;"'}>◀ Anterior</button>
            <span style="font-size:10px; color:#94a3b8; font-weight:700;">Pág ${pagActual + 1} de ${totalPaginas}</span>
            <button onclick="window.abrirListaAgrupacion(window._listaAgrupacionActiva, ${pagActual + 1})" ${pagActual >= totalPaginas - 1 ? 'disabled style="opacity:0.35; background:transparent; border:none; color:#fff;"' : 'style="background:rgba(255,107,0,0.2); border:1px solid #ff6b00; color:#fff; border-radius:8px; padding:4px 10px; font-size:11px; font-weight:800; cursor:pointer;"'}>Siguiente ▶</button>
        </div>
    ` : '';

    contenedor.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:6px;">
            <span style="font-size:12px; font-weight:900; color:#ff6b00; text-transform:uppercase;">📍 ${listaComercios.length} ubicaciones en este punto</span>
            <button onclick="document.getElementById('modal-agrupacion-lista').classList.remove('activo')" style="background:transparent; border:none; color:#94a3b8; font-size:16px; font-weight:900; cursor:pointer;">✕</button>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px; overflow-y:auto; max-height:34vh; padding-right:2px;">
            ${itemsHtml}
        </div>
        ${navHtml}
    `;
    contenedor.classList.add('activo');
};

window.seleccionarComercioDesdeAgrupacion = function(codigo, lat, lng) {
    const contenedor = document.getElementById('modal-agrupacion-lista');
    if (contenedor) contenedor.classList.remove('activo');
    EstadoMapa.seleccion.pinAbiertoId = String(codigo);
    EstadoMapa.vista.interaccionUsuario = false;
    window.volarCamaraHonesta(lng, lat, Math.max(mapa.getZoom(), 16.8), 850);
    setTimeout(() => {
        const buscador = document.getElementById('input-buscador');
        window.barridoRadar(buscador ? buscador.value : '', { conservarRotacion: true });
        if (window.marcadoresRadar && window.marcadoresRadar[codigo]) {
            const pop = window.marcadoresRadar[codigo].getPopup();
            if (pop && !pop.isOpen()) window.marcadoresRadar[codigo].togglePopup();
        }
    }, 900);
};

function actualizarCapasLejanasWebGL(elegibles, modoZoom) {
    if (!mapa || !mapa.isStyleLoaded()) return;

    // Deduplicar por ID para jamás sumar documentos repetidos
    const vistos = new Set();
    const features = [];
    for (let i = 0; i < elegibles.length; i++) {
        const p = elegibles[i];
        const idUnico = String(p.codigo || p.id || '');
        if (!idUnico || vistos.has(idUnico)) continue;
        const lat = Number(p.Coordenadas?.latitude ?? p.lat);
        const lng = Number(p.Coordenadas?.longitude ?? p.lng);
        if (!window.esCoordenadaValida(lat, lng)) continue;
        vistos.add(idUnico);

        const colorCat = p.tipo_modelo === 'inmueble' ? '#00f5d4' : (p.tipo_modelo === 'servicio' ? '#38bdf8' : (p.color_principal || '#ff6b00'));
        features.push({
            type: 'Feature',
            properties: {
                id: idUnico,
                nombre: p.nombre || 'Comercio',
                color: colorCat
            },
            geometry: { type: 'Point', coordinates: [lng, lat] }
        });
    }

    const geojsonData = { type: 'FeatureCollection', features };
    const mostrarWebGL = (modoZoom === 'ultima' || modoZoom === 'penultima');

    try {
        if (mapa.getSource('geokatu-constelacion-source')) {
            mapa.getSource('geokatu-constelacion-source').setData(geojsonData);
        } else {
            mapa.addSource('geokatu-constelacion-source', {
                type: 'geojson',
                data: geojsonData,
                cluster: true,
                clusterMaxZoom: 15,
                clusterRadius: 42
            });

            // Círculos de agregados con r = clamp(r0 + k*sqrt(n), rmin, rmax)
            mapa.addLayer({
                id: 'geokatu-clusters-layer',
                type: 'circle',
                source: 'geokatu-constelacion-source',
                filter: ['has', 'point_count'],
                paint: {
                    'circle-color': '#ff6b00',
                    'circle-radius': [
                        'min', 26,
                        ['max', 11, ['+', 8, ['*', 2.2, ['sqrt', ['get', 'point_count']]]]]
                    ],
                    'circle-opacity': 0.88,
                    'circle-stroke-width': 1.5,
                    'circle-stroke-color': '#ffffff'
                }
            });

            // Conteo exacto sobre cada agregado
            mapa.addLayer({
                id: 'geokatu-clusters-count',
                type: 'symbol',
                source: 'geokatu-constelacion-source',
                filter: ['has', 'point_count'],
                layout: {
                    'text-field': '{point_count_abbreviated}',
                    'text-size': 11,
                    'text-allow-overlap': true
                },
                paint: {
                    'text-color': '#ffffff'
                }
            });

            // Micropines de 5-9 px con borde fino de contraste y sin animación permanente
            mapa.addLayer({
                id: 'geokatu-micropines-layer',
                type: 'circle',
                source: 'geokatu-constelacion-source',
                filter: ['!', ['has', 'point_count']],
                paint: {
                    'circle-color': ['get', 'color'],
                    'circle-radius': [
                        'interpolate', ['linear'], ['zoom'],
                        10, 3.2,
                        13.8, 4.5
                    ],
                    'circle-stroke-width': 1,
                    'circle-stroke-color': '#0a0a0c',
                    'circle-opacity': 0.92
                }
            });

            mapa.on('click', 'geokatu-clusters-layer', (e) => {
                const feats = mapa.queryRenderedFeatures(e.point, { layers: ['geokatu-clusters-layer'] });
                if (!feats || !feats.length) return;
                const clusterId = feats[0].properties.cluster_id;
                const coords = feats[0].geometry.coordinates;
                const src = mapa.getSource('geokatu-constelacion-source');
                if (src && typeof src.getClusterLeaves === 'function') {
                    src.getClusterLeaves(clusterId, 100, 0, (err, leaves) => {
                        if (!err && leaves && leaves.length > 0) {
                            const comerciosCluster = leaves
                                .map(f => dbDirectorioMap.get(String(f.properties.id)))
                                .filter(Boolean);
                            if (mapa.getZoom() < 13.2) {
                                window.volarCamaraHonesta(coords[0], coords[1], Math.min(15.2, mapa.getZoom() + 2.2), 800);
                            } else {
                                window.abrirListaAgrupacion(comerciosCluster, 0);
                            }
                        }
                    });
                }
            });

            mapa.on('click', 'geokatu-micropines-layer', (e) => {
                const feat = e.features && e.features[0];
                if (!feat) return;
                const idCom = String(feat.properties.id);
                const coords = feat.geometry.coordinates;
                window.seleccionarComercioDesdeAgrupacion(idCom, coords[1], coords[0]);
            });
        }

        const vis = mostrarWebGL ? 'visible' : 'none';
        ['geokatu-clusters-layer', 'geokatu-clusters-count', 'geokatu-micropines-layer'].forEach(idL => {
            if (mapa.getLayer(idL)) mapa.setLayoutProperty(idL, 'visibility', vis);
        });
    } catch (eWebGL) {
        console.warn('[Radar WebGL] Aviso en capas lejanas:', eWebGL.message);
    }
}

// =========================================================================
// 🛰️ MOTOR PRINCIPAL DE BARRIDO DIFERENCIAL, ROTACIÓN Y COLISIONES
// =========================================================================
window.barridoRadar = function(filtroTexto = "", opciones = {}) {
    if (!datosDescargados || !mapa) return;

    window.actualizarEscalaContinuaZoom();
    const modoZoom = EstadoMapa.vista.modoZoomActual || 'barrio';
    const catActiva = window.categoriaActivaGlobal || 'negocios';
    const favsStorage = JSON.parse(localStorage.getItem('geokatu_favoritos_anon')) || [];
    const favsIds = favsStorage.map(f => f.id);
    const filtroEanIds = Array.isArray(window._filtroEanIdsActivo) ? window._filtroEanIdsActivo : null;

    // 1. Filtrar universo elegible del directorio público
    let filtrados = (dbDirectorio || []).filter(p => {
        if (!p) return false;
        if (filtroEanIds && !filtroEanIds.includes(String(p.codigo || p.id))) return false;

        if (catActiva === 'inmuebles') {
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
        } else if (catActiva === 'comercios' || catActiva === 'negocios') {
            const esCom = ['negocio', 'comercio', 'tienda'].includes(p.tipo_modelo) || p.categoria_maestra === 'comercio' || Boolean(p.nombre && !p.es_inmueble_real && p.tipo_modelo !== 'conductor');
            if (!esCom) return false;

            const fc = window.filtrosComerciosEstado || {};
            const strCom = `${p.nombre || ''} ${p.niche || ''} ${p.categoria || ''} ${p.palabras_clave || ''}`.toLowerCase();

            if (fc.categoria && fc.categoria !== 'todos' && !strCom.includes(fc.categoria.toLowerCase())) return false;
            if (fc.subtipo && fc.subtipo !== 'todos' && !strCom.includes(fc.subtipo.toLowerCase())) return false;
            if (fc.domicilio === 'si' && p.domicilio_activo === false) return false;
            if (fc.domicilio === 'local' && p.solo_recogida !== true) return false;
        } else if (catActiva === 'servicios') {
            const esServ = p.tipo_modelo === 'servicio' || p.categoria_maestra === 'servicio';
            if (!esServ) return false;

            const fs = window.filtrosServiciosEstado || {};
            const strServ = `${p.nombre || ''} ${p.niche || ''} ${p.categoria || ''} ${p.palabras_clave || ''}`.toLowerCase();

            if (fs.categoria && fs.categoria !== 'todos' && !strServ.includes(fs.categoria.toLowerCase())) return false;
            if (fs.subtipo && fs.subtipo !== 'todos' && !strServ.includes(fs.subtipo.toLowerCase())) return false;
            if (fs.modalidad === 'domicilio' && !strServ.includes('domicilio')) return false;
            if (fs.modalidad === 'sede' && !strServ.includes('local') && !strServ.includes('sede')) return false;
        }

        if (filtroTexto && typeof filtroTexto === 'string' && !filtroTexto.startsWith('Stock:')) {
            const txt = filtroTexto.toLowerCase().trim();
            const tagsStr = Array.isArray(p.tags_busqueda) ? p.tags_busqueda.join(' ') : (p.tags_busqueda || '');
            const strCompleto = `${p.nombre || ''} ${p.niche || ''} ${p.categoria || ''} ${p.palabras_clave || ''} ${tagsStr} ${p.slogan || ''}`.toLowerCase();
            if (!strCompleto.includes(txt)) return false;
        }

        if (filtrandoFavoritos && !favsIds.includes(encodeURIComponent(p.codigo))) {
            return false;
        }
        return true;
    });

    // 2. Actualizar siempre la representación WebGL para modos lejanos (Última y Penúltima altura)
    actualizarCapasLejanasWebGL(filtrados, modoZoom);

    // En Última y Penúltima altura (z < 14), todos se representan en WebGL; ocultar DOM salvo el seleccionado
    if (modoZoom === 'ultima' || modoZoom === 'penultima') {
        for (let idClon in window.marcadoresRadar) {
            if (idClon !== EstadoMapa.seleccion.pinAbiertoId) {
                try { window.marcadoresRadar[idClon].remove(); } catch (e) {}
                delete window.marcadoresRadar[idClon];
            }
        }
        return;
    }

    const limiteMapa = mapa.getBounds();
    const userCenter = mapa.getCenter();
    window.marcadoresRadar = window.marcadoresRadar || {};
    let tarjetasHibridasHtml = '';
    const favs = favsIds;

    // 3. Candidatos dentro del viewport actual
    let candidatosViewport = filtrados.filter(p => {
        if (!p.Coordenadas) return false;
        const latSegura = Number(p.Coordenadas.latitude);
        const lngSegura = Number(p.Coordenadas.longitude);
        if (!window.esCoordenadaValida(latSegura, lngSegura)) return false;
        return limiteMapa.contains([lngSegura, latSegura]);
    });

    // 4. Selección equitativa con capacidad dinámica C, mínimo 40% general y máx 20% rotación por gesto significativo
    const capacidadC = calcularCapacidadPantalla();
    const gestoSignificativo = opciones.conservarRotacion ? false : esGestoSignificativo();
    const pinAbierto = EstadoMapa.seleccion.pinAbiertoId;

    let pinesSeleccionados = [];
    if (candidatosViewport.length <= capacidadC) {
        pinesSeleccionados = candidatosViewport.slice();
        window.memoriaRadar = pinesSeleccionados.map(p => p.codigo);
    } else {
        window.memoriaRadar = window.memoriaRadar || [];
        const setMemoriaPrevia = new Set(window.memoriaRadar);

        // Si NO hubo gesto significativo, conservar intactos los que siguen en pantalla
        const tasaSupervivencia = gestoSignificativo ? 0.80 : 1.0;
        const maxSobrevivientes = Math.floor(capacidadC * tasaSupervivencia);

        const enPantallaPrevios = candidatosViewport.filter(p => setMemoriaPrevia.has(p.codigo));
        // Asegurar que el pin abierto jamás se descarte
        enPantallaPrevios.sort((a, b) => {
            if (a.codigo === pinAbierto) return -1;
            if (b.codigo === pinAbierto) return 1;
            return 0;
        });

        const sobrevivientes = enPantallaPrevios.slice(0, maxSobrevivientes);
        const setSobrevivientes = new Set(sobrevivientes.map(p => p.codigo));
        const plazasRestantes = Math.max(0, capacidadC - sobrevivientes.length);

        if (plazasRestantes > 0) {
            const restantes = candidatosViewport.filter(p => !setSobrevivientes.has(p.codigo));

            // Barajado sin reemplazo Fisher-Yates + prioridad a los que llevan más tiempo sin exponerse
            const barajados = barajarFisherYates(restantes, EstadoMapa.seleccion.semillaSesion + EstadoMapa.consulta.generacionActual);
            barajados.sort((a, b) => {
                const tA = EstadoMapa.seleccion.ultimaExposicionTs.get(a.codigo) || 0;
                const tB = EstadoMapa.seleccion.ultimaExposicionTs.get(b.codigo) || 0;
                return tA - tB;
            });

            // Garantizar al menos 40% del total C para exposición general/gratuita
            const esPromocionado = (p) => Boolean(p.red_afiliados === true || p.red_afiliados === 'SI' || p.premium === true || p.premium === 'SI' || p.promo === 'SI');
            const generalesSobrevivientes = sobrevivientes.filter(p => !esPromocionado(p)).length;
            const minimoGeneralTotal = Math.ceil(capacidadC * 0.40);
            const cuotaGeneralNueva = Math.max(0, Math.min(plazasRestantes, minimoGeneralTotal - generalesSobrevivientes));

            const colaGeneral = barajados.filter(p => !esPromocionado(p));
            const colaPromo = barajados.filter(p => esPromocionado(p));

            const nuevosElegidos = [];
            for (let i = 0; i < colaGeneral.length && nuevosElegidos.length < cuotaGeneralNueva; i++) {
                nuevosElegidos.push(colaGeneral[i]);
            }
            const setNuevos = new Set(nuevosElegidos.map(p => p.codigo));
            const poolCombinado = colaPromo.concat(colaGeneral).filter(p => !setNuevos.has(p.codigo));

            for (let i = 0; i < poolCombinado.length && nuevosElegidos.length < plazasRestantes; i++) {
                nuevosElegidos.push(poolCombinado[i]);
            }

            pinesSeleccionados = sobrevivientes.concat(nuevosElegidos);
        } else {
            pinesSeleccionados = sobrevivientes;
        }

        const ahoraTs = Date.now();
        pinesSeleccionados.forEach(p => EstadoMapa.seleccion.ultimaExposicionTs.set(p.codigo, ahoraTs));
        window.memoriaRadar = pinesSeleccionados.map(p => p.codigo);
    }

    // 5. Cuadrícula de colisiones en pantalla y expansión radial (Spiderfy) para coordenadas idénticas
    const gruposCoordenada = new Map();
    pinesSeleccionados.forEach(p => {
        const claveCoord = `${Number(p.Coordenadas.latitude).toFixed(5)}:${Number(p.Coordenadas.longitude).toFixed(5)}`;
        if (!gruposCoordenada.has(claveCoord)) gruposCoordenada.set(claveCoord, []);
        gruposCoordenada.get(claveCoord).push(p);
    });

    const celdaColisionPx = modoZoom === 'cercano' ? 42 : 48;
    const celdasPantallaOcupadas = new Set();
    const pinesEnPantalla = [];
    const desplazamientosSpider = new Map();

    // Priorizar el pin abierto para que jamás pierda su celda de pantalla
    pinesSeleccionados.sort((a, b) => {
        if (a.codigo === pinAbierto) return -1;
        if (b.codigo === pinAbierto) return 1;
        return 0;
    });

    pinesSeleccionados.forEach(p => {
        const claveCoord = `${Number(p.Coordenadas.latitude).toFixed(5)}:${Number(p.Coordenadas.longitude).toFixed(5)}`;
        const hermanos = gruposCoordenada.get(claveCoord) || [p];
        const idxHermano = hermanos.indexOf(p);

        if (hermanos.length > 1 && idxHermano > 0) {
            if (modoZoom === 'cercano' && idxHermano < 6) {
                // Expansión radial visual en píxeles sin alterar coordenadas geográficas
                const angulo = (idxHermano / Math.min(6, hermanos.length)) * 2 * Math.PI;
                const radioPx = 28;
                desplazamientosSpider.set(p.codigo, {
                    dx: Math.round(Math.cos(angulo) * radioPx),
                    dy: Math.round(Math.sin(angulo) * radioPx),
                    totalCoincidentes: hermanos.length,
                    grupo: hermanos
                });
                pinesEnPantalla.push(p);
            }
            return;
        }

        const pt = mapa.project([p.Coordenadas.longitude, p.Coordenadas.latitude]);
        const gx = Math.floor(pt.x / celdaColisionPx);
        const gy = Math.floor(pt.y / celdaColisionPx);
        const claveGrid = `${gx}:${gy}`;

        if (p.codigo === pinAbierto || !celdasPantallaOcupadas.has(claveGrid)) {
            celdasPantallaOcupadas.add(claveGrid);
            if (hermanos.length > 1) {
                desplazamientosSpider.set(p.codigo, {
                    dx: 0,
                    dy: 0,
                    totalCoincidentes: hermanos.length,
                    grupo: hermanos
                });
            }
            pinesEnPantalla.push(p);
        }
    });

    // 6. Retirada diferencial suave de marcadores que ya no están en la selección
    const codigosEnPantalla = new Set(pinesEnPantalla.map(p => p.codigo));
    for (let idClon in window.marcadoresRadar) {
        if (!codigosEnPantalla.has(idClon) && idClon !== pinAbierto) {
            const markerSaliente = window.marcadoresRadar[idClon];
            if (markerSaliente && !markerSaliente._desvaneciendo) {
                markerSaliente._desvaneciendo = true;
                const elPinOut = markerSaliente.getElement ? markerSaliente.getElement() : null;
                if (elPinOut) {
                    elPinOut.style.transition = 'opacity 0.24s ease-out';
                    elPinOut.style.opacity = '0';
                    elPinOut.style.pointerEvents = 'none';
                }
                markerSaliente._timerFadeOut = setTimeout(() => {
                    try { markerSaliente.remove(); } catch (eR) {}
                    if (window.marcadoresRadar[idClon] === markerSaliente) {
                        delete window.marcadoresRadar[idClon];
                    }
                }, 240);
            }
        } else {
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

    // No confundir fallo de red con cero negocios
    if (pinesEnPantalla.length === 0) {
        if (EstadoMapa.consulta.estadoUI !== 'error' && EstadoMapa.consulta.estadoUI !== 'consultando') {
            const toast = document.getElementById('toast-fantasma');
            if (toast) {
                let mensajeToast = "No encontramos resultados confirmados en esta zona";
                if (filtrandoFavoritos) {
                    mensajeToast = "No tienes guardados en esta zona";
                } else if (typeof window.obtenerMensajeSinResultados === 'function') {
                    mensajeToast = window.obtenerMensajeSinResultados();
                }
                toast.innerText = mensajeToast;
                toast.style.opacity = '1';
                setTimeout(() => { toast.style.opacity = '0'; }, 3000);
            }
        }
        return;
    }

    // 7. Renderizado diferencial de pines con física de caída lunar
    pinesEnPantalla.forEach(p => {
        const pos = { lat: p.Coordenadas.latitude, lng: p.Coordenadas.longitude };
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

        if (catActiva === 'inmuebles') {
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
        
        let htmlAtributosGorras = '';
        if (emojiGorra) {
            htmlAtributosGorras = `data-emoji="${emojiGorra}" data-anclaje="${claseAnclaje}"`;
        }

        var esTemaClasico = (p.tema_popup === 'clasico');
        var colorBotonRaw = (paleta && paleta.c3) ? paleta.c3 : (c2 || '#ff6b00');
        var estiloBoton = window.resolverEstiloBotonAccion(colorBotonRaw, esTemaClasico);

        var colorSlogan = (paleta && paleta.c2) ? paleta.c2 : '#8a909d';
        if (esTemaClasico && window.obtenerLuminanciaYIQ(colorSlogan) > 170) {
            colorSlogan = '#334155';
        } else if (!esTemaClasico && window.obtenerLuminanciaYIQ(colorSlogan) < 40) {
            colorSlogan = '#cbd5e1';
        }

        var candidataPng = p.nombre_png || p.logo_pin || p.logo_nombre || '';
        var urlSeguraPng = '';
        if (candidataPng && candidataPng !== p.logo && candidataPng !== p.portada && candidataPng !== logoSeguro) {
            urlSeguraPng = escapeQuotes(candidataPng);
        }

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

        var infoSpider = desplazamientosSpider.get(p.codigo);
        var btnCoincidentesPopup = '';
        if (infoSpider && infoSpider.totalCoincidentes > 1) {
            btnCoincidentesPopup = `<button type="button" onclick="window.abrirListaAgrupacion(window._gruposCoincidentesMap['${String(p.codigo).replace(/'/g, "\\'")}'], 0)" style="width:100%; margin-top:6px; background:rgba(255,107,0,0.18); border:1px solid #ff6b00; color:#fff; border-radius:8px; padding:5px; font-size:9.5px; font-weight:800; cursor:pointer;">📍 Ver ${infoSpider.totalCoincidentes} negocios en esta dirección</button>`;
            window._gruposCoincidentesMap = window._gruposCoincidentesMap || {};
            window._gruposCoincidentesMap[p.codigo] = infoSpider.grupo;
        }

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
                    btnCoincidentesPopup +
                    '<div class="popup-micro-fila-status">' +
                        '<button type="button" class="btn-micro-status" onclick="window.mostrarAvisoVerificacionModal(\'' + semaforoOverlayId + '\', \'' + horarioOverlayId + '\')" title="' + semaforoTexto + '">' +
                            '<span class="dot-status" style="background: ' + semaforoColor + '; box-shadow: 0 0 6px ' + semaforoColor + ';"></span>' +
                        '</button>' +
                        '<button type="button" class="btn-micro-status" onclick="window.mostrarAvisoHorarioModal(\'' + horarioOverlayId + '\', \'' + semaforoOverlayId + '\')" title="' + evalHorario.texto + '">' +
                            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="' + evalHorario.color + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 4px ' + evalHorario.color + ');"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>' +
                        '</button>' +
                    '</div>' +
                    '<div id="' + semaforoOverlayId + '" class="popup-aviso-verificacion" style="display: none; border-color: ' + semaforoColor + ';">' +
                        '<span style="color: ' + semaforoColor + '; font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; line-height: 1.2;">' + semaforoTexto + '</span>' +
                    '</div>' +
                    '<div id="' + horarioOverlayId + '" class="popup-aviso-verificacion" style="display: none; border-color: ' + evalHorario.color + ';">' +
                        '<span style="color: ' + evalHorario.color + '; font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; line-height: 1.2;">' + evalHorario.texto + '</span>' +
                    '</div>' +
                    bloquePublicidad +
                '</div>' +
            '</div>';

        const firmaVisualActual = (p.pin_pack || '') + '|' + c1 + '|' + c2 + '|' + (p.link_pin || p.portada || '') + '|' + (infoSpider ? infoSpider.totalCoincidentes : 1);

        // Si el marcador ya existe y conserva su firma visual, actualizar popup y offset spider sin destruir ni repetir caída lunar
        if (window.marcadoresRadar[p.codigo] && window.marcadoresRadar[p.codigo]._firmaVisual === firmaVisualActual) {
            const mExistente = window.marcadoresRadar[p.codigo];
            const popExistente = mExistente.getPopup ? mExistente.getPopup() : null;
            if (popExistente) popExistente.setHTML(htmlPopup);
            const elExistente = mExistente.getElement ? mExistente.getElement() : null;
            const dropWrapper = elExistente ? elExistente.querySelector('.pin-lunar-drop') : null;
            if (dropWrapper) {
                dropWrapper.style.setProperty('--spider-dx', `${infoSpider ? infoSpider.dx : 0}px`);
                dropWrapper.style.setProperty('--spider-dy', `${infoSpider ? infoSpider.dy : 0}px`);
            }
        } else {
            const teniaPopupAbierto = Boolean(
                window.marcadoresRadar[p.codigo] &&
                window.marcadoresRadar[p.codigo].getPopup() &&
                window.marcadoresRadar[p.codigo].getPopup().isOpen()
            );
            if (window.marcadoresRadar[p.codigo]) {
                try { window.marcadoresRadar[p.codigo].remove(); } catch (eRem) {}
                delete window.marcadoresRadar[p.codigo];
            }

            const elDOM = document.createElement('div');
            elDOM.style.width = '60px';
            elDOM.style.height = '60px';
            elDOM.style.display = 'flex';
            elDOM.style.justifyContent = 'center';
            elDOM.style.alignItems = 'center';
            elDOM.style.cursor = 'pointer';

            let svgSilueta = '<path d="M 30,57 C 30,57 10,38 10,20 C 10,9 19,3 30,3 C 41,3 50,9 50,20 C 50,38 30,57 30,57 Z" />';
            if (claseForma === 'forma-esfera') svgSilueta = '<circle cx="30" cy="30" r="26" />';
            else if (claseForma === 'forma-triangulo') svgSilueta = '<polygon points="6,8 54,8 30,54" stroke-linejoin="round" />';
            else if (claseForma === 'forma-estrella') svgSilueta = '<polygon points="30,4 38,23 57,23 42,34 48,53 30,42 12,53 18,34 3,23 22,23" stroke-linejoin="round" />';
            else if (claseForma === 'forma-hexagono') svgSilueta = '<polygon points="30,4 53,17 53,43 30,56 7,43 7,17" stroke-linejoin="round" />';
            else if (claseForma === 'forma-corazon') svgSilueta = '<path d="M 30 16 C 22 2 10 6 10 20 C 10 35 25 45 30 57 C 35 45 50 35 50 20 C 50 6 38 2 30 16 Z" stroke-linejoin="round" />';
            else if (claseForma === 'forma-arbol') svgSilueta = '<polygon points="26,56 34,56 34,42 50,42 30,6 10,42 26,42" stroke-linejoin="round" />';
            else if (claseForma === 'forma-hongo') svgSilueta = '<path d="M 24 56 L 36 56 L 36 36 L 52 36 C 52 15 44 8 30 8 C 16 8 8 15 8 36 L 24 36 Z" stroke-linejoin="round" />';
            else if (claseForma === 'forma-paleta') svgSilueta = '<path d="M 28 56 L 32 56 L 32 37 A 16 16 0 1 0 28 37 Z" stroke-linejoin="round" />';

            const urlCandidata = p.link_pin || p.logo || p.portada || p.imagen_perfil || p.foto_portada || logoSeguro;
            const tieneFotoValida = typeof urlCandidata === 'string' && urlCandidata.trim().length > 5 && urlCandidata !== 'null' && urlCandidata !== 'undefined';

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

            // Desfase determinista 0-120 ms para caída lunar sin efecto cortina
            const delayLunarMs = hashDeterminista(p.codigo) % 121;
            const dxSpider = infoSpider ? infoSpider.dx : 0;
            const dySpider = infoSpider ? infoSpider.dy : 0;
            const badgeClusterHtml = (infoSpider && infoSpider.totalCoincidentes > 1 && dxSpider === 0 && dySpider === 0)
                ? `<span style="position:absolute; top:-4px; right:-4px; background:#ff6b00; color:#fff; border:1.5px solid #fff; border-radius:10px; font-size:9px; font-weight:900; padding:1px 5px; z-index:20;">+${infoSpider.totalCoincidentes - 1}</span>`
                : '';

            elDOM.innerHTML = 
                `<div class="pin-lunar-drop anim-entrada-lunar" style="--lunar-delay:${delayLunarMs}ms; --spider-dx:${dxSpider}px; --spider-dy:${dySpider}px;">` +
                    `<div class="pin-wrapper ${claseVisualPin}" data-forma="${claseForma}" style="${cssVarsPin}" ${htmlAtributosGorras}>` +
                        svgSiluetaCompleta +
                        badgeClusterHtml +
                    `</div>` +
                `</div>`;

            const dropEl = elDOM.querySelector('.pin-lunar-drop');
            if (dropEl) {
                dropEl.addEventListener('animationend', () => {
                    dropEl.classList.remove('anim-entrada-lunar');
                    dropEl.classList.add('aterrizado-fijo');
                }, { once: true });
            }

            if (tieneFotoValida) {
                const imgPreload = new Image();
                imgPreload.onerror = () => {
                    const svgImg = elDOM.querySelector('image');
                    if (svgImg) svgImg.setAttribute('href', fallbackSVGAureo);
                };
                imgPreload.src = urlCandidata;
            }

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

            popup.on('open', () => {
                EstadoMapa.seleccion.pinAbiertoId = String(p.codigo);
                if (esCustomTema) {
                    const hexC = rawTemaP.replace('custom:', '').replace('#', '').trim();
                    const rC = parseInt(hexC.substring(0, 2), 16) || 255;
                    const gC = parseInt(hexC.substring(2, 4), 16) || 107;
                    const bC = parseInt(hexC.substring(4, 6), 16) || 0;
                    const elContent = popup.getElement() ? popup.getElement().querySelector('.maplibregl-popup-content') : null;
                    if (elContent) {
                        elContent.style.setProperty('background', 'linear-gradient(145deg, rgba(' + rC + ',' + gC + ',' + bC + ',0.34), rgba(' + Math.round(rC * 0.16) + ',' + Math.round(gC * 0.16) + ',' + Math.round(bC * 0.16) + ',0.92))', 'important');
                        elContent.style.setProperty('border-color', 'rgba(' + rC + ',' + gC + ',' + bC + ',0.55)', 'important');
                    }
                }
            });

            popup.on('close', () => {
                if (EstadoMapa.seleccion.pinAbiertoId === String(p.codigo)) {
                    EstadoMapa.seleccion.pinAbiertoId = null;
                }
            });

            const calibrarOrientacionVertical = () => {
                if (!mapa) return;
                const posPixel = mapa.project([pos.lng, pos.lat]);
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

            const marker = new maplibregl.Marker({ element: elDOM, anchor: 'bottom' })
                .setLngLat([pos.lng, pos.lat])
                .setPopup(popup)
                .addTo(mapa);

            if (teniaPopupAbierto || EstadoMapa.seleccion.pinAbiertoId === String(p.codigo)) {
                setTimeout(() => {
                    if (!popup.isOpen()) marker.togglePopup();
                }, 40);
            }

            marker._firmaVisual = firmaVisualActual;
            window.marcadoresRadar[p.codigo] = marker;
        }

        window.cerrarTarjetaInmueble = function(event, elemento) {
            event.stopPropagation(); 
            elemento.closest('.tarjeta-hibrida').style.display = 'none';
        };

        if (catActiva === 'inmuebles') {
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
        if (catActiva === 'inmuebles' && tarjetasHibridasHtml !== '') {
            sheetHibrido.innerHTML = tarjetasHibridasHtml;
            sheetHibrido.classList.add('activo');
        } else {
            sheetHibrido.classList.remove('activo');
            sheetHibrido.innerHTML = '';
        }
    }
};

window.cargarCaballoTroya = function() {
    if (!dbTroya || dbTroya.length === 0) return;
    const troyasActivos = dbTroya.filter(t => t.activo === true || t.activo === "SI");
    if (troyasActivos.length > 0) {
        document.getElementById('img-troya').src = troyasActivos[0].imagen_16_9 || dbSimbologia['banner_noticias_generico'];
        document.getElementById('link-troya').href = troyasActivos[0].link_accion || '#';
        document.getElementById('contenedor-troya').style.display = 'block';
    }
};

document.getElementById('input-buscador')?.addEventListener('input', (e) => {
    clearTimeout(window.timerBusqueda);
    if (!e.target.value.startsWith('Stock:')) {
        window._filtroEanIdsActivo = null;
    }
    window.timerBusqueda = setTimeout(() => {
        if (datosDescargados) window.barridoRadar(e.target.value, { conservarRotacion: true });
    }, 320);
});

window.toggleSubmenu = () => document.getElementById('submenu-llave')?.classList.toggle('activo');
window.abrirModal = (id) => document.getElementById(id)?.classList.add('activo');
window.cerrarModalFuera = (e, id) => { if (e.target.id === id) document.getElementById(id)?.classList.remove('activo'); };

function aplicarSwipeAbajo(modalId, contentId) {
    const modal = document.getElementById(modalId);
    const content = document.getElementById(contentId);
    if (!modal || !content) return;
    let startY = 0, currentY = 0;
    content.addEventListener('touchstart', e => startY = e.touches[0].clientY, { passive: true });
    content.addEventListener('touchmove', e => { 
        currentY = e.touches[0].clientY; 
        if (currentY > startY && content.scrollTop === 0) content.style.transform = `translateY(${currentY - startY}px)`; 
    }, { passive: true });
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
    const panel = document.querySelector('.maplibregl-canvas');
    if (!panel) return;

    if (tipo === 'satelite') {
        // Fondo negro
        panel.style.filter = "invert(95%) hue-rotate(180deg) brightness(125%) contrast(80%)";
        document.body.classList.remove('ui-light');
    } else if (tipo === 'rayosx') {
        // Rojizo original
        panel.style.filter = "invert(100%) sepia(100%) hue-rotate(355deg) saturate(1500%) contrast(1.3) brightness(1.1)";
        document.body.classList.remove('ui-light');
    } else {
        // 'lite' (Bajo Gwai): claro original con el que arranca el mapa
        panel.style.filter = "none";
        document.body.classList.add('ui-light');
    }

    document.querySelectorAll('.map-tag:not(#btn-giro-toggle)').forEach(t => t.classList.remove('active'));
    if (el) el.classList.add('active');

    const btnGiro = document.getElementById('btn-giro-toggle');
    if (btnGiro) {
        if (tipo === 'rayosx') {
            btnGiro.style.display = 'block';
        } else {
            btnGiro.style.display = 'none';
            if (window.isRadar3DActivo) window.toggleRadarInmersivo(btnGiro);
        }
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
        minZoom: 11,
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
    const { barcode, idsComercios } = e.detail || {};
    if (!window.mapa) return;

    if (!idsComercios || idsComercios.length === 0) {
        window._filtroEanIdsActivo = null;
        const toast = document.getElementById('toast-fantasma');
        if (toast) {
            toast.innerText = "No hay comercios locales con stock activo de este artículo.";
            toast.style.opacity = '1';
            setTimeout(() => { toast.style.opacity = '0'; }, 3500);
        }
        return;
    }

    window._filtroEanIdsActivo = idsComercios.map(id => String(id));

    const inputBuscador = document.getElementById('input-buscador');
    if (inputBuscador) {
        inputBuscador.value = `Stock: ${barcode} (${idsComercios.length} tiendas)`;
    }

    if (typeof window.barridoRadar === 'function') {
        window.barridoRadar('', { conservarRotacion: true });
    }
    if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
});

       

