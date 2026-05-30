// auth-mando.js - Módulo de Autenticación Centralizada (Cero Magic Links)
import QRpidoDB from './core-db.js';

window.toggleVerPassword = function(inputId, btn) {
    const el = document.getElementById(inputId);
    if (el.type === 'password') {
        el.type = 'text'; btn.innerText = '🙈';
    } else {
        el.type = 'password'; btn.innerText = '👁️';
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
    if (mandato && !mandato.checked) return alert("Debes aceptar el Contrato de Mandato para operar en QRpido.");

    if(!email || !pass) return alert("Completa el correo y la contraseña.");

    const btn = document.getElementById('btn-registrar');
    btn.innerText = "Enviando TOTP..."; btn.disabled = true;
    
    const { success, error } = await QRpidoDB.SecurityService.registrarUsuario(email, pass, tipoCuenta);
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
    const { success, error } = await QRpidoDB.SecurityService.verificarTOTP(email, codigo);
    
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
    const { success, error } = await QRpidoDB.SecurityService.iniciarConGoogle();
    if (success) {
        localStorage.setItem('qrpido_session_validated', 'true'); // 🔑 Entregamos llave a usuario recurrente
        const modal = document.getElementById('modal-login');
        if (modal) modal.classList.remove('activo');

        
        // CORTE QUIRÚRGICO APLICADO: Si estamos en tramites.html, forzamos recarga.
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
    const { success, error } = await QRpidoDB.SecurityService.iniciarSesion(email, pass);
    if (!success) {
        alert("Error: " + error);
    } else {
        localStorage.setItem('qrpido_session_validated', 'true'); // 🔑 Entregamos llave a usuario recurrente
        const modal = document.getElementById('modal-login');
        if (modal) modal.classList.remove('activo');


        if(window.location.pathname.includes('tramites.html')) {
            location.reload();
        }
    }
};

window.cerrarSesion = async () => {
    await QRpidoDB.SecurityService.cerrarSesion();
    localStorage.removeItem('qrpido_session_validated'); // 🗑️ Destruimos la llave por seguridad
    const modal = document.getElementById('modal-login');
    if (modal) modal.classList.remove('activo');
    
    if(window.location.pathname.includes('tramites.html')) {
        location.reload();
    }
};


window.loginGoogleRadar = async () => {
    const { success, error } = await QRpidoDB.SecurityService.iniciarConGoogle();
    if (success) window.location.href = 'admin.html';
    else alert("Error con Google: " + error);
};

window.loginTradicionalRadar = async () => {
    const email = document.getElementById('radar-email').value.trim();
    const pass = document.getElementById('radar-pass').value;
    if(!email || !pass) return alert("Llena ambos campos.");
    const { success, error } = await QRpidoDB.SecurityService.iniciarSesion(email, pass);
    if (success) window.location.href = 'admin.html';
    else alert("Credenciales incorrectas: " + error);
};

QRpidoDB.SecurityService.observarEstadoSesion(async (user) => {
    const btnMod = document.getElementById('btn-acceso-moderacion');
    const btnSuper = document.getElementById('btn-acceso-superadmin');
    const formLogin = document.getElementById('form-login-activo');
    const panelActivo = document.getElementById('panel-usuario-activo');
    const btnMando = document.getElementById('btn-portal-mando');
    const btnSaldo = document.getElementById('contenedor-saldo-universal');
    
    // 🚖 CAPTURA DE BOTONES DE TRANSPORTE INYECTADOS EN EL SUBMENÚ DE INDEX.HTML
    const btnEmpresaTrans = document.getElementById('btn-panel-empresa');
    const btnConductorTrans = document.getElementById('btn-panel-conductor');

    if (user) {
        if(formLogin) formLogin.style.display = 'none';
        if(panelActivo) panelActivo.style.display = 'block';
        if(document.getElementById('nombre-usuario-activo')) document.getElementById('nombre-usuario-activo').innerText = user.email;
        if(btnMando) btnMando.style.background = 'var(--naranja)';
        
        try {
            const { success, data } = await QRpidoDB.SecurityService.obtenerRolAdmin(user.uid);
            if (success) {
                // Limpieza/Ocultado preventivo de accesos de movilidad antes de evaluar el rol activo
                if (btnEmpresaTrans) btnEmpresaTrans.style.display = 'none';
                if (btnConductorTrans) btnConductorTrans.style.display = 'none';

                if ((data.rol === 'admin' || data.rol === 'moderador' || data.rol === 'superadmin') && btnMod) btnMod.style.display = 'block';
                if (data.rol === 'superadmin' && btnSuper) btnSuper.style.display = 'block';
                
                // 🚖 CONMUTADOR REACTIVO DE ROLES DE MOVILIDAD
                if (data.rol === 'empresa_transporte' && btnEmpresaTrans) {
                    btnEmpresaTrans.style.display = 'block';
                    if (typeof window.inyectarCRMCorporativoEmpresa === 'function') {
                        window.inyectarCRMCorporativoEmpresa(user.uid);
                    }
                }
                
                if (data.rol === 'conductor' && btnConductorTrans) {
                    btnConductorTrans.style.display = 'block';
                    if (typeof window.verificarOnboardingCRM === 'function') {
                        window.verificarOnboardingCRM(user.uid, user.email, data.rol);
                    }
                }

                if (data.rol && btnSaldo) {
                    btnSaldo.style.display = 'flex';
                    if(data.saldo_logistica !== undefined && window.formatearMoneda) {
                        document.getElementById('texto-saldo-global').innerText = window.formatearMoneda(data.saldo_logistica);
                    }
                }
            }
        } catch (error) {
             console.error("Error al obtener rol:", error);
        }
        
    } else {
        if(btnSaldo) btnSaldo.style.display = 'none';
        if(formLogin) formLogin.style.display = 'block';
        if(panelActivo) panelActivo.style.display = 'none';
        if(btnMando) btnMando.style.background = 'var(--glass-bg)';
        if(btnMod) btnMod.style.display = 'none';
        if(btnSuper) btnSuper.style.display = 'none';
        
        // 🚖 REINICIO DE BOTONES EN NAVEGACIÓN ANÓNIMA O CIERRE DE SESIÓN
        if (btnEmpresaTrans) btnEmpresaTrans.style.display = 'none';
        if (btnConductorTrans) btnConductorTrans.style.display = 'none';
    }
});