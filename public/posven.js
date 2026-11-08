import GeokatuDB from './core-db.js';
import { MotorBalanza } from './balanza-motor.js';
import { MotorCajonMonedero } from './cajon-motor.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

const auth = getAuth();

// =========================================================================
// 1. ESTADO GLOBAL DE LA TERMINAL POS VENEZUELA
// =========================================================================
let idNegocio = localStorage.getItem('geokatu_active_uid') || null;
let catalogoLocal = [];
let carrito = [];
let ticketsEnEspera = [];
let balanza = null;
let pesoEnVivoActual = 0.000;
let productoEnPesajeManual = null;
let ultimoTicketIdVendido = null;
let turnoCajaActivo = null;
let unsubscribeSemaforoStock = null;

let cajeroCodigoActivo = localStorage.getItem('geokatu_cajero_pin') || "0000";
let cajaNumeroActiva = localStorage.getItem('geokatu_caja_num') || "CAJA-01";
let motorCajon = new MotorCajonMonedero();

// 💱 MOTOR DE TASAS DE CAMBIO FLOTANTES
let tasasVigentes = {
    bcv: 42.50,         // Bs. por USD oficial
    paralelo: 49.80,    // Bs. por USD libre
    cop: 4050,          // COP por USD frontera
    tipo_activo: 'BCV'  // 'BCV' | 'PARALELO'
};

// 💵 BÓVEDAS Y ACUMULADORES MULTICARTERA DEL TURNO
let acumuladoTurnoVen = {
    usd_efectivo: 0,
    ves_efectivo: 0,
    cop_efectivo: 0,
    ves_pago_movil: 0,
    ves_punto_venta: 0,
    usd_zelle: 0,
    usd_usdt: 0,
    igtf_recaudado_usd: 0,
    base_gravable_usd: 0,
    iva_16_usd: 0,
    exento_usd: 0,
    total_usd_consolidado: 0
};

// Memoria de abonos del ticket en curso
let pagosAcumuladosTicket = [];
let monedaAbonoActiva = 'USD'; // 'USD' | 'VES' | 'COP'

// =========================================================================
// 2. INICIALIZACIÓN DE SESIÓN Y VIGILANCIA CRIPTOGRÁFICA
// =========================================================================
GeokatuDB.SecurityService.observarEstadoSesion(async (user) => {
    if (user && user.uid) {
        const idTenant = localStorage.getItem('geokatu_active_uid') || user.uid;
        idNegocio = idTenant;

        await GeokatuDB.SecurityService.sellarSesionTerminalLocal(idTenant);
        cargarTasasDesdeStorage();

        try {
            const { success: sNeg, data: dNeg } = await GeokatuDB.LocalService.getDetails(idTenant);
            if (sNeg && dNeg) {
                const perfilParaTicket = dNeg.perfil_fiscal_ven || {
                    razon_social: dNeg.nombre || "GEOKATU COMERCIO",
                    rif: dNeg.rif || "J-00000000-0",
                    direccion: dNeg.direccion || "San Cristóbal, Táchira",
                    codigo_tienda: dNeg.codigo_tienda || "T-01"
                };
                localStorage.setItem(`geokatu_perfil_ven_${idTenant}`, JSON.stringify(perfilParaTicket));
            }
        } catch (ePerfil) {
            console.warn("[POSVen] Perfil fiscal cargado en contingencia:", ePerfil.message);
        }
// Auditoría de perfil de operario y seguridad de claves provisionales
        const { getFirestore, doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
        const db = getFirestore();
        try {
            let docOperario = await getDoc(doc(db, `Directorio/${idNegocio}/Equipo`, user.uid));
            if (!docOperario.exists()) {
                docOperario = await getDoc(doc(db, `Directorio/${idNegocio}/Colaboradores`, user.uid));
            }

            if (docOperario.exists()) {
                const dataOp = docOperario.data();
                cajeroCodigoActivo = dataOp.codigo_cajero || "0000";
                localStorage.setItem('geokatu_cajero_pin', cajeroCodigoActivo);

                if (dataOp.requiere_cambio_password) {
                    if (dataOp.expiracion_clave_temporal && new Date() > new Date(dataOp.expiracion_clave_temporal)) {
                        alert("⚠️ La contraseña provisional ha expirado (48 horas superadas). Solicita un restablecimiento.");
                        GeokatuDB.SecurityService.destruirSesionTerminalLocal();
                        window.location.href = 'oficina';
                        return;
                    }
                    const modalPass = document.getElementById('modal-cambio-password-obligatorio');
                    if (modalPass) modalPass.style.display = 'flex';
                    return;
                }
            }
        } catch (errPerfil) {
            console.warn("[POSVen] Verificación de operario diferida:", errPerfil.message);
        }

        await inicializarCajaVen();
    } else {
        if (typeof unsubscribeSemaforoStock === 'function') {
            unsubscribeSemaforoStock();
            unsubscribeSemaforoStock = null;
        }
        GeokatuDB.SecurityService.destruirSesionTerminalLocal();
        window.location.href = 'oficina';
    }
});

async function inicializarCajaVen() {
    actualizarIndicadorCola();
    cargarTicketsEnEsperaStorage();
    await verificarEstadoTurnoCaja();

    // Sincronización inmediata al arrancar si hay conexión
    if (navigator.onLine && idNegocio) {
        GeokatuDB.PosService.sincronizarVentasPendientes(idNegocio).then(() => {
            actualizarIndicadorCola();
        }).catch(err => console.warn("[POSVen AutoSync]:", err));
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
    actualizarTickerTasasUI();
    actualizarVisorRemanente();

    if (typeof unsubscribeSemaforoStock === 'function') {
        unsubscribeSemaforoStock();
        unsubscribeSemaforoStock = null;
    }

    unsubscribeSemaforoStock = GeokatuDB.PosService.escucharSemaforoStock(idNegocio, ({ id_prod, stock_actual, precio }) => {
        const prodRAM = catalogoLocal.find(p => p.id_prod === id_prod);
        if (prodRAM) {
            prodRAM.stock_actual = stock_actual;
            if (precio !== null) prodRAM.precio = precio;
            
            const itemCar = carrito.find(c => c.id_prod === id_prod);
            if (itemCar && precio !== null && !itemCar.precio_fijado_balanza) {
                itemCar.precio = precio;
                renderizarCarrito();
            }
        }
    });
}

// =========================================================================
// CONTROL DEL MENÚ DE 3 PUNTOS, RESPALDOS .TXT Y RELEVO DE CAJERO
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

window.descargarRespaldoOfflineTxt = () => {
    window.cerrarMenuOpcionesPOS();
    const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid') || "";
    const claveCola = `geokatu_sync_cola_${tenantReal}`;
    const cola = JSON.parse(localStorage.getItem(claveCola) || "[]");

    if (cola.length === 0) {
        if (typeof window.mostrarAvisoPos === 'function') window.mostrarAvisoPos("No hay tickets pendientes en la cola offline.");
        else alert("No hay tickets pendientes en la cola offline.");
        return;
    }

    const blob = new Blob([JSON.stringify(cola, null, 2)], { type: "text/plain;charset=utf-8" });
    const urlBlob = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = urlBlob;
    a.download = `respaldo_posven_${tenantReal}_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(urlBlob);

    setTimeout(() => {
        if (confirm("Respaldo descargado. ¿Deseas vaciar la memoria de tickets pendientes para liberar espacio en el teléfono?")) {
            localStorage.setItem(claveCola, "[]");
            actualizarIndicadorCola();
            if (typeof window.mostrarAvisoPos === 'function') window.mostrarAvisoPos("Memoria de tickets offline liberada.");
        }
    }, 400);
};

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
            if (!Array.isArray(tickets) || tickets.length === 0) return alert("Formato de tickets inválido.");

            document.getElementById('txt-conexion').innerText = "VERIFICANDO...";
            const res = await GeokatuDB.PosService.analizarYSincronizarRespaldo(idNegocio, tickets);
            alert(`Resultado del análisis de respaldo:\n\nTotal: ${res.total}\nDuplicados: ${res.duplicados}\nSincronizados: ${res.sincronizados}`);
            actualizarIndicadorCola();
        } catch (err) {
            alert("Error al procesar archivo de respaldo.");
        } finally {
            document.getElementById('txt-conexion').innerText = "EN LÍNEA";
            event.target.value = '';
        }
    };
    reader.readAsText(file);
};

window.cerrarSesionCajeroPOS = async () => {
    window.cerrarMenuOpcionesPOS();
    if (carrito.length > 0 && !confirm("Hay artículos en el carrito actual. ¿Seguro que deseas salir sin completar la venta?")) return;

    try {
        await GeokatuDB.SecurityService.cerrarSesion();
        GeokatuDB.SecurityService.destruirSesionTerminalLocal();
        window.location.href = 'oficina';
    } catch (e) {
        alert("Error al cerrar sesión: " + e.message);
    }
};

function cargarTasasDesdeStorage() {
    const raw = localStorage.getItem(`geokatu_tasas_${idNegocio}`);
    if (raw) {
        try {
            tasasVigentes = { ...tasasVigentes, ...JSON.parse(raw) };
        } catch (e) {
            console.warn("[Tasas] Corrupción de tasas locales, restableciendo defaults.");
        }
    }
}

function guardarTasasEnStorage() {
    localStorage.setItem(`geokatu_tasas_${idNegocio}`, JSON.stringify(tasasVigentes));
    actualizarTickerTasasUI();
    renderizarCarrito();
    actualizarVisorRemanente();
}

function obtenerTasaVESActiva() {
    return tasasVigentes.tipo_activo === 'PARALELO' ? Number(tasasVigentes.paralelo) : Number(tasasVigentes.bcv);
}

function convertirUSDaVES(montoUSD) {
    return Number((Number(montoUSD) * obtenerTasaVESActiva()).toFixed(2));
}

function convertirVESaUSD(montoVES) {
    const tasa = obtenerTasaVESActiva();
    return tasa > 0 ? Number((Number(montoVES) / tasa).toFixed(2)) : 0;
}

function convertirUSDaCOP(montoUSD) {
    return Math.round(Number(montoUSD) * Number(tasasVigentes.cop));
}

function convertirCOPaUSD(montoCOP) {
    const tasa = Number(tasasVigentes.cop);
    return tasa > 0 ? Number((Number(montoCOP) / tasa).toFixed(2)) : 0;
}

function actualizarTickerTasasUI() {
    const tagActiva = document.getElementById('tag-tasa-activa');
    const txtVal = document.getElementById('txt-tasa-activa-val');
    const tasaActual = obtenerTasaVESActiva();

    if (tagActiva) tagActiva.innerText = `Tasa ${tasasVigentes.tipo_activo}`;
    if (txtVal) txtVal.innerText = `Bs. ${tasaActual.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    document.getElementById('input-tasa-bcv').value = tasasVigentes.bcv;
    document.getElementById('input-tasa-paralelo').value = tasasVigentes.paralelo;
    document.getElementById('input-tasa-cop').value = tasasVigentes.cop;
    document.getElementById('select-tasa-activa').value = tasasVigentes.tipo_activo;
}

// Listeners modal de tasas
document.getElementById('btn-ajustar-tasa')?.addEventListener('click', () => {
    document.getElementById('modal-tasas-cambio').style.display = 'flex';
});

document.getElementById('btn-cerrar-tasas')?.addEventListener('click', () => {
    document.getElementById('modal-tasas-cambio').style.display = 'none';
});

document.getElementById('btn-guardar-tasas')?.addEventListener('click', () => {
    const bcvVal = parseFloat(document.getElementById('input-tasa-bcv').value);
    const parVal = parseFloat(document.getElementById('input-tasa-paralelo').value);
    const copVal = parseFloat(document.getElementById('input-tasa-cop').value);
    const activaVal = document.getElementById('select-tasa-activa').value;

    if (isNaN(bcvVal) || bcvVal <= 0 || isNaN(parVal) || parVal <= 0 || isNaN(copVal) || copVal <= 0) {
        return alert("Por favor ingresa valores numéricos positivos para todas las tasas.");
    }

    tasasVigentes = {
        bcv: bcvVal,
        paralelo: parVal,
        cop: copVal,
        tipo_activo: activaVal
    };

    guardarTasasEnStorage();
    document.getElementById('modal-tasas-cambio').style.display = 'none';
    window.mostrarAvisoPos("Tasas cambiarias actualizadas correctamente.");
});

// =========================================================================
// 4. SANITIZACIÓN Y MOTOR DE BALANZA / CÓDIGO DE BARRAS
// =========================================================================
function sanitizarCantidadSegura(valor, esPesable = false, maximoPermitido = 9999.999) {
    if (valor === null || valor === undefined) return null;
    const num = Number(valor);
    if (isNaN(num) || !isFinite(num) || num <= 0.0001 || num > maximoPermitido) return null;
    return esPesable ? parseFloat(num.toFixed(3)) : Math.floor(num);
}

function parsearCodigoBalanza(codigo) {
    if (!/^\d{13}$/.test(codigo)) return null;
    const prefijo = codigo.substring(0, 2);
    if (prefijo < "20" || prefijo > "29") return null;

    const plu = codigo.substring(2, 7);
    const valorRaw = parseInt(codigo.substring(7, 12), 10);

    if (prefijo === "20" || prefijo === "21") {
        return { tipo: 'PESO', plu: plu, cantidad: parseFloat((valorRaw / 1000).toFixed(3)) };
    }
    if (prefijo === "22" || prefijo === "23") {
        return { tipo: 'VALOR', plu: plu, montoTotalUSD: parseFloat((valorRaw / 100).toFixed(2)) };
    }
    return null;
}

// Búsqueda en caja
const inputBuscador = document.getElementById('buscador-principal');
inputBuscador?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const entrada = inputBuscador.value.trim();
        if (!entrada) return;

        const matchSoloMultiplicador = entrada.match(/^([0-9]+(?:\.[0-9]{1,3})?)\*$/);
        if (matchSoloMultiplicador) {
            if (carrito.length === 0) {
                alert("El carrito está vacío. Escanea un producto primero.");
                inputBuscador.value = '';
                return;
            }
            const ultimoIdx = carrito.length - 1;
            const cantSanitizada = sanitizarCantidadSegura(matchSoloMultiplicador[1], carrito[ultimoIdx].es_pesable);
            if (cantSanitizada) actualizarCantidadDirecta(ultimoIdx, cantSanitizada);
            inputBuscador.value = '';
            return;
        }

        let multiplicador = 1;
        let termino = entrada;
        if (entrada.includes('*')) {
            const partes = entrada.split('*');
            const factorVal = sanitizarCantidadSegura(partes[0].trim(), true);
            if (factorVal && partes[1].trim().length > 0) {
                multiplicador = factorVal;
                termino = partes.slice(1).join('*').trim();
            }
        }

        procesarEntradaCodigo(termino, multiplicador);
        inputBuscador.value = '';
    }
});

function procesarEntradaCodigo(termino, factorMultiplicador = 1) {
    const terminoLimpio = termino.trim();

    if (terminoLimpio.startsWith("TK-")) {
        window.abrirModalDevolucionParcial(terminoLimpio);
        return;
    }

    const datosBalanza = parsearCodigoBalanza(terminoLimpio);
    if (datosBalanza) {
        const prod = catalogoLocal.find(p => p.codigo_barras === datosBalanza.plu || p.id_prod === datosBalanza.plu || p.plu === datosBalanza.plu);
        if (prod) {
            if (datosBalanza.tipo === 'PESO') {
                agregarAlCarrito(prod, datosBalanza.cantidad, true);
            } else {
                const precioKg = Number(prod.precio) || 1;
                const pesoCalc = parseFloat((datosBalanza.montoTotalUSD / precioKg).toFixed(3));
                agregarAlCarrito(prod, pesoCalc, true, datosBalanza.montoTotalUSD);
            }
            return;
        }
    }

    const producto = catalogoLocal.find(p => p.codigo_barras === terminoLimpio || p.id_prod === terminoLimpio);
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

    const coincidencias = catalogoLocal.filter(p => p.nombre.toLowerCase().includes(terminoLimpio.toLowerCase()));
    if (coincidencias.length === 1) {
        agregarAlCarrito(coincidencias[0], factorMultiplicador);
    } else if (coincidencias.length > 1) {
        alert(`Se encontraron ${coincidencias.length} coincidencias. Usa el código de barras o sé más específico.`);
    } else {
        alert("⚠️ Producto no encontrado en el inventario.");
    }
}

// =========================================================================
// 5. GESTIÓN DEL CARRITO Y ARITMÉTICA TRIBUTARIA (IVA 16% + IGTF 3%)
// =========================================================================
function agregarAlCarrito(producto, cantidad = 1, forzarReemplazo = false, precioForzadoUSD = null) {
    const itemExistente = carrito.find(item => item.id_prod === producto.id_prod);
    const esPesable = Boolean(producto.es_pesable);
    const cantPrevia = itemExistente ? itemExistente.cantidad : 0;
    const nuevaCant = forzarReemplazo ? cantidad : (cantPrevia + cantidad);

    if (itemExistente && !precioForzadoUSD) {
        itemExistente.cantidad = esPesable ? parseFloat(nuevaCant.toFixed(3)) : Math.round(nuevaCant);
    } else {
        carrito.push({
            id_prod: producto.id_prod,
            codigo_barras: producto.codigo_barras || "",
            nombre: producto.nombre,
            precio: precioForzadoUSD !== null ? precioForzadoUSD : (Number(producto.precio) || 0),
            impuesto: String(producto.impuesto || "16"), // 16% general en Venezuela
            es_pesable: esPesable,
            unidad_medida: producto.unidad_medida || (esPesable ? "kg" : "und"),
            cantidad: esPesable ? parseFloat(nuevaCant.toFixed(3)) : Math.round(nuevaCant),
            precio_fijado_balanza: precioForzadoUSD !== null
        });
    }

    if (navigator.vibrate) navigator.vibrate(50);
    renderizarCarrito();
}

function modificarCantidad(index, delta) {
    const item = carrito[index];
    const paso = item.es_pesable ? 0.100 : 1;
    const nueva = item.cantidad + (delta * paso);
    item.cantidad = item.es_pesable ? parseFloat(nueva.toFixed(3)) : Math.round(nueva);

    if (item.cantidad <= 0.0001) {
        carrito.splice(index, 1);
    }
    renderizarCarrito();
}

function actualizarCantidadDirecta(index, valorStr) {
    const item = carrito[index];
    if (!item) return;
    const validada = sanitizarCantidadSegura(valorStr, item.es_pesable);
    if (!validada) return renderizarCarrito();
    item.cantidad = validada;
    renderizarCarrito();
}

function eliminarItem(index) {
    carrito.splice(index, 1);
    renderizarCarrito();
}

function calcularTotalesCarrito() {
    let subtotalUSD = 0;
    let baseGravableUSD = 0;
    let iva16USD = 0;
    let exentoUSD = 0;

    carrito.forEach(item => {
        const subLinea = item.precio_fijado_balanza 
            ? Number(item.precio) 
            : Number((Number(item.precio) * item.cantidad).toFixed(2));
        subtotalUSD += subLinea;

        if (String(item.impuesto) === "16") {
            const baseLinea = Number((subLinea / 1.16).toFixed(2));
            baseGravableUSD += baseLinea;
            iva16USD += Number((subLinea - baseLinea).toFixed(2));
        } else {
            exentoUSD += subLinea;
        }
    });

    // 🛡️ REGLA IGTF 3%: Aplica exclusivamente a la porción liquidada en divisas o cripto
    let pagosEnDivisaUSD = 0;
    pagosAcumuladosTicket.forEach(p => {
        if (['EFECTIVO_USD', 'ZELLE', 'BINANCE_PAY'].includes(p.metodo)) {
            pagosEnDivisaUSD += p.monto_usd_equivalente;
        }
    });

    const igtfCalculadoUSD = Number((pagosEnDivisaUSD * 0.03).toFixed(2));
    const totalPagarUSD = Number((subtotalUSD + igtfCalculadoUSD).toFixed(2));

    return {
        subtotalUSD: Number(subtotalUSD.toFixed(2)),
        baseGravableUSD: Number(baseGravableUSD.toFixed(2)),
        iva16USD: Number(iva16USD.toFixed(2)),
        exentoUSD: Number(exentoUSD.toFixed(2)),
        igtfCalculadoUSD,
        totalPagarUSD
    };
}

function renderizarCarrito() {
    const contenedor = document.getElementById('current-sale');
    if (!contenedor) return;
    contenedor.innerHTML = '';

    const badge = document.getElementById('cant-items-badge');
    if (badge) badge.innerText = `${carrito.length} ${carrito.length === 1 ? 'línea' : 'líneas'}`;

    if (carrito.length === 0) {
        contenedor.innerHTML = '<p style="text-align: center; color: #555; margin-top: 50px; font-size: 13px;">El carrito está vacío.<br>Escanea un producto para comenzar.</p>';
        document.getElementById('txt-base-usd').innerText = '$0.00';
        document.getElementById('txt-iva-usd').innerText = '$0.00';
        document.getElementById('txt-igtf-usd').innerText = '$0.00';
        document.getElementById('txt-exento-usd').innerText = '$0.00';
        document.getElementById('txt-total-ves').innerText = 'Bs. 0,00';
        document.getElementById('txt-total-cop').innerText = '$0 COP';
        document.getElementById('txt-total').innerText = '$0.00';
        actualizarVisorRemanente();
        return;
    }

    carrito.forEach((item, idx) => {
        const subtotalLinea = item.precio_fijado_balanza 
            ? Number(item.precio) 
            : Number((Number(item.precio) * item.cantidad).toFixed(2));
        const subtotalVES = convertirUSDaVES(subtotalLinea);

        const card = document.createElement('div');
        card.className = 'cart-card';
        card.innerHTML = `
            <div class="cart-card-info">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <h4>${item.nombre}</h4>
                    <button type="button" onclick="window.agregarNotaItem(${idx})" title="Añadir nota" style="background:none; border:none; color:#888; cursor:pointer; font-size:11px;">✏️ Nota</button>
                </div>
                <p>$${Number(item.precio).toFixed(2)} / ${item.unidad_medida} <span style="color:#60a5fa;">(~Bs. ${convertirUSDaVES(item.precio).toFixed(2)})</span></p>
                ${item.nota ? `<div class="cart-item-nota">📝 ${item.nota}</div>` : ''}
            </div>
            <div class="cart-controls">
                <button class="qty-btn btn-menos" data-idx="${idx}">-</button>
                <input type="number" class="qty-input-direct" data-idx="idx"step="{item.es_pesable ? '0.001' : '1'}" min="item.espesable?'0.001':'1'"value="{item.cantidad}">
                <button class="qty-btn btn-mas" data-idx="${idx}">+</button>
            </div>
            <div class="cart-card-subtotal" style="text-align: right;">
                <div>$${subtotalLinea.toFixed(2)}</div>
                <div style="font-size: 10px; color: #60a5fa; font-weight: normal;">Bs. ${subtotalVES.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</div>
            </div>
            <button class="btn-remove-item" data-idx="${idx}">
                <svg class="icono-pos" style="font-size: 18px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>
            </button>
        `;
        contenedor.appendChild(card);
    });

    contenedor.querySelectorAll('.btn-menos').forEach(b => b.onclick = () => modificarCantidad(Number(b.dataset.idx), -1));
    contenedor.querySelectorAll('.btn-mas').forEach(b => b.onclick = () => modificarCantidad(Number(b.dataset.idx), 1));
    contenedor.querySelectorAll('.btn-remove-item').forEach(b => b.onclick = () => eliminarItem(Number(b.dataset.idx)));
    contenedor.querySelectorAll('.qty-input-direct').forEach(inp => {
        inp.onchange = (e) => actualizarCantidadDirecta(Number(inp.dataset.idx), e.target.value);
        inp.onfocus = () => inp.select();
    });

    const tot = calcularTotalesCarrito();
    document.getElementById('txt-base-usd').innerText = `$${tot.baseGravableUSD.toFixed(2)}`;
    document.getElementById('txt-iva-usd').innerText = `$${tot.iva16USD.toFixed(2)}`;
    document.getElementById('txt-igtf-usd').innerText = `$${tot.igtfCalculadoUSD.toFixed(2)}`;
    document.getElementById('txt-exento-usd').innerText = `$${tot.exentoUSD.toFixed(2)}`;
    document.getElementById('txt-total-ves').innerText = `Bs. ${convertirUSDaVES(tot.totalPagarUSD).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
    document.getElementById('txt-total-cop').innerText = `$${convertirUSDaCOP(tot.totalPagarUSD).toLocaleString('es-CO')} COP`;
    document.getElementById('txt-total').innerText = `$${tot.totalPagarUSD.toFixed(2)}`;

    actualizarVisorRemanente();
}

// Abrir modal de catálogo en lista vertical
document.getElementById('btn-abrir-catalogo-modal')?.addEventListener('click', () => {
    const modalCat = document.getElementById('modal-catalogo-popup');
    if (modalCat) modalCat.style.display = 'flex';
});

// Abrir modal de catálogo en lista vertical
document.getElementById('btn-abrir-catalogo-modal')?.addEventListener('click', () => {
    const modalCat = document.getElementById('modal-catalogo-popup');
    if (modalCat) modalCat.style.display = 'flex';
});

function renderizarGridCatalogo() {
    const grid = document.getElementById('grid-rapida');
    if (!grid) return;
    grid.innerHTML = '';

    if (catalogoLocal.length === 0) {
        grid.innerHTML = '<p style="text-align: center; color: #666; padding: 20px 0; font-size: 12px;">No hay productos registrados en el inventario.</p>';
        return;
    }

  catalogoLocal.slice(0, 150).forEach(prod => {
        const item = document.createElement('div');
        item.className = 'product-row-item';
        item.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <svg class="icono-pos" style="color: var(--color-marca); font-size: 18px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m3 7 9-5 9 5v11l-9 4-9-4V7zm0 0 9 5 9-5M12 12v10"/></svg>
                <span class="item-title">${prod.nombre}</span>
            </div>
            <div style="text-align: right;">
                <span class="item-price">$Number(prod.precio).toFixed(2){prod.es_pesable ? '/kg' : ''}</span>
                <span style="display: block; font-size: 10px; color: #60a5fa; font-family: monospace;">Bs. ${convertirUSDaVES(prod.precio).toFixed(2)}</span>
            </div>
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



// =========================================================================
// 6. VISOR DE SALDOS, ABONOS Y DENOMINACIONES RÁPIDAS
// =========================================================================
function calcularTotalPagadoHastaAhoraUSD() {
    return Number(pagosAcumuladosTicket.reduce((acc, p) => acc + p.monto_usd_equivalente, 0).toFixed(2));
}

function actualizarVisorRemanente() {
    const { totalPagarUSD } = calcularTotalesCarrito();
    const pagadoUSD = calcularTotalPagadoHastaAhoraUSD();
    const remanenteUSD = Math.max(0, Number((totalPagarUSD - pagadoUSD).toFixed(2)));

    const txtRem = document.getElementById('txt-remanente');
    const txtRemVES = document.getElementById('txt-remanente-ves-badge');
    const lblEstado = document.getElementById('lbl-estado-saldo');
    const inputAbono = document.getElementById('input-monto-abono');
    const contenedorAbonos = document.getElementById('lista-abonos-ticket');

    if (txtRem) txtRem.innerText = `$${remanenteUSD.toFixed(2)}`;
    if (txtRemVES) txtRemVES.innerText = `(Bs. ${convertirUSDaVES(remanenteUSD).toLocaleString('es-VE', { minimumFractionDigits: 2 })})`;
    
    if (lblEstado) {
        lblEstado.innerText = remanenteUSD === 0 && pagadoUSD > 0 ? "Completado" : "Por Cobrar ($)";
        lblEstado.style.color = remanenteUSD === 0 && pagadoUSD > 0 ? "var(--accent-green)" : "#ffaa00";
    }

    if (contenedorAbonos) {
        contenedorAbonos.innerHTML = pagosAcumuladosTicket.map(p => 
            `<span style="background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px;">
                ${p.metodo}: ${p.moneda_original === 'USD' ? `$p.montooriginal.toFixed(2)`:(p.monedaoriginal==='VES'?`Bs.p.montooriginal.toLocaleString('es-VE')`:`{p.monto_original.toLocaleString('es-CO')} COP`)}
                <span style="opacity: 0.7;">(eq. $${p.monto_usd_equivalente.toFixed(2)})</span>
            </span>`
        ).join('');
    }

    if (inputAbono && document.activeElement !== inputAbono) {
        if (remanenteUSD > 0) {
            if (monedaAbonoActiva === 'USD') inputAbono.value = remanenteUSD;
            else if (monedaAbonoActiva === 'VES') inputAbono.value = convertirUSDaVES(remanenteUSD);
            else if (monedaAbonoActiva === 'COP') inputAbono.value = convertirUSDaCOP(remanenteUSD);
        } else {
            inputAbono.value = '';
        }
    }

    renderizarBilletesInteligentes(remanenteUSD);
}

// Selector de moneda activa para abonos
document.querySelectorAll('.btn-moneda-abono').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.btn-moneda-abono').forEach(b => {
            b.classList.remove('activa');
            b.style.background = 'rgba(255,255,255,0.08)';
            b.style.color = '#fff';
        });
        btn.classList.add('activa');
        btn.style.background = 'var(--color-marca)';
        btn.style.color = '#000';

        monedaAbonoActiva = btn.dataset.moneda;
        actualizarVisorRemanente();
    });
});

function renderizarBilletesInteligentes(remanenteUSD) {
    const contenedor = document.getElementById('contenedor-billetes-rapidos');
    if (!contenedor) return;

    if (remanenteUSD <= 0) {
        contenedor.innerHTML = '';
        return;
    }

    let denominaciones = [];
    if (monedaAbonoActiva === 'USD') {
        denominaciones = [1, 5, 10, 20, 50, 100];
    } else if (monedaAbonoActiva === 'VES') {
        denominaciones = [50, 100, 200, 500, 1000];
    } else {
        denominaciones = [10000, 20000, 50000, 100000];
    }

    let montoExacto = remanenteUSD;
    if (monedaAbonoActiva === 'VES') montoExacto = convertirUSDaVES(remanenteUSD);
    if (monedaAbonoActiva === 'COP') montoExacto = convertirUSDaCOP(remanenteUSD);

    let html = `
        <button type="button" class="btn-quick-cash exacto" data-monto="${montoExacto}">
            <strong>Exacto</strong>
            <span style="font-size: 9px; opacity: 0.8;">0</span>
        </button>
    `;

    denominaciones.forEach(billete => {
        html += `
            <button type="button" class="btn-quick-cash" data-monto="${billete}">
                <strong>${monedaAbonoActiva === 'USD' ? `$${billete}` : billete.toLocaleString()}</strong>
                <span style="font-size: 8px; opacity: 0.8;">${monedaAbonoActiva}</span>
            </button>
        `;
    });

    contenedor.innerHTML = html;
    contenedor.querySelectorAll('.btn-quick-cash').forEach(btn => {
        btn.onclick = () => {
            const inp = document.getElementById('input-monto-abono');
            if (inp) {
                inp.value = btn.dataset.monto;
                inp.dispatchEvent(new Event('input'));
            }
        };
    });
}

// =========================================================================
// 7. PASARELA DE COBRO MULTIMONEDA (SPLIT PAYMENTS VENEZUELA)
// =========================================================================
document.querySelectorAll('.btn-pay').forEach(btn => {
    btn.addEventListener('click', () => {
        const metodo = btn.dataset.pago;
        procesarIntentoPago(metodo);
    });
});

function procesarIntentoPago(metodo) {
    if (carrito.length === 0) return alert("El carrito está vacío.");

    const { totalPagarUSD } = calcularTotalesCarrito();
    const pagadoUSD = calcularTotalPagadoHastaAhoraUSD();
    const remanenteUSD = Math.max(0, Number((totalPagarUSD - pagadoUSD).toFixed(2)));

    if (remanenteUSD <= 0) {
        return alert("El ticket ya se encuentra cubierto.");
    }

    const inputVal = parseFloat(document.getElementById('input-monto-abono').value);
    let valorDigitado = (!isNaN(inputVal) && inputVal > 0) ? inputVal : null;

    // --- COBRO POR PAGO MÓVIL (VES) ---
    if (metodo === 'PAGO_MOVIL') {
        const montoVES = valorDigitado && monedaAbonoActiva === 'VES' 
            ? valorDigitado 
            : convertirUSDaVES(remanenteUSD);
        const montoUSDEquiv = convertirVESaUSD(montoVES);

        document.getElementById('pm-monto-ves').innerText = `Bs. ${montoVES.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
        document.getElementById('pm-monto-usd-equiv').innerText = `($${montoUSDEquiv.toFixed(2)} USD)`;
        document.getElementById('pm-referencia').value = '';
        document.getElementById('modal-pagomovil').style.display = 'flex';
        document.getElementById('pm-referencia').focus();
        return;
    }

    // --- COBRO POR PUNTO DE VENTA DÉBITO (VES) ---
    if (metodo === 'PUNTO_VENTA') {
        const montoVES = valorDigitado && monedaAbonoActiva === 'VES' 
            ? valorDigitado 
            : convertirUSDaVES(remanenteUSD);
        const montoUSDEquiv = convertirVESaUSD(montoVES);

        document.getElementById('pos-monto-ves').innerText = `Bs. ${montoVES.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
        document.getElementById('pos-monto-usd-equiv').innerText = `($${montoUSDEquiv.toFixed(2)} USD)`;
        document.getElementById('pos-voucher').value = '';
        document.getElementById('modal-puntoventa').style.display = 'flex';
        document.getElementById('pos-voucher').focus();
        return;
    }

    // --- COBRO POR ZELLE (USD) ---
    if (metodo === 'ZELLE') {
        const montoUSD = valorDigitado && monedaAbonoActiva === 'USD' ? valorDigitado : remanenteUSD;
        document.getElementById('zelle-monto-usd').innerText = `$${montoUSD.toFixed(2)}`;
        document.getElementById('zelle-titular').value = '';
        document.getElementById('zelle-referencia').value = '';
        document.getElementById('modal-zelle').style.display = 'flex';
        document.getElementById('zelle-titular').focus();
        return;
    }

    // --- COBRO EN EFECTIVO DÓLARES (USD) ---
    if (metodo === 'EFECTIVO_USD') {
        const entregadoUSD = valorDigitado && monedaAbonoActiva === 'USD' ? valorDigitado : remanenteUSD;

        motorCajon.dispararAperturaDirecta(0).catch(() => {});

        if (entregadoUSD > remanenteUSD) {
            const vueltoUSD = Number((entregadoUSD - remanenteUSD).toFixed(2));
            aplicarAbonoConfirmado('EFECTIVO_USD', 'USD', remanenteUSD, remanenteUSD);
            abrirModalVueltoMultimoneda(vueltoUSD);
        } else {
            aplicarAbonoConfirmado('EFECTIVO_USD', 'USD', entregadoUSD, entregadoUSD);
        }
        return;
    }

    // --- COBRO EN EFECTIVO BOLÍVARES (VES) ---
    if (metodo === 'EFECTIVO_VES') {
        const entregadoVES = valorDigitado && monedaAbonoActiva === 'VES' 
            ? valorDigitado 
            : convertirUSDaVES(remanenteUSD);
        const equivUSD = convertirVESaUSD(entregadoVES);

        motorCajon.dispararAperturaDirecta(0).catch(() => {});
        aplicarAbonoConfirmado('EFECTIVO_VES', 'VES', entregadoVES, Math.min(equivUSD, remanenteUSD));
        return;
    }

    // --- COBRO EN PESOS FRONTERIZOS (COP) ---
    if (metodo === 'PESOS_COP') {
        const entregadoCOP = valorDigitado && monedaAbonoActiva === 'COP' 
            ? valorDigitado 
            : convertirUSDaCOP(remanenteUSD);
        const equivUSD = convertirCOPaUSD(entregadoCOP);

        motorCajon.dispararAperturaDirecta(0).catch(() => {});
        aplicarAbonoConfirmado('PESOS_COP', 'COP', entregadoCOP, Math.min(equivUSD, remanenteUSD));
        return;
    }

    // --- COBRO CRIPTO BINANCE PAY (USDT) ---
    if (metodo === 'BINANCE_PAY') {
        const montoUSD = valorDigitado && monedaAbonoActiva === 'USD' ? valorDigitado : remanenteUSD;
        const refTx = prompt(`Ingresa el Pay ID o TXID de Binance Pay por ${montoUSD.toFixed(2)} USDT:`);
        if (refTx) {
            aplicarAbonoConfirmado('BINANCE_PAY', 'USD', montoUSD, montoUSD, refTx);
        }
    }
}

// Confirmaciones modales de pago
document.getElementById('btn-confirmar-pm')?.addEventListener('click', () => {
    const banco = document.getElementById('pm-banco-origen').value;
    const telf = document.getElementById('pm-telefono').value.trim();
    const ref = document.getElementById('pm-referencia').value.trim();
    if (!ref) return alert("Por favor digita al menos los últimos dígitos de la referencia.");

    const montoVES = Number(document.getElementById('pm-monto-ves').innerText.replace(/[^\d,]/g, '').replace(',', '.'));
    const equivUSD = convertirVESaUSD(montoVES);

    document.getElementById('modal-pagomovil').style.display = 'none';
    aplicarAbonoConfirmado('PAGO_MOVIL', 'VES', montoVES, equivUSD, `banco-{ref} (${telf})`);
});

document.getElementById('btn-confirmar-pos')?.addEventListener('click', () => {
    const lote = document.getElementById('pos-lote').value.trim() || "001";
    const voucher = document.getElementById('pos-voucher').value.trim();
    if (!voucher) return alert("Digita el número de aprobación del voucher.");

    const montoVES = Number(document.getElementById('pos-monto-ves').innerText.replace(/[^\d,]/g, '').replace(',', '.'));
    const equivUSD = convertirVESaUSD(montoVES);

    document.getElementById('modal-puntoventa').style.display = 'none';
    aplicarAbonoConfirmado('PUNTO_VENTA', 'VES', montoVES, equivUSD, `L:lote-A:{voucher}`);
});

document.getElementById('btn-confirmar-zelle')?.addEventListener('click', () => {
    const titular = document.getElementById('zelle-titular').value.trim();
    const memo = document.getElementById('zelle-referencia').value.trim();
    if (!titular) return alert("Ingresa el nombre del titular emisor.");

    const montoUSD = parseFloat(document.getElementById('zelle-monto-usd').innerText.replace(/[^\d.]/g, ''));
    document.getElementById('modal-zelle').style.display = 'none';
    aplicarAbonoConfirmado('ZELLE', 'USD', montoUSD, montoUSD, `${titular} - ${memo}`);
});

document.getElementById('btn-cancelar-pm')?.addEventListener('click', () => document.getElementById('modal-pagomovil').style.display = 'none');
document.getElementById('btn-cancelar-pos')?.addEventListener('click', () => document.getElementById('modal-puntoventa').style.display = 'none');
document.getElementById('btn-cancelar-zelle')?.addEventListener('click', () => document.getElementById('modal-zelle').style.display = 'none');

function aplicarAbonoConfirmado(metodo, monedaOriginal, montoOriginal, montoUSDEquivalente, referencia = null) {
    pagosAcumuladosTicket.push({
        metodo,
        moneda_original: monedaOriginal,
        monto_original: montoOriginal,
        monto_usd_equivalente: Number(montoUSDEquivalente.toFixed(2)),
        referencia
    });

    renderizarCarrito(); // Recalcula IGTF si se sumaron abonos en USD
    actualizarVisorRemanente();

    const { totalPagarUSD } = calcularTotalesCarrito();
    const pagadoUSD = calcularTotalPagadoHastaAhoraUSD();

    if (pagadoUSD >= totalPagarUSD) {
        ejecutarVentaFinalDefinitivaVen();
    } else {
        const falta = Number((totalPagarUSD - pagadoUSD).toFixed(2));
        window.mostrarAvisoPos(`Abono recibido. Restan $${falta.toFixed(2)} (~Bs. ${convertirUSDaVES(falta).toFixed(2)})`);
    }
}

// =========================================================================
// 8. RESOLUCIÓN DE VUELTOS MULTIDIVISA (THE CHANGE PROBLEM)
// =========================================================================
function abrirModalVueltoMultimoneda(vueltoUSD) {
    const modal = document.getElementById('modal-vuelto-ven');
    if (!modal) return;

    document.getElementById('vuelto-total-usd').innerText = `$${vueltoUSD.toFixed(2)} USD`;
    document.getElementById('vuelto-equiv-ves').innerText = `Bs. ${convertirUSDaVES(vueltoUSD).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
    document.getElementById('vuelto-equiv-cop').innerText = `$${convertirUSDaCOP(vueltoUSD).toLocaleString('es-CO')} COP`;

    window.vueltoActivoDatos = {
        montoUSD: vueltoUSD,
        montoVES: convertirUSDaVES(vueltoUSD),
        montoCOP: convertirUSDaCOP(vueltoUSD)
    };

    modal.style.display = 'flex';
}

document.getElementById('btn-vuelto-pm')?.addEventListener('click', () => {
    const datos = window.vueltoActivoDatos;
    const telf = prompt("Ingresa el número de teléfono o datos Pago Móvil para transferir el vuelto:", "");
    if (telf) {
        alert(`Vuelto de Bs. ${datos.montoVES.toFixed(2)} procesado por Pago Móvil a ${telf}.`);
        document.getElementById('modal-vuelto-ven').style.display = 'none';
    }
});

document.getElementById('btn-vuelto-cop')?.addEventListener('click', () => {
    alert(`Entregar $${window.vueltoActivoDatos.montoCOP.toLocaleString('es-CO')} COP en efectivo de gaveta.`);
    document.getElementById('modal-vuelto-ven').style.display = 'none';
});

document.getElementById('btn-vuelto-usd-fisico')?.addEventListener('click', () => {
    alert(`Entregar $${window.vueltoActivoDatos.montoUSD.toFixed(2)} en billetes o monedas de dólar.`);
    document.getElementById('modal-vuelto-ven').style.display = 'none';
});

document.getElementById('btn-vuelto-saldo-favor')?.addEventListener('click', () => {
    alert(`Vale emitido por $${window.vueltoActivoDatos.montoUSD.toFixed(2)} USD para la próxima compra del cliente.`);
    document.getElementById('modal-vuelto-ven').style.display = 'none';
});

document.getElementById('btn-cerrar-vuelto')?.addEventListener('click', () => {
    document.getElementById('modal-vuelto-ven').style.display = 'none';
});

// =========================================================================
// 9. EJECUCIÓN DE VENTA DEFINITIVA Y TIRILLA 58mm VENEZUELA
// =========================================================================
let ventaEnProceso = false;
async function ejecutarVentaFinalDefinitivaVen() {
    if (ventaEnProceso) return;
    ventaEnProceso = true;
    try { return await ejecutarVentaFinalDefinitivaVenInterna(); }
    catch (error) { alert('No se pudo completar la operación: ' + error.message); }
    finally { ventaEnProceso = false; }
}

async function ejecutarVentaFinalDefinitivaVenInterna() {
    if (!turnoCajaActivo || turnoCajaActivo.estado !== 'ABIERTA') {
        alert("⚠️ La caja se encuentra cerrada. Abre turno antes de facturar.");
        abrirModalAperturaCaja();
        return;
    }

    const totales = calcularTotalesCarrito();
    const productosAuditados = carrito.map(item => {
        const sub = item.precio_fijado_balanza ? Number(item.precio) : Number((Number(item.precio) * item.cantidad).toFixed(2));
        return {
            id_prod: item.id_prod,
            codigo_barras: item.codigo_barras || "",
            nombre: item.nombre,
            precio: Number(item.precio), // Mandatorio para la validación en core-db.js
            precio_usd: Number(item.precio),
            precio_fijado_balanza: Boolean(item.precio_fijado_balanza),
            cantidad: item.cantidad,
            subtotal: sub, // Mandatorio para la validación en core-db.js
            subtotal_usd: sub,
            impuesto: item.impuesto,
            es_pesable: item.es_pesable,
            unidad_medida: item.unidad_medida,
            nota: item.nota || ""
        };
    });


    const switchRif = document.getElementById('switch-rif-cliente');
    const datosCliente = {
        rif: switchRif && switchRif.checked 
            ? `document.getElementById('rif-tipo-doc').value-{document.getElementById('rif-numero').value.trim()}`
            : "V-00000000",
        nombre: switchRif && switchRif.checked 
            ? (document.getElementById('rif-nombre').value.trim() || "Consumidor Final") 
            : "Consumidor Final",
        telefono: switchRif && switchRif.checked 
            ? document.getElementById('rif-telefono').value.trim() 
            : ""
    };

   const ticketPayload = {
        id_sesion: turnoCajaActivo.id_sesion,
        total: totales.totalPagarUSD, // Exigido por regla Firestore
        metodo_pago: pagosAcumuladosTicket.length === 1 ? pagosAcumuladosTicket[0].metodo : "MIXTO", // Exigido por regla Firestore
        caja_numero: cajaNumeroActiva,
        codigo_cajero: cajeroCodigoActivo,
        cajero_email: auth.currentUser ? auth.currentUser.email : "CAJERO",
        tasa_aplicada: obtenerTasaVESActiva(),
        tipo_tasa: tasasVigentes.tipo_activo,
        tasa_cop: tasasVigentes.cop,
        productos: productosAuditados,
        subtotal_usd: totales.subtotalUSD,
        base_gravable_usd: totales.baseGravableUSD,
        iva_16_usd: totales.iva16USD,
        igtf_usd: totales.igtfCalculadoUSD,
        exento_usd: totales.exentoUSD,
        total_usd: totales.totalPagarUSD,
        total_ves: convertirUSDaVES(totales.totalPagarUSD),
        total_cop: convertirUSDaCOP(totales.totalPagarUSD),
        metodos_pago_split: [...pagosAcumuladosTicket],
        cliente: datosCliente,
        pais_operacion: "VEN"
    };
;

    document.getElementById('txt-conexion').innerText = "REGISTRANDO...";
    const res = await GeokatuDB.PosService.procesarVentaLote(idNegocio, ticketPayload);

   if (res.success) {
        ultimoTicketIdVendido = res.ticketId || res.localId;

        if (typeof window.mostrarAvisoPos === 'function') {
            window.mostrarAvisoPos(`Venta asentada con éxito. Ticket: ${ultimoTicketIdVendido}`);
        }

        // Acumular ventas en bóvedas del turno

        pagosAcumuladosTicket.forEach(p => {
            if (p.metodo === 'EFECTIVO_USD') acumuladoTurnoVen.usd_efectivo += p.monto_original;
            else if (p.metodo === 'EFECTIVO_VES') acumuladoTurnoVen.ves_efectivo += p.monto_original;
            else if (p.metodo === 'PESOS_COP') acumuladoTurnoVen.cop_efectivo += p.monto_original;
            else if (p.metodo === 'PAGO_MOVIL') acumuladoTurnoVen.ves_pago_movil += p.monto_original;
            else if (p.metodo === 'PUNTO_VENTA') acumuladoTurnoVen.ves_punto_venta += p.monto_original;
            else if (p.metodo === 'ZELLE') acumuladoTurnoVen.usd_zelle += p.monto_original;
            else if (p.metodo === 'BINANCE_PAY') acumuladoTurnoVen.usd_usdt += p.monto_original;
        });

        acumuladoTurnoVen.igtf_recaudado_usd += totales.igtfCalculadoUSD;
        acumuladoTurnoVen.base_gravable_usd += totales.baseGravableUSD;
        acumuladoTurnoVen.iva_16_usd += totales.iva16USD;
        acumuladoTurnoVen.exento_usd += totales.exentoUSD;
        acumuladoTurnoVen.total_usd_consolidado += totales.totalPagarUSD;

        localStorage.setItem(`geokatu_acumulado_ven_${idNegocio}`, JSON.stringify(acumuladoTurnoVen));

        // Actualizar KPIs de la barra inferior
        const kpiUSD = document.getElementById('kpi-ventas-usd');
        const kpiVES = document.getElementById('kpi-ventas-ves');
        if (kpiUSD) kpiUSD.innerText = `$${acumuladoTurnoVen.total_usd_consolidado.toFixed(2)}`;
        if (kpiVES) kpiVES.innerText = `(Bs. ${convertirUSDaVES(acumuladoTurnoVen.total_usd_consolidado).toFixed(0)})`;

        armarTirillaTermicaVen(ticketPayload, ultimoTicketIdVendido);

        // Limpiar estado para el siguiente cliente
        carrito = [];
        pagosAcumuladosTicket = [];
        catalogoLocal = GeokatuDB.PosService.cargarCatalogoDesdeCache(idNegocio);
        renderizarCarrito();
        actualizarVisorRemanente();
        renderizarGridCatalogo();
        actualizarIndicadorCola();

        const txtVueltas = document.getElementById('txt-cambio-vueltas');
        if (txtVueltas) txtVueltas.style.display = 'none';

        if (switchRif) {
            switchRif.checked = false;
            document.getElementById('formulario-rif').style.display = 'none';
        }

        // Impresión o Comprobante Digital
        if (window.deseaFacturaEcologicaQR) {
            window.deseaFacturaEcologicaQR = false;
            await abrirModalFacturaDigitalQR(ultimoTicketIdVendido);
        } else {
            motorCajon.dispararAperturaDirecta(0, true).catch(() => {});
            setTimeout(() => window.print(), 300);
        }
    } else {
        alert("Error al registrar venta: " + res.error);
    }

    document.getElementById('txt-conexion').innerText = "EN LÍNEA";
}

function armarTirillaTermicaVen(ticket, ticketId) {
    const perfil = JSON.parse(localStorage.getItem(`geokatu_perfil_ven_${idNegocio}`) || "{}");
    
    document.getElementById('ticket-negocio-nombre').innerText = perfil.razon_social || "GEOKATU COMERCIO";
    document.getElementById('ticket-negocio-rif').innerText = `RIF: ${perfil.rif || 'J-00000000-0'}`;
    document.getElementById('ticket-negocio-dir').innerText = perfil.direccion || "San Cristóbal, Táchira";

    const ahora = new Date();
    document.getElementById('t-caja-cod').innerText = cajaNumeroActiva;
    document.getElementById('t-fecha-corta').innerText = ahora.toLocaleDateString('es-VE');
    document.getElementById('t-hora-corta').innerText = ahora.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('t-cajero-cod').innerText = `OP #${cajeroCodigoActivo}`;

    document.getElementById('t-id').innerText = ticketId;
    document.getElementById('t-cliente').innerText = ticket.cliente?.nombre || "Consumidor Final";
    document.getElementById('t-rif').innerText = ticket.cliente?.rif || "V-00000000";

    const tbody = document.getElementById('t-items');
    tbody.innerHTML = '';
    ticket.productos.forEach(p => {
        tbody.innerHTML += `
            <tr>
                <td>${p.es_pesable ? `${p.cantidad}p.unidadmedida`:`{p.cantidad}x`} ${p.nombre}</td>
                <td style="text-align: right;">$${p.subtotal_usd.toFixed(2)}</td>
            </tr>
        `;
    });

    document.getElementById('t-base-print').innerText = `$${ticket.base_gravable_usd.toFixed(2)}`;
    document.getElementById('t-iva-print').innerText = `$${ticket.iva_16_usd.toFixed(2)}`;
    document.getElementById('t-igtf-print').innerText = `$${ticket.igtf_usd.toFixed(2)}`;
    document.getElementById('t-exento-print').innerText = `$${ticket.exento_usd.toFixed(2)}`;

    document.getElementById('t-total').innerText = `$${ticket.total_usd.toFixed(2)}`;
    document.getElementById('t-total-ves-print').innerText = `Bs. ${ticket.total_ves.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
    document.getElementById('t-tasa-print').innerText = `Bs. ${ticket.tasa_aplicada.toFixed(2)} / $ (${ticket.tipo_tasa})`;

    const txtPagos = ticket.metodos_pago_split.map(p => 
        `${p.metodo}: ${p.moneda_original === 'USD' ? `$p.montooriginal.toFixed(2)`:(p.monedaoriginal==='VES'?`Bs.p.montooriginal.toLocaleString('es-VE')`:`{p.monto_original.toLocaleString('es-CO')} COP`)}`
    ).join(' | ');
    document.getElementById('t-metodos-desglose').innerText = txtPagos;

    document.getElementById('t-barcode-text').innerText = ticketId;
    generarCode128SVG(ticketId, 't-barcode-svg');
}

function generarCode128SVG(texto, svgId) {
    const svg = document.getElementById(svgId);
    if (!svg || !texto) return;

    const patrones = [
        "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
        "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
        "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211"
    ];
    let x = 0, rects = "";
    for (let i = 0; i < texto.length; i++) {
        const ancho = (texto.charCodeAt(i) % 3) + 1;
        rects += `<rect x="x*2"y="0"width="{ancho * 2}" height="38" fill="#000"/>`;
        x += ancho + 1;
    }
    svg.setAttribute("viewBox", `0 0 ${x * 2} 38`);
    svg.innerHTML = rects;
}

// Switch RIF reactivo
const switchRif = document.getElementById('switch-rif-cliente');
switchRif?.addEventListener('change', () => {
    const formRif = document.getElementById('formulario-rif');
    const txtEstado = document.getElementById('txt-estado-rif');
    if (switchRif.checked) {
        formRif.style.display = 'flex';
        txtEstado.innerText = 'Personalizado';
        txtEstado.style.color = 'var(--color-marca)';
        document.getElementById('rif-numero').focus();
    } else {
        formRif.style.display = 'none';
        txtEstado.innerText = 'Consumidor Final';
        txtEstado.style.color = 'var(--text-muted)';
    }
});

// =========================================================================
// 10. ARQUEO MULTICARTERA, INFORME X Y CIERRE Z
// =========================================================================
async function verificarEstadoTurnoCaja() {
    const res = await GeokatuDB.PosService.obtenerEstadoCajaActual(idNegocio, cajaNumeroActiva);
    const btnCaja = document.getElementById('txt-estado-caja-btn');

    if (res.success && res.data && res.data.estado === 'ABIERTA') {
        turnoCajaActivo = res.data;
        const rawAcum = localStorage.getItem(`geokatu_acumulado_ven_${idNegocio}`);
        if (rawAcum) {
            try { acumuladoTurnoVen = { ...acumuladoTurnoVen, ...JSON.parse(rawAcum) }; } catch (e) {}
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
        abrirModalAperturaCaja();
    }
}

function abrirModalAperturaCaja() {
    const modal = document.getElementById('modal-apertura-caja');
    if (modal) modal.style.display = 'flex';
}

document.getElementById('btn-confirmar-apertura')?.addEventListener('click', async () => {
    const baseUSD = parseFloat(document.getElementById('base-caja-usd').value) || 0;
    const baseVES = parseFloat(document.getElementById('base-caja-ves').value) || 0;
    const baseCOP = parseFloat(document.getElementById('base-caja-cop').value) || 0;

    const res = await GeokatuDB.PosService.abrirTurnoCaja(idNegocio, baseUSD, auth.currentUser?.email || "CAJERO", cajaNumeroActiva);
    if (res.success) {
        turnoCajaActivo = {
            ...res.data,
            base_multimoneda: { usd: baseUSD, ves: baseVES, cop: baseCOP }
        };
        acumuladoTurnoVen = {
            usd_efectivo: 0, ves_efectivo: 0, cop_efectivo: 0,
            ves_pago_movil: 0, ves_punto_venta: 0, usd_zelle: 0, usd_usdt: 0,
            igtf_recaudado_usd: 0, base_gravable_usd: 0, iva_16_usd: 0, exento_usd: 0,
            total_usd_consolidado: 0
        };
        localStorage.setItem(`geokatu_acumulado_ven_${idNegocio}`, JSON.stringify(acumuladoTurnoVen));
        document.getElementById('modal-apertura-caja').style.display = 'none';

        const btnCaja = document.getElementById('txt-estado-caja-btn');
        if (btnCaja) {
            btnCaja.innerText = "Caja Abierta";
            btnCaja.style.color = "var(--accent-green)";
        }
        window.mostrarAvisoPos("Turno multicartera aperturado con éxito.");
    }
});

document.getElementById('btn-control-caja')?.addEventListener('click', () => {
    if (!turnoCajaActivo || turnoCajaActivo.estado !== 'ABIERTA') {
        abrirModalAperturaCaja();
    } else {
        document.getElementById('modal-movimiento-caja').style.display = 'flex';
    }
});

document.getElementById('btn-cancelar-mov-caja')?.addEventListener('click', () => {
    document.getElementById('modal-movimiento-caja').style.display = 'none';
});

document.getElementById('btn-guardar-mov-caja')?.addEventListener('click', async () => {
    const tipo = document.getElementById('mov-tipo-operacion').value;
    const moneda = document.getElementById('mov-moneda').value;
    const monto = parseFloat(document.getElementById('mov-monto').value);
    const motivo = document.getElementById('mov-motivo').value.trim();

    if (isNaN(monto) || monto <= 0 || !motivo) return alert("Ingresa un monto y motivo válidos.");

    const res = await GeokatuDB.PosService.registrarMovimientoMenorCaja(idNegocio, tipo, monto, `[${moneda}] ${motivo}`, cajaNumeroActiva);
    if (res.success) {
        alert(`Movimiento de ${tipo === 'ENTRADA' ? 'Ingreso' : 'Salida'} por ${moneda} ${monto} registrado.`);
        document.getElementById('modal-movimiento-caja').style.display = 'none';
    }
});

// Informe X (Auditoría Parcial)
document.getElementById('btn-iniciar-informe-x')?.addEventListener('click', () => {
    document.getElementById('modal-movimiento-caja').style.display = 'none';
    const ahora = new Date();
    document.getElementById('tx-turno').innerText = turnoCajaActivo?.id_sesion || "SES-01";
    document.getElementById('tx-fecha').innerText = ahora.toLocaleDateString();
    document.getElementById('tx-cajero').innerText = auth.currentUser?.email || "CAJERO";
    document.getElementById('tx-supervisor').innerText = "AUDITORÍA INTERNA";

    document.getElementById('tx-efectivo-usd').innerText = `$${acumuladoTurnoVen.usd_efectivo.toFixed(2)}`;
    document.getElementById('tx-pm-ves').innerText = `Bs. ${acumuladoTurnoVen.ves_pago_movil.toLocaleString('es-VE')}`;
    document.getElementById('tx-punto-ves').innerText = `Bs. ${acumuladoTurnoVen.ves_punto_venta.toLocaleString('es-VE')}`;
    document.getElementById('tx-zelle-usd').innerText = `$${acumuladoTurnoVen.usd_zelle.toFixed(2)}`;
    document.getElementById('tx-total-usd').innerText = `$${acumuladoTurnoVen.total_usd_consolidado.toFixed(2)} USD`;

    document.getElementById('tirilla-venta-container').style.display = 'none';
    document.getElementById('tirilla-cierre-z-container').style.display = 'none';
    document.getElementById('tirilla-informe-x-container').style.display = 'block';

    setTimeout(() => {
        window.print();
        setTimeout(() => {
            document.getElementById('tirilla-informe-x-container').style.display = 'none';
            document.getElementById('tirilla-venta-container').style.display = 'block';
        }, 1000);
    }, 300);
});

// Cierre Z Definitivo
document.getElementById('btn-iniciar-cierre-z')?.addEventListener('click', () => {
    document.getElementById('modal-movimiento-caja').style.display = 'none';
    
    document.getElementById('cz-base-usd').innerText = `$${turnoCajaActivo?.base_multimoneda?.usd || 0}`;
    document.getElementById('cz-ventas-usd').innerText = `$${acumuladoTurnoVen.usd_efectivo.toFixed(2)}`;
    document.getElementById('cz-ventas-ves').innerText = `Bs. ${acumuladoTurnoVen.ves_efectivo.toLocaleString('es-VE')}`;
    document.getElementById('cz-ventas-cop').innerText = `$${acumuladoTurnoVen.cop_efectivo.toLocaleString('es-CO')} COP`;
    document.getElementById('cz-ventas-pm').innerText = `Bs. ${acumuladoTurnoVen.ves_pago_movil.toLocaleString('es-VE')}`;
    document.getElementById('cz-ventas-punto').innerText = `Bs. ${acumuladoTurnoVen.ves_punto_venta.toLocaleString('es-VE')}`;
    document.getElementById('cz-ventas-zelle').innerText = `$${acumuladoTurnoVen.usd_zelle.toFixed(2)}`;
    document.getElementById('cz-ventas-usdt').innerText = `${acumuladoTurnoVen.usd_usdt.toFixed(2)} USDT`;
    document.getElementById('cz-total-consolidado-usd').innerText = `$${acumuladoTurnoVen.total_usd_consolidado.toFixed(2)} USD`;

    document.getElementById('modal-cierre-z').style.display = 'flex';
});

document.getElementById('btn-cancelar-cierre-z')?.addEventListener('click', () => {
    document.getElementById('modal-cierre-z').style.display = 'none';
});

document.getElementById('btn-confirmar-cierre-z')?.addEventListener('click', async () => {
    if (!confirm("¿Deseas sellar definitivamente la caja y emitir el Cierre Z?")) return;

    const res = await GeokatuDB.PosService.ejecutarCierreZ(idNegocio, acumuladoTurnoVen.usd_efectivo, {
        efectivo: acumuladoTurnoVen.usd_efectivo,
        tarjeta: acumuladoTurnoVen.ves_punto_venta,
        nequi: acumuladoTurnoVen.ves_pago_movil,
        // Inyección multicartera de Venezuela
        pais: "VEN",
        usd_efectivo: acumuladoTurnoVen.usd_efectivo,
        ves_efectivo: acumuladoTurnoVen.ves_efectivo,
        cop_efectivo: acumuladoTurnoVen.cop_efectivo,
        ves_pago_movil: acumuladoTurnoVen.ves_pago_movil,
        ves_punto_venta: acumuladoTurnoVen.ves_punto_venta,
        usd_zelle: acumuladoTurnoVen.usd_zelle,
        usd_usdt: acumuladoTurnoVen.usd_usdt,
        igtf_recaudado_usd: acumuladoTurnoVen.igtf_recaudado_usd,
        total_usd_consolidado: acumuladoTurnoVen.total_usd_consolidado
    }, cajaNumeroActiva);


    if (res.success) {
        document.getElementById('tz-id').innerText = turnoCajaActivo?.id_sesion || "SES-Z";
        document.getElementById('tz-cierre').innerText = new Date().toLocaleTimeString();
        document.getElementById('tz-cajero').innerText = auth.currentUser?.email || "CAJERO";

        document.getElementById('tz-base-usd').innerText = `$${turnoCajaActivo?.base_multimoneda?.usd || 0}`;
        document.getElementById('tz-efectivo-usd').innerText = `$${acumuladoTurnoVen.usd_efectivo.toFixed(2)}`;
        document.getElementById('tz-efectivo-ves').innerText = `Bs. ${acumuladoTurnoVen.ves_efectivo.toLocaleString('es-VE')}`;
        document.getElementById('tz-efectivo-cop').innerText = `$${acumuladoTurnoVen.cop_efectivo.toLocaleString('es-CO')} COP`;
        document.getElementById('tz-pago-movil').innerText = `Bs. ${acumuladoTurnoVen.ves_pago_movil.toLocaleString('es-VE')}`;
        document.getElementById('tz-punto-venta').innerText = `Bs. ${acumuladoTurnoVen.ves_punto_venta.toLocaleString('es-VE')}`;
        document.getElementById('tz-zelle').innerText = `$${acumuladoTurnoVen.usd_zelle.toFixed(2)}`;
        document.getElementById('tz-usdt').innerText = `${acumuladoTurnoVen.usd_usdt.toFixed(2)} USDT`;
        document.getElementById('tz-total-consolidado').innerText = `$${acumuladoTurnoVen.total_usd_consolidado.toFixed(2)} USD`;

        document.getElementById('modal-cierre-z').style.display = 'none';
        document.getElementById('tirilla-venta-container').style.display = 'none';
        document.getElementById('tirilla-cierre-z-container').style.display = 'block';

        turnoCajaActivo = null;
        localStorage.removeItem(`geokatu_acumulado_ven_${idNegocio}`);

        setTimeout(() => {
            window.print();
            setTimeout(() => {
                document.getElementById('tirilla-cierre-z-container').style.display = 'none';
                document.getElementById('tirilla-venta-container').style.display = 'block';
            }, 1000);
        }, 300);

        window.mostrarAvisoPos("Cierre Z multicartera completado.");
    }
});

// =========================================================================
// 11. BÁSCULA, GAVETA, TICKETS EN ESPERA Y AYUDA
// =========================================================================
balanza = new MotorBalanza({
    onPesoVivo: (peso) => {
        pesoEnVivoActual = peso;
        const txtVivo = document.getElementById('txt-peso-vivo');
        if (txtVivo) {
            txtVivo.innerText = `${peso.toFixed(3)} kg`;
            txtVivo.style.display = 'inline-block';
        }
        const inpManual = document.getElementById('input-peso-manual');
        if (inpManual && document.getElementById('modal-pesaje').style.display === 'flex') {
            inpManual.value = peso.toFixed(3);
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
    }
});

document.getElementById('btn-menu-balanza')?.addEventListener('click', () => {
    document.getElementById('modal-balanza-config').style.display = 'flex';
});
document.getElementById('btn-cerrar-modal-balanza')?.addEventListener('click', () => {
    document.getElementById('modal-balanza-config').style.display = 'none';
});
document.getElementById('btn-conectar-usb')?.addEventListener('click', () => balanza.conectarUSB(9600));
document.getElementById('btn-conectar-ble')?.addEventListener('click', () => balanza.conectarBluetooth());
document.getElementById('btn-desconectar-balanza')?.addEventListener('click', () => balanza.desconectar());

document.getElementById('btn-tara-balanza')?.addEventListener('click', () => balanza.aplicarTara());
document.getElementById('btn-tara-modal')?.addEventListener('click', () => balanza.aplicarTara());

function abrirModalPesaje(producto, pesoSugerido = null) {
    productoEnPesajeManual = producto;
    document.getElementById('pesaje-prod-nombre').innerText = producto.nombre;
    document.getElementById('pesaje-prod-precio').innerText = `$${Number(producto.precio).toFixed(2)} / ${producto.unidad_medida || 'kg'}`;

    const inp = document.getElementById('input-peso-manual');
    inp.value = pesoSugerido !== null ? pesoSugerido.toFixed(3) : (pesoEnVivoActual > 0 ? pesoEnVivoActual.toFixed(3) : '');
    actualizarCalculoPesajeModal();

    document.getElementById('modal-pesaje').style.display = 'flex';
    setTimeout(() => { inp.focus(); inp.select(); }, 100);
}

function actualizarCalculoPesajeModal() {
    if (!productoEnPesajeManual) return;
    const peso = parseFloat(document.getElementById('input-peso-manual').value) || 0;
    const sub = Number((peso * Number(productoEnPesajeManual.precio)).toFixed(2));
    document.getElementById('pesaje-subtotal-calc').innerText = `$${sub.toFixed(2)}`;
}

document.getElementById('input-peso-manual')?.addEventListener('input', actualizarCalculoPesajeModal);
document.getElementById('btn-confirmar-pesaje')?.addEventListener('click', () => {
    const val = sanitizarCantidadSegura(document.getElementById('input-peso-manual').value, true, 300);
    if (!val) return alert("Ingresa un peso válido.");
    agregarAlCarrito(productoEnPesajeManual, val, true);
    document.getElementById('modal-pesaje').style.display = 'none';
    productoEnPesajeManual = null;
});
document.getElementById('btn-cancelar-pesaje')?.addEventListener('click', () => {
    document.getElementById('modal-pesaje').style.display = 'none';
    productoEnPesajeManual = null;
});

// Tickets retenidos
document.getElementById('btn-pausar-ticket')?.addEventListener('click', () => {
    if (carrito.length === 0) return alert("El carrito está vacío.");
    const ticketPausado = {
        id: `P-${Date.now().toString().slice(-4)}`,
        hora: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        items: [...carrito],
        abonosPrevios: [...pagosAcumuladosTicket],
        totalUSD: document.getElementById('txt-total').innerText
    };
    ticketsEnEspera.push(ticketPausado);
    sincronizarTicketsEnEsperaStorage();

    carrito = [];
    pagosAcumuladosTicket = [];
    renderizarCarrito();
    window.mostrarAvisoPos(`Ticket pausado (#${ticketPausado.id}).`);
});

function sincronizarTicketsEnEsperaStorage() {
    localStorage.setItem(`geokatu_tickets_pausados_ven_${idNegocio}`, JSON.stringify(ticketsEnEspera));
    actualizarBadgeTicketsEspera();
}

function cargarTicketsEnEsperaStorage() {
    ticketsEnEspera = JSON.parse(localStorage.getItem(`geokatu_tickets_pausados_ven_${idNegocio}`) || "[]");
    actualizarBadgeTicketsEspera();
}

function actualizarBadgeTicketsEspera() {
    const badge = document.getElementById('badge-en-espera');
    if (badge) {
        badge.innerText = ticketsEnEspera.length;
        badge.style.display = ticketsEnEspera.length > 0 ? 'inline-block' : 'none';
    }
}

document.getElementById('btn-ver-espera')?.addEventListener('click', () => {
    const modal = document.getElementById('modal-espera');
    const lista = document.getElementById('lista-tickets-espera');
    lista.innerHTML = '';

    if (ticketsEnEspera.length === 0) {
        lista.innerHTML = '<p style="text-align: center; color: #777; padding: 20px;">No hay tickets retenidos.</p>';
    } else {
        ticketsEnEspera.forEach((t, idx) => {
            const row = document.createElement('div');
            row.style.cssText = 'background: rgba(255,255,255,0.04); padding: 8px 12px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;';
            row.innerHTML = `
                <div>
                    <strong>#t.id</strong><spanstyle="color:#888;font-size:11px;">({t.hora})</span>
                    <p style="font-size: 11px; color: var(--accent-green); margin: 2px 0;">t.totalUSD({t.items.length} productos)</p>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button class="btn-rec" data-idx="${idx}" style="background: var(--color-marca); border:none; padding:4px 8px; border-radius:6px; font-weight:bold; cursor:pointer;">Recuperar</button>
                    <button class="btn-del" data-idx="${idx}" style="background: rgba(255,68,68,0.2); border:none; color:var(--accent-red); padding:4px 8px; border-radius:6px; cursor:pointer;">✕</button>
                </div>
            `;
            lista.appendChild(row);
        });

        lista.querySelectorAll('.btn-rec').forEach(b => {
            b.onclick = () => {
                const idx = Number(b.dataset.idx);
                carrito = [...ticketsEnEspera[idx].items];
                pagosAcumuladosTicket = ticketsEnEspera[idx].abonosPrevios || [];
                ticketsEnEspera.splice(idx, 1);
                sincronizarTicketsEnEsperaStorage();
                modal.style.display = 'none';
                renderizarCarrito();
            };
        });

        lista.querySelectorAll('.btn-del').forEach(b => {
            b.onclick = () => {
                ticketsEnEspera.splice(Number(b.dataset.idx), 1);
                sincronizarTicketsEnEsperaStorage();
                document.getElementById('btn-ver-espera').click();
            };
        });
    }
    modal.style.display = 'flex';
});

document.getElementById('btn-cerrar-modal-espera')?.addEventListener('click', () => {
    document.getElementById('modal-espera').style.display = 'none';
});

// Cajón monedero
document.getElementById('btn-abrir-cajon')?.addEventListener('click', () => {
    motorCajon.dispararAperturaDirecta(0);
});

// Manual [F1]
document.getElementById('btn-manual-ayuda')?.addEventListener('click', () => {
    document.getElementById('modal-ayuda-pos').style.display = 'flex';
});
document.getElementById('btn-cerrar-ayuda')?.addEventListener('click', () => {
    document.getElementById('modal-ayuda-pos').style.display = 'none';
});
document.querySelectorAll('.tab-ayuda').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab-ayuda').forEach(t => t.classList.remove('activa'));
        document.querySelectorAll('.panel-ayuda-contenido').forEach(p => p.style.display = 'none');
        tab.classList.add('activa');
        const target = document.getElementById(tab.dataset.tab);
        if (target) target.style.display = 'block';
    });
});

// =========================================================================
// 12. COMPROBANTE DIGITAL QR (24 HORAS, WHATSAPP Y COPIA DE TICKET)
// =========================================================================
window.deseaFacturaEcologicaQR = false;
window.urlFacturaActiva = "";
window.ticketIdFacturaActiva = "";

window.alternarFacturaEcologica = async function(btn) {
    if (carrito.length === 0 && ultimoTicketIdVendido) {
        await abrirModalFacturaDigitalQR(ultimoTicketIdVendido);
        return;
    }
    window.deseaFacturaEcologicaQR = !window.deseaFacturaEcologicaQR;
    if (btn) {
        btn.style.borderColor = window.deseaFacturaEcologicaQR ? 'var(--accent-green)' : 'var(--border-soft)';
        btn.style.background = window.deseaFacturaEcologicaQR ? 'rgba(0,255,100,0.15)' : 'rgba(255,255,255,0.03)';
        btn.style.color = window.deseaFacturaEcologicaQR ? 'var(--accent-green)' : '#fff';
    }
    if (typeof window.mostrarAvisoPos === 'function') {
        window.mostrarAvisoPos(window.deseaFacturaEcologicaQR ? "Modo comprobante digital activo." : "Modo ticket impreso activo.");
    }
};

async function generarFirmaFactura24Horas(tktId, expTimestamp) {
    try {
        const raw = `tktId:{idNegocio}:${expTimestamp}:GEOKATU_PUBLIC_TKT_SALT`;
        if (window.crypto && window.crypto.subtle) {
            const encoder = new TextEncoder();
            const data = encoder.encode(raw);
            const buffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(buffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).slice(0, 16).join('');
        }
    } catch (_) {}
    return "SIG_" + Date.now().toString(16).toUpperCase();
}

async function abrirModalFacturaDigitalQR(ticketId, telefonoPrevio = "") {
    const modalQR = document.getElementById('modal-factura-qr');
    const contenedor = document.getElementById('contenedor-qr-factura');
    const inputWp = document.getElementById('input-whatsapp-cliente');
    if (!modalQR || !contenedor) return;

    window.ticketIdFacturaActiva = ticketId;
    const exp = Date.now() + (24 * 60 * 60 * 1000);
    const sig = await generarFirmaFactura24Horas(ticketId, exp);

    window.urlFacturaActiva = `window.location.origin/facturaven?com={idNegocio}&tkt=ticketId&exp={exp}&sig=${sig}`;

    contenedor.innerHTML = '';
    contenedor.style.padding = '20px';
    contenedor.style.backgroundColor = '#fff';
    if (typeof window.QRCode === 'function') {
        try {
            new window.QRCode(contenedor, {
                text: window.urlFacturaActiva, width: 240, height: 240,
                colorDark: '#000000', colorLight: '#ffffff',
                correctLevel: window.QRCode.CorrectLevel.M
            });
        } catch (errorQR) {
            contenedor.textContent = 'No se pudo generar el QR. Usa el enlace de WhatsApp.';
        }
    } else {
        contenedor.textContent = 'Generador QR no disponible. Recarga la aplicación.';
    }

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
    const numCompleto = rawTel.length === 10 ? `58${rawTel}` : rawTel;
    const nombreLocal = (document.getElementById('ticket-negocio-nombre')?.innerText || "el comercio").trim();
    const mensaje = `Hola. Adjuntamos tu comprobante de compra en ${nombreLocal}:\n\nComprobante: ${window.urlFacturaActiva}\nID Ticket: ${window.ticketIdFacturaActiva}\n\nValidez del enlace: 24 horas.`;
    window.open(`https://wa.me/numCompleto?text={encodeURIComponent(mensaje)}`, '_blank');
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
        if (tktLocal?.cliente?.telefono) telGuardado = tktLocal.cliente.telefono;
    } catch (_) {}

    await abrirModalFacturaDigitalQR(tktId, telGuardado);
};

document.getElementById('btn-cerrar-qr')?.addEventListener('click', () => {
    document.getElementById('modal-factura-qr').style.display = 'none';
});


// =========================================================================
// 13. CÁMARA Y MONITOR OFFLINE
// =========================================================================
let scannerInstancia = null;
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
        alert("La linterna no está disponible en este dispositivo.");
    } catch (e) {
        alert("No se pudo controlar la linterna.");
    }
};

window.cerrarCamaraPOS = () => {
    const dock = document.getElementById('scanner-dock');
    const btnCam = document.getElementById('btn-toggle-camara');
    if (dock) dock.style.display = 'none';
    if (btnCam) btnCam.innerHTML = `<svg class="icono-pos" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5M8 8h3v3H8zM15 8h1v3M8 15h3v1m4-1h2v2"/></svg> Cámara`;

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

    if (scannerInstancia && scannerInstancia.isScanning) {
        scannerInstancia.stop().catch(() => {});
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
    if (btnCam) btnCam.innerHTML = `<svg class="icono-pos" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m5 5 14 14M19 5 5 19"/></svg> Cerrar`;

    const configFormatos = {
        formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.QR_CODE
        ],
        verbose: false
    };

    if (!scannerInstancia) scannerInstancia = new Html5Qrcode("lector-camara", configFormatos);

    scannerInstancia.start(
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
        alert("Comprueba los permisos de cámara en tu navegador.");
        window.cerrarCamaraPOS();
    });
};


document.getElementById('btn-toggle-camara')?.addEventListener('click', window.escanearParaPOS);

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

function monitorearCapacidadCola() {
    const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid') || "";
    const rawCola = localStorage.getItem(`geokatu_sync_cola_${tenantReal}`) || "[]";
    const bytesOcupados = new Blob([rawCola]).size;
    const cola = JSON.parse(rawCola);

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


window.addEventListener('online', async () => {
    document.getElementById('txt-conexion').innerText = "SINCRONIZANDO...";
    await GeokatuDB.PosService.sincronizarVentasPendientes(idNegocio);
    actualizarIndicadorCola();
    document.getElementById('txt-conexion').innerText = "EN LÍNEA";
    document.getElementById('led-conexion').style.backgroundColor = "var(--accent-green)";
});

window.addEventListener('offline', () => {
    document.getElementById('txt-conexion').innerText = "OFFLINE (Sin Red)";
    document.getElementById('led-conexion').style.backgroundColor = "orange";
});

// Atajos globales
window.addEventListener('keydown', (e) => {
    if (e.key === 'F1') { e.preventDefault(); document.getElementById('btn-manual-ayuda')?.click(); }
    if (e.key === 'F2') { e.preventDefault(); inputBuscador?.focus(); inputBuscador?.select(); }
    if (e.key === 'F6') { e.preventDefault(); balanza?.aplicarTara(); }
    if (e.key === 'F7') { e.preventDefault(); motorCajon?.dispararAperturaDirecta(0); }
    if (e.key === 'F4') { e.preventDefault(); procesarIntentoPago('EFECTIVO_USD'); }
    if (e.key === 'F8') { e.preventDefault(); procesarIntentoPago('PAGO_MOVIL'); }
    if (e.key === 'F9') { e.preventDefault(); procesarIntentoPago('PUNTO_VENTA'); }
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-datafono-overlay').forEach(m => m.style.display = 'none');
    }
});

// Comanda notes
window.agregarNotaItem = function(index) {
    const nota = prompt("Instrucción o nota para este producto:", carrito[index].nota || "");
    if (nota !== null) {
        carrito[index].nota = nota.trim();
        renderizarCarrito();
    }
};

// Ítem libre
document.getElementById('btn-abrir-item-libre')?.addEventListener('click', () => {
    document.getElementById('modal-item-libre').style.display = 'flex';
});
document.getElementById('btn-cancelar-libre')?.addEventListener('click', () => {
    document.getElementById('modal-item-libre').style.display = 'none';
});
document.getElementById('btn-agregar-libre')?.addEventListener('click', () => {
    const nom = document.getElementById('libre-nombre').value.trim() || "Concepto Libre";
    const pre = parseFloat(document.getElementById('libre-precio').value);
    const iva = document.getElementById('libre-iva').value;
    if (isNaN(pre) || pre <= 0) return alert("Ingresa un precio en USD válido.");

    carrito.push({
        id_prod: "GENERICO_" + Date.now(),
        codigo_barras: "",
        nombre: `[L] ${nom}`,
        precio: pre,
        cantidad: 1,
        impuesto: iva,
        es_pesable: false,
        unidad_medida: "und",
        precio_fijado_balanza: false
    });

    document.getElementById('libre-nombre').value = '';
    document.getElementById('libre-precio').value = '';
    document.getElementById('modal-item-libre').style.display = 'none';
    renderizarCarrito();
});

// Devolución parcial
window.abrirModalDevolucionParcial = async function(ticketId) {
    const { getFirestore, doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
    const db = getFirestore();
    const snap = await getDoc(doc(db, `Directorio/${idNegocio}/Ventas_POS`, ticketId));
    if (!snap.exists()) return alert("Ticket no encontrado.");

    const venta = snap.data();
    document.getElementById('dev-ticket-tag').innerText = ticketId;
    const lista = document.getElementById('dev-lista-items');
    lista.innerHTML = '';

    (venta.productos || []).forEach((p, idx) => {
        lista.innerHTML += `
            <div style="background: rgba(255,255,255,0.04); padding: 8px 12px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                <label style="display: flex; align-items: center; gap: 8px; font-size: 11px; cursor: pointer;">
                    <input type="checkbox" class="chk-dev-item" data-idx="idx"data-precio="{p.precio_usd || p.precio}" data-cant="${p.cantidad}" onchange="window.recalcularTotalDevolucion()">
                    <span>p.cantidadxp.nombre({Number(p.precio_usd || p.precio).toFixed(2)})</span>
                </label>
            </div>
        `;
    });

    window.ticketEnDevolucion = { id: ticketId, productos: venta.productos };
    document.getElementById('modal-devolucion-parcial').style.display = 'flex';
};

window.recalcularTotalDevolucion = function() {
    let tot = 0;
    document.querySelectorAll('.chk-dev-item:checked').forEach(c => {
        tot += (Number(c.dataset.precio) * Number(c.dataset.cant));
    });
    document.getElementById('dev-total-reembolso').innerText = `$${tot.toFixed(2)}`;
};

document.getElementById('btn-cancelar-dev')?.addEventListener('click', () => {
    document.getElementById('modal-devolucion-parcial').style.display = 'none';
});

document.getElementById('btn-ejecutar-dev-parcial')?.addEventListener('click', async () => {
    const items = [];
    document.querySelectorAll('.chk-dev-item:checked').forEach(c => {
        const orig = window.ticketEnDevolucion.productos[c.dataset.idx];
        items.push({ ...orig, cantidad_devuelta: Number(c.dataset.cant) });
    });
    if (items.length === 0) return alert("Selecciona artículos a devolver.");

    const res = await GeokatuDB.PosService.devolucionParcialPOS(idNegocio, window.ticketEnDevolucion.id, items);
    if (res.success) {
        alert("Devolución procesada y stock reingresado.");
        document.getElementById('modal-devolucion-parcial').style.display = 'none';
        catalogoLocal = GeokatuDB.PosService.cargarCatalogoDesdeCache(idNegocio);
        renderizarGridCatalogo();
    }
});

// Anulación completa
document.getElementById('btn-abrir-anulacion')?.addEventListener('click', () => {
    document.getElementById('anulacion-ticket-id').value = ultimoTicketIdVendido || '';
    document.getElementById('modal-anulacion').style.display = 'flex';
});
document.getElementById('btn-cancelar-anulacion')?.addEventListener('click', () => {
    document.getElementById('modal-anulacion').style.display = 'none';
});
document.getElementById('btn-ejecutar-anulacion')?.addEventListener('click', async () => {
    const tkt = document.getElementById('anulacion-ticket-id').value.trim();
    const mot = document.getElementById('anulacion-motivo').value;
    if (!tkt) return alert("Ingresa el ID del ticket.");

    const res = await GeokatuDB.PosService.anularVentaPOS(idNegocio, tkt, mot);
    if (res.success) {
        alert("Venta anulada y stock restituido al catálogo.");
        document.getElementById('modal-anulacion').style.display = 'none';
        catalogoLocal = GeokatuDB.PosService.cargarCatalogoDesdeCache(idNegocio);
        renderizarGridCatalogo();
    }
});

// WakeLock de pantalla
if ('wakeLock' in navigator) {
    navigator.wakeLock.request('screen').catch(() => {});
}
// Listener para cambio obligatorio de contraseña del operario en primer inicio
document.getElementById('btn-establecer-nueva-pass')?.addEventListener('click', async () => {
    const p1 = document.getElementById('input-nueva-pass').value;
    const p2 = document.getElementById('input-confirmar-pass').value;

    if (p1.length < 6) return alert("La contraseña debe tener mínimo 6 caracteres.");
    if (p1 !== p2) return alert("Las contraseñas no coinciden.");

    try {
        const { getAuth, updatePassword } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js');
        const { getFirestore, doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
        
        const authActual = getAuth();
        await updatePassword(authActual.currentUser, p1);

        const dbActual = getFirestore();
        const fechaActualIso = new Date().toISOString();

        await updateDoc(doc(dbActual, `Directorio/${idNegocio}/Equipo`, authActual.currentUser.uid), {
            requiere_cambio_password: false,
            expiracion_clave_temporal: null,
            fecha_ultimo_cambio_password: fechaActualIso
        });

        try {
            await updateDoc(doc(dbActual, 'Usuarios_Operadores', authActual.currentUser.uid), {
                requiere_cambio_password: false,
                expiracion_clave_temporal: null,
                fecha_ultimo_cambio_password: fechaActualIso
            });
        } catch (eDocGlobal) {}

        alert("Contraseña personalizada actualizada correctamente. ¡Bienvenido!");
        document.getElementById('modal-cambio-password-obligatorio').style.display = 'none';
        await inicializarCajaVen();
    } catch (err) {
        alert("Error actualizando contraseña: " + err.message);
    }
});



