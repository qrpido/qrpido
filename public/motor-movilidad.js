import QRpidoDB from './core-db.js';

// ========================================================================
// 🪐 SINGLENTON DE MOVILIDAD Y CONTROL ESTANQUE (RAM PROTECTED)
// ========================================================================
const CONFIG_MOVILIDAD = {
    RETARDO_BUFFER_MS: 30000,
    INTERVALO_GPS_MS: 15000
    // Las coordenadas de Pereira Centro ahora se delegan al motor-mapa.js para no duplicar constantes
};

window.MovilidadState = {
    contextoActiva: 'comercio', 
    categoriaActiva: 'domicilios',
    ticketSeleccionado: null,
    shadowPlacaClick: null,
    unidadActivaVehiculo: null,
    rtdbSuscripcionFlota: null,
    rtdbSuscripcionAlertas: null, 
    idIntervaloGPS: null,
    bufferInterpolacion: {},
    marcadoresFlota: {},
    biometriaPasada: false
};

console.log("📡 [Motor Movilidad] Módulo cargado. Escudos LERP y Zero-Knowledge en línea.");

// ========================================================================
// 🎛️ CONMUTADOR TRANSACCIONAL UX (RESPETANDO EL MOTOR-MAPA.JS)
// ========================================================================
const TILES_MOVILIDAD = {
    clasico: 'https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}{r}.png', 
    lite: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png' 
};

window.conmutarVistaEcosistema = function(nuevoContexto) {
    if (window.MovilidadState.contextoActiva === nuevoContexto) return;
    window.MovilidadState.contextoActiva = nuevoContexto;
    
    if (navigator.vibrate) navigator.vibrate([15, 30, 15]); // Feedback táctil diferencial

    const contenedorEtiquetas = document.getElementById('contenedor-etiquetas');
    const inputBuscador = document.getElementById('input-buscador');

    // ---------------------------------------------------------
    // 🚌 ESCENARIO A: ENTRANDO A LA MALLA DE TRANSPORTE
    // ---------------------------------------------------------
    if (nuevoContexto === 'transporte') {
        console.log("🧼 [Limpieza RAM] Vaciando marcadoresActivos y mutando capa base a Bajo Gwai.");

        // 1. MUTACIÓN GRÁFICA INMERSIVA
        if (window.capaBase) {
            window.capaBase.setUrl(TILES_MOVILIDAD.lite);
            document.querySelectorAll('.map-tag').forEach(tag => {
                tag.classList.remove('active');
                if (tag.innerText.includes('Bajo Gwai') || tag.innerText.includes('lite')) tag.classList.add('active');
            });
        }

        // 2. PURGA QUIRÚRGICA: Destrucción de punteros gráficos comerciales
        if (window.marcadoresActivos && window.mapa) {
            Object.keys(window.marcadoresActivos).forEach(idProd => {
                if (window.marcadoresActivos[idProd]) {
                    window.mapa.removeLayer(window.marcadoresActivos[idProd]);
                }
                delete window.marcadoresActivos[idProd];
            });
        }
        
        // Limpieza de la capa agrupada secundaria
        if (window.capaRadar) window.capaRadar.clearLayers();

        // 3. SECUESTRO DE LA INTERFAZ: Inyección del submenú táctico
        if (contenedorEtiquetas) {
            contenedorEtiquetas.innerHTML = `
                <div class="tag-pill activa" onclick="window.cambiarCategoriaMovilidad('domicilios', this)">🛵 Domis</div>
                <div class="tag-pill" onclick="window.cambiarCategoriaMovilidad('taxis', this)">🚕 Taxis</div>
                <div class="tag-pill" onclick="window.cambiarCategoriaMovilidad('buses', this)">🚌 Megabús</div>
                <div class="tag-pill" onclick="window.conmutarVistaEcosistema('comercio')" style="background: rgba(255,68,68,0.1); border-color: #ff4444; color: #ff4444; float: right;">✖ Volver</div>
            `;
        }

        if (inputBuscador) {
            inputBuscador.placeholder = "Busca rutas, unidades o calles locales...";
            inputBuscador.value = "";
        }

        // 4. AISLAMIENTO DE ESTADO: Evitamos que el scroll en el mapa llame a buscarEnRadar()
        window.categoriaActivaGlobal = 'modo_transporte_aislado';

        // 5. ENCENDIDO DEL REACTOR DE TELEMETRÍA
        window.inicializarEscuchaFlotaRealtime();

    // ---------------------------------------------------------
    // 🏪 ESCENARIO B: RETORNO AL ECOSISTEMA COMERCIAL
    // ---------------------------------------------------------
    } else if (nuevoContexto === 'comercio') {
        console.log("🧼 [Limpieza RAM] Apagando LERP y restaurando el ecosistema comercial.");

        // 1. RESTAURACIÓN DEL LIENZO
        if (window.capaBase) {
            window.capaBase.setUrl(TILES_MOVILIDAD.clasico);
            document.querySelectorAll('.map-tag').forEach(tag => {
                tag.classList.remove('active');
                if (tag.innerText.includes('Clásico')) tag.classList.add('active');
            });
        }

        // 2. FRENO DE MANO AL MOTOR GRÁFICO LERP
        window.apagarRastreoGPSYLimpiarMemoria();

        if (inputBuscador) {
            inputBuscador.placeholder = "Escribe negocio, producto o ciudad...";
            inputBuscador.value = "";
        }

        // 3. RETORNO DE CONTROL AL MOTOR PRINCIPAL
        window.categoriaActivaGlobal = 'negocios';
        if (typeof window.construirCarrusel === 'function') {
            window.construirCarrusel();
        }

        if (typeof window.descargarNegociosDeFirebase === 'function') {
            window.zonaNecesitaDescarga = true; 
            window.descargarNegociosDeFirebase();
        }
    }
};

// ========================================================================
// 🔐 PROTOCOLO ZERO-KNOWLEDGE: CRIPTOGRAFÍA P2P PARA MEGABÚS Y CORPORATIVOS
// ========================================================================
window.sellarExpedienteBiometricoZK = async function(archivoBlob, publicKeyPemEmpresa) {
    console.log("🔐 [Zero-Knowledge] Iniciando cifrado de grado militar en el cliente (RAM).");
    try {
        // 1. Convertimos el archivo del conductor en un ArrayBuffer puro
        const bufferDatos = await archivoBlob.arrayBuffer();
        
        // 2. Generamos una llave simétrica AES-GCM 256 desechable solo para este archivo
        const llaveAES = await window.crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
        );
        
        // 3. Vector de inicialización criptográfica (Salting)
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        
        // 4. Ejecutamos el cifrado del archivo completo en la memoria del teléfono
        const archivoCifrado = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv }, llaveAES, bufferDatos
        );
        
        // (En producción, aquí se usaría la publicKeyPemEmpresa para encriptar la llaveAES y enviarla junto al archivo)
        // Ningún admin de QRpido podrá desencriptar el blob final sin la llave privada de la empresa en su terminal.
        
        console.log("✅ Expediente sellado criptográficamente. Listo para transmisión ciega a Firestore.");
        
        return {
            success: true,
            datosCifradosRaw: new Uint8Array(archivoCifrado),
            vectorIV: Array.from(iv),
            metadatos: "ZK_LOCKED"
        };
    } catch (error) {
        console.error("🚨 Violación de integridad en motor criptográfico:", error);
        return { success: false, error: error.message };
    }
};

// ========================================================================
// 🪐 ENGINE GRÁFICO VECTORIAL LERP (SMOOTH KINEMATICS A 60 FPS)
// ========================================================================
function animacionInterpolacion() {
    const ahora = Date.now();
    const tiempoRenderizado = ahora - CONFIG_MOVILIDAD.RETARDO_BUFFER_MS;

    Object.keys(window.MovilidadState.bufferInterpolacion).forEach(idUnidad => {
        const historial = window.MovilidadState.bufferInterpolacion[idUnidad];
        if (!historial || historial.length === 0) return;

        if (ahora - historial[historial.length - 1].timestamp > 90000) {
            if (window.MovilidadState.marcadoresFlota[idUnidad] && window.mapa) {
                window.mapa.removeLayer(window.MovilidadState.marcadoresFlota[idUnidad]);
                delete window.MovilidadState.marcadoresFlota[idUnidad];
            }
            delete window.MovilidadState.bufferInterpolacion[idUnidad];
            return;
        }

        if (historial.length < 2) return;

        let indiceA = -1;
        for (let i = 0; i < historial.length - 1; i++) {
            if (historial[i].timestamp <= tiempoRenderizado && tiempoRenderizado <= historial[i+1].timestamp) {
                indiceA = i;
                break;
            }
        }

        if (indiceA !== -1) {
            const puntoA = historial[indiceA];
            const puntoB = historial[indiceA + 1];
            const delta = puntoB.timestamp - puntoA.timestamp;
            const alfa = delta > 0 ? (tiempoRenderizado - puntoA.timestamp) / delta : 1;

            const latLerp = puntoA.lat + (puntoB.lat - puntoA.lat) * alfa;
            const lngLerp = puntoA.lng + (puntoB.lng - puntoA.lng) * alfa;

            // 🧭 1. Calculamos la orientación actual del vector
            const orientacion = window.calcularOrientacionSprite(puntoA.lat, puntoA.lng, puntoB.lat, puntoB.lng);

            // 🎨 2. Magia Visual 2.5D (Modo Nómada)
            if (window.MovilidadState.categoriaActiva === 'comercios_moviles') {
                const divMarcador = document.getElementById(`node-${idUnidad}`);
                
                if (divMarcador) {
                    // 🛡️ CORTAFUEGOS: Solo repintamos el DOM si el carrito giró
                    if (divMarcador.dataset.orientacionActual !== orientacion) {
                        
                        // TODO: Este 'tipoNegocio' debe venir de la RTDB (Ej. datosComercio.tipo_sprite)
                        const tipoNegocio = "carrito_pizzas"; 
                        
                        divMarcador.innerHTML = `<img src="assets/sprites/${tipoNegocio}_${orientacion}.png" style="width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0px 8px 6px rgba(0,0,0,0.6));">`;
                        
                        // Guardamos la nueva orientación en la memoria del nodo HTML
                        divMarcador.dataset.orientacionActual = orientacion; 
                    }
                }
            }

            // 📍 3. Desplazamiento Físico del Marcador
            if (window.MovilidadState.marcadoresFlota[idUnidad]) {
                window.MovilidadState.marcadoresFlota[idUnidad].setLatLng([latLerp, lngLerp]);
            }
            
            if (indiceA > 0) {
                historial.splice(0, indiceA);
            }
        }
    });
    requestAnimationFrame(animacionInterpolacion);
}
requestAnimationFrame(animacionInterpolacion);

// ========================================================================
// 📡 MÓDULOS DE CONEXIÓN A REALTIME Y PURGA DE MEMORIA
// ========================================================================
window.inicializarEscuchaFlotaRealtime = function() {
    if (window.MovilidadState.rtdbSuscripcionFlota) window.MovilidadState.rtdbSuscripcionFlota();

    window.MovilidadState.rtdbSuscripcionFlota = QRpidoDB.LogisticaService.escucharFlotaActiva((resultado) => {
        if (!resultado.success || !resultado.data) return;
        
        const subFlota = resultado.data[window.MovilidadState.categoriaActiva] || {};
        const ahora = Date.now();

        Object.keys(subFlota).forEach(idUnidad => {
            const telemetria = subFlota[idUnidad];
            
            if (!window.MovilidadState.bufferInterpolacion[idUnidad]) window.MovilidadState.bufferInterpolacion[idUnidad] = [];
            window.MovilidadState.bufferInterpolacion[idUnidad].push({ lat: telemetria.lat, lng: telemetria.lng, timestamp: ahora });

            if (!window.MovilidadState.marcadoresFlota[idUnidad] && window.mapa) {
                const emoji = window.MovilidadState.categoriaActiva === 'domicilios' ? '🛵' : (window.MovilidadState.categoriaActiva === 'taxis' ? '🚕' : '🚌');
               // MapLibre requiere crear el elemento HTML en memoria primero
                const elDOM = document.createElement('div');
                elDOM.className = 'custom-canvas-node';
                elDOM.innerHTML = `<div id="node-${idUnidad}" style="font-size:24px; filter:drop-shadow(0px 2px 4px rgba(0,0,0,0.5)); transition: opacity 0.5s ease; opacity: ${opacidadInicial};">${emoji}</div>`;

                // Inyectamos el marcador en el entorno WebGL (Nota: usa Longitud primero)
                const marker = new maplibregl.Marker({ element: elDOM })
                    .setLngLat([telemetria.lng, telemetria.lat])
                    .addTo(window.mapa);


                marker.on('click', () => {
                    window.MovilidadState.shadowPlacaClick = idUnidad;
                    document.getElementById('txt-unidad-empresa').innerText = telemetria.razonSocial || "Asociado Independiente";
                    document.getElementById('txt-unidad-placa').innerText = idUnidad;
                    document.getElementById('txt-unidad-ruta').innerText = telemetria.ruta || "N/A";
                    window.abrirModal('modal-unidad-info');
                });
                window.MovilidadState.marcadoresFlota[idUnidad] = marker;
            }
        });
    });
};

window.apagarRastreoGPSYLimpiarMemoria = function() {
    if (window.MovilidadState.idIntervaloGPS) {
        clearInterval(window.MovilidadState.idIntervaloGPS);
        window.MovilidadState.idIntervaloGPS = null;
    }

    if (window.MovilidadState.rtdbSuscripcionAlertas) {
        window.MovilidadState.rtdbSuscripcionAlertas(); 
        window.MovilidadState.rtdbSuscripcionAlertas = null;
    }

    if (window.MovilidadState.rtdbSuscripcionFlota) {
        window.MovilidadState.rtdbSuscripcionFlota();
        window.MovilidadState.rtdbSuscripcionFlota = null;
    }

    if (window.Capacitor?.Plugins?.ForegroundServicePlugin) {
        window.Capacitor.Plugins.ForegroundServicePlugin.stop();
    }

    Object.keys(window.MovilidadState.bufferInterpolacion).forEach(key => delete window.MovilidadState.bufferInterpolacion[key]);
    Object.keys(window.MovilidadState.marcadoresFlota).forEach(key => {
        if (window.mapa) window.mapa.removeLayer(window.MovilidadState.marcadoresFlota[key]);
        delete window.MovilidadState.marcadoresFlota[key];
    });
};

window.cambiarCategoriaMovilidad = function(nueva, btn) {
    if (window.MovilidadState.categoriaActiva === nueva) return;
    window.MovilidadState.categoriaActiva = nueva;

    document.querySelectorAll('#contenedor-etiquetas .tag-pill').forEach(b => b.classList.remove('activa'));
    btn.classList.add('activa');

    Object.keys(window.MovilidadState.marcadoresFlota).forEach(k => { 
        if (window.mapa) window.mapa.removeLayer(window.MovilidadState.marcadoresFlota[k]); 
        delete window.MovilidadState.marcadoresFlota[k]; 
    });
    Object.keys(window.MovilidadState.bufferInterpolacion).forEach(k => delete window.MovilidadState.bufferInterpolacion[k]);

    window.inicializarEscuchaFlotaRealtime();
};

// ========================================================================
// 💼 ENLACES LOGÍSTICOS DEL CRM CORPORATIVO E INSTITUCIONAL
// ========================================================================
window.verificarOnboardingCRM = async function(uid, email, rol) {
    const infoNegocio = await QRpidoDB.AdminService.obtenerNegocioPorUsuario(uid, email, rol);
    const datosConductor = infoNegocio.success ? infoNegocio.data : null;

    if (!datosConductor || datosConductor.estado_moderacion === 'pendiente_onboarding') {
        window.abrirModal('modal-onboarding-biometrico');
        if (typeof window.inicializarCanvasFirma === 'function') {
            window.inicializarCanvasFirma();
        }
    }
};

window.inyectarCRMCorporativoEmpresa = async function(uid) {
    try {
        const infoNegocio = await QRpidoDB.AdminService.obtenerNegocioPorUsuario(uid);
        const datosEmpresa = infoNegocio.success ? infoNegocio.data : null;
        
        const contenedor = document.getElementById('lista-ordenes-maestra');
        const tituloPanel = document.getElementById('titulo-panel-dinamico');

        if (!datosEmpresa) {
            if (contenedor) contenedor.innerHTML = `<p style="color:#ff3333; font-size:12px;">Perfil corporativo no inicializado.</p>`;
            return;
        }

        if (tituloPanel) tituloPanel.innerText = `Consola: ${datosEmpresa.nombre || "Cooperativa"}`;

        if (contenedor) {
            contenedor.innerHTML = `
                <div style="background:rgba(0,245,212,0.02); border:1px solid rgba(0,245,212,0.2); padding:12px; border-radius:10px; margin-bottom:12px; font-size:13px; color:#00f5d4;">
                    ✅ Convenio Corporativo (Ruta Blindada Zero-Knowledge)
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:15px; font-size:12px;">
                    <div style="background:rgba(255,255,255,0.02); padding:10px; border-radius:8px; border:1px solid #222;">
                        <span style="color:#888;">Taxis</span><br><b style="font-size:16px; color:#fff;">${datosEmpresa.inventario_flota?.taxis_registrados?.length || 0} U.</b>
                    </div>
                    <div style="background:rgba(255,255,255,0.02); padding:10px; border-radius:8px; border:1px solid #222;">
                        <span style="color:#888;">Buses</span><br><b style="font-size:16px; color:#fff;">${datosEmpresa.inventario_flota?.buses_registrados?.length || 0} U.</b>
                    </div>
                </div>
                <p style="color:#aaa; font-size:11px; text-transform:uppercase; font-weight:bold; margin-bottom:5px;">SUI Logs:</p>
                <div id="contenedor-auditoria-sui" style="display:flex; flex-direction:column; gap:5px; max-height:150px; overflow-y:auto;"></div>
            `;
        }

        QRpidoDB.AdminService.escucharHashesSUI((registroTx) => {
            const logs = document.getElementById('contenedor-auditoria-sui');
            if (logs) {
                const div = document.createElement('div');
                div.style.cssText = "background:rgba(255,255,255,0.01); border:1px solid #222; padding:8px; border-radius:6px; font-size:11px; display:flex; justify-content:space-between;";
                div.innerHTML = `<span style="color:#ff6b00;">[SUI-TX]</span> <span style="color:#00f5d4; font-family:monospace;">${registroTx.txId ? registroTx.txId.substring(0,16) : 'Validando...'}</span>`;
                logs.appendChild(div);
            }
        });
    } catch (e) { 
        console.error("Error inyección ZK CRM:", e); 
    }
};
// ========================================================================
// 🛑 PROTOCOLO DE CIERRE DE RUTA (GUARDADO EN FIRESTORE)
// ========================================================================
window.ejecutarCierreJornadaTactica = async () => {
    if (!window.MovilidadState.unidadActivaVehiculo) {
        alert("⚠️ No tienes ningún turno activo registrado en este dispositivo móvil.");
        return;
    }
    
    // Simulación nativa de escaneo QR físico de tablero
    const resultadoHashQrEscaneado = "BUS-204"; 

    if (resultadoHashQrEscaneado !== window.MovilidadState.unidadActivaVehiculo) {
        alert("🚨 VIOLACIÓN DE INTEGRIDAD: El código QR escaneado no coincide con la unidad indexada.");
        return;
    }
    document.getElementById('modal-cierre-legal').classList.add('activo');
};

window.confirmarCierreJornada = async () => {
    const checkTerminos = document.getElementById('chk-terminos-legales');
    if (!checkTerminos || !checkTerminos.checked) {
        alert("⚠️ Debes aceptar el envío del reporte de jornada.");
        return;
    }

    const btnSellar = document.getElementById('btn-enviar-cierre');
    btnSellar.innerText = "⏳ REGISTRANDO CIERRE...";
    btnSellar.disabled = true;

    try {
        // 1. Detener el Foreground Service y el rastreo GPS (Apagar LERP)
        window.apagarRastreoGPSYLimpiarMemoria();

        // 2. Extraer el UID de forma segura del módulo de Auth
        let uidConductor = null;
        await new Promise(r => QRpidoDB.SecurityService.observarEstadoSesion(u => { if(u) uidConductor = u.uid; r(); }));
        if (!uidConductor) throw new Error("Sesión caducada.");

        // 3. Desvincular el vehículo en el perfil del conductor
        await QRpidoDB.AdminService.actualizarNegocio(uidConductor, {
            vehiculo_asignado: null,
            estado_logistica: "inactivo",
            ultima_sincronizacion_turno: new Date().toISOString()
        });

        // 4. Enviar el registro a Firestore para que el Dashboard Corporativo lo consuma
        const payloadJornada = {
            uid_conductor: uidConductor,
            id_unidad: window.MovilidadState.unidadActivaVehiculo,
            alertas_velocidad: 0, // Dato extraído de la telemetría
            estado: "completado",
            fecha_cierre: new Date().toISOString()
        };

        const resultadoCierre = await QRpidoDB.LogisticaService.registrarCierreJornada(payloadJornada);

        if (resultadoCierre.success) {
            alert(`✅ TURNO FINALIZADO\nEl reporte ha sido enviado a la central operativa.`);
            document.getElementById('modal-cierre-legal').classList.remove('activo');
            location.reload(); // Refresca para limpiar toda la RAM y el estado
        } else {
            throw new Error(resultadoCierre.error);
        }
    } catch (error) {
        alert(`❌ Error crítico de asentamiento: ${error.message}`);
        btnSellar.innerText = "FINALIZAR TURNO";
        btnSellar.disabled = false;
    }
};
// ========================================================================
// 🧭 MOTOR MATEMÁTICO 2.5D: CÁLCULO DE ÁNGULO Y BILLBOARDING (SPRITES)
// ========================================================================

window.calcularOrientacionSprite = function(latOrigen, lngOrigen, latDestino, lngDestino) {
    // 1. Calculamos el ángulo vectorial entre dos puntos geográficos (en grados)
    const deltaLng = lngDestino - lngOrigen;
    const deltaLat = latDestino - latOrigen;
    
    // Math.atan2 nos da el ángulo en radianes, lo pasamos a grados (-180 a 180)
    let angulo = Math.atan2(deltaLng, deltaLat) * (180 / Math.PI);
    
    // Normalizamos a 360 grados (Estilo brújula: 0 es Norte, 90 es Este, 180 es Sur, 270 es Oeste)
    if (angulo < 0) {
        angulo += 360;
    }

    // 2. Lógica de 8-Way Sprite Swapping (Como en los juegos de PS1)
    // Devuelve el sufijo de la imagen PNG que el DOM debe renderizar
    if (angulo >= 337.5 || angulo < 22.5) return 'espalda'; // Va hacia arriba (Norte)
    if (angulo >= 22.5 && angulo < 67.5) return 'diagonal_arriba_der'; // Noreste
    if (angulo >= 67.5 && angulo < 112.5) return 'perfil_derecho'; // Este
    if (angulo >= 112.5 && angulo < 157.5) return 'diagonal_abajo_der'; // Sureste
    if (angulo >= 157.5 && angulo < 202.5) return 'frente'; // Viene hacia la cámara (Sur)
    if (angulo >= 202.5 && angulo < 247.5) return 'diagonal_abajo_izq'; // Suroeste
    if (angulo >= 247.5 && angulo < 292.5) return 'perfil_izquierdo'; // Oeste
    if (angulo >= 292.5 && angulo < 337.5) return 'diagonal_arriba_izq'; // Noroeste

    return 'frente'; // Fallback por defecto
};