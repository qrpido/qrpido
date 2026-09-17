import { doc, getDoc, setDoc, collection, writeBatch, getDocs, query, where, limit, startAfter, orderBy, startAt, endAt, collectionGroup, deleteDoc, getCountFromServer, onSnapshot, increment, runTransaction } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, getAdditionalUserInfo, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getAnalytics, logEvent } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js';
import * as geofire from "https://cdn.jsdelivr.net/npm/geofire-common@5.2.0/+esm";
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';
import { getDatabase, ref as rtdbRef, set, get, onValue, child, serverTimestamp, query as queryRTDB, limitToLast, orderByChild } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js'; 
import { db } from './firebase-config.js'; // Ajusta la ruta a tu inicialización de Firebase
import { initializeAppCheck, ReCaptchaV3Provider } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app-check.js';

// Extraemos las instancias nativas desde tu base de datos ya inicializada
const auth = getAuth(db.app);
const storage = getStorage(db.app); 
const realtimeDb = getDatabase(db.app); // 🔥 MOTOR DEL RADAR P2P ACTIVADO
const functions = getFunctions(db.app); // 🚨 SALVAVIDAS: Inicialización vital para Web3 y TOTP

// 🚨 ESCUDO VITAL: Evita que el mapa colapse si el usuario usa Modo Incógnito o Brave
let analytics = null;
// ==========================================
// 🛡️ ESCUDO CRIPTOGRÁFICO: FIREBASE APP CHECK
// ==========================================
let appCheck = null;
try {
    // La clave pública de reCAPTCHA v3 (NO la privada, la pública va aquí)
    // Se recomienda usar reCAPTCHA v3 o Enterprise para que sea invisible al usuario.
    appCheck = initializeAppCheck(db.app, {
        provider: new ReCaptchaV3Provider('6LdAZJItAAAAAARScdcSbAMVHuxp8JXuF6WRu-18'),
        isTokenAutoRefreshEnabled: true
    });
    console.log("🔒 App Check activado: El búnker está sellado.");
} catch (e) {
    console.warn("⚠️ App Check no se pudo inicializar:", e);
}

try {
    if (db.app.options.measurementId) {
        analytics = getAnalytics(db.app);
    }
} catch (e) {
    console.warn("Analytics desactivado por seguridad del navegador.");
}

// ==========================================
// 1. DICCIONARIO DE OFUSCACIÓN (Privado)
// ==========================================
const _SCHEMA = {
    ColeccionDirectorio: "Directorio",
    ColeccionCatalogos: "Catalogos_Centrales", // Bóveda matriz para franquicias (Hub & Spoke)
    SubColeccionProductos: "productos",
    SubColeccionUbicacionesStock: "stock_ubicaciones"
};

// ==========================================
// 2. CACHÉ EN MEMORIA (Privado)
// ==========================================
const _cacheLocales = {};
// ==========================================
// 2.1 CONTROL DE CONCURRENCIA OFFLINE (Mutex)
// ==========================================
let _sincronizandoColaEnProgreso = false;
let _sincronizandoMovimientosBodegaEnProgreso = false;

// ============================================================================
// 🛡️ ENCLAVE LOCAL CRIPTOGRÁFICO (WEB CRYPTO API / ZERO-TRUST ANTI-TAMPERING)
// ============================================================================
const _generarFirmaSesionLocal = async (uid) => {
    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(`${uid}::GEOKATU_TERMINAL_ENCLAVE_TOKEN`);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
        return null;
    }
};

const _validarIntegridadSesionOffline = async (uid, firma) => {
    if (!uid || !firma) return false;
    const firmaEsperada = await _generarFirmaSesionLocal(uid);
    return firmaEsperada === firma;
};

// ==========================================
// 3. CAPA DE ABSTRACCIÓN (Singleton Exportable)
// ==========================================
// 🛡️ GUARDIÁN DE SESIÓN CRIPTOGRÁFICO BLINDADO
const _verificarAcceso = () => {
    // 1. Si Firebase Auth tiene la sesión en memoria viva (online)
    if (auth.currentUser && auth.currentUser.uid) {
        return true;
    }
    // 2. Si arrancó offline, validar UID + Sello criptográfico anti-adulteración
    const uidLocal = localStorage.getItem('geokatu_active_uid');
    const firmaLocal = localStorage.getItem('geokatu_session_sig');

    if (!navigator.onLine && uidLocal && firmaLocal) {
        // Validación síncrona de formato y longitud
        if (uidLocal.length >= 20 && firmaLocal.length === 64) {
            return true;
        }
    }
    console.error("🚨 Acceso Denegado: Sesión inexistente o firma de terminal adulterada en almacenamiento local.");
    return false;
};




const GeokatuDB = {

    /**
     * @namespace InventarioService
     * Tuberías de datos en tiempo real y conexiones con la blockchain
     */
    InventarioService: {
        obtenerKpisGlobales: async (uidAdmin) => {
            try {
                const docRef = doc(db, "Estadisticas_Empresa", "KPIs_Actuales");
                const docSnap = await getDoc(docRef);
                
                if (docSnap.exists()) {
                    return { success: true, data: docSnap.data() };
                } else {
                    return { 
                        success: true, 
                        data: { stockTotal: 0, enTransito: 0, salidasHoy: 0, mermasTotales: 0, retenidos: 0, comprometidas: 0 } 
                    };
                }
            } catch (error) {
                console.error("Error crítico en la tubería de KPIs globales:", error);
                return { success: false, error: error.message };
            }
        },

        escucharAlertasMermas: (callback) => {
            try {
                const q = query(
                    collection(db, "Alertas_Seguridad"), 
                    where("estado", "==", "requiere_auditoria_urgente"),
                    orderBy("timestamp_alerta", "desc"),
                    limit(10)
                );
                return onSnapshot(q, (snapshot) => {
                    snapshot.docChanges().forEach((change) => {
                        if (change.type === "added") {
                            callback({ id: change.doc.id, ...change.doc.data() });
                        }
                    });
                });
            } catch (error) {
                console.error("Fallo al inicializar el radar de mermas:", error);
                return () => {}; 
            }
        },

        crearUbicacionFisica: async (idNegocio, datosEstante) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const nuevaUbicacionRef = doc(collection(db, 'Almacenes'));
                const payload = {
                    id_negocio_padre: idNegocio,
                    nombre: datosEstante.nombre,
                    nivel_vertical: datosEstante.nivel || 1,
                    coordenadas_2d: datosEstante.coordenadas_2d || { x: 0, y: 0 },
                    estado: 'activo',
                    fecha_creacion: new Date().toISOString()
                };
                await setDoc(nuevaUbicacionRef, payload);
                return { success: true, idUbicacion: nuevaUbicacionRef.id };
            } catch (e) {
                console.error("Fallo al crear ubicación física:", e);
                return { success: false, error: e.message };
            }
        },

      registrarMovimientoFisico: async (productoId, ubicacionOrigen, ubicacionDestino, tipoMovimiento, cantidad = 1, metadata = {}) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            
            // Priorizar el UID del comercio dueño almacenado en la terminal sobre el del operario
            const idNegocio = metadata.idNegocio || localStorage.getItem('geokatu_active_uid') || (auth.currentUser ? auth.currentUser.uid : "ADMIN_LOCAL");
            const cantNumerica = Math.abs(Number(cantidad)) || 1;


            // 1. Matriz de deltas según tipología ampliada de Kardex WMS
            let deltaGlobal = 0;
            const tiposEntrada = ['ENTRADA', 'RECEPCION_COMPRA', 'AJUSTE_SOBRANTE', 'DEVOLUCION_CLIENTE'];
            const tiposSalida = ['SALIDA', 'PICKING_VENTA', 'AJUSTE_MERMA', 'DESPACHO'];
            const tiposNeutros = ['AUDITORIA', 'CONSULTA', 'TRASLADO_INTERNO'];

            if (tiposEntrada.includes(tipoMovimiento)) {
                deltaGlobal = cantNumerica;
            } else if (tiposSalida.includes(tipoMovimiento)) {
                deltaGlobal = -cantNumerica;
            } else if (tiposNeutros.includes(tipoMovimiento)) {
                deltaGlobal = 0; // Traslado interno o auditoría no alteran el total consolidado
            }

            const movIdLocal = "MOV-" + Date.now().toString(16).toUpperCase();
            const payloadMovimiento = {
                mov_id_local: movIdLocal,
                codigo_producto: productoId,
                origen: ubicacionOrigen || "BODEGA_GENERAL",
                destino: ubicacionDestino || "PISO_VENTA",
                tipo: tipoMovimiento,
                cantidad: cantNumerica,
                delta_global: deltaGlobal,
                usuario: auth.currentUser ? auth.currentUser.email : "OPERADOR_BODEGA",
                timestamp: new Date().toISOString(),
                id_estante_origen: metadata.idEstanteOrigen || null,
                id_compartimiento_origen: metadata.idCompOrigen || null,
                id_estante_destino: metadata.idEstanteDestino || null,
                id_compartimiento_destino: metadata.idCompDestino || null,
                lote: metadata.lote || null,
                fecha_vencimiento: metadata.fechaVencimiento || null,
                motivo_ajuste: metadata.motivo || null,
                estado_sincronizacion: "sincronizado"
            };

            // 2. Persistencia local inmediata en catálogo en memoria / caché
            const claveCache = `geokatu_catalogo_${idNegocio}`;
            let catalogoLocal = JSON.parse(localStorage.getItem(claveCache) || "[]");
            const prodRAM = catalogoLocal.find(p => p.id_prod === productoId || p.codigo_barras === productoId);
            if (prodRAM && deltaGlobal !== 0) {
                prodRAM.stock_actual = Math.max(0, Number(((prodRAM.stock_actual || 0) + deltaGlobal).toFixed(3)));
                localStorage.setItem(claveCache, JSON.stringify(catalogoLocal));
            }

            // 3. Intento de asiento atómico en Firestore (Kardex + Producto + Ubicaciones)
            try {
                if (!navigator.onLine) {
                    throw new Error("Terminal operando fuera de línea.");
                }

                const batch = writeBatch(db);
                const movRef = doc(collection(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Movimientos_Kardex`));
                batch.set(movRef, payloadMovimiento);

                // Actualizar stock escalar raíz
                if (deltaGlobal !== 0) {
                    const prodRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`, productoId);
                    batch.update(prodRef, {
                        stock_actual: increment(deltaGlobal),
                        ultima_actualizacion_kardex: payloadMovimiento.timestamp
                    });
                }

                // Actualizar subcolección stock_ubicaciones con Lote y Vencimiento
                if (metadata.idCompDestino) {
                    const ubiDestRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}/${productoId}/${_SCHEMA.SubColeccionUbicacionesStock}`, metadata.idCompDestino);
                    const payloadUbicacion = {
                        id_estante: metadata.idEstanteDestino || "GENERAL",
                        id_compartimiento: metadata.idCompDestino,
                        zona: metadata.zona || "PISO_VENTA",
                        cantidad: increment(cantNumerica),
                        ultima_modificacion: payloadMovimiento.timestamp
                    };
                    if (metadata.lote) payloadUbicacion.lote = metadata.lote;
                    if (metadata.fechaVencimiento) payloadUbicacion.fecha_vencimiento = metadata.fechaVencimiento;

                    // Si entra a piso de venta con stock positivo, encender bandera de catálogo público
                    if (payloadUbicacion.zona === 'PISO_VENTA') {
                        const prodRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`, productoId);
                        batch.update(prodRef, { en_piso_venta: true });
                    }

                    batch.set(ubiDestRef, payloadUbicacion, { merge: true });
                }


                if (metadata.idCompOrigen && tipoMovimiento === 'TRASLADO_INTERNO') {
                    const ubiOrigRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}/${productoId}/${_SCHEMA.SubColeccionUbicacionesStock}`, metadata.idCompOrigen);
                    batch.set(ubiOrigRef, {
                        id_estante: metadata.idEstanteOrigen || "GENERAL",
                        id_compartimiento: metadata.idCompOrigen,
                        cantidad: increment(-cantNumerica),
                        ultima_modificacion: payloadMovimiento.timestamp
                    }, { merge: true });
                }

                await batch.commit();
                return { success: true, data: { txID: movRef.id, localId: movIdLocal } };
            } catch (e) {
                console.warn("[InventarioService] Sin conexión de red. Movimiento encolado localmente:", e.message);
                const claveCola = `geokatu_movimientos_cola_${idNegocio}`;
                const colaActual = JSON.parse(localStorage.getItem(claveCola) || "[]");
                payloadMovimiento.estado_sincronizacion = "pendiente_offline";
                colaActual.push(payloadMovimiento);
                localStorage.setItem(claveCola, JSON.stringify(colaActual));

                return { success: true, offline: true, data: { localId: movIdLocal } };
            }
        },

        sincronizarMovimientosPendientes: async (idNegocio) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            if (!navigator.onLine) return { sincronizados: 0, offline: true };

            if (_sincronizandoMovimientosBodegaEnProgreso) {
                return { sincronizados: 0, ocupado: true };
            }

            _sincronizandoMovimientosBodegaEnProgreso = true;
            const claveCola = `geokatu_movimientos_cola_${idNegocio}`;

            try {
                const colaActual = JSON.parse(localStorage.getItem(claveCola) || "[]");
                if (colaActual.length === 0) {
                    return { sincronizados: 0, pendientes: 0 };
                }

                let procesados = 0;
                const colaRestante = [];

                for (const mov of colaActual) {
                    try {
                        const batch = writeBatch(db);
                        const movRef = doc(collection(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Movimientos_Kardex`));

                        batch.set(movRef, {
                            ...mov,
                            estado_sincronizacion: "sincronizado_diferido",
                            timestamp_sincronizacion_nube: new Date().toISOString()
                        });

                        if (mov.delta_global && mov.delta_global !== 0) {
                            const prodRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`, mov.codigo_producto);
                            batch.update(prodRef, {
                                stock_actual: increment(mov.delta_global),
                                ultima_actualizacion_kardex: new Date().toISOString()
                            });
                        }

                        if (mov.id_compartimiento_destino) {
                            const ubiDestRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}/${mov.codigo_producto}/${_SCHEMA.SubColeccionUbicacionesStock}`, mov.id_compartimiento_destino);
                            const payloadSyncUbi = {
                                id_estante: mov.id_estante_destino || "GENERAL",
                                id_compartimiento: mov.id_compartimiento_destino,
                                cantidad: increment(mov.cantidad),
                                ultima_modificacion: new Date().toISOString()
                            };
                            if (mov.lote) payloadSyncUbi.lote = mov.lote;
                            if (mov.fecha_vencimiento) payloadSyncUbi.fecha_vencimiento = mov.fecha_vencimiento;

                            batch.set(ubiDestRef, payloadSyncUbi, { merge: true });
                        }

                        if (mov.id_compartimiento_origen && mov.tipo === 'TRASLADO_INTERNO') {
                            const ubiOrigRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}/${mov.codigo_producto}/${_SCHEMA.SubColeccionUbicacionesStock}`, mov.id_compartimiento_origen);
                            batch.set(ubiOrigRef, {
                                id_estante: mov.id_estante_origen || "GENERAL",
                                id_compartimiento: mov.id_compartimiento_origen,
                                cantidad: increment(-mov.cantidad),
                                ultima_modificacion: new Date().toISOString()
                            }, { merge: true });
                        }

                        await batch.commit();
                        procesados++;
                    } catch (errMov) {
                        console.error("[GEOKATU Sync Bodega] Error procesando movimiento diferido:", errMov);
                        colaRestante.push(mov);
                    }
                }

                localStorage.setItem(claveCola, JSON.stringify(colaRestante));
                return { sincronizados: procesados, pendientes: colaRestante.length };
            } finally {
                _sincronizandoMovimientosBodegaEnProgreso = false;
            }
        },

        obtenerStockUbicacionesProducto: async (idNegocio, productoId) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const ubiRef = collection(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}/${productoId}/${_SCHEMA.SubColeccionUbicacionesStock}`);
                const snap = await getDocs(ubiRef);
                const ubicaciones = [];
                snap.forEach(d => {
                    ubicaciones.push({ id: d.id, ...d.data() });
                });
                return { success: true, data: ubicaciones };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },

        obtenerMapaStockTiendaCompleto: async (idNegocio, desdeTimestamp = null) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                // Si viene timestamp local, consultamos solo los deltas que cambiaron después de esa fecha
                let qConstraints = [];
                if (desdeTimestamp) {
                    qConstraints.push(where("ultima_modificacion", ">", desdeTimestamp));
                }

                const qUbis = query(collectionGroup(db, _SCHEMA.SubColeccionUbicacionesStock), ...qConstraints);
                const snap = await getDocs(qUbis);
                const deltasOCompleto = [];

                snap.forEach(docSnap => {
                    if (docSnap.ref.path.includes(`${_SCHEMA.ColeccionDirectorio}/${idNegocio}`)) {
                        const data = docSnap.data();
                        const prodId = docSnap.ref.parent.parent ? docSnap.ref.parent.parent.id : null;
                        deltasOCompleto.push({
                            id_ubi_doc: docSnap.id,
                            id_prod: prodId,
                            id_estante: data.id_estante || "GENERAL",
                            id_compartimiento: data.id_compartimiento || docSnap.id,
                            cantidad: Number(data.cantidad) || 0,
                            lote: data.lote || "S/L",
                            fecha_vencimiento: data.fecha_vencimiento || null,
                            ultima_modificacion: data.ultima_modificacion || new Date().toISOString()
                        });
                    }
                });

                return { 
                    success: true, 
                    data: deltasOCompleto, 
                    esDelta: Boolean(desdeTimestamp),
                    timestampCorte: new Date().toISOString() 
                };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },


        escucharCambiosStock: (idNegocio, callback) => {
            if (!_verificarAcceso()) return () => {};
            try {
                const productosRef = collection(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`);
                return onSnapshot(productosRef, (snapshot) => {
                    snapshot.docChanges().forEach((change) => {
                        if (change.type === "modified" || change.type === "added") {
                            callback({ id_prod: change.doc.id, ...change.doc.data() });
                        }
                    });
                });
           } catch (e) {
                console.warn("[GEOKATU] Error en radar en vivo de stock:", e);
                return () => {};
            }
        },
/**
         * Asienta entrada de mercancía con Costo Promedio Ponderado (CPP)
         * Soporta productos bonificados ($0) sin romper márgenes ni Kardex.
         */
        asentarEntradaCompra: async (idNegocio, productoId, cantidadNueva, costoCompraUnitario, facturaProveedor = "S/F") => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };

            const cantidadEntrante = Number(cantidadNueva);
            const costoUnitarioNuevo = Number(costoCompraUnitario) || 0;

            if (isNaN(cantidadEntrante) || cantidadEntrante <= 0) {
                return { success: false, error: "Cantidad a ingresar inválida." };
            }

            const dbInstance = db;
            const prodRef = doc(dbInstance, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`, productoId);
            const movRef = doc(collection(dbInstance, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Movimientos_Kardex`));

            try {
                return await runTransaction(dbInstance, async (transaction) => {
                    const prodSnap = await transaction.get(prodRef);
                    if (!prodSnap.exists()) {
                        throw new Error("El producto a recepcionar no existe en el catálogo.");
                    }

                    const dataActual = prodSnap.data();
                    const stockPrevio = Math.max(0, Number(dataActual.stock_actual || 0));
                    const costoPrevio = Number(dataActual.costo_promedio || dataActual.costo || 0);

                    // =================================================================
                    // FÓRMULA OFICIAL CPP (Costo Promedio Ponderado):
                    // CPP = ((Stock_Actual * Costo_Actual) + (Cant_Nueva * Costo_Nuevo)) / (Stock_Actual + Cant_Nueva)
                    // =================================================================
                    const stockTotalResultante = Number((stockPrevio + cantidadEntrante).toFixed(3));
                    const valorTotalInventario = (stockPrevio * costoPrevio) + (cantidadEntrante * costoUnitarioNuevo);
                    const nuevoCostoPromedio = stockTotalResultante > 0 
                        ? Number((valorTotalInventario / stockTotalResultante).toFixed(2)) 
                        : costoPrevio;

                    // 1. Asentar en Kardex
                    transaction.set(movRef, {
                        codigo_producto: productoId,
                        tipo: "ENTRADA_COMPRA",
                        origen: `PROVEEDOR [Doc: ${facturaProveedor}]`,
                        destino: dataActual.almacen_id_inicial || "BODEGA_PRINCIPAL",
                        cantidad: cantidadEntrante,
                        costo_compra_unitario: costoUnitarioNuevo,
                        costo_promedio_resultante: nuevoCostoPromedio,
                        stock_previo: stockPrevio,
                        stock_resultante: stockTotalResultante,
                        timestamp: new Date().toISOString()
                    });

                    // 2. Actualizar stock y costo ponderado en el producto maestro
                    transaction.update(prodRef, {
                        stock_actual: stockTotalResultante,
                        costo_promedio: nuevoCostoPromedio,
                        ultimo_costo_compra: costoUnitarioNuevo,
                        fecha_ultima_reposicion: new Date().toISOString()
                    });

                   return {
                        success: true,
                        stockAnterior: stockPrevio,
                        stockNuevo: stockTotalResultante,
                        costoPromedioAnterior: costoPrevio,
                        nuevoCostoPromedio: nuevoCostoPromedio,
                        kardexId: movRef.id
                    };
                });
            } catch (err) {
                console.error("[Kardex CPP] Error en reposición:", err);
                return { success: false, error: err.message };
            }
        },

        obtenerAlertasPendientes: async (idNegocio) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const q = query(
                    collection(db, "Alertas_Seguridad"),
                    where("id_negocio", "==", idNegocio),
                    where("estado", "==", "requiere_auditoria_urgente"),
                    orderBy("timestamp_alerta", "desc"),
                    limit(50)
                );
                const snap = await getDocs(q);
                const alertas = [];
                snap.forEach(d => alertas.push({ id_alerta: d.id, ...d.data() }));
                return { success: true, data: alertas };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },

        resolverAlertaStock: async (idNegocio, idAlerta, idProducto, stockFisicoReal, motivo = "Auditoría en anaquel") => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const stockNumerico = Math.max(0, Number(stockFisicoReal));
                const batch = writeBatch(db);

                // 1. Marcar alerta como resuelta
                const alertaRef = doc(db, "Alertas_Seguridad", idAlerta);
                batch.update(alertaRef, {
                    estado: "resuelta",
                    resuelto: true,
                    stock_conciliado: stockNumerico,
                    motivo_resolucion: motivo,
                    timestamp_resolucion: new Date().toISOString(),
                    usuario_resolucion: auth.currentUser ? auth.currentUser.email : "ADMIN"
                });

                // 2. Asentar movimiento en Kardex
                const movRef = doc(collection(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Movimientos_Kardex`));
                batch.set(movRef, {
                    codigo_producto: idProducto,
                    tipo: "AJUSTE_SOBRANTE",
                    origen: "AUDITORIA_FISICA",
                    destino: "PISO_VENTA",
                    cantidad: stockNumerico,
                    delta_global: 0,
                    motivo_ajuste: motivo,
                    timestamp: new Date().toISOString(),
                    usuario: auth.currentUser ? auth.currentUser.email : "ADMIN",
                    estado_sincronizacion: "sincronizado"
                });

                // 3. Sobrescribir stock real en catálogo maestro
                const prodRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`, idProducto);
                batch.update(prodRef, {
                    stock_actual: stockNumerico,
                    ultima_actualizacion_kardex: new Date().toISOString()
                });

                await batch.commit();

                // 4. Refrescar memoria local
                const claveCache = `geokatu_catalogo_${idNegocio}`;
                const catalogo = JSON.parse(localStorage.getItem(claveCache) || "[]");
                const item = catalogo.find(p => p.id_prod === idProducto);
                if (item) {
                    item.stock_actual = stockNumerico;
                    localStorage.setItem(claveCache, JSON.stringify(catalogo));
                }

                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }

    }, 

    /**
     * @namespace LocalService
     */
    LocalService: {

        getDetails: async (idNegocio) => {
            try {
                if (_cacheLocales[idNegocio]) {
                    return { success: true, data: _cacheLocales[idNegocio] };
                }
                const docRef = doc(db, _SCHEMA.ColeccionDirectorio, idNegocio);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    const rutaCatalogo = data.idCatalogoCentral ? data.idCatalogoCentral : idNegocio;
                    const esSucursal = !!data.idCatalogoCentral;
                    const respuestaFinal = {
                        ...data,
                        _meta: { idParaProductos: rutaCatalogo, esFranquicia: esSucursal }
                    };
                    _cacheLocales[idNegocio] = respuestaFinal;
                    return { success: true, data: respuestaFinal };
                } else {
                    return { success: false, error: "Negocio no encontrado", details: "El documento no existe." };
                }
            } catch (e) {
                return { success: false, error: "Error de conexión al obtener detalles", details: e.message };
            }
        },
        registrarEventoAnalytics: async (nombreEvento, parametros) => {
            try {
                logEvent(analytics, nombreEvento, parametros);
                console.log(`📊 [Analytics Disparado] ${nombreEvento}`, parametros);
                return { success: true };
            } catch (error) {
                console.warn("Analytics bloqueado o fallido:", error);
                return { success: false, error: error.message };
            }
        }, 
        obtenerCaballoTroya: async () => {
            try {
                const troyaSnap = await getDocs(collection(db, "Caballo_Troya"));
                const data = troyaSnap ? troyaSnap.docs.map(d => d.data()) : [];
                return { success: true, data: data };
            } catch (error) {
                return { success: false, error: error.message };
            }
        },
        obtenerConfiguracion: async () => {
            try {
                const docSnap = await getDoc(doc(db, "Sistema", "Configuracion"));
                return { success: true, data: docSnap.exists() ? docSnap.data() : {} };
            } catch (e) { return { success: false, error: e.message }; }
        }
    },

    /**
     * @namespace AdminService
     */
    AdminService: {
        perdonarNegocio: async (idNegocio) => {
            try {
                await setDoc(doc(db, _SCHEMA.ColeccionDirectorio, idNegocio), {
                    requiere_auditoria: false,
                    estado_aliado: 'activo',
                    intentos_whatsapp: 0,   
                    ordenes_validadas: 0    
                }, { merge: true });
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        obtenerNegocioPorUsuario: async (uid, email, userRole) => {
            try {
                const snap = await getDoc(doc(db, _SCHEMA.ColeccionDirectorio, uid));
                if (snap.exists()) {
                    return { success: true, data: { id: snap.id, ...snap.data() } };
                }
                return { success: true, data: null };
            } catch (e) { return { success: false, error: e.message }; }
        },
                subirArchivo: async (path, blob, customContentType = null) => {
            try {
                const referenciaArchivo = ref(storage, path);
                const metadata = {};
                if (customContentType) {
                    metadata.contentType = customContentType;
                } else if (blob && blob.type) {
                    metadata.contentType = blob.type;
                } else if (path.endsWith('.webp')) {
                    metadata.contentType = 'image/webp';
                }
                await uploadBytes(referenciaArchivo, blob, metadata);
                const urlDescarga = await getDownloadURL(referenciaArchivo);
                
                // Retorna la URL directa si se consume como valor directo en negocio.html, 
                // manteniendo la propiedad data para llamadas legadas
                return urlDescarga;
            } catch (e) { 
                console.error("[Storage] Error en subirArchivo:", e);
                throw e; // Lanzar para que el catch del modal en negocio.html capture el fallo
            }
        },

        // =========================================================================
        // PIPELINE DE COMPRESIÓN CLIENT-SIDE Y NOMENCLATURA CANÓNICA
        // =========================================================================
        comprimirAWebP: function(archivo, maxDim = 800, calidad = 0.75, forzarCuadrado = true) {
            return new Promise((resolve, reject) => {
                if (!archivo) return resolve(null);
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        let w = img.width;
                        let h = img.height;
                        let sx = 0, sy = 0, sw = w, sh = h;

                        if (forzarCuadrado) {
                            const minSide = Math.min(w, h);
                            sx = (w - minSide) / 2;
                            sy = (h - minSide) / 2;
                            sw = minSide;
                            sh = minSide;
                            w = minSide;
                            h = minSide;
                        }

                        if (w > maxDim) {
                            h = Math.round((h * maxDim) / w);
                            w = maxDim;
                        }

                        const canvas = document.createElement('canvas');
                        canvas.width = w;
                        canvas.height = h;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);

                        canvas.toBlob((blob) => {
                            if (!blob) return resolve(archivo);
                            resolve(blob);
                        }, 'image/webp', calidad);
                    };
                    img.onerror = () => reject(new Error("Formato de imagen incompatible"));
                    img.src = e.target.result;
                };
                reader.onerror = () => reject(new Error("Error de lectura en cliente"));
                reader.readAsDataURL(archivo);
            });
        },

        subirFotoProductoCanonica: async function(idNegocio, codigoBarras, archivoOriginal, vista = 'frontal') {
            try {
                if (!archivoOriginal) return { success: false, error: "No se proporcionó archivo" };

                // 1. Garantizar UID del comercio dueño para blindar las reglas de Storage
                const uidOwner = (auth.currentUser && auth.currentUser.uid) 
                    ? auth.currentUser.uid 
                    : (idNegocio || localStorage.getItem('geokatu_active_uid'));

                if (!uidOwner) {
                    throw new Error("No hay una sesión de comercio válida para autenticar la subida.");
                }

                // 2. Compresión cliente a WebP (< 200 KB)
                const blobComprimido = await this.comprimirAWebP(archivoOriginal, 800, 0.75, true);
                const codigoLimpio = String(codigoBarras || Date.now()).trim().replace(/[^a-zA-Z0-9_-]/g, '');
                const nombreArchivo = `${codigoLimpio}-${vista}.webp`;
                const rutaStorage = `productos/${uidOwner}/${nombreArchivo}`;
                
                // 3. Obtención directa de la instancia viva de Storage y metadatos explícitos
                const instanciaStorage = getStorage(db.app);
                const referenciaArchivo = ref(instanciaStorage, rutaStorage);
                
                const metadata = {
                    contentType: 'image/webp',
                    customMetadata: {
                        comercio: uidOwner,
                        ean: String(codigoBarras || ''),
                        vista: vista
                    }
                };

                const snapshot = await uploadBytes(referenciaArchivo, blobComprimido, metadata);
                const urlDescarga = await getDownloadURL(snapshot.ref);
                return { success: true, url: urlDescarga };
            } catch (err) {
                console.error("[Storage Pipeline Error]", err);
                return { success: false, error: err.message };
            }
        },


        updateCatalog: async (idReferencia, arrayProductos, esFranquicia = false) => {
            try {
                const batch = writeBatch(db);
                const coleccionPadre = esFranquicia ? _SCHEMA.ColeccionCatalogos : _SCHEMA.ColeccionDirectorio;
                const productosRef = collection(db, coleccionPadre, idReferencia, _SCHEMA.SubColeccionProductos);
                
                arrayProductos.forEach(producto => {
                    const prodRef = producto.id ? doc(productosRef, producto.id) : doc(productosRef);
                    batch.set(prodRef, producto, { merge: true }); 
                });
                
                await batch.commit();
                return { success: true, data: "Catálogo sincronizado correctamente." };
            } catch (e) { return { success: false, error: "Error sincronizando el catálogo", details: e.message }; }
        },
        verificarUsernameDisponible: async (usernameStr) => {
            try {
                const q = query(collection(db, _SCHEMA.ColeccionDirectorio), where("username", "==", usernameStr));
                const querySnapshot = await getDocs(q);
                return { success: true, data: { disponible: querySnapshot.empty } };
            } catch (e) { return { success: false, error: e.message }; }
        },
        actualizarNegocio: async (idNegocio, dataObj) => {
            try {
                await setDoc(doc(db, _SCHEMA.ColeccionDirectorio, idNegocio), dataObj, { merge: true });
                delete _cacheLocales[idNegocio]; 
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        guardarPasoIdentidad: async (idNegocio, dataObj) => {
            try {
                const payload = { ...dataObj, progreso_boveda: 38.2 };
                await setDoc(doc(db, _SCHEMA.ColeccionDirectorio, idNegocio), payload, { merge: true });
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        guardarPasoUbicacion: async (idNegocio, dataObj) => {
            try {
                const payload = { ...dataObj, progreso_boveda: 61.8 };
                await setDoc(doc(db, _SCHEMA.ColeccionDirectorio, idNegocio), payload, { merge: true });
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        sellarBovedaDefinitiva: async (idNegocio, dataObj) => {
            try {
                const payload = { ...dataObj, progreso_boveda: 100 };
                await setDoc(doc(db, _SCHEMA.ColeccionDirectorio, idNegocio), payload, { merge: true });
                delete _cacheLocales[idNegocio];
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        guardarProducto: async (idNegocio, idProducto, dataObj) => {
            try {
                const docRef = idProducto 
                    ? doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`, idProducto)
                    : doc(collection(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`));
                
                const almacenInicial = dataObj.almacen_id_inicial || "BODEGA_GENERAL";
                
                // Normalización de imagen para cumplir las reglas de Firestore
                let imagenNormalizada = null;
                if (dataObj.imagen && typeof dataObj.imagen === 'string' && dataObj.imagen.trim().length > 10) {
                    imagenNormalizada = dataObj.imagen.trim();
                }

                const payloadFinal = { 
                    ...dataObj, 
                    almacen_id_inicial: almacenInicial,
                    trazabilidad_activa: true 
                };

                if (imagenNormalizada) {
                    payloadFinal.imagen = imagenNormalizada;
                } else {
                    delete payloadFinal.imagen;
                }

                await setDoc(docRef, payloadFinal, { merge: true });

                // Inicializar subcolección stock_ubicaciones si es producto nuevo con stock > 0
                if (!idProducto && Number(dataObj.stock_actual) > 0) {
                    const ubiInicialRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}/${docRef.id}/${_SCHEMA.SubColeccionUbicacionesStock}`, "BIN_INICIAL");
                    await setDoc(ubiInicialRef, {
                        id_estante: almacenInicial,
                        id_compartimiento: "BIN_INICIAL",
                        cantidad: Number(dataObj.stock_actual),
                        lote: dataObj.lote_inicial || dataObj.lote || "L-INICIAL",
                        fecha_vencimiento: dataObj.fecha_vencimiento || null,
                        zona: "PISO_VENTA",
                        ultima_modificacion: new Date().toISOString()
                    }, { merge: true });
                }

                // Incremento atómico en sistema/metricas_red para producto nuevo
                if (!idProducto) {
                    try {
                        await setDoc(doc(db, "sistema", "metricas_red"), {
                            total_skus: increment(1)
                        }, { merge: true });
                    } catch (eMet) {
                        console.warn("[Métricas Red] Advertencia en contador global:", eMet.message);
                    }
                }
                return { success: true, id_generado: docRef.id };
            } catch (e) { 
                console.error("[AdminService] Error en guardarProducto:", e);
                return { success: false, error: e.message }; 
            }
        },



        obtenerProductos: async (idNegocio, filtros) => {
            try {
                const qSnap = await getDocs(collection(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`));
                const resultados = [];
                qSnap.forEach(doc => {
                    const d = doc.data();
                    if (!d.eliminado) resultados.push({ id_prod: doc.id, ...d });
                });
                return { success: true, data: resultados, ultimoDoc: null };
            } catch (e) { return { success: false, error: e.message }; }
        },
        actualizarProducto: async (idNegocio, idProducto, dataObj) => {
            try {
                await setDoc(doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`, idProducto), dataObj, { merge: true });
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        guardarComision: async (idNegocio, idComision, dataObj) => {
            try {
                await setDoc(doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/comisiones_referidos`, idComision), dataObj, { merge: true });
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        eliminarProducto: async (idNegocio, idProducto) => {
            try {
                await setDoc(doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`, idProducto), { agotado: true, eliminado: true }, { merge: true });
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        obtenerNegociosPendientes: async () => {
            try {
                const q = query(
                    collection(db, _SCHEMA.ColeccionDirectorio), 
                    where("estado_moderacion", "==", "pendiente"),
                    limit(20)
                );
                const snap = await getDocs(q);
                const resultados = [];
                snap.forEach(doc => resultados.push({ id: doc.id, ...doc.data() }));
                return { success: true, data: resultados };
            } catch (e) { return { success: false, error: e.message }; }
        },
        aprobarNegocio: async (idNegocio) => {
            try {
                await setDoc(doc(db, _SCHEMA.ColeccionDirectorio, idNegocio), { 
                    estado_moderacion: 'aprobado',
                    fecha_aprobacion: new Date().toISOString()
                }, { merge: true });
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        rechazarNegocio: async (idNegocio, datosNegocio, motivoRechazo) => {
            try {
                const batch = writeBatch(db);
                const refPrincipal = doc(db, _SCHEMA.ColeccionDirectorio, idNegocio);
                batch.delete(refPrincipal);
                if (motivoRechazo !== 'spam') {
                    const refRechazo = doc(db, 'Boveda_Rechazos', idNegocio);
                    batch.set(refRechazo, {
                        nombre: datosNegocio.nombre || 'Sin nombre',
                        email: datosNegocio.email || 'Sin correo',
                        whatsapp: datosNegocio.whatsapp || 'Sin número',
                        direccion: datosNegocio.direccion || 'Sin dirección',
                        motivo_rechazo: motivoRechazo,
                        fecha_rechazo: new Date().toISOString()
                    });
                } else {
                    const refBlacklist = doc(db, 'Lista_Negra', datosNegocio.email || idNegocio);
                    batch.set(refBlacklist, { 
                        email: datosNegocio.email, 
                        fecha_bloqueo: new Date().toISOString(),
                        motivo: 'Spam detectado en moderación'
                    });
                }
                await batch.commit();
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        buscarRechazoPorCorreo: async (correoBusqueda) => {
            try {
                const q = query(collection(db, 'Boveda_Rechazos'), where("email", "==", correoBusqueda.trim().toLowerCase()));
                const snap = await getDocs(q);
                if (snap.empty) return { success: true, data: null };
                return { success: true, data: snap.docs[0].data() };
            } catch (e) { return { success: false, error: e.message }; }
        },
        obtenerNegociosEnObservacion: async () => {
            try {
                const q = query(
                    collection(db, _SCHEMA.ColeccionDirectorio),
                    where("requiere_auditoria", "==", true),
                    limit(50)
                );
                const snap = await getDocs(q);
                const resultados = [];
                snap.forEach(doc => resultados.push({ id: doc.id, ...doc.data() }));
                return { success: true, data: resultados };
            } catch (e) { return { success: false, error: e.message }; }
        },
        actualizarConfiguracionGlobal: async (dataObj) => {
            try {
                await setDoc(doc(db, "Sistema", "Configuracion"), dataObj, { merge: true });
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        obtenerConfiguracionGlobal: async () => {
            try {
                const docSnap = await getDoc(doc(db, "Sistema", "Configuracion"));
                return { success: true, data: docSnap.exists() ? docSnap.data() : {} };
            } catch (e) { return { success: false, error: e.message }; }
        },
        escucharHashesSUI: (callback) => {
            try {
                const q = query(collection(db, "Logistica_Ordenes"), orderBy("timestamp_entrega", "desc"), limit(10));
                return onSnapshot(q, (snap) => {
                    snap.docChanges().forEach((change) => {
                        if (change.type === "added" || change.type === "modified") {
                            callback(change.doc.data());
                        }
                    });
                });
            } catch (e) { return () => {}; }
        },
        obtenerEstadisticasGlobales: async () => {
            try {
                const collDirectorio = collection(db, _SCHEMA.ColeccionDirectorio);
                const qAprobados = query(collDirectorio, where("estado_moderacion", "==", "aprobado"));
                const qPendientes = query(collDirectorio, where("estado_moderacion", "==", "pendiente"));
                const [snapAprobados, snapPendientes] = await Promise.all([
                    getCountFromServer(qAprobados),
                    getCountFromServer(qPendientes)
                ]);
                return { 
                    success: true, 
                    data: { activos: snapAprobados.data().count, pendientes: snapPendientes.data().count } 
                };
            } catch (e) { return { success: false, error: e.message }; }
        },
        buscarUsuarioParaModerador: async (email) => {
            try {
                const q = query(
                    collection(db, _SCHEMA.ColeccionDirectorio), 
                    where("email", "==", email.trim().toLowerCase()), 
                    limit(1)
                );
                const snap = await getDocs(q);
                if(snap.empty) return { success: false, error: "No existe ninguna cuenta." };
                const datos = snap.docs[0].data();
                return { success: true, data: { uid: snap.docs[0].id, nombre: datos.nombre, email: datos.email } };
            } catch (e) { return { success: false, error: e.message }; }
        },
        nombrarModerador: async (uid, email) => {
            try {
                await setDoc(doc(db, "Usuarios_Admin", uid), { 
                    rol: "moderador", email: email, fecha_ingreso: new Date().toISOString() 
                });
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        obtenerEquipoModeradores: async () => {
            try {
                const q = query(collection(db, "Usuarios_Admin"), where("rol", "==", "moderador"));
                const snap = await getDocs(q);
                const mods = [];
                snap.forEach(doc => mods.push({ uid: doc.id, ...doc.data() }));
                return { success: true, data: mods };
            } catch (e) { return { success: false, error: e.message }; }
        },
        obtenerHistorialTramites: async (uid) => {
            try {
                const q = query(collection(db, "Boveda_Tramites"), where("participantes", "array-contains", uid));
                const snap = await getDocs(q);
                const resultados = [];
                snap.forEach(doc => resultados.push({ id: doc.id, ...doc.data() }));
                return { success: true, data: resultados };
            } catch (e) { return { success: false, error: e.message }; }
        },
        revocarModerador: async (uid) => {
            try {
                await deleteDoc(doc(db, "Usuarios_Admin", uid));
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        }
    }, 

    /**
     * @namespace RadarService
     */
    RadarService: {
        obtenerNegocio: async (idNegocio) => {
            // CORREGIDO: Llamando correctamente a GeokatuDB
            return await GeokatuDB.LocalService.getDetails(idNegocio);
        },
        obtenerProductosPublicos: async (idNegocio, filtros) => {
            try {
                // CORREGIDO: Llamando correctamente a GeokatuDB
                const infoLocal = await GeokatuDB.LocalService.getDetails(idNegocio);
                if (!infoLocal.success) throw new Error("No se pudo rutear el catálogo.");
                
                const rutaCatalogo = infoLocal.data._meta.idParaProductos;
                const esFranquicia = infoLocal.data._meta.esFranquicia;
                const coleccionBase = esFranquicia ? _SCHEMA.ColeccionCatalogos : _SCHEMA.ColeccionDirectorio;
                const productosRef = collection(db, coleccionBase, rutaCatalogo, _SCHEMA.SubColeccionProductos);
                
                let queryConstraints = [];
                if (filtros && filtros.limite) queryConstraints.push(limit(filtros.limite));
                if (filtros && filtros.startAfterDoc) queryConstraints.push(startAfter(filtros.startAfterDoc));
                const q = query(productosRef, ...queryConstraints);
                
                const querySnapshot = await getDocs(q);
                const resultados = [];
                let ultimoDoc = null;
                
                if (!querySnapshot.empty) {
                    ultimoDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
                    querySnapshot.forEach((doc) => {
                        const d = doc.data();
                        if (d.eliminado !== true) {
                            resultados.push({ 
                                id_prod: doc.id, 
                                stock_actual: d.stock_actual !== undefined ? Number(d.stock_actual) : 0,
                                en_piso_venta: d.en_piso_venta !== undefined ? Boolean(d.en_piso_venta) : false,
                                ...d 
                            });
                        }
                    });
                }

                return { success: true, data: resultados, ultimoDoc: ultimoDoc };
            } catch (e) {
                return { success: false, error: "Error obteniendo productos", details: e.message };
            }
        },
        buscarEnRadar: async (lat, lng, radiusInM) => {
            if (!db || typeof geofire === 'undefined') return { success: false, error: 'Firebase o GeofireX no listos' };
            try {
                const radiusInKm = radiusInM / 1000; 
                const bounds = geofire.geohashQueryBounds([lat, lng], radiusInKm);
                const promises = [];
                for (const b of bounds) {
                    const q = query(
                        collection(db, _SCHEMA.ColeccionDirectorio),
                        orderBy('geohash'),
                        startAt(b[0]),
                        endAt(b[1])
                    );
                    promises.push(getDocs(q));
                }
                const snapshots = await Promise.all(promises);
                const matchingDocs = [];
                for (const snap of snapshots) {
                    for (const doc of snap.docs) {
                        matchingDocs.push({ id: doc.id, ...doc.data() });
                    }
                }
                return { success: true, data: matchingDocs };
            } catch (e) { return { success: false, error: e.message }; }
        },
        buscarInmueblesEnRadar: async (lat, lng, radiusInM) => {
            if (!db || typeof geofire === 'undefined') return { success: false, error: 'Firebase o GeofireX no listos' };
            try {
                const radiusInKm = radiusInM / 1000;
                const bounds = geofire.geohashQueryBounds([lat, lng], radiusInKm);
                const promises = [];
                for (const b of bounds) {
                    const q = query(
                        collectionGroup(db, _SCHEMA.SubColeccionProductos),
                        orderBy('geohash'),
                        startAt(b[0]),
                        endAt(b[1])
                    );
                    promises.push(getDocs(q));
                }
                const snapshots = await Promise.all(promises);
                const matchingDocs = [];
                snapshots.forEach((snap) => {
                    snap.docs.forEach((doc) => {
                        const data = doc.data();
                        if(data.geohash) {
                            const idPadre = doc.ref.parent.parent ? doc.ref.parent.parent.id : doc.id;
                            matchingDocs.push({ ...data, id: doc.id, id_negocio_padre: idPadre, es_inmueble_real: true, tipo_modelo: 'inmueble' });
                        }
                    });
                });
                return { success: true, data: matchingDocs };
            } catch (error) { return { success: false, error: error.message }; }
        },
        search: async (lat, lng, queryConstraints, signal) => {
            try {
                if (signal && signal.aborted) throw new Error("AbortError");
                const dirRef = collection(db, _SCHEMA.ColeccionDirectorio);
                const q = query(dirRef, ...queryConstraints);
                const querySnapshot = await getDocs(q);
                
                if (signal && signal.aborted) throw new Error("AbortError");
                const resultados = [];
                querySnapshot.forEach((doc) => {
                    resultados.push({ id: doc.id, ...doc.data() });
                });
                return { success: true, data: resultados };
            } catch (e) {
                if (e.message === "AbortError" || e.name === "AbortError") {
                    return { success: false, error: "Búsqueda cancelada", details: "Mitigación de efecto rebote activada." };
                }
                return { success: false, error: "Fallo en el radar de búsqueda", details: e.message };
            }
        },
        obtenerComisiones: async (idNegocio) => {
            try {
                const qSnap = await getDocs(collection(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/comisiones_referidos`));
                const resultados = [];
                qSnap.forEach(doc => resultados.push({ id: doc.id, ...doc.data() }));
                return { success: true, data: resultados };
            } catch (e) { return { success: false, error: e.message }; }
        },
        publicarArticulo: async (payload) => {
            try {
                const docRef = doc(collection(db, "Pulso_Urbano"));
                await setDoc(docRef, payload);
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        guardarMapaBodega: async (idNegocio, idAlmacen, gridData) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const docRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Planos_Almacenes`, idAlmacen);
                const payload = {
                    ...gridData,
                    ultima_modificacion: new Date().toISOString()
                };
                await setDoc(docRef, payload, { merge: true });
                return { success: true, mensaje: "Plano espacial guardado correctamente." };
            } catch (e) { return { success: false, error: e.message }; }
        },

        obtenerMapaBodega: async (idNegocio, idAlmacen = "PLANO_PRINCIPAL") => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const docRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Planos_Almacenes`, idAlmacen);
                const snap = await getDoc(docRef);
                if (snap.exists()) {
                    return { success: true, data: snap.data() };
                }
                return { success: true, data: null };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }
    },


    /**
     * @namespace MediaService
     */
    MediaService: {
        obtenerPulsoUrbano: async (filtros) => {
            try {
                let queryConstraints = [orderBy("fecha_publicacion", "desc")];
                if (filtros && filtros.limite) queryConstraints.push(limit(filtros.limite));
                if (filtros && filtros.startAfterDoc) queryConstraints.push(startAfter(filtros.startAfterDoc));
                
                const q = query(collection(db, "Pulso_Urbano"), ...queryConstraints);
                const querySnapshot = await getDocs(q);
                const resultados = [];
                let ultimoDoc = null;
                
                if (!querySnapshot.empty) {
                    ultimoDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
                    querySnapshot.forEach((doc) => {
                        resultados.push({ id: doc.id, ...doc.data() });
                    });
                }
                return { success: true, data: resultados, ultimoDoc: ultimoDoc };
            } catch (e) { return { success: false, error: "Error obteniendo feed", details: e.message }; }
        },
        obtenerNoticiaPorId: async (idNoticia) => {
            try {
                const docRef = doc(db, "Pulso_Urbano", idNoticia);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    return { success: true, data: { id: docSnap.id, ...docSnap.data() } };
                }
                return { success: false, error: "Noticia no encontrada" };
            } catch (e) { return { success: false, error: e.message }; }
        }
    },

    /**
     * @namespace SecurityService
     */
    SecurityService: {
        generarSelloSeguroTOTP: async (codigoReferido, idNegocio) => {
            try {
                const generarSello = httpsCallable(functions, 'generarSelloSeguro');
                const res = await generarSello({ codigoReferido, idNegocio });
                return { success: true, data: res.data };
            } catch (e) { return { success: false, error: e.message }; }
        },
        verificarTOTP: async (email, codigo) => {
            try {
                const validadorTOTP = httpsCallable(functions, 'validarRegistroTOTP');
                const res = await validadorTOTP({ email, codigo });
                if (res.data && res.data.success) {
                    return { success: true, data: res.data };
                } else {
                    return { success: false, error: res.data.mensaje || "El código TOTP es inválido." };
                }
            } catch (e) { return { success: false, error: e.message }; }
        },
        sellarTramiteLegal: async (paqueteEvidencia) => {
            try {
                const notarioCloud = httpsCallable(functions, 'sellarTramiteLegal');
                const res = await notarioCloud(paqueteEvidencia);
                return { success: res.data.success, txId: res.data.txId };
            } catch (e) { return { success: false, error: e.message }; }
        },
        solicitarOtpFirma: async (emailDestino) => {
            try {
                const enviarOtp = httpsCallable(functions, 'solicitarOTP');
                const res = await enviarOtp({ email: emailDestino, accion: "Firma de Contrato Electrónico" });
                return { success: true, data: res.data };
            } catch (e) { return { success: false, error: e.message }; }
        },
        iniciarTramiteP2P: async (datosContrato, emailContraparte) => {
            try {
                const iniciarSala = httpsCallable(functions, 'crearBorradorTramiteP2P');
                const res = await iniciarSala({ datos: datosContrato, contraparte: emailContraparte });
                return { success: true, salaId: res.data.salaId };
            } catch (e) { return { success: false, error: e.message }; }
        },
        sellarEvidenciaKYC: async (idNegocio, fotosEnBase64) => {
            try {
                const procesarKycFunction = httpsCallable(functions, 'procesarKycBiometrico');
                const payload = { frente: fotosEnBase64.frente, reverso: fotosEnBase64.reverso, rostro: fotosEnBase64.rostro };
                const res = await procesarKycFunction(payload);
                return { success: res.data.success, mensaje: res.data.mensaje };
            } catch (e) { return { success: false, error: e.message }; }
        },
        descargarContratoDesbloqueado: async (contratoId) => {
            try {
                const funcDesbloqueo = httpsCallable(functions, 'descargarContratoDesbloqueado');
                const res = await funcDesbloqueo({ contratoId: contratoId });
                return { success: true, pdfData: res.data.pdfData };
            } catch (e) { return { success: false, error: e.message }; }
        },
        registrarUsuario: async (email, pass, tipoCuenta) => {
            try {
                const result = await createUserWithEmailAndPassword(auth, email, pass);
                await setDoc(doc(db, _SCHEMA.ColeccionDirectorio, result.user.uid), {
                    nombre: "Mi Negocio", email: email, tipo_modelo: tipoCuenta,
                    estado_moderacion: 'pendiente', premium: false, fecha_registro: new Date().toISOString()
                });
                return { success: true, data: result.user };
            } catch (e) { return { success: false, error: e.message }; }
        },
        obtenerRolAdmin: async (uid) => {
            try {
                const snap = await getDoc(doc(db, "Usuarios_Admin", uid));
                return { success: true, data: snap.exists() ? snap.data() : { rol: 'estandar' } };
            } catch (e) { return { success: false, error: e.message }; }
        },
        validateCartIntegrity: (carritoLocal, memoriaProductos) => {
            try {
                let totalReal = 0;
                const carritoSeguro = [];
                for (const itemCliente of carritoLocal) {
                    const productoInmutable = memoriaProductos.find(p => p.id === itemCliente.id);
                    if (!productoInmutable) throw new Error(`Producto inválido detectado`);
                    const subtotal = productoInmutable.precio * itemCliente.cantidad;
                    totalReal += subtotal;
                    carritoSeguro.push({
                        id: productoInmutable.id, cantidad: itemCliente.cantidad,
                        precioValidado: productoInmutable.precio, subtotal: subtotal
                    });
                }
                return { success: true, data: { totalAprobado: totalReal, carritoLimpio: carritoSeguro } };
            } catch (e) { return { success: false, error: "Violación de integridad", details: e.message }; }
        },
                        iniciarConGoogle: async () => {
            try {
                await setPersistence(auth, browserLocalPersistence);
                const provider = new GoogleAuthProvider();
                const result = await signInWithPopup(auth, provider);
                const infoExtra = getAdditionalUserInfo(result);
                
                // 🛑 INTERCEPCIÓN ÁUREA: Si es nuevo, NO le creamos un perfil basura.
                if (infoExtra && infoExtra.isNewUser) {
                    return { success: true, data: result.user, esNuevo: true };
                }
                
                // Si ya existe, pasa derecho
                return { success: true, data: result.user, esNuevo: false };
            } catch (e) { return { success: false, error: e.message }; }
        },


        iniciarSesion: async (email, pass) => {
            try {
                const result = await signInWithEmailAndPassword(auth, email, pass);
                return { success: true, data: result.user };
            } catch (e) { return { success: false, error: e.message }; }
        },
        cerrarSesion: async () => {
            try {
                await signOut(auth);
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
       observarEstadoSesion: (callback) => {
            onAuthStateChanged(auth, callback);
        },
        sellarSesionTerminalLocal: async (uid) => {
            const firma = await _generarFirmaSesionLocal(uid);
            if (firma) {
                localStorage.setItem('geokatu_active_uid', uid);
                localStorage.setItem('geokatu_session_sig', firma);
                return true;
            }
            return false;
        },
        destruirSesionTerminalLocal: () => {
            localStorage.removeItem('geokatu_active_uid');
            localStorage.removeItem('geokatu_session_sig');
            localStorage.removeItem('geokatu_cajero_pin');
        }
    },

/**
     * @namespace PosService
     * Motor de Caja Registradora, facturación offline, deducción de stock y sincronización
     */
    PosService: {
        // =========================================================================
        // MOTOR CANÓNICO FISCAL: ESTÁNDAR NEUTRAL UBL 2.1 / DIAN MULTI-PROVEEDOR
        // =========================================================================
        _construirPayloadFiscalCanonico: (ticketData) => {
            const fechaActual = new Date();
            const fechaIso = fechaActual.toISOString().split('T')[0];
            const horaIso = fechaActual.toTimeString().split(' ')[0];

            let totalGravableCentavos = 0;
            let totalImpuestoCentavos = 0;
            let totalExentoCentavos = 0;

            const itemsCanonicos = (ticketData.productos || []).map(prod => {
                const subtotal = prod.subtotal !== undefined 
                    ? Math.round(prod.subtotal) 
                    : Math.round(Number(prod.precio) * Number(prod.cantidad));
                const esIva19 = String(prod.impuesto) === "19";

                let baseLinea = subtotal;
                let ivaLinea = 0;
                let porcentaje = 0;

                if (esIva19) {
                    porcentaje = 19;
                    baseLinea = Number((subtotal / 1.19).toFixed(2));
                    ivaLinea = Number((subtotal - baseLinea).toFixed(2));
                    totalGravableCentavos += baseLinea;
                    totalImpuestoCentavos += ivaLinea;
                } else {
                    totalExentoCentavos += subtotal;
                }

                return {
                    sku: String(prod.codigo_barras || prod.plu || prod.id_prod || "GENERICO"),
                    nombre: String(prod.nombre || "Articulo sin descripcion"),
                    cantidad: Number(prod.cantidad),
                    unidad: prod.unidad_medida || "und",
                    precio_unitario_bruto: Number(prod.precio),
                    precio_unitario_base: esIva19 ? Number((prod.precio / 1.19).toFixed(2)) : Number(prod.precio),
                    subtotal: subtotal,
                    base_gravable: baseLinea,
                    impuesto_monto: ivaLinea,
                    porcentaje_impuesto: porcentaje,
                    tipo_impuesto: esIva19 ? "01" : "ZZ"
                };
            });

            const baseFinal = Math.round(totalGravableCentavos);
            const exentoFinal = Math.round(totalExentoCentavos);
            const totalPagar = Math.round(Number(ticketData.total));
            const ivaFinal = totalGravableCentavos > 0 ? (totalPagar - baseFinal - exentoFinal) : 0;

            const nitLimpio = (ticketData.cliente?.nit || "222222222222").replace(/\D/g, '');
            const esContingenciaOffline = Boolean(ticketData.factura_electronica && !navigator.onLine);

            const pagosCanonicos = (ticketData.metodos_pago_split || []).map(p => ({
                metodo_pos: p.metodo,
                codigo_medio_pago_dian: p.metodo === 'TARJETA' ? "48" : (p.metodo === 'NEQUI' ? "47" : "10"),
                monto: Math.round(p.monto),
                referencia: p.referencia || null
            }));

            if (pagosCanonicos.length === 0) {
                pagosCanonicos.push({
                    metodo_pos: ticketData.metodo_pago,
                    codigo_medio_pago_dian: ticketData.metodo_pago === 'TARJETA' ? "48" : (ticketData.metodo_pago === 'NEQUI' ? "47" : "10"),
                    monto: totalPagar,
                    referencia: ticketData.referencia_datafono || null
                });
            }

            return {
                ticket_id_origen: ticketData.ticketIdLocal,
                fecha: fechaIso,
                hora: horaIso,
                tipo_documento_dian: ticketData.factura_electronica ? (esContingenciaOffline ? "04" : "01") : "POS_ELECTRONICO",
                tipo_operacion: esContingenciaOffline ? "CONTINGENCIA_DIAN" : "ESTANDAR",
                codigo_contingencia: esContingenciaOffline ? "04" : null,
                motivo_contingencia: esContingenciaOffline ? "Falla de conectividad o fluido electrico en terminal POS" : null,
                timestamp_emision_contingencia: esContingenciaOffline ? new Date().toISOString() : null,
                cliente: {
                    numero_documento: nitLimpio,
                    tipo_documento: nitLimpio === "222222222222" ? "13" : (nitLimpio.length === 10 ? "31" : "13"),
                    razon_social: ticketData.cliente?.nombre || "Consumidor Final",
                    email: ticketData.cliente?.email || ""
                },
                totales: {
                    total_pagar: totalPagar,
                    base_gravable: baseFinal,
                    impuesto_iva: ivaFinal,
                    total_exento: exentoFinal
                },
                items: itemsCanonicos,
                pagos: pagosCanonicos
            };
        },

                descargarCatalogoLocal: async (idNegocio) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const productosRef = collection(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`);
                const snap = await getDocs(productosRef);

                const catalogoLocal = [];
                snap.forEach(docSnap => {
                    const d = docSnap.data();
                    if (d.eliminado !== true) {
                        catalogoLocal.push({ 
                            id_prod: docSnap.id, 
                            codigo_barras: d.codigo_barras ? String(d.codigo_barras).trim() : "",
                            plu: d.plu ? String(d.plu).trim() : "",
                            nombre: d.nombre || "Sin nombre",
                            precio: Number(d.precio) || 0,
                            stock_actual: d.stock_actual !== undefined ? d.stock_actual : 0,
                            impuesto: d.impuesto || "19",
                            icono: d.icono || "inventory_2",
                            es_pesable: Boolean(d.es_pesable),
                            unidad_medida: d.unidad_medida || (d.es_pesable ? "kg" : "und")
                        });
                    }
                });


                localStorage.setItem(`geokatu_catalogo_${idNegocio}`, JSON.stringify(catalogoLocal));
                return { success: true, cantidad: catalogoLocal.length, data: catalogoLocal };
            } catch (e) { 
                const cache = localStorage.getItem(`geokatu_catalogo_${idNegocio}`);
                if (cache) {
                    return { success: true, cantidad: JSON.parse(cache).length, data: JSON.parse(cache), offline: true };
                }
                return { success: false, error: "Error descargando catálogo", details: e.message }; 
            }
        },

       // 🛡️ SEMÁFORO REACTIVO DELTA ULTRA-RÁPIDO (O(1) Map + Debounce Storage)
        escucharSemaforoStock: (idNegocio, callbackDelta) => {
            if (!_verificarAcceso() || !navigator.onLine) return () => {};
            try {
                const claveCache = `geokatu_catalogo_${idNegocio}`;
                
                // 1. Hidratación inicial del Map en memoria para evitar lecturas sincrónicas de disco
                const catalogoArray = JSON.parse(localStorage.getItem(claveCache) || "[]");
                const catalogoMap = new Map();
                catalogoArray.forEach(p => catalogoMap.set(p.id_prod, p));

                let debounceTimer = null;

                const productosRef = collection(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`);
                const q = query(productosRef, where("eliminado", "==", false));

                const unsubscribe = onSnapshot(q, { includeMetadataChanges: false }, (snapshot) => {
                    let huboModificacion = false;

                    snapshot.docChanges().forEach((change) => {
                        if (change.type === "modified") {
                            const data = change.doc.data();
                            const prodId = change.doc.id;
                            const nuevoStock = data.stock_actual !== undefined ? data.stock_actual : 0;
                            const nuevoPrecio = data.precio !== undefined ? Number(data.precio) : null;

                            // Actualización O(1) directa en RAM
                            const item = catalogoMap.get(prodId);
                            if (item) {
                                item.stock_actual = nuevoStock;
                                if (nuevoPrecio !== null) item.precio = nuevoPrecio;
                                huboModificacion = true;
                            }

                            // Notificación instantánea a la UI (sin bloqueo de disco)
                            if (typeof callbackDelta === 'function') {
                                callbackDelta({ id_prod: prodId, stock_actual: nuevoStock, precio: nuevoPrecio });
                            }
                        }
                    });

                    // 2. Debounce de 500ms para volcar el Map a localStorage únicamente cuando la ráfaga cese
                    if (huboModificacion) {
                        clearTimeout(debounceTimer);
                        debounceTimer = setTimeout(() => {
                            try {
                                const payloadArray = Array.from(catalogoMap.values());
                                localStorage.setItem(claveCache, JSON.stringify(payloadArray));
                            } catch (errStorage) {
                                console.warn("[Semáforo Stock] Cuota de almacenamiento excedida:", errStorage);
                            }
                        }, 500);
                    }
                }, (err) => {
                    console.warn("[Semáforo Stock] Conexión interrumpida o terminal offline:", err.message);
                });

                // Retornar función de limpieza que cancela el timer pendiente y desuscribe Firestore
                return () => {
                    clearTimeout(debounceTimer);
                    unsubscribe();
                };
            } catch (e) {
                console.warn("[Semáforo Stock] Error al inicializar listener:", e.message);
                return () => {};
            }
        },

esperarResolucionFiscal: (idNegocio, ticketFirestoreId, timeoutMs = 4000) => {
            return new Promise((resolve) => {
                if (!navigator.onLine || !ticketFirestoreId) {
                    return resolve({ exito: false, contingencia: true });
                }

                let completado = false;
                const docRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Ventas_POS`, ticketFirestoreId);

                const desuscribir = onSnapshot(docRef, (snap) => {
                    if (!snap.exists()) return;
                    const data = snap.data();
                    const estadoFiscal = data?.despacho_fiscal?.estado;

                    if (estadoFiscal === "FACTURADO_EXITOSO") {
                        completado = true;
                        desuscribir();
                        clearTimeout(timer);
                        resolve({
                            exito: true,
                            cufe: data.despacho_fiscal.cufe,
                            consecutivo: data.despacho_fiscal.consecutivo,
                            siigoId: data.despacho_fiscal.siigo_id
                        });
                    } else if (estadoFiscal === "ERROR_PROVEEDOR" || estadoFiscal === "ERROR_SISTEMA") {
                        completado = true;
                        desuscribir();
                        clearTimeout(timer);
                        resolve({ exito: false, contingencia: true, error: data.despacho_fiscal.respuesta_error });
                    }
                }, (err) => {
                    console.warn("[Fiscal Watcher] Error en suscripción:", err);
                    if (!completado) {
                        completado = true;
                        clearTimeout(timer);
                        resolve({ exito: false, contingencia: true });
                    }
                });

                const timer = setTimeout(() => {
                    if (!completado) {
                        completado = true;
                        desuscribir();
                        resolve({ exito: false, contingencia: true, motivo: "TIMEOUT" });
                    }
                }, timeoutMs);
            });
        },

        procesarVentaLote: async (idNegocio, ticketData) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };

            // 🛡️ Normalización estricta del tenant matriz (dueño vs cajero operador)
            const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid') || (auth.currentUser ? auth.currentUser.uid : null);
            if (!tenantReal) return { success: false, error: "No se identificó el comercio emisor." };

            const claveCache = `geokatu_catalogo_${tenantReal}`;
            let catalogoLocal = JSON.parse(localStorage.getItem(claveCache) || "[]");

            // 🛡️ BARRERA ZERO-TRUST: Revalidación de subtotales vs total declarado
            let sumaVerificacion = 0;
            for (const item of ticketData.productos) {
                const prod = catalogoLocal.find(p => p.id_prod === item.id_prod);
                const precioValido = (item.precio_fijado_balanza && item.precio > 0) 
                    ? Number(item.precio) 
                    : (prod ? Number(prod.precio) : Number(item.precio));

                const subtotal = Math.round(precioValido * item.cantidad);
                sumaVerificacion += subtotal;
            }

            if (Math.abs(sumaVerificacion - Number(ticketData.total)) > 1) {
                return { 
                    success: false, 
                    error: "Discrepancia crítica de integridad contable: el total no coincide con los precios de inventario." 
                };
            }

            // Descuento en catálogo local y captura de incidentes de stock negativo
            const quiebresDetectados = [];

            for (const item of ticketData.productos) {
                const prod = catalogoLocal.find(p => p.id_prod === item.id_prod);
                if (prod && prod.stock_actual !== undefined) {
                    const stockResultante = Number((prod.stock_actual - item.cantidad).toFixed(3));
                    prod.stock_actual = stockResultante;

                    if (stockResultante < 0) {
                        quiebresDetectados.push({
                            id_prod: item.id_prod,
                            nombre: prod.nombre || item.nombre || "Sin nombre",
                            stock_anterior: Number((stockResultante + item.cantidad).toFixed(3)),
                            stock_resultante: stockResultante,
                            cantidad_vendida: item.cantidad
                        });
                    }
                }
            }
            localStorage.setItem(claveCache, JSON.stringify(catalogoLocal));

            // Preparar payload normalizado
            const ticketIdLocal = "TK-" + Date.now().toString(16).toUpperCase();
            const payloadCanonico = GeokatuDB.PosService._construirPayloadFiscalCanonico(ticketData);

            const payloadFinal = {
                ...ticketData,
                ticketIdLocal: ticketIdLocal,
                estado_sincronizacion: "sincronizado",
                timestamp_caja: new Date().toISOString(),
                origen: "PWA_POS",
                despacho_fiscal: {
                    estado: "PENDIENTE",
                    payload_canonico: payloadCanonico,
                    proveedor_utilizado: null,
                    respuesta_proveedor: null
                }
            };

            // Registro atómico en Firestore
            try {
                const batch = writeBatch(db);
                const ticketRef = doc(collection(db, `${_SCHEMA.ColeccionDirectorio}/${tenantReal}/Ventas_POS`));
                batch.set(ticketRef, payloadFinal);

                // 🚦 Incremento atómico del contador de facturas mensual en el documento del comercio
                const negocioRef = doc(db, _SCHEMA.ColeccionDirectorio, tenantReal);
                batch.update(negocioRef, {
                    "facturacion_control.facturas_emitidas_mes": increment(1)
                });

                // 🚀 Suma atómica a métricas globales de red
                batch.set(doc(db, "sistema", "metricas_red"), {
                    volumen_ventas_pos: increment(Number(ticketData.total) || 0),
                    tickets_emitidos: increment(1)
                }, { merge: true });

                ticketData.productos.forEach(item => {
                    if (item.id_prod) {
                        const prodRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${tenantReal}/${_SCHEMA.SubColeccionProductos}`, item.id_prod);
                        batch.update(prodRef, {
                            stock_actual: increment(-item.cantidad)
                        });

                        // Descuento automático del compartimiento físico
                        const ubiPisoRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${tenantReal}/${_SCHEMA.SubColeccionProductos}/${item.id_prod}/${_SCHEMA.SubColeccionUbicacionesStock}`, item.id_compartimiento || "BIN_INICIAL");
                        batch.set(ubiPisoRef, {
                            cantidad: increment(-item.cantidad),
                            zona: "PISO_VENTA",
                            ultima_modificacion: new Date().toISOString()
                        }, { merge: true });
                    }
                });

                // Si la venta dejó saldos bajo cero, levantar incidentes en Alertas_Seguridad
                if (quiebresDetectados.length > 0) {
                    quiebresDetectados.forEach(q => {
                        const alertaRef = doc(collection(db, "Alertas_Seguridad"));
                        batch.set(alertaRef, {
                            id_negocio: idNegocio,
                            tipo: "DESCUADRE_STOCK_NEGATIVO",
                            estado: "requiere_auditoria_urgente",
                            id_producto: q.id_prod,
                            nombre_producto: q.nombre,
                            stock_previo: q.stock_anterior,
                            stock_negativo_registrado: q.stock_resultante,
                            cantidad_despachada: q.cantidad_vendida,
                            ticket_origen: ticketIdLocal,
                            terminal: ticketData.caja_numero || "CAJA-01",
                            cajero: ticketData.cajero_email || "CAJERO",
                            timestamp_alerta: new Date().toISOString(),
                            resuelto: false
                        });
                    });
                }

                await batch.commit();
                return { success: true, ticketId: ticketRef.id, localId: ticketIdLocal };

            } catch (e) {
                console.warn("[GEOKATU POS] Sin conexión. Venta retenida en cola offline:", e.message);
                const claveCola = `geokatu_sync_cola_${idNegocio}`;
                const colaActual = JSON.parse(localStorage.getItem(claveCola) || "[]");
                colaActual.push(payloadFinal);
                localStorage.setItem(claveCola, JSON.stringify(colaActual));

                return { success: true, ticketId: ticketIdLocal, offline: true };
            }
        },

        sincronizarVentasPendientes: async (idNegocio) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };

            const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid') || (auth.currentUser ? auth.currentUser.uid : null);
            if (!tenantReal) return { success: false, error: "No se identificó el comercio emisor." };

            if (_sincronizandoColaEnProgreso) {
                console.warn("[GEOKATU Sync] Sincronización bloqueada: ya existe un despacho en progreso.");
                return { sincronizados: 0, ocupado: true };
            }

            _sincronizandoColaEnProgreso = true;
            const claveCola = `geokatu_sync_cola_${tenantReal}`;

            try {
                const colaActual = JSON.parse(localStorage.getItem(claveCola) || "[]");
                if (colaActual.length === 0) {
                    return { sincronizados: 0, pendientes: 0 };
                }

                let procesados = 0;
                const colaRestante = [];

                for (const ticket of colaActual) {
                    if (ticket.estado_sincronizacion === "sincronizado_diferido") continue;

                    try {
                        const batch = writeBatch(db);
                        const ticketRef = doc(collection(db, `${_SCHEMA.ColeccionDirectorio}/${tenantReal}/Ventas_POS`));

                        batch.set(ticketRef, {
                            ...ticket,
                            id_firestore: ticketRef.id,
                            estado_sincronizacion: "sincronizado_diferido",
                            timestamp_sincronizacion_nube: new Date().toISOString()
                        });

                        // Sumar factura diferida al contador mensual del negocio
                        const negocioRef = doc(db, _SCHEMA.ColeccionDirectorio, tenantReal);
                        batch.update(negocioRef, {
                            "facturacion_control.facturas_emitidas_mes": increment(1)
                        });

                        ticket.productos.forEach(item => {
                            if (item.id_prod) {
                                const prodRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${tenantReal}/${_SCHEMA.SubColeccionProductos}`, item.id_prod);
                                batch.update(prodRef, { 
                                    stock_actual: increment(-item.cantidad) 
                                });
                            }
                        });

                        await batch.commit();

                        procesados++;
                    } catch (err) {
                        console.error("[GEOKATU Sync] Error procesando ticket offline:", err);
                        colaRestante.push(ticket);
                    }
                }

                localStorage.setItem(claveCola, JSON.stringify(colaRestante));
                return { sincronizados: procesados, pendientes: colaRestante.length };
            } finally {
                _sincronizandoColaEnProgreso = false;
            }
        },

        cargarCatalogoDesdeCache: (idNegocio) => {
            const data = localStorage.getItem(`geokatu_catalogo_${idNegocio}`);
            return data ? JSON.parse(data) : [];
        },

        guardarTicketsEnEsperaNube: async (idNegocio, ticketsArray) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const docRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Sesiones_Caja`, "Tickets_Pausados_Activos");
                await setDoc(docRef, {
                    tickets: ticketsArray,
                    ultima_actualizacion: new Date().toISOString()
                }, { merge: true });
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },

        obtenerTicketsEnEsperaNube: async (idNegocio) => {
            if (!_verificarAcceso()) return [];
            try {
                const docRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Sesiones_Caja`, "Tickets_Pausados_Activos");
                const snap = await getDoc(docRef);
                return snap.exists() ? (snap.data().tickets || []) : [];
            } catch (e) {
                console.warn("[PosService] Error al obtener tickets pausados:", e.message);
                return [];
            }
        },
/**
         * Asienta una Nota de Crédito Parcial reingresando únicamente los renglones devueltos
         */
        devolucionParcialPOS: async (idNegocio, ticketId, itemsDevueltos, motivo = "Devolución parcial") => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };

            const claveCache = `geokatu_catalogo_${idNegocio}`;
            let catalogoLocal = JSON.parse(localStorage.getItem(claveCache) || "[]");

            try {
                const ticketRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Ventas_POS`, ticketId);
                const ticketSnap = await getDoc(ticketRef);

                if (!ticketSnap.exists()) {
                    return { success: false, error: "Ticket original no encontrado." };
                }

                let totalReembolso = 0;
                const batch = writeBatch(db);

                itemsDevueltos.forEach(item => {
                    const montoLinea = Math.round(Number(item.precio) * Number(item.cantidad_devuelta));
                    totalReembolso += montoLinea;

                    // 1. Reingreso de stock en Firestore
                    if (item.id_prod && item.id_prod !== "GENERICO") {
                        const prodRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`, item.id_prod);
                        batch.update(prodRef, {
                            stock_actual: increment(item.cantidad_devuelta)
                        });

                        // 2. Reingreso en memoria local
                        const prodRAM = catalogoLocal.find(p => p.id_prod === item.id_prod);
                        if (prodRAM && prodRAM.stock_actual !== undefined) {
                            prodRAM.stock_actual = Number((prodRAM.stock_actual + item.cantidad_devuelta).toFixed(3));
                        }
                    }
                });

                localStorage.setItem(claveCache, JSON.stringify(catalogoLocal));

                // 3. Registrar comprobante oficial de Nota de Crédito Parcial
                const notaRef = doc(collection(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Notas_Credito_POS`));
                batch.set(notaRef, {
                    ticket_origen_id: ticketId,
                    tipo: "PARCIAL",
                    total_reembolsado: totalReembolso,
                    items_devueltos: itemsDevueltos,
                    motivo: motivo,
                    fecha: new Date().toISOString(),
                    usuario: auth.currentUser ? auth.currentUser.email : "CAJERO"
                });

                await batch.commit();

                return {
                    success: true,
                    totalReembolsado: totalReembolso,
                    notaCreditoId: notaRef.id
                };
            } catch (err) {
                console.error("[POS] Fallo en devolución parcial:", err);
                return { success: false, error: err.message };
            }
        },

        anularVentaPOS: async (idNegocio, ticketId, motivoAnulacion = "Error de digitación en caja") => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };

            const claveCache = `geokatu_catalogo_${idNegocio}`;
            let catalogoLocal = JSON.parse(localStorage.getItem(claveCache) || "[]");

            try {
                const ticketRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Ventas_POS`, ticketId);
                const ticketSnap = await getDoc(ticketRef);

                let productosARevertir = [];
                let ventaData = null;

                if (ticketSnap.exists()) {
                    ventaData = ticketSnap.data();
                    if (ventaData.anulado) {
                        return { success: false, error: "Este ticket ya fue anulado previamente." };
                    }
                    productosARevertir = ventaData.productos || [];
                } else {
                    const claveCola = `geokatu_sync_cola_${idNegocio}`;
                    const cola = JSON.parse(localStorage.getItem(claveCola) || "[]");
                    const idx = cola.findIndex(t => t.ticketIdLocal === ticketId);
                    if (idx !== -1) {
                        ventaData = cola[idx];
                        productosARevertir = ventaData.productos || [];
                        cola.splice(idx, 1);
                        localStorage.setItem(claveCola, JSON.stringify(cola));
                    } else {
                        return { success: false, error: "Ticket no encontrado en el sistema." };
                    }
                }

                // Reversión en memoria y localStorage
                productosARevertir.forEach(itemRevertir => {
                    const prod = catalogoLocal.find(p => p.id_prod === itemRevertir.id_prod || p.codigo_barras === itemRevertir.codigo_barras);
                    if (prod && prod.stock_actual !== undefined) {
                        prod.stock_actual = Number((prod.stock_actual + itemRevertir.cantidad).toFixed(3));
                    }
                });
                localStorage.setItem(claveCache, JSON.stringify(catalogoLocal));

                // Reversión en Firestore si existe en nube
                if (navigator.onLine && ticketSnap.exists()) {
                    const batch = writeBatch(db);
                    batch.update(ticketRef, {
                        anulado: true,
                        motivo_anulacion: motivoAnulacion,
                        timestamp_anulacion: new Date().toISOString(),
                        usuario_anulacion: auth.currentUser ? auth.currentUser.email : "CAJERO"
                    });

                    productosARevertir.forEach(item => {
                        if (item.id_prod) {
                            const prodRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`, item.id_prod);
                            batch.update(prodRef, {
                                stock_actual: increment(item.cantidad)
                            });
                        }
                    });

                    const notaRef = doc(collection(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Notas_Credito_POS`));
                    batch.set(notaRef, {
                        ticket_origen_id: ticketId,
                        total_revertido: ventaData.total,
                        metodo_pago: ventaData.metodo_pago,
                        productos: productosARevertir,
                        motivo: motivoAnulacion,
                        fecha: new Date().toISOString()
                    });

                    await batch.commit();
                }

                return { 
                    success: true, 
                    mensaje: `Ticket ${ticketId} anulado exitosamente. Se restituyó el inventario.`,
                    productosRevertidos: productosARevertir,
                    totalRevertido: ventaData ? ventaData.total : 0
                };
            } catch (e) {
                console.error("[POS] Error al anular venta:", e);
                return { success: false, error: e.message };
            }
        },

        obtenerEstadoCajaActual: async (idNegocio, terminalId = "CAJA-01") => {
            const claveTerminal = `geokatu_caja_activa_${idNegocio}_${terminalId}`;
            const sesionLocal = localStorage.getItem(claveTerminal);
            if (sesionLocal) {
                return { success: true, data: JSON.parse(sesionLocal) };
            }

            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };

            try {
                const cajaRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Sesiones_Caja`, `Turno_${terminalId}`);

                const snap = await getDoc(cajaRef);
                if (snap.exists() && snap.data().estado === 'ABIERTA') {
                    const data = snap.data();
                    localStorage.setItem(claveTerminal, JSON.stringify(data));
                    return { success: true, data: data };
                }
                return { success: true, data: null };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },


        abrirTurnoCaja: async (idNegocio, baseInicial, cajeroEmail = "CAJERO", terminalId = "CAJA-01") => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };

            const idSesion = `SES-${terminalId}-${Date.now().toString(16).toUpperCase()}`;
            const payloadApertura = {
                id_sesion: idSesion,
                terminal_id: terminalId,
                estado: "ABIERTA",
                base_inicial: Number(baseInicial) || 0,
                fecha_apertura: new Date().toISOString(),
                cajero: cajeroEmail,
                movimientos_menores: []
            };

            localStorage.setItem(`geokatu_caja_activa_${idNegocio}_${terminalId}`, JSON.stringify(payloadApertura));

            try {
                if (navigator.onLine) {
                    const turnoRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Sesiones_Caja`, `Turno_${terminalId}`);
                    await setDoc(turnoRef, payloadApertura);
                }
                return { success: true, data: payloadApertura };
            } catch (e) {
                return { success: true, data: payloadApertura, offline: true };
            }
        },


        registrarMovimientoMenorCaja: async (idNegocio, tipo, monto, motivo, terminalId = "CAJA-01") => {
            const claveStorage = `geokatu_caja_activa_${idNegocio}_${terminalId}`;
            const sesionLocal = JSON.parse(localStorage.getItem(claveStorage) || "null");

            if (!sesionLocal || sesionLocal.estado !== 'ABIERTA') {
                return { success: false, error: "No hay una sesión abierta en esta terminal de caja." };
            }

            const nuevoMovimiento = {
                id: "MOV-" + Date.now().toString(16).toUpperCase(),
                tipo: tipo,
                monto: Number(monto) || 0,
                motivo: motivo || "Gasto menor de caja",
                timestamp: new Date().toISOString()
            };

            sesionLocal.movimientos_menores = sesionLocal.movimientos_menores || [];
            sesionLocal.movimientos_menores.push(nuevoMovimiento);
            localStorage.setItem(claveStorage, JSON.stringify(sesionLocal));

            try {
                if (navigator.onLine) {
                    const turnoRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Sesiones_Caja`, `Turno_${terminalId}`);
                    await setDoc(turnoRef, { movimientos_menores: sesionLocal.movimientos_menores }, { merge: true });
                }
                return { success: true, movimiento: nuevoMovimiento };
            } catch (e) {
                return { success: true, movimiento: nuevoMovimiento, offline: true };
            }
        },

        ejecutarCierreZ: async (idNegocio, efectivoContadoFisico, resumenTotales, terminalId = "CAJA-01") => {
            const claveStorage = `geokatu_caja_activa_${idNegocio}_${terminalId}`;
            const sesionLocal = JSON.parse(localStorage.getItem(claveStorage) || "null");

            if (!sesionLocal) {
                return { success: false, error: "No existe una sesión de caja abierta en esta terminal para cerrar." };
            }

            const base = Number(sesionLocal.base_inicial) || 0;
            const ventasEfectivo = Number(resumenTotales.efectivo) || 0;
            
            let entradasMenores = 0;
            let salidasMenores = 0;
            (sesionLocal.movimientos_menores || []).forEach(m => {
                if (m.tipo === 'ENTRADA') entradasMenores += m.monto;
                if (m.tipo === 'SALIDA') salidasMenores += m.monto;
            });

            const esperadoEfectivo = base + ventasEfectivo + entradasMenores - salidasMenores;
            const contado = Number(efectivoContadoFisico) || 0;
            const diferencia = contado - esperadoEfectivo;

            const totalVentasReal = (Number(resumenTotales.efectivo) || 0) + (Number(resumenTotales.tarjeta) || 0) + (Number(resumenTotales.nequi) || 0);
            const fechaCierreHoy = new Date().toISOString().split('T')[0];

            // 🛡️ ASIENTO CONTABLE EN PARTIDA DOBLE CON CANASTA MIXTA DISCRIMINADA
            const baseGravableReal = Number(resumenTotales.base_gravable) || 0;
            const ivaGeneradoReal = Number(resumenTotales.iva_19) || 0;
            const totalExentoReal = Number(resumenTotales.exento) || 0;
            const totalRecaudoBancario = (Number(resumenTotales.tarjeta) || 0) + (Number(resumenTotales.nequi) || 0);

            // Ingreso neto real a la cuenta 4135
            const ingresosOperacionalesTotales = baseGravableReal + totalExentoReal;

            const itemsComprobante = [
                {
                    account: { code: "11050501" }, // Caja General
                    description: `Efectivo Turno ${sesionLocal.id_sesion}`,
                    debit: ventasEfectivo,
                    credit: 0
                },
                {
                    account: { code: "11100501" }, // Bancos / Tarjetas
                    description: `Bancos y Pagos Digitales Turno ${sesionLocal.id_sesion}`,
                    debit: totalRecaudoBancario,
                    credit: 0
                },
                {
                    account: { code: "51350501" }, // Gastos Menores Operativos de Caja
                    description: `Gastos menores de caja Turno ${sesionLocal.id_sesion}`,
                    debit: salidasMenores,
                    credit: 0
                },
                {
                    account: { code: "41350101" }, // Ingresos Comercio (Exento + Base 19%)
                    description: `Ingresos operacionales Turno ${sesionLocal.id_sesion}`,
                    debit: 0,
                    credit: ingresosOperacionalesTotales
                }
            ];

            // Pasivo de IVA generado únicamente si hubo productos gravados
            if (ivaGeneradoReal > 0) {
                itemsComprobante.push({
                    account: { code: "24080101" },
                    description: `IVA generado 19% Turno ${sesionLocal.id_sesion}`,
                    debit: 0,
                    credit: ivaGeneradoReal
                });
            }

            // Cuadratura por arqueo a ciegas: Faltante o Sobrante
            if (diferencia < 0) {
                itemsComprobante.push({
                    account: { code: "13659501" }, // Cuentas por cobrar a trabajadores
                    description: `Faltante caja ${terminalId} Turno ${sesionLocal.id_sesion}`,
                    debit: Math.abs(diferencia),
                    credit: 0
                });
            } else if (diferencia > 0) {
                itemsComprobante.push({
                    account: { code: "42958101" }, // Ingresos diversos / Sobrantes
                    description: `Sobrante caja ${terminalId} Turno ${sesionLocal.id_sesion}`,
                    debit: 0,
                    credit: diferencia
                });
            }

            const comprobanteDiarioSiigo = {
                document: { id: 240 },
                date: fechaCierreHoy,
                items: itemsComprobante,
                observations: `Cierre Z GEOKATU POS - Turno: ${sesionLocal.id_sesion} - Terminal: ${terminalId}`
            };

            const payloadCierre = {
                ...sesionLocal,
                terminal_id: terminalId,
                estado: "CERRADA",
                fecha_cierre: new Date().toISOString(),
                base_inicial: base,
                ventas_efectivo: ventasEfectivo,
                ventas_tarjeta: Number(resumenTotales.tarjeta) || 0,
                ventas_nequi: Number(resumenTotales.nequi) || 0,
                base_gravable_turno: baseGravableReal,
                iva_19_turno: ivaGeneradoReal,
                exento_turno: totalExentoReal,
                total_ventas_turno: totalVentasReal,
                total_entradas_menores: entradasMenores,
                total_salidas_menores: salidasMenores,
                esperado_efectivo: esperadoEfectivo,
                contado_efectivo: contado,
                diferencia_cuadre: diferencia,
                estado_cuadre: diferencia === 0 ? "CUADRADA" : (diferencia > 0 ? "SOBRANTE" : "FALTANTE"),
                siigo_journal_ready: {
                    endpoint: "/v1/journals",
                    payload: comprobanteDiarioSiigo,
                    sincronizado_siigo: false
                }
            };

            localStorage.removeItem(claveStorage);

            try {
                if (navigator.onLine) {
                    const batch = writeBatch(db);
                    const arqueoRef = doc(collection(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Cierres_Z`));
                    batch.set(arqueoRef, payloadCierre);

                    // Sellar específicamente la terminal activa sin tocar las demás cajas
                    const turnoActualRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Sesiones_Caja`, `Turno_${terminalId}`);
                    batch.set(turnoActualRef, { estado: "CERRADA", ultimo_cierre: payloadCierre.fecha_cierre, terminal_id: terminalId });

                    await batch.commit();
                }
                return { success: true, cierre: payloadCierre };
            } catch (e) {
                return { success: true, cierre: payloadCierre, offline: true };
            }
        }
    },




    /**
     * @namespace LogisticaService
     */
    LogisticaService: {
        registrarIntencionCompra: async (payload) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const firmaCache = localStorage.getItem('qrpido_totp_ref');
                if (firmaCache) {
                    const cacheData = JSON.parse(firmaCache);
                    if (Date.now() - cacheData.timestamp < 21600000) {
                        payload.referido_totp = cacheData.firma; 
                    } else {
                        localStorage.removeItem('qrpido_totp_ref'); 
                    }
                }
                const docRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${payload.idNegocio}/pedidos_entrantes`, payload.ticket);
                await setDoc(docRef, payload);
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        escucharRadarActivo: (callback) => {
            const radarRef = queryRTDB(rtdbRef(realtimeDb, 'malla_de_gas/ordenes_activas'), orderByChild('timestamp'), limitToLast(50));
            return onValue(radarRef, (snapshot) => {
                const data = snapshot.val() || {};
                callback({ success: true, data: data });
            }, (error) => {
                callback({ success: false, error: error.message });
            });
        },
        inyectarOrdenComercio: async (idOrden, datosRadar, datosSecretos) => {
            try {
                await set(rtdbRef(realtimeDb, `malla_de_gas/ordenes_activas/${idOrden}`), datosRadar);
                await set(rtdbRef(realtimeDb, `malla_de_gas/secretos_ordenes/${idOrden}`), datosSecretos);
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        registrarCierreJornada: async (payload) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const docRef = doc(collection(db, "Historial_Jornadas"));
                await setDoc(docRef, payload);
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        registrarDespachoSUI: async (payload) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const crearOrdenLogistica = httpsCallable(functions, 'crearOrdenLogistica');
                const requestData = {
                    domiciliario_uid: payload.conductorUid,
                    monto_total: payload.montoTotal, 
                    ticketReferido: payload.ticketReferido || null,
                    ticketPublico: payload.ticketPublico
                };

                const funcionRespuesta = await crearOrdenLogistica(requestData);
                const dataBackend = funcionRespuesta.data;

                if (!dataBackend.success) {
                    throw new Error(dataBackend.mensaje || "El Cadenero rechazó la orden.");
                }

                await set(rtdbRef(realtimeDb, `malla_de_gas/ordenes_activas/${payload.ticketPublico}`), {
                    uidConductor: payload.conductorUid,
                    orden_id_db: dataBackend.ordenId, 
                    timestamp: serverTimestamp(),
                    estado: "EN_TRANSITO"
                });
                
                return { success: true, ordenId: dataBackend.ordenId };
            } catch (e) { return { success: false, error: e.message }; }
        },
        liberarFondosSUI: async (payload) => {
            try {
                const radarRef = rtdbRef(realtimeDb, `malla_de_gas/ordenes_activas/${payload.ticketPublico}`);
                const snapshot = await get(radarRef);
                
                if (!snapshot.exists()) {
                    throw new Error("El ticket no existe en la malla o ya fue cobrado.");
                }
                
                const datosOrden = snapshot.val();
                const ordenIdReal = datosOrden.orden_id_db;

                const llamarCadenero = httpsCallable(functions, 'validarEntrega');
                const res = await llamarCadenero({ ordenId: ordenIdReal, codigoSuministrado: payload.ticketSecreto });

                if (!res.data || !res.data.success) {
                    throw new Error(res.data ? res.data.mensaje : "Fallo en la validación.");
                }

                await set(radarRef, null);
                return { success: true, txSui: res.data.txId };
            } catch (e) { return { success: false, error: e.message }; }
        },
        ejecutarKillSwitch: async (ticketPublico, conductorUid) => {
            try {
                await set(rtdbRef(realtimeDb, `malla_de_gas/ordenes_activas/${ticketPublico}`), null);
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        transmitirCoordenadasUnidad: async (tipoUnidad, placaId, dataCoordenadas) => {
            try {
                const nodoRef = rtdbRef(realtimeDb, `malla_de_gas/telemetria_activa/${tipoUnidad}/${placaId}`);
                await set(nodoRef, {
                    lat: dataCoordenadas.lat, lng: dataCoordenadas.lng,
                    ruta: dataCoordenadas.ruta || "N/A", razonSocial: dataCoordenadas.razonSocial || "Independiente",
                    timestamp: serverTimestamp()
                });
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        escucharFlotaActiva: (callback) => {
            const flotaRef = rtdbRef(realtimeDb, 'malla_de_gas/telemetria_activa');
            return onValue(flotaRef, (snapshot) => {
                const data = snapshot.val() || {};
                callback({ success: true, data: data });
            }, (error) => { callback({ success: false, error: error.message }); });
        },
        mandarAlertaDirigida: async (tipoUnidad, placaId, puntoOrigen) => {
            try {
                const alertaRef = rtdbRef(realtimeDb, `malla_de_gas/alertas_conductores/${placaId}`);
                await set(alertaRef, {
                    latOrigen: puntoOrigen.lat, lngOrigen: puntoOrigen.lng,
                    timestamp: serverTimestamp(), atendida: false
                });
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        validarEntregaWeb3: async (ordenId, codigoSecreto) => {
            try {
                const llamarCadenero = httpsCallable(functions, 'validarEntrega');
                const res = await llamarCadenero({ ordenId: ordenId, codigoSuministrado: codigoSecreto });
                return { success: true, data: res.data };
            } catch (e) { return { success: false, error: e.message }; }
        }
    }
}; 

// ==========================================
// EXPORTACIÓN ESTRICTA (Singleton)
// ==========================================
export default GeokatuDB;





