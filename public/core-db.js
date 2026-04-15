/**



* @file core-db.js



* @description Capa de Abstracción y Seguridad para Firebase v10.



* Aísla la UI de la base de datos, optimiza costos (Blaze), implementa Zero Trust



* y maneja el enrutamiento inteligente para sucursales/franquicias.



*/







import { doc, getDoc, setDoc, collection, writeBatch, getDocs, query, where, limit, startAfter, orderBy, startAt, endAt, collectionGroup, deleteDoc, getCountFromServer } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';




import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, getAdditionalUserInfo, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';


import { getAnalytics, logEvent } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js';

import * as geofire from "https://cdn.jsdelivr.net/npm/geofire-common@5.2.0/+esm";

// INYECTAMOS EL IMPORT DE STORAGE AQUÍ:
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';

import { db } from './firebase-config.js'; // Ajusta la ruta a tu inicialización de Firebase




// Extraemos las instancias nativas desde tu base de datos ya inicializada
const auth = getAuth(db.app);
const storage = getStorage(db.app); // 🔥 INYECTAMOS EL MOTOR DE STORAGE AQUÍ

// 🚨 ESCUDO VITAL: Evita que el mapa colapse si el usuario usa Modo Incógnito o Brave

let analytics = null;
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



// La UI pide "Locales", el Core lee las colecciones reales. Protege el esquema.



const _SCHEMA = {



ColeccionDirectorio: "Directorio",



ColeccionCatalogos: "Catalogos_Centrales", // Bóveda matriz para franquicias (Hub & Spoke)



SubColeccionProductos: "productos"



};







// ==========================================



// 2. CACHÉ EN MEMORIA (Privado)



// ==========================================



// Evita lecturas redundantes a Firestore durante la misma sesión.



const _cacheLocales = {};







// ==========================================



// 3. CAPA DE ABSTRACCIÓN (Singleton Exportable)



// ==========================================



const QRpidoDB = {







/**



* @namespace LocalService



* Gestiona la lectura de datos de negocios y enruta sucursales a su catálogo matriz.



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





// LÓGICA DE SUCURSALES (Hub & Spoke):



// Identificamos el ID real del catálogo y si pertenece a una franquicia.



const rutaCatalogo = data.idCatalogoCentral ? data.idCatalogoCentral : idNegocio;



const esSucursal = !!data.idCatalogoCentral;







// Empaquetamos la respuesta inyectando los metadatos de enrutamiento



const respuestaFinal = {



...data,



_meta: {



idParaProductos: rutaCatalogo,



esFranquicia: esSucursal



}



};







_cacheLocales[idNegocio] = respuestaFinal;



return { success: true, data: respuestaFinal };



} else {



return { success: false, error: "Negocio no encontrado", details: "El documento no existe en la base de datos." };



}



} catch (e) {



return { success: false, error: "Error de conexión al obtener detalles", details: e.message };



}



}, // <--- Coma vital para separar métodos





registrarEventoAnalytics: async (nombreEvento, parametros) => {

try {

// Dispara el evento real a Google Analytics 4

logEvent(analytics, nombreEvento, parametros);

// Mantenemos el log visual solo para que tú puedas depurar si lo necesitas

console.log(`📊 [Analytics Disparado] ${nombreEvento}`, parametros);

return { success: true };

} catch (error) {

// Si Analytics falla (ej. bloqueadores de anuncios), la app no se rompe

console.warn("Analytics bloqueado o fallido:", error);

return { success: false, error: error.message };

}

}, // <--- Coma vital


obtenerCaballoTroya: async () => {

try {

const troyaSnap = await getDocs(collection(db, "Caballo_Troya"));

const data = troyaSnap ? troyaSnap.docs.map(d => d.data()) : [];

return { success: true, data: data };

} catch (error) {

return { success: false, error: error.message };

}

}

},









        /**
         * @namespace AdminService
         * Operaciones de escritura optimizadas e inteligentes para administradores.
         */
        AdminService: {
            obtenerNegocioPorUsuario: async (uid, email, userRole) => {
                try {
                    const snap = await getDoc(doc(db, _SCHEMA.ColeccionDirectorio, uid));
                    if (snap.exists()) {
                        return { success: true, data: { id: snap.id, ...snap.data() } };
                    }
                    return { success: true, data: null };
                } catch (e) {
                    return { success: false, error: e.message };
                }
            },

            subirArchivo: async (path, blob) => {
                try {
                    const storageRef = ref(storage, path);
                    await uploadBytes(storageRef, blob);
                    const urlDescarga = await getDownloadURL(storageRef);
                    return { success: true, data: urlDescarga };
                } catch (e) {
                    return { success: false, error: e.message };
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
                } catch (e) {
                    return { success: false, error: "Error al sincronizar el catálogo", details: e.message };
                }
            },

            // 🚨 INYECCIONES MAESTRAS (LAS QUE TE FALTABAN) 🚨
            
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
                    return { success: true };
                } catch (e) { return { success: false, error: e.message }; }
            },

            guardarProducto: async (idNegocio, idProducto, dataObj) => {
                try {
                    const docRef = idProducto 
                        ? doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`, idProducto)
                        : doc(collection(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`));
                    await setDoc(docRef, dataObj, { merge: true });
                    return { success: true };
                } catch (e) { return { success: false, error: e.message }; }
            },

            obtenerProductos: async (idNegocio, filtros) => {
                try {
                    const qSnap = await getDocs(collection(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`));
                    const resultados = [];
                    qSnap.forEach(doc => resultados.push({ id_prod: doc.id, ...doc.data() }));
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
                    // Marcado de seguridad (Soft Delete)
                    await setDoc(doc(db, `${_SCHEMA.ColeccionDirectorio}/${idNegocio}/${_SCHEMA.SubColeccionProductos}`, idProducto), { agotado: true, eliminado: true }, { merge: true });
                    return { success: true };
                } catch (e) { return { success: false, error: e.message }; }
            }
        },

            // --- MÓDULO DE MODERACIÓN AVANZADA ---

            obtenerNegociosPendientes: async () => {
                try {
                    const q = query(
                        collection(db, _SCHEMA.ColeccionDirectorio), 
                        where("estado_moderacion", "==", "pendiente"),
                        limit(20) // Traemos de 20 en 20 para no saturar la RAM
                    );
                    const snap = await getDocs(q);
                    const resultados = [];
                    snap.forEach(doc => resultados.push({ id: doc.id, ...doc.data() }));
                    return { success: true, data: resultados };
                } catch (e) { return { success: false, error: e.message }; }
            },

            aprobarNegocio: async (idNegocio) => {
                try {
                    // Quitamos el estado pendiente y le ponemos fecha de aprobación
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
                    
                    // 1. Referencia al negocio en la tabla principal (para borrarlo)
                    const refPrincipal = doc(db, _SCHEMA.ColeccionDirectorio, idNegocio);
                    batch.delete(refPrincipal);

                    // 2. Si NO es Spam, lo guardamos en la Bóveda de Rechazos (Cementerio)
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
                        // 3. SORPRESA: Si es Spam, lo metemos a la Lista Negra
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
                    
                    // Retornamos el primero que encuentre
                    return { success: true, data: snap.docs[0].data() };
                } catch (e) { return { success: false, error: e.message }; }
            },
            // --- MÓDULO CEREBRO CENTRAL (SUPER ADMIN) ---

            obtenerEstadisticasGlobales: async () => {
                try {
                    // Magia de Ahorro: getCountFromServer cuenta en la nube, casi no cuesta lecturas
                    const collDirectorio = collection(db, _SCHEMA.ColeccionDirectorio);
                    
                    const qAprobados = query(collDirectorio, where("estado_moderacion", "==", "aprobado"));
                    const qPendientes = query(collDirectorio, where("estado_moderacion", "==", "pendiente"));

                    const [snapAprobados, snapPendientes] = await Promise.all([
                        getCountFromServer(qAprobados),
                        getCountFromServer(qPendientes)
                    ]);

                    return { 
                        success: true, 
                        data: {
                            activos: snapAprobados.data().count,
                            pendientes: snapPendientes.data().count
                        } 
                    };
                } catch (e) { return { success: false, error: e.message }; }
            },

            buscarUsuarioParaModerador: async (email) => {
                try {
                    // Buscamos al usuario en la base principal por su correo
                    const q = query(
                        collection(db, _SCHEMA.ColeccionDirectorio), 
                        where("email", "==", email.trim().toLowerCase()), 
                        limit(1)
                    );
                    const snap = await getDocs(q);
                    if(snap.empty) return { success: false, error: "No existe ninguna cuenta con este correo en QRpido." };
                    
                    const datos = snap.docs[0].data();
                    return { success: true, data: { uid: snap.docs[0].id, nombre: datos.nombre, email: datos.email } };
                } catch (e) { return { success: false, error: e.message }; }
            },

            nombrarModerador: async (uid, email) => {
                try {
                    await setDoc(doc(db, "Usuarios_Admin", uid), { 
                        rol: "moderador", 
                        email: email, 
                        fecha_ingreso: new Date().toISOString() 
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

            revocarModerador: async (uid) => {
                try {
                    // Le quitamos la placa borrando su documento de la colección de permisos
                    await deleteDoc(doc(db, "Usuarios_Admin", uid));
                    return { success: true };
                } catch (e) { return { success: false, error: e.message }; }
            },


/**



* @namespace RadarService



* Consultas geoespaciales con cancelación de red (Efecto Rebote) y obtención de catálogos.



*/



RadarService: {
  



obtenerNegocio: async (idNegocio) => {



// Puente para respetar el contrato de la UI



return await QRpidoDB.LocalService.getDetails(idNegocio);



},







obtenerProductosPublicos: async (idNegocio, filtros) => {



try {



// 1. Ruteo Inteligente (Hub & Spoke)



const infoLocal = await QRpidoDB.LocalService.getDetails(idNegocio);



if (!infoLocal.success) throw new Error("No se pudo rutear el catálogo.");







const rutaCatalogo = infoLocal.data._meta.idParaProductos;



const esFranquicia = infoLocal.data._meta.esFranquicia;



const coleccionBase = esFranquicia ? _SCHEMA.ColeccionCatalogos : _SCHEMA.ColeccionDirectorio;







const productosRef = collection(db, coleccionBase, rutaCatalogo, _SCHEMA.SubColeccionProductos);





// 2. Desempaquetado de Filtros (Paginación)



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



resultados.push({ id_prod: doc.id, ...doc.data() });



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
                } catch (e) {
                    console.error("Error CoreDB buscarEnRadar:", e);
                    return { success: false, error: e.message };
                }
            },
            buscarInmueblesEnRadar: async (lat, lng, radiusInM) => {
                if (!db || typeof geofire === 'undefined') return { success: false, error: 'Firebase o GeofireX no listos' };
                try {
                    const radiusInKm = radiusInM / 1000;
                    const bounds = geofire.geohashQueryBounds([lat, lng], radiusInKm);
                    const promises = [];

                    for (const b of bounds) {
                        // 🚨 Magia aquí: collectionGroup perfora TODAS las carpetas "productos" de todos los usuarios
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
                            // Si tiene geohash, es un inmueble con coordenadas propias
                            if(data.geohash) {
                                matchingDocs.push({ ...data, id: doc.id, es_inmueble_real: true, tipo_modelo: 'inmueble' });
                            }
                        });
                    });

                    return { success: true, data: matchingDocs };
                } catch (error) {
                    console.error("Error CoreDB buscarInmueblesEnRadar:", error);
                    return { success: false, error: error.message };
                }
            },




search: async (lat, lng, queryConstraints, signal) => {



try {



// Validación pre-red: Si el usuario movió el mapa rápido, cancelamos antes de gastar ancho de banda.



if (signal && signal.aborted) throw new Error("AbortError");







const dirRef = collection(db, _SCHEMA.ColeccionDirectorio);



const q = query(dirRef, ...queryConstraints);





const querySnapshot = await getDocs(q);







// Validación post-red: Si el usuario abortó durante la descarga, ignoramos el procesamiento.



if (signal && signal.aborted) throw new Error("AbortError");







const resultados = [];



querySnapshot.forEach((doc) => {



resultados.push({ id: doc.id, ...doc.data() });



});







return { success: true, data: resultados };



} catch (e) {



// Filtramos el error de cancelación para no asustar a la UI



if (e.message === "AbortError" || e.name === "AbortError") {



return { success: false, error: "Búsqueda cancelada", details: "Mitigación de efecto rebote activada." };



}



return { success: false, error: "Fallo en el radar de búsqueda", details: e.message };



}



}



},



/**

* @namespace MediaService

* Gestiona el feed de noticias (Pulso Urbano) protegiendo la lectura de Firebase y manejando la paginación.

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

} catch (e) {

return { success: false, error: "Error obteniendo el feed de noticias", details: e.message };

}

}, // <--- COMA VITAL que separa las dos funciones



obtenerNoticiaPorId: async (idNoticia) => {

try {

const docRef = doc(db, "Pulso_Urbano", idNoticia);

const docSnap = await getDoc(docRef);

if (docSnap.exists()) {

return { success: true, data: { id: docSnap.id, ...docSnap.data() } };

}

return { success: false, error: "Noticia no encontrada" };

} catch (e) {

return { success: false, error: e.message };

}

}

},

/**

* @namespace SecurityService

* Motor Zero Trust para validación y autenticación aislada de la UI.

*/

SecurityService: {

registrarUsuario: async (email, pass, tipoCuenta) => {
    try {
        const result = await createUserWithEmailAndPassword(auth, email, pass);
        // Creamos su "Bóveda" en Firestore cumpliendo tus Reglas Zero Trust
        await setDoc(doc(db, _SCHEMA.ColeccionDirectorio, result.user.uid), {
            nombre: "Mi Negocio",
            email: email,
            tipo_modelo: tipoCuenta,
            estado_moderacion: 'pendiente',
            premium: false,
            fecha_registro: new Date().toISOString()
        });
        return { success: true, data: result.user };
    } catch (e) {
        return { success: false, error: e.message };
    }
},

obtenerRolAdmin: async (uid) => {
    try {
        const snap = await getDoc(doc(db, "Usuarios_Admin", uid));
        return { success: true, data: snap.exists() ? snap.data() : { rol: 'estandar' } };
    } catch (e) {
        return { success: false, error: e.message };
    }
},

validateCartIntegrity: (carritoLocal, memoriaProductos) => {


try {

let totalReal = 0;

const carritoSeguro = [];



for (const itemCliente of carritoLocal) {

const productoInmutable = memoriaProductos.find(p => p.id === itemCliente.id);

if (!productoInmutable) throw new Error(`Producto inválido detectado (ID: ${itemCliente.id})`);



const subtotal = productoInmutable.precio * itemCliente.cantidad;

totalReal += subtotal;



carritoSeguro.push({

id: productoInmutable.id,

cantidad: itemCliente.cantidad,

precioValidado: productoInmutable.precio,

subtotal: subtotal

});

}

return { success: true, data: { totalAprobado: totalReal, carritoLimpio: carritoSeguro } };

} catch (e) {

return { success: false, error: "Violación de integridad detectada", details: e.message };

}

},



iniciarConGoogle: async () => {
    try {
        await setPersistence(auth, browserLocalPersistence);
        const provider = new GoogleAuthProvider();
        const result = await signInWithPopup(auth, provider);
        
        // Magia Zero Trust: Validamos si es la primera vez que entra con Google
        const infoExtra = getAdditionalUserInfo(result);
        if (infoExtra && infoExtra.isNewUser) {
            await setDoc(doc(db, _SCHEMA.ColeccionDirectorio, result.user.uid), {
              nombre: result.user.displayName || "Mi Negocio",
                email: result.user.email,
                tipo_modelo: 'negocio', // Por defecto
                estado_moderacion: 'pendiente',
                premium: false,
                fecha_registro: new Date().toISOString()
            });
        }
        return { success: true, data: result.user };
    } catch (e) {
        return { success: false, error: e.message };
    }
},




iniciarSesion: async (email, pass) => {

try {

const result = await signInWithEmailAndPassword(auth, email, pass);

return { success: true, data: result.user };

} catch (e) {

return { success: false, error: e.message };

}

},



enviarMagicLink: async (email, urlRetorno) => {

try {

const actionCodeSettings = { url: urlRetorno, handleCodeInApp: true };

await sendSignInLinkToEmail(auth, email, actionCodeSettings);

return { success: true };

} catch (e) {

return { success: false, error: e.message };

}

},



esEnlaceMagico: (url) => {

return isSignInWithEmailLink(auth, url);

},



verificarMagicLink: async (email, url) => {

try {

const result = await signInWithEmailLink(auth, email, url);

return { success: true, data: result.user };

} catch (e) {

return { success: false, error: e.message };

}

},



cerrarSesion: async () => {

try {

await signOut(auth);

return { success: true };

} catch (e) {

return { success: false, error: e.message };

}

},



observarEstadoSesion: (callback) => {

onAuthStateChanged(auth, callback);

}

}

};





// ==========================================



// EXPORTACIÓN ESTRICTA (Singleton)



// ==========================================



// Evita que la UI tenga acceso a _SCHEMA o _cacheLocales.



export default QRpidoDB;
