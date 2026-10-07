import GeokatuDB from './core-db.js';

/**
 * ============================================================================
 * MODULO DE TELEMETRIA COMERCIAL, AUDITORIA FORENSE Y WMS (LOCAL-FIRST)
 * Archivo: metricas.js
 * Huella de RAM acotada: < 45 MB con destruccion activa de subscripciones.
 * ============================================================================
 */

// 1. ESTADO DE MEMORIA VIVA (SINGLETON LOCAL)
const AppState = {
    idNegocio: null,
    pais: "COL",
    rangoActivo: "HOY",
    fechaInicioISO: null,
    fechaFinISO: null,
    suscripcionVentasHoy: null,
    timerReloj: null,
    catalogoLocal: [],
    ventas: [],
    cierresZ: [],
    kardex: [],
    alertasSeguridad: [],
    facturacionControl: null,
    kpisCalculados: {
        ventasNetas: 0,
        cogsTotal: 0,
        utilidadBruta: 0,
        margenPct: 0,
        aov: 0,
        ordenesValidas: 0,
        ordenesAnuladas: 0,
        splitEfectivo: 0,
        splitTarjeta: 0,
        splitDigital: 0,
        descuadreArqueo: 0,
        salidasMenores: 0,
        valorInventario: 0,
        mermasPerdidas: 0,
        discrepanciasConteo: 0,
        dianExitosos: 0,
        dianContingencia: 0
    }
};

// 2. FORMATEADORES MONETARIOS CONDICIONALES (COL: COP sin decimales / VEN: USD con 2 decimales)
const MonedaFormatter = {
    formatear(valor, pais = AppState.pais) {
        const num = Number(valor) || 0;
        if (pais === "VEN") {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(num);
        }
        return new Intl.NumberFormat('es-CO', {
            style: 'currency',
            currency: 'COP',
            maximumFractionDigits: 0
        }).format(num);
    }
};

// 3. UTILIDADES DEL ENCLAVE Y NOTIFICACIONES NATIVAS ESTILIZADAS
const UI = {
    showToast(mensaje, duracionMs = 3000) {
        const toast = document.getElementById('toast-notificacion');
        if (!toast) return;
        toast.textContent = mensaje;
        toast.classList.add('activo');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => {
            toast.classList.remove('activo');
        }, duracionMs);
    },

    actualizarReloj() {
        const relojEl = document.getElementById('reloj-vivo');
        if (relojEl) {
            const d = new Date();
            relojEl.textContent = d.toTimeString().split(' ')[0];
        }
    },

    actualizarPillRed() {
        const dot = document.getElementById('indicador-red-dot');
        const txt = document.getElementById('texto-red-status');
        if (!dot || !txt) return;

        const claveColaVentas = `geokatu_sync_cola_${AppState.idNegocio}`;
        const colaVentas = JSON.parse(localStorage.getItem(claveColaVentas) || "[]");
        const claveColaMovs = `geokatu_movimientos_cola_${AppState.idNegocio}`;
        const colaMovs = JSON.parse(localStorage.getItem(claveColaMovs) || "[]");
        const pendTotal = colaVentas.length + colaMovs.length;

        if (navigator.onLine) {
            dot.classList.remove('offline');
            txt.textContent = pendTotal > 0 ? `ONLINE (${pendTotal} pend)` : "ONLINE";
        } else {
            dot.classList.add('offline');
            txt.textContent = `OFFLINE: ${pendTotal} pend`;
        }

        const colaVentasCountEl = document.getElementById('cola-ventas-count');
        const colaBodegaCountEl = document.getElementById('cola-bodega-count');
        if (colaVentasCountEl) colaVentasCountEl.textContent = colaVentas.length;
        if (colaBodegaCountEl) colaBodegaCountEl.textContent = colaMovs.length;
    }
};

// 4. RESOLUCION MULTI-TENANT Y SEGURIDAD ZERO-TRUST
async function resolverTenantActivo() {
    const params = new URLSearchParams(window.location.search);
    const idParam = params.get('id');
    const idLocal = localStorage.getItem('geokatu_active_uid');
    const sigLocal = localStorage.getItem('geokatu_session_sig');

    let resolvedUid = null;
    if (idParam && idParam.trim().length >= 20) {
        resolvedUid = idParam.trim();
    } else if (idLocal && sigLocal && sigLocal.length === 64) {
        resolvedUid = idLocal;
    }

    if (!resolvedUid) {
        console.error("[Metricas] No hay tenant autenticado.");
        UI.showToast("Acceso no autorizado: Sin identificador de terminal.");
        setTimeout(() => { window.location.href = '/oficina'; }, 1500);
        return null;
    }

    AppState.idNegocio = resolvedUid;
    const paisGuardado = localStorage.getItem(`geokatu_pais_${resolvedUid}`);
    if (paisGuardado) {
        AppState.pais = paisGuardado;
    }

    const badgeMoneda = document.getElementById('badge-moneda-pais');
    if (badgeMoneda) {
        badgeMoneda.textContent = AppState.pais === "VEN" ? "VEN: USD ($ #.##)" : "COL: COP ($ #.###)";
    }
    return resolvedUid;
}

// 5. MANEJO DE RANGOS TEMPORALES REACTIVOS
function calcularRangoTemporal(rangoClave) {
    const ahora = new Date();
    let inicio = new Date();
    let fin = new Date();

    if (rangoClave === "HOY") {
        inicio.setHours(0, 0, 0, 0);
        fin.setHours(23, 59, 59, 999);
    } else if (rangoClave === "AYER") {
        inicio.setDate(inicio.getDate() - 1);
        inicio.setHours(0, 0, 0, 0);
        fin.setDate(fin.getDate() - 1);
        fin.setHours(23, 59, 59, 999);
    } else if (rangoClave === "7DIAS") {
        inicio.setDate(inicio.getDate() - 7);
        inicio.setHours(0, 0, 0, 0);
        fin.setHours(23, 59, 59, 999);
    } else if (rangoClave === "MES") {
        inicio = new Date(ahora.getFullYear(), ahora.getMonth(), 1, 0, 0, 0, 0);
        fin = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    AppState.fechaInicioISO = inicio.toISOString();
    AppState.fechaFinISO = fin.toISOString();

    const lbl = document.getElementById('rango-fecha-etiqueta');
    if (lbl) {
        lbl.textContent = `${inicio.toLocaleDateString()} - ${fin.toLocaleDateString()}`;
    }
}

// 6. HIDRATACION LOCAL-FIRST (0 MS)
function hidratarDesdeCacheLocal() {
    const claveCacheCat = `geokatu_catalogo_${AppState.idNegocio}`;
    AppState.catalogoLocal = JSON.parse(localStorage.getItem(claveCacheCat) || "[]");

    const claveCaja = `geokatu_caja_activa_${AppState.idNegocio}_CAJA-01`;
    const cajaData = JSON.parse(localStorage.getItem(claveCaja) || "null");

    const turnoBadge = document.getElementById('badge-turno-estado');
    const sesionSpan = document.getElementById('id-sesion-activa');
    const cajeroSpan = document.getElementById('cajero-en-turno');

    if (cajaData && cajaData.estado === 'ABIERTA') {
        if (turnoBadge) {
            turnoBadge.textContent = "ABIERTA";
            turnoBadge.className = "shift-badge abierta";
        }
        if (sesionSpan) sesionSpan.textContent = cajaData.id_sesion;
        if (cajeroSpan) cajeroSpan.textContent = cajaData.cajero || "Cajero Asignado";
    } else {
        if (turnoBadge) {
            turnoBadge.textContent = "CERRADA";
            turnoBadge.className = "shift-badge cerrada";
        }
        if (sesionSpan) sesionSpan.textContent = "S/N";
        if (cajeroSpan) cajeroSpan.textContent = "Sin turno activo";
    }

    // Calcular valorización de catálogo en RAM inmediatamente
    recalcularInventarioValuadoRAM();
}

// 7. MOTOR MATEMATICO REDUCER DE ALTA VELOCIDAD (RAM)
function recalcularInventarioValuadoRAM() {
    let valorTotal = 0;
    const criticos = [];

    for (let i = 0; i < AppState.catalogoLocal.length; i++) {
        const prod = AppState.catalogoLocal[i];
        const stock = Number(prod.stock_actual) || 0;
        const cpp = Number(prod.costo_promedio || prod.costo || 0);

        if (stock > 0) {
            valorTotal += (stock * cpp);
        }

        if (stock <= 2 || prod.alerta_quiebre) {
            criticos.push({
                codigo: prod.codigo_barras || prod.id_prod || "S/C",
                nombre: prod.nombre || "Articulo",
                stock: stock,
                cpp: cpp
            });
        }
    }

    AppState.kpisCalculados.valorInventario = valorTotal;
    const kpiValInvEl = document.getElementById('kpi-valor-inventario');
    if (kpiValInvEl) kpiValInvEl.textContent = MonedaFormatter.formatear(valorTotal);

    // Renderizar Top 5 críticos
    const tbody = document.getElementById('tbody-articulos-criticos');
    if (tbody) {
        if (criticos.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #777; padding: 12px;">Inventario equilibrado. Cero quiebres.</td></tr>`;
        } else {
            criticos.sort((a, b) => a.stock - b.stock);
            const top5 = criticos.slice(0, 5);
            tbody.innerHTML = top5.map(c => `
                <tr>
                    <td style="color: var(--naranja);">${c.codigo}</td>
                    <td style="max-width: 140px; overflow: hidden; text-overflow: ellipsis;">${c.nombre}</td>
                    <td style="color: c.stock<=0?'var(--rojo-urgente)':'var(--amber)';font-weight:800;">{c.stock}</td>
                    <td>${MonedaFormatter.formatear(c.cpp)}</td>
                </tr>
            `).join('');

        }
    }
}

function procesarVentasMatrizRAM() {
    let ventasNetas = 0;
    let cogsTotal = 0;
    let validas = 0;
    let anuladas = 0;
    let splitEfectivo = 0;
    let splitTarjeta = 0;
    let splitDigital = 0;
    let dianOk = 0;
    let dianContingencia = 0;

    const mapaCostos = new Map();
    AppState.catalogoLocal.forEach(p => {
        mapaCostos.set(p.id_prod, Number(p.costo_promedio || p.costo || 0));
        if (p.codigo_barras) mapaCostos.set(p.codigo_barras, Number(p.costo_promedio || p.costo || 0));
    });

    for (let i = 0; i < AppState.ventas.length; i++) {
        const t = AppState.ventas[i];

        if (t.anulado) {
            anuladas++;
            continue;
        }

        validas++;
        const totalVenta = Number(t.total) || 0;
        ventasNetas += totalVenta;

        // Calculo de COGS sobre productos vendidos
        if (Array.isArray(t.productos)) {
            for (let j = 0; j < t.productos.length; j++) {
                const item = t.productos[j];
                const cant = Number(item.cantidad) || 1;
                const costoUnitario = mapaCostos.get(item.id_prod) || mapaCostos.get(item.codigo_barras) || Number(item.costo || 0);
                cogsTotal += (cant * costoUnitario);
            }
        }

      // Matriz de pagos unificada (COL: COP | VEN: USD Equivalente)
        const extraerMonto = (obj) => {
            if (obj.monto_usd_equivalente !== undefined) return Number(obj.monto_usd_equivalente) || 0;
            return Number(obj.monto || obj.monto_original || 0);
        };

        if (Array.isArray(t.metodos_pago_split) && t.metodos_pago_split.length > 0) {
            t.metodos_pago_split.forEach(s => {
                const m = extraerMonto(s);
                const met = String(s.metodo || "").toUpperCase();

                if (['EFECTIVO', 'EFECTIVO_USD', 'EFECTIVO_VES', 'PESOS_COP'].includes(met)) {
                    splitEfectivo += m;
                } else if (['TARJETA', 'PUNTO_VENTA'].includes(met)) {
                    splitTarjeta += m;
                } else {
                    splitDigital += m; // Nequi, Pago Móvil, Zelle, Binance Pay
                }
            });
        } else {
            const m = totalVenta;
            const met = String(t.metodo_pago || "").toUpperCase();

            if (['EFECTIVO', 'EFECTIVO_USD', 'EFECTIVO_VES', 'PESOS_COP'].includes(met)) {
                splitEfectivo += m;
            } else if (['TARJETA', 'PUNTO_VENTA'].includes(met)) {
                splitTarjeta += m;
            } else {
                splitDigital += m;
            }
        }

        // Telemetría Fiscal Condicional (COL: DIAN / VEN: Control Interno e IGTF)
        if (AppState.pais === "VEN") {
            dianOk++; // Total de comprobantes emitidos
            if (Number(t.igtf_usd) > 0) dianContingencia += Number(t.igtf_usd); // Acumulador de IGTF
        } else {
            if (t.factura_electronica) {
                if (t.despacho_fiscal?.estado === "FACTURADO_EXITOSO") {
                    dianOk++;
                } else {
                    dianContingencia++;
                }
            }
        }

    }

    const utilidadBruta = ventasNetas - cogsTotal;
    const margenPct = ventasNetas > 0 ? (utilidadBruta / ventasNetas) * 100 : 0;
    const aov = validas > 0 ? ventasNetas / validas : 0;

    AppState.kpisCalculados.ventasNetas = ventasNetas;
    AppState.kpisCalculados.cogsTotal = cogsTotal;
    AppState.kpisCalculados.utilidadBruta = utilidadBruta;
    AppState.kpisCalculados.margenPct = margenPct;
    AppState.kpisCalculados.aov = aov;
    AppState.kpisCalculados.ordenesValidas = validas;
    AppState.kpisCalculados.ordenesAnuladas = anuladas;
    AppState.kpisCalculados.splitEfectivo = splitEfectivo;
    AppState.kpisCalculados.splitTarjeta = splitTarjeta;
    AppState.kpisCalculados.splitDigital = splitDigital;
    AppState.kpisCalculados.dianExitosos = dianOk;
    AppState.kpisCalculados.dianContingencia = dianContingencia;

    // Pintar en DOM
    document.getElementById('kpi-ventas-netas').textContent = MonedaFormatter.formatear(ventasNetas);
    document.getElementById('kpi-cogs-total').textContent = MonedaFormatter.formatear(cogsTotal);
    document.getElementById('kpi-utilidad-bruta').textContent = MonedaFormatter.formatear(utilidadBruta);
    document.getElementById('kpi-margen-pct').textContent = `${margenPct.toFixed(1)}%`;
    document.getElementById('kpi-aov').textContent = MonedaFormatter.formatear(aov);
    document.getElementById('conteo-ordenes-validas').textContent = validas;
    document.getElementById('conteo-ordenes-anuladas').textContent = anuladas;

    // Split Payments
    document.getElementById('monto-split-efectivo').textContent = MonedaFormatter.formatear(splitEfectivo);
    document.getElementById('monto-split-tarjeta').textContent = MonedaFormatter.formatear(splitTarjeta);
    document.getElementById('monto-split-digital').textContent = MonedaFormatter.formatear(splitDigital);

    const totalSplit = (splitEfectivo + splitTarjeta + splitDigital) || 1;
    document.getElementById('bar-split-efectivo').style.width = `${Math.min(100, (splitEfectivo / totalSplit) * 100)}%`;
    document.getElementById('bar-split-tarjeta').style.width = `${Math.min(100, (splitTarjeta / totalSplit) * 100)}%`;
    document.getElementById('bar-split-digital').style.width = `${Math.min(100, (splitDigital / totalSplit) * 100)}%`;

    // Fiscal dinámico por país
    const lblFiscalTitulo = document.getElementById('lbl-fiscal-titulo');
    const lblFiscalOk = document.getElementById('lbl-fiscal-ok');
    const lblFiscalAlt = document.getElementById('lbl-fiscal-alt');

    if (AppState.pais === "VEN") {
        if (lblFiscalTitulo) lblFiscalTitulo.textContent = "Control Fiscal Venezuela e IGTF";
        if (lblFiscalOk) lblFiscalOk.textContent = "Comprobantes:";
        if (lblFiscalAlt) lblFiscalAlt.textContent = "Total IGTF Recaudado:";
        document.getElementById('conteo-dian-exitoso').textContent = dianOk;
        document.getElementById('conteo-dian-contingencia').textContent = MonedaFormatter.formatear(dianContingencia);
    } else {
        if (lblFiscalTitulo) lblFiscalTitulo.textContent = "Conformidad Fiscal DIAN / Contingencias";
        if (lblFiscalOk) lblFiscalOk.textContent = "Facturado con CUFE:";
        if (lblFiscalAlt) lblFiscalAlt.textContent = "Contingencia Tipo 04:";
        document.getElementById('conteo-dian-exitoso').textContent = dianOk;
        document.getElementById('conteo-dian-contingencia').textContent = dianContingencia;
    }
}


function procesarCierresZMatrizRAM() {
    let descuadreNeto = 0;
    let salidasMenores = 0;

    for (let i = 0; i < AppState.cierresZ.length; i++) {
        const c = AppState.cierresZ[i];
        descuadreNeto += (Number(c.diferencia_cuadre) || 0);
        salidasMenores += (Number(c.total_salidas_menores) || 0);
    }

    AppState.kpisCalculados.descuadreArqueo = descuadreNeto;
    AppState.kpisCalculados.salidasMenores = salidasMenores;

    const elDesc = document.getElementById('kpi-descuadre-arqueo');
    if (elDesc) {
        elDesc.textContent = MonedaFormatter.formatear(descuadreNeto);
        if (descuadreNeto < 0) elDesc.className = "sub-kpi-valor rojo";
        else if (descuadreNeto > 0) elDesc.className = "sub-kpi-valor verde";
        else elDesc.className = "sub-kpi-valor";
    }

    const elSal = document.getElementById('kpi-salidas-menores');
    if (elSal) elSal.textContent = MonedaFormatter.formatear(salidasMenores);
}

function procesarKardexMatrizRAM() {
    let mermasTotal = 0;
    let conteosAjustes = 0;

    for (let i = 0; i < AppState.kardex.length; i++) {
        const m = AppState.kardex[i];
        const tipo = m.tipo || "";

        if (tipo === "AJUSTE_MERMA" || tipo === "MERMA_AUDITORIA") {
            const cant = Number(m.cantidad) || 0;
            const costo = Number(m.costo_compra_unitario || m.costo_promedio_resultante || 0);
            mermasTotal += (cant * costo);
        } else if (tipo === "AJUSTE_CONTEO_CICLICO") {
            conteosAjustes++;
        }
    }

    AppState.kpisCalculados.mermasPerdidas = mermasTotal;
    AppState.kpisCalculados.discrepanciasConteo = conteosAjustes;

    const elMerma = document.getElementById('kpi-mermas-perdidas');
    if (elMerma) elMerma.textContent = MonedaFormatter.formatear(mermasTotal);

    const elConteos = document.getElementById('kpi-discrepancias-conteos');
    if (elConteos) elConteos.textContent = conteosAjustes;
}

// 8. ODOMETRO FISCAL Y ESTIMACION DE ALMACENAMIENTO WEB API
async function actualizarOdometroYTelemetria() {
    if (!AppState.facturacionControl) {
        const resControl = await GeokatuDB.MetricasService.obtenerControlFacturacion(AppState.idNegocio);
        if (resControl.success) {
            AppState.facturacionControl = resControl.facturacion_control;
            AppState.pais = resControl.pais || AppState.pais;
        }
    }

    const control = AppState.facturacionControl || { facturas_emitidas_mes: 0, facturas_cupo_gratis: 1300, facturas_prepago_saldo: 0 };
    const emitidas = Number(control.facturas_emitidas_mes) || 0;
    const cupo = (Number(control.facturas_cupo_gratis) || 1300) + (Number(control.facturas_prepago_saldo) || 0);
    const pct = Math.min(100, Math.round((emitidas / cupo) * 100));

    const pathEl = document.getElementById('odometro-progreso-path');
    if (pathEl) {
        pathEl.setAttribute('stroke-dasharray', `${pct}, 100`);
    }

    const pctEl = document.getElementById('odometro-porcentaje');
    if (pctEl) pctEl.textContent = `${pct}%`;

    const emitEl = document.getElementById('facturas-emitidas-mes');
    if (emitEl) emitEl.textContent = emitidas;

    const maxEl = document.getElementById('facturas-cupo-max');
    if (maxEl) maxEl.textContent = cupo;

    // Proyección de velocidad en base a ventas de los últimos 7 días
    const velDiaria = AppState.ventas.length > 0 ? (AppState.ventas.length / 7) : 0;
    const diasRestantes = velDiaria > 0 ? Math.round((cupo - emitidas) / velDiaria) : 999;
    const proyEl = document.getElementById('proyeccion-cuota');
    if (proyEl) {
        proyEl.textContent = diasRestantes < 999 ? `${Math.max(1, diasRestantes)} dias restantes` : "Normal";
    }

    // Monitor Storage Quota nativo Android WebView
    if (navigator.storage && navigator.storage.estimate) {
        try {
            const estimacion = await navigator.storage.estimate();
            const usado = estimacion.usage || 0;
            const cuota = estimacion.quota || 1;
            const pctUso = ((usado / cuota) * 100).toFixed(1);

            const storagePctEl = document.getElementById('storage-porcentaje-uso');
            const storageBar = document.getElementById('storage-fill-bar');

            if (storagePctEl) storagePctEl.textContent = `pctUso%({(usado / (1024 * 1024)).toFixed(1)} MB)`;

            if (storageBar) {
                storageBar.style.width = `${Math.min(100, pctUso)}%`;
                if (pctUso > 80) storageBar.classList.add('peligro');
                else storageBar.classList.remove('peligro');
            }
        } catch (eStorage) {
            console.warn("[Storage API] Error calculando cuota:", eStorage);
        }
    }
}

// 9. CARGA Y SINCRONIZACION DIFERENCIAL
async function sincronizarMetricas() {
    UI.actualizarPillRed();

    // 1. Desuscribir listener previo para erradicar fugas de memoria
    if (AppState.suscripcionVentasHoy) {
        AppState.suscripcionVentasHoy();
        AppState.suscripcionVentasHoy = null;
    }

    calcularRangoTemporal(AppState.rangoActivo);

    // 2. Carga concurrente acotada en red
    const [resVentas, resCierres, resKardex, resAlertas] = await Promise.all([
        GeokatuDB.MetricasService.obtenerVentasRango(AppState.idNegocio, AppState.fechaInicioISO, AppState.fechaFinISO),
        GeokatuDB.MetricasService.obtenerCierresZRango(AppState.idNegocio, AppState.fechaInicioISO, AppState.fechaFinISO),
        GeokatuDB.MetricasService.obtenerMovimientosKardexRango(AppState.idNegocio, AppState.fechaInicioISO, AppState.fechaFinISO),
        GeokatuDB.MetricasService.obtenerAlertasSeguridadVivas(AppState.idNegocio)
    ]);

    AppState.ventas = resVentas.success ? resVentas.data : [];
    AppState.cierresZ = resCierres.success ? resCierres.data : [];
    AppState.kardex = resKardex.success ? resKardex.data : [];
    AppState.alertasSeguridad = resAlertas.success ? resAlertas.data : [];

    // 3. Ejecutar Reducers
    procesarVentasMatrizRAM();
    procesarCierresZMatrizRAM();
    procesarKardexMatrizRAM();
    await actualizarOdometroYTelemetria();

    // 4. Si el rango es HOY y hay red, mantener canal reactivo en vivo acotado a 150 docs
    if (AppState.rangoActivo === "HOY" && navigator.onLine) {
        AppState.suscripcionVentasHoy = GeokatuDB.MetricasService.escucharVentasHoy(
            AppState.idNegocio,
            AppState.fechaInicioISO,
            (snap) => {
                if (snap.success) {
                    AppState.ventas = snap.data;
                    procesarVentasMatrizRAM();
                    UI.actualizarPillRed();
                }
            }
        );
    }
}

// 10. GENERACION CLIENT-SIDE DE LIBRO CONTABLE CSV (0 MS / CERO-EGRESS)
function exportarLibroContableCSV() {
    if (AppState.ventas.length === 0) {
        UI.showToast("No existen ventas registradas en este periodo para exportar.");
        return;
    }

    const separador = ";";
    const esVen = AppState.pais === "VEN";
    let contenidoCsv = "\uFEFF";
    
    const encabezados = esVen
        ? ["Ticket", "Fecha", "Hora", "Total_USD", "Total_VES", "Tasa", "Metodo_Pago", "Base_USD", "IVA_16", "IGTF_3", "Exento", "RIF_Cliente", "Anulado"]
        : ["Ticket", "Fecha", "Hora", "Total_COP", "Metodo_Pago", "Base_Gravable", "IVA_19", "Exento", "Estado_DIAN", "CUFE", "Anulado"];

    contenidoCsv += encabezados.join(separador) + "\r\n";

    AppState.ventas.forEach(v => {
        const fechaHora = v.timestamp_caja ? v.timestamp_caja.split('T') : ["", ""];
        const fecha = fechaHora[0];
        const hora = (fechaHora[1] || "").split('.')[0];

        let fila = [];
        if (esVen) {
            fila = [
                v.ticketIdLocal || v.id_firestore,
                fecha,
                hora,
                v.total_usd || v.total || 0,
                v.total_ves || 0,
                v.tasa_aplicada || 0,
                v.metodo_pago || "MIXTO",
                v.base_gravable_usd || 0,
                v.iva_16_usd || 0,
                v.igtf_usd || 0,
                v.exento_usd || 0,
                v.cliente?.rif || "V-00000000",
                v.anulado ? "SI" : "NO"
            ];
        } else {
            const payloadFiscal = v.despacho_fiscal?.payload_canonico;
            const base = payloadFiscal ? payloadFiscal.totales?.base_gravable : (v.desglose_tributario?.base_gravable || 0);
            const iva = payloadFiscal ? payloadFiscal.totales?.impuesto_iva : (v.desglose_tributario?.iva_19 || 0);
            const exento = payloadFiscal ? payloadFiscal.totales?.total_exento : (v.desglose_tributario?.exento || 0);
            const cufe = v.despacho_fiscal?.cufe || "SIN_CUFE";
            const estadoDian = v.despacho_fiscal?.estado || (v.factura_electronica ? "PENDIENTE" : "POS_ESTANDAR");

            fila = [
                v.ticketIdLocal || v.id_firestore,
                fecha,
                hora,
                v.total || 0,
                v.metodo_pago || "EFECTIVO",
                base,
                iva,
                exento,
                estadoDian,
                cufe,
                v.anulado ? "SI" : "NO"
            ];
        }
        contenidoCsv += fila.join(separador) + "\r\n";
    });


    const blob = new Blob([contenidoCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Libro_Ventas_${AppState.idNegocio}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    UI.showToast("Libro contable CSV generado y descargado (0 ms).");
}

// 11. IMPRESION TERMICA DE INFORME GERENCIAL (58MM / 80MM)
function imprimirInformeGerencialTermico() {
    const contenedor = document.getElementById('contenedor-impresion-termica');
    if (!contenedor) return;

    const fechaHoy = new Date().toLocaleString();
    const k = AppState.kpisCalculados;

    contenedor.innerHTML = `
        <div style="width: 100%; text-align: center; font-size: 11px; line-height: 1.3;">
            <p style="font-weight: 900; margin: 0;">GEOKATU B2B ENTERPRISE</p>
            <p style="margin: 2px 0;">INFORME GERENCIAL RESUMEN</p>
            <p style="margin: 2px 0;">${fechaHoy}</p>
            <p style="margin: 2px 0;">RANGO: ${AppState.rangoActivo}</p>
            <p style="margin: 2px 0;">MONEDA: ${AppState.pais === 'VEN' ? 'USD' : 'COP'}</p>
            <p>================================</p>
            <div style="text-align: left; font-size: 10.5px;">
                <p>VENTAS NETAS: ${MonedaFormatter.formatear(k.ventasNetas)}</p>
                <p>COSTO MERCANCIA (CPP): ${MonedaFormatter.formatear(k.cogsTotal)}</p>
                <p>UTILIDAD BRUTA: ${MonedaFormatter.formatear(k.utilidadBruta)}</p>
                <p>MARGEN BRUTO: ${k.margenPct.toFixed(1)}%</p>
                <p>TICKETS VALIDOS: ${k.ordenesValidas}</p>
                <p>TICKETS ANULADOS: ${k.ordenesAnuladas}</p>
                <p>TICKET PROMEDIO: ${MonedaFormatter.formatear(k.aov)}</p>
                <p>--------------------------------</p>
                <p>DESGLOSE RECAUDO:</p>
                <p> - EFECTIVO: ${MonedaFormatter.formatear(k.splitEfectivo)}</p>
                <p> - TARJETA/DATAFONO: ${MonedaFormatter.formatear(k.splitTarjeta)}</p>
                <p> - BILLETERAS/TRANSF: ${MonedaFormatter.formatear(k.splitDigital)}</p>
                <p>--------------------------------</p>
                <p>AUDITORIA Y GASTOS CAJA:</p>
                <p> - DESCUADRE ARQUEOS: ${MonedaFormatter.formatear(k.descuadreArqueo)}</p>
                <p> - SALIDAS MENORES: ${MonedaFormatter.formatear(k.salidasMenores)}</p>
                <p> - MERMAS / BAJAS WMS: ${MonedaFormatter.formatear(k.mermasPerdidas)}</p>
                <p> - AJUSTES ANAQUEL: ${k.discrepanciasConteo}</p>
                <p>--------------------------------</p>
                ${AppState.pais === 'VEN' ? `
                <p>TELEMETRIA FISCAL VENEZUELA:</p>
                <p> - COMPROBANTES: ${k.dianExitosos}</p>
                <p> - RECAUDO IGTF 3%: ${MonedaFormatter.formatear(k.dianContingencia)}</p>
                ` : `
                <p>TELEMETRIA FISCAL DIAN:</p>
                <p> - EMISIONES CUFE OK: ${k.dianExitosos}</p>
                <p> - CONTINGENCIA TIPO 04: ${k.dianContingencia}</p>
                `}

            </div>
            <p>================================</p>
            <p style="margin-top: 10px;">FIRMA AUDITOR / ADMINISTRADOR</p>
            <br><br>
            <p>________________________________</p>
        </div>
    `;

    window.print();
}

// 12. ENRUTAMIENTO, EVENTOS Y DESTRUCCION DE MEMORIA
function vincularEventosUI() {
    // Regresar a la suite administrativa
    const btnRegresar = document.getElementById('btn-regresar');
    if (btnRegresar) {
        btnRegresar.addEventListener('click', () => {
            window.location.href = `/oficina${AppState.idNegocio ? '?id=' + AppState.idNegocio : ''}`;
        });
    }

    // Selector de rango
    const strip = document.getElementById('range-strip');
    if (strip) {
        strip.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-range-chip');
            if (!btn) return;

            const rango = btn.dataset.rango;
            if (rango === "CUSTOM") {
                const modal = document.getElementById('modal-custom-range');
                if (modal) modal.classList.add('activo');
                return;
            }

            document.querySelectorAll('.btn-range-chip').forEach(b => b.classList.remove('activo'));
            btn.classList.add('activo');
            AppState.rangoActivo = rango;
            sincronizarMetricas();
        });
    }

    // Modal de rango personalizado
    const btnCerrarModal = document.getElementById('btn-cerrar-modal-rango');
    if (btnCerrarModal) {
        btnCerrarModal.addEventListener('click', () => {
            document.getElementById('modal-custom-range').classList.remove('activo');
        });
    }

    const btnAplicarRango = document.getElementById('btn-aplicar-rango-custom');
    if (btnAplicarRango) {
        btnAplicarRango.addEventListener('click', () => {
            const d = document.getElementById('input-custom-desde').value;
            const h = document.getElementById('input-custom-hasta').value;
            if (!d || !h) {
                UI.showToast("Selecciona ambas fechas para aplicar el filtro.");
                return;
            }
            AppState.fechaInicioISO = new Date(d).toISOString();
            AppState.fechaFinISO = new Date(h).toISOString();
            AppState.rangoActivo = "CUSTOM";

            document.querySelectorAll('.btn-range-chip').forEach(b => b.classList.remove('activo'));
            const customBtn = document.querySelector('.btn-range-chip[data-rango="CUSTOM"]');
            if (customBtn) customBtn.classList.add('activo');

            document.getElementById('modal-custom-range').classList.remove('activo');
            sincronizarMetricas();
        });
    }

    // Acciones del dock inferior
    const btnExportar = document.getElementById('btn-exportar-auditoria');
    if (btnExportar) {
        btnExportar.addEventListener('click', exportarLibroContableCSV);
    }

    const btnImprimir = document.getElementById('btn-imprimir-informe');
    if (btnImprimir) {
        btnImprimir.addEventListener('click', imprimirInformeGerencialTermico);
    }

    // Listeners de Red y Visibilidad
    window.addEventListener('online', () => { UI.actualizarPillRed(); sincronizarMetricas(); });
    window.addEventListener('offline', () => { UI.actualizarPillRed(); });

    // Cancelar listeners al salir para no devorar la RAM (< 45 MB)
    window.addEventListener('beforeunload', () => {
        if (AppState.suscripcionVentasHoy) AppState.suscripcionVentasHoy();
        if (AppState.timerReloj) clearInterval(AppState.timerReloj);
    });
}

// 13. BOOTSTRAP PRINCIPAL
document.addEventListener('DOMContentLoaded', async () => {
    const tenantUid = await resolverTenantActivo();
    if (!tenantUid) return;

    vincularEventosUI();
    hidratarDesdeCacheLocal();
    UI.actualizarPillRed();

    AppState.timerReloj = setInterval(() => {
        UI.actualizarReloj();
    }, 1000);

    // Sincronización diferencial con Firestore
    await sincronizarMetricas();
});

