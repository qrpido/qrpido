/**
 * GEOKATU SIG - MOTOR DE VISOR DE INVENTARIO Y RADAR OPERATIVO
 * Multi-Sede Dinámica + Parser Óptico Trifásico + RBAC Operativo Universal
 */
import GeokatuDB from './core-db.js';
import { AuthGate } from './auth-gate.js';
import './geokatu-tour.js';


let idNegocio = localStorage.getItem('geokatu_active_uid') || null;
let idSedeActiva = localStorage.getItem('geokatu_sede_activa') || 'SALA_VENTAS';
let rolUsuarioActivo = null;

const METRO_PX = 60;
let perimetro = { anchoM: 12, largoM: 18 };
let muebles = [];
let celdasMurosBloqueadas = new Set();
let catalogoTotal = [];
let stockPosicionalGlobal = []; // Array de { id_prod, id_estante, id_compartimiento, cantidad, lote, fecha_vencimiento, zona }
let capaActiva = "TODO";

// Viewport libre para navegación
let viewport = { x: 40, y: 100, escala: 1 };
let arrastrando = false;
let inicioRaton = { x: 0, y: 0 };

const capaTransform = document.getElementById('capa-transform');
const canvasRejilla = document.getElementById('rejilla-canvas');
const ctxRejilla = canvasRejilla.getContext('2d');
const contenedorMuebles = document.getElementById('contenedor-muebles');
const drawer = document.getElementById('panel-detalle-mueble');
const panelFiltros = document.getElementById('panel-filtros-avanzados');
const inputBusqueda = document.getElementById('visor-busqueda');
const filtroCat = document.getElementById('filtro-categoria');
const filtroPrecio = document.getElementById('filtro-precio');
const filtroVenc = document.getElementById('filtro-dias-vencimiento');
const labelPrecioMax = document.getElementById('label-precio-max');
const selectSede = document.getElementById('selector-sede-activa');

// --- MOTOR DE DIÁLOGOS IN-APP ESTILIZADOS (ANTI-ALERT) ---
const modalInApp = document.getElementById('modal-inapp-dialogo');
const txtInAppTitulo = document.getElementById('txt-inapp-titulo');
const txtInAppMensaje = document.getElementById('txt-inapp-mensaje');
const btnInAppAceptar = document.getElementById('btn-inapp-aceptar');
const btnInAppCancelar = document.getElementById('btn-inapp-cancelar');

window.mostrarAlertaInApp = function(mensaje, titulo = "Aviso del Sistema") {
    return new Promise((resolve) => {
        if (!modalInApp) return resolve(true);
        txtInAppTitulo.innerText = titulo;
        txtInAppMensaje.innerText = mensaje;
        btnInAppCancelar.style.display = 'none';
        modalInApp.style.display = 'flex';

        const handler = () => {
            btnInAppAceptar.removeEventListener('click', handler);
            modalInApp.style.display = 'none';
            resolve(true);
        };
        btnInAppAceptar.addEventListener('click', handler);
    });
};

window.mostrarConfirmacionInApp = function(mensaje, titulo = "Confirmación") {
    return new Promise((resolve) => {
        if (!modalInApp) return resolve(false);
        txtInAppTitulo.innerText = titulo;
        txtInAppMensaje.innerText = mensaje;
        btnInAppCancelar.style.display = 'block';
        modalInApp.style.display = 'flex';

        const handlerAceptar = () => {
            limpiarListeners();
            modalInApp.style.display = 'none';
            resolve(true);
        };
        const handlerCancelar = () => {
            limpiarListeners();
            modalInApp.style.display = 'none';
            resolve(false);
        };
        const limpiarListeners = () => {
            btnInAppAceptar.removeEventListener('click', handlerAceptar);
            btnInAppCancelar.removeEventListener('click', handlerCancelar);
        };

        btnInAppAceptar.addEventListener('click', handlerAceptar);
        btnInAppCancelar.addEventListener('click', handlerCancelar);
    });
};

function actualizarTransform() {
    capaTransform.style.transform = 'translate3d(' + viewport.x + 'px, ' + viewport.y + 'px, 0) scale(' + viewport.escala + ')';
    if (typeof actualizarBrujulaDireccional === 'function') {
        actualizarBrujulaDireccional();
    }
}



// ==========================================
// 1. PANEO Y PINCH-TO-ZOOM MULTITÁCTIL ESTABILIZADO
// ==========================================
const vpEl = document.getElementById('viewport-infinito');
const punterosActivos = new Map();
let distanciaInicialPinch = 0;
let escalaInicialPinch = 1;
let centroInicialPinch = { x: 0, y: 0 };
let viewportInicialPinch = { x: 0, y: 0 };
let inicioArrastreUnico = { x: 0, y: 0 };

vpEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.mueble-bloque')) return;
    punterosActivos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    vpEl.setPointerCapture(e.pointerId);
    if (punterosActivos.size === 1) {
        inicioArrastreUnico = { x: e.clientX - viewport.x, y: e.clientY - viewport.y };
    } else if (punterosActivos.size === 2) {
        e.preventDefault(); // Inhibir zoom nativo del navegador Chromium
        const pts = Array.from(punterosActivos.values());
        distanciaInicialPinch = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        escalaInicialPinch = viewport.escala;
        viewportInicialPinch = { x: viewport.x, y: viewport.y };
        centroInicialPinch = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    }
});

vpEl.addEventListener('pointermove', (e) => {
    if (!punterosActivos.has(e.pointerId)) return;
    punterosActivos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punterosActivos.size === 1) {
        viewport.x = e.clientX - inicioArrastreUnico.x;
        viewport.y = e.clientY - inicioArrastreUnico.y;
        actualizarTransform();
    } else if (punterosActivos.size === 2) {
        e.preventDefault(); // Inhibir colisión gestual y recarga de página
        const pts = Array.from(punterosActivos.values());
        const distActual = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        if (distanciaInicialPinch === 0) return;
        const factor = distActual / distanciaInicialPinch;
        const nuevaEscala = Math.min(Math.max(0.15, escalaInicialPinch * factor), 4.0);
        const centroActual = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        const mundoPivotX = (centroInicialPinch.x - viewportInicialPinch.x) / escalaInicialPinch;
        const mundoPivotY = (centroInicialPinch.y - viewportInicialPinch.y) / escalaInicialPinch;
        viewport.x = centroActual.x - (mundoPivotX * nuevaEscala);
        viewport.y = centroActual.y - (mundoPivotY * nuevaEscala);
        viewport.escala = nuevaEscala;
        actualizarTransform();
    }
});


const limpiarPunteroVisor = (e) => {
    punterosActivos.delete(e.pointerId);
    if (punterosActivos.size === 1) {
        const pRestante = Array.from(punterosActivos.values())[0];
        inicioArrastreUnico = { x: pRestante.x - viewport.x, y: pRestante.y - viewport.y };
    }
};
vpEl.addEventListener('pointerup', limpiarPunteroVisor);
vpEl.addEventListener('pointercancel', limpiarPunteroVisor);

vpEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    viewport.escala = Math.min(Math.max(0.2, viewport.escala * factor), 3.5);
    actualizarTransform();
}, { passive: false });

// ==========================================
// 2. DIBUJO DEL CONTORNO, MUROS Y RUTA VECTORIAL (FASE 4)
// ==========================================
let puntosRutaPicking = [];
let animacionRutaId = null;
let desfaseDashRuta = 0;
let muebleObjetivoRadar = null;

function redibujarArea() {
    const w = perimetro.anchoM * METRO_PX;
    const h = perimetro.largoM * METRO_PX;

    if (canvasRejilla.width !== w || canvasRejilla.height !== h) {
        canvasRejilla.width = w;
        canvasRejilla.height = h;
        canvasRejilla.style.width = w + 'px';
        canvasRejilla.style.height = h + 'px';
    }

    ctxRejilla.clearRect(0, 0, w, h);
    ctxRejilla.fillStyle = '#21212b';
    ctxRejilla.fillRect(0, 0, w, h);

    ctxRejilla.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctxRejilla.lineWidth = 1;
    for (let x = 0; x <= w; x += METRO_PX) {
        ctxRejilla.beginPath(); ctxRejilla.moveTo(x, 0); ctxRejilla.lineTo(x, h); ctxRejilla.stroke();
    }
    for (let y = 0; y <= h; y += METRO_PX) {
        ctxRejilla.beginPath(); ctxRejilla.moveTo(0, y); ctxRejilla.lineTo(w, y); ctxRejilla.stroke();
    }

    ctxRejilla.strokeStyle = '#ff6b00';
    ctxRejilla.lineWidth = 3;
    ctxRejilla.strokeRect(0, 0, w, h);

    // Muros irregulares persistidos
    celdasMurosBloqueadas.forEach(coord => {
        const partes = coord.split(',');
        const cx = Number(partes[0]);
        const cy = Number(partes[1]);
        ctxRejilla.fillStyle = 'rgba(255, 68, 68, 0.45)';
        ctxRejilla.fillRect(cx * METRO_PX, cy * METRO_PX, METRO_PX, METRO_PX);
        ctxRejilla.strokeStyle = '#ff4444';
        ctxRejilla.lineWidth = 1;
        ctxRejilla.strokeRect(cx * METRO_PX, cy * METRO_PX, METRO_PX, METRO_PX);
    });

    // 4.2 Trazado Vectorial Dinámico de Ruta en Suelo
    if (puntosRutaPicking.length > 1) {
        dibujarRutaVectorial();
    }
}

function dibujarRutaVectorial() {
    ctxRejilla.save();
    ctxRejilla.strokeStyle = '#ff6b00';
    ctxRejilla.lineWidth = 3.5;
    ctxRejilla.setLineDash([10, 6]);
    ctxRejilla.lineDashOffset = -desfaseDashRuta;
    ctxRejilla.lineCap = 'round';
    ctxRejilla.lineJoin = 'round';
    ctxRejilla.shadowColor = '#ff6b00';
    ctxRejilla.shadowBlur = 8;

    ctxRejilla.beginPath();
    ctxRejilla.moveTo(puntosRutaPicking[0].x, puntosRutaPicking[0].y);
    for (let i = 1; i < puntosRutaPicking.length; i++) {
        ctxRejilla.lineTo(puntosRutaPicking[i].x, puntosRutaPicking[i].y);
    }
    ctxRejilla.stroke();

    // Balizas de parada sobre cada punto de la ruta
    for (let i = 0; i < puntosRutaPicking.length; i++) {
        const pt = puntosRutaPicking[i];
        ctxRejilla.beginPath();
        ctxRejilla.arc(pt.x, pt.y, i === 0 ? 6 : 5, 0, Math.PI * 2);
        ctxRejilla.fillStyle = (i === 0) ? '#00ff64' : '#ffd700';
        ctxRejilla.fill();
        ctxRejilla.strokeStyle = '#000000';
        ctxRejilla.lineWidth = 1.5;
        ctxRejilla.stroke();
    }
    ctxRejilla.restore();
}

function loopAnimacionRuta() {
    if (puntosRutaPicking.length < 2) {
        animacionRutaId = null;
        return;
    }
    desfaseDashRuta = (desfaseDashRuta + 0.6) % 32;
    redibujarArea();
    animacionRutaId = requestAnimationFrame(loopAnimacionRuta);
}

function iniciarAnimacionRuta() {
    if (!animacionRutaId && puntosRutaPicking.length > 1) {
        animacionRutaId = requestAnimationFrame(loopAnimacionRuta);
    }
}

function detenerAnimacionRuta() {
    if (animacionRutaId) {
        cancelAnimationFrame(animacionRutaId);
        animacionRutaId = null;
    }
    puntosRutaPicking = [];
    desfaseDashRuta = 0;
    redibujarArea();
}


// ==========================================
// 3. CAPAS CROMÁTICAS (HEATMAPS)
// ==========================================
function calcularGradienteCromatico(valor, min, max, invertir = false) {
    if (max <= min) return 'rgba(0, 255, 100, 0.35)';
    let ratio = (valor - min) / (max - min);
    ratio = Math.max(0, Math.min(1, ratio));
    if (invertir) ratio = 1 - ratio;

    const hue = ((1 - ratio) * 120).toFixed(0);
    return "hsla(" + hue + ", 100%, 45%, 0.42)"; 
}

// ==========================================
// 4. RENDERIZADO DE MUEBLES (SOLO LECTURA)
// ==========================================
function renderizarMueblesVisor() {
    contenedorMuebles.innerHTML = '';
    const hoy = new Date();

    let maxStockGlobal = 1;
    let maxPrecioGlobal = 1;
    const stockPorEspacio = new Map();
    for (const stock of stockPosicionalGlobal) {
        if (!stockPorEspacio.has(stock.id_compartimiento)) stockPorEspacio.set(stock.id_compartimiento, []);
        stockPorEspacio.get(stock.id_compartimiento).push(stock);
    }
    const stockPorMueble = new Map();
    const catalogoPorId = new Map(catalogoTotal.map(p => [p.id_prod, p]));

    muebles.forEach(m => {
        const items = (m.compartimientos || []).flatMap(espacio => stockPorEspacio.get(espacio.id_comp) || []);
        stockPorMueble.set(m.id_mueble, items);
        const cant = items.reduce((acc, x) => acc + (Number(x.cantidad) || 0), 0);
        if (cant > maxStockGlobal) maxStockGlobal = cant;

        items.forEach(it => {
            const p = catalogoPorId.get(it.id_prod);
            if (p && p.precio && Number(p.precio) > maxPrecioGlobal) {
                maxPrecioGlobal = Number(p.precio);
            }
        });
    });

    muebles.forEach(m => {
        const el = document.createElement('div');
        el.classList.add('mueble-bloque');
        el.id = 'mueble-visor-' + m.id_mueble;
        el.setAttribute('data-id-mueble', m.id_mueble);
        el.setAttribute('data-qr', m.qr || ('GEO-M-' + idNegocio + '-' + idSedeActiva + '-' + m.id_mueble));
        el.style.width = (m.anchoM * METRO_PX) + 'px';
        el.style.height = (m.largoM * METRO_PX) + 'px';
        el.style.left = m.x + 'px';
        el.style.top = m.y + 'px';
        const rot = m.rotacion || 0;
        el.style.transform = 'rotate(' + rot + 'deg)';


        // Filtrar existencias de este mueble
        const itemsEnMueble = stockPorMueble.get(m.id_mueble);
        const stockTotalMueble = itemsEnMueble.reduce((acc, x) => acc + (Number(x.cantidad) || 0), 0);

        // Capas Temáticas
        if (capaActiva === "HEATMAP_STOCK") {
            el.style.backgroundColor = calcularGradienteCromatico(stockTotalMueble, 0, maxStockGlobal, true);
            el.style.borderColor = stockTotalMueble === 0 ? '#ff3333' : '#00ff64';
        } else if (capaActiva === "HEATMAP_PRECIO") {
            let maxPrecio = 0;
            itemsEnMueble.forEach(it => {
                const prod = catalogoPorId.get(it.id_prod);
                if (prod && Number(prod.precio) > maxPrecio) maxPrecio = Number(prod.precio);
            });
            el.style.backgroundColor = calcularGradienteCromatico(maxPrecio, 0, maxPrecioGlobal, false);
        } else if (capaActiva === "VENCIMIENTOS") {
            let urgente = false;
            let proximo = false;
            itemsEnMueble.forEach(it => {
                if (it.fecha_vencimiento) {
                    const dias = Math.ceil((new Date(it.fecha_vencimiento) - hoy) / (1000 * 60 * 60 * 24));
                    if (dias <= 5) urgente = true;
                    else if (dias <= 15) proximo = true;
                }
            });
            if (urgente) el.classList.add('mueble-alerta-rojo');
            else if (proximo) el.classList.add('mueble-alerta-amarillo');
        } else if (capaActiva === "STOCK_CERO") {
            if (stockTotalMueble === 0) el.classList.add('mueble-alerta-rojo');
        } else if (capaActiva === "ESTADO_AUDITORIA") {
            // Clasificación por frescura de auditoría física:
            // Verde: Auditado en las últimas 48 horas.
            // Cyan: Auditado en los últimos 7 días.
            // Naranja/Amarillo: Auditoría pendiente (> 7 días o nunca auditado).
            let fechaMasReciente = 0;
            itemsEnMueble.forEach(it => {
                const ts = it.ultimo_conteo_ciclico;
                if (ts) {
                    const t = new Date(ts).getTime();
                    if (t > fechaMasReciente) fechaMasReciente = t;
                }
            });

            const horasDesdeAuditoria = fechaMasReciente > 0 
                ? ((Date.now() - fechaMasReciente) / (1000 * 60 * 60)) 
                : 99999;

            if (horasDesdeAuditoria <= 48) {
                el.style.backgroundColor = 'rgba(0, 255, 100, 0.35)';
                el.style.borderColor = '#00ff64';
            } else if (horasDesdeAuditoria <= 168) {
                el.style.backgroundColor = 'rgba(0, 229, 255, 0.3)';
                el.style.borderColor = '#00e5ff';
            } else {
                el.style.backgroundColor = 'rgba(255, 170, 0, 0.3)';
                el.style.borderColor = '#ffaa00';
            }
        }


        // Subcuadrícula visual interior
        const subGrid = document.createElement('div');
        subGrid.classList.add('mueble-subdivisiones');
        const binsFrontal = (m.caras && m.caras.A) ? (m.caras.A.bins || 4) : 4;
        const cols = Math.ceil(Math.sqrt(binsFrontal));
        subGrid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';

        for (let i = 0; i < binsFrontal; i++) {
            const c = document.createElement('div');
            c.classList.add('subdivision-celda');
            subGrid.appendChild(c);
        }
        el.appendChild(subGrid);

       // Etiqueta con contra-rotación fija horizontal permanente
        const tag = document.createElement('div');
        tag.classList.add('mueble-etiqueta');
        tag.style.transform = 'rotate(' + (-rot) + 'deg)';
        const totalBins = m.compartimientos ? m.compartimientos.length : 0;
        tag.innerText = m.nombre + '\n[' + (m.zona === 'BODEGA' ? 'BODEGA' : 'PISO') + ']\n' + stockTotalMueble + 'u | ' + totalBins + ' Bins';
        el.appendChild(tag);


        // Evento de inspección y disparo del visor de alzado PiP
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            abrirFichaMueble(m, itemsEnMueble);
            abrirAlzadoElevacionMueble(m);
        });

        contenedorMuebles.appendChild(el);
    });

    ejecutarBusquedaYFiltros();
}

// ==========================================
// 5. INSPECCIÓN AL TOQUE (DRAWER LATERAL MULTI-CARA)
// ==========================================
function abrirFichaMueble(mueble, items) {
    document.getElementById('txt-mueble-id-fisico').innerText = mueble.id_mueble;
    document.getElementById('txt-mueble-nombre').innerText = mueble.nombre;

    const badgeZona = document.getElementById('txt-mueble-zona-badge');
    const esBodega = mueble.zona === 'BODEGA';
    badgeZona.innerText = esBodega ? 'BODEGA' : 'PISO DE VENTA';
    badgeZona.className = 'badge-zona-tag ' + (esBodega ? 'bodega' : 'piso');


    const totalFisico = (items || []).reduce((acc, x) => acc + (Number(x.cantidad) || 0), 0);
    const binsOcupados = new Set((items || []).map(x => x.id_compartimiento)).size;

    document.getElementById('stat-total-unidades').innerText = totalFisico;
    document.getElementById('stat-total-bins-ocupados').innerText = binsOcupados;

   // Conectar disparador directo a la terminal stock en modo AUDITAR
    const btnAuditarMueble = document.getElementById('btn-drawer-auditar-mueble');
    if (btnAuditarMueble) {
        btnAuditarMueble.onclick = function() {
            window.location.href = enlaceStock(mueble, null, 'AUDITAR');
        };
    }


    const listaEl = document.getElementById('lista-productos-estante');
    listaEl.innerHTML = '';

    if (!items || items.length === 0) {
        listaEl.innerHTML = `
            <div style="text-align: center; color: #777; padding: 40px 10px;">
                <div style="font-size: 11px; text-transform: uppercase; color: #666; letter-spacing: 1px; font-weight: 800;">Sin existencias registradas</div>
                <p style="margin-top: 6px; font-size: 12px; color: #555;">No hay artículos ubicados en este mueble.</p>
            </div>
        `;
    } else {

        const hoy = new Date();
        const nombresCaras = { A: 'Frontal', B: 'Posterior', C: 'Cabecera Izq', D: 'Cabecera Der' };

        items.forEach(it => {
            const prod = catalogoTotal.find(p => p.id_prod === it.id_prod || p.codigo_barras === it.id_prod) || {};
            const cantTeorica = it.cantidad;

            // Desglose del bin canónico GEO-P-{idNegocio}-{idSede}-{idMueble}-{cara}-{nivel}-{bin}
            let caraTexto = 'A';
            let nivelTexto = '';
            let binTexto = it.id_compartimiento || 'BIN';

            if (it.id_compartimiento && it.id_compartimiento.startsWith('GEO-P-')) {
                const partes = it.id_compartimiento.split('-');
                const len = partes.length;
                if (len >= 6) {
                    binTexto = partes[len - 1] || 'BIN';
                    nivelTexto = partes[len - 2] || '';
                    caraTexto = partes[len - 3] || 'A';
                }
            }

            let tagVencHTML = '';
            if (it.fecha_vencimiento) {
                const diasVenc = Math.ceil((new Date(it.fecha_vencimiento) - hoy) / (1000 * 60 * 60 * 24));
                if (diasVenc <= 0) {
                    tagVencHTML = '<span class="tag-vencimiento-pill tag-venc-urgente">¡VENCIDO! (' + it.fecha_vencimiento + ')</span>';
                } else if (diasVenc <= 5) {
                    tagVencHTML = '<span class="tag-vencimiento-pill tag-venc-urgente">Vence en ' + diasVenc + ' días</span>';
                } else if (diasVenc <= 15) {
                    tagVencHTML = '<span class="tag-vencimiento-pill tag-venc-proximo">Vence en ' + diasVenc + ' días</span>';
                } else {
                    tagVencHTML = '<span class="tag-vencimiento-pill tag-venc-optimo">' + it.fecha_vencimiento + '</span>';
                }
            }

            const div = document.createElement('div');
            div.classList.add('item-inventario-fila');
            div.innerHTML = '<div class="item-img-container">' +
                '<img src="' + (prod.imagen || 'https://via.placeholder.com/60/0a0a0c/ff6b00?text=SKU') + '" alt="Foto SKU">' +
                '</div>' +
                '<div class="item-info-col">' +
                '<strong class="item-titulo-prod">' + (prod.nombre || it.id_prod) + '</strong>' +
                '<span class="item-bin-meta">' +
                '<span class="tag-cara-pill">' + (nombresCaras[caraTexto] || caraTexto) + '</span> ' +
                (nivelTexto ? (nivelTexto + ' - ') : '') + binTexto + ' | Lote: ' + (it.lote || 'S/L') +
                '</span>' +
                '<div>' + tagVencHTML + '</div>' +
                '</div>' +
                '<div class="item-conteo-col">' +
                '<span class="item-conteo-numero">' + (it.cantidad || 0) + '</span>' +
                '<span class="item-conteo-sub">En bin</span>' +
                '<span class="item-conteo-teorico">Teórico: ' + cantTeorica + 'u</span>' +
                '</div>';
            listaEl.appendChild(div);

        });
    }

    drawer.style.boxShadow = '-10px 0 35px rgba(0, 0, 0, 0.85)';
    drawer.classList.add('visible');
}

document.getElementById('btn-cerrar-drawer').addEventListener('click', () => {
    drawer.classList.remove('visible');
    drawer.style.boxShadow = 'none';
});

// ==========================================
// 5.1 MOTOR DE ELEVACIÓN Y ALZADO PSEUDO-3D (PROYECCIÓN OBLICUA CABINET)
// ==========================================
const widgetAlzado = document.getElementById('visor-alzado-pip');
const svgAlzado = document.getElementById('svg-alzado-mueble');
const tabsCarasEl = document.getElementById('alzado-tabs-caras');
const btnCerrarAlzado = document.getElementById('btn-cerrar-alzado');
let muebleAlzadoActivo = null;
let caraAlzadoSeleccionada = 'A';
let binAlzadoObjetivoId = null;
let binSeleccionadoActivo = null;

if (btnCerrarAlzado) {
    btnCerrarAlzado.addEventListener('click', (e) => {
        e.stopPropagation();
        if (widgetAlzado) widgetAlzado.classList.add('oculto');
    });
}

function abrirAlzadoElevacionMueble(mueble, targetCompId = null) {
    if (!mueble || !widgetAlzado) return;
    muebleAlzadoActivo = mueble;
    binAlzadoObjetivoId = targetCompId;
    binSeleccionadoActivo = null;

    document.getElementById('alzado-id-tag').innerText = mueble.id_mueble || 'GEO-M';
    document.getElementById('alzado-nombre-tag').innerText = mueble.nombre || 'Góndola';

    const carasDisponibles = mueble.caras ? Object.keys(mueble.caras) : ['A'];
    if (targetCompId && targetCompId.indexOf('-') !== -1) {
        const p = targetCompId.split('-');
        if (p.length >= 3 && carasDisponibles.indexOf(p[p.length - 3]) !== -1) {
            caraAlzadoSeleccionada = p[p.length - 3];
        } else {
            caraAlzadoSeleccionada = carasDisponibles[0] || 'A';
        }
    } else if (carasDisponibles.indexOf(caraAlzadoSeleccionada) === -1) {
        caraAlzadoSeleccionada = carasDisponibles[0] || 'A';
    }

    tabsCarasEl.innerHTML = '';
    carasDisponibles.forEach(c => {
        const btn = document.createElement('button');
        btn.classList.add('btn-tab-cara');
        if (c === caraAlzadoSeleccionada) btn.classList.add('activa');
        btn.innerText = 'Cara ' + c;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            caraAlzadoSeleccionada = c;
            document.querySelectorAll('.btn-tab-cara').forEach(b => b.classList.remove('activa'));
            btn.classList.add('activa');
            renderizarGeometriaAlzado();
        });
        tabsCarasEl.appendChild(btn);
    });

    renderizarGeometriaAlzado();
    widgetAlzado.classList.remove('oculto');
}

function renderizarGeometriaAlzado() {

    if (!muebleAlzadoActivo || !svgAlzado) return;

    const m = muebleAlzadoActivo;
    const configCara = (m.caras && m.caras[caraAlzadoSeleccionada]) ? m.caras[caraAlzadoSeleccionada] : {};
    
    const niveles = Math.max(1, configCara.niveles || configCara.alturas || 4);
    const divisiones = Math.max(1, configCara.divisiones || configCara.bins || 6);
    const capMaxBin = Number(configCara.capacidadPorBin) || 10;

    const originX = 18;
    const originY = 32;
    const anchoFrente = 210;
    const altoFrente = 120;
    
    const dxFuga = 24;
    const dyFuga = -16;

    let targetNivel = -1;
    let targetCol = -1;
    if (binAlzadoObjetivoId && binAlzadoObjetivoId.indexOf('-') !== -1) {
        const partes = binAlzadoObjetivoId.split('-');
        const len = partes.length;
        if (len >= 3 && partes[len - 3] === caraAlzadoSeleccionada) {
            targetCol = parseInt(partes[len - 1].replace(/\D/g, '')) || -1;
            targetNivel = parseInt(partes[len - 2].replace(/\D/g, '')) || -1;
        }
    }

    let svgContent = '';

    // 1. Tapa Superior
    svgContent += '<polygon class="mueble-3d-cara-superior" points="' +
        originX + ',' + originY + ' ' +
        (originX + dxFuga) + ',' + (originY + dyFuga) + ' ' +
        (originX + anchoFrente + dxFuga) + ',' + (originY + dyFuga) + ' ' +
        (originX + anchoFrente) + ',' + originY + '" />';

    // 2. Costado Lateral Derecho
    svgContent += '<polygon class="mueble-3d-cara-lateral" points="' +
        (originX + anchoFrente) + ',' + originY + ' ' +
        (originX + anchoFrente + dxFuga) + ',' + (originY + dyFuga) + ' ' +
        (originX + anchoFrente + dxFuga) + ',' + (originY + altoFrente + dyFuga) + ' ' +
        (originX + anchoFrente) + ',' + (originY + altoFrente) + '" />';

    // 3. Aristas maestras
    svgContent += '<line class="mueble-3d-aristas" x1="' + originX + '" y1="' + originY + '" x2="' + (originX + dxFuga) + '" y2="' + (originY + dyFuga) + '" />' +
        '<line class="mueble-3d-aristas" x1="' + (originX + anchoFrente) + '" y1="' + originY + '" x2="' + (originX + anchoFrente + dxFuga) + '" y2="' + (originY + dyFuga) + '" />' +
        '<line class="mueble-3d-aristas" x1="' + (originX + anchoFrente) + '" y1="' + (originY + altoFrente) + '" x2="' + (originX + anchoFrente + dxFuga) + '" y2="' + (originY + altoFrente + dyFuga) + '" />' +
        '<line class="mueble-3d-aristas" x1="' + (originX + dxFuga) + '" y1="' + (originY + dyFuga) + '" x2="' + (originX + anchoFrente + dxFuga) + '" y2="' + (originY + dyFuga) + '" />' +
        '<line class="mueble-3d-aristas" x1="' + (originX + anchoFrente + dxFuga) + '" y1="' + (originY + dyFuga) + '" x2="' + (originX + anchoFrente + dxFuga) + '" y2="' + (originY + altoFrente + dyFuga) + '" />';

    // 4. Parrilla de Bins con Shading Volumétrico (3.4)
    const anchoCelda = anchoFrente / divisiones;
    const altoCelda = altoFrente / niveles;

    for (let r = 0; r < niveles; r++) {
        const nroNivel = niveles - r;
        const cellY = originY + (r * altoCelda);

        for (let c = 0; c < divisiones; c++) {
            const nroCol = c + 1;
            const cellX = originX + (c * anchoCelda);
            const esTarget = (nroNivel === targetNivel && nroCol === targetCol);
            const strNivel = "N" + nroNivel;
            const strBin = "B" + (nroCol < 10 ? "0" + nroCol : nroCol);
            const idCompGenerado = "GEO-P-" + idNegocio + "-" + idSedeActiva + "-" + m.id_mueble + "-" + caraAlzadoSeleccionada + "-" + strNivel + "-" + strBin;


            // Existencias físicas del bin
            const compRegistrado = m.compartimientos?.find(comp =>
                comp.cara === caraAlzadoSeleccionada && comp.nivel === strNivel && comp.bin === strBin
            );
            const idEspacio = compRegistrado?.id_comp || idCompGenerado;
            const itemsEnBin = stockPosicionalGlobal.filter(s => s.id_compartimiento === idEspacio);

            const cantFisica = itemsEnBin.reduce((acc, x) => acc + (Number(x.cantidad) || 0), 0);
            const ratioOcupacion = cantFisica / capMaxBin;

            // Shading cromático por capacidad
            let claseShading = 'bin-shading-vacio';
            if (cantFisica > 0 && ratioOcupacion <= 0.4) {
                claseShading = 'bin-shading-bajo';
            } else if (ratioOcupacion > 0.4) {
                claseShading = 'bin-shading-abastecido';
            }

            const esSeleccionado = binSeleccionadoActivo && binSeleccionadoActivo.idComp === idEspacio;
            const claseTarget = esTarget ? ' bin-objetivo-gps' : '';
            const claseSel = esSeleccionado ? ' bin-seleccionado-touch' : '';
            const textoActivo = (esTarget || esSeleccionado) ? ' texto-activo' : '';
            const textoCelda = cantFisica > 0 ? (cantFisica + 'u') : nroCol;

            svgContent += '<g class="alzado-bin-nodo" ' +
                'data-id-comp="' + idEspacio + '" ' +
                'data-cara="' + caraAlzadoSeleccionada + '" ' +
                'data-nivel="' + nroNivel + '" ' +
                'data-col="' + nroCol + '" ' +
                'data-cant="' + cantFisica + '">' +
                '<rect class="bin-cuadrante-rect ' + claseShading + claseTarget + claseSel + '" ' +
                'x="' + (cellX + 1) + '" y="' + (cellY + 1) + '" ' +
                'width="' + (anchoCelda - 2) + '" height="' + (altoCelda - 2) + '" ' +
                'rx="2" />' +
                '<text class="bin-texto-coord' + textoActivo + '" ' +
                'x="' + (cellX + (anchoCelda / 2)) + '" ' +
                'y="' + (cellY + (altoCelda / 2) + 2.5) + '" ' +
                'text-anchor="middle">' +
                textoCelda +
                '</text>' +
                '</g>';
        }
    }

    svgAlzado.innerHTML = svgContent;

    // 3.1 Asignación de Interactividad Táctil a cada Bin
    svgAlzado.querySelectorAll('.alzado-bin-nodo').forEach(nodo => {
        const handlerClick = (e) => {
            e.stopPropagation();
            if (navigator.vibrate) navigator.vibrate(20);
            const idComp = nodo.getAttribute('data-id-comp');
            const cara = nodo.getAttribute('data-cara');
            const nivel = nodo.getAttribute('data-nivel');
            const col = nodo.getAttribute('data-col');
            const cant = Number(nodo.getAttribute('data-cant')) || 0;

            binSeleccionadoActivo = { mueble: m, idComp: idComp, cara: cara, nivel: nivel, col: col, cant: cant };

            svgAlzado.querySelectorAll('.bin-cuadrante-rect').forEach(r => r.classList.remove('bin-seleccionado-touch'));
            const rect = nodo.querySelector('.bin-cuadrante-rect');
            if (rect) rect.classList.add('bin-seleccionado-touch');

            desplegarMicroKardexFooter(binSeleccionadoActivo);
        };
        nodo.addEventListener('click', handlerClick);
    });

    if (binSeleccionadoActivo) {
        desplegarMicroKardexFooter(binSeleccionadoActivo);
    } else {
        const footer = document.querySelector('.alzado-pip-footer');
        if (footer) {
            const msgFooter = (targetNivel !== -1 && targetCol !== -1)
                ? ('Objetivo: Cara ' + caraAlzadoSeleccionada + ' · N' + targetNivel + ' · B' + targetCol)
                : ('Toca un bin para operar (Cara ' + caraAlzadoSeleccionada + ')');

            footer.innerHTML = '<span id="alzado-target-txt" class="alzado-target-detalle">' + msgFooter + '</span>';
        }
    }
}

// 🎯 3.2 y 3.3 Micro-Kardex: [+1 Reponer] y [Reportar Merma]
function desplegarMicroKardexFooter(binData) {
    const footer = document.querySelector('.alzado-pip-footer');
    if (!footer) return;

    // Buscar si ya existe un producto asignado a este bin
    const itemEnBin = stockPosicionalGlobal.find(s => s.id_compartimiento === binData.idComp && Number(s.cantidad) > 0);
    const prod = itemEnBin ? catalogoTotal.find(p => p.id_prod === itemEnBin.id_prod) : null;
    const nombreProd = prod ? prod.nombre : (itemEnBin ? itemEnBin.id_prod : 'Bin Vacío');

    footer.innerHTML = '<span class="alzado-target-detalle">' +
        'Cara ' + binData.cara + ' · N' + binData.nivel + ' · B' + binData.col + ' (' + binData.cant + 'u) - ' + nombreProd +
        '</span>' +
        '<div class="alzado-acciones-bin">' +
        '<button id="btn-alzado-reponer" class="btn-micro-kardex btn-kardex-reponer">Mover stock</button>' +
        '<button id="btn-alzado-auditar-bin" class="btn-micro-kardex btn-kardex-auditar">Auditar</button>' +
        '<button id="btn-alzado-merma" class="btn-micro-kardex btn-kardex-merma">Merma</button>' +
        '</div>';

    document.getElementById('btn-alzado-reponer').addEventListener('click', () => {
        window.location.href = enlaceStock(binData.mueble, binData.idComp);
    });
    document.getElementById('btn-alzado-auditar-bin').addEventListener('click', () => {
        window.location.href = enlaceStock(binData.mueble, binData.idComp, 'AUDITAR');
    });

    document.getElementById('btn-alzado-merma').addEventListener('click', async (e) => {
        e.stopPropagation();
        await ejecutarReporteMermaBin(binData, prod || itemEnBin);
    });
}

function enlaceStock(mueble = null, espacio = null, operacion = null) {
    const parametros = new URLSearchParams({ sede: idSedeActiva });
    if (mueble) parametros.set('mueble', mueble.id_mueble);
    if (espacio) parametros.set('bin', espacio);
    if (operacion) parametros.set('op', operacion);
    return 'stock?' + parametros.toString();
}

async function ejecutarReporteMermaBin(binData, itemOProd) {
    const confirmacion = await window.mostrarConfirmacionInApp(
        '¿Reportar merma o avería física en Cara ' + binData.cara + ' · Nivel ' + binData.nivel + ' · Bin ' + binData.col + '?',
        'Confirmar Merma en Anaquel'
    );
    if (!confirmacion) return;

    dispararFeedbackHaptico('critico');
    reproducirTonoPiso('critico');

    const idProd = itemOProd ? (itemOProd.id_prod || itemOProd.codigo_barras) : 'NO_ESPECIFICADO';

    // 1. Asiento en Alertas_Seguridad
    const resultado = await GeokatuDB.InventarioService.reportarMermaAnaquel(
        idNegocio,
        binData.mueble.id_mueble,
        binData.idComp,
        idProd,
        'Avería física detectada en anaquel'
    );

    if (!resultado.success) {
        await window.mostrarAlertaInApp(resultado.error || 'Intenta nuevamente.', 'No se guardó la alerta');
        return;
    }
    // 2. Reflejo visual inmediato en el plano 2D
    const elMueble = document.getElementById('mueble-visor-' + binData.mueble.id_mueble);
    if (elMueble) {
        elMueble.classList.add('mueble-alerta-rojo');
    }

    await window.mostrarAlertaInApp(
        'Alerta de merma asentada correctamente para ' + binData.mueble.nombre + ' [' + binData.idComp + '].',
        'Merma Registrada'
    );
}





// ==========================================
// 6. PARSER ÓPTICO Y BÚSQUEDA MULTICRITERIO
// ==========================================
function centrarMuebleEnPantalla(mueble) {
    if (!mueble) return;
    viewport.x = (window.innerWidth / 2) - ((mueble.x + (mueble.anchoM * METRO_PX) / 2) * viewport.escala);
    viewport.y = (window.innerHeight / 2) - ((mueble.y + (mueble.largoM * METRO_PX) / 2) * viewport.escala);
    actualizarTransform();
}

// 🎯 Inyector de Coordenada Exacta (Cara y Bin) con Baliza GPS Amarilla
function colocarPinGpsEnMueble(mueble, idCompartimiento, labelProducto = '') {
    const el = document.getElementById('mueble-visor-' + mueble.id_mueble);
    if (!el) return;

    let cara = 'A';
    let nivel = 1;
    let binNum = 1;

    if (idCompartimiento && idCompartimiento.indexOf('-') !== -1) {
        const partes = idCompartimiento.split('-');
        const len = partes.length;
        if (len >= 3) {
            const posibleBin = parseInt(partes[len - 1].replace(/\D/g, '')) || 1;
            const posibleNivel = parseInt(partes[len - 2].replace(/\D/g, '')) || 1;
            const posibleCara = partes[len - 3].toUpperCase();
            if (['A', 'B', 'C', 'D'].indexOf(posibleCara) !== -1) cara = posibleCara;
            binNum = posibleBin;
            nivel = posibleNivel;
        }
    }

    const rot = mueble.rotacion || 0;
    const wPx = mueble.anchoM * METRO_PX;
    const hPx = mueble.largoM * METRO_PX;
    const totalBinsCara = (mueble.caras && mueble.caras[cara]) ? (mueble.caras[cara].bins || 4) : 4;
    const pasoFraccion = 1 / (totalBinsCara + 1);
    const indexNormalizado = Math.min(Math.max(binNum, 1), totalBinsCara);

    let posX = wPx * 0.5;
    let posY = hPx * 0.5;

    // Cara A: Frontal (inferior) | Cara B: Posterior (superior) | C: Izq | D: Der
    if (cara === 'A') {
        posX = wPx * (pasoFraccion * indexNormalizado);
        posY = hPx * 0.82;
    } else if (cara === 'B') {
        posX = wPx * (pasoFraccion * indexNormalizado);
        posY = hPx * 0.18;
    } else if (cara === 'C') {
        posX = wPx * 0.18;
        posY = hPx * (pasoFraccion * indexNormalizado);
    } else if (cara === 'D') {
        posX = wPx * 0.82;
        posY = hPx * (pasoFraccion * indexNormalizado);
    }

    const pin = document.createElement('div');
    pin.classList.add('pin-radar-gps');
    pin.style.left = posX + 'px';
    pin.style.top = posY + 'px';

    // Contrarrotación de la etiqueta para legibilidad permanente horizontal (Formato Anti-Docs)
    pin.innerHTML = '<div class="pin-gps-onda"></div>' +
        '<div class="pin-gps-nucleo"></div>' +
        '<div class="pin-gps-etiqueta" style="transform: rotate(' + (-rot) + 'deg);">' +
        'Cara ' + cara + ' · N' + nivel + ' · B' + binNum +
        '</div>';
    el.appendChild(pin);
}



function poblarFiltros() {
    const categorias = [...new Set(catalogoTotal.map(p => p.categoria).filter(Boolean))];
    filtroCat.innerHTML = '<option value="">Todas las categorías</option>';
    categorias.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.innerText = cat;
        filtroCat.appendChild(opt);
    });

    const precios = catalogoTotal.map(p => Number(p.precio) || 0);
    const maxP = precios.length > 0 ? Math.max(...precios) : 500000;
    filtroPrecio.max = maxP;
    filtroPrecio.value = maxP;
    labelPrecioMax.innerText = "$" + maxP.toLocaleString(); 
}

function ejecutarBusquedaYFiltros() {
    const rawInput = inputBusqueda.value.trim();
    const query = rawInput.toLowerCase();
    const catSel = filtroCat.value;
    const precioMax = Number(filtroPrecio.value) || Infinity;
    const reglaVenc = filtroVenc.value;
    const hoy = new Date();

    // 1. Limpieza de balizas GPS y estados visuales previos
    document.querySelectorAll('.pin-radar-gps').forEach(p => p.remove());
    document.querySelectorAll('.mueble-bloque').forEach(m => m.classList.remove('radar-activo'));
    if (widgetAlzado) widgetAlzado.classList.add('oculto');


    if (!rawInput && !catSel && precioMax >= Number(filtroPrecio.max) && reglaVenc === 'TODOS') {
        return;
    }

    // --- CASO A: DETECCIÓN DIRECTA DE QR MAESTRO DE MUEBLE (GEO-M-) ---
    if (rawInput.startsWith('GEO-M-')) {
        const muebleEncontrado = muebles.find(m => m.qr === rawInput || rawInput.endsWith(m.id_mueble));
        if (muebleEncontrado) {
            centrarMuebleEnPantalla(muebleEncontrado);
            colocarPinGpsEnMueble(muebleEncontrado, 'GEO-P-0-0-0-A-1-1');
            const items = stockPosicionalGlobal.filter(s => s.id_estante === muebleEncontrado.id_mueble || s.id_estante === muebleEncontrado.qr);
            abrirFichaMueble(muebleEncontrado, items);
        }
        return;
    }

   // --- CASO B: DETECCIÓN DIRECTA DE QR DE BIN (GEO-P-) ---
    if (rawInput.startsWith('GEO-P-')) {
        const muebleEncontrado = muebles.find(m => 
            (m.compartimientos || []).some(c => c.id_comp === rawInput) ||
            rawInput.indexOf('-' + m.id_mueble + '-') !== -1
        );

        if (muebleEncontrado) {
            centrarMuebleEnPantalla(muebleEncontrado);
            colocarPinGpsEnMueble(muebleEncontrado, rawInput);
            abrirAlzadoElevacionMueble(muebleEncontrado, rawInput);
            const items = stockPosicionalGlobal.filter(s => s.id_compartimiento === rawInput);
            abrirFichaMueble(muebleEncontrado, items);
        }
        return;
    }


    // --- CASO C: FILTRO MULTICRITERIO (SKU, NOMBRE, BARRAS, LOTE, PRECIO, CATEGORÍA) ---
    const prodsCoincidentes = catalogoTotal.filter(p => {
        const coincideQuery = !query ||
            (p.nombre && p.nombre.toLowerCase().includes(query)) ||
            (p.codigo_barras && p.codigo_barras.toLowerCase().includes(query)) ||
            (p.id_prod && p.id_prod.toLowerCase().includes(query));

        const coincideCat = !catSel || p.categoria === catSel;
        const coincidePrecio = !p.precio || Number(p.precio) <= precioMax;

        return coincideQuery && coincideCat && coincidePrecio;
    });

    const idsProds = new Set(prodsCoincidentes.map(p => p.id_prod));
    const coincidenciasUbicacion = [];

    stockPosicionalGlobal.forEach(ubi => {
        const matchProd = idsProds.has(ubi.id_prod);
        const matchLote = query && ubi.lote && ubi.lote.toLowerCase().includes(query);
        const matchComp = query && ubi.id_compartimiento && ubi.id_compartimiento.toLowerCase().includes(query);

        if (matchProd || matchLote || matchComp) {
            if (reglaVenc !== 'TODOS') {
                if (!ubi.fecha_vencimiento) return;
                const dias = Math.ceil((new Date(ubi.fecha_vencimiento) - hoy) / (1000 * 60 * 60 * 24));
                if (reglaVenc === 'VENCIDOS' && dias > 0) return;
                if (reglaVenc === '5' && (dias < 0 || dias > 5)) return;
                if (reglaVenc === '15' && (dias < 0 || dias > 15)) return;
                if (reglaVenc === '30' && (dias < 0 || dias > 30)) return;
            }

            coincidenciasUbicacion.push(ubi);
        }
    });

    let primerMueble = null;
    let primerUbi = null;
    const mueblesEncontrados = [];

    coincidenciasUbicacion.forEach(ubi => {
        const muebleObj = muebles.find(m => m.id_mueble === ubi.id_estante || m.qr === ubi.id_estante);
        if (muebleObj) {
            colocarPinGpsEnMueble(muebleObj, ubi.id_compartimiento);
            mueblesEncontrados.push(muebleObj);
            if (!primerMueble) {
                primerMueble = muebleObj;
                primerUbi = ubi;
            }
        }
    });

    // 4.1 y 4.2 Decisión de Trazado Vectorial Multi-Parada vs. Objetivo Único
    if (mueblesEncontrados.length > 1) {
        puntosRutaPicking = calcularRutaPickingOptima(mueblesEncontrados);
        iniciarAnimacionRuta();
        muebleObjetivoRadar = puntosRutaPicking[1] ? puntosRutaPicking[1].mueble : primerMueble;
    } else if (mueblesEncontrados.length === 1) {
        detenerAnimacionRuta();
        muebleObjetivoRadar = primerMueble;
    } else {
        detenerAnimacionRuta();
        muebleObjetivoRadar = null;
    }

    actualizarBrujulaDireccional();

    if (primerMueble && query) {
        centrarMuebleEnPantalla(primerMueble);
        if (primerUbi) {
            abrirAlzadoElevacionMueble(primerMueble, primerUbi.id_compartimiento);
        }

        const prod = catalogoTotal.find(p => p.id_prod === (primerUbi ? primerUbi.id_prod : ''));
        const stockActual = prod ? Number(prod.stock_actual) : 1;
        const diasVenc = (primerUbi && primerUbi.fecha_vencimiento)
            ? Math.ceil((new Date(primerUbi.fecha_vencimiento) - hoy) / (1000 * 60 * 60 * 24))
            : 999;

        if (diasVenc <= 5) {
            reproducirTonoPiso('vencido');
            dispararFeedbackHaptico('critico');
        } else if (stockActual <= 0) {
            reproducirTonoPiso('quiebre');
            dispararFeedbackHaptico('quiebre');
        } else {
            reproducirTonoPiso('exito');
            dispararFeedbackHaptico('exito');
        }
    }
}




// ==========================================
// 4.1 HEURÍSTICA DE PICKING S-SHAPE Y 4.3 BRÚJULA OFF-SCREEN
// ==========================================
const elBrujula = document.getElementById('hud-brujula-radar');
const elFlechaBrujula = document.getElementById('brujula-flecha-nodo');
const elDistBrujula = document.getElementById('brujula-distancia-txt');

// 4.1 Algoritmo de Secuencia Óptima de Recorrido (Nearest Neighbor)
function calcularRutaPickingOptima(mueblesObjetivo) {
    if (!mueblesObjetivo || mueblesObjetivo.length === 0) return [];

    const unicos = [];
    const idsVistos = new Set();
    mueblesObjetivo.forEach(m => {
        if (!idsVistos.has(m.id_mueble)) {
            idsVistos.add(m.id_mueble);
            unicos.push(m);
        }
    });

    let puntoActual = { x: 40, y: 40 }; // Origen estándar: Entrada / Caja
    const pendientes = unicos.map(m => {
        return {
            mueble: m,
            x: m.x + ((m.anchoM * METRO_PX) / 2),
            y: m.y + ((m.largoM * METRO_PX) / 2)
        };
    });

    const rutaFinal = [{ x: puntoActual.x, y: puntoActual.y, label: 'Entrada' }];

    while (pendientes.length > 0) {
        let mejorIdx = 0;
        let distMinima = Infinity;

        for (let i = 0; i < pendientes.length; i++) {
            const p = pendientes[i];
            const d = Math.hypot(p.x - puntoActual.x, p.y - puntoActual.y);
            if (d < distMinima) {
                distMinima = d;
                mejorIdx = i;
            }
        }

        const elegido = pendientes.splice(mejorIdx, 1)[0];
        rutaFinal.push(elegido);
        puntoActual = { x: elegido.x, y: elegido.y };
    }

    return rutaFinal;
}

// 4.3 Raycast y Posicionamiento de Baliza en Borde de Pantalla
function actualizarBrujulaDireccional() {
    if (!elBrujula || !muebleObjetivoRadar) {
        if (elBrujula) elBrujula.classList.add('oculto');
        return;
    }

    const m = muebleObjetivoRadar;
    const wPx = m.anchoM * METRO_PX;
    const hPx = m.largoM * METRO_PX;
    const mCentroMundoX = m.x + (wPx / 2);
    const mCentroMundoY = m.y + (hPx / 2);

    const screenTargetX = viewport.x + (mCentroMundoX * viewport.escala);
    const screenTargetY = viewport.y + (mCentroMundoY * viewport.escala);

    const padLeft = 28;
    const padRight = window.innerWidth - 28;
    const padTop = 120;
    const padBottom = window.innerHeight - 80;

    const estaVisible = (
        screenTargetX >= (padLeft - 20) &&
        screenTargetX <= (padRight + 20) &&
        screenTargetY >= (padTop - 20) &&
        screenTargetY <= (padBottom + 20)
    );

    if (estaVisible) {
        elBrujula.classList.add('oculto');
        return;
    }

    const screenCenterX = window.innerWidth / 2;
    const screenCenterY = (padTop + padBottom) / 2;

    const dx = screenTargetX - screenCenterX;
    const dy = screenTargetY - screenCenterY;
    const anguloRad = Math.atan2(dy, dx);
    const anguloDeg = anguloRad * (180 / Math.PI);

    let tMin = Infinity;
    if (dx > 0) tMin = Math.min(tMin, (padRight - screenCenterX) / dx);
    if (dx < 0) tMin = Math.min(tMin, (padLeft - screenCenterX) / dx);
    if (dy > 0) tMin = Math.min(tMin, (padBottom - screenCenterY) / dy);
    if (dy < 0) tMin = Math.min(tMin, (padTop - screenCenterY) / dy);

    const clampX = screenCenterX + (dx * tMin);
    const clampY = screenCenterY + (dy * tMin);

    const worldCenterX = (screenCenterX - viewport.x) / viewport.escala;
    const worldCenterY = (screenCenterY - viewport.y) / viewport.escala;
    const distPx = Math.hypot(mCentroMundoX - worldCenterX, mCentroMundoY - worldCenterY);
    const distM = (distPx / METRO_PX).toFixed(1) + 'm';

    elBrujula.style.left = clampX + 'px';
    elBrujula.style.top = clampY + 'px';
    elFlechaBrujula.style.transform = 'rotate(' + anguloDeg + 'deg)';
    elDistBrujula.innerText = distM;

    elBrujula.classList.remove('oculto');
}

if (elBrujula) {
    elBrujula.addEventListener('click', (e) => {
        e.stopPropagation();
        if (muebleObjetivoRadar) {
            centrarMuebleEnPantalla(muebleObjetivoRadar);
            if (navigator.vibrate) navigator.vibrate(30);
        }
    });
}

// Eventos de filtros y búsqueda
inputBusqueda.addEventListener('input', ejecutarBusquedaYFiltros);
filtroCat.addEventListener('change', ejecutarBusquedaYFiltros);
filtroVenc.addEventListener('change', ejecutarBusquedaYFiltros);
filtroPrecio.addEventListener('input', (e) => {
   labelPrecioMax.innerText = "$" + Number(e.target.value).toLocaleString(); 
    ejecutarBusquedaYFiltros();
});

document.getElementById('btn-toggle-filtros').addEventListener('click', () => {
    panelFiltros.classList.toggle('oculto');
});

document.getElementById('btn-limpiar-filtros').addEventListener('click', () => {
    inputBusqueda.value = '';
    filtroCat.value = '';
    filtroVenc.value = 'TODOS';
    filtroPrecio.value = filtroPrecio.max;
    labelPrecioMax.innerText = '$' + Number(filtroPrecio.max).toLocaleString();
    document.querySelectorAll('.pin-radar-gps').forEach(p => p.remove());
    document.querySelectorAll('.mueble-bloque').forEach(m => m.classList.remove('radar-activo'));
    if (widgetAlzado) widgetAlzado.classList.add('oculto');
    detenerAnimacionRuta();
    muebleObjetivoRadar = null;
    actualizarBrujulaDireccional();
});



// 🎯 FUNCIÓN CANÓNICA: Zoom Extents / Centrado cinemático global
function ejecutarZoomExtents(vibrar = true) {
    if (vibrar && navigator.vibrate) navigator.vibrate(30);
    const planoW = perimetro.anchoM * METRO_PX;
    const planoH = perimetro.largoM * METRO_PX;
    const altoDisponible = window.innerHeight - 100;
    const factorEscala = Math.min((window.innerWidth * 0.88) / planoW, (altoDisponible * 0.82) / planoH);

    viewport.escala = Math.min(Math.max(0.2, factorEscala), 2.5);
    viewport.x = (window.innerWidth - (planoW * viewport.escala)) / 2;
    viewport.y = 85 + ((altoDisponible - (planoH * viewport.escala)) / 2);
    actualizarTransform();
}

// 🎯 BOTÓN DIANA: Listener de encuadre manual
const btnZoomFit = document.getElementById('btn-zoom-fit');
if (btnZoomFit) {
    btnZoomFit.addEventListener('click', () => ejecutarZoomExtents(true));
}



// Control y conmutación del Menú Flotante de Capas (Speed-Dial FAB)
const btnFabTrigger = document.getElementById('btn-fab-trigger');
const fabMenuEmergente = document.getElementById('fab-menu-emergente');
const lblCapaActual = document.getElementById('lbl-capa-actual');

if (btnFabTrigger && fabMenuEmergente) {
    btnFabTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (navigator.vibrate) navigator.vibrate(30);
        fabMenuEmergente.classList.toggle('oculto');
    });

    // Cerrar menú emergente si se toca el lienzo infinito
    vpEl.addEventListener('pointerdown', () => {
        if (!fabMenuEmergente.classList.contains('oculto')) {
            fabMenuEmergente.classList.add('oculto');
        }
    });
}

// Selector de capas temáticas y actualización de etiqueta
document.querySelectorAll('.badge-filtro').forEach(btn => {
    if (btn.id === 'btn-ir-editor') return;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (navigator.vibrate) navigator.vibrate(30);
        document.querySelectorAll('.badge-filtro').forEach(b => {
            if (b.id !== 'btn-ir-editor') b.classList.remove('activo');
        });
        btn.classList.add('activo');
        capaActiva = btn.getAttribute('data-capa');

        // Actualizar el texto del badge flotante inferior
        if (lblCapaActual) {
            const rotulos = {
                'TODO': 'Todos',
                'HEATMAP_STOCK': 'Stock',
                'ESTADO_AUDITORIA': 'Auditoría',
                'HEATMAP_PRECIO': 'Precios',
                'VENCIMIENTOS': 'Venc.',
                'STOCK_CERO': 'Sin Stock'
            };

            lblCapaActual.innerText = rotulos[capaActiva] || 'Capas';
        }

        if (fabMenuEmergente) fabMenuEmergente.classList.add('oculto');
        renderizarMueblesVisor();
    });
});


// ==========================================
// 7. CÁMARA RÁPIDA, HÁPTICA Y AUDITORÍA RÁPIDA (FASE 2)
// ==========================================
let html5QrCodeVisor = null;
const modalCamara = document.getElementById('modal-camara');
const btnLinterna = document.getElementById('btn-toggle-linterna');
const btnModoBuscar = document.getElementById('btn-modo-buscar');
const btnModoRafaga = document.getElementById('btn-modo-rafaga');
const bannerRafaga = document.getElementById('banner-rafaga-feedback');
const txtRafagaProd = document.getElementById('txt-rafaga-producto');
const badgeRafagaConteo = document.getElementById('badge-rafaga-conteo');

let modoEscaneoCamara = 'BUSQUEDA'; // 'BUSQUEDA' | 'RAFAGA'
let antorchaEncendida = false;
let ultimoCodigoLeido = '';
let tiempoUltimaLectura = 0;
let conteoAuditoriaRafaga = 0;

// 🔊 2.1 Motor Web Audio API Sintetizado (Sin archivos externos)
let audioCtxVisor = null;
function reproducirTonoPiso(tipo = 'exito') {
    try {
        if (!audioCtxVisor) audioCtxVisor = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtxVisor.state === 'suspended') audioCtxVisor.resume();
        const osc = audioCtxVisor.createOscillator();
        const gain = audioCtxVisor.createGain();
        osc.connect(gain);
        gain.connect(audioCtxVisor.destination);
        const t = audioCtxVisor.currentTime;

        if (tipo === 'exito') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, t);
            gain.gain.setValueAtTime(0.2, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
            osc.start(t);
            osc.stop(t + 0.12);
        } else if (tipo === 'quiebre') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(420, t);
            gain.gain.setValueAtTime(0.25, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
            osc.start(t);
            osc.stop(t + 0.18);
        } else if (tipo === 'critico' || tipo === 'vencido') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(300, t);
            gain.gain.setValueAtTime(0.3, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
            osc.start(t);
            osc.stop(t + 0.25);
        }
    } catch (e) {
        console.warn("[WebAudio] No inicializado o bloqueado:", e);
    }
}

// 📳 2.3 Perfiles de Retroalimentación Háptica Diferenciada
function dispararFeedbackHaptico(tipo = 'exito') {
    if (!navigator.vibrate) return;
    if (tipo === 'exito') {
        navigator.vibrate(20); // Pulso seco
    } else if (tipo === 'quiebre') {
        navigator.vibrate([40, 60, 40]); // Doble pulso corto
    } else if (tipo === 'critico' || tipo === 'vencido') {
        navigator.vibrate(150); // Pulso largo de advertencia
    }
}

// 🔦 2.2 Extracción de Pista de Video y Alternancia de Antorcha/Linterna
function obtenerTrackCamaraActiva() {
    const videoEl = document.querySelector('#lector-camara-visor video');
    if (videoEl && videoEl.srcObject) {
        return videoEl.srcObject.getVideoTracks()[0] || null;
    }
    return null;
}

if (btnLinterna) {
    btnLinterna.addEventListener('click', async () => {
        const track = obtenerTrackCamaraActiva();
        if (!track) return;
        const caps = track.getCapabilities ? track.getCapabilities() : {};
     if (!caps.torch) {
            window.mostrarAlertaInApp('Este dispositivo no soporta control de linterna en la cámara.', 'Hardware No Disponible');
            return;
        }

        try {
            antorchaEncendida = !antorchaEncendida;
            await track.applyConstraints({ advanced: [{ torch: antorchaEncendida }] });
            btnLinterna.classList.toggle('activo', antorchaEncendida);
            btnLinterna.innerText = antorchaEncendida ? '🔦 ON' : '🔦 OFF';
        } catch (err) {
            console.warn('[Linterna] Error al conmutar antorcha:', err);
        }
    });
}

// Selectores de Modo de Escaneo
if (btnModoBuscar && btnModoRafaga) {
    btnModoBuscar.addEventListener('click', () => {
        modoEscaneoCamara = 'BUSQUEDA';
        btnModoBuscar.classList.add('activa');
        btnModoRafaga.classList.remove('activa');
        if (bannerRafaga) bannerRafaga.classList.add('oculto');
    });

    btnModoRafaga.addEventListener('click', () => {
        modoEscaneoCamara = 'RAFAGA';
        btnModoRafaga.classList.add('activa');
        btnModoBuscar.classList.remove('activa');
        if (bannerRafaga) bannerRafaga.classList.remove('oculto');
    });
}

// ⚡ 2.4 Procesador de Auditoría en Ráfaga Continua (Debounce 800ms)
function procesarLecturaRafaga(codigo) {
    conteoAuditoriaRafaga++;
    const codLimpio = String(codigo).trim().toLowerCase();
    const prod = catalogoTotal.find(p => 
        (p.codigo_barras && p.codigo_barras.toLowerCase() === codLimpio) ||
        (p.id_prod && p.id_prod.toLowerCase() === codLimpio)
    );

    bannerRafaga.classList.remove('alerta-quiebre', 'alerta-vencido');
    badgeRafagaConteo.innerText = conteoAuditoriaRafaga + " leídos";

    if (!prod) {
        txtRafagaProd.innerText = "❓ Desconocido: " + codigo;
        bannerRafaga.classList.add('alerta-quiebre');
        reproducirTonoPiso('quiebre');
        dispararFeedbackHaptico('quiebre');
        return;
    }


    const ubis = stockPosicionalGlobal.filter(s => s.id_prod === prod.id_prod);
    const stockTotal = Number(prod.stock_actual) || 0;
    const hoy = new Date();
    const tieneVencido = ubis.some(u => u.fecha_vencimiento && Math.ceil((new Date(u.fecha_vencimiento) - hoy) / (1000 * 60 * 60 * 24)) <= 5);

    if (tieneVencido) {
        txtRafagaProd.innerText = '⏳ [CRÍTICO/VENCE] ' + prod.nombre;
        bannerRafaga.classList.add('alerta-vencido');
        reproducirTonoPiso('vencido');
        dispararFeedbackHaptico('critico');
    } else if (stockTotal <= 0) {
        txtRafagaProd.innerText = '⚠️ [STOCK 0] ' + prod.nombre;
        bannerRafaga.classList.add('alerta-quiebre');
        reproducirTonoPiso('quiebre');
        dispararFeedbackHaptico('quiebre');
    } else {
        txtRafagaProd.innerText = '✓ ' + prod.nombre + ' (' + stockTotal + 'u)';
        reproducirTonoPiso('exito');
        dispararFeedbackHaptico('exito');
    }


    // Centrar y posicionar en el plano en segundo plano
    inputBusqueda.value = codigo;
    ejecutarBusquedaYFiltros();
}

document.getElementById('btn-abrir-camara').addEventListener('click', () => {
    modalCamara.style.display = 'flex';
    ultimoCodigoLeido = '';
    tiempoUltimaLectura = 0;
    conteoAuditoriaRafaga = 0;
    if (badgeRafagaConteo) badgeRafagaConteo.innerText = '0 escaneos';
    if (txtRafagaProd) txtRafagaProd.innerText = 'Esperando lectura...';

    if (!html5QrCodeVisor) {
        html5QrCodeVisor = new Html5Qrcode("lector-camara-visor");
    }
    html5QrCodeVisor.start(
        { facingMode: "environment" },
        { fps: 20, qrbox: { width: 260, height: 180 } },
        (codigo) => {
            const ahora = Date.now();
            if (codigo === ultimoCodigoLeido && (ahora - tiempoUltimaLectura) < 800) {
                return; // Inhibir ráfaga duplicada inmediata
            }
            ultimoCodigoLeido = codigo;
            tiempoUltimaLectura = ahora;

            if (modoEscaneoCamara === 'BUSQUEDA') {
                inputBusqueda.value = codigo;
                ejecutarBusquedaYFiltros();
                cerrarCamara();
            } else {
                procesarLecturaRafaga(codigo);
            }
        },
        () => {}
    ).catch(err => console.warn("[Lector QR] Error al iniciar cámara:", err));
});

function cerrarCamara() {
    antorchaEncendida = false;
    if (btnLinterna) {
        btnLinterna.classList.remove('activo');
        btnLinterna.innerText = '🔦 OFF';
    }
    if (html5QrCodeVisor && html5QrCodeVisor.isScanning) {
        html5QrCodeVisor.stop().then(() => {
            modalCamara.style.display = 'none';
        }).catch(() => {
            modalCamara.style.display = 'none';
        });
    } else {
        modalCamara.style.display = 'none';
    }
}
document.getElementById('btn-cerrar-camara').addEventListener('click', cerrarCamara);


// ==========================================
// 8. MULTI-SEDE DINÁMICA Y LOCAL-FIRST DELTAS (ZERO-READS)
// ==========================================
async function cargarSedesDinamicas() {
    if (!idNegocio || !selectSede) return;
    selectSede.disabled = !AuthGate._estado.contextoActivo?.esDueno;
    if (selectSede.disabled) {
        selectSede.replaceChildren(new Option(idSedeActiva === 'SALA_VENTAS' ? 'Sala de ventas' : idSedeActiva, idSedeActiva));
        return;
    }
    const claveSedesCache = 'geokatu_sedes_cache_' + idNegocio;
    const pintarOpcionesSedes = (listaSedes) => {
        selectSede.innerHTML = '';
        listaSedes.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id_sede;
            opt.innerText = (s.tipo === 'BODEGA' ? '[BODEGA] ' : '[SALA] ') + (s.nombre || s.id_sede);
            selectSede.appendChild(opt);
        });
        const existeActiva = listaSedes.some(s => s.id_sede === idSedeActiva);
        if (!existeActiva) selectSede.add(new Option(idSedeActiva, idSedeActiva));
        selectSede.value = idSedeActiva;
    };

    try {
        const cacheStr = localStorage.getItem(claveSedesCache);
        if (cacheStr) {
            const listaLocal = JSON.parse(cacheStr);
            if (Array.isArray(listaLocal) && listaLocal.length > 0) {
                pintarOpcionesSedes(listaLocal);
                if (!navigator.onLine) return;
            }
        }
        if (!navigator.onLine) return;
        const resSedes = await GeokatuDB.RadarService.obtenerSedesComercio(idNegocio);
        if (resSedes.success && resSedes.data.length > 0) {
            localStorage.setItem(claveSedesCache, JSON.stringify(resSedes.data));
            pintarOpcionesSedes(resSedes.data);
        }
    } catch (e) {
        console.warn("[GEOKATU SIG] Error cargando sedes dinamicas:", e);
    }
}
if (selectSede) {
    selectSede.addEventListener('change', async (e) => {
        if (!AuthGate._estado.contextoActivo?.esDueno) return;
        idSedeActiva = e.target.value;
        localStorage.setItem('geokatu_sede_activa_' + idNegocio, idSedeActiva);
        document.getElementById('inventario-ir-stock').href = enlaceStock();
        await hidratarVisor();
        ejecutarZoomExtents(false);
    });
}

// Reactividad en 0 ms entre pestañas locales (POS / Stock / Oficina -> Visor)
window.addEventListener('storage', (e) => {
    if (!idNegocio || !e.key) return;
    if (e.key === 'geokatu_catalogo_' + idNegocio && e.newValue) {
        try {
            catalogoTotal = JSON.parse(e.newValue);
            renderizarMueblesVisor();
        } catch (err) {}
    } else if (e.key === 'geokatu_stock_ubis_' + idNegocio && e.newValue) {
        try {
            stockPosicionalGlobal = JSON.parse(e.newValue);
            renderizarMueblesVisor();
        } catch (err) {}
    } else if (e.key === 'geokatu_plano_' + idNegocio + '_' + idSedeActiva && e.newValue) {
        try {
            const pData = JSON.parse(e.newValue);
            if (pData.perimetro) perimetro = pData.perimetro;
            if (Array.isArray(pData.elementos)) muebles = pData.elementos;
            if (Array.isArray(pData.muros)) celdasMurosBloqueadas = new Set(pData.muros);
            redibujarArea();
            renderizarMueblesVisor();
        } catch (err) {}
    }
});

async function hidratarVisor() {
    if (!idNegocio) return;
    const negocio = idNegocio;
    const sede = idSedeActiva;
    const sigueActivo = () => negocio === idNegocio && sede === idSedeActiva;
    const claveCachePlano = "geokatu_plano_" + idNegocio + "_" + idSedeActiva;
    const claveCacheStockUbis = "geokatu_stock_ubis_" + idNegocio;
    const claveSyncTimestamp = "geokatu_sync_ubis_time_" + idNegocio;

    // Paso 1: Carga fria en 0 ms desde cache local (Cero lecturas de red)
    const cachePlano = localStorage.getItem(claveCachePlano);
    const cacheUbis = localStorage.getItem(claveCacheStockUbis);
    let modPlanoLocal = null;

    if (cachePlano) {
        try {
            const planoData = JSON.parse(cachePlano);
            modPlanoLocal = planoData.ultima_modificacion || null;
            if (planoData.perimetro) perimetro = planoData.perimetro;
            if (Array.isArray(planoData.elementos)) muebles = planoData.elementos;
            if (Array.isArray(planoData.muros)) celdasMurosBloqueadas = new Set(planoData.muros);
        } catch (eP) {}
    } else {
        perimetro = { anchoM: 12, largoM: 18 };
        muebles = [];
        celdasMurosBloqueadas = new Set();
    }
    stockPosicionalGlobal = [];
    if (cacheUbis) {
        try { stockPosicionalGlobal = JSON.parse(cacheUbis); } catch (eU) { stockPosicionalGlobal = []; }
    }
    catalogoTotal = GeokatuDB.PosService.cargarCatalogoDesdeCache(idNegocio);
    poblarFiltros();
    redibujarArea();
    renderizarMueblesVisor();
    actualizarTransform();

    if (!navigator.onLine) return;

    // Paso 2: Hidratacion estrictamente por deltas en segundo plano
    try {
        const resPlano = await GeokatuDB.RadarService.obtenerMapaBodega(negocio, sede, { revalidarMs: 300000 });
        if (!sigueActivo()) return;
        if (resPlano.success && resPlano.data) {
            const modRemota = resPlano.data.ultima_modificacion || null;
            if (!cachePlano || (modRemota && modRemota !== modPlanoLocal)) {
                localStorage.setItem(claveCachePlano, JSON.stringify(resPlano.data));
                if (resPlano.data.perimetro) perimetro = resPlano.data.perimetro;
                if (Array.isArray(resPlano.data.elementos)) muebles = resPlano.data.elementos;
                if (Array.isArray(resPlano.data.muros)) celdasMurosBloqueadas = new Set(resPlano.data.muros);
                redibujarArea();
                renderizarMueblesVisor();
            }
        }

        // Sincronizar unicamente deltas del catalogo (fecha_actualizacion > ultimoSync)
        const resCat = await GeokatuDB.PosService.descargarCatalogoLocal(negocio, false);
        if (!sigueActivo()) return;
        if (resCat.success) {
            catalogoTotal = resCat.data;
            if (!resCat.esDelta || (resCat.deltasLeidos && resCat.deltasLeidos > 0)) {
                poblarFiltros();
                renderizarMueblesVisor();
            }
        }

        // Sincronizar unicamente deltas de ubicaciones (ultima_modificacion > ultimoSync)
        const ultimoSync = cacheUbis ? localStorage.getItem(claveSyncTimestamp) : null;
        const resUbis = await GeokatuDB.InventarioService.obtenerMapaStockTiendaCompleto(negocio, ultimoSync);
        if (!sigueActivo()) return;
        if (resUbis.success) {
            if (resUbis.esDelta && resUbis.data.length > 0) {
                resUbis.data.forEach(delta => {
                    const idx = stockPosicionalGlobal.findIndex(s =>
                        s.id_prod === delta.id_prod && s.id_compartimiento === delta.id_compartimiento
                    );
                    if (idx !== -1) {
                        stockPosicionalGlobal[idx] = delta;
                    } else {
                        stockPosicionalGlobal.push(delta);
                    }
                });
                console.log("[GEOKATU SIG] " + resUbis.data.length + " deltas de stock sincronizados."); 
            } else if (!resUbis.esDelta) {
                stockPosicionalGlobal = resUbis.data;
            }
            localStorage.setItem(claveCacheStockUbis, JSON.stringify(stockPosicionalGlobal));
            localStorage.setItem(claveSyncTimestamp, resUbis.timestampCorte);
            if (resUbis.data.length > 0 || !resUbis.esDelta) {
                renderizarMueblesVisor();
            }
        }
    } catch (err) {
        console.warn("[GEOKATU SIG] Error en sincronizacion delta:", err);
    }
}


// ==========================================
// 9. CONTROL DE SESIÓN Y RADAR OPERATIVO CON AUTH-GATE
// ==========================================
AuthGate.inicializar({
    tituloModulo: 'Radar de Inventario SIG',
    subtituloModulo: 'Visor de Piso y Ubicacion Espacial de Stock',
    minutosInactividad: 20,
    onSesionLista: async function(contexto) {
        idNegocio = contexto.idNegocio;
        const parametros = new URLSearchParams(location.search);
        idSedeActiva = contexto.esDueno ? (parametros.get('sede') || localStorage.getItem('geokatu_sede_activa_' + idNegocio) || contexto.almacen) : contexto.almacen;
        idSedeActiva ||= 'SALA_VENTAS';
        document.getElementById('inventario-ir-stock').href = enlaceStock();
        rolUsuarioActivo = contexto.rol || 'cajero';

        localStorage.setItem('geokatu_active_uid', contexto.idNegocio);
        localStorage.setItem('geokatu_sede_activa', idSedeActiva);

        // Sellado criptografico de la terminal
        await GeokatuDB.SecurityService.sellarSesionTerminalLocal(contexto.idNegocio);
        GeokatuDB.sincronizarPendientesOperativos(contexto.idNegocio).catch(error => console.warn('[Sincronización pendiente]', error.message));

        // Regla RBAC: Boton "Editar Plano SIG" solo para roles arquitectos
        var rolesConEdicion = ['owner', 'dueño', 'supervisor', 'administrador_delegado', 'visual_merchandising', 'admin', 'superadmin'];
        var btnEditor = document.getElementById('btn-ir-editor');
        if (btnEditor) {
            btnEditor.style.display = rolesConEdicion.includes(rolUsuarioActivo) ? 'inline-block' : 'none';
            btnEditor.onclick = () => { location.href = 'mapatienda?sede=' + encodeURIComponent(idSedeActiva); };
        }

        await cargarSedesDinamicas();
        await hidratarVisor();
        ejecutarZoomExtents(false);
        var paramsInv = new URLSearchParams(window.location.search);
        var skuBuscar = paramsInv.get('buscar');
        if (skuBuscar && inputBusqueda) {
            inputBusqueda.value = skuBuscar;
            setTimeout(function() { ejecutarBusquedaYFiltros(); }, 250);
        }


        // Iniciar explicación del visor de piso y radar
        if (window.GeokatuTour && typeof window.GeokatuTour.iniciar === 'function') {
            setTimeout(function() {
                window.GeokatuTour.iniciar('inventario');
            }, 900);
        }
    },

    onCerrarSesion: async function() {
        if (typeof cerrarCamara === 'function') {
            cerrarCamara();
        }
        detenerAnimacionRuta();
        idNegocio = null;
        muebles = [];
        catalogoTotal = [];
        stockPosicionalGlobal = [];
        contenedorMuebles.innerHTML = '';
        if (drawer) drawer.classList.remove('visible');
        if (widgetAlzado) widgetAlzado.classList.add('oculto');
    }
});

// Listener del boton salir en la barra superior
var btnLogoutVisor = document.getElementById('btn-logout-visor');
if (btnLogoutVisor) {
    btnLogoutVisor.addEventListener('click', async function(e) {
        e.stopPropagation();
        if (typeof cerrarCamara === 'function') cerrarCamara();
        await AuthGate.cerrarSesion();
    });
}



