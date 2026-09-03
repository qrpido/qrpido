import { doc, getDoc, setDoc, collection, writeBatch, getDocs, query, where, limit, startAfter, orderBy, startAt, endAt, collectionGroup, deleteDoc, getCountFromServer, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
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
    SubColeccionProductos: "productos"
};

// ==========================================
// 2. CACHÉ EN MEMORIA (Privado)
// ==========================================
const _cacheLocales = {};

// ==========================================
// 3. CAPA DE ABSTRACCIÓN (Singleton Exportable)
// ==========================================
// 🛡️ GUARDIÁN DE SESIÓN (Capa Zero-Trust en Cliente)
const _verificarAcceso = () => {
    const sesionValida = localStorage.getItem('qrpido_session_validated');
    if (!sesionValida) {
        console.error("🚨 Intento de acceso bloqueado: Sesión no validada.");
        return false;
    }
    return true;
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

        registrarMovimientoFisico: async (productoId, ubicacionOrigen, ubicacionDestino, tipoMovimiento) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const invocarCadenero = httpsCallable(functions, 'registrarMovimientoInventario');
                const res = await invocarCadenero({ productoId, ubicacionOrigen, ubicacionDestino, tipoMovimiento });
                return { success: true, data: res.data };
            } catch (e) {
                console.error("Falla en el enlace con el Cadenero Logístico:", e);
                return { success: false, error: e.message };
            }
        },

        rastrearProductoInmutable: async (productoId) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const invocarAuditor = httpsCallable(functions, 'auditarTrazabilidadProducto');
                const res = await invocarAuditor({ productoId });
                return { success: true, data: res.data };
            } catch (e) {
                console.error("Error al contactar al Auditor de Trazabilidad:", e);
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
        subirArchivo: async (path, blob) => {
            try {
                const referenciaArchivo = ref(storage, path);
                await uploadBytes(referenciaArchivo, blob);
                const urlDescarga = await getDownloadURL(referenciaArchivo);
                return { success: true, data: urlDescarga };
            } catch (e) { return { success: false, error: "Error subiendo archivo", details: e.message }; }
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
                if (dataObj.tipo === 'producto' && !dataObj.almacen_id_inicial) {
                    throw new Error("Arquitectura Inválida: Todo producto físico debe nacer en un estante.");
                }
                const docRef = idProducto 
                    ? doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`, idProducto)
                    : doc(collection(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`));
                
                const payloadFinal = { ...dataObj, trazabilidad_activa: true };
                await setDoc(docRef, payloadFinal, { merge: true });
                return { success: true, id_generado: docRef.id };
            } catch (e) { return { success: false, error: e.message }; }
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
                        if (!d.eliminado) resultados.push({ id_prod: doc.id, ...d });
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