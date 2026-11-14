/**
 * GEOKATU - Modulo de Autenticacion Universal, Turnos y Control de Terminales
 * Archivo: auth-gate.js
 * Cumplimiento: Cero emojis, 100% vectores SVG nativos, Login Hibrido (Clave + Google), Relevo en Caliente y GPS obligatorio.
 */

import GeokatuDB from './core-db.js';
import { db } from './firebase-config.js';
import { 
    doc, 
    getDoc, 
    collection, 
    query, 
    where, 
    getDocs,
    addDoc,
    serverTimestamp 
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// =========================================================================
// REPOSITORIO DE ICONOS SVG NATIVOS (CERO EMOJIS)
// =========================================================================
const SVG_ICONS = {
    logoGK: '<svg width="26" height="26" viewBox="0 0 100 100" fill="none"><rect width="100" height="100" rx="22" fill="#0a0a0c" stroke="#ff6b00" stroke-width="4"/><path d="M50 20 L80 80 L50 65 L20 80 Z" fill="#ff6b00"/></svg>',
    google: '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>',
    gps: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>',
    relevo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>',
    alerta: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffaa00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    candado: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    borrarPin: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>',
    tienda: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    maletin: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    flechaDerecha: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>'
};

// =========================================================================
// ESTILOS GLASSMORPHIC AUTO-INYECTADOS
// =========================================================================
function inyectarEstilosBunker() {
    if (document.getElementById('gk-auth-gate-estilos')) return;
    const style = document.createElement('style');
    style.id = 'gk-auth-gate-estilos';
    style.textContent = `
        .gk-gate-overlay {
            position: fixed;
            inset: 0;
            background: rgba(10, 10, 12, 0.95);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            z-index: 999999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
            box-sizing: border-box;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.25s ease-in-out;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .gk-gate-overlay.activo {
            opacity: 1;
            pointer-events: auto;
        }
        .gk-gate-card {
            background: rgba(20, 20, 25, 0.98);
            border: 1px solid rgba(255, 107, 0, 0.35);
            border-radius: 20px;
            width: 100%;
            max-width: 380px;
            padding: 22px 18px;
            box-sizing: border-box;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.9), 0 0 20px rgba(255, 107, 0, 0.2);
            display: flex;
            flex-direction: column;
            gap: 12px;
            position: relative;
        }
        .gk-gate-header {
            text-align: center;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
        }
        .gk-gate-titulo {
            margin: 0;
            font-size: 14px;
            font-weight: 900;
            letter-spacing: 1.2px;
            text-transform: uppercase;
            color: #ffffff;
        }
        .gk-gate-subtitulo {
            margin: 0;
            font-size: 11px;
            color: #8a909d;
            line-height: 1.35;
        }
        .gk-input-bunker {
            width: 100%;
            box-sizing: border-box;
            background: rgba(0, 0, 0, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 10px;
            padding: 11px 12px;
            color: #ffffff;
            font-size: 13px;
            outline: none;
            transition: border-color 0.2s;
        }
        .gk-input-bunker:focus {
            border-color: #ff6b00;
        }
        .gk-btn-google {
            width: 100%;
            padding: 11px;
            border-radius: 12px;
            background: #ffffff;
            color: #1a1a1a;
            border: none;
            font-size: 12.5px;
            font-weight: 800;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            cursor: pointer;
            transition: transform 0.15s;
        }
        .gk-btn-google:active { transform: scale(0.97); }
        .gk-btn-primario {
            width: 100%;
            padding: 12px;
            border-radius: 12px;
            background: linear-gradient(135deg, #ff8c00 0%, #ff6b00 100%);
            border: none;
            color: #ffffff;
            font-size: 12px;
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            cursor: pointer;
            box-shadow: 0 4px 14px rgba(255, 107, 0, 0.35);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: transform 0.15s;
        }
        .gk-btn-primario:active { transform: scale(0.97); }
        .gk-btn-primario:disabled {
            background: #2a2a30;
            color: #666;
            box-shadow: none;
            cursor: not-allowed;
        }
        .gk-btn-secundario {
            width: 100%;
            padding: 10px;
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.15);
            color: #ccc;
            font-size: 11px;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }
        .gk-pin-display {
            display: flex;
            justify-content: center;
            gap: 12px;
            margin: 6px 0 10px 0;
        }
        .gk-pin-dot {
            width: 13px;
            height: 13px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.1);
            border: 1.5px solid rgba(255, 107, 0, 0.4);
            transition: all 0.15s;
        }
        .gk-pin-dot.lleno {
            background: #ff6b00;
            box-shadow: 0 0 10px rgba(255, 107, 0, 0.7);
        }
        .gk-keypad {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            width: 100%;
        }
        .gk-key-btn {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            color: #ffffff;
            font-size: 18px;
            font-weight: 800;
            font-family: monospace;
            padding: 13px 0;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s, transform 0.1s;
        }
        .gk-key-btn:active {
            background: rgba(255, 107, 0, 0.25);
            border-color: #ff6b00;
            transform: scale(0.94);
        }
        .gk-contextos-lista {
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-height: 240px;
            overflow-y: auto;
        }
        .gk-contexto-card {
            background: rgba(0, 0, 0, 0.4);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            padding: 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            transition: all 0.2s;
        }
        .gk-contexto-card:active {
            border-color: #ff6b00;
            background: rgba(255, 107, 0, 0.1);
        }
        .gk-error-box {
            background: rgba(255, 68, 68, 0.12);
            border: 1px solid rgba(255, 68, 68, 0.35);
            color: #ff4444;
            font-size: 11px;
            padding: 8px 12px;
            border-radius: 10px;
            text-align: center;
            display: none;
            line-height: 1.35;
        }
        .gk-alerta-box {
            background: rgba(255, 170, 0, 0.12);
            border: 1px solid rgba(255, 170, 0, 0.4);
            color: #ffaa00;
            font-size: 11px;
            padding: 10px 12px;
            border-radius: 10px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            line-height: 1.35;
        }
        .gk-divisor-login {
            display: flex;
            align-items: center;
            gap: 8px;
            color: #555;
            font-size: 10px;
            text-transform: uppercase;
            font-weight: 800;
            margin: 2px 0;
        }
        .gk-divisor-login::before, .gk-divisor-login::after {
            content: "";
            flex: 1;
            height: 1px;
            background: rgba(255, 255, 255, 0.08);
        }
    `;
    document.head.appendChild(style);
}

// =========================================================================
// MOTOR CENTRAL DE CONTROL DE TERMINAL Y AUTENTICACIÓN
// =========================================================================
export const AuthGate = {
    _config: {
        tituloModulo: 'Terminal Operativa',
        subtituloModulo: 'Verifica tu identidad para iniciar operaciones',
        minutosInactividad: 10,
        onSesionLista: null,
        onCerrarSesion: null
    },

    _estado: {
        pinAcumulado: '',
        usuarioAuth: null,
        contextoActivo: null,
        contextosDetectados: [],
        datosTurnoPendiente: null,
        modoRelevoEnCaliente: false,
        timerInactividad: null,
        sesionBloqueada: false
    },

    inicializar(opciones = {}) {
        this._config = Object.assign({}, this._config, opciones);
        inyectarEstilosBunker();
        this._construirDOM();
        this._iniciarVigilanteInactividad();
        this._escucharSesionAuth();
    },

    _construirDOM() {
        if (document.getElementById('gk-auth-gate-root')) return;

        const overlay = document.createElement('div');
        overlay.id = 'gk-auth-gate-root';
        overlay.className = 'gk-gate-overlay';

        overlay.innerHTML = `
            <div class="gk-gate-card">
                <div class="gk-gate-header">
                    <div style="display:flex; align-items:center; gap:8px;">
                        ${SVG_ICONS.logoGK}
                        <span style="font-weight:900; font-size:17px; letter-spacing:2px; color:#ffffff;">
                            GEO<span style="color:#ff6b00;">KATU</span>
                        </span>
                    </div>
                    <h3 class="gk-gate-titulo" id="gk-gate-titulo-ui">${this._config.tituloModulo}</h3>
                    <p class="gk-gate-subtitulo" id="gk-gate-subtitulo-ui">${this._config.subtituloModulo}</p>
                </div>

                <div id="gk-gate-error-caja" class="gk-error-box"></div>

                <!-- 1. VISTA INICIAL: CORREO/CLAVE + GOOGLE -->
                <div id="gk-vista-login" style="display:flex; flex-direction:column; gap:8px;">
                    <input type="email" id="gk-login-email" class="gk-input-bunker" placeholder="Correo de operario o titular" autocomplete="email">
                    <input type="password" id="gk-login-pass" class="gk-input-bunker" placeholder="Contraseña" autocomplete="current-password" onkeydown="if(event.key==='Enter') window.AuthGate._iniciarConEmailClave()">
                    <button type="button" class="gk-btn-primario" id="gk-btn-email-act" onclick="window.AuthGate._iniciarConEmailClave()">
                        <span>Entrar con Correo y Clave</span>
                    </button>

                    <div class="gk-divisor-login">O acceso rápido</div>

                    <button type="button" class="gk-btn-google" id="gk-btn-google-act" onclick="window.AuthGate._iniciarGoogle()">
                        ${SVG_ICONS.google}
                        <span>Continuar con Google</span>
                    </button>
                    <p style="margin:0; font-size:10px; color:#666; text-align:center;">Acceso exclusivo para personal y titulares autorizados.</p>
                </div>

                <!-- 2. VISTA SELECTOR MULTI-TENANT (DON JORGE VS PROPIO) -->
                <div id="gk-vista-selector" style="display:none; flex-direction:column; gap:8px;">
                    <span style="font-size:11px; color:#8a909d; text-align:center;">Selecciona la sucursal o comercio a operar:</span>
                    <div class="gk-contextos-lista" id="gk-contenedor-contextos"></div>
                </div>

                <!-- 3. VISTA CAPTURA GPS Y HORARIO OBLIGATORIO DE TURNO -->
                <div id="gk-vista-gps" style="display:none; flex-direction:column; gap:10px;">
                    <div id="gk-box-alerta-horario" class="gk-alerta-box" style="display:none;">
                        <div style="display:flex; align-items:center; gap:6px;">
                            ${SVG_ICONS.alerta}
                            <strong style="color:#ffaa00; font-size:11.5px;">Acceso Fuera de Horario</strong>
                        </div>
                        <span id="gk-txt-alerta-horario">Operacion extraordinaria detectada.</span>
                    </div>

                    <p style="font-size:11px; color:#bbb; text-align:center; margin:0; line-height:1.4;">
                        Para sellar la apertura del turno, el dispositivo debe capturar la coordenada geografica de presencia en el establecimiento.
                    </p>

                    <button type="button" class="gk-btn-primario" id="gk-btn-capturar-gps" onclick="window.AuthGate._ejecutarCapturaGPSApertura()">
                        ${SVG_ICONS.gps}
                        <span id="gk-lbl-btn-gps">Confirmar Presencia y Entrar</span>
                    </button>

                    <button type="button" class="gk-btn-secundario" onclick="window.AuthGate.cerrarSesion()">
                        Cerrar Sesion y Cambiar Usuario
                    </button>
                </div>

                <!-- 4. VISTA BLOQUEO 10 MINUTOS & RELEVO EN CALIENTE -->
                <div id="gk-vista-bloqueo" style="display:none; flex-direction:column; align-items:center; gap:8px;">
                    <div style="display:flex; align-items:center; gap:6px; color:#ff6b00;">
                        ${SVG_ICONS.candado}
                        <span id="gk-titulo-estado-bloqueo" style="font-size:11.5px; font-weight:800; text-transform:uppercase;">Terminal Bloqueada por PIN</span>
                    </div>

                    <div style="text-align:center; margin-bottom:2px;">
                        <strong id="gk-lbl-operario-bloqueo" style="display:block; font-size:13px; color:#ffffff;">Operario</strong>
                        <span id="gk-lbl-sede-bloqueo" style="font-size:10.5px; color:#8a909d; font-family:monospace;">Sede</span>
                    </div>

                    <div class="gk-pin-display">
                        <div class="gk-pin-dot" id="gk-dot-0"></div>
                        <div class="gk-pin-dot" id="gk-dot-1"></div>
                        <div class="gk-pin-dot" id="gk-dot-2"></div>
                        <div class="gk-pin-dot" id="gk-dot-3"></div>
                    </div>

                    <div class="gk-keypad">
                        <button type="button" class="gk-key-btn" onclick="window.AuthGate._pulsarPin(1)">1</button>
                        <button type="button" class="gk-key-btn" onclick="window.AuthGate._pulsarPin(2)">2</button>
                        <button type="button" class="gk-key-btn" onclick="window.AuthGate._pulsarPin(3)">3</button>
                        <button type="button" class="gk-key-btn" onclick="window.AuthGate._pulsarPin(4)">4</button>
                        <button type="button" class="gk-key-btn" onclick="window.AuthGate._pulsarPin(5)">5</button>
                        <button type="button" class="gk-key-btn" onclick="window.AuthGate._pulsarPin(6)">6</button>
                        <button type="button" class="gk-key-btn" onclick="window.AuthGate._pulsarPin(7)">7</button>
                        <button type="button" class="gk-key-btn" onclick="window.AuthGate._pulsarPin(8)">8</button>
                        <button type="button" class="gk-key-btn" onclick="window.AuthGate._pulsarPin(9)">9</button>
                        <button type="button" class="gk-key-btn" style="color:#8a909d; font-size:11px;" onclick="window.AuthGate._limpiarPin()">C</button>
                        <button type="button" class="gk-key-btn" onclick="window.AuthGate._pulsarPin(0)">0</button>
                        <button type="button" class="gk-key-btn" onclick="window.AuthGate._borrarPin()">${SVG_ICONS.borrarPin}</button>
                    </div>

                    <div style="display:flex; flex-direction:column; width:100%; gap:6px; margin-top:6px;">
                        <button type="button" class="gk-btn-secundario" style="border-color:rgba(255,107,0,0.4); color:#ff6b00;" onclick="window.AuthGate._activarModoRelevo()">
                            ${SVG_ICONS.relevo}
                            <span>Entrar con PIN de otro Operario (Relevo)</span>
                        </button>
                        <button type="button" class="gk-btn-secundario" style="color:#ff4444; border-color:rgba(255,68,68,0.3);" onclick="window.AuthGate.cerrarSesion()">
                            <span>Cerrar Sesion Actual y Abrir Otra Cuenta</span>
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        window.AuthGate = this;
    },

    _mostrarError(msg) {
        const box = document.getElementById('gk-gate-error-caja');
        if (box) {
            box.innerText = msg;
            box.style.display = 'block';
        }
        if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    },

    _ocultarError() {
        const box = document.getElementById('gk-gate-error-caja');
        if (box) box.style.display = 'none';
    },

    _escucharSesionAuth() {
        GeokatuDB.SecurityService.observarEstadoSesion(async (user) => {
            if (user) {
                this._estado.usuarioAuth = user;
                if (!this._estado.sesionBloqueada) {
                    await this._evaluarContextosMultiTenant(user);
                }
            } else {
                this._estado.usuarioAuth = null;
                this._abrirPantallaLogin();
            }
        });
    },

    _abrirPantallaLogin() {
        this._ocultarTodasLasVistas();
        document.getElementById('gk-vista-login').style.display = 'flex';
        this._abrirModal();
    },

    _ocultarTodasLasVistas() {
        ['gk-vista-login', 'gk-vista-selector', 'gk-vista-gps', 'gk-vista-bloqueo'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        this._ocultarError();
    },

    async _iniciarConEmailClave() {
        this._ocultarError();
        const email = (document.getElementById('gk-login-email')?.value || '').trim();
        const pass = document.getElementById('gk-login-pass')?.value || '';
        if (!email || !pass) {
            this._mostrarError("Ingresa tu correo y contraseña.");
            return;
        }
        const btn = document.getElementById('gk-btn-email-act');
        btn.disabled = true;
        btn.innerText = "Verificando...";

        try {
            const res = await GeokatuDB.SecurityService.iniciarSesion(email, pass);
            if (!res.success) throw new Error(res.error || 'Credenciales incorrectas.');
            document.getElementById('gk-login-pass').value = '';
        } catch (err) {
            this._mostrarError("Error de acceso: " + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<span>Entrar con Correo y Clave</span>';
        }
    },

    async _iniciarGoogle() {
        this._ocultarError();
        const btn = document.getElementById('gk-btn-google-act');
        btn.disabled = true;
        btn.style.opacity = '0.7';

        try {
            const res = await GeokatuDB.SecurityService.iniciarConGoogle();
            if (!res.success) throw new Error(res.error || 'Autenticacion cancelada.');
        } catch (err) {
            this._mostrarError(err.message);
        } finally {
            btn.disabled = false;
            btn.style.opacity = '1';
        }
    },
// =========================================================================
    // MULTI-TENANCY ZERO-READS: RESUELVE LOCALES DESDE CACHE 12H O FIRESTORE
    // =========================================================================
    async _evaluarContextosMultiTenant(user) {
        const claveCacheCtx = 'geokatu_contextos_cache_' + user.uid;
        const TTL_12_HORAS = 12 * 60 * 60 * 1000;
        let contextos = [];

        try {
            // 1. Verificar cache local de contextos (0 ms, 0 lecturas en recargas F5 o modo avion)
            const rawCache = localStorage.getItem(claveCacheCtx);
            if (rawCache) {
                const parsed = JSON.parse(rawCache);
                const vigente = parsed && parsed.timestamp && ((Date.now() - parsed.timestamp) < TTL_12_HORAS);
                if (Array.isArray(parsed.contextos) && parsed.contextos.length > 0 && (vigente || !navigator.onLine)) {
                    contextos = parsed.contextos;
                }
            }

         // 2. Solo consultar Firestore si no hay cache vigente y tenemos red
            if (contextos.length === 0 && navigator.onLine) {
                const snapPropio = await getDoc(doc(db, "Directorio", user.uid));
                if (snapPropio.exists()) {
                    const dataP = snapPropio.data();
                    const pinTitularValido = (dataP.pin_titular && /^\d{4}$/.test(String(dataP.pin_titular).trim()))
                        ? String(dataP.pin_titular).trim()
                        : "0000";
                    contextos.push({
                        idNegocio: user.uid,
                        nombre: dataP.nombre || "Mi Comercio",
                        rol: 'dueño',
                        esDueno: true,
                        operadorUid: user.uid,
                        almacen: "SALA_VENTAS",
                        codigoCajero: pinTitularValido,
                        horarioLaboral: null
                    });
                }
                const snapOperador = await getDoc(doc(db, "Usuarios_Operadores", user.uid));
                if (snapOperador.exists()) {
                    const opData = snapOperador.data();
                    const idPadre = opData.id_negocio;
                    const docPadreSnap = await getDoc(doc(db, "Directorio", idPadre));
                    const nombrePadre = docPadreSnap.exists() ? docPadreSnap.data().nombre : "Comercio Asignado";
                    contextos.push({
                        idNegocio: idPadre,
                        nombre: opData.nombre || nombrePadre,
                        nombreComercio: nombrePadre,
                        rol: opData.rol || 'cajero',
                        esDueno: false,
                        operadorUid: user.uid,
                        almacen: opData.almacen_habitual || "SALA_VENTAS",
                        codigoCajero: opData.codigo_cajero || "0000",
                        horarioLaboral: opData.horario_laboral || null
                    });
                }
                if (contextos.length > 0) {
                    localStorage.setItem(claveCacheCtx, JSON.stringify({
                        timestamp: Date.now(),
                        contextos: contextos
                    }));
                }
            }
            this._estado.contextosDetectados = contextos;
            if (contextos.length === 0) {
                this._mostrarError("No tienes comercios asociados como titular ni como operario.");
                return;
            }
            // Si ya habia un contexto o relevo activo en esta sesion, restaurarlo directamente
            const uidActivoPrevio = localStorage.getItem('geokatu_active_uid');
            if (uidActivoPrevio) {
                const relevoGuardado = localStorage.getItem('geokatu_operador_relevo_activo_' + uidActivoPrevio);
                if (relevoGuardado) {
                    try {
                        const ctxRelevo = JSON.parse(relevoGuardado);
                        if (ctxRelevo?.sesionAuthUid === user.uid && ctxRelevo.idNegocio === uidActivoPrevio && contextos.some(c => c.idNegocio === uidActivoPrevio)) {
                            this._iniciarProtocoloAperturaTurno(ctxRelevo);
                            return;
                        }
                    } catch (eR) {}
                }
                const ctxCoincidente = contextos.find(c => c.idNegocio === uidActivoPrevio);
                if (ctxCoincidente) {
                    this._iniciarProtocoloAperturaTurno(ctxCoincidente);
                    return;
                }
            }
            if (contextos.length === 1) {
                this._iniciarProtocoloAperturaTurno(contextos[0]);
            } else {
                this._mostrarSelectorContextos(contextos);
            }
        } catch (e) {
            this._mostrarError("Fallo validando credenciales de terminal: " + e.message);
        }
    },
    _mostrarSelectorContextos(contextos) {
        this._ocultarTodasLasVistas();
        const cont = document.getElementById('gk-contenedor-contextos');
        cont.innerHTML = '';
        contextos.forEach(ctx => {
            const card = document.createElement('div');
            card.className = 'gk-contexto-card';
            const ico = ctx.esDueno ? SVG_ICONS.tienda : SVG_ICONS.maletin;
            const tituloCard = ctx.nombreComercio || ctx.nombre;
            card.innerHTML =
                '<div style="display:flex; align-items:center; gap:10px; min-width:0;">' +
                    '<span style="color:#ff6b00; display:flex;">' + ico + '</span>' +
                    '<div style="overflow:hidden;">' +
                        '<strong style="display:block; font-size:12.5px; color:#fff; text-overflow:ellipsis; white-space:nowrap; overflow:hidden;">' + tituloCard + '</strong>' +
                        '<span style="font-size:10px; color:#888;">Sede: ' + ctx.almacen + ' | Rol: ' + ctx.rol + '</span>' +
                    '</div>' +
                '</div>' +
                '<span style="color:#ff6b00; display:flex;">' + SVG_ICONS.flechaDerecha + '</span>';
            card.onclick = () => this._iniciarProtocoloAperturaTurno(ctx);
            cont.appendChild(card);
        });
        document.getElementById('gk-vista-selector').style.display = 'flex';
        this._abrirModal();
    },
    // =========================================================================
    // PROTOCOLO APERTURA: EXIME AL DUENO Y A OFICINA; EXIGE GPS SOLO A EMPLEADOS
    // =========================================================================
    _iniciarProtocoloAperturaTurno(ctx) {
        if (!ctx) return;
        // Normalizar PIN para que jamas quede un codigo alfanumerico como D-KHI2 en el teclado numerico
        if (!ctx.codigoCajero || !/^\d{4}$/.test(String(ctx.codigoCajero).trim())) {
            ctx.codigoCajero = "0000";
        }
        this._estado.datosTurnoPendiente = ctx;
        const rutaActual = (window.location.pathname || '').toLowerCase();
        const esPortalOficina = rutaActual.indexOf('oficina') !== -1;
        const esTitularDueno = Boolean(ctx.esDueno === true || ctx.rol === 'dueño' || ctx.rol === 'owner');
        // REGLA ESTRICTA: El dueno o cualquier acceso a Oficina entra en 0 ms sin pedir GPS
        if (esTitularDueno || esPortalOficina) {
            this._concederAccesoTerminal(ctx, null, false);
            return;
        }
        const hoyStr = new Date().toISOString().split('T')[0];
        const claveGpsDia = 'geokatu_gps_apertura_' + ctx.idNegocio + '_' + hoyStr;
        const gpsGuardadoHoy = localStorage.getItem(claveGpsDia);
        const evaluacionHorario = this._evaluarHorarioOperario(ctx.horarioLaboral);
        if (gpsGuardadoHoy && !evaluacionHorario.fueraDeHorario) {
            this._concederAccesoTerminal(ctx, JSON.parse(gpsGuardadoHoy), false);
            return;
        }

        this._ocultarTodasLasVistas();
        const boxAlerta = document.getElementById('gk-box-alerta-horario');
        const txtAlerta = document.getElementById('gk-txt-alerta-horario');
        const lblBtn = document.getElementById('gk-lbl-btn-gps');

        if (evaluacionHorario.fueraDeHorario) {
            boxAlerta.style.display = 'flex';
            txtAlerta.innerText = evaluacionHorario.motivo;
            lblBtn.innerText = 'Aceptar Ingreso Extraordinario';
        } else {
            boxAlerta.style.display = 'none';
            lblBtn.innerText = 'Confirmar Presencia y Entrar';
        }

        document.getElementById('gk-vista-gps').style.display = 'flex';
        this._abrirModal();
    },

    _evaluarHorarioOperario(horario) {
        if (!horario || !horario.activo) {
            return { fueraDeHorario: false };
        }

        const ahora = new Date();
        const diaSemana = ahora.getDay();
        const minutosDia = ahora.getHours() * 60 + ahora.getMinutes();

        if (Array.isArray(horario.dias_permitidos) && !horario.dias_permitidos.includes(diaSemana)) {
            return {
                fueraDeHorario: true,
                motivo: 'Dia no programado en tu turno laboral habitual.'
            };
        }

        const tolerancia = Number(horario.tolerancia_minutos) || 45;
        const inicioConTol = (Number(horario.hora_inicio_minutos) || 0) - tolerancia;
        const finConTol = (Number(horario.hora_fin_minutos) || 1440) + tolerancia;

        if (minutosDia < inicioConTol || minutosDia > finConTol) {
            return {
                fueraDeHorario: true,
                motivo: 'Horario fuera de tu turno asignado (' + Math.floor(horario.hora_inicio_minutos / 60) + ':00 a ' + Math.floor(horario.hora_fin_minutos / 60) + ':00).'
            };
        }

        return { fueraDeHorario: false };
    },

    _ejecutarCapturaGPSApertura() {
        if (!navigator.geolocation) {
            this._mostrarError("Tu dispositivo no cuenta con sensor GPS compatible.");
            return;
        }

        const btn = document.getElementById('gk-btn-capturar-gps');
        btn.disabled = true;
        btn.innerText = "Sintonizando satelites GPS...";

        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const coordenadas = {
                    lat: Number(pos.coords.latitude.toFixed(6)),
                    lng: Number(pos.coords.longitude.toFixed(6)),
                    precision_m: Math.round(pos.coords.accuracy)
                };

                const ctx = this._estado.datosTurnoPendiente;
                const evaluacion = this._evaluarHorarioOperario(ctx.horarioLaboral);

                const hoyStr = new Date().toISOString().split('T')[0];
                localStorage.setItem('geokatu_gps_apertura_' + ctx.idNegocio + '_' + hoyStr, JSON.stringify(coordenadas));

                if (evaluacion.fueraDeHorario) {
                    await this._asentarIncidenciaFueraHorario(ctx, coordenadas, evaluacion.motivo);
                }

                                btn.disabled = false;
                btn.innerHTML = SVG_ICONS.gps + ' <span>Confirmar Presencia y Entrar</span>';
                this._concederAccesoTerminal(ctx, coordenadas, evaluacion.fueraDeHorario);
            },
            (err) => {
                btn.disabled = false;
                btn.innerHTML = `${SVG_ICONS.gps} <span>Confirmar Presencia y Entrar</span>`;
                this._mostrarError("GPS OBLIGATORIO: Debes permitir el acceso a tu ubicacion en el navegador para operar.");
            },
            { enableHighAccuracy: true, timeout: 9000, maximumAge: 0 }
        );
    },

    async _asentarIncidenciaFueraHorario(ctx, coords, motivo) {
        try {
            await addDoc(collection(db, "Alertas_Seguridad"), {
                id_negocio: ctx.idNegocio,
                tipo: "ACCESO_FUERA_DE_TURNO",
                estado: "requiere_auditoria_urgente",
                operador_uid: this._estado.usuarioAuth ? this._estado.usuarioAuth.uid : "LOCAL",
                codigo_cajero: ctx.codigoCajero,
                rol: ctx.rol,
                motivo: motivo,
                coordenadas: coords,
                timestamp_alerta: serverTimestamp(),
                resuelto: false
            });
        } catch (e) {
            console.warn("[Seguridad] Falla registrando alerta:", e.message);
        }
    },

   async _hidratarNominaLocal(idTienda, forzar = false) {
        if (!idTienda) return [];
        const claveNomina = 'geokatu_nomina_cache_' + idTienda;
        const TTL_12_HORAS = 12 * 60 * 60 * 1000;
        try {
            const cacheStr = localStorage.getItem(claveNomina);
            if (cacheStr && !forzar) {
                const parsed = JSON.parse(cacheStr);
                const vigente = parsed && parsed.timestamp && ((Date.now() - parsed.timestamp) < TTL_12_HORAS);
                if (Array.isArray(parsed.operarios) && (vigente || !navigator.onLine)) {
                    return parsed.operarios;
                }
            }
            if (!navigator.onLine) {
                return cacheStr ? (JSON.parse(cacheStr).operarios || []) : [];
            }

            const mapaOperarios = new Map();
            const ctxActual = this._estado.contextoActivo;
            if (ctxActual && ctxActual.idNegocio === idTienda && ctxActual.codigoCajero) {
                mapaOperarios.set(String(ctxActual.codigoCajero).trim(), {
                    pin: String(ctxActual.codigoCajero).trim(),
                    nombre: ctxActual.nombre || "Operario Titular",
                    rol: ctxActual.rol || "dueño",
                    esDueno: Boolean(ctxActual.esDueno),
                    operadorUid: ctxActual.operadorUid || this._estado.usuarioAuth?.uid,
                    almacen: ctxActual.almacen || "SALA_VENTAS",
                    horario_laboral: ctxActual.horarioLaboral || null
                });
            }

            const [snapEquipo, snapColab] = await Promise.all([
                getDocs(collection(db, "Directorio/" + idTienda + "/Equipo")).catch(() => ({ forEach: () => {} })),
                getDocs(collection(db, "Directorio/" + idTienda + "/Colaboradores")).catch(() => ({ forEach: () => {} }))
            ]);

            const registrarDoc = (docSnap) => {
                const d = docSnap.data();
                const pinOp = String(d.codigo_cajero || d.pin || '').trim();
                if (pinOp) {
                    mapaOperarios.set(pinOp, {
                        pin: pinOp,
                        nombre: d.nombre || "Operario",
                        rol: d.rol || "cajero",
                        esDueno: false,
                        operadorUid: d.uid || docSnap.id,
                        almacen: d.almacen_habitual || d.almacen || "SALA_VENTAS",
                        horario_laboral: d.horario_laboral || null
                    });
                }
            };
            snapEquipo.forEach(registrarDoc);
            snapColab.forEach(registrarDoc);

            const listaFinal = Array.from(mapaOperarios.values());
            localStorage.setItem(claveNomina, JSON.stringify({
                timestamp: Date.now(),
                operarios: listaFinal
            }));
            return listaFinal;
        } catch (e) {
            console.warn("[AuthGate] Aviso hidratando nomina local:", e.message);
            return [];
        }
    },
    _concederAccesoTerminal(ctx, coordenadas, esFueraHorario) {
        const sesionAuthUid = this._estado.usuarioAuth?.uid;
        ctx = { ...ctx, sesionAuthUid, operadorUid: ctx.operadorUid || sesionAuthUid };
        this._estado.contextoActivo = ctx;
        this._estado.sesionBloqueada = false;
        localStorage.setItem('geokatu_active_uid', ctx.idNegocio);
        if (sesionAuthUid) localStorage.setItem('geokatu_auth_uid', sesionAuthUid);
        localStorage.setItem('geokatu_cajero_rol', ctx.rol);
        localStorage.setItem('geokatu_almacen_activo', ctx.almacen);
        localStorage.setItem('geokatu_cajero_pin', ctx.codigoCajero);
        localStorage.setItem('geokatu_operador_relevo_activo_' + ctx.idNegocio, JSON.stringify(ctx));
        if (GeokatuDB && GeokatuDB.SecurityService && GeokatuDB.SecurityService.sellarSesionTerminalLocal) {
            GeokatuDB.SecurityService.sellarSesionTerminalLocal(ctx.idNegocio);
        }
        // Pre-cachear la nomina solo en terminales operativas (POS, Stock, Inventario, Mapatiena)
        if (/\/(pos|stock|inventario|mapatienda)(?:\.html)?\/?$/i.test(window.location.pathname || '')) {
            this._hidratarNominaLocal(ctx.idNegocio, false);
        }
        this._cerrarModal();

        if (typeof this._config.onSesionLista === 'function') {
            this._config.onSesionLista({
                ...ctx,
                gpsApertura: coordenadas,
                esFueraHorario: esFueraHorario
            });
        }
    },


    // =========================================================================
    // VIGILANTE DE INACTIVIDAD (10 MINUTOS) & RELEVO EN CALIENTE
    // =========================================================================
    _iniciarVigilanteInactividad() {
        const reiniciarContador = () => {
            if (this._estado.sesionBloqueada || !this._estado.contextoActivo) return;

            if (this._estado.timerInactividad) {
                clearTimeout(this._estado.timerInactividad);
            }

            const limiteMs = (this._config.minutosInactividad || 10) * 60 * 1000;
            this._estado.timerInactividad = setTimeout(() => {
                this.bloquearTerminalPorInactividad();
            }, limiteMs);
        };

        ['pointerdown', 'keydown', 'touchstart'].forEach(evt => {
            window.addEventListener(evt, reiniciarContador, { passive: true });
        });

        reiniciarContador();
    },

    bloquearTerminalPorInactividad() {
        if (!this._estado.contextoActivo) return;

        this._estado.sesionBloqueada = true;
        this._estado.pinAcumulado = '';
        this._estado.modoRelevoEnCaliente = false;

        this._ocultarTodasLasVistas();
        const ctx = this._estado.contextoActivo;

        const titBloqueo = document.getElementById('gk-titulo-estado-bloqueo');
        if (titBloqueo) titBloqueo.innerText = 'Terminal en Pausa (10 Min)';
        document.getElementById('gk-lbl-operario-bloqueo').innerText = 'Turno actual: ' + ctx.nombre;
        document.getElementById('gk-lbl-sede-bloqueo').innerText = 'Digita tu PIN personal o haz relevo abajo';

        this._actualizarPuntosPIN();
        document.getElementById('gk-vista-bloqueo').style.display = 'flex';
        this._abrirModal();

        if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
    },

    _activarModoRelevo() {
        this._estado.modoRelevoEnCaliente = true;
        this._estado.pinAcumulado = '';
        this._ocultarError();
        this._actualizarPuntosPIN();

        const titBloqueo = document.getElementById('gk-titulo-estado-bloqueo');
        if (titBloqueo) titBloqueo.innerText = 'Relevo Rapido de Operario';
        document.getElementById('gk-lbl-operario-bloqueo').innerText = "Nuevo Operario en Turno";
        document.getElementById('gk-lbl-sede-bloqueo').innerText = "Digita tu PIN personal de 4 digitos para asumir el mando";
        if (navigator.vibrate) navigator.vibrate(25);
    },

    _pulsarPin(digito) {
        if (this._estado.pinAcumulado.length >= 4) return;
        if (navigator.vibrate) navigator.vibrate(15);

        this._estado.pinAcumulado += String(digito);
        this._actualizarPuntosPIN();

        if (this._estado.pinAcumulado.length === 4) {
            this._validarPinDesbloqueo();
        }
    },

    _borrarPin() {
        if (this._estado.pinAcumulado.length === 0) return;
        this._estado.pinAcumulado = this._estado.pinAcumulado.slice(0, -1);
        this._actualizarPuntosPIN();
    },

    _limpiarPin() {
        this._estado.pinAcumulado = '';
        this._actualizarPuntosPIN();
    },

    _actualizarPuntosPIN() {
        const len = this._estado.pinAcumulado.length;
        for (let i = 0; i < 4; i++) {
            const dot = document.getElementById('gk-dot-' + i);
            if (dot) {
                if (i < len) dot.classList.add('lleno');
                else dot.classList.remove('lleno');
            }
        }
    },

    async _validarPinDesbloqueo() {
        const pinIngresado = String(this._estado.pinAcumulado).trim();
        const ctxActual = this._estado.contextoActivo;
        // CASO A: Si Marcela regresa y marca su propio PIN
        if (!this._estado.modoRelevoEnCaliente && String(ctxActual.codigoCajero) === pinIngresado) {
            this._estado.sesionBloqueada = false;
            this._cerrarModal();
            return;
        }
        // CASO B: Relevo en caliente 0-ms Offline-First contra la nomina sellada en cache local
        try {
            const idTienda = ctxActual.idNegocio;
            let nominaLocal = await this._hidratarNominaLocal(idTienda, false);
            let opEncontrado = nominaLocal.find(op => String(op.pin) === pinIngresado);

            // Fallback unico: si el PIN no figura en cache local y hay red (ej. empleado creado hace 1 minuto), refrescar nomina
            if (!opEncontrado && navigator.onLine) {
                nominaLocal = await this._hidratarNominaLocal(idTienda, true);
                opEncontrado = nominaLocal.find(op => String(op.pin) === pinIngresado);
            }

            if (opEncontrado) {
                const nuevoContexto = {
                    idNegocio: idTienda,
                    nombre: opEncontrado.nombre || "Operario Relevo",
                    rol: opEncontrado.rol || "cajero",
                    esDueno: Boolean(opEncontrado.esDueno),
                    operadorUid: opEncontrado.operadorUid || null,
                    sesionAuthUid: this._estado.usuarioAuth?.uid,
                    almacen: opEncontrado.almacen || ctxActual.almacen,
                    codigoCajero: pinIngresado,
                    horarioLaboral: opEncontrado.horario_laboral || null
                };
                const evalH = this._evaluarHorarioOperario(nuevoContexto.horarioLaboral);
                if (evalH.fueraDeHorario) {
                    this._estado.datosTurnoPendiente = nuevoContexto;
                    this._iniciarProtocoloAperturaTurno(nuevoContexto);
                    return;
                }
                this._estado.contextoActivo = nuevoContexto;
                this._estado.sesionBloqueada = false;
                localStorage.setItem('geokatu_cajero_pin', nuevoContexto.codigoCajero);
                localStorage.setItem('geokatu_cajero_rol', nuevoContexto.rol);
                localStorage.setItem('geokatu_almacen_activo', nuevoContexto.almacen);
                localStorage.setItem('geokatu_operador_relevo_activo_' + idTienda, JSON.stringify(nuevoContexto));
                this._cerrarModal();
                if (typeof this._config.onSesionLista === 'function') {
                    this._config.onSesionLista(nuevoContexto);
                }
                return;
            }
            this._mostrarError("PIN " + pinIngresado + " no pertenece a ningun operario de esta tienda.");
            this._limpiarPin();
        } catch (e) {
            this._mostrarError("Error al verificar PIN de relevo: " + e.message);
            this._limpiarPin();
        }
    },
    _abrirModal() {
        const root = document.getElementById('gk-auth-gate-root');
        if (root) root.classList.add('activo');
    },
    _cerrarModal() {
        const root = document.getElementById('gk-auth-gate-root');
        if (root) root.classList.remove('activo');
        this._ocultarError();
    },
    async cerrarSesion() {
        if (typeof this._config.onCerrarSesion === 'function') {
            try { this._config.onCerrarSesion(); } catch(e) {}
        }
        const idTiendaActiva = this._estado.contextoActivo ? this._estado.contextoActivo.idNegocio : localStorage.getItem('geokatu_active_uid');
        const uidUsuario = this._estado.usuarioAuth ? this._estado.usuarioAuth.uid : null;
        await GeokatuDB.SecurityService.cerrarSesion();
        GeokatuDB.SecurityService.destruirSesionTerminalLocal();
        localStorage.removeItem('geokatu_active_uid');
        localStorage.removeItem('geokatu_cajero_rol');
        localStorage.removeItem('geokatu_almacen_activo');
        localStorage.removeItem('geokatu_cajero_pin');
        localStorage.removeItem('geokatu_auth_uid');
        if (idTiendaActiva) {
            localStorage.removeItem('geokatu_operador_relevo_activo_' + idTiendaActiva);
            localStorage.removeItem('geokatu_nomina_cache_' + idTiendaActiva);
        }
        if (uidUsuario) {
            localStorage.removeItem('geokatu_contextos_cache_' + uidUsuario);
        }
        this._estado.contextoActivo = null;
        this._estado.sesionBloqueada = false;
        this._estado.pinAcumulado = '';
        this._abrirPantallaLogin();
    }

};

window.AuthGate = AuthGate;


