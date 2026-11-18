// auth-mando.js - Módulo de Autenticación Centralizada (Cero Magic Links)
import GeokatuDB from './core-db.js';

const SVG_OJO_VISIBLE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const SVG_OJO_OCULTO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

window.toggleVerPassword = function(inputId, btn) {
    const el = document.getElementById(inputId);
    if (!el || !btn) return;
    if (el.type === 'password') {
        el.type = 'text';
        btn.innerHTML = SVG_OJO_OCULTO;
    } else {
        el.type = 'password';
        btn.innerHTML = SVG_OJO_VISIBLE;
    }
};

// MOTOR DE PANELES (Bóveda admin.html)
window.mostrarPanelAuth = function(panel) {
    if(navigator.vibrate) navigator.vibrate(50);
    try {
        document.getElementById('panel-seleccion').style.display = 'none';
        document.getElementById('panel-login-form').style.display = 'none';
        document.getElementById('panel-registro-form').style.display = 'none';
        
        if (panel === 'seleccion') document.getElementById('panel-seleccion').style.display = 'block';
        if (panel === 'login') document.getElementById('panel-login-form').style.display = 'block';
        if (panel === 'registro') document.getElementById('panel-registro-form').style.display = 'block';
        if (panel === 'totp') document.getElementById('panel-totp-form').style.display = 'block';
    } catch(e) {
        console.error("Error en paneles:", e.message);
    }
};

// REGISTRO DE NUEVA BÓVEDA
window.registrarUsuario = async () => {
    if (navigator.vibrate) navigator.vibrate(50);
    const email = document.getElementById('reg-email').value.trim();
    const pass = document.getElementById('reg-pass').value;
    const tipoCuenta = document.querySelector('input[name="tipo_cuenta"]:checked')?.value || 'servicio';
    
    // --- ESCUDO LEGAL Y ANTI-BOTS ---
    const honeypot = document.getElementById('miel_bot');
    if (honeypot && honeypot.value !== '') return; // Trampa activada: el bot muere en silencio.
    
    const mandato = document.getElementById('acepto-mandato');
    if (mandato && !mandato.checked) return alert("Debes aceptar el Contrato de Mandato para operar en Geokatu.");

    if(!email || !pass) return alert("Completa el correo y la contraseña.");

    const btn = document.getElementById('btn-registrar');
    btn.innerText = "Enviando TOTP..."; btn.disabled = true;
    
    const { success, error } = await GeokatuDB.SecurityService.registrarUsuario(email, pass, tipoCuenta);
    if (success) {
        if (navigator.vibrate) navigator.vibrate([50, 100, 50]);
        // UX Corregida: Nos quedamos en el mapa y pasamos a la validación en 2 pasos
        window.mostrarPanelAuth('totp');
    } else {
        alert("Error al registrar: " + error);
        btn.innerText = "Crear mi cuenta ahora"; btn.disabled = false;
    }
};

// VALIDACIÓN TOTP (Cortafuegos Anti-Bots y Verificación)
window.validarCodigoRegistro = async () => {
    if (navigator.vibrate) navigator.vibrate(50);
    // Recuperamos el email del paso anterior de registro
    const email = document.getElementById('reg-email').value.trim();
    const codigo = document.getElementById('input-totp').value.trim();

    if (!codigo || codigo.length !== 6) return alert("El código debe tener exactamente 6 dígitos.");

    const btn = document.getElementById('btn-validar-totp');
    btn.innerText = "Verificando..."; btn.disabled = true;

    // Delegamos la validación al Cerebro (core-db.js / Cloud Functions)
    const { success, error } = await GeokatuDB.SecurityService.verificarTOTP(email, codigo);
    
    if (success) {
        if (navigator.vibrate) navigator.vibrate([50, 100, 50]);
        // Cierre inmersivo: Forzamos estado de sesión validada en memoria local 
        // antes de permitir cualquier renderizado de datos sensibles.
        localStorage.setItem('qrpido_session_validated', 'true');
        
        const modal = document.getElementById('modal-login');
        if (modal) modal.classList.remove('activo');

        // Forzamos la recarga si estamos en la vista de tramites
        if(window.location.pathname.includes('tramites.html')) {
            location.reload();
        }

    } else {
        alert("Código inválido o expirado: " + error);
        btn.innerText = "Validar Código"; btn.disabled = false;
    }
};

// LOGIN CON GOOGLE
window.iniciarConGoogle = async () => {
    const { success, error } = await GeokatuDB.SecurityService.iniciarConGoogle();
    if (success) {
        localStorage.setItem('qrpido_session_validated', 'true');
        const modal = document.getElementById('modal-login');
        if (modal) modal.classList.remove('activo');

        if(window.location.pathname.includes('tramites.html')) {
            location.reload();
        }

    } else {
        alert("Error al iniciar con Google: " + error);
    }
};

window.iniciarSesion = async () => {
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-pass').value;
    const { success, error } = await GeokatuDB.SecurityService.iniciarSesion(email, pass);
    if (!success) {
        alert("Error: " + error);
    } else {
        localStorage.setItem('qrpido_session_validated', 'true');
        const modal = document.getElementById('modal-login');
        if (modal) modal.classList.remove('activo');

        if(window.location.pathname.includes('tramites.html')) {
            location.reload();
        }
    }
};

window.cerrarSesion = async () => {
    await GeokatuDB.SecurityService.cerrarSesion();
    window.rolUsuarioActual = null;
    localStorage.removeItem('qrpido_session_validated');
    const modal = document.getElementById('modal-login');
    if (modal) modal.classList.remove('activo');
    
    if(window.location.pathname.includes('tramites.html')) {
        location.reload();
    }
};

window.loginGoogleRadar = async () => {
    const { success, error } = await GeokatuDB.SecurityService.iniciarConGoogle();
    if (success) window.location.href = 'admin.html';
    else alert("Error con Google: " + error);
};

window.loginTradicionalRadar = async () => {
    const email = document.getElementById('radar-email').value.trim();
    const pass = document.getElementById('radar-pass').value;
    if(!email || !pass) return alert("Llena ambos campos.");
    const { success, error } = await GeokatuDB.SecurityService.iniciarSesion(email, pass);
    if (success) window.location.href = 'admin.html';
    else alert("Credenciales incorrectas: " + error);
};

GeokatuDB.SecurityService.observarEstadoSesion(async (user) => {
    const btnMod = document.getElementById('btn-acceso-moderacion');
    const btnSuper = document.getElementById('btn-acceso-superadmin');
    const formLogin = document.getElementById('form-login-activo');
    const panelActivo = document.getElementById('panel-usuario-activo');
    const btnMando = document.getElementById('btn-portal-mando');
    const btnSaldo = document.getElementById('contenedor-saldo-universal');
    const btnEmpresaTrans = document.getElementById('btn-panel-empresa');
    const btnConductorTrans = document.getElementById('btn-panel-conductor');
    const btnCabina = document.getElementById('btn-cabina');
    const btnPerf = document.getElementById('btn-audit-perf');
    const btnRep = document.getElementById('btn-audit-rep');
    const btnOfiEmp = document.getElementById('btn-oficina-empleado');
    const btnModalOfiEmp = document.getElementById('btn-modal-oficina-empleado');

    if (user) {
        window.idUsuarioActual = user.uid;
        window.rolUsuarioActual = null;
        if (formLogin) formLogin.style.display = 'none';
        if (panelActivo) panelActivo.style.display = 'block';
        if (document.getElementById('nombre-usuario-activo')) document.getElementById('nombre-usuario-activo').innerText = user.email;
        if (btnMando) btnMando.style.background = 'var(--naranja)';
        if (btnEmpresaTrans) btnEmpresaTrans.style.display = 'none';
        if (btnConductorTrans) btnConductorTrans.style.display = 'none';
        if (btnCabina) btnCabina.style.display = 'none';
        if (btnPerf) btnPerf.style.display = 'none';
        if (btnRep) btnRep.style.display = 'none';
        if (typeof window.sincronizarBotonesLlave === 'function') window.sincronizarBotonesLlave();

        try {
            const { success, data } = await GeokatuDB.SecurityService.obtenerRolAdmin(user.uid);
            if (success && data) {
                const rol = String(data.rol || '').toLowerCase();
                window.rolUsuarioActual = rol || null;

                if ((rol === 'admin' || rol === 'moderador' || rol === 'superadmin') && btnMod) btnMod.style.display = 'block';
                if (rol === 'superadmin') {
                    if (btnSuper) btnSuper.style.display = 'block';
                    if (btnPerf) btnPerf.style.display = 'block';
                    if (btnRep) btnRep.style.display = 'block';
                }

                if (rol === 'empresa_transporte' && btnEmpresaTrans) {
                    btnEmpresaTrans.style.display = 'block';
                    if (typeof window.inyectarCRMCorporativoEmpresa === 'function') {
                        window.inyectarCRMCorporativoEmpresa(user.uid);
                    }
                }

                if (rol === 'conductor') {
                    if (btnCabina) btnCabina.style.display = 'block';
                    if (btnConductorTrans) btnConductorTrans.style.display = 'block';
                    if (typeof window.verificarOnboardingCRM === 'function') {
                        window.verificarOnboardingCRM(user.uid, user.email, rol);
                    }
                }

                if (rol && btnSaldo) {
                    btnSaldo.style.display = 'flex';
                    if (data.saldo_logistica !== undefined && window.formatearMoneda) {
                        document.getElementById('texto-saldo-global').innerText = window.formatearMoneda(data.saldo_logistica);
                    }
                }
            }
        } catch (error) {
            console.error('Error al obtener rol:', error);
        } finally {
            if (typeof window.sincronizarBotonesLlave === 'function') window.sincronizarBotonesLlave();
        }
    } else {
        window.idUsuarioActual = null;
        window.rolUsuarioActual = null;
        if (btnSaldo) btnSaldo.style.display = 'none';
        if (formLogin) formLogin.style.display = 'block';
        if (panelActivo) panelActivo.style.display = 'none';
        if (btnMando) btnMando.style.background = 'var(--glass-bg)';
        if (btnMod) btnMod.style.display = 'none';
        if (btnSuper) btnSuper.style.display = 'none';
        if (btnEmpresaTrans) btnEmpresaTrans.style.display = 'none';
        if (btnConductorTrans) btnConductorTrans.style.display = 'none';
        if (btnCabina) btnCabina.style.display = 'none';
        if (btnPerf) btnPerf.style.display = 'none';
        if (btnRep) btnRep.style.display = 'none';
        if (btnOfiEmp) btnOfiEmp.style.display = 'none';
        if (btnModalOfiEmp) btnModalOfiEmp.style.display = 'none';
        if (typeof window.sincronizarBotonesLlave === 'function') window.sincronizarBotonesLlave();
    }
});
