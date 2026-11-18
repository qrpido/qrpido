/**
 * GEOKATU - Panel Compartido de Escaner (Vender | Consultar | Ubicar)
 * Archivo: public/scanner-hub.js
 * Una sola instancia de Html5Qrcode, descarte de lecturas al cambiar de modo,
 * soporte de multiples ubicaciones por sede y liberacion en X / Atras / bloqueo.
 */

import GeokatuDB from './core-db.js';
import { AuthGate } from './auth-gate.js';

const SVG_HUB = {
  cerrar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  rayo: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  flecha: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>'
};

const SVG_PLACEHOLDER_PROD = "data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Crect%20width='100'%20height='100'%20rx='14'%20fill='%23101014'/%3E%3Ctext%20x='50'%20y='54'%20fill='%23ff6b00'%20font-family='sans-serif'%20font-size='11'%20font-weight='900'%20text-anchor='middle'%3ESKU%3C/text%3E%3C/svg%3E";

function inyectarEstilosScannerHub() {
  if (document.getElementById('gk-scanner-hub-estilos')) return;
  const style = document.createElement('style');
  style.id = 'gk-scanner-hub-estilos';
  style.textContent = [
    '.gk-sh-overlay {',
    ' position: fixed;',
    ' inset: 0;',
    ' background: rgba(0, 0, 0, 0.68);',
    ' backdrop-filter: blur(6px);',
    ' -webkit-backdrop-filter: blur(6px);',
    ' z-index: 999900;',
    ' display: none;',
    ' align-items: flex-end;',
    ' justify-content: center;',
    ' font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
    ' box-sizing: border-box;',
    '}',
    '.gk-sh-overlay.activo { display: flex; }',
    '.gk-sh-sheet {',
    ' width: 100%;',
    ' max-width: 480px;',
    ' background: #141419;',
    ' border-top: 1px solid rgba(255, 255, 255, 0.14);',
    ' border-radius: 22px 22px 0 0;',
    ' padding: 10px 16px max(16px, env(safe-area-inset-bottom)) 16px;',
    ' box-shadow: 0 -16px 45px rgba(0, 0, 0, 0.92);',
    ' display: flex;',
    ' flex-direction: column;',
    ' gap: 12px;',
    ' box-sizing: border-box;',
    ' max-height: 92dvh;',
    ' overflow-y: auto;',
    '}',
    '.gk-sh-handle {',
    ' width: 44px;',
    ' height: 4px;',
    ' border-radius: 99px;',
    ' background: rgba(255, 255, 255, 0.24);',
    ' margin: 0 auto;',
    '}',
    '.gk-sh-header {',
    ' display: flex;',
    ' align-items: center;',
    ' justify-content: space-between;',
    '}',
    '.gk-sh-titulo {',
    ' margin: 0;',
    ' font-size: 20px;',
    ' font-weight: 900;',
    ' color: #ffffff;',
    ' letter-spacing: 0.2px;',
    '}',
    '.gk-sh-btn-cerrar {',
    ' width: 40px;',
    ' height: 40px;',
    ' border-radius: 10px;',
    ' border: 1px solid rgba(255, 255, 255, 0.12);',
    ' background: rgba(255, 255, 255, 0.05);',
    ' color: #d1d5db;',
    ' display: flex;',
    ' align-items: center;',
    ' justify-content: center;',
    ' cursor: pointer;',
    '}',
    '.gk-sh-modos {',
    ' display: grid;',
    ' grid-template-columns: repeat(3, 1fr);',
    ' background: #0c0c10;',
    ' border: 1px solid rgba(255, 255, 255, 0.12);',
    ' border-radius: 12px;',
    ' padding: 3px;',
    ' gap: 4px;',
    '}',
    '.gk-sh-modo-btn {',
    ' min-height: 40px;',
    ' border: 1px solid transparent;',
    ' border-radius: 9px;',
    ' background: transparent;',
    ' color: #9ca3af;',
    ' font-size: 13px;',
    ' font-weight: 700;',
    ' cursor: pointer;',
    ' transition: all 0.15s ease;',
    '}',
    '.gk-sh-modo-btn.activo {',
    ' background: rgba(255, 107, 0, 0.24);',
    ' border-color: #ff6b00;',
    ' color: #ffffff;',
    ' font-weight: 900;',
    ' box-shadow: 0 0 12px rgba(255, 107, 0, 0.22);',
    '}',
    '.gk-sh-visor-wrap {',
    ' position: relative;',
    ' width: 100%;',
    ' height: 205px;',
    ' border-radius: 14px;',
    ' overflow: hidden;',
    ' background: #000000;',
    ' border: 1px solid rgba(255, 255, 255, 0.14);',
    '}',
    '#gk-sh-lector { width: 100%; height: 100%; }',
    '#gk-sh-lector video {',
    ' width: 100% !important;',
    ' height: 100% !important;',
    ' object-fit: cover !important;',
    ' display: block !important;',
    '}',
    '#gk-sh-lector #qr-shaded-region,',
    '#gk-sh-lector [id*="scan_region"],',
    '#gk-sh-lector [id*="shaded_region"] { display: none !important; }',
    '.gk-sh-reticula {',
    ' position: absolute;',
    ' inset: 22% 16%;',
    ' pointer-events: none;',
    ' z-index: 4;',
    '}',
    '.gk-sh-esquina {',
    ' position: absolute;',
    ' width: 22px;',
    ' height: 22px;',
    ' border-color: #ff6b00;',
    ' border-style: solid;',
    ' border-width: 0;',
    '}',
    '.gk-sh-esquina.tl { top: 0; left: 0; border-top-width: 3.5px; border-left-width: 3.5px; border-top-left-radius: 6px; }',
    '.gk-sh-esquina.tr { top: 0; right: 0; border-top-width: 3.5px; border-right-width: 3.5px; border-top-right-radius: 6px; }',
    '.gk-sh-esquina.bl { bottom: 0; left: 0; border-bottom-width: 3.5px; border-left-width: 3.5px; border-bottom-left-radius: 6px; }',
    '.gk-sh-esquina.br { bottom: 0; right: 0; border-bottom-width: 3.5px; border-right-width: 3.5px; border-bottom-right-radius: 6px; }',
    '.gk-sh-btn-flash {',
    ' position: absolute;',
    ' top: 10px;',
    ' right: 10px;',
    ' z-index: 8;',
    ' width: 38px;',
    ' height: 38px;',
    ' border-radius: 10px;',
    ' background: rgba(14, 14, 18, 0.78);',
    ' border: 1px solid rgba(255, 255, 255, 0.28);',
    ' color: #ffffff;',
    ' display: flex;',
    ' align-items: center;',
    ' justify-content: center;',
    ' cursor: pointer;',
    '}',
    '.gk-sh-btn-flash.encendido {',
    ' background: #ff6b00;',
    ' color: #111111;',
    ' border-color: #ff6b00;',
    '}',
    '.gk-sh-estado-hint {',
    ' text-align: center;',
    ' font-size: 12px;',
    ' color: #9ca3af;',
    ' padding: 10px 8px;',
    ' background: rgba(255, 255, 255, 0.03);',
    ' border: 1px dashed rgba(255, 255, 255, 0.12);',
    ' border-radius: 12px;',
    '}',
    '.gk-sh-ficha {',
    ' display: none;',
    ' flex-direction: column;',
    ' gap: 10px;',
    ' background: rgba(255, 255, 255, 0.03);',
    ' border: 1px solid rgba(255, 255, 255, 0.1);',
    ' border-radius: 14px;',
    ' padding: 10px;',
    '}',
    '.gk-sh-ficha.visible { display: flex; }',
    '.gk-sh-ficha-top {',
    ' display: flex;',
    ' align-items: center;',
    ' gap: 12px;',
    '}',
    '.gk-sh-foto {',
    ' width: 60px;',
    ' height: 60px;',
    ' border-radius: 10px;',
    ' object-fit: cover;',
    ' background: #0a0a0c;',
    ' border: 1px solid rgba(255, 255, 255, 0.12);',
    ' flex-shrink: 0;',
    '}',
    '.gk-sh-info {',
    ' flex: 1;',
    ' min-width: 0;',
    ' display: flex;',
    ' flex-direction: column;',
    ' gap: 3px;',
    '}',
    '.gk-sh-nombre {',
    ' font-size: 15px;',
    ' font-weight: 800;',
    ' color: #ffffff;',
    ' white-space: nowrap;',
    ' overflow: hidden;',
    ' text-overflow: ellipsis;',
    '}',
    '.gk-sh-ubicacion {',
    ' font-size: 12px;',
    ' color: #9ca3af;',
    ' white-space: nowrap;',
    ' overflow: hidden;',
    ' text-overflow: ellipsis;',
    '}',
    '.gk-sh-metricas {',
    ' display: flex;',
    ' align-items: center;',
    ' gap: 8px;',
    ' margin-top: 2px;',
    '}',
    '.gk-sh-stock {',
    ' font-size: 12.5px;',
    ' font-weight: 700;',
    ' color: #e5e7eb;',
    '}',
    '.gk-sh-sep { color: rgba(255, 255, 255, 0.25); }',
    '.gk-sh-precio {',
    ' font-size: 16px;',
    ' font-weight: 900;',
    ' font-family: monospace;',
    ' color: #ffffff;',
    ' margin-left: auto;',
    '}',
    '.gk-sh-select-ubis {',
    ' width: 100%;',
    ' min-height: 40px;',
    ' background: #0c0c10;',
    ' border: 1px solid rgba(255, 107, 0, 0.4);',
    ' border-radius: 10px;',
    ' color: #ffffff;',
    ' font-size: 12px;',
    ' padding: 6px 10px;',
    ' outline: none;',
    ' display: none;',
    '}',
    '.gk-sh-ubicar-destino {',
    ' display: none;',
    ' font-size: 11.5px;',
    ' font-family: monospace;',
    ' color: #00ff64;',
    ' background: rgba(0, 255, 100, 0.08);',
    ' border: 1px solid rgba(0, 255, 100, 0.28);',
    ' border-radius: 9px;',
    ' padding: 7px 10px;',
    '}',
    '.gk-sh-btn-accion {',
    ' width: 100%;',
    ' min-height: 46px;',
    ' border-radius: 12px;',
    ' border: 1.5px solid #ff6b00;',
    ' background: rgba(255, 107, 0, 0.16);',
    ' color: #ffffff;',
    ' font-size: 14px;',
    ' font-weight: 900;',
    ' cursor: pointer;',
    ' display: flex;',
    ' align-items: center;',
    ' justify-content: center;',
    ' gap: 8px;',
    '}',
    '.gk-sh-btn-accion:active { background: #ff6b00; color: #111111; }',
    '.gk-sh-btn-accion:disabled { opacity: 0.45; cursor: not-allowed; }'
  ].join('\n');
  document.head.appendChild(style);
}

function formatearBinCorto(mueble, idComp) {
  const nom = (mueble && mueble.nombre) ? mueble.nombre : 'Mueble';
  if (idComp && idComp.indexOf('GEO-P-') === 0) {
    const p = idComp.split('-');
    if (p.length >= 6) {
      return nom + ' · Cara ' + p[p.length - 3] + ' · ' + p[p.length - 2] + ' · ' + p[p.length - 1];
    }
  }
  if (idComp === 'BIN_INICIAL') return 'Almacen inicial';
  return idComp ? (nom + ' · ' + idComp) : nom;
}

export const ScannerHub = {
  _abierto: false,
  _modoActivo: 'CONSULTAR',
  _seqLectura: 0,
  _camaraListaParaLeer: false,
  _html5Qr: null,
  _iniciandoCamara: false,
  _deteniendoCamara: false,
  _linternaActiva: false,
  _cooldownCodigo: '',
  _cooldownTs: 0,
  _conteoVenderSesion: 0,
  _ultimoCodigoVender: '',
  _historialEmpujado: false,
  _elementoOrigen: null,
  _callbacks: {},
  _idNegocio: null,
  _idSede: 'SALA_VENTAS',
  _consultaActiva: null,
  _ubicarEstado: { mueble: null, bin: null, producto: null, codigoProd: null },
  _listenersRegistrados: false,

  estaAbierto() {
    return this._abierto;
  },

  _construirDOM() {
    if (document.getElementById('gk-scanner-hub-overlay')) return;
    inyectarEstilosScannerHub();

    const wrap = document.createElement('div');
    wrap.id = 'gk-scanner-hub-overlay';
    wrap.className = 'gk-sh-overlay';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Escaner compartido');

    wrap.innerHTML = [
      '<div class="gk-sh-sheet" id="gk-sh-sheet">',
      ' <div class="gk-sh-handle"></div>',
      ' <div class="gk-sh-header">',
      '  <h2 class="gk-sh-titulo">Escáner</h2>',
      '  <button type="button" id="gk-sh-btn-cerrar" class="gk-sh-btn-cerrar" aria-label="Cerrar escaner">' + SVG_HUB.cerrar + '</button>',
      ' </div>',
      ' <div class="gk-sh-modos" role="tablist" aria-label="Modo de escaneo">',
      '  <button type="button" class="gk-sh-modo-btn" data-modo="VENDER" role="tab">Vender</button>',
      '  <button type="button" class="gk-sh-modo-btn" data-modo="CONSULTAR" role="tab">Consultar</button>',
      '  <button type="button" class="gk-sh-modo-btn" data-modo="UBICAR" role="tab">Ubicar</button>',
      ' </div>',
      ' <div class="gk-sh-visor-wrap">',
      '  <div id="gk-sh-lector"></div>',
      '  <div class="gk-sh-reticula" aria-hidden="true">',
      '   <span class="gk-sh-esquina tl"></span>',
      '   <span class="gk-sh-esquina tr"></span>',
      '   <span class="gk-sh-esquina bl"></span>',
      '   <span class="gk-sh-esquina br"></span>',
      '  </div>',
      '  <button type="button" id="gk-sh-btn-flash" class="gk-sh-btn-flash" title="Linterna">' + SVG_HUB.rayo + '</button>',
      ' </div>',
      ' <div id="gk-sh-estado-hint" class="gk-sh-estado-hint">Apunta la cámara al código de barras o QR.</div>',
      ' <div id="gk-sh-ficha" class="gk-sh-ficha">',
      '  <div class="gk-sh-ficha-top">',
      '   <img id="gk-sh-foto" class="gk-sh-foto" alt="Producto" src="' + SVG_PLACEHOLDER_PROD + '">',
      '   <div class="gk-sh-info">',
      '    <strong id="gk-sh-nombre" class="gk-sh-nombre">Producto</strong>',
      '    <span id="gk-sh-ubicacion" class="gk-sh-ubicacion">Sin ubicación</span>',
      '    <div class="gk-sh-metricas">',
      '     <span id="gk-sh-stock" class="gk-sh-stock">0 disponibles</span>',
      '     <span id="gk-sh-sep" class="gk-sh-sep">|</span>',
      '     <strong id="gk-sh-precio" class="gk-sh-precio">$0</strong>',
      '    </div>',
      '   </div>',
      '  </div>',
      '  <select id="gk-sh-select-ubis" class="gk-sh-select-ubis" aria-label="Elegir ubicacion del producto"></select>',
      '  <div id="gk-sh-ubicar-destino" class="gk-sh-ubicar-destino"></div>',
      ' </div>',
      ' <button type="button" id="gk-sh-btn-accion" class="gk-sh-btn-accion" style="display:none;">',
      '  <span id="gk-sh-btn-accion-txt">Continuar</span>',
      '  ' + SVG_HUB.flecha,
      ' </button>',
      '</div>'
    ].join('');

    document.body.appendChild(wrap);

    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) this.cerrar();
    });
    document.getElementById('gk-sh-btn-cerrar').addEventListener('click', () => this.cerrar());
    document.getElementById('gk-sh-btn-flash').addEventListener('click', () => this._alternarLinterna());
    document.getElementById('gk-sh-btn-accion').addEventListener('click', () => this._ejecutarAccionContextual());

    wrap.querySelectorAll('.gk-sh-modo-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nuevoModo = btn.getAttribute('data-modo');
        if (nuevoModo && nuevoModo !== this._modoActivo) {
          this.cambiarModo(nuevoModo);
        }
      });
    });

    document.getElementById('gk-sh-select-ubis').addEventListener('change', (e) => {
      if (!this._consultaActiva || !Array.isArray(this._consultaActiva.ubicaciones)) return;
      const idx = Number(e.target.value);
      const elegida = this._consultaActiva.ubicaciones[idx] || null;
      if (elegida) {
        this._consultaActiva.ubicacionSeleccionada = elegida;
        document.getElementById('gk-sh-ubicacion').textContent = elegida.etiqueta;
        document.getElementById('gk-sh-stock').textContent = elegida.cantidad + ' en este espacio (' + this._consultaActiva.stockTotal + ' total)';
      }
    });

    if (!this._listenersRegistrados) {
      this._listenersRegistrados = true;
      window.addEventListener('popstate', () => {
        if (this._abierto) {
          this._historialEmpujado = false;
          this.cerrar({ desdePopstate: true });
        }
      });
      window.addEventListener('gk:terminal-bloqueada', () => {
        if (this._abierto) this.cerrar({ silencioso: true, restaurarFoco: false });
      });
      window.addEventListener('keydown', (e) => {
        if (this._abierto && e.key === 'Escape') {
          e.preventDefault();
          this.cerrar();
        }
      });
    }
  },

  _actualizarUISelectorModo() {
    const root = document.getElementById('gk-scanner-hub-overlay');
    if (!root) return;
    root.querySelectorAll('.gk-sh-modo-btn').forEach((btn) => {
      const activo = btn.getAttribute('data-modo') === this._modoActivo;
      btn.classList.toggle('activo', activo);
      btn.setAttribute('aria-selected', String(activo));
    });
    const hint = document.getElementById('gk-sh-estado-hint');
    if (hint) {
      if (this._modoActivo === 'VENDER') {
        hint.textContent = 'Modo Vender: cada lectura suma al ticket activo del POS.';
      } else if (this._modoActivo === 'CONSULTAR') {
        hint.textContent = 'Modo Consultar: revisa precio, stock y ubicación sin alterar el ticket.';
      } else {
        hint.textContent = 'Modo Ubicar: escanea mueble (GEO-M-), espacio (GEO-P-) y producto.';
      }
      hint.style.display = 'block';
    }
    const ficha = document.getElementById('gk-sh-ficha');
    if (ficha) ficha.classList.remove('visible');
    const selUbis = document.getElementById('gk-sh-select-ubis');
    if (selUbis) selUbis.style.display = 'none';
    const boxDest = document.getElementById('gk-sh-ubicar-destino');
    if (boxDest) boxDest.style.display = 'none';
    const btnAccion = document.getElementById('gk-sh-btn-accion');
    if (btnAccion) btnAccion.style.display = 'none';
  },

  cambiarModo(nuevoModo) {
    const modoNorm = String(nuevoModo || 'CONSULTAR').toUpperCase();
    if (['VENDER', 'CONSULTAR', 'UBICAR'].indexOf(modoNorm) === -1) return;
    // Invalidar cualquier lectura asincrona pendiente del modo anterior
    this._seqLectura++;
    this._modoActivo = modoNorm;
    this._cooldownCodigo = '';
    this._cooldownTs = 0;
    this._consultaActiva = null;
    this._conteoVenderSesion = 0;
    this._ultimoCodigoVender = '';
    this._actualizarUISelectorModo();
    if (modoNorm === 'UBICAR' && (this._ubicarEstado.mueble || this._ubicarEstado.bin || this._ubicarEstado.producto)) {
      this._pintarEstadoUbicar();
    }
    if (navigator.vibrate) navigator.vibrate(15);
  },

  async abrir(opciones) {
    const opts = opciones || {};
    if (AuthGate && AuthGate._estado && AuthGate._estado.sesionBloqueada) return;
    this._construirDOM();

    this._callbacks = {
      onVender: typeof opts.onVender === 'function' ? opts.onVender : null,
      onVerEnMapa: typeof opts.onVerEnMapa === 'function' ? opts.onVerEnMapa : null,
      onUbicar: typeof opts.onUbicar === 'function' ? opts.onUbicar : null,
      onCerrar: typeof opts.onCerrar === 'function' ? opts.onCerrar : null
    };
    this._idNegocio = opts.idNegocio || localStorage.getItem('geokatu_active_uid') || '';
    this._idSede = opts.idSede || localStorage.getItem('geokatu_sede_activa_' + this._idNegocio) || localStorage.getItem('geokatu_sede_activa') || localStorage.getItem('geokatu_almacen_activo') || 'SALA_VENTAS';
    this._elementoOrigen = opts.origenEl || document.activeElement || null;

    this._seqLectura++;
    this._camaraListaParaLeer = false;
    this._cooldownCodigo = '';
    this._cooldownTs = 0;
    this._conteoVenderSesion = 0;
    this._ultimoCodigoVender = '';
    this._consultaActiva = null;
    this._ubicarEstado = {
      mueble: opts.muebleInicial || null,
      bin: opts.binInicial || null,
      producto: opts.productoInicial || null,
      codigoProd: opts.productoInicial ? (opts.productoInicial.codigo_barras || opts.productoInicial.id_prod) : null
    };

    const modoIni = String(opts.modoInicial || 'CONSULTAR').toUpperCase();
    this._modoActivo = ['VENDER', 'CONSULTAR', 'UBICAR'].indexOf(modoIni) !== -1 ? modoIni : 'CONSULTAR';

    // Mostrar overlay y modo seleccionado ANTES de aceptar lecturas
    this._actualizarUISelectorModo();
    if (this._modoActivo === 'UBICAR' && (this._ubicarEstado.mueble || this._ubicarEstado.bin || this._ubicarEstado.producto)) {
      this._pintarEstadoUbicar();
    }
    const overlay = document.getElementById('gk-scanner-hub-overlay');
    if (overlay) overlay.classList.add('activo');
    this._abierto = true;

    if (!this._historialEmpujado) {
      try {
        window.history.pushState({ gkScannerHub: true }, '');
        this._historialEmpujado = true;
      } catch (eHist) {}
    }

    await this._iniciarCamara();
    if (this._abierto) {
      this._camaraListaParaLeer = true;
    }
  },

  async cerrar(opciones) {
    const opts = opciones || {};
    if (!this._abierto && !this._iniciandoCamara) return;
    this._abierto = false;
    this._camaraListaParaLeer = false;
    this._seqLectura++;

    const overlay = document.getElementById('gk-scanner-hub-overlay');
    if (overlay) overlay.classList.remove('activo');

    await this._detenerCamara();

    if (!opts.desdePopstate && this._historialEmpujado) {
      this._historialEmpujado = false;
      try {
        if (window.history.state && window.history.state.gkScannerHub) {
          window.history.back();
        }
      } catch (eBack) {}
    }

    if (opts.restaurarFoco !== false && this._elementoOrigen && typeof this._elementoOrigen.focus === 'function') {
      const destinoFoco = this._elementoOrigen;
      setTimeout(() => {
        if (!(AuthGate && AuthGate._estado && AuthGate._estado.sesionBloqueada)) {
          try { destinoFoco.focus(); } catch (eF) {}
        }
      }, 30);
    }

    if (!opts.silencioso && this._callbacks.onCerrar) {
      try { this._callbacks.onCerrar(); } catch (eCb) {}
    }
  },

  async _iniciarCamara() {
    if (typeof window.Html5Qrcode === 'undefined') {
      const hint = document.getElementById('gk-sh-estado-hint');
      if (hint) hint.textContent = 'Lector óptico no disponible en esta vista.';
      return;
    }
    if (this._iniciandoCamara) return;
    this._iniciandoCamara = true;
    try {
      await this._detenerCamara();
      if (!this._abierto) return;
      if (!this._html5Qr) {
        const formatos = (typeof window.Html5QrcodeSupportedFormats !== 'undefined')
          ? [
              window.Html5QrcodeSupportedFormats.EAN_13,
              window.Html5QrcodeSupportedFormats.EAN_8,
              window.Html5QrcodeSupportedFormats.CODE_128,
              window.Html5QrcodeSupportedFormats.CODE_39,
              window.Html5QrcodeSupportedFormats.UPC_A,
              window.Html5QrcodeSupportedFormats.UPC_E,
              window.Html5QrcodeSupportedFormats.QR_CODE
            ]
          : undefined;
        this._html5Qr = formatos
          ? new window.Html5Qrcode('gk-sh-lector', { formatsToSupport: formatos, verbose: false })
          : new window.Html5Qrcode('gk-sh-lector');
      }
      await this._html5Qr.start(
        { facingMode: 'environment' },
        { fps: 18, qrbox: { width: 230, height: 120 } },
        (codigo) => this._onLecturaBruta(codigo),
        () => {}
      );
    } catch (err) {
      const hint = document.getElementById('gk-sh-estado-hint');
      if (hint) hint.textContent = 'No se pudo iniciar la cámara. Revisa los permisos del navegador.';
    } finally {
      this._iniciandoCamara = false;
    }
  },

  async _detenerCamara() {
    if (this._deteniendoCamara) return;
    this._deteniendoCamara = true;
    try {
      if (this._linternaActiva) {
        const video = document.querySelector('#gk-sh-lector video');
        const track = (video && video.srcObject) ? video.srcObject.getVideoTracks()[0] : null;
        if (track && track.applyConstraints) {
          await track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
        }
        this._linternaActiva = false;
        const btnF = document.getElementById('gk-sh-btn-flash');
        if (btnF) btnF.classList.remove('encendido');
      }
      if (this._html5Qr && this._html5Qr.isScanning) {
        await this._html5Qr.stop().catch(() => {});
      }
    } finally {
      this._deteniendoCamara = false;
    }
  },

  async _alternarLinterna() {
    const video = document.querySelector('#gk-sh-lector video');
    const track = (video && video.srcObject) ? video.srcObject.getVideoTracks()[0] : null;
    if (!track || !track.getCapabilities) return;
    const caps = track.getCapabilities();
    if (!caps || !caps.torch) return;
    try {
      this._linternaActiva = !this._linternaActiva;
      await track.applyConstraints({ advanced: [{ torch: this._linternaActiva }] });
      const btnF = document.getElementById('gk-sh-btn-flash');
      if (btnF) btnF.classList.toggle('encendido', this._linternaActiva);
    } catch (eT) {
      this._linternaActiva = false;
    }
  },

  _leerCatalogoLocal() {
    if (!this._idNegocio) return [];
    try {
      return JSON.parse(localStorage.getItem('geokatu_catalogo_' + this._idNegocio) || '[]');
    } catch (e) {
      return [];
    }
  },

  _leerPlanoSede() {
    if (!this._idNegocio) return { elementos: [] };
    try {
      return JSON.parse(localStorage.getItem('geokatu_plano_' + this._idNegocio + '_' + this._idSede) || '{"elementos":[]}');
    } catch (e) {
      return { elementos: [] };
    }
  },

  _leerUbicacionesLocales() {
    if (!this._idNegocio) return [];
    try {
      return JSON.parse(localStorage.getItem('geokatu_stock_ubis_' + this._idNegocio) || '[]');
    } catch (e) {
      return [];
    }
  },

  _onLecturaBruta(codigoRaw) {
    if (!this._abierto || !this._camaraListaParaLeer) return;
    if (AuthGate && AuthGate._estado && AuthGate._estado.sesionBloqueada) return;
    const codigo = String(codigoRaw || '').trim();
    if (!codigo) return;

    const ahora = Date.now();
    if (codigo === this._cooldownCodigo && (ahora - this._cooldownTs) < 1300) {
      return;
    }
    this._cooldownCodigo = codigo;
    this._cooldownTs = ahora;

    if (navigator.vibrate) navigator.vibrate(45);

    const seq = ++this._seqLectura;
    const modoSnap = this._modoActivo;

    if (modoSnap === 'VENDER') {
      this._procesarModoVender(codigo, seq);
    } else if (modoSnap === 'CONSULTAR') {
      this._procesarModoConsultar(codigo, seq);
    } else if (modoSnap === 'UBICAR') {
      this._procesarModoUbicar(codigo, seq);
    }
  },

  _procesarModoVender(codigo, seq) {
    if (!this._abierto || seq !== this._seqLectura || this._modoActivo !== 'VENDER') return;

    const catalogo = this._leerCatalogoLocal();
    const prod = catalogo.find(p => p.codigo_barras === codigo || p.id_prod === codigo) || null;

    if (this._callbacks.onVender) {
      this._callbacks.onVender(codigo);
    }

    if (codigo === this._ultimoCodigoVender) {
      this._conteoVenderSesion++;
    } else {
      this._ultimoCodigoVender = codigo;
      this._conteoVenderSesion = 1;
    }

    const hint = document.getElementById('gk-sh-estado-hint');
    if (hint) hint.style.display = 'none';

    const ficha = document.getElementById('gk-sh-ficha');
    const foto = document.getElementById('gk-sh-foto');
    const nombre = document.getElementById('gk-sh-nombre');
    const ubi = document.getElementById('gk-sh-ubicacion');
    const stock = document.getElementById('gk-sh-stock');
    const sep = document.getElementById('gk-sh-sep');
    const precio = document.getElementById('gk-sh-precio');

    foto.src = (prod && prod.imagen) ? prod.imagen : SVG_PLACEHOLDER_PROD;
    nombre.textContent = prod ? prod.nombre : ('Código ' + codigo);
    ubi.textContent = this._callbacks.onVender
      ? ('Entregado al POS (+' + this._conteoVenderSesion + ' en este escaneo)')
      : 'Abre el POS para sumar este artículo al ticket';
    stock.textContent = prod ? ((Number(prod.stock_actual) || 0) + ' en inventario') : 'Lectura recibida';
    if (prod && Number(prod.precio) > 0) {
      precio.textContent = '$' + Number(prod.precio).toLocaleString('es-CO');
      precio.style.display = 'inline';
      sep.style.display = 'inline';
    } else {
      precio.style.display = 'none';
      sep.style.display = 'none';
    }
    document.getElementById('gk-sh-select-ubis').style.display = 'none';
    document.getElementById('gk-sh-ubicar-destino').style.display = 'none';
    ficha.classList.add('visible');

    const btnAccion = document.getElementById('gk-sh-btn-accion');
    const txtAccion = document.getElementById('gk-sh-btn-accion-txt');
    btnAccion.disabled = false;
    btnAccion.style.display = 'flex';
    txtAccion.textContent = this._callbacks.onVender ? 'Volver al ticket' : 'Ir a POS';
  },

  async _procesarModoConsultar(codigo, seq) {
    const catalogo = this._leerCatalogoLocal();
    let prod = catalogo.find(p => p.codigo_barras === codigo || p.id_prod === codigo) || null;

    if (!prod && GeokatuDB.CatalogoMatrizService && GeokatuDB.CatalogoMatrizService.obtenerProductoPorCodigo) {
      const matchM = await GeokatuDB.CatalogoMatrizService.obtenerProductoPorCodigo(codigo);
      if (!this._abierto || seq !== this._seqLectura || this._modoActivo !== 'CONSULTAR') return;
      if (matchM) {
        prod = { id_prod: codigo, codigo_barras: codigo, nombre: matchM.nombre, precio: 0, stock_actual: 0, imagen: '' };
      }
    }

    const plano = this._leerPlanoSede();
    const muebles = Array.isArray(plano.elementos) ? plano.elementos : [];
    const mapaCompAMueble = new Map();
    for (let i = 0; i < muebles.length; i++) {
      const m = muebles[i];
      const comps = m.compartimientos || [];
      for (let j = 0; j < comps.length; j++) {
        mapaCompAMueble.set(comps[j].id_comp, m);
      }
    }

    let ubisRaw = this._leerUbicacionesLocales();
    let misUbis = prod
      ? ubisRaw.filter(u => u.id_prod === prod.id_prod && Number(u.cantidad) > 0)
      : [];

    if (prod && misUbis.length === 0 && navigator.onLine && GeokatuDB.InventarioService && GeokatuDB.InventarioService.obtenerStockUbicacionesProducto) {
      const resU = await GeokatuDB.InventarioService.obtenerStockUbicacionesProducto(this._idNegocio, prod.id_prod);
      if (!this._abierto || seq !== this._seqLectura || this._modoActivo !== 'CONSULTAR') return;
      if (resU && resU.success && Array.isArray(resU.data)) {
        misUbis = resU.data.filter(u => Number(u.cantidad) > 0);
      }
    }

    if (!this._abierto || seq !== this._seqLectura || this._modoActivo !== 'CONSULTAR') return;

    const ubicacionesSede = [];
    const ubicacionesOtras = [];
    for (let k = 0; k < misUbis.length; k++) {
      const u = misUbis[k];
      const idComp = u.id_compartimiento || u.id || '';
      const mueble = mapaCompAMueble.get(idComp) || muebles.find(m => m.id_mueble === u.id_estante || m.qr === u.id_estante) || null;
      const itemUbi = {
        id_compartimiento: idComp,
        id_estante: mueble ? mueble.id_mueble : (u.id_estante || ''),
        mueble: mueble,
        cantidad: Number(u.cantidad) || 0,
        etiqueta: mueble ? formatearBinCorto(mueble, idComp) : formatearBinCorto(null, idComp)
      };
      if (mueble) ubicacionesSede.push(itemUbi);
      else ubicacionesOtras.push(itemUbi);
    }

    const listaFinal = ubicacionesSede.length > 0 ? ubicacionesSede : ubicacionesOtras;
    const stockTotal = prod ? (Number(prod.stock_actual) || 0) : 0;

    this._consultaActiva = {
      codigo: codigo,
      producto: prod,
      stockTotal: stockTotal,
      ubicaciones: listaFinal,
      ubicacionSeleccionada: listaFinal[0] || null
    };

    const hint = document.getElementById('gk-sh-estado-hint');
    if (hint) hint.style.display = 'none';

    const ficha = document.getElementById('gk-sh-ficha');
    const foto = document.getElementById('gk-sh-foto');
    const nombre = document.getElementById('gk-sh-nombre');
    const ubiEl = document.getElementById('gk-sh-ubicacion');
    const stockEl = document.getElementById('gk-sh-stock');
    const sep = document.getElementById('gk-sh-sep');
    const precioEl = document.getElementById('gk-sh-precio');
    const selUbis = document.getElementById('gk-sh-select-ubis');

    foto.src = (prod && prod.imagen) ? prod.imagen : SVG_PLACEHOLDER_PROD;
    nombre.textContent = prod ? prod.nombre : ('No encontrado: ' + codigo);

    if (listaFinal.length > 0) {
      ubiEl.textContent = listaFinal[0].etiqueta;
      stockEl.textContent = listaFinal.length > 1
        ? (listaFinal[0].cantidad + ' en este espacio (' + stockTotal + ' total)')
        : (stockTotal + ' disponibles');
    } else {
      ubiEl.textContent = 'Sin ubicación en ' + (this._idSede === 'SALA_VENTAS' ? 'Sala de ventas' : this._idSede);
      stockEl.textContent = stockTotal + ' disponibles';
    }

    if (prod && Number(prod.precio) > 0) {
      precioEl.textContent = '$' + Number(prod.precio).toLocaleString('es-CO');
      precioEl.style.display = 'inline';
      sep.style.display = 'inline';
    } else {
      precioEl.style.display = 'none';
      sep.style.display = 'none';
    }

    if (listaFinal.length > 1) {
      selUbis.innerHTML = '';
      for (let i = 0; i < listaFinal.length; i++) {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = listaFinal[i].etiqueta + ' — ' + listaFinal[i].cantidad + ' und';
        selUbis.appendChild(opt);
      }
      selUbis.style.display = 'block';
    } else {
      selUbis.style.display = 'none';
    }

    document.getElementById('gk-sh-ubicar-destino').style.display = 'none';
    ficha.classList.add('visible');

    const btnAccion = document.getElementById('gk-sh-btn-accion');
    const txtAccion = document.getElementById('gk-sh-btn-accion-txt');
    btnAccion.style.display = 'flex';
    btnAccion.disabled = !prod;
    txtAccion.textContent = 'Ver en mapa';
  },

  async _procesarModoUbicar(codigo, seq) {
    const plano = this._leerPlanoSede();
    const muebles = Array.isArray(plano.elementos) ? plano.elementos : [];

    if (codigo.indexOf('GEO-M-') === 0) {
      const mueble = muebles.find(m => m.qr === codigo || (!m.qr && codigo === 'GEO-M-' + this._idNegocio + '-' + this._idSede + '-' + m.id_mueble) || codigo.endsWith(m.id_mueble));
      if (!this._abierto || seq !== this._seqLectura || this._modoActivo !== 'UBICAR') return;
      if (mueble) {
        this._ubicarEstado.mueble = mueble;
        this._ubicarEstado.bin = null;
      }
      this._pintarEstadoUbicar(mueble ? null : 'Mueble QR no pertenece a la sede activa.');
      return;
    }

    if (codigo.indexOf('GEO-P-') === 0) {
      let halladoMueble = null;
      let halladoBin = null;
      for (let i = 0; i < muebles.length; i++) {
        const comps = muebles[i].compartimientos || [];
        const matchB = comps.find(c => c.id_comp === codigo);
        if (matchB) {
          halladoMueble = muebles[i];
          halladoBin = matchB;
          break;
        }
      }
      if (!this._abierto || seq !== this._seqLectura || this._modoActivo !== 'UBICAR') return;
      if (halladoMueble && halladoBin) {
        this._ubicarEstado.mueble = halladoMueble;
        this._ubicarEstado.bin = halladoBin;
      }
      this._pintarEstadoUbicar(halladoBin ? null : 'Compartimiento QR no pertenece a la sede activa.');
      return;
    }

    const catalogo = this._leerCatalogoLocal();
    let prod = catalogo.find(p => p.codigo_barras === codigo || p.id_prod === codigo) || null;
    if (!prod && GeokatuDB.CatalogoMatrizService && GeokatuDB.CatalogoMatrizService.obtenerProductoPorCodigo) {
      const mMat = await GeokatuDB.CatalogoMatrizService.obtenerProductoPorCodigo(codigo);
      if (!this._abierto || seq !== this._seqLectura || this._modoActivo !== 'UBICAR') return;
      if (mMat) {
        prod = { id_prod: codigo, codigo_barras: codigo, nombre: mMat.nombre, precio: 0, stock_actual: 0, imagen: '' };
      }
    }
    if (!this._abierto || seq !== this._seqLectura || this._modoActivo !== 'UBICAR') return;
    this._ubicarEstado.producto = prod;
    this._ubicarEstado.codigoProd = codigo;
    this._pintarEstadoUbicar(null);
  },

  _pintarEstadoUbicar(avisoError) {
    const est = this._ubicarEstado;
    const hint = document.getElementById('gk-sh-estado-hint');
    if (avisoError && hint) {
      hint.textContent = avisoError;
      hint.style.display = 'block';
    } else if (hint) {
      hint.style.display = 'none';
    }

    const ficha = document.getElementById('gk-sh-ficha');
    const foto = document.getElementById('gk-sh-foto');
    const nombre = document.getElementById('gk-sh-nombre');
    const ubiEl = document.getElementById('gk-sh-ubicacion');
    const stockEl = document.getElementById('gk-sh-stock');
    const sep = document.getElementById('gk-sh-sep');
    const precioEl = document.getElementById('gk-sh-precio');
    const boxDest = document.getElementById('gk-sh-ubicar-destino');

    if (est.producto) {
      foto.src = est.producto.imagen || SVG_PLACEHOLDER_PROD;
      nombre.textContent = est.producto.nombre || est.codigoProd;
      stockEl.textContent = (Number(est.producto.stock_actual) || 0) + ' en inventario';
      if (Number(est.producto.precio) > 0) {
        precioEl.textContent = '$' + Number(est.producto.precio).toLocaleString('es-CO');
        precioEl.style.display = 'inline';
        sep.style.display = 'inline';
      } else {
        precioEl.style.display = 'none';
        sep.style.display = 'none';
      }
    } else if (est.codigoProd) {
      foto.src = SVG_PLACEHOLDER_PROD;
      nombre.textContent = 'Código nuevo: ' + est.codigoProd;
      stockEl.textContent = 'Listo para alta o ubicación en Stock';
      precioEl.style.display = 'none';
      sep.style.display = 'none';
    } else {
      foto.src = SVG_PLACEHOLDER_PROD;
      nombre.textContent = 'Destino seleccionado';
      stockEl.textContent = 'Escanea ahora el producto a ubicar';
      precioEl.style.display = 'none';
      sep.style.display = 'none';
    }

    if (est.mueble && est.bin) {
      const txtDest = formatearBinCorto(est.mueble, est.bin.id_comp);
      ubiEl.textContent = 'Destino listo: ' + txtDest;
      boxDest.textContent = 'DESTINO: ' + txtDest;
      boxDest.style.display = 'block';
    } else if (est.mueble) {
      ubiEl.textContent = 'Mueble: ' + est.mueble.nombre + ' (escanea QR del espacio)';
      boxDest.textContent = 'MUEBLE: ' + est.mueble.nombre + ' · Falta espacio (GEO-P-)';
      boxDest.style.display = 'block';
    } else {
      ubiEl.textContent = 'Escanea el QR del mueble o espacio destino';
      boxDest.style.display = 'none';
    }

    document.getElementById('gk-sh-select-ubis').style.display = 'none';
    ficha.classList.add('visible');

    const btnAccion = document.getElementById('gk-sh-btn-accion');
    const txtAccion = document.getElementById('gk-sh-btn-accion-txt');
    const puedeConfirmar = Boolean(est.codigoProd || est.mueble || est.bin);
    btnAccion.style.display = 'flex';
    btnAccion.disabled = !puedeConfirmar;
    txtAccion.textContent = 'Confirmar en Stock';
  },

  async _ejecutarAccionContextual() {
    if (this._modoActivo === 'VENDER') {
      const tienePosLocal = Boolean(this._callbacks.onVender);
      await this.cerrar();
      if (!tienePosLocal) {
        if (window.TerminalApp && typeof window.TerminalApp.irAVista === 'function') {
          window.TerminalApp.irAVista('pos', {});
        } else {
          window.location.href = 'pos';
        }
      }
      return;
    }

    if (this._modoActivo === 'CONSULTAR') {
      const datos = this._consultaActiva;
      if (!datos) return;
      const payload = {
        codigo: datos.codigo,
        producto: datos.producto,
        ubicacion: datos.ubicacionSeleccionada,
        idSede: this._idSede
      };
      await this.cerrar();
      if (this._callbacks.onVerEnMapa) {
        this._callbacks.onVerEnMapa(payload);
      } else if (window.TerminalApp && typeof window.TerminalApp.irAVista === 'function') {
        window.TerminalApp.irAVista('mapa', {
          buscar: (payload.ubicacion && payload.ubicacion.id_compartimiento) ? payload.ubicacion.id_compartimiento : payload.codigo,
          sede: payload.idSede
        });
      } else {
        const q = new URLSearchParams({
          buscar: (payload.ubicacion && payload.ubicacion.id_compartimiento) ? payload.ubicacion.id_compartimiento : payload.codigo,
          sede: payload.idSede
        });
        window.location.href = 'inventario?' + q.toString();
      }
      return;
    }

    if (this._modoActivo === 'UBICAR') {
      const est = Object.assign({}, this._ubicarEstado, { idSede: this._idSede });
      await this.cerrar();
      if (this._callbacks.onUbicar) {
        this._callbacks.onUbicar(est);
      } else if (window.TerminalApp && typeof window.TerminalApp.irAVista === 'function') {
        window.TerminalApp.irAVista('stock', {
          sede: est.idSede,
          mueble: est.mueble ? est.mueble.id_mueble : null,
          bin: est.bin ? est.bin.id_comp : null,
          buscar: est.codigoProd || null
        });
      } else {
        const p = new URLSearchParams({ sede: est.idSede });
        if (est.mueble) p.set('mueble', est.mueble.id_mueble);
        if (est.bin) p.set('bin', est.bin.id_comp);
        if (est.codigoProd) p.set('buscar', est.codigoProd);
        window.location.href = 'stock?' + p.toString();
      }
    }
  }
};

window.ScannerHub = ScannerHub;
