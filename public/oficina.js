/**

* ============================================================================

* GEOKATU | OFICINA DE CONTROL Y BÓVEDA COMERCIAL (oficina.js)

* Motor Lógico Modular Unificado

* ============================================================================

*/



import GeokatuDB, { CatalogoMatrizService } from './core-db.js';

import { BillingGuard } from './billing-guard.js';

import * as geofire from 'https://cdn.jsdelivr.net/npm/geofire-common@5.2.0/+esm';

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

window.generarGeohash = (lat, lng) => geofire.geohashForLocation([lat, lng]);

// Ruteador dinámico según país del comercio
window.abrirTerminalPOS = async function() {
    var idTenant = window.idNegocioLogueado || localStorage.getItem('geokatu_active_uid');
    if (!idTenant) {
        window.open('pos.html', '_blank');
        return;
    }
    var destino = await GeokatuDB.PosService.obtenerDestinoPOS(idTenant);
    window.open(destino, '_blank');
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

window.cargarPreviewNombrePng = function(input, contexto) {
    if (input.files && input.files[0]) {
        var f = input.files[0];
        var reader = new FileReader();
        reader.onload = function(e) {
            var dataUrl = e.target.result;
            if (contexto === 'fase1') {
                window.nombrePngTemporalPaso1 = dataUrl;
                var img1 = document.getElementById('fase1-img-nombre-preview');
                var ph1 = document.getElementById('fase1-placeholder-nombre');
                if (img1) { img1.src = dataUrl; img1.style.display = 'block'; }
                if (ph1) ph1.style.display = 'none';
            } else {
                window.nombrePngTemporalModal = dataUrl;
                var imgM = document.getElementById('modal-img-nombre-preview');
                var phM = document.getElementById('modal-placeholder-nombre');
                if (imgM) { imgM.src = dataUrl; imgM.style.display = 'block'; }
                if (phM) phM.style.display = 'none';
            }
        };
        reader.readAsDataURL(f);
    }
};

window.subirImagenDirecta = async function(tipo, input) {
    if (!input.files || !input.files[0] || !window.idNegocioLogueado) return;
    var file = input.files[0];
    try {
        var path = 'tiendas/' + window.idNegocioLogueado + '/' + tipo + (tipo === 'nombre_png' ? '.png' : '.webp');
        var res = await GeokatuDB.AdminService.subirArchivo(path, file);
        var url = (typeof res === 'string') ? res : (res && res.data ? res.data : '');
        if (url) {
            var payload = {};
            payload[tipo] = url;
            await GeokatuDB.AdminService.actualizarNegocio(window.idNegocioLogueado, payload);
            window.datosTienda[tipo] = url;
            if (tipo === 'nombre_png') {
                var elPng = document.getElementById('ui-nombre-png');
                var elNom = document.getElementById('ui-nombre');
                if (elPng) { elPng.src = url; elPng.style.display = 'block'; }
                if (elNom) elNom.style.display = 'none';
            } else if (tipo === 'logo') {
                var elLogo = document.getElementById('ui-logo');
                if (elLogo) { elLogo.src = url; elLogo.style.display = 'block'; }
            }
            if (window.miniMapaPerfil) window.abrirGemeloDigital();
        }
    } catch (err) {
        console.error("Error subida directa " + tipo + ":", err);
    }
};


// ============================================================================

// BLOQUE 1: SESIÓN, CONTROL DE ACCESO Y SEGURIDAD

// ============================================================================

GeokatuDB.SecurityService.observarEstadoSesion(async (user) => {

if (user) {

window.idNegocioLogueado = user.uid;

await GeokatuDB.SecurityService.sellarSesionTerminalLocal(user.uid);



var loginScreen = document.getElementById('login-screen');
        if (loginScreen) loginScreen.style.display = 'none';

        var uidBadge = document.getElementById('ofi-uid-badge');
        if (uidBadge) uidBadge.innerText = 'ID: ' + user.uid.slice(0, 8) + '...';

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
        } else if (progreso >= 60) {
            // Paso 3: Ubicación y Gemelo Digital
            window.iniciarSandboxGeoespacial(false);
        } else if (progreso >= 30) {
            // Paso 2: ADN y Branding
            if (fasePin) fasePin.style.display = 'block';
            window.cargarDiccionarioEmojis();
            window.actualizarPinLive();
        } else {
            // Paso 1: Identidad y Operación
            if (faseIdentidad) faseIdentidad.style.display = 'block';
            window.hidratarCamposPaso1Identidad(user.email);
        }



} else {

const loginScreen = document.getElementById('login-screen');

const dashboardScreen = document.getElementById('dashboard-screen');

if (loginScreen) loginScreen.style.display = 'block';

if (dashboardScreen) dashboardScreen.style.display = 'none';



if (typeof window.desuscripcionAlertas === 'function') {

window.desuscripcionAlertas();

}

}

});



window.iniciarSesionGoogle = async function() {

const res = await GeokatuDB.SecurityService.iniciarConGoogle();

if (!res.success) alert("Error de autenticación: " + res.error);

};



window.cerrarSesionOficina = async function() {

if (confirm("¿Cerrar sesión de la consola de administración?")) {

await GeokatuDB.SecurityService.cerrarSesion();

GeokatuDB.SecurityService.destruirSesionTerminalLocal();

window.location.reload();

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
        var coords = window.datosTienda.Coordenadas || { latitude: 4.8133, longitude: -75.6961 };
        var lat = coords.latitude || coords._lat || 4.8133;
        var lng = coords.longitude || coords._long || -75.6961;
        setTimeout(function() { window.inicializarMiniMapaPerfil(lat, lng); }, 150);
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



if (badgePlan) {
    badgePlan.innerText = 'PLAN: ' + (window.datosTienda.premium ? 'PREMIUM VIP' : 'ESTÁNDAR');
    if (window.datosTienda.premium) badgePlan.classList.add('premium');
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
        const acum = JSON.parse(localStorage.getItem('geokatu_acumulado_' + window.idNegocioLogueado) || "{}");
        const totalVendido = (acum.efectivo || 0) + (acum.tarjeta || 0) + (acum.nequi || 0);
        const elVentas = document.getElementById('kpi-ventas-dia');
        if (elVentas) elVentas.innerText = '$' + totalVendido.toLocaleString('es-CO');

        const prodsSnap = await getDocs(collection(db, 'Directorio/' + window.idNegocioLogueado + '/productos'));
        let cantProds = 0;
        prodsSnap.forEach(d => { if (!d.data().eliminado) cantProds++; });
        const elTotal = document.getElementById('kpi-articulos-total');
        if (elTotal) elTotal.innerText = cantProds;

        const ventasSnap = await getDocs(query(collection(db, 'Directorio/' + window.idNegocioLogueado + '/Ventas_POS'), limit(100)));
        const elTickets = document.getElementById('kpi-tickets-cant');
        if (elTickets) elTickets.innerText = ventasSnap.size;

        // Escuchar y reflejar incidencias en tiempo real desde el arranque
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
        cont.innerHTML = "<p style='text-align:center; color:#888; padding:20px 0;'>Cargando inventario...</p>";
        window.ultimoDocCatalogo = null;
        window.listaProductosGlobal = [];
    } else if (btnMas) {
        btnMas.innerText = "Cargando...";
        btnMas.disabled = true;
    }

    try {
        var filtros = {
            terminoBusqueda: window.terminoBusquedaActual,
            limite: 20,
            startAfterDoc: reiniciar ? null : window.ultimoDocCatalogo
        };

        var resp = await GeokatuDB.AdminService.obtenerProductos(window.idNegocioLogueado, filtros);
        var success = resp.success;
        var data = resp.data;
        var ultimoDoc = resp.ultimoDoc;

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
window.actualizarNombreImagenUI = function(input, idTexto) {
    var textoUI = document.getElementById(idTexto);
    if (input.files && input.files[0] && textoUI) {
        var reader = new FileReader();
        reader.onload = function(e) {
            textoUI.innerHTML = '<img src="' + e.target.result + '" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">';
        };
        reader.readAsDataURL(input.files[0]);
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
        var f = (fInput && fInput.files) ? fInput.files[0] : null;

        // Pipeline canónico con compresión centralizada
        if (f) {
            var resFoto = await GeokatuDB.AdminService.subirFotoProductoCanonica(
                window.idNegocioLogueado,
                barcodeVal,
                f,
                'frontal'
            );
            if (!resFoto.success) throw new Error(resFoto.error || "Fallo en subida canónica.");
            urlImg = resFoto.data;
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

window.cargarDiccionarioEmojis = function() {
    var diccionario = [
        { grupo: "🎩 Coronas y Sombreros", anclaje: "anclaje-arriba", iconos: "👑,🎓,🎩,🧢,🌸" },
        { grupo: "🎀 Esquinas y Tiaras", anclaje: "anclaje-esquina", iconos: "🎀,🏵️,✨,⭐" },
        { grupo: "🍔 Comida (Flotante)", anclaje: "anclaje-arriba", iconos: "🍔,🍕,☕,🍻" }
    ];
    var selects = [document.getElementById('edit-select-efecto'), document.getElementById('select-efecto')];
    selects.forEach(function(select) {
        if (!select) return;
        select.innerHTML = '<option value="|">Sin Emoticón</option>';
        diccionario.forEach(function(cat) {
            var optgroup = document.createElement('optgroup'); 
            optgroup.label = cat.grupo;
            cat.iconos.split(',').forEach(function(emoji) {
                var opt = document.createElement('option');
                opt.value = cat.anclaje + '|' + emoji; 
                opt.text = emoji;
                optgroup.appendChild(opt);
            });
            select.appendChild(optgroup);
        });
    });
};

window.cargarPreviewPinModal = function(input) {
    if (input.files && input.files[0]) {
        var reader = new FileReader();
        reader.onload = function(e) { 
            window.imagenCargadaTemporalModal = e.target.result;
            window.actualizarPinLiveModal();
        };
        reader.readAsDataURL(input.files[0]);
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

window.seleccionarTemaPopupModal = function(tema) {
    var t = tema === 'clasico' ? 'clasico' : 'carbon';
    var input = document.getElementById('edit-select-tema');
    if (input) input.value = t;

    var btnCar = document.getElementById('btn-tema-carbon');
    var btnCla = document.getElementById('btn-tema-clasico');
    if (btnCar && btnCla) {
        if (t === 'clasico') {
            btnCla.classList.add('activo');
            btnCar.classList.remove('activo');
        } else {
            btnCar.classList.add('activo');
            btnCla.classList.remove('activo');
        }
    }
};

window.seleccionarTemaPopupOnboarding = function(tema) {
    var t = tema === 'clasico' ? 'clasico' : 'carbon';
    var input = document.getElementById('select-tema-onboarding');
    if (input) input.value = t;

    var btnCar = document.getElementById('btn-tema-ob-carbon');
    var btnCla = document.getElementById('btn-tema-ob-clasico');
    if (btnCar && btnCla) {
        if (t === 'clasico') {
            btnCla.classList.add('activo');
            btnCar.classList.remove('activo');
        } else {
            btnCar.classList.add('activo');
            btnCla.classList.remove('activo');
        }
    }
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




    var pinF = document.getElementById('edit-file-pin') ? document.getElementById('edit-file-pin').files[0] : null;
    if (pinF) {
        var blob = await window.comprimirImagen(pinF, 400, 0.6, true);
        var resPin = await GeokatuDB.AdminService.subirArchivo('tiendas/' + window.idNegocioLogueado + '/pin_mapa.webp', blob);
        var urlPin = (typeof resPin === 'string') ? resPin : (resPin && resPin.data ? resPin.data : '');
        if (urlPin) payload.link_pin = urlPin;
    }

    var nombreFModal = document.getElementById('modal-file-nombre-png') ? document.getElementById('modal-file-nombre-png').files[0] : null;
    if (nombreFModal) {
        var blobWebpModal = await window.comprimirImagenTransparenteWebP(nombreFModal, 460, 110);
        var resNomModal = await GeokatuDB.AdminService.subirArchivo('tiendas/' + window.idNegocioLogueado + '/nombre_png.webp', blobWebpModal);
        var urlNomModal = (typeof resNomModal === 'string') ? resNomModal : (resNomModal && resNomModal.data ? resNomModal.data : '');
        if (urlNomModal) {
            payload.nombre_png = urlNomModal;
            var uiPng = document.getElementById('ui-nombre-png');
            var uiTxt = document.getElementById('ui-nombre');
            if (uiPng) { uiPng.src = urlNomModal; uiPng.style.display = 'block'; }
            if (uiTxt) uiTxt.style.display = 'none';
        }
    }


    await GeokatuDB.AdminService.actualizarNegocio(window.idNegocioLogueado, payload);


    var modal = document.getElementById('modal-diseno-pin-branding');
    modal.classList.remove('activo');
    setTimeout(function() { 
        modal.style.display = 'none'; 
        if (window.miniMapaPerfil) {
            window.miniMapaPerfil.remove();
            window.miniMapaPerfil = null;
            var pos = window.datosTienda.Coordenadas || { latitude: 4.8133, longitude: -75.6961 };
            window.inicializarMiniMapaPerfil(pos.latitude, pos.longitude);
        }
    }, 300);
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
        var colorFinal = '#' + hex;
        window.setSlotColor(window.slotColorActual, colorFinal);
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
        var colorValido = '#' + hexLimpio;
        if (input) input.style.borderColor = '#00ff64';
        if (window.slotColorActual) window.setSlotColor(window.slotColorActual, colorValido);
    } else {
        if (input) input.style.borderColor = '#ff4444';
    }
};

// Controladores táctiles y de puntero para la rueda y el deslizador de brillo
var rueda = document.getElementById('rueda-colores');
var sliderBrillo = document.getElementById('slider-brillo');
var draggingWheel = false;

var calcularColorRueda = function(e) {
    if (!rueda) return;
    var rect = rueda.getBoundingClientRect();
    var clientX = e.touches ? e.touches[0].clientX : e.clientX;
    var clientY = e.touches ? e.touches[0].clientY : e.clientY;
    var x = clientX - rect.left - rect.width / 2;
    var y = clientY - rect.top - rect.height / 2;

    var radio = Math.sqrt(x * x + y * y);
    var maxRadio = rect.width / 2;
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

    var angle = Math.atan2(y, x) * (180 / Math.PI) + 90;
    if (angle < 0) angle += 360;

    window.estadoColorCustom.h = angle;
    window.estadoColorCustom.l_base = 100 - (radio / maxRadio * 50);
    actualizarPreviewCustom();
};

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
window.obtenerDireccionGeocoding = async function(lat, lng, targetInputId) {
    var el = document.getElementById(targetInputId);
    if (!el) return;
    try {
        var url = "https://nominatim.openstreetmap.org/reverse?format=json&lat=" + lat + "&lon=" + lng;
        var resp = await fetch(url, { headers: { 'Accept-Language': 'es' } });
        var data = await resp.json();
        if (data && data.display_name) {
            var addr = data.address || {};
            var via = addr.road || addr.pedestrian || addr.suburb || '';
            var num = addr.house_number ? ' #' + addr.house_number : '';
            var ciudad = addr.city || addr.town || addr.municipality || '';
            var dirCorta = (via + num + (ciudad ? ', ' + ciudad : '')).trim();
            el.value = dirCorta || data.display_name.split(',').slice(0, 3).join(',');
        }
    } catch (e) {
        console.warn("[Geocoding] Fallo inverso:", e);
    }
};

window.buscarDireccionSandbox = async function(inputId, mapa, marker) {
    var inEl = document.getElementById(inputId);
    if (!inEl) return;
    var query = inEl.value.trim();
    if (!query) return;

    try {
        var url = "https://nominatim.openstreetmap.org/search?format=json&q=" + encodeURIComponent(query);
        var resp = await fetch(url, { headers: { 'Accept-Language': 'es' } });
        var data = await resp.json();
        if (data && data.length > 0) {
            var lat = parseFloat(data[0].lat);
            var lng = parseFloat(data[0].lon);

            if (mapa) mapa.flyTo({ center: [lng, lat], zoom: 17, duration: 1200 });
            if (marker) marker.setLngLat([lng, lat]);

            var inLat = document.getElementById('perfilLat');
            var inLng = document.getElementById('perfilLng');
            if (inLat) inLat.value = lat;
            if (inLng) inLng.value = lng;

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

            if (navigator.vibrate) navigator.vibrate([40, 40]);
        } else {
            alert("No se hallaron resultados para esa dirección.");
        }
    } catch (e) {
        console.warn("[Geocoding] Fallo en búsqueda:", e);
        alert("Error al conectar con el servicio de geocodificación.");
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


window.inicializarMiniMapaPerfil = function(latInicial, lngInicial) {
    if (window.miniMapaPerfil) {
        window.miniMapaPerfil.resize();
        return;
    }

    var defaultLat = Number(latInicial) || 4.8133;
    var defaultLng = Number(lngInicial) || -75.6961;

   window.miniMapaPerfil = new maplibregl.Map({
        container: 'mini-mapa-perfil',
        style: 'estilo-fresco.json',
        center: [defaultLng, defaultLat],
        zoom: 16,
        attributionControl: false
    });

    // Desactivar navegación táctil por defecto para permitir scroll libre en la página
    window.miniMapaPerfil.dragPan.disable();
    window.miniMapaPerfil.scrollZoom.disable();
    window.miniMapaPerfil.touchZoomRotate.disable();


    var elPunto = document.createElement('div');
    elPunto.style.position = 'relative';
    elPunto.style.width = '60px';
    elPunto.style.height = '60px';
    elPunto.style.display = 'flex';
    elPunto.style.justifyContent = 'center';
    elPunto.style.alignItems = 'center';

    var fClass = 'forma-gota', aClass = 'anim-salto', eEmoji = '', eAnclaje = '', auraClase = '';
    if (window.datosTienda && window.datosTienda.pin_pack) {
        var p = window.datosTienda.pin_pack.split('|');
        fClass = p[0] || 'forma-gota';
        aClass = p[1] || 'anim-salto';
        if (p.length > 2) { eAnclaje = p[2] || ''; eEmoji = p[3] || ''; }
        if (p.length > 4) { auraClase = p[4] || ''; }
    }

    var foto = (window.datosTienda && window.datosTienda.link_pin) ? window.datosTienda.link_pin : null;
    var emojiAttr = (eEmoji && eEmoji !== '|') ? 'data-emoji="' + eEmoji + '" data-anclaje="' + eAnclaje + '"' : '';
    
    var color1 = (window.datosTienda && window.datosTienda.color_principal) ? window.datosTienda.color_principal : '#ff6b00';
    var color2 = (window.datosTienda && window.datosTienda.color_acento) ? window.datosTienda.color_acento : '#ffffff';
    var color3 = (window.datosTienda && window.datosTienda.color_terciario) ? window.datosTienda.color_terciario : '#0a0a0c';

    var cssVars = '--color-main: ' + color1 + '; --color-sec: ' + color2 + '; --color-ter: ' + color3 + ';';

    elPunto.innerHTML = 
        '<div id="pin-render-perfil" class="pin-wrapper ' + aClass + ' ' + auraClase + '" data-forma="' + fClass + '" style="' + cssVars + ' cursor: pointer;" ' + emojiAttr + '>' +
            '<div id="lapiz-pin-directo" class="pin-diskette-wrapper lapiz-transparente-contextual" onclick="event.stopPropagation(); window.abrirModalEdicionPinBranding();" title="Personalizar PIN">' +
                '<div class="btn-diskette-biselado" style="background: ' + color1 + '26 !important; border-color: ' + color1 + '66 !important;">' +
                    '<span class="icono-diskette-relieve">💾</span>' +
                '</div>' +
            '</div>' +
        '</div>';

    var wrapper = elPunto.querySelector('.pin-wrapper');
    var svgContent = window.obtenerContenidoSVG(fClass, foto, 'img-pin-perfil');
    wrapper.insertAdjacentHTML('beforeend', svgContent);

    window.pinMiniMapaPerfil = new maplibregl.Marker({
        element: elPunto,
        draggable: false,
        anchor: 'bottom'
    }).setLngLat([defaultLng, defaultLat]).addTo(window.miniMapaPerfil);

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
            geohash: hash
        });
    });

        elPunto.addEventListener('click', function(e) {
        e.stopPropagation();
        window.abrirGemeloDigital();
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

window.abrirGemeloDigital = function() {
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
window.cargarAlertasSeguridad = function() {
    if (typeof window.desuscripcionAlertas === 'function') window.desuscripcionAlertas();

    var contenedor = document.getElementById('contenedor-alertas-lista');
    
    // Consulta sin orderBy compuesto para no exigir índices manuales en Firestore
    var qAlertas = query(
        collection(db, "Alertas_Seguridad"),
        where("id_negocio", "==", window.idNegocioLogueado),
        where("estado", "==", "requiere_auditoria_urgente")
    );

    window.desuscripcionAlertas = onSnapshot(qAlertas, function(snap) {
        var total = snap.size;
        var elTotal = document.getElementById('kpi-alertas-activas');
        if (elTotal) elTotal.innerText = total;

        if (!contenedor) return;

        if (snap.empty) {
            contenedor.innerHTML = 
                '<div style="text-align: center; padding: 20px 10px; color: #888;">' +
                    '<span style="font-size: 22px;">✅</span>' +
                    '<h4 style="color: white; margin: 4px 0; font-size: 12px;">Inventario en Orden</h4>' +
                    '<p style="font-size: 10.5px; margin: 0;">Sin quiebres de caja ni averías en anaquel.</p>' +
                '</div>';
            return;
        }

        // Ordenar en memoria local por frescura sin romper Firestore
        var alertas = [];
        snap.forEach(function(d) { alertas.push({ id_doc: d.id, ...d.data() }); });
        alertas.sort(function(a, b) { return new Date(b.timestamp_alerta || 0) - new Date(a.timestamp_alerta || 0); });

        var html = '';
        alertas.forEach(function(a) {
            var fecha = a.timestamp_alerta ? new Date(a.timestamp_alerta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
            var esMerma = a.tipo === 'MERMA_EN_ANAQUEL';
            
            // Resolución inteligente del nombre del artículo
            var nombreProd = a.nombre_producto || '';
            if (!nombreProd && a.id_producto) {
                var match = window.listaProductosGlobal.find(function(p) { return p.id_prod === a.id_producto; });
                nombreProd = match ? match.nombre : a.id_producto;
            }
            if (!nombreProd) nombreProd = "Artículo sin identificar";
            var nomProdLimpio = nombreProd.replace(/'/g, "\\'");

                        var esFantasma = a.tipo === 'PRODUCTO_FANTASMA_OFFLINE';
            var etiquetaBadge = esMerma ? 'Avería / Merma' : (esFantasma ? 'Producto Fantasma' : 'Quiebre en Caja');
            
            var estiloBadge = esMerma 
                ? 'background:rgba(255,170,0,0.18); color:#ffaa00; border:1px solid rgba(255,170,0,0.4);' 
                : (esFantasma ? 'background:rgba(184,68,255,0.18); color:#b844ff; border:1px solid rgba(184,68,255,0.4);' : 'background:rgba(255,68,68,0.2); color:#ff4444; border:1px solid rgba(255,68,68,0.4);');

            var cuerpoDetalle = esMerma
                ? '<p style="font-size:10.5px; color:#aaa; margin:2px 0 0 0;">' +
                    'Anaquel: <strong style="color:white; font-family:monospace;">' + (a.id_mueble || 'Góndola') + ' [' + (a.id_compartimiento || 'BIN') + ']</strong><br>' +
                    'Motivo: <span style="color:#ddd;">' + (a.motivo || 'Reporte físico') + '</span>' +
                  '</p>'
                : '<p style="font-size:10.5px; color:#aaa; margin:2px 0 0 0;">' +
                    'Saldo en sistema: <strong style="color:#ff4444; font-family:monospace;">' + (a.stock_negativo_registrado !== undefined ? a.stock_negativo_registrado : 0) + ' und</strong> (Venta: ' + (a.cantidad_despachada || 1) + ' und)<br>' +
                    '<span style="color:#888; font-size:10px; display:block; margin-top:3px;">' +
                        '🧾 Ticket: <strong style="color:#fff;">' + (a.ticket_origen || 'DESCONOCIDO') + '</strong> | 👤 ' + (a.cajero || 'Caja') + ' (' + (a.terminal || 'CAJA-01') + ')' +
                    '</span>' +
                    (esFantasma ? '<span style="color:#b844ff; font-size:9px; display:block; margin-top:2px;">⚠️ ' + (a.motivo || 'Producto borrado en nube previo a sincronización') + '</span>' : '') +
                  '</p>';

            var saldoParaModal = esMerma ? ('En ' + (a.id_compartimiento || 'Góndola')) : ((a.stock_negativo_registrado !== undefined ? a.stock_negativo_registrado : 0) + ' und');

            html += 
                '<div class="incidente-item" style="border-left-color: ' + (esMerma ? '#ffaa00' : '#ff4444') + ';">' +
                    '<div style="display:flex; justify-content:space-between; align-items:center;">' +
                        '<span class="badge-alerta-urgente" style="' + estiloBadge + '">' + etiquetaBadge + '</span>' +
                        '<span style="font-size:10px; color:#888; font-family:monospace;">' + fecha + '</span>' +
                    '</div>' +
                    '<div>' +
                        '<strong style="font-size:12.5px; color:white;">' + nombreProd + '</strong>' +
                        cuerpoDetalle +
                    '</div>' +
                    '<button type="button" class="btn-submit" style="margin-top:6px !important; padding:6px !important; font-size:10.5px; background:rgba(0,255,100,0.15); border:1px solid rgba(0,255,100,0.4); color:#00ff64;" onclick="window.abrirModalConciliacion(\'' + a.id_doc + '\', \'' + (a.id_producto || '') + '\', \'' + nomProdLimpio + '\', \'' + saldoParaModal + '\')">' +
                        'Conciliar Stock Físico' +
                    '</button>' +
                '</div>';
        });
        contenedor.innerHTML = html;
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

            html += 
                '<div style="background:rgba(0,0,0,0.3); border:1px solid var(--glass-border); border-radius:10px; padding:10px 12px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">' +
                    '<div style="text-align:left;">' +
                        '<div style="display:flex; align-items:center; gap:6px;">' +
                            '<strong style="color:white; font-size:12.5px;">' + (emp.nombre || emp.email) + '</strong>' +
                            '<span style="background:rgba(255,107,0,0.2); color:var(--naranja); padding:1px 5px; border-radius:4px; font-family:monospace; font-size:10px; font-weight:900;">PIN: ' + (emp.codigo_cajero || '----') + '</span>' +
                        '</div>' +
                        '<span style="color:#777; font-size:10.5px;">' + emp.email + '</span>' +
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
        return alert("Completa el correo, clave (mín. 6 caracteres) y un PIN numérico de 4 dígitos.");
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
            almacenHabitual: almacen
        });

        if (!res.data || !res.data.success) {
            throw new Error((res.data && res.data.mensaje) ? res.data.mensaje : "Fallo en servidor.");
        }

        alert("✅ Operario registrado correctamente.");
        document.getElementById('emp-nuevo-nombre').value = '';
        document.getElementById('emp-nuevo-email').value = '';
        document.getElementById('emp-nuevo-pass').value = '';
        document.getElementById('emp-nuevo-codigo').value = '';
        document.getElementById('form-nuevo-colaborador').style.display = 'none';
        window.cargarEquipoOficina();
    } catch (err) {
        alert("Error creando credenciales: " + err.message);
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

if (confirmado) window.location.href = '/';

}; 
// ============================================================================
// FUNCIONES CONTROLADORAS DEL ONBOARDING (FASE 1 Y 2) - BLINDADAS
// ============================================================================
window.imagenCargadaTemporalPaso1 = null;
window.mapaOnboarding = null;
window.markerOnboarding = null;

window.cargarPreviewPin = function(input) {
    if (input.files && input.files[0]) {
        var reader = new FileReader();
        reader.onload = function(e) {
            window.imagenCargadaTemporalPaso1 = e.target.result;
            window.actualizarPinLive();
        };
        reader.readAsDataURL(input.files[0]);
    }
};

window.actualizarPinLive = function() {
    var forma = document.getElementById('select-forma').value;
    var anim = document.getElementById('select-animacion') ? document.getElementById('select-animacion').value : 'anim-salto';
    var color = document.getElementById('wizColorHex1') ? document.getElementById('wizColorHex1').value : '#ff6b00';
    var efectoRaw = document.getElementById('select-efecto') ? document.getElementById('select-efecto').value : '';
    window.actualizarContenedorPin('pin-live-preview', 'img-live-preview', forma, color, efectoRaw, window.imagenCargadaTemporalPaso1, anim);
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
        var pinF = document.getElementById('file-pin').files[0];
        if (pinF) {
            var blob = await GeokatuDB.AdminService.comprimirAWebP(pinF, 400, 0.7, true);
            var res = await GeokatuDB.AdminService.subirArchivo('tiendas/' + window.idNegocioLogueado + '/pin_mapa.webp', blob);
            var urlPin = (typeof res === 'string') ? res : (res && res.data ? res.data : '');
            if (urlPin) payload.link_pin = urlPin;
        }

        var nombreF = document.getElementById('fase1-file-nombre-png') ? document.getElementById('fase1-file-nombre-png').files[0] : null;
        if (nombreF) {
            var blobWebp = await window.comprimirImagenTransparenteWebP(nombreF, 460, 110);
            var resNom = await GeokatuDB.AdminService.subirArchivo('tiendas/' + window.idNegocioLogueado + '/nombre_png.webp', blobWebp);
            var urlNom = (typeof resNom === 'string') ? resNom : (resNom && resNom.data ? resNom.data : '');
            if (urlNom) payload.nombre_png = urlNom;
        }

        await GeokatuDB.AdminService.actualizarNegocio(window.idNegocioLogueado, payload);
        Object.assign(window.datosTienda, payload);

        document.getElementById('fase-1-pin').style.display = 'none';
        window.iniciarSandboxGeoespacial(false);
    } catch (e) {
        alert("Error al guardar ADN del PIN: " + e.message);
    } finally {
        btn.innerText = "Continuar a Ubicación";
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
        if (selectorPais) {
            selectorPais.value = window.detectarPaisPorCoordenadas(pos.lat, pos.lng);
        }
    });

    // Al tocar el pin en el paso de onboarding, se despliega el Gemelo Digital para verificar los datos
    elDOM.addEventListener('click', function(e) {
        e.stopPropagation();
        window.abrirGemeloDigitalEnMapa(window.mapaOnboarding, window.markerOnboarding);
    });

    setTimeout(function() { 
        window.mapaOnboarding.resize(); 
        // Abrir automáticamente el Gemelo Digital para confirmar visualmente
        window.abrirGemeloDigitalEnMapa(window.mapaOnboarding, window.markerOnboarding);
    }, 450);
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



window.buscarDireccionWizard = async function() {
    var input = document.getElementById('wiz-direccion-inteligente');
    var query = input.value.trim();
    if (!query) return;
    try {
        var res = await fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(query));
        var data = await res.json();
        if (data && data.length > 0) {
            var lat = parseFloat(data[0].lat);
            var lng = parseFloat(data[0].lon);
            if (window.mapaOnboarding && window.markerOnboarding) {
                window.mapaOnboarding.flyTo({ center: [lng, lat], zoom: 17 });
                window.markerOnboarding.setLngLat([lng, lat]);
            }
        }
    } catch (e) {
        console.warn("Fallo geocodificación wizard:", e);
    }
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
        await GeokatuDB.AdminService.actualizarNegocio(window.idNegocioLogueado, payloadFinal);
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
    var correoPub = document.getElementById('wiz-correo-publico').value.trim();
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
        correo: correoPub,
        email: correoPub,
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
    } catch (e) {
        alert("Error al guardar identidad: " + e.message);
    } finally {
        btn.innerText = "Continuar a Diseño de PIN";
        btn.disabled = false;
    }
};








