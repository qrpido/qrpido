/**
 * ============================================================================
 * GEOKATU | OFICINA INMOBILIARIA (public/inmobiliaria.js)
 * Motor Lógico Modular Unificado (Cero Emojis · Cero Alert Nativo · Offline-First)
 * ============================================================================
 */

import GeokatuDB from './core-db.js';
import { BillingGuard } from './billing-guard.js';
import { AuthGate } from './auth-gate.js';
import './estudio-imagen-universal.js';
import {
    getFirestore,
    doc,
    setDoc
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const db = getFirestore();

if (typeof pmtiles !== 'undefined' && typeof maplibregl !== 'undefined') {
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
}

const CIUDADES_LOCALES = [
    { nombre: 'Pereira, Colombia', lat: 4.8133, lng: -75.6961 },
    { nombre: 'Dosquebradas, Colombia', lat: 4.8365, lng: -75.6725 },
    { nombre: 'Bogotá, Colombia', lat: 4.6097, lng: -74.0817 },
    { nombre: 'Medellín, Colombia', lat: 6.2476, lng: -75.5658 },
    { nombre: 'Cali, Colombia', lat: 3.4516, lng: -76.5320 },
    { nombre: 'Armenia, Colombia', lat: 4.5339, lng: -75.6811 },
    { nombre: 'Manizales, Colombia', lat: 5.0689, lng: -75.5174 },
    { nombre: 'Barranquilla, Colombia', lat: 10.9685, lng: -74.7813 },
    { nombre: 'Caracas, Venezuela', lat: 10.4806, lng: -66.9036 },
    { nombre: 'San Cristóbal, Venezuela', lat: 7.7794, lng: -72.2247 }
];

const IMG_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Crect width='120' height='120' fill='%23121218'/%3E%3Ctext x='60' y='65' fill='%23ff6b00' font-family='sans-serif' font-size='12' font-weight='900' text-anchor='middle'%3ESIN FOTO%3C/text%3E%3C/svg%3E";
const CLAVE_BORRADOR_INMO = 'geokatu_inmobiliaria_draft';

let idAgencia = null;
let datosAgencia = {};
let listaInmuebles = [];
let blobPortadaPendiente = null;
let blobsGaleriaPendiente = [];
let mapaProp = null;
let markerProp = null;
let mapaAgencia = null;
let markerAgencia = null;
let resolverConfirmacion = null;
let timerToast = null;

// ============================================================================
// 1. UTILIDADES DE INTERFAZ Y GEOHASH NATIVO
// ============================================================================
function mostrarToast(msg) {
    const el = document.getElementById('toast-inmo');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(timerToast);
    timerToast = setTimeout(() => el.classList.remove('visible'), 2800);
}

function confirmarInapp(titulo, texto) {
    return new Promise((resolve) => {
        resolverConfirmacion = resolve;
        const titEl = document.getElementById('confirm-inmo-titulo');
        const txtEl = document.getElementById('confirm-inmo-texto');
        if (titEl) titEl.textContent = titulo;
        if (txtEl) txtEl.textContent = texto;
        const m = document.getElementById('modal-confirm-inmo');
        if (m) {
            m.style.display = 'flex';
            m.classList.add('activo');
        } else {
            resolve(false);
        }
    });
}

window.responderConfirmacionInmo = function(aceptado) {
    const m = document.getElementById('modal-confirm-inmo');
    if (m) {
        m.classList.remove('activo');
        m.style.display = 'none';
    }
    if (typeof resolverConfirmacion === 'function') {
        const fn = resolverConfirmacion;
        resolverConfirmacion = null;
        fn(Boolean(aceptado));
    }
};

function sanitizar(v) {
    const d = document.createElement('div');
    d.textContent = String(v === undefined || v === null ? '' : v);
    return d.innerHTML;
}

function generarGeohash(lat, lng, precision = 9) {
    const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
    const latR = [-90.0, 90.0];
    const lngR = [-180.0, 180.0];
    let hash = '';
    let par = true;
    let bit = 0;
    let ch = 0;
    while (hash.length < precision) {
        if (par) {
            const mid = (lngR[0] + lngR[1]) / 2;
            if (lng >= mid) {
                ch |= (1 << (4 - bit));
                lngR[0] = mid;
            } else {
                lngR[1] = mid;
            }
        } else {
            const mid = (latR[0] + latR[1]) / 2;
            if (lat >= mid) {
                ch |= (1 << (4 - bit));
                latR[0] = mid;
            } else {
                latR[1] = mid;
            }
        }
        par = !par;
        if (bit < 4) {
            bit++;
        } else {
            hash += BASE32[ch];
            bit = 0;
            ch = 0;
        }
    }
    return hash;
}

function resolverUbicacionLocal(texto) {
    const q = String(texto || '').trim();
    if (!q) return null;
    const match = q.match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
    const low = q.toLowerCase();
    return CIUDADES_LOCALES.find(c => c.nombre.toLowerCase().includes(low)) || null;
}

function crearPinDomNaranja() {
    const el = document.createElement('div');
    el.style.cssText = 'width:34px; height:34px; border-radius:50% 50% 50% 0; transform:rotate(-45deg); background:#ff6b00; border:2.5px solid #ffffff; box-shadow:0 4px 12px rgba(0,0,0,0.65); cursor:grab;';
    return el;
}

function comprimirImagenWebP(file, maxWidth = 1080, quality = 0.82) {
    return new Promise((resolve) => {
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let w = img.width;
                let h = img.height;
                if (w > maxWidth) {
                    h = Math.round((h * maxWidth) / w);
                    w = maxWidth;
                }
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                canvas.toBlob((blob) => resolve(blob || file), 'image/webp', quality);
            };
            img.onerror = () => resolve(file);
            img.src = e.target.result;
        };
        reader.onerror = () => resolve(file);
        reader.readAsDataURL(file);
    });
}

// ============================================================================
// 2. AUTENTICACIÓN Y SESIÓN MEDIANTE AUTH-GATE
// ============================================================================
AuthGate.inicializar({
    tituloModulo: 'Oficina Inmobiliaria',
    subtituloModulo: 'Gestión de portafolio, radar y contratos digitales',
    permitirPinDirecto: true,
    onSesionLista: async function(contexto) {
        idAgencia = contexto.idNegocio;
        await GeokatuDB.SecurityService.sellarSesionTerminalLocal(idAgencia);
        const uidEl = document.getElementById('inmo-uid-badge');
        if (uidEl) uidEl.textContent = 'ID: ' + String(idAgencia).slice(0, 8) + '...';
        const dash = document.getElementById('dashboard-screen');
        if (dash) dash.style.display = 'flex';
        await inicializarOficinaInmobiliaria(contexto);
    },
    onCerrarSesion: function() {
        idAgencia = null;
        datosAgencia = {};
        listaInmuebles = [];
        const dash = document.getElementById('dashboard-screen');
        if (dash) dash.style.display = 'none';
    }
});

window.cerrarSesionInmobiliaria = async function() {
    const ok = await confirmarInapp('Cerrar sesión', '¿Deseas salir de la Oficina Inmobiliaria?');
    if (ok) await AuthGate.cerrarSesion();
};

async function inicializarOficinaInmobiliaria(contexto) {
    try {
        const resNeg = await GeokatuDB.AdminService.obtenerNegocioPorUsuario(idAgencia, contexto.email || '', 'admin');
        if (resNeg?.success && resNeg.data) {
            datosAgencia = resNeg.data;
        } else {
            datosAgencia = {
                nombre: 'Mi Agencia Inmobiliaria',
                tipo_modelo: 'inmueble',
                categoria_maestra: 'inmueble'
            };
        }

        if (BillingGuard && typeof BillingGuard.verificarEstadoCuota === 'function') {
            BillingGuard.verificarEstadoCuota(datosAgencia.facturacion_control, 'billing-alert-container');
        }

        hidratarCabeceraYCuenta();
        await cargarPortafolioInmuebles();
    } catch (e) {
        mostrarToast('Operando con datos en caché local.');
    }
}

function hidratarCabeceraYCuenta() {
    const nomHeader = document.getElementById('ui-nombre-inmo');
    if (nomHeader) nomHeader.textContent = datosAgencia.nombre || 'OFICINA INMOBILIARIA';

    const logoEl = document.getElementById('ui-logo-inmo');
    if (logoEl && datosAgencia.logo) {
        logoEl.src = datosAgencia.logo;
        logoEl.style.display = 'block';
    }

    const setV = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val || '';
    };
    setV('ag-nombre', datosAgencia.nombre);
    setV('ag-slogan', datosAgencia.slogan);
    setV('ag-nicho', datosAgencia.nicho || datosAgencia.niche || 'Inmobiliaria General');
    setV('ag-whatsapp', datosAgencia.whatsapp || datosAgencia.whatsApp);
    setV('ag-pbx', datosAgencia.pbx);
    setV('ag-username', datosAgencia.username);
    setV('ag-pin', /^\d{4}$/.test(String(datosAgencia.pin_titular || '')) ? datosAgencia.pin_titular : '0000');
}

// ============================================================================
// 3. NAVEGACIÓN DE PESTAÑAS
// ============================================================================
window.cambiarTabInmo = function(tabId) {
    if (navigator.vibrate) navigator.vibrate(20);
    document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.remove('activo');
        el.style.display = 'none';
    });
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('activo', btn.getAttribute('data-tab') === tabId);
    });
    const target = document.getElementById('content-' + tabId);
    if (target) {
        target.style.display = 'block';
        target.classList.add('activo');
    }
    if (tabId === 'cuenta') {
        const lat = Number(datosAgencia.Coordenadas?.latitude ?? datosAgencia.lat ?? 4.8133);
        const lng = Number(datosAgencia.Coordenadas?.longitude ?? datosAgencia.lng ?? -75.6961);
        setTimeout(() => inicializarMapaAgencia(lat, lng), 120);
    } else if (tabId === 'contratos') {
        renderizarTabContratos();
    }
};

// ============================================================================
// 4. PORTAFOLIO, MÉTRICAS Y ALERTAS DE VENCIMIENTO
// ============================================================================
async function cargarPortafolioInmuebles() {
    if (!idAgencia) return;
    const claveCache = 'geokatu_inmuebles_cache_' + idAgencia;
    try {
        const local = JSON.parse(localStorage.getItem(claveCache) || '[]');
        if (Array.isArray(local) && local.length) {
            listaInmuebles = local;
            actualizarKPIs();
            window.filtrarPortafolio();
        }
    } catch (e) {}

    if (navigator.onLine) {
        const res = await GeokatuDB.AdminService.obtenerProductos(idAgencia, { limite: 100 });
        if (res?.success && Array.isArray(res.data)) {
            listaInmuebles = res.data.filter(p => !p.eliminado);
            localStorage.setItem(claveCache, JSON.stringify(listaInmuebles));
        }
    }
    actualizarKPIs();
    window.filtrarPortafolio();
    renderizarTabContratos();
}

function actualizarKPIs() {
    const total = listaInmuebles.length;
    const disp = listaInmuebles.filter(p => (p.estado_inmueble || (p.agotado ? 'arrendado_vendido' : 'disponible')) === 'disponible').length;
    const ocup = total - disp;
    const conContrato = listaInmuebles.filter(p => Boolean(p.sala_tramite || p.contrato_activo_id)).length;

    const setTxt = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(v);
    };
    setTxt('kpi-total-inm', total);
    setTxt('kpi-disp-inm', disp);
    setTxt('kpi-ocup-inm', ocup);
    setTxt('kpi-contratos-inm', conContrato);

    const hoy = Date.now();
    const proximos = listaInmuebles.filter(p => {
        if (!p.fecha_fin_contrato) return false;
        const diffDias = Math.ceil((new Date(p.fecha_fin_contrato).getTime() - hoy) / 86400000);
        return diffDias >= -5 && diffDias <= 30;
    });

    const boxVenc = document.getElementById('lista-vencimientos-inmo');
    if (!boxVenc) return;
    if (proximos.length === 0) {
        boxVenc.textContent = 'Sin vencimientos en los próximos 30 días.';
    } else {
        boxVenc.innerHTML = proximos.map(p => {
            const d = Math.ceil((new Date(p.fecha_fin_contrato).getTime() - hoy) / 86400000);
            const txtD = d <= 0 ? 'Vencido' : ('Vence en ' + d + ' días');
            const col = d <= 7 ? '#ff6b6b' : '#facc15';
            return '<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.06);">' +
                '<strong style="color:#ffffff; font-size:12px;">' + sanitizar(p.nombre) + '</strong>' +
                '<span style="color:' + col + '; font-family:monospace; font-weight:800; font-size:11px;">' + txtD + '</span>' +
            '</div>';
        }).join('');
    }
}

window.filtrarPortafolio = function() {
    const cont = document.getElementById('lista-inmuebles-container');
    if (!cont) return;
    const q = (document.getElementById('filtro-inmo-texto')?.value || '').trim().toLowerCase();
    const fOp = document.getElementById('filtro-inmo-op')?.value || '';
    const fEst = document.getElementById('filtro-inmo-estado')?.value || '';

    const filtrados = listaInmuebles.filter(p => {
        const op = String(p.tipo_operacion || p.tipo || 'arriendo').toLowerCase();
        const est = String(p.estado_inmueble || (p.agotado ? 'arrendado_vendido' : 'disponible'));
        if (fOp && op !== fOp) return false;
        if (fEst && est !== fEst) return false;
        if (q) {
            const bolsa = ((p.nombre || '') + ' ' + (p.barrio || '') + ' ' + (p.direccion || '') + ' ' + (p.subtipo_inmueble || '')).toLowerCase();
            if (!bolsa.includes(q)) return false;
        }
        return true;
    });

    if (filtrados.length === 0) {
        cont.innerHTML = '<div class="panel-operaciones-bloque" style="text-align:center; color:#9ca3af; font-size:12px;">No hay inmuebles registrados bajo este criterio.</div>';
        return;
    }

    const estilosEst = {
        disponible: { txt: 'Disponible', col: '#00ff64', bg: 'rgba(0,255,100,0.12)' },
        en_estudio: { txt: 'En estudio', col: '#facc15', bg: 'rgba(250,204,21,0.14)' },
        arrendado_vendido: { txt: 'Cerrado', col: '#ff6b6b', bg: 'rgba(255,68,68,0.14)' }
    };

    cont.innerHTML = filtrados.map(p => {
        const id = p.id_prod || p.id;
        const est = p.estado_inmueble || (p.agotado ? 'arrendado_vendido' : 'disponible');
        const infoE = estilosEst[est] || estilosEst.disponible;
        const img = p.foto_portada || p.imagen || IMG_PLACEHOLDER;
        const opTxt = String(p.tipo_operacion || p.tipo || 'arriendo').toUpperCase();
        const subTxt = p.subtipo_inmueble || p.categoria || 'Inmueble';
        const habTxt = p.habitaciones ? (p.habitaciones + ' hab · ') : '';
        const areaTxt = p.area_m2 ? (p.area_m2 + ' m²') : '';
        const tieneSala = Boolean(p.sala_tramite || p.contrato_activo_id);

        return '<article class="prop-card-inmo">' +
            '<div class="prop-card-top">' +
                '<img class="prop-card-thumb" src="' + img + '" alt="' + sanitizar(p.nombre) + '">' +
                '<div class="prop-card-meta">' +
                    '<h4>' + sanitizar(p.nombre) + '</h4>' +
                    '<span class="prop-card-sub">' + opTxt + ' · ' + sanitizar(subTxt) + ' · ' + habTxt + areaTxt + '</span>' +
                    '<div class="prop-card-precio-row">' +
                        '<span class="prop-card-precio">$' + Number(p.precio || 0).toLocaleString('es-CO') + '</span>' +
                        '<span class="pill-estado-inmo" style="color:' + infoE.col + '; background:' + infoE.bg + ';">' + infoE.txt + '</span>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="prop-card-acciones">' +
                '<button type="button" class="btn-card-mini" onclick="window.editarInmueble(\'' + id + '\')">Editar</button>' +
                '<button type="button" class="btn-card-mini qr" onclick="window.abrirCartelQR(\'' + id + '\')">Cartel QR</button>' +
                '<button type="button" class="btn-card-mini legal" onclick="window.abrirContratoTramite(\'' + id + '\')">' + (tieneSala ? 'Ver Sala' : 'Contrato') + '</button>' +
                '<button type="button" class="btn-card-mini borrar" onclick="window.solicitarEliminarInmueble(\'' + id + '\')">Borrar</button>' +
            '</div>' +
        '</article>';
    }).join('');
};

// ============================================================================
// 5. CONTRATOS Y CONEXIÓN CON NOTARÍA DIGITAL (/tramites)
// ============================================================================
function renderizarTabContratos() {
    const cont = document.getElementById('lista-contratos-inmo');
    if (!cont) return;
    if (listaInmuebles.length === 0) {
        cont.innerHTML = '<div class="panel-operaciones-bloque" style="text-align:center; color:#9ca3af; font-size:12px;">Publica al menos un inmueble para emitir o vincular contratos digitales.</div>';
        return;
    }

    const etiquetasContrato = {
        arriendo_vivienda_ley820: 'Arriendo Vivienda (Ley 820)',
        arriendo_comercial: 'Arriendo Comercial',
        temporada_dias: 'Estadía Corta / Días',
        promesa_compraventa: 'Promesa de Compraventa'
    };

    cont.innerHTML = listaInmuebles.map(p => {
        const id = p.id_prod || p.id;
        const sala = p.sala_tramite || p.contrato_activo_id || '';
        const tipoLbl = etiquetasContrato[p.tipo_contrato] || 'Contrato Digital';
        return '<div class="contrato-row-card">' +
            '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">' +
                '<strong style="color:#ffffff; font-size:13px;">' + sanitizar(p.nombre) + '</strong>' +
                '<span style="font-size:10px; font-family:monospace; color:' + (sala ? '#00ff64' : '#9ca3af') + '; font-weight:800;">' + (sala ? ('ACTIVO #' + sanitizar(sala)) : 'SIN SALA ACTIVA') + '</span>' +
            '</div>' +
            '<span style="font-size:11px; color:#9ca3af;">' + sanitizar(tipoLbl) + (p.fecha_fin_contrato ? (' · Vence: ' + p.fecha_fin_contrato) : '') + '</span>' +
            '<div style="display:flex; gap:6px;">' +
                '<input type="text" id="sala-inp-' + id + '" class="input-form" value="' + sanitizar(sala) + '" placeholder="Código de sala o documento activo" style="margin:0; flex:1; padding:7px 10px; font-size:11.5px;">' +
                '<button type="button" class="btn-card-mini" style="padding:0 10px;" onclick="window.guardarSalaContratoInmueble(\'' + id + '\')">Vincular</button>' +
                '<button type="button" class="btn-card-mini legal" style="padding:0 12px;" onclick="window.abrirContratoTramite(\'' + id + '\')">' + (sala ? 'Abrir Documento' : 'Forjar') + '</button>' +
            '</div>' +
        '</div>';
    }).join('');
}

window.guardarSalaContratoInmueble = async function(id) {
    const val = (document.getElementById('sala-inp-' + id)?.value || '').trim();
    const res = await GeokatuDB.AdminService.actualizarProducto(idAgencia, id, {
        sala_tramite: val,
        contrato_activo_id: val
    });
    if (res?.success) {
        const item = listaInmuebles.find(x => (x.id_prod || x.id) === id);
        if (item) {
            item.sala_tramite = val;
            item.contrato_activo_id = val;
        }
        localStorage.setItem('geokatu_inmuebles_cache_' + idAgencia, JSON.stringify(listaInmuebles));
        actualizarKPIs();
        window.filtrarPortafolio();
        renderizarTabContratos();
        mostrarToast(val ? 'Documento activo vinculado.' : 'Vínculo de documento eliminado.');
    } else {
        mostrarToast('No se pudo guardar el vínculo.');
    }
};

window.abrirContratoTramite = function(id) {
    const p = listaInmuebles.find(x => (x.id_prod || x.id) === id);
    if (!p) return;
    const salaActiva = (p.sala_tramite || p.contrato_activo_id || '').trim();
    if (salaActiva) {
        const qSala = new URLSearchParams({ sala: salaActiva, inmueble: id });
        window.location.href = '/tramites?' + qSala.toString();
        return;
    }
    const op = String(p.tipo_operacion || 'arriendo').toLowerCase();
    const q = new URLSearchParams({
        plantilla: op === 'venta' ? 'mandato' : 'arrendamiento',
        inmueble: id,
        agencia: idAgencia,
        titulo: p.nombre || '',
        direccion: p.direccion || p.barrio || '',
        valor: String(p.precio || ''),
        operacion: op,
        contrato: p.tipo_contrato || 'arriendo_vivienda_ley820'
    });
    window.location.href = '/tramites?' + q.toString();
};

// ============================================================================
// 6. FORMULARIO BOTTOM-SHEET, BORRADOR EN RAM Y MAPA DE PROPIEDAD
// ============================================================================
window.actualizarCamposPorSubtipo = function() {
    const sub = document.getElementById('inm-subtipo')?.value || 'apartamento';
    const esTierra = sub === 'lote';
    const esComercial = ['local', 'oficina', 'bodega'].includes(sub);
    const wHab = document.getElementById('campo-hab-wrap');
    const wBan = document.getElementById('campo-banos-wrap');
    if (wHab) wHab.style.display = (esTierra || esComercial) ? 'none' : 'block';
    if (wBan) wBan.style.display = esTierra ? 'none' : 'block';
};

function guardarBorradorInmueble() {
    const editId = document.getElementById('inm-edit-id')?.value || '';
    if (editId) return;
    const draft = {
        nombre: document.getElementById('inm-nombre')?.value || '',
        operacion: document.getElementById('inm-operacion')?.value || 'arriendo',
        subtipo: document.getElementById('inm-subtipo')?.value || 'apartamento',
        precio: document.getElementById('inm-precio')?.value || '',
        admin: document.getElementById('inm-admin')?.value || '',
        adminInc: Boolean(document.getElementById('inm-admin-incluida')?.checked),
        area: document.getElementById('inm-area')?.value || '',
        hab: document.getElementById('inm-hab')?.value || '',
        banos: document.getElementById('inm-banos')?.value || '',
        estrato: document.getElementById('inm-estrato')?.value || '',
        parq: document.getElementById('inm-parq')?.value || '',
        barrio: document.getElementById('inm-barrio')?.value || '',
        direccion: document.getElementById('inm-direccion')?.value || '',
        contrato: document.getElementById('inm-tipo-contrato')?.value || 'arriendo_vivienda_ley820',
        descripcion: document.getElementById('inm-descripcion')?.value || ''
    };
    sessionStorage.setItem(CLAVE_BORRADOR_INMO, JSON.stringify(draft));
}

function restaurarBorradorInmueble() {
    const raw = sessionStorage.getItem(CLAVE_BORRADOR_INMO);
    if (!raw) return;
    try {
        const d = JSON.parse(raw);
        if (!d) return;
        const setV = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined) el.value = v; };
        setV('inm-nombre', d.nombre);
        setV('inm-operacion', d.operacion);
        setV('inm-subtipo', d.subtipo);
        setV('inm-precio', d.precio);
        setV('inm-admin', d.admin);
        const chk = document.getElementById('inm-admin-incluida');
        if (chk) chk.checked = Boolean(d.adminInc);
        setV('inm-area', d.area);
        setV('inm-hab', d.hab);
        setV('inm-banos', d.banos);
        setV('inm-estrato', d.estrato);
        setV('inm-parq', d.parq);
        setV('inm-barrio', d.barrio);
        setV('inm-direccion', d.direccion);
        setV('inm-tipo-contrato', d.contrato);
        setV('inm-descripcion', d.descripcion);
    } catch (e) {}
}

document.addEventListener('input', (e) => {
    if (e.target && e.target.closest('#bottom-sheet-inmueble')) {
        guardarBorradorInmueble();
    }
});

function inicializarMapaPropiedad(lat, lng) {
    const latN = Number(lat) || 4.8133;
    const lngN = Number(lng) || -75.6961;
    if (!mapaProp) {
        mapaProp = new maplibregl.Map({
            container: 'mini-mapa-inmueble',
            style: './estilo-fresco.json',
            center: [lngN, latN],
            zoom: 16,
            attributionControl: false
        });
        markerProp = new maplibregl.Marker({ element: crearPinDomNaranja(), draggable: true, anchor: 'bottom' })
            .setLngLat([lngN, latN])
            .addTo(mapaProp);
        markerProp.on('dragend', () => {
            const c = markerProp.getLngLat();
            document.getElementById('inm-lat').value = c.lat;
            document.getElementById('inm-lng').value = c.lng;
        });
        mapaProp.on('click', (e) => {
            markerProp.setLngLat(e.lngLat);
            document.getElementById('inm-lat').value = e.lngLat.lat;
            document.getElementById('inm-lng').value = e.lngLat.lng;
        });
    } else {
        mapaProp.setCenter([lngN, latN]);
        markerProp.setLngLat([lngN, latN]);
        setTimeout(() => mapaProp.resize(), 180);
    }
    document.getElementById('inm-lat').value = latN;
    document.getElementById('inm-lng').value = lngN;
}

window.buscarEnMapaInmo = function() {
    const val = document.getElementById('inm-buscador-mapa')?.value || '';
    const dst = resolverUbicacionLocal(val);
    if (!dst || !mapaProp || !markerProp) {
        mostrarToast('Toca directamente sobre el mapa o usa el botón GPS.');
        return;
    }
    mapaProp.flyTo({ center: [dst.lng, dst.lat], zoom: 16, duration: 900 });
    markerProp.setLngLat([dst.lng, dst.lat]);
    document.getElementById('inm-lat').value = dst.lat;
    document.getElementById('inm-lng').value = dst.lng;
};

window.ubicarGpsPropiedad = function() {
    if (!navigator.geolocation) return mostrarToast('GPS no disponible en este dispositivo.');
    navigator.geolocation.getCurrentPosition((pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (mapaProp && markerProp) {
            mapaProp.flyTo({ center: [lng, lat], zoom: 17, duration: 900 });
            markerProp.setLngLat([lng, lat]);
        }
        document.getElementById('inm-lat').value = lat;
        document.getElementById('inm-lng').value = lng;
        mostrarToast('Ubicación GPS fijada.');
    }, () => mostrarToast('Habilita los permisos de ubicación en el navegador.'), { enableHighAccuracy: true });
};

window.abrirSheetInmueble = function(propEditar) {
    blobPortadaPendiente = null;
    blobsGaleriaPendiente = [];
    document.getElementById('inm-file-portada').value = '';
    document.getElementById('inm-file-galeria').value = '';
    document.getElementById('btn-portada-inmo-txt').textContent = 'Foto Fachada';
    document.getElementById('btn-galeria-inmo-txt').textContent = 'Galería Extra (Hasta 8)';

    const p = propEditar || {};
    document.getElementById('sheet-inmo-titulo').textContent = propEditar ? 'Editar Inmueble' : 'Nuevo Inmueble';
    document.getElementById('inm-edit-id').value = p.id_prod || p.id || '';
    document.getElementById('inm-foto-actual').value = p.foto_portada || p.imagen || '';
    document.getElementById('inm-galeria-actual').value = JSON.stringify(
        Array.isArray(p.galeria) ? p.galeria : (Array.isArray(p.galeria_extra) ? p.galeria_extra : [])
    );
    document.getElementById('inm-nombre').value = p.nombre || '';
    document.getElementById('inm-operacion').value = p.tipo_operacion || p.tipo || 'arriendo';
    document.getElementById('inm-subtipo').value = p.subtipo_inmueble || 'apartamento';
    document.getElementById('inm-precio').value = p.precio || '';
    document.getElementById('inm-admin').value = p.administracion || '';
    document.getElementById('inm-admin-incluida').checked = Boolean(p.admin_incluida);
    document.getElementById('inm-area').value = p.area_m2 || '';
    document.getElementById('inm-hab').value = p.habitaciones || '';
    document.getElementById('inm-banos').value = p.banos || '';
    document.getElementById('inm-estrato').value = String(p.estrato || '').replace(/^e/i, '');
    document.getElementById('inm-parq').value = p.parqueaderos || '';
    document.getElementById('inm-estado').value = p.estado_inmueble || (p.agotado ? 'arrendado_vendido' : 'disponible');
    document.getElementById('inm-barrio').value = p.barrio || p.categoria || '';
    document.getElementById('inm-direccion').value = p.direccion || '';
    document.getElementById('inm-tipo-contrato').value = p.tipo_contrato || 'arriendo_vivienda_ley820';
    document.getElementById('inm-fin-contrato').value = p.fecha_fin_contrato || '';
    document.getElementById('inm-sala-tramite').value = p.sala_tramite || p.contrato_activo_id || '';
    document.getElementById('inm-descripcion').value = p.cuerpo_texto || p.cuerpo_articulo || '';

    if (!propEditar) {
        restaurarBorradorInmueble();
    }

    window.actualizarCamposPorSubtipo();
    document.getElementById('overlay-inmueble').style.display = 'block';
    document.getElementById('bottom-sheet-inmueble').classList.add('activo');

    const lat = Number(p.Coordenadas?.latitude ?? p.lat ?? datosAgencia.Coordenadas?.latitude ?? 4.8133);
    const lng = Number(p.Coordenadas?.longitude ?? p.lng ?? datosAgencia.Coordenadas?.longitude ?? -75.6961);
    setTimeout(() => inicializarMapaPropiedad(lat, lng), 220);
};

window.cerrarSheetInmueble = function() {
    document.getElementById('bottom-sheet-inmueble').classList.remove('activo');
    document.getElementById('overlay-inmueble').style.display = 'none';
};

window.editarInmueble = function(id) {
    const p = listaInmuebles.find(x => (x.id_prod || x.id) === id);
    if (p) window.abrirSheetInmueble(p);
};

window.manejarFotoPortadaInmo = async function(input) {
    if (!input.files || !input.files[0]) return;
    if (window.GeokatuEstudio && typeof window.GeokatuEstudio.editarImagen === 'function') {
        const ed = await window.GeokatuEstudio.editarImagen(input.files[0], {
            maxAncho: 1200,
            maxAlto: 900,
            calidad: 0.84,
            titulo: 'Editar Foto Principal del Inmueble'
        });
        if (!ed) {
            input.value = '';
            return;
        }
        blobPortadaPendiente = ed.blob;
    } else {
        blobPortadaPendiente = await comprimirImagenWebP(input.files[0], 1200, 0.84);
    }
    document.getElementById('btn-portada-inmo-txt').textContent = 'Fachada lista';
};

window.manejarGaleriaInmo = function(input) {
    if (!input.files || !input.files.length) return;
    const arr = Array.from(input.files).slice(0, 8);
    blobsGaleriaPendiente = arr;
    document.getElementById('btn-galeria-inmo-txt').textContent = arr.length + ' foto(s) lista(s)';
};

window.guardarInmueble = async function() {
    const nombre = document.getElementById('inm-nombre').value.trim();
    const precio = Math.round(Number(document.getElementById('inm-precio').value) || 0);
    const lat = parseFloat(document.getElementById('inm-lat').value);
    const lng = parseFloat(document.getElementById('inm-lng').value);
    if (!nombre || precio <= 0) return mostrarToast('Título y valor son obligatorios.');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return mostrarToast('Ubica la propiedad en el mapa.');

    const btn = document.getElementById('btn-guardar-inmueble');
    btn.disabled = true;
    btn.textContent = 'Guardando inmueble...';

    try {
        const editId = document.getElementById('inm-edit-id').value.trim() || null;
        let urlPortada = document.getElementById('inm-foto-actual').value.trim();

        if (blobPortadaPendiente) {
            const up = await GeokatuDB.AdminService.subirArchivo(
                'propiedades/' + idAgencia + '/fachada_' + Date.now() + '.webp',
                blobPortadaPendiente,
                'image/webp'
            );
            urlPortada = typeof up === 'string' ? up : (up?.data || up?.url || urlPortada);
        }

        let galeria = [];
        try {
            galeria = JSON.parse(document.getElementById('inm-galeria-actual').value || '[]');
        } catch (e) {
            galeria = [];
        }

        if (blobsGaleriaPendiente.length > 0) {
            for (let i = 0; i < blobsGaleriaPendiente.length; i++) {
                btn.textContent = 'Subiendo foto ' + (i + 1) + ' de ' + blobsGaleriaPendiente.length + '...';
                const blobOpt = await comprimirImagenWebP(blobsGaleriaPendiente[i], 1080, 0.82);
                const upG = await GeokatuDB.AdminService.subirArchivo(
                    'propiedades/' + idAgencia + '/gal_' + Date.now() + '_' + i + '.webp',
                    blobOpt,
                    'image/webp'
                );
                const urlG = typeof upG === 'string' ? upG : (upG?.data || upG?.url || '');
                if (urlG) galeria.push(urlG);
            }
            galeria = galeria.slice(-8);
        }

        const estadoInm = document.getElementById('inm-estado').value;
        const barrio = document.getElementById('inm-barrio').value.trim();
        const subtipo = document.getElementById('inm-subtipo').value;
        const operacion = document.getElementById('inm-operacion').value;
        const sala = document.getElementById('inm-sala-tramite').value.trim();

        const payload = {
            tipo_modelo: 'inmueble',
            categoria_maestra: 'inmueble',
            es_inmueble_real: true,
            id_negocio_padre: idAgencia,
            nombre: nombre,
            precio: precio,
            administracion: Math.round(Number(document.getElementById('inm-admin').value) || 0),
            admin_incluida: document.getElementById('inm-admin-incluida').checked,
            tipo_operacion: operacion,
            tipo: operacion,
            subtipo_inmueble: subtipo,
            categoria: barrio || subtipo,
            barrio: barrio,
            direccion: document.getElementById('inm-direccion').value.trim(),
            area_m2: Number(document.getElementById('inm-area').value) || 0,
            habitaciones: Number(document.getElementById('inm-hab').value) || 0,
            banos: Number(document.getElementById('inm-banos').value) || 0,
            estrato: document.getElementById('inm-estrato').value,
            parqueaderos: Number(document.getElementById('inm-parq').value) || 0,
            estado_inmueble: estadoInm,
            agotado: estadoInm === 'arrendado_vendido',
            tipo_contrato: document.getElementById('inm-tipo-contrato').value,
            fecha_fin_contrato: document.getElementById('inm-fin-contrato').value || '',
            sala_tramite: sala,
            contrato_activo_id: sala,
            cuerpo_texto: document.getElementById('inm-descripcion').value.trim(),
            foto_portada: urlPortada,
            imagen: urlPortada,
            galeria: galeria,
            Coordenadas: { latitude: lat, longitude: lng },
            lat: lat,
            lng: lng,
            geohash: generarGeohash(lat, lng),
            palabras_clave: [nombre, subtipo, operacion, barrio].join(' ').toLowerCase(),
            fecha_actualizacion: new Date().toISOString()
        };

        if (!editId) {
            payload.fecha_creacion = new Date().toISOString();
            payload.fecha_registro = payload.fecha_creacion;
        }

        const res = await GeokatuDB.AdminService.guardarProducto(idAgencia, editId, payload);
        if (!res?.success) throw new Error(res?.error || 'Error guardando inmueble');

        sessionStorage.removeItem(CLAVE_BORRADOR_INMO);
        window.cerrarSheetInmueble();
        await cargarPortafolioInmuebles();
        mostrarToast(editId ? 'Inmueble actualizado.' : 'Inmueble publicado en el radar.');
    } catch (e) {
        mostrarToast('Error: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar Inmueble';
    }
};

window.solicitarEliminarInmueble = async function(id) {
    const ok = await confirmarInapp('Eliminar propiedad', 'Esta acción retirará el inmueble del radar y de tu portafolio.');
    if (!ok) return;
    const res = await GeokatuDB.AdminService.eliminarProducto(idAgencia, id);
    if (res?.success) {
        await cargarPortafolioInmuebles();
        mostrarToast('Inmueble eliminado.');
    } else {
        mostrarToast('No se pudo eliminar el inmueble.');
    }
};

// ============================================================================
// 7. GENERADOR DE CARTEL QR IMPRIMIBLE (SE ARRIENDA / SE VENDE)
// ============================================================================
window.abrirCartelQR = function(id) {
    const p = listaInmuebles.find(x => (x.id_prod || x.id) === id);
    if (!p) return;
    const op = String(p.tipo_operacion || 'arriendo').toLowerCase();
    const banda = op === 'venta' ? 'SE VENDE' : (op === 'dias' ? 'ALQUILER POR DÍAS' : 'SE ARRIENDA');
    document.getElementById('cartel-banda').textContent = banda;
    document.getElementById('cartel-titulo').textContent = p.nombre || 'Propiedad';

    const specs = [
        p.subtipo_inmueble || '',
        p.area_m2 ? (p.area_m2 + ' m²') : '',
        p.habitaciones ? (p.habitaciones + ' Hab') : '',
        p.estrato ? ('Estrato ' + p.estrato) : ''
    ].filter(Boolean).join(' · ');
    document.getElementById('cartel-specs').textContent = specs || (p.barrio || '');
    document.getElementById('cartel-precio').textContent = '$' + Number(p.precio || 0).toLocaleString('es-CO') + (op === 'arriendo' ? ' /mes' : '');

    const wa = datosAgencia.whatsapp || datosAgencia.whatsApp || '';
    document.getElementById('cartel-contacto').textContent = (datosAgencia.nombre || 'GeoKATU') + (wa ? (' · WhatsApp ' + wa) : '');

    const qrBox = document.getElementById('cartel-qr-box');
    qrBox.innerHTML = '';
    const urlPublica = window.location.origin + '/inmueble?id=' + encodeURIComponent(idAgencia) + '&item=' + encodeURIComponent(id);
    if (typeof window.QRCode !== 'undefined') {
        new window.QRCode(qrBox, {
            text: urlPublica,
            width: 190,
            height: 190,
            colorDark: '#0a0a0c',
            colorLight: '#ffffff',
            correctLevel: window.QRCode.CorrectLevel.H
        });
    }
    document.getElementById('modal-cartel-qr').style.display = 'flex';
};

window.cerrarCartelQR = function() {
    document.getElementById('modal-cartel-qr').style.display = 'none';
};

window.imprimirCartelQR = function() {
    let limpiado = false;
    const limpiar = () => {
        if (limpiado) return;
        limpiado = true;
        document.body.classList.remove('modo-print-cartel');
        window.removeEventListener('afterprint', limpiar);
    };
    document.body.classList.add('modo-print-cartel');
    window.addEventListener('afterprint', limpiar);
    try {
        window.print();
    } finally {
        setTimeout(limpiar, 1200);
    }
};

// ============================================================================
// 8. PERFIL DE AGENCIA Y SEDE EN EL RADAR
// ============================================================================
function inicializarMapaAgencia(lat, lng) {
    const latN = Number(lat) || 4.8133;
    const lngN = Number(lng) || -75.6961;
    if (!mapaAgencia) {
        mapaAgencia = new maplibregl.Map({
            container: 'mapa-agencia-sede',
            style: './estilo-fresco.json',
            center: [lngN, latN],
            zoom: 16,
            attributionControl: false
        });
        markerAgencia = new maplibregl.Marker({ element: crearPinDomNaranja(), draggable: true, anchor: 'bottom' })
            .setLngLat([lngN, latN])
            .addTo(mapaAgencia);
        markerAgencia.on('dragend', () => {
            const c = markerAgencia.getLngLat();
            document.getElementById('ag-lat').value = c.lat;
            document.getElementById('ag-lng').value = c.lng;
        });
    } else {
        mapaAgencia.setCenter([lngN, latN]);
        markerAgencia.setLngLat([lngN, latN]);
        setTimeout(() => mapaAgencia.resize(), 150);
    }
    document.getElementById('ag-lat').value = latN;
    document.getElementById('ag-lng').value = lngN;
}

window.buscarEnMapaAgencia = function() {
    const dst = resolverUbicacionLocal(document.getElementById('ag-buscador-mapa')?.value || '');
    if (!dst || !mapaAgencia || !markerAgencia) return mostrarToast('Usa el botón GPS o arrastra el pin.');
    mapaAgencia.flyTo({ center: [dst.lng, dst.lat], zoom: 16, duration: 900 });
    markerAgencia.setLngLat([dst.lng, dst.lat]);
    document.getElementById('ag-lat').value = dst.lat;
    document.getElementById('ag-lng').value = dst.lng;
};

window.ubicarGpsAgencia = function() {
    if (!navigator.geolocation) return mostrarToast('GPS no disponible.');
    navigator.geolocation.getCurrentPosition((pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (mapaAgencia && markerAgencia) {
            mapaAgencia.flyTo({ center: [lng, lat], zoom: 17, duration: 900 });
            markerAgencia.setLngLat([lng, lat]);
        }
        document.getElementById('ag-lat').value = lat;
        document.getElementById('ag-lng').value = lng;
        mostrarToast('Ubicación de sede fijada.');
    }, () => mostrarToast('No se pudo obtener la señal GPS.'), { enableHighAccuracy: true });
};

window.subirImagenAgencia = async function(tipo, input) {
    if (!input.files || !input.files[0] || !idAgencia) return;
    try {
        let blob = input.files[0];
        if (window.GeokatuEstudio && typeof window.GeokatuEstudio.editarImagen === 'function') {
            const ed = await window.GeokatuEstudio.editarImagen(blob, {
                maxAncho: tipo === 'portada' ? 1200 : 600,
                maxAlto: tipo === 'portada' ? 400 : 600,
                calidad: 0.85,
                titulo: tipo === 'portada' ? 'Portada de Agencia' : 'Logo de Agencia'
            });
            if (!ed) {
                input.value = '';
                return;
            }
            blob = ed.blob;
        } else {
            blob = await comprimirImagenWebP(blob, tipo === 'portada' ? 1200 : 600, 0.85);
        }
        const res = await GeokatuDB.AdminService.subirArchivo(
            'tiendas/' + idAgencia + '/' + tipo + '_' + Date.now() + '.webp',
            blob,
            'image/webp'
        );
        const url = typeof res === 'string' ? res : (res?.data || res?.url || '');
        if (url) {
            const payload = {};
            payload[tipo] = url;
            await GeokatuDB.AdminService.actualizarNegocio(idAgencia, payload);
            datosAgencia[tipo] = url;
            hidratarCabeceraYCuenta();
            mostrarToast('Imagen actualizada.');
        }
    } catch (e) {
        mostrarToast('Error subiendo imagen.');
    }
};

window.guardarPerfilAgencia = async function() {
    const nombre = document.getElementById('ag-nombre').value.trim();
    const wa = document.getElementById('ag-whatsapp').value.trim().replace(/\D/g, '');
    const pin = document.getElementById('ag-pin').value.trim() || '0000';
    if (!nombre) return mostrarToast('El nombre de la agencia es obligatorio.');
    if (!/^\d{4}$/.test(pin)) return mostrarToast('El PIN titular debe ser de 4 dígitos.');

    const btn = document.getElementById('btn-guardar-agencia');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    try {
        const lat = parseFloat(document.getElementById('ag-lat').value) || Number(datosAgencia.Coordenadas?.latitude ?? 4.8133);
        const lng = parseFloat(document.getElementById('ag-lng').value) || Number(datosAgencia.Coordenadas?.longitude ?? -75.6961);
        const pbx = document.getElementById('ag-pbx').value.trim();
        const nicho = document.getElementById('ag-nicho').value;
        const username = document.getElementById('ag-username').value.trim().toLowerCase() || null;

        const payload = {
            nombre: nombre,
            slogan: document.getElementById('ag-slogan').value.trim(),
            nicho: nicho,
            niche: nicho,
            categoria: nicho,
            categoria_maestra: 'inmueble',
            tipo_modelo: 'inmueble',
            username: username,
            pin_titular: pin,
            Coordenadas: { latitude: lat, longitude: lng },
            lat: lat,
            lng: lng,
            geohash: generarGeohash(lat, lng),
            fecha_actualizacion: new Date().toISOString()
        };

        await GeokatuDB.AdminService.actualizarNegocio(idAgencia, payload);
        await setDoc(doc(db, 'Directorio_Contacto', idAgencia), {
            id: idAgencia,
            whatsapp: wa,
            telefonos: wa ? [wa] : [],
            pbx: pbx,
            fecha_actualizacion: new Date().toISOString()
        }, { merge: true });

        Object.assign(datosAgencia, payload, { whatsapp: wa, whatsApp: wa, pbx: pbx });
        localStorage.setItem('geokatu_cajero_pin', pin);
        hidratarCabeceraYCuenta();
        mostrarToast('Perfil de agencia actualizado.');
    } catch (e) {
        mostrarToast('Error guardando perfil: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar Perfil de Agencia';
    }
};

window.visualizarVitrinaInmobiliaria = function() {
    if (!idAgencia) return;
    window.open('/inmueble?id=' + encodeURIComponent(idAgencia), '_blank');
};

