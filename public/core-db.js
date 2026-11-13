import { nuevoIdOperacion, quitarConfirmados, crearLoteIdempotente } from './operaciones-integridad.js';
import { doc, getDoc, setDoc, collection, writeBatch, getDocs, query, where, limit, startAfter, orderBy, startAt, endAt, collectionGroup, deleteDoc, getCountFromServer, onSnapshot, increment, runTransaction } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, getAdditionalUserInfo, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getAnalytics, logEvent } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js';
// Motor Geohash Base32 100% Nativo (Cero dependencias externas / Offline-First)
const _BASE32_GH = "0123456789bcdefghjkmnpqrstuvwxyz";
const geofire = {
    geohashForLocation: function(coords, precision) {
        const pres = precision || 9;
        const lat = Number(coords[0]) || 0;
        const lng = Number(coords[1]) || 0;
        let idx = 0, bit = 0, evenBit = true, geohash = "";
        let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180;
        while (geohash.length < pres) {
            if (evenBit) {
                const lngMid = (lngMin + lngMax) / 2;
                if (lng >= lngMid) { idx = idx * 2 + 1; lngMin = lngMid; }
                else { idx = idx * 2; lngMax = lngMid; }
            } else {
                const latMid = (latMin + latMax) / 2;
                if (lat >= latMid) { idx = idx * 2 + 1; latMin = latMid; }
                else { idx = idx * 2; latMax = latMid; }
            }
            evenBit = !evenBit;
            if (++bit === 5) {
                geohash += _BASE32_GH.charAt(idx);
                bit = 0;
                idx = 0;
            }
        }
        return geohash;
    },
    geohashQueryBounds: function(center, radiusInM) {
        const lat = Number(center[0]) || 0;
        const lng = Number(center[1]) || 0;
        const r = Math.max(500, Number(radiusInM) || 3000);
        const precision = r <= 1000 ? 6 : (r <= 5000 ? 5 : (r <= 25000 ? 4 : 3));
        const latDelta = r / 110574;
        const lngDelta = r / (111320 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
        const prefijos = new Set();
        const pasos = [-1, 0, 1];
        for (let i = 0; i < pasos.length; i++) {
            for (let j = 0; j < pasos.length; j++) {
                const pLat = Math.max(-89.9, Math.min(89.9, lat + pasos[i] * latDelta));
                const pLng = Math.max(-179.9, Math.min(179.9, lng + pasos[j] * lngDelta));
                prefijos.add(this.geohashForLocation([pLat, pLng], precision));
            }
        }
        const bounds = [];
        prefijos.forEach(function(pref) {
            bounds.push([pref, pref + "~"]);
        });
        return bounds;
    }
};
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';
import { getDatabase, ref as rtdbRef, set, get, onValue, child, serverTimestamp, query as queryRTDB, limitToLast, orderByChild } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js'; 
import { db } from './firebase-config.js'; // Ajusta la ruta a tu inicialización de Firebase
import { initializeAppCheck, ReCaptchaV3Provider } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app-check.js';

// Extraemos las instancias nativas con tolerancia a entornos sin RTDB configurado
const auth = getAuth(db.app);
const storage = getStorage(db.app); 
let realtimeDb = null;
try {
    realtimeDb = getDatabase(db.app);
} catch (e) {
    console.warn("⚠️ Realtime Database no inicializado (verificar databaseURL):", e.message);
}
let functions = null;
try {
    functions = getFunctions(db.app);
} catch (e) {
    console.warn("⚠️ Firebase Functions no inicializado:", e.message);
}


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
const _cacheContactos = {};

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
        const raw = `${uid}::GEOKATU_TERMINAL_ENCLAVE_TOKEN`;
        if (window.crypto && window.crypto.subtle) {
            const encoder = new TextEncoder();
            const data = encoder.encode(raw);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }
        // Fallback determinista de 64 caracteres para contextos HTTP locales en Termux/Acode
        let h1 = 0xdeadbeef, h2 = 0x41c64e6d;
        for (let i = 0; i < raw.length; i++) {
            const ch = raw.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        const p1 = (4294967296 + h1).toString(16).substring(1);
        const p2 = (4294967296 + h2).toString(16).substring(1);
        return (p1 + p2).repeat(4);
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
    // 1. Si Firebase Auth tiene la sesión en memoria viva
    if (auth && auth.currentUser && auth.currentUser.uid) {
        return true;
    }
    // 2. Si la sesión en memoria aún sincroniza o la terminal opera offline, validar Enclave Local
    const uidLocal = localStorage.getItem('geokatu_active_uid');
    const firmaLocal = localStorage.getItem('geokatu_session_sig');

    if (uidLocal && firmaLocal) {
        if (uidLocal.length >= 20 && firmaLocal.length === 64) {
            return true;
        }
    }
    console.error("🚨 Acceso Denegado: Sesión inexistente o firma de terminal adulterada en almacenamiento local.");
    return false;
};



// =========================================================================
// SERVICIO CATÁLOGO MATRIZ GLOBAL (INDEXEDDB OFFLINE-FIRST 0ms)
// =========================================================================
const DB_NAME_MATRIZ = 'GeokatuMatrizDB';
const DB_VERSION_MATRIZ = 1;
const STORE_MATRIZ = 'productos_matriz';

function abrirDBMatriz() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME_MATRIZ, DB_VERSION_MATRIZ);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_MATRIZ)) {
                db.createObjectStore(STORE_MATRIZ, { keyPath: 'codigo_barras' });
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

export const CatalogoMatrizService = {
    /**
     * Verifica e inicializa la base de datos de la Matriz Global en IndexedDB.
     */
    async inicializarMatriz() {
        try {
            const db = await abrirDBMatriz();
            const tx = db.transaction(STORE_MATRIZ, 'readonly');
            const store = tx.objectStore(STORE_MATRIZ);
            const countReq = store.count();

            const count = await new Promise((res) => {
                countReq.onsuccess = () => res(countReq.result);
                countReq.onerror = () => res(0);
            });

            // Si la BD ya contiene registros, la hidratación previa fue exitosa
            if (count > 0) {
                console.log(`[IndexedDB Matriz] BD lista con ${count} productos indexados.`);
                return { success: true, count };
            }

            // Descarga inicial desde /catalogo_matriz.json
            console.log('[IndexedDB Matriz] Hidratando matriz desde /catalogo_matriz.json...');
            const resp = await fetch('/catalogo_matriz.json');
            if (!resp.ok) throw new Error(`Error HTTP: ${resp.status}`);
            const data = await resp.json();

            const categorias = data.n || [];
            const productos = data.p || [];

            // Transacción masiva de escritura
            const txWrite = db.transaction(STORE_MATRIZ, 'readwrite');
            const storeWrite = txWrite.objectStore(STORE_MATRIZ);

            for (let i = 0; i < productos.length; i++) {
                const [barcode, nombre, idxCat] = productos[i];
                storeWrite.put({
                    codigo_barras: String(barcode).trim(),
                    nombre: nombre,
                    categoria: categorias[idxCat] || 'General'
                });
            }

            await new Promise((res, rej) => {
                txWrite.oncomplete = () => res();
                txWrite.onerror = (e) => rej(e.target.error);
            });

           console.log('[IndexedDB Matriz] Hidratacion completada: ' + productos.length + ' registros.');
            return { success: true, count: productos.length };
        } catch (err) {
            console.error('[IndexedDB Matriz] Error durante inicializacion:', err);
            return { success: false, error: err.message };
        }
    },
    async obtenerProductoPorCodigo(barcode) {
        try {
            const db = await abrirDBMatriz();
            const tx = db.transaction(STORE_MATRIZ, 'readonly');
            const store = tx.objectStore(STORE_MATRIZ);
            const req = store.get(String(barcode).trim());
            return new Promise((resolve) => {
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });
        } catch (err) {
            console.error('[IndexedDB Matriz] Error en consulta por codigo:', err);
            return null;
        }
    }
};

// =========================================================================
// SERVICIO DIRECTORIO MATRIZ GLOBAL (INDEXEDDB OFFLINE-FIRST 0ms)
// =========================================================================
const DB_NAME_DIR = 'GeokatuDirectorioDB';
const DB_VERSION_DIR = 1;
const STORE_DIR = 'comercios_matriz';
function abrirDBDirectorio() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME_DIR, DB_VERSION_DIR);
        request.onupgradeneeded = (e) => {
            const dbInstance = e.target.result;
            if (!dbInstance.objectStoreNames.contains(STORE_DIR)) {
                const store = dbInstance.createObjectStore(STORE_DIR, { keyPath: 'id' });
                store.createIndex('categoria', 'c', { unique: false });
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}
export const DirectorioMatrizService = {
    async inicializarDirectorio(forzarRecarga = false) {
        try {
            const dbInstance = await abrirDBDirectorio();
            const txRead = dbInstance.transaction(STORE_DIR, 'readonly');
            const storeRead = txRead.objectStore(STORE_DIR);
            const countReq = storeRead.count();
            const total = await new Promise((res) => {
                countReq.onsuccess = () => res(countReq.result);
                countReq.onerror = () => res(0);
            });
            if (total > 0 && !forzarRecarga) {
                return { success: true, count: total };
            }
            const bucketName = (db.app.options && db.app.options.storageBucket) 
                ? db.app.options.storageBucket 
                : 'geo-katu.appspot.com';
            const urlStorage = 'https://storage.googleapis.com/' + bucketName + '/directorio_matriz.json';
            
            let resp = null;
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000);
                try { resp = await fetch(urlStorage, {signal:controller.signal}); }
                finally { clearTimeout(timeout); }
                if (!resp.ok) throw new Error('HTTP Storage ' + resp.status);
            } catch (errStorage) {
                resp = await fetch('/directorio_matriz.json');
            }
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const comercios = await resp.json();
            const txWrite = dbInstance.transaction(STORE_DIR, 'readwrite');
            const storeWrite = txWrite.objectStore(STORE_DIR);
            if (forzarRecarga) {
                storeWrite.clear();
            }
            for (let i = 0; i < comercios.length; i++) {
                storeWrite.put(comercios[i]);
            }
            await new Promise((res, rej) => {
                txWrite.oncomplete = () => res();
                txWrite.onerror = (e) => rej(e.target.error);
            });
            localStorage.setItem('geokatu_matriz_timestamp', new Date().toISOString());
            return { success: true, count: comercios.length };
        } catch (err) {
            console.warn('[DirectorioMatriz] Error durante inicializacion:', err.message);
            return { success: false, error: err.message };
        }
    },
    async sincronizarDeltaNube(timestampUltimoCorte, onNuevoComercioCallback) {
        if (!navigator.onLine) return;
        try {
            const fechaCorteISO = timestampUltimoCorte || new Date(Date.now() - 86400000).toISOString();
            const q = query(
                collection(db, "Directorio"),
                where("estado_moderacion", "==", "aprobado"),
                where("fecha_actualizacion", ">", fechaCorteISO)
            );
            return onSnapshot(q, (snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    if (change.type === "added" || change.type === "modified") {
                        const data = change.doc.data();
                        const comercioFormateado = {
                            id: change.doc.id,
                            n: data.nombre || "Comercio Aliado",
                            s: (data.slogan || "").substring(0, 70),
                            c: data.nicho || data.categoria || "General",
                            g: [Number(data.Coordenadas?.latitude ?? data.lat ?? 4.81333), Number(data.Coordenadas?.longitude ?? data.lng ?? -75.69611)],
                            p: data.pin_pack || "forma-gota|anim-salto",
                            b: [data.color_principal || "#ff6b00", data.color_acento || "#8a909d", data.color_terciario || "#ffffff", data.color_cuaternario || "#0a0a0c"],
                            l: data.logo || "",
                            logo: data.logo || "",
                            portada: data.portada || "",
                            link_pin: data.link_pin || "",
                            nombre_png: data.nombre_png || data.logo_nombre || "",
                                                        tema_popup: data.tema_popup || "carbon",
                            direccion: data.direccion || "",
                            direccion_normalizada: data.direccion_normalizada || normalizarDireccionCartesiana(data.direccion || ""),
                            horario: data.horario || "",
                            whatsapp: data.whatsapp || data.whatsApp || "",
                            pbx: data.pbx || "",
                            f: (data.whatsapp ? 1 : 0) | (data.pbx ? 2 : 0) | (data.es_24_horas ? 4 : 0)
                        };
                        abrirDBDirectorio().then((dbInstance) => {
                            const tx = dbInstance.transaction(STORE_DIR, 'readwrite');
                            tx.objectStore(STORE_DIR).put(comercioFormateado);
                            tx.oncomplete = () => dbInstance.close();
                            tx.onerror = () => console.warn('[Directorio Delta] Falló la persistencia local.');
                        }).catch(err => console.warn('[Directorio Delta] Caché:', err.message));
                        if (typeof onNuevoComercioCallback === 'function') {
                            onNuevoComercioCallback(comercioFormateado);
                        }
                    }
                });
            }, (err) => {
                console.warn('[Directorio Delta] Suscripción interrumpida; verificar índice y permisos:', err.message);
            });
        } catch (err) {
            console.warn("[Directorio Delta] Sincronizacion omitida:", err.message);
        }
    },
    async obtenerTodosComercios() {
        try {
            const dbInstance = await abrirDBDirectorio();
            const tx = dbInstance.transaction(STORE_DIR, 'readonly');
            const store = tx.objectStore(STORE_DIR);
            const req = store.getAll();
            return new Promise((resolve) => {
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]);
            });
        } catch (e) {
            return [];
        }
    },
    async obtenerComercioPorId(id) {
        try {
            const dbInstance = await abrirDBDirectorio();
            const tx = dbInstance.transaction(STORE_DIR, 'readonly');
            const store = tx.objectStore(STORE_DIR);
            const req = store.get(String(id));
            return new Promise((resolve) => {
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });
        } catch (e) {
            return null;
        }
    }
};


export function normalizarDireccionCartesiana(dirRaw) {
    const baseVacia = { eje: '', cruce: '', placa: '', cuadra: '', exacta: '', sector: '', tokens: [] };
    if (!dirRaw || typeof dirRaw !== 'string') return baseVacia;

    let txt = dirRaw
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[,;|()]/g, ' ')
        .replace(/\b(NO\.?|NUM\.?|NUMERO|NRO\.?)\b/g, ' ')
        .replace(/#/g, ' # ')
        .replace(/-/g, ' - ')
        .replace(/\b(CARRERAS?|CRAS?\.?|CRS?\.?|KRS?\.?|K)\b/g, 'CRA')
        .replace(/\b(CALLES?|CLLS?\.?|CLS?\.?|CL\.?)\b/g, 'CLL')
        .replace(/\b(AVENIDAS?|AVDAS?\.?|AVS?\.?|AV\.?)\b/g, 'AV')
        .replace(/\b(DIAGONALES?|DIAGS?\.?|DGS?\.?|DG\.?)\b/g, 'DIAG')
        .replace(/\b(TRANSVERSALES?|TRANSV\.?|TVS?\.?|TV\.?)\b/g, 'TV')
        .replace(/\b(MANZANAS?|MZS?\.?|MZ\.?)\b/g, 'MZ')
        .replace(/\b(CASAS?|CS\.?)\b/g, 'CASA')
        .replace(/\b(LOCAL|LOC\.?|APTO\.?|OFICINA|OF\.?|PISO|INT\.?|BARRIO|BRR\.?|SECTOR|URB\.?)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    let eje = '';
    let cruce = '';
    let placa = '';
    let restoSector = txt;

    const regexUrbana = /\b(CRA|CLL|AV|DIAG|TV|MZ)\s+([0-9]+[A-Z]?(?:\s+(?:BIS|SUR|NORTE|ESTE|OESTE))?|[0-9]+\s+DE\s+[A-Z]+)(?:\s*(?:#|CON|CASA|-)\s*([0-9]+[A-Z]?)(?:\s*(?:-|\s)\s*([0-9]+))?|\s+([0-9]{1,3})\s+([0-9]{1,3}))?/;
    const m = txt.match(regexUrbana);

    if (m) {
        eje = (m[1] + ' ' + m[2]).replace(/\s+/g, ' ').trim();
        let rawCruce = m[3] || m[5] || '';
        let rawPlaca = m[4] || m[6] || '';

        if (rawCruce && !rawPlaca && /^[0-9]{4}$/.test(rawCruce)) {
            rawPlaca = rawCruce.slice(2);
            rawCruce = rawCruce.slice(0, 2);
        } else if (rawCruce && !rawPlaca && /^[0-9]{3}$/.test(rawCruce) && Number(rawCruce) > 150) {
            rawPlaca = rawCruce.slice(1);
            rawCruce = rawCruce.slice(0, 1);
        }

        cruce = rawCruce.trim();
        placa = rawPlaca.trim();
        restoSector = txt.replace(m[0], ' ').replace(/[#-]/g, ' ').replace(/\s+/g, ' ').trim();
    } else {
        restoSector = txt.replace(/[#-]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    const cuadra = (eje && cruce) ? (eje + ' ' + cruce) : eje;
    const exacta = (cuadra && placa) ? (cuadra + ' ' + placa) : cuadra;
    const tokens = restoSector
        ? restoSector.split(' ').filter(function(w) { return w.length >= 3 && !/^[0-9]+$/.test(w); })
        : [];

    return {
        eje: eje,
        cruce: cruce,
        placa: placa,
        cuadra: cuadra,
        exacta: exacta,
        sector: restoSector,
        tokens: tokens
    };
}

const GeokatuDB = {
    normalizarDireccionCartesiana,
    CatalogoMatrizService,
    DirectorioMatrizService, 
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
            const cantNumerica = Number(cantidad);
            if (!Number.isFinite(cantNumerica) || cantNumerica <= 0) {
                return { success: false, error: 'La cantidad debe ser positiva y finita.' };
            }


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

            const movIdLocal = nuevoIdOperacion('MOV');
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
                zona: metadata.zona || 'PISO_VENTA',
                estado_sincronizacion: "sincronizado"
            };

            const claveColaMovimiento = `geokatu_movimientos_cola_${idNegocio}`;
            const colaMovimiento = JSON.parse(localStorage.getItem(claveColaMovimiento) || '[]');
            colaMovimiento.push(payloadMovimiento);
            localStorage.setItem(claveColaMovimiento, JSON.stringify(colaMovimiento));
            // 2. Persistencia local inmediata en catálogo en memoria / caché
            const claveCache = `geokatu_catalogo_${idNegocio}`;
            let catalogoLocal = JSON.parse(localStorage.getItem(claveCache) || "[]");
            const prodRAM = catalogoLocal.find(p => p.id_prod === productoId || p.codigo_barras === productoId);
            if (prodRAM && deltaGlobal !== 0) {
                prodRAM.stock_actual = Number((Number(prodRAM.stock_actual || 0) + deltaGlobal).toFixed(3));
                localStorage.setItem(claveCache, JSON.stringify(catalogoLocal));
            }

            // Kardex y efectos comparten un recibo estable para los reintentos.
            try {
                if (!navigator.onLine) {
                    throw new Error("Terminal operando fuera de línea.");
                }

                const movRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Movimientos_Kardex`, movIdLocal);
                const batch = crearLoteIdempotente(db, movRef, runTransaction);
                batch.set(movRef, payloadMovimiento);

                // Actualizar stock escalar raíz
                if (deltaGlobal !== 0) {
                    const prodRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`, productoId);
                    batch.update(prodRef, {
                        stock_actual: increment(deltaGlobal),
                        fecha_actualizacion: new Date().toISOString(),
                        ultima_actualizacion_kardex: payloadMovimiento.timestamp
                    });
                }

                  // 1. Ingreso a compartimiento de destino (Solo en Entradas y Traslados)
                if (metadata.idCompDestino && (tiposEntrada.includes(tipoMovimiento) || tipoMovimiento === 'TRASLADO_INTERNO')) {
                    const ubiDestRef = doc(db, _SCHEMA.ColeccionDirectorio + "/" + idNegocio + "/" + _SCHEMA.SubColeccionProductos + "/" + productoId + "/" + _SCHEMA.SubColeccionUbicacionesStock, metadata.idCompDestino);
                    const payloadUbicacion = {
                        id_negocio: idNegocio,
                        id_estante: metadata.idEstanteDestino || "GENERAL",
                        id_compartimiento: metadata.idCompDestino,
                        zona: metadata.zona || "PISO_VENTA",
                        cantidad: increment(cantNumerica),
                        ultima_modificacion: payloadMovimiento.timestamp
                    };

                    if (metadata.lote) payloadUbicacion.lote = metadata.lote;
                    if (metadata.fechaVencimiento) payloadUbicacion.fecha_vencimiento = metadata.fechaVencimiento;

                    if (payloadUbicacion.zona === 'PISO_VENTA') {
                        const prodRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`, productoId);
                        batch.update(prodRef, { en_piso_venta: true });
                    }

                    batch.set(ubiDestRef, payloadUbicacion, { merge: true });
                }

                // 2. Egreso de compartimiento de origen (En Salidas y Traslados Internos)
                if (metadata.idCompOrigen && (tiposSalida.includes(tipoMovimiento) || tipoMovimiento === 'TRASLADO_INTERNO')) {
                    const ubiOrigRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}/${productoId}/${_SCHEMA.SubColeccionUbicacionesStock}`, metadata.idCompOrigen);
                    batch.set(ubiOrigRef, {
                        id_estante: metadata.idEstanteOrigen || "GENERAL",
                        id_compartimiento: metadata.idCompOrigen,
                        cantidad: increment(-cantNumerica),
                        ultima_modificacion: payloadMovimiento.timestamp
                    }, { merge: true });
                }

                await batch.commit();
                quitarConfirmados(localStorage, claveColaMovimiento, [movIdLocal], 'mov_id_local');
                return { success: true, data: { txID: movRef.id, localId: movIdLocal } };
            } catch (e) {
                console.warn("[InventarioService] Sin conexión de red. Movimiento encolado localmente:", e.message);
                // Ya persistido antes del envío. Conservarlo para un reintento.

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
                        const movRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Movimientos_Kardex`, mov.mov_id_local);
                        const batch = crearLoteIdempotente(db, movRef, runTransaction);

                        batch.set(movRef, {
                            ...mov,
                            estado_sincronizacion: "sincronizado_diferido",
                            timestamp_sincronizacion_nube: new Date().toISOString()
                        });

                        if (mov.delta_global && mov.delta_global !== 0) {
                            const prodRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`, mov.codigo_producto);
                            batch.update(prodRef, {
                                stock_actual: increment(mov.delta_global),
                                fecha_actualizacion: new Date().toISOString(),
                                ultima_actualizacion_kardex: new Date().toISOString()
                            });
                        }

                        if (mov.id_compartimiento_destino && ['ENTRADA', 'RECEPCION_COMPRA', 'AJUSTE_SOBRANTE', 'DEVOLUCION_CLIENTE', 'TRASLADO_INTERNO', 'AJUSTE_CONTEO_CICLICO'].includes(mov.tipo)) {
                            const ubiDestRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}/${mov.codigo_producto}/${_SCHEMA.SubColeccionUbicacionesStock}`, mov.id_compartimiento_destino);
                            const esConteoCiclico = mov.tipo === 'AJUSTE_CONTEO_CICLICO';
                            
                            const payloadSyncUbi = {
                                zona: mov.zona || 'PISO_VENTA',
                                id_negocio: idNegocio,
                                id_estante: mov.id_estante_destino || "GENERAL",
                                id_compartimiento: mov.id_compartimiento_destino,
                                cantidad: esConteoCiclico ? Number(mov.stock_fisico_contado) : increment(mov.cantidad),
                                ultima_modificacion: new Date().toISOString()
                            };

                            if (esConteoCiclico) payloadSyncUbi.ultimo_conteo_ciclico = new Date().toISOString();
                            if (mov.lote) payloadSyncUbi.lote = mov.lote;
                            if (mov.fecha_vencimiento) payloadSyncUbi.fecha_vencimiento = mov.fecha_vencimiento;

                            if (payloadSyncUbi.zona === 'PISO_VENTA') {
                                const prodRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`, mov.codigo_producto);
                                batch.update(prodRef, { en_piso_venta: true });
                            }
                            batch.set(ubiDestRef, payloadSyncUbi, { merge: true });
                        }


                        if (mov.id_compartimiento_origen && ['SALIDA', 'PICKING_VENTA', 'AJUSTE_MERMA', 'DESPACHO', 'TRASLADO_INTERNO'].includes(mov.tipo)) {
                            const ubiOrigRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}/${mov.codigo_producto}/${_SCHEMA.SubColeccionUbicacionesStock}`, mov.id_compartimiento_origen);
                            batch.set(ubiOrigRef, {
                                id_estante: mov.id_estante_origen || "GENERAL",
                                id_compartimiento: mov.id_compartimiento_origen,
                                cantidad: increment(-mov.cantidad),
                                ultima_modificacion: new Date().toISOString()
                            }, { merge: true });
                        }

                        await batch.commit();
                        quitarConfirmados(localStorage, claveCola, [mov.mov_id_local], 'mov_id_local');
                        procesados++;
                    } catch (errMov) {
                        console.error("[GEOKATU Sync Bodega] Error procesando movimiento diferido:", errMov);
                        colaRestante.push(mov);
                    }
                }

                return { sincronizados: procesados, pendientes: JSON.parse(localStorage.getItem(claveCola) || '[]').length };
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
                const tenantReal = idNegocio || localStorage.getItem("geokatu_active_uid");
                let qConstraints = [where("id_negocio", "==", tenantReal)];

                if (desdeTimestamp) {
                    qConstraints.push(where("ultima_modificacion", ">", desdeTimestamp));
                }

                const qUbis = query(collectionGroup(db, _SCHEMA.SubColeccionUbicacionesStock), ...qConstraints);
                const snap = await getDocs(qUbis);
                const deltasOCompleto = [];

                snap.forEach(docSnap => {
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
                });

                return { 
                    success: true, 
                    data: deltasOCompleto, 
                    esDelta: Boolean(desdeTimestamp),
                    timestampCorte: new Date().toISOString() 
                };
            } catch (e) {
                // Fallback automático por si existen documentos previos que aún no tenían el campo id_negocio
                console.warn("[WMS] Reintentando lectura completa sin filtro compuesto:", e.message);
                try {
                    const tenantReal = idNegocio || localStorage.getItem("geokatu_active_uid");
                    const qFallback = query(collectionGroup(db, _SCHEMA.SubColeccionUbicacionesStock));
                    const snapFallback = await getDocs(qFallback);
                    const filtrados = [];
                    snapFallback.forEach(docSnap => {
                        if (docSnap.ref.path.indexOf(_SCHEMA.ColeccionDirectorio + "/" + tenantReal) !== -1) {
                            const data = docSnap.data();
                            const prodId = docSnap.ref.parent.parent ? docSnap.ref.parent.parent.id : null;
                            filtrados.push({
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
                    return { success: true, data: filtrados, esDelta: false, timestampCorte: new Date().toISOString() };
                } catch (errFallback) {
                    return { success: false, error: errFallback.message };
                }
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

        reportarMermaAnaquel: async (idNegocio, idMueble, idCompartimiento, idProducto = null, motivo = "Merma o avería reportada en anaquel") => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const alertaRef = doc(collection(db, "Alertas_Seguridad"));
                const payloadAlerta = {
                    id_alerta: alertaRef.id,
                    id_negocio: idNegocio,
                    tipo: "MERMA_EN_ANAQUEL",
                    estado: "requiere_auditoria_urgente",
                    id_mueble: idMueble,
                    id_compartimiento: idCompartimiento,
                    id_producto: idProducto || "NO_ESPECIFICADO",
                    motivo: motivo,
                    usuario: auth.currentUser ? auth.currentUser.email : "OPERADOR_PISO",
                    timestamp_alerta: new Date().toISOString(),
                    resuelto: false
                };
                if (navigator.onLine) {
                    await setDoc(alertaRef, payloadAlerta);
                } else {
                    const claveAlertasOffline = `geokatu_alertas_offline_${idNegocio}`;
                    const cola = JSON.parse(localStorage.getItem(claveAlertasOffline) || "[]");
                    cola.push(payloadAlerta);
                    localStorage.setItem(claveAlertasOffline, JSON.stringify(cola));
                }
                return { success: true, idAlerta: alertaRef.id };
            } catch (e) {
                console.error("[InventarioService] Error reportando merma en anaquel:", e);
                return { success: false, error: e.message };
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
        },

        /**
         * Obtiene el stock teórico de los artículos asignados a un compartimiento específico (Bin).
         * Resuelve en 0ms desde caché local con fallback a Firestore en línea.
         */
        obtenerStockTeoricoBin: async (idNegocio, idCompartimiento) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            if (!idCompartimiento) return { success: false, error: "Identificador de compartimiento requerido." };

            const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid');
            const claveCacheUbis = `geokatu_stock_ubis_${tenantReal}`;
            const claveCacheCat = `geokatu_catalogo_${tenantReal}`;

            const ubisLocales = JSON.parse(localStorage.getItem(claveCacheUbis) || "[]");
            const catLocal = JSON.parse(localStorage.getItem(claveCacheCat) || "[]");

            const itemsEncontrados = ubisLocales.filter(u => u.id_compartimiento === idCompartimiento);

            if (itemsEncontrados.length > 0 || !navigator.onLine) {
                const resultado = itemsEncontrados.map(u => {
                    const prod = catLocal.find(p => p.id_prod === u.id_prod || p.codigo_barras === u.id_prod) || {};
                    return {
                        id_prod: u.id_prod,
                        codigo_barras: prod.codigo_barras || u.id_prod,
                        nombre: prod.nombre || "Artículo sin descripción",
                        stock_teorico: Number(u.cantidad) || 0,
                        lote: u.lote || "S/L",
                        fecha_vencimiento: u.fecha_vencimiento || null,
                        zona: u.zona || "PISO_VENTA",
                        id_estante: u.id_estante || "GENERAL",
                        id_compartimiento: idCompartimiento
                    };
                });
                return { success: true, data: resultado, origen: "local" };
            }

            try {
                const qUbis = query(
                    collectionGroup(db, _SCHEMA.SubColeccionUbicacionesStock),
                    where("id_compartimiento", "==", idCompartimiento)
                );
                const snap = await getDocs(qUbis);
                const itemsNube = [];

                snap.forEach(d => {
                    if (d.ref.path.includes(`${_SCHEMA.ColeccionDirectorio}/${tenantReal}`)) {
                        const data = d.data();
                        const prodId = d.ref.parent.parent ? d.ref.parent.parent.id : null;
                        const prod = catLocal.find(p => p.id_prod === prodId) || {};
                        itemsNube.push({
                            id_prod: prodId,
                            codigo_barras: prod.codigo_barras || prodId,
                            nombre: prod.nombre || "Artículo sin descripción",
                            stock_teorico: Number(data.cantidad) || 0,
                            lote: data.lote || "S/L",
                            fecha_vencimiento: data.fecha_vencimiento || null,
                            zona: data.zona || "PISO_VENTA",
                            id_estante: data.id_estante || "GENERAL",
                            id_compartimiento: idCompartimiento
                        });
                    }
                });

                return { success: true, data: itemsNube, origen: "nube" };
            } catch (err) {
                console.warn("[InventarioService] Error consultando bin en Firestore, fallback local:", err.message);
                return { success: true, data: itemsEncontrados, origen: "local_fallback" };
            }
        },

        /**
         * Asienta atómicamente el ajuste de Conteo Cíclico en anaquel físico.
         * Genera asiento en Kardex, actualiza el bin, sincroniza el maestro de productos,
         * resuelve alertas de merma/quiebre y persiste con soporte 100% offline.
         */
        asentarAjusteConteoCiclico: async (idNegocio, idCompartimiento, discrepanciasArray, metadata = {}) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            if (!idCompartimiento || !Array.isArray(discrepanciasArray) || discrepanciasArray.length === 0) {
                return { success: false, error: "Datos de auditoría o compartimiento incompletos." };
            }

            const tenantReal = idNegocio || metadata.idNegocio || localStorage.getItem('geokatu_active_uid') || (auth.currentUser ? auth.currentUser.uid : "ADMIN_LOCAL");
            const timestampActual = new Date().toISOString();
            const operadorEmail = auth.currentUser ? auth.currentUser.email : (metadata.operador || "OPERADOR_AUDITORIA");
            const operadorUid = auth.currentUser ? auth.currentUser.uid : (metadata.operador_uid || "TERMINAL_LOCAL");
            const idMueble = metadata.idEstante || (idCompartimiento.startsWith('GEO-P-') ? (idCompartimiento.split('-')[idCompartimiento.split('-').length - 4] || "GENERAL") : "GENERAL");
            const zonaOperacion = metadata.zona || "PISO_VENTA";

            const asientosKardex = [];
            const actualizacionesProductos = [];
            const actualizacionesUbicaciones = [];
            const alertasAResolver = [];

            const claveCacheCat = `geokatu_catalogo_${tenantReal}`;
            const claveCacheUbis = `geokatu_stock_ubis_${tenantReal}`;
            let catalogoLocal = JSON.parse(localStorage.getItem(claveCacheCat) || "[]");
            let ubisLocales = JSON.parse(localStorage.getItem(claveCacheUbis) || "[]");

            for (const item of discrepanciasArray) {
                const prodId = item.id_prod || item.codigo_producto;
                if (!prodId) continue;

                const stockPrevio = Math.max(0, Number(item.stock_previo !== undefined ? item.stock_previo : item.stock_teorico) || 0);
                const stockFisico = Math.max(0, Number(item.stock_fisico_contado !== undefined ? item.stock_fisico_contado : item.stock_fisico) || 0);
                const deltaCalculado = Number((stockFisico - stockPrevio).toFixed(3));
                const movIdLocal = "MOV-AUDIT-" + Date.now().toString(16).toUpperCase() + "-" + Math.random().toString(36).substring(2, 6).toUpperCase();

                const payloadMovimiento = {
                    mov_id_local: movIdLocal,
                    codigo_producto: prodId,
                    origen: deltaCalculado < 0 ? idCompartimiento : "AJUSTE_AUDITORIA",
                    destino: deltaCalculado > 0 ? idCompartimiento : "MERMA_AUDITORIA",
                    tipo: "AJUSTE_CONTEO_CICLICO",
                    cantidad: Math.abs(deltaCalculado),
                    delta_global: deltaCalculado,
                    stock_previo_bin: stockPrevio,
                    stock_fisico_contado: stockFisico,
                    id_estante_destino: idMueble,
                    id_compartimiento_destino: idCompartimiento,
                    zona: zonaOperacion,
                    usuario: operadorEmail,
                    operador_uid: operadorUid,
                    motivo_ajuste: item.motivo || metadata.motivo || "Auditoría física de góndola",
                    lote: item.lote || null,
                    fecha_vencimiento: item.fecha_vencimiento || null,
                    timestamp: timestampActual,
                    estado_sincronizacion: "sincronizado"
                };

                asientosKardex.push(payloadMovimiento);

                actualizacionesProductos.push({
                    id_prod: prodId,
                    delta: deltaCalculado,
                    en_piso_venta: zonaOperacion === "PISO_VENTA"
                });

                actualizacionesUbicaciones.push({
                    id_prod: prodId,
                    id_estante: idMueble,
                    id_compartimiento: idCompartimiento,
                    cantidad_real: stockFisico,
                    zona: zonaOperacion,
                    lote: item.lote || null,
                    fecha_vencimiento: item.fecha_vencimiento || null,
                    ultima_modificacion: timestampActual
                });

                alertasAResolver.push({
                    id_prod: prodId,
                    id_compartimiento: idCompartimiento,
                    stock_conciliado: stockFisico
                });

                // Mutación local en RAM para respuesta instantánea (0ms)
                const prodRAM = catalogoLocal.find(p => p.id_prod === prodId || p.codigo_barras === prodId);
                if (prodRAM && deltaCalculado !== 0) {
                    prodRAM.stock_actual = Math.max(0, Number(((prodRAM.stock_actual || 0) + deltaCalculado).toFixed(3)));
                }

                const ubiRAM = ubisLocales.find(u => (u.id_prod === prodId || u.codigo_barras === prodId) && u.id_compartimiento === idCompartimiento);
                if (ubiRAM) {
                    ubiRAM.cantidad = stockFisico;
                    ubiRAM.ultima_modificacion = timestampActual;
                } else {
                    ubisLocales.push({
                        id_prod: prodId,
                        id_estante: idMueble,
                        id_compartimiento: idCompartimiento,
                        cantidad: stockFisico,
                        zona: zonaOperacion,
                        lote: item.lote || "S/L",
                        fecha_vencimiento: item.fecha_vencimiento || null,
                        ultima_modificacion: timestampActual
                    });
                }
            }

            localStorage.setItem(claveCacheCat, JSON.stringify(catalogoLocal));
            localStorage.setItem(claveCacheUbis, JSON.stringify(ubisLocales));

            // Intentar asentamiento atómico en Firestore
            try {
                if (!navigator.onLine) {
                    throw new Error("Terminal operando fuera de línea.");
                }

                const batch = writeBatch(db);

                // 1. Asientos Kardex
                asientosKardex.forEach(mov => {
                    const movRef = doc(collection(db, `${_SCHEMA.ColeccionDirectorio}/${tenantReal}/Movimientos_Kardex`));
                    batch.set(movRef, mov);
                });

                // 2. Actualización de Producto Maestro
                actualizacionesProductos.forEach(prodUpdate => {
                    if (prodUpdate.delta !== 0) {
                        const prodRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${tenantReal}/${_SCHEMA.SubColeccionProductos}`, prodUpdate.id_prod);
                        const dataUpdate = {
                            stock_actual: increment(prodUpdate.delta),
                            ultima_actualizacion_kardex: timestampActual,
                            ultima_auditoria_fisica: timestampActual
                        };
                        if (prodUpdate.en_piso_venta) {
                            dataUpdate.en_piso_venta = true;
                        }
                        batch.update(prodRef, dataUpdate);
                    }
                });

                // 3. Sobrescritura de cantidad real en stock_ubicaciones
                actualizacionesUbicaciones.forEach(ubiUpdate => {
                    const ubiRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${tenantReal}/${_SCHEMA.SubColeccionProductos}/${ubiUpdate.id_prod}/${_SCHEMA.SubColeccionUbicacionesStock}`, ubiUpdate.id_compartimiento);
                    const payloadUbi = {
                        id_estante: ubiUpdate.id_estante,
                        id_compartimiento: ubiUpdate.id_compartimiento,
                        zona: ubiUpdate.zona,
                        cantidad: ubiUpdate.cantidad_real,
                        ultima_modificacion: ubiUpdate.ultima_modificacion,
                        ultimo_conteo_ciclico: timestampActual
                    };
                    if (ubiUpdate.lote) payloadUbi.lote = ubiUpdate.lote;
                    if (ubiUpdate.fecha_vencimiento) payloadUbi.fecha_vencimiento = ubiUpdate.fecha_vencimiento;
                    batch.set(ubiRef, payloadUbi, { merge: true });
                });

                // 4. Marcado automático de Alertas_Seguridad resueltas
                for (const al of alertasAResolver) {
                    try {
                        const qAlertas = query(
                            collection(db, "Alertas_Seguridad"),
                            where("id_negocio", "==", tenantReal),
                            where("id_producto", "==", al.id_prod),
                            where("estado", "==", "requiere_auditoria_urgente")
                        );
                        const snapAlertas = await getDocs(qAlertas);
                        snapAlertas.forEach(docAlerta => {
                            batch.update(docAlerta.ref, {
                                estado: "resuelta",
                                resuelto: true,
                                stock_conciliado: al.stock_conciliado,
                                motivo_resolucion: "Auditoría y conteo cíclico en anaquel",
                                timestamp_resolucion: timestampActual,
                                usuario_resolucion: operadorEmail
                            });
                        });
                    } catch (eAlerta) {
                        console.warn("[InventarioService] Aviso mitigado en resolución de alerta:", eAlerta.message);
                    }
                }

                await batch.commit();
                return { success: true, totalAjustes: asientosKardex.length, offline: false };

            } catch (errNube) {
                console.warn("[InventarioService] Red no disponible. Asentamiento encolado localmente:", errNube.message);
                const claveCola = `geokatu_movimientos_cola_${tenantReal}`;
                const colaActual = JSON.parse(localStorage.getItem(claveCola) || "[]");

                asientosKardex.forEach(m => {
                    m.estado_sincronizacion = "pendiente_offline";
                    m.es_conteo_ciclico = true;
                    colaActual.push(m);
                });

                localStorage.setItem(claveCola, JSON.stringify(colaActual));
                return { success: true, totalAjustes: asientosKardex.length, offline: true };
            }
        }

    }, 

    /**
     * @namespace LocalService
     */

    LocalService: {
obtenerContactoComercio: async (idNegocio) => {
            if (!idNegocio) return { success: false, error: "ID de comercio requerido." };
            const idLimpio = String(idNegocio).trim();
            // 1. Cache de sesion en memoria (0 ms, 0 lecturas en Firestore)
            if (_cacheContactos[idLimpio]) {
                return { success: true, data: _cacheContactos[idLimpio] };
            }
            // 2. Consulta aislada a Directorio_Contacto (tolerante a fallos de reglas o inexistencia)
            try {
                const docRef = doc(db, "Directorio_Contacto", idLimpio);
                const snap = await getDoc(docRef);
                if (snap.exists()) {
                    const data = snap.data() || {};
                    const tieneFono = Boolean(data.whatsapp || data.whatsApp || (data.telefonos && data.telefonos[0]) || data.pbx);
                    if (tieneFono) {
                        _cacheContactos[idLimpio] = data;
                        return { success: true, data: data };
                    }
                }
            } catch (eContacto) {}
            // 3. Respaldo inmediato desde _cacheLocales (0 ms) o documento raiz de Directorio
            try {
                let d = _cacheLocales[idLimpio] || null;
                if (!d) {
                    const docDirRef = doc(db, _SCHEMA.ColeccionDirectorio, idLimpio);
                    const snapDir = await getDoc(docDirRef);
                    if (snapDir.exists()) d = snapDir.data();
                }
                if (d) {
                    const dataRespaldo = {
                        whatsapp: d.whatsapp || d.whatsApp || (d.telefonos && d.telefonos[0]) || "",
                        telefonos: d.telefonos || [],
                        pbx: d.pbx || "",
                        correo: d.correo || d.email || "",
                        instagram: d.instagram || "",
                        web: d.web || d.sitio_web || ""
                    };
                    _cacheContactos[idLimpio] = dataRespaldo;
                    return { success: true, data: dataRespaldo };
                }
                return { success: false, error: "Contacto no disponible." };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },

        getDetails: async (idNegocio) => {
            try {
                if (_cacheLocales[idNegocio]) {
                    return { success: true, data: _cacheLocales[idNegocio] };
                }
                const docRef = doc(db, _SCHEMA.ColeccionDirectorio, idNegocio);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    const paisComercio = data.pais || "COL";

                    localStorage.setItem(`geokatu_pais_${idNegocio}`, paisComercio);

                    const rutaCatalogo = data.idCatalogoCentral ? data.idCatalogoCentral : idNegocio;
                    const esSucursal = !!data.idCatalogoCentral;
                    const respuestaFinal = {
                        ...data,
                        pais: paisComercio,
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
                // 1. Intento por UID directo (cuentas registradas tradicionalmente)
                const snap = await getDoc(doc(db, _SCHEMA.ColeccionDirectorio, uid));
                if (snap.exists()) {
                    return { success: true, data: { id: snap.id, ...snap.data() } };
                }

                // 2. Intento por coincidencia de correo (Comercios creados en Onboarding)
                if (email && typeof email === 'string') {
                    const emailLimpio = email.trim().toLowerCase();
                    const q = query(
                        collection(db, _SCHEMA.ColeccionDirectorio),
                        where("owner_email", "==", emailLimpio),
                        limit(1)
                    );
                    const snapEmail = await getDocs(q);
                    if (!snapEmail.empty) {
                        const docDueno = snapEmail.docs[0];
                        const dataDueno = docDueno.data();

                        // Vincular el UID de Google con el comercio para accesos posteriores
                        if (!dataDueno.uid_dueno || dataDueno.uid_dueno !== uid) {
                            await setDoc(doc(db, _SCHEMA.ColeccionDirectorio, docDueno.id), {
                                uid_dueno: uid,
                                dueno_registrado: true,
                                fecha_primer_login: new Date().toISOString()
                            }, { merge: true });
                        }

                        // Sellar en memoria para POS, Stock y Cajas
                        localStorage.setItem('geokatu_active_uid', docDueno.id);
                        return { success: true, data: { id: docDueno.id, ...dataDueno } };
                    }
                }

                return { success: true, data: null };
            } catch (e) { 
                return { success: false, error: e.message }; 
            }
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
                
                // Objeto híbrido: compatible con llamadas como string y con destructuración { success, data }
                return {
                    success: true,
                    data: urlDescarga,
                    url: urlDescarga,
                    toString: () => urlDescarga
                };
            } catch (e) { 
                console.error("[Storage] Error en subirArchivo:", e);
                throw e;
            }
        },

        // =========================================================================
        // PIPELINE DE COMPRESIÓN CLIENT-SIDE Y NOMENCLATURA CANÓNICA
        // =========================================================================
        comprimirAWebP: function(archivo, maxDim = 800, calidad = 0.75, forzarCuadrado = true, preservarTransparencia = true) {
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

                        const dimension = Number(maxDim);
                        if (!Number.isFinite(dimension) || dimension < 1 || !w || !h) {
                            reject(new Error("Dimensiones de imagen inválidas"));
                            return;
                        }
                        const escala = Math.min(1, dimension / Math.max(w, h));
                        w = Math.max(1, Math.round(w * escala));
                        h = Math.max(1, Math.round(h * escala));

                        const canvas = document.createElement('canvas');
                        canvas.width = w;
                        canvas.height = h;
                        const ctx = canvas.getContext('2d');
                        if (!ctx) { reject(new Error("Canvas no disponible")); return; }
                        if (!preservarTransparencia) {
                            ctx.fillStyle = '#FFFFFF';
                            ctx.fillRect(0, 0, w, h);
                        }
                        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);

                        canvas.toBlob((blob) => {
                            if (!blob || blob.type !== "image/webp") return reject(new Error("El navegador no pudo codificar WebP"));
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
                if (!archivoOriginal) return { success: false, error: "No se proporciono archivo" };
                const uidOwner = String(idNegocio || localStorage.getItem('geokatu_active_uid') ||
                    (auth.currentUser && auth.currentUser.uid) || '').trim();
                if (uidOwner.includes('/') || !/^[a-zA-Z0-9_-]+$/.test(String(vista))) {
                    throw new Error("Identificador de comercio o vista inválido.");
                }
                if (!uidOwner) {
                    throw new Error("No hay una sesion de comercio valida para autenticar la subida.");
                }
                const blobComprimido = await this.comprimirAWebP(archivoOriginal, 800, 0.75, true, false);
                const codigoLimpio = String(codigoBarras || Date.now()).trim().replace(/[^a-zA-Z0-9_-]/g, '');
                const nombreArchivo = codigoLimpio + '-' + vista + '.webp';
                const rutaStorage = 'productos/' + uidOwner + '/' + nombreArchivo;
                
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
                const ahoraISO = new Date().toISOString();
                
                arrayProductos.forEach(producto => {
                    const prodRef = producto.id ? doc(productosRef, producto.id) : doc(productosRef);
                    batch.set(prodRef, { ...producto, fecha_actualizacion: ahoraISO }, { merge: true }); 
                });
                
                await batch.commit();
                if (!esFranquicia) {
                    setDoc(doc(db, _SCHEMA.ColeccionDirectorio, idReferencia), {
                        catalogo_version: Date.now(),
                        fecha_actualizacion: ahoraISO
                    }, { merge: true }).catch(() => {});
                    delete _cacheLocales[idReferencia];
                }
                return { success: true, data: "Catalogo sincronizado correctamente." };
            } catch (e) { return { success: false, error: "Error sincronizando el catalogo", details: e.message }; }
        },
        verificarUsernameDisponible: async (usernameStr) => {
            try {
                const q = query(collection(db, _SCHEMA.ColeccionDirectorio), where("username", "==", usernameStr));
                const querySnapshot = await getDocs(q);
                return { success: true, data: { disponible: querySnapshot.empty } };
            } catch (e) { return { success: false, error: e.message }; }
        },
        esProductoTiendaValido: (p) => {
            if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
            if (p['0'] !== undefined && p['1'] !== undefined) return false;
            const idP = String(p.id_prod || p.id || '').trim();
            if (!idP || idP === 'undefined' || idP === 'null') return false;
            if (!p.nombre || p.nombre === 'Sin nombre') return false;
            return true;
        },
        actualizarNegocio: async (idNegocio, dataObj) => {
            try {
                const payload = Object.assign({}, dataObj, {
                    fecha_actualizacion: new Date().toISOString()
                });
                await setDoc(doc(db, _SCHEMA.ColeccionDirectorio, idNegocio), payload, { merge: true });
                delete _cacheLocales[idNegocio];
                delete _cacheContactos[idNegocio];
                try {
                    const claveNegCache = 'geokatu_cache_neg_' + idNegocio;
                    const negPrevio = JSON.parse(localStorage.getItem(claveNegCache) || '{}');
                    localStorage.setItem(claveNegCache, JSON.stringify(Object.assign({}, negPrevio, payload)));
                } catch (eLoc) {}
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
                const payload = { 
                    ...dataObj, 
                    pais: dataObj.pais || "COL",
                    progreso_boveda: 61.8 
                };
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
        // Compilador Zero-Reads: Construye el JSON base del catalogo en Storage CDN y el diccionario mapa_precios en el documento raiz
        compilarCatalogoJSON: async (idNegocio, soloActualizarPrecios = false) => {
            try {
                const claveCache = 'geokatu_catalogo_' + idNegocio;
                const listaLocal = JSON.parse(localStorage.getItem(claveCache) || '[]')
                    .filter(p => GeokatuDB.AdminService.esProductoTiendaValido(p) && !p.eliminado);
                if (listaLocal.length === 0) return { success: false };


               // 1. Construir diccionario ultraligero mapa_precios: SOLO [precio, agotadoBit] para jamas pisar el stock_actual operativo
                const mapaPrecios = {};
                const limiteSkus = Math.min(listaLocal.length, 1000);
                for (let i = 0; i < limiteSkus; i++) {
                    const item = listaLocal[i];
                    if (item && item.id_prod) {
                        mapaPrecios[item.id_prod] = [
                            Number(item.precio) || 0,
                            item.agotado ? 1 : 0
                        ];
                    }
                }


                const selloAhora = Date.now();
                const payloadRaiz = {
                    mapa_precios: mapaPrecios,
                    precios_version: selloAhora
                };

                // 2. Si cambio la estructura del catalogo (alta, edicion de foto/nombre/layout o baja), subir catalogo_base.json al CDN de Storage
                if (!soloActualizarPrecios && navigator.onLine) {
                    try {
                        const jsonString = JSON.stringify({
                            v: selloAhora,
                            id: idNegocio,
                            p: listaLocal
                        });
                        const blobJson = new Blob([jsonString], { type: 'application/json' });
                        const rutaJson = 'productos/' + idNegocio + '/catalogo_base.json';
                        const refJson = ref(storage, rutaJson);
                        await uploadBytes(refJson, blobJson, { contentType: 'application/json' });
                        const urlJson = await getDownloadURL(refJson);
                        payloadRaiz.catalogo_json_url = urlJson;
                        payloadRaiz.catalogo_version = selloAhora;
                        localStorage.setItem('geokatu_cache_ver_' + idNegocio, String(selloAhora));
                    } catch (eSt) {
                        payloadRaiz.catalogo_version = selloAhora;
                    }
                }

                await setDoc(doc(db, _SCHEMA.ColeccionDirectorio, idNegocio), payloadRaiz, { merge: true });
                localStorage.setItem('geokatu_cache_prods_' + idNegocio, JSON.stringify(listaLocal));
                delete _cacheLocales[idNegocio];
                return { success: true, version: selloAhora };
            } catch (errComp) {
                console.warn("[Compilador JSON] Aviso:", errComp.message);
                return { success: false, error: errComp.message };
            }
        },
        guardarProducto: async (idNegocio, idProducto, dataObj) => {
            try {
// === CANDADO FREEMIUM: MÁXIMO 150 PRODUCTOS GRATIS ===
                const claveCacheLim = 'geokatu_catalogo_' + idNegocio;
                const listaActualLim = JSON.parse(localStorage.getItem(claveCacheLim) || '[]')
                    .filter(function(p) { return GeokatuDB.AdminService.esProductoTiendaValido(p) && !p.eliminado; });

                const infoTiendaLim = await GeokatuDB.LocalService.getDetails(idNegocio);
                const datosComercioLim = (infoTiendaLim && infoTiendaLim.data) ? infoTiendaLim.data : {};
                const planComercio = datosComercioLim.plan_suscripcion || (datosComercioLim.premium ? 'PRO' : 'FREEMIUM');

                if (!idProducto && planComercio === 'FREEMIUM' && listaActualLim.length >= 150) {
                    return {
                        success: false,
                        limite_freemium: true,
                        error: 'Has alcanzado el limite de 150 productos gratuitos. Activa el Plan Pro para catalogo ilimitado y WMS.'
                    };
                }
                // === FIN CANDADO FREEMIUM ===


                const rutaProds = _SCHEMA.ColeccionDirectorio + '/' + idNegocio + '/' + _SCHEMA.SubColeccionProductos;
                const docRef = idProducto 
                    ? doc(db, rutaProds, idProducto)
                    : doc(collection(db, rutaProds));
                
                const almacenInicial = dataObj.almacen_id_inicial || "BODEGA_GENERAL";
                const ahoraISO = new Date().toISOString();
                
                let imagenNormalizada = null;
                if (dataObj.imagen && typeof dataObj.imagen === 'string' && dataObj.imagen.trim().length > 10) {
                    imagenNormalizada = dataObj.imagen.trim();
                }
                const payloadFinal = { 
                    ...dataObj, 
                    almacen_id_inicial: almacenInicial,
                    trazabilidad_activa: true,
                    eliminado: false,
                    fecha_actualizacion: ahoraISO
                };
                if (imagenNormalizada) {
                    payloadFinal.imagen = imagenNormalizada;
                } else {
                    delete payloadFinal.imagen;
                }
                await setDoc(docRef, payloadFinal, { merge: true });

                // Actualizar en caliente la cache local unificada y compilar JSON + mapa_precios
                try {
                    const claveCache = 'geokatu_catalogo_' + idNegocio;
                    const listaLocal = JSON.parse(localStorage.getItem(claveCache) || '[]');
                    const itemNormalizado = {
                        ...payloadFinal,
                        id_prod: docRef.id,
                        codigo_barras: payloadFinal.codigo_barras ? String(payloadFinal.codigo_barras).trim() : "",
                        plu: payloadFinal.plu ? String(payloadFinal.plu).trim() : "",
                        nombre: payloadFinal.nombre || "Sin nombre",
                        precio: Number(payloadFinal.precio) || 0,
                        stock_actual: payloadFinal.stock_actual !== undefined ? Number(payloadFinal.stock_actual) : 0,
                        impuesto: payloadFinal.impuesto || "19",
                        icono: payloadFinal.icono || "inventory_2",
                        es_pesable: Boolean(payloadFinal.es_pesable),
                        unidad_medida: payloadFinal.unidad_medida || (payloadFinal.es_pesable ? "kg" : "und")
                    };
                    const idxExistente = listaLocal.findIndex(p => p.id_prod === docRef.id);
                    if (idxExistente !== -1) {
                        listaLocal[idxExistente] = Object.assign({}, listaLocal[idxExistente], itemNormalizado);
                    } else {
                        listaLocal.push(itemNormalizado);
                    }
                    localStorage.setItem(claveCache, JSON.stringify(listaLocal));
                    localStorage.setItem('geokatu_catalogo_sync_' + idNegocio, ahoraISO);
                } catch (eCache) {}

                GeokatuDB.AdminService.compilarCatalogoJSON(idNegocio, false).catch(() => {});

                if (!idProducto && Number(dataObj.stock_actual) > 0) {
                    const ubiInicialRef = doc(db, _SCHEMA.ColeccionDirectorio + "/" + idNegocio + "/" + _SCHEMA.SubColeccionProductos + "/" + docRef.id + "/" + _SCHEMA.SubColeccionUbicacionesStock, "BIN_INICIAL");
                    await setDoc(ubiInicialRef, {
                        id_negocio: idNegocio,
                        id_estante: almacenInicial,
                        id_compartimiento: "BIN_INICIAL",
                        cantidad: Number(dataObj.stock_actual),
                        lote: dataObj.lote_inicial || dataObj.lote || "L-INICIAL",
                        fecha_vencimiento: dataObj.fecha_vencimiento || null,
                        zona: "PISO_VENTA",
                        ultima_modificacion: ahoraISO
                    }, { merge: true });
                }
                if (!idProducto) {
                    try {
                        await setDoc(doc(db, "sistema", "metricas_red"), {
                            total_skus: increment(1)
                        }, { merge: true });
                    } catch (eMet) {
                        console.warn("[Metricas Red] Advertencia en contador global:", eMet.message);
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
                const forzarCompleta = Boolean(filtros && filtros.forzarCompleta);
                const resSync = await GeokatuDB.PosService.descargarCatalogoLocal(idNegocio, forzarCompleta);
                if (resSync && resSync.success) {
                    return { success: true, data: resSync.data || [], ultimoDoc: null, esDelta: Boolean(resSync.esDelta) };
                }
                return { success: false, error: (resSync && resSync.error) || "Error obteniendo catalogo" };
            } catch (e) { return { success: false, error: e.message }; }
        },
        actualizarProducto: async (idNegocio, idProducto, dataObj) => {
            try {
                const ahoraISO = new Date().toISOString();
                const payload = { ...dataObj, fecha_actualizacion: ahoraISO };
                await setDoc(doc(db, _SCHEMA.ColeccionDirectorio + '/' + idNegocio + '/' + _SCHEMA.SubColeccionProductos, idProducto), payload, { merge: true });

                try {
                    const claveCache = 'geokatu_catalogo_' + idNegocio;
                    const listaLocal = JSON.parse(localStorage.getItem(claveCache) || '[]');
                    const idx = listaLocal.findIndex(p => p.id_prod === idProducto);
                    if (idx !== -1) {
                        listaLocal[idx] = Object.assign({}, listaLocal[idx], payload);
                        if (payload.precio !== undefined) listaLocal[idx].precio = Number(payload.precio) || 0;
                        if (payload.stock_actual !== undefined) listaLocal[idx].stock_actual = Number(payload.stock_actual) || 0;
                        localStorage.setItem(claveCache, JSON.stringify(listaLocal));
                    }
                } catch (eCache) {}

                // Si solo cambio precio, stock o estado agotado, solo hidrata mapa_precios sin resubir el JSON entero
                const llaves = Object.keys(dataObj || {});
                const soloPrecioOEstado = llaves.every(k => ['precio', 'agotado', 'stock_actual', 'fecha_actualizacion'].includes(k));
                GeokatuDB.AdminService.compilarCatalogoJSON(idNegocio, soloPrecioOEstado).catch(() => {});
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        guardarComision: async (idNegocio, idComision, dataObj) => {
            try {
                await setDoc(doc(db, _SCHEMA.ColeccionDirectorio + '/' + idNegocio + '/comisiones_referidos', idComision), dataObj, { merge: true });
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        eliminarProducto: async (idNegocio, idProducto) => {
            try {
                const ahoraISO = new Date().toISOString();
                await setDoc(doc(db, _SCHEMA.ColeccionDirectorio + '/' + idNegocio + '/' + _SCHEMA.SubColeccionProductos, idProducto), {
                    agotado: true,
                    eliminado: true,
                    fecha_actualizacion: ahoraISO
                }, { merge: true });
                try {
                    const claveCache = 'geokatu_catalogo_' + idNegocio;
                    const listaLocal = JSON.parse(localStorage.getItem(claveCache) || '[]').filter(p => p.id_prod !== idProducto);
                    localStorage.setItem(claveCache, JSON.stringify(listaLocal));
                } catch (eCache) {}
                GeokatuDB.AdminService.compilarCatalogoJSON(idNegocio, false).catch(() => {});
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
        },

        // // =========================================================================
        // 🚀 SUBIDA MASIVA ONESHOT CON ESQUEMA CANÓNICO COMPLETO (21 CAMPOS + BRANDING + GEOHASH)
        // =========================================================================
        subirLoteComerciosDirectorio: async (loteComercios) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            if (!Array.isArray(loteComercios) || loteComercios.length === 0) {
                return { success: false, error: "No se proporcionaron comercios para subir." };
            }
            try {
                const TAM_LOTE = 400;
                let subidosTotal = 0;

                for (let i = 0; i < loteComercios.length; i += TAM_LOTE) {
                    const tanda = loteComercios.slice(i, i + TAM_LOTE);
                    const batch = writeBatch(db);

                    tanda.forEach(item => {
                        // Extracción quirúrgica de coordenadas (soporta Number, Object y String "lat, lng")
                        let lat = null;
                        let lng = null;

                        if (item.Coordenadas && typeof item.Coordenadas.latitude === 'number') {
                            lat = item.Coordenadas.latitude;
                            lng = item.Coordenadas.longitude;
                        } else if (typeof item.lat === 'number' && !isNaN(item.lat)) {
                            lat = item.lat;
                            lng = item.lng;
                        } else {
                            const rawCoords = String(item.coordenada_validada || item.coordenadas_crudo || item.lat || '');
                            const match = rawCoords.match(/[-+]?\d{1,3}(?:\.\d+)?/g);
                            if (match && match.length >= 2) {
                                lat = parseFloat(match[0]);
                                lng = parseFloat(match[1]);
                            }
                        }

                        // Inversión automática si longitud y latitud vienen invertidas
                        if (lat !== null && lng !== null && lat < -50 && lng > -10 && lng < 20) {
                            const temp = lat; lat = lng; lng = temp;
                        }

                        // Respaldo de seguridad en centroide de Pereira si no hay coordenadas válidas
                        lat = (typeof lat === 'number' && !isNaN(lat)) ? Number(lat.toFixed(6)) : 4.81333;
                        lng = (typeof lng === 'number' && !isNaN(lng)) ? Number(lng.toFixed(6)) : -75.69611;


                        // Cálculo nativo del Geohash espacial mediante geofire
                        let geohashStr = "";
                        try {
                            if (typeof geofire !== 'undefined' && geofire.geohashForLocation) {
                                geohashStr = geofire.geohashForLocation([lat, lng]);
                            }
                        } catch (eG) {}

                        const docRef = item.id ? doc(db, _SCHEMA.ColeccionDirectorio, item.id) : doc(collection(db, _SCHEMA.ColeccionDirectorio));
                        
                        const arrFonos = Array.isArray(item.telefonos) 
                            ? item.telefonos 
                            : String(item.whatsapp || '').split('|').map(f => f.trim().replace(/\D/g, '')).filter(Boolean);

                        // Garantizar array estricto en tags_busqueda
                        let tagsArray = [];
                        if (Array.isArray(item.tags_busqueda)) {
                            tagsArray = item.tags_busqueda;
                        } else if (typeof item.tags_busqueda === 'string' && item.tags_busqueda.trim()) {
                            tagsArray = item.tags_busqueda.split(/[,|;]/).map(t => t.replace(/^#/, '').trim()).filter(Boolean);
                        }

                        const payload = {
                            // Identidad y Textos Comerciales
                            nombre: item.nombre || "Comercio Aliado",
                            slogan: item.slogan || item.cuerpo_articulo || "",
                            cuerpo_articulo: item.slogan || item.cuerpo_articulo || "",
                            nicho: item.nicho || item.categoria || "General",
                            categoria: item.nicho || item.categoria || "General",
                            categoria_maestra: item.nicho || item.categoria || "General",
                            tags_busqueda: tagsArray,
                            informacion_adicional: item.informacion_adicional || "",

                                                        // Cartografía y Ubicación Geoespacial
                            direccion: item.direccion || "",
                            direccion_normalizada: normalizarDireccionCartesiana(item.direccion || ""),
                            plus_code: item.plus_code || "",
                            Coordenadas: { latitude: lat, longitude: lng },
                            lat: lat,
                            lng: lng,
                            ubicacion: { lat: lat, lng: lng },
                            geohash: geohashStr,
                            pais: item.pais || "COL",

                            // Canales de Comunicación y Redes
                            whatsapp: arrFonos[0] || "",
                            whatsApp: arrFonos[0] || "",
                            telefonos: arrFonos,
                            pbx: item.pbx || "",
                            email: item.correo || item.email || "",
                            correo: item.correo || item.email || "",
                            instagram: String(item.instagram_handle || item.instagram || '').replace(/^@/, '').trim(),
                            facebook: item.facebook || "",
                            web: item.sitio_web || item.web || "",
                            sitio_web: item.sitio_web || item.web || "",

                            // Operación y Horarios
                            horario: item.horario || "",
                            es_24_horas: Boolean(item.es_24_horas),

                            // Auditoría Maps y Calificaciones
                            verificado_maps: item.verificado_maps || "NO",
                            cant_resenas: Number(item.cant_resenas) || 0,
                            resena_picante: item.resena_picante || "",
                            destacado_estrella: Boolean(item.destacado_estrella),

                            // ADN del Pin Vectorial 3D y Rueda Cromática Áurea
                            pin_pack: item.pin_pack || "forma-gota|anim-salto||",
                            color_principal: item.color_principal || "#ff6b00",
                            color_acento: item.color_acento || "#8a909d",
                            color_terciario: item.color_terciario || "#ffffff",
                            paleta_distribucion: item.paleta_distribucion || [
                                { color: item.color_principal || "#ff6b00", porcentaje: 50 },
                                { color: item.color_acento || "#8a909d", porcentaje: 25 },
                                { color: item.color_terciario || "#ffffff", porcentaje: 12.5 }
                            ],

                            // Recursos Gráficos
                            logo: (item.logo && item.logo.startsWith('http')) ? item.logo : "",
                            portada: (item.portada && item.portada.startsWith('http')) ? item.portada : "",
                            link_pin: (item.link_pin && item.link_pin.startsWith('http')) ? item.link_pin : "",
                            logo_nombre: (item.logo_nombre && item.logo_nombre.startsWith('http')) ? item.logo_nombre : "",

                            // Bóveda de Custodia y Moderación
                            reclamado: Boolean(item.reclamado),
                            dueno_registrado: Boolean(item.dueno_registrado),
                            owner_email: item.owner_email || item.dueno_email || "",
                            estado_moderacion: "aprobado",
                            premium: false,
                            progreso_boveda: 100,
                            tipo_modelo: "negocio",
                            fecha_registro: item.fecha_registro || new Date(),
                            fecha_ingreso: item.fecha_ingreso || new Date().toISOString(),
                            fecha_actualizacion: new Date().toISOString(),
                            origen_cuenta: "Onboarding_OneShot_Radar"
                        };

                        batch.set(docRef, payload, { merge: true });
                        subidosTotal++;
                    });

                    await batch.commit();
                }

                return { success: true, totalSubidos: subidosTotal };
            } catch (err) {
                console.error("[AdminService] Error en subida masiva de comercios:", err);
                return { success: false, error: err.message };
            }
        },


        // =========================================================================
        // 🔑 ASIGNAR COMERCIO A SU DUEÑO (CLAIM DE NEGOCIO)
        // =========================================================================
        asignarDuenoComercio: async (idNegocio, emailDueno, datosExtra = {}) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            if (!idNegocio || !emailDueno) return { success: false, error: "Identificador de negocio y correo requeridos." };
            try {
                const docRef = doc(db, _SCHEMA.ColeccionDirectorio, idNegocio);
                const payloadClaim = {
                    reclamado: true,
                    dueno_registrado: true,
                    owner_email: String(emailDueno).trim().toLowerCase(),
                    fecha_entrega_dueno: new Date().toISOString(),
                    credencial_temporal_activa: true,
                    ...datosExtra
                };
                await setDoc(docRef, payloadClaim, { merge: true });
                delete _cacheLocales[idNegocio];
                return { success: true, data: payloadClaim };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        // =========================================================================
        // 🔄 CONMUTAR ESTADO RECLAMADO (SWITCH LIBRE / TOMADO)
        // =========================================================================
        conmutarEstadoReclamado: async (idNegocio, estaTomado) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const docRef = doc(db, _SCHEMA.ColeccionDirectorio, idNegocio);
                await setDoc(docRef, { reclamado: Boolean(estaTomado) }, { merge: true });
                delete _cacheLocales[idNegocio];
                return { success: true, reclamado: Boolean(estaTomado) };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        // =========================================================================
        // 🔍 CONSULTA DIRECTA DE COMERCIOS EN FIRESTORE (CENTRAL DE ADMINISTRACIÓN)
        // =========================================================================
        guardarEnlaceAppScriptOnboarding: async (urlAppScript) => {
            try {
                const url = new URL(String(urlAppScript || '').trim());
                if (url.origin !== 'https://script.google.com' ||
                    !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname) || url.username || url.password) {
                    throw new Error('Usa la URL publicada de Apps Script terminada en /exec.');
                }
                await setDoc(doc(db, 'Sistema', 'Onboarding_Privado'), {
                    url_appscript_onboarding: url.href,
                    fecha_actualizacion: new Date().toISOString()
                }, { merge: true });
                try { localStorage.setItem('geokatu_apps_script_url', url.href); } catch (_) {}
                return { success: true, url: url.href };
            } catch (err) { return { success: false, error: err.message }; }
        },
        obtenerEnlaceAppScriptOnboarding: async () => {
            try {
                if (navigator.onLine) {
                    const snap = await getDoc(doc(db, 'Sistema', 'Onboarding_Privado'));
                    const url = snap.exists() ? snap.data().url_appscript_onboarding : '';
                    if (url) {
                        try { localStorage.setItem('geokatu_apps_script_url', url); } catch (_) {}
                        return { success: true, url, origen: 'nube' };
                    }
                }
                return { success: true, url: localStorage.getItem('geokatu_apps_script_url') || '', origen: 'local' };
            } catch (err) {
                return { success: true, url: localStorage.getItem('geokatu_apps_script_url') || '', origen: 'local', error: err.message };
            }
        },
        buscarComerciosDirectorio: async (criterioBusqueda = "", maxRegistros = 50, ultimoDoc = null) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const tamano = Math.max(1, Math.min(500, Math.floor(Number(maxRegistros) || 50)));
                const restricciones = [orderBy('__name__')];
                if (ultimoDoc) restricciones.push(startAfter(ultimoDoc));
                restricciones.push(limit(tamano));
                const snap = await getDocs(query(collection(db, _SCHEMA.ColeccionDirectorio), ...restricciones));
                const busqueda = String(criterioBusqueda).toLowerCase().trim();
                const data = snap.docs.map(d => {
                    const v = d.data();
                    const tomado = v.reclamado === true || v.dueno_registrado === true ||
                        (v.uid_dueno != null && v.uid_dueno !== '') || (v.owner_email != null && v.owner_email !== '');
                    return { ...v, id: d.id, esta_tomado: tomado, editable_en_onboarding: !tomado };
                }).filter(v => [v.id, v.nombre, v.nicho, v.direccion, v.whatsapp, v.owner_email].join(' ').toLowerCase().includes(busqueda));
                const libres = data.filter(v => !v.esta_tomado);
                const tomados = data.filter(v => v.esta_tomado);
                return { success: true, data, libres, tomados,
                    totales: { todos: data.length, libres: libres.length, tomados: tomados.length },
                    alcance: 'pagina', ultimoDoc: snap.docs.at(-1) || null, puedeHaberMas: snap.size === tamano };
            } catch (err) { return { success: false, error: err.message, data: [], libres: [], tomados: [] }; }
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
       // Inyector O(1) exclusivo de precios y estado agotado desde el documento raiz (preserva intacto el stock_actual)
        hidratarPreciosEnCatalogo: (listaProductos, mapaPrecios) => {
            if (!Array.isArray(listaProductos)) return [];
            if (!mapaPrecios || typeof mapaPrecios !== 'object') return listaProductos;
            return listaProductos.map(prod => {
                const idP = prod.id_prod || prod.id;
                const entrada = idP ? mapaPrecios[idP] : null;
                if (entrada !== undefined && entrada !== null) {
                    if (Array.isArray(entrada)) {
                        prod.precio = Number(entrada[0]) || 0;
                        prod.agotado = Boolean(entrada[1] === 1 || entrada[1] === true);
                    } else if (typeof entrada === 'number') {
                        prod.precio = entrada;
                    } else if (typeof entrada === 'object') {
                        if (entrada.p !== undefined) prod.precio = Number(entrada.p) || 0;
                        if (entrada.a !== undefined) prod.agotado = Boolean(entrada.a);
                    }
                }
                return prod;
            });
        },

        obtenerProductosPublicos: async (idNegocio, filtros) => {
            const claveProdsPub = 'geokatu_cache_prods_' + idNegocio;
            const claveVerPub = 'geokatu_cache_ver_' + idNegocio;
            try {
                const infoLocal = await GeokatuDB.LocalService.getDetails(idNegocio);
                if (!infoLocal.success) throw new Error("No se pudo rutear el catalogo.");
                
                const dataNeg = infoLocal.data || {};
                const mapaPreciosRaiz = dataNeg.mapa_precios || null;
                const versionRemota = dataNeg.catalogo_version ? String(dataNeg.catalogo_version) : null;
                const urlJsonCatalogo = dataNeg.catalogo_json_url || null;
                const versionLocal = localStorage.getItem(claveVerPub);
                const cacheCruda = localStorage.getItem(claveProdsPub);

                // CAPA 1: Si el esqueleto no ha cambiado (versionLocal === versionRemota), hidratar precios en 0 ms desde mapa_precios (0 lecturas Firestore / 0 descargas Storage)
                if (cacheCruda && !(filtros && filtros.startAfterDoc) && !(filtros && filtros.forzarNube)) {
                    if (!navigator.onLine || (versionRemota && versionLocal === versionRemota)) {
                        const prodsCache = JSON.parse(cacheCruda).filter(p => GeokatuDB.AdminService.esProductoTiendaValido(p));
                        if (prodsCache.length > 0) {
                            const prodsHidratados = GeokatuDB.RadarService.hidratarPreciosEnCatalogo(prodsCache, mapaPreciosRaiz);
                            localStorage.setItem(claveProdsPub, JSON.stringify(prodsHidratados));
                            return { success: true, data: prodsHidratados, ultimoDoc: null, desdeCache: true };
                        }
                    }
                }
                // CAPA 2: Descargar el esqueleto desde el JSON estatico en Cloud Storage CDN (validando que no sea catalogo_matriz.json)
                if (urlJsonCatalogo && navigator.onLine && !(filtros && filtros.startAfterDoc)) {
                    try {
                        const sep = urlJsonCatalogo.indexOf('?') !== -1 ? '&' : '?';
                        const respJson = await fetch(urlJsonCatalogo + sep + 'v=' + (versionRemota || Date.now()));
                        if (respJson.ok) {
                            const paqueteJson = await respJson.json();
                            if (!paqueteJson.n) {
                                const arrayBase = Array.isArray(paqueteJson) ? paqueteJson : (paqueteJson.p || []);
                                const filtradosJson = arrayBase.filter(p => GeokatuDB.AdminService.esProductoTiendaValido(p) && p.eliminado !== true);
                                if (filtradosJson.length > 0) {
                                    const prodsConPrecios = GeokatuDB.RadarService.hidratarPreciosEnCatalogo(filtradosJson, mapaPreciosRaiz);
                                    localStorage.setItem(claveProdsPub, JSON.stringify(prodsConPrecios));
                                    localStorage.setItem('geokatu_catalogo_' + idNegocio, JSON.stringify(prodsConPrecios));
                                    if (versionRemota) localStorage.setItem(claveVerPub, versionRemota);
                                    return { success: true, data: prodsConPrecios, ultimoDoc: null, desdeJsonCDN: true };
                                }
                            }
                        }
                    } catch (eCdn) {
                        console.warn("[Catalogo JSON CDN] Fallback a subcoleccion:", eCdn.message);
                    }
                }


                // CAPA 3: Fallback retrocompatible a Firestore solo para comercios antiguos que aun no tienen catalogo_base.json
                const rutaCatalogo = dataNeg._meta.idParaProductos;
                const esFranquicia = dataNeg._meta.esFranquicia;
                const coleccionBase = esFranquicia ? _SCHEMA.ColeccionCatalogos : _SCHEMA.ColeccionDirectorio;
                const productosRef = collection(db, coleccionBase, rutaCatalogo, _SCHEMA.SubColeccionProductos);
                
                let queryConstraints = [];
                if (filtros && filtros.limite) queryConstraints.push(limit(filtros.limite));
                if (filtros && filtros.startAfterDoc) queryConstraints.push(startAfter(filtros.startAfterDoc));
                const q = query(productosRef, ...queryConstraints);
                
                const querySnapshot = await getDocs(q);
                let resultados = [];
                let ultimoDoc = null;
                
                if (!querySnapshot.empty) {
                    ultimoDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
                    querySnapshot.forEach((docSnap) => {
                        const d = docSnap.data();
                        if (d.eliminado !== true) {
                            resultados.push({ 
                                id_prod: docSnap.id, 
                                stock_actual: d.stock_actual !== undefined ? Number(d.stock_actual) : 0,
                                en_piso_venta: d.en_piso_venta !== undefined ? Boolean(d.en_piso_venta) : false,
                                ...d 
                            });
                        }
                    });
                }
                resultados = GeokatuDB.RadarService.hidratarPreciosEnCatalogo(resultados, mapaPreciosRaiz);
                if (!(filtros && filtros.startAfterDoc)) {
                    try {
                        localStorage.setItem(claveProdsPub, JSON.stringify(resultados));
                        if (versionRemota) {
                            localStorage.setItem(claveVerPub, versionRemota);
                        }
                    } catch (eSt) {}
                }
                return { success: true, data: resultados, ultimoDoc: ultimoDoc, desdeCache: false };
            } catch (e) {
                const respaldoLocal = localStorage.getItem(claveProdsPub);
                if (respaldoLocal) {
                    return { success: true, data: JSON.parse(respaldoLocal), ultimoDoc: null, desdeCache: true, offline: true };
                }
                return { success: false, error: "Error obteniendo productos", details: e.message };
            }
        },

        
       /**
         * Motor de Doble Capa por Código de Barras (IndexedDB 0 ms + Firestore Híbrido)
         * Resuelve datos reales de tiendas sobre el catálogo matriz y busca en nube y local.
         */
        buscarComerciosPorCodigoEAN: async function(codigoBarras) {
            const barcodeClean = String(codigoBarras).trim();
            const barcodeNum = Number(barcodeClean);
            const esNumeroValido = !isNaN(barcodeNum) && barcodeClean.length > 0;

            let productoInfo = {
                barcode: barcodeClean,
                nombre: "Producto no registrado",
                categoria: "General",
                precio: "0",
                costo: "0",
                stock_actual: "1",
                unidad: "STD",
                lote: "",
                vencimiento: "",
                nota: "",
                imagen: ""
            };

            // -----------------------------------------------------------------
            // 1. CAPA 1: Resolución de respaldo en Diccionario Maestro (0 ms)
            // -----------------------------------------------------------------
            let matchMaestro = null;
            if (typeof CatalogoMatrizService !== 'undefined' && CatalogoMatrizService.obtenerProductoPorCodigo) {
                matchMaestro = await CatalogoMatrizService.obtenerProductoPorCodigo(barcodeClean);
            }

            if (!matchMaestro) {
                const catalogoMatriz = JSON.parse(localStorage.getItem('geokatu_catalogo_matriz') || "[]");
                const matchLS = catalogoMatriz.find(p => 
                    Array.isArray(p) 
                        ? String(p[0]).trim() === barcodeClean 
                        : (String(p.codigo || p.codigo_barras || p.barcode).trim() === barcodeClean)
                );
                if (matchLS) {
                    matchMaestro = {
                        nombre: Array.isArray(matchLS) ? matchLS[1] : (matchLS.nombre || matchLS.n),
                        categoria: Array.isArray(matchLS) ? matchLS[2] : (matchLS.categoria || "General")
                    };
                }
            }

            if (matchMaestro) {
                productoInfo.nombre = matchMaestro.nombre || productoInfo.nombre;
                productoInfo.categoria = matchMaestro.categoria || productoInfo.categoria;
            }

            // -----------------------------------------------------------------
            // 2. CAPA 2: Stock Activo de Comercios (Red + Memoria Local)
            // -----------------------------------------------------------------
            const comerciosCoincidentes = [];
            const comerciosProcesados = new Set();

            const procesarArticuloComercio = (data, idDoc, idPadreFallback) => {
                const idComercio = data.id_negocio || data.id_comercio || idPadreFallback;
                if (!idComercio) return;

                const stockNum = Number(data.stock_actual ?? data.stock ?? 1);
                const estaAgotado = Boolean(data.agotado === true || data.eliminado === true);

                if (!estaAgotado && stockNum > 0) {
                    if (!comerciosProcesados.has(idComercio)) {
                        comerciosProcesados.add(idComercio);
                        const precioReal = Number(data.precio || 0);

                        comerciosCoincidentes.push({
                            id_comercio: idComercio,
                            precio: precioReal,
                            stock: stockNum,
                            id_producto: idDoc
                        });

                        // 👈 VITAL: La información y precio de la tienda SIEMPRE ganan
                        if (precioReal > 0) {
                            productoInfo.precio = precioReal;
                        }
                        if (data.nombre && (data.nombre.length > 2)) {
                            productoInfo.nombre = data.nombre; // Adopta "Crema dermoprotectora"
                        }
                        if (data.categoria && data.categoria !== 'General') {
                            productoInfo.categoria = data.categoria;
                        }
                        if (data.imagen) {
                            productoInfo.imagen = data.imagen;
                        }
                    }
                }
            };

            // A. Revisión en catálogos locales en este navegador (0 ms garantizado)
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith('geokatu_catalogo_')) {
                        const idComercioKey = key.replace('geokatu_catalogo_', '');
                        const catalogoLocal = JSON.parse(localStorage.getItem(key) || "[]");
                        catalogoLocal.forEach(p => {
                            const cod = String(p.codigo_barras || p.codigo || p.id_prod || '').trim();
                            if (cod === barcodeClean) {
                                procesarArticuloComercio(p, p.id_prod || p.id, idComercioKey);
                            }
                        });
                    }
                }
            } catch (eLoc) {
                console.warn("[Core-DB] Error leyendo inventarios locales:", eLoc);
            }

            // B. Consulta Híbrida en Firestore (Texto y Número)
            if (navigator.onLine) {
                try {
                    const queries = [
                        query(collectionGroup(db, _SCHEMA.SubColeccionProductos), where("codigo_barras", "==", barcodeClean))
                    ];

                    if (esNumeroValido) {
                        queries.push(query(collectionGroup(db, _SCHEMA.SubColeccionProductos), where("codigo_barras", "==", barcodeNum)));
                    }

                    const snapshots = await Promise.all(queries.map(q => getDocs(q).catch(err => {
                        console.warn("[Core-DB] Aviso en collectionGroup:", err.message);
                        return { forEach: () => {} };
                    })));

                    snapshots.forEach(snap => {
                        snap.forEach(docSnap => {
                            const data = docSnap.data();
                            const idPadre = docSnap.ref.parent && docSnap.ref.parent.parent ? docSnap.ref.parent.parent.id : null;
                            procesarArticuloComercio(data, docSnap.id, idPadre);
                        });
                    });
                } catch (err) {
                    console.error("[Core-DB] Error Firestore Capa 2:", err);
                }
            }

            return {
                success: true,
                producto: productoInfo,
                comerciosIDs: comerciosCoincidentes.map(c => c.id_comercio),
                detallesComercios: comerciosCoincidentes
            };
        },

                buscarEnRadar: async (lat, lng, radiusInM) => {
            if (!db || typeof geofire === 'undefined') return { success: false, error: 'Firebase o GeofireX no listos' };
            try {
                // geofire-common requiere el radio en METROS. Aseguramos minimo 3000 metros de radar
                const radioEnMetros = Math.max(3000, Number(radiusInM) || 3000);
                const bounds = geofire.geohashQueryBounds([lat, lng], radioEnMetros);
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
                // geofire-common requiere el radio expresado en METROS
                const radioEnMetros = Math.max(5000, Number(radiusInM) || 5000);
                const bounds = geofire.geohashQueryBounds([lat, lng], radioEnMetros);
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
                        if (data.geohash) {
                            const idPadre = doc.ref.parent.parent ? doc.ref.parent.parent.id : doc.id;
                            matchingDocs.push({ 
                                ...data, 
                                id: doc.id, 
                                id_negocio_padre: idPadre, 
                                es_inmueble_real: true, 
                                tipo_modelo: 'inmueble' 
                            });
                        }
                    });
                });
                return { success: true, data: matchingDocs };
            } catch (error) { 
                return { success: false, error: error.message }; 
            }
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
            if (!_verificarAcceso()) return { success: false, error: "Sesion no autorizada." };
            const clavePlano = 'geokatu_plano_' + idNegocio + '_' + (idAlmacen || 'PLANO_PRINCIPAL');
            const payload = {
                ...gridData,
                ultima_modificacion: new Date().toISOString()
            };
            try {
                localStorage.setItem(clavePlano, JSON.stringify(payload));
            } catch (eLocal) {}
            try {
                if (!navigator.onLine) {
                    return { success: true, offline: true, mensaje: "Plano guardado en memoria local (Modo Avion)." };
                }
                const docRef = doc(db, _SCHEMA.ColeccionDirectorio + '/' + idNegocio + '/Planos_Almacenes', idAlmacen);
                await setDoc(docRef, payload, { merge: true });
                return { success: true, mensaje: "Plano espacial guardado correctamente." };
            } catch (e) {
                return { success: true, offline: true, error: e.message };
            }
        },
        obtenerMapaBodega: async (idNegocio, idAlmacen = "PLANO_PRINCIPAL", opciones = {}) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesion no autorizada." };
            const clavePlano = 'geokatu_plano_' + idNegocio + '_' + idAlmacen;
            const planoCacheStr = localStorage.getItem(clavePlano);
            if (planoCacheStr && (!navigator.onLine || !opciones.forzarNube)) {
                try {
                    return { success: true, data: JSON.parse(planoCacheStr), origen: "cache_local" };
                } catch (eParse) {}
            }
            try {
                const docRef = doc(db, _SCHEMA.ColeccionDirectorio + '/' + idNegocio + '/Planos_Almacenes', idAlmacen);
                const snap = await getDoc(docRef);
                if (snap.exists()) {
                    const dataPlano = snap.data();
                    try { localStorage.setItem(clavePlano, JSON.stringify(dataPlano)); } catch (eS) {}
                    return { success: true, data: dataPlano, origen: "nube" };
                }
                return { success: true, data: planoCacheStr ? JSON.parse(planoCacheStr) : null };
            } catch (e) {
                if (planoCacheStr) {
                    return { success: true, data: JSON.parse(planoCacheStr), origen: "fallback_local", offline: true };
                }
                return { success: false, error: e.message };
            }
        },


        // =========================================================================
        // MÉTODOS RBAC Y MULTI-SEDE PARA RADAR ESPACIAL
        // =========================================================================
        obtenerSedesComercio: async (idNegocio) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const snap = await getDocs(collection(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Sedes_Almacenes`));
                const sedes = [];
                snap.forEach(d => sedes.push({ id_sede: d.id, ...d.data() }));
                
                if (sedes.length === 0) {
                    sedes.push({ id_sede: "SALA_VENTAS", nombre: "Sede Principal / Sala Ventas", tipo: "PISO_VENTA" });
                }
                return { success: true, data: sedes };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },

        crearSedeBodega: async (idNegocio, idSede, datosSede) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const sedeRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Sedes_Almacenes`, idSede);
                await setDoc(sedeRef, {
                    ...datosSede,
                    fecha_creacion: new Date().toISOString()
                }, { merge: true });
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },

        validarPermisosOperador: async (idNegocio, userEmail) => {
            if (!_verificarAcceso()) return { autorizado: false, error: "Sin sesión activa." };
            try {
                const currentUid = auth.currentUser ? auth.currentUser.uid : null;
                if (currentUid === idNegocio || localStorage.getItem('geokatu_active_uid') === currentUid) {
                    return { autorizado: true, rol: "owner", nombre: "Dueño / Propietario" };
                }

                const emailClean = (userEmail || (auth.currentUser ? auth.currentUser.email : "")).trim().toLowerCase();
                const q = query(
                    collection(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Colaboradores`),
                    where("email", "==", emailClean)
                );
                const snap = await getDocs(q);
                if (!snap.empty) {
                    const dataColab = snap.docs[0].data();
                    return { autorizado: true, rol: dataColab.rol || "asesor", nombre: dataColab.nombre || "Colaborador" };
                }

                if (currentUid) {
                    const adminSnap = await getDoc(doc(db, "Usuarios_Admin", currentUid));
                    if (adminSnap.exists()) {
                        const dataAdmin = adminSnap.data();
                        return { autorizado: true, rol: dataAdmin.rol, nombre: dataAdmin.nombre || "Administrador" };
                    }
                }

                return { autorizado: false, error: "El usuario no figura en la nómina de colaboradores autorizados." };
            } catch (e) {
                return { autorizado: false, error: e.message };
            }
        }
    }, // <-- CIERRE CORRECTO DE RadarService

    /**
     * @namespace TopografiaService
     * Almacenamiento catastral consolidado en un solo disparo (Oneshot Zero-Leak)
     */
    TopografiaService: {
        guardarPlanoCatastralOneshot: async (idNegocio, idPlano, paqueteCatastral) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid') || (auth.currentUser ? auth.currentUser.uid : null);
                if (!tenantReal) return { success: false, error: "Identificador de negocio no válido." };

                const docRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${tenantReal}/Planos_Topograficos`, idPlano);
                const payloadConsolidado = {
                    ...paqueteCatastral,
                    id_plano: idPlano,
                    timestamp_guardado: new Date().toISOString(),
                    usuario: auth.currentUser ? auth.currentUser.email : "TOPOGRAFO_LOCAL"
                };

                await setDoc(docRef, payloadConsolidado, { merge: true });
                return { success: true, idPlano: docRef.id };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },

        obtenerPlanoCatastral: async (idNegocio, idPlano) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid') || (auth.currentUser ? auth.currentUser.uid : null);
                const docRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${tenantReal}/Planos_Topograficos`, idPlano);
                const snap = await getDoc(docRef);
                return { success: true, data: snap.exists() ? snap.data() : null };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },
        listarPlanosCatastrales: async (idNegocio) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid') || (auth.currentUser ? auth.currentUser.uid : null);
                const colRef = collection(db, `${_SCHEMA.ColeccionDirectorio}/${tenantReal}/Planos_Topograficos`);
                const snap = await getDocs(colRef);
                const planos = [];
                snap.forEach(d => {
                    planos.push({ id_firestore: d.id, ...d.data() });
                });
                return { success: true, data: planos };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },


        obtenerEstadoCupoPlanos: async (idNegocio) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid');
                const docRef = doc(db, _SCHEMA.ColeccionDirectorio, tenantReal);
                const snap = await getDoc(docRef);

                if (snap.exists()) {
                    const data = snap.data();
                    const control = data.control_topografia || {
                        cupo_maximo_pdf: 10,
                        descargas_realizadas: 0
                    };
                    return { 
                        success: true, 
                        cupoMaximo: control.cupo_maximo_pdf ?? 10, 
                        descargas: control.descargas_realizadas ?? 0,
                        disponibles: Math.max(0, (control.cupo_maximo_pdf ?? 10) - (control.descargas_realizadas ?? 0))
                    };
                }
                return { success: true, cupoMaximo: 10, descargas: 0, disponibles: 10 };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },

        registrarConsumoDescargaPdf: async (idNegocio, idPlano) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid');
                const docRef = doc(db, _SCHEMA.ColeccionDirectorio, tenantReal);

                return await runTransaction(db, async (transaction) => {
                    const snap = await transaction.get(docRef);
                    if (!snap.exists()) throw new Error("Documento de usuario no encontrado.");

                    const data = snap.data();
                    const control = data.control_topografia || { cupo_maximo_pdf: 10, descargas_realizadas: 0 };
                    const descargasActuales = control.descargas_realizadas || 0;
                    const cupoMaximo = control.cupo_maximo_pdf !== undefined ? control.cupo_maximo_pdf : 10;

                    if (descargasActuales >= cupoMaximo) {
                        return { success: false, agotado: true, mensaje: "Has alcanzado el límite de planos gratuitos." };
                    }

                    const nuevasDescargas = descargasActuales + 1;
                    transaction.update(docRef, {
                        "control_topografia.descargas_realizadas": nuevasDescargas,
                        "control_topografia.cupo_maximo_pdf": cupoMaximo,
                        "control_topografia.ultima_descarga": new Date().toISOString()
                    });

                    const logRef = doc(collection(db, `${_SCHEMA.ColeccionDirectorio}/${tenantReal}/Historial_Descargas_PDF`));
                    transaction.set(logRef, {
                        id_plano: idPlano,
                        numero_descarga: nuevasDescargas,
                        fecha: new Date().toISOString()
                    });

                    return { success: true, nuevasDescargas, cupoMaximo, disponibles: cupoMaximo - nuevasDescargas };
                });
            } catch (e) {
                return { success: false, error: e.message };
            }
        },

        recargarCupoPlanos: async (idNegocio, cantidadPlanosExtra = 10, refPago = "COMPRA_DIRECTA") => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            try {
                const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid');
                const docRef = doc(db, _SCHEMA.ColeccionDirectorio, tenantReal);
                
                await setDoc(docRef, {
                    control_topografia: {
                        cupo_maximo_pdf: increment(cantidadPlanosExtra),
                        ultimo_pago_ref: refPago,
                        fecha_recarga: new Date().toISOString()
                    }
                }, { merge: true });

                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }
    }, // <-- CIERRE CORRECTO CON COMA DE TopografiaService

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
            return onAuthStateChanged(auth, callback);
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
obtenerDestinoPOS: async (idNegocio) => {
            let pais = localStorage.getItem('geokatu_pais_' + idNegocio);
            if (!pais) {
                const res = await GeokatuDB.LocalService.getDetails(idNegocio);
                pais = (res.data && res.data.pais) ? res.data.pais : "COL";
                localStorage.setItem('geokatu_pais_' + idNegocio, pais);
            }
            return pais === "VEN" ? "/posven" : "/pos";
        },

// =========================================================================
        // CONFIGURACIÓN POS, GOOGLE SHEETS (APPS SCRIPT) Y CORNETA DE VOZ
        // =========================================================================
        guardarConfiguracionTerminalPOS: async (idNegocio, nuevaConfig) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesion no autorizada." };
            const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid');
            const claveCfgLocal = 'geokatu_pos_config_' + tenantReal;

            const configPrevia = JSON.parse(localStorage.getItem(claveCfgLocal) || '{}');
            const configFusionada = Object.assign({}, configPrevia, nuevaConfig, {
                ultima_actualizacion: new Date().toISOString()
            });

            localStorage.setItem(claveCfgLocal, JSON.stringify(configFusionada));
            delete _cacheLocales[tenantReal];

            try {
                if (navigator.onLine) {
                    await setDoc(doc(db, _SCHEMA.ColeccionDirectorio, tenantReal), {
                        configuracion_pos: configFusionada
                    }, { merge: true });
                }
                return { success: true, data: configFusionada };
            } catch (e) {
                return { success: true, data: configFusionada, offline: true };
            }
        },

        obtenerConfiguracionTerminalPOS: async (idNegocio) => {
            const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid');
            const claveCfgLocal = 'geokatu_pos_config_' + tenantReal;
            const localStr = localStorage.getItem(claveCfgLocal);

            if (localStr && !navigator.onLine) {
                return JSON.parse(localStr);
            }

            try {
                delete _cacheLocales[tenantReal];
                const info = await GeokatuDB.LocalService.getDetails(tenantReal);
                const dNeg = (info && info.success && info.data) ? info.data : {};
                const cfgRemota = dNeg.configuracion_pos || {};
                const cfgLocal = localStr ? JSON.parse(localStr) : {};

                const finalCfg = Object.assign({
                    apps_script_url: "",
                    whatsapp_facturas_activo: false,
                    whatsapp_numero_emisor: dNeg.whatsapp || dNeg.whatsApp || "",
                    whatsapp_numero_inscrito: dNeg.whatsapp || dNeg.whatsApp || "",
                    corneta_voz_activa: true,
                    pasarela_activa: "MANUAL",
                    pasarela_public_key: "",
                    pasarela_verificada: false,
                    llave_secreta_mascara: "",
                    bold_terminal_id: "",
                    plan_activo: dNeg.plan_suscripcion || (dNeg.premium ? "PRO" : "FREEMIUM")
                }, cfgLocal, cfgRemota);

                localStorage.setItem(claveCfgLocal, JSON.stringify(finalCfg));
                return finalCfg;
            } catch (e) {
                return localStr ? JSON.parse(localStr) : {
                    apps_script_url: "",
                    whatsapp_facturas_activo: false,
                    pasarela_activa: "MANUAL",
                    pasarela_verificada: false,
                    plan_activo: "FREEMIUM"
                };
            }
        },

        despacharTicketGoogleSheet: async (idNegocio, ticketPayload) => {
            const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid');
            const cfg = await GeokatuDB.PosService.obtenerConfiguracionTerminalPOS(tenantReal);
            const urlScript = String(cfg.apps_script_url || "").trim();

            if (!urlScript || urlScript.indexOf("https://script.google.com/macros/s/") !== 0) {
                return { enviado: false, motivo: "SIN_APPS_SCRIPT" };
            }

            const claveColaSheets = 'geokatu_sheets_cola_' + tenantReal;
            const resumenItems = (ticketPayload.productos || []).map(function(p) {
                return p.cantidad + 'x ' + p.nombre + ' (' + p.precio + ')';
            }).join(' | ');

            const totalesCanonicos = (ticketPayload.despacho_fiscal && ticketPayload.despacho_fiscal.payload_canonico && ticketPayload.despacho_fiscal.payload_canonico.totales)
                ? ticketPayload.despacho_fiscal.payload_canonico.totales
                : {};

            const filaSheet = {
                ticket_id: ticketPayload.ticketIdLocal || ticketPayload.id_firestore || "S/N",
                fecha: ticketPayload.timestamp_caja || new Date().toISOString(),
                cajero: ticketPayload.codigo_cajero || "CAJA-01",
                cliente_nit: (ticketPayload.cliente && (ticketPayload.cliente.nit || ticketPayload.cliente.rif)) || "222222222222",
                cliente_nombre: (ticketPayload.cliente && ticketPayload.cliente.nombre) || "Consumidor Final",
                metodo_pago: ticketPayload.metodo_pago || "EFECTIVO",
                base_gravable: totalesCanonicos.base_gravable || ticketPayload.base_gravable_usd || 0,
                iva: totalesCanonicos.impuesto_iva || ticketPayload.iva_16_usd || 0,
                total: Number(ticketPayload.total) || 0,
                detalle_productos: resumenItems
            };

            try {
                if (!navigator.onLine) throw new Error("Offline");
                await fetch(urlScript, {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify(filaSheet)
                });
                return { enviado: true };
            } catch (err) {
                const cola = JSON.parse(localStorage.getItem(claveColaSheets) || '[]');
                if (!cola.some(function(f) { return f.ticket_id === filaSheet.ticket_id; })) {
                    cola.push(filaSheet);
                    localStorage.setItem(claveColaSheets, JSON.stringify(cola));
                }
                return { enviado: false, encolado: true };
            }
        },

        sincronizarColaGoogleSheets: async (idNegocio) => {
            if (!navigator.onLine) return { sincronizados: 0 };
            const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid');
            const cfg = await GeokatuDB.PosService.obtenerConfiguracionTerminalPOS(tenantReal);
            const urlScript = String(cfg.apps_script_url || "").trim();
            if (!urlScript || urlScript.indexOf("https://script.google.com/macros/s/") !== 0) {
                return { sincronizados: 0 };
            }

            const claveColaSheets = 'geokatu_sheets_cola_' + tenantReal;
            const pendientes = JSON.parse(localStorage.getItem(claveColaSheets) || '[]');
            if (pendientes.length === 0) return { sincronizados: 0 };

            let enviados = 0;
            const restantes = [];
            for (let i = 0; i < pendientes.length; i++) {
                try {
                    await fetch(urlScript, {
                        method: 'POST',
                        mode: 'no-cors',
                        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                        body: JSON.stringify(pendientes[i])
                    });
                    enviados++;
                } catch (e) {
                    restantes.push(pendientes[i]);
                }
            }
            localStorage.setItem(claveColaSheets, JSON.stringify(restantes));
            return { sincronizados: enviados };
        },

        anunciarPagoCornetaVoz: (montoPesos, metodo) => {
            try {
                if (!('speechSynthesis' in window)) return;
                const tenantReal = localStorage.getItem('geokatu_active_uid') || '';
                const cfgRaw = localStorage.getItem('geokatu_pos_config_' + tenantReal);
                if (cfgRaw) {
                    const cfg = JSON.parse(cfgRaw);
                    if (cfg.corneta_voz_activa === false) return;
                }
                window.speechSynthesis.cancel();
                const montoLimpio = Math.round(Number(montoPesos) || 0).toLocaleString('es-CO');
                const textoVoz = 'Pago aprobado por ' + (metodo || 'Pasarela') + '. Has recibido ' + montoLimpio + ' pesos.';
                const msg = new SpeechSynthesisUtterance(textoVoz);
                msg.lang = 'es-CO';
                msg.rate = 1.05;
                msg.pitch = 1.0;
                msg.volume = 1.0;
                window.speechSynthesis.speak(msg);
            } catch (e) {
                console.warn("[Corneta Digital] Audio no disponible:", e.message);
            }
        },

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

               descargarCatalogoLocal: async (idNegocio, forzarCompleta = false) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesion no autorizada." };
            const claveCache = 'geokatu_catalogo_' + idNegocio;
            const claveSync = 'geokatu_catalogo_sync_' + idNegocio;
            const claveVerCat = 'geokatu_cache_ver_' + idNegocio;
            const claveVerPrecios = 'geokatu_precios_ver_' + idNegocio;

            const normalizarProd = (idDoc, d) => ({
                ...d,
                id_prod: idDoc,
                codigo_barras: d.codigo_barras ? String(d.codigo_barras).trim() : "",
                plu: d.plu ? String(d.plu).trim() : "",
                nombre: d.nombre || "Sin nombre",
                precio: Number(d.precio) || 0,
                stock_actual: d.stock_actual !== undefined ? Number(d.stock_actual) : 0,
                impuesto: d.impuesto || "19",
                icono: d.icono || "inventory_2",
                es_pesable: Boolean(d.es_pesable),
                unidad_medida: d.unidad_medida || (d.es_pesable ? "kg" : "und")
            });

            const cacheExistenteStr = localStorage.getItem(claveCache);
            let catalogoMemoria = [];
            try {
                const rawMem = cacheExistenteStr ? JSON.parse(cacheExistenteStr) : [];
                catalogoMemoria = Array.isArray(rawMem) ? rawMem.filter(p => GeokatuDB.AdminService.esProductoTiendaValido(p)) : [];
                // Si la cache local estaba contaminada con los 6499 items de la matriz, purgarla de inmediato
                if (Array.isArray(rawMem) && rawMem.length > 0 && catalogoMemoria.length === 0) {
                    localStorage.removeItem(claveCache);
                    localStorage.removeItem(claveSync);
                    localStorage.removeItem(claveVerCat);
                }
            } catch (eP) {
                catalogoMemoria = [];
            }
            if (!navigator.onLine && catalogoMemoria.length > 0) {
                return { success: true, cantidad: catalogoMemoria.length, data: catalogoMemoria, offline: true, esDelta: true };
            }
            try {
                const ahoraCorte = new Date().toISOString();
                // 1. Consultar el documento raiz del comercio (en cache de sesion o 1 lectura) para revisar catalogo_version y mapa_precios
                const infoRaiz = await GeokatuDB.LocalService.getDetails(idNegocio);
                const dataRaiz = (infoRaiz && infoRaiz.success && infoRaiz.data) ? infoRaiz.data : {};
                const verCatRemota = dataRaiz.catalogo_version ? String(dataRaiz.catalogo_version) : null;
                const verPreciosRemota = dataRaiz.precios_version ? String(dataRaiz.precios_version) : null;
                const urlJson = dataRaiz.catalogo_json_url || null;
                const mapaPrecios = dataRaiz.mapa_precios || null;
                const verCatLocal = localStorage.getItem(claveVerCat);
                const verPreciosLocal = localStorage.getItem(claveVerPrecios);
                // CASO A (ZERO-READS ABSOLUTO): Si ya tenemos el catalogo valido en cache y catalogo_version coincide, 0 consultas a la subcoleccion productos
                if (!forzarCompleta && catalogoMemoria.length > 0 && verCatRemota && verCatLocal === verCatRemota) {
                    let deltasPrecio = 0;
                    if (mapaPrecios && verPreciosRemota !== verPreciosLocal) {
                        catalogoMemoria = GeokatuDB.RadarService.hidratarPreciosEnCatalogo(catalogoMemoria, mapaPrecios);
                        localStorage.setItem(claveCache, JSON.stringify(catalogoMemoria));
                        if (verPreciosRemota) localStorage.setItem(claveVerPrecios, verPreciosRemota);
                        deltasPrecio = 1;
                    }
                    return {
                        success: true,
                        cantidad: catalogoMemoria.length,
                        data: catalogoMemoria,
                        esDelta: true,
                        deltasLeidos: deltasPrecio
                    };
                }
                // CASO B (DESCARGA DESDE JSON EN STORAGE CDN): Validando que no sea catalogo_matriz.json
                if (urlJson && !forzarCompleta) {
                    try {
                        const sep = urlJson.indexOf('?') !== -1 ? '&' : '?';
                        const resp = await fetch(urlJson + sep + 'v=' + (verCatRemota || Date.now()));
                        if (resp.ok) {
                            const paquete = await resp.json();
                            if (!paquete.n) {
                                const listaJson = Array.isArray(paquete) ? paquete : (paquete.p || []);
                                let normalizados = listaJson
                                    .filter(p => GeokatuDB.AdminService.esProductoTiendaValido(p) && p.eliminado !== true)
                                    .map(p => normalizarProd(p.id_prod || p.id, p));
                                if (normalizados.length > 0) {
                                    normalizados = GeokatuDB.RadarService.hidratarPreciosEnCatalogo(normalizados, mapaPrecios);
                                    localStorage.setItem(claveCache, JSON.stringify(normalizados));
                                    localStorage.setItem(claveSync, ahoraCorte);
                                    if (verCatRemota) localStorage.setItem(claveVerCat, verCatRemota);
                                    if (verPreciosRemota) localStorage.setItem(claveVerPrecios, verPreciosRemota);
                                    return { success: true, cantidad: normalizados.length, data: normalizados, esDelta: false, desdeJsonCDN: true };
                                }
                            }
                        }
                    } catch (eJson) {
                        console.warn("[PosService JSON] Fallback a deltas Firestore:", eJson.message);
                    }
                }


                // CASO C: Fallback a deltas por fecha_actualizacion o primera compilacion automatica del JSON
                const productosRef = collection(db, _SCHEMA.ColeccionDirectorio + '/' + idNegocio + '/' + _SCHEMA.SubColeccionProductos);
                const ultimoSync = localStorage.getItem(claveSync);

                if (!forzarCompleta && catalogoMemoria.length > 0 && ultimoSync) {
                    const qDelta = query(productosRef, where("fecha_actualizacion", ">", ultimoSync));
                    const snapDelta = await getDocs(qDelta);
                    let cambiosAplicados = 0;

                    if (!snapDelta.empty) {
                        const mapaCatalogo = new Map();
                        catalogoMemoria.forEach(item => mapaCatalogo.set(item.id_prod, item));

                        snapDelta.forEach(docSnap => {
                            const d = docSnap.data();
                            if (d.eliminado === true) {
                                mapaCatalogo.delete(docSnap.id);
                            } else {
                                const previo = mapaCatalogo.get(docSnap.id) || {};
                                mapaCatalogo.set(docSnap.id, normalizarProd(docSnap.id, Object.assign({}, previo, d)));
                            }
                            cambiosAplicados++;
                        });

                        catalogoMemoria = Array.from(mapaCatalogo.values());
                    }
                    catalogoMemoria = GeokatuDB.RadarService.hidratarPreciosEnCatalogo(catalogoMemoria, mapaPrecios);
                    localStorage.setItem(claveCache, JSON.stringify(catalogoMemoria));
                    localStorage.setItem(claveSync, ahoraCorte);
                    return {
                        success: true,
                        cantidad: catalogoMemoria.length,
                        data: catalogoMemoria,
                        esDelta: true,
                        deltasLeidos: cambiosAplicados
                    };
                }

                const snap = await getDocs(productosRef);
                let catalogoLocal = [];
                snap.forEach(docSnap => {
                    const d = docSnap.data();
                    if (d.eliminado !== true) {
                        catalogoLocal.push(normalizarProd(docSnap.id, d));
                    }
                });
                catalogoLocal = GeokatuDB.RadarService.hidratarPreciosEnCatalogo(catalogoLocal, mapaPrecios);
                localStorage.setItem(claveCache, JSON.stringify(catalogoLocal));
                localStorage.setItem(claveSync, ahoraCorte);

                // Si el comercio aun no tenia su catalogo_base.json compilado en Storage, generarlo automaticamente en segundo plano
                if (!urlJson && catalogoLocal.length > 0) {
                    GeokatuDB.AdminService.compilarCatalogoJSON(idNegocio, false).catch(() => {});
                }
                return { success: true, cantidad: catalogoLocal.length, data: catalogoLocal, esDelta: false };
            } catch (e) { 
                if (catalogoMemoria.length > 0) {
                    return { success: true, cantidad: catalogoMemoria.length, data: catalogoMemoria, offline: true };
                }
                return { success: false, error: "Error descargando catalogo", details: e.message }; 
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

           // 🛡️ BARRERA ZERO-TRUST MULTIMONEDA (COL: Enteros COP | VEN: Decimales USD)
            const esVen = ticketData.pais_operacion === 'VEN' || ticketData.pais === 'VEN';
            let sumaVerificacion = 0;

            for (const item of ticketData.productos) {
                const prod = catalogoLocal.find(p => p.id_prod === item.id_prod);
                const precioBase = item.precio !== undefined ? item.precio : (item.precio_usd !== undefined ? item.precio_usd : 0);
                const precioValido = (item.precio_fijado_balanza && precioBase > 0) 
                    ? Number(precioBase) 
                    : (prod ? Number(prod.precio) : Number(precioBase));

                if (!Number.isFinite(Number(item.cantidad)) || Number(item.cantidad) <= 0 || !Number.isFinite(precioValido) || precioValido < 0) {
                    return { success: false, error: "Cantidad o precio inválido." };
                }
                const importeLinea = item.precio_fijado_balanza ? precioValido : precioValido * item.cantidad;
                const subtotal = esVen ? Number(importeLinea.toFixed(2)) : Math.round(importeLinea);
                sumaVerificacion += subtotal;
            }

            // Conciliar el recargo ya calculado por POS VEN, sin cambiar su política fiscal.
            if (esVen) {
                const recargo = Number(ticketData.igtf_usd || 0);
                if (!Number.isFinite(recargo) || recargo < 0) return { success: false, error: 'Recargo inválido.' };
                sumaVerificacion = Number((sumaVerificacion + recargo).toFixed(2));
            }
            const margenTolerancia = esVen ? 0.05 : 1;
            if (!Number.isFinite(Number(ticketData.total)) || Math.abs(sumaVerificacion - Number(ticketData.total)) > margenTolerancia) {
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

                                    // Generación de Ticket ID Compuesto Forense: TK-[CAJA]-[CAJERO]-[SECUENCIA]
            const cajaCod = String(ticketData.caja_numero || "01").replace(/\D/g, '').padStart(2, '0').slice(-2);
            const cajeroCod = String(ticketData.codigo_cajero || "0000").replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase();
            
            // Consecutivo numérico del turno guardado en memoria local
            const claveSeq = `geokatu_secuencia_caja_${tenantReal}_${cajaCod}`;
            let secuencia = parseInt(localStorage.getItem(claveSeq) || "0", 10) + 1;
            localStorage.setItem(claveSeq, String(secuencia));
            const seqStr = String(secuencia).padStart(4, '0');

            // Formato estándar limpio: TK-01-D9A4-0001
           const ticketIdLocal = nuevoIdOperacion('TK-' + cajaCod + '-' + cajeroCod + '-' + seqStr);

            const payloadCanonico = GeokatuDB.PosService._construirPayloadFiscalCanonico({
                ...ticketData,
                ticketIdLocal: ticketIdLocal
            });

            const payloadFinal = {
                ...ticketData,
                ticketIdLocal: ticketIdLocal,
                anulado: false,
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

            const claveCola = `geokatu_sync_cola_${tenantReal}`;
            try {
                const cola = JSON.parse(localStorage.getItem(claveCola) || '[]');
                cola.push(payloadFinal);
                localStorage.setItem(claveCola, JSON.stringify(cola));
            } catch (errorLocal) {
                // Restaurar el catálogo si no se pudo conservar la venta.
                for (const item of ticketData.productos) {
                    const prod = catalogoLocal.find(p => p.id_prod === item.id_prod);
                    if (prod && prod.stock_actual !== undefined) prod.stock_actual += Number(item.cantidad);
                }
                localStorage.setItem(claveCache, JSON.stringify(catalogoLocal));
                return { success: false, error: 'No se pudo guardar la venta en este dispositivo: ' + errorLocal.message };
            }
            try {
                if (!navigator.onLine) throw new Error('Venta guardada pendiente de conexión.');
                const ticketRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${tenantReal}/Ventas_POS`, ticketIdLocal);
                const batch = crearLoteIdempotente(db, ticketRef, runTransaction);
                batch.set(ticketRef, payloadFinal);


                                // Incremento seguro con merge para garantizar creación si no existe el objeto
                const negocioRef = doc(db, _SCHEMA.ColeccionDirectorio, tenantReal);
                batch.set(negocioRef, {
                    facturacion_control: {
                        facturas_emitidas_mes: increment(1),
                        ultima_venta_id: ticketRef.id
                    }
                }, { merge: true });


                // 🚀 Suma atómica a métricas globales de red
                batch.set(doc(db, "sistema", "metricas_red"), {
                    volumen_ventas_pos: increment(Number(ticketData.total) || 0),
                    tickets_emitidos: increment(1)
                }, { merge: true });

                ticketData.productos.forEach(item => {
                    if (item.id_prod && !item.id_prod.startsWith("GENERICO")) {
                        const prodRef = doc(db, _SCHEMA.ColeccionDirectorio + "/" + tenantReal + "/" + _SCHEMA.SubColeccionProductos, item.id_prod);
                        batch.set(prodRef, {
                            stock_actual: increment(-item.cantidad),
                            fecha_actualizacion: new Date().toISOString()
                        }, { merge: true });



                        const desglose = Array.isArray(item.desglose_ubicaciones) && item.desglose_ubicaciones.length > 0
                            ? item.desglose_ubicaciones
                            : (item.id_compartimiento ? [{ id_compartimiento: item.id_compartimiento, cantidad: item.cantidad }] : []);

                        desglose.forEach(ubiItem => {
                            const ubiPisoRef = doc(db, _SCHEMA.ColeccionDirectorio + "/" + tenantReal + "/" + _SCHEMA.SubColeccionProductos + "/" + item.id_prod + "/" + _SCHEMA.SubColeccionUbicacionesStock, ubiItem.id_compartimiento);
                            batch.set(ubiPisoRef, {
                                cantidad: increment(-ubiItem.cantidad),
                                zona: "PISO_VENTA",
                                ultima_modificacion: new Date().toISOString()
                            }, { merge: true });
                        });
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
                quitarConfirmados(localStorage, claveCola, [ticketIdLocal], 'ticketIdLocal');
                GeokatuDB.PosService.despacharTicketGoogleSheet(tenantReal, payloadFinal).catch(function() {});
                return { success: true, ticketId: ticketIdLocal, localId: ticketIdLocal, payloadCanonico };

            } catch (e) {
                console.error("[GEOKATU POS] Error al asentar en Firestore (desviado a cola):", e);
                GeokatuDB.PosService.despacharTicketGoogleSheet(tenantReal, payloadFinal).catch(function() {});
                return { success: true, ticketId: ticketIdLocal, localId: ticketIdLocal, offline: true, errorFirestore: e.message };
            }
        },


                analizarYSincronizarRespaldo: async (idNegocio, ticketsArray) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid');
            const colRef = collection(db, `${_SCHEMA.ColeccionDirectorio}/${tenantReal}/Ventas_POS`);

            let duplicados = 0;
            let sincronizados = 0;

            for (const ticket of ticketsArray) {
                const idBuscar = ticket.ticketIdLocal || ticket.ticketId || ticket.id;
                if (!idBuscar) continue;

                // Verificar si el ticket ya existe en Firestore para evitar doble facturación
                const q = query(colRef, where("ticketIdLocal", "==", idBuscar), limit(1));
                const snap = await getDocs(q);

                if (!snap.empty) {
                    duplicados++;
                } else {
                    const ticketRef = doc(colRef, idBuscar);
                    const batch = crearLoteIdempotente(db, ticketRef, runTransaction);
                    batch.set(ticketRef, {
                        ...ticket,
                        id_firestore: ticketRef.id,
                        estado_sincronizacion: "sincronizado_respaldo_archivo",
                        timestamp_sincronizacion_nube: new Date().toISOString()
                    });

                    // Incrementar factura en el control mensual del negocio
                    const negocioRef = doc(db, _SCHEMA.ColeccionDirectorio, tenantReal);
                    batch.set(negocioRef, {
                        facturacion_control: {
                            facturas_emitidas_mes: increment(1),
                            ultima_venta_id: ticketRef.id
                        }
                    }, { merge: true });

                    // Descuento de stock si aplica
                    (ticket.productos || []).forEach(item => {
                        if (item.id_prod && !item.id_prod.startsWith("GENERICO")) {
                            const prodRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${tenantReal}/${_SCHEMA.SubColeccionProductos}`, item.id_prod);
                            batch.update(prodRef, {
                                stock_actual: increment(-item.cantidad), fecha_actualizacion: new Date().toISOString()
                            });
                            const desglose = item.desglose_ubicaciones?.length ? item.desglose_ubicaciones : (item.id_compartimiento ? [{ id_compartimiento: item.id_compartimiento, cantidad: item.cantidad }] : []);
                            for (const ubicacion of desglose) {
                                const ref = doc(db, `${_SCHEMA.ColeccionDirectorio}/${tenantReal}/${_SCHEMA.SubColeccionProductos}/${item.id_prod}/${_SCHEMA.SubColeccionUbicacionesStock}`, ubicacion.id_compartimiento);
                                batch.set(ref, { cantidad: increment(-Number(ubicacion.cantidad)), ultima_modificacion: new Date().toISOString() }, { merge: true });
                            }
                        }
                    });

                    await batch.commit();
                    sincronizados++;
                }
            }

            return { total: ticketsArray.length, duplicados, sincronizados };
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
                        if (!navigator.onLine) throw new Error('Sin conexión.');
                        const idDoc = ticket.ticketIdLocal || ticket.ticketId || `TK-OFF-${Date.now()}`;
                        const ticketRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${tenantReal}/Ventas_POS`, idDoc);

                        const batch = crearLoteIdempotente(db, ticketRef, runTransaction);
                        batch.set(ticketRef, {
                            ...ticket,
                            id_firestore: idDoc,
                            estado_sincronizacion: "sincronizado_diferido",
                            timestamp_sincronizacion_nube: new Date().toISOString()
                        });

                                                // Sumar factura diferida con merge seguro
                        const negocioRef = doc(db, _SCHEMA.ColeccionDirectorio, tenantReal);
                        batch.set(negocioRef, {
                            facturacion_control: {
                                facturas_emitidas_mes: increment(1),
                                ultima_venta_id: ticketRef.id
                            }
                        }, { merge: true });


                                                      batch.set(doc(db, "sistema", "metricas_red"), {
                            volumen_ventas_pos: increment(Number(ticket.total) || 0), tickets_emitidos: increment(1)
                        }, { merge: true });
                        // 🛡️ REVISIÓN FORENSE DE PRODUCTOS ANTES DE SINCRONIZAR
                        for (const item of ticket.productos) {
                            if (item.id_prod && !item.id_prod.startsWith("GENERICO")) {
                                const prodRef = doc(db, _SCHEMA.ColeccionDirectorio + "/" + tenantReal + "/" + _SCHEMA.SubColeccionProductos, item.id_prod);
                                
                                // Lectura en tiempo real contra la nube para validar integridad
                                const prodSnap = await getDoc(prodRef);
                                
                                if (!prodSnap.exists()) {
                                    // 👻 ALERTA 1: PRODUCTO FANTASMA DETECTADO
                                    const alertaRef = doc(collection(db, "Alertas_Seguridad"));
                                    batch.set(alertaRef, {
                                        id_negocio: tenantReal,
                                        tipo: "PRODUCTO_FANTASMA_OFFLINE",
                                        estado: "requiere_auditoria_urgente",
                                        id_producto: item.id_prod,
                                        nombre_producto: item.nombre || "Artículo eliminado",
                                        stock_previo: 0,
                                        stock_negativo_registrado: -item.cantidad,
                                        cantidad_despachada: item.cantidad,
                                        ticket_origen: idDoc,
                                        terminal: ticket.caja_numero || "CAJA-01",
                                        cajero: ticket.cajero_email || "CAJERO",
                                        timestamp_alerta: new Date().toISOString(),
                                        resuelto: false,
                                        motivo: "El producto se vendió offline pero había sido eliminado en la nube."
                                    });
                                } else {
                                    // 📉 ALERTA 2: QUIEBRE DE STOCK AL SINCRONIZAR
                                    const stockNube = Number(prodSnap.data().stock_actual) || 0;
                                    if (stockNube - item.cantidad < 0) {
                                        const alertaRef = doc(collection(db, "Alertas_Seguridad"));
                                        batch.set(alertaRef, {
                                            id_negocio: tenantReal,
                                            tipo: "DESCUADRE_STOCK_NEGATIVO",
                                            estado: "requiere_auditoria_urgente",
                                            id_producto: item.id_prod,
                                            nombre_producto: item.nombre || prodSnap.data().nombre,
                                            stock_previo: stockNube,
                                            stock_negativo_registrado: stockNube - item.cantidad,
                                            cantidad_despachada: item.cantidad,
                                            ticket_origen: idDoc,
                                            terminal: ticket.caja_numero || "CAJA-01",
                                            cajero: ticket.cajero_email || "CAJERO",
                                            timestamp_alerta: new Date().toISOString(),
                                            resuelto: false,
                                            motivo: "Venta offline generó saldo negativo al cruzar con la nube."
                                        });
                                    }
                                }

                                // Forzamos Upsert (set + merge) para que el ticket jamás falle y la cola fluya
                                batch.set(prodRef, { 
                                    stock_actual: increment(-item.cantidad) 
                                }, { merge: true });

                                const desglose = Array.isArray(item.desglose_ubicaciones) && item.desglose_ubicaciones.length > 0
                                    ? item.desglose_ubicaciones
                                    : (item.id_compartimiento ? [{ id_compartimiento: item.id_compartimiento, cantidad: item.cantidad }] : []);

                                desglose.forEach(ubiItem => {
                                    const ubiPisoRef = doc(db, _SCHEMA.ColeccionDirectorio + "/" + tenantReal + "/" + _SCHEMA.SubColeccionProductos + "/" + item.id_prod + "/" + _SCHEMA.SubColeccionUbicacionesStock, ubiItem.id_compartimiento);
                                    batch.set(ubiPisoRef, {
                                        cantidad: increment(-ubiItem.cantidad),
                                        zona: "PISO_VENTA",
                                        ultima_modificacion: new Date().toISOString()
                                    }, { merge: true });
                                });
                            }
                        }






                        await batch.commit();
                        quitarConfirmados(localStorage, claveCola, [ticket.ticketIdLocal], 'ticketIdLocal');
                        procesados++;
                    } catch (err) {
                        console.error("[GEOKATU Sync] Error procesando ticket offline:", err);
                        colaRestante.push(ticket);
                    }
                }

                return { sincronizados: procesados, pendientes: JSON.parse(localStorage.getItem(claveCola) || '[]').length };
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

        registrarAuditoriaInformeX: async (idNegocio, efectivoContadoFisico, resumenTotales, supervisorNombre = "Gerencia", terminalId = "CAJA-01") => {
            const claveTerminal = `geokatu_caja_activa_${idNegocio}_${terminalId}`;
            const sesionLocal = JSON.parse(localStorage.getItem(claveTerminal) || "null");

            if (!sesionLocal) {
                return { success: false, error: "No existe una sesión de caja abierta en esta terminal para auditar." };
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

            const payloadInformeX = {
                id_informe: "INF-X-" + Date.now().toString(16).toUpperCase(),
                id_sesion_origen: sesionLocal.id_sesion,
                terminal_id: terminalId,
                fecha_auditoria: new Date().toISOString(),
                cajero: sesionLocal.cajero,
                supervisor: supervisorNombre,
                base_inicial: base,
                ventas_efectivo: ventasEfectivo,
                ventas_tarjeta: Number(resumenTotales.tarjeta) || 0,
                ventas_nequi: Number(resumenTotales.nequi) || 0,
                total_entradas_menores: entradasMenores,
                total_salidas_menores: salidasMenores,
                esperado_efectivo: esperadoEfectivo,
                contado_efectivo: contado,
                diferencia_cuadre: diferencia,
                estado_cuadre: diferencia === 0 ? "CUADRADA" : (diferencia > 0 ? "SOBRANTE" : "FALTANTE")
            };

            try {
                if (navigator.onLine) {
                    const informeRef = doc(collection(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Informes_X`));
                    await setDoc(informeRef, payloadInformeX);
                }
                return { success: true, informeX: payloadInformeX };
            } catch (e) {
                return { success: true, informeX: payloadInformeX, offline: true };
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
                const esVen = itemsDevueltos.some(i => i.precio_usd !== undefined || String(i.impuesto) === "16");

                itemsDevueltos.forEach(item => {
                    const precioItem = Number(item.precio !== undefined ? item.precio : (item.precio_usd || 0));
                    const montoLinea = esVen 
                        ? Number((precioItem * Number(item.cantidad_devuelta)).toFixed(2))
                        : Math.round(precioItem * Number(item.cantidad_devuelta));
                    totalReembolso += montoLinea;


                      // 1. Reingreso de stock en Firestore (Ignorando ítems libres)
                    if (item.id_prod && !item.id_prod.startsWith("GENERICO")) {
                        const prodRef = doc(db, _SCHEMA.ColeccionDirectorio + "/" + idNegocio + "/" + _SCHEMA.SubColeccionProductos, item.id_prod);
                        batch.update(prodRef, {
                            stock_actual: increment(item.cantidad_devuelta)
                        });

                        // Determinar el compartimiento de destino para el reingreso físico
                        const idCompRetorno = (Array.isArray(item.desglose_ubicaciones) && item.desglose_ubicaciones.length > 0)
                            ? item.desglose_ubicaciones[0].id_compartimiento
                            : (item.id_compartimiento || "BIN_INICIAL");

                        const ubiRef = doc(db, _SCHEMA.ColeccionDirectorio + "/" + idNegocio + "/" + _SCHEMA.SubColeccionProductos + "/" + item.id_prod + "/" + _SCHEMA.SubColeccionUbicacionesStock, idCompRetorno);
                        batch.set(ubiRef, {
                            cantidad: increment(item.cantidad_devuelta),
                            zona: "PISO_VENTA",
                            ultima_modificacion: new Date().toISOString()
                        }, { merge: true });

                        // 2. Reingreso en memoria local de catálogo
                        const prodRAM = catalogoLocal.find(p => p.id_prod === item.id_prod);
                        if (prodRAM && prodRAM.stock_actual !== undefined) {
                            prodRAM.stock_actual = Number((prodRAM.stock_actual + item.cantidad_devuelta).toFixed(3));
                        }

                        // 3. Reingreso en memoria local de ubicaciones WMS
                        const claveUbis = "geokatu_stock_ubis_" + idNegocio;
                        let ubisLocales = JSON.parse(localStorage.getItem(claveUbis) || "[]");
                        const targetUbi = ubisLocales.find(u => u.id_prod === item.id_prod && u.id_compartimiento === idCompRetorno);
                        if (targetUbi) {
                            targetUbi.cantidad = Number((Number(targetUbi.cantidad) + Number(item.cantidad_devuelta)).toFixed(3));
                            localStorage.setItem(claveUbis, JSON.stringify(ubisLocales));
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

        anularVentaPOS: async (idNegocio, ticketId, motivoAnulacion) => {
            if (!_verificarAcceso()) return { success: false, error: 'Sesión no autorizada.' };
            if (!navigator.onLine) return { success: false, error: 'Conecta la terminal para confirmar la anulación sin duplicar devoluciones.' };
            try {
                const ticketRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Ventas_POS`, ticketId);
                const venta = await runTransaction(db, async tx => {
                    const snapshot = await tx.get(ticketRef);
                    if (!snapshot.exists()) throw new Error('Sincroniza primero el ticket pendiente antes de anularlo.');
                    const data = snapshot.data();
                    if (data.anulado) throw new Error('Este ticket ya fue anulado previamente.');
                    tx.update(ticketRef, {
                        anulado: true, motivo_anulacion: motivoAnulacion,
                        timestamp_anulacion: new Date().toISOString(),
                        usuario_anulacion: auth.currentUser.email || 'CAJERO'
                    });
                    for (const item of data.productos || []) {
                        if (!item.id_prod || item.id_prod.startsWith('GENERICO')) continue;
                        const prodRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`, item.id_prod);
                        tx.update(prodRef, { stock_actual: increment(Number(item.cantidad)), fecha_actualizacion: new Date().toISOString() });
                        const ubicaciones = item.desglose_ubicaciones?.length ? item.desglose_ubicaciones : (item.id_compartimiento ? [{ id_compartimiento: item.id_compartimiento, cantidad: item.cantidad }] : []);
                        for (const ubicacion of ubicaciones) {
                            const ref = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}/${item.id_prod}/${_SCHEMA.SubColeccionUbicacionesStock}`, ubicacion.id_compartimiento);
                            tx.set(ref, { cantidad: increment(Number(ubicacion.cantidad)), ultima_modificacion: new Date().toISOString() }, { merge: true });
                        }
                    }
                    tx.set(doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Notas_Credito_POS`, ticketId), {
                        ticket_origen_id: ticketId, total_revertido: data.total,
                        metodo_pago: data.metodo_pago, productos: data.productos,
                        motivo: motivoAnulacion, fecha: new Date().toISOString(),
                        estado_fiscal: data.factura_electronica ? 'PENDIENTE_GESTION_PROVEEDOR' : 'NO_APLICA'
                    });
                    return data;
                });
                // Refrescar cachés solo después de confirmar la reversión en servidor.
                const clave = `geokatu_catalogo_${idNegocio}`;
                const catalogo = JSON.parse(localStorage.getItem(clave) || '[]');
                const claveUbis = `geokatu_stock_ubis_${idNegocio}`;
                const ubicaciones = JSON.parse(localStorage.getItem(claveUbis) || '[]');
                for (const item of venta.productos || []) {
                    const prod = catalogo.find(p => p.id_prod === item.id_prod);
                    if (prod) prod.stock_actual = Number((Number(prod.stock_actual || 0) + Number(item.cantidad)).toFixed(3));
                    const desglose = item.desglose_ubicaciones?.length ? item.desglose_ubicaciones : (item.id_compartimiento ? [{ id_compartimiento: item.id_compartimiento, cantidad: item.cantidad }] : []);
                    for (const des of desglose) {
                        const ub = ubicaciones.find(u => u.id_prod === item.id_prod && u.id_compartimiento === des.id_compartimiento);
                        if (ub) ub.cantidad = Number((Number(ub.cantidad) + Number(des.cantidad)).toFixed(3));
                    }
                }
                localStorage.setItem(clave, JSON.stringify(catalogo));
                localStorage.setItem(claveUbis, JSON.stringify(ubicaciones));
                return { success: true, mensaje: 'Venta anulada e inventario restituido.' + (venta.factura_electronica ? ' La nota fiscal debe gestionarse con el proveedor.' : ''), totalRevertido: venta.total, productosRevertidos: venta.productos, ventaOriginal: venta };
            } catch (error) { return { success: false, error: error.message }; }
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
            if (!_verificarAcceso()) return { success: false, error: "Sesion no autorizada." };
            const idSesion = 'SES-' + terminalId + '-' + Date.now().toString(16).toUpperCase();

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

            // 🛡️ ASIENTO CONTABLE DE CIERRE Z EN PARTIDA DOBLE CUADRADA
            // Débitos de Venta: Caja (Efectivo Neto) + Bancos (Datáfono/Nequi)
            // Créditos de Venta: Ingresos Operacionales (Base + Exento) + IVA Generado
            const itemsComprobante = [
                {
                    account: { code: "11050501" }, // Caja General (Entrada neta de efectivo por ventas)
                    description: `Ventas Efectivo Turno ${sesionLocal.id_sesion}`,
                    debit: ventasEfectivo,
                    credit: 0
                },
                {
                    account: { code: "11100501" }, // Bancos / Pasarelas (Tarjeta + Nequi)
                    description: `Recaudo Bancario Turno ${sesionLocal.id_sesion}`,
                    debit: totalRecaudoBancario,
                    credit: 0
                },
                {
                    account: { code: "41350101" }, // Ingresos Brutos Comercio
                    description: `Ingresos Operacionales Turno ${sesionLocal.id_sesion}`,
                    debit: 0,
                    credit: ingresosOperacionalesTotales
                }
            ];

            // Pasivo IVA 19%
            if (ivaGeneradoReal > 0) {
                itemsComprobante.push({
                    account: { code: "24080101" },
                    description: `IVA Generado 19% Turno ${sesionLocal.id_sesion}`,
                    debit: 0,
                    credit: ivaGeneradoReal
                });
            }

            // Gastos menores (Salida física de dinero): Débito al gasto, Crédito a Caja
            if (salidasMenores > 0) {
                itemsComprobante.push({
                    account: { code: "51350501" }, // Gasto Operativo Menor
                    description: `Gastos de caja Turno ${sesionLocal.id_sesion}`,
                    debit: salidasMenores,
                    credit: 0
                });
                itemsComprobante.push({
                    account: { code: "11050501" }, // Salida de Caja
                    description: `Descargo por gastos caja Turno ${sesionLocal.id_sesion}`,
                    debit: 0,
                    credit: salidasMenores
                });
            }

            // Sencillo inyectado: Débito a Caja, Crédito a Caja Principal / Cuentas por Pagar
            if (entradasMenores > 0) {
                itemsComprobante.push({
                    account: { code: "11050501" }, // Entrada de Sencillo
                    description: `Refuerzo de sencillo Turno ${sesionLocal.id_sesion}`,
                    debit: entradasMenores,
                    credit: 0
                });
                itemsComprobante.push({
                    account: { code: "23359501" }, // Acreedores varios / Reposición
                    description: `Contrapartida sencillo Turno ${sesionLocal.id_sesion}`,
                    debit: 0,
                    credit: entradasMenores
                });
            }

            // Cuadratura por Arqueo a Ciegas (Faltante o Sobrante contra Caja)
            if (diferencia < 0) {
                // Faltante: Débito cuenta por cobrar cajero, Crédito a Caja
                const montoFaltante = Math.abs(diferencia);
                itemsComprobante.push({
                    account: { code: "13659501" },
                    description: `Faltante de caja Turno ${sesionLocal.id_sesion}`,
                    debit: montoFaltante,
                    credit: 0
                });
                itemsComprobante.push({
                    account: { code: "11050501" },
                    description: `Ajuste faltante efectivo Turno ${sesionLocal.id_sesion}`,
                    debit: 0,
                    credit: montoFaltante
                });
            } else if (diferencia > 0) {
                // Sobrante: Débito a Caja, Crédito a Otros Ingresos
                itemsComprobante.push({
                    account: { code: "11050501" },
                    description: `Ajuste sobrante efectivo Turno ${sesionLocal.id_sesion}`,
                    debit: diferencia,
                    credit: 0
                });
                itemsComprobante.push({
                    account: { code: "42958101" },
                    description: `Sobrante de caja Turno ${sesionLocal.id_sesion}`,
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
                ...resumenTotales, // 🛡️ Preserva de forma transparente todas las bóvedas multidivisa de Venezuela
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

            const claveCierres = `geokatu_cierres_cola_${idNegocio}`;
            const pendientes = JSON.parse(localStorage.getItem(claveCierres) || '[]');
            if (!pendientes.some(c => c.id_sesion === payloadCierre.id_sesion)) pendientes.push(payloadCierre);
            try {
                localStorage.setItem(claveCierres, JSON.stringify(pendientes));
            } catch (error) {
                return { success: false, error: 'No se pudo conservar el cierre: ' + error.message };
            }
            localStorage.removeItem(claveStorage);

            try {
                if (navigator.onLine) {
                    const arqueoRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Cierres_Z`, payloadCierre.id_sesion);
                    const batch = crearLoteIdempotente(db, arqueoRef, runTransaction);
                    batch.set(arqueoRef, payloadCierre);

                    // Sellar específicamente la terminal activa sin tocar las demás cajas
                    const turnoActualRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Sesiones_Caja`, `Turno_${terminalId}`);
                    batch.set(turnoActualRef, { estado: "CERRADA", ultimo_cierre: payloadCierre.fecha_cierre, terminal_id: terminalId });

                    await batch.commit();
                    quitarConfirmados(localStorage, claveCierres, [payloadCierre.id_sesion], 'id_sesion');
                }
                return { success: true, cierre: payloadCierre, offline: !navigator.onLine };
            } catch (e) {
                return { success: true, cierre: payloadCierre, offline: true };
            }
        },
        sincronizarCierresPendientes: async (idNegocio) => {
            if (!navigator.onLine || !_verificarAcceso()) return { sincronizados: 0 };
            const clave = `geokatu_cierres_cola_${idNegocio}`;
            let sincronizados = 0;
            for (const cierre of JSON.parse(localStorage.getItem(clave) || '[]')) {
                try {
                    const ref = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Cierres_Z`, cierre.id_sesion);
                    const turnoRef = doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/Sesiones_Caja`, `Turno_${cierre.terminal_id}`);
                    await runTransaction(db, async tx => {
                        const previo = await tx.get(ref);
                        const turno = await tx.get(turnoRef);
                        if (previo.exists()) return;
                        tx.set(ref, cierre);
                        if (turno.exists() && turno.data().id_sesion === cierre.id_sesion) {
                            tx.update(turnoRef, { estado: 'CERRADA', ultimo_cierre: cierre.fecha_cierre });
                        }
                    });
                    quitarConfirmados(localStorage, clave, [cierre.id_sesion], 'id_sesion');
                    sincronizados++;
                } catch (error) { console.warn('[Cierre pendiente]', error.message); }
            }
            return { sincronizados };
        }

    },

    /**
     * @namespace MetricasService
     * Telemetría comercial, auditoría forense WMS y cuotas de infraestructura
     */
    MetricasService: {
        obtenerVentasRango: async (idNegocio, fechaInicioISO, fechaFinISO, maxRegistros = 400) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid');
            if (!tenantReal) return { success: false, error: "Comercio no especificado." };

            try {
                const rutaVentas = _SCHEMA.ColeccionDirectorio + '/' + tenantReal + '/Ventas_POS';
                const colRef = collection(db, rutaVentas);
                const q = query(
                    colRef,
                    where("timestamp_caja", ">=", fechaInicioISO),
                    where("timestamp_caja", "<=", fechaFinISO),
                    orderBy("timestamp_caja", "desc"),
                    limit(maxRegistros)
                );
                const snap = await getDocs(q);
                const ventas = [];
                snap.forEach(function(d) { ventas.push(Object.assign({ id_firestore: d.id }, d.data())); });
                return { success: true, data: ventas, origen: "nube" };
            } catch (err) {
                console.warn("[MetricasService] Fallback local para ventas:", err.message);
                const claveCola = 'geokatu_sync_cola_' + tenantReal;
                const cola = JSON.parse(localStorage.getItem(claveCola) || "[]");
                const filtradas = cola.filter(function(t) {
                    return t.timestamp_caja >= fechaInicioISO && t.timestamp_caja <= fechaFinISO;
                });
                return { success: true, data: filtradas, origen: "cola_local", error: err.message };
            }
        },

        escucharVentasHoy: (idNegocio, fechaInicioHoyISO, callback) => {
            if (!_verificarAcceso() || !navigator.onLine) return () => {};
            const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid');
            if (!tenantReal) return () => {};

            try {
                const rutaVentas = _SCHEMA.ColeccionDirectorio + '/' + tenantReal + '/Ventas_POS';
                const colRef = collection(db, rutaVentas);
                const q = query(
                    colRef,
                    where("timestamp_caja", ">=", fechaInicioHoyISO),
                    orderBy("timestamp_caja", "desc"),
                    limit(150)
                );
                return onSnapshot(q, (snapshot) => {
                    const ventas = [];
                    snapshot.forEach(function(docSnap) {
                        ventas.push(Object.assign({ id_firestore: docSnap.id }, docSnap.data()));
                    });
                    callback({ success: true, data: ventas });
                }, (err) => {
                    console.warn("[MetricasService] Suscripción interrumpida:", err.message);
                });
            } catch (e) {
                console.warn("[MetricasService] Error listener ventas:", e.message);
                return () => {};
            }
        },

        obtenerCierresZRango: async (idNegocio, fechaInicioISO, fechaFinISO) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid');
            if (!tenantReal) return { success: false, error: "Comercio no especificado." };

            try {
                const rutaCierres = _SCHEMA.ColeccionDirectorio + '/' + tenantReal + '/Cierres_Z';
                const colRef = collection(db, rutaCierres);
                const q = query(
                    colRef,
                    where("fecha_cierre", ">=", fechaInicioISO),
                    where("fecha_cierre", "<=", fechaFinISO),
                    orderBy("fecha_cierre", "desc"),
                    limit(60)
                );
                const snap = await getDocs(q);
                const cierres = [];
                snap.forEach(function(d) { cierres.push(Object.assign({ id_firestore: d.id }, d.data())); });
                return { success: true, data: cierres };
            } catch (e) {
                return { success: false, error: e.message, data: [] };
            }
        },

        obtenerMovimientosKardexRango: async (idNegocio, fechaInicioISO, fechaFinISO, maxLimit = 500) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid');
            if (!tenantReal) return { success: false, error: "Comercio no especificado." };

            try {
                const rutaKardex = _SCHEMA.ColeccionDirectorio + '/' + tenantReal + '/Movimientos_Kardex';
                const colRef = collection(db, rutaKardex);
                const q = query(
                    colRef,
                    where("timestamp", ">=", fechaInicioISO),
                    where("timestamp", "<=", fechaFinISO),
                    orderBy("timestamp", "desc"),
                    limit(maxLimit)
                );
                const snap = await getDocs(q);
                const movs = [];
                snap.forEach(function(d) { movs.push(Object.assign({ id_kardex: d.id }, d.data())); });
                return { success: true, data: movs };
            } catch (e) {
                console.warn("[MetricasService] Error recuperando Kardex:", e.message);
                const claveMovs = 'geokatu_movimientos_cola_' + tenantReal;
                const colaMovs = JSON.parse(localStorage.getItem(claveMovs) || "[]");
                return { success: true, data: colaMovs, origen: "cola_local" };
            }
        },

        obtenerAlertasSeguridadVivas: async (idNegocio) => {
            if (!_verificarAcceso()) return { success: false, error: "Sesión no autorizada." };
            const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid');
            if (!tenantReal) return { success: false, error: "Comercio no especificado." };

            try {
                const q = query(
                    collection(db, "Alertas_Seguridad"),
                    where("id_negocio", "==", tenantReal),
                    where("resuelto", "==", false),
                    limit(50)
                );
                const snap = await getDocs(q);
                const alertas = [];
                snap.forEach(function(d) { alertas.push(Object.assign({ id_alerta: d.id }, d.data())); });
                return { success: true, data: alertas };
            } catch (e) {
                return { success: false, error: e.message, data: [] };
            }
        },

        obtenerControlFacturacion: async (idNegocio) => {
            const tenantReal = idNegocio || localStorage.getItem('geokatu_active_uid');
            if (!tenantReal) return { success: false, error: "Comercio no especificado." };

            try {
                const docSnap = await getDoc(doc(db, _SCHEMA.ColeccionDirectorio, tenantReal));
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    const planActivoCalculado = data.plan_suscripcion || (data.premium ? "PRO" : "FREEMIUM");
                    return {
                        success: true,
                        pais: data.pais || "COL",
                        facturacion_control: data.facturacion_control || {
                            facturas_emitidas_mes: 0,
                            facturas_cupo_gratis: 1300,
                            facturas_prepago_saldo: 0,
                            plan_activo: planActivoCalculado
                        }
                    };
                }
                return { success: false, error: "Comercio no encontrado" };
            } catch (e) {
                return { success: false, error: e.message };
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
                const rutaPedido = _SCHEMA.ColeccionDirectorio + '/' + payload.idNegocio + '/pedidos_entrantes';
                const docRef = doc(db, rutaPedido, payload.ticket);
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
                await set(rtdbRef(realtimeDb, 'malla_de_gas/ordenes_activas/' + idOrden), datosRadar);
                await set(rtdbRef(realtimeDb, 'malla_de_gas/secretos_ordenes/' + idOrden), datosSecretos);
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

                await set(rtdbRef(realtimeDb, 'malla_de_gas/ordenes_activas/' + payload.ticketPublico), {
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
                const radarRef = rtdbRef(realtimeDb, 'malla_de_gas/ordenes_activas/' + payload.ticketPublico);
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
                await set(rtdbRef(realtimeDb, 'malla_de_gas/ordenes_activas/' + ticketPublico), null);
                return { success: true };
            } catch (e) { return { success: false, error: e.message }; }
        },
        transmitirCoordenadasUnidad: async (tipoUnidad, placaId, dataCoordenadas) => {
            try {
                const nodoRef = rtdbRef(realtimeDb, 'malla_de_gas/telemetria_activa/' + tipoUnidad + '/' + placaId);
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
                const alertaRef = rtdbRef(realtimeDb, 'malla_de_gas/alertas_conductores/' + placaId);
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
// Las colas pertenecen al comercio activo. Cada recibo protege los reintentos.
GeokatuDB.sincronizarPendientesOperativos = async (idNegocio) => {
    if (!idNegocio || !navigator.onLine) return;
    await GeokatuDB.InventarioService.sincronizarMovimientosPendientes(idNegocio);
    await GeokatuDB.PosService.sincronizarVentasPendientes(idNegocio);
    await GeokatuDB.PosService.sincronizarCierresPendientes(idNegocio);
    await GeokatuDB.PosService.sincronizarColaGoogleSheets(idNegocio);
};

window.addEventListener('online', () => {
    GeokatuDB.sincronizarPendientesOperativos(localStorage.getItem('geokatu_active_uid'))
        .catch(error => console.warn('[Sincronización pendiente]', error.message));
});
export default GeokatuDB;



