import GeokatuDB from './core-db.js';
import { BillingGuard } from './billing-guard.js';
import { MotorLector } from './lector-motor.js';
import { MotorBalanza } from './balanza-motor.js';
import { MotorCajonMonedero } from './cajon-motor.js';
import { QRLocal } from './qrcode-local.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

const auth = getAuth();


// ==========================================
// ESTADO GLOBAL DE LA TERMINAL POS
// ==========================================
let idNegocio = localStorage.getItem('geokatu_active_uid') || null;
let controlFacturacionActivo = null; // 🚦 Control de cupo y recargas
let catalogoLocal = [];
let carrito = [];
let ticketsEnEspera = [];
let balanza = null;
let pesoEnVivoActual = 0.000;
let productoEnPesajeManual = null;
let ultimoTicketIdVendido = null; // Memoria del último ticket para anulación rápida
let turnoCajaActivo = null; // Información de la sesión de caja abierta
let acumuladoTurno = { 
    efectivo: 0, 
    tarjeta: 0, 
    nequi: 0, 
    base_gravable: 0, 
    iva_19: 0, 
    exento: 0 
};

let unsubscribeSemaforoStock = null; // 🛡️ Cerrojo de memoria para ciclo de vida Kiosk
let cajeroCodigoActivo = localStorage.getItem('geokatu_cajero_pin') || "0000";
let cajaNumeroActiva = localStorage.getItem('geokatu_caja_num') || "CAJA-01";
 

// ==========================================
// 1. INICIALIZACIÓN DE SESIÓN Y CATÁLOGO
// ==========================================
GeokatuDB.SecurityService.observarEstadoSesion(async (user) => {
    if (user && user.uid) {
        const idTenant = localStorage.getItem('geokatu_active_uid') || user.uid;
        idNegocio = idTenant;

        // 🛡️ SELLADO DE ENCLAVE CRIPTOGRÁFICO DE TERMINAL LOCAL
        await GeokatuDB.SecurityService.sellarSesionTerminalLocal(idTenant);

        // 🚦 Lectura de estado fiscal y cuota del comercio matriz con persistencia para impresión
        try {
            const { success: sNeg, data: dNeg } = await GeokatuDB.LocalService.getDetails(idTenant);
            if (sNeg && dNeg) {
                const pais = dNeg.pais || localStorage.getItem(`geokatu_pais_${idTenant}`);
                if (pais === 'VEN') {
                    console.warn("[Router POS] Comercio de Venezuela detectado. Redirigiendo a posven.html...");
                    window.location.replace('posven.html');
                    return;
                }

                const perfilParaTicket = dNeg.perfil_fiscal || {

                    razon_social: dNeg.nombre || "GEOKATU COMERCIO",
                    nit: dNeg.nit || "",
                    dv: dNeg.dv || "0",
                    direccion: dNeg.direccion || "Pereira, Risaralda",
                    regimen_tributario: dNeg.regimen_tributario || "RESPONSABLE_IVA",
                    codigo_tienda: dNeg.codigo_tienda || "T-01"
                };
                localStorage.setItem(`geokatu_perfil_${idTenant}`, JSON.stringify(perfilParaTicket));
            }

            controlFacturacionActivo = (sNeg && dNeg?.facturacion_control) ? dNeg.facturacion_control : {
                plan_activo: "FREEMIUM",
                facturas_emitidas_mes: 0,
                facturas_cupo_gratis: 1300,
                facturas_prepago_saldo: 0
            };
            BillingGuard.verificarEstadoCuota(controlFacturacionActivo, 'pos-alerta-facturas');
        } catch (eFact) {
            console.warn("[BillingGuard] Fallo al consultar estado de cuota:", eFact.message);
        }

        // Auditoría de perfil de operario y políticas de seguridad de contraseñas
        const { getFirestore, doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
        const db = getFirestore();

        
         try {
            let docOperario = await getDoc(doc(db, `Directorio/${idNegocio}/Equipo`, user.uid));
            if (!docOperario.exists()) {
                docOperario = await getDoc(doc(db, `Directorio/${idNegocio}/Colaboradores`, user.uid));
            }

                        if (docOperario.exists()) {
                const dataOp = docOperario.data();
                cajeroCodigoActivo = String(dataOp.codigo_cajero || "0000").trim();
                localStorage.setItem('geokatu_cajero_pin', cajeroCodigoActivo);

                // FILTRO 1: Clave provisional de onboarding (Caduca en 48 horas)
                if (dataOp.requiere_cambio_password) {
                    if (dataOp.expiracion_clave_temporal && new Date() > new Date(dataOp.expiracion_clave_temporal)) {
                        alert("La contraseña provisional ha expirado. Solicita al administrador restablecer tu clave.");
                        GeokatuDB.SecurityService.destruirSesionTerminalLocal();
                        window.location.href = 'oficina';
                        return;
                    }

                    const modalPass = document.getElementById('modal-cambio-password-obligatorio');
                    if (modalPass) modalPass.style.display = 'flex';
                    return;
                }

                // FILTRO 2: Rotación obligatoria cada 10 semanas (70 días)
                const DIEZ_SEMANAS_MS = 10 * 7 * 24 * 60 * 60 * 1000;
                if (dataOp.fecha_ultimo_cambio_password) {
                    const tiempoTranscurrido = Date.now() - new Date(dataOp.fecha_ultimo_cambio_password).getTime();
                    if (tiempoTranscurrido > DIEZ_SEMANAS_MS) {
                        alert("Por política de seguridad, debes renovar tu contraseña cada 10 semanas.");
                        const modalPass = document.getElementById('modal-cambio-password-obligatorio');
                        if (modalPass) modalPass.style.display = 'flex';
                        return;
                    }
                }
            } else {
                // Si no está en nómina de colaboradores y coincide con el comercio o titular, es el dueño
                if (user.uid === idTenant || localStorage.getItem('geokatu_active_uid') === user.uid) {
                    const sufijoDueno = user.uid.slice(-4).toUpperCase();
                    cajeroCodigoActivo = `D-${sufijoDueno}`;
                    localStorage.setItem('geokatu_cajero_pin', cajeroCodigoActivo);
                }
            }
        } catch (errPerfil) {
            console.warn("[POS] No se pudo leer perfil de operario en línea:", errPerfil.message);
        }

        await inicializarCaja();
    } else {
         if (typeof unsubscribeSemaforoStock === 'function') {
            unsubscribeSemaforoStock();
            unsubscribeSemaforoStock = null;
        }
        // 🛡️ DESTRUCCIÓN SEGURA DE ENCLAVE AL SALIR
        GeokatuDB.SecurityService.destruirSesionTerminalLocal();
        window.location.href = 'oficina';
    }
});






async function inicializarCaja() {
    actualizarIndicadorCola();
    cargarTicketsEnEsperaStorage();
    await verificarEstadoTurnoCaja();

    // Sincronización inmediata al arrancar si hay conexión
    if (navigator.onLine && idNegocio) {
        GeokatuDB.PosService.sincronizarVentasPendientes(idNegocio).then(res => {
            actualizarIndicadorCola();
        }).catch(err => console.warn("[POS AutoSync]:", err));
    }



    // 🗺️ Precarga del mapa de ubicaciones WMS para descontar de estantes reales (GEO-P-...)
    try {
        const resUbis = await GeokatuDB.InventarioService.obtenerMapaStockTiendaCompleto(idNegocio);
        if (resUbis.success && Array.isArray(resUbis.data)) {
            localStorage.setItem(`geokatu_stock_ubis_${idNegocio}`, JSON.stringify(resUbis.data));
        }
    } catch (eUbi) {
        console.warn("[POS WMS] Precarga espacial diferida:", eUbi);
    }

    const res = await GeokatuDB.PosService.descargarCatalogoLocal(idNegocio);
    if (res.success) {
        catalogoLocal = res.data;
        document.getElementById('txt-conexion').innerText = res.offline ? "OFFLINE (Caché)" : "EN LÍNEA";
        document.getElementById('led-conexion').style.backgroundColor = res.offline ? "orange" : "var(--accent-green)";
    } else {
        catalogoLocal = GeokatuDB.PosService.cargarCatalogoDesdeCache(idNegocio);
        document.getElementById('txt-conexion').innerText = "OFFLINE (Respaldo)";
        document.getElementById('led-conexion').style.backgroundColor = "orange";
    }
    renderizarGridCatalogo();

   // 🛡️ GESTIÓN DE CICLO DE VIDA ANTI-LEAK (KIOSK 16 HORAS):
    // 1. Si existía un semáforo previo suscrito, cancelarlo antes de instanciar uno nuevo
    if (typeof unsubscribeSemaforoStock === 'function') {
        unsubscribeSemaforoStock();
        unsubscribeSemaforoStock = null;
    }

    // 2. Suscripción limpia guardando la referencia para futuras alternancias de turno o sesión
    unsubscribeSemaforoStock = GeokatuDB.PosService.escucharSemaforoStock(idNegocio, ({ id_prod, stock_actual, precio }) => {
        const prodEnRAM = catalogoLocal.find(p => p.id_prod === id_prod);
        if (prodEnRAM) {
            prodEnRAM.stock_actual = stock_actual;
            if (precio !== null) prodEnRAM.precio = precio;
            
            // Si el producto está actualmente en el carrito, actualizar visualmente
            const itemCarrito = carrito.find(c => c.id_prod === id_prod);
            if (itemCarrito && precio !== null && !itemCarrito.precio_fijado_balanza) {
                itemCarrito.precio = precio;
                renderizarCarrito();
            }
        }
    });
}

// ==========================================
// SANITIZADOR NUMÉRICO DEFENSIVO POS
// ==========================================
function sanitizarCantidadSegura(valor, esPesable = false, maximoPermitido = 9999.999) {
    if (valor === null || valor === undefined) return null;
    const num = Number(valor);
    if (isNaN(num) || !isFinite(num) || num <= 0.0001 || num > maximoPermitido) {
        return null;
    }
    return esPesable ? parseFloat(num.toFixed(3)) : Math.floor(num);
}

// ==========================================
// 2. DECODIFICADOR GS1 / EAN-13 DE BALANZA
// ==========================================
function parsearCodigoBalanza(codigo) {
    // Valida longitud EAN-13 estándar y prefijos de balanza (20 al 29)
    if (!/^\d{13}$/.test(codigo)) return null;

    const prefijo = codigo.substring(0, 2);
    if (prefijo < "20" || prefijo > "29") return null;

    const plu = codigo.substring(2, 7); // 5 dígitos de producto
    const valorRaw = parseInt(codigo.substring(7, 12), 10); // 5 dígitos de magnitud

    // Prefijos 20 y 21: Magnitud en Peso (gramos -> kg con 3 decimales)
    // Ejemplo: 200010501450X -> PLU 00105, 1450 gramos -> 1.450 kg
    if (prefijo === "20" || prefijo === "21") {
        return {
            tipo: 'PESO',
            plu: plu,
            cantidad: parseFloat((valorRaw / 1000).toFixed(3))
        };
    }

    // Prefijos 22 y 23: Balanzas configuradas por Importe Total Calculado ($)
    // Ejemplo: 220010500750X -> PLU 00105, valor monetario $7.500 COP
    if (prefijo === "22" || prefijo === "23") {
        return {
            tipo: 'VALOR',
            plu: plu,
            montoTotal: valorRaw
        };
    }

    return null;
}

// ==========================================
// 3. MOTOR DE ESCÁNER Y PROCESAMIENTO
// ==========================================
let scannerPosInstancia = null;
let escaneoEnCooldown = false;

let linternaEncendida = false;

window.alternarFlashCamaraPOS = async () => {
    try {
        const videoElem = document.querySelector('#lector-camara video');
        if (videoElem && videoElem.srcObject) {
            const track = videoElem.srcObject.getVideoTracks()[0];
            if (track) {
                const capabilities = track.getCapabilities ? track.getCapabilities() : {};
                if ('torch' in capabilities) {
                    linternaEncendida = !linternaEncendida;
                    await track.applyConstraints({ advanced: [{ torch: linternaEncendida }] });
                    const btnFlash = document.getElementById('btn-flash-pos');
                    if (btnFlash) {
                        btnFlash.style.background = linternaEncendida ? 'var(--color-marca)' : 'rgba(0,0,0,0.65)';
                        btnFlash.style.color = linternaEncendida ? '#000' : '#fff';
                    }
                    return;
                }
            }
        }
        alert("La linterna no está disponible en este lente o dispositivo.");
    } catch (e) {
        console.warn("Fallo al alternar linterna:", e);
        alert("Tu dispositivo o navegador no permitió encender la linterna.");
    }
};

window.cerrarCamaraPOS = () => {
    const dock = document.getElementById('scanner-dock');
    const btnCam = document.getElementById('btn-toggle-camara');
    if (dock) dock.style.display = 'none';
    if (btnCam) btnCam.innerHTML = `<span class="material-symbols-outlined">qr_code_scanner</span> Cámara`;

    // Apagar linterna si quedó encendida al cerrar el visor
    if (linternaEncendida) {
        const videoElem = document.querySelector('#lector-camara video');
        if (videoElem?.srcObject) {
            const track = videoElem.srcObject.getVideoTracks()[0];
            if (track) track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
        }
        linternaEncendida = false;
        const btnFlash = document.getElementById('btn-flash-pos');
        if (btnFlash) {
            btnFlash.style.background = 'rgba(0,0,0,0.65)';
            btnFlash.style.color = '#fff';
        }
    }

    if (scannerPosInstancia && scannerPosInstancia.isScanning) {
        scannerPosInstancia.stop().catch(() => {});
    }
    escaneoEnCooldown = false;
};


window.escanearParaPOS = () => {
    const dock = document.getElementById('scanner-dock');
    const btnCam = document.getElementById('btn-toggle-camara');
    if (!dock) return;

    if (dock.style.display === "block") {
        window.cerrarCamaraPOS();
        return;
    }

    dock.style.display = "block";
    if (btnCam) btnCam.innerHTML = `<span class="material-symbols-outlined">close</span> Cerrar`;

    const configFormatos = {
        formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.QR_CODE
        ],
        verbose: false
    };

    if (!scannerPosInstancia) {
        scannerPosInstancia = new Html5Qrcode("lector-camara", configFormatos);
    }

    scannerPosInstancia.start(
        { facingMode: "environment" },
        { fps: 20, qrbox: { width: 220, height: 110 } },
        (codigoDecodificado) => {
            if (escaneoEnCooldown) return;
            escaneoEnCooldown = true;

            if (navigator.vibrate) navigator.vibrate(60);
            procesarEntradaCodigo(codigoDecodificado);

            setTimeout(() => {
                escaneoEnCooldown = false;
            }, 1200);
        },
        () => {}
    ).catch(err => {
        console.error("Error al iniciar cámara POS:", err);
        alert("Comprueba los permisos de cámara en tu navegador.");
        window.cerrarCamaraPOS();
    });
};


const btnToggleCamara = document.getElementById('btn-toggle-camara');
if (btnToggleCamara) {
    btnToggleCamara.addEventListener('click', (e) => {
        e.stopPropagation();
        window.escanearParaPOS();
    });
}


const inputBuscador = document.getElementById('buscador-principal');
inputBuscador.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const entrada = inputBuscador.value.trim();
        if (!entrada) return;

       // Caso A: Multiplicador sobre el último producto en carrito (ej: "15*")
        const matchSoloMultiplicador = entrada.match(/^([0-9]+(?:\.[0-9]{1,3})?)\*$/);
        if (matchSoloMultiplicador) {
            if (carrito.length === 0) {
                alert("El carrito está vacío. Escanea un producto primero antes de multiplicar.");
                inputBuscador.value = '';
                return;
            }
            const ultimoIndice = carrito.length - 1;
            const esPesable = carrito[ultimoIndice].es_pesable;
            const cantidadSanitizada = sanitizarCantidadSegura(matchSoloMultiplicador[1], esPesable);

            if (!cantidadSanitizada) {
                alert("⚠️ Cantidad multiplicadora inválida o fuera de rango (0.001 - 9999).");
                inputBuscador.value = '';
                return;
            }

            actualizarCantidadDirecta(ultimoIndice, cantidadSanitizada);
            inputBuscador.value = '';
            return;
        }

        // Caso B: Multiplicador estándar retail (ej: "15*7701234567890" o "2.5*TOMATE")
        let multiplicador = 1;
        let terminoBusqueda = entrada;

        if (entrada.includes('*')) {
            const partes = entrada.split('*');
            const factorBruto = partes[0].trim();
            const resto = partes.slice(1).join('*').trim();

            const factorValidado = sanitizarCantidadSegura(factorBruto, true);
            if (factorValidado && resto.length > 0) {
                multiplicador = factorValidado;
                terminoBusqueda = resto;
            } else if (resto.length > 0) {
                alert("⚠️ Multiplicador no válido. Se usará cantidad base (1).");
            }
        }


        procesarEntradaCodigo(terminoBusqueda, multiplicador);
        inputBuscador.value = '';
    }
});


function procesarEntradaCodigo(termino, factorMultiplicador = 1) {
    const terminoLimpio = termino.trim();

     // 🛡️ DEVOLUCIÓN PARCIAL INTELIGENTE POR ESCÁNER DE TICKET (TK- o Hash directo de Firestore)
    const esTicketFiscal = terminoLimpio.startsWith("TK-") || (terminoLimpio.length >= 18 && !/^\d{8,14}$/.test(terminoLimpio));
    if (esTicketFiscal) {
        window.abrirModalDevolucionParcial(terminoLimpio);
        if (navigator.vibrate) navigator.vibrate([80, 50, 80]);
        return;
    }


    // 1. Probar si es código de barras generado por balanza (EAN-13 con peso o importe)
    const datosBalanza = parsearCodigoBalanza(terminoLimpio);

    if (datosBalanza) {
        const prodBalanza = catalogoLocal.find(p => 
            p.codigo_barras === datosBalanza.plu || 
            p.id_prod === datosBalanza.plu ||
            (p.plu && p.plu === datosBalanza.plu)
        );

        if (prodBalanza) {
            if (datosBalanza.tipo === 'PESO') {
                // Prefijo 20/21: Peso directo en kg (ej: 1.450 kg a precio de lista)
                agregarAlCarrito(prodBalanza, datosBalanza.cantidad, true);
            } else if (datosBalanza.tipo === 'VALOR') {
                // Prefijo 22/23: El sticker tiene el valor monetario exacto (ej: $4.500)
                const precioKg = Number(prodBalanza.precio) || 0;
                let pesoCalculado = 1; // Fallback: 1 bandeja/paquete cerrado
                
                if (precioKg > 0 && prodBalanza.es_pesable) {
                    // Descuenta del stock los kg equivalentes con 3 decimales
                    pesoCalculado = parseFloat((datosBalanza.montoTotal / precioKg).toFixed(3));
                }

                // El carrito cobra el total del sticker respetando la etiqueta
                agregarAlCarrito(prodBalanza, pesoCalculado, true, datosBalanza.montoTotal);
            }
            return;
        }
    }


    // 2. Búsqueda directa por código o ID exacto
    const producto = catalogoLocal.find(p => p.codigo_barras === termino || p.id_prod === termino);
    if (producto) {
        if (producto.es_pesable) {
            if (pesoEnVivoActual > 0) {
                agregarAlCarrito(producto, pesoEnVivoActual * factorMultiplicador, true);
            } else {
                abrirModalPesaje(producto, factorMultiplicador > 1 ? factorMultiplicador : null);
            }
        } else {
            agregarAlCarrito(producto, factorMultiplicador);
        }
        return;
    }

    // 3. Fallback: Búsqueda predictiva por nombre
    const coincidencias = catalogoLocal.filter(p => p.nombre.toLowerCase().includes(termino.toLowerCase()));
    if (coincidencias.length === 1) {
        const prod = coincidencias[0];
        if (prod.es_pesable) {
            if (pesoEnVivoActual > 0) {
                agregarAlCarrito(prod, pesoEnVivoActual * factorMultiplicador, true);
            } else {
                abrirModalPesaje(prod, factorMultiplicador > 1 ? factorMultiplicador : null);
            }
        } else {
            agregarAlCarrito(prod, factorMultiplicador);
        }
    } else if (coincidencias.length > 1) {
        alert(`Hay ${coincidencias.length} productos con ese nombre. Usa el código de barras.`);
    } else {
        alert("⚠️ Producto no encontrado en el inventario.");
        if (navigator.vibrate) navigator.vibrate([150, 80, 150]);
    }
}


// ==========================================
// 4. GESTIÓN DEL CARRITO (DECIMALES Y STOCK)
// ==========================================
function agregarAlCarrito(producto, cantidadASumar = 1, forzarReemplazo = false, precioForzado = null) {
    const itemExistente = carrito.find(item => item.id_prod === producto.id_prod);
    const esPesable = producto.es_pesable || false;
    const cantidadPrevia = itemExistente ? itemExistente.cantidad : 0;
    const nuevaCantidad = forzarReemplazo ? cantidadASumar : (cantidadPrevia + cantidadASumar);

    // Advertencia no bloqueante de stock teórico
    if (producto.stock_actual !== undefined && nuevaCantidad > producto.stock_actual) {
        if (typeof window.mostrarAvisoPos === 'function') {
            window.mostrarAvisoPos(`⚠️ Stock teórico superado para "${producto.nombre}". Se registrará para auditoría.`);
        }
    }


    // Si viene con precio fijado por balanza (prefijos 22/23) o con cantidad forzada
    if (itemExistente && !precioForzado) {
        itemExistente.cantidad = esPesable ? parseFloat(nuevaCantidad.toFixed(3)) : Math.round(nuevaCantidad);
    } else {
        carrito.push({
            id_prod: producto.id_prod,
            codigo_barras: producto.codigo_barras || "",
            nombre: producto.nombre,
            precio: precioForzado !== null ? precioForzado : (Number(producto.precio) || 0),
            impuesto: producto.impuesto || "19",
            es_pesable: esPesable,
            unidad_medida: producto.unidad_medida || (esPesable ? "kg" : "und"),
            cantidad: esPesable ? parseFloat(nuevaCantidad.toFixed(3)) : Math.round(nuevaCantidad),
            precio_fijado_balanza: precioForzado !== null
        });
    }

    if (navigator.vibrate) navigator.vibrate(60);
    renderizarCarrito();
}


function modificarCantidad(index, delta) {
    const item = carrito[index];
    const prodCatalogo = catalogoLocal.find(p => p.id_prod === item.id_prod);
    const paso = item.es_pesable ? 0.100 : 1;
    const nuevaCantidad = item.cantidad + (delta * paso);

    if (delta > 0 && prodCatalogo && prodCatalogo.stock_actual !== undefined) {
        if (nuevaCantidad > prodCatalogo.stock_actual && typeof window.mostrarAvisoPos === 'function') {
            window.mostrarAvisoPos(`⚠️ Venta sobrepasando stock teórico de anaquel.`);
        }
    }


    item.cantidad = item.es_pesable ? parseFloat(nuevaCantidad.toFixed(3)) : Math.round(nuevaCantidad);

    if (item.cantidad <= 0.0001) {
        carrito.splice(index, 1);
    }
    renderizarCarrito();
}

function actualizarCantidadDirecta(index, valorStr) {
    const item = carrito[index];
    if (!item) return;

    const cantidadValidada = sanitizarCantidadSegura(valorStr, item.es_pesable);
    const prodCatalogo = catalogoLocal.find(p => p.id_prod === item.id_prod);

    if (!cantidadValidada) {
        alert("⚠️ Ingresa una cantidad válida mayor a 0 y menor a 9,999.");
        renderizarCarrito();
        return;
    }

    if (prodCatalogo && prodCatalogo.stock_actual !== undefined && cantidadValidada > prodCatalogo.stock_actual) {
        if (typeof window.mostrarAvisoPos === 'function') {
            window.mostrarAvisoPos(`⚠️ Cantidad fijada supera stock en sistema.`);
        }
    }


    item.cantidad = cantidadValidada;
    renderizarCarrito();
}

function eliminarItem(index) {
    carrito.splice(index, 1);
    renderizarCarrito();
}

// ==========================================
// 5. RENDERIZADO DEL CARRITO TÁCTIL
// ==========================================
function renderizarCarrito() {
    const contenedor = document.getElementById('current-sale');
    contenedor.innerHTML = '';

    const badge = document.getElementById('cant-items-badge');
    const totalLineas = carrito.length;
    badge.innerText = `${totalLineas} ${totalLineas === 1 ? 'línea' : 'líneas'}`;

    if (carrito.length === 0) {
        contenedor.innerHTML = '<p style="text-align: center; color: #555; margin-top: 50px; font-size: 13px;">El carrito está vacío.<br>Escanea un producto para comenzar.</p>';
        document.getElementById('txt-base').innerText = '$0';
        document.getElementById('txt-iva19').innerText = '$0';
        document.getElementById('txt-exento').innerText = '$0';
        document.getElementById('txt-total').innerText = '$0';
        return;
    }

    // 🛡️ MOTOR CONTABLE ESTRICTO DIAN (ANEXO 1.9) - PRECISIÓN CENTAVOS & CUADRATURA EXACTA
    let totalGeneral = 0;
    let acumuladorBaseGravableCentavos = 0;
    let acumuladorExentoCentavos = 0;

    // PEGAR EN SU LUGAR (Aritmética de alta precisión DIAN UBL 2.1):
    carrito.forEach((item, index) => {
        const subtotal = item.precio_fijado_balanza 
            ? Math.round(Number(item.precio)) 
            : Math.round(Number(item.precio) * item.cantidad);
        totalGeneral += subtotal;

        if (String(item.impuesto) === "19") {
            // Base con precisión decimal completa sin truncar prematuramente
            const baseLinea = subtotal / 1.19;
            acumuladorBaseGravableCentavos += baseLinea;
        } else {
            acumuladorExentoCentavos += subtotal;
        }


        const notaHtml = item.nota ? `<div class="cart-item-nota">📝 ${item.nota}</div>` : '';
        const card = document.createElement('div');
        card.className = 'cart-card';
        card.innerHTML = `
           <div class="cart-card-info">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <h4>${item.nombre}</h4>
                    <button type="button" onclick="window.agregarNotaItem(${index})" title="Añadir nota de comanda" style="background:none; border:none; color:#888; cursor:pointer; font-size:11px;">✏️ Nota</button>
                </div>
                <p>${item.precio_fijado_balanza ? `Etiqueta Balanza (${item.cantidad} ${item.unidad_medida})` : `$${Number(item.precio).toLocaleString('es-CO')} / ${item.unidad_medida}`}</p>
                ${notaHtml}
            </div>

            <div class="cart-controls">
                <button class="qty-btn btn-menos" data-idx="${index}">-</button>
                <input type="number" 
                       class="qty-input-direct" 
                       data-idx="${index}" 
                       step="${item.es_pesable ? '0.001' : '1'}" 
                       min="${item.es_pesable ? '0.001' : '1'}" 
                       value="${item.cantidad}">
                <button class="qty-btn btn-mas" data-idx="${index}">+</button>
            </div>
            <div class="cart-card-subtotal">
                $${subtotal.toLocaleString('es-CO')}
            </div>
            <button class="btn-remove-item" data-idx="${index}">
                <span class="material-symbols-outlined" style="font-size: 18px;">delete</span>
            </button>
        `;
        contenedor.appendChild(card);

    });

    // Delegación de eventos para controles del carrito
    contenedor.querySelectorAll('.btn-menos').forEach(b => b.onclick = () => modificarCantidad(Number(b.dataset.idx), -1));
    contenedor.querySelectorAll('.btn-mas').forEach(b => b.onclick = () => modificarCantidad(Number(b.dataset.idx), 1));
    contenedor.querySelectorAll('.btn-remove-item').forEach(b => b.onclick = () => eliminarItem(Number(b.dataset.idx)));
    contenedor.querySelectorAll('.qty-input-direct').forEach(inp => {
        inp.onchange = (e) => actualizarCantidadDirecta(Number(inp.dataset.idx), e.target.value);
        inp.onfocus = () => inp.select();
    });

    // CUADRATURA ARITMÉTICA INVIOLABLE: Base + IVA + Exento = Total
    const baseFinalEntero = Math.round(acumuladorBaseGravableCentavos);
    const exentoFinalEntero = Math.round(acumuladorExentoCentavos);
    
    // Si hay artículos gravados, el IVA se calcula por residuo para asegurar 0 discrepancia:
    const ivaFinalEntero = totalGeneral > (baseFinalEntero + exentoFinalEntero)
        ? (totalGeneral - baseFinalEntero - exentoFinalEntero)
        : (acumuladorBaseGravableCentavos > 0 ? Math.max(0, totalGeneral - baseFinalEntero - exentoFinalEntero) : 0);

  document.getElementById('txt-base').innerText = `$${baseFinalEntero.toLocaleString('es-CO')}`;
    document.getElementById('txt-iva19').innerText = `$${ivaFinalEntero.toLocaleString('es-CO')}`;
    document.getElementById('txt-exento').innerText = `$${exentoFinalEntero.toLocaleString('es-CO')}`;
    document.getElementById('txt-total').innerText = `$${totalGeneral.toLocaleString('es-CO')}`;

    // Sincronizar el remanente en pantalla cada vez que el carrito cambia
    actualizarVisorRemanente();
}


function renderizarGridCatalogo() {
    const grid = document.getElementById('grid-rapida');
    if (!grid) return;
    grid.innerHTML = '';

    if (catalogoLocal.length === 0) {
        grid.innerHTML = '<p style="text-align: center; color: #666; padding: 20px 0; font-size: 12px;">No hay productos en inventario.</p>';
        return;
    }

    catalogoLocal.slice(0, 30).forEach(prod => {
        const item = document.createElement('div');
        item.className = 'product-row-item';
        item.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span class="material-symbols-outlined" style="color: var(--color-marca); font-size: 18px;">${prod.icono || (prod.es_pesable ? 'scale' : 'inventory_2')}</span>
                <span class="item-title">${prod.nombre}</span>
            </div>
            <span class="item-price">$${Number(prod.precio).toLocaleString()}${prod.es_pesable ? '/kg' : ''}</span>
        `;

        item.onclick = () => {
            const modalCat = document.getElementById('modal-catalogo-popup');
            if (modalCat) modalCat.style.display = 'none';

            if (prod.es_pesable) {
                if (pesoEnVivoActual > 0) {
                    agregarAlCarrito(prod, pesoEnVivoActual, true);
                } else {
                    abrirModalPesaje(prod);
                }
            } else {
                agregarAlCarrito(prod, 1);
            }
        };

        grid.appendChild(item);
    });
}



// ==========================================
// 6. TICKETS EN ESPERA / PAUSADOS (PUNTO 4)
// ==========================================
async function cargarTicketsEnEsperaStorage() {
    // 1. Carga inmediata desde localStorage (0 ms de espera, 100% offline)
    ticketsEnEspera = JSON.parse(localStorage.getItem(`geokatu_tickets_pausados_${idNegocio}`) || "[]");
    actualizarBadgeTicketsEspera();

    // 2. Si hay conexión, sincronizar con Firestore para recuperar tickets de otras cajas o sesiones
    if (navigator.onLine && idNegocio && GeokatuDB.PosService.obtenerTicketsEnEsperaNube) {
        try {
            const ticketsNube = await GeokatuDB.PosService.obtenerTicketsEnEsperaNube(idNegocio);
            if (ticketsNube && ticketsNube.length > 0) {
                // Combinar sin duplicar IDs
                const idsLocales = new Set(ticketsEnEspera.map(t => t.id));
                ticketsNube.forEach(tn => {
                    if (!idsLocales.has(tn.id)) ticketsEnEspera.push(tn);
                });
                localStorage.setItem(`geokatu_tickets_pausados_${idNegocio}`, JSON.stringify(ticketsEnEspera));
                actualizarBadgeTicketsEspera();
            }
        } catch (e) {
            console.warn("[POS] Fallo al sincronizar tickets pausados con la nube:", e);
        }
    }
}

function sincronizarTicketsEnEsperaStorage() {
    // Persistencia local inmediata
    localStorage.setItem(`geokatu_tickets_pausados_${idNegocio}`, JSON.stringify(ticketsEnEspera));
    actualizarBadgeTicketsEspera();

    // Si hay internet, persistir en Firestore en segundo plano
    if (navigator.onLine && idNegocio && GeokatuDB.PosService.guardarTicketsEnEsperaNube) {
        GeokatuDB.PosService.guardarTicketsEnEsperaNube(idNegocio, ticketsEnEspera).catch(err => {
            console.warn("[POS] Error al sincronizar tickets pausados en Firestore:", err);
        });
    }
}

function actualizarBadgeTicketsEspera() {
    const badge = document.getElementById('badge-en-espera');
    if (badge) {
        badge.innerText = ticketsEnEspera.length;
        badge.style.display = ticketsEnEspera.length > 0 ? 'inline-block' : 'none';
    }
}

document.getElementById('btn-pausar-ticket').addEventListener('click', () => {
    if (carrito.length === 0) return alert("El ticket actual está vacío.");

    const hora = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const nuevoTicketPausado = {
        id: `P-${Date.now().toString().slice(-4)}`,
        hora: hora,
        items: [...carrito],
        abonosPrevios: [...pagosAcumuladosTicket], // 🛡️ Preserva abonos parciales ya cobrados
        total: document.getElementById('txt-total').innerText
    };

    ticketsEnEspera.push(nuevoTicketPausado);
    sincronizarTicketsEnEsperaStorage();

    carrito = [];
    pagosAcumuladosTicket = []; // Limpia memoria de abonos de la venta pausada
    renderizarCarrito();
    actualizarVisorRemanente();
    alert(`Ticket puesto en espera (#${nuevoTicketPausado.id}). Caja lista para el siguiente cliente.`);
});


document.getElementById('btn-ver-espera').addEventListener('click', () => {
    abrirModalTicketsEspera();
});

function abrirModalTicketsEspera() {
    const modal = document.getElementById('modal-espera');
    const lista = document.getElementById('lista-tickets-espera');
    lista.innerHTML = '';

    if (ticketsEnEspera.length === 0) {
        lista.innerHTML = '<p style="text-align: center; color: #777; padding: 20px;">No hay tickets retenidos.</p>';
    } else {
        ticketsEnEspera.forEach((t, idx) => {
            const row = document.createElement('div');
            row.className = 'ticket-pausado-row';
            row.innerHTML = `
                <div>
                    <strong>Ticket #${t.id}</strong> <span style="color: var(--text-muted); font-size: 11px;">(${t.hora})</span>
                    <p style="font-size: 12px; color: var(--accent-green); margin-top: 2px;">${t.total} (${t.items.length} productos)</p>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="btn-recuperar" data-idx="${idx}">Recuperar</button>
                    <button class="btn-descartar" data-idx="${idx}">✕</button>
                </div>
            `;
            lista.appendChild(row);
        });

        lista.querySelectorAll('.btn-recuperar').forEach(btn => {
            btn.onclick = () => {
                const idx = Number(btn.dataset.idx);
                if (carrito.length > 0 && !confirm("Hay productos en el carrito actual. ¿Deseas reemplazarlos por este ticket pausado?")) {
                    return;
                }
               carrito = [...ticketsEnEspera[idx].items];
                pagosAcumuladosTicket = ticketsEnEspera[idx].abonosPrevios || []; // 🛡️ Restaura abonos parciales
                ticketsEnEspera.splice(idx, 1);
                sincronizarTicketsEnEsperaStorage();
                modal.style.display = 'none';
                renderizarCarrito();
                actualizarVisorRemanente();

            };
        });

        lista.querySelectorAll('.btn-descartar').forEach(btn => {
            btn.onclick = () => {
                const idx = Number(btn.dataset.idx);
                if (confirm("¿Descartar definitivamente este ticket?")) {
                    ticketsEnEspera.splice(idx, 1);
                    sincronizarTicketsEnEsperaStorage();
                    abrirModalTicketsEspera();
                }
            };
        });
    }

    modal.style.display = 'flex';
}

document.getElementById('btn-cerrar-modal-espera').addEventListener('click', () => {
    document.getElementById('modal-espera').style.display = 'none';
});

// ==========================================
// 7. CHECKOUT Y PASARELA DE COBROS MIXTOS (SPLIT PAYMENTS)
// ==========================================
let pagosAcumuladosTicket = []; // [{ metodo, monto, referencia }]
let montoPendienteDatafonoTemporal = 0;

function obtenerTotalTicketActual() {
    return Number(document.getElementById('txt-total').innerText.replace(/\D/g, '')) || 0;
}

function calcularTotalPagadoHastaAhora() {
    return pagosAcumuladosTicket.reduce((acc, p) => acc + p.monto, 0);
}

function actualizarVisorRemanente() {
    const totalTicket = obtenerTotalTicketActual();
    const pagado = calcularTotalPagadoHastaAhora();
    const remanente = Math.max(0, totalTicket - pagado);

    const txtRem = document.getElementById('txt-remanente');
    const lblEstado = document.getElementById('lbl-estado-saldo');
    const inputAbono = document.getElementById('input-monto-abono');
    const contenedorAbonos = document.getElementById('lista-abonos-ticket');

    if (txtRem) txtRem.innerText = `$${remanente.toLocaleString('es-CO')}`;
    if (lblEstado) {
        lblEstado.innerText = remanente === 0 && pagado > 0 ? "Completado" : "Por Cobrar";
        lblEstado.style.color = remanente === 0 && pagado > 0 ? "var(--accent-green)" : "#ffaa00";
    }

    if (contenedorAbonos) {
        contenedorAbonos.innerHTML = pagosAcumuladosTicket.map(p => 
            `<span style="background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px;">${p.metodo}: $${p.monto.toLocaleString('es-CO')}</span>`
        ).join('');
    }

    // Sugerir en el input el remanente sólo si el cajero no está escribiendo activamente en él
    if (inputAbono && remanente > 0 && document.activeElement !== inputAbono) {
        inputAbono.value = remanente;
    } else if (remanente === 0 && inputAbono) {
        inputAbono.value = '';
    }

    // 🛡️ RECALCULAR BOTONES DINÁMICOS DE BILLETES SEGÚN EL SALDO ACTUAL
    renderizarBilletesInteligentes(remanente);
}

// =========================================================================
// MOTOR DE DENOMINACIONES RÁPIDAS INTELIGENTES (GEOKATU POS)
// =========================================================================
function renderizarBilletesInteligentes(remanente) {
    const contenedor = document.getElementById('contenedor-billetes-rapidos');
    if (!contenedor) return;

    if (remanente <= 0) {
        contenedor.innerHTML = '';
        return;
    }

    const denominaciones = [10000, 20000, 50000, 100000];
    let html = `
        <button type="button" class="btn-quick-cash exacto" data-monto="${remanente}">
            <strong>Exacto</strong>
            <span style="font-size: 9px; opacity: 0.8;">$0</span>
        </button>
    `;

    denominaciones.forEach(billete => {
        const esMenor = billete < remanente;
        const cambio = billete - remanente;
        const textoSub = esMenor ? 'Abono' : `+$${cambio.toLocaleString('es-CO')}`;
        const estiloVisual = esMenor ? 'opacity: 0.45;' : 'border-color: rgba(0,255,100,0.3);';

        html += `
            <button type="button" class="btn-quick-cash" data-monto="${billete}" style="${estiloVisual}">
                <strong>$${(billete / 1000)}k</strong>
                <span style="font-size: 9px; opacity: 0.85; color: ${esMenor ? '#aaa' : 'var(--accent-green)'};">${textoSub}</span>
            </button>
        `;
    });

    contenedor.innerHTML = html;

    contenedor.querySelectorAll('.btn-quick-cash').forEach(btn => {
        btn.onclick = () => {
            const monto = Number(btn.dataset.monto);
            const inputAbono = document.getElementById('input-monto-abono');
            if (inputAbono) {
                inputAbono.value = monto;
                inputAbono.dispatchEvent(new Event('input'));
            }
        };
    });
}

// Calculadora de vueltas en tiempo real mientras el cajero digita
const inputMontoAbono = document.getElementById('input-monto-abono');
if (inputMontoAbono) {
    inputMontoAbono.addEventListener('input', () => {
        const totalTicket = obtenerTotalTicketActual();
        const pagado = calcularTotalPagadoHastaAhora();
        const remanente = Math.max(0, totalTicket - pagado);
        const recibido = parseFloat(inputMontoAbono.value) || 0;
        const txtVueltas = document.getElementById('txt-cambio-vueltas');

        if (recibido > remanente && remanente > 0) {
            const cambio = recibido - remanente;
            txtVueltas.innerText = `Vueltas: $${cambio.toLocaleString('es-CO')}`;
            txtVueltas.style.display = 'inline-block';
        } else {
            txtVueltas.style.display = 'none';
        }
    });
}

document.querySelectorAll('.btn-pay').forEach(btn => {
    btn.addEventListener('click', () => {
        const metodo = btn.dataset.pago;
        procesarAbonoPago(metodo);
    });
});

function procesarAbonoPago(metodo) {
    if (carrito.length === 0) {
        if (typeof window.mostrarAvisoPos === 'function') {
            window.mostrarAvisoPos("El carrito está vacío.");
        } else {
            alert("El carrito está vacío.");
        }
        return;
    }

    // Control preventivo de cupo de facturación
    if (controlFacturacionActivo) {
        const estadoCuota = BillingGuard.verificarEstadoCuota(controlFacturacionActivo, 'pos-alerta-facturas');
        if (estadoCuota && estadoCuota.bloqueado) {
            const fechaApertura = turnoCajaActivo?.fecha_apertura ? new Date(turnoCajaActivo.fecha_apertura) : null;
            const hoy = new Date();
            const esTurnoAperturadoHoy = turnoCajaActivo?.estado === 'ABIERTA' && fechaApertura &&
                fechaApertura.getFullYear() === hoy.getFullYear() &&
                fechaApertura.getMonth() === hoy.getMonth() &&
                fechaApertura.getDate() === hoy.getDate();

            if (esTurnoAperturadoHoy) {
                if (typeof window.mostrarAvisoPos === 'function') {
                    window.mostrarAvisoPos("Límite de 1.300 facturas alcanzado. Se permite facturar hasta realizar el Cierre Z de hoy.");
                }
            } else {
                alert("Has alcanzado el límite de 1.300 facturas de tu plan y no tienes un turno activo aperturado hoy. Realiza una recarga para continuar.");
                return;
            }
        }
    }

    const totalTicket = obtenerTotalTicketActual();
    const pagadoHastaAhora = calcularTotalPagadoHastaAhora();
    const remanente = totalTicket - pagadoHastaAhora;

    if (remanente <= 0) {
        ejecutarVentaFinalDefinitiva();
        return;
    }

    // Sanitización robusta: extrae únicamente números y punto decimal
    const inputElement = document.getElementById('input-monto-abono');
    const inputValRaw = inputElement ? inputElement.value : "";
    const inputValSanitizado = String(inputValRaw).replace(/[^0-9.]/g, '');
    let montoIngresado = parseFloat(inputValSanitizado);

    if (isNaN(montoIngresado) || montoIngresado <= 0) {
        montoIngresado = remanente;
    }

    if (metodo === 'TARJETA') {
        const montoTarjeta = Math.min(montoIngresado, remanente);
        abrirModalDatafono(montoTarjeta);
        return;
    }

    if (metodo === 'NEQUI') {
        const montoNequi = Math.min(montoIngresado, remanente);
        aplicarAbonoConfirmado('NEQUI', montoNequi);
        return;
    }

    if (metodo === 'EFECTIVO') {
        let montoEfectivoAbonado = montoIngresado;
        let cambioCalculado = 0;

        if (montoIngresado > remanente) {
            cambioCalculado = Math.round(montoIngresado - remanente);
            montoEfectivoAbonado = remanente;
        }

        if (typeof motorCajon !== 'undefined' && motorCajon.dispararAperturaDirecta) {
            motorCajon.dispararAperturaDirecta(0).catch(() => {});
        }

        if (cambioCalculado > 0) {
            const txtVueltas = document.getElementById('txt-cambio-vueltas');
            if (txtVueltas) {
                txtVueltas.innerText = `Vueltas: $${cambioCalculado.toLocaleString('es-CO')}`;
                txtVueltas.style.display = 'inline-block';
            }
            if (typeof window.mostrarAvisoPos === 'function') {
                window.mostrarAvisoPos(`Vueltas al cliente: $${cambioCalculado.toLocaleString('es-CO')}`);
            }
        }

        aplicarAbonoConfirmado('EFECTIVO', montoEfectivoAbonado);
    }
}


function abrirModalDatafono(montoFraccion) {
    montoPendienteDatafonoTemporal = montoFraccion;
    document.getElementById('monto-datafono').innerText = `$${montoFraccion.toLocaleString('es-CO')}`;
    document.getElementById('voucher-datafono').value = '';
    document.getElementById('modal-datafono').style.display = 'flex';
    document.getElementById('voucher-datafono').focus();
}

document.getElementById('btn-cancelar-datafono').addEventListener('click', () => {
    document.getElementById('modal-datafono').style.display = 'none';
    montoPendienteDatafonoTemporal = 0;
});

document.getElementById('btn-confirmar-datafono').addEventListener('click', () => {
    const voucher = document.getElementById('voucher-datafono').value.trim();
    document.getElementById('modal-datafono').style.display = 'none';
    aplicarAbonoConfirmado('TARJETA', montoPendienteDatafonoTemporal, voucher || 'APROBADO_MANUAL');
    montoPendienteDatafonoTemporal = 0;
});

function aplicarAbonoConfirmado(metodo, monto, referencia = null) {
    pagosAcumuladosTicket.push({
        metodo: metodo,
        monto: Math.round(monto),
        referencia: referencia
    });

    actualizarVisorRemanente();

    const totalTicket = obtenerTotalTicketActual();
    const pagado = calcularTotalPagadoHastaAhora();

    if (pagado >= totalTicket) {
        // Ticket 100% saldado -> Disparar venta final definitiva
        ejecutarVentaFinalDefinitiva();
    } else {
        const falta = totalTicket - pagado;
        alert(`Abono de $${monto.toLocaleString('es-CO')} recibido por ${metodo}.\nFaltan $${falta.toLocaleString('es-CO')} para completar la orden.`);
    }
}

async function ejecutarVentaFinalDefinitiva() {
    if (!turnoCajaActivo || turnoCajaActivo.estado !== 'ABIERTA') {
        alert("⚠️ La caja está cerrada. Debes abrir el turno primero.");
        abrirModalAperturaCaja();
        return;
    }

    // 🛡️ RECALCULO INMUTABLE DE PRODUCTOS CONTRA CATÁLOGO MAESTRO
    let totalVentaCalculado = 0;
    let productosAuditados = [];

   for (const item of carrito) {
        // Si es un ítem libre creado en el momento, pasa directo con su precio validado
        if (item.id_prod && item.id_prod.startsWith("GENERICO_")) {
            const subtotalLibre = Math.round(Number(item.precio) * Number(item.cantidad));
            totalVentaCalculado += subtotalLibre;
            productosAuditados.push({
                id_prod: item.id_prod,
                codigo_barras: "",
                plu: "",
                nombre: item.nombre,
                precio: Number(item.precio),
                impuesto: String(item.impuesto || "0"),
                es_pesable: false,
                unidad_medida: "und",
                cantidad: item.cantidad,
                subtotal: subtotalLibre,
                precio_fijado_balanza: false,
                nota: item.nota || ""
            });
            continue;
        }

        const prodMaestro = catalogoLocal.find(p => p.id_prod === item.id_prod);
        if (!prodMaestro) {
            alert(`⚠️ Error de Integridad: Producto "${item.nombre}" inválido.`);
            return;
        }

        let precioFinal = item.precio_fijado_balanza && item.precio > 0 
            ? Math.round(Number(item.precio)) 
            : Number(prodMaestro.precio);
        let subtotal = item.precio_fijado_balanza ? precioFinal : Math.round(precioFinal * item.cantidad);

         // 🛡️ ENLACE ESPACIAL AUTOMÁTICO: Deducir compartimiento activo en Piso de Venta y actualizar caché local
        let idCompPisoVenta = "BIN_INICIAL";
        try {
            const stockUbisLocal = JSON.parse(localStorage.getItem(`geokatu_stock_ubis_${idNegocio}`) || "[]");
            // Buscar la primera ubicación del producto que esté en zona de piso de ventas con stock > 0
            const ubiPiso = stockUbisLocal.find(u => u.id_prod === prodMaestro.id_prod && u.zona === 'PISO_VENTA' && u.cantidad > 0);
            if (ubiPiso && ubiPiso.id_compartimiento) {
                idCompPisoVenta = ubiPiso.id_compartimiento;
                ubiPiso.cantidad = Math.max(0, Number((ubiPiso.cantidad - item.cantidad).toFixed(3)));
                localStorage.setItem(`geokatu_stock_ubis_${idNegocio}`, JSON.stringify(stockUbisLocal));
            }
        } catch (eUbi) {
            console.warn("[POS Contexto Espacial] Usando compartimiento por defecto:", eUbi);
        }

        totalVentaCalculado += subtotal;
        productosAuditados.push({
            id_prod: prodMaestro.id_prod,
            codigo_barras: prodMaestro.codigo_barras || "",
            plu: prodMaestro.plu || "",
            nombre: prodMaestro.nombre,
            precio: precioFinal,
            impuesto: String(prodMaestro.impuesto || "19"),
            es_pesable: !!prodMaestro.es_pesable,
            unidad_medida: prodMaestro.unidad_medida || (prodMaestro.es_pesable ? "kg" : "und"),
            cantidad: item.cantidad,
            subtotal: subtotal,
            precio_fijado_balanza: !!item.precio_fijado_balanza,
            nota: item.nota || "",
            id_compartimiento: idCompPisoVenta // 📍 Coordenada física para descuento atómico en el estante
        });
    }



    const switchDian = document.getElementById('switch-dian');
    const requiereFacturaDian = switchDian ? switchDian.checked : false;

    let datosCliente = {
        nit: "222222222222",
        nombre: "Consumidor Final",
        email: ""
    };

    if (requiereFacturaDian) {
        const nit = document.getElementById('dian-nit').value.trim();
        const nombre = document.getElementById('dian-nombre').value.trim();
        const email = document.getElementById('dian-email').value.trim();
        if (!nit || !nombre || !email) {
            alert("⚠️ Para factura electrónica DIAN debes ingresar NIT, Nombre y Correo.");
            return;
        }
        datosCliente = { nit, nombre, email };
    }

    const ticketPayload = {
        caja_numero: cajaNumeroActiva,
        codigo_cajero: cajeroCodigoActivo,
        cajero_email: auth.currentUser ? auth.currentUser.email : "CAJERO",
        productos: productosAuditados,
        total: totalVentaCalculado,
        metodos_pago_split: [...pagosAcumuladosTicket],
        metodo_pago: pagosAcumuladosTicket.length === 1 ? pagosAcumuladosTicket[0].metodo : "MIXTO",
        factura_electronica: requiereFacturaDian,
        cliente: datosCliente
    };


   document.getElementById('txt-conexion').innerText = "REGISTRANDO...";
    const res = await GeokatuDB.PosService.procesarVentaLote(idNegocio, ticketPayload);

        if (res.success) {
        ultimoTicketIdVendido = res.ticketId || res.localId;
        
        if (typeof window.mostrarAvisoPos === 'function') {
            window.mostrarAvisoPos(`Venta asentada con éxito. Ticket: ${ultimoTicketIdVendido}`);
        }

        let datosFiscalesResueltos = null;

        // 🛡️ BARRERA FISCAL RESOLUCIÓN 000165 DIAN:
        // Si requiere factura electrónica, retenemos la impresión hasta 4 segundos esperando CUFE
        if (requiereFacturaDian) {
            if (navigator.onLine && !res.offline && res.ticketId) {
                document.getElementById('txt-conexion').innerText = "EMITIENDO CUFE DIAN...";
                const resFiscal = await GeokatuDB.PosService.esperarResolucionFiscal(idNegocio, res.ticketId, 4000);
                if (resFiscal.exito) {
                    datosFiscalesResueltos = {
                        cufe: resFiscal.cufe,
                        consecutivo: resFiscal.consecutivo,
                        esContingencia: false
                    };
                } else {
                    datosFiscalesResueltos = {
                        cufe: null,
                        consecutivo: null,
                        esContingencia: true
                    };
                }
            } else {
                // Offline inmediato: entra en contingencia tipo 04
                datosFiscalesResueltos = {
                    cufe: null,
                    consecutivo: null,
                    esContingencia: true
                };
            }
        }

        armarTirillaTermica(ticketPayload, ultimoTicketIdVendido, datosFiscalesResueltos);

        // Acumular ventas por medio de pago individual y desglose tributario real
        pagosAcumuladosTicket.forEach(p => {
            if (p.metodo === 'EFECTIVO') acumuladoTurno.efectivo += p.monto;
            else if (p.metodo === 'TARJETA') acumuladoTurno.tarjeta += p.monto;
            else if (p.metodo === 'NEQUI') acumuladoTurno.nequi += p.monto;
        });

        // Sumar canasta mixta auditada del ticket canonico
        const fiscalTicket = res.payloadCanonico?.totales || ticketPayload.despacho_fiscal?.payload_canonico?.totales;
        if (fiscalTicket) {
            acumuladoTurno.base_gravable += (fiscalTicket.base_gravable || 0);
            acumuladoTurno.iva_19 += (fiscalTicket.impuesto_iva || 0);
            acumuladoTurno.exento += (fiscalTicket.total_exento || 0);
        } else {
            // Calculo directo si no viaja el payload
            let b = 0, iv = 0, ex = 0;
            productosAuditados.forEach(pr => {
                if (String(pr.impuesto) === "19") {
                    const baseProd = Number((pr.subtotal / 1.19).toFixed(2));
                    b += baseProd;
                    iv += (pr.subtotal - baseProd);
                } else {
                    ex += pr.subtotal;
                }
            });
            acumuladoTurno.base_gravable += Math.round(b);
            acumuladoTurno.iva_19 += Math.round(iv);
            acumuladoTurno.exento += Math.round(ex);
        }
        localStorage.setItem(`geokatu_acumulado_${idNegocio}`, JSON.stringify(acumuladoTurno));


         // Actualizar KPIs de ventas del día
        const kpiObj = document.getElementById('kpi-ventas');
        if (kpiObj) {
            const kpiActual = Number(kpiObj.innerText.replace(/\D/g, ''));
            kpiObj.innerText = `$${(kpiActual + totalVentaCalculado).toLocaleString('es-CO')}`;
        }

        // Actualizar contador mensual de facturas libres en tiempo real
        if (controlFacturacionActivo) {
            controlFacturacionActivo.facturas_emitidas_mes = (Number(controlFacturacionActivo.facturas_emitidas_mes) || 0) + 1;
            BillingGuard.verificarEstadoCuota(controlFacturacionActivo, 'pos-alerta-facturas');
        }


        // Limpiar estado
        carrito = [];
        pagosAcumuladosTicket = [];
        catalogoLocal = GeokatuDB.PosService.cargarCatalogoDesdeCache(idNegocio);
        renderizarCarrito();
        actualizarVisorRemanente();
        renderizarGridCatalogo();
        actualizarIndicadorCola();

        const txtVueltas = document.getElementById('txt-cambio-vueltas');
        if (txtVueltas) txtVueltas.style.display = 'none';

        if (switchDian) {
            switchDian.checked = false;
            document.getElementById('formulario-dian').style.display = 'none';
        }

        // 🛡️ BIFURCACIÓN ECOLÓGICA VS. IMPRESIÓN FÍSICA
        if (window.deseaFacturaEcologicaQR) {
            window.deseaFacturaEcologicaQR = false;
            await abrirModalFacturaDigitalQR(ultimoTicketIdVendido);
        } else {
            // Corte de papel automático por WebUSB/Serial + Diálogo de impresión térmica
            motorCajon.dispararAperturaDirecta(0, true).catch(() => {});
            setTimeout(() => window.print(), 300);
        }

    } else {
        alert("Error al procesar la venta: " + res.error);
    }

    document.getElementById('txt-conexion').innerText = "EN LÍNEA";
}

// =========================================================================
// GENERADOR NATIVO CODE-128B EN SVG PURO (SIN DEPENDENCIAS)
// =========================================================================
function generarCode128SVG(texto, svgId) {
    const svg = document.getElementById(svgId);
    if (!svg || !texto) return;

    // Patrones canónicos de anchos para Code 128
    const patrones = [
        "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
        "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
        "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
        "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
        "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
        "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
        "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
        "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
        "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
        "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
        "114131","311141","411131","211412","211214","211232","2331112"
    ];

    const START_B = 104;
    const STOP = 106;

    let codigos = [START_B];
    let sumaCheck = START_B;

    for (let i = 0; i < texto.length; i++) {
        const charCode = texto.charCodeAt(i) - 32;
        codigos.push(charCode);
        sumaCheck += charCode * (i + 1);
    }

    codigos.push(sumaCheck % 103);
    codigos.push(STOP);

    let patronCompleto = "";
    codigos.forEach(c => { patronCompleto += patrones[c]; });

    let x = 0;
    let rects = "";
    for (let i = 0; i < patronCompleto.length; i++) {
        const ancho = parseInt(patronCompleto[i], 10);
        if (i % 2 === 0) {
            rects += `<rect x="${x * 1.5}" y="0" width="${ancho * 1.5}" height="40" fill="#000"/>`;
        }
        x += ancho;
    }

    svg.setAttribute("viewBox", `0 0 ${x * 1.5} 40`);
    svg.innerHTML = rects;
}

function armarTirillaTermica(ticket, ticketId, datosFiscales = null) {
    // 1. Cargar perfil fiscal del comercio
    const perfilFiscal = JSON.parse(localStorage.getItem(`geokatu_perfil_${idNegocio}`) || "{}");
    const elNombreNegocio = document.getElementById('ticket-negocio-nombre');
    const elNitNegocio = document.getElementById('ticket-negocio-nit');
    const elDirNegocio = document.getElementById('ticket-negocio-dir');
    const elRegimenNegocio = document.getElementById('ticket-regimen-text');

    if (elNombreNegocio) elNombreNegocio.innerText = perfilFiscal.razon_social || "GEOKATU COMERCIO";
    if (elNitNegocio) elNitNegocio.innerText = perfilFiscal.nit ? `NIT: ${perfilFiscal.nit}-${perfilFiscal.dv || '0'}` : "NIT: 222222222222";
    if (elDirNegocio) elDirNegocio.innerText = perfilFiscal.direccion || "Pereira, Risaralda";
    if (elRegimenNegocio) elRegimenNegocio.innerText = perfilFiscal.regimen_tributario === "NO_RESPONSABLE_IVA" ? "NO RESPONSABLE DE IVA" : "RESPONSABLE DE IVA";

    // 2. Cabecera de auditoría retail (Tienda / Caja / Cajero / Fecha / Hora)
    const ahora = new Date();
    const elSede = document.getElementById('t-sede-cod');
    const elCaja = document.getElementById('t-caja-cod');
    const elFechaCorta = document.getElementById('t-fecha-corta');
    const elHoraCorta = document.getElementById('t-hora-corta');
    const elCajeroCod = document.getElementById('t-cajero-cod');

    if (elSede) elSede.innerText = perfilFiscal.codigo_tienda || "T-01";
    if (elCaja) elCaja.innerText = cajaNumeroActiva;
    if (elFechaCorta) elFechaCorta.innerText = ahora.toLocaleDateString('es-CO');
    if (elHoraCorta) elHoraCorta.innerText = ahora.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    if (elCajeroCod) elCajeroCod.innerText = `OP #${cajeroCodigoActivo} (${ticket.cajero_email || 'CAJERO'})`;

    // 3. Datos del ticket y cliente
    const elId = document.getElementById('t-id');
    const elCliente = document.getElementById('t-cliente');
    const elNit = document.getElementById('t-nit');
    const elMetodo = document.getElementById('t-metodo');
    const elTotal = document.getElementById('t-total');
    const elAviso = document.getElementById('t-dian-aviso');
    const bloqueFiscal = document.getElementById('t-bloque-fiscal');
    const elConsecutivo = document.getElementById('t-consecutivo-dian');
    const elCufe = document.getElementById('t-cufe-dian');
    const tbody = document.getElementById('t-items');

    if (elId) elId.innerText = ticketId.substring(0, 10);
    if (elCliente) elCliente.innerText = ticket.cliente?.nombre || "Consumidor Final";
    if (elNit) elNit.innerText = ticket.cliente?.nit || "222222222222";

    // 4. Formateo limpio del medio de pago
    let txtPago = "";
    if (ticket.metodos_pago_split && ticket.metodos_pago_split.length > 0) {
        txtPago = ticket.metodos_pago_split.map(p => 
            `${p.metodo}: $${Number(p.monto).toLocaleString('es-CO')}${p.referencia ? ` (${p.referencia})` : ''}`
        ).join(' | ');
    } else {
        txtPago = ticket.metodo_pago;
    }
    if (elMetodo) elMetodo.innerText = txtPago;

   if (elTotal) elTotal.innerText = `$${Number(ticket.total).toLocaleString('es-CO')}`;

    // 4.1 Desglose tributario en tirilla impresa
    const elBasePrint = document.getElementById('t-base-print');
    const elIvaPrint = document.getElementById('t-iva-print');
    const elExentoPrint = document.getElementById('t-exento-print');
    if (elBasePrint) elBasePrint.innerText = document.getElementById('txt-base')?.innerText || '$0';
    if (elIvaPrint) elIvaPrint.innerText = document.getElementById('txt-iva19')?.innerText || '$0';
    if (elExentoPrint) elExentoPrint.innerText = document.getElementById('txt-exento')?.innerText || '$0';

    // 5. Renderizado normativo DIAN (CUFE o Contingencia 04)
    if (ticket.factura_electronica) {
        if (datosFiscales && !datosFiscales.esContingencia && datosFiscales.cufe) {
            if (elAviso) elAviso.innerText = "FACTURA ELECTRÓNICA DE VENTA";
            if (bloqueFiscal) bloqueFiscal.style.display = 'block';
            if (elConsecutivo) elConsecutivo.innerText = datosFiscales.consecutivo || ticketId;
            if (elCufe) elCufe.innerText = datosFiscales.cufe;
        } else {
            if (elAviso) {
                elAviso.innerHTML = "FACTURA ELECTRÓNICA DE VENTA<br>*** CONTINGENCIA DIAN TIPO 04 ***<br>SUJETA A VALIDACIÓN PREVIA";
            }
            if (bloqueFiscal) {
                bloqueFiscal.style.display = 'block';
                if (elConsecutivo) elConsecutivo.innerText = `PROVISIONAL: ${ticketId}`;
                if (elCufe) elCufe.innerText = "PENDIENTE_TRANSMISION_DIFERIDA";
            }
        }
    } else {
        if (bloqueFiscal) bloqueFiscal.style.display = 'none';
        if (elAviso) {
            if (perfilFiscal.regimen_tributario === "NO_RESPONSABLE_IVA") {
                elAviso.innerHTML = "RÉGIMEN NO RESPONSABLE DE IVA<br>DOCUMENTO DE CONTROL INTERNO NO VÁLIDO COMO FACTURA";
            } else {
                elAviso.innerText = "DOCUMENTO EQUIVALENTE POS";
            }
        }
    }

   // 6. Renglones de productos (con notas de preparación visibles)
    if (tbody) {
        tbody.innerHTML = '';
        (ticket.productos || []).forEach(p => {
            const sub = Math.round(Number(p.precio) * Number(p.cantidad));
            const cantTexto = p.es_pesable ? `${p.cantidad} ${p.unidad_medida}` : `${p.cantidad}x`;
            const notaImpresa = p.nota ? `<br><span style="font-size: 8.5px; font-style: italic;">* ${p.nota}</span>` : '';
            tbody.innerHTML += `
                <tr>
                    <td>${cantTexto} ${p.nombre}${notaImpresa}</td>
                    <td style="text-align: right;">$${sub.toLocaleString('es-CO')}</td>
                </tr>
            `;
        });
    }


    // 7. Código de barras Code-128 para devolución rápida por escáner
    const txtBarcode = document.getElementById('t-barcode-text');
    if (txtBarcode) txtBarcode.innerText = ticketId;
    if (typeof generarCode128SVG === 'function') {
        generarCode128SVG(ticketId, 't-barcode-svg');
    }
}

// ==========================================
// 8. RED Y MONITOR OFFLINE
// ==========================================
function actualizarIndicadorCola() {
    const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid') || "";
    const colaTenant = JSON.parse(localStorage.getItem(`geokatu_sync_cola_${tenantReal}`) || "[]");
    const colaId = (idNegocio && idNegocio !== tenantReal) ? JSON.parse(localStorage.getItem(`geokatu_sync_cola_${idNegocio}`) || "[]") : [];
    const totalPendientes = Math.max(colaTenant.length, colaId.length);

    const txtRed = document.getElementById('txt-red-abono');
    const ledRed = document.getElementById('led-red-abono');
    const badgeRed = document.getElementById('badge-estado-red');

    if (txtRed && ledRed && badgeRed) {
        if (!navigator.onLine || totalPendientes > 0) {
            txtRed.innerText = totalPendientes > 0 ? `Offline: ${totalPendientes} pend.` : "Offline";
            txtRed.style.color = "orange";
            ledRed.style.backgroundColor = "orange";
            badgeRed.style.background = "rgba(255,165,0,0.15)";
            badgeRed.style.borderColor = "rgba(255,165,0,0.4)";
        } else {
            txtRed.innerText = "Online";
            txtRed.style.color = "var(--accent-green)";
            ledRed.style.backgroundColor = "var(--accent-green)";
            badgeRed.style.background = "rgba(0,255,100,0.1)";
            badgeRed.style.borderColor = "rgba(0,255,100,0.25)";
        }
    }

    monitorearCapacidadCola();
}


// =========================================================================
// MONITOR DE MEMORIA OFFLINE AL 80% (ALERTA DE 15 SEGUNDOS)
// =========================================================================
function monitorearCapacidadCola() {
    const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid') || "";
    const claveCola = `geokatu_sync_cola_${tenantReal}`;
    const rawCola = localStorage.getItem(claveCola) || "[]";
    const bytesOcupados = new Blob([rawCola]).size;
    const cola = JSON.parse(rawCola);

    // Umbral de 80%: 4 MB ocupados o más de 800 tickets acumulados
    const esCritico = bytesOcupados > 4000000 || cola.length >= 800;
    const alertaElem = document.getElementById('alerta-memoria-cola');

    if (alertaElem && esCritico && alertaElem.style.display !== 'flex') {
        alertaElem.style.display = 'flex';
        setTimeout(() => { alertaElem.style.opacity = '1'; }, 10);

        setTimeout(() => {
            alertaElem.style.opacity = '0';
            setTimeout(() => { alertaElem.style.display = 'none'; }, 400);
        }, 15000);
    }
}

// =========================================================================
// CONTROL DEL MENÚ DE 3 PUNTOS, RESPALDOS .TXT Y CIERRE DE SESIÓN
// =========================================================================
window.alternarMenuOpcionesPOS = (e) => {
    e.stopPropagation();
    const menu = document.getElementById('dropdown-menu-pos');
    if (menu) menu.classList.toggle('activo');
};

window.cerrarMenuOpcionesPOS = () => {
    const menu = document.getElementById('dropdown-menu-pos');
    if (menu) menu.classList.remove('activo');
};

document.addEventListener('click', (e) => {
    if (!e.target.closest('#dropdown-menu-pos') && !e.target.closest('#btn-menu-tres-puntos')) {
        window.cerrarMenuOpcionesPOS();
    }
});

// 1. Descarga de tickets en cola en formato .txt
window.descargarRespaldoOfflineTxt = () => {
    window.cerrarMenuOpcionesPOS();
    const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid') || "";
    const claveCola = `geokatu_sync_cola_${tenantReal}`;
    const cola = JSON.parse(localStorage.getItem(claveCola) || "[]");

    if (cola.length === 0) {
        if (typeof window.mostrarAvisoPos === 'function') {
            window.mostrarAvisoPos("No hay tickets pendientes en la cola offline.");
        } else {
            alert("No hay tickets pendientes en la cola offline.");
        }
        return;
    }

    const contenido = JSON.stringify(cola, null, 2);
    const blob = new Blob([contenido], { type: "text/plain;charset=utf-8" });
    const urlBlob = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = urlBlob;
    a.download = `respaldo_tickets_${tenantReal}_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(urlBlob);

    setTimeout(() => {
        if (confirm("Respaldo descargado exitosamente. ¿Deseas vaciar la memoria de tickets pendientes para liberar espacio en el teléfono?")) {
            localStorage.setItem(claveCola, "[]");
            actualizarIndicadorCola();
            if (typeof window.mostrarAvisoPos === 'function') {
                window.mostrarAvisoPos("Memoria de tickets offline liberada.");
            }
        }
    }, 400);
};

// 2. Carga y análisis anti-duplicados del archivo .txt
window.procesarArchivoRespaldoSeleccionado = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!navigator.onLine) {
        alert("Debes tener conexión a Internet activa para verificar y subir el respaldo a la nube.");
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const tickets = JSON.parse(e.target.result);
            if (!Array.isArray(tickets) || tickets.length === 0) {
                alert("El archivo no contiene un formato de tickets válido.");
                return;
            }

            document.getElementById('txt-conexion').innerText = "VERIFICANDO...";
            const res = await GeokatuDB.PosService.analizarYSincronizarRespaldo(idNegocio, tickets);

            alert(`Resultado del análisis de respaldo:\n\nTotal en archivo: ${res.total}\nDuplicados descartados: ${res.duplicados}\nSincronizados en Firestore: ${res.sincronizados}`);
            actualizarIndicadorCola();
        } catch (err) {
            console.error("[Respaldo Error]", err);
            alert("Error al procesar el archivo: formato no compatible.");
        } finally {
            document.getElementById('txt-conexion').innerText = "EN LÍNEA";
            event.target.value = '';
        }
    };
    reader.readAsText(file);
};

// 3. Cierre de sesión individual del cajero (mantiene el turno de caja abierto)
window.cerrarSesionCajeroPOS = async () => {
    window.cerrarMenuOpcionesPOS();
    if (carrito.length > 0 && !confirm("Hay artículos en el carrito actual. ¿Seguro que deseas salir sin completar la venta?")) {
        return;
    }

    try {
        await GeokatuDB.SecurityService.cerrarSesion();
        GeokatuDB.SecurityService.destruirSesionTerminalLocal();
        // Redirigir a login de oficina para que el relevo ingrese con sus credenciales
        window.location.href = 'oficina';
    } catch (e) {
        alert("Error al cerrar sesión: " + e.message);
    }
};


window.addEventListener('online', async () => {
    const elConexion = document.getElementById('txt-conexion');
    if (elConexion) elConexion.innerText = "EN LÍNEA";
    const led = document.getElementById('led-conexion');
    if (led) led.style.backgroundColor = "var(--accent-green)";

    const syncRes = await GeokatuDB.PosService.sincronizarVentasPendientes(idNegocio);
    if (syncRes.sincronizados > 0) {
        console.log(`[GEOKATU] ${syncRes.sincronizados} ventas offline sincronizadas.`);
    }
    actualizarIndicadorCola();
});

window.addEventListener('offline', () => {
    const elConexion = document.getElementById('txt-conexion');
    if (elConexion) elConexion.innerText = "OFFLINE";
    const led = document.getElementById('led-conexion');
    if (led) led.style.backgroundColor = "orange";
    actualizarIndicadorCola();
});

// =========================================================================
// 8.1 VIGILANTE DE CICLO DE VIDA KIOSK (ANTI-SUSPENSIÓN & RECUPERACIÓN HARDWARE)
// =========================================================================
let wakeLockSentinel = null;

// Evitar que la pantalla se apague automáticamente durante la jornada comercial
async function solicitarScreenWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLockSentinel = await navigator.wakeLock.request('screen');
            wakeLockSentinel.addEventListener('release', () => {
                wakeLockSentinel = null;
            });
        } catch (err) {
            console.info('[Kiosk WakeLock] Suspensión controlada por directiva de OS:', err.message);
        }
    }
}

// Reactivación inmediata al recuperar visibilidad (despertar de pantalla o cambio de pestaña)
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
        console.log('[Kiosk Lifecycle] Terminal reactivada. Verificando periféricos...');
        await solicitarScreenWakeLock();

        // 1. Diagnóstico de Balanza Serial: Verificar si el flujo de lectura sigue vivo
        if (balanza && balanza.tipoConexion === 'SERIAL') {
            const puerto = balanza.puertoSerial;
            // Si el puerto fue revocado o el canal readable quedó bloqueado por el SO
            if (!puerto || !puerto.readable || puerto.readable.locked) {
                console.warn('[Balanza] Canal serial interrumpido tras reposo. Restableciendo estado...');
                await balanza.desconectar().catch(() => {});
                const tagBalanza = document.getElementById('tag-estado-balanza');
                if (tagBalanza) {
                    tagBalanza.innerText = 'Desconectada (Reconectar)';
                    tagBalanza.style.color = 'orange';
                }
            }
        }

        // 2. Diagnóstico de Balanza Bluetooth: Validar estado de la conexión GATT
        if (balanza && balanza.tipoConexion === 'BLUETOOTH') {
            if (!balanza.dispositivoBLE?.gatt?.connected) {
                console.warn('[Balanza BLE] Conexión GATT perdida durante el reposo.');
                await balanza.desconectar().catch(() => {});
            }
        }

        // 3. Rehidratar cola offline y estado de red
        actualizarIndicadorCola();
    }
});

// Activar el bloqueo de pantalla al primer clic o interacción en la PWA
window.addEventListener('pointerdown', () => {
    if (!wakeLockSentinel) solicitarScreenWakeLock();
}, { once: true });

// ==========================================
// 9. ATAJOS DE TECLADO
// ==========================================
window.addEventListener('keydown', (e) => {
    const modalPesaje = document.getElementById('modal-pesaje');
    const modalPesajeAbierto = modalPesaje && modalPesaje.style.display === 'flex';

   // Tecla rápida F6 para Tarar en cualquier momento
    if (e.key === 'F6') {
        e.preventDefault();
        if (balanza) {
            balanza.aplicarTara();
        }
        return;
    }
// Tecla rápida F1: Manual de Usuario
    if (e.key === 'F1') {
        e.preventDefault();
        alternarModalAyuda();
        return;
    }

    // Escape para cerrar el manual si está abierto
    if (e.key === 'Escape' && modalAyuda && modalAyuda.style.display === 'flex') {
        e.preventDefault();
        modalAyuda.style.display = 'none';
        return;
    }

    // Tecla rápida F7 para Abrir Cajón Monedero
    if (e.key === 'F7') {
        e.preventDefault();
        abrirCajonManual();
        return;
    }
    // Escape prioritario: Si el modal de pesaje está abierto, cerrarlo de inmediato
    if (e.key === 'Escape') {
      if (modalPesajeAbierto) {
            e.preventDefault();
            cerrarModalPesaje();
            return;
        }
        if (modalAnulacion && modalAnulacion.style.display === 'flex') {
            e.preventDefault();
            cerrarModalAnulacion();
            return;
        }

        const modalEspera = document.getElementById('modal-espera');
        if (modalEspera && modalEspera.style.display === 'flex') {
            e.preventDefault();
            modalEspera.style.display = 'none';
            return;
        }
        const modalBalanza = document.getElementById('modal-balanza-config');
        if (modalBalanza && modalBalanza.style.display === 'flex') {
            e.preventDefault();
            modalBalanza.style.display = 'none';
            return;
        }
    }

    const elementoActivo = document.activeElement;
    const estaEscribiendo = ['INPUT', 'TEXTAREA', 'SELECT'].includes(elementoActivo.tagName);

    if (e.key === 'F2') {
        e.preventDefault();
        inputBuscador.focus();
        inputBuscador.select();
        return;
    }

    if (e.key === 'Escape') {
        if (estaEscribiendo) elementoActivo.blur();
        return;
    }


    if (estaEscribiendo) return;

   // 🛡️ ATAJOS VINCULADOS AL MOTOR DE ABONOS MIXTOS (SPLIT PAYMENTS)
    if (carrito.length > 0) {
        if (e.key === 'F4') {
            e.preventDefault();
            procesarAbonoPago('EFECTIVO');
        } else if (e.key === 'F8') {
            e.preventDefault();
            procesarAbonoPago('TARJETA');
        } else if (e.key === 'F9') {
            e.preventDefault();
            procesarAbonoPago('NEQUI');
        }
    }

});

// ==========================================
// CONTROL DEL MODAL DE FACTURA ELECTRÓNICA DIAN (FLOTANTE ENCIMA DE TODO)
// ==========================================
const switchDian = document.getElementById('switch-dian');
const txtEstadoDian = document.getElementById('txt-estado-dian');

if (switchDian) {
    switchDian.addEventListener('change', () => {
        if (switchDian.checked) {
            const modal = document.getElementById('modal-formulario-dian');
            if (modal) {
                modal.style.display = 'flex';
                setTimeout(() => document.getElementById('dian-nit')?.focus(), 100);
            }
        } else {
            window.cerrarModalDian(false);
        }
    });
}

window.cerrarModalDian = (guardado = false) => {
    const modal = document.getElementById('modal-formulario-dian');
    if (modal) modal.style.display = 'none';
    if (!guardado) {
        if (switchDian) switchDian.checked = false;
        if (txtEstadoDian) {
            txtEstadoDian.innerText = 'Consumidor Final';
            txtEstadoDian.style.color = 'var(--text-muted)';
        }
    }
};

window.confirmarDatosDian = () => {
    const nit = (document.getElementById('dian-nit')?.value || '').trim();
    const nombre = (document.getElementById('dian-nombre')?.value || '').trim();
    const email = (document.getElementById('dian-email')?.value || '').trim();

    if (!nit || !nombre || !email) {
        alert("Digita NIT/Cédula, Razón Social y Correo Electrónico.");
        return;
    }

    if (switchDian) switchDian.checked = true;
    if (txtEstadoDian) {
        txtEstadoDian.innerText = 'Personalizada';
        txtEstadoDian.style.color = 'var(--color-marca)';
    }
    window.cerrarModalDian(true);
};

// ==========================================
// CONTROL DEL MODAL DE MANUAL Y AYUDA [F1]
// ==========================================
const modalAyuda = document.getElementById('modal-ayuda-pos');
const btnAyuda = document.getElementById('btn-manual-ayuda');
const btnCerrarAyuda = document.getElementById('btn-cerrar-ayuda');

function alternarModalAyuda() {
    if (!modalAyuda) return;
    const estaVisible = modalAyuda.style.display === 'flex';
    modalAyuda.style.display = estaVisible ? 'none' : 'flex';
}

if (btnAyuda) btnAyuda.addEventListener('click', alternarModalAyuda);
if (btnCerrarAyuda) btnCerrarAyuda.addEventListener('click', () => modalAyuda.style.display = 'none');

// Control de pestañas dentro del manual
document.querySelectorAll('.tab-ayuda').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
        document.querySelectorAll('.tab-ayuda').forEach(b => b.classList.remove('activa'));
        document.querySelectorAll('.panel-ayuda-contenido').forEach(p => p.style.display = 'none');

        tabBtn.classList.add('activa');
        const targetTab = document.getElementById(tabBtn.dataset.tab);
        if (targetTab) targetTab.style.display = 'block';
    });
});

// ==========================================
// 10.  INICIALIZADOR DE MOTOR DE BALANZA
// ==========================================
balanza = new MotorBalanza({
    onPesoVivo: (peso) => {
        pesoEnVivoActual = peso;
        const txtVivo = document.getElementById('txt-peso-vivo');
        if (txtVivo) {
            txtVivo.innerText = `${peso.toFixed(3)} kg`;
            txtVivo.style.display = 'inline-block';
        }

        // Si el modal de pesaje manual está abierto, actualizarlo en vivo
        const inputManual = document.getElementById('input-peso-manual');
        if (inputManual && document.getElementById('modal-pesaje').style.display === 'flex') {
            inputManual.value = peso.toFixed(3);
            actualizarCalculoPesajeModal();
        }
    },
    onEstadoConexion: ({ conectado, tipo }) => {
        const tag = document.getElementById('tag-estado-balanza');
        const btnDesc = document.getElementById('btn-desconectar-balanza');
        const txtVivo = document.getElementById('txt-peso-vivo');

       const btnTara = document.getElementById('btn-tara-balanza');
        if (conectado) {
            tag.innerText = `Conectado: ${tipo}`;
            tag.style.color = 'var(--accent-green)';
            btnDesc.style.display = 'block';
            txtVivo.style.display = 'inline-block';
            if (btnTara) btnTara.style.display = 'inline-block';
        } else {
            tag.innerText = 'Desconectada';
            tag.style.color = '#aaa';
            btnDesc.style.display = 'none';
            txtVivo.style.display = 'none';
            if (btnTara) btnTara.style.display = 'none';
        }
    },
    onTramaDesconocida: (trama) => {
        console.info('[Balanza] Trama recibida para diagnóstico:', trama);
    }
});
// Abrir modal de catálogo
document.getElementById('btn-abrir-catalogo-modal')?.addEventListener('click', () => {
    const modalCat = document.getElementById('modal-catalogo-popup');
    if (modalCat) modalCat.style.display = 'flex';
});

// Listener de Tara en barra superior
const btnTaraSuperior = document.getElementById('btn-tara-balanza');
if (btnTaraSuperior) {
    btnTaraSuperior.addEventListener('click', async () => {
        if (balanza) {
            const tara = await balanza.aplicarTara();
            btnTaraSuperior.style.background = tara > 0 ? 'rgba(255,107,0,0.3)' : '';
        }
    });
}

// Listener de Tara en modal de pesaje
const btnTaraModal = document.getElementById('btn-tara-modal');
if (btnTaraModal) {
    btnTaraModal.addEventListener('click', async () => {
        if (balanza) {
            const tara = await balanza.aplicarTara();
            const badge = document.getElementById('badge-tara-activa');
            if (badge) {
                badge.innerText = `TARA: ${tara.toFixed(3)} kg`;
                badge.style.display = tara > 0 ? 'inline-block' : 'none';
            }
        } else {
            // Si es pesaje manual sin balanza, simplemente vacía el campo
            document.getElementById('input-peso-manual').value = '';
            actualizarCalculoPesajeModal();
        }
    });
}

// Listeners de UI para configuración de balanza
document.getElementById('btn-menu-balanza').addEventListener('click', () => {
    document.getElementById('modal-balanza-config').style.display = 'flex';
});

document.getElementById('btn-cerrar-modal-balanza').addEventListener('click', () => {
    document.getElementById('modal-balanza-config').style.display = 'none';
});

document.getElementById('btn-conectar-usb').addEventListener('click', async () => {
    try {
        await balanza.conectarUSB(9600);
        alert("Báscula USB conectada correctamente.");
    } catch (err) {
        alert("No se pudo conectar por USB: " + err.message);
    }
});

document.getElementById('btn-conectar-ble').addEventListener('click', async () => {
    try {
        await balanza.conectarBluetooth();
        alert("Báscula Bluetooth emparejada correctamente.");
    } catch (err) {
        alert("No se pudo conectar por Bluetooth: " + err.message);
    }
});

document.getElementById('btn-desconectar-balanza').addEventListener('click', async () => {
    await balanza.desconectar();
});

// Diagnóstico / Ticket de firmware para soporte
document.getElementById('btn-reporte-balanza').addEventListener('click', () => {
    const reporte = balanza.generarReporteDiagnostico();
    const textoReporte = JSON.stringify(reporte, null, 2);
    navigator.clipboard.writeText(textoReporte);
    alert("📋 Diagnóstico copiado al portapapeles. Pégalo en tu canal de soporte para homologar el firmware de este modelo.");
});

// ==========================================
// MODAL DE PESAJE MANUAL (O CAPTURA DIRECTA)
// ==========================================
function abrirModalPesaje(producto, pesoSugerido = null) {
    productoEnPesajeManual = producto;
    document.getElementById('pesaje-prod-nombre').innerText = producto.nombre;
    document.getElementById('pesaje-prod-precio').innerText = `$${Number(producto.precio).toLocaleString()} / ${producto.unidad_medida || 'kg'}`;

    const inputManual = document.getElementById('input-peso-manual');
    // Si se especificó un multiplicador (ej: 2.5*TOMATE) o hay balanza conectada
    if (pesoSugerido !== null) {
        inputManual.value = pesoSugerido.toFixed(3);
    } else {
        inputManual.value = pesoEnVivoActual > 0 ? pesoEnVivoActual.toFixed(3) : '';
    }
    actualizarCalculoPesajeModal();

    document.getElementById('modal-pesaje').style.display = 'flex';
    setTimeout(() => {
        inputManual.focus();
        inputManual.select();
    }, 100);
}

function actualizarCalculoPesajeModal() {
    if (!productoEnPesajeManual) return;
    const inputManual = document.getElementById('input-peso-manual');
    const peso = parseFloat(inputManual.value) || 0;
    const subtotal = Math.round(peso * Number(productoEnPesajeManual.precio));
    document.getElementById('pesaje-subtotal-calc').innerText = `$${subtotal.toLocaleString()}`;
}

document.getElementById('input-peso-manual').addEventListener('input', actualizarCalculoPesajeModal);

document.getElementById('input-peso-manual').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        confirmarPesajeModal();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        cerrarModalPesaje();
    }
});

document.getElementById('btn-confirmar-pesaje').addEventListener('click', confirmarPesajeModal);

function confirmarPesajeModal() {
    const inputVal = document.getElementById('input-peso-manual').value;
    const pesoValidado = sanitizarCantidadSegura(inputVal, true, 300.000); // 300 kg límite razonable de balanza comercial

    if (!pesoValidado) {
        alert("⚠️ Por favor ingresa un peso numérico válido mayor a 0.001 kg y máximo 300 kg.");
        return;
    }

    agregarAlCarrito(productoEnPesajeManual, pesoValidado, true);
    cerrarModalPesaje();
}


function cerrarModalPesaje() {
    document.getElementById('modal-pesaje').style.display = 'none';
    productoEnPesajeManual = null;
    document.getElementById('buscador-principal').focus();
}

document.getElementById('btn-cancelar-pesaje').addEventListener('click', cerrarModalPesaje);
// =========================================================================
// 11. FLUJO DE ANULACIONES Y REVERSIÓN DE STOCK (PUNTO 2)
// =========================================================================
const modalAnulacion = document.getElementById('modal-anulacion');
const inputTicketAnular = document.getElementById('anulacion-ticket-id');

function abrirModalAnulacion() {
    if (modalAnulacion) {
        // Pre-cargar con el último ticket vendido para agilizar
        inputTicketAnular.value = ultimoTicketIdVendido || '';
        modalAnulacion.style.display = 'flex';
        setTimeout(() => {
            inputTicketAnular.focus();
            inputTicketAnular.select();
        }, 100);
    }
}

function cerrarModalAnulacion() {
    if (modalAnulacion) {
        modalAnulacion.style.display = 'none';
        document.getElementById('buscador-principal').focus();
    }
}

document.getElementById('btn-abrir-anulacion').addEventListener('click', abrirModalAnulacion);
document.getElementById('btn-cancelar-anulacion').addEventListener('click', cerrarModalAnulacion);

document.getElementById('btn-ejecutar-anulacion').addEventListener('click', async () => {
    const ticketId = inputTicketAnular.value.trim();
    const motivo = document.getElementById('anulacion-motivo').value;

    if (!ticketId) {
        alert("Por favor ingresa el identificador del ticket a anular.");
        return;
    }

    if (!confirm(`¿Confirmas la anulación del ticket ${ticketId}? Se devolverán los productos al inventario.`)) {
        return;
    }

    document.getElementById('txt-conexion').innerText = "REVIRTIENDO...";
    const res = await GeokatuDB.PosService.anularVentaPOS(idNegocio, ticketId, motivo);

    if (res.success) {
        alert(res.mensaje);

        // 1. Rehidratar catálogo local en RAM tras el reingreso de stock
        catalogoLocal = GeokatuDB.PosService.cargarCatalogoDesdeCache(idNegocio);
        renderizarGridCatalogo();

        // 2. Descontar el total del KPI de ventas del día
        if (res.totalRevertido > 0) {
            const kpiObj = document.getElementById('kpi-ventas');
            if (kpiObj) {
                const kpiActual = Number(kpiObj.innerText.replace(/\D/g, ''));
                kpiObj.innerText = `$${Math.max(0, kpiActual - res.totalRevertido).toLocaleString()}`;
            }
        }

        // Si el ticket anulado era el último, se limpia
        if (ultimoTicketIdVendido === ticketId) {
            ultimoTicketIdVendido = null;
        }

        cerrarModalAnulacion();
    } else {
        alert("Error al anular: " + res.error);
    }
    document.getElementById('txt-conexion').innerText = "EN LÍNEA";
});
// =========================================================================
// 12. CONTROL DE CAJA, EGRESOS Y CIERRE Z (PUNTO 3)
// =========================================================================
async function verificarEstadoTurnoCaja() {
    const res = await GeokatuDB.PosService.obtenerEstadoCajaActual(idNegocio, cajaNumeroActiva);
    const btnCaja = document.getElementById('txt-estado-caja-btn');


   if (res.success && res.data && res.data.estado === 'ABIERTA') {
        turnoCajaActivo = res.data;
        
        // 🛡️ RECUPERACIÓN DEFENSIVA: Evita pérdida de acumuladores ante crash del sistema
        const acumuladoGuardado = localStorage.getItem(`geokatu_acumulado_${idNegocio}`);
        if (acumuladoGuardado) {
            try {
                const parsed = JSON.parse(acumuladoGuardado);
                acumuladoTurno = {
                    efectivo: Number(parsed.efectivo) || 0,
                    tarjeta: Number(parsed.tarjeta) || 0,
                    nequi: Number(parsed.nequi) || 0,
                    base_gravable: Number(parsed.base_gravable) || 0,
                    iva_19: Number(parsed.iva_19) || 0,
                    exento: Number(parsed.exento) || 0
                };
            } catch (e) {
                console.warn("[POS] Acumulado corrupto en storage, recalculando...");
            }
        }


        if (btnCaja) {
            btnCaja.innerText = "Caja Abierta";
            btnCaja.style.color = "var(--accent-green)";
        }
    } else {
        turnoCajaActivo = null;
        if (btnCaja) {
            btnCaja.innerText = "Abrir Caja";
            btnCaja.style.color = "orange";
        }
        // Si no hay caja abierta, abrir el modal de apertura al inicio
        abrirModalAperturaCaja();
    }
}

function abrirModalAperturaCaja() {
    const modal = document.getElementById('modal-apertura-caja');
    if (modal) {
        modal.style.display = 'flex';
        const inp = document.getElementById('input-base-caja');
        setTimeout(() => { inp.focus(); inp.select(); }, 100);
    }
}

document.getElementById('btn-confirmar-apertura').addEventListener('click', async () => {
    const base = parseFloat(document.getElementById('input-base-caja').value);
    if (isNaN(base) || base < 0) {
        alert("Ingresa un monto de base válido (puede ser 0 si no hay sencillo).");
        return;
    }

    // 🛑 "NO ANTES": Si el ciclo ya alcanzó las 1.300 facturas, no se permite abrir un nuevo turno
    if (controlFacturacionActivo) {
        const gratis = Number(controlFacturacionActivo.facturas_cupo_gratis) || 1300;
        const prepago = Number(controlFacturacionActivo.facturas_prepago_saldo) || 0;
        const emitidas = Number(controlFacturacionActivo.facturas_emitidas_mes) || 0;
        if (emitidas >= (gratis + prepago)) {
            alert("🛑 Has alcanzado el límite de 1.300 facturas de tu plan. Debes recargar cupo antes de aperturar un nuevo turno de caja.");
            return;
        }
    }

    const res = await GeokatuDB.PosService.abrirTurnoCaja(idNegocio, base, auth.currentUser?.email || "CAJERO", cajaNumeroActiva);

    if (res.success) {
        turnoCajaActivo = res.data;
               acumuladoTurno = { efectivo: 0, tarjeta: 0, nequi: 0, base_gravable: 0, iva_19: 0, exento: 0 };
        localStorage.setItem(`geokatu_acumulado_${idNegocio}`, JSON.stringify(acumuladoTurno));

        document.getElementById('modal-apertura-caja').style.display = 'none';
        const btnCaja = document.getElementById('txt-estado-caja-btn');
        if (btnCaja) {
            btnCaja.innerText = "Caja Abierta";
            btnCaja.style.color = "var(--accent-green)";
        }
        window.mostrarAvisoPos(`Caja abierta con base de $${base.toLocaleString()}. ¡Buenas ventas!`);
    } else {
        alert("Error al abrir caja: " + res.error);
    }
});

// Botón de control de caja en cabecera
document.getElementById('btn-control-caja').addEventListener('click', () => {
    if (!turnoCajaActivo || turnoCajaActivo.estado !== 'ABIERTA') {
        abrirModalAperturaCaja();
    } else {
        document.getElementById('modal-movimiento-caja').style.display = 'flex';
        document.getElementById('mov-monto').value = '';
        document.getElementById('mov-motivo').value = '';
    }
});

document.getElementById('btn-cancelar-mov-caja').addEventListener('click', () => {
    document.getElementById('modal-movimiento-caja').style.display = 'none';
});

// Guardar movimiento menor (Gasto o entrada)
document.getElementById('btn-guardar-mov-caja').addEventListener('click', async () => {
    const tipo = document.getElementById('mov-tipo-operacion').value;
    const monto = parseFloat(document.getElementById('mov-monto').value);
    const motivo = document.getElementById('mov-motivo').value.trim();

    if (isNaN(monto) || monto <= 0) return alert("Ingresa un monto válido.");
    if (!motivo) return alert("Por favor describe el motivo de la salida o entrada.");

    const res = await GeokatuDB.PosService.registrarMovimientoMenorCaja(idNegocio, tipo, monto, motivo, cajaNumeroActiva);

    if (res.success) {
        turnoCajaActivo.movimientos_menores = turnoCajaActivo.movimientos_menores || [];
        turnoCajaActivo.movimientos_menores.push(res.movimiento);
        alert(`Movimiento registrado: ${tipo === 'SALIDA' ? 'Retiro de' : 'Entrada de'} $${monto.toLocaleString()}`);
        document.getElementById('modal-movimiento-caja').style.display = 'none';
    } else {
        alert("Error al registrar movimiento: " + res.error);
    }
});

// Variable para identificar si el conteo actual es Auditoría (X) o Cierre Final (Z)
let modoArqueoActual = 'CIERRE_Z'; // 'INFORME_X' | 'CIERRE_Z'

// Disparador de Auditoría / Informe X
document.getElementById('btn-iniciar-informe-x').addEventListener('click', () => {
    modoArqueoActual = 'INFORME_X';
    document.getElementById('modal-movimiento-caja').style.display = 'none';
    abrirModalArqueoGenerico("Auditoría Parcial (Informe X)", "EMITIR INFORME X (SIN CERRAR) 📋");
});

// Disparador de Cierre Z definitivo
document.getElementById('btn-iniciar-cierre-z').addEventListener('click', () => {
    modoArqueoActual = 'CIERRE_Z';
    document.getElementById('modal-movimiento-caja').style.display = 'none';
    abrirModalArqueoGenerico("Arqueo y Cierre Z Definitivo", "SELLAR Y CERRAR TURNO 🖨️");
});

function abrirModalArqueoGenerico(titulo, textoBotonConfirmar) {
    const modal = document.getElementById('modal-cierre-z');
    const base = turnoCajaActivo ? Number(turnoCajaActivo.base_inicial) : 0;
    
    let entradas = 0;
    let salidas = 0;
    (turnoCajaActivo.movimientos_menores || []).forEach(m => {
        if (m.tipo === 'ENTRADA') entradas += m.monto;
        if (m.tipo === 'SALIDA') salidas += m.monto;
    });

    const esperadoEfectivo = base + acumuladoTurno.efectivo + entradas - salidas;

    modal.querySelector('h3').innerText = titulo;
    document.getElementById('btn-confirmar-cierre-z').innerText = textoBotonConfirmar;

    document.getElementById('cz-base-inicial').innerText = `$${base.toLocaleString()}`;
    document.getElementById('cz-ventas-efectivo').innerText = `$${acumuladoTurno.efectivo.toLocaleString()}`;
    document.getElementById('cz-ventas-tarjeta').innerText = `$${acumuladoTurno.tarjeta.toLocaleString()}`;
    document.getElementById('cz-ventas-nequi').innerText = `$${acumuladoTurno.nequi.toLocaleString()}`;
    document.getElementById('cz-movimientos-netos').innerText = `+$${entradas.toLocaleString()} / -$${salidas.toLocaleString()}`;
    document.getElementById('cz-efectivo-esperado').innerText = `$${esperadoEfectivo.toLocaleString()}`;

    const inputContado = document.getElementById('cz-input-contado');
    inputContado.value = '';
    document.getElementById('cz-box-resultado').style.display = 'none';

    modal.style.display = 'flex';
    setTimeout(() => inputContado.focus(), 100);
}

function abrirModalCierreZ() {
    const modal = document.getElementById('modal-cierre-z');
    const base = turnoCajaActivo ? Number(turnoCajaActivo.base_inicial) : 0;
    
    let entradas = 0;
    let salidas = 0;
    (turnoCajaActivo.movimientos_menores || []).forEach(m => {
        if (m.tipo === 'ENTRADA') entradas += m.monto;
        if (m.tipo === 'SALIDA') salidas += m.monto;
    });

    const esperadoEfectivo = base + acumuladoTurno.efectivo + entradas - salidas;

    document.getElementById('cz-base-inicial').innerText = `$${base.toLocaleString()}`;
    document.getElementById('cz-ventas-efectivo').innerText = `$${acumuladoTurno.efectivo.toLocaleString()}`;
    document.getElementById('cz-ventas-tarjeta').innerText = `$${acumuladoTurno.tarjeta.toLocaleString()}`;
    document.getElementById('cz-ventas-nequi').innerText = `$${acumuladoTurno.nequi.toLocaleString()}`;
    document.getElementById('cz-movimientos-netos').innerText = `+$${entradas.toLocaleString()} / -$${salidas.toLocaleString()}`;
    document.getElementById('cz-efectivo-esperado').innerText = `$${esperadoEfectivo.toLocaleString()}`;

    const inputContado = document.getElementById('cz-input-contado');
    inputContado.value = '';
    document.getElementById('cz-box-resultado').style.display = 'none';

    modal.style.display = 'flex';
    setTimeout(() => inputContado.focus(), 100);
}

// Cálculo reactivo de sobrante o faltante al contar el dinero
document.getElementById('cz-input-contado').addEventListener('input', (e) => {
    const contado = parseFloat(e.target.value);
    const esperado = Number(document.getElementById('cz-efectivo-esperado').innerText.replace(/\D/g, ''));
    const box = document.getElementById('cz-box-resultado');
    const txtTitulo = document.getElementById('cz-resultado-titulo');
    const txtMonto = document.getElementById('cz-resultado-monto');

    if (isNaN(contado)) {
        box.style.display = 'none';
        return;
    }

    const diff = contado - esperado;
    box.style.display = 'flex';

    if (diff === 0) {
        box.style.background = "rgba(0,255,100,0.15)";
        box.style.border = "1px solid var(--accent-green)";
        txtTitulo.innerText = "CAJA CUADRADA EXACTA";
        txtTitulo.style.color = "var(--accent-green)";
        txtMonto.innerText = "$0";
        txtMonto.style.color = "var(--accent-green)";
    } else if (diff > 0) {
        box.style.background = "rgba(96,165,250,0.15)";
        box.style.border = "1px solid #60a5fa";
        txtTitulo.innerText = "SOBRANTE EN CAJA";
        txtTitulo.style.color = "#60a5fa";
        txtMonto.innerText = `+$${diff.toLocaleString()}`;
        txtMonto.style.color = "#60a5fa";
    } else {
        box.style.background = "rgba(255,69,58,0.15)";
        box.style.border = "1px solid var(--accent-red)";
        txtTitulo.innerText = "FALTANTE EN CAJA";
        txtTitulo.style.color = "var(--accent-red)";
        txtMonto.innerText = `-$${Math.abs(diff).toLocaleString()}`;
        txtMonto.style.color = "var(--accent-red)";
    }
});

document.getElementById('btn-cancelar-cierre-z').addEventListener('click', () => {
    document.getElementById('modal-cierre-z').style.display = 'none';
});

// Ejecución de Arqueo: bifurcación entre Informe X (Auditoría) y Cierre Z (Fin de Turno)
document.getElementById('btn-confirmar-cierre-z').addEventListener('click', async () => {
    const contado = parseFloat(document.getElementById('cz-input-contado').value);
    if (isNaN(contado) || contado < 0) {
        alert("Por favor digita la cantidad de dinero físico contado en la gaveta.");
        return;
    }

    // --- CAMINO 1: INFORME X (AUDITORÍA GERENCIAL SIN CERRAR TURNO) ---
    if (modoArqueoActual === 'INFORME_X') {
        const supervisor = prompt("Ingresa el correo o nombre del Supervisor/Gerente que audita:", "Gerencia");
        if (!supervisor) return;

        document.getElementById('txt-conexion').innerText = "REGISTRANDO AUDITORÍA...";
        const resX = await GeokatuDB.PosService.registrarAuditoriaInformeX(idNegocio, contado, acumuladoTurno, supervisor);

        if (resX.success) {
            armarTirillaInformeX(resX.informeX);
            document.getElementById('modal-cierre-z').style.display = 'none';

            setTimeout(() => {
                window.print();
                setTimeout(() => {
                    document.getElementById('tirilla-informe-x-container').style.display = 'none';
                    document.getElementById('tirilla-venta-container').style.display = 'block';
                }, 1000);
            }, 300);

            alert("Auditoría (Informe X) generada con éxito. La caja continúa operando normalmente.");
        } else {
            alert("Error al registrar auditoría: " + resX.error);
        }
        document.getElementById('txt-conexion').innerText = "EN LÍNEA";
        return;
    }

    // --- CAMINO 2: CIERRE Z (SELLADO DEFINITIVO DE CAJA) ---
    if (!confirm("¿Deseas sellar y cerrar definitivamente este turno de caja?")) {
        return;
    }

    document.getElementById('txt-conexion').innerText = "CERRANDO CAJA...";
    const res = await GeokatuDB.PosService.ejecutarCierreZ(idNegocio, contado, acumuladoTurno, cajaNumeroActiva);


    if (res.success) {
        // Armar tirilla de Cierre Z
        armarTirillaCierreZ(res.cierre);

        // Limpiar estado
        turnoCajaActivo = null;
               acumuladoTurno = { efectivo: 0, tarjeta: 0, nequi: 0, base_gravable: 0, iva_19: 0, exento: 0 };
        localStorage.removeItem(`geokatu_acumulado_${idNegocio}`);

        const btnCaja = document.getElementById('txt-estado-caja-btn');
        if (btnCaja) {
            btnCaja.innerText = "Abrir Caja";
            btnCaja.style.color = "orange";
        }

        document.getElementById('modal-cierre-z').style.display = 'none';

        // Imprimir tirilla de cierre
        setTimeout(() => {
            window.print();
            // Restaurar visor térmico para tickets de venta
            setTimeout(() => {
                document.getElementById('tirilla-cierre-z-container').style.display = 'none';
                document.getElementById('tirilla-venta-container').style.display = 'block';
            }, 1000);
        }, 300);

        alert("Turno sellado y Cierre Z registrado exitosamente.");
    } else {
        alert("Error al cerrar caja: " + res.error);
    }
    document.getElementById('txt-conexion').innerText = "EN LÍNEA";
});

function armarTirillaCierreZ(cierre) {
    document.getElementById('tirilla-venta-container').style.display = 'none';
    document.getElementById('tirilla-cierre-z-container').style.display = 'block';

    document.getElementById('tz-id').innerText = cierre.id_sesion;
    document.getElementById('tz-apertura').innerText = new Date(cierre.fecha_apertura).toLocaleTimeString();
    document.getElementById('tz-cierre').innerText = new Date(cierre.fecha_cierre).toLocaleTimeString();
    document.getElementById('tz-cajero').innerText = cierre.cajero;

    document.getElementById('tz-base').innerText = `$${cierre.base_inicial.toLocaleString()}`;
    document.getElementById('tz-efectivo').innerText = `$${cierre.ventas_efectivo.toLocaleString()}`;
    document.getElementById('tz-tarjeta').innerText = `$${cierre.ventas_tarjeta.toLocaleString()}`;
    document.getElementById('tz-nequi').innerText = `$${cierre.ventas_nequi.toLocaleString()}`;
    document.getElementById('tz-entradas').innerText = `+$${cierre.total_entradas_menores.toLocaleString()}`;
    document.getElementById('tz-salidas').innerText = `-$${cierre.total_salidas_menores.toLocaleString()}`;

    document.getElementById('tz-esperado').innerText = `$${cierre.esperado_efectivo.toLocaleString()}`;
    document.getElementById('tz-contado').innerText = `$${cierre.contado_efectivo.toLocaleString()}`;

    const elDisc = document.getElementById('tz-discrepancia');
    if (cierre.diferencia_cuadre === 0) {
        elDisc.innerText = "CUADRADA EXACTA ($0)";
        elDisc.style.color = "#000";
    } else if (cierre.diferencia_cuadre > 0) {
        elDisc.innerText = `SOBRANTE: +$${cierre.diferencia_cuadre.toLocaleString()}`;
    } else {
        elDisc.innerText = `FALTANTE: -$${Math.abs(cierre.diferencia_cuadre).toLocaleString()}`;
    }
}
function armarTirillaInformeX(informe) {
    document.getElementById('tirilla-venta-container').style.display = 'none';
    document.getElementById('tirilla-cierre-z-container').style.display = 'none';
    document.getElementById('tirilla-informe-x-container').style.display = 'block';

    document.getElementById('tx-id').innerText = informe.id_informe;
    document.getElementById('tx-turno').innerText = informe.id_sesion_origen;
    document.getElementById('tx-fecha').innerText = new Date(informe.fecha_auditoria).toLocaleString();
    document.getElementById('tx-cajero').innerText = informe.cajero;
    document.getElementById('tx-supervisor').innerText = informe.supervisor;

    document.getElementById('tx-base').innerText = `$${informe.base_inicial.toLocaleString()}`;
    document.getElementById('tx-efectivo').innerText = `$${informe.ventas_efectivo.toLocaleString()}`;
    document.getElementById('tx-tarjeta').innerText = `$${informe.ventas_tarjeta.toLocaleString()}`;
    document.getElementById('tx-nequi').innerText = `$${informe.ventas_nequi.toLocaleString()}`;
    document.getElementById('tx-entradas').innerText = `+$${informe.total_entradas_menores.toLocaleString()}`;
    document.getElementById('tx-salidas').innerText = `-$${informe.total_salidas_menores.toLocaleString()}`;

    document.getElementById('tx-esperado').innerText = `$${informe.esperado_efectivo.toLocaleString()}`;
    document.getElementById('tx-contado').innerText = `$${informe.contado_efectivo.toLocaleString()}`;

    const elDisc = document.getElementById('tx-discrepancia');
    if (informe.diferencia_cuadre === 0) {
        elDisc.innerText = "CAJA CUADRADA EXACTA ($0)";
    } else if (informe.diferencia_cuadre > 0) {
        elDisc.innerText = `SOBRANTE: +$${informe.diferencia_cuadre.toLocaleString()}`;
    } else {
        elDisc.innerText = `FALTANTE: -$${Math.abs(informe.diferencia_cuadre).toLocaleString()}`;
    }
}
// =========================================================================
// 13. CONTROL DEL CAJÓN MONEDERO MANUAL (PUNTO 5)
// =========================================================================
async function abrirCajonManual() {
    if (!turnoCajaActivo || turnoCajaActivo.estado !== 'ABIERTA') {
        alert("La caja está cerrada. Debes abrir turno primero.");
        return;
    }

    const res = await motorCajon.dispararAperturaDirecta(0);
    
    // Si opera por el driver universal de la impresora, window.print() con plantilla vacía dispara el solenoide
    if (res.metodo === "DRIVER_IMPRESION") {
        // En drivers configurados para "Open Drawer on Print", window.print() abre la gaveta
        // Si no hay conexión directa WebUSB/Serial, emitimos notificación
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        console.log("[Cajón] Pulso enviado vía driver térmico.");
    }
}

document.getElementById('btn-abrir-cajon').addEventListener('click', abrirCajonManual);
// =========================================================================
// 14. MEJORAS DE MOSTRADOR: NOTAS, VENTA LIBRE Y DEVOLUCIÓN PARCIAL
// =========================================================================
window.agregarNotaItem = function(index) {
    const notaActual = carrito[index].nota || "";
    const nuevaNota = prompt("Instrucción o nota de preparación para este ítem:", notaActual);
    if (nuevaNota !== null) {
        carrito[index].nota = nuevaNota.trim();
        renderizarCarrito();
    }
};

// --- CONTROL DE ÍTEM ABIERTO / VENTA LIBRE ---
document.getElementById('btn-abrir-item-libre')?.addEventListener('click', () => {
    document.getElementById('modal-item-libre').style.display = 'flex';
    setTimeout(() => document.getElementById('libre-nombre').focus(), 100);
});

document.getElementById('btn-cancelar-libre')?.addEventListener('click', () => {
    document.getElementById('modal-item-libre').style.display = 'none';
});

document.getElementById('btn-agregar-libre')?.addEventListener('click', () => {
    const nom = document.getElementById('libre-nombre').value.trim() || "Concepto General";
    const pre = parseFloat(document.getElementById('libre-precio').value);
    const iva = document.getElementById('libre-iva').value;

    if (isNaN(pre) || pre <= 0) return alert("Ingresa un precio válido.");

    carrito.push({
        id_prod: "GENERICO_" + Date.now(),
        codigo_barras: "",
        plu: "",
        nombre: `[L] ${nom}`,
        precio: pre,
        cantidad: 1,
        impuesto: iva,
        es_pesable: false,
        unidad_medida: "und",
        subtotal: pre,
        precio_fijado_balanza: false
    });

    document.getElementById('libre-nombre').value = '';
    document.getElementById('libre-precio').value = '';
    document.getElementById('modal-item-libre').style.display = 'none';

    renderizarCarrito();
    actualizarVisorRemanente();
});

// --- DEVOLUCIÓN PARCIAL POR ESCÁNER O SELECCIÓN ---
window.abrirModalDevolucionParcial = async function(ticketId) {
    const { getFirestore, doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
    const db = getFirestore();
    const snap = await getDoc(doc(db, `Directorio/${idNegocio}/Ventas_POS`, ticketId));

    if (!snap.exists()) return alert("El ticket escaneado no existe en el sistema.");
    const venta = snap.data();
    if (venta.anulado) return alert("Este ticket ya fue anulado previamente.");

    document.getElementById('dev-ticket-tag').innerText = ticketId;
    const lista = document.getElementById('dev-lista-items');
    lista.innerHTML = '';

    (venta.productos || []).forEach((p, idx) => {
        lista.innerHTML += `
            <div style="background: rgba(255,255,255,0.04); padding: 8px 12px; border-radius: 6px; display: flex; align-items: center; justify-content: space-between;">
                <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; cursor: pointer;">
                    <input type="checkbox" class="chk-dev-item" data-idx="${idx}" data-precio="${p.precio}" data-cant="${p.cantidad}" onchange="window.recalcularTotalDevolucion()">
                    <span>${p.cantidad}x ${p.nombre} ($${Number(p.precio).toLocaleString('es-CO')})</span>
                </label>
            </div>
        `;
    });

    window.ticketEnDevolucion = { id: ticketId, productos: venta.productos };
    document.getElementById('dev-total-reembolso').innerText = "$0";
    document.getElementById('modal-devolucion-parcial').style.display = 'flex';
};

window.recalcularTotalDevolucion = function() {
    let total = 0;
    document.querySelectorAll('.chk-dev-item:checked').forEach(chk => {
        total += (Number(chk.dataset.precio) * Number(chk.dataset.cant));
    });
    document.getElementById('dev-total-reembolso').innerText = `$${total.toLocaleString('es-CO')}`;
};

document.getElementById('btn-cancelar-dev')?.addEventListener('click', () => {
    document.getElementById('modal-devolucion-parcial').style.display = 'none';
});

document.getElementById('btn-ejecutar-dev-parcial')?.addEventListener('click', async () => {
    const itemsADevolver = [];
    document.querySelectorAll('.chk-dev-item:checked').forEach(chk => {
        const pOriginal = window.ticketEnDevolucion.productos[chk.dataset.idx];
        itemsADevolver.push({
            ...pOriginal,
            cantidad_devuelta: Number(chk.dataset.cant)
        });
    });

    if (itemsADevolver.length === 0) return alert("Selecciona al menos un artículo para devolver.");

    const res = await GeokatuDB.PosService.devolucionParcialPOS(idNegocio, window.ticketEnDevolucion.id, itemsADevolver);
    if (res.success) {
        alert(`Devolución exitosa. Reembolso: $${res.totalReembolsado.toLocaleString('es-CO')}. Se restituyó el inventario.`);
        document.getElementById('modal-devolucion-parcial').style.display = 'none';
        catalogoLocal = GeokatuDB.PosService.cargarCatalogoDesdeCache(idNegocio);
        renderizarGridCatalogo();
    } else {
        alert("Error en devolución: " + res.error);
    }
});

// =========================================================================
// CAMBIO OBLIGATORIO DE CONTRASEÑA EN PRIMER INICIO
// =========================================================================
document.getElementById('btn-establecer-nueva-pass')?.addEventListener('click', async () => {
    const p1 = document.getElementById('input-nueva-pass').value;
    const p2 = document.getElementById('input-confirmar-pass').value;

    if (p1.length < 6) return alert("La contraseña debe tener mínimo 6 caracteres.");
    if (p1 !== p2) return alert("Las contraseñas no coinciden.");

    try {
        const { getAuth, updatePassword } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js');
        const { getFirestore, doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
        
        const auth = getAuth();
        await updatePassword(auth.currentUser, p1);

        const db = getFirestore();
        const fechaActualIso = new Date().toISOString();

        // Actualizar subcolección del comercio y limpiar la expiración provisional
        await updateDoc(doc(db, `Directorio/${idNegocio}/Equipo`, auth.currentUser.uid), {
            requiere_cambio_password: false,
            expiracion_clave_temporal: null,
            fecha_ultimo_cambio_password: fechaActualIso
        });

        // Actualizar el índice global de operadores
        try {
            await updateDoc(doc(db, 'Usuarios_Operadores', auth.currentUser.uid), {
                requiere_cambio_password: false,
                expiracion_clave_temporal: null,
                fecha_ultimo_cambio_password: fechaActualIso
            });
        } catch (eDocGlobal) {
            console.warn("[POS] Índice global omitido o sin permisos:", eDocGlobal.message);
        }

        alert("Contraseña personalizada actualizada correctamente. ¡Bienvenido!");

        document.getElementById('modal-cambio-password-obligatorio').style.display = 'none';
        await inicializarCaja();
    } catch (err) {
        alert("Error actualizando contraseña: " + err.message);
    }
});
// =========================================================================
// 15. FACTURA ECOLÓGICA QR (URL FIRMADA DE 24 HORAS, WHATSAPP Y ZERO-PAPER)
// =========================================================================
window.deseaFacturaEcologicaQR = false;
window.urlFacturaActiva = "";
window.ticketIdFacturaActiva = "";

window.alternarFacturaEcologica = async function(btn) {
    // Si el carrito está vacío y ya hay una venta previa asentada, abrir directamente su comprobante QR
    if (carrito.length === 0 && ultimoTicketIdVendido) {
        await abrirModalFacturaDigitalQR(ultimoTicketIdVendido);
        return;
    }

    // Si el carrito tiene productos, activar/desactivar modalidad ecológica para el cierre
    window.deseaFacturaEcologicaQR = !window.deseaFacturaEcologicaQR;
    if (btn) {
        btn.style.borderColor = window.deseaFacturaEcologicaQR ? 'var(--accent-green)' : 'var(--border-soft)';
        btn.style.background = window.deseaFacturaEcologicaQR ? 'rgba(0,255,100,0.15)' : 'rgba(255,255,255,0.03)';
        btn.style.color = window.deseaFacturaEcologicaQR ? 'var(--accent-green)' : '#fff';
    }

    if (typeof window.mostrarAvisoPos === 'function') {
        window.mostrarAvisoPos(window.deseaFacturaEcologicaQR ? "Modo ecológico activo: emitirá QR al cobrar." : "Modo ticket impreso activo.");
    }
};


async function generarFirmaFactura24Horas(tktId, expTimestamp) {
    try {
        const raw = `${tktId}:${idNegocio}:${expTimestamp}:GEOKATU_PUBLIC_TKT_SALT`;
        if (window.crypto && window.crypto.subtle) {
            const encoder = new TextEncoder();
            const data = encoder.encode(raw);
            const buffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(buffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).slice(0, 16).join('');
        }
    } catch (_) {}
    // Fallback determinista seguro para contextos HTTP locales en Termux/Acode
    return "SIG_" + Date.now().toString(16).toUpperCase();
}



async function abrirModalFacturaDigitalQR(ticketId, telefonoPrevio = "") {
    const modalQR = document.getElementById('modal-factura-qr');
    const contenedor = document.getElementById('contenedor-qr-factura');
    if (!modalQR || !contenedor) return;

    window.ticketIdFacturaActiva = ticketId;
    const exp = Date.now() + (24 * 60 * 60 * 1000); // 24 horas
    const sig = await generarFirmaFactura24Horas(ticketId, exp);

    window.urlFacturaActiva = `${window.location.origin}/factura?com=${idNegocio}&tkt=${ticketId}&exp=${exp}&sig=${sig}`;

    contenedor.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.margin = '0 auto';
    contenedor.appendChild(canvas);

    let renderExitoso = false;
    if (typeof QRLocal !== 'undefined' && QRLocal.dibujarEnCanvas) {
        try {
            // quietZone: 4 módulos blancos mandatorios para lectura óptica en pantallas
            QRLocal.dibujarEnCanvas(canvas, window.urlFacturaActiva, { width: 240, margin: 4 });
            renderExitoso = true;
        } catch (_) {}
    }

    if (!renderExitoso) {
        // Fallback en alta resolución con margin 15px de zona muda
        contenedor.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=15&data=${encodeURIComponent(window.urlFacturaActiva)}" style="display:block; width:220px; height:220px; margin:0 auto;" alt="QR Factura">`;
    }

    const inputWp = document.getElementById('input-whatsapp-cliente');
    if (inputWp) inputWp.value = telefonoPrevio || '';

    modalQR.style.display = 'flex';
}


window.enviarFacturaWhatsApp = function() {
    const inputWp = document.getElementById('input-whatsapp-cliente');
    const rawTel = inputWp ? inputWp.value.replace(/\D/g, '') : '';
    if (!rawTel || rawTel.length < 7) {
        alert("Digita un número de WhatsApp válido.");
        return;
    }
    const numCompleto = rawTel.length === 10 ? `57${rawTel}` : rawTel;
    const nombreLocal = (document.getElementById('ticket-negocio-nombre')?.innerText || "el comercio").trim();
    const mensaje = `Hola. Adjuntamos tu comprobante de compra en ${nombreLocal}:\n\nComprobante: ${window.urlFacturaActiva}\nID Ticket: ${window.ticketIdFacturaActiva}\n\nValidez del enlace: 24 horas.`;
    window.open(`https://wa.me/${numCompleto}?text=${encodeURIComponent(mensaje)}`, '_blank');
};

window.abrirModalCopiaComprobante = function() {
    const modal = document.getElementById('modal-buscar-copia');
    const input = document.getElementById('input-buscar-ticket-id');
    if (modal) {
        if (input) input.value = ultimoTicketIdVendido || '';
        modal.style.display = 'flex';
        setTimeout(() => input?.focus(), 100);
    }
};

window.generarCopiaComprobante = async function() {
    const input = document.getElementById('input-buscar-ticket-id');
    const tktId = input ? input.value.trim() : '';
    if (!tktId) return alert("Ingresa un ID de ticket válido.");

    document.getElementById('modal-buscar-copia').style.display = 'none';

    let telGuardado = "";
    try {
        const cola = JSON.parse(localStorage.getItem(`geokatu_sync_cola_${idNegocio}`) || "[]");
        const tktLocal = cola.find(t => t.ticketIdLocal === tktId || t.ticketId === tktId);
        if (tktLocal?.cliente?.whatsapp) telGuardado = tktLocal.cliente.whatsapp;
    } catch (_) {}

    await abrirModalFacturaDigitalQR(tktId, telGuardado);
};


document.getElementById('btn-cerrar-qr')?.addEventListener('click', () => {
    document.getElementById('modal-factura-qr').style.display = 'none';
});



