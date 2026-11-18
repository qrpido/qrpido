/**
 * GEOKATU - Controlador de Terminal Unificada (Shell)
 * Archivo: public/terminal-shell.js
 * - Inicializacion unica de AuthGate
 * - Ticket vivo en RAM + barra "Volver a la venta"
 * - Dock retractil lento a la izquierda en POS (pestana naranja + gestos tactiles)
 * - Enrutador 0ms + historial Android Atras (ScannerHub -> Visor 2.5D -> Vista anterior)
 */

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

function repararVistaInventarioEmbebida(frame) {
  if (!frame || !frame.contentDocument) return;
  const doc = frame.contentDocument;
  if (!doc.getElementById('hud-radar') || doc.getElementById('gk-fix-radar-25d')) return;

  const st = doc.createElement('style');
  st.id = 'gk-fix-radar-25d';
  st.textContent = `
    /* 1. Evitar que Filtros se corte con el buscador (27659.jpg) */
    #panel-filtros {
      margin-top: 10px !important;
      padding-top: 12px !important;
      border-top: 1px solid rgba(255, 255, 255, 0.12) !important;
      position: relative !important;
      z-index: 25 !important;
    }
    /* 2. Ocultar ficha inferior cuando el 2.5D o el drawer estan abiertos (Cero superposicion) */
    body:has(#visor-alzado-pip:not(.oculto)) #ficha-compacta-radar,
    body:has(#drawer-detalle:not(.oculto)) #ficha-compacta-radar {
      display: none !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    /* 3. Visor 2.5D limpio, centrado y con boton X siempre visible */
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
    #alzado-id-badge, #drawer-id-mueble {
      display: inline-block !important;
      max-width: 92px !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      vertical-align: bottom !important;
    }
    #btn-cerrar-alzado {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 30px !important;
      height: 30px !important;
      min-width: 30px !important;
      border-radius: 8px !important;
      background: rgba(255, 68, 68, 0.18) !important;
      border: 1px solid rgba(255, 68, 68, 0.5) !important;
      color: #ffffff !important;
      flex-shrink: 0 !important;
      cursor: pointer !important;
      margin-left: 4px !important;
    }
    /* 4. Mejora visual de muebles en el plano 2D */
    .mueble-radar-2d, [data-id-mueble] {
      border-radius: 8px !important;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.18) !important;
    }
  `;
  doc.head.appendChild(st);

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
  const nomEl = document.getElementById('inicio-nombre-negocio');
  const rolEl = document.getElementById('inicio-operador-rol');
  const estEl = document.getElementById('inicio-estado-txt');
  const btnCroquis = document.getElementById('btn-inicio-croquis');
  const btnOficina = document.getElementById('btn-inicio-oficina');

  if (nomEl) nomEl.textContent = ctx.nombreNegocio || ctx.comercio || 'Comercio activo';
  const nombreOp = ctx.nombreOperador || ctx.nombre || ctx.email || 'Operador';
  const rolTxt = ctx.esDueno ? 'Titular' : (ctx.rol || 'Operario');
  if (rolEl) rolEl.textContent = nombreOp + ' · ' + rolTxt;
  if (estEl) estEl.textContent = 'Sesión activa';

  const puedeEditar = Boolean(
    ctx.esDueno === true ||
    ctx.rol === 'dueño' ||
    ctx.rol === 'owner' ||
    ctx.rol === 'admin' ||
    ctx.rol === 'administrador'
  );
  if (btnCroquis) btnCroquis.style.display = puedeEditar ? 'flex' : 'none';
  if (btnOficina) btnOficina.style.display = puedeEditar ? 'flex' : 'none';
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
    modoEditorMapaActivo = typeof forzarEditor === 'boolean' ? forzarEditor : !modoEditorMapaActivo;
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
    const vista = ['inicio', 'pos', 'stock', 'mapa'].indexOf(destino) !== -1 ? destino : 'pos';
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

    if (vista !== 'inicio') {
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
  window.TerminalApp.abrirEscaner('CONSULTAR', e.currentTarget);
});
document.getElementById('btn-inicio-croquis').addEventListener('click', () => {
  window.location.href = 'mapatienda';
});
document.getElementById('btn-inicio-oficina').addEventListener('click', () => {
  window.location.href = 'oficina';
});
document.getElementById('btn-inicio-bloquear').addEventListener('click', () => {
  window.TerminalApp.solicitarBloqueo();
});
document.getElementById('btn-inicio-salir').addEventListener('click', () => {
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
  onSesionLista: (contexto) => {
    contextoSesionActivo = contexto;
    shellEl.classList.add('listo');
    actualizarPanelInicio(contexto);

    modulosHijosRegistrados.forEach((h) => {
      if (typeof h.onSesion === 'function') {
        try { h.onSesion(contexto); } catch (err) {}
      }
    });

    const params = new URLSearchParams(window.location.search);
    const vistaInicial = params.get('vista') || 'pos';
    try {
      window.history.replaceState({ gkVista: vistaInicial }, '');
    } catch (eR) {}

    asegurarFrameCargado('pos');
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
