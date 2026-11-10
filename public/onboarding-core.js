/**
 * GEOKATU B2B - Núcleo de Auditoría, Catálogo y Onboarding OneShot
 * Archivo: onboarding-core.js
 * Dependencias: core-db.js, firebase-config.js, auth-mando.js
 * Cumplimiento: Cero dependencias externas pesadas, cero emojis, cero sintaxis Docs-incompatible (${})
 */

import GeokatuDB from './core-db.js';
import { db } from './firebase-config.js';
import { doc, collection, writeBatch, setDoc, getDocs } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';
import * as geofire from "https://cdn.jsdelivr.net/npm/geofire-common@5.2.0/+esm";
import './auth-mando.js';

// =========================================================================
// ESTADO GLOBAL COMPARTIDO
// =========================================================================
let listaComercios = JSON.parse(localStorage.getItem('geokatu_onboarding_cola')) || [];
let floresRecolectadas = parseInt(localStorage.getItem('geokatu_flores_contador') || '0', 10);
let abejasActivas = 0;
let comercioActivoParaCatalogo = null;
let vistaActualTablero = 'radar';
let superadminAutorizado = false;

export const AppState = {
    get comercioActivo() { return comercioActivoParaCatalogo; },
    set comercioActivo(val) { comercioActivoParaCatalogo = val; },
    get listaComercios() { return listaComercios; },
    guardarColaLocal: function() {
        localStorage.setItem('geokatu_onboarding_cola', JSON.stringify(listaComercios));
    }
};
window.AppState = AppState;

// =========================================================================
// SINTETIZADOR DE AUDIO (WEB AUDIO API NATIVO - CERO LATENCIA)
// =========================================================================
let audioCtx = null;
export function emitirTono(tipo) {
    const modo = tipo || 'EXITO';
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const t = audioCtx.currentTime;

        if (modo === 'EXITO') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1850, t);
            gain.gain.setValueAtTime(0.2, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
            osc.start(t);
            osc.stop(t + 0.08);
        } else {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(220, t);
            gain.gain.setValueAtTime(0.25, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.25);
            osc.start(t);
            osc.stop(t + 0.25);
        }
    } catch (e) {}
}
window.emitirTono = emitirTono;

// =========================================================================
// TOASTS Y MODALES GLASSMORPHIC (REGLA DE ORO 2: CERO ALERT/CONFIRM NATIVOS)
// =========================================================================
export function mostrarToast(mensaje, tipo, duracion) {
    const tModo = tipo || 'info';
    const dTiempo = duracion || 3200;
    const contenedor = document.getElementById('geokatu-toast-container');
    if (!contenedor) return;
    
    const toast = document.createElement('div');
    toast.className = 'geokatu-toast toast-' + tModo;
    
    const colorIco = (tModo === 'exito') ? 'var(--verde-hoja)' : ((tModo === 'error') ? 'var(--rojo-fuego)' : 'var(--azul-link)');
    const iconoPath = (tModo === 'exito') 
        ? '<polyline points="20 6 9 17 4 12"/>' 
        : ((tModo === 'error') 
            ? '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' 
            : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>');

    toast.innerHTML = 
        '<div style="display:flex; align-items:center; gap:8px;">' +
            '<svg class="svg-ico" viewBox="0 0 24 24" style="color:' + colorIco + ';">' + iconoPath + '</svg>' +
            '<span>' + mensaje + '</span>' +
        '</div>' +
        '<button type="button" style="background:none; border:none; color:#64748b; font-size:13px; cursor:pointer; padding:0 4px;" onclick="this.parentElement.remove()">✕</button>';
    
    contenedor.appendChild(toast);
    setTimeout(function() {
        toast.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(15px)';
        setTimeout(function() { toast.remove(); }, 250);
    }, dTiempo);
}
window.mostrarToast = mostrarToast;

export function solicitarConfirmacion(titulo, mensaje) {
    return new Promise(function(resolve) {
        const modal = document.getElementById('geokatu-modal-confirm');
        const tit = document.getElementById('geokatu-confirm-titulo');
        const msg = document.getElementById('geokatu-confirm-mensaje');
        const btnCancel = document.getElementById('geokatu-confirm-btn-cancelar');
        const btnOk = document.getElementById('geokatu-confirm-btn-aceptar');

        if (!modal || !tit || !msg || !btnCancel || !btnOk) {
            resolve(false);
            return;
        }

        tit.innerText = titulo;
        msg.innerText = mensaje;
        modal.style.display = 'flex';

        const finalizar = function(resultado) {
            modal.style.display = 'none';
            btnCancel.onclick = null;
            btnOk.onclick = null;
            resolve(resultado);
        };

        btnCancel.onclick = function() { finalizar(false); };
        btnOk.onclick = function() { finalizar(true); };
    });
}
window.solicitarConfirmacion = solicitarConfirmacion;
// =========================================================================
// HUD, CONTADORES Y ENJAMBRE (SATISFACEN LOS IMPORTS DEL HTML)
// =========================================================================
export function actualizarHUD() {
    const kpiFlores = document.getElementById('kpi-flores');
    if (kpiFlores) kpiFlores.innerText = floresRecolectadas;

    const elTotal = document.getElementById('kpi-total');
    if (elTotal) elTotal.innerText = listaComercios.length;

    const validados = listaComercios.filter(function(c) { return Boolean(c.validado); }).length;
    const subidos = listaComercios.filter(function(c) { return Boolean(c.subido); }).length;
    const enVuelo = listaComercios.filter(function(c) { return !c.capturado && !c.archivado; }).length;

    const elValidados = document.getElementById('kpi-validados');
    if (elValidados) elValidados.innerText = validados;

    const elListos = document.getElementById('conteo-listos');
    if (elListos) elListos.innerText = validados;

    const elSubidos = document.getElementById('conteo-subidos');
    if (elSubidos) elSubidos.innerText = subidos;

    const elEnVuelo = document.getElementById('conteo-en-vuelo');
    if (elEnVuelo) elEnVuelo.innerText = enVuelo;

    const elVisibles = document.getElementById('badge-total-visibles');
    if (elVisibles) {
        const visibles = listaComercios.filter(function(c) { return Boolean(c.capturado); }).length;
        elVisibles.innerText = visibles;
    }
}
window.actualizarHUD = actualizarHUD;

export function iniciarEnjambreSiAutorizado() {
    const cielo = document.getElementById('cielo');
    if (!cielo) return;

    cielo.innerHTML = '';
    let contadorVoladores = 0;

    listaComercios.forEach(function(comercio) {
        if (!comercio.capturado && !comercio.archivado) {
            lanzarEntidadVoladora(comercio, contadorVoladores);
            contadorVoladores++;
        }
    });

    abejasActivas = contadorVoladores;
}
window.iniciarEnjambreSiAutorizado = iniciarEnjambreSiAutorizado;

// =========================================================================
// MATRIZ GLOBAL INDEXEDDB (KPI BARCODE DEL HUD)
// =========================================================================
export async function inicializarMatrizGlobalUI() {
    const badge = document.getElementById('kpi-skus-matriz');
    try {
        if (GeokatuDB && GeokatuDB.CatalogoMatrizService) {
            const res = await GeokatuDB.CatalogoMatrizService.inicializarMatriz();
            if (res && res.success) {
                if (badge) badge.innerText = (res.count || 0).toLocaleString('es-CO') + ' SKUs (0 ms)';
                return;
            }
        }
        if (badge) badge.innerText = 'Matriz Lista';
    } catch (e) {
        if (badge) badge.innerText = 'Modo Local';
    }
}
window.inicializarMatrizGlobalUI = inicializarMatrizGlobalUI;

// =========================================================================
// SUBIDA MASIVA ONESHOT (BOTÓN DEL HEADER DEL HTML)
// =========================================================================
window.subirOneShotAFirebase = async function() {
    const listosParaSubir = listaComercios.filter(function(c) {
        return c.validado === true && c.subido !== true;
    });

    if (listosParaSubir.length === 0) {
        mostrarToast("No hay comercios clasificados como 'Listos OneShot'.", "info");
        return;
    }

    const conf = await solicitarConfirmacion(
        "Subida OneShot a Firestore",
        "¿Deseas asentar masivamente " + listosParaSubir.length + " comercios en la coleccion Directorio?"
    );
    if (!conf) return;

    try {
        mostrarToast("Inyectando tanda en Firestore...", "info");
        const res = await GeokatuDB.AdminService.subirLoteComerciosDirectorio(listosParaSubir);
        if (res.success) {
            listosParaSubir.forEach(function(c) {
                c.subido = true;
            });
            AppState.guardarColaLocal();
            renderizarTablero();
            actualizarHUD();
            emitirTono('EXITO');
            mostrarToast("OneShot completado: " + res.totalSubidos + " comercios sincronizados.", "exito", 4000);
        } else {
            throw new Error(res.error || "Fallo en la transacción");
        }
    } catch (err) {
        mostrarToast("Error en subida masiva: " + err.message, "error", 5000);
    }
};

// =========================================================================
// BÚNKER DE AUTENTICACIÓN ZERO-TRUST (SUPERADMIN)
// =========================================================================
GeokatuDB.SecurityService.observarEstadoSesion(async function(user) {
    const gate = document.getElementById('bunker-auth-gate');
    const panelLogin = document.getElementById('panel-login-bunker');
    const panelVerificando = document.getElementById('panel-verificando-bunker');
    const cajaDenegado = document.getElementById('caja-acceso-denegado');
    const badgeSuper = document.getElementById('badge-superadmin');
    const btnLogout = document.getElementById('btn-logout-header');

    if (user) {
        if (panelLogin) panelLogin.style.display = 'none';
        if (cajaDenegado) cajaDenegado.style.display = 'none';
        if (panelVerificando) panelVerificando.style.display = 'block';

        try {
            const res = await GeokatuDB.SecurityService.obtenerRolAdmin(user.uid);
            if (res.success && res.data && res.data.rol === 'superadmin') {
                superadminAutorizado = true;
                if (panelVerificando) panelVerificando.style.display = 'none';
                if (gate) gate.style.display = 'none';

                if (badgeSuper) {
                    badgeSuper.style.display = 'inline-flex';
                    badgeSuper.title = 'Operando como: ' + user.email;
                }
                if (btnLogout) btnLogout.style.display = 'inline-flex';

                actualizarDatalistNichos();
                renderizarTablero();
                actualizarHUD();
                iniciarEnjambreSiAutorizado();
            } else {
                superadminAutorizado = false;
                if (panelVerificando) panelVerificando.style.display = 'none';
                if (gate) gate.style.display = 'flex';
                
                const rolDetectado = (res.data && res.data.rol) ? res.data.rol : 'Usuario Estandar';
                const txtMotivo = document.getElementById('txt-motivo-denegado');
                if (txtMotivo) {
                    txtMotivo.innerHTML = 'Sesion iniciada como <b>' + user.email + '</b>.<br>Tu rol actual es: <code style="color:var(--naranja);">' + rolDetectado + '</code>.<br>Se requiere rol: <code style="color:var(--verde-hoja);">superadmin</code>.';
                }
                if (cajaDenegado) cajaDenegado.style.display = 'block';
            }
        } catch (err) {
            if (panelVerificando) panelVerificando.style.display = 'none';
            if (cajaDenegado) cajaDenegado.style.display = 'block';
            const txtMotivo = document.getElementById('txt-motivo-denegado');
            if (txtMotivo) txtMotivo.innerText = "Fallo de conexion validando privilegios en Firestore.";
        }
    } else {
        superadminAutorizado = false;
        if (gate) gate.style.display = 'flex';
        if (panelLogin) panelLogin.style.display = 'block';
        if (panelVerificando) panelVerificando.style.display = 'none';
        if (cajaDenegado) cajaDenegado.style.display = 'none';
        if (badgeSuper) badgeSuper.style.display = 'none';
        if (btnLogout) btnLogout.style.display = 'none';
    }
});

// =========================================================================
// ENJAMBRE ORGÁNICO Y SISTEMA DE POLINIZACIÓN FLORAL ORIGINAL (🐝 🦋 🌸)
// =========================================================================
export function dispararFlores(clienteX, clienteY) {
    const escenario = document.getElementById('escenario');
    if (!escenario) return;
    const rect = escenario.getBoundingClientRect();
    const relX = clienteX - rect.left;
    const relY = clienteY - rect.top;
    const flores = ['🌸', '🌺', '🌼', '🌻', '🌷', '✨'];

    for (let i = 0; i < 10; i++) {
        const flor = document.createElement('div');
        flor.className = 'flor-particula';
        flor.innerText = flores[Math.floor(Math.random() * flores.length)];
        flor.style.left = relX + 'px';
        flor.style.top = relY + 'px';

        const angulo = Math.random() * Math.PI * 2;
        const dist = 35 + Math.random() * 75;
        flor.style.setProperty('--tx', 'calc(-50% + ' + (Math.cos(angulo) * dist) + 'px)');
        flor.style.setProperty('--ty', 'calc(-50% + ' + (Math.sin(angulo) * dist) + 'px)');
        flor.style.setProperty('--rot', (Math.random() * 360) + 'deg');

        escenario.appendChild(flor);
        setTimeout(function() { flor.remove(); }, 850);
    }

       floresRecolectadas++;
    localStorage.setItem('geokatu_flores_contador', floresRecolectadas.toString());
    const kpiFlores = document.getElementById('kpi-flores');
    if (kpiFlores) kpiFlores.innerText = floresRecolectadas;
}
window.dispararFlores = dispararFlores;


function ejecutarCapturaComercio(wrapper, idComercio, clienteX, clienteY) {

    if (!wrapper || wrapper.classList.contains('salvada')) return;

    wrapper.classList.add('salvada');
    wrapper.style.pointerEvents = 'none';
    wrapper.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
    wrapper.style.opacity = '0';
    wrapper.style.transform = wrapper.style.transform + ' scale(1.6)';

    dispararFlores(clienteX, clienteY);
    emitirTono('EXITO');
    if (navigator.vibrate) navigator.vibrate([40, 30, 40]);

    setTimeout(function() {
        wrapper.remove();
        actualizarHUD();
    }, 280);

    const comercio = listaComercios.find(function(c) {
        return String(c.id) === String(idComercio);
    });

    if (comercio) {
        comercio.capturado = true;
        comercio.archivado = false;
        comercio.subido = false;
        if (comercio.estado_flujo === 'Cerrado' || comercio.estado_flujo === 'Seguimiento') {
            comercio.estado_flujo = 'Auditado';
        }

        AppState.guardarColaLocal();
        renderizarTablero();
        actualizarHUD();

        setTimeout(function() {
            const tarjeta = document.querySelector('.cuadrito-actividad[data-id="' + idComercio + '"]');
            if (tarjeta) {
                tarjeta.classList.add('recien-aterrizado');
                tarjeta.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }
}

function lanzarEntidadVoladora(comercio, index) {
    const cielo = document.getElementById('cielo');
    if (!cielo || cielo.querySelector('.abeja-wrapper[data-id-comercio="' + comercio.id + '"]')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'abeja-wrapper';
    wrapper.setAttribute('data-id-comercio', comercio.id);

    const esMariposa = (index % 2 === 1);
    const emoji = esMariposa ? '🦋' : '🐝';

    const anchoMax = Math.max(100, (cielo.clientWidth || 320) - 50);
    const altoMax = Math.max(80, (cielo.clientHeight || 160) - 50);

    let posX = Math.random() * anchoMax;
    let posY = Math.random() * altoMax;

    wrapper.style.transform = 'translate(' + posX + 'px, ' + posY + 'px)';
    wrapper.innerHTML = '<div class="abeja-sprite" style="font-size:26px;">' + emoji + '</div>';

    // Disparador directo táctil con máxima prioridad de intercepción
    wrapper.addEventListener('pointerdown', function(e) {
        e.stopPropagation();
        ejecutarCapturaComercio(wrapper, comercio.id, e.clientX, e.clientY);
    });

    cielo.appendChild(wrapper);

    function volarHaciaNuevoPunto() {
        if (wrapper.classList.contains('salvada')) return;
        const nuevoX = 15 + Math.random() * (Math.max(100, cielo.clientWidth) - 65);
        const nuevoY = 15 + Math.random() * (Math.max(80, cielo.clientHeight) - 60);
        const dx = nuevoX - posX;
        const dy = nuevoY - posY;
        const distancia = Math.hypot(dx, dy);

        const duracion = Math.max(2.5, distancia / (45 + Math.random() * 30));
        wrapper.style.transition = 'transform ' + duracion + 's ease-in-out';
        wrapper.style.transform = 'translate(' + nuevoX + 'px, ' + nuevoY + 'px)';

        posX = nuevoX;
        posY = nuevoY;

        setTimeout(volarHaciaNuevoPunto, duracion * 1000);
    }

    setTimeout(volarHaciaNuevoPunto, 100 + Math.random() * 500);
}

const escenarioEl = document.getElementById('escenario');
if (escenarioEl) {
    escenarioEl.addEventListener('pointerdown', function(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        // 1. Intento por elemento directo
        let objetivo = e.target.closest('.abeja-wrapper');

        // 2. Búsqueda de proximidad con lectura de matriz en vuelo (GPU)
        if (!objetivo) {
            const cielo = document.getElementById('cielo');
            const abejas = cielo ? cielo.querySelectorAll('.abeja-wrapper:not(.salvada)') : [];
            let mejorDistancia = 60; // Radio perimetral de captura táctil (60px)
            let mejorAbeja = null;

            for (let i = 0; i < abejas.length; i++) {
                const ab = abejas[i];
                let centroX = 0;
                let centroY = 0;

                try {
                    const matrix = new DOMMatrix(window.getComputedStyle(ab).transform);
                    const cieloRect = cielo.getBoundingClientRect();
                    centroX = cieloRect.left + matrix.m41 + 24;
                    centroY = cieloRect.top + matrix.m42 + 24;
                } catch (err) {
                    const r = ab.getBoundingClientRect();
                    centroX = r.left + r.width / 2;
                    centroY = r.top + r.height / 2;
                }

                const dist = Math.hypot(e.clientX - centroX, e.clientY - centroY);
                if (dist < mejorDistancia) {
                    mejorDistancia = dist;
                    mejorAbeja = ab;
                }
            }

            if (mejorAbeja) {
                objetivo = mejorAbeja;
            }
        }

        if (objetivo && !objetivo.classList.contains('salvada')) {
            const idComercio = objetivo.getAttribute('data-id-comercio');
            ejecutarCapturaComercio(objetivo, idComercio, e.clientX, e.clientY);
        } else {
            dispararFlores(e.clientX, e.clientY);
        }
    });
}



// =========================================================================
// TRADUCTOR ESPACIAL UNIVERSAL (MAPS, PLUS CODES, DMS, DECIMAL)
// =========================================================================
function parsearCoordenadasUniversales(input) {
    if (!input || typeof input !== 'string') return null;
    const str = input.trim();

    const matchPlusCode = str.match(/([23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3})/i);
    if (matchPlusCode && typeof OpenLocationCode !== 'undefined') {
        try {
            const code = matchPlusCode[1].toUpperCase();
            let fullCode = code;
            if (OpenLocationCode.isShort(code)) {
                fullCode = OpenLocationCode.recoverNearest(code, 4.81333, -75.69611);
            }
            if (OpenLocationCode.isFull(fullCode)) {
                const area = OpenLocationCode.decode(fullCode);
                return normalizarLatLng(area.latitudeCenter, area.longitudeCenter);
            }
        } catch (e) {}
    }

    const matchUrl = str.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || str.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (matchUrl) return normalizarLatLng(parseFloat(matchUrl[1]), parseFloat(matchUrl[2]));

    const dmsRegex = /(\d+)[°º\s]+(\d+)['′\s]+([\d.]+)?["″\s]*([NSEWnsew])?/g;
    const dmsMatches = [...str.matchAll(dmsRegex)];
    if (dmsMatches.length >= 2) {
        const convertirDMS = function(m) {
            let dec = parseFloat(m[1]) + (parseFloat(m[2] || 0) / 60) + (parseFloat(m[3] || 0) / 3600);
            const dir = (m[4] || '').toUpperCase();
            if (dir === 'S' || dir === 'W') dec = -dec;
            return dec;
        };
        return normalizarLatLng(convertirDMS(dmsMatches[0]), convertirDMS(dmsMatches[1]));
    }

    const matchWkt = str.match(/POINT\s*\(\s*(-?\d+\.\d+)\s+(-?\d+\.\d+)\s*\)/i);
    if (matchWkt) return normalizarLatLng(parseFloat(matchWkt[2]), parseFloat(matchWkt[1]));

    const nums = str.match(/[-+]?\d{1,3}\.\d+/g);
    if (nums && nums.length >= 2) return normalizarLatLng(parseFloat(nums[0]), parseFloat(nums[1]));

    return null;
}

function normalizarLatLng(lat, lng) {
    let latF = lat;
    let lngF = lng;
    if (latF < -50 && lngF > -10 && lngF < 20) {
        const temp = latF; latF = lngF; lngF = temp;
    }
    return { lat: Number(latF.toFixed(6)), lng: Number(lngF.toFixed(6)) };
}

window.probarTraductor = function(val) {
    const res = parsearCoordenadasUniversales(val);
    const badge = document.getElementById('coord-resultado');
    if (!badge) return;
    if (res) {
        badge.innerText = 'Lat: ' + res.lat + ' | Lng: ' + res.lng;
        badge.style.borderColor = 'var(--verde-hoja)';
        badge.style.color = 'var(--verde-hoja)';
    } else {
        badge.innerText = 'Formato no reconocido';
        badge.style.borderColor = 'var(--rojo-fuego)';
        badge.style.color = 'var(--rojo-fuego)';
    }
};

// =========================================================================
// MINIMAPA GEOESPACIAL MAPLIBRE GL
// =========================================================================
let miniMapaNuevo = null;
let markerNuevo = null;
let ticketEditandoIndex = null;
let marcadoresMultiSedes = [];
const COORDS_PEREIRA_DEFAULT = [-75.69611, 4.81333];

if (typeof pmtiles !== 'undefined' && typeof maplibregl !== 'undefined') {
    try {
        const protocol = new pmtiles.Protocol();
        maplibregl.addProtocol("pmtiles", protocol.tile);
    } catch (e) {}
}

export function inicializarMapaNuevoComercio() {
    if (typeof maplibregl === 'undefined') return;

    miniMapaNuevo = new maplibregl.Map({
        container: 'mapa-nuevo-comercio',
        style: './estilo-fresco.json',
        center: COORDS_PEREIRA_DEFAULT,
        zoom: 15,
        attributionControl: false
    });

    markerNuevo = new maplibregl.Marker({ color: "#ff6b00", draggable: true })
        .setLngLat(COORDS_PEREIRA_DEFAULT)
        .addTo(miniMapaNuevo);

    markerNuevo.on('dragend', function() {
        const lngLat = markerNuevo.getLngLat();
        actualizarInputsCoordenadas(lngLat.lat, lngLat.lng);
        geocodificarInversa(lngLat.lat, lngLat.lng);
    });

    miniMapaNuevo.on('click', function(e) {
        markerNuevo.setLngLat(e.lngLat);
        actualizarInputsCoordenadas(e.lngLat.lat, e.lngLat.lng);
        geocodificarInversa(e.lngLat.lat, e.lngLat.lng);
    });

    actualizarInputsCoordenadas(COORDS_PEREIRA_DEFAULT[1], COORDS_PEREIRA_DEFAULT[0]);
}
window.inicializarMapaNuevoComercio = inicializarMapaNuevoComercio;

function actualizarInputsCoordenadas(lat, lng) {
    const latFix = Number(lat).toFixed(6);
    const lngFix = Number(lng).toFixed(6);
    const inputLat = document.getElementById('nuevo-lat');
    const inputLng = document.getElementById('nuevo-lng');
    const display = document.getElementById('nuevo-coords-display');
    if (inputLat) inputLat.value = latFix;
    if (inputLng) inputLng.value = lngFix;
    if (display) display.innerText = 'Coords: ' + latFix + ', ' + lngFix;
}

async function geocodificarInversa(lat, lng) {
    const inputDir = document.getElementById('nuevo-direccion');
    try {
        const urlGeo = 'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lng);
        const res = await fetch(urlGeo);
        if (res.ok) {
            const data = await res.json();
            if (data && data.display_name) {
                const resumida = data.display_name.split(',').slice(0, 3).join(',').trim();
                if (inputDir) inputDir.value = resumida;
                return;
            }
        }
    } catch (e) {}

    if (inputDir && (!inputDir.value || inputDir.value.indexOf('GPS:') === 0)) {
        inputDir.value = 'GPS: ' + Number(lat).toFixed(6) + ', ' + Number(lng).toFixed(6);
    }
}

window.geolocalizarNuevoComercio = function() {
    if (!navigator.geolocation) {
        mostrarToast("Geolocalizacion no soportada en el dispositivo.", "error");
        return;
    }
    navigator.geolocation.getCurrentPosition(
        function(pos) {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            if (miniMapaNuevo && markerNuevo) {
                miniMapaNuevo.flyTo({ center: [lng, lat], zoom: 17 });
                markerNuevo.setLngLat([lng, lat]);
                actualizarInputsCoordenadas(lat, lng);
                geocodificarInversa(lat, lng);
            }
            emitirTono('EXITO');
        },
        function() {
            mostrarToast("No fue posible capturar coordenadas GPS.", "error");
        },
        { enableHighAccuracy: true, timeout: 8000 }
    );
};

window.buscarDireccionModal = async function() {
    const inputEl = document.getElementById('nuevo-busqueda-dir');
    const rawInput = inputEl ? inputEl.value.trim() : '';
    if (!rawInput) return;

    const fijarPuntoEnMapa = function(lat, lng, direccionTexto) {
        if (miniMapaNuevo && markerNuevo) {
            miniMapaNuevo.flyTo({ center: [lng, lat], zoom: 17 });
            markerNuevo.setLngLat([lng, lat]);
            actualizarInputsCoordenadas(lat, lng);
            const inputDir = document.getElementById('nuevo-direccion');
            if (direccionTexto && inputDir) {
                inputDir.value = direccionTexto;
            } else if (inputDir) {
                geocodificarInversa(lat, lng);
            }
            emitirTono('EXITO');
        }
    };

    const matchCoord = rawInput.match(/^\s*([-+]?\d{1,3}(?:\.\d+)?)\s*[,|\s]\s*([-+]?\d{1,3}(?:\.\d+)?)\s*$/);
    if (matchCoord) {
        let lat = parseFloat(matchCoord[1]);
        let lng = parseFloat(matchCoord[2]);
        if (lat < -50 && lng > -10 && lng < 20) { const temp = lat; lat = lng; lng = temp; }
        fijarPuntoEnMapa(lat, lng, null);
        return;
    }

    let limpia = rawInput
        .replace(/\b(loc|local|apto|of|oficina|piso|bloque|int)\s*[\w\d-]+/gi, '')
        .replace(/[#–-]/g, ' ')
        .replace(/\b(carrera|cra|cr|k)\b\.?/gi, 'Carrera')
        .replace(/\b(calle|cll|cl)\b\.?/gi, 'Calle')
        .replace(/\b(avenida|avda|av)\b\.?/gi, 'Avenida')
        .replace(/\s+/g, ' ')
        .trim();

    if (!/\bpereira\b/i.test(limpia)) limpia += ', Pereira';
    if (!/\bcolombia\b/i.test(limpia)) limpia += ', Colombia';

    try {
        const urlBusqueda = 'https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(limpia) + '&viewbox=-75.76,4.86,-75.64,4.76&bounded=0&limit=1';
        const res = await fetch(urlBusqueda, { headers: { 'Accept-Language': 'es' } });
        if (res.ok) {
            const data = await res.json();
            if (data && data.length > 0) {
                fijarPuntoEnMapa(parseFloat(data[0].lat), parseFloat(data[0].lon), data[0].display_name.split(',').slice(0, 3).join(',').trim());
                return;
            }
        }
        mostrarToast("Punto no localizado. Arrastra el marcador en el mapa.", "info");
    } catch (e) {
        mostrarToast("Sin conexion para geocodificar direccion.", "error");
    }
};

export function obtenerSedesVinculadas(comercioActual) {
    if (!comercioActual || !comercioActual.nombre) return [];
    const normalizarMarca = function(n) {
        return String(n || '')
            .toLowerCase()
            .replace(/\b(s\.?a\.?s\.?|s\.?a\.?|ltda\.?|sucursal|sede|punto|local)\b/gi, '')
            .replace(/[-–#0-9]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    };

    const marcaRaiz = normalizarMarca(comercioActual.nombre);
    if (marcaRaiz.length < 3) return [comercioActual];

    return listaComercios.filter(function(item) {
        const otra = normalizarMarca(item.nombre);
        return otra.indexOf(marcaRaiz) !== -1 || marcaRaiz.indexOf(otra) !== -1;
    });
}

function limpiarMarcadoresMultiSedes() {
    marcadoresMultiSedes.forEach(function(m) { m.remove(); });
    marcadoresMultiSedes = [];
}

window.abrirMapaMultiSede = function(nombreComercio) {
    const comercio = listaComercios.find(function(c) { return c.nombre === nombreComercio; });
    if (!comercio) return;
    const idx = listaComercios.findIndex(function(c) { return c.id === comercio.id; });
    abrirMapaParaEditarTicket(idx);
    setTimeout(function() { dibujarTodasLasSedesEnMapa(comercio); }, 250);
};

function dibujarTodasLasSedesEnMapa(comercioBase) {
    if (!miniMapaNuevo) return;
    limpiarMarcadoresMultiSedes();
    const sedes = obtenerSedesVinculadas(comercioBase);
    if (sedes.length <= 1) return;

    const bounds = new maplibregl.LngLatBounds();
    let validas = 0;

    sedes.forEach(function(sede, i) {
        const raw = sede.coordenada_validada || sede.coordenadas_crudo || (String(sede.lat || '') + ', ' + String(sede.lng || ''));
        const coords = parsearCoordenadasUniversales(raw);
        if (!coords) return;
        validas++;
        bounds.extend([coords.lng, coords.lat]);

        if (sede.id !== comercioBase.id) {
            const el = document.createElement('div');
            el.style.cssText = "width:22px; height:22px; border-radius:50%; background:#29b6f6; border:2px solid white; display:flex; align-items:center; justify-content:center; color:#000; font-size:9.5px; font-weight:900; cursor:pointer;";
            el.innerText = (i + 1);

            const m = new maplibregl.Marker({ element: el })
                .setLngLat([coords.lng, coords.lat])
                .addTo(miniMapaNuevo);
            marcadoresMultiSedes.push(m);
        }
    });
    if (validas > 1) miniMapaNuevo.fitBounds(bounds, { padding: 40, maxZoom: 16 });
}

window.abrirMapaParaEditarTicket = function(index) {
    ticketEditandoIndex = index;
    const c = listaComercios[index];
    const modal = document.getElementById('modal-nuevo-comercio');
    if (modal) modal.style.display = 'flex';

    document.getElementById('nuevo-id').value = c.id;
    document.getElementById('nuevo-nombre').value = c.nombre || '';
    document.getElementById('nuevo-whatsapp').value = c.whatsapp || '';
    document.getElementById('nuevo-direccion').value = c.direccion || '';

    const coords = parsearCoordenadasUniversales(c.coordenada_validada || c.coordenadas_crudo || '') || { lat: 4.81333, lng: -75.69611 };
    setTimeout(function() {
        if (!miniMapaNuevo) inicializarMapaNuevoComercio();
        miniMapaNuevo.resize();
        miniMapaNuevo.flyTo({ center: [coords.lng, coords.lat], zoom: 17 });
        markerNuevo.setLngLat([coords.lng, coords.lat]);
        actualizarInputsCoordenadas(coords.lat, coords.lng);
    }, 150);
};

window.abrirModalNuevoComercio = function() {
    ticketEditandoIndex = null;
    const modal = document.getElementById('modal-nuevo-comercio');
    if (modal) modal.style.display = 'flex';
    const autoId = 'GEO-' + Date.now().toString().slice(-4);
    document.getElementById('nuevo-id').value = autoId;
    document.getElementById('nuevo-nombre').value = '';
    document.getElementById('nuevo-whatsapp').value = '';
    document.getElementById('nuevo-direccion').value = '';

    setTimeout(function() {
        if (!miniMapaNuevo) inicializarMapaNuevoComercio();
        miniMapaNuevo.resize();
        miniMapaNuevo.flyTo({ center: COORDS_PEREIRA_DEFAULT, zoom: 15 });
        markerNuevo.setLngLat(COORDS_PEREIRA_DEFAULT);
        actualizarInputsCoordenadas(COORDS_PEREIRA_DEFAULT[1], COORDS_PEREIRA_DEFAULT[0]);
    }, 150);
};

window.cerrarModalNuevoComercio = function() {
    ticketEditandoIndex = null;
    limpiarMarcadoresMultiSedes();
    const modal = document.getElementById('modal-nuevo-comercio');
    if (modal) modal.style.display = 'none';
};

window.guardarNuevoComercio = function() {
    const nombre = document.getElementById('nuevo-nombre')?.value?.trim() || '';
    const lat = parseFloat(document.getElementById('nuevo-lat')?.value);
    const lng = parseFloat(document.getElementById('nuevo-lng')?.value);
    const direccion = document.getElementById('nuevo-direccion')?.value?.trim() || '';


    if (!nombre) { mostrarToast("Nombre de comercio obligatorio.", "error"); return; }
    if (isNaN(lat) || isNaN(lng)) { mostrarToast("Fija el punto en el mapa.", "error"); return; }

    if (ticketEditandoIndex !== null) {
        const item = listaComercios[ticketEditandoIndex];
        item.nombre = nombre;
        item.direccion = direccion;
        item.whatsapp = document.getElementById('nuevo-whatsapp')?.value.trim() || '';
        item.lat = lat; item.lng = lng;
        item.coordenada_validada = lat + ', ' + lng;
        item.ubicacion = { lat: lat, lng: lng };
        AppState.guardarColaLocal();
        renderizarTablero();
        cerrarModalNuevoComercio();
        mostrarToast('Ubicacion actualizada para "' + nombre + '".', "exito");
        return;
    }

    const nuevo = {
        id: document.getElementById('nuevo-id')?.value.trim() || ('GEO-' + Date.now().toString().slice(-4)),
        nombre: nombre,
        nicho: "General",
        categoria: "General",
        direccion: direccion,
        whatsapp: document.getElementById('nuevo-whatsapp')?.value.trim() || "",
        coordenada_validada: lat + ', ' + lng,
        lat: lat, lng: lng, ubicacion: { lat: lat, lng: lng },
        estado: "Auditado", capturado: true, validado: false, subido: false,
        catalogo: [], fecha_ingreso: new Date().toISOString()
    };
    listaComercios.unshift(nuevo);
    AppState.guardarColaLocal();
    actualizarDatalistNichos();
    renderizarTablero();
    cerrarModalNuevoComercio();
    emitirTono('EXITO');
    mostrarToast('Comercio "' + nombre + '" registrado.', "exito");
};

// =========================================================================
// GESTOR DE IDENTIDAD DE MARCA, PINES Y RUEDA CROMÁTICA ÁUREA
// =========================================================================
const GRIS_METALLIC_GEOKATU = "#8a909d";
const BLANCO_GEOKATU = "#ffffff";

window.slotColorActual = 1;
window.estadoColorCustom = { h: 0, s: 100, l: 50, l_base: 50 };

export function hslToHex(h, s, l) {
    const lNorm = l / 100;
    const a = (s * Math.min(lNorm, 1 - lNorm)) / 100;
    const f = function(n) {
        const k = (n + h / 30) % 12;
        return Math.round(255 * (lNorm - a * Math.max(Math.min(k - 3, 9 - k, 1), -1))).toString(16).padStart(2, '0');
    };
    return ('#' + f(0) + f(8) + f(4)).toUpperCase();
}

export function hexToHSL(hex) {
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
        h = s = 0;
    } else {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function obtenerContenidoSVGPin(forma, fotoSrc) {
    let shapeTag = '';
    if (forma === 'forma-esfera') shapeTag = '<circle cx="30" cy="30" r="26" />';
    else if (forma === 'forma-triangulo') shapeTag = '<polygon points="6,8 54,8 30,54" stroke-linejoin="round" />';
    else if (forma === 'forma-hexagono') shapeTag = '<polygon points="30,4 53,17 53,43 30,56 7,43 7,17" stroke-linejoin="round" />';
    else shapeTag = '<path d="M 30,57 C 30,57 10,38 10,20 C 10,9 19,3 30,3 C 41,3 50,9 50,20 C 50,38 30,57 30,57 Z" />';

    const clipId = 'clip-pin-' + Math.random().toString(36).substr(2, 6);
    const tieneFoto = Boolean(fotoSrc && fotoSrc.length > 5);

    return '<svg class="svg-pin-fondo" viewBox="0 0 60 60">' +
        '<defs>' +
            '<clipPath id="' + clipId + '">' + shapeTag + '</clipPath>' +
        '</defs>' +
        '<g class="svg-pin-forma-base">' + shapeTag + '</g>' +
        (tieneFoto ? ('<image href="' + fotoSrc + '" x="0" y="0" width="60" height="60" preserveAspectRatio="xMidYMid slice" clip-path="url(#' + clipId + ')" opacity="0.95" />') : '') +
        '<g fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="2" stroke-linejoin="round">' + shapeTag + '</g>' +
    '</svg>' +
    (!tieneFoto ? '<span class="texto-centro-masa">PIN</span>' : '');
}
window.obtenerContenidoSVGPin = obtenerContenidoSVGPin;

export function actualizarPinDrawerLive() {
    if (!comercioActivoParaCatalogo) return;
    const forma = document.getElementById('drawer-select-forma')?.value || 'forma-gota';
    const anim = document.getElementById('drawer-select-animacion')?.value || 'anim-salto';
    const efectoRaw = document.getElementById('drawer-select-efecto')?.value || '|';
    const partesEfecto = efectoRaw.split('|');
    const anclaje = partesEfecto[0] || '';
    const emoji = partesEfecto[1] || '';
    const colorMain = document.getElementById('hex-slot-1')?.value || '#ff6b00';

    const wrap = document.getElementById('drawer-pin-live');
    if (!wrap) return;

    wrap.className = 'pin-wrapper ' + anim;
    wrap.setAttribute('data-forma', forma);
    wrap.style.setProperty('--color-main', colorMain);

    if (emoji && emoji !== '') {
        wrap.setAttribute('data-emoji', emoji);
        wrap.setAttribute('data-anclaje', anclaje);
    } else {
        wrap.removeAttribute('data-emoji');
        wrap.removeAttribute('data-anclaje');
    }

    const fotoSrc = comercioActivoParaCatalogo.link_pin || comercioActivoParaCatalogo.logo || '';
    wrap.innerHTML = obtenerContenidoSVGPin(forma, fotoSrc);

    comercioActivoParaCatalogo.pin_pack = forma + '|' + anim + '|' + efectoRaw;
    comercioActivoParaCatalogo.color_principal = colorMain;
    recalcularDistribucionAureaSilenciosa();
}
window.actualizarPinDrawerLive = actualizarPinDrawerLive;
export function recalcularDistribucionAureaSilenciosa() {
    if (!comercioActivoParaCatalogo) return;
    const c1 = document.getElementById('hex-slot-1')?.value || '#ff6b00';
    const c2 = document.getElementById('hex-slot-2')?.value || '';
    const c3 = document.getElementById('hex-slot-3')?.value || '';
    const c4 = document.getElementById('hex-slot-4')?.value || '';

    const coloresUsuario = [c1, c2, c3, c4].filter(Boolean);
    const cant = coloresUsuario.length;
    let distribucionFinal = [];

    if (cant === 1) {
        distribucionFinal = [
            { color: coloresUsuario[0], porcentaje: 50 },
            { color: GRIS_METALLIC_GEOKATU, porcentaje: 25 },
            { color: BLANCO_GEOKATU, porcentaje: 12.5 }
        ];
        comercioActivoParaCatalogo.color_acento = GRIS_METALLIC_GEOKATU;
        comercioActivoParaCatalogo.color_terciario = BLANCO_GEOKATU;
    } else if (cant === 2) {
        distribucionFinal = [
            { color: coloresUsuario[0], porcentaje: 50 },
            { color: coloresUsuario[1], porcentaje: 25 },
            { color: GRIS_METALLIC_GEOKATU, porcentaje: 12.5 },
            { color: BLANCO_GEOKATU, porcentaje: 7.5 }
        ];
        comercioActivoParaCatalogo.color_acento = coloresUsuario[1];
        comercioActivoParaCatalogo.color_terciario = GRIS_METALLIC_GEOKATU;
    } else {
        distribucionFinal = [
            { color: coloresUsuario[0], porcentaje: 50 },
            { color: coloresUsuario[1], porcentaje: 25 },
            { color: coloresUsuario[2] || GRIS_METALLIC_GEOKATU, porcentaje: 12.5 },
            { color: coloresUsuario[3] || BLANCO_GEOKATU, porcentaje: 7.5 }
        ];
        comercioActivoParaCatalogo.color_acento = coloresUsuario[1];
        comercioActivoParaCatalogo.color_terciario = coloresUsuario[2] || GRIS_METALLIC_GEOKATU;
    }

    comercioActivoParaCatalogo.color_principal = coloresUsuario[0];
    comercioActivoParaCatalogo.paleta_distribucion = distribucionFinal;
    AppState.guardarColaLocal();
}

export function aplicarColorASlot(slot, hex) {
    const inputHex = document.getElementById('hex-slot-' + slot);
    const swatch = document.getElementById('swatch-color-' + slot);
    if (inputHex) inputHex.value = hex;
    if (swatch) swatch.style.background = hex;

    if (slot === 1 && comercioActivoParaCatalogo) {
        comercioActivoParaCatalogo.color_principal = hex;
        actualizarPinDrawerLive();
    }
    recalcularDistribucionAureaSilenciosa();
}
window.aplicarColorASlot = aplicarColorASlot;

window.abrirRuedaColorBoveda = function(slot) {
    window.slotColorActual = slot;
    const inputVal = document.getElementById('hex-slot-' + slot)?.value || "#ff6b00";
    const inputHex = document.getElementById('input-hex-manual');
    if (inputHex) inputHex.value = inputVal.replace('#', '');
    const modal = document.getElementById('modal-color-espectro');
    if (modal) modal.style.display = 'flex';

    try {
        const hsl = hexToHSL(inputVal);
        window.estadoColorCustom.h = hsl.h;
        window.estadoColorCustom.l_base = Math.max(50, hsl.l);
        const slider = document.getElementById('slider-brillo');
        if (slider) {
            slider.value = 100;
            slider.style.background = 'linear-gradient(to right, black, ' + hslToHex(hsl.h, 100, window.estadoColorCustom.l_base) + ')';
        }
    } catch(e) {}
};

window.cerrarModalColorManual = function() {
    const modal = document.getElementById('modal-color-espectro');
    if (modal) modal.style.display = 'none';
};

export const CATALOGO_CUARZOS_ONBOARDING = [
    { id: 'carbon', nombre: 'Ónix Carbón', dot: '#181820', bg: 'linear-gradient(145deg, rgba(28,28,36,0.92), rgba(12,12,16,0.95))', border: 'rgba(255,255,255,0.16)', text: '#ffffff', claro: false },
    { id: 'clasico', nombre: 'Cuarzo Clásico', dot: '#f8fafc', bg: 'linear-gradient(145deg, rgba(255,255,255,0.92), rgba(236,240,246,0.95))', border: 'rgba(0,0,0,0.18)', text: '#0f172a', claro: true },
    { id: 'pantera', nombre: 'Pantera Rosa', dot: '#ff69b4', bg: 'linear-gradient(145deg, rgba(255,105,180,0.32), rgba(46,14,34,0.90))', border: 'rgba(255,130,195,0.50)', text: '#ffffff', claro: false },
    { id: 'celeste', nombre: 'Azul Cielo', dot: '#38bdf8', bg: 'linear-gradient(145deg, rgba(56,189,248,0.32), rgba(12,34,58,0.90))', border: 'rgba(56,189,248,0.50)', text: '#ffffff', claro: false },
    { id: 'ambar', nombre: 'Ámbar Geokatu', dot: '#ff6b00', bg: 'linear-gradient(145deg, rgba(255,107,0,0.32), rgba(46,20,6,0.90))', border: 'rgba(255,140,0,0.50)', text: '#ffffff', claro: false },
    { id: 'esmeralda', nombre: 'Esmeralda', dot: '#10b981', bg: 'linear-gradient(145deg, rgba(16,185,129,0.32), rgba(8,40,30,0.90))', border: 'rgba(52,211,153,0.50)', text: '#ffffff', claro: false },
    { id: 'topacio', nombre: 'Topacio Real', dot: '#facc15', bg: 'linear-gradient(145deg, rgba(250,204,21,0.30), rgba(48,38,8,0.90))', border: 'rgba(250,204,21,0.50)', text: '#ffffff', claro: false },
    { id: 'rubi', nombre: 'Rubí Carmesí', dot: '#f43f5e', bg: 'linear-gradient(145deg, rgba(244,63,94,0.32), rgba(48,10,20,0.90))', border: 'rgba(251,113,133,0.50)', text: '#ffffff', claro: false },
    { id: 'amatista', nombre: 'Amatista', dot: '#a855f7', bg: 'linear-gradient(145deg, rgba(168,85,247,0.32), rgba(32,12,52,0.90))', border: 'rgba(192,132,252,0.50)', text: '#ffffff', claro: false }
];

window.obtenerEstiloCuarzoOnboarding = function(temaRaw) {
    const t = String(temaRaw || 'carbon').trim();
    if (t.indexOf('custom:') === 0) {
        const hex = t.replace('custom:', '').trim() || '#ff6b00';
        const clean = hex.replace('#', '');
        const r = parseInt(clean.substring(0, 2), 16) || 255;
        const g = parseInt(clean.substring(2, 4), 16) || 107;
        const b = parseInt(clean.substring(4, 6), 16) || 0;
        return {
            id: t,
            nombre: 'Cuarzo Propio',
            dot: hex,
            bg: 'linear-gradient(145deg, rgba(' + r + ',' + g + ',' + b + ',0.34), rgba(' + Math.round(r * 0.16) + ',' + Math.round(g * 0.16) + ',' + Math.round(b * 0.16) + ',0.92))',
            border: 'rgba(' + r + ',' + g + ',' + b + ',0.55)',
            text: '#ffffff',
            claro: false
        };
    }
    return CATALOGO_CUARZOS_ONBOARDING.find(function(x) { return x.id === t; }) || CATALOGO_CUARZOS_ONBOARDING[0];
};

let sincronizandoScrollDrawerCuarzos = false;
function vincularScrollCuarzosDrawer() {
    const elTop = document.getElementById('carrusel-cuarzos-drawer');
    const elBot = document.getElementById('sim-track-drawer-cuarzos');
    if (!elTop || !elBot) return;
    elTop.onscroll = function() {
        if (sincronizandoScrollDrawerCuarzos) return;
        sincronizandoScrollDrawerCuarzos = true;
        const maxTop = Math.max(1, elTop.scrollWidth - elTop.clientWidth);
        const maxBot = Math.max(0, elBot.scrollWidth - elBot.clientWidth);
        elBot.scrollLeft = (elTop.scrollLeft / maxTop) * maxBot;
        setTimeout(function() { sincronizandoScrollDrawerCuarzos = false; }, 25);
    };
    elBot.onscroll = function() {
        if (sincronizandoScrollDrawerCuarzos) return;
        sincronizandoScrollDrawerCuarzos = true;
        const maxBot = Math.max(1, elBot.scrollWidth - elBot.clientWidth);
        const maxTop = Math.max(0, elTop.scrollWidth - elTop.clientWidth);
        elTop.scrollLeft = (elBot.scrollLeft / maxBot) * maxTop;
        setTimeout(function() { sincronizandoScrollDrawerCuarzos = false; }, 25);
    };
}

export function renderizarCarruselCuarzosDrawer() {
    const track = document.getElementById('carrusel-cuarzos-drawer');
    const input = document.getElementById('drawer-select-tema');
    if (!track) return;
    const valorActual = (comercioActivoParaCatalogo && comercioActivoParaCatalogo.tema_popup)
        ? comercioActivoParaCatalogo.tema_popup
        : (input && input.value ? input.value : 'carbon');
    if (input) input.value = valorActual;
    const esCustom = valorActual.indexOf('custom:') === 0;
    const colorCustom = esCustom ? valorActual.replace('custom:', '') : '#00f5d4';

    let html = '';
    CATALOGO_CUARZOS_ONBOARDING.forEach(function(c) {
        const activo = (valorActual === c.id) ? ' activo' : '';
        html +=
            '<button type="button" class="chip-cuarzo-item' + activo + '" data-tema="' + c.id + '" onclick="window.seleccionarCuarzoDrawer(\'' + c.id + '\')" style="background:' + c.bg + '; border-color:' + c.border + '; color:' + c.text + ';">' +
                '<span style="width:9px; height:9px; border-radius:50%; background:' + c.dot + '; border:1px solid rgba(255,255,255,0.5);"></span>' +
                '<span>' + c.nombre + '</span>' +
            '</button>';
    });
    html +=
        '<button type="button" class="chip-cuarzo-item' + (esCustom ? ' activo' : '') + '" data-tema="custom" onclick="window.abrirRuedaColorBoveda(\'CUARZO_CUSTOM\')" style="background:linear-gradient(145deg, rgba(255,107,0,0.25), rgba(0,245,212,0.25)); border-color:rgba(0,245,212,0.5); color:#ffffff;">' +
            '<span style="width:9px; height:9px; border-radius:50%; background:' + colorCustom + '; border:1px solid #fff;"></span>' +
            '<span>🎨 Personalizado</span>' +
        '</button>';
    track.innerHTML = html;
    renderizarSimuladorNombreDrawer();
}
window.renderizarCarruselCuarzosDrawer = renderizarCarruselCuarzosDrawer;

export function renderizarSimuladorNombreDrawer() {
    const box = document.getElementById('drawer-simulador-nombre-png');
    if (!box) return;
    const urlLogoNombre = comercioActivoParaCatalogo
        ? (comercioActivoParaCatalogo.logo_nombre || comercioActivoParaCatalogo.nombre_png || '')
        : '';
    if (!urlLogoNombre || urlLogoNombre.length < 5) {
        box.style.display = 'none';
        return;
    }
    const temaActivo = (comercioActivoParaCatalogo && comercioActivoParaCatalogo.tema_popup) || 'carbon';
    const lista = CATALOGO_CUARZOS_ONBOARDING.slice();
    if (temaActivo.indexOf('custom:') === 0) {
        lista.push(window.obtenerEstiloCuarzoOnboarding(temaActivo));
    }
    const cardsHtml = lista.map(function(c) {
        const sel = (temaActivo === c.id);
        const halo = c.claro
            ? 'filter:drop-shadow(0 0 1px rgba(0,0,0,0.45));'
            : 'filter:drop-shadow(0 0 1.5px rgba(255,255,255,0.85)) drop-shadow(0 2px 4px rgba(0,0,0,0.9));';
        const borde = sel ? '2px solid var(--naranja)' : ('1px solid ' + c.border);
        return '<div data-sim-tema="' + c.id + '" onclick="window.seleccionarCuarzoDrawer(\'' + c.id + '\')" style="flex:0 0 144px; scroll-snap-align:center; background:' + c.bg + '; border:' + borde + '; border-radius:10px; padding:8px 6px; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:58px; cursor:pointer;">' +
            '<span style="font-size:8px; color:' + (c.claro ? '#334155' : '#cbd5e1') + '; font-weight:800; text-transform:uppercase; margin-bottom:4px;">' + c.nombre + '</span>' +
            '<img src="' + urlLogoNombre + '" style="max-height:30px; max-width:128px; object-fit:contain; ' + halo + '">' +
        '</div>';
    }).join('');

    box.style.display = 'block';
    box.innerHTML =
        '<div style="background:rgba(0,0,0,0.5); border:1px dashed rgba(255,107,0,0.4); border-radius:10px; padding:8px; text-align:center;">' +
            '<span style="font-size:9px; font-weight:900; color:var(--naranja-miel); text-transform:uppercase; display:block; margin-bottom:4px;">Simulador 1:1 Logo Nombre en Cuarzos (Desliza ➔)</span>' +
            '<div id="sim-track-drawer-cuarzos" class="carrusel-cuarzos-track">' + cardsHtml + '</div>' +
        '</div>';
    vincularScrollCuarzosDrawer();
}
window.renderizarSimuladorNombreDrawer = renderizarSimuladorNombreDrawer;

window.seleccionarCuarzoDrawer = function(tema) {
    const t = String(tema || 'carbon').trim();
    const input = document.getElementById('drawer-select-tema');
    if (input) input.value = t;
    if (comercioActivoParaCatalogo) {
        comercioActivoParaCatalogo.tema_popup = t;
        AppState.guardarColaLocal();
    }
    renderizarCarruselCuarzosDrawer();
    setTimeout(function() {
        const topTrack = document.getElementById('carrusel-cuarzos-drawer');
        if (topTrack) {
            const key = t.indexOf('custom:') === 0 ? 'custom' : t;
            const chip = topTrack.querySelector('[data-tema="' + key + '"]');
            if (chip) chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
        const botTrack = document.getElementById('sim-track-drawer-cuarzos');
        if (botTrack) {
            const card = botTrack.querySelector('[data-sim-tema="' + t + '"]');
            if (card) card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }, 40);
};

window.confirmarColorSeleccionado = function() {
    const inputEl = document.getElementById('input-hex-manual');
    let hex = inputEl ? inputEl.value.replace('#', '').trim() : '';
    if (/^([0-9A-F]{3}|[0-9A-F]{6})$/i.test(hex)) {
        const hexFinal = '#' + hex.toUpperCase();
        if (window.slotColorActual === 'CUARZO_CUSTOM') {
            window.seleccionarCuarzoDrawer('custom:' + hexFinal);
        } else {
            aplicarColorASlot(window.slotColorActual, hexFinal);
        }
        cerrarModalColorManual();
    } else {
        mostrarToast("Codigo cromatico hexadecimal invalido.", "error");
    }
};
window.sincronizarColorDesdeHex = function(valorIngresado) {
    const hexLimpio = (valorIngresado || '').replace('#', '').trim();
    const inputHex = document.getElementById('input-hex-manual');
    if (/^([0-9A-F]{3}|[0-9A-F]{6})$/i.test(hexLimpio)) {
        if (inputHex) inputHex.style.borderColor = '#00ff64';
        if (window.slotColorActual && window.slotColorActual !== 'CUARZO_CUSTOM') {
            aplicarColorASlot(window.slotColorActual, '#' + hexLimpio.toUpperCase());
        }
    } else {
        if (inputHex) inputHex.style.borderColor = '#ff4444';
    }
};



window.eliminarSlotColor = function(slot) {
    const box = document.getElementById('slot-color-box-' + slot);
    const addBtn = document.getElementById('add-slot-btn-' + slot);
    const hexInput = document.getElementById('hex-slot-' + slot);
    if (box) box.style.display = 'none';
    if (addBtn) addBtn.style.display = 'flex';
    if (hexInput) hexInput.value = '';

    if (slot === 2) { eliminarSlotColor(3); eliminarSlotColor(4); }
    else if (slot === 3) { eliminarSlotColor(4); }
    recalcularDistribucionAureaSilenciosa();
};

window.agregarSlotColor = function(slot) {
    const box = document.getElementById('slot-color-box-' + slot);
    const addBtn = document.getElementById('add-slot-btn-' + slot);
    if (addBtn) addBtn.style.display = 'none';
    if (box) box.style.display = 'flex';

    const defaults = { 2: '#ffffff', 3: '#0a0a0c', 4: '#00f5d4' };
    aplicarColorASlot(slot, defaults[slot]);

    if (slot < 4) {
        const nextAdd = document.getElementById('add-slot-btn-' + (slot + 1));
        const nextBox = document.getElementById('slot-color-box-' + (slot + 1));
        if (nextAdd && nextBox && nextBox.style.display === 'none') {
            nextAdd.style.display = 'flex';
        }
    }
};

window.extraerColoresAutomaticosBranding = function() {
    const c = comercioActivoParaCatalogo || (window.AppState && window.AppState.comercioActivo);
    if (!c) {
        mostrarToast("Abre primero un comercio en el Drawer.", "error");
        return;
    }

    const srccandidata = c.logo || c.link_pin || c.portada || c.logo_nombre || c._laminaMaestraDataUrl || '';
    const imgDom = document.getElementById('preview-brand-logo');
    const urlUsar = srccandidata || (imgDom && imgDom.src ? imgDom.src : '');

    if (!urlUsar || urlUsar.length < 10) {
        mostrarToast("Carga primero el logo o la lamina del comercio.", "info");
        return;
    }

    const procesarImagenEnCanvas = function(imgObj) {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            canvas.width = 120;
            canvas.height = 120;
            ctx.drawImage(imgObj, 0, 0, 120, 120);
            const data = ctx.getImageData(0, 0, 120, 120).data;
            const conteo = {};

            for (let i = 0; i < data.length; i += 16) {
                const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
                if (a < 128) continue;
                // Ignorar blancos puros y negros/grises de fondo de la plantilla
                if (r > 235 && g > 235 && b > 235) continue;
                if (r < 22 && g < 22 && b < 22) continue;

                const rB = Math.min(255, Math.round(r / 24) * 24);
                const gB = Math.min(255, Math.round(g / 24) * 24);
                const bB = Math.min(255, Math.round(b / 24) * 24);
                const rgbKey = String(rB) + ',' + String(gB) + ',' + String(bB);
                conteo[rgbKey] = (conteo[rgbKey] || 0) + 1;
            }

            const ordenados = Object.entries(conteo).sort(function(a, b) { return b[1] - a[1]; });
            const elegidos = [];
            for (let i = 0; i < ordenados.length; i++) {
                const rgb = ordenados[i][0].split(',').map(Number);
                const esRepetido = elegidos.some(function(col) {
                    return Math.hypot(col[0] - rgb[0], col[1] - rgb[1], col[2] - rgb[2]) < 55;
                });
                if (!esRepetido) {
                    elegidos.push(rgb);
                    if (elegidos.length === 4) break;
                }
            }

            const hexColors = elegidos.map(function(col) {
                return '#' + col.map(function(v) { return Math.min(255, v).toString(16).padStart(2, '0'); }).join('').toUpperCase();
            });

            eliminarSlotColor(2); eliminarSlotColor(3); eliminarSlotColor(4);

            if (hexColors[0]) aplicarColorASlot(1, hexColors[0]);
            if (hexColors[1]) { agregarSlotColor(2); aplicarColorASlot(2, hexColors[1]); }
            if (hexColors[2]) { agregarSlotColor(3); aplicarColorASlot(3, hexColors[2]); }
            if (hexColors[3]) { agregarSlotColor(4); aplicarColorASlot(4, hexColors[3]); }

            emitirTono('EXITO');
            actualizarPinDrawerLive();
            AppState.guardarColaLocal();
            mostrarToast("Paleta aurea extraida de los pixeles del comercio.", "exito");
        } catch (errCanvas) {
            mostrarToast("Error leyendo pixeles de la imagen.", "error");
        }
    };

    const imgTemp = new Image();
    if (urlUsar.indexOf('http') === 0) {
        imgTemp.crossOrigin = "anonymous";
    }
    imgTemp.onload = function() { procesarImagenEnCanvas(imgTemp); };
    imgTemp.onerror = function() {
        // Fallback por proxy solo si era una URL remota con bloqueo CORS
        if (urlUsar.indexOf('http') === 0) {
            const imgProxy = new Image();
            imgProxy.crossOrigin = "anonymous";
            imgProxy.onload = function() { procesarImagenEnCanvas(imgProxy); };
            imgProxy.src = 'https://images.weserv.nl/?url=' + encodeURIComponent(urlUsar);
        }
    };
    imgTemp.src = urlUsar;
};

export function inicializarEventosRueda() {
    const rueda = document.getElementById('rueda-colores');
    const sliderBrillo = document.getElementById('slider-brillo');
    if (!rueda || !sliderBrillo) return;
    let draggingWheel = false;

    const calcularColorRueda = function(e) {
        const rect = rueda.getBoundingClientRect();
        let clientX = e.touches ? e.touches[0].clientX : e.clientX;
        let clientY = e.touches ? e.touches[0].clientY : e.clientY;
        let x = clientX - rect.left - rect.width / 2;
        let y = clientY - rect.top - rect.height / 2;

        let radio = Math.sqrt(x * x + y * y);
        const maxRadio = rect.width / 2;
        if (radio > maxRadio) { x = (x / radio) * maxRadio; y = (y / radio) * maxRadio; radio = maxRadio; }

        const puntero = document.getElementById('puntero-color');
        if (puntero) {
            puntero.style.left = (x + maxRadio) + 'px';
            puntero.style.top = (y + maxRadio) + 'px';
        }

        // Calibracion exacta 1:1 con conic-gradient(from 90deg)
        let angle = Math.atan2(y, x) * (180 / Math.PI);
        if (angle < 0) angle += 360;
        window.estadoColorCustom.h = Math.round(angle);
        window.estadoColorCustom.l_base = 100 - ((radio / maxRadio) * 50); 
        actualizarPreviewCustom();
    };
    const actualizarPreviewCustom = function() {
        const factorBrillo = sliderBrillo.value / 100;
        const l_final = window.estadoColorCustom.l_base * factorBrillo;
        const hex = hslToHex(window.estadoColorCustom.h, 100, l_final);
        const inputHex = document.getElementById('input-hex-manual');
        if (inputHex) {
            inputHex.value = hex.replace('#', '');
            inputHex.style.borderColor = '#00ff64';
        }
        const pureHex = hslToHex(window.estadoColorCustom.h, 100, window.estadoColorCustom.l_base);
        sliderBrillo.style.background = 'linear-gradient(to right, black, ' + pureHex + ')';
        if (window.slotColorActual && window.slotColorActual !== 'CUARZO_CUSTOM') {
            aplicarColorASlot(window.slotColorActual, hex);
        }
    };

    rueda.addEventListener('mousedown', function(e) { draggingWheel = true; calcularColorRueda(e); });
    rueda.addEventListener('mousemove', function(e) { if (draggingWheel) calcularColorRueda(e); });
    window.addEventListener('mouseup', function() { draggingWheel = false; });
    rueda.addEventListener('touchstart', function(e) { draggingWheel = true; calcularColorRueda(e); }, { passive: false });
    rueda.addEventListener('touchmove', function(e) { if (draggingWheel) { e.preventDefault(); calcularColorRueda(e); } }, { passive: false });
    window.addEventListener('touchend', function() { draggingWheel = false; });
    sliderBrillo.addEventListener('input', actualizarPreviewCustom);
}
window.inicializarEventosRueda = inicializarEventosRueda;

// =========================================================================
// GESTOR DE CATEGORÍAS MAESTRAS Y NICHOS
// =========================================================================
let poolCategoriasCatalogo = new Set();

export function actualizarDatalistCategoriasCatalogo() {
    const dl = document.getElementById('lista-categorias-catalogo-sugeridas');
    if (!dl) return;

    listaComercios.forEach(function(c) {
        if (c.catalogo && Array.isArray(c.catalogo)) {
            c.catalogo.forEach(function(p) {
                if (p.categoria && p.categoria.trim() && p.categoria !== 'General') {
                    poolCategoriasCatalogo.add(p.categoria.trim());
                }
            });
        }
    });

    const guardadas = JSON.parse(localStorage.getItem('geokatu_categorias_catalogo_maestras') || '[]');
    guardadas.forEach(function(cat) { poolCategoriasCatalogo.add(cat); });

    const ordenadas = Array.from(poolCategoriasCatalogo).sort(function(a, b) { return a.localeCompare(b, 'es'); });
    dl.innerHTML = ordenadas.map(function(c) { return '<option value="' + c + '">'; }).join('');
}
window.actualizarDatalistCategoriasCatalogo = actualizarDatalistCategoriasCatalogo;

export function registrarCategoriaGlobalCatalogo(nuevaCat) {
    if (!nuevaCat || !nuevaCat.trim()) return;
    const catLimpia = nuevaCat.trim();
    poolCategoriasCatalogo.add(catLimpia);

    const guardadas = JSON.parse(localStorage.getItem('geokatu_categorias_catalogo_maestras') || '[]');
    if (guardadas.indexOf(catLimpia) === -1) {
        guardadas.push(catLimpia);
        localStorage.setItem('geokatu_categorias_catalogo_maestras', JSON.stringify(guardadas));
    }
    actualizarDatalistCategoriasCatalogo();
}
window.registrarCategoriaGlobalCatalogo = registrarCategoriaGlobalCatalogo;

export function actualizarDatalistNichos() {
    const datalist = document.getElementById('lista-nichos-sugeridos');
    if (!datalist) return;

    const setNichos = new Set();
    listaComercios.forEach(function(c) {
        const n = (c.nicho || c.categoria || '').trim();
        if (n && n !== 'General') setNichos.add(n);
    });

    const nichosOrdenados = Array.from(setNichos).sort(function(a, b) { return a.localeCompare(b, 'es'); });
    datalist.innerHTML = nichosOrdenados.map(function(nicho) { return '<option value="' + nicho + '">'; }).join('');
}
window.actualizarDatalistNichos = actualizarDatalistNichos;

// =========================================================================
// RENDERIZADOR DEL TABLERO KANBAN
// =========================================================================
window.cambiarVistaTablero = function(vista) {
    vistaActualTablero = vista;
    document.querySelectorAll('.tab-vista').forEach(function(b) { b.classList.remove('activa'); });
    const btnActivo = document.getElementById('tab-' + vista);
    if (btnActivo) btnActivo.classList.add('activa');
    renderizarTablero();
};

window.toggleMinimizarTicket = function(index, event) {
    if (event.target.classList.contains('modo-edicion') || event.target.tagName === 'INPUT' || event.target.tagName === 'BUTTON') return;
    listaComercios[index].minimizado = !listaComercios[index].minimizado;
    AppState.guardarColaLocal();
    const card = document.querySelector('.cuadrito-actividad[data-index="' + index + '"]');
    if (card) {
        card.classList.toggle('minimizado', listaComercios[index].minimizado);
        const flecha = card.querySelector('.btn-toggle-colapso');
        if (flecha) flecha.innerText = listaComercios[index].minimizado ? '▶' : '▼';
    }
};

window.toggleMinimizarTodos = function() {
    const algunoAbierto = listaComercios.some(function(c) { return !c.minimizado; });
    listaComercios.forEach(function(c) { c.minimizado = algunoAbierto; });
    AppState.guardarColaLocal();
    renderizarTablero();
};

window.toggleValidado = function(index) {
    document.querySelectorAll('.menu-decision-validar').forEach(function(m) { m.remove(); });
    const card = document.querySelector('.cuadrito-actividad[data-index="' + index + '"]');
    if (!card) return;

    const menu = document.createElement('div');
    menu.className = 'menu-decision-validar';
    menu.innerHTML = 
        '<div style="font-size: 11px; font-weight: 900; color: #fff; border-bottom: 1px solid #333; padding-bottom: 4px;">' +
            'Clasificar Comercio' +
        '</div>' +
        '<button class="btn-submit" style="background: rgba(255, 179, 0, 0.2); border: 1px solid var(--naranja-miel); color: var(--naranja-miel); padding: 6px; font-size: 11px; justify-content: center;" onclick="event.stopPropagation(); clasificarComercio(' + index + ', \'Seguimiento\')">' +
            '1. Seguimiento' +
        '</button>' +
        '<button class="btn-submit" style="background: rgba(0, 230, 118, 0.2); border: 1px solid var(--verde-hoja); color: var(--verde-hoja); padding: 6px; font-size: 11px; justify-content: center;" onclick="event.stopPropagation(); clasificarComercio(' + index + ', \'Cerrado\')">' +
            '2. Cerrado' +
        '</button>' +
        '<button style="background: transparent; border: none; color: #888; font-size: 10px; cursor: pointer; text-align: center;" onclick="event.stopPropagation(); this.parentElement.remove()">' +
            'Cancelar' +
        '</button>';
    card.appendChild(menu);
};

window.clasificarComercio = function(index, estadoFinal) {
    const c = listaComercios[index];
    c.estado_flujo = estadoFinal;
    c.validado = (estadoFinal === 'Cerrado');
    c.fecha_clasificacion = new Date().toISOString();
    c.archivado = false;
    c.capturado = true;

    if (estadoFinal === 'Cerrado') {
        emitirTono('EXITO');
        const volador = document.querySelector('.abeja-wrapper[data-id-comercio="' + c.id + '"]');
        if (volador) volador.remove();
        abejasActivas = Math.max(0, abejasActivas - 1);
        actualizarHUD();
    }

    AppState.guardarColaLocal();
    renderizarTablero();
    actualizarConteoHistorial();
};

function normalizarURL(u) {
    if (!u || u === 'N/A') return '#';
    return (u.indexOf('http') === 0) ? u : ('https://' + u);
}

export function renderizarTablero() {
    const contenedor = document.getElementById('contenedor-grid-unico');
    if (!contenedor) return;
    contenedor.innerHTML = '';

    let validados = 0, subidos = 0, visibles = 0;

    listaComercios.forEach(function(c) {
        if (c.validado && !c.subido && c.archivado === true) {
            c.archivado = false;
            c.capturado = true;
        }
    });

    listaComercios.forEach(function(c, index) {
        if (c.validado) validados++;
        if (c.subido) subidos++;
        if (!c.capturado) return;

        if (vistaActualTablero === 'radar') {
            if (c.subido === true || c.archivado === true || c.estado_flujo === 'Seguimiento') return;
        } else if (vistaActualTablero === 'seguimiento') {
            if (c.estado_flujo !== 'Seguimiento') return;
        } else if (vistaActualTablero === 'listos') {
            if (!c.validado || c.subido) return;
        }

        visibles++;

        const coordsRaw = c.coordenada_validada || c.coordenadas_crudo || c.plus_code || (String(c.lat || '') + ', ' + String(c.lng || ''));
        const coords = parsearCoordenadasUniversales(coordsRaw);
        const coordsTexto = coords ? (coords.lat + ', ' + coords.lng) : "⚠️ Requiere Validar";

        const arrFonos = String(c.whatsapp || '').split('|').map(function(f) { return f.trim(); }).filter(Boolean);
        const nombreSeguro = (c.nombre || '').replace(/'/g, "\\'");

        let arrFonosHTML = '';
        if (arrFonos.length > 0) {
            arrFonosHTML = arrFonos.map(function(num) {
                return '<button class="btn-wa-pill" onclick="event.stopPropagation(); abrirWhatsAppDirecto(\'' + num + '\', \'' + nombreSeguro + '\')" title="Chatear al WhatsApp +57 ' + num + '">' +
                    '💬 ' + num +
                '</button>';
            }).join('');
        } else {
            arrFonosHTML = '<span style="color: #888; font-size: 11px; font-style: italic;">Sin WhatsApp</span>';
        }

        const tagsHTML = (c.tags_busqueda && c.tags_busqueda.length > 0)
            ? c.tags_busqueda.map(function(t) { return '<span class="tag-info-extra">#' + t + '</span>'; }).join(' ')
            : '';

        const badgeEstrella = c.destacado_estrella 
            ? '<span class="badge-estrella-prioridad" title="No verificado en Maps y con > 3 reseñas">⭐ PROSPECTO TOP (' + (c.cant_resenas || 0) + ' rev)</span>' 
            : '';

        const igHandleLimpio = String(c.instagram_handle || c.instagram || '').replace(/^@/, '').trim();
        const igUrlFinal = igHandleLimpio ? ('https://instagram.com/' + igHandleLimpio) : '#';
        const totalCat = (c.catalogo && Array.isArray(c.catalogo)) ? c.catalogo.length : 0;
        const badge24H = c.es_24_horas ? '<b style="color:var(--verde-hoja);">[24H]</b>' : '';

        const pbxLimpio = String(c.pbx || '').replace(/\D/g, '');
        const pbxHTML = c.pbx 
            ? ('<a href="tel:' + pbxLimpio + '" class="btn-tel-pill" title="Marcar al PBX fijo">📞 ' + c.pbx + '</a>') 
            : '<span class="dato-copiable" data-key="pbx">N/A</span>';

        const sloganHTML = c.slogan ? ('<span class="ticket-slogan">"' + c.slogan + '"</span>') : '';
        const resenaHTML = c.resena_picante 
            ? ('<div style="margin-top: 5px; font-size: 10px; color: #bbb; background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 4px; border-left: 2px solid var(--rojo-fuego);">💬 "' + c.resena_picante.substring(0, 110) + '..."</div>') 
            : '';
        const horarioTexto = c.horario ? c.horario : "No registra";

        const sedesHermanas = obtenerSedesVinculadas(c);
        let sedesHTML = '';
        if (sedesHermanas.length > 1) {
            sedesHTML = 
                '<div style="margin: 6px 0; padding: 6px 8px; background: rgba(41, 182, 246, 0.08); border: 1px dashed var(--azul-link); border-radius: 6px;">' +
                    '<div style="display:flex; justify-content:space-between; align-items:center; font-size:10.5px; font-weight:bold; color:var(--azul-link); margin-bottom:4px;">' +
                        '<span>Red Multi-Sede (' + sedesHermanas.length + ' puntos)</span>' +
                        '<button type="button" class="btn-submit" style="padding: 2px 6px; font-size: 9.5px; background: var(--azul-link); color: #000;" onclick="event.stopPropagation(); abrirMapaMultiSede(\'' + nombreSeguro + '\')">' +
                            'Ver Red en Mapa' +
                        '</button>' +
                    '</div>' +
                '</div>';
        }

        const card = document.createElement('div');
        card.className = 'cuadrito-actividad ' + (c.validado ? 'validado' : '') + ' ' + (c.minimizado ? 'minimizado' : '');
        card.setAttribute('data-id', c.id);
        card.setAttribute('data-index', index);

        card.innerHTML = 
            '<div class="ticket-cabecera" onclick="toggleMinimizarTicket(' + index + ', event)" title="Toca para colapsar o expandir este ticket">' +
                '<div style="display:flex; align-items:center; gap:6px; flex:1; min-width:0;">' +
                    '<span class="btn-toggle-colapso">' + (c.minimizado ? '▶' : '▼') + '</span>' +
                    '<span>🏪</span>' +
                    '<span class="dato-copiable dato-nombre-texto" data-key="nombre" style="font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + (c.nombre || "COMERCIO SIN NOMBRE") + '</span>' +
                    badgeEstrella +
                '</div>' +
                '<span style="font-size: 10px; font-family: monospace; color: ' + (coords ? 'var(--verde-hoja)' : 'var(--rojo-fuego)') + '; flex-shrink:0;">' +
                    coordsTexto +
                '</span>' +
            '</div>' +

            '<div class="ticket-cuerpo">' +
                '<button type="button" class="btn-eliminar-inline" onclick="event.stopPropagation(); window.eliminarComercioTicket(' + index + ')" title="Eliminar fila">🗑️</button>' +
                '<button type="button" class="btn-editar-inline" onclick="event.stopPropagation(); window.toggleEditarTicket(' + index + ', this)" title="Editar datos">✏️</button>' +
                '<button type="button" class="btn-enviar-sheets-inline" onclick="event.stopPropagation(); enviarComercioASheets(' + index + ')" title="Enviar este ticket a la última fila de Sheets">📤</button>' +


                '<div class="cuadrito-datos">' +
                    sloganHTML +
                    '<pre style="margin: 0; line-height: 1.6;">• ID: <span class="dato-copiable" data-key="id">' + c.id + '</span>\n' +
'• Nicho: <span class="dato-copiable dato-nicho-texto" data-key="nicho">' + (c.nicho || c.categoria || "General") + '</span>\n' +
'<input type="text" class="input-nicho-editable" list="lista-nichos-sugeridos" value="' + (c.nicho || c.categoria || 'General') + '" style="display:none; background:rgba(0,0,0,0.8); border:1px dashed var(--rojo-fuego); color:#00ff64; border-radius:4px; padding:1px 6px; font-size:11px; outline:none; font-family:inherit; width:65%;">\n' +
'• Dirección: <span class="dato-copiable" data-key="direccion">' + (c.direccion || "N/A") + '</span> <button class="btn-geo-inline" style="display:none;" onclick="event.stopPropagation(); abrirMapaParaEditarTicket(' + index + ')" title="Fijar coordenadas en el Minimapa">🗺️ Fijar en Mapa</button>\n' +
'• Plus Code: <span class="dato-copiable" data-key="plus_code" style="color:var(--naranja-miel); font-family:monospace;">' + (c.plus_code || "N/A") + '</span>\n' +
'• Coords GPS: <span class="dato-copiable" data-key="coordenada_validada">' + coordsTexto + '</span>\n' +
sedesHTML +
'• Horario: <span class="dato-copiable" data-key="horario">' + horarioTexto + '</span> ' + badge24H + '\n' +
'• PBX: ' + pbxHTML + ' | Correo: <span class="dato-copiable" data-key="correo">' + (c.correo || "N/A") + '</span></pre>' +

                    '<div class="fila-fonos-wa">' +
                        '<span style="font-size: 12px; color: #cbd5e1; font-family: \'Segoe UI\', sans-serif;">• WhatsApp:</span>' +
                        '<div class="contenedor-botones-wa">' +
                            arrFonosHTML +
                            '<button class="btn-plus-wa" onclick="event.stopPropagation(); agregarFonoDinamico(' + index + ')" title="Añadir línea WhatsApp">+</button>' +
                        '</div>' +
                        '<span class="dato-copiable dato-whatsapp-raw" data-key="whatsapp" style="display:none;">' + (c.whatsapp || "") + '</span>' +
                    '</div>' +

                    '<pre style="margin: 0; line-height: 1.6;">• Instagram: <span class="dato-copiable" data-key="instagram">' + (igHandleLimpio || "N/A") + '</span>\n' +
'• Web: <span class="dato-copiable" data-key="web">' + (c.sitio_web || c.web || "N/A") + '</span></pre>' +

                    (tagsHTML ? ('<div style="margin-top: 5px;">' + tagsHTML + '</div>') : '') +
                    resenaHTML +
                '</div>' +

                '<button class="btn-act btn-act-cat" onclick="abrirDrawerCatalogo(' + index + ')">' +
                    '📦 Gestionar Catálogo (<strong id="badge-cat-' + index + '">' + totalCat + '</strong> SKUs)' +
                '</button>' +

                '<div class="cuadrito-acciones-comercio" style="grid-template-columns: 1fr 1fr 1fr 1.2fr;">' +
                    '<a class="btn-act btn-act-web" href="' + normalizarURL(c.sitio_web || c.web) + '" target="_blank">Web</a>' +
                    '<a class="btn-act btn-act-ig" href="' + igUrlFinal + '" target="_blank">Instagram</a>' +
                    '<button type="button" class="btn-act" style="background: rgba(41,182,246,0.18); border-color: var(--azul-link); color: var(--azul-link);" onclick="event.stopPropagation(); window.abrirModalDefinirDueno(' + index + ')" title="Asignar correo del dueño">' +
                        (c.reclamado ? 'Dueño: OK' : 'Ceder') +
                    '</button>' +
                    '<button class="btn-act btn-act-val ' + (c.validado ? 'activo' : '') + '" onclick="toggleValidado(' + index + ')">' +
                        (c.validado ? 'Validado' : 'Validar') +
                    '</button>' +
                '</div>' +
            '</div>';

        contenedor.appendChild(card);
    });

    if (visibles === 0 && listaComercios.length > 0) {
        contenedor.innerHTML = 
            '<div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px; color: #888; font-size: 13px;">' +
                '🐝 <strong>Tienes comercios volando en el enjambre.</strong><br>' +
                'Toca una abeja o mariposa en el cielo para capturarla y bajar su ticket al tablero.' +
            '</div>';
    }

    const elValidados = document.getElementById('kpi-validados');

    const elTotal = document.getElementById('kpi-total');
    const elListos = document.getElementById('conteo-listos');
    const elSubidos = document.getElementById('conteo-subidos');
    const elVisibles = document.getElementById('badge-total-visibles');

    if (elValidados) elValidados.innerText = validados;
    if (elTotal) elTotal.innerText = listaComercios.length;
    if (elListos) elListos.innerText = validados;
    if (elSubidos) elSubidos.innerText = subidos;
    if (elVisibles) elVisibles.innerText = visibles;
    AppState.guardarColaLocal();
}
window.renderizarTablero = renderizarTablero;

window.agregarFonoDinamico = function(index) {
    const nuevoFono = prompt("Ingresa el numero de WhatsApp:");
    if (!nuevoFono) return;
    const limpio = nuevoFono.replace(/\D/g, '');
    if (limpio.length < 7) { mostrarToast("Numero invalido.", "error"); return; }
    let actuales = listaComercios[index].whatsapp ? String(listaComercios[index].whatsapp).split('|').map(function(s) { return s.trim(); }).filter(Boolean) : [];
    actuales.push(limpio);
    listaComercios[index].whatsapp = actuales.join(' | ');
    AppState.guardarColaLocal();
    renderizarTablero();
};

window.filtrarComerciosUI = function() {
    const inputBusqueda = document.getElementById('buscar-comercio');
    const q = (inputBusqueda ? inputBusqueda.value : '').trim().toLowerCase();
    document.querySelectorAll('.cuadrito-actividad').forEach(function(card) {
        const txt = card.innerText.toLowerCase();
        card.style.display = (q === '' || txt.indexOf(q) !== -1) ? 'block' : 'none';
    });
};

// =========================================================================
// EDICIÓN EN CALIENTE Y COPIADO TÁCTIL
// =========================================================================
window.eliminarComercioTicket = async function(index) {
    var conf = await solicitarConfirmacion("Eliminar Comercio", "¿Deseas eliminar este registro del radar local?");
    if (!conf) return;
    listaComercios.splice(index, 1);
    AppState.guardarColaLocal();
    renderizarTablero();
    actualizarConteoHistorial();
    mostrarToast("Comercio removido.", "info");
};

window.toggleEditarTicket = function(index, btnElement) {
    var btn = btnElement || document.querySelector('.cuadrito-actividad[data-index="' + index + '"] .btn-editar-inline');
    if (!btn) return;
    var card = btn.closest('.cuadrito-actividad');
    if (!card) return;

    var spans = card.querySelectorAll('.dato-copiable');
    var btnTrash = card.querySelector('.btn-eliminar-inline');
    var contenedorWa = card.querySelector('.contenedor-botones-wa');
    var spanWaRaw = card.querySelector('.dato-whatsapp-raw');
    var btnGeoInline = card.querySelector('.btn-geo-inline');

    var editando = btn.textContent.trim().indexOf('✔️') !== -1;

    if (editando) {
        var inputNicho = card.querySelector('.input-nicho-editable');
        var spanNicho = card.querySelector('.dato-nicho-texto');
        if (inputNicho && listaComercios[index]) {
            var valorFinal = inputNicho.value.trim() || 'General';
            listaComercios[index].nicho = valorFinal;
            listaComercios[index].categoria = valorFinal;
            if (spanNicho) spanNicho.innerText = valorFinal;
        }

        spans.forEach(function(span) {
            var key = span.getAttribute('data-key');
            if (key && key !== 'nicho' && listaComercios[index]) {
                listaComercios[index][key] = span.innerText.trim();
            }
            span.contentEditable = "false";
            span.classList.remove('modo-edicion');
        });

        btn.textContent = '✏️';
        if (btnTrash) btnTrash.style.display = 'none';
        if (contenedorWa) contenedorWa.style.display = 'inline-flex';
        if (spanWaRaw) spanWaRaw.style.display = 'none';
        if (btnGeoInline) btnGeoInline.style.display = 'none';
        if (inputNicho && spanNicho) {
            inputNicho.style.display = 'none';
            spanNicho.style.display = 'inline-block';
        }
        actualizarDatalistNichos();
        AppState.guardarColaLocal();
        renderizarTablero();

        // Si el comercio ya está en Firebase, actualizar en caliente
        var cActual = listaComercios[index];
        if (cActual && cActual.subido === true) {
            mostrarToast("Sincronizando cambios con Firestore...", "info", 2000);
            (async function() {
                try {
                    var docRef = doc(db, "Directorio", String(cActual.id));
                    var arrFonos = String(cActual.whatsapp || '').split('|').map(function(f) { return f.trim().replace(/\D/g, ''); }).filter(Boolean);
                    var pbxLimpio = String(cActual.pbx || '').trim();

                    var payloadUpdate = {
                        nombre: cActual.nombre || "Comercio Aliado",
                        nicho: cActual.nicho || "General",
                        categoria: cActual.nicho || "General",
                        categoria_maestra: cActual.nicho || "General",
                        direccion: cActual.direccion || "",
                        plus_code: cActual.plus_code || "",
                        horario: cActual.horario || "No registra",
                        pbx: pbxLimpio,
                        correo: cActual.correo || "",
                        email: cActual.correo || "",
                        instagram: String(cActual.instagram || '').replace(/^@/, '').trim(),
                        web: cActual.web || cActual.sitio_web || "",
                        sitio_web: cActual.web || cActual.sitio_web || "",
                        whatsapp: arrFonos[0] || "",
                        whatsApp: arrFonos[0] || "",
                        telefonos: arrFonos,
                        fecha_actualizacion: new Date().toISOString()
                    };

                    await setDoc(docRef, payloadUpdate, { merge: true });
                    emitirTono('EXITO');
                    mostrarToast('Actualizado en vivo en Firestore.', "exito", 2500);
                } catch (errSync) {
                    mostrarToast("Error actualizando en la nube: " + errSync.message, "error", 4000);
                }
            })();
        } else {
            mostrarToast("Cambios guardados localmente.", "exito");
        }
    } else {
        btn.textContent = '✔️';
        if (btnTrash) btnTrash.style.display = 'block';
        if (btnGeoInline) btnGeoInline.style.display = 'inline-flex';

        if (contenedorWa) contenedorWa.style.display = 'none';
        if (spanWaRaw) {
            spanWaRaw.style.display = 'inline-block';
            spanWaRaw.contentEditable = "true";
            spanWaRaw.classList.add('modo-edicion');
        }

        var inputNicho = card.querySelector('.input-nicho-editable');
        var spanNicho = card.querySelector('.dato-nicho-texto');
        if (inputNicho && spanNicho) {
            spanNicho.style.display = 'none';
            inputNicho.style.display = 'inline-block';
            inputNicho.focus();
        }

        spans.forEach(function(span) {
            if (!span.classList.contains('dato-whatsapp-raw') && !span.classList.contains('dato-nicho-texto')) {
                span.contentEditable = "true";
                span.classList.add('modo-edicion');
            }
        });
    }
};

document.addEventListener('click', async function(event) {

    if (event.target.classList.contains('dato-copiable')) {
        const span = event.target;
        if (span.classList.contains('modo-edicion')) return;
        try {
            await navigator.clipboard.writeText(span.innerText.trim());
            mostrarToast("Texto copiado al portapapeles.", "info", 1500);
        } catch (err) {}
        return;
    }

   if (event.target.classList.contains('btn-eliminar-inline')) {
        event.stopPropagation();
        const conf = await solicitarConfirmacion("Eliminar Comercio", "¿Deseas eliminar este registro del radar local?");
        if (!conf) return;
        const card = event.target.closest('.cuadrito-actividad');
        const index = parseInt(card.getAttribute('data-index'), 10);
        listaComercios.splice(index, 1);
        AppState.guardarColaLocal();
        renderizarTablero();
        actualizarConteoHistorial();
        mostrarToast("Comercio removido.", "info");
        return;
    }

    if (event.target.classList.contains('btn-editar-inline')) {
        event.stopPropagation();
        const btn = event.target;
        const card = btn.closest('.cuadrito-actividad');
        const index = parseInt(card.getAttribute('data-index'), 10);
        const spans = card.querySelectorAll('.dato-copiable');
        const btnTrash = card.querySelector('.btn-eliminar-inline');
        const contenedorWa = card.querySelector('.contenedor-botones-wa');
        const spanWaRaw = card.querySelector('.dato-whatsapp-raw');
        const btnGeoInline = card.querySelector('.btn-geo-inline');

        const editando = btn.textContent.trim() === '✔️';

        if (editando) {
            const inputNicho = card.querySelector('.input-nicho-editable');
            const spanNicho = card.querySelector('.dato-nicho-texto');
            if (inputNicho && listaComercios[index]) {
                const valorFinal = inputNicho.value.trim() || 'General';
                listaComercios[index].nicho = valorFinal;
                listaComercios[index].categoria = valorFinal;
                if (spanNicho) spanNicho.innerText = valorFinal;
            }

            spans.forEach(function(span) {
                const key = span.getAttribute('data-key');
                if (key && key !== 'nicho' && listaComercios[index]) {
                    listaComercios[index][key] = span.innerText.trim();
                }
                span.contentEditable = "false";
                span.classList.remove('modo-edicion');
            });

            btn.textContent = '✏️';
            if (btnTrash) btnTrash.style.display = 'none';
            if (contenedorWa) contenedorWa.style.display = 'inline-flex';
            if (spanWaRaw) spanWaRaw.style.display = 'none';
            if (btnGeoInline) btnGeoInline.style.display = 'none';
            if (inputNicho && spanNicho) {
                inputNicho.style.display = 'none';
                spanNicho.style.display = 'inline-block';
            }
            actualizarDatalistNichos();
            AppState.guardarColaLocal();
            renderizarTablero();
            mostrarToast("Cambios guardados.", "exito");
        } else {
            btn.textContent = '✔️';
            if (btnTrash) btnTrash.style.display = 'block';
            if (btnGeoInline) btnGeoInline.style.display = 'inline-flex';

            if (contenedorWa) contenedorWa.style.display = 'none';
            if (spanWaRaw) {
                spanWaRaw.style.display = 'inline-block';
                spanWaRaw.contentEditable = "true";
                spanWaRaw.classList.add('modo-edicion');
            }

            const inputNicho = card.querySelector('.input-nicho-editable');
            const spanNicho = card.querySelector('.dato-nicho-texto');
            if (inputNicho && spanNicho) {
                spanNicho.style.display = 'none';
                inputNicho.style.display = 'inline-block';
                inputNicho.focus();
            }

            spans.forEach(function(span) {
                if (!span.classList.contains('dato-whatsapp-raw') && !span.classList.contains('dato-nicho-texto')) {
                    span.contentEditable = "true";
                    span.classList.add('modo-edicion');
                }
            });
        }
        return;
    }

});

// =========================================================================
// DRAWER LATERAL DE CATÁLOGO Y HARDWARE ÓPTICO
// =========================================================================
window.abrirDrawerCatalogo = function(index) {
    comercioActivoParaCatalogo = listaComercios[index];
    if (!comercioActivoParaCatalogo.catalogo) comercioActivoParaCatalogo.catalogo = [];

    const elNombre = document.getElementById('drawer-comercio-nombre');
    const elId = document.getElementById('drawer-comercio-id');
    if (elNombre) elNombre.innerText = comercioActivoParaCatalogo.nombre || "Comercio Aliado";
    if (elId) elId.innerText = 'ID: ' + comercioActivoParaCatalogo.id;
    
    const drawer = document.getElementById('drawer-catalogo-comercio');
    if (drawer) drawer.classList.add('activo');

    window.history.pushState({ modal: 'drawer_catalogo' }, '');

    actualizarPreviewsIdentidadUI();

    if (comercioActivoParaCatalogo.pin_pack) {
        const partesPin = comercioActivoParaCatalogo.pin_pack.split('|');
        const forma = partesPin[0];
        const anim = partesPin[1];
        const selForma = document.getElementById('drawer-select-forma');
        const selAnim = document.getElementById('drawer-select-animacion');
        if (forma && selForma) selForma.value = forma;
        if (anim && selAnim) selAnim.value = anim;
    }

    const c1 = comercioActivoParaCatalogo.color_principal || "#ff6b00";
    aplicarColorASlot(1, c1);

    if (comercioActivoParaCatalogo.color_acento && comercioActivoParaCatalogo.color_acento !== GRIS_METALLIC_GEOKATU) {
        agregarSlotColor(2);
        aplicarColorASlot(2, comercioActivoParaCatalogo.color_acento);
    } else {
        eliminarSlotColor(2);
    }

    if (comercioActivoParaCatalogo.color_terciario && comercioActivoParaCatalogo.color_terciario !== BLANCO_GEOKATU) {
        agregarSlotColor(3);
        aplicarColorASlot(3, comercioActivoParaCatalogo.color_terciario);
    } else {
        eliminarSlotColor(3);
    }

    renderizarCarruselCuarzosDrawer();
    actualizarPinDrawerLive();
    renderizarListaSkusDrawer();
      // Hidratar controles de Orientación y Cabecera del Catálogo
    if (document.getElementById('drawer-avatar-posicion')) {
        document.getElementById('drawer-avatar-posicion').value = comercioActivoParaCatalogo.avatar_posicion || 'centro';
    }
    if (document.getElementById('drawer-placa-nombre')) {
        document.getElementById('drawer-placa-nombre').value = comercioActivoParaCatalogo.placa_nombre || 'ninguna';
    }
    if (document.getElementById('drawer-portada-posicion')) {
        const posP = comercioActivoParaCatalogo.portada_posicion !== undefined ? comercioActivoParaCatalogo.portada_posicion : 50;
        document.getElementById('drawer-portada-posicion').value = posP;
        const lblP = document.getElementById('lbl-drawer-portada-pos');
        if (lblP) lblP.innerText = posP + '%';
    }
    if (document.getElementById('drawer-avatar-marco')) {
        document.getElementById('drawer-avatar-marco').checked = (comercioActivoParaCatalogo.avatar_marco !== false);
    }
    if (document.getElementById('drawer-mostrar-stock')) {
        document.getElementById('drawer-mostrar-stock').checked = (comercioActivoParaCatalogo.mostrar_stock_publico === true);
    }

};


window.cerrarDrawerCatalogo = function(desdePopstate) {
    const esPopstate = Boolean(desdePopstate);
    const drawer = document.getElementById('drawer-catalogo-comercio');
    if (drawer && drawer.classList.contains('activo')) {
        drawer.classList.remove('activo');
        comercioActivoParaCatalogo = null;
        renderizarTablero();

        if (!esPopstate && window.history.state && window.history.state.modal === 'drawer_catalogo') {
            window.history.back();
        }
    }
};

window.addEventListener('popstate', function() {
    const drawer = document.getElementById('drawer-catalogo-comercio');
    const modalEstudio = document.getElementById('modal-estudio-canvas-geokatu');

    if (modalEstudio && modalEstudio.style.display === 'flex') {
        window.cerrarEstudioCanvas();
        return;
    }
    if (drawer && drawer.classList.contains('activo')) {
        window.cerrarDrawerCatalogo(true);
    }
});

export function renderizarListaSkusDrawer() {
    const cont = document.getElementById('drawer-lista-skus');
    const badgeTotal = document.getElementById('drawer-total-skus');
    if (!cont || !comercioActivoParaCatalogo) return;

    const prods = comercioActivoParaCatalogo.catalogo || [];
    if (badgeTotal) badgeTotal.innerText = prods.length;

    if (prods.length === 0) {
        cont.innerHTML = '<p style="color: #666; font-size: 11px; text-align: center; margin-top: 30px;">No hay productos en el catalogo de este comercio.</p>';
        return;
    }

    cont.innerHTML = prods.map(function(p, idx) {
        return '<div class="prod-fila-item">' +
            '<img class="prod-thumb" src="' + (p.imagen || '') + '" onerror="this.src=\'\'">' +
            '<div style="flex: 1; min-width: 0;">' +
                '<div style="display:flex; justify-content:space-between; align-items:center;">' +
                    '<strong style="font-size: 12px; color: #fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + (p.nombre || 'Sin nombre') + '</strong>' +
                    '<span style="font-size: 11px; color: var(--verde-hoja); font-weight: bold; font-family: monospace;">$' + Number(p.precio || 0).toLocaleString('es-CO') + '</span>' +
                '</div>' +
                '<div style="display:flex; justify-content:space-between; align-items:center; margin-top: 3px; font-size: 10px; color: #888;">' +
                    '<span>EAN: <code style="color: var(--naranja-miel); font-family: monospace;">' + (p.codigo_barras || 'N/A') + '</code></span>' +
                    '<span>Stock: <b style="color: #ddd;">' + (p.stock_actual !== undefined ? p.stock_actual : 10) + '</b></span>' +
                '</div>' +
            '</div>' +
            '<button type="button" onclick="eliminarProductoCatalogo(' + idx + ')" style="background: rgba(255,68,68,0.2); border: 1px solid rgba(255,68,68,0.4); color: var(--rojo-fuego); border-radius: 6px; padding: 4px 6px; cursor: pointer; font-size: 11px;">Quitar</button>' +
        '</div>';
    }).join('');
}
window.renderizarListaSkusDrawer = renderizarListaSkusDrawer;

window.eliminarProductoCatalogo = function(idx) {
    if (!comercioActivoParaCatalogo || !comercioActivoParaCatalogo.catalogo) return;
    comercioActivoParaCatalogo.catalogo.splice(idx, 1);
    AppState.guardarColaLocal();
    renderizarListaSkusDrawer();
};

let scannerInstancia = null;
window.abrirCamaraModalParaCatalogo = function() {
    if (typeof Html5Qrcode === 'undefined') {
        mostrarToast("Modulo de escaner en preparacion. Usa agregar manual.", "info");
        return;
    }
    const modal = document.getElementById('modal-camara-escaneo');
    if (modal) modal.style.display = 'flex';

    try {
        if (!scannerInstancia) {
            scannerInstancia = new Html5Qrcode("lector-camara-modal", { verbose: false });
        }
        scannerInstancia.start(
            { facingMode: "environment" },
            { fps: 20, qrbox: { width: 250, height: 160 } },
            async function(codigo) {
                await cerrarCamaraModal();
                emitirTono('EXITO');
                await procesarCodigoEscaneadoCatalogo(codigo);
            },
            function() {}
        ).catch(function() {
            mostrarToast("No fue posible acceder a la camara.", "error");
            cerrarCamaraModal();
        });
    } catch (e) {
        cerrarCamaraModal();
    }
};

window.cerrarCamaraModal = async function() {
    if (scannerInstancia) {
        try {
            if (scannerInstancia.isScanning) await scannerInstancia.stop();
        } catch (e) {}
    }
    const modal = document.getElementById('modal-camara-escaneo');
    if (modal) modal.style.display = 'none';
};

window.procesarCodigoEscaneadoCatalogo = async function(codigo) {
    if (!comercioActivoParaCatalogo) return;
    const prod = await GeokatuDB.CatalogoMatrizService.obtenerProductoPorCodigo(codigo);
    if (prod) {
        const nuevo = {
            codigo_barras: codigo,
            nombre: prod.nombre || "Producto Matriz",
            categoria: prod.categoria || comercioActivoParaCatalogo.nicho || "General",
            precio: Number(prod.precio || 0),
            stock_actual: 10,
            imagen: prod.imagen || '',
            en_piso_venta: true,
            fecha_creacion: new Date().toISOString()
        };
        if (!comercioActivoParaCatalogo.catalogo) comercioActivoParaCatalogo.catalogo = [];
        comercioActivoParaCatalogo.catalogo.unshift(nuevo);
    } else {

        const nombre = prompt('Codigo: ' + codigo + '\nNombre del articulo:');
        if (nombre && nombre.trim()) {
            const nuevo = {
                codigo_barras: codigo,
                nombre: nombre.trim(),
                categoria: comercioActivoParaCatalogo.nicho || "General",
                precio: 0,
                stock_actual: 10,
                en_piso_venta: true,
                fecha_creacion: new Date().toISOString()
            };
            if (!comercioActivoParaCatalogo.catalogo) comercioActivoParaCatalogo.catalogo = [];
            comercioActivoParaCatalogo.catalogo.unshift(nuevo);
        }
    }
    AppState.guardarColaLocal();
    renderizarListaSkusDrawer();
};

window.agregarProductoManualPrompt = function() {
    if (!comercioActivoParaCatalogo) {
        mostrarToast("Abre primero el catalogo de un comercio.", "error");
        return;
    }
    const nombre = prompt("Nombre del producto:");
    if (!nombre || !nombre.trim()) return;
    const precioStr = prompt('Precio para "' + nombre.trim() + '":', "1000");
    const precio = parseFloat(precioStr) || 0;
    const categoria = comercioActivoParaCatalogo.nicho || "General";
    const eanManual = prompt("Codigo de barras (vacio para autogenerar):", "");
    const barcodeFinal = (eanManual && eanManual.trim()) ? eanManual.trim() : String(Date.now()).slice(-8);

    const nuevoProd = {
        codigo_barras: barcodeFinal,
        nombre: nombre.trim(),
        categoria: categoria,
        precio: precio,
        stock_actual: 10,
        en_piso_venta: true,
        fecha_creacion: new Date().toISOString()
    };
    if (!comercioActivoParaCatalogo.catalogo) comercioActivoParaCatalogo.catalogo = [];
    comercioActivoParaCatalogo.catalogo.unshift(nuevoProd);
    AppState.guardarColaLocal();
    renderizarListaSkusDrawer();
    emitirTono('EXITO');
};

export function actualizarPreviewsIdentidadUI() {
    if (!comercioActivoParaCatalogo) return;
    const campos = [
        { id: 'logo', val: comercioActivoParaCatalogo.logo },
        { id: 'portada', val: comercioActivoParaCatalogo.portada },
        { id: 'pin', val: comercioActivoParaCatalogo.link_pin },
        { id: 'logonombre', val: comercioActivoParaCatalogo.logo_nombre }
    ];
    campos.forEach(function(c) {
        const img = document.getElementById('preview-brand-' + c.id);
        const ph = document.getElementById('ph-brand-' + c.id);
        if (c.val && c.val.length > 5) {
            if (img) { img.src = c.val; img.style.display = 'block'; }
            if (ph) ph.style.display = 'none';
        } else {
            if (img) img.style.display = 'none';
            if (ph) ph.style.display = 'flex';
        }
    });
    renderizarSimuladorNombreDrawer();
}


window.actualizarAparienciaCabeceraDrawer = function() {
    if (!comercioActivoParaCatalogo) return;
    comercioActivoParaCatalogo.avatar_posicion = document.getElementById('drawer-avatar-posicion')?.value || 'centro';
    comercioActivoParaCatalogo.placa_nombre = document.getElementById('drawer-placa-nombre')?.value || 'ninguna';
    comercioActivoParaCatalogo.portada_posicion = Number(document.getElementById('drawer-portada-posicion')?.value ?? 50);
    comercioActivoParaCatalogo.avatar_marco = Boolean(document.getElementById('drawer-avatar-marco')?.checked);
    comercioActivoParaCatalogo.mostrar_stock_publico = Boolean(document.getElementById('drawer-mostrar-stock')?.checked);
    const lblP = document.getElementById('lbl-drawer-portada-pos');
    if (lblP) lblP.innerText = comercioActivoParaCatalogo.portada_posicion + '%';
    AppState.guardarColaLocal();
};

// Lee un File a DataURL íntegro sin recortar ni deformar nada
function leerArchivoIntegroDataURL(file) {
    return new Promise(function(resolve, reject) {
        const reader = new FileReader();
        reader.onload = function(e) { resolve(e.target.result); };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Abre el Estudio 2D Universal a resolución completa con guía visual sugerida según el slot
window.abrirEstudioIdentidadIntegro = async function(dataUrlOrigen, campo) {
    if (!comercioActivoParaCatalogo || !dataUrlOrigen) return;

    const titulosSlot = {
        portada: 'Encuadrar PORTADA (Franja Superior)',
        logo: 'Encuadrar LOGO PERFIL (Abajo Izquierda)',
        link_pin: 'Encuadrar PIN MAPA',
        logo_nombre: 'Encuadrar NOMBRE_PNG (Abajo Derecha + Varita)'
    };

    if (window.GeokatuEstudio && typeof window.GeokatuEstudio.editarImagen === 'function') {
        const resultado = await window.GeokatuEstudio.editarImagen(dataUrlOrigen, {
            maxAncho: campo === 'portada' ? 1400 : 900,
            maxAlto: campo === 'portada' ? 900 : 900,
            calidad: 0.88,
            titulo: titulosSlot[campo] || 'Editar Identidad',
            rolSugerido: campo
        });

        if (!resultado) return;

        if (!comercioActivoParaCatalogo._blobsIdentidad) comercioActivoParaCatalogo._blobsIdentidad = {};
        comercioActivoParaCatalogo._blobsIdentidad[campo] = resultado.blob;
        comercioActivoParaCatalogo[campo] = resultado.dataUrl;
        if (campo === 'logo_nombre') {
            comercioActivoParaCatalogo.nombre_png = resultado.dataUrl;
        }

        actualizarPreviewsIdentidadUI();
        if (campo === 'link_pin' || campo === 'logo') actualizarPinDrawerLive();
        AppState.guardarColaLocal();
        emitirTono('EXITO');
        mostrarToast('Imagen de ' + campo + ' lista en memoria local (se subira al inyectar).', 'exito');
    }
};

window.procesarFotoIdentidadIndividual = async function(file, campo) {
    if (!file || !comercioActivoParaCatalogo) return;
    try {
        const dataUrlIntegra = await leerArchivoIntegroDataURL(file);
        if (!comercioActivoParaCatalogo._originalesIdentidad) comercioActivoParaCatalogo._originalesIdentidad = {};
        comercioActivoParaCatalogo._originalesIdentidad[campo] = dataUrlIntegra;
        // Guardar también como lámina maestra por si quiere sacar de esta misma foto los otros 3 slots
        comercioActivoParaCatalogo._laminaMaestraDataUrl = dataUrlIntegra;

        const abrirEstudio = document.getElementById('chk-abrir-estudio-al-subir')?.checked !== false;
        if (abrirEstudio) {
            await window.abrirEstudioIdentidadIntegro(dataUrlIntegra, campo);
        } else {
            if (!comercioActivoParaCatalogo._blobsIdentidad) comercioActivoParaCatalogo._blobsIdentidad = {};
            comercioActivoParaCatalogo._blobsIdentidad[campo] = file;
            comercioActivoParaCatalogo[campo] = dataUrlIntegra;
            actualizarPreviewsIdentidadUI();
            if (campo === 'link_pin' || campo === 'logo') actualizarPinDrawerLive();
            AppState.guardarColaLocal();
            mostrarToast('Imagen cargada en memoria local.', 'info');
        }
    } catch (e) {
        console.warn("[Identidad] Error leyendo imagen:", e);
    }
};

window.editarSlotIdentidadEnEstudio = async function(campo) {
    if (!comercioActivoParaCatalogo) {
        mostrarToast("Abre primero un comercio en el Drawer.", "error");
        return;
    }
    const orig = (comercioActivoParaCatalogo._originalesIdentidad && comercioActivoParaCatalogo._originalesIdentidad[campo])
        || comercioActivoParaCatalogo._laminaMaestraDataUrl
        || comercioActivoParaCatalogo[campo];

    if (!orig) {
        // Si aún no ha subido archivo, abre el selector de archivos de ese slot
        const mapInput = {
            logo: 'input-branding-logo',
            portada: 'input-branding-portada',
            link_pin: 'input-branding-pin',
            logo_nombre: 'input-branding-logonombre'
        };
        const inputEl = document.getElementById(mapInput[campo]);
        if (inputEl) inputEl.click();
        return;
    }
    await window.abrirEstudioIdentidadIntegro(orig, campo);
};

// Si despiece-estudio.js llama a subirFotoIdentidadStorage, lo retenemos en memoria local sin subir aún a Firebase
export async function subirFotoIdentidadStorage(blob, campo, idComercio) {
    if (comercioActivoParaCatalogo && blob) {
        if (!comercioActivoParaCatalogo._blobsIdentidad) comercioActivoParaCatalogo._blobsIdentidad = {};
        comercioActivoParaCatalogo._blobsIdentidad[campo] = blob;
        const localUrl = URL.createObjectURL(blob);
        comercioActivoParaCatalogo[campo] = localUrl;
        if (campo === 'logo_nombre') comercioActivoParaCatalogo.nombre_png = localUrl;
        actualizarPreviewsIdentidadUI();
        if (campo === 'link_pin' || campo === 'logo') actualizarPinDrawerLive();
        AppState.guardarColaLocal();
        mostrarToast('Guardado en memoria local. Se subira al pulsar INYECTAR CATALOGO.', 'exito');
        return localUrl;
    }
    return null;
}
window.subirFotoIdentidadStorage = subirFotoIdentidadStorage;

// Función interna que sube a Storage únicamente cuando se presiona "INYECTAR CATALOGO A FIRESTORE"
async function subirActivoIdentidadDefinitivo(c, campo, idSeguro, storage) {
    const valActual = c[campo] || '';
    if (valActual && valActual.indexOf('http') === 0) return valActual;

    let blobSubir = (c._blobsIdentidad && c._blobsIdentidad[campo]) ? c._blobsIdentidad[campo] : null;
    if (!blobSubir && valActual && (valActual.indexOf('data:image') === 0 || valActual.indexOf('blob:') === 0)) {
        try {
            const resp = await fetch(valActual);
            blobSubir = await resp.blob();
        } catch (eB) {}
    }

    if (blobSubir && blobSubir.size > 150) {
        const rutaStorage = 'tiendas/' + idSeguro + '/' + campo + '_' + Date.now() + '.webp';
        const storageRef = ref(storage, rutaStorage);
        const snapshot = await uploadBytes(storageRef, blobSubir, { contentType: blobSubir.type || 'image/webp' });
        const downloadURL = await getDownloadURL(snapshot.ref);
        c[campo] = downloadURL;
        if (c._blobsIdentidad) delete c._blobsIdentidad[campo];
        return downloadURL;
    }
    return '';
}
export async function subirFotoAStorageEnSegundoPlano(producto, idComercio) {
    try {
        if (!producto.archivoBlob || !(producto.archivoBlob instanceof Blob)) return;
        const storage = getStorage(db.app);
        const path = 'productos/' + idComercio + '/' + producto.codigo_barras + '_' + Date.now() + '.webp';
        const storageRef = ref(storage, path);
        const snapshot = await uploadBytes(storageRef, producto.archivoBlob, { contentType: 'image/webp' });
        const downloadURL = await getDownloadURL(snapshot.ref);
        producto.imagen = downloadURL;
        producto.subido_storage = true;
        delete producto.archivoBlob; // Purga el binario para que no se convierta en objeto vacío {} al guardar en JSON
        AppState.guardarColaLocal();
    } catch (err) {
        console.warn("[Storage Background]", err);
    }
}


window.procesarLoteImagenes = async function(archivos) {
    if (!archivos || archivos.length === 0 || !comercioActivoParaCatalogo) return;
    const listaFiles = Array.from(archivos);
    let brandingCount = 0, productCount = 0;

    for (let i = 0; i < listaFiles.length; i++) {
        const file = listaFiles[i];
        try {
            const nombreLimpio = file.name.replace(/\.[^/.]+$/, "").toLowerCase().trim();
            let campoIdentidad = null;
            if (nombreLimpio === 'logo' || nombreLimpio.indexOf('perfil') === 0) campoIdentidad = 'logo';
            else if (nombreLimpio === 'portada' || nombreLimpio.indexOf('banner') === 0) campoIdentidad = 'portada';
            else if (nombreLimpio === 'pin' || nombreLimpio.indexOf('link_pin') === 0) campoIdentidad = 'link_pin';
            else if (nombreLimpio === 'logo_nombre' || nombreLimpio === 'logonombre') campoIdentidad = 'logo_nombre';

            if (campoIdentidad) {
                const esCuadrado = campoIdentidad !== 'portada';
                const maxDim = campoIdentidad === 'portada' ? 1200 : 600;
                const blob = await GeokatuDB.AdminService.comprimirAWebP(file, maxDim, 0.8, esCuadrado);
                comercioActivoParaCatalogo[campoIdentidad] = URL.createObjectURL(blob);
                actualizarPreviewsIdentidadUI();
                subirFotoIdentidadStorage(blob, campoIdentidad, comercioActivoParaCatalogo.id);
                brandingCount++;
                continue;
            }

            const partes = file.name.replace(/\.[^/.]+$/, "").split('_');
            const codigo = partes[0] ? partes[0].trim() : String(Date.now()).slice(-8);
            const nombre = partes[1] ? partes[1].replace(/-/g, ' ').trim() : "Producto Catalogo";
            const categoria = partes[2] ? partes[2].replace(/-/g, ' ').trim() : (comercioActivoParaCatalogo.nicho || "General");

            const blobWebp = await GeokatuDB.AdminService.comprimirAWebP(file, 800, 0.75, true);
            const previewURL = URL.createObjectURL(blobWebp);

            const nuevo = {
                codigo_barras: codigo,
                nombre: nombre,
                categoria: categoria,
                precio: 0,
                stock_actual: 10,
                imagen: previewURL,
                archivoBlob: blobWebp,
                en_piso_venta: true,
                subido_storage: false,
                fecha_creacion: new Date().toISOString()
            };
            if (!comercioActivoParaCatalogo.catalogo) comercioActivoParaCatalogo.catalogo = [];
            comercioActivoParaCatalogo.catalogo.unshift(nuevo);
            productCount++;
            subirFotoAStorageEnSegundoPlano(nuevo, comercioActivoParaCatalogo.id);
        } catch (e) {}
    }

    const inputLote = document.getElementById('input-fotos-lote');
    if (inputLote) inputLote.value = "";
    AppState.guardarColaLocal();
    renderizarListaSkusDrawer();
    emitirTono('EXITO');
    mostrarToast('Lote completado: ' + brandingCount + ' activos de marca y ' + productCount + ' productos.', "exito");
};

// =========================================================================
// SINCRONIZACIÓN ATÓMICA FIRESTORE ONESHOT
// =========================================================================
window.sincronizarCatalogoComercioNube = async function() {
    if (!comercioActivoParaCatalogo) {
        mostrarToast("No hay comercio activo seleccionado.", "error");
        return;
    }

    const c = comercioActivoParaCatalogo;
    const prods = c.catalogo || [];
    const btn = document.getElementById('btn-inyectar-catalogo-nube');

    const confirmado = await solicitarConfirmacion(
        "Sincronizar Expediente",
        'Deseas asentar en Firestore el comercio "' + (c.nombre || 'Comercio') + '" con sus ' + prods.length + ' productos, ubicacion y branding?'
    );
    if (!confirmado) return;

    if (btn) {
        btn.disabled = true;
        btn.innerText = "Preparando datos...";
        btn.style.opacity = "0.7";
    }

    try {
        const idSeguro = String(c.id || ('GEO-' + Date.now().toString().slice(-4))).trim();
        c.id = idSeguro;

        // 1. Subir fotos pendientes en formato Blob a Firebase Storage
        const storage = getStorage(db.app);
        for (let i = 0; i < prods.length; i++) {

            const p = prods[i];

            // 1. Si la foto ya está subida en Firebase Storage con URL remota válida, se omite
            if (p.imagen && p.imagen.indexOf('http') === 0 && p.subido_storage === true) {
                continue;
            }

            // 2. Si es un Blob local pendiente o URL blob: temporal
            let blobParaSubir = null;
            if (p.archivoBlob && p.archivoBlob instanceof Blob) {
                blobParaSubir = p.archivoBlob;
            } else if (p.imagen && p.imagen.indexOf('blob:') === 0) {
                try {
                    const resBlob = await fetch(p.imagen);
                    blobParaSubir = await resBlob.blob();
                } catch (eBlob) {}
            }

            // 3. Solo sube si el binario es una imagen real de más de 200 bytes (bloquea basura de 9B)
            if (blobParaSubir && blobParaSubir.size > 200) {
                if (btn) {
                    btn.innerText = "Subiendo foto (" + (i + 1) + " de " + prods.length + ")...";
                }
                try {
                    const rutaStorage = 'productos/' + idSeguro + '/' + (p.codigo_barras || Date.now()) + '_' + Date.now() + '.webp';
                    const storageRef = ref(storage, rutaStorage);
                    const snapshot = await uploadBytes(storageRef, blobParaSubir, { contentType: 'image/webp' });
                    const downloadURL = await getDownloadURL(snapshot.ref);
                    p.imagen = downloadURL;
                    p.subido_storage = true;
                    delete p.archivoBlob;
                } catch (errFoto) {
                    console.warn("Fallo subiendo foto del producto " + p.nombre, errFoto);
                }
            }
        }

        // 1.B Subir activos de identidad (Logo, Portada, Pin, Nombre_PNG) en este momento exacto
        const camposIdentidad = ['logo', 'portada', 'link_pin', 'logo_nombre'];
        for (let k = 0; k < camposIdentidad.length; k++) {
            const campoId = camposIdentidad[k];
            if (c[campoId] && c[campoId].indexOf('http') !== 0) {
                if (btn) btn.innerText = "Subiendo " + campoId + " a Storage...";
                await subirActivoIdentidadDefinitivo(c, campoId, idSeguro, storage);
            }
        }
        if (c.logo_nombre && c.logo_nombre.indexOf('http') === 0) {
            c.nombre_png = c.logo_nombre;
        }

        if (btn) {
            btn.innerText = "Asentando en Firestore...";
        }

        const batch = writeBatch(db);
        const docNegocioRef = doc(db, "Directorio", idSeguro);

        const coordsRaw = c.coordenada_validada || c.coordenadas_crudo || c.plus_code || (String(c.lat || '') + ', ' + String(c.lng || ''));
        const coords = parsearCoordenadasUniversales(coordsRaw) || { lat: 4.81333, lng: -75.69611 };

        let geoHashCalculado = "";
        try {
            if (typeof geofire !== 'undefined' && geofire.geohashForLocation) {
                geoHashCalculado = geofire.geohashForLocation([coords.lat, coords.lng]);
            }
        } catch (e) {}

        const arrFonos = String(c.whatsapp || '').split('|').map(function(f) { return f.trim().replace(/\D/g, ''); }).filter(Boolean);
        const primerFono = arrFonos[0] ? (arrFonos[0].length === 10 ? '57' + arrFonos[0] : arrFonos[0]) : "";

        let etiquetasArray = [];
        if (Array.isArray(c.tags_busqueda)) etiquetasArray = c.tags_busqueda;
        else if (typeof c.tags_busqueda === 'string' && c.tags_busqueda.trim()) {
            etiquetasArray = c.tags_busqueda.split(/[,|;]/).map(function(t) { return t.replace(/^#/, '').trim(); }).filter(Boolean);
        }

        const payloadMaestro = {
            nombre: c.nombre || "Comercio Aliado",
            slogan: c.slogan || "",
            cuerpo_articulo: c.slogan || c.cuerpo_articulo || "",
            nicho: c.nicho || c.categoria || "General",
            categoria: c.nicho || c.categoria || "General",
            categoria_maestra: c.nicho || c.categoria || "General",
            tags_busqueda: etiquetasArray,
            informacion_adicional: c.informacion_adicional || "",

            verificado_maps: c.verificado_maps || "NO",
            cant_resenas: Number(c.cant_resenas) || 0,
            resena_picante: c.resena_picante || "",
            destacado_estrella: Boolean(c.destacado_estrella),

            horario: c.horario || "",
            es_24_horas: Boolean(c.es_24_horas),

            direccion: c.direccion || "",
            plus_code: c.plus_code || "",
            Coordenadas: { latitude: coords.lat, longitude: coords.lng },
            lat: coords.lat,
            lng: coords.lng,
            ubicacion: { lat: coords.lat, lng: coords.lng },
            geohash: geoHashCalculado,

            whatsapp: primerFono,
            whatsApp: primerFono,
            telefonos: arrFonos,
            pbx: String(c.pbx || '').trim(),
            correo: c.correo || c.email || "",
            email: c.correo || c.email || "",
            instagram: String(c.instagram_handle || c.instagram || '').replace(/^@/, '').trim(),
            facebook: c.facebook || "",
            web: c.sitio_web || c.web || "",
            sitio_web: c.sitio_web || c.web || "",

            pin_pack: c.pin_pack || "forma-gota|anim-salto",
            tema_popup: c.tema_popup || document.getElementById('drawer-select-tema')?.value || "carbon",
            pin_pack: c.pin_pack || "forma-gota|anim-salto",
            tema_popup: c.tema_popup || document.getElementById('drawer-select-tema')?.value || "carbon",
            avatar_posicion: c.avatar_posicion || document.getElementById('drawer-avatar-posicion')?.value || "centro",
            placa_nombre: c.placa_nombre || document.getElementById('drawer-placa-nombre')?.value || "ninguna",
            portada_posicion: c.portada_posicion !== undefined ? Number(c.portada_posicion) : Number(document.getElementById('drawer-portada-posicion')?.value ?? 50),
            avatar_marco: c.avatar_marco !== undefined ? Boolean(c.avatar_marco) : Boolean(document.getElementById('drawer-avatar-marco')?.checked !== false),
            mostrar_stock_publico: Boolean(c.mostrar_stock_publico || document.getElementById('drawer-mostrar-stock')?.checked),
            color_principal: c.color_principal || "#ff6b00",
            color_acento: c.color_acento || GRIS_METALLIC_GEOKATU,
            color_terciario: c.color_terciario || BLANCO_GEOKATU,
            paleta_distribucion: c.paleta_distribucion || [
                { color: "#ff6b00", porcentaje: 50 },
                { color: GRIS_METALLIC_GEOKATU, porcentaje: 25 },
                { color: BLANCO_GEOKATU, porcentaje: 12.5 }
            ],
            logo: (c.logo && c.logo.indexOf('http') === 0) ? c.logo : "",
            portada: (c.portada && c.portada.indexOf('http') === 0) ? c.portada : "",
            link_pin: (c.link_pin && c.link_pin.indexOf('http') === 0) ? c.link_pin : "",
            logo_nombre: (c.logo_nombre && c.logo_nombre.indexOf('http') === 0) ? c.logo_nombre : "",
            nombre_png: (c.logo_nombre && c.logo_nombre.indexOf('http') === 0) ? c.logo_nombre : "",


            reclamado: Boolean(c.reclamado),
            dueno_registrado: Boolean(c.dueno_registrado),
            owner_email: c.owner_email || c.dueno_email || "",
            estado_moderacion: "aprobado",
            premium: false,
            progreso_boveda: 100,
            tipo_modelo: "negocio",
            fecha_ingreso: c.fecha_ingreso || new Date().toISOString(),
            fecha_actualizacion: new Date().toISOString(),
            origen_cuenta: "Onboarding_OneShot_Radar"
        };

        batch.set(docNegocioRef, payloadMaestro, { merge: true });

        // 2. Inyección de subcolección de productos
        const coleccionProds = collection(db, 'Directorio/' + idSeguro + '/productos');
        prods.forEach(function(p) {
            const docRef = p.id ? doc(coleccionProds, String(p.id)) : doc(coleccionProds);
            const payloadProd = {
                nombre: p.nombre || "Sin nombre",
                codigo_barras: String(p.codigo_barras || "").trim(),
                precio: Number(p.precio) || 0,
                categoria: p.categoria || c.nicho || "General",
                stock_actual: Number(p.stock_actual) || 0,
                cuerpo_texto: p.cuerpo_texto || "",
                en_piso_venta: true,
                eliminado: false,
                fecha_actualizacion: new Date().toISOString()
            };
            if (p.imagen && p.imagen.indexOf('http') === 0) {
                payloadProd.imagen = p.imagen;
            }
            batch.set(docRef, payloadProd, { merge: true });
        });

        await batch.commit();

        c.subido = true;
        c.validado = true;
        AppState.guardarColaLocal();
        renderizarTablero();

        emitirTono('EXITO');
        if (btn) {
            btn.innerText = "Catalogo Inyectado con Exito";
            btn.style.background = "var(--verde-hoja)";
            btn.style.color = "#052e16";
        }

        mostrarToast('Expediente de "' + c.nombre + '" guardado en Firestore.', "exito", 4000);

        setTimeout(function() {
            if (btn) {
                btn.disabled = false;
                btn.innerText = "INYECTAR CATALOGO A FIRESTORE";
                btn.style.background = "";
                btn.style.color = "";
                btn.style.opacity = "1";
            }
            cerrarDrawerCatalogo();
        }, 1200);

    } catch (err) {
        if (btn) {
            btn.disabled = false;
            btn.innerText = "Error al Inyectar (Reintentar)";
            btn.style.background = "var(--rojo-fuego)";
            btn.style.opacity = "1";
        }
        mostrarToast("Fallo Firestore: " + err.message, "error", 5500);
    }
};


// =========================================================================
// GOOGLE SHEETS & APPS SCRIPT
// =========================================================================
window.configurarURLScript = function() {
    const actual = localStorage.getItem('geokatu_apps_script_url') || '';
    const u = prompt("URL Web App de Google Apps Script (/exec):", actual);
    if (!u) return null;
    const limpia = u.trim();
    localStorage.setItem('geokatu_apps_script_url', limpia);
    mostrarToast("URL de Apps Script almacenada.", "exito");
    return limpia;
};

window.sincronizarConAppsScript = async function() {
    let u = localStorage.getItem('geokatu_apps_script_url');
    if (!u) {
        u = window.configurarURLScript();
        if (!u) return;
    }

    try {
        const res = await fetch(u + (u.indexOf('?') !== -1 ? '&' : '?') + 't=' + Date.now());
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("Estructura de respuesta no valida.");

        let nuevos = 0;

            data.forEach(function(item) {
                const idx = listaComercios.findIndex(function(c) { return c.id === item.id; });

                if (idx === -1) {
                    const yaAuditado = (item.estado === 'Auditado' || item.estado === 'SUBIDO_FIREBASE' || item.estado_flujo === 'Cerrado');
                    const nuevoItem = {
                        ...item,
                        capturado: yaAuditado,
                        validado: (item.estado === 'Auditado' || item.estado === 'SUBIDO_FIREBASE'),
                        subido: (item.estado === 'SUBIDO_FIREBASE'),
                        catalogo: []
                    };

                    listaComercios.push(nuevoItem);

                    if (!nuevoItem.capturado && !nuevoItem.archivado) {
                        lanzarEntidadVoladora(nuevoItem, nuevos);
                    }
                    nuevos++;
                } else {
                    listaComercios[idx].nombre = item.nombre;
                    listaComercios[idx].direccion = item.direccion;
                    listaComercios[idx].whatsapp = item.whatsapp;
                    listaComercios[idx].horario = item.horario;
                    listaComercios[idx].pbx = item.pbx;
                    listaComercios[idx].correo = item.correo;
                    listaComercios[idx].coordenadas_crudo = item.coordenadas_crudo || item.coordenada_validada;
                }
            });

            AppState.guardarColaLocal();
            actualizarDatalistNichos();
            actualizarHUD();
            renderizarTablero();
            emitirTono('EXITO');
            mostrarToast('Sincronización: ' + nuevos + ' comercios lanzados al enjambre.', "exito");

    } catch (e) {
        mostrarToast("Error conectando con Google Sheets: " + e.message, "error");
    }
};

window.enviarComercioASheets = async function(index) {
    const c = listaComercios[index];
    const u = localStorage.getItem('geokatu_apps_script_url');
    if (!u) {
        mostrarToast("Configura primero la URL de Apps Script.", "info");
        return;
    }

    try {
        await fetch(u, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ accion: "anexar_comercio_nuevo", comercio: c })
        });
        emitirTono('EXITO');
        mostrarToast('Comercio "' + c.nombre + '" enviado a Sheets.', "exito");
    } catch (e) {
        mostrarToast("Fallo enviando registro a Sheets.", "error");
    }
};

// =========================================================================
// BÓVEDA HISTORIAL Y ASIGNACIÓN DE DUEÑOS (CLAIM)
// =========================================================================
let claimComercioIndex = null;

window.abrirModalHistorial = function() {
    const modal = document.getElementById('modal-historial');
    if (modal) modal.style.display = 'flex';
    renderizarListaHistorial();
};

window.cerrarModalHistorial = function() {
    const modal = document.getElementById('modal-historial');
    if (modal) modal.style.display = 'none';
};

export function actualizarConteoHistorial() {
    const total = listaComercios.filter(function(c) {
        return c.estado_flujo === 'Seguimiento' || c.estado_flujo === 'Cerrado';
    }).length;
    const b = document.getElementById('badge-historial-conteo');
    if (b) b.innerText = total;
}
window.actualizarConteoHistorial = actualizarConteoHistorial;

window.renderizarListaHistorial = function() {
    const cont = document.getElementById('contenedor-items-historial');
    if (!cont) return;
    cont.innerHTML = '';

    const busqueda = (document.getElementById('buscador-historial')?.value || '').toLowerCase().trim();
    const filtroCat = document.getElementById('filtro-categoria-historial')?.value || 'todos';

    const filtrados = listaComercios.filter(function(c) {
        if (filtroCat === 'Seguimiento' && c.estado_flujo !== 'Seguimiento') return false;
        if (filtroCat === 'Cerrado' && c.estado_flujo !== 'Cerrado') return false;
        if (filtroCat === 'disponibles' && c.reclamado === true) return false;
        if (filtroCat === 'tomados' && c.reclamado !== true) return false;

        if (busqueda) {
            const texto = (c.id + ' ' + c.nombre + ' ' + (c.direccion || '')).toLowerCase();
            if (texto.indexOf(busqueda) === -1) return false;
        }
        return true;
    });

    if (filtrados.length === 0) {
        cont.innerHTML = '<p style="color:#64748b; text-align:center; padding:24px; font-size:11px;">Sin registros coincidentes.</p>';
        return;
    }

    filtrados.forEach(function(c) {
        const idxReal = listaComercios.findIndex(function(item) { return item.id === c.id; });
        const esTomado = (c.reclamado === true);
        const card = document.createElement('div');
        card.style.cssText = "background:rgba(0,0,0,0.4); border:1px solid var(--glass-border); border-radius:8px; padding:10px; display:flex; justify-content:space-between; align-items:center; gap:8px;";
        card.innerHTML = 
            '<div style="flex:1; min-width:0;">' +
                '<div style="display:flex; align-items:center; gap:6px;">' +
                    '<strong style="font-size:12px; color:#fff;">' + c.nombre + '</strong>' +
                    '<span style="font-size:9px; font-family:monospace; color:var(--naranja);">' + c.id + '</span>' +
                '</div>' +
                '<div style="font-size:10px; color:#94a3b8; margin-top:2px;">' + (c.direccion || 'Sin direccion fisica') + '</div>' +
            '</div>' +
            '<div style="display:flex; align-items:center; gap:6px;">' +
                '<label class="switch-tomado" style="margin-right:6px;" title="Alternar estado Tomado / Libre">' +
                    '<input type="checkbox" ' + (esTomado ? 'checked' : '') + ' onchange="toggleNegocioTomado(' + idxReal + ', this.checked)">' +
                    '<span class="slider-tomado"></span>' +
                '</label>' +
                '<button type="button" class="btn-submit" style="padding:4px 8px; font-size:10px; background:rgba(255,255,255,0.08);" onclick="reabrirComercioEnRadar(' + idxReal + ')">Reabrir</button>' +
                '<button type="button" class="btn-submit btn-oneshot" style="padding:4px 8px; font-size:10px;" onclick="abrirModalDefinirDueno(' + idxReal + ')">Asignar Dueno</button>' +
            '</div>';
        if (!esTomado && c.id && superadminAutorizado) {
            const catalogo = document.createElement('a');
            catalogo.href = '/negocio?id=' + encodeURIComponent(c.id) + '&editor=onboarding';
            catalogo.textContent = 'Editar catálogo'; catalogo.className = 'btn-submit';
            catalogo.style.cssText = 'padding:8px;font-size:11px;text-align:center';
            card.lastElementChild.append(catalogo);
        }
        cont.appendChild(card);
    });
};

window.toggleNegocioTomado = async function(index, tomado) {
    const c = listaComercios[index];
    c.reclamado = tomado;
    AppState.guardarColaLocal();
    renderizarListaHistorial();
    try {
        await GeokatuDB.AdminService.conmutarEstadoReclamado(c.id, tomado);
    } catch (e) {}
    mostrarToast('Estado actualizado: ' + (tomado ? 'TOMADO' : 'LIBRE'), 'info');
};


window.reabrirComercioEnRadar = function(index) {
    listaComercios[index].archivado = false;
    listaComercios[index].capturado = true;
    AppState.guardarColaLocal();
    cerrarModalHistorial();
    renderizarTablero();
    mostrarToast("Comercio reactivado en el Radar.", "info");
};

window.abrirModalDefinirDueno = function(index) {
    claimComercioIndex = index;
    const c = listaComercios[index];
    const modal = document.getElementById('modal-definir-dueno');
    const txtNom = document.getElementById('txt-claim-nombre');
    const inputEmail = document.getElementById('claim-email');
    if (txtNom) txtNom.innerText = c.nombre;
    if (inputEmail) inputEmail.value = c.owner_email || '';
    regenerarPasswordClaim();
    if (modal) modal.style.display = 'flex';
};

window.cerrarModalDefinirDueno = function() {
    const modal = document.getElementById('modal-definir-dueno');
    if (modal) modal.style.display = 'none';
    claimComercioIndex = null;
};

window.regenerarPasswordClaim = function() {
    const pass = 'GK-' + Math.random().toString(36).substring(2, 8).toUpperCase() + '!';
    const inputPass = document.getElementById('claim-pass');
    if (inputPass) inputPass.value = pass;
};

window.confirmarEntregaDueno = async function() {
    if (claimComercioIndex === null) return;
    const c = listaComercios[claimComercioIndex];
    const emailInput = document.getElementById('claim-email');
    const passInput = document.getElementById('claim-pass');
    const email = emailInput ? emailInput.value.trim().toLowerCase() : '';
    const passTemporal = passInput ? passInput.value.trim() : '';

    if (!email || !email.includes('@')) {
        mostrarToast("Ingresa un correo electrónico válido.", "error");
        return;
    }

    const btn = document.getElementById('btn-confirmar-claim');
    if (btn) { btn.disabled = true; btn.innerText = "Transfiriendo..."; }

    try {
        c.reclamado = true;
        c.dueno_registrado = false;
        c.owner_email = email;
        c.password_temporal = passTemporal;
        AppState.guardarColaLocal();

    // Si el comercio ya está en Firestore, impactar el documento raíz sin exponer contraseñas
        if (c.subido === true || c.id) {
            const idDocStr = String(c.id);
            const docRef = doc(db, "Directorio", idDocStr);
            
            // 1. Datos públicos / administrativos en el documento raíz
            await setDoc(docRef, {
                reclamado: true,
                dueno_registrado: false,
                owner_email: email,
                fecha_entrega_dueno: new Date().toISOString()
            }, { merge: true });

            // 2. Credencial aislada en subcolección protegida (invisible para scrapers y consultas públicas)
            const bovedaRef = doc(db, "Directorio/" + idDocStr + "/Boveda_Seguridad", "Credenciales");
            await setDoc(bovedaRef, {
                password_temporal: passTemporal,
                owner_email: email,
                fecha_generacion: new Date().toISOString()
            }, { merge: true });
        }


        emitirTono('EXITO');
        renderizarTablero();
        mostrarToast('Titularidad asignada a ' + email, "exito", 3000);

        // Envío directo por WhatsApp
        const arrFonos = String(c.whatsapp || '').split('|').map(function(f) { return f.trim().replace(/\D/g, ''); }).filter(Boolean);
        const fono = arrFonos[0] || '';
        const fonoCompleto = fono.length === 10 ? ('57' + fono) : fono;
        const urlAcceso = window.location.origin + '/oficina';

        const mensajeWA = encodeURIComponent(
            "Hola *" + (c.nombre || "Comercio") + "*! Te entregamos el acceso a tu consola en GEOKATU:\n\n" +
            "1. Ingresa a: " + urlAcceso + "\n" +
            "2. Toca 'Continuar con Google' usando tu correo: *" + email + "*\n\n" +
            "(Clave de respaldo opcional: " + passTemporal + ")\n" +
            "Tu catálogo y ubicación ya están listos en el radar."
        );

        if (fonoCompleto.length >= 7) {
            if (confirm("¿Deseas enviar las credenciales por WhatsApp a " + c.nombre + "?")) {
                window.open("https://api.whatsapp.com/send?phone=" + fonoCompleto + "&text=" + mensajeWA, '_blank');
            }
        }

        cerrarModalDefinirDueno();
        renderizarListaHistorial();
    } catch (err) {
        mostrarToast("Error asignando titularidad: " + err.message, "error", 4500);
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = "DEFINIR DUEÑO"; }
    }
};



window.abrirWhatsAppDirecto = function(numero, nombreComercio) {
    let limpio = String(numero || '').replace(/\D/g, '');
    if (!limpio) return;
    if (limpio.length === 10) limpio = '57' + limpio;
    const msg = encodeURIComponent('Hola ' + nombreComercio + '! Te contacto desde GEOKATU.');
    window.open('https://api.whatsapp.com/send?phone=' + limpio + '&text=' + msg, '_blank');
};

window.abrirWA = function(fono, nom) {
    window.abrirWhatsAppDirecto(fono, nom);
};
// =========================================================================
// COMPILADOR DE MATRIZ OFFLINE (REPLICA DE catalogo_matriz.json)
// =========================================================================
window.exportarDirectorioMatrizJSON = function() {
    const aprobados = listaComercios.filter(function(c) {
        return Boolean(c.validado) || c.estado_flujo === 'Cerrado' || c.subido === true;
    });

    if (aprobados.length === 0) {
        mostrarToast("No hay comercios auditados para exportar.", "info");
        return;
    }

    const payloadCompacto = aprobados.map(function(c) {
        const coords = parsearCoordenadasUniversales(c.coordenada_validada || c.coordenadas_crudo || '');
        const lat = coords ? coords.lat : 4.81333;
        const lng = coords ? coords.lng : -75.69611;

        // Empaquetado binario de flags para ahorrar bytes
        let flags = 0;
        if (c.whatsapp && String(c.whatsapp).trim().length > 5) flags |= 1;  // Bit 0: WhatsApp
        if (c.pbx && (!c.whatsapp || String(c.whatsapp).trim() === '')) flags |= 2; // Bit 1: Solo PBX
        if (Boolean(c.es_24_horas)) flags |= 4;                             // Bit 2: 24 Horas
        if (c.verificado_maps === 'SI') flags |= 8;                         // Bit 3: Verificado Maps
        if (Boolean(c.destacado_estrella)) flags |= 16;                     // Bit 4: Estrella

        const colores = [
            c.color_principal || "#ff6b00",
            c.color_acento || "#8a909d"
        ];

        return {
            id: String(c.id),
            n: String(c.nombre || "Comercio"),
            s: String(c.slogan || "").substring(0, 70),
            c: String(c.nicho || c.categoria || "General"),
            g: [lat, lng],
            p: String(c.pin_pack || "forma-gota|anim-salto"),
            b: colores,
            l: String(c.logo || ""),
            f: flags
        };
    });

    const blob = new Blob([JSON.stringify(payloadCompacto)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "directorio_matriz.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    mostrarToast("Matriz exportada (" + payloadCompacto.length + " comercios).", "exito");
};




