/**

* ============================================================================

* GEOKATU | OFICINA DE CONTROL Y BÓVEDA COMERCIAL (oficina.js)

* Motor Lógico Modular Unificado

* ============================================================================

*/



import GeokatuDB, { CatalogoMatrizService } from './core-db.js';
import { BillingGuard } from './billing-guard.js'; 
import { AuthGate } from './auth-gate.js'; 
import './estudio-imagen-universal.js';
import './geokatu-tour.js';  
import {

getFirestore,

collection,

doc,

getDocs,

setDoc,

updateDoc,

query,

where,

orderBy,

limit,

onSnapshot

} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

import { getAuth } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';



// Instancias nativas de soporte

const db = getFirestore();

const auth = getAuth();



// Protocolo vectorial PMTiles

const protocol = new pmtiles.Protocol();

maplibregl.addProtocol("pmtiles", protocol.tile);



// Exposición global

window.GeokatuDB = GeokatuDB;

window.BillingGuard = BillingGuard;

window.CatalogoMatrizService = CatalogoMatrizService;

// Algoritmo Geohash nativo (Base 32 canónica, 100% offline, cero dependencias)
window.generarGeohash = function(lat, lng, precision) {
    if (precision === undefined) precision = 9;
    var BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
    var latRango = [-90.0, 90.0];
    var lngRango = [-180.0, 180.0];
    var hash = "";
    var esPar = true;
    var bit = 0;
    var caracterIdx = 0;

    while (hash.length < precision) {
        if (esPar) {
            var medioLng = (lngRango[0] + lngRango[1]) / 2;
            if (lng >= medioLng) {
                caracterIdx |= (1 << (4 - bit));
                lngRango[0] = medioLng;
            } else {
                lngRango[1] = medioLng;
            }
        } else {
            var medioLat = (latRango[0] + latRango[1]) / 2;
            if (lat >= medioLat) {
                caracterIdx |= (1 << (4 - bit));
                latRango[0] = medioLat;
            } else {
                latRango[1] = medioLat;
            }
        }

        esPar = !esPar;
        if (bit < 4) {
            bit++;
        } else {
            hash += BASE32[caracterIdx];
            bit = 0;
            caracterIdx = 0;
        }
    }
    return hash;
};


// Ruteador dinámico según país del comercio
window.abrirTerminalPOS = async function() {
    var idTenant = window.idNegocioLogueado || localStorage.getItem('geokatu_active_uid');
    if (!idTenant) {
        window.open('/pos', '_blank');
        return;
    }
    var destino = await GeokatuDB.PosService.obtenerDestinoPOS(idTenant);
    var cleanDestino = String(destino).replace(/\.html/g, '');
    window.open(cleanDestino.startsWith('/') ? cleanDestino : ('/' + cleanDestino), '_blank');
};


// Detección automática por coordenadas (Frontera y territorio)
window.detectarPaisPorCoordenadas = function(lat, lng) {
    var esVenezuela = (lng > -73.38 && lng < -59.80) && (lat > 0.65 && lat < 12.50) && !(lng < -72.45 && lat < 8.0);
    return esVenezuela ? 'VEN' : 'COL';
};


// ============================================================================

// ESTADO GLOBAL REACTIVO EN MEMORIA

// ============================================================================

window.idNegocioLogueado = localStorage.getItem('geokatu_active_uid') || null;

window.datosTienda = {};

window.listaProductosGlobal = [];

window.ultimoDocCatalogo = null;

window.categoriaFiltroActual = "";

window.terminoBusquedaActual = "";

window.categoriasDisponibles = new Set();

window.timeoutsTarjetas = {};

window.miniMapaPerfil = null;

window.pinMiniMapaPerfil = null;

window.popupOnboarding = null;

window.modoEdicionActivo = false;
window.slotColorActual = 1;
window.estadoColorCustom = { h: 0, s: 100, l: 50, l_base: 50 };
window.desuscripcionAlertas = null;
window.imagenCargadaTemporalModal = null;
window.nombrePngTemporalPaso1 = null;
window.nombrePngTemporalModal = null;
window.timeoutTooltipNombre = null;
window.trackCamaraActiva = null;
window.torchEncendido = false;

window.mostrarTooltipNombrePng = function(origen, btnElement) {
    if (navigator.vibrate) navigator.vibrate(25);
    var tooltipId = (origen === 'fase-1') ? 'tooltip-fase-1-nombre' : 'tooltip-modal-nombre';
    var el = document.getElementById(tooltipId);
    if (!el) return;

    if (window.timeoutTooltipNombre) clearTimeout(window.timeoutTooltipNombre);

    el.innerHTML = 
        '<div style="display: flex; gap: 8px; align-items: flex-start;">' +
            '<span style="color: var(--naranja); font-size: 15px; line-height: 1;">ℹ️</span>' +
            '<div style="flex: 1;">' +
                '<strong style="color: #ffffff; display: block; margin-bottom: 2px;">Logotipo con Fondo Transparente</strong>' +
                '<p style="margin: 0; color: #b5b5be; line-height: 1.35;">Sube tu marca recortada (PNG/WebP sin fondo). Se exhibir\u00E1 en la cabecera, minimapa y tarjetas de la plataforma en lugar de texto b\u00E1sico.</p>' +
            '</div>' +
        '</div>';

    el.style.display = 'block';
    el.classList.remove('fade-out');
    el.classList.add('activo');

    window.timeoutTooltipNombre = setTimeout(function() {
        el.classList.add('fade-out');
        setTimeout(function() {
            el.style.display = 'none';
            el.classList.remove('activo');
            el.classList.remove('fade-out');
        }, 350);
    }, 4500);
};
window.comprimirImagen = function(file, maxWidth, quality, forceSquare) {
    if (maxWidth === undefined) maxWidth = 800;
    if (quality === undefined) quality = 0.75;
    if (forceSquare === undefined) forceSquare = false;
    return new Promise(function(resolve, reject) {
        if (!file) return resolve(null);
        var reader = new FileReader();
        reader.onload = function(event) {
            var img = new Image();
            img.onload = function() {
                var width = img.width;
                var height = img.height;
                var sx = 0, sy = 0, sWidth = width, sHeight = height;
                if (forceSquare) {
                    var size = Math.min(width, height);
                    sx = (width - size) / 2;
                    sy = (height - size) / 2;
                    sWidth = size;
                    sHeight = size;
                    width = size;
                    height = size;
                }
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
                var canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                var ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, width, height);
                ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, width, height);
                canvas.toBlob(function(blob) {
                    resolve(blob || file);
                }, 'image/webp', quality);
            };
            img.onerror = function() { reject(new Error("Archivo de imagen no valido")); };
            img.src = event.target.result;
        };
        reader.onerror = function() { reject(new Error("Error leyendo el archivo")); };
        reader.readAsDataURL(file);
    });
};

window.comprimirImagenTransparenteWebP = function(file, maxAncho, maxAlto) {
    return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function(e) {
            var img = new Image();
            img.onload = function() {
                var w = img.width;
                var h = img.height;
                if (w > maxAncho || h > maxAlto) {
                    var ratio = Math.min(maxAncho / w, maxAlto / h);
                    w = Math.round(w * ratio);
                    h = Math.round(h * ratio);
                }
                var canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                var ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                canvas.toBlob(function(blob) {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error("Fallo al exportar WebP con transparencia."));
                    }
                }, 'image/webp', 0.88);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

window.mostrarTooltipEtiquetasRadar = function(btnElement) {
    if (navigator.vibrate) navigator.vibrate(25);
    var el = document.getElementById('tooltip-etiquetas-radar');
    if (!el) return;

    if (window.timeoutTooltipNombre) clearTimeout(window.timeoutTooltipNombre);

    el.innerHTML = 
        '<div style="display: flex; gap: 8px; align-items: flex-start;">' +
            '<span style="color: var(--naranja); font-size: 15px; line-height: 1;">🏷️</span>' +
            '<div style="flex: 1;">' +
                '<strong style="color: #ffffff; display: block; margin-bottom: 2px;">Etiquetas de Búsqueda</strong>' +
                '<p style="margin: 0; color: #b5b5be; line-height: 1.35;">Escribe tus productos estrella, platos o servicios separados por guion o coma. Los ciudadanos te encontrarán en el radar aunque no conozcan el nombre de tu comercio.</p>' +
            '</div>' +
        '</div>';

    el.style.display = 'block';
    el.classList.remove('fade-out');
    el.classList.add('activo');

    window.timeoutTooltipNombre = setTimeout(function() {
        el.classList.add('fade-out');
        setTimeout(function() {
            el.style.display = 'none';
            el.classList.remove('activo');
            el.classList.remove('fade-out');
        }, 350);
    }, 4500);
};

window.blobNombrePngEditadoFase1 = null;
window.blobNombrePngEditadoModal = null;

// Recorta automaticamente el aire transparente sobrante alrededor del logo tipografico
window.recortarAireTransparentePng = function(dataUrl) {
    return new Promise(function(resolve) {
        var img = new Image();
        img.onload = function() {
            var c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            var ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);
            var imgData = ctx.getImageData(0, 0, c.width, c.height);
            var d = imgData.data;
            var top = c.height, left = c.width, right = 0, bottom = 0;
            var hallado = false;
            for (var y = 0; y < c.height; y++) {
                for (var x = 0; x < c.width; x++) {
                    var alpha = d[(y * c.width + x) * 4 + 3];
                    if (alpha > 15) {
                        if (x < left) left = x;
                        if (x > right) right = x;
                        if (y < top) top = y;
                        if (y > bottom) bottom = y;
                        hallado = true;
                    }
                }
            }
            if (!hallado || right <= left || bottom <= top) {
                return resolve({ dataUrl: dataUrl, blob: window.dataUrlABlob(dataUrl), ratio: img.width / Math.max(1, img.height) });
            }
            var trimW = right - left + 1;
            var trimH = bottom - top + 1;
            var out = document.createElement('canvas');
            out.width = trimW;
            out.height = trimH;
            out.getContext('2d').drawImage(c, left, top, trimW, trimH, 0, 0, trimW, trimH);
            var nuevoDataUrl = out.toDataURL('image/webp', 0.92);
            out.toBlob(function(b) {
                resolve({ dataUrl: nuevoDataUrl, blob: b || window.dataUrlABlob(nuevoDataUrl), ratio: trimW / Math.max(1, trimH) });
            }, 'image/webp', 0.92);
        };
        img.onerror = function() {
            resolve({ dataUrl: dataUrl, blob: window.dataUrlABlob(dataUrl), ratio: 1 });
        };
        img.src = dataUrl;
    });
};

window.CATALOGO_CUARZOS_GEOKATU = [
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

window.obtenerEstiloCuarzo = function(temaRaw) {
    var t = String(temaRaw || 'carbon').trim();
    if (t.indexOf('custom:') === 0) {
        var hex = t.replace('custom:', '').trim() || '#ff6b00';
        var clean = hex.replace('#', '');
        var r = parseInt(clean.substring(0, 2), 16) || 255;
        var g = parseInt(clean.substring(2, 4), 16) || 107;
        var b = parseInt(clean.substring(4, 6), 16) || 0;
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
    var encontrado = window.CATALOGO_CUARZOS_GEOKATU.find(function(x) { return x.id === t; });
    return encontrado || window.CATALOGO_CUARZOS_GEOKATU[0];
};

window.sincronizandoScrollCuarzos = false;
window.vincularScrollSincronizadoCuarzos = function(idArriba, idAbajo) {
    var elTop = document.getElementById(idArriba);
    var elBot = document.getElementById(idAbajo);
    if (!elTop || !elBot) return;
    elTop.onscroll = function() {
        if (window.sincronizandoScrollCuarzos) return;
        window.sincronizandoScrollCuarzos = true;
        var maxTop = Math.max(1, elTop.scrollWidth - elTop.clientWidth);
        var maxBot = Math.max(0, elBot.scrollWidth - elBot.clientWidth);
        elBot.scrollLeft = (elTop.scrollLeft / maxTop) * maxBot;
        setTimeout(function() { window.sincronizandoScrollCuarzos = false; }, 25);
    };
    elBot.onscroll = function() {
        if (window.sincronizandoScrollCuarzos) return;
        window.sincronizandoScrollCuarzos = true;
        var maxBot = Math.max(1, elBot.scrollWidth - elBot.clientWidth);
        var maxTop = Math.max(0, elTop.scrollWidth - elTop.clientWidth);
        elTop.scrollLeft = (elBot.scrollLeft / maxBot) * maxTop;
        setTimeout(function() { window.sincronizandoScrollCuarzos = false; }, 25);
    };
};

window.renderizarCarruselesCuarzo = function() {
    var configs = [
        { trackId: 'carrusel-temas-onboarding', inputId: 'select-tema-onboarding', esModal: false, simTrackId: 'sim-track-fase1' },
        { trackId: 'carrusel-temas-modal', inputId: 'edit-select-tema', esModal: true, simTrackId: 'sim-track-modal' }
    ];
    configs.forEach(function(cfg) {
        var track = document.getElementById(cfg.trackId);
        var input = document.getElementById(cfg.inputId);
        if (!track) return;
        var valorActual = (input && input.value) ? input.value : (window.datosTienda.tema_popup || 'carbon');
        var esCustomActivo = valorActual.indexOf('custom:') === 0;
        var colorCustom = esCustomActivo ? valorActual.replace('custom:', '') : '#00f5d4';

        var html = '';
        window.CATALOGO_CUARZOS_GEOKATU.forEach(function(c) {
            var activo = (valorActual === c.id) ? ' activo' : '';
            var fnCall = cfg.esModal
                ? ('window.seleccionarTemaPopupModal(\'' + c.id + '\')')
                : ('window.seleccionarTemaPopupOnboarding(\'' + c.id + '\')');
            html +=
                '<button type="button" class="chip-cuarzo-item' + activo + '" data-tema="' + c.id + '" onclick="' + fnCall + '" style="background:' + c.bg + '; border-color:' + c.border + '; color:' + c.text + ';">' +
                    '<span style="width:10px; height:10px; border-radius:50%; background:' + c.dot + '; border:1px solid rgba(255,255,255,0.5); flex-shrink:0;"></span>' +
                    '<span>' + c.nombre + '</span>' +
                '</button>';
        });
        var fnCustom = cfg.esModal
            ? 'window.abrirRuedaParaCuarzoPersonalizado(\'modal\')'
            : 'window.abrirRuedaParaCuarzoPersonalizado(\'onboarding\')';
        html +=
            '<button type="button" class="chip-cuarzo-item' + (esCustomActivo ? ' activo' : '') + '" data-tema="custom" onclick="' + fnCustom + '" style="background:linear-gradient(145deg, rgba(255,107,0,0.25), rgba(0,245,212,0.25)); border-color:rgba(0,245,212,0.5); color:#ffffff;">' +
                '<span style="width:10px; height:10px; border-radius:50%; background:' + colorCustom + '; border:1px solid #fff;"></span>' +
                '<span>🎨 Personalizado</span>' +
            '</button>';
        track.innerHTML = html;
        window.vincularScrollSincronizadoCuarzos(cfg.trackId, cfg.simTrackId);
    });
};

window.renderizarSimuladorNombrePng = function(dataUrl, ratio, contenedorId) {
    var box = document.getElementById(contenedorId);
    if (!box) return;
    if (!dataUrl) {
        box.style.display = 'none';
        return;
    }
    var esModal = (contenedorId === 'modal-simulador-nombre-png');
    var simTrackId = esModal ? 'sim-track-modal' : 'sim-track-fase1';
    var topTrackId = esModal ? 'carrusel-temas-modal' : 'carrusel-temas-onboarding';
    var inputId = esModal ? 'edit-select-tema' : 'select-tema-onboarding';
    var temaActivo = document.getElementById(inputId) ? document.getElementById(inputId).value : (window.datosTienda.tema_popup || 'carbon');

    var listaSimular = window.CATALOGO_CUARZOS_GEOKATU.slice();
    if (temaActivo.indexOf('custom:') === 0) {
        listaSimular.push(window.obtenerEstiloCuarzo(temaActivo));
    }

    var tarjetasHtml = listaSimular.map(function(c) {
        var seleccionado = (temaActivo === c.id);
        var filtroHalo = c.claro
            ? 'filter:drop-shadow(0 0 1px rgba(0,0,0,0.45));'
            : 'filter:drop-shadow(0 0 1.5px rgba(255,255,255,0.85)) drop-shadow(0 2px 4px rgba(0,0,0,0.9));';
        var fnSelect = esModal
            ? ('window.seleccionarTemaPopupModal(\'' + c.id + '\')')
            : ('window.seleccionarTemaPopupOnboarding(\'' + c.id + '\')');
        var bordeSel = seleccionado ? '2px solid #ff6b00' : ('1px solid ' + c.border);
        var sombraSel = seleccionado ? 'box-shadow: 0 0 14px rgba(255,107,0,0.45);' : '';
        return '<div data-sim-tema="' + c.id + '" onclick="' + fnSelect + '" style="flex:0 0 148px; scroll-snap-align:center; background:' + c.bg + '; border:' + bordeSel + '; ' + sombraSel + ' border-radius:12px; padding:10px 8px; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:62px; cursor:pointer; transition:all 0.2s;">' +
            '<span style="font-size:8.5px; color:' + (c.claro ? '#334155' : '#cbd5e1') + '; font-weight:800; text-transform:uppercase; margin-bottom:5px;">' + c.nombre + '</span>' +
            '<img src="' + dataUrl + '" style="max-height:32px; max-width:132px; object-fit:contain; ' + filtroHalo + '">' +
        '</div>';
    }).join('');

    var avisoProporcion = (ratio < 1.6)
        ? '<div style="color:#ffaa00; font-size:9.5px; margin-bottom:6px; line-height:1.3;">⚠️ Imagen casi cuadrada. Para mayor tamaño, usa solo las letras horizontales sin fondo.</div>'
        : '<div style="color:#00ff64; font-size:9.5px; margin-bottom:6px;">✓ Toca o desliza cualquier cuarzo para elegir el fondo de tu tarjeta y catálogo</div>';

    box.style.display = 'block';
    box.innerHTML =
        '<div style="background:rgba(0,0,0,0.55); border:1px dashed rgba(255,107,0,0.45); border-radius:12px; padding:10px; text-align:center;">' +
            '<span style="font-size:9.5px; font-weight:900; color:var(--naranja); text-transform:uppercase; letter-spacing:0.6px; display:block; margin-bottom:4px;">Simulador 1:1 en Cuarzos Traslúcidos (Desliza ➔)</span>' +
            avisoProporcion +
            '<div id="' + simTrackId + '" class="carrusel-cuarzos-track">' +
                tarjetasHtml +
            '</div>' +
        '</div>';

    window.vincularScrollSincronizadoCuarzos(topTrackId, simTrackId);
};


window.cargarPreviewNombrePng = async function(input, contexto) {
    if (!input.files || !input.files[0]) return;
    var f = input.files[0];
    var editada = await window.GeokatuEstudio.editarImagen(f, {
        maxAncho: 600,
        maxAlto: 180,
        calidad: 0.92,
        titulo: 'Editar Logo Tipográfico (Sin Fondo)'
    });
    if (!editada) { input.value = ''; return; }
    var optimizada = await window.recortarAireTransparentePng(editada.dataUrl);
    if (contexto === 'fase1') {
        window.nombrePngTemporalPaso1 = optimizada.dataUrl;
        window.blobNombrePngEditadoFase1 = optimizada.blob;
        var img1 = document.getElementById('fase1-img-nombre-preview');
        var ph1 = document.getElementById('fase1-placeholder-nombre');
        if (img1) { img1.src = optimizada.dataUrl; img1.style.display = 'block'; }
        if (ph1) ph1.style.display = 'none';
        window.renderizarSimuladorNombrePng(optimizada.dataUrl, optimizada.ratio, 'fase1-simulador-nombre-png');
    } else {
        window.nombrePngTemporalModal = optimizada.dataUrl;
        window.blobNombrePngEditadoModal = optimizada.blob;
        var imgM = document.getElementById('modal-img-nombre-preview');
        var phM = document.getElementById('modal-placeholder-nombre');
        if (imgM) { imgM.src = optimizada.dataUrl; imgM.style.display = 'block'; }
        if (phM) phM.style.display = 'none';
        window.renderizarSimuladorNombrePng(optimizada.dataUrl, optimizada.ratio, 'modal-simulador-nombre-png');
    }
};


window.subirImagenDirecta = async function(tipo, input) {
    if (!input.files || !input.files[0] || !window.idNegocioLogueado) return;
    var file = input.files[0];
    try {
        var titulos = {
            nombre_png: 'Editar Logo Tipográfico',
            logo: 'Editar Logo de Perfil',
            portada: 'Editar Foto de Portada'
        };
        var editada = await window.GeokatuEstudio.editarImagen(file, {
            maxAncho: tipo === 'portada' ? 1200 : 600,
            maxAlto: tipo === 'nombre_png' ? 150 : 800,
            calidad: 0.86,
            titulo: titulos[tipo] || 'Editar Imagen'
        });
        if (!editada) { input.value = ''; return; }

        var path = 'tiendas/' + window.idNegocioLogueado + '/' + tipo + '_' + Date.now() + '.webp';
        var res = await GeokatuDB.AdminService.subirArchivo(path, editada.blob);
        var url = (typeof res === 'string') ? res : (res && res.data ? res.data : '');
        if (url) {
            var payload = {};
            payload[tipo] = url;
            if (tipo === 'nombre_png') payload.logo_nombre = url;
            await GeokatuDB.AdminService.actualizarNegocio(window.idNegocioLogueado, payload);
            Object.assign(window.datosTienda, payload);
            if (tipo === 'nombre_png') {
                var elPng = document.getElementById('ui-nombre-png');
                var elNom = document.getElementById('ui-nombre');
                if (elPng) { elPng.src = url; elPng.style.display = 'block'; }
                if (elNom) elNom.style.display = 'none';
            } else if (tipo === 'logo') {
                var elLogo = document.getElementById('ui-logo');
                if (elLogo) { elLogo.src = url; elLogo.style.display = 'block'; }
            }
            if (window.miniMapaPerfil) {
                var coords = window.datosTienda.Coordenadas || { latitude: 4.8133, longitude: -75.6961 };
                window.inicializarMiniMapaPerfil(coords.latitude || 4.8133, coords.longitude || -75.6961);
            }
            alert("✅ Imagen de " + tipo + " actualizada correctamente.");
        }
    } catch (err) {
        console.error("Error subida directa " + tipo + ":", err);
    }
};



// ============================================================================
// BLOQUE 1: SESIÓN Y CONTROL DE ACCESO MEDIANTE AUTH-GATE
// ============================================================================
AuthGate.inicializar({
    tituloModulo: 'Oficina de Control',
    subtituloModulo: 'Consola de Administracion y Boveda Comercial',
    permitirPinDirecto: true,
    onSesionLista: async function(contexto) {
        window.idNegocioLogueado = contexto.idNegocio;
        await GeokatuDB.SecurityService.sellarSesionTerminalLocal(contexto.idNegocio);

        var uidBadge = document.getElementById('ofi-uid-badge');
        if (uidBadge) uidBadge.innerText = 'ID: ' + String(contexto.idNegocio).slice(0, 8) + '...';

        await inicializarConsolaOficina();

        // Máquina de estados del onboarding inicial en 3 fases
        var progreso = Number(window.datosTienda.progreso_boveda) || 0;
        var dashboardScreen = document.getElementById('dashboard-screen');
        var faseIdentidad = document.getElementById('fase-1-identidad');
        var fasePin = document.getElementById('fase-1-pin');
        var faseMapa = document.getElementById('fase-mapa-sandbox');

        // Ocultar todas las pantallas antes de despachar
        if (dashboardScreen) dashboardScreen.style.display = 'none';
        if (faseIdentidad) faseIdentidad.style.display = 'none';
        if (fasePin) fasePin.style.display = 'none';
        if (faseMapa) faseMapa.style.display = 'none';

        if (progreso >= 100) {
            if (dashboardScreen) dashboardScreen.style.display = 'flex';
            if (window.GeokatuTour && typeof window.GeokatuTour.iniciar === 'function') {
                setTimeout(function() { window.GeokatuTour.iniciar('oficina'); }, 800);
            }
        } else if (progreso >= 60) {
            window.iniciarSandboxGeoespacial(false);
            setTimeout(function() { if (window.lanzarGuiaOnboardingFase) window.lanzarGuiaOnboardingFase(3); }, 600);
        } else if (progreso >= 30) {
            if (fasePin) fasePin.style.display = 'block';
            window.cargarDiccionarioEmojis();
            window.actualizarPinLive();
            setTimeout(function() { if (window.lanzarGuiaOnboardingFase) window.lanzarGuiaOnboardingFase(2); }, 600);
        } else {
            if (faseIdentidad) faseIdentidad.style.display = 'block';
            var emailActivo = (AuthGate._estado.usuarioAuth && AuthGate._estado.usuarioAuth.email) ? AuthGate._estado.usuarioAuth.email : '';
            window.hidratarCamposPaso1Identidad(emailActivo);
            setTimeout(function() { if (window.lanzarGuiaOnboardingFase) window.lanzarGuiaOnboardingFase(1); }, 600);
        }

    },
    onCerrarSesion: function() {
        // Purga atómica de memoria para que nunca quede rota la pantalla
        if (typeof window.desuscripcionAlertas === 'function') {
            window.desuscripcionAlertas();
        }
        if (window.miniMapaPerfil) {
            window.miniMapaPerfil.remove();
            window.miniMapaPerfil = null;
        }
        // Ocultar todas las áreas operativas
        var dashboardScreen = document.getElementById('dashboard-screen');
        var faseIdentidad = document.getElementById('fase-1-identidad');
        var fasePin = document.getElementById('fase-1-pin');
        var faseMapa = document.getElementById('fase-mapa-sandbox');

        if (dashboardScreen) dashboardScreen.style.display = 'none';
        if (faseIdentidad) faseIdentidad.style.display = 'none';
        if (fasePin) fasePin.style.display = 'none';
        if (faseMapa) faseMapa.style.display = 'none';

        window.datosTienda = {};
        window.idNegocioLogueado = null;
    }
});

window.cerrarSesionOficina = async function() {
    if (confirm("¿Cerrar sesión de la consola de administración?")) {
        await AuthGate.cerrarSesion();
    }
};




// ============================================================================

// BLOQUE 2: NAVEGACIÓN Y SISTEMA DE PESTAÑAS (TABS)

// ============================================================================

window.cambiarTab = function(tabId) {
    if (navigator.vibrate) navigator.vibrate(30);

    document.querySelectorAll('.tab-content').forEach(function(el) {
        el.classList.remove('activo');
        el.style.display = 'none';
    });
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
        btn.classList.remove('activo');
    });

    var content = document.getElementById('content-' + tabId);
    if (content) {
        content.style.display = (tabId === 'ajustes' || tabId === 'operaciones' || tabId === 'equipo') ? 'flex' : 'block';
        content.classList.add('activo');
    }

    var targetBtn = Array.from(document.querySelectorAll('.tab-btn')).find(function(b) {
        var clickAttr = b.getAttribute('onclick') || '';
        return clickAttr.indexOf("'" + tabId + "'") !== -1;
    });
    if (targetBtn) targetBtn.classList.add('activo');

    if (tabId === 'ajustes') {
        window.hidratarFormularioCuentaDashboard();
        window.montarBrandingEnSubTabCuenta();
        if (!window.subTabCuentaActiva) window.subTabCuentaActiva = 'identidad';
        window.cambiarSubTabCuenta(window.subTabCuentaActiva);
    } else if (tabId === 'inventario') {
        window.cargarMisProductos(true);
    } else if (tabId === 'operaciones') {
        window.cargarAlertasSeguridad();
        window.renderizarResumenFiscal();
    } else if (tabId === 'equipo') {
        window.cargarEquipoOficina();
        window.cargarTareasOficina();
    }
};




// ============================================================================

// BLOQUE 3: INICIALIZACIÓN Y KPIS EN TIEMPO REAL

// ============================================================================

async function inicializarConsolaOficina() {

try {

const resNeg = await GeokatuDB.AdminService.obtenerNegocioPorUsuario(

window.idNegocioLogueado,

auth.currentUser?.email,

"admin"

);



if (resNeg.success && resNeg.data) {

window.datosTienda = resNeg.data;



// Escudo de Facturación

if (BillingGuard && typeof BillingGuard.verificarEstadoCuota === 'function') {

BillingGuard.verificarEstadoCuota(window.datosTienda.facturacion_control, 'billing-alert-container');

}



// Hidratar cabecera de identidad

const elNombre = document.getElementById('ui-nombre');

const elNombrePng = document.getElementById('ui-nombre-png');

const elLogo = document.getElementById('ui-logo');

const badgePlan = document.getElementById('ofi-estado-cuenta');



if (window.datosTienda.nombre_png) {

if (elNombrePng) { elNombrePng.src = window.datosTienda.nombre_png; elNombrePng.style.display = 'block'; }

if (elNombre) elNombre.style.display = 'none';

} else {

if (elNombrePng) elNombrePng.style.display = 'none';

if (elNombre) { elNombre.innerText = window.datosTienda.nombre || "COMERCIO GEOKATU"; elNombre.style.display = 'block'; }

}



if (elLogo && window.datosTienda.logo) {

elLogo.src = window.datosTienda.logo;

elLogo.style.display = 'block';

}



// Disparar tour guiado si el usuario entra por primera vez a la consola
        if (window.GeokatuTour && typeof window.GeokatuTour.iniciar === 'function') {
            setTimeout(function() {
                window.GeokatuTour.iniciar('oficina');
            }, 800);
        }


// Diagnóstico Siigo Nube
const fis = window.datosTienda.perfil_fiscal;
const txtSiigo = document.getElementById('txt-estado-fiscal-siigo');
if (txtSiigo) {
    if (fis && fis.siigo_user) {
        txtSiigo.innerHTML = 'Conexión API Siigo enlazada a <strong>' + (fis.razon_social || window.datosTienda.nombre) + '</strong> (NIT: ' + (fis.nit || 'S/N') + ').';
    } else {
        txtSiigo.innerText = "Modo comprobante equivalente POS local (sin llaves Siigo configuradas).";
    }
}




// Selector de pines

window.cargarDiccionarioEmojis();



// Sincronizar catálogo matriz local

if (CatalogoMatrizService && typeof CatalogoMatrizService.inicializarMatriz === 'function') {

CatalogoMatrizService.inicializarMatriz().catch(e => console.warn("[Matriz] Sync local pospuesta:", e));

}

}



await cargarKpisDashboard();

} catch (err) {

console.error("[Oficina] Fallo en arranque general:", err);

}

}



async function cargarKpisDashboard() {
    try {
        const tenantId = window.idNegocioLogueado;
        if (!tenantId) return;

        // 1. Lectura inmediata desde cache local (0 ms, 0 lecturas en Firestore)
        const acum = JSON.parse(localStorage.getItem('geokatu_acumulado_' + tenantId) || "{}");
        const totalVendido = (acum.efectivo || 0) + (acum.tarjeta || 0) + (acum.nequi || 0);
        const elVentas = document.getElementById('kpi-ventas-dia');
        if (elVentas) elVentas.innerText = '$' + totalVendido.toLocaleString('es-CO');

        const claveCacheCat = 'geokatu_catalogo_' + tenantId;
        const catalogoLocalStr = localStorage.getItem(claveCacheCat);
        let catalogoMemoria = [];
        try {
            catalogoMemoria = catalogoLocalStr ? JSON.parse(catalogoLocalStr) : [];
        } catch (eC) {
            catalogoMemoria = [];
        }

        const elTotal = document.getElementById('kpi-articulos-total');
        if (elTotal) {
            const cantActivos = catalogoMemoria.filter(function(p) { return !p.eliminado; }).length;
            elTotal.innerText = cantActivos;
        }

        const claveCacheVentas = 'geokatu_ventas_cache_' + tenantId;
        const ventasLocalStr = localStorage.getItem(claveCacheVentas);
        window.ventasCacheGlobal = [];
        try {
            window.ventasCacheGlobal = ventasLocalStr ? JSON.parse(ventasLocalStr) : [];
        } catch (eV) {
            window.ventasCacheGlobal = [];
        }

        const elTickets = document.getElementById('kpi-tickets-cant');
        if (elTickets) elTickets.innerText = window.ventasCacheGlobal.length;

        // 2. Sincronización ligera por deltas en segundo plano (solo si hay red)
        if (navigator.onLine) {
            // A. Sincronizar unicamente productos modificados despues del ultimoSync
            const resSync = await GeokatuDB.PosService.descargarCatalogoLocal(tenantId, false);
            if (resSync && resSync.success && elTotal) {
                const cantActivosSync = (resSync.data || []).filter(function(p) { return !p.eliminado; }).length;
                elTotal.innerText = cantActivosSync;
            }

            // B. Traer unicamente tickets creados despues del ultimo timestamp guardado
            const ultimoSyncVentas = localStorage.getItem('geokatu_ventas_sync_' + tenantId) || new Date(Date.now() - 86400000).toISOString();
            const ventasRef = collection(db, 'Directorio/' + tenantId + '/Ventas_POS');
            const qVentasDelta = query(ventasRef, where("timestamp_caja", ">", ultimoSyncVentas), limit(50));
            const snapVentasDelta = await getDocs(qVentasDelta);

            if (!snapVentasDelta.empty) {
                const mapaVentas = new Map();
                window.ventasCacheGlobal.forEach(function(v) { mapaVentas.set(v.ticketIdLocal || v.id_doc, v); });
                snapVentasDelta.forEach(function(docSnap) {
                    const dataV = docSnap.data();
                    dataV.id_doc = docSnap.id;
                    mapaVentas.set(dataV.ticketIdLocal || docSnap.id, dataV);
                });
                window.ventasCacheGlobal = Array.from(mapaVentas.values());
                window.ventasCacheGlobal.sort(function(a, b) {
                    var fA = a.fecha_creacion || a.timestamp_caja || 0;
                    var fB = b.fecha_creacion || b.timestamp_caja || 0;
                    return new Date(fB).getTime() - new Date(fA).getTime();
                });
                localStorage.setItem(claveCacheVentas, JSON.stringify(window.ventasCacheGlobal));
                localStorage.setItem('geokatu_ventas_sync_' + tenantId, new Date().toISOString());
            }

            if (elTickets) elTickets.innerText = window.ventasCacheGlobal.length;
        }

        // C. Refrescar alertas en tiempo real
        window.cargarAlertasSeguridad();
    } catch (err) {
        console.warn("[Oficina] Error al cargar KPIs:", err.message);
    }
}





// ============================================================================
// BLOQUE 4: GESTIÓN DEL CATÁLOGO DE PRODUCTOS (LAYOUTS, DRAG & DROP Y CSV)
// ============================================================================
window.GEOKATU_IMG_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150' viewBox='0 0 150 150'%3E%3Crect width='100%25' height='100%25' fill='%23141418'/%3E%3Ctext x='50%25' y='50%25' fill='%23ff6b00' font-family='sans-serif' font-weight='900' font-size='14' text-anchor='middle' dominant-baseline='middle'%3ESIN FOTO%3C/text%3E%3C/svg%3E";

window.manejarErrorImgCatalogo = function(img) {
    if (!img) return;
    img.onerror = null;
    img.src = window.GEOKATU_IMG_PLACEHOLDER;
};

window.seleccionarLayoutCatalogo = function(layoutId) {
    var l = layoutId || 'layout-grid';
    var inputLayout = document.getElementById('prodLayoutSeleccionado');
    if (inputLayout) inputLayout.value = l;

    document.querySelectorAll('.btn-layout-chip').forEach(function(btn) {
        if (btn.getAttribute('data-layout') === l) {
            btn.classList.add('activo');
        } else {
            btn.classList.remove('activo');
        }
    });

    var secGaleria = document.getElementById('seccion-galeria-split');
    var secEditorial = document.getElementById('seccion-articulo-editorial');

    if (secGaleria) {
        secGaleria.style.display = (l === 'layout-galeria-split') ? 'block' : 'none';
    }
    if (secEditorial) {
        secEditorial.style.display = (l === 'layout-articulo') ? 'block' : 'none';
    }
    window.guardarBorradorCatalogo();
};
window.cargarMisProductos = async function(reiniciar) {
    if (reiniciar === undefined) reiniciar = true;
    var cont = document.getElementById('lista-productos-container');
    var btnMas = document.getElementById('btn-cargar-mas');
    if (!cont) return;
    if (reiniciar) {
        cont.innerHTML = "<p style='text-align:center; color:#888; padding:20px 0;'>Cargando inventario en 0 ms...</p>";
        window.ultimoDocCatalogo = null;
        window.listaProductosGlobal = [];
    } else if (btnMas) {
        btnMas.innerText = "Cargando...";
        btnMas.disabled = true;
    }
    try {
        // Carga instantanea desde la cache local unificada de PosService
        if (reiniciar) {
            var resCache = await GeokatuDB.PosService.descargarCatalogoLocal(window.idNegocioLogueado, false);
            if (resCache && resCache.success && Array.isArray(resCache.data)) {
                window.listaProductosGlobal = resCache.data.filter(function(p) { return !p.eliminado; });
            }
        }
        var success = true;
        var data = window.listaProductosGlobal;
        var ultimoDoc = null;


        if (reiniciar) cont.innerHTML = "";
        if (!success || (data.length === 0 && reiniciar)) {
            cont.innerHTML = 
                '<div style="grid-column: 1 / -1; text-align:center; color:#888; padding: 40px 0;">' +
                    '<h4 style="color:white; margin:8px 0 4px 0;">Catálogo Vacío</h4>' +
                    '<p style="font-size:11.5px; margin:0;">Pulsa "+ Nuevo Artículo" para registrar el primero.</p>' +
                '</div>';
            if (btnMas) btnMas.style.display = 'none';
            return;
        }

        window.ultimoDocCatalogo = ultimoDoc;
        if (btnMas) {
            btnMas.style.display = data.length < 20 ? 'none' : 'block';
            btnMas.innerText = "Cargar más artículos";
            btnMas.disabled = false;
        }

        data.forEach(function(p) {
            var yaExiste = window.listaProductosGlobal.find(function(x) { return x.id_prod === p.id_prod; });
            if (!yaExiste) window.listaProductosGlobal.push(p);
            if (p.categoria) window.categoriasDisponibles.add(p.categoria);
        });

        if (reiniciar) window.actualizarSelectCategorias();

        var renderData = [].concat(window.listaProductosGlobal);
        if (window.categoriaFiltroActual) {
            renderData = renderData.filter(function(p) {
                return (p.categoria || '').toLowerCase() === window.categoriaFiltroActual.toLowerCase();
            });
        }
        if (window.terminoBusquedaActual) {
            renderData = renderData.filter(function(p) {
                return p.nombre.toLowerCase().indexOf(window.terminoBusquedaActual) !== -1;
            });
        }

        renderData.sort(function(a, b) { return (a.orden || 0) - (b.orden || 0); });

        cont.innerHTML = "";
        renderData.forEach(function(p) {
            var card = document.createElement('div');
            var lClass = p.layout || 'layout-grid';
            card.className = 'producto-card ' + lClass + (p.agotado ? ' agotado' : '');
            card.id = 'card-' + p.id_prod;
            card.dataset.id = p.id_prod;
            card.setAttribute('draggable', 'true');
            card.onclick = function() { window.mostrarLapizProducto(p.id_prod); };

            var imgPrincipal = (p.imagen && p.imagen.trim().length > 10) 
                ? p.imagen 
                : window.GEOKATU_IMG_PLACEHOLDER;

            var cuerpoHTML = '';
            if (lClass === 'layout-hero') {
                cuerpoHTML = 
                    '<div class="card-hero-header"><h3 class="prod-nombre">' + p.nombre + '</h3></div>' +
                    '<div class="card-hero-img-box"><img src="' + imgPrincipal + '" alt="' + p.nombre + '" onerror="window.manejarErrorImgCatalogo(this)"></div>' +
                    '<div class="card-hero-footer">' +
                        '<p class="prod-desc">' + (p.cuerpo_texto || 'Artículo destacado del catálogo.') + '</p>' +
                        '<b class="prod-precio">$' + p.precio + '</b>' +
                    '</div>';
            } else if (lClass === 'layout-galeria-split') {
                var gal = (p.galeria && p.galeria.length > 0) ? p.galeria : [imgPrincipal, imgPrincipal, imgPrincipal, imgPrincipal];
                var miniaturas = gal.slice(0, 4).map(function(m) {
                    return '<img src="' + m + '" alt="Miniatura" onerror="window.manejarErrorImgCatalogo(this)">';
                }).join('');
                cuerpoHTML = 
                    '<div class="split-top-row">' +
                        '<div class="split-main-photo"><img src="' + imgPrincipal + '" alt="' + p.nombre + '" onerror="window.manejarErrorImgCatalogo(this)"></div>' +
                        '<div class="split-thumbnails-grid">' + miniaturas + '</div>' +
                    '</div>' +
                    '<div class="split-bottom-row">' +
                        '<h4 class="prod-nombre">' + p.nombre + '</h4>' +
                        '<b class="prod-precio">$' + p.precio + '</b>' +
                    '</div>';
            } else if (lClass === 'layout-articulo') {
                var floatDir = p.posicion_imagen === 'derecha' ? 'float-derecha' : 'float-izquierda';
                cuerpoHTML = 
                    '<div class="card-articulo-wrapper">' +
                        '<h3 class="articulo-titulo">' + p.nombre + '</h3>' +
                        '<div class="articulo-cuerpo">' +
                            '<div class="articulo-img-box ' + floatDir + '"><img src="' + imgPrincipal + '" alt="' + p.nombre + '" onerror="window.manejarErrorImgCatalogo(this)"></div>' +
                            '<p class="articulo-texto">' + (p.cuerpo_texto || 'Sin descripción editorial añadida.') + '</p>' +
                        '</div>' +
                        '<div class="articulo-footer"><b class="prod-precio">$' + p.precio + '</b></div>' +
                    '</div>';
            } else {
                cuerpoHTML = 
                    '<div class="galeria-scroll" style="height: 110px; width: 100%; border-radius: 12px; overflow: hidden; background: #141418;">' +
                        '<img src="' + imgPrincipal + '" alt="' + p.nombre + '" style="width: 100%; height: 100%; object-fit: cover; object-position: center; display: block;" onerror="window.manejarErrorImgCatalogo(this)">' +
                    '</div>' +
                    '<div class="prod-info-wrapper" style="margin-top: 8px; width: 100%; text-align: center;">' +
                        '<h4 class="prod-nombre">' + p.nombre + '</h4>' +
                        '<b class="prod-precio">$' + p.precio + '</b>' +
                    '</div>';
            }

            card.innerHTML = 
                cuerpoHTML +
                '<div class="card-lapiz-btn" id="lapiz-' + p.id_prod + '" onclick="event.stopPropagation(); window.abrirMenuEdicionProducto(\'' + p.id_prod + '\')">' +
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--naranja)" stroke-width="2">' +
                        '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>' +
                    '</svg>' +
                '</div>' +
                '<div class="card-opciones-menu" id="menu-' + p.id_prod + '">' +
                    '<button class="btn-accion btn-edit" onclick="event.stopPropagation(); window.prepararEdicion(\'' + p.id_prod + '\')">Editar</button>' +
                    '<button class="btn-accion" style="background:rgba(255,255,255,0.1); color:#aaa;" onclick="event.stopPropagation(); window.cambiarEstadoAgotado(\'' + p.id_prod + '\', ' + p.agotado + ')">' + (p.agotado ? 'Activar' : 'Agotar') + '</button>' +
                    '<button class="btn-accion btn-delete" onclick="event.stopPropagation(); window.eliminarProducto(\'' + p.id_prod + '\')">Borrar</button>' +
                '</div>';

            card.addEventListener('dragstart', function(e) {
                e.dataTransfer.setData('text/plain', p.id_prod);
                card.classList.add('arrastrando');
            });
            card.addEventListener('dragend', function() {
                card.classList.remove('arrastrando');
            });

            cont.appendChild(card);
        });

        window.habilitarContenedorDrop(cont);
    } catch (e) {
        console.error("[Oficina] Error al listar catálogo:", e);
        if (reiniciar) cont.innerHTML = "<p style='color:#ff4444; text-align:center;'>Fallo al cargar catálogo.</p>";
    }
};

window.habilitarContenedorDrop = function(contenedor) {
    if (!contenedor) return;
    contenedor.addEventListener('dragover', function(e) {
        e.preventDefault();
        var arrastrando = document.querySelector('.arrastrando');
        if (!arrastrando) return;
        var trasElemento = Array.from(contenedor.querySelectorAll('.producto-card:not(.arrastrando)')).reduce(function(masCercano, hijo) {
            var box = hijo.getBoundingClientRect();
            var offset = e.clientY - box.top - box.height / 2;
            if (offset < 0 && offset > masCercano.offset) {
                return { offset: offset, element: hijo };
            } else {
                return masCercano;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;

        if (trasElemento == null) {
            contenedor.appendChild(arrastrando);
        } else {
            contenedor.insertBefore(arrastrando, trasElemento);
        }
    });
};

window.procesarArchivoCSV = function(input) {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = async function(e) {
        var lineas = e.target.result.split('\n').filter(function(l) { return l.trim().length > 0; });
        if (lineas.length < 2) return alert("El archivo CSV no contiene registros.");

        var importados = 0;
        for (var i = 1; i < lineas.length; i++) {
            var partes = lineas[i].split(',').map(function(s) { return s ? s.trim() : ''; });
            var nombre = partes[0];
            var precio = partes[1];
            var stock = partes[2];
            var barcode = partes[3];

            if (nombre) {
                await GeokatuDB.AdminService.guardarProducto(window.idNegocioLogueado, null, {
                    nombre: nombre,
                    precio: parseFloat(precio) || 0,
                    stock_actual: parseFloat(stock) || 0,
                    codigo_barras: barcode || Date.now().toString().slice(-8),
                    categoria: 'Importado',
                    layout: 'layout-grid',
                    orden: Date.now() + i
                });
                importados++;
            }
        }
        alert('✅ Se importaron ' + importados + ' artículos.');
        window.cargarMisProductos(true);
    };
    reader.readAsText(file);
};

window.rotarLayoutProducto = async function(id, layoutActual) {
    if (navigator.vibrate) navigator.vibrate(30);
    var secuencia = ['layout-grid', 'layout-hero', 'layout-galeria-split', 'layout-articulo'];
    var nuevoLayout = secuencia[(secuencia.indexOf(layoutActual) + 1) % secuencia.length];

    var p = window.listaProductosGlobal.find(function(x) { return x.id_prod === id; });
    if (p) p.layout = nuevoLayout;

    await GeokatuDB.AdminService.actualizarProducto(window.idNegocioLogueado, id, { layout: nuevoLayout });
    window.cargarMisProductos(false);
};

window.actualizarSelectCategorias = function() {
    var select = document.getElementById('filtro-categoria');
    if (!select) return;
    var valPrevio = select.value;
    select.innerHTML = '<option value="">Todas</option>';
    window.categoriasDisponibles.forEach(function(cat) {
        var opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        if (cat === valPrevio) opt.selected = true;
        select.appendChild(opt);
    });
};

window.manejarBusquedaTeclado = function(e) {
    if (e.key === 'Enter') {
        window.terminoBusquedaActual = document.getElementById('filtro-busqueda').value.trim().toLowerCase();
        window.cargarMisProductos(true);
    }
};

window.filtrarCatalogo = function() {
    window.categoriaFiltroActual = document.getElementById('filtro-categoria').value.trim();
    window.cargarMisProductos(true);
};

window.cargarMasProductos = function() {
    window.cargarMisProductos(false);
};

window.mostrarLapizProducto = function(id) {
    var card = document.getElementById('card-' + id);
    if (!card) return;
    var yaActivo = card.classList.contains('show-lapiz-btn');
    document.querySelectorAll('.producto-card').forEach(function(c) {
        c.classList.remove('show-lapiz-btn');
        c.classList.remove('show-opciones');
    });
    if (!yaActivo) {
        card.classList.add('show-lapiz-btn');
        if (window.timeoutsTarjetas[id]) clearTimeout(window.timeoutsTarjetas[id]);
        window.timeoutsTarjetas[id] = setTimeout(function() { card.classList.remove('show-lapiz-btn'); }, 3000);
    }
};

window.abrirMenuEdicionProducto = function(id) {
    var card = document.getElementById('card-' + id);
    if (card) {
        if (window.timeoutsTarjetas[id]) clearTimeout(window.timeoutsTarjetas[id]);
        card.classList.remove('show-lapiz-btn');
        card.classList.add('show-opciones');
        window.timeoutsTarjetas[id] = setTimeout(function() { card.classList.remove('show-opciones'); }, 5000);
    }
};

window.cambiarEstadoAgotado = async function(id, estadoActual) {
    if (navigator.vibrate) navigator.vibrate(40);
    var res = await GeokatuDB.AdminService.actualizarProducto(window.idNegocioLogueado, id, { agotado: !estadoActual });
    if (res.success) window.cargarMisProductos(false);
};

window.eliminarProducto = async function(id) {
    if (navigator.vibrate) navigator.vibrate(50);
    if (confirm("¿Eliminar este artículo del catálogo?")) {
        var res = await GeokatuDB.AdminService.eliminarProducto(window.idNegocioLogueado, id);
        if (res.success) window.cargarMisProductos(true);
    }
};


// ============================================================================
// BLOQUE 5: MOTOR DE VENTANAS FLOTANTES, CATÁLOGO Y PERSISTENCIA UNIFICADA
// ============================================================================

// --- GESTIÓN DE VENTANAS Y BURBUJAS FLOTANTES ---
window.hacerElementoArrastrable = function(elmnt, header) {
    var pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    var handle = header || elmnt;

    handle.onmousedown = dragMouseDown;
    handle.ontouchstart = dragTouchStart;

    function dragMouseDown(e) {
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function dragTouchStart(e) {
        var touch = e.touches[0];
        pos3 = touch.clientX;
        pos4 = touch.clientY;
        document.ontouchend = closeDragElement;
        document.ontouchmove = elementTouchDrag;
    }

    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
        elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
        elmnt.style.transform = "none";
    }

    function elementTouchDrag(e) {
        var touch = e.touches[0];
        pos1 = pos3 - touch.clientX;
        pos2 = pos4 - touch.clientY;
        pos3 = touch.clientX;
        pos4 = touch.clientY;
        elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
        elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
        elmnt.style.transform = "none";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
        document.ontouchend = null;
        document.ontouchmove = null;
    }
};

window.minimizarABurbuja = function(modalId, nombreProd) {
    var modalEl = document.getElementById(modalId);
    if (!modalEl) return;
    modalEl.style.display = 'none';

    var burbujaId = 'burbuja-' + modalId;
    if (document.getElementById(burbujaId)) return;

    var tagTexto = (nombreProd || 'PROD').substring(0, 6);
    var burbujaHTML = 
        '<div id="' + burbujaId + '" class="burbuja-producto-flotante" onclick="window.restaurarDesdeBurbuja(\'' + modalId + '\', \'' + burbujaId + '\')">' +
            '<span class="burbuja-badge">📦</span>' +
            '<div class="burbuja-contenido">' +
                '<span style="font-weight:900;">' + tagTexto + '</span>' +
            '</div>' +
        '</div>';

    var contenedorModales = document.getElementById('contenedor-modales-productos');
    if (contenedorModales) {
        contenedorModales.insertAdjacentHTML('beforeend', burbujaHTML);
        var burbujaEl = document.getElementById(burbujaId);
        if (burbujaEl) window.hacerElementoArrastrable(burbujaEl);
    }
};

window.restaurarDesdeBurbuja = function(modalId, burbujaId) {
    var bEl = document.getElementById(burbujaId);
    if (bEl) bEl.remove();
    var modalEl = document.getElementById(modalId);
    if (modalEl) {
        modalEl.style.display = 'block';
        modalEl.style.top = '50%';
        modalEl.style.left = '50%';
        modalEl.style.transform = 'translate(-50%, -50%)';
    }
};

// --- DICCIONARIOS Y CONTROLADORES EN CASCADA (MÉTRICA & RETAIL) ---
var DICCIONARIO_METRICAS = {
    peso: [
        { id: 'g', label: 'g (Gramos)' },
        { id: 'kg', label: 'kg (Kilos)' },
        { id: 'lb', label: 'lb (Libras)' },
        { id: 'oz', label: 'oz (Onzas)' }
    ],
    volumen: [
        { id: 'ml', label: 'ml (Mililitros)' },
        { id: 'L', label: 'L (Litros)' },
        { id: 'cm3', label: 'cm³ (C.C.)' },
        { id: 'gal', label: 'gal (Galones)' }
    ],
    distancia: [
        { id: 'cm', label: 'cm (Centímetros)' },
        { id: 'm', label: 'm (Metros)' },
        { id: 'in', label: 'in (Pulgadas)' },
        { id: 'yd', label: 'yd (Yardas)' }
    ],
    unidades: [
        { id: 'und', label: 'und (Unidad)' },
        { id: 'paq', label: 'paq (Paquete)' },
        { id: 'cja', label: 'cja (Caja)' },
        { id: 'doc', label: 'doc (Docena)' }
    ]
};

var DICCIONARIO_RETAIL = {
    estandar: [
        { id: 'STD', label: 'STD (Venta Normal)' }
    ],
    promociones: [
        { id: 'P-L', label: 'P-L (Liquidación)' },
        { id: 'P-2X', label: 'P-2X (Promo 2x1)' },
        { id: 'P-DC', label: 'P-DC (Descuento %)' },
        { id: 'P-XY', label: 'P-XY (Combo / Pack)' }
    ],
    merma: [
        { id: 'M-VP', label: 'M-VP (Próx. a Vencer)' },
        { id: 'M-AV', label: 'M-AV (Avería / Empaque)' },
        { id: 'M-CD', label: 'M-CD (Caducado / Merma)' }
    ],
    devoluciones: [
        { id: 'D-DF', label: 'D-DF (Defecto Fábrica)' },
        { id: 'D-GC', label: 'D-GC (Garantía Cliente)' },
        { id: 'D-ED', label: 'D-ED (Error Despacho)' }
    ]
};

window.toggleMenuMetrica = function(e) {
    e.stopPropagation();
    var m = document.getElementById('cascada-magnitudes');
    var sub = document.getElementById('cascada-unidades');
    if (m) {
        if (m.classList.contains('activo')) {
            m.classList.remove('activo');
            if (sub) sub.classList.remove('activo');
        } else {
            m.classList.add('activo');
        }
    }
};

window.abrirSubmenuMetrica = function(magnitud, e) {
    e.stopPropagation();
    var sub = document.getElementById('cascada-unidades');
    var lista = DICCIONARIO_METRICAS[magnitud] || [];
    var html = '';
    lista.forEach(function(u) {
        html += '<button type="button" class="btn-cascada-item" onclick="window.seleccionarUnidadFinal(\'' + magnitud + '\', \'' + u.id + '\', event)">' + u.label + '</button>';
    });
    if (sub) {
        sub.innerHTML = html;
        sub.classList.add('activo');
    }
};

window.seleccionarUnidadFinal = function(magnitud, unidadId, e) {
    e.stopPropagation();
    var lbl = document.getElementById('label-unidad-activa');
    var inMag = document.getElementById('prodMedidaMagnitud');
    var inUni = document.getElementById('prodMedidaUnidad');
    if (lbl) lbl.innerText = unidadId;
    if (inMag) inMag.value = magnitud;
    if (inUni) inUni.value = unidadId;

    var m = document.getElementById('cascada-magnitudes');
    var sub = document.getElementById('cascada-unidades');
    if (m) m.classList.remove('activo');
    if (sub) sub.classList.remove('activo');

    var inVal = document.getElementById('prodMedidaValor');
    if (inVal) inVal.focus();
};

window.toggleMenuRetail = function(e) {
    e.stopPropagation();
    var mMet = document.getElementById('cascada-magnitudes');
    var sMet = document.getElementById('cascada-unidades');
    if (mMet) mMet.classList.remove('activo');
    if (sMet) sMet.classList.remove('activo');

    var m = document.getElementById('cascada-retail-tipos');
    var sub = document.getElementById('cascada-retail-subtipos');
    if (m) {
        if (m.classList.contains('activo')) {
            m.classList.remove('activo');
            if (sub) sub.classList.remove('activo');
        } else {
            m.classList.add('activo');
        }
    }
};

window.abrirSubmenuRetail = function(tipo, e) {
    e.stopPropagation();
    if (tipo === 'estandar') {
        window.seleccionarRetailFinal('estandar', 'STD', e);
        return;
    }
    var sub = document.getElementById('cascada-retail-subtipos');
    var lista = DICCIONARIO_RETAIL[tipo] || [];
    var html = '';
    lista.forEach(function(r) {
        html += '<button type="button" class="btn-cascada-item" onclick="window.seleccionarRetailFinal(\'' + tipo + '\', \'' + r.id + '\', event)">' + r.label + '</button>';
    });
    if (sub) {
        sub.innerHTML = html;
        sub.classList.add('activo');
    }
};

window.seleccionarRetailFinal = function(tipo, codigo, e) {
    e.stopPropagation();
    var lbl = document.getElementById('label-retail-activo');
    var inTip = document.getElementById('prodRetailTipo');
    var inCod = document.getElementById('prodRetailCodigo');
    if (lbl) lbl.innerText = codigo;
    if (inTip) inTip.value = tipo;
    if (inCod) inCod.value = codigo;

    var m = document.getElementById('cascada-retail-tipos');
    var sub = document.getElementById('cascada-retail-subtipos');
    if (m) m.classList.remove('activo');
    if (sub) sub.classList.remove('activo');

    var inDet = document.getElementById('prodRetailDetalle');
    if (inDet) inDet.focus();
};

document.addEventListener('click', function(e) {
    var mMet = document.getElementById('cascada-magnitudes');
    var sMet = document.getElementById('cascada-unidades');
    if (mMet && !e.target.closest('#modulo-metrica-combo')) {
        mMet.classList.remove('activo');
        if (sMet) sMet.classList.remove('activo');
    }

    var mRet = document.getElementById('cascada-retail-tipos');
    var sRet = document.getElementById('cascada-retail-subtipos');
    if (mRet && !e.target.closest('#modulo-retail-combo')) {
        mRet.classList.remove('activo');
        if (sRet) sRet.classList.remove('activo');
    }
});

// --- BOTTOM SHEET Y FORMULARIO DE PRODUCTO ---
window.blobProductoEditadoCatalogo = null;

window.actualizarNombreImagenUI = async function(input, idTexto) {
    var textoUI = document.getElementById(idTexto);
    if (input.files && input.files[0] && textoUI) {
        var editada = await window.GeokatuEstudio.editarImagen(input.files[0], {
            maxAncho: 800,
            maxAlto: 800,
            calidad: 0.84,
            titulo: 'Editar Foto del Producto'
        });
        if (!editada) {
            input.value = '';
            return;
        }
        window.blobProductoEditadoCatalogo = editada.blob;
        textoUI.innerHTML = '<img src="' + editada.dataUrl + '" style="width:100%;height:100%;object-fit:contain;border-radius:12px;">';
    }
};


window.previsualizarImagenProducto = function(input) {
    window.actualizarNombreImagenUI(input, 'file-upload-text');
};

window.abrirBottomSheet = function(productoEditar) {
    var editId = document.getElementById('prodEditId') ? document.getElementById('prodEditId').value : '';
if (!editId) {
    window.restaurarBorradorCatalogo();
}
    if (navigator.vibrate) navigator.vibrate(30);
    var sheet = document.getElementById('bottom-sheet-catalogo');
    var overlay = document.getElementById('overlay-catalogo');
    if (overlay) overlay.style.display = 'block';
    if (sheet) sheet.classList.add('activo');

    if (productoEditar) {
        window.prepararEdicion(productoEditar.id_prod);
    }
};

window.cerrarBottomSheet = function() {
    var sheet = document.getElementById('bottom-sheet-catalogo');
    var overlay = document.getElementById('overlay-catalogo');
    if (sheet) sheet.classList.remove('activo');
    if (overlay) overlay.style.display = 'none';

    window.cancelarEdicion();

    if (window.html5QrCodeCatalogo && window.html5QrCodeCatalogo.isScanning) {
        window.html5QrCodeCatalogo.stop().then(function() {
            var visor = document.getElementById('lector-camara-catalogo');
            if (visor) visor.style.display = 'none';
        }).catch(function() {});
    }
};

window.cancelarEdicion = function() {
    document.getElementById('prodNombre').value = '';
    document.getElementById('prodPrecio').value = '';
    document.getElementById('prodCategoria').value = '';
    document.getElementById('prodEditId').value = '';
    document.getElementById('prodImagenActual').value = '';

    var inStock = document.getElementById('prodStockInicial');
    if (inStock) inStock.value = '1';

    var bCode = document.getElementById('prodBarcode');
    if (bCode) bCode.value = '';

    // Limpieza métrica
    var valMet = document.getElementById('prodMedidaValor');
    if (valMet) valMet.value = '';
    document.getElementById('prodMedidaMagnitud').value = 'peso';
    document.getElementById('prodMedidaUnidad').value = 'g';
    var lblUnidad = document.getElementById('label-unidad-activa');
    if (lblUnidad) lblUnidad.innerText = 'g';

    // Limpieza editorial y galería
    document.getElementById('prodGaleriaActual').value = '[]';
    var fGal = document.getElementById('prodGaleriaFiles');
    if (fGal) fGal.value = '';
    var txtCuerpo = document.getElementById('prodCuerpoTexto');
    if (txtCuerpo) txtCuerpo.value = '';
    var posImg = document.getElementById('prodPosicionImagen');
    if (posImg) posImg.value = 'izquierda';
    window.seleccionarLayoutCatalogo('layout-grid');


    // Limpieza retail
    var detRet = document.getElementById('prodRetailDetalle');
    if (detRet) detRet.value = '';
    document.getElementById('prodRetailTipo').value = 'estandar';
    document.getElementById('prodRetailCodigo').value = 'STD';
    var lblRet = document.getElementById('label-retail-activo');
    if (lblRet) lblRet.innerText = 'STD';

    var btnSub = document.getElementById('btn-submit-producto');
    if (btnSub) btnSub.innerText = "GUARDAR EN CATÁLOGO";
    var titBs = document.getElementById('bs-titulo');
    if (titBs) titBs.innerText = "Añadir al Catálogo";

    var fImg = document.getElementById('prodImagenFile');
    if (fImg) fImg.value = '';
    var txtUpload = document.getElementById('file-upload-text');
    if (txtUpload) txtUpload.innerHTML = '<span style="font-size:18px;">📸</span><span>Foto</span>';

};

window.prepararEdicion = function(id) {
    if (navigator.vibrate) navigator.vibrate(40);
    var p = window.listaProductosGlobal.find(function(x) { return x.id_prod === id; });
    if (!p) return;

    document.getElementById('prodNombre').value = p.nombre || '';
    document.getElementById('prodPrecio').value = p.precio !== undefined ? p.precio : '';
    document.getElementById('prodCategoria').value = p.categoria || '';
    document.getElementById('prodEditId').value = id;

    var inStock = document.getElementById('prodStockInicial');
    if (inStock) inStock.value = p.stock_actual !== undefined ? p.stock_actual : 0;

    document.getElementById('prodImagenActual').value = p.imagen || '';
    var bCode = document.getElementById('prodBarcode');
    if (bCode) bCode.value = p.codigo_barras || '';

    // Hidratar Métrica
    var met = p.metrica || {};
    document.getElementById('prodMedidaMagnitud').value = met.magnitud || 'peso';
    document.getElementById('prodMedidaUnidad').value = met.unidad || 'g';
    var lblUnidad = document.getElementById('label-unidad-activa');
    if (lblUnidad) lblUnidad.innerText = met.unidad || 'g';
    var valMet = document.getElementById('prodMedidaValor');
    if (valMet) valMet.value = met.valor || '';

    // Hidratar Galería y Editorial
    document.getElementById('prodGaleriaActual').value = JSON.stringify(p.galeria || []);
    var txtCuerpo = document.getElementById('prodCuerpoTexto');
    if (txtCuerpo) txtCuerpo.value = p.cuerpo_texto || '';
    var posImg = document.getElementById('prodPosicionImagen');
    if (posImg) posImg.value = p.posicion_imagen || 'izquierda';
    window.seleccionarLayoutCatalogo(p.layout || 'layout-grid');

    // Hidratar Clasificación Retail
    var clas = p.clasificacion || {};
    document.getElementById('prodRetailTipo').value = clas.tipo || 'estandar';
    document.getElementById('prodRetailCodigo').value = clas.codigo || 'STD';
    var lblRet = document.getElementById('label-retail-activo');
    if (lblRet) lblRet.innerText = clas.codigo || 'STD';
    var detRet = document.getElementById('prodRetailDetalle');
    if (detRet) detRet.value = clas.detalle || '';

    var uploadText = document.getElementById('file-upload-text');
    if (uploadText) {
        uploadText.innerHTML = (p.imagen && p.imagen.trim().length > 10)
            ? '<img src="' + p.imagen + '" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">'
            : '<span style="font-size:18px;">📸</span><span>Foto</span>';
    }

    document.getElementById('btn-submit-producto').innerText = "ACTUALIZAR DATOS";
    document.getElementById('bs-titulo').innerText = "Editar Producto";

    var sheet = document.getElementById('bottom-sheet-catalogo');
    var overlay = document.getElementById('overlay-catalogo');
    if (overlay) overlay.style.display = 'block';
    if (sheet) sheet.classList.add('activo');
};
// ============================================================================
// BORRADOR EFÍMERO CONTRA REINICIOS DE CÁMARA ANDROID (ZERO ${})
// ============================================================================
window.guardarBorradorCatalogo = function() {
    // Si estamos editando un producto existente, no sobreescribir borrador nuevo
    var editId = document.getElementById('prodEditId') ? document.getElementById('prodEditId').value : '';
    if (editId) return;

    var borrador = {
        barcode: document.getElementById('prodBarcode') ? document.getElementById('prodBarcode').value : '',
        nombre: document.getElementById('prodNombre') ? document.getElementById('prodNombre').value : '',
        precio: document.getElementById('prodPrecio') ? document.getElementById('prodPrecio').value : '',
        stock: document.getElementById('prodStockInicial') ? document.getElementById('prodStockInicial').value : '',
        categoria: document.getElementById('prodCategoria') ? document.getElementById('prodCategoria').value : '',
        magnitud: document.getElementById('prodMedidaMagnitud') ? document.getElementById('prodMedidaMagnitud').value : 'peso',
        unidad: document.getElementById('prodMedidaUnidad') ? document.getElementById('prodMedidaUnidad').value : 'g',
        medidaValor: document.getElementById('prodMedidaValor') ? document.getElementById('prodMedidaValor').value : '',
        retailTipo: document.getElementById('prodRetailTipo') ? document.getElementById('prodRetailTipo').value : 'estandar',
        retailCodigo: document.getElementById('prodRetailCodigo') ? document.getElementById('prodRetailCodigo').value : 'STD',
        retailDetalle: document.getElementById('prodRetailDetalle') ? document.getElementById('prodRetailDetalle').value : '',
        layout: document.getElementById('prodLayoutSeleccionado') ? document.getElementById('prodLayoutSeleccionado').value : 'layout-grid',
        cuerpoTexto: document.getElementById('prodCuerpoTexto') ? document.getElementById('prodCuerpoTexto').value : ''
    };

    sessionStorage.setItem('geokatu_catalogo_draft', JSON.stringify(borrador));
};

window.restaurarBorradorCatalogo = function() {
    var raw = sessionStorage.getItem('geokatu_catalogo_draft');
    if (!raw) return;
    try {
        var d = JSON.parse(raw);
        if (!d) return;

        if (document.getElementById('prodBarcode') && d.barcode) document.getElementById('prodBarcode').value = d.barcode;
        if (document.getElementById('prodNombre') && d.nombre) document.getElementById('prodNombre').value = d.nombre;
        if (document.getElementById('prodPrecio') && d.precio) document.getElementById('prodPrecio').value = d.precio;
        if (document.getElementById('prodStockInicial') && d.stock) document.getElementById('prodStockInicial').value = d.stock;
        if (document.getElementById('prodCategoria') && d.categoria) document.getElementById('prodCategoria').value = d.categoria;

        if (document.getElementById('prodMedidaMagnitud') && d.magnitud) document.getElementById('prodMedidaMagnitud').value = d.magnitud;
        if (document.getElementById('prodMedidaUnidad') && d.unidad) {
            document.getElementById('prodMedidaUnidad').value = d.unidad;
            var lblUni = document.getElementById('label-unidad-activa');
            if (lblUni) lblUni.innerText = d.unidad;
        }
        if (document.getElementById('prodMedidaValor') && d.medidaValor) document.getElementById('prodMedidaValor').value = d.medidaValor;

        if (document.getElementById('prodRetailTipo') && d.retailTipo) document.getElementById('prodRetailTipo').value = d.retailTipo;
        if (document.getElementById('prodRetailCodigo') && d.retailCodigo) {
            document.getElementById('prodRetailCodigo').value = d.retailCodigo;
            var lblRet = document.getElementById('label-retail-activo');
            if (lblRet) lblRet.innerText = d.retailCodigo;
        }
        if (document.getElementById('prodRetailDetalle') && d.retailDetalle) document.getElementById('prodRetailDetalle').value = d.retailDetalle;
        if (document.getElementById('prodCuerpoTexto') && d.cuerpoTexto) document.getElementById('prodCuerpoTexto').value = d.cuerpoTexto;
        if (d.layout) window.seleccionarLayoutCatalogo(d.layout);
    } catch (e) {
        console.warn("Fallo restaurando borrador:", e);
    }
};

window.limpiarBorradorCatalogo = function() {
    sessionStorage.removeItem('geokatu_catalogo_draft');
};

// Escuchar cambios en todos los inputs del formulario para guardar en tiempo real
document.addEventListener('input', function(e) {
    if (e.target && e.target.closest('#bottom-sheet-catalogo')) {
        window.guardarBorradorCatalogo();
    }
});

// --- SUBIDA CANÓNICA Y GUARDADO EN FIRESTORE ---
window.guardarProducto = async function() {
    if (navigator.vibrate) navigator.vibrate(40);
    if (!window.idNegocioLogueado) return;

    var nom = document.getElementById('prodNombre').value.trim();
    var pre = document.getElementById('prodPrecio').value.trim();
    var stockInput = document.getElementById('prodStockInicial') ? document.getElementById('prodStockInicial').value.trim() : "";
    var cantStock = stockInput !== "" ? Math.max(0, parseFloat(stockInput)) : 0;
    var editId = document.getElementById('prodEditId').value.trim();

    if (!nom || !pre) return alert("El nombre y el precio son obligatorios.");

    var btn = document.getElementById('btn-submit-producto');
    btn.innerText = "Guardando...";
    btn.disabled = true;

    try {
        var barcodeVal = document.getElementById('prodBarcode') ? document.getElementById('prodBarcode').value.trim() : "";
        var urlImg = document.getElementById('prodImagenActual').value.trim() || '';
        var fInput = document.getElementById('prodImagenFile');
        var f = (fInput && fInput.files && fInput.files.length > 0) ? fInput.files[0] : null;

       // Subida de imagen usando el Blob editado en el Estudio 2D (con transparencia WebP intacta)
        if (window.blobProductoEditadoCatalogo || f) {
            var blobWebpProd = window.blobProductoEditadoCatalogo || (await window.comprimirImagen(f, 600, 0.75, true));
            var codNombreArchivo = (barcodeVal || 'prod') + '_' + Date.now();
            var pathFoto = 'productos/' + window.idNegocioLogueado + '/' + codNombreArchivo + '.webp';
            var resFoto = await GeokatuDB.AdminService.subirArchivo(pathFoto, blobWebpProd);
            window.blobProductoEditadoCatalogo = null;


            if (resFoto) {
                if (typeof resFoto === 'string') {
                    urlImg = resFoto;
                } else if (resFoto.data && typeof resFoto.data === 'string') {
                    urlImg = resFoto.data;
                } else if (resFoto.data && resFoto.data.url) {
                    urlImg = resFoto.data.url;
                } else if (resFoto.url) {
                    urlImg = resFoto.url;
                }
            }

            if (!urlImg) {
                console.warn("[Catálogo] Aviso: La subida de imagen no retornó URL válida.");
            }
        }


    
var esVenezuela = window.datosTienda.pais === 'VEN';
var precioInput = parseFloat(pre);
var precioNormalizado = esVenezuela ? parseFloat(precioInput.toFixed(2)) : Math.round(precioInput);


        // Métrica
        var inMedMag = document.getElementById('prodMedidaMagnitud');
        var inMedUni = document.getElementById('prodMedidaUnidad');
        var inMedVal = document.getElementById('prodMedidaValor');
        var medidaMagnitud = inMedMag ? inMedMag.value : 'peso';
        var medidaUnidad = inMedUni ? inMedUni.value : 'g';
        var medidaValor = inMedVal ? (parseFloat(inMedVal.value) || 0) : 0;

        // Retail
        var inRetTip = document.getElementById('prodRetailTipo');
        var inRetCod = document.getElementById('prodRetailCodigo');
        var inRetDet = document.getElementById('prodRetailDetalle');
        var retailTipo = inRetTip ? inRetTip.value : 'estandar';
        var retailCodigo = inRetCod ? inRetCod.value : 'STD';
        var retailDetalle = inRetDet ? inRetDet.value.trim() : '';

        // Galería múltiple secundaria (máximo 4)
        var arrayGaleria = JSON.parse(document.getElementById('prodGaleriaActual').value || "[]");
        var galeriaFiles = document.getElementById('prodGaleriaFiles') ? document.getElementById('prodGaleriaFiles').files : null;
        if (galeriaFiles && galeriaFiles.length > 0) {
            var limite = Math.min(galeriaFiles.length, 4);
            for (var i = 0; i < limite; i++) {
                var blobG = await window.comprimirImagen(galeriaFiles[i], 600, 0.7, true);
                var pathGal = 'productos/' + window.idNegocioLogueado + '/gal_' + Date.now() + '_' + i + '.webp';
                var upG = await GeokatuDB.AdminService.subirArchivo(pathGal, blobG);
                var urlG = (typeof upG === 'string') ? upG : (upG && upG.data ? upG.data : '');
                if (urlG) arrayGaleria.push(urlG);
            }
            arrayGaleria = arrayGaleria.slice(-4);
        }

        var inTxtCuerpo = document.getElementById('prodCuerpoTexto');
        var inPosImg = document.getElementById('prodPosicionImagen');
        var cuerpoEditorial = inTxtCuerpo ? inTxtCuerpo.value.trim() : '';
        var posImg = inPosImg ? inPosImg.value : 'izquierda';

                var inputLayoutSel = document.getElementById('prodLayoutSeleccionado');
        var layoutDefinido = inputLayoutSel ? inputLayoutSel.value : 'layout-grid';

        var esPesableArticulo = Boolean(medidaMagnitud === 'peso' || medidaUnidad === 'kg' || medidaUnidad === 'g' || medidaUnidad === 'lb');

        var pObj = {
            nombre: nom,
            precio: precioNormalizado,
            codigo_barras: barcodeVal,
            stock_actual: cantStock,
            categoria: document.getElementById('prodCategoria').value.trim() || "General",
            imagen: urlImg,
            galeria: arrayGaleria,
            cuerpo_texto: cuerpoEditorial,
            posicion_imagen: posImg,
            en_piso_venta: true,
            layout: layoutDefinido,
            es_pesable: esPesableArticulo,
            unidad_medida: medidaUnidad || (esPesableArticulo ? 'kg' : 'und'),
            metrica: {
                magnitud: medidaMagnitud,
                unidad: medidaUnidad,
                valor: medidaValor
            },
            clasificacion: {
                tipo: retailTipo,
                codigo: retailCodigo,
                detalle: retailDetalle
            }
        };


        if (!editId) {
            pObj.agotado = cantStock === 0;
            pObj.fecha_creacion = new Date().toISOString();
            pObj.orden = Date.now();
        }


        var resGuardado = await GeokatuDB.AdminService.guardarProducto(window.idNegocioLogueado, editId || null, pObj);
        if (!resGuardado.success) throw new Error(resGuardado.error);

        if (navigator.vibrate) navigator.vibrate([50, 100, 50]);
        window.cerrarBottomSheet();
        window.cargarMisProductos(true);
    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        btn.innerText = "GUARDAR EN CATÁLOGO";
        btn.disabled = false;
    }
};

// --- ESCÁNER DE CÓDIGOS DE BARRAS DIRECTO ---
window.trackCamaraActiva = null;
window.torchEncendido = false;

window.escanearParaCatalogo = function() {
    var wrapper = document.getElementById('lector-camara-wrapper');
    var visor = document.getElementById('lector-camara-catalogo');
    if (!wrapper || !visor) return;

    if (wrapper.style.display === 'block') {
        window.detenerCamaraEscaner();
        return;
    }

    wrapper.style.display = 'block';
    if (!window.html5QrCodeCatalogo) {
        window.html5QrCodeCatalogo = new Html5Qrcode("lector-camara-catalogo");
    }

    var configCamara = {
        fps: 24,
        qrbox: function(w, h) {
            return { width: Math.floor(w * 0.85), height: Math.floor(Math.min(h * 0.5, 140)) };
        },
        aspectRatio: 1.333333
    };

    window.html5QrCodeCatalogo.start(
        { facingMode: "environment" },
        configCamara,
        async function(codigo) {
            var inBar = document.getElementById('prodBarcode');
            var codigoLimpio = String(codigo).trim();
            if (inBar) inBar.value = codigoLimpio;
            if (navigator.vibrate) navigator.vibrate([60, 50, 60]);

            // 1. Revisar primero si ya existe en la tienda
            var prodLocal = window.listaProductosGlobal.find(function(p) {
                var codProd = p.codigo_barras ? String(p.codigo_barras).trim() : '';
                var idProd = p.id_prod ? String(p.id_prod).trim() : '';
                return codProd === codigoLimpio || idProd === codigoLimpio;
            });

            if (prodLocal) {
                window.prepararEdicion(prodLocal.id_prod);
                window.detenerCamaraEscaner();
                return;
            }

            // 2. Si es nuevo, buscar sugerencias en el Catálogo Matriz
            window.guardarBorradorCatalogo();

            if (CatalogoMatrizService && typeof CatalogoMatrizService.obtenerProductoPorCodigo === 'function') {
                var prodMatriz = await CatalogoMatrizService.obtenerProductoPorCodigo(codigoLimpio);
                if (prodMatriz) {
                    var inNom = document.getElementById('prodNombre');
                    var inCat = document.getElementById('prodCategoria');
                    if (inNom && !inNom.value) inNom.value = prodMatriz.nombre;
                    if (inCat && (!inCat.value || inCat.value === 'General')) inCat.value = prodMatriz.categoria;
                    window.guardarBorradorCatalogo();
                }
            }

            window.detenerCamaraEscaner();
        },

        function() {}
    ).then(function() {
        // Calibración de sensor: Foco continuo, obturación reactiva y exposición
        setTimeout(function() {
            var videoEl = document.querySelector('#lector-camara-catalogo video');
            if (videoEl && videoEl.srcObject) {
                var tracks = videoEl.srcObject.getVideoTracks();
                if (tracks && tracks.length > 0) {
                    window.trackCamaraActiva = tracks[0];
                    var caps = window.trackCamaraActiva.getCapabilities ? window.trackCamaraActiva.getCapabilities() : {};
                    
                    var constraintsAvanzadas = {};
                    if (caps.focusMode && caps.focusMode.indexOf('continuous') !== -1) {
                        constraintsAvanzadas.focusMode = 'continuous';
                    }
                    if (caps.exposureMode && caps.exposureMode.indexOf('continuous') !== -1) {
                        constraintsAvanzadas.exposureMode = 'continuous';
                    }
                    if (caps.exposureCompensation) {
                        constraintsAvanzadas.exposureCompensation = caps.exposureCompensation.max ? Math.min(caps.exposureCompensation.max, 1.0) : 0;
                    }

                    if (Object.keys(constraintsAvanzadas).length > 0) {
                        window.trackCamaraActiva.applyConstraints({ advanced: [constraintsAvanzadas] }).catch(function(e) {
                            console.warn("Calibración de lente opcional:", e);
                        });
                    }
                }
            }
        }, 600);
    }).catch(function(err) {
        console.warn("Fallo cámara catálogo:", err);
        wrapper.style.display = 'none';
    });
};

window.detenerCamaraEscaner = function() {
    var wrapper = document.getElementById('lector-camara-wrapper');
    if (window.trackCamaraActiva && window.torchEncendido) {
        window.trackCamaraActiva.applyConstraints({ advanced: [{ torch: false }] }).catch(function() {});
    }
    window.torchEncendido = false;
    window.trackCamaraActiva = null;

    var btnTorch = document.getElementById('btn-torch-escaner');
    if (btnTorch) btnTorch.innerHTML = '🔦 <span>Flash</span>';

    if (window.html5QrCodeCatalogo && window.html5QrCodeCatalogo.isScanning) {
        window.html5QrCodeCatalogo.stop().then(function() {
            if (wrapper) wrapper.style.display = 'none';
        }).catch(function() {
            if (wrapper) wrapper.style.display = 'none';
        });
    } else if (wrapper) {
        wrapper.style.display = 'none';
    }
};

window.toggleTorchScanner = function() {
    if (!window.trackCamaraActiva) return;
    var caps = window.trackCamaraActiva.getCapabilities ? window.trackCamaraActiva.getCapabilities() : {};
    if (!caps.torch) {
        alert("Tu dispositivo no admite control de linterna vía web.");
        return;
    }

    window.torchEncendido = !window.torchEncendido;
    window.trackCamaraActiva.applyConstraints({
        advanced: [{ torch: window.torchEncendido }]
    }).then(function() {
        var btnTorch = document.getElementById('btn-torch-escaner');
        if (btnTorch) {
            btnTorch.innerHTML = window.torchEncendido 
                ? '⚡ <span style="color:#00ff64;">Encendido</span>' 
                : '🔦 <span>Flash</span>';
        }
    }).catch(function(e) {
        console.warn("Error conmutando flash:", e);
    });
};


// ============================================================================
// BLOQUE 6: FÁBRICA VECTORIAL DE PINES SVG & BRANDING (CONFORME A PINES.CSS)
// ============================================================================
window.obtenerContenidoSVG = function(forma, fotoSrc, imgId) {
    var geo = '';
    if (forma === 'forma-esfera') {
        geo = '<circle cx="30" cy="30" r="26" />';
    } else if (forma === 'forma-triangulo') {
        geo = '<polygon points="6,8 54,8 30,54" stroke-linejoin="round" />';
    } else if (forma === 'forma-estrella') {
        geo = '<polygon points="30,4 38,23 57,23 42,34 48,53 30,42 12,53 18,34 3,23 22,23" stroke-linejoin="round" />';
    } else if (forma === 'forma-hexagono') {
        geo = '<polygon points="30,4 53,17 53,43 30,56 7,43 7,17" stroke-linejoin="round" />';
    } else if (forma === 'forma-corazon') {
        geo = '<path d="M 30 16 C 22 2 10 6 10 20 C 10 35 25 45 30 57 C 35 45 50 35 50 20 C 50 6 38 2 30 16 Z" stroke-linejoin="round" />';
    } else if (forma === 'forma-arbol') {
        geo = '<polygon points="26,56 34,56 34,42 50,42 30,6 10,42 26,42" stroke-linejoin="round" />';
    } else if (forma === 'forma-hongo') {
        geo = '<path d="M 24 56 L 36 56 L 36 36 L 52 36 C 52 15 44 8 30 8 C 16 8 8 15 8 36 L 24 36 Z" stroke-linejoin="round" />';
    } else if (forma === 'forma-paleta') {
        geo = '<path d="M 28 56 L 32 56 L 32 37 A 16 16 0 1 0 28 37 Z" stroke-linejoin="round" />';
    } else {
        geo = '<path d="M 30,57 C 30,57 10,38 10,20 C 10,9 19,3 30,3 C 41,3 50,9 50,20 C 50,38 30,57 30,57 Z" />';
    }

    var idUnico = imgId || ('pin-' + Math.floor(Math.random() * 100000));
    var clipId = 'clip-' + idUnico;
    var txtDisplay = fotoSrc ? 'none' : 'flex';
    var imgNode = fotoSrc 
        ? '<image id="' + idUnico + '" href="' + fotoSrc + '" x="0" y="0" width="60" height="60" preserveAspectRatio="xMidYMid slice" clip-path="url(#' + clipId + ')" />'
        : '';

    return '<svg class="svg-pin-fondo" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">' +
               '<defs><clipPath id="' + clipId + '">' + geo + '</clipPath></defs>' +
               geo +
               imgNode +
           '</svg>' +
           '<span class="texto-centro-masa" style="display: ' + txtDisplay + ';">FOTO<br>PIN</span>';
};


window.calcularPaletaAureaSilenciosa = function(c1, c2, c3, c4) {
    var primario = c1 || '#ff6b00';
    var grisGeokatu = '#8a909d';
    var blanco = '#ffffff';
    var oscuro = '#0a0a0c';

    var final1 = primario;
    var final2 = c2 ? c2 : grisGeokatu;
    // Si solo hay 1 color: c3 toma c1. Si hay 2 colores: c3 toma c2. Si hay 3 o más: c3 toma c3.
    var final3 = c3 ? c3 : (c2 ? c2 : primario);
    var final4 = c4 ? c4 : (c3 ? grisGeokatu : (c2 ? grisGeokatu : blanco));

    return {
        c1: final1,
        c2: final2,
        c3: final3,
        c4: final4
    };
};

window.actualizarContenedorPin = function(idContenedor, idImagen, forma, color1, color2, color3, color4, efectoRaw, fotoSrc, animacion, auraClase) {
    var contenedor = document.getElementById(idContenedor);
    if (!contenedor) return;

    var partesEfecto = (efectoRaw || '|').split('|');
    var anclaje = partesEfecto[0] || '';
    var emoji = partesEfecto[1] || '';
    var anim = animacion || 'anim-salto';
    var aura = auraClase || '';

    var paleta = window.calcularPaletaAureaSilenciosa(color1, color2, color3, color4);

    contenedor.className = 'pin-wrapper ' + anim + ' ' + aura;
    contenedor.setAttribute('data-forma', forma || 'forma-gota');
    contenedor.style.setProperty('--color-main', paleta.c1);
    contenedor.style.setProperty('--color-sec', paleta.c2);
    contenedor.style.setProperty('--color-ter', paleta.c3);
    contenedor.style.setProperty('--color-cuat', paleta.c4);


    if (emoji && emoji !== '|') {
        contenedor.setAttribute('data-emoji', emoji);
        contenedor.setAttribute('data-anclaje', anclaje);
    } else {
        contenedor.removeAttribute('data-emoji');
        contenedor.removeAttribute('data-anclaje');
    }

    contenedor.innerHTML = window.obtenerContenidoSVG(forma, fotoSrc, idImagen);
};

window.dataUrlABlob = function(dataUrl) {
    try {
        if (!dataUrl || typeof dataUrl !== 'string' || dataUrl.indexOf(',') === -1) return null;
        var partes = dataUrl.split(',');
        var mimeMatch = partes[0].match(/:(.*?);/);
        var mime = mimeMatch ? mimeMatch[1] : 'image/webp';
        var bstr = atob(partes[1]);
        var n = bstr.length;
        var u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    } catch (e) {
        return null;
    }
};

window.DICCIONARIO_EMOJIS_GRID = [
    {
        grupo: "Energia, Fuego y Destellos",
        anclajeDefault: "anclaje-esquina",
        iconos: ["👑","🎓","🧢","🌸","🎀","🏵️","✨","⭐","💫","⚡","💥","💢","💤","💯","🔥","🎉","🎊","💋","❤️‍🔥","❣️","♥️","💕","💞","🩷","🩵","💚","💜","💛","🧡","💭","🗯️","💬","🗨️","‼️","⁉️","❌","♨️","📴","🛜","📲","🔷","💠"]
    },
    {
        grupo: "Clima y Cosmos",
        anclajeDefault: "anclaje-arriba",
        iconos: ["🌈","🌧️","🌤️","⛈️","🌦️","🌛","🌙","☄️","🪐","🌕","🌑","🌒","🌘"]
    },
    {
        grupo: "Gastronomia y Bebidas",
        anclajeDefault: "anclaje-arriba",
        iconos: ["🍔","☕","🍻","🍕","🍟","🌮","🥖","🍞","🍒","🍋‍🟩","🍿","🦞","🥞","🍲","🍚","🍺","🍵","🍷","🍽️","🍴","🍹","🍸","🥂","🥢"]
    },
    {
        grupo: "Movilidad, Fiestas y Musica",
        anclajeDefault: "anclaje-arriba",
        iconos: ["🚲","🏍️","🚑","🚕","🚀","💈","🚨","🛟","🛸","🎃","🎂","🎈","🎄","🎋","🎗️","🏆","📢","🎲","🎩","🧶","🎻","🎸","🎷","🎺","🪇","🎭"]
    },
    {
        grupo: "Moda, Joyas, Salud y Oficios",
        anclajeDefault: "anclaje-arriba",
        iconos: ["💎","💸","💰","💡","🕯️","🛍️","👒","💄","💍","👜","🪭","👠","👢","🥾","👟","👞","👓","🕶️","🧬","🩹","💊","🩺","🛰️","📡","🧯","🛠️","🔨","📚","🏷️","📯","🔊","⚰️","🔮","🪬","🔑","🔐"]
    },
    {
        grupo: "Naturaleza y Animales",
        anclajeDefault: "anclaje-arriba",
        iconos: ["🕸️","🐚","🐝","🐞","🦋","🦗","🐙","🦀","🐬","🦈","🦩","🦜","🦅","🐥","🐣","🐦","🪶","🐘","🦏","🐪","🐖","🐕","🐃","🐄","🐎","🐈","🐸","🐢","🐲","🐴","🐷","🐱","🐶"]
    }
];

window.anclajeEmojiActivo = 'anclaje-arriba';
window.selectEmojiTargetId = null;

window.cargarDiccionarioEmojis = function() {
    var idsSelect = ['edit-select-efecto', 'select-efecto'];
    idsSelect.forEach(function(idSel) {
        var select = document.getElementById(idSel);
        if (!select) return;
        var valorPrevio = select.value || '|';
        select.innerHTML = '<option value="|">Sin Emoticon</option>';
        window.DICCIONARIO_EMOJIS_GRID.forEach(function(cat) {
            cat.iconos.forEach(function(emoji) {
                var optArr = document.createElement('option');
                optArr.value = 'anclaje-arriba|' + emoji;
                optArr.text = emoji + ' (Arriba)';
                select.appendChild(optArr);
                var optEsq = document.createElement('option');
                optEsq.value = 'anclaje-esquina|' + emoji;
                optEsq.text = emoji + ' (Esquina)';
                select.appendChild(optEsq);
            });
        });
        select.value = valorPrevio;
        if (!select.value) select.value = '|';
        window.convertirSelectEnBotonTecladoEmoji(select);
    });
    window.inyectarModalTecladoEmojis();
};

window.convertirSelectEnBotonTecladoEmoji = function(selectEl) {
    if (!selectEl) return;
    var btnId = 'btn-grid-' + selectEl.id;
    var btnExistente = document.getElementById(btnId);
    selectEl.style.display = 'none';
    if (!btnExistente) {
        btnExistente = document.createElement('button');
        btnExistente.type = 'button';
        btnExistente.id = btnId;
        btnExistente.className = 'input-form';
        btnExistente.style.cssText = 'margin:0; padding:8px 10px !important; font-size:12px; display:flex; align-items:center; justify-content:space-between; cursor:pointer; background:rgba(255,255,255,0.06); color:#fff; border:1px solid rgba(255,107,0,0.35); border-radius:10px;';
        btnExistente.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            window.abrirTecladoEmojisGrid(selectEl.id);
        };
        selectEl.parentNode.insertBefore(btnExistente, selectEl.nextSibling);
    }
    window.sincronizarEtiquetaBotonEmoji(selectEl.id);
};

window.sincronizarEtiquetaBotonEmoji = function(selectId) {
    var selectEl = document.getElementById(selectId);
    var btn = document.getElementById('btn-grid-' + selectId);
    if (!selectEl || !btn) return;
    var val = selectEl.value || '|';
    var partes = val.split('|');
    var emoji = partes[1] || '';
    if (emoji) {
        btn.innerHTML = '<span style="font-size:17px; line-height:1;">' + emoji + '</span><span style="font-size:10px; color:#ff6b00; font-weight:800;">Cambiar ▾</span>';
    } else {
        btn.innerHTML = '<span style="font-size:11px; color:#ccc;">😊 Emoticon</span><span style="font-size:10px; color:#ff6b00;">▾</span>';
    }
};

window.inyectarModalTecladoEmojis = function() {
    if (document.getElementById('gk-modal-teclado-emojis')) return;
    var modal = document.createElement('div');
    modal.id = 'gk-modal-teclado-emojis';
    modal.style.cssText = 'display:none; position:fixed; inset:0; z-index:200050; background:rgba(0,0,0,0.82); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); align-items:flex-end; justify-content:center; padding:0; box-sizing:border-box;';
    modal.onclick = function(e) {
        if (e.target === modal) modal.style.display = 'none';
    };

    var htmlGrupos = '';
    window.DICCIONARIO_EMOJIS_GRID.forEach(function(cat) {
        htmlGrupos += '<div style="font-size:10px; font-weight:900; color:#ff6b00; text-transform:uppercase; letter-spacing:0.8px; margin:10px 0 6px 2px;">' + cat.grupo + '</div>';
        htmlGrupos += '<div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:6px;">';
        cat.iconos.forEach(function(em) {
            htmlGrupos += '<button type="button" class="gk-emoji-key-btn" data-emoji="' + em + '" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08); border-radius:10px; height:42px; font-size:22px; display:flex; align-items:center; justify-content:center; cursor:pointer; padding:0;">' + em + '</button>';
        });
        htmlGrupos += '</div>';
    });

    modal.innerHTML =
        '<div style="background:#121217; border-top:2px solid #ff6b00; border-radius:22px 22px 0 0; width:100%; max-width:460px; max-height:76vh; display:flex; flex-direction:column; padding:14px 14px 18px 14px; box-sizing:border-box; box-shadow:0 -12px 40px rgba(0,0,0,0.95);">' +
            '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">' +
                '<strong style="color:#fff; font-size:13px; text-transform:uppercase; letter-spacing:0.8px;">Elige un Emoticon para tu PIN</strong>' +
                '<button type="button" id="gk-cerrar-teclado-emoji" style="background:rgba(255,255,255,0.08); border:none; color:#fff; width:28px; height:28px; border-radius:50%; cursor:pointer; font-weight:bold;">✕</button>' +
            '</div>' +
            '<div style="display:grid; grid-template-columns:1fr 1fr auto; gap:6px; margin-bottom:10px;">' +
                '<button type="button" id="gk-anc-arriba" style="padding:8px; border-radius:8px; border:1px solid #ff6b00; background:rgba(255,107,0,0.2); color:#fff; font-size:11px; font-weight:800; cursor:pointer;">⬆️ Corona Arriba</button>' +
                '<button type="button" id="gk-anc-esquina" style="padding:8px; border-radius:8px; border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.04); color:#aaa; font-size:11px; font-weight:800; cursor:pointer;">↗️ En Esquina</button>' +
                '<button type="button" id="gk-sin-emoji" style="padding:8px 10px; border-radius:8px; border:1px solid rgba(255,68,68,0.4); background:rgba(255,68,68,0.12); color:#ff4444; font-size:11px; font-weight:800; cursor:pointer;">🚫 Quitar</button>' +
            '</div>' +
            '<div id="gk-scroll-emojis-grid" style="overflow-y:auto; flex:1; padding-right:2px;">' +
                htmlGrupos +
            '</div>' +
        '</div>';

    document.body.appendChild(modal);

    var actualizarBotonesAnclajeUI = function() {
        var btnArr = document.getElementById('gk-anc-arriba');
        var btnEsq = document.getElementById('gk-anc-esquina');
        if (!btnArr || !btnEsq) return;
        if (window.anclajeEmojiActivo === 'anclaje-esquina') {
            btnEsq.style.borderColor = '#ff6b00';
            btnEsq.style.background = 'rgba(255,107,0,0.2)';
            btnEsq.style.color = '#fff';
            btnArr.style.borderColor = 'rgba(255,255,255,0.15)';
            btnArr.style.background = 'rgba(255,255,255,0.04)';
            btnArr.style.color = '#aaa';
        } else {
            btnArr.style.borderColor = '#ff6b00';
            btnArr.style.background = 'rgba(255,107,0,0.2)';
            btnArr.style.color = '#fff';
            btnEsq.style.borderColor = 'rgba(255,255,255,0.15)';
            btnEsq.style.background = 'rgba(255,255,255,0.04)';
            btnEsq.style.color = '#aaa';
        }
    };

    document.getElementById('gk-cerrar-teclado-emoji').onclick = function() {
        modal.style.display = 'none';
    };
    document.getElementById('gk-anc-arriba').onclick = function() {
        window.anclajeEmojiActivo = 'anclaje-arriba';
        actualizarBotonesAnclajeUI();
    };
    document.getElementById('gk-anc-esquina').onclick = function() {
        window.anclajeEmojiActivo = 'anclaje-esquina';
        actualizarBotonesAnclajeUI();
    };
    document.getElementById('gk-sin-emoji').onclick = function() {
        window.aplicarEmojiSeleccionadoGrid('|');
        modal.style.display = 'none';
    };
    modal.querySelectorAll('.gk-emoji-key-btn').forEach(function(btn) {
        btn.onclick = function() {
            var em = btn.getAttribute('data-emoji');
            window.aplicarEmojiSeleccionadoGrid(window.anclajeEmojiActivo + '|' + em);
            modal.style.display = 'none';
        };
    });
};

window.abrirTecladoEmojisGrid = function(selectId) {
    if (navigator.vibrate) navigator.vibrate(20);
    window.inyectarModalTecladoEmojis();
    window.selectEmojiTargetId = selectId;
    var sel = document.getElementById(selectId);
    if (sel && sel.value && sel.value.indexOf('anclaje-esquina') === 0) {
        window.anclajeEmojiActivo = 'anclaje-esquina';
        document.getElementById('gk-anc-esquina').click();
    } else {
        window.anclajeEmojiActivo = 'anclaje-arriba';
        document.getElementById('gk-anc-arriba').click();
    }
    var modal = document.getElementById('gk-modal-teclado-emojis');
    if (modal) modal.style.display = 'flex';
};

window.aplicarEmojiSeleccionadoGrid = function(valorCompuesto) {
    if (navigator.vibrate) navigator.vibrate(25);
    var targetId = window.selectEmojiTargetId || 'select-efecto';
    var sel = document.getElementById(targetId);
    if (sel) {
        sel.value = valorCompuesto;
        if (sel.value !== valorCompuesto) {
            var opt = document.createElement('option');
            opt.value = valorCompuesto;
            opt.text = valorCompuesto;
            sel.appendChild(opt);
            sel.value = valorCompuesto;
        }
        window.sincronizarEtiquetaBotonEmoji(targetId);
        if (targetId === 'edit-select-efecto') {
            window.actualizarPinLiveModal();
        } else {
            window.actualizarPinLive();
        }
    }
};


window.blobPinEditadoModal = null;
window.cargarPreviewPinModal = async function(input) {
    if (input.files && input.files[0]) {
        var editada = await window.GeokatuEstudio.editarImagen(input.files[0], {
            maxAncho: 500,
            maxAlto: 500,
            calidad: 0.85,
            titulo: 'Editar Imagen del PIN'
        });
        if (!editada) { input.value = ''; return; }
        window.imagenCargadaTemporalModal = editada.dataUrl;
        window.blobPinEditadoModal = editada.blob;
        window.actualizarPinLiveModal();
    }
};


window.actualizarPinLiveModal = function() {
    var forma = document.getElementById('edit-select-forma') ? document.getElementById('edit-select-forma').value : 'forma-gota';
    var anim = document.getElementById('edit-select-animacion') ? document.getElementById('edit-select-animacion').value : 'anim-salto';
    var efectoRaw = document.getElementById('edit-select-efecto') ? document.getElementById('edit-select-efecto').value : '';
    var aura = document.getElementById('edit-select-aura') ? document.getElementById('edit-select-aura').value : '';
    
    var c1 = document.getElementById('wizColorHex1') ? document.getElementById('wizColorHex1').value : '#ff6b00';
    var c2 = document.getElementById('wizColorHex2') ? document.getElementById('wizColorHex2').value : '';
    var c3 = document.getElementById('wizColorHex3') ? document.getElementById('wizColorHex3').value : '';
    var c4 = document.getElementById('wizColorHex4') ? document.getElementById('wizColorHex4').value : '';

    window.actualizarContenedorPin('edit-pin-live-preview', 'edit-img-live-preview', forma, c1, c2, c3, c4, efectoRaw, window.imagenCargadaTemporalModal || window.datosTienda.link_pin, anim, aura);
};

window.cerrarModalEdicionPinBranding = function() {
    var modal = document.getElementById('modal-diseno-pin-branding');
    if (!modal) return;
    modal.classList.remove('activo');
    setTimeout(function() { 
        modal.style.display = 'none'; 
    }, 250);
};

window.aplicarSeleccionCuarzoSincronizada = function(tema, esModal) {
    var t = String(tema || 'carbon').trim();
    var inputId = esModal ? 'edit-select-tema' : 'select-tema-onboarding';
    var topTrackId = esModal ? 'carrusel-temas-modal' : 'carrusel-temas-onboarding';
    var simBoxId = esModal ? 'modal-simulador-nombre-png' : 'fase1-simulador-nombre-png';
    var simTrackId = esModal ? 'sim-track-modal' : 'sim-track-fase1';

    var input = document.getElementById(inputId);
    if (input) input.value = t;
    window.datosTienda.tema_popup = t;

    window.renderizarCarruselesCuarzo();
    var srcImg = esModal
        ? (window.nombrePngTemporalModal || window.datosTienda.nombre_png || window.datosTienda.logo_nombre)
        : (window.nombrePngTemporalPaso1 || window.datosTienda.nombre_png || window.datosTienda.logo_nombre);
    if (srcImg) {
        window.renderizarSimuladorNombrePng(srcImg, 2.5, simBoxId);
    }

    // Centrar suavemente el chip arriba y la tarjeta abajo en sincronía
    setTimeout(function() {
        var topTrack = document.getElementById(topTrackId);
        if (topTrack) {
            var targetKey = t.indexOf('custom:') === 0 ? 'custom' : t;
            var chip = topTrack.querySelector('[data-tema="' + targetKey + '"]');
            if (chip) chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
        var simTrack = document.getElementById(simTrackId);
        if (simTrack) {
            var card = simTrack.querySelector('[data-sim-tema="' + t + '"]');
            if (card) card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }, 40);
};

window.seleccionarTemaPopupModal = function(tema) {
    window.aplicarSeleccionCuarzoSincronizada(tema, true);
};

window.seleccionarTemaPopupOnboarding = function(tema) {
    window.aplicarSeleccionCuarzoSincronizada(tema, false);
};

window.contextoCuarzoPersonalizado = null;
window.abrirRuedaParaCuarzoPersonalizado = function(origen) {
    window.contextoCuarzoPersonalizado = origen;
    window.abrirSelectorColor('CUARZO_CUSTOM');
};


window.abrirModalEdicionPinBranding = function() {
    var modal = document.getElementById('modal-diseno-pin-branding');
    if (!modal) return;

    if (window.datosTienda.pin_pack) {
        var p = window.datosTienda.pin_pack.split('|');
        if (document.getElementById('edit-select-forma')) document.getElementById('edit-select-forma').value = p[0] || 'forma-gota';
        if (document.getElementById('edit-select-animacion')) document.getElementById('edit-select-animacion').value = p[1] || 'anim-salto';
        if (document.getElementById('edit-select-efecto') && p.length > 2) document.getElementById('edit-select-efecto').value = p[2] + '|' + (p[3] || '');
        if (document.getElementById('edit-select-aura') && p.length > 4) document.getElementById('edit-select-aura').value = p[4] || '';
    }
    if (window.datosTienda.color_principal) window.setSlotColor(1, window.datosTienda.color_principal);
    if (window.datosTienda.color_acento) window.setSlotColor(2, window.datosTienda.color_acento);
    if (window.datosTienda.color_terciario) window.setSlotColor(3, window.datosTienda.color_terciario);

    var actualNombrePng = window.datosTienda.nombre_png;
    var imgM = document.getElementById('modal-img-nombre-preview');
    var phM = document.getElementById('modal-placeholder-nombre');
    if (actualNombrePng) {
        if (imgM) { imgM.src = actualNombrePng; imgM.style.display = 'block'; }
        if (phM) phM.style.display = 'none';
    } else {
        if (imgM) { imgM.src = ''; imgM.style.display = 'none'; }
        if (phM) phM.style.display = 'flex';
    }

    var inTags = document.getElementById('edit-palabras-clave-branding');
    if (inTags) {
        inTags.value = window.datosTienda.palabras_clave || '';
    }

    window.actualizarPinLiveModal();


    modal.style.display = 'flex';
    setTimeout(function() { modal.classList.add('activo'); }, 10);
};


window.procesarGuardadoPinBrandingModal = async function() {
    var forma = document.getElementById('edit-select-forma').value;
    var anim = document.getElementById('edit-select-animacion') ? document.getElementById('edit-select-animacion').value : 'anim-salto';
    var efecto = document.getElementById('edit-select-efecto') ? document.getElementById('edit-select-efecto').value : '';
    var aura = document.getElementById('edit-select-aura') ? document.getElementById('edit-select-aura').value : '';
    var tema = document.getElementById('edit-select-tema') ? document.getElementById('edit-select-tema').value : 'carbon';

    var c1 = document.getElementById('wizColorHex1').value;
    var c2 = document.getElementById('wizColorHex2').value;
    var c3 = document.getElementById('wizColorHex3').value;
    var c4 = document.getElementById('wizColorHex4') ? document.getElementById('wizColorHex4').value : '';

    var paleta = window.calcularPaletaAureaSilenciosa(c1, c2, c3, c4);
        var inTags = document.getElementById('edit-palabras-clave-branding');
    var tagsVal = inTags ? inTags.value.trim().toLowerCase() : '';

    var pinPack = forma + '|' + anim + '|' + efecto + '|' + aura;
    var payload = { 
        pin_pack: pinPack, 
        color_principal: paleta.c1, 
        color_acento: paleta.c2, 
        color_terciario: paleta.c3,
        color_cuaternario: paleta.c4,
        paleta_aurea: paleta,
        palabras_clave: tagsVal
    };

var stamp = Date.now();
    var blobPinSubir = window.blobPinEditadoModal || window.dataUrlABlob(window.imagenCargadaTemporalModal);
    if (blobPinSubir) {
        var resPin = await GeokatuDB.AdminService.subirArchivo('tiendas/' + window.idNegocioLogueado + '/pin_mapa_' + stamp + '.webp', blobPinSubir, 'image/webp');
        var urlPin = (typeof resPin === 'string') ? resPin : (resPin && resPin.data ? resPin.data : '');
        if (urlPin) payload.link_pin = urlPin;
        window.blobPinEditadoModal = null;
    }
    var blobNomModal = window.blobNombrePngEditadoModal || window.dataUrlABlob(window.nombrePngTemporalModal);
    if (blobNomModal) {
        var resNomModal = await GeokatuDB.AdminService.subirArchivo('tiendas/' + window.idNegocioLogueado + '/nombre_png_' + stamp + '.webp', blobNomModal, 'image/webp');
        var urlNomModal = (typeof resNomModal === 'string') ? resNomModal : (resNomModal && resNomModal.data ? resNomModal.data : '');
        if (urlNomModal) {
            payload.nombre_png = urlNomModal;
            payload.logo_nombre = urlNomModal;
            var uiPng = document.getElementById('ui-nombre-png');
            var uiTxt = document.getElementById('ui-nombre');
            if (uiPng) { uiPng.src = urlNomModal; uiPng.style.display = 'block'; }
            if (uiTxt) uiTxt.style.display = 'none';
        }
        window.blobNombrePngEditadoModal = null;
    }
    window.sincronizarEtiquetaBotonEmoji('edit-select-efecto');
    await GeokatuDB.AdminService.actualizarNegocio(window.idNegocioLogueado, payload);
    Object.assign(window.datosTienda, payload);
    if (navigator.vibrate) navigator.vibrate([40, 60]);
    alert("✅ ADN y Branding actualizados correctamente.");
    var modal = document.getElementById('modal-diseno-pin-branding');
    if (modal) {
        modal.classList.remove('activo');
        modal.style.display = 'none';
    }
    if (window.miniMapaPerfil) {
        window.miniMapaPerfil.remove();
        window.miniMapaPerfil = null;
    }
};


// ============================================================================
// BLOQUE 7: RUEDA CROMÁTICA ESPECTRAL Y PALETA ÁUREA (ZERO ${})
// ============================================================================
window.hslToHex = function(h, s, l) {
    l /= 100;
    var a = s * Math.min(l, 1 - l) / 100;
    var f = function(n) {
        var k = (n + h / 30) % 12;
        return Math.round(255 * (l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1))).toString(16).padStart(2, '0');
    };
    return ('#' + f(0) + f(8) + f(4)).toUpperCase();
};

window.hexToHSL = function(hex) {
    var r = parseInt(hex.slice(1, 3), 16) / 255;
    var g = parseInt(hex.slice(3, 5), 16) / 255;
    var b = parseInt(hex.slice(5, 7), 16) / 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        var d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
};

window.abrirSelectorColor = function(slot) {
    window.slotColorActual = slot;
    var modalColor = document.getElementById('modal-color-espectro');
    var inputHex = document.getElementById('input-hex-manual');
    var slider = document.getElementById('slider-brillo');

    var inputSlot = document.getElementById('wizColorHex' + slot);
    var colorActual = inputSlot ? inputSlot.value : '#ff6b00';
    if (inputHex) inputHex.value = (colorActual || '#ff6b00').replace('#', '');

    try {
        var hsl = window.hexToHSL(colorActual || '#ff6b00');
        window.estadoColorCustom.h = hsl.h;
        window.estadoColorCustom.l_base = Math.max(50, hsl.l);
        if (slider) {
            slider.value = 100;
            var pureHex = window.hslToHex(hsl.h, 100, window.estadoColorCustom.l_base);
            slider.style.background = 'linear-gradient(to right, black, ' + pureHex + ')';
        }
    } catch (e) {
        console.warn("Fallo cálculo HSL:", e);
    }

    if (modalColor) {
        modalColor.style.display = 'flex';
        modalColor.classList.add('activo');
    }
};

window.cerrarModalColorManual = function() {
    var modalColor = document.getElementById('modal-color-espectro');
    if (modalColor) {
        modalColor.classList.remove('activo');
        setTimeout(function() { modalColor.style.display = 'none'; }, 200);
    }
};


window.setSlotColor = function(slot, hex) {
    var input = document.getElementById('wizColorHex' + slot);
    var wrappers = document.querySelectorAll('[data-slot="' + slot + '"]');
    if (input) {
        input.value = hex;
        wrappers.forEach(function(w) { w.style.background = hex; });
        if (slot === 1) {
            var p1 = document.getElementById('edit-pin-live-preview');
            var p2 = document.getElementById('pin-live-preview');
            if (p1) p1.style.setProperty('--color-main', hex);
            if (p2) p2.style.setProperty('--color-main', hex);
        }
    }
};

window.eliminarColor = function(slot) {
    document.querySelectorAll('#color-slot-' + slot + ', #color-slot-' + slot + '-modal').forEach(function(el) {
        el.style.display = 'none';
    });
    document.querySelectorAll('#add-slot-' + slot + ', #add-slot-' + slot + '-modal').forEach(function(el) {
        el.style.display = 'flex';
    });
    var input = document.getElementById('wizColorHex' + slot);
    if (input) input.value = "";
};

window.agregarColor = function(slot) {
    document.querySelectorAll('#add-slot-' + slot + ', #add-slot-' + slot + '-modal').forEach(function(el) {
        el.style.display = 'none';
    });
    document.querySelectorAll('#color-slot-' + slot + ', #color-slot-' + slot + '-modal').forEach(function(el) {
        el.style.display = 'flex';
    });
    var defaults = { 2: "#ffffff", 3: "#0a0a0c", 4: "#00f5d4" };
    var input = document.getElementById('wizColorHex' + slot);
    if (input) input.value = defaults[slot];

    var swatches = document.querySelectorAll('[data-slot="' + slot + '"]');
    swatches.forEach(function(swatch) { swatch.style.background = defaults[slot]; });
};

window.confirmarColorSeleccionado = function() {
    var input = document.getElementById('input-hex-manual');
    var hex = input ? input.value.trim().replace('#', '') : '';
    var esHexValido = (hex.length === 6 || hex.length === 3) && !isNaN(parseInt(hex, 16));
    if (esHexValido) {
        var colorFinal = '#' + hex.toUpperCase();
        if (window.slotColorActual === 'CUARZO_CUSTOM') {
            var esModal = (window.contextoCuarzoPersonalizado === 'modal');
            window.aplicarSeleccionCuarzoSincronizada('custom:' + colorFinal, esModal);
        } else {
            window.setSlotColor(window.slotColorActual, colorFinal);
        }
        window.cerrarModalColorManual();
    } else {
        alert("Código de color inválido.");
    }
};
window.sincronizarColorDesdeHex = function(valorIngresado) {
    var hexLimpio = valorIngresado.replace('#', '').trim();
    var input = document.getElementById('input-hex-manual');
    var esHexValido = (hexLimpio.length === 6 || hexLimpio.length === 3) && !isNaN(parseInt(hexLimpio, 16));
    if (esHexValido) {
        var colorValido = '#' + hexLimpio.toUpperCase();
        if (input) input.style.borderColor = '#00ff64';
        if (window.slotColorActual && window.slotColorActual !== 'CUARZO_CUSTOM') {
            window.setSlotColor(window.slotColorActual, colorValido);
        }
    } else {
        if (input) input.style.borderColor = '#ff4444';
    }
};
// Controladores táctiles y de puntero 100% calibrados con conic-gradient(from 90deg)
var rueda = document.getElementById('rueda-colores');
var sliderBrillo = document.getElementById('slider-brillo');
var draggingWheel = false;
var calcularColorRueda = function(e) {
    if (!rueda) return;
    var rect = rueda.getBoundingClientRect();
    var clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
    var clientY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;
    var maxRadio = rect.width / 2;
    var x = clientX - rect.left - maxRadio;
    var y = clientY - rect.top - maxRadio;
    var radio = Math.sqrt(x * x + y * y);
    if (radio > maxRadio) {
        x = (x / radio) * maxRadio;
        y = (y / radio) * maxRadio;
        radio = maxRadio;
    }
    var puntero = document.getElementById('puntero-color');
    if (puntero) {
        puntero.style.left = (x + maxRadio) + 'px';
        puntero.style.top = (y + maxRadio) + 'px';
    }
    // En conic-gradient(from 90deg), 0° (Rojo) está a las 3 en punto (eje +X), idéntico a Math.atan2(y, x)
    var angle = Math.atan2(y, x) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    window.estadoColorCustom.h = Math.round(angle);
    window.estadoColorCustom.l_base = 100 - ((radio / maxRadio) * 50);
    actualizarPreviewCustom();
};
setTimeout(function() { window.renderizarCarruselesCuarzo(); }, 200);


var actualizarPreviewCustom = function() {
    if (!sliderBrillo) return;
    var factorBrillo = sliderBrillo.value / 100;
    var l_final = window.estadoColorCustom.l_base * factorBrillo;
    var hex = window.hslToHex(window.estadoColorCustom.h, 100, l_final);

    var inputHex = document.getElementById('input-hex-manual');
    if (inputHex) {
        inputHex.value = hex.replace('#', '');
        inputHex.style.borderColor = '#00ff64';
    }

    var pureHex = window.hslToHex(window.estadoColorCustom.h, 100, window.estadoColorCustom.l_base);
    sliderBrillo.style.background = 'linear-gradient(to right, black, ' + pureHex + ')';

    if (window.slotColorActual) window.setSlotColor(window.slotColorActual, hex);
};

if (rueda) {
    rueda.addEventListener('mousedown', function(e) { draggingWheel = true; calcularColorRueda(e); });
    rueda.addEventListener('mousemove', function(e) { if (draggingWheel) calcularColorRueda(e); });
    window.addEventListener('mouseup', function() { draggingWheel = false; });
    rueda.addEventListener('touchstart', function(e) { draggingWheel = true; calcularColorRueda(e); }, { passive: false });
    rueda.addEventListener('touchmove', function(e) { if (draggingWheel) { e.preventDefault(); calcularColorRueda(e); } }, { passive: false });
    window.addEventListener('touchend', function() { draggingWheel = false; });
}

if (sliderBrillo) {
    sliderBrillo.addEventListener('input', actualizarPreviewCustom);
}
// ============================================================================
// BLOQUE 8: PERFIL GEOESPACIAL, MINIMAPA & GEMELO DIGITAL (RESTAURADO)
// ============================================================================
window.CIUDADES_LOCALES_OFICINA = [
    { nombre: "Pereira, Colombia", lat: 4.8133, lng: -75.6961 },
    { nombre: "Dosquebradas, Colombia", lat: 4.8365, lng: -75.6725 },
    { nombre: "Bogota, Colombia", lat: 4.6097, lng: -74.0817 },
    { nombre: "Medellin, Colombia", lat: 6.2476, lng: -75.5658 },
    { nombre: "Cali, Colombia", lat: 3.4516, lng: -76.5320 },
    { nombre: "Barranquilla, Colombia", lat: 10.9685, lng: -74.7813 },
    { nombre: "Armenia, Colombia", lat: 4.5339, lng: -75.6811 },
    { nombre: "Manizales, Colombia", lat: 5.0689, lng: -75.5174 },
    { nombre: "Caracas, Venezuela", lat: 10.4806, lng: -66.9036 },
    { nombre: "Maracaibo, Venezuela", lat: 10.6666, lng: -71.6124 },
    { nombre: "Valencia, Venezuela", lat: 10.1620, lng: -68.0077 },
    { nombre: "San Cristobal / Tachira, Venezuela", lat: 7.7794, lng: -72.2247 },
    { nombre: "Lobatera, Tachira, Venezuela", lat: 7.9302, lng: -72.2442 }
];

window.resolverCoordenadaLocalOficina = function(queryRaw) {
    var q = String(queryRaw || '').trim();
    if (!q) return null;
    var matchCoords = q.match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/);
    if (matchCoords) {
        return { lat: parseFloat(matchCoords[1]), lng: parseFloat(matchCoords[2]) };
    }
    var qLow = q.toLowerCase();
    var ciudad = window.CIUDADES_LOCALES_OFICINA.find(function(c) {
        return c.nombre.toLowerCase().indexOf(qLow) !== -1;
    });
    if (ciudad) return { lat: ciudad.lat, lng: ciudad.lng };
    return null;
};

window.obtenerDireccionGeocoding = function(lat, lng, targetInputId) {
    var el = document.getElementById(targetInputId);
    if (!el) return;
    var latF = Number(lat).toFixed(5);
    var lngF = Number(lng).toFixed(5);
    if (!el.value || el.value.indexOf('Coord:') === 0) {
        el.value = 'Coord: ' + latF + ', ' + lngF;
    }
};

window.buscarDireccionSandbox = async function(inputId, mapa, marker) {
    var inEl = document.getElementById(inputId);
    if (!inEl) return;
    var query = inEl.value.trim();
    if (!query) return;
    var destino = window.resolverCoordenadaLocalOficina(query);
    if (destino) {
        var lat = destino.lat;
        var lng = destino.lng;
        if (mapa) mapa.flyTo({ center: [lng, lat], zoom: 16, duration: 1200 });
        if (marker) marker.setLngLat([lng, lat]);
        var inLat = document.getElementById('perfilLat');
        var inLng = document.getElementById('perfilLng');
        if (inLat) inLat.value = lat;
        if (inLng) inLng.value = lng;
        var hash = window.generarGeohash(lat, lng);
        var paisAuto = window.detectarPaisPorCoordenadas(lat, lng);
        window.datosTienda.Coordenadas = { latitude: lat, longitude: lng };
        window.datosTienda.direccion = query;
        window.datosTienda.pais = paisAuto;
        localStorage.setItem('geokatu_pais_' + window.idNegocioLogueado, paisAuto);
        await GeokatuDB.AdminService.actualizarNegocio(window.idNegocioLogueado, {
            Coordenadas: window.datosTienda.Coordenadas,
            direccion: query,
            geohash: hash,
            pais: paisAuto
        });
        if (navigator.vibrate) navigator.vibrate([40, 40]);
    } else {
        window.datosTienda.direccion = query;
        await GeokatuDB.AdminService.actualizarNegocio(window.idNegocioLogueado, { direccion: query });
        alert("Direccion textual guardada. Arrastra el pin en el mapa o pulsa el boton GPS para fijar el punto exacto.");
    }
};


window.obtenerUbicacionActualPerfil = function() {
    if (!navigator.geolocation) {
        return alert("Tu dispositivo o navegador no admite GPS.");
    }
    if (navigator.vibrate) navigator.vibrate(30);

    var btn = document.getElementById('btn-geo-perfil');
    if (btn) btn.style.transform = "scale(0.9)";

    navigator.geolocation.getCurrentPosition(async function(pos) {
        if (btn) btn.style.transform = "scale(1)";
        var lat = pos.coords.latitude;
        var lng = pos.coords.longitude;

        if (window.miniMapaPerfil) {
            window.miniMapaPerfil.flyTo({ center: [lng, lat], zoom: 17, duration: 1200 });
        }
        if (window.pinMiniMapaPerfil) {
            window.pinMiniMapaPerfil.setLngLat([lng, lat]);
        }

        var inLat = document.getElementById('perfilLat');
        var inLng = document.getElementById('perfilLng');
        if (inLat) inLat.value = lat;
        if (inLng) inLng.value = lng;

        window.obtenerDireccionGeocoding(lat, lng, 'perfilDireccion');

        var hash = window.generarGeohash(lat, lng);
        var paisAuto = window.detectarPaisPorCoordenadas(lat, lng);

        window.datosTienda.Coordenadas = { latitude: lat, longitude: lng };
        window.datosTienda.pais = paisAuto;
        localStorage.setItem('geokatu_pais_' + window.idNegocioLogueado, paisAuto);

        await GeokatuDB.AdminService.actualizarNegocio(window.idNegocioLogueado, {
            Coordenadas: window.datosTienda.Coordenadas,
            geohash: hash,
            pais: paisAuto
        });

        if (navigator.vibrate) navigator.vibrate([50, 100, 50]);
    }, function(err) {
        if (btn) btn.style.transform = "scale(1)";
        console.warn("[GPS Perfil] Error:", err);
        alert("No se pudo obtener la señal GPS. Revisa los permisos de ubicación de tu dispositivo.");
    }, { enableHighAccuracy: true, timeout: 10000 });
};


window.subTabCuentaActiva = 'identidad';

window.montarBrandingEnSubTabCuenta = function() {
    var slot = document.getElementById('ancla-subtab-branding-slot');
    var modalBrand = document.getElementById('modal-diseno-pin-branding');
    if (!slot || !modalBrand) return;
    var cardInterna = modalBrand.querySelector('.foco-onboarding');
    if (cardInterna && cardInterna.parentElement !== slot) {
        var btnDiskette = document.getElementById('btn-guardar-edicion-branding');
        if (btnDiskette) btnDiskette.style.display = 'none';
        cardInterna.style.width = '100%';
        cardInterna.style.maxWidth = '100%';
        cardInterna.style.margin = '0';
        cardInterna.style.border = 'none';
        cardInterna.style.padding = '4px 0';
        cardInterna.style.background = 'transparent';
        slot.appendChild(cardInterna);
    }
    window.hidratarControlesBrandingCuenta();
};

window.hidratarControlesBrandingCuenta = function() {
    if (window.datosTienda.pin_pack) {
        var p = window.datosTienda.pin_pack.split('|');
        if (document.getElementById('edit-select-forma')) document.getElementById('edit-select-forma').value = p[0] || 'forma-gota';
        if (document.getElementById('edit-select-animacion')) document.getElementById('edit-select-animacion').value = p[1] || 'anim-salto';
        if (document.getElementById('edit-select-efecto') && p.length > 2) {
            document.getElementById('edit-select-efecto').value = p[2] + '|' + (p[3] || '');
            window.sincronizarEtiquetaBotonEmoji('edit-select-efecto');
        }
        if (document.getElementById('edit-select-aura') && p.length > 4) document.getElementById('edit-select-aura').value = p[4] || '';
    }
    if (window.datosTienda.tema_popup) {
        window.seleccionarTemaPopupModal(window.datosTienda.tema_popup);
    }
    if (window.datosTienda.color_principal) window.setSlotColor(1, window.datosTienda.color_principal);
    if (window.datosTienda.color_acento) window.setSlotColor(2, window.datosTienda.color_acento);
    if (window.datosTienda.color_terciario) window.setSlotColor(3, window.datosTienda.color_terciario);
    if (window.datosTienda.color_cuaternario) window.setSlotColor(4, window.datosTienda.color_cuaternario);
    var actualNombrePng = window.datosTienda.nombre_png || window.datosTienda.logo_nombre;
    var imgM = document.getElementById('modal-img-nombre-preview');
    var phM = document.getElementById('modal-placeholder-nombre');
    if (actualNombrePng) {
        if (imgM) { imgM.src = actualNombrePng; imgM.style.display = 'block'; }
        if (phM) phM.style.display = 'none';
        window.renderizarSimuladorNombrePng(actualNombrePng, 2.5, 'modal-simulador-nombre-png');
    } else {
        if (imgM) { imgM.src = ''; imgM.style.display = 'none'; }
        if (phM) phM.style.display = 'flex';
    }
    var inTags = document.getElementById('edit-palabras-clave-branding');
    if (inTags) inTags.value = window.datosTienda.palabras_clave || '';
    window.actualizarPinLiveModal();
};

window.hidratarFormularioCuentaDashboard = function() {
    var t = window.datosTienda || {};
    var setVal = function(id, val) { var el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('cta-nombre', t.nombre);
    setVal('cta-slogan', t.slogan);
    setVal('cta-nicho', t.nicho || t.categoria);
    setVal('cta-whatsapp', t.whatsapp || t.whatsApp);
    setVal('cta-pbx', t.pbx);
    setVal('cta-correo', t.correo_interno || t.correo || t.email);
    setVal('cta-instagram', String(t.instagram || '').replace(/^@/, ''));
    setVal('cta-web', t.sitio_web || t.web);
    setVal('cta-pin-titular', (t.pin_titular && /^\d{4}$/.test(String(t.pin_titular))) ? t.pin_titular : '0000');
    var chkCor = document.getElementById('cta-check-correo-publico');
    if (chkCor) chkCor.checked = Boolean(t.mostrar_correo_publico === true);
    var chk24 = document.getElementById('cta-check-24h');
    var es24 = Boolean(t.es_24_horas);
    if (chk24) chk24.checked = es24;
    var boxHoras = document.getElementById('cta-rango-horas');
    if (boxHoras) {
        boxHoras.style.opacity = es24 ? '0.35' : '1';
        boxHoras.style.pointerEvents = es24 ? 'none' : 'auto';
    }
    if (!es24 && t.horario && t.horario.indexOf('-') !== -1) {
        var ph = t.horario.split('-').map(function(s) { return s.trim(); });
        setVal('cta-hora-inicio', ph[0] || '08:00');
        setVal('cta-hora-fin', ph[1] || '20:00');
    }
};

window.guardarCuentaIdentidadDashboard = async function() {
    var btn = document.getElementById('btn-guardar-cta-identidad');
    var nom = (document.getElementById('cta-nombre')?.value || '').trim();
    var nic = (document.getElementById('cta-nicho')?.value || '').trim();
    var wa = (document.getElementById('cta-whatsapp')?.value || '').trim().replace(/\D/g, '');
    var pbx = (document.getElementById('cta-pbx')?.value || '').trim();
    var pinTitular = (document.getElementById('cta-pin-titular')?.value || '0000').trim();
    if (!nom) return alert("El nombre comercial es obligatorio.");
    if (!/^\d{4}$/.test(pinTitular)) return alert("El PIN Titular debe ser de 4 dígitos numéricos.");
    var es24 = Boolean(document.getElementById('cta-check-24h')?.checked);
    var horarioStr = es24
        ? "24 Horas"
        : ((document.getElementById('cta-hora-inicio')?.value || '08:00') + " - " + (document.getElementById('cta-hora-fin')?.value || '20:00'));
    var mostrarCor = Boolean(document.getElementById('cta-check-correo-publico')?.checked);
    var correoIn = (document.getElementById('cta-correo')?.value || '').trim();
    var igVal = (document.getElementById('cta-instagram')?.value || '').trim().replace(/^@/, '');
    var webVal = (document.getElementById('cta-web')?.value || '').trim();
    var payload = {
        nombre: nom,
        slogan: (document.getElementById('cta-slogan')?.value || '').trim(),
        cuerpo_articulo: (document.getElementById('cta-slogan')?.value || '').trim(),
        nicho: nic || "General",
        categoria: nic || "General",
        categoria_maestra: nic || "General",
        whatsapp: wa,
        whatsApp: wa,
        telefonos: wa ? [wa] : [],
        pbx: pbx,
        correo_interno: correoIn,
        correo: mostrarCor ? correoIn : "",
        email: mostrarCor ? correoIn : "",
        mostrar_correo_publico: mostrarCor,
        instagram: igVal,
        web: webVal,
        sitio_web: webVal,
        horario: horarioStr,
        es_24_horas: es24,
        pin_titular: pinTitular
    };
    if (btn) { btn.disabled = true; btn.innerText = "Guardando..."; }
    try {
        await GeokatuDB.AdminService.actualizarNegocio(window.idNegocioLogueado, payload);
        try {
            await setDoc(doc(db, "Directorio_Contacto", window.idNegocioLogueado), {
                id: window.idNegocioLogueado,
                whatsapp: wa,
                telefonos: wa ? [wa] : [],
                pbx: pbx,
                correo: mostrarCor ? correoIn : "",
                mostrar_correo_publico: mostrarCor,
                instagram: igVal,
                web: webVal,
                fecha_actualizacion: new Date().toISOString()
            }, { merge: true });
        } catch (eC) {}
        Object.assign(window.datosTienda, payload);
        localStorage.setItem('geokatu_cajero_pin', pinTitular);
        var elNom = document.getElementById('ui-nombre');
        if (elNom) elNom.innerText = nom;
        alert("✅ Identidad, canales y horarios actualizados.");
    } catch (e) {
        alert("Error al guardar: " + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = "Guardar Identidad y Canales"; }
    }
};

window.cambiarSubTabCuenta = function(subTab) {
    if (navigator.vibrate) navigator.vibrate(20);
    window.subTabCuentaActiva = subTab;
    var mapIds = {
        identidad: { panel: 'subtab-cuenta-identidad', btn: 'btn-subtab-identidad' },
        branding: { panel: 'subtab-cuenta-branding', btn: 'btn-subtab-branding' },
        mapa: { panel: 'subtab-cuenta-mapa', btn: 'btn-subtab-mapa' }
    };
    Object.keys(mapIds).forEach(function(k) {
        var p = document.getElementById(mapIds[k].panel);
        var b = document.getElementById(mapIds[k].btn);
        if (p) p.style.display = (k === subTab) ? 'flex' : 'none';
        if (b) b.classList.toggle('activo', k === subTab);
    });
    if (subTab === 'branding') {
        window.montarBrandingEnSubTabCuenta();
    } else if (subTab === 'mapa') {
        var coords = window.datosTienda.Coordenadas || { latitude: 4.8133, longitude: -75.6961 };
        var lat = coords.latitude || coords._lat || 4.8133;
        var lng = coords.longitude || coords._long || -75.6961;
        setTimeout(function() { window.inicializarMiniMapaPerfil(lat, lng); }, 120);
    }
};

window.mostrarGuiaCuentaOficina = function() {
    if (navigator.vibrate) navigator.vibrate(25);
    var existente = document.getElementById('gk-guia-fase-modal');
    if (existente) existente.remove();
    var overlay = document.createElement('div');
    overlay.id = 'gk-guia-fase-modal';
    overlay.style.cssText = 'position:fixed; inset:0; z-index:200100; background:rgba(0,0,0,0.82); backdrop-filter:blur(10px); display:flex; align-items:center; justify-content:center; padding:18px; box-sizing:border-box;';
    overlay.innerHTML =
        '<div style="background:#14141a; border:1px solid rgba(255,107,0,0.45); border-radius:20px; width:100%; max-width:370px; padding:20px 18px; box-sizing:border-box; display:flex; flex-direction:column; gap:10px; text-align:center;">' +
            '<div style="display:inline-flex; align-self:center; background:rgba(255,107,0,0.15); color:#ff6b00; border:1px solid rgba(255,107,0,0.4); border-radius:20px; padding:3px 10px; font-size:10px; font-weight:900; text-transform:uppercase;">Guia de Cuenta Comercial</div>' +
            '<h3 style="margin:0; color:#fff; font-size:14.5px; font-weight:900; text-transform:uppercase;">Tus 3 Fases en un solo lugar</h3>' +
            '<div style="display:flex; flex-direction:column; gap:8px; text-align:left; font-size:11.5px; color:#ddd; line-height:1.4;">' +
                '<div style="background:rgba(255,255,255,0.04); border-left:3px solid #ff6b00; border-radius:8px; padding:8px 10px;"><strong>1. Identidad:</strong> Edita tu nombre, slogan, WhatsApp, PBX, horarios, foto de perfil, portada y tu PIN de 4 digitos.</div>' +
                '<div style="background:rgba(255,255,255,0.04); border-left:3px solid #ff6b00; border-radius:8px; padding:8px 10px;"><strong>2. ADN & Pin:</strong> Personaliza la silueta de tu pin, emoticon en cuadricula, paleta de colores y previsualiza a escala real tu logotipo tipografico sin fondo.</div>' +
                '<div style="background:rgba(255,255,255,0.04); border-left:3px solid #ff6b00; border-radius:8px; padding:8px 10px;"><strong>3. Ubicacion:</strong> Arrastra tu pin en el mapa para ajustar la coordenada exacta y tocalo para ver tu tarjeta Gemelo Digital identica al radar ciudadano.</div>' +
            '</div>' +
            '<button type="button" onclick="this.closest(\'#gk-guia-fase-modal\').remove()" style="width:100%; padding:11px; border-radius:12px; border:none; background:linear-gradient(135deg, #ff8c00, #ff6b00); color:#fff; font-size:12px; font-weight:900; text-transform:uppercase; cursor:pointer; margin-top:4px;">Entendido</button>' +
        '</div>';
    document.body.appendChild(overlay);
};

window.inicializarMiniMapaPerfil = function(latInicial, lngInicial) {
    var defaultLat = Number(latInicial) || 4.8133;
    var defaultLng = Number(lngInicial) || -75.6961;
    if (!window.miniMapaPerfil) {
        window.miniMapaPerfil = new maplibregl.Map({
            container: 'mini-mapa-perfil',
            style: 'estilo-fresco.json',
            center: [defaultLng, defaultLat],
            zoom: 16,
            attributionControl: false
        });
    } else {
        window.miniMapaPerfil.setCenter([defaultLng, defaultLat]);
        window.miniMapaPerfil.resize();
    }
    if (window.pinMiniMapaPerfil) {
        window.pinMiniMapaPerfil.remove();
    }
    var p = window.datosTienda || {};
    var fClass = 'forma-gota', aClass = 'anim-salto', eEmoji = '', eAnclaje = '', auraClase = '';
    if (p.pin_pack) {
        var partes = p.pin_pack.split('|');
        fClass = partes[0] || 'forma-gota';
        aClass = partes[1] || 'anim-salto';
        if (partes.length > 2) { eAnclaje = partes[2] || ''; eEmoji = partes[3] || ''; }
        if (partes.length > 4) { auraClase = partes[4] || ''; }
    }
    var paleta = window.calcularPaletaAureaSilenciosa(p.color_principal, p.color_acento, p.color_terciario, p.color_cuaternario);
    // Prioridad exclusiva a link_pin para que la foto de portada jamas pise la foto del PIN
    var fotoPin = p.link_pin || p.logo || p.portada || '';
    var emojiAttr = (eEmoji && eEmoji !== '|') ? 'data-emoji="' + eEmoji + '" data-anclaje="' + eAnclaje + '"' : '';
    var cssVars = '--color-main: ' + paleta.c1 + '; --color-sec: ' + paleta.c2 + '; --color-ter: ' + paleta.c3 + '; --color-cuat: ' + paleta.c4 + ';';

    var elPunto = document.createElement('div');
    elPunto.style.width = '60px';
    elPunto.style.height = '60px';
    elPunto.style.display = 'flex';
    elPunto.style.justifyContent = 'center';
    elPunto.style.alignItems = 'center';
    elPunto.style.cursor = 'pointer';
    elPunto.innerHTML =
        '<div id="pin-render-perfil" class="pin-wrapper ' + fClass + ' ' + aClass + ' ' + auraClase + '" data-forma="' + fClass + '" style="' + cssVars + '" ' + emojiAttr + '>' +
            window.obtenerContenidoSVG(fClass, fotoPin, 'img-pin-perfil') +
        '</div>';

    var popup = window.construirPopupIdenticoMotorMapa(p, paleta);
    window.pinMiniMapaPerfil = new maplibregl.Marker({
        element: elPunto,
        draggable: true,
        anchor: 'bottom'
    })
    .setLngLat([defaultLng, defaultLat])
    .setPopup(popup)
    .addTo(window.miniMapaPerfil);

    window.pinMiniMapaPerfil.on('dragend', async function() {
        var pos = window.pinMiniMapaPerfil.getLngLat();
        var inputLat = document.getElementById('perfilLat');
        var inputLng = document.getElementById('perfilLng');
        if (inputLat) inputLat.value = pos.lat;
        if (inputLng) inputLng.value = pos.lng;
        window.obtenerDireccionGeocoding(pos.lat, pos.lng, 'perfilDireccion');
        var hash = window.generarGeohash(pos.lat, pos.lng);
        window.datosTienda.Coordenadas = { latitude: pos.lat, longitude: pos.lng };
        await GeokatuDB.AdminService.actualizarNegocio(window.idNegocioLogueado, {
            Coordenadas: window.datosTienda.Coordenadas,
            lat: pos.lat,
            lng: pos.lng,
            geohash: hash
        });
    });

    var inLat = document.getElementById('perfilLat');
    var inLng = document.getElementById('perfilLng');
    if (inLat) inLat.value = defaultLat;
    if (inLng) inLng.value = defaultLng;
    window.obtenerDireccionGeocoding(defaultLat, defaultLng, 'perfilDireccion');
    [100, 300, 600].forEach(function(ms) {
        setTimeout(function() {
            if (window.miniMapaPerfil) window.miniMapaPerfil.resize();
        }, ms);
    });
};

// Genera exactamente al milimetro el mismo Popup que motor-mapa.js
window.construirPopupIdenticoMotorMapa = function(p, paleta) {
    var esTemaClasico = (p.tema_popup === 'clasico');
    var c1 = paleta.c1 || '#ff6b00';
    var cBtn = paleta.c3 || paleta.c2 || c1;
    var r = parseInt(cBtn.replace('#', '').substring(0, 2), 16) || 0;
    var g = parseInt(cBtn.replace('#', '').substring(2, 4), 16) || 0;
    var b = parseInt(cBtn.replace('#', '').substring(4, 6), 16) || 0;
    var yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    var colorTextoBtn = (yiq >= 145) ? '#0a0a0c' : '#ffffff';
    var colorSlogan = paleta.c2 || '#8a909d';
    var portadaUsada = p.portada || 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=1080';
    var logoUsado = p.logo || 'https://via.placeholder.com/150/0a0a0c/ff6b00?text=GK';
    var nombreTxt = p.nombre || 'Mi Comercio';
    var urlPng = p.nombre_png || p.logo_nombre || '';
    var filtroHalo = esTemaClasico
        ? 'filter: drop-shadow(0 0 1px rgba(0,0,0,0.45));'
        : 'filter: drop-shadow(0 0 1.5px rgba(255,255,255,0.85)) drop-shadow(0 2px 4px rgba(0,0,0,0.9));';
    var tituloHtml = urlPng
        ? '<div class="popup-nombre-png-box"><img src="' + urlPng + '" alt="' + nombreTxt + '" class="popup-nombre-png" style="max-height:32px; max-width:142px; object-fit:contain; ' + filtroHalo + '"></div>'
        : '<h3 class="popup-title" style="color:' + (esTemaClasico ? '#0f172a' : '#ffffff') + ' !important; font-size:13px; font-weight:900; margin:4px 0 2px 0; text-transform:uppercase;">' + nombreTxt + '</h3>';
    var sloganHtml = p.slogan ? '<p class="popup-slogan" style="color:' + colorSlogan + ' !important;">' + p.slogan + '</p>' : '';
    var nichoTxt = (p.nicho || p.categoria || 'Comercio').toUpperCase();
    var html =
        '<div style="position:relative; width:100%; border-radius:15px; overflow:hidden;">' +
            '<div style="position:relative;">' +
                '<img src="' + portadaUsada + '" class="popup-portada" style="border-color:' + c1 + ';">' +
            '</div>' +
            '<div class="popup-info" style="padding:0 10px 10px 10px; position:relative; text-align:center;">' +
                '<img src="' + logoUsado + '" class="popup-logo" style="border-color:' + c1 + ';">' +
                tituloHtml +
                sloganHtml +
                '<div class="estrellas" style="margin-top:2px;">★★★★★</div>' +
                '<p class="texto-piedra" style="margin:2px 0 8px 0; color:' + colorSlogan + ' !important;">' + nichoTxt + '</p>' +
                '<div class="popup-acciones-fila" style="display:flex; gap:6px; align-items:center; justify-content:center;">' +
                    '<a href="/negocio?id=' + encodeURIComponent(window.idNegocioLogueado || '') + '" target="_blank" class="btn-popup-catalogo" style="background:' + cBtn + ' !important; color:' + colorTextoBtn + ' !important; text-decoration:none; flex:1; padding:7px 10px; border-radius:10px; font-size:10.5px; font-weight:900;">CATÁLOGO</a>' +
                '</div>' +
            '</div>' +
        '</div>';
    var rawTema = String(p.tema_popup || 'carbon').trim();
    var esCustom = rawTema.indexOf('custom:') === 0;
    var claseTema = esCustom ? 'popup-tema-carbon' : ('popup-tema-' + rawTema);
    var pop = new maplibregl.Popup({
        anchor: 'top',
        offset: [0, 8],
        closeButton: false,
        closeOnClick: true,
        maxWidth: '164px',
        className: 'popup-boveda-estricto ' + claseTema
    }).setHTML(html);
    if (esCustom) {
        pop.on('open', function() {
            var est = window.obtenerEstiloCuarzo(rawTema);
            var elC = pop.getElement() ? pop.getElement().querySelector('.maplibregl-popup-content') : null;
            if (elC && est) {
                elC.style.setProperty('background', est.bg, 'important');
                elC.style.setProperty('border-color', est.border, 'important');
            }
        });
    }
    return pop;
};


window.abrirGemeloDigital = function() {
    if (window.pinMiniMapaPerfil) {
        window.pinMiniMapaPerfil.togglePopup();
        return;
    }

    var p = window.datosTienda.portada || 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=600&q=80';
    var l = window.datosTienda.logo || 'https://via.placeholder.com/150/0a0a0c/ff6b00?text=LOGO';
    var n = window.datosTienda.nombre || '';
    var s = window.datosTienda.slogan || '';
    var w = window.datosTienda.whatsApp || window.datosTienda.whatsapp || '';
    var pbx = window.datosTienda.pbx || '';
    var c = (window.datosTienda.niche || 'otro').toUpperCase();
    var colorP = window.datosTienda.color_principal || '#ff6b00';


    var renderImage = function(src, isLogo) {
        var accion = isLogo ? "document.getElementById('file-logo').click()" : "document.getElementById('file-portada').click()";
        var radioVal = isLogo ? "50%" : "15px 15px 0 0";
        var baseClass = isLogo ? "popup-logo" : "popup-portada";

        if (window.modoEdicionActivo) {
            var margenLogo = isLogo ? 'margin: -24px auto 6px auto;' : '';
            return '<div class="' + baseClass + ' click-edit-area" onclick="' + accion + '" style="cursor: pointer; position: relative; overflow: hidden; border-radius: ' + radioVal + ' !important; ' + margenLogo + '">' +
                '<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.7); border-radius: 50%; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; color: white; font-size: 11px; z-index: 10;">📷</div>' +
                '<img src="' + src + '" style="width: 100%; height: 100%; object-fit: cover; opacity: 0.5;">' +
            '</div>';
        }
        return '<img src="' + src + '" class="' + baseClass + '">';
    };

        var cuerpoDatos = '';
    if (window.modoEdicionActivo) {
        var tieneSlogan = Boolean(s && String(s).trim().length > 0);
        var bloqueInputSlogan = 
            '<div id="caja-input-slogan" style="display: ' + (tieneSlogan ? 'block' : 'none') + '; margin-bottom: 3px;">' +
                '<input type="text" id="edit-master-slogan" class="input-inline-minimal" value="' + s + '" placeholder="Slogan o lema comercial">' +
            '</div>' +
            (!tieneSlogan 
                ? '<button type="button" class="btn-chip-expandir" id="btn-add-slogan" onclick="document.getElementById(\'caja-input-slogan\').style.display=\'block\'; this.style.display=\'none\'; document.getElementById(\'edit-master-slogan\').focus();">+ Slogan</button>' 
                : '');

        var tienePbx = Boolean(pbx && String(pbx).trim().length > 0);
        var bloquePbx = 
            '<div id="caja-input-pbx" style="display: ' + (tienePbx ? 'block' : 'none') + '; margin-top: 3px;">' +
                '<input type="tel" id="edit-master-pbx" class="input-inline-minimal" value="' + pbx + '" placeholder="PBX / Fijo comercial">' +
            '</div>';

        cuerpoDatos = 
            '<div style="display: flex; flex-direction: column; gap: 3px; margin-top: 6px;">' +
                '<input type="text" id="edit-master-nombre" class="input-inline-minimal" value="' + (n === 'Mi Nueva Tienda' ? '' : n) + '" placeholder="Nombre de comercio">' +
                bloqueInputSlogan +
                '<select id="edit-master-niche" class="input-inline-minimal" style="text-transform: uppercase;">' +
                    '<option value="restaurante"' + (c === 'RESTAURANTE' ? ' selected' : '') + '>RESTAURANTE</option>' +
                    '<option value="supermercado"' + (c === 'SUPERMERCADO' ? ' selected' : '') + '>SUPERMERCADO</option>' +
                    '<option value="tecnologia"' + (c === 'TECNOLOGIA' ? ' selected' : '') + '>TECNOLOGÍA</option>' +
                    '<option value="ropa"' + (c === 'ROPA' ? ' selected' : '') + '>ROPA / BOUTIQUE</option>' +
                    '<option value="otro"' + (c === 'OTRO' ? ' selected' : '') + '>OTRO</option>' +
                '</select>' +
                '<div style="display: flex; gap: 4px; align-items: center;">' +
                    '<input type="number" id="edit-master-whatsapp" class="input-inline-minimal" style="flex: 1; margin-bottom: 0;" value="' + w + '" placeholder="WhatsApp">' +
                    (!tienePbx 
                        ? '<button type="button" class="btn-chip-expandir" id="btn-add-pbx" style="margin-bottom: 0;" onclick="document.getElementById(\'caja-input-pbx\').style.display=\'block\'; this.style.display=\'none\'; document.getElementById(\'edit-master-pbx\').focus();">+ PBX</button>' 
                        : '') +
                '</div>' +
                bloquePbx +
            '</div>';
    } else {

        var bloqueNombre = window.datosTienda.nombre_png
            ? '<img src="' + window.datosTienda.nombre_png + '" style="max-height:22px;max-width:140px;object-fit:contain;margin:0 auto 2px auto;display:block;" alt="' + n + '">'
            : '<h4 style="margin: 0; color: white; font-size: 13px; font-weight: 900; text-transform: uppercase;">' + (n || 'TU COMERCIO') + '</h4>';

        var bloqueSlogan = s
            ? '<span class="popup-slogan">' + s + '</span>'
            : '';

        var botonWhatsApp = w
            ? '<a href="https://wa.me/' + w + '" target="_blank" class="badge-comunicacion badge-whatsapp">💬 ' + w + '</a>'
            : '';

        var botonPbx = pbx
            ? '<a href="tel:' + pbx.replace(/\D/g, '') + '" class="badge-comunicacion badge-pbx">📞 PBX: ' + pbx + '</a>'
            : '';

        cuerpoDatos = 
            '<div style="margin-top: 6px;">' + bloqueNombre + '</div>' +
            bloqueSlogan +
            '<div style="margin-top: 2px;">' +
                '<span style="font-size: 9px; color: var(--naranja); text-transform: uppercase; font-weight: bold;">' + c + '</span>' +
            '</div>' +
            '<div style="display: flex; flex-direction: column; gap: 3px; margin-top: 6px;">' +
                botonWhatsApp +
                botonPbx +
            '</div>';
    }


        var botonCerrar = '<button type="button" onclick="if(window.popupOnboarding) window.popupOnboarding.remove();" style="position: absolute; top: 6px; left: 6px; z-index: 50; width: 26px; height: 26px; background: rgba(0,0,0,0.7); border: 1px solid rgba(255,255,255,0.25); color: #ffffff; border-radius: 50%; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; outline: none;">✕</button>';

    var botonGuardar = window.modoEdicionActivo
        ? '<button id="lapiz-tarjeta-popup" class="btn-diskette-biselado" style="position: absolute; top: 6px; right: 6px; z-index: 50; width: 30px; height: 30px; background: ' + colorP + '26 !important; border-color: ' + colorP + '66 !important;" onclick="window.toggleGuardarTarjetaPopup(this)" title="Guardar Cambios">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--naranja)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>' +
          '</button>'
        : '';

    var htmlGemelo = 
        '<div style="position: relative;">' +
            botonCerrar +
            botonGuardar +
            renderImage(p, false) +
        '</div>' +
        '<div class="popup-info">' +
            renderImage(l, true) +
            cuerpoDatos +
            (window.modoEdicionActivo ? '' : '<button type="button" class="btn-submit" style="margin-top: 8px !important; padding: 6px !important; font-size: 10px; background: var(--naranja);" onclick="window.cambiarTab(\'inventario\')">Ver Catálogo</button>') +
        '</div>';

    if (window.popupOnboarding) {
        window.popupOnboarding.remove();
    }

    if (window.miniMapaPerfil && window.pinMiniMapaPerfil) {
        window.popupOnboarding = new maplibregl.Popup({ 
            offset: [0, 8], 
            anchor: 'top', 
            closeOnClick: false, 
            closeButton: false, 
            maxWidth: '200px', 
            className: 'popup-boveda-estricto'
        })
        .setHTML(htmlGemelo)
        .setLngLat(window.pinMiniMapaPerfil.getLngLat())
        .addTo(window.miniMapaPerfil);

        window.miniMapaPerfil.panTo(window.pinMiniMapaPerfil.getLngLat(), { duration: 350 });
    }

};

window.toggleModoEdicionMinimalista = function() {
    window.modoEdicionActivo = !window.modoEdicionActivo;
    var btnLapiz = document.getElementById('btn-master-lapiz-dashboard');
    var inputDir = document.getElementById('perfilDireccion');
    var lapizPin = document.getElementById('lapiz-pin-directo');

    var svgLapiz = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>';
    var svgCerrar = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

    if (btnLapiz) {
        btnLapiz.innerHTML = window.modoEdicionActivo ? svgCerrar : svgLapiz;
        btnLapiz.style.color = window.modoEdicionActivo ? '#ff4444' : 'var(--naranja)';
        btnLapiz.style.borderColor = window.modoEdicionActivo ? '#ff4444' : 'var(--naranja)';
    }

    if (inputDir && window.modoEdicionActivo) {
        inputDir.focus();
    }

    if (lapizPin) {
        if (window.modoEdicionActivo) lapizPin.classList.add('visible');
        else lapizPin.classList.remove('visible');
    }

    if (window.miniMapaPerfil) {
        if (window.modoEdicionActivo) {
            window.miniMapaPerfil.dragPan.enable();
            window.miniMapaPerfil.scrollZoom.enable();
            window.miniMapaPerfil.touchZoomRotate.enable();
        } else {
            window.miniMapaPerfil.dragPan.disable();
            window.miniMapaPerfil.scrollZoom.disable();
            window.miniMapaPerfil.touchZoomRotate.disable();
        }
    }

    if (window.pinMiniMapaPerfil) {
        window.pinMiniMapaPerfil.setDraggable(window.modoEdicionActivo);
    }

    window.abrirGemeloDigital();
};

window.toggleGuardarTarjetaPopup = async function() {
    var inputNom = document.getElementById('edit-master-nombre');
    var inputSlogan = document.getElementById('edit-master-slogan');
    var selectSec = document.getElementById('edit-master-niche');
    var inputTel = document.getElementById('edit-master-whatsapp');
    var inputPbx = document.getElementById('edit-master-pbx');

    var payload = {};
    if (inputNom && inputNom.value.trim()) payload.nombre = inputNom.value.trim();
    if (inputSlogan) payload.slogan = inputSlogan.value.trim();
    if (selectSec) payload.niche = selectSec.value;
    if (inputTel && inputTel.value.trim()) {
        var telLimpio = inputTel.value.trim().replace(/\D/g, '');
        payload.whatsapp = telLimpio;
        payload.whatsApp = telLimpio;
    }
    if (inputPbx) {
        payload.pbx = inputPbx.value.trim().replace(/[^\d\s\-\+\(\)]/g, '');
    }


    Object.assign(window.datosTienda, payload);

    try {
        await GeokatuDB.AdminService.actualizarNegocio(window.idNegocioLogueado, payload);
        if (navigator.vibrate) navigator.vibrate([50, 50]);

        var uiNom = document.getElementById('ui-nombre');
        if (uiNom && payload.nombre) uiNom.innerText = payload.nombre;
    } catch(e) {
        console.error("Error al guardar tarjeta:", e);
        alert("No se pudo guardar la tarjeta: " + e.message);
    }

    window.modoEdicionActivo = false;
    var btnLapiz = document.getElementById('btn-master-lapiz-dashboard');
    if (btnLapiz) {
        btnLapiz.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>';
        btnLapiz.style.color = 'var(--naranja)';
        btnLapiz.style.borderColor = 'var(--naranja)';
    }
    if (window.miniMapaPerfil) {
        window.miniMapaPerfil.dragPan.disable();
        window.miniMapaPerfil.scrollZoom.disable();
        window.miniMapaPerfil.touchZoomRotate.disable();
    }
    if (window.pinMiniMapaPerfil) window.pinMiniMapaPerfil.setDraggable(false);
    window.abrirGemeloDigital();
};


// ============================================================================
// BLOQUE 9: AUDITORÍA DE CAJA, DATOS FISCALES & DIAN (ZERO ${})
// ============================================================================
window.incidenciasCacheGlobal = [];

window.cargarAlertasSeguridad = function() {
    if (typeof window.desuscripcionAlertas === 'function') window.desuscripcionAlertas();
    if (!window.idNegocioLogueado) return;

    var qAlertas = query(
        collection(db, "Alertas_Seguridad"),
        where("id_negocio", "==", window.idNegocioLogueado)
    );

    window.desuscripcionAlertas = onSnapshot(qAlertas, function(snap) {
        var todas = [];
        var pendientes = 0;

        snap.forEach(function(d) {
            var data = d.data();
            data.id_doc = d.id;
            todas.push(data);
            if (data.estado === "requiere_auditoria_urgente" || !data.resuelto) {
                pendientes++;
            }
        });

        // Ordenar en memoria por frescura (mas reciente arriba)
        todas.sort(function(a, b) {
            var tA = a.timestamp_alerta ? new Date(a.timestamp_alerta.toDate ? a.timestamp_alerta.toDate() : a.timestamp_alerta).getTime() : 0;
            var tB = b.timestamp_alerta ? new Date(b.timestamp_alerta.toDate ? b.timestamp_alerta.toDate() : b.timestamp_alerta).getTime() : 0;
            return tB - tA;
        });

        window.incidenciasCacheGlobal = todas;

        // Actualizar tacómetro de incidencias
        var elTotal = document.getElementById('kpi-alertas-activas');
        if (elTotal) elTotal.innerText = pendientes;

        // Actualizar burbuja roja urgente de aviso visual
        var badgeUrgente = document.getElementById('badge-kpi-incidencias');
        if (badgeUrgente) {
            if (pendientes > 0) {
                badgeUrgente.innerText = pendientes;
                badgeUrgente.style.display = 'flex';
            } else {
                badgeUrgente.style.display = 'none';
            }
        }

        // Si la modal esta abierta visualizando incidencias, refrescar en caliente
        if (window.tipoKpiActivoModal === 'incidencias') {
            window.filtrarContenidoKpiModal();
        }
    }, function(err) {
        console.warn("[Alertas] Error en radar de seguridad:", err.message);
    });
};


window.abrirModalConciliacion = function(idAlerta, idProd, nombreProd, stockNeg) {
    document.getElementById('concilia-alerta-id').value = idAlerta;
    document.getElementById('concilia-prod-id').value = idProd;
    document.getElementById('concilia-prod-nombre').innerText = nombreProd;
    document.getElementById('concilia-prod-desfase').innerText = 'Saldo registrado: ' + stockNeg + ' und';
    document.getElementById('concilia-stock-real').value = '';
    document.getElementById('concilia-motivo').value = '';
    document.getElementById('modal-conciliacion').style.display = 'flex';
};

window.cerrarModalConciliacion = function() {
    document.getElementById('modal-conciliacion').style.display = 'none';
};

window.ejecutarConciliacionAlerta = async function() {
    var idAlerta = document.getElementById('concilia-alerta-id').value;
    var idProd = document.getElementById('concilia-prod-id').value;
    var stockReal = document.getElementById('concilia-stock-real').value;
    var motivo = document.getElementById('concilia-motivo').value.trim();

    if (stockReal === "" || isNaN(stockReal) || Number(stockReal) < 0) {
        return alert("Digita una cantidad física contada válida.");
    }

    var res = await GeokatuDB.InventarioService.resolverAlertaStock(
        window.idNegocioLogueado,
        idAlerta,
        idProd,
        stockReal,
        motivo || "Ajuste físico de anaquel"
    );

    if (res.success) {
        alert("✅ Inventario conciliado exitosamente.");
        window.cerrarModalConciliacion();
    } else {
        alert("Error al resolver: " + res.error);
    }
};

window.calcularDV = function(nit) {
    var vpri = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
    var z = nit.toString().trim();
    var x = 0;
    for (var i = 0; i < z.length; i++) {
        x += (parseInt(z.substr(i, 1), 10) * vpri[z.length - 1 - i]);
    }
    var y = x % 11;
    return (y > 1) ? (11 - y).toString() : y.toString();
};

document.getElementById('fisc-nit')?.addEventListener('input', function(e) {
    var val = e.target.value.trim();
    var elDv = document.getElementById('fisc-dv');
    if (val.length >= 6 && elDv) elDv.value = window.calcularDV(val);
});

window.guardarConfiguracionFiscal = async function() {
    var btn = document.getElementById('btn-guardar-fiscal');
    btn.innerText = "GUARDANDO...";
    btn.disabled = true;

    var selPais = document.getElementById('fisc-pais-comercio');
    var paisElegido = selPais ? selPais.value : (window.datosTienda.pais || "COL");

    var payloadFiscal = {
        pais: paisElegido,
        perfil_fiscal: {
            razon_social: document.getElementById('fisc-razon-social').value.trim() || window.datosTienda.nombre,
            codigo_tienda: (document.getElementById('fisc-codigo-tienda').value.trim() || "TIENDA-01").toUpperCase(),
            nit: document.getElementById('fisc-nit').value.trim(),
            dv: document.getElementById('fisc-dv').value.trim(),
            regimen_tributario: document.getElementById('fisc-regimen').value,
            direccion: document.getElementById('fisc-direccion').value.trim(),
            siigo_user: document.getElementById('fisc-siigo-user').value.trim(),
            siigo_key: document.getElementById('fisc-siigo-key').value.trim(),
            codigo_tipo_comprobante: Number(document.getElementById('fisc-siigo-doc-id').value) || 1150,
            id_impuesto_iva_siigo: Number(document.getElementById('fisc-siigo-iva-id').value) || 1284
        }
    };

    try {
        await GeokatuDB.AdminService.actualizarNegocio(window.idNegocioLogueado, payloadFiscal);
        Object.assign(window.datosTienda, payloadFiscal);
        localStorage.setItem('geokatu_pais_' + window.idNegocioLogueado, paisElegido);

        window.renderizarResumenFiscal();
        document.getElementById('form-config-fiscal').style.display = 'none';
        alert("✅ Perfil fiscal y país guardados correctamente.");
    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        btn.innerText = "Guardar Perfil Fiscal";
        btn.disabled = false;
    }
};

window.renderizarResumenFiscal = function() {
    var contenedor = document.getElementById('resumen-fiscal-render');
    if (!contenedor) return;

    var paisActual = window.datosTienda.pais || localStorage.getItem('geokatu_pais_' + window.idNegocioLogueado) || 'COL';
    var selPais = document.getElementById('fisc-pais-comercio');
    if (selPais) selPais.value = paisActual;

    var f = window.datosTienda.perfil_fiscal;
    var etiquetaPais = paisActual === 'VEN' ? '🇻🇪 VENEZUELA (POS USD/VES)' : '🇨🇴 COLOMBIA (POS COP/DIAN)';

    if (!f || !f.nit) {
        contenedor.innerHTML = 
            '<div style="display:flex; justify-content:space-between; align-items:center;">' +
                '<span style="color:#ffaa00; font-size:11px;">Régimen no configurado</span>' +
                '<span style="background:rgba(255,107,0,0.15); color:var(--naranja); padding:2px 7px; border-radius:6px; font-weight:bold; font-size:9.5px;">' + etiquetaPais + '</span>' +
            '</div>';
        return;
    }

    contenedor.innerHTML = 
        '<div style="display:flex; justify-content:space-between; align-items:center;">' +
            '<div>' +
                '<strong style="color:white; font-size:12px;">' + f.razon_social + '</strong>' +
                '<span style="display:block; color:#888;">Doc: ' + f.nit + (f.dv ? '-' + f.dv : '') + ' | Sede: ' + f.codigo_tienda + '</span>' +
            '</div>' +
            '<div style="display:flex; flex-direction:column; gap:3px; align-items:flex-end;">' +
                '<span style="background:rgba(255,107,0,0.15); color:var(--naranja); padding:2px 6px; border-radius:5px; font-weight:bold; font-size:9px;">' + etiquetaPais + '</span>' +
                '<span style="background:rgba(0,255,100,0.15); color:#00ff64; padding:2px 6px; border-radius:5px; font-weight:bold; font-size:9px;">' +
                    (paisActual === 'VEN' ? 'MULTIMONEDA' : (f.siigo_user ? 'SIIGO ACTIVO' : 'POS NATIVO')) +
                '</span>' +
            '</div>' +
        '</div>';
};


// ============================================================================
// BLOQUE 10: PERSONAL, TAREAS INTERNAS & ROLES (ZERO ${})
// ============================================================================
window.cargarEquipoOficina = async function() {
    var contenedor = document.getElementById('cajeros-render');
    var selectDest = document.getElementById('tarea-destinatario');
    if (!contenedor) return;

    try {
        var snap = await getDocs(collection(db, 'Directorio/' + window.idNegocioLogueado + '/Equipo'));
        if (snap.empty) {
            snap = await getDocs(collection(db, 'Directorio/' + window.idNegocioLogueado + '/Colaboradores'));
        }

        if (snap.empty) {
            contenedor.innerHTML = '<p style="text-align:center; color:#666; font-size:11px;">No hay personal registrado.</p>';
            return;
        }

        var html = '';
        if (selectDest) selectDest.innerHTML = '<option value="TODOS">📢 Para todo el personal</option>';

        var badgeRoles = {
            cajero: { txt: "Cajero", col: "#0277BD" },
            supervisor_pos: { txt: "Supervisor", col: "#f59e0b" },
            operador_bodega: { txt: "Bodega", col: "#8a2be2" },
            almacen: { txt: "Almacén", col: "#8a2be2" },
            administrador_delegado: { txt: "Admin Delegado", col: "#2563eb" },
            asesor: { txt: "Ventas", col: "#10b981" },
            visual_merchandising: { txt: "Visual", col: "#ec4899" }
        };

        snap.forEach(function(d) {
            var emp = d.data();
            var rolInfo = badgeRoles[emp.rol] || { txt: emp.rol || 'Cajero', col: '#ff6b00' };

            if (selectDest) {
                selectDest.innerHTML += '<option value="' + d.id + '">' + (emp.nombre || emp.email) + '</option>';
            }

            var textoHorario = (emp.horario_laboral && emp.horario_laboral.activo)
                ? (emp.horario_laboral.hora_inicio_str + ' - ' + emp.horario_laboral.hora_fin_str)
                : 'Turno Libre 24/7';

            html += 
                '<div style="background:rgba(0,0,0,0.3); border:1px solid var(--glass-border); border-radius:10px; padding:10px 12px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">' +
                    '<div style="text-align:left;">' +
                        '<div style="display:flex; align-items:center; gap:6px;">' +
                            '<strong style="color:white; font-size:12.5px;">' + (emp.nombre || emp.email) + '</strong>' +
                            '<span style="background:rgba(255,107,0,0.2); color:var(--naranja); padding:1px 5px; border-radius:4px; font-family:monospace; font-size:10px; font-weight:900;">PIN: ' + (emp.codigo_cajero || '----') + '</span>' +
                        '</div>' +
                        '<div style="display:flex; gap:8px; align-items:center; margin-top:2px;">' +
                            '<span style="color:#777; font-size:10.5px;">' + emp.email + '</span>' +
                            '<span style="color:#aaa; font-size:9.5px; font-family:monospace; background:rgba(255,255,255,0.06); padding:1px 5px; border-radius:4px;">' + textoHorario + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<span style="background:' + rolInfo.col + '; color:white; font-weight:bold; font-size:9.5px; padding:3px 7px; border-radius:6px; text-transform:uppercase;">' +
                        rolInfo.txt +
                    '</span>' +
                '</div>';

        });
        contenedor.innerHTML = html;
    } catch (e) {
        console.warn("[Equipo] Error al cargar:", e);
    }
};

window.generarPasswordSugerida = function() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
    var pass = "";
    for (var i = 0; i < 9; i++) pass += chars[Math.floor(Math.random() * chars.length)];
    var el = document.getElementById('emp-nuevo-pass');
    if (el) el.value = pass;
};

window.generarPinEmpleado = function() {
    var pin = Math.floor(1000 + Math.random() * 9000);
    var el = document.getElementById('emp-nuevo-codigo');
    if (el) el.value = pin;
};

window.registrarEmpleado = async function() {
    var nombre = document.getElementById('emp-nuevo-nombre').value.trim();
    var tel = document.getElementById('emp-nuevo-tel').value.trim();
    var email = document.getElementById('emp-nuevo-email').value.trim().toLowerCase();
    var pass = document.getElementById('emp-nuevo-pass').value;
    var codigo = document.getElementById('emp-nuevo-codigo').value.trim();
    var rol = document.getElementById('emp-nuevo-rol').value;
    var almacen = document.getElementById('emp-nuevo-almacen').value;
    var btn = document.getElementById('btn-crear-empleado');

    if (!email || pass.length < 6 || !/^\d{4}$/.test(codigo)) {
        return alert("Completa el correo, clave (min. 6 caracteres) y un PIN numerico de 4 digitos.");
    }

    // Calculo del contrato de horario laboral
    var chkHorario = document.getElementById('emp-horario-activo');
    var tieneHorario = chkHorario ? chkHorario.checked : false;
    var horarioPayload = null;

    if (tieneHorario) {
        var hIni = document.getElementById('emp-hora-inicio').value || '07:00';
        var hFin = document.getElementById('emp-hora-fin').value || '16:00';
        var pIni = hIni.split(':');
        var pFin = hFin.split(':');
        var minInicio = (parseInt(pIni[0], 10) * 60) + parseInt(pIni[1], 10);
        var minFin = (parseInt(pFin[0], 10) * 60) + parseInt(pFin[1], 10);

        horarioPayload = {
            activo: true,
            hora_inicio_str: hIni,
            hora_fin_str: hFin,
            hora_inicio_minutos: minInicio,
            hora_fin_minutos: minFin,
            dias_permitidos: [1, 2, 3, 4, 5, 6], // Lunes a Sabado
            tolerancia_minutos: 45
        };
    }

    btn.innerText = "Registrando...";
    btn.disabled = true;
    try {
        var funcModule = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js');
        var forjarOperario = funcModule.httpsCallable(funcModule.getFunctions(db.app), 'crearOperarioComercio');
        var res = await forjarOperario({
            idNegocio: window.idNegocioLogueado,
            nombre: nombre || email.split('@')[0],
            telefono: tel,
            email: email,
            passwordTemporal: pass,
            codigoCajero: codigo,
            rol: rol,
            almacenHabitual: almacen,
            horarioLaboral: horarioPayload
        });


        if (!res.data || !res.data.success) {
            throw new Error((res.data && res.data.mensaje) ? res.data.mensaje : "Fallo en servidor.");
        }

        localStorage.removeItem('geokatu_nomina_cache_' + window.idNegocioLogueado);
        alert("✅ Operario registrado correctamente.");
        document.getElementById('emp-nuevo-nombre').value = '';
        document.getElementById('emp-nuevo-email').value = '';
        document.getElementById('emp-nuevo-pass').value = '';
        document.getElementById('emp-nuevo-codigo').value = '';
        document.getElementById('form-nuevo-colaborador').style.display = 'none';
        window.cargarEquipoOficina();
    } catch (err) {
        try {
            // Respaldo directo en Firestore (100% operativo para relevo por PIN de 4 digitos sin Cloud Functions)
            var idOpLocal = 'OP_' + codigo + '_' + Date.now().toString(36).toUpperCase();
            var payloadOp = {
                nombre: nombre || email.split('@')[0],
                telefono: tel,
                email: email,
                codigo_cajero: codigo,
                pin: codigo,
                rol: rol,
                almacen_habitual: almacen,
                horario_laboral: horarioPayload,
                fecha_creacion: new Date().toISOString()
            };
            await setDoc(doc(db, 'Directorio/' + window.idNegocioLogueado + '/Equipo', idOpLocal), payloadOp, { merge: true });
            await setDoc(doc(db, 'Directorio/' + window.idNegocioLogueado + '/Colaboradores', idOpLocal), payloadOp, { merge: true });
            localStorage.removeItem('geokatu_nomina_cache_' + window.idNegocioLogueado);
            alert("✅ Operario registrado en nómina local con PIN " + codigo + " (Listo para Relevo por PIN).");
            document.getElementById('emp-nuevo-nombre').value = '';
            document.getElementById('emp-nuevo-email').value = '';
            document.getElementById('emp-nuevo-pass').value = '';
            document.getElementById('emp-nuevo-codigo').value = '';
            document.getElementById('form-nuevo-colaborador').style.display = 'none';
            window.cargarEquipoOficina();
        } catch (errFallback) {
            alert("Error creando credenciales: " + errFallback.message);
        }
    } finally {
        btn.innerText = "Registrar Operario";
        btn.disabled = false;
    }
};


window.crearTareaInterna = async function() {
    var titulo = document.getElementById('tarea-titulo').value.trim();
    var destinatario = document.getElementById('tarea-destinatario').value;
    var prioridad = document.getElementById('tarea-prioridad').value;

    if (!titulo) return alert("Escribe la tarea.");

    await setDoc(doc(collection(db, 'Directorio/' + window.idNegocioLogueado + '/Tareas_Internas')), {
        titulo: titulo,
        destinatario_uid: destinatario,
        prioridad: prioridad,
        completada: false,
        fecha_creacion: new Date().toISOString()
    });

    document.getElementById('tarea-titulo').value = '';
    window.cargarTareasOficina();
};

window.cargarTareasOficina = async function() {
    var contenedor = document.getElementById('contenedor-tareas-lista');
    if (!contenedor) return;

    try {
        var snap = await getDocs(query(
            collection(db, 'Directorio/' + window.idNegocioLogueado + '/Tareas_Internas'),
            where("completada", "==", false),
            orderBy("fecha_creacion", "desc"),
            limit(20)
        ));

        if (snap.empty) {
            contenedor.innerHTML = '<p style="text-align:center; color:#666; font-size:11px;">Sin tareas pendientes.</p>';
            return;
        }

        var html = '';
        snap.forEach(function(docSnap) {
            var t = docSnap.data();
            var col = t.prioridad === 'URGENTE' ? '#ff4444' : 'var(--naranja)';
            html += 
                '<div class="tarea-item" style="border-left-color: ' + col + ';">' +
                    '<div>' +
                        '<span style="font-size:9.5px; font-weight:bold; color:' + col + '; text-transform:uppercase;">' + t.prioridad + '</span>' +
                        '<strong style="display:block; font-size:12px; color:white;">' + t.titulo + '</strong>' +
                    '</div>' +
                    '<button type="button" onclick="window.marcarTareaCompletada(\'' + docSnap.id + '\')" style="background:rgba(0,255,100,0.15); border:1px solid rgba(0,255,100,0.4); color:#00ff64; border-radius:6px; padding:5px 9px; font-size:10px; cursor:pointer;">' +
                        '✔️ Listo' +
                    '</button>' +
                '</div>';
        });
        contenedor.innerHTML = html;
    } catch (e) {
        console.warn("[Tareas] Error:", e);
    }
};

window.marcarTareaCompletada = async function(idTarea) {
    await updateDoc(doc(db, 'Directorio/' + window.idNegocioLogueado + '/Tareas_Internas', idTarea), {
        completada: true,
        fecha_completada: new Date().toISOString()
    });
    window.cargarTareasOficina();
};




// Historial y prevención de salida involuntaria

window.history.pushState({ page: 'oficina_root' }, '');



window.addEventListener('popstate', () => {

const mBrand = document.getElementById('modal-diseno-pin-branding');

if (mBrand && (mBrand.classList.contains('activo') || mBrand.style.display === 'flex')) {

mBrand.classList.remove('activo');

mBrand.style.display = 'none';

window.history.pushState({ page: 'oficina_root' }, '');

return;

}



const modalSalida = document.getElementById('modal-confirmar-salida');

if (modalSalida) modalSalida.classList.add('activo');

window.history.pushState({ page: 'oficina_root' }, '');

});


window.cerrarModalSalida = function(confirmado) {
    const modalSalida = document.getElementById('modal-confirmar-salida');
    if (modalSalida) modalSalida.classList.remove('activo');
    if (confirmado) {
        sessionStorage.setItem('geokatu_ram_warm', '1');
        if (window.idNegocioLogueado && window.datosTienda) {
            try {
                localStorage.setItem('geokatu_cache_neg_' + window.idNegocioLogueado, JSON.stringify(window.datosTienda));
                sessionStorage.setItem('geokatu_enfocar_ram', window.idNegocioLogueado);
                var c = window.datosTienda.Coordenadas || {};
                var lat = c.latitude || c._lat || window.datosTienda.lat;
                var lng = c.longitude || c._long || window.datosTienda.lng;
                if (lat && lng) {
                    sessionStorage.setItem('geokatu_last_cam', JSON.stringify({
                        lat: Number(lat),
                        lng: Number(lng),
                        zoom: 17
                    }));
                }
            } catch (eSal) {}
        }
        window.location.href = '/';
    }
};

// ============================================================================
// FUNCIONES CONTROLADORAS DEL ONBOARDING (FASE 1 Y 2) - BLINDADAS
// ============================================================================
window.imagenCargadaTemporalPaso1 = null;
window.mapaOnboarding = null;
window.markerOnboarding = null;

window.blobPinEditadoPaso1 = null;
window.cargarPreviewPin = async function(input) {
    if (input.files && input.files[0]) {
        var editada = await window.GeokatuEstudio.editarImagen(input.files[0], {
            maxAncho: 500,
            maxAlto: 500,
            calidad: 0.85,
            titulo: 'Editar Imagen del PIN'
        });
        if (!editada) { input.value = ''; return; }
        window.imagenCargadaTemporalPaso1 = editada.dataUrl;
        window.blobPinEditadoPaso1 = editada.blob;
        window.actualizarPinLive();
        window.extraerColoresDeImagen(window.imagenCargadaTemporalPaso1).then(function(pal) {
            if (pal && pal.c1) {
                window.setSlotColor(1, pal.c1);
                if (pal.c2) window.setSlotColor(2, pal.c2);
                window.actualizarPinLive();
            }
        }).catch(function() {});
    }
};


// ============================================================================
// MOTOR MÁGICO: EXTRACCIÓN AUTOMÁTICA DE PALETA DESDE IMAGEN (MICRO-CANVAS 2D)
// ============================================================================
window.extraerColoresDeImagen = function(imgSrcODataUrl) {
    return new Promise(function(resolve, reject) {
        if (!imgSrcODataUrl) return reject(new Error("No hay imagen disponible"));
        var img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = function() {
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');
            canvas.width = 40;
            canvas.height = 40;
            ctx.drawImage(img, 0, 0, 40, 40);
            var data = ctx.getImageData(0, 0, 40, 40).data;
            
            var cubos = {};
            for (var i = 0; i < data.length; i += 4) {
                var r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
                if (a < 128) continue; // Descartar píxeles transparentes
                if (r > 240 && g > 240 && b > 240) continue; // Descartar blanco puro
                if (r < 20 && g < 20 && b < 20) continue; // Descartar negro puro
                
                // Cuantización de color a saltos de 24
                var qr = Math.round(r / 24) * 24;
                var qg = Math.round(g / 24) * 24;
                var qb = Math.round(b / 24) * 24;
                var hex = '#' + ((1 << 24) + (qr << 16) + (qg << 8) + qb).toString(16).slice(1).toUpperCase();
                cubos[hex] = (cubos[hex] || 0) + 1;
            }
            
            var ordenados = Object.keys(cubos).sort(function(a, b) { return cubos[b] - cubos[a]; });
            var c1 = ordenados[0] || '#FF6B00';
            var c2 = ordenados[1] || '#8A909D';
            resolve({ c1: c1, c2: c2 });
        };
        img.onerror = reject;
        img.src = imgSrcODataUrl;
    });
};

window.ejecutarExtraccionMagicaColores = async function(contexto) {
    var fotoSrc = (contexto === 'fase1') 
        ? window.imagenCargadaTemporalPaso1 
        : (window.imagenCargadaTemporalModal || window.datosTienda.link_pin);

    if (!fotoSrc) {
        alert("Primero carga una foto al PIN o pulsa 'Otra Foto' para seleccionar un volante o logo.");
        return;
    }

    try {
        var pal = await window.extraerColoresDeImagen(fotoSrc);
        if (pal && pal.c1) {
            window.setSlotColor(1, pal.c1);
            if (pal.c2) window.setSlotColor(2, pal.c2);
            if (contexto === 'fase1') window.actualizarPinLive();
            else window.actualizarPinLiveModal();
            if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
        }
    } catch (e) {
        alert("No se pudieron extraer colores de la imagen: " + e.message);
    }
};

window.extraerColoresDesdeInput = function(input, contexto) {
    if (input.files && input.files[0]) {
        var reader = new FileReader();
        reader.onload = async function(e) {
            try {
                var pal = await window.extraerColoresDeImagen(e.target.result);
                if (pal && pal.c1) {
                    window.setSlotColor(1, pal.c1);
                    if (pal.c2) window.setSlotColor(2, pal.c2);
                    if (contexto === 'fase1') window.actualizarPinLive();
                    else window.actualizarPinLiveModal();
                    if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
                }
            } catch (err) {
                alert("Error analizando foto: " + err.message);
            }
        };
        reader.readAsDataURL(input.files[0]);
    }
};

window.volverAFase1Identidad = function() {
    var f1 = document.getElementById('fase-1-identidad');
    var f2 = document.getElementById('fase-1-pin');
    if (f2) f2.style.display = 'none';
    if (f1) f1.style.display = 'block';
};

window.volverAFase2Pin = function() {
    var f2 = document.getElementById('fase-1-pin');
    var f3 = document.getElementById('fase-mapa-sandbox');
    if (f3) f3.style.display = 'none';
    if (f2) f2.style.display = 'block';
    window.actualizarPinLive();
};


window.actualizarPinLive = function() {
    var forma = document.getElementById('select-forma') ? document.getElementById('select-forma').value : 'forma-gota';
    var anim = document.getElementById('select-animacion') ? document.getElementById('select-animacion').value : 'anim-salto';
    var efectoRaw = document.getElementById('select-efecto') ? document.getElementById('select-efecto').value : '';
    var c1 = document.getElementById('wizColorHex1') ? document.getElementById('wizColorHex1').value : '#ff6b00';
    var c2 = document.getElementById('wizColorHex2') ? document.getElementById('wizColorHex2').value : '';
    var c3 = document.getElementById('wizColorHex3') ? document.getElementById('wizColorHex3').value : '';
    var c4 = document.getElementById('wizColorHex4') ? document.getElementById('wizColorHex4').value : '';
    var foto = window.imagenCargadaTemporalPaso1 || (window.datosTienda && window.datosTienda.link_pin) || null;

    // Se respetan los 11 parámetros exactos para que la imagen no caiga en el argumento de color
    window.actualizarContenedorPin('pin-live-preview', 'img-live-preview', forma, c1, c2, c3, c4, efectoRaw, foto, anim, '');
};

window.guardarPaso2ADN = async function() {
    var btn = document.getElementById('btn-siguiente-fase');
    btn.innerText = "Guardando...";
    btn.disabled = true;
    var forma = document.getElementById('select-forma').value;
    var anim = document.getElementById('select-animacion') ? document.getElementById('select-animacion').value : 'anim-salto';
    var efecto = document.getElementById('select-efecto') ? document.getElementById('select-efecto').value : '';
    var tema = document.getElementById('select-tema-onboarding') ? document.getElementById('select-tema-onboarding').value : 'carbon';
    var pinPack = forma + '|' + anim + '|' + efecto;
    var c1 = document.getElementById('wizColorHex1').value;
    var c2 = document.getElementById('wizColorHex2').value;
    var c3 = document.getElementById('wizColorHex3').value;
    var c4 = document.getElementById('wizColorHex4') ? document.getElementById('wizColorHex4').value : '';
    var paleta = window.calcularPaletaAureaSilenciosa(c1, c2, c3, c4);
    var payload = {
        pin_pack: pinPack,
        tema_popup: tema,
        color_principal: paleta.c1,
        color_acento: paleta.c2,
        color_terciario: paleta.c3,
        color_cuaternario: paleta.c4,
        paleta_aurea: paleta,
        progreso_boveda: 65
    };
    try {
        // 1. Subir foto del PIN desde el Blob ya procesado en RAM (evita NotReadableError de FileReader en Android)
        var blobPin = window.blobPinEditadoPaso1 || window.dataUrlABlob(window.imagenCargadaTemporalPaso1);
        if (blobPin && navigator.onLine) {
            try {
                var res = await GeokatuDB.AdminService.subirArchivo('tiendas/' + window.idNegocioLogueado + '/pin_mapa.webp', blobPin, 'image/webp');
                var urlPin = (typeof res === 'string') ? res : (res && res.data ? res.data : (res && res.url ? res.url : ''));
                if (urlPin) {
                    payload.link_pin = urlPin;
                    if (!window.datosTienda.logo) payload.logo = urlPin;
                }
                window.blobPinEditadoPaso1 = null;
            } catch (errPinUp) {
                console.warn("[Paso 2] Aviso subiendo foto del PIN:", errPinUp.message);
            }
        }
        // 2. Subir logotipo tipografico PNG/WebP desde el Blob ya procesado en RAM
        var blobNom = window.blobNombrePngEditadoFase1 || window.dataUrlABlob(window.nombrePngTemporalPaso1);
        if (blobNom && navigator.onLine) {
            try {
                var resNom = await GeokatuDB.AdminService.subirArchivo('tiendas/' + window.idNegocioLogueado + '/nombre_png.webp', blobNom, 'image/webp');
                var urlNom = (typeof resNom === 'string') ? resNom : (resNom && resNom.data ? resNom.data : (resNom && resNom.url ? resNom.url : ''));
                if (urlNom) payload.nombre_png = urlNom;
                window.blobNombrePngEditadoFase1 = null;
            } catch (errNomUp) {
                console.warn("[Paso 2] Aviso subiendo logo tipografico:", errNomUp.message);
            }
        }
        var resUpd = await GeokatuDB.AdminService.actualizarNegocio(window.idNegocioLogueado, payload);
        if (resUpd && !resUpd.success) throw new Error(resUpd.error || "Fallo actualizando Firestore");
        Object.assign(window.datosTienda, payload);
        document.getElementById('fase-1-pin').style.display = 'none';
        window.iniciarSandboxGeoespacial(false);
        setTimeout(function() { if (window.lanzarGuiaOnboardingFase) window.lanzarGuiaOnboardingFase(3); }, 550);
    } catch (e) {
        alert("Error al guardar ADN del PIN: " + e.message);
    } finally {
        btn.innerText = "Continuar a Ubicación →";
        btn.disabled = false;
    }
};

// Mantenemos alias retrocompatible por si algún listener lo invoca
window.guardarPaso1ADN = window.guardarPaso2ADN;


window.iniciarSandboxGeoespacial = function() {
    var faseSandbox = document.getElementById('fase-mapa-sandbox');
    if (faseSandbox) faseSandbox.style.display = 'flex';

    var lat = 4.8133, lng = -75.6961;
    if (window.datosTienda.Coordenadas) {
        lat = window.datosTienda.Coordenadas.latitude || window.datosTienda.Coordenadas._lat || lat;
        lng = window.datosTienda.Coordenadas.longitude || window.datosTienda.Coordenadas._long || lng;
    }

    if (!window.mapaOnboarding) {
        window.mapaOnboarding = new maplibregl.Map({
            container: 'mapa-onboarding',
            style: 'estilo-fresco.json',
            center: [lng, lat],
            zoom: 16,
            attributionControl: false
        });
    } else {
        window.mapaOnboarding.setCenter([lng, lat]);
    }

    if (window.markerOnboarding) window.markerOnboarding.remove();

    var elDOM = document.createElement('div');
    elDOM.style.position = 'relative';
    elDOM.style.width = '60px';
    elDOM.style.height = '60px';
    elDOM.style.display = 'flex';
    elDOM.style.justifyContent = 'center';
    elDOM.style.alignItems = 'center';

    var fClass = 'forma-gota';
    if (window.datosTienda.pin_pack) {
        fClass = window.datosTienda.pin_pack.split('|')[0] || 'forma-gota';
    }
    var foto = window.imagenCargadaTemporalPaso1 || window.datosTienda.link_pin;
    var color = window.datosTienda.color_principal || '#ff6b00';

    elDOM.innerHTML = '<div class="pin-wrapper anim-salto" data-forma="' + fClass + '" style="--color-main: ' + color + '; cursor: pointer;"></div>';
    elDOM.querySelector('.pin-wrapper').innerHTML = window.obtenerContenidoSVG(fClass, foto, 'img-pin-fase-3');

    window.markerOnboarding = new maplibregl.Marker({ element: elDOM, draggable: true, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .addTo(window.mapaOnboarding);

    var selectorPais = document.getElementById('wiz-pais-comercio');
    if (selectorPais) {
        selectorPais.value = window.detectarPaisPorCoordenadas(lat, lng);
    }

    window.markerOnboarding.on('dragend', function() {
        var pos = window.markerOnboarding.getLngLat();
        window.datosTienda.Coordenadas = { latitude: pos.lat, longitude: pos.lng };
        if (selectorPais) {
            selectorPais.value = window.detectarPaisPorCoordenadas(pos.lat, pos.lng);
        }
    });

    // Permite tocar cualquier parte del mapa para mover el pin allí
    window.mapaOnboarding.on('click', function(e) {
        if (window.popupActivo) window.popupActivo.remove();
        window.markerOnboarding.setLngLat(e.lngLat);
        window.datosTienda.Coordenadas = { latitude: e.lngLat.lat, longitude: e.lngLat.lng };
        if (selectorPais) {
            selectorPais.value = window.detectarPaisPorCoordenadas(e.lngLat.lat, e.lngLat.lng);
        }
    });

    // Solo abre el gemelo si el usuario hace clic expresamente en el pin, no automáticamente para que no tape el mapa
    elDOM.addEventListener('click', function(e) {
        e.stopPropagation();
        window.abrirGemeloDigitalEnMapa(window.mapaOnboarding, window.markerOnboarding);
    });

    setTimeout(function() { 
        window.mapaOnboarding.resize(); 
    }, 300);

};

// Función genérica para renderizar el Gemelo Digital en cualquier instancia de mapa
window.abrirGemeloDigitalEnMapa = function(instanciaMapa, instanciaMarker) {
    if (!instanciaMapa || !instanciaMarker) return;

    var p = window.datosTienda.portada || 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=600&q=80';
    var l = window.datosTienda.logo || 'https://via.placeholder.com/150/0a0a0c/ff6b00?text=LOGO';
    var n = window.datosTienda.nombre || 'Tu Comercio';
    var s = window.datosTienda.slogan || '';
    var w = window.datosTienda.whatsapp || window.datosTienda.whatsApp || '';
    var pbx = window.datosTienda.pbx || '';
    var c = (window.datosTienda.nicho || window.datosTienda.categoria || 'General').toUpperCase();
    var h = window.datosTienda.horario || '';
    var es24 = Boolean(window.datosTienda.es_24_horas);

    var bloqueNombre = window.datosTienda.nombre_png
        ? '<img src="' + window.datosTienda.nombre_png + '" style="max-height:22px;max-width:140px;object-fit:contain;margin:0 auto 2px auto;display:block;" alt="' + n + '">'
        : '<h4 style="margin: 0; color: white; font-size: 13px; font-weight: 900; text-transform: uppercase;">' + n + '</h4>';

    var bloqueSlogan = s ? '<span class="popup-slogan">' + s + '</span>' : '';
    var badgeHorario = es24 
        ? '<span style="display:inline-block; background:rgba(0,255,100,0.15); color:var(--verde-hoja); font-weight:900; font-size:9px; padding:1px 6px; border-radius:4px; margin-top:2px;">[24 HORAS]</span>'
        : (h ? '<span style="display:block; font-size:9.5px; color:#aaa; margin-top:2px;">Horario: ' + h + '</span>' : '');

    var botonWhatsApp = w ? '<a href="https://wa.me/' + w + '" target="_blank" class="badge-comunicacion badge-whatsapp">WhatsApp: ' + w + '</a>' : '';
    var botonPbx = pbx ? '<a href="tel:' + pbx.replace(/\D/g, '') + '" class="badge-comunicacion badge-pbx">PBX: ' + pbx + '</a>' : '';

    var html = 
        '<div style="position: relative;">' +
            '<button type="button" onclick="if(window.popupActivo) window.popupActivo.remove();" style="position: absolute; top: 6px; left: 6px; z-index: 50; width: 24px; height: 24px; background: rgba(0,0,0,0.7); border: 1px solid rgba(255,255,255,0.25); color: #ffffff; border-radius: 50%; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center;">✕</button>' +
            '<img src="' + p + '" class="popup-portada">' +
        '</div>' +
        '<div class="popup-info">' +
            '<img src="' + l + '" class="popup-logo">' +
            '<div style="margin-top: 6px;">' + bloqueNombre + '</div>' +
            bloqueSlogan +
            '<div style="margin-top: 2px;">' +
                '<span style="font-size: 9px; color: var(--naranja); text-transform: uppercase; font-weight: bold;">' + c + '</span>' +
            '</div>' +
            badgeHorario +
            '<div style="display: flex; flex-direction: column; gap: 3px; margin-top: 6px;">' +
                botonWhatsApp +
                botonPbx +
            '</div>' +
        '</div>';

    if (window.popupActivo) window.popupActivo.remove();

    window.popupActivo = new maplibregl.Popup({
        offset: [0, 8],
        anchor: 'top',
        closeOnClick: false,
        closeButton: false,
        maxWidth: '210px',
        className: 'popup-boveda-estricto'
    })
    .setHTML(html)
    .setLngLat(instanciaMarker.getLngLat())
    .addTo(instanciaMapa);
};

window.buscarDireccionWizard = function() {
    var input = document.getElementById('wiz-direccion-inteligente');
    var query = input ? input.value.trim() : '';
    if (!query) return;
    var destino = window.resolverCoordenadaLocalOficina(query);
    if (destino && window.mapaOnboarding && window.markerOnboarding) {
        window.mapaOnboarding.flyTo({ center: [destino.lng, destino.lat], zoom: 16.5, duration: 1200 });
        window.markerOnboarding.setLngLat([destino.lng, destino.lat]);
        window.datosTienda.Coordenadas = { latitude: destino.lat, longitude: destino.lng };
        window.datosTienda.direccion = query;
    } else {
        window.datosTienda.direccion = query;
        alert("Direccion registrada. Toca cualquier punto del mapa o usa el boton GPS 📍 para colocar tu PIN sobre el local.");
    }
};

window.GUIA_FASES_ONBOARDING = {
    1: {
        titulo: "Paso 1: Identidad y Canales",
        pasos: [
            "1. Nombre, Lema y Nicho: Define como te encontraran los ciudadanos en el radar urbano.",
            "2. Canales de Contacto: Ingresa tu WhatsApp de pedidos y/o linea PBX. Si solo tienes PBX, el catalogo mostrara automaticamente el boton de llamada PBX.",
            "3. Privacidad y Horario: Tu correo permanece privado salvo que marques 'Hacer publico'. Configura tu horario o activa Servicio 24 Horas."
        ]
    },
    2: {
        titulo: "Paso 2: ADN Visual y Branding",
        pasos: [
            "1. Foto del PIN y Logo Tipografico: Toca el PIN central para subir la foto o icono de tu local, y carga opcionalmente tu logotipo en PNG/WebP sin fondo.",
            "2. Forma, Animacion y Emoticon: Elige la silueta geometrica, el movimiento 3D y toca el boton de Emoticon para abrir el teclado en cuadricula.",
            "3. Paleta Aurea Automatica: Pulsa 'Auto-Extraer Colores (PIN)' para detectar los colores de tu imagen o personalizalos tocando cada circulo."
        ]
    },
    3: {
        titulo: "Paso 3: Ubicacion y Gemelo Digital",
        pasos: [
            "1. Posiciona tu Comercio: Pulsa el boton GPS 📍 o toca directamente sobre tu cuadra en el mapa para fijar la coordenada exacta.",
            "2. Prueba tu Gemelo Digital: Toca tu PIN en el mapa para previsualizar como veran tu tarjeta los clientes.",
            "3. Pais y Regimen POS: Verifica el regimen (Colombia COP/DIAN o Venezuela USD/Multidivisa) y pulsa 'Sellar Boveda y Finalizar'."
        ]
    }
};

window.lanzarGuiaOnboardingFase = function(numFase, forzar) {
    var cfg = window.GUIA_FASES_ONBOARDING[numFase];
    if (!cfg) return;
    var claveVista = 'geokatu_onboarding_fase_vista_' + numFase;
    if (!forzar && sessionStorage.getItem(claveVista)) return;
    sessionStorage.setItem(claveVista, '1');

    var existente = document.getElementById('gk-guia-fase-modal');
    if (existente) existente.remove();

    var overlay = document.createElement('div');
    overlay.id = 'gk-guia-fase-modal';
    overlay.style.cssText = 'position:fixed; inset:0; z-index:200100; background:rgba(0,0,0,0.82); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); display:flex; align-items:center; justify-content:center; padding:18px; box-sizing:border-box;';

    var listaHtml = cfg.pasos.map(function(txt) {
        return '<div style="background:rgba(255,255,255,0.04); border-left:3px solid #ff6b00; border-radius:8px; padding:9px 11px; font-size:11.5px; color:#ddd; line-height:1.4; text-align:left;">' + txt + '</div>';
    }).join('');

    overlay.innerHTML =
        '<div style="background:#14141a; border:1px solid rgba(255,107,0,0.45); border-radius:20px; width:100%; max-width:370px; padding:20px 18px; box-sizing:border-box; box-shadow:0 16px 40px rgba(0,0,0,0.95); display:flex; flex-direction:column; gap:10px; text-align:center;">' +
            '<div style="display:inline-flex; align-self:center; background:rgba(255,107,0,0.15); color:#ff6b00; border:1px solid rgba(255,107,0,0.4); border-radius:20px; padding:3px 10px; font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:0.8px;">Guia Interactiva Geokatu</div>' +
            '<h3 style="margin:0; color:#fff; font-size:15px; font-weight:900; text-transform:uppercase;">' + cfg.titulo + '</h3>' +
            '<div style="display:flex; flex-direction:column; gap:8px; margin:4px 0;">' + listaHtml + '</div>' +
            '<button type="button" id="gk-btn-entendido-fase" style="width:100%; padding:12px; border-radius:12px; border:none; background:linear-gradient(135deg, #ff8c00, #ff6b00); color:#fff; font-size:12px; font-weight:900; text-transform:uppercase; letter-spacing:0.8px; cursor:pointer; margin-top:4px;">Entendido, Continuar</button>' +
        '</div>';

    document.body.appendChild(overlay);
    document.getElementById('gk-btn-entendido-fase').onclick = function() {
        if (navigator.vibrate) navigator.vibrate(20);
        overlay.remove();
    };
};


window.obtenerUbicacionActualWizard = function() {
    if (!navigator.geolocation) return alert("Tu dispositivo no soporta GPS.");
    navigator.geolocation.getCurrentPosition(function(pos) {
        var lat = pos.coords.latitude;
        var lng = pos.coords.longitude;
        if (window.mapaOnboarding && window.markerOnboarding) {
            window.mapaOnboarding.flyTo({ center: [lng, lat], zoom: 17 });
            window.markerOnboarding.setLngLat([lng, lat]);
        }
    }, function() {
        alert("No se pudo obtener acceso a tu GPS.");
    }, { enableHighAccuracy: true });
};

window.guardarPaso3Ubicacion = async function() {
    var btn = document.getElementById('btn-guardar-paso-2');
    btn.innerText = "Sellando Bóveda...";
    btn.disabled = true;

    var pos = window.markerOnboarding.getLngLat();
    var hash = window.generarGeohash(pos.lat, pos.lng);
    var selPais = document.getElementById('wiz-pais-comercio');
    var paisElegido = selPais ? selPais.value : window.detectarPaisPorCoordenadas(pos.lat, pos.lng);

    var t = window.datosTienda;

    // Payload canónico consolidado
    var payloadFinal = {
        nombre: t.nombre || "Comercio Aliado",
        slogan: t.slogan || "",
        cuerpo_articulo: t.slogan || "",
        nicho: t.nicho || t.categoria || "General",
        categoria: t.nicho || t.categoria || "General",
        categoria_maestra: t.nicho || t.categoria || "General",

        whatsapp: t.whatsapp || t.whatsApp || "",
        whatsApp: t.whatsapp || t.whatsApp || "",
        telefonos: t.telefonos || [t.whatsapp || ""],
        pbx: t.pbx || "",
        correo: t.correo || t.email || "",
        email: t.correo || t.email || "",
        instagram: t.instagram || "",
        web: t.web || t.sitio_web || "",
        sitio_web: t.web || t.sitio_web || "",

        horario: t.horario || "",
        es_24_horas: Boolean(t.es_24_horas),

        pin_pack: t.pin_pack || "forma-gota|anim-salto||",
        tema_popup: t.tema_popup || "carbon",
        color_principal: t.color_principal || "#ff6b00",
        color_acento: t.color_acento || "#8a909d",
        color_terciario: t.color_terciario || "#ffffff",
        color_cuaternario: t.color_cuaternario || "#0a0a0c",
        paleta_aurea: t.paleta_aurea || {},

        Coordenadas: { latitude: pos.lat, longitude: pos.lng },
        lat: pos.lat,
        lng: pos.lng,
        ubicacion: { lat: pos.lat, lng: pos.lng },
        geohash: hash,
        pais: paisElegido,

        progreso_boveda: 100,
        estado_moderacion: t.estado_moderacion || "pendiente",
        tipo_modelo: "negocio",
        fecha_actualizacion: new Date().toISOString()
    };

    if (t.link_pin) payloadFinal.link_pin = t.link_pin;
    if (t.nombre_png) payloadFinal.nombre_png = t.nombre_png;

    try {
        // 1. Payload público de cartografía (sin teléfonos planos)
        var payloadPublico = Object.assign({}, payloadFinal);
        delete payloadPublico.whatsapp;
        delete payloadPublico.whatsApp;
        delete payloadPublico.telefonos;
        delete payloadPublico.pbx;
        delete payloadPublico.correo;
        delete payloadPublico.email;

        await GeokatuDB.AdminService.actualizarNegocio(window.idNegocioLogueado, payloadPublico);

        // 2. Colección protegida de contacto (solo expone el correo si el usuario marcó el check público)
        var correoPublicoAutorizado = (t.mostrar_correo_publico === true) ? (t.correo || t.email || "") : "";
        await setDoc(doc(db, "Directorio_Contacto", window.idNegocioLogueado), {
            id: window.idNegocioLogueado,
            whatsapp: t.whatsapp || t.whatsApp || "",
            telefonos: t.telefonos || [t.whatsapp || ""],
            pbx: t.pbx || "",
            correo: correoPublicoAutorizado,
            mostrar_correo_publico: Boolean(t.mostrar_correo_publico === true),
            instagram: t.instagram || "",
            web: t.web || t.sitio_web || "",
            fecha_actualizacion: new Date().toISOString()
        }, { merge: true });


        localStorage.setItem('geokatu_pais_' + window.idNegocioLogueado, paisElegido);

        btn.innerText = "Bóveda Lista";
        setTimeout(function() { window.location.reload(); }, 500);
    } catch (e) {
        alert("Error al sellar ubicación: " + e.message);
        btn.disabled = false;
        btn.innerText = "Sellar Bóveda y Finalizar";
    }
};
// Mantenemos alias retrocompatible
window.guardarPaso2Ubicacion = window.guardarPaso3Ubicacion;

// ============================================================================
// PASO 1: CONTROLADOR DE IDENTIDAD Y OPERACIÓN (HORARIOS Y DATOS COMERCIALES)
// ============================================================================
window.hidratarCamposPaso1Identidad = function(emailAuth) {
    var t = window.datosTienda || {};
    var inNom = document.getElementById('wiz-nombre');
    var inSlo = document.getElementById('wiz-slogan');
    var inNic = document.getElementById('wiz-nicho');
    var inWa = document.getElementById('wiz-whatsapp');
    var inPbx = document.getElementById('wiz-pbx');
    var inCor = document.getElementById('wiz-correo-publico');
    var chkCorPub = document.getElementById('wiz-check-correo-publico');
    var inIg = document.getElementById('wiz-instagram');
    var inWeb = document.getElementById('wiz-web');
    var chk24 = document.getElementById('wiz-check-24h');
    var hIni = document.getElementById('wiz-hora-inicio');
    var hFin = document.getElementById('wiz-hora-fin');
    if (inNom) inNom.value = (t.nombre && t.nombre !== 'Mi Negocio') ? t.nombre : '';
    if (inSlo) inSlo.value = t.slogan || '';
    if (inNic) inNic.value = t.nicho || t.categoria || '';
    if (inWa) inWa.value = t.whatsapp || t.whatsApp || '';
    if (inPbx) inPbx.value = t.pbx || '';
    if (inCor) inCor.value = t.correo || t.email || emailAuth || '';

    // Por defecto el correo es PRIVADO (false), salvo que el comercio ya hubiera activado mostrarlo
    var mostrarCorreo = Boolean(t.mostrar_correo_publico === true);
    if (chkCorPub) chkCorPub.checked = mostrarCorreo;
    window.toggleVisibilidadCorreoWizard(mostrarCorreo);

    if (inIg) inIg.value = String(t.instagram || '').replace(/^@/, '');
    if (inWeb) inWeb.value = t.sitio_web || t.web || '';

    if (t.es_24_horas) {
        if (chk24) chk24.checked = true;
        window.toggleHorario24HWizard(true);
    } else if (t.horario && t.horario.includes('-')) {
        var partesH = t.horario.split('-').map(function(s) { return s.trim(); });
        if (hIni && partesH[0]) hIni.value = partesH[0];
        if (hFin && partesH[1]) hFin.value = partesH[1];
    }
};

window.toggleHorario24HWizard = function(es24) {
    var contRango = document.getElementById('contenedor-rango-horas');
    var hIni = document.getElementById('wiz-hora-inicio');
    var hFin = document.getElementById('wiz-hora-fin');
    if (contRango) {
        contRango.style.opacity = es24 ? "0.35" : "1";
        contRango.style.pointerEvents = es24 ? "none" : "auto";
    }
    if (hIni) hIni.disabled = es24;
    if (hFin) hFin.disabled = es24;
};

window.toggleVisibilidadCorreoWizard = function(esPublico) {
    var inCor = document.getElementById('wiz-correo-publico');
    if (inCor) {
        inCor.style.opacity = esPublico ? "1" : "0.55";
        inCor.style.borderColor = esPublico ? "var(--naranja)" : "var(--glass-border)";
    }
};

window.guardarPaso1Identidad = async function() {
    var nom = document.getElementById('wiz-nombre').value.trim();
    var nic = document.getElementById('wiz-nicho').value.trim();
    var wa = document.getElementById('wiz-whatsapp').value.trim().replace(/\D/g, '');
    if (!nom) return alert("Por favor ingresa el nombre comercial.");
    if (!nic) return alert("Selecciona o escribe el nicho o categoría de tu negocio.");
    if (wa.length < 7) return alert("Ingresa un número de WhatsApp válido.");
    var btn = document.getElementById('btn-guardar-paso-1');
    btn.innerText = "Guardando...";
    btn.disabled = true;
    var es24 = document.getElementById('wiz-check-24h').checked;
    var horarioStr = es24 
        ? "24 Horas" 
        : (document.getElementById('wiz-hora-inicio').value + " - " + document.getElementById('wiz-hora-fin').value);
    var igHandle = document.getElementById('wiz-instagram').value.trim().replace(/^@/, '');
    var webUrl = document.getElementById('wiz-web').value.trim();
    var correoInput = document.getElementById('wiz-correo-publico').value.trim();
    var chkCorreoPub = document.getElementById('wiz-check-correo-publico');
    var mostrarCorreoPub = chkCorreoPub ? chkCorreoPub.checked : false;
    var pbxVal = document.getElementById('wiz-pbx').value.trim();
    var payloadIdentidad = {
        nombre: nom,
        slogan: document.getElementById('wiz-slogan').value.trim(),
        cuerpo_articulo: document.getElementById('wiz-slogan').value.trim(),
        nicho: nic,
        categoria: nic,
        categoria_maestra: nic,
        whatsapp: wa,
        whatsApp: wa,
        telefonos: [wa],
        pbx: pbxVal,
        correo_interno: correoInput,
        correo: mostrarCorreoPub ? correoInput : "",
        email: mostrarCorreoPub ? correoInput : "",
        mostrar_correo_publico: mostrarCorreoPub,
        instagram: igHandle,
        web: webUrl,
        sitio_web: webUrl,
        horario: horarioStr,
        es_24_horas: es24,
        progreso_boveda: 35
    };

    try {
        await GeokatuDB.AdminService.actualizarNegocio(window.idNegocioLogueado, payloadIdentidad);
        Object.assign(window.datosTienda, payloadIdentidad);
        document.getElementById('fase-1-identidad').style.display = 'none';
        var fasePin = document.getElementById('fase-1-pin');
        if (fasePin) fasePin.style.display = 'block';
        window.cargarDiccionarioEmojis();
        window.actualizarPinLive();
        setTimeout(function() { if (window.lanzarGuiaOnboardingFase) window.lanzarGuiaOnboardingFase(2); }, 450);
    } catch (e) {

        alert("Error al guardar identidad: " + e.message);
    } finally {
        btn.innerText = "Continuar a Diseño de PIN";
        btn.disabled = false;
    }
};

window.marcarIncidenciaRevisada = async function(idAlerta) {
    try {
        await updateDoc(doc(db, "Alertas_Seguridad", idAlerta), {
            estado: "auditada_resuelta",
            resuelto: true,
            fecha_auditoria: new Date().toISOString()
        });
        if (navigator.vibrate) navigator.vibrate(20);
    } catch (e) {
        alert("Error al archivar incidencia: " + e.message);
    }
};
// ============================================================================
// CONTROLADOR DEL BOTTOM-SHEET DRILLDOWN DE MÉTRICAS, INCIDENCIAS Y GESTOS
// ============================================================================
window.tipoKpiActivoModal = null;
window.tabIndiceKpiActivo = 0;

window.mostrarTooltipKpiHelp = function(btnElement) {
    if (navigator.vibrate) navigator.vibrate(25);
    var el = document.getElementById('tooltip-kpi-info');
    if (!el) return;
    el.innerHTML = 
        '<div style="display:flex; gap:8px; align-items:flex-start;">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--naranja)" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>' +
            '<div style="flex:1;">' +
                '<strong style="color:#ffffff; display:block; margin-bottom:2px;">Métricas Interactivas</strong>' +
                '<p style="margin:0; color:#b5b5be; line-height:1.35; font-size:10.5px;">Toca cualquier tarjeta de métrica para desplegar su historial detallado, auditoría de hoy y filtros por código o fecha.</p>' +
            '</div>' +
        '</div>';
    el.style.display = 'block';
    el.classList.remove('fade-out');
    el.classList.add('activo');
    setTimeout(function() {
        el.classList.add('fade-out');
        setTimeout(function() {
            el.style.display = 'none';
            el.classList.remove('activo');
            el.classList.remove('fade-out');
        }, 350);
    }, 4500);
};

window.abrirModalDetalleKPI = function(tipo) {
    if (navigator.vibrate) navigator.vibrate(30);
    window.tipoKpiActivoModal = tipo;
    window.tabIndiceKpiActivo = 0;

    // Registrar estado en el historial del navegador para capturar el botón atrás
    window.history.pushState({ modal_kpi_abierta: true }, '');

    var titulos = {
        incidencias: { t: "Incidencias y Auditoría", sub: "Control de seguridad, stock y turnos" },
        ventas: { t: "Ventas y Recaudos", sub: "Desglose financiero del comercio" },
        tickets: { t: "Tickets Emitidos", sub: "Trazabilidad de cajas y comprobantes" },
        articulos: { t: "Inventario de Catálogo", sub: "Estado de existencias en mostrador" }
    };

    var config = titulos[tipo] || { t: "Desglose Operativo", sub: "Registros en tiempo real" };
    document.getElementById('txt-kpi-sheet-titulo').innerText = config.t;
    document.getElementById('txt-kpi-sheet-subtitulo').innerText = config.sub;

    // Configuración de los nombres de pestañas según la métrica
    var tabNombres = {
        incidencias: ["Hoy", "Pendientes", "Historial"],
        ventas: ["Hoy", "Grandes", "Historial"],
        tickets: ["Hoy", "Con DIAN", "Historial"],
        articulos: ["En Stock", "Agotados", "Bajo Stock"]
    };

    var nombres = tabNombres[tipo] || ["Hoy", "Pendientes", "Historial"];
    for (var i = 0; i < 3; i++) {
        var btnTab = document.getElementById('kpi-tab-' + i);
        if (btnTab) {
            btnTab.innerText = nombres[i];
            if (i === 0) btnTab.classList.add('activo');
            else btnTab.classList.remove('activo');
        }
    }

    window.limpiarFiltrosKpiModal(false);

    var overlay = document.getElementById('overlay-kpi-drilldown');
    var sheet = document.getElementById('sheet-kpi-drilldown');
    if (overlay) overlay.style.display = 'flex';
    setTimeout(function() {
        if (sheet) sheet.classList.add('activo');
    }, 10);

    window.filtrarContenidoKpiModal();
};

window.conmutarTabModalKPI = function(indice) {
    if (navigator.vibrate) navigator.vibrate(20);
    window.tabIndiceKpiActivo = indice;
    for (var i = 0; i < 3; i++) {
        var btn = document.getElementById('kpi-tab-' + i);
        if (btn) {
            if (i === indice) btn.classList.add('activo');
            else btn.classList.remove('activo');
        }
    }
    window.filtrarContenidoKpiModal();
};

window.limpiarFiltrosKpiModal = function(ejecutarRender = true) {
    var inCod = document.getElementById('kpi-filtro-codigo');
    var inOp = document.getElementById('kpi-filtro-operario');
    var inFec = document.getElementById('kpi-filtro-fecha');
    if (inCod) inCod.value = '';
    if (inOp) inOp.value = '';
    if (inFec) inFec.value = '';
    if (ejecutarRender) window.filtrarContenidoKpiModal();
};

window.cerrarModalDetalleKPI = function(desdePopstate = false) {
    var sheet = document.getElementById('sheet-kpi-drilldown');
    var overlay = document.getElementById('overlay-kpi-drilldown');
    if (sheet) sheet.classList.remove('activo');
    setTimeout(function() {
        if (overlay) overlay.style.display = 'none';
        window.tipoKpiActivoModal = null;
    }, 280);

    // Si se cerro por clic exterior o boton X, revertir el pushState sin salir de oficina
    if (!desdePopstate && window.history.state && window.history.state.modal_kpi_abierta) {
        window.history.back();
    }
};

// ============================================================================
// MOTOR DE FILTRADO Y RENDERIZADO DEL CONTENIDO DE LA MODAL
// ============================================================================
window.filtrarContenidoKpiModal = function() {
    var contenedor = document.getElementById('kpi-modal-lista-scroll');
    if (!contenedor) return;

    var tipo = window.tipoKpiActivoModal;
    var tabIdx = window.tabIndiceKpiActivo;

    var fCodigo = (document.getElementById('kpi-filtro-codigo')?.value || '').trim().toLowerCase();
    var fOp = (document.getElementById('kpi-filtro-operario')?.value || '').trim().toLowerCase();
    var fFecha = document.getElementById('kpi-filtro-fecha')?.value || '';

    // 1. RENDERIZADO DE LA MÉTRICA DE INCIDENCIAS
    if (tipo === 'incidencias') {
        var lista = [].concat(window.incidenciasCacheGlobal || []);
        var ahora = new Date();
        var inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();

        // Filtro por pestaña
        if (tabIdx === 0) {
            // "Hoy": incidencias desde las 00:00 de hoy
            lista = lista.filter(function(a) {
                var t = a.timestamp_alerta ? new Date(a.timestamp_alerta.toDate ? a.timestamp_alerta.toDate() : a.timestamp_alerta).getTime() : 0;
                return t >= inicioHoy;
            });
        } else if (tabIdx === 1) {
            // "Pendientes": las que requieran atencion
            lista = lista.filter(function(a) {
                return a.estado === "requiere_auditoria_urgente" || !a.resuelto;
            });
        }
        // tabIdx === 2 es "Historial" (muestra todas en orden cronologico)

        // Filtros manuales del submenu superior
        if (fCodigo) {
            lista = lista.filter(function(a) {
                return (a.codigo_cajero && a.codigo_cajero.toLowerCase().indexOf(fCodigo) !== -1) ||
                       (a.id_producto && a.id_producto.toLowerCase().indexOf(fCodigo) !== -1) ||
                       (a.id_compartimiento && a.id_compartimiento.toLowerCase().indexOf(fCodigo) !== -1);
            });
        }
        if (fOp) {
            lista = lista.filter(function(a) {
                return (a.cajero && a.cajero.toLowerCase().indexOf(fOp) !== -1) ||
                       (a.operador_uid && a.operador_uid.toLowerCase().indexOf(fOp) !== -1) ||
                       (a.codigo_cajero && a.codigo_cajero.toLowerCase().indexOf(fOp) !== -1);
            });
        }
        if (fFecha) {
            lista = lista.filter(function(a) {
                var dStr = a.timestamp_alerta ? new Date(a.timestamp_alerta.toDate ? a.timestamp_alerta.toDate() : a.timestamp_alerta).toISOString().split('T')[0] : '';
                return dStr === fFecha;
            });
        }

        if (lista.length === 0) {
            var msjsVacios = [
                "Sin incidencias registradas hoy.",
                "No hay incidencias pendientes por resolver.",
                "Historial de incidencias vacio."
            ];
            contenedor.innerHTML = '<p style="text-align: center; color: #888; font-style: italic; padding: 40px 10px; font-size: 12px; margin: 0;">' + (msjsVacios[tabIdx] || "Sin registros.") + '</p>';
            return;
        }

        var html = '';
        lista.forEach(function(a) {
            var fechaObj = a.timestamp_alerta ? new Date(a.timestamp_alerta.toDate ? a.timestamp_alerta.toDate() : a.timestamp_alerta) : null;
            var fechaStr = fechaObj ? (fechaObj.toLocaleDateString() + ' ' + fechaObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) : '--:--';
            var estaResuelta = Boolean(a.resuelto);

            if (a.tipo === 'ACCESO_FUERA_DE_TURNO') {
                var coordsTxt = (a.coordenadas && a.coordenadas.lat) 
                    ? (a.coordenadas.lat + ', ' + a.coordenadas.lng + ' (±' + (a.coordenadas.precision_m || 0) + 'm)')
                    : 'Sin coordenadas';

                html += 
                    '<div class="incidente-item" style="border-left-color: ' + (estaResuelta ? '#00ff64' : '#ffaa00') + '; background: rgba(0,0,0,0.45); padding: 10px 12px;">' +
                        '<div style="display:flex; justify-content:space-between; align-items:center;">' +
                            '<span class="badge-alerta-urgente" style="background:' + (estaResuelta ? 'rgba(0,255,100,0.15)' : 'rgba(255,170,0,0.18)') + '; color:' + (estaResuelta ? '#00ff64' : '#ffaa00') + '; border:1px solid ' + (estaResuelta ? 'rgba(0,255,100,0.4)' : 'rgba(255,170,0,0.4)') + '; font-size:9.5px;">Acceso Fuera de Turno</span>' +
                            '<span style="font-size:10px; color:#888; font-family:monospace;">' + fechaStr + '</span>' +
                        '</div>' +
                        '<div style="margin-top:4px;">' +
                            '<strong style="font-size:12px; color:white;">Operario: OP #' + (a.codigo_cajero || '----') + ' (' + (a.rol || 'Caja') + ')</strong>' +
                            '<p style="font-size:10.5px; color:#aaa; margin:2px 0 0 0;">' +
                                'Motivo: <span style="color:#ffaa00;">' + (a.motivo || 'Ingreso extraordinario') + '</span><br>' +
                                'GPS: <span style="color:#ddd; font-family:monospace;">' + coordsTxt + '</span>' +
                            '</p>' +
                        '</div>' +
                        (!estaResuelta 
                            ? '<button type="button" class="btn-submit" style="margin-top:8px !important; padding:6px !important; font-size:10px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2); color:#ddd;" onclick="window.marcarIncidenciaRevisada(\'' + a.id_doc + '\')">Marcar como Revisado</button>' 
                            : '<span style="font-size:9.5px; color:#00ff64; font-weight:bold; margin-top:6px; display:block;">Revisado / Auditado</span>') +
                    '</div>';
            } else {
                var esMerma = a.tipo === 'MERMA_EN_ANAQUEL';
                var nomProd = a.nombre_producto || a.id_producto || "Articulo";
                var nomLimpio = nomProd.replace(/'/g, "\\'");

                html += 
                    '<div class="incidente-item" style="border-left-color: ' + (estaResuelta ? '#00ff64' : (esMerma ? '#ffaa00' : '#ff4444')) + '; background: rgba(0,0,0,0.45); padding: 10px 12px;">' +
                        '<div style="display:flex; justify-content:space-between; align-items:center;">' +
                            '<span class="badge-alerta-urgente" style="background:' + (estaResuelta ? 'rgba(0,255,100,0.15)' : 'rgba(255,68,68,0.2)') + '; color:' + (estaResuelta ? '#00ff64' : '#ff4444') + '; border:1px solid ' + (estaResuelta ? 'rgba(0,255,100,0.4)' : 'rgba(255,68,68,0.4)') + ';">' + (esMerma ? 'Averia Anaquel' : 'Quiebre Stock') + '</span>' +
                            '<span style="font-size:10px; color:#888; font-family:monospace;">' + fechaStr + '</span>' +
                        '</div>' +
                        '<div style="margin-top:4px;">' +
                            '<strong style="font-size:12px; color:white;">' + nomProd + '</strong>' +
                            '<p style="font-size:10.5px; color:#aaa; margin:2px 0 0 0;">' + (a.motivo || 'Desfase de unidades en anaquel') + '</p>' +
                        '</div>' +
                        (!estaResuelta 
                            ? '<button type="button" class="btn-submit" style="margin-top:8px !important; padding:6px !important; font-size:10.5px; background:rgba(0,255,100,0.15); border:1px solid rgba(0,255,100,0.4); color:#00ff64;" onclick="window.abrirModalConciliacion(\'' + a.id_doc + '\', \'' + (a.id_producto || '') + '\', \'' + nomLimpio + '\', \'' + (a.stock_negativo_registrado || 0) + '\')">Conciliar Stock Fisico</button>'
                            : '<span style="font-size:9.5px; color:#00ff64; font-weight:bold; margin-top:6px; display:block;">Conciliado</span>') +
                    '</div>';
            }
        });
        contenedor.innerHTML = html;
        return;
    }

    // 2. RENDERIZADO DE LAS OTRAS 3 MÉTRICAS (CATÁLOGO, TICKETS, VENTAS)
    if (tipo === 'articulos') {
        var prods = [].concat(window.listaProductosGlobal || []);
        if (tabIdx === 1) prods = prods.filter(p => p.agotado);
        else if (tabIdx === 2) prods = prods.filter(p => (Number(p.stock_actual) || 0) <= 3 && !p.agotado);
        else prods = prods.filter(p => !p.agotado);

        if (fCodigo) prods = prods.filter(p => (p.codigo_barras && p.codigo_barras.toLowerCase().includes(fCodigo)) || p.id_prod.toLowerCase().includes(fCodigo));
        if (fOp) prods = prods.filter(p => p.nombre.toLowerCase().includes(fOp));

        if (prods.length === 0) {
            contenedor.innerHTML = '<p style="text-align: center; color: #888; font-style: italic; padding: 40px 10px; font-size: 12px; margin: 0;">Sin articulos bajo este criterio.</p>';
            return;
        }

        var htmlArt = '';
        prods.forEach(p => {
            htmlArt += 
                '<div style="background: rgba(0,0,0,0.4); border: 1px solid var(--glass-border); border-radius: 10px; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center;">' +
                    '<div>' +
                        '<strong style="color:white; font-size:12px; display:block;">' + p.nombre + '</strong>' +
                        '<span style="font-size:10px; color:#888; font-family:monospace;">EAN: ' + (p.codigo_barras || 'S/N') + ' | Cat: ' + (p.categoria || 'Gral') + '</span>' +
                    '</div>' +
                    '<div style="text-align:right;">' +
                        '<strong style="color:var(--naranja); font-size:13px; font-family:monospace;">$' + p.precio + '</strong>' +
                        '<span style="display:block; font-size:10px; color:' + (p.agotado ? '#ff4444' : '#00ff64') + '; font-weight:bold;">' + (p.agotado ? 'AGOTADO' : (p.stock_actual + ' ' + (p.unidad_medida || 'und'))) + '</span>' +
                    '</div>' +
                '</div>';
        });
        contenedor.innerHTML = htmlArt;
        return;
    }

    // 3. RENDERIZADO DE LA MÉTRICA: VENTAS DEL DÍA
    if (tipo === 'ventas') {
        var ventas = [].concat(window.ventasCacheGlobal || []);
        var ahora = new Date();
        var inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();

        // Filtro por pestañas de Ventas: ["Hoy", "Grandes", "Historial"]
        if (tabIdx === 0) {
            // "Hoy": Ventas asentadas desde las 00:00 de hoy
            ventas = ventas.filter(function(v) {
                var t = v.fecha_creacion || v.timestamp || 0;
                return new Date(t).getTime() >= inicioHoy;
            });
        } else if (tabIdx === 1) {
            // "Grandes": Ventas destacadas con ticket superior a $50.000 COP
            ventas = ventas.filter(function(v) {
                var total = Number(v.total_cobrado || v.total || 0);
                return total >= 50000;
            });
        }
        // tabIdx === 2 es "Historial" (todas las ventas ordenadas cronológicamente)

        // Filtros manuales del submenú superior
        if (fCodigo) {
            ventas = ventas.filter(function(v) {
                var tId = (v.ticketIdLocal || v.id_doc || '').toLowerCase();
                return tId.indexOf(fCodigo) !== -1;
            });
        }
        if (fOp) {
            ventas = ventas.filter(function(v) {
                var op = (v.cajero_pin || v.cajero || v.operador_uid || '').toLowerCase();
                return op.indexOf(fOp) !== -1;
            });
        }
        if (fFecha) {
            ventas = ventas.filter(function(v) {
                var t = v.fecha_creacion || v.timestamp || '';
                var dStr = t ? new Date(t).toISOString().split('T')[0] : '';
                return dStr === fFecha;
            });
        }

        if (ventas.length === 0) {
            var msjsVaciosVentas = [
                "No hay ventas registradas el día de hoy.",
                "No hay ventas de alto valor registradas.",
                "Historial de ventas vacío."
            ];
            contenedor.innerHTML = '<p style="text-align:center; color:#888; font-style:italic; padding:40px 10px; font-size:12px; margin:0;">' + (msjsVaciosVentas[tabIdx] || "Sin ventas.") + '</p>';
            return;
        }

        var htmlVentas = '';
        ventas.forEach(function(v) {
            var total = Number(v.total_cobrado || v.total || 0);
            var fecha = v.fecha_creacion || v.timestamp;
            var horaStr = fecha ? new Date(fecha).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
            var fechaStr = fecha ? new Date(fecha).toLocaleDateString() : '';
            var cantItems = Array.isArray(v.items) ? v.items.length : (v.total_articulos || 1);
            var medioPago = v.medio_pago || (Array.isArray(v.pagos) && v.pagos[0] ? v.pagos[0].metodo : 'EFECTIVO');

            htmlVentas += 
                '<div style="background:rgba(0,0,0,0.4); border:1px solid var(--glass-border); border-radius:12px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">' +
                    '<div>' +
                        '<div style="display:flex; align-items:center; gap:6px;">' +
                            '<strong style="color:#ffffff; font-size:12.5px; font-family:monospace;">' + (v.ticketIdLocal || v.id_doc.slice(-6).toUpperCase()) + '</strong>' +
                            '<span style="background:rgba(0,255,100,0.12); color:#00ff64; font-size:9.5px; padding:1px 5px; border-radius:4px; font-weight:bold; text-transform:uppercase;">' + medioPago + '</span>' +
                        '</div>' +
                        '<span style="font-size:10px; color:#888; display:block; margin-top:2px;">' + cantItems + ' art. | OP: ' + (v.cajero_pin || '0000') + ' | ' + fechaStr + ' ' + horaStr + '</span>' +
                    '</div>' +
                    '<div style="text-align:right;">' +
                        '<strong style="color:#00ff64; font-size:14px; font-family:monospace;">$' + total.toLocaleString('es-CO') + '</strong>' +
                    '</div>' +
                '</div>';
        });
        contenedor.innerHTML = htmlVentas;
        return;
    }

    // 4. RENDERIZADO DE LA MÉTRICA: TICKETS EMITIDOS
    if (tipo === 'tickets') {
        var tickets = [].concat(window.ventasCacheGlobal || []);
        var ahoraT = new Date();
        var inicioHoyT = new Date(ahoraT.getFullYear(), ahoraT.getMonth(), ahoraT.getDate()).getTime();

        // Filtro por pestañas de Tickets: ["Hoy", "Con DIAN", "Historial"]
        if (tabIdx === 0) {
            tickets = tickets.filter(function(tk) {
                var t = tk.fecha_creacion || tk.timestamp || 0;
                return new Date(t).getTime() >= inicioHoyT;
            });
        } else if (tabIdx === 1) {
            // "Con DIAN": Comprobantes enviados o enlazados a facturación electrónica
            tickets = tickets.filter(function(tk) {
                return tk.factura_electronica || (tk.despacho_fiscal && tk.despacho_fiscal.estado === 'FACTURADO_EXITOSO');
            });
        }
        // tabIdx === 2 es "Historial"

        if (fCodigo) {
            tickets = tickets.filter(function(tk) {
                var tId = (tk.ticketIdLocal || tk.id_doc || '').toLowerCase();
                return tId.indexOf(fCodigo) !== -1;
            });
        }
        if (fOp) {
            tickets = tickets.filter(function(tk) {
                var op = (tk.cajero_pin || tk.cajero || tk.operador_uid || '').toLowerCase();
                return op.indexOf(fOp) !== -1;
            });
        }
        if (fFecha) {
            tickets = tickets.filter(function(tk) {
                var t = tk.fecha_creacion || tk.timestamp || '';
                var dStr = t ? new Date(t).toISOString().split('T')[0] : '';
                return dStr === fFecha;
            });
        }

        if (tickets.length === 0) {
            var msjsVaciosTickets = [
                "No hay tickets timbrados hoy.",
                "No hay facturas electrónicas DIAN en este periodo.",
                "Historial de tickets vacío."
            ];
            contenedor.innerHTML = '<p style="text-align:center; color:#888; font-style:italic; padding:40px 10px; font-size:12px; margin:0;">' + (msjsVaciosTickets[tabIdx] || "Sin comprobantes.") + '</p>';
            return;
        }

        var htmlTickets = '';
        tickets.forEach(function(tk) {
            var total = Number(tk.total_cobrado || tk.total || 0);
            var fecha = tk.fecha_creacion || tk.timestamp;
            var fechaCompleta = fecha ? new Date(fecha).toLocaleDateString() + ' ' + new Date(fecha).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
            var esDian = tk.factura_electronica || (tk.despacho_fiscal && tk.despacho_fiscal.estado === 'FACTURADO_EXITOSO');
            var cufeOId = (tk.despacho_fiscal && tk.despacho_fiscal.consecutivo) ? tk.despacho_fiscal.consecutivo : (tk.ticketIdLocal || tk.id_doc.slice(-6).toUpperCase());

            htmlTickets += 
                '<div style="background:rgba(0,0,0,0.4); border:1px solid var(--glass-border); border-radius:12px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">' +
                    '<div>' +
                        '<div style="display:flex; align-items:center; gap:6px;">' +
                            '<strong style="color:#ffffff; font-size:12px; font-family:monospace;">#' + cufeOId + '</strong>' +
                            '<span style="background:' + (esDian ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.06)') + '; color:' + (esDian ? '#60a5fa' : '#888') + '; font-size:9px; padding:1px 5px; border-radius:4px; font-weight:bold;">' + (esDian ? 'DIAN ELECTRÓNICA' : 'EQUIVALENTE POS') + '</span>' +
                        '</div>' +
                        '<span style="font-size:10px; color:#888; display:block; margin-top:2px;">Cajero: OP #' + (tk.cajero_pin || '0000') + ' | ' + fechaCompleta + '</span>' +
                    '</div>' +
                    '<div style="text-align:right;">' +
                        '<strong style="color:#60a5fa; font-size:13.5px; font-family:monospace;">$' + total.toLocaleString('es-CO') + '</strong>' +
                    '</div>' +
                '</div>';
        });
        contenedor.innerHTML = htmlTickets;
        return;
    }

};

// ============================================================================
// GESTOS TÁCTILES: SWIPE DOWN TO DISMISS & ATRÁS NATIVO DE ANDROID
// ============================================================================
window.addEventListener('popstate', function(e) {
    var overlayKpi = document.getElementById('overlay-kpi-drilldown');
    if (overlayKpi && overlayKpi.style.display !== 'none') {
        window.cerrarModalDetalleKPI(true);
        return;
    }
});

// Soporte de deslizamiento táctil hacia abajo en la cabecera de la modal
(function inicializarGestoArrastreKpi() {
    var handle = document.getElementById('drag-handle-kpi');
    var sheet = document.getElementById('sheet-kpi-drilldown');
    if (!handle || !sheet) return;

    var inicioY = 0;
    var deltaY = 0;

    handle.addEventListener('touchstart', function(e) {
        inicioY = e.touches[0].clientY;
        sheet.style.transition = 'none';
    }, { passive: true });

    handle.addEventListener('touchmove', function(e) {
        deltaY = e.touches[0].clientY - inicioY;
        if (deltaY > 0) {
            sheet.style.transform = 'translateY(' + deltaY + 'px)';
        }
    }, { passive: true });

    handle.addEventListener('touchend', function() {
        sheet.style.transition = 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)';
        if (deltaY > 90) {
            window.cerrarModalDetalleKPI();
        } else {
            sheet.style.transform = 'translateY(0)';
        }
        inicioY = 0;
        deltaY = 0;
    });
})();







