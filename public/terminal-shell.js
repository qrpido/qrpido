/**
 * GEOKATU - Controlador de Terminal Unificada (Shell)
 * Archivo: public/terminal-shell.js
 * - Inicializacion unica de AuthGate
 * - Ticket vivo en RAM + barra "Volver a la venta"
 * - Dock retractil lento a la izquierda en POS (pestana naranja + gestos tactiles)
 * - Enrutador 0ms + historial Android Atras (ScannerHub -> Visor 2.5D -> Vista anterior)
 */

import GeokatuDB from './core-db.js';
import { db } from './firebase-config.js';
import { collection, doc, getDocs, query, where, limit, setDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { AuthGate } from './auth-gate.js';
import { ScannerHub } from './scanner-hub.js';

const RUTAS_FRAMES = {
  pos: 'pos?embed=terminal',
  stock: 'stock?embed=terminal',
  mapa: 'inventario?embed=terminal'
};

const MODOS_POR_VISTA = {
  pos: 'VENDER',
  mapa: 'CONSULTAR',
  stock: 'UBICAR',
  inicio: 'CONSULTAR'
};

const shellEl = document.getElementById('terminal-shell');
const dockEl = document.getElementById('terminal-dock');
const pestanaPosEl = document.getElementById('btn-dock-pestana-pos');
const barraVentaEl = document.getElementById('barra-volver-venta');
const bvvUnidadesEl = document.getElementById('bvv-unidades');
const bvvTotalEl = document.getElementById('bvv-total');

const FRAMES = {
  pos: document.getElementById('frame-pos'),
  stock: document.getElementById('frame-stock'),
  mapa: document.getElementById('frame-mapa')
};

const VISTAS = {
  inicio: document.getElementById('vista-inicio'),
  pos: document.getElementById('vista-pos'),
  stock: document.getElementById('vista-stock'),
  mapa: document.getElementById('vista-mapa')
};

let contextoSesionActivo = null;
const modulosHijosRegistrados = new Set();
const framesCargados = { pos: false, stock: false, mapa: false };
const accionesPendientes = { pos: [], stock: [], mapa: [] };

let timerAutocierreDock = null;
let timerActividadThrottle = 0;
let observadorPos = null;
let resumenVentaActual = { unidades: 0, totalTexto: '$0', activo: false };
let permisosActivosTerminal = null;
let cajasComercioCache = [];
let estadosCajasCache = {};
let datosNegocioTerminal = {};

function escaparHtmlShell(texto) {
 if (texto === null || texto === undefined) return '';
 return String(texto)
 .replace(/&/g, '&amp;')
 .replace(/</g, '&lt;')
 .replace(/>/g, '&gt;')
 .replace(/"/g, '&quot;')
 .replace(/'/g, '&#39;');
}

function resolverPermisosRolTerminal(ctx) {
 const rol = String((ctx && ctx.rol) || 'cajero').toLowerCase().trim();
 const esDueno = Boolean(ctx && (ctx.esDueno === true || rol === 'dueño' || rol === 'owner'));
 const esAdmin = esDueno || rol === 'administrador_delegado' || rol === 'admin' || rol === 'administrador' || rol === 'superadmin';
 if (esAdmin) {
 return {
 etiqueta: esDueno ? 'Titular' : 'Admin Delegado',
 pos: true, stock: true, mapa: true, escaner: true, cardEscaner: true,
 croquis: true, adminCajas: true, configFiscal: true, asignarTareas: true,
 oficina: true, perfilEmpleado: false
 };
 }
 if (rol === 'supervisor' || rol === 'supervisor_pos') {
 return {
 etiqueta: 'Supervisor',
 pos: true, stock: true, mapa: true, escaner: true, cardEscaner: true,
 croquis: true, adminCajas: true, configFiscal: false, asignarTareas: true,
 oficina: false, perfilEmpleado: true
 };
 }
 if (rol === 'operador_bodega' || rol === 'almacen') {
 return {
 etiqueta: 'Operario Bodega',
 pos: false, stock: true, mapa: true, escaner: true, cardEscaner: true,
 croquis: false, adminCajas: false, configFiscal: false, asignarTareas: false,
 oficina: false, perfilEmpleado: true
 };
 }
 if (rol === 'visual_merchandising') {
 return {
 etiqueta: 'Visual Merchandising',
 pos: false, stock: true, mapa: true, escaner: true, cardEscaner: false,
 croquis: true, adminCajas: false, configFiscal: false, asignarTareas: false,
 oficina: false, perfilEmpleado: true
 };
 }
 return {
 etiqueta: rol === 'asesor' ? 'Asesor Ventas' : 'Cajero POS',
 pos: true, stock: false, mapa: true, escaner: true, cardEscaner: true,
 croquis: false, adminCajas: false, configFiscal: false, asignarTareas: false,
 oficina: false, perfilEmpleado: true
 };
}

function obtenerVistaPermitidaFallback_(vistaDeseada) {
 const p = permisosActivosTerminal;
 if (!p) return vistaDeseada;
 if (vistaDeseada === 'inicio') return 'inicio';
 if (vistaDeseada === 'pos' && p.pos) return 'pos';
 if (vistaDeseada === 'stock' && p.stock) return 'stock';
 if (vistaDeseada === 'mapa' && p.mapa) return 'mapa';
 if (p.pos) return 'pos';
 if (p.stock) return 'stock';
 if (p.mapa) return 'mapa';
 return 'inicio';
}

function aplicarPermisosDockYCards(p) {
 if (!p) return;
 const mapaBotones = [
 { vista: 'pos', ok: p.pos, cardId: 'btn-inicio-pos' },
 { vista: 'stock', ok: p.stock, cardId: 'btn-inicio-stock' },
 { vista: 'mapa', ok: p.mapa, cardId: 'btn-inicio-mapa' }
 ];
 mapaBotones.forEach(function(item) {
 const btnDock = dockEl ? dockEl.querySelector('.dock-item[data-vista="' + item.vista + '"]') : null;
 if (btnDock) btnDock.style.display = item.ok ? 'flex' : 'none';
 const cardEl = document.getElementById(item.cardId);
 if (cardEl) cardEl.style.display = item.ok ? 'flex' : 'none';
 });
  const btnEsc = document.getElementById('btn-inicio-escaner');
 if (btnEsc) btnEsc.style.display = p.cardEscaner ? 'flex' : 'none';
 const btnCroquis = document.getElementById('btn-inicio-croquis');
 if (btnCroquis) btnCroquis.style.display = p.croquis ? 'flex' : 'none';
 const btnOfi = document.getElementById('btn-inicio-oficina');
 if (btnOfi) btnOfi.style.display = p.oficina ? 'flex' : 'none';
 const ddOfi = document.getElementById('dd-btn-oficina');
 if (ddOfi) ddOfi.style.display = p.oficina ? 'flex' : 'none';
 const btnPerf = document.getElementById('btn-inicio-perfil-emp');
 if (btnPerf) btnPerf.style.display = p.perfilEmpleado ? 'flex' : 'none';
 const formAsignarT = document.getElementById('form-asignar-tarea-shell');
 if (formAsignarT) formAsignarT.style.display = p.asignarTareas ? 'flex' : 'none';
 const bloqueCajas = document.getElementById('bloque-puesto-multicaja');
 if (bloqueCajas) bloqueCajas.style.display = (p.pos || p.adminCajas) ? 'flex' : 'none';
 const btnAdminCajas = document.getElementById('btn-toggle-admin-cajas');
 if (btnAdminCajas) btnAdminCajas.style.display = p.adminCajas ? 'inline-block' : 'none';
 const bloqueFiscal = document.getElementById('bloque-config-pos-gerencial');
 if (bloqueFiscal) {
 const mostrarFranja = Boolean(p.configFiscal || p.adminCajas);
 bloqueFiscal.style.display = mostrarFranja ? 'flex' : 'none';
 const bPas = document.getElementById('btn-inicio-pasarelas');
 const bFisc = document.getElementById('btn-toggle-fiscal-terminal');
 const bGer = document.getElementById('btn-inicio-gerencial');
 const filaBtns = bloqueFiscal.querySelector('.inicio-fiscal-btns');
 if (bPas) bPas.style.display = p.configFiscal ? 'inline-flex' : 'none';
 if (bFisc) bFisc.style.display = p.configFiscal ? 'inline-flex' : 'none';
 if (bGer) bGer.style.display = (p.configFiscal || p.adminCajas) ? 'inline-flex' : 'none';
 if (filaBtns) filaBtns.style.gridTemplateColumns = p.configFiscal ? 'repeat(3, 1fr)' : '1fr';
 }
 const chipsWrap = document.getElementById('inicio-permisos-chips');
 if (chipsWrap) {
 const definicion = [
 { lbl: 'POS / Cobro', ok: p.pos },
 { lbl: 'Stock WMS', ok: p.stock },
 { lbl: 'Mapa Tienda', ok: p.mapa },
 { lbl: 'Croquis QR', ok: p.croquis },
 { lbl: 'Gestionar Cajas', ok: p.adminCajas },
 { lbl: 'Fiscal / DIAN', ok: p.configFiscal },
 { lbl: 'Oficina', ok: p.oficina }
 ];
 chipsWrap.innerHTML = definicion.map(function(d) {
 return '<span class="permiso-chip ' + (d.ok ? 'permitido' : 'restringido') + '">' + d.lbl + '</span>';
 }).join('');
 }
}

function actualizarEstadoRedYColaInicio() {
 const idNeg = (contextoSesionActivo && contextoSesionActivo.idNegocio) || localStorage.getItem('geokatu_active_uid') || '';
 let pendVentas = 0;
 let pendMovs = 0;
 let pendCierres = 0;
 try {
 if (idNeg) {
 pendVentas = JSON.parse(localStorage.getItem('geokatu_sync_cola_' + idNeg) || '[]').length;
 pendMovs = JSON.parse(localStorage.getItem('geokatu_movimientos_cola_' + idNeg) || '[]').length;
 pendCierres = JSON.parse(localStorage.getItem('geokatu_cierres_cola_' + idNeg) || '[]').length;
 }
 } catch (eQ) {}
 const totalPend = pendVentas + pendMovs + pendCierres;
 const redTxt = document.getElementById('inicio-red-txt');
 const redPill = document.getElementById('inicio-red-pill');
 const estTxt = document.getElementById('inicio-estado-txt');
 const estDot = document.getElementById('inicio-estado-dot');
 const online = navigator.onLine;
 if (redTxt) {
 redTxt.textContent = online ? (totalPend > 0 ? ('Online · ' + totalPend + ' pend.') : 'Online') : ('Offline · ' + totalPend + ' pend.');
 }
 if (redPill) {
 redPill.className = 'inicio-pill ' + ((!online || totalPend > 0) ? 'alerta' : 'ok');
 }
 if (estTxt) estTxt.textContent = online ? 'Sesión activa' : 'Modo offline';
 if (estDot) estDot.style.background = online ? 'var(--gk-verde)' : '#fbbf24';
}

function pintarResumenCajasInicio() {
 const idNeg = (contextoSesionActivo && contextoSesionActivo.idNegocio) || localStorage.getItem('geokatu_active_uid') || '';
 const sel = document.getElementById('select-caja-terminal');
 const badgeTurno = document.getElementById('inicio-turno-badge');
 const resumenEl = document.getElementById('inicio-cajas-resumen');
 const listaAdmin = document.getElementById('lista-cajas-admin');
 const cajaGuardada = localStorage.getItem('geokatu_caja_num') || 'CAJA-01';
 const activas = cajasComercioCache.filter(function(c) { return c.activa !== false; });
 const existeSel = activas.some(function(c) { return c.id === cajaGuardada; });
 const cajaActiva = existeSel ? cajaGuardada : (activas[0] ? activas[0].id : 'CAJA-01');
 localStorage.setItem('geokatu_caja_num', cajaActiva);
 if (sel) {
 sel.innerHTML = activas.map(function(c) {
 const est = estadosCajasCache[c.id] || { estado: 'CERRADA' };
 const tagEst = est.estado === 'ABIERTA' ? ' [ABIERTA]' : ' [CERRADA]';
 const selectedAttr = c.id === cajaActiva ? ' selected' : '';
 return '<option value="' + escaparHtmlShell(c.id) + '"' + selectedAttr + '>' + escaparHtmlShell(c.id + ' · ' + c.nombre + tagEst) + '</option>';
 }).join('');
 }
 const estAct = estadosCajasCache[cajaActiva] || { estado: 'CERRADA' };
 if (badgeTurno) {
 badgeTurno.textContent = estAct.estado === 'ABIERTA' ? (cajaActiva + ' ABIERTA') : (cajaActiva + ' CERRADA');
 badgeTurno.className = 'inicio-pill ' + (estAct.estado === 'ABIERTA' ? 'ok' : 'alerta');
 }
 let cantAbiertas = 0;
 cajasComercioCache.forEach(function(c) {
 if (estadosCajasCache[c.id] && estadosCajasCache[c.id].estado === 'ABIERTA') cantAbiertas++;
 });
 if (resumenEl) {
 resumenEl.textContent = activas.length + (activas.length === 1 ? ' caja' : ' cajas') + ' · ' + cantAbiertas + ' abierta(s)';
 }
 if (listaAdmin) {
 listaAdmin.innerHTML = cajasComercioCache.map(function(c) {
 const est = estadosCajasCache[c.id] || { estado: 'CERRADA', cajero: '' };
 const abierta = est.estado === 'ABIERTA';
 const esBase = c.id === 'CAJA-01';
 const sub = abierta ? ('ABIERTA · ' + (est.cajero || 'Cajero')) : (c.activa === false ? 'INACTIVA' : 'CERRADA');
 const btnAcc = esBase
 ? '<span class="inicio-pill">Base</span>'
 : '<button type="button" class="inicio-btn-mini btn-toggle-caja-activa" data-caja-id="' + escaparHtmlShell(c.id) + '">' + (c.activa === false ? 'Activar' : 'Desactivar') + '</button>';
 return '<div class="caja-admin-fila">' +
 '<div style="min-width:0;">' +
 '<strong style="display:block; color:#fff; font-family:monospace;">' + escaparHtmlShell(c.id) + ' · ' + escaparHtmlShell(c.nombre) + '</strong>' +
 '<span style="font-size:10px; color:' + (abierta ? 'var(--gk-verde)' : 'var(--gk-muted)') + ';">' + escaparHtmlShell(sub) + '</span>' +
 '</div>' +
 btnAcc +
 '</div>';
 }).join('');
 listaAdmin.querySelectorAll('.btn-toggle-caja-activa').forEach(function(btn) {
 btn.addEventListener('click', async function() {
 const cid = btn.getAttribute('data-caja-id');
 if (!cid || !idNeg) return;
 if (estadosCajasCache[cid] && estadosCajasCache[cid].estado === 'ABIERTA') {
 alert('No puedes desactivar ' + cid + ' mientras tenga un turno abierto.');
 return;
 }
 cajasComercioCache = cajasComercioCache.map(function(x) {
 return x.id === cid ? Object.assign({}, x, { activa: x.activa === false }) : x;
 });
 await GeokatuDB.PosService.guardarCajasComercio(idNeg, cajasComercioCache);
 pintarResumenCajasInicio();
 });
 });
 }
}

async function cargarCajasYEstadosInicio(idNegocio, forzarRed) {
 if (!idNegocio) return;
 const resCajas = await GeokatuDB.PosService.obtenerCajasComercio(idNegocio, Boolean(forzarRed));
 cajasComercioCache = (resCajas && resCajas.data) ? resCajas.data : [{ id: 'CAJA-01', nombre: 'Caja Principal', sede: 'SALA_VENTAS', activa: true }];
 const resEst = await GeokatuDB.PosService.obtenerEstadoTodasCajas(idNegocio, cajasComercioCache);
 estadosCajasCache = (resEst && resEst.data) ? resEst.data : {};
 pintarResumenCajasInicio();
}

async function cargarTareasTurnoInicio(ctx) {
 const cont = document.getElementById('inicio-tareas-lista');
 const badge = document.getElementById('inicio-tareas-conteo');
 const resumenTxt = document.getElementById('inicio-tareas-resumen-txt');
 if (!cont || !ctx || !ctx.idNegocio) return;
 if (!navigator.onLine) {
 cont.innerHTML = '<p style="margin:4px 0; font-size:11px; color:var(--gk-muted); text-align:center;">Sin red para consultar tareas del turno.</p>';
 if (badge) badge.textContent = '0';
 if (resumenTxt) resumenTxt.textContent = 'Sin conexión';
 return;
 }
 try {
 const qT = query(
 collection(db, 'Directorio/' + ctx.idNegocio + '/Tareas_Internas'),
 where('completada', '==', false),
 limit(30)
 );
 const snap = await getDocs(qT);
 const lista = [];
 const puedeVerTodas = Boolean(ctx.esDueno === true || (permisosActivosTerminal && permisosActivosTerminal.asignarTareas));
 snap.forEach(function(d) {
 const t = d.data() || {};
 const dest = String(t.destinatario_uid || 'TODOS');
 if (dest === 'TODOS' || dest === ctx.operadorUid || puedeVerTodas) {
 lista.push(Object.assign({ id: d.id }, t));
 }
 });
 lista.sort(function(a, b) {
 return String(b.fecha_creacion || '').localeCompare(String(a.fecha_creacion || ''));
 });
 if (badge) badge.textContent = String(lista.length);
 if (lista.length === 0) {
 if (resumenTxt) resumenTxt.textContent = 'Sin tareas pendientes';
 cont.innerHTML = '<p style="margin:4px 0; font-size:11.5px; color:var(--gk-muted); text-align:center;">Sin tareas pendientes para este turno.</p>';
 return;
 }
 if (resumenTxt) {
 const primera = String(lista[0].titulo || 'Tarea pendiente');
 resumenTxt.textContent = lista.length > 1 ? (primera + ' (+' + (lista.length - 1) + ')') : primera;
 }
 cont.innerHTML = lista.map(function(t) {
 const col = t.prioridad === 'URGENTE' ? '#ff4444' : 'var(--gk-naranja)';
 return '<div class="tarea-turno-fila" style="border-left-color:' + col + ';">' +
 '<div style="min-width:0;">' +
 '<span style="font-size:9.5px; font-weight:900; color:' + col + '; text-transform:uppercase;">' + escaparHtmlShell(t.prioridad || 'NORMAL') + '</span>' +
 '<strong style="display:block; font-size:12px; color:#fff;">' + escaparHtmlShell(t.titulo || '') + '</strong>' +
 '</div>' +
 '<button type="button" class="inicio-btn-mini btn-completar-tarea-term" data-tarea-id="' + escaparHtmlShell(t.id) + '">Listo</button>' +
 '</div>';
 }).join('');
 cont.querySelectorAll('.btn-completar-tarea-term').forEach(function(b) {
 b.addEventListener('click', async function() {
 const idT = b.getAttribute('data-tarea-id');
 if (!idT) return;
 b.disabled = true;
 try {
 await updateDoc(doc(db, 'Directorio/' + ctx.idNegocio + '/Tareas_Internas', idT), {
 completada: true,
 fecha_completada: new Date().toISOString(),
 completada_por: ctx.nombre || ('OP #' + (ctx.codigoCajero || '0000'))
 });
 cargarTareasTurnoInicio(ctx);
 } catch (eT) {
 b.disabled = false;
 }
 });
 });
 } catch (e) {
 if (badge) badge.textContent = '0';
 if (resumenTxt) resumenTxt.textContent = 'Sin tareas pendientes';
 cont.innerHTML = '<p style="margin:4px 0; font-size:11px; color:var(--gk-muted); text-align:center;">No se pudieron cargar las tareas.</p>';
 }
}

function calcularDVTerminal(nit) {
 const vpri = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
 const z = String(nit || '').replace(/\D/g, '');
 let x = 0;
 for (let i = 0; i < z.length; i++) {
 x += (parseInt(z.charAt(i), 10) * vpri[z.length - 1 - i]);
 }
 const y = x % 11;
 return (y > 1) ? String(11 - y) : String(y);
}

function hidratarBloqueFiscalTerminal(dNeg) {
 datosNegocioTerminal = dNeg || {};
 const idNeg = (contextoSesionActivo && contextoSesionActivo.idNegocio) || localStorage.getItem('geokatu_active_uid') || '';
 const paisActual = datosNegocioTerminal.pais || localStorage.getItem('geokatu_pais_' + idNeg) || 'COL';
 const f = datosNegocioTerminal.perfil_fiscal || {};
 const setV = function(id, v) { const el = document.getElementById(id); if (el) el.value = v || ''; };
 setV('term-fisc-razon', f.razon_social || datosNegocioTerminal.nombre || '');
 setV('term-fisc-tienda', f.codigo_tienda || 'T-01');
 setV('term-fisc-nit', f.nit || datosNegocioTerminal.nit || datosNegocioTerminal.rif || '');
 setV('term-fisc-dv', f.dv || '');
 setV('term-fisc-regimen', f.regimen_tributario || 'RESPONSABLE_IVA');
 setV('term-fisc-dir', f.direccion || datosNegocioTerminal.direccion || '');
 setV('term-fisc-siigo-user', f.siigo_user || '');
 setV('term-fisc-siigo-key', f.siigo_key || '');
 setV('term-fisc-siigo-doc', f.codigo_tipo_comprobante || '');
 setV('term-fisc-siigo-iva', f.id_impuesto_iva_siigo || '');
 setV('term-fisc-pais', paisActual);
  const resEl = document.getElementById('resumen-fiscal-terminal');
 if (resEl) {
 const tagPais = paisActual === 'VEN' ? 'VE (USD/VES)' : 'CO (DIAN)';
 if (!f.nit && !datosNegocioTerminal.rif) {
 resEl.style.color = '#fbbf24';
 resEl.textContent = 'Sin NIT/RIF (' + tagPais + ')';
 } else {
 const docTxt = (f.nit || datosNegocioTerminal.rif) + (f.dv ? ('-' + f.dv) : '');
 resEl.style.color = '#86efac';
 resEl.textContent = docTxt + ' · ' + (f.codigo_tienda || 'T-01') + ' · ' + tagPais;
 }
 }
}

function obtenerSedeActiva(idNegocio) {
  return localStorage.getItem('geokatu_sede_activa_' + idNegocio)
    || localStorage.getItem('geokatu_sede_activa')
    || localStorage.getItem('geokatu_almacen_activo')
    || 'SALA_VENTAS';
}

function pintarBarraVolverVenta() {
  if (!barraVentaEl) return;
  const mostrar = Boolean(resumenVentaActual.activo && window.TerminalApp.vistaActiva !== 'pos');
  barraVentaEl.classList.toggle('visible', mostrar);
  if (mostrar) {
    const u = resumenVentaActual.unidades;
    const etiquetaU = Number.isInteger(u)
      ? (u === 1 ? '1 unidad' : u + ' unidades')
      : (u.toFixed(2) + ' und');
    bvvUnidadesEl.textContent = etiquetaU;
    bvvTotalEl.textContent = resumenVentaActual.totalTexto;
  }
}

function leerEstadoTicketDesdePos() {
  const frame = FRAMES.pos;
  if (!frame || !frame.contentDocument) return;
  const doc = frame.contentDocument;
  const lista = doc.getElementById('current-sale');
  const totalEl = doc.querySelector('.total-amount');
  if (!lista || !totalEl) return;

  const cards = lista.querySelectorAll('.cart-card');
  let unidades = 0;
  cards.forEach((card) => {
    const inp = card.querySelector('.qty-input-direct');
    const val = inp ? parseFloat(String(inp.value).replace(',', '.')) : 1;
    unidades += (Number.isFinite(val) && val > 0) ? val : 1;
  });

  const totalTexto = (totalEl.textContent || '$0').trim();
  const totalNum = Number(totalTexto.replace(/[^\d]/g, '')) || 0;

  resumenVentaActual = {
    unidades: unidades,
    totalTexto: totalTexto || '$0',
    activo: cards.length > 0 || totalNum > 0
  };
  pintarBarraVolverVenta();
}

function conectarObservadorTicketPos() {
  const frame = FRAMES.pos;
  if (!frame || !frame.contentDocument) return;
  const doc = frame.contentDocument;
  const lista = doc.getElementById('current-sale');
  const totalEl = doc.querySelector('.total-amount');
  if (!lista || !totalEl) return;

  if (observadorPos) {
    observadorPos.disconnect();
    observadorPos = null;
  }
  observadorPos = new MutationObserver(() => leerEstadoTicketDesdePos());
  observadorPos.observe(lista, { childList: true, subtree: true, attributes: true });
  observadorPos.observe(totalEl, { childList: true, characterData: true, subtree: true });
  leerEstadoTicketDesdePos();
}

function ejecutarCuandoBridgeExista(vista, nombreFn, fnEjecutar) {
  const frame = FRAMES[vista];
  if (!frame) return;

  const intentar = (intentosRestantes) => {
    const win = frame.contentWindow;
    if (win && typeof win[nombreFn] === 'function') {
      fnEjecutar(win);
      return;
    }
    if (intentosRestantes <= 0) return;
    setTimeout(() => intentar(intentosRestantes - 1), 120);
  };

  if (framesCargados[vista]) {
    intentar(25);
  } else {
    accionesPendientes[vista].push(() => intentar(30));
    asegurarFrameCargado(vista);
  }
}

let modoEditorMapaActivo = false;

// Generador determinista de codigo de 6 caracteres: 3 Letras (Zona/Tipo) + 3 Numeros (001-999)
window.generarCodigoMueble6D = function(rawId, nombreMueble, sedeTexto) {
  const limpio = String(rawId || '').trim().toUpperCase();
  if (/^[A-Z]{3}\d{3}$/.test(limpio)) return limpio;
  const bolsa = (String(sedeTexto || '') + ' ' + String(nombreMueble || '')).toUpperCase();
  let prefijo = 'PVT';
  if (bolsa.includes('BOD') || bolsa.includes('ALM')) prefijo = 'BOD';
  else if (bolsa.includes('VIT') || bolsa.includes('MOS')) prefijo = 'VIT';
  else if (bolsa.includes('FRI') || bolsa.includes('NEV') || bolsa.includes('REF')) prefijo = 'FRI';
  else if (bolsa.includes('CAJ')) prefijo = 'CAJ';
  else if (bolsa.includes('PAS')) prefijo = 'PAS';

  const numEnNombre = String(nombreMueble || '').match(/(\d{1,3})/);
  let numero = 1;
  if (numEnNombre) {
    numero = Math.max(1, Math.min(999, parseInt(numEnNombre[1], 10)));
  } else if (limpio) {
    let hash = 0;
    for (let i = 0; i < limpio.length; i++) {
      hash = ((hash << 5) - hash + limpio.charCodeAt(i)) | 0;
    }
    numero = (Math.abs(hash) % 999) + 1;
  }
  return prefijo + String(numero).padStart(3, '0');
};

function repararVistaInventarioEmbebida(frame) {
  if (!frame || !frame.contentDocument) return;
  const doc = frame.contentDocument;
  if (!doc.querySelector('.visor-hud') || doc.getElementById('gk-fix-radar-25d')) return;

  const st = doc.createElement('style');
  st.id = 'gk-fix-radar-25d';
  st.textContent = `
    /* 1. Separar #panel-filtros-avanzados del buscador superior (27659.jpg) */
    #panel-filtros-avanzados:not(.oculto) {
      top: 138px !important;
      padding-top: 14px !important;
      z-index: 950 !important;
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.92) !important;
    }
    /* 2. Ocultar ficha inferior y FAB cuando el 2.5D o el drawer estan abiertos */
    body:has(#visor-alzado-pip:not(.oculto)) #ficha-compacta-radar,
    body:has(#visor-alzado-pip:not(.oculto)) #fab-capas-contenedor,
    body:has(#panel-detalle-mueble.abierto) #ficha-compacta-radar {
      display: none !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    /* 3. Visor 2.5D centrado, con cabecera flexible y boton X siempre visible */
    #visor-alzado-pip:not(.oculto) {
      position: fixed !important;
      left: 12px !important;
      right: 12px !important;
      bottom: 14px !important;
      top: auto !important;
      width: auto !important;
      max-width: 440px !important;
      margin: 0 auto !important;
      background: rgba(14, 14, 20, 0.98) !important;
      border: 1.5px solid #ff6b00 !important;
      border-radius: 18px !important;
      box-shadow: 0 20px 55px rgba(0, 0, 0, 0.95), 0 0 0 100vmax rgba(0, 0, 0, 0.55) !important;
      z-index: 9500 !important;
      overflow: hidden !important;
    }
    .alzado-pip-header {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 8px !important;
      flex-wrap: nowrap !important;
    }
    .alzado-pip-titulos {
      min-width: 0 !important;
      flex: 1 1 auto !important;
      overflow: hidden !important;
    }
    .alzado-pip-controles {
      display: flex !important;
      align-items: center !important;
      gap: 4px !important;
      flex-shrink: 0 !important;
    }
    #alzado-id-tag, #txt-mueble-id-fisico {
      font-family: monospace !important;
      font-weight: 900 !important;
      letter-spacing: 0.8px !important;
      background: rgba(255, 107, 0, 0.16) !important;
      border: 1px solid rgba(255, 107, 0, 0.45) !important;
      color: #ff6b00 !important;
      padding: 2px 7px !important;
      border-radius: 6px !important;
      font-size: 11px !important;
      display: inline-block !important;
      max-width: 78px !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
    }
    #btn-cerrar-alzado {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 30px !important;
      height: 30px !important;
      min-width: 30px !important;
      border-radius: 8px !important;
      background: rgba(255, 68, 68, 0.2) !important;
      border: 1px solid rgba(255, 68, 68, 0.55) !important;
      color: #ffffff !important;
      flex-shrink: 0 !important;
      cursor: pointer !important;
      margin-left: 4px !important;
    }
  `;
  doc.head.appendChild(st);

  // Boton Editar Mapa directo en la cabecera junto a Mover stock
  const cab = doc.querySelector('.inventario-cabecera');
  const linkStock = doc.getElementById('inventario-ir-stock');
  if (cab && linkStock && !doc.getElementById('btn-cab-editar-croquis')) {
    const wrapAcc = doc.createElement('div');
    wrapAcc.style.cssText = 'display:flex; align-items:center; gap:6px;';
    const btnEd = doc.createElement('button');
    btnEd.id = 'btn-cab-editar-croquis';
    btnEd.type = 'button';
    btnEd.textContent = 'Editar mapa';
    btnEd.style.cssText = 'background:rgba(37,99,235,0.22); border:1px solid rgba(96,165,250,0.5); color:#93c5fd; border-radius:99px; padding:6px 11px; font-size:11px; font-weight:800; cursor:pointer;';
    btnEd.addEventListener('click', () => window.TerminalApp.alternarModoEditorMapa(true));
    linkStock.parentNode.insertBefore(wrapAcc, linkStock);
    wrapAcc.appendChild(btnEd);
    wrapAcc.appendChild(linkStock);
  }

  const normalizarBadges6D = () => {
    const selSede = doc.getElementById('selector-sede-activa');
    const txtSede = selSede && selSede.options[selSede.selectedIndex] ? selSede.options[selSede.selectedIndex].text : 'PISO DE VENTA';
    const pares = [
      { idBadge: 'alzado-id-tag', idNom: 'alzado-nombre-tag' },
      { idBadge: 'txt-mueble-id-fisico', idNom: 'txt-mueble-nombre' }
    ];
    pares.forEach((p) => {
      const elB = doc.getElementById(p.idBadge);
      const elN = doc.getElementById(p.idNom);
      if (elB && elB.textContent) {
        const actual = elB.textContent.trim();
        if (actual.length > 6 || !/^[A-Z]{3}\d{3}$/.test(actual)) {
          const raw = elB.dataset.rawId || actual;
          elB.dataset.rawId = raw;
          const cod6 = window.generarCodigoMueble6D(raw, elN ? elN.textContent : '', txtSede);
          if (actual !== cod6) elB.textContent = cod6;
        }
      }
    });
  };
  const obs6D = new MutationObserver(normalizarBadges6D);
  obs6D.observe(doc.body, { childList: true, subtree: true, characterData: true });
  normalizarBadges6D();

  // Garantizar que el boton X exista y sea visible dentro de la cabecera del 2.5D
  const visor = doc.getElementById('visor-alzado-pip');
  if (visor) {
    let btnCerrar = doc.getElementById('btn-cerrar-alzado');
    const headerVisor = visor.firstElementChild;
    if (!btnCerrar && headerVisor) {
      btnCerrar = doc.createElement('button');
      btnCerrar.id = 'btn-cerrar-alzado';
      btnCerrar.type = 'button';
      btnCerrar.innerHTML = '✕';
      headerVisor.appendChild(btnCerrar);
    }
    if (btnCerrar) {
      btnCerrar.addEventListener('click', (e) => {
        e.stopPropagation();
        visor.classList.add('oculto');
      });
    }
    // Barra de acciones inferior dentro del propio 2.5D (Abrir en Stock / Editar Mapa / Cerrar)
    if (!doc.getElementById('gk-footer-25d')) {
      const footer25d = doc.createElement('div');
      footer25d.id = 'gk-footer-25d';
      footer25d.style.cssText = 'display:grid; grid-template-columns:1fr 1fr auto; gap:6px; padding:8px 12px 10px 12px; background:rgba(10,10,14,0.96); border-top:1px solid rgba(255,255,255,0.1);';
      footer25d.innerHTML = `
        <button type="button" id="gk-25d-ir-stock" style="background:rgba(0,255,100,0.12); border:1px solid rgba(0,255,100,0.4); color:#00ff64; border-radius:8px; padding:8px 6px; font-size:11px; font-weight:800; cursor:pointer;">Abrir en Stock</button>
        <button type="button" id="gk-25d-editar-mapa" style="background:rgba(37,99,235,0.2); border:1px solid rgba(96,165,250,0.45); color:#93c5fd; border-radius:8px; padding:8px 6px; font-size:11px; font-weight:800; cursor:pointer;">Editar Croquis</button>
        <button type="button" id="gk-25d-cerrar-btn" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2); color:#ffffff; border-radius:8px; padding:8px 12px; font-size:11px; font-weight:800; cursor:pointer;">Cerrar</button>
      `;
      visor.appendChild(footer25d);
      footer25d.querySelector('#gk-25d-cerrar-btn').addEventListener('click', () => visor.classList.add('oculto'));
      footer25d.querySelector('#gk-25d-ir-stock').addEventListener('click', () => {
        const btnStock = doc.getElementById('btn-fc-abrir-stock');
        if (btnStock) btnStock.click();
        else window.TerminalApp.irAVista('stock');
      });
      footer25d.querySelector('#gk-25d-editar-mapa').addEventListener('click', () => {
        window.TerminalApp.alternarModoEditorMapa(true);
      });
    }
  }
};

function asegurarFrameCargado(vista) {
  const frame = FRAMES[vista];
  if (!frame) return;
  if (!frame.dataset.listenerListo) {
    frame.dataset.listenerListo = '1';
    frame.addEventListener('load', () => {
      framesCargados[vista] = true;
            try {
        if (frame.contentWindow) {
          frame.contentWindow.TerminalApp = window.TerminalApp;
          frame.contentWindow.generarCodigoMueble6D = window.generarCodigoMueble6D;
        }
      } catch (e) {}

      if (vista === 'pos') {
        setTimeout(conectarObservadorTicketPos, 250);
      }
      if (vista === 'mapa') {
        setTimeout(() => repararVistaInventarioEmbebida(frame), 120);
      }

      const cola = accionesPendientes[vista].splice(0);
      cola.forEach((fn) => {
        try { fn(); } catch (eC) {}
      });
    });
  }
  if (framesCargados[vista] || frame.dataset.iniciado === '1') return;
  frame.dataset.iniciado = '1';
  frame.src = RUTAS_FRAMES[vista];
}

function cancelarTimerDock() {
  if (timerAutocierreDock) {
    clearTimeout(timerAutocierreDock);
    timerAutocierreDock = null;
  }
}

function ocultarDockEnPos() {
  cancelarTimerDock();
  if (window.TerminalApp.vistaActiva !== 'pos') return;
  shellEl.classList.add('dock-oculto');
}

function mostrarDockEnPos(msAutocierre) {
  cancelarTimerDock();
  shellEl.classList.remove('dock-oculto');
  if (window.TerminalApp.vistaActiva === 'pos') {
    const espera = typeof msAutocierre === 'number' ? msAutocierre : 4000;
    timerAutocierreDock = setTimeout(() => {
      if (window.TerminalApp.vistaActiva === 'pos' && !ScannerHub.estaAbierto()) {
        ocultarDockEnPos();
      }
    }, espera);
  }
}

function configurarGestosDockPos() {
  let inicioXDock = null;
  let inicioXPestana = null;

  if (dockEl) {
    dockEl.addEventListener('touchstart', (e) => {
      if (window.TerminalApp.vistaActiva !== 'pos') return;
      inicioXDock = e.touches[0] ? e.touches[0].clientX : null;
      mostrarDockEnPos(4200);
    }, { passive: true });

    dockEl.addEventListener('touchend', (e) => {
      if (inicioXDock === null || window.TerminalApp.vistaActiva !== 'pos') return;
      const finX = e.changedTouches[0] ? e.changedTouches[0].clientX : inicioXDock;
      const deltaX = finX - inicioXDock;
      inicioXDock = null;
      if (deltaX < -35) {
        ocultarDockEnPos();
      }
    }, { passive: true });

    dockEl.addEventListener('pointerdown', () => {
      if (window.TerminalApp.vistaActiva === 'pos') {
        mostrarDockEnPos(4200);
      }
    });
  }

  if (pestanaPosEl) {
    pestanaPosEl.addEventListener('click', (e) => {
      e.stopPropagation();
      mostrarDockEnPos(4200);
    });

    pestanaPosEl.addEventListener('touchstart', (e) => {
      inicioXPestana = e.touches[0] ? e.touches[0].clientX : null;
    }, { passive: true });

    pestanaPosEl.addEventListener('touchend', (e) => {
      if (inicioXPestana === null) return;
      const finX = e.changedTouches[0] ? e.changedTouches[0].clientX : inicioXPestana;
      const deltaX = finX - inicioXPestana;
      inicioXPestana = null;
      if (deltaX > 22) {
        mostrarDockEnPos(4200);
      }
    }, { passive: true });
  }
}

function actualizarPanelInicio(ctx) {
 if (!ctx) return;
 permisosActivosTerminal = resolverPermisosRolTerminal(ctx);
 const nomEl = document.getElementById('inicio-nombre-negocio');
 const rolEl = document.getElementById('inicio-operador-rol');
 const pinEl = document.getElementById('inicio-badge-pin');
 const badgeRolEl = document.getElementById('inicio-badge-rol');
 const horarioEl = document.getElementById('inicio-badge-horario');
 const sedeEl = document.getElementById('inicio-sede-txt');

 const nombreComercio = (datosNegocioTerminal && datosNegocioTerminal.nombre) || ctx.nombreComercio || ctx.nombreNegocio || ctx.comercio || 'Comercio activo';
 if (nomEl) nomEl.textContent = nombreComercio;
 const nombreOp = ctx.nombreOperador || ctx.nombre || ctx.email || 'Operador';
 if (rolEl) rolEl.textContent = nombreOp + ' · ' + permisosActivosTerminal.etiqueta;
 if (pinEl) pinEl.textContent = 'OP #' + (ctx.codigoCajero || localStorage.getItem('geokatu_cajero_pin') || '0000');
 if (badgeRolEl) badgeRolEl.textContent = permisosActivosTerminal.etiqueta.toUpperCase();
 if (horarioEl) {
 const h = ctx.horarioLaboral;
 if (h && h.activo) {
 const ini = h.hora_inicio_str || (Math.floor((Number(h.hora_inicio_minutos) || 420) / 60) + ':00');
 const fin = h.hora_fin_str || (Math.floor((Number(h.hora_fin_minutos) || 960) / 60) + ':00');
 horarioEl.textContent = 'Horario: ' + ini + ' - ' + fin;
 } else {
 horarioEl.textContent = 'Turno Abierto';
 }
 }
 if (sedeEl) sedeEl.textContent = obtenerSedeActiva(ctx.idNegocio);

  aplicarPermisosDockYCards(permisosActivosTerminal);
 actualizarEstadoRedYColaInicio();
 cargarCajasYEstadosInicio(ctx.idNegocio, false);
 cargarTareasTurnoInicio(ctx);
 hidratarAvatarInicioShell_(ctx);
}

function cerrarVisor25dSiAbierto() {
  const frameMapa = FRAMES.mapa;
  if (!frameMapa || !frameMapa.contentDocument) return false;
  const doc = frameMapa.contentDocument;
  const visor = doc.getElementById('visor-alzado-pip');
  if (visor && !visor.classList.contains('oculto')) {
    const btnCerrar = doc.getElementById('btn-cerrar-alzado');
    if (btnCerrar) btnCerrar.click();
    else visor.classList.add('oculto');
    return true;
  }
  return false;
}

window.TerminalApp = {
  vistaActiva: 'pos',
  esTerminalUnificada: true,

  obtenerContextoSesion() {
    return contextoSesionActivo;
  },

  registrarModuloHijo(hooks) {
    if (!hooks) return () => {};
    modulosHijosRegistrados.add(hooks);
    if (contextoSesionActivo && typeof hooks.onSesion === 'function') {
      try { hooks.onSesion(contextoSesionActivo); } catch (e) {}
    }
    return () => modulosHijosRegistrados.delete(hooks);
  },

  notificarActividad() {
    const ahora = Date.now();
    if (ahora - timerActividadThrottle < 4500) return;
    timerActividadThrottle = ahora;
    if (AuthGate && typeof AuthGate._reiniciarRelojInactividad === 'function') {
      try { AuthGate._reiniciarRelojInactividad(); } catch (e) {}
    } else {
      window.dispatchEvent(new Event('touchstart'));
    }
  },

  solicitarBloqueo() {
    if (ScannerHub && ScannerHub.estaAbierto()) {
      ScannerHub.cerrar({ silencioso: true, restaurarFoco: false });
    }
    if (AuthGate && typeof AuthGate.bloquearTerminalPorInactividad === 'function') {
      AuthGate.bloquearTerminalPorInactividad();
    }
  },

    solicitarCerrarSesion() {
    if (ScannerHub && ScannerHub.estaAbierto()) {
      ScannerHub.cerrar({ silencioso: true, restaurarFoco: false });
    }
    if (AuthGate && typeof AuthGate.cerrarSesion === 'function') {
      AuthGate.cerrarSesion();
    }
  },

   alternarModoEditorMapa(forzarEditor) {
 const frameMapa = FRAMES.mapa;
 if (!frameMapa) return;
 const proximo = typeof forzarEditor === 'boolean' ? forzarEditor : !modoEditorMapaActivo;
 if (proximo && permisosActivosTerminal && !permisosActivosTerminal.croquis) {
 alert('Tu rol actual no tiene permiso para editar el croquis de tienda.');
 return;
 }
 modoEditorMapaActivo = proximo;
    const txtBtn = document.getElementById('txt-switch-editor-mapa');
    const btnSwitch = document.getElementById('btn-switch-editor-mapa');
    if (modoEditorMapaActivo) {
      frameMapa.src = 'mapatienda?embed=terminal';
      if (txtBtn) txtBtn.textContent = 'Volver al Radar';
      if (btnSwitch) btnSwitch.style.background = 'linear-gradient(135deg, #ff8c00, #ff6b00)';
    } else {
      frameMapa.src = 'inventario?embed=terminal';
      if (txtBtn) txtBtn.textContent = 'Editar Mapa';
      if (btnSwitch) btnSwitch.style.background = 'linear-gradient(135deg, #2563eb, #1d4ed8)';
    }
    if (this.vistaActiva !== 'mapa') {
      this.irAVista('mapa');
    }
  },

   irAVista(destino, params, opciones) {
 const vistaSolicitada = ['inicio', 'pos', 'stock', 'mapa'].indexOf(destino) !== -1 ? destino : 'pos';
 const vista = obtenerVistaPermitidaFallback_(vistaSolicitada);
 const opts = opciones || {};
 const prevVista = this.vistaActiva;

    if (ScannerHub && ScannerHub.estaAbierto()) {
      ScannerHub.cerrar({ silencioso: true, restaurarFoco: false });
    }

    if (prevVista === 'pos') {
      leerEstadoTicketDesdePos();
    }

    this.vistaActiva = vista;

    Object.keys(VISTAS).forEach((k) => {
      if (VISTAS[k]) VISTAS[k].classList.toggle('activa', k === vista);
    });

    dockEl.querySelectorAll('.dock-item').forEach((btn) => {
      btn.classList.toggle('activo', btn.getAttribute('data-vista') === vista);
    });

    const esPos = (vista === 'pos');
    shellEl.classList.toggle('en-pos', esPos);

    if (esPos) {
      // Mostrar brevemente y deslizar lento a la izquierda para que el cajero vea donde queda
      mostrarDockEnPos(prevVista === 'pos' ? 4000 : 1200);
    } else {
      cancelarTimerDock();
      shellEl.classList.remove('dock-oculto');
    }

    pintarBarraVolverVenta();

     if (vista === 'inicio' && contextoSesionActivo) {
 actualizarEstadoRedYColaInicio();
 cargarCajasYEstadosInicio(contextoSesionActivo.idNegocio, false);
 } else if (vista !== 'inicio') {
 asegurarFrameCargado(vista);
 }

    if (vista === 'mapa' && params && params.buscar) {
      ejecutarCuandoBridgeExista('mapa', '__gkMapaEnfocar', (win) => {
        win.__gkMapaEnfocar(params.buscar, params.sede || null);
      });
    }

    if (vista === 'stock' && params && (params.mueble || params.bin || params.buscar)) {
      ejecutarCuandoBridgeExista('stock', '__gkStockAplicarUbicacion', (win) => {
        win.__gkStockAplicarUbicacion({
          mueble: params.mueble || null,
          bin: params.bin || null,
          codigoProd: params.buscar || null,
          idSede: params.sede || null
        });
      });
    }

    if (!opts.desdePopstate && prevVista !== vista) {
      try {
        window.history.pushState({ gkVista: vista }, '');
      } catch (eHist) {}
    }
  },

  abrirEscaner(modoOpcional, origenEl, extras) {
    if (!contextoSesionActivo || (AuthGate._estado && AuthGate._estado.sesionBloqueada)) return;
    const modo = modoOpcional || MODOS_POR_VISTA[this.vistaActiva] || 'CONSULTAR';
    const extra = extras || {};
    const idNegocio = contextoSesionActivo.idNegocio || localStorage.getItem('geokatu_active_uid') || '';
    const idSede = obtenerSedeActiva(idNegocio);

    ScannerHub.abrir({
      modoInicial: modo,
      origenEl: origenEl || document.getElementById('btn-dock-escaner'),
      idNegocio: idNegocio,
      idSede: idSede,
      muebleInicial: extra.muebleInicial || null,
      binInicial: extra.binInicial || null,
      productoInicial: extra.productoInicial || null,
      onVender: (codigo) => {
        ejecutarCuandoBridgeExista('pos', '__gkPosProcesarCodigo', (win) => {
          win.__gkPosProcesarCodigo(codigo);
          setTimeout(leerEstadoTicketDesdePos, 120);
        });
      },
      onVerEnMapa: (datos) => {
        if (!datos) return;
        const termino = (datos.ubicacion && datos.ubicacion.id_compartimiento)
          ? datos.ubicacion.id_compartimiento
          : (datos.codigo || '');
        this.irAVista('mapa', { buscar: termino, sede: datos.idSede || idSede });
      },
      onUbicar: (est) => {
        this.irAVista('stock', {
          sede: est.idSede || idSede,
          mueble: est.mueble || null,
          bin: est.bin || null,
          buscar: est.codigoProd || null
        });
      }
    });
  }
};

// Eventos de navegacion del Dock e Inicio
dockEl.querySelectorAll('.dock-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const v = btn.getAttribute('data-vista');
    if (v) window.TerminalApp.irAVista(v);
  });
});

document.getElementById('btn-dock-escaner').addEventListener('click', (e) => {
  window.TerminalApp.abrirEscaner(null, e.currentTarget);
});

barraVentaEl.addEventListener('click', () => {
  window.TerminalApp.irAVista('pos');
});

document.querySelectorAll('[data-ir]').forEach((btn) => {
  btn.addEventListener('click', () => {
    window.TerminalApp.irAVista(btn.getAttribute('data-ir'));
  });
});

document.getElementById('btn-inicio-escaner').addEventListener('click', (e) => {
  const modoEsc = (permisosActivosTerminal && !permisosActivosTerminal.pos && permisosActivosTerminal.stock) ? 'UBICAR' : 'CONSULTAR';
  window.TerminalApp.abrirEscaner(modoEsc, e.currentTarget);
});
document.getElementById('btn-inicio-croquis').addEventListener('click', function() {
 if (permisosActivosTerminal && !permisosActivosTerminal.croquis) return;
 window.location.href = 'mapatienda';
});
document.getElementById('btn-inicio-oficina').addEventListener('click', function() {
 if (permisosActivosTerminal && !permisosActivosTerminal.oficina) return;
 window.location.href = 'oficina';
});
let uidPerfilShellActivo = null;

function aplicarAvatarShellDOM_(urlFoto) {
 const imgTop = document.getElementById('inicio-avatar-img');
 const svgTop = document.getElementById('inicio-avatar-svg');
 const imgMod = document.getElementById('emp-shell-avatar');
 const svgMod = document.getElementById('emp-shell-avatar-svg');
 if (urlFoto) {
 if (imgTop) { imgTop.src = urlFoto; imgTop.style.display = 'block'; }
 if (svgTop) svgTop.style.display = 'none';
 if (imgMod) { imgMod.src = urlFoto; imgMod.style.display = 'block'; }
 if (svgMod) svgMod.style.display = 'none';
 }
}

async function hidratarAvatarInicioShell_(ctx) {
 try {
 const authMod = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js');
 const u = authMod.getAuth().currentUser;
 uidPerfilShellActivo = (ctx && ctx.operadorUid) || (u && u.uid) || localStorage.getItem('geokatu_auth_uid') || null;
 if (!uidPerfilShellActivo) return;
 const emailAct = (ctx && ctx.email) || (u && u.email) || '';
 const res = await GeokatuDB.SecurityService.obtenerPerfilLaboralEmpleado(uidPerfilShellActivo, emailAct);
 if (res && res.success && res.empleado && res.empleado.foto) {
 aplicarAvatarShellDOM_(res.empleado.foto);
 }
 } catch (eAv) {}
}

async function abrirModalPerfilEmpleadoShell_() {
 const modal = document.getElementById('modal-perfil-empleado');
 if (!modal) return;
 const dd = document.getElementById('dropdown-terminal-menu');
 if (dd) dd.classList.remove('activo');
 modal.classList.add('activo');

 const ctx = contextoSesionActivo || {};
 const pinEl = document.getElementById('emp-shell-pin');
 const rolEl = document.getElementById('emp-shell-rol');
 const mailEl = document.getElementById('emp-shell-email');
 const nomInp = document.getElementById('emp-shell-nombre');
 const telInp = document.getElementById('emp-shell-tel');
 const histCont = document.getElementById('emp-shell-historial-24h');
 const histCount = document.getElementById('emp-shell-hist-count');

 if (pinEl) pinEl.textContent = 'PIN: ' + (ctx.codigoCajero || localStorage.getItem('geokatu_cajero_pin') || '0000');
 if (rolEl) rolEl.textContent = (permisosActivosTerminal && permisosActivosTerminal.etiqueta) || 'Operario';
 if (mailEl) mailEl.textContent = ctx.email || '';
 if (nomInp && !nomInp.value) nomInp.value = ctx.nombreOperador || ctx.nombre || '';
 if (histCont) histCont.innerHTML = '<p style="margin:8px 0; font-size:11px; color:var(--gk-muted); text-align:center;">Consultando conexiones...</p>';

 try {
 const authMod = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js');
 const u = authMod.getAuth().currentUser;
 uidPerfilShellActivo = (ctx && ctx.operadorUid) || (u && u.uid) || localStorage.getItem('geokatu_auth_uid') || null;
 const emailAct = (ctx && ctx.email) || (u && u.email) || '';
 if (mailEl && emailAct) mailEl.textContent = emailAct;
 if (!uidPerfilShellActivo) return;
 const res = await GeokatuDB.SecurityService.obtenerPerfilLaboralEmpleado(uidPerfilShellActivo, emailAct);
 if (res && res.success) {
 const emp = res.empleado || {};
 if (nomInp) nomInp.value = emp.nombre || ctx.nombreOperador || ctx.nombre || '';
 if (telInp) telInp.value = emp.telefono || '';
 if (emp.foto) aplicarAvatarShellDOM_(emp.foto);
 const listaC = Array.isArray(res.conexionesUltimoDia) ? res.conexionesUltimoDia : [];
 if (histCount) histCount.textContent = String(listaC.length);
 if (histCont) {
 if (listaC.length === 0) {
 histCont.innerHTML = '<p style="margin:8px 0; font-size:11px; color:var(--gk-muted); text-align:center;">Sin registros en las últimas 24 horas.</p>';
 } else {
 histCont.innerHTML = listaC.map(function(c) {
 const hora = c.fecha ? new Date(c.fecha).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '--:--';
 return '<div class="caja-admin-fila"><div><strong style="color:#fff; display:block;">' + escaparHtmlShell(c.modulo || 'Terminal') + '</strong><span style="font-size:10px; color:var(--gk-muted);">' + escaparHtmlShell((c.comercio || '') + ' · ' + (c.sede || '')) + '</span></div><span style="color:var(--gk-verde); font-family:monospace; font-weight:800;">' + hora + '</span></div>';
 }).join('');
 }
 }
 }
 } catch (ePerf) {
 if (histCont) histCont.innerHTML = '<p style="margin:8px 0; font-size:11px; color:var(--gk-muted); text-align:center;">No se pudo consultar el historial.</p>';
 }
}

const btnPerfilEmp = document.getElementById('btn-inicio-perfil-emp');
if (btnPerfilEmp) btnPerfilEmp.addEventListener('click', abrirModalPerfilEmpleadoShell_);
const btnAvatarPerfil = document.getElementById('btn-avatar-abrir-perfil');
if (btnAvatarPerfil) btnAvatarPerfil.addEventListener('click', abrirModalPerfilEmpleadoShell_);
const ddBtnPerfil = document.getElementById('dd-btn-mi-perfil');
if (ddBtnPerfil) ddBtnPerfil.addEventListener('click', abrirModalPerfilEmpleadoShell_);
const btnSyncInicio = document.getElementById('btn-inicio-sync');
if (btnSyncInicio) {
 btnSyncInicio.addEventListener('click', async function() {
 const idNeg = (contextoSesionActivo && contextoSesionActivo.idNegocio) || localStorage.getItem('geokatu_active_uid') || '';
 if (!idNeg) return;
 btnSyncInicio.disabled = true;
 btnSyncInicio.textContent = 'Sincronizando...';
 try {
 await GeokatuDB.sincronizarPendientesOperativos(idNeg);
 await cargarCajasYEstadosInicio(idNeg, true);
 actualizarEstadoRedYColaInicio();
 } finally {
 btnSyncInicio.disabled = false;
 btnSyncInicio.textContent = 'Sincronizar';
 }
 });
}
const selectCajaTerminal = document.getElementById('select-caja-terminal');
if (selectCajaTerminal) {
 selectCajaTerminal.addEventListener('change', function() {
 const idNeg = (contextoSesionActivo && contextoSesionActivo.idNegocio) || localStorage.getItem('geokatu_active_uid') || '';
 const cajaAnterior = localStorage.getItem('geokatu_caja_num') || 'CAJA-01';
 const nuevaCaja = selectCajaTerminal.value;
 if (!nuevaCaja || nuevaCaja === cajaAnterior) return;
 let turnoLocalAbierto = false;
 try {
 const rawT = localStorage.getItem('geokatu_caja_activa_' + idNeg + '_' + cajaAnterior);
 if (rawT && JSON.parse(rawT).estado === 'ABIERTA') turnoLocalAbierto = true;
 } catch (eT) {}
 if (turnoLocalAbierto) {
 alert('La caja ' + cajaAnterior + ' tiene un turno abierto en este dispositivo. Haz Cierre Z antes de cambiar de caja.');
 selectCajaTerminal.value = cajaAnterior;
 return;
 }
 localStorage.setItem('geokatu_caja_num', nuevaCaja);
 pintarResumenCajasInicio();
 if (framesCargados.pos) {
 ejecutarCuandoBridgeExista('pos', '__gkPosCambiarCaja', function(win) {
 win.__gkPosCambiarCaja(nuevaCaja);
 });
 }
 });
}
const btnToggleAdminCajas = document.getElementById('btn-toggle-admin-cajas');
if (btnToggleAdminCajas) {
 btnToggleAdminCajas.addEventListener('click', function() {
 const modalCajas = document.getElementById('modal-admin-cajas');
 if (modalCajas) modalCajas.classList.add('activo');
 const idNeg = (contextoSesionActivo && contextoSesionActivo.idNegocio) || localStorage.getItem('geokatu_active_uid') || '';
 if (idNeg) cargarCajasYEstadosInicio(idNeg, false);
 });
}
const btnCrearCajaPos = document.getElementById('btn-crear-caja-pos');
if (btnCrearCajaPos) {
 btnCrearCajaPos.addEventListener('click', async function() {
 if (!permisosActivosTerminal || !permisosActivosTerminal.adminCajas) return;
 const idNeg = (contextoSesionActivo && contextoSesionActivo.idNegocio) || localStorage.getItem('geokatu_active_uid') || '';
 const inpNom = document.getElementById('input-nueva-caja-nombre');
 let maxNum = 1;
 cajasComercioCache.forEach(function(c) {
 const m = String(c.id || '').match(/(\d+)$/);
 if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
 });
 const nuevoId = 'CAJA-' + String(maxNum + 1).padStart(2, '0');
 const nombre = (inpNom && inpNom.value.trim()) ? inpNom.value.trim() : ('Caja ' + (maxNum + 1));
 cajasComercioCache.push({ id: nuevoId, nombre: nombre, sede: obtenerSedeActiva(idNeg), activa: true });
 btnCrearCajaPos.disabled = true;
 try {
 const resG = await GeokatuDB.PosService.guardarCajasComercio(idNeg, cajasComercioCache);
 if (resG && resG.success) {
 if (inpNom) inpNom.value = '';
 await cargarCajasYEstadosInicio(idNeg, false);
 } else {
 alert('No se pudo crear la caja: ' + ((resG && resG.error) || 'Error desconocido'));
 }
 } finally {
 btnCrearCajaPos.disabled = false;
 }
 });
}
const btnToggleFiscal = document.getElementById('btn-toggle-fiscal-terminal');
if (btnToggleFiscal) {
 btnToggleFiscal.addEventListener('click', function() {
 const modalF = document.getElementById('modal-fiscal-terminal');
 if (modalF) modalF.classList.add('activo');
 });
}
const inpNitTerm = document.getElementById('term-fisc-nit');
if (inpNitTerm) {
 inpNitTerm.addEventListener('input', function() {
 const paisSel = (document.getElementById('term-fisc-pais')?.value || 'COL');
 const val = inpNitTerm.value.replace(/\D/g, '');
 const dvEl = document.getElementById('term-fisc-dv');
 if (paisSel === 'COL' && val.length >= 6 && dvEl) {
 dvEl.value = calcularDVTerminal(val);
 }
 });
}
const btnGuardarFiscal = document.getElementById('btn-guardar-fiscal-terminal');
if (btnGuardarFiscal) {
 btnGuardarFiscal.addEventListener('click', async function() {
 if (!permisosActivosTerminal || !permisosActivosTerminal.configFiscal) return;
 const idNeg = (contextoSesionActivo && contextoSesionActivo.idNegocio) || localStorage.getItem('geokatu_active_uid') || '';
 if (!idNeg) return;
 const paisAnterior = datosNegocioTerminal.pais || localStorage.getItem('geokatu_pais_' + idNeg) || 'COL';
 const paisElegido = (document.getElementById('term-fisc-pais')?.value || 'COL');
 const perfilFiscal = {
 razon_social: (document.getElementById('term-fisc-razon')?.value || '').trim() || datosNegocioTerminal.nombre || 'GEOKATU COMERCIO',
 codigo_tienda: ((document.getElementById('term-fisc-tienda')?.value || 'T-01').trim() || 'T-01').toUpperCase(),
 nit: (document.getElementById('term-fisc-nit')?.value || '').trim(),
 dv: (document.getElementById('term-fisc-dv')?.value || '').trim(),
 regimen_tributario: document.getElementById('term-fisc-regimen')?.value || 'RESPONSABLE_IVA',
 direccion: (document.getElementById('term-fisc-dir')?.value || '').trim(),
 siigo_user: (document.getElementById('term-fisc-siigo-user')?.value || '').trim(),
 siigo_key: (document.getElementById('term-fisc-siigo-key')?.value || '').trim(),
 codigo_tipo_comprobante: Number(document.getElementById('term-fisc-siigo-doc')?.value) || 1150,
 id_impuesto_iva_siigo: Number(document.getElementById('term-fisc-siigo-iva')?.value) || 1284
 };
 btnGuardarFiscal.disabled = true;
 btnGuardarFiscal.textContent = 'Guardando...';
 try {
 const payloadF = { pais: paisElegido, perfil_fiscal: perfilFiscal };
 const resUpd = await GeokatuDB.AdminService.actualizarNegocio(idNeg, payloadF);
 if (!resUpd || !resUpd.success) throw new Error((resUpd && resUpd.error) || 'Error guardando perfil fiscal');
 Object.assign(datosNegocioTerminal, payloadF);
 localStorage.setItem('geokatu_pais_' + idNeg, paisElegido);
 localStorage.setItem('geokatu_perfil_' + idNeg, JSON.stringify(perfilFiscal));
 hidratarBloqueFiscalTerminal(datosNegocioTerminal);
  const modalF = document.getElementById('modal-fiscal-terminal');
 if (modalF) modalF.classList.remove('activo');
 if (paisElegido !== paisAnterior) {
 RUTAS_FRAMES.pos = paisElegido === 'VEN' ? 'posven?embed=terminal' : 'pos?embed=terminal';
 if (FRAMES.pos && framesCargados.pos) {
 framesCargados.pos = false;
 FRAMES.pos.dataset.iniciado = '1';
 FRAMES.pos.src = RUTAS_FRAMES.pos;
 }
 }
 alert('Perfil fiscal y régimen POS actualizados.');
 } catch (eF) {
 alert('Error al guardar: ' + eF.message);
 } finally {
 btnGuardarFiscal.disabled = false;
 btnGuardarFiscal.textContent = 'Guardar Perfil Fiscal y País POS';
 }
 });
}
const btnPasarelas = document.getElementById('btn-inicio-pasarelas');
if (btnPasarelas) {
 btnPasarelas.addEventListener('click', function() {
 const idNeg = (contextoSesionActivo && contextoSesionActivo.idNegocio) || localStorage.getItem('geokatu_active_uid') || '';
 window.location.href = '/pasarelas' + (idNeg ? ('?id=' + encodeURIComponent(idNeg)) : '');
 });
}
const btnGerencial = document.getElementById('btn-inicio-gerencial');
if (btnGerencial) {
 btnGerencial.addEventListener('click', function() {
 window.open('admin-gerencial', '_blank');
 });
}
window.addEventListener('online', actualizarEstadoRedYColaInicio);
window.addEventListener('offline', actualizarEstadoRedYColaInicio);
const btnTermMenu = document.getElementById('btn-terminal-menu');
const ddTermMenu = document.getElementById('dropdown-terminal-menu');
if (btnTermMenu && ddTermMenu) {
 btnTermMenu.addEventListener('click', function(e) {
 e.stopPropagation();
 ddTermMenu.classList.toggle('activo');
 });
 document.addEventListener('click', function(e) {
 if (!e.target.closest('#dropdown-terminal-menu') && !e.target.closest('#btn-terminal-menu')) {
 ddTermMenu.classList.remove('activo');
 }
 });
}
const ddBtnOfi = document.getElementById('dd-btn-oficina');
if (ddBtnOfi) {
 ddBtnOfi.addEventListener('click', function() {
 if (ddTermMenu) ddTermMenu.classList.remove('activo');
 if (permisosActivosTerminal && permisosActivosTerminal.oficina) window.location.href = 'oficina';
 });
}
const btnAbrirTareas = document.getElementById('btn-abrir-modal-tareas');
if (btnAbrirTareas) {
 btnAbrirTareas.addEventListener('click', function() {
 const mT = document.getElementById('modal-tareas-turno');
 if (mT) mT.classList.add('activo');
 if (contextoSesionActivo) cargarTareasTurnoInicio(contextoSesionActivo);
 });
}
const btnCrearTareaShell = document.getElementById('btn-shell-crear-tarea');
if (btnCrearTareaShell) {
 btnCrearTareaShell.addEventListener('click', async function() {
 if (!contextoSesionActivo || !contextoSesionActivo.idNegocio) return;
 if (!permisosActivosTerminal || !permisosActivosTerminal.asignarTareas) return;
 const inpTit = document.getElementById('shell-tarea-titulo');
 const selPri = document.getElementById('shell-tarea-prioridad');
 const titulo = inpTit ? inpTit.value.trim() : '';
 if (!titulo) return;
 btnCrearTareaShell.disabled = true;
 try {
 await setDoc(doc(collection(db, 'Directorio/' + contextoSesionActivo.idNegocio + '/Tareas_Internas')), {
 titulo: titulo,
 destinatario_uid: 'TODOS',
 prioridad: (selPri && selPri.value) || 'NORMAL',
 completada: false,
 creada_por: contextoSesionActivo.nombre || ('OP #' + (contextoSesionActivo.codigoCajero || '0000')),
 fecha_creacion: new Date().toISOString()
 });
 if (inpTit) inpTit.value = '';
 await cargarTareasTurnoInicio(contextoSesionActivo);
 } catch (eNT) {
 alert('No se pudo publicar la tarea: ' + eNT.message);
 } finally {
 btnCrearTareaShell.disabled = false;
 }
 });
}
document.querySelectorAll('.emp-tab-btn').forEach(function(tabBtn) {
 tabBtn.addEventListener('click', function() {
 const target = tabBtn.getAttribute('data-emp-tab');
 document.querySelectorAll('.emp-tab-btn').forEach(function(b) { b.classList.toggle('activo', b === tabBtn); });
 document.querySelectorAll('.emp-tab-panel').forEach(function(p) { p.classList.toggle('activo', p.id === 'emp-panel-' + target); });
 });
});
const btnGuardarEmpShell = document.getElementById('btn-emp-shell-guardar');
if (btnGuardarEmpShell) {
 btnGuardarEmpShell.addEventListener('click', async function() {
 if (!uidPerfilShellActivo) return alert('Sesión de usuario no disponible.');
 const nombre = (document.getElementById('emp-shell-nombre')?.value || '').trim();
 const tel = (document.getElementById('emp-shell-tel')?.value || '').trim();
 btnGuardarEmpShell.disabled = true;
 try {
 const payloadEmp = { telefono: tel };
 if (nombre) payloadEmp.nombre = nombre;
 const r = await GeokatuDB.SecurityService.actualizarDatosPersonalesEmpleado(uidPerfilShellActivo, payloadEmp);
 alert(r && r.success ? 'Datos personales actualizados.' : ('Error: ' + ((r && r.error) || 'No se pudo guardar')));
 } finally {
 btnGuardarEmpShell.disabled = false;
 }
 });
}
const fileFotoEmpShell = document.getElementById('emp-shell-file-foto');
if (fileFotoEmpShell) {
 fileFotoEmpShell.addEventListener('change', async function(e) {
 const f = e.target.files && e.target.files[0];
 if (!f || !uidPerfilShellActivo) return;
 try {
 const blob = await GeokatuDB.AdminService.comprimirAWebP(f, 400, 0.8, true, false);
 const url = await GeokatuDB.AdminService.subirArchivo('operadores/' + uidPerfilShellActivo + '/avatar_' + Date.now() + '.webp', blob, 'image/webp');
 const urlStr = typeof url === 'string' ? url : ((url && (url.url || url.data)) || '');
 if (urlStr) {
 aplicarAvatarShellDOM_(urlStr);
 await GeokatuDB.SecurityService.actualizarDatosPersonalesEmpleado(uidPerfilShellActivo, { foto: urlStr });
 }
 } catch (errF) {
 alert('No se pudo subir la foto: ' + errF.message);
 }
 });
}
const btnPassEmpShell = document.getElementById('btn-emp-shell-pass');
if (btnPassEmpShell) {
 btnPassEmpShell.addEventListener('click', async function() {
 const p1 = document.getElementById('emp-shell-pass1')?.value || '';
 const p2 = document.getElementById('emp-shell-pass2')?.value || '';
 if (p1.length < 6) return alert('La contraseña debe tener mínimo 6 caracteres.');
 if (p1 !== p2) return alert('Las contraseñas no coinciden.');
 btnPassEmpShell.disabled = true;
 try {
 const authMod = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js');
 const userAct = authMod.getAuth().currentUser;
 if (!userAct) throw new Error('Inicia sesión con tu correo y clave para cambiar la contraseña.');
 await authMod.updatePassword(userAct, p1);
 document.getElementById('emp-shell-pass1').value = '';
 document.getElementById('emp-shell-pass2').value = '';
 alert('Contraseña actualizada correctamente.');
 } catch (errP) {
 if (errP && errP.code === 'auth/requires-recent-login') {
 alert('Por seguridad, cierra sesión e ingresa de nuevo con tu correo antes de cambiar la contraseña.');
 } else {
 alert('No se pudo cambiar la contraseña: ' + errP.message);
 }
 } finally {
 btnPassEmpShell.disabled = false;
 }
 });
}
document.getElementById('btn-inicio-bloquear').addEventListener('click', function() {
 if (ddTermMenu) ddTermMenu.classList.remove('activo');
 window.TerminalApp.solicitarBloqueo();
});
document.getElementById('btn-inicio-salir').addEventListener('click', function() {
 if (ddTermMenu) ddTermMenu.classList.remove('activo');
 window.TerminalApp.solicitarCerrarSesion();
});

// Gestion unificada de Boton Atras de Android (ScannerHub -> 2.5D en Mapa -> Vista anterior)
window.addEventListener('popstate', (e) => {
  if (ScannerHub && ScannerHub.estaAbierto()) return;

  if (window.TerminalApp.vistaActiva === 'mapa' && cerrarVisor25dSiAbierto()) {
    try {
      window.history.pushState({ gkVista: 'mapa' }, '');
    } catch (errH) {}
    return;
  }

  const estado = e && e.state ? e.state : null;
  if (estado && estado.gkVista) {
    window.TerminalApp.irAVista(estado.gkVista, {}, { desdePopstate: true });
  } else if (window.TerminalApp.vistaActiva !== 'pos') {
    window.TerminalApp.irAVista('pos', {}, { desdePopstate: true });
  }
});

// Propagacion de bloqueo de terminal a todos los modulos embebidos
window.addEventListener('gk:terminal-bloqueada', (e) => {
  const motivo = e && e.detail ? e.detail.motivo : 'bloqueo';
  modulosHijosRegistrados.forEach((h) => {
    if (typeof h.onBloqueo === 'function') {
      try { h.onBloqueo(motivo); } catch (err) {}
    }
  });
});

configurarGestosDockPos();

// Inicializacion UNICA de AuthGate para toda la terminal
AuthGate.inicializar({
  tituloModulo: 'GeoKATU Terminal',
  subtituloModulo: 'Verifica tu identidad para iniciar operaciones',
  precargarNomina: true,
   onSesionLista: async (contexto) => {
 contextoSesionActivo = contexto;
 permisosActivosTerminal = resolverPermisosRolTerminal(contexto);
 let paisComercio = localStorage.getItem('geokatu_pais_' + contexto.idNegocio) || '';
 try {
 const resDet = await GeokatuDB.LocalService.getDetails(contexto.idNegocio);
 if (resDet && resDet.success && resDet.data) {
 datosNegocioTerminal = resDet.data;
 if (resDet.data.pais) {
 paisComercio = resDet.data.pais;
 localStorage.setItem('geokatu_pais_' + contexto.idNegocio, paisComercio);
 }
 }
 } catch (eDet) {}
 RUTAS_FRAMES.pos = (paisComercio === 'VEN') ? 'posven?embed=terminal' : 'pos?embed=terminal';
 hidratarBloqueFiscalTerminal(datosNegocioTerminal);
 shellEl.classList.add('listo');
 actualizarPanelInicio(contexto);

 modulosHijosRegistrados.forEach(function(h) {
 if (typeof h.onSesion === 'function') {
 try { h.onSesion(contexto); } catch (err) {}
 }
 });

 const params = new URLSearchParams(window.location.search);
 const vistaParam = params.get('vista') || 'pos';
 const vistaInicial = obtenerVistaPermitidaFallback_(vistaParam);
 try {
 window.history.replaceState({ gkVista: vistaInicial }, '');
 } catch (eR) {}

 if (permisosActivosTerminal.pos) {
 asegurarFrameCargado('pos');
 }
 window.TerminalApp.irAVista(vistaInicial, {}, { desdePopstate: true });
 },
  onCerrarSesion: () => {
    contextoSesionActivo = null;
    resumenVentaActual = { unidades: 0, totalTexto: '$0', activo: false };
    pintarBarraVolverVenta();
    modulosHijosRegistrados.forEach((h) => {
      if (typeof h.onLogout === 'function') {
        try { h.onLogout(); } catch (err) {}
      }
    });
    shellEl.classList.remove('listo');
  }
});
