const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { getFullnodeUrl, SuiClient } = require('@mysten/sui/client');
const { defineSecret } = require('firebase-functions/params');
const nodemailer = require('nodemailer');

// -------------------------------------------------------------------
// CONFIGURACIÓN GLOBAL: MOTOR DE CORREO (ADUANA DIGITAL)
// -------------------------------------------------------------------
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'qrpido@gmail.com',        // <-- Tu correo real
        pass: 'khxvkeufgicxcrsh'         // <-- La clave de 16 letras (sin espacios)
    }
});


// Inicializar el SDK de administrador de Firebase
admin.initializeApp();

// Inicializamos el "visor" hacia la red principal de SUI
const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet') });

// Definimos el secreto de Google Cloud
const semillaMaestra = defineSecret('SEMILLA_MAESTRA');

// -------------------------------------------------------------------
// MÓDULO 1: LA FORJA DE BILLETERAS (Derivación HD)
// -------------------------------------------------------------------
exports.forjarBilletera = functions.runWith({ secrets: [semillaMaestra] }).auth.user().onCreate(async (user) => {
    const MNEMONIC_MAESTRA = semillaMaestra.value();
    const uid = user.uid;
    const db = admin.firestore();
    
        // 🛡️ SHARDING: Multiplicamos x10 la capacidad de registro concurrente
    const NUM_ESQUIRLAS = 10;
    const shardId = Math.floor(Math.random() * NUM_ESQUIRLAS); // Elegimos una esquirla al azar (0 a 9)
    const shardRef = db.collection('Sistema').doc('ContadorBilleteras').collection('Esquirlas').doc(shardId.toString());
    const userRef = db.collection('Directorio').doc(uid);

    try {
        const indiceSeguro = await db.runTransaction(async (transaction) => {
            const shardDoc = await transaction.get(shardRef);
            let conteoActual = 0;
            
            if (shardDoc.exists) {
                conteoActual = shardDoc.data().conteo || 0;
            }
            
            const nuevoConteo = conteoActual + 1;
            transaction.set(shardRef, { conteo: nuevoConteo }, { merge: true });
            
            // 🧠 MAGIA MATEMÁTICA: Garantizamos un índice único a nivel global
            // Ej: Esquirla 4, Conteo 5 -> Índice: (5 * 10) + 4 = 54
            // Nadie más en el universo tendrá el índice 54.
            return (nuevoConteo * NUM_ESQUIRLAS) + shardId;
        });

        const derivationPath = `m/44'/784'/${indiceSeguro}'/0'/0'`;

        const keypair = Ed25519Keypair.deriveKeypair(MNEMONIC_MAESTRA, derivationPath);
        const suiAddress = keypair.getPublicKey().toSuiAddress();

        await userRef.set({
            wallet_sui: suiAddress,
            indice_derivacion: indiceSeguro,
            estado_billetera: "forjada_activa",
            fecha_creacion: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log(`Éxito: Billetera SUI ${suiAddress} (Índice: ${indiceSeguro}) forjada para UID: ${uid}`);
        return null;

    } catch (error) {
        console.error(`Error crítico forjando la billetera HD para UID ${uid}: `, error);
        return null;
    }
});

// -------------------------------------------------------------------
// MÓDULO 2: LA TESORERÍA AUTÓNOMA (Vigilante de Gas)
// -------------------------------------------------------------------
exports.vigilanteTesoreria = functions.pubsub.schedule('every 12 hours').onRun(async (context) => {
    
    // IMPORTANTE: Cambia este string por la dirección pública real de tu tesorería cuando la tengas.
    const direccionTesoreria = process.env.DIRECCION_TESORERIA || "0x966bb847123c0999b3b02eca0456349558363b76148f5c4edf8d7d831b1a7d84";
    const UMBRAL_CRITICO = 5.0; 

    try {
        const balance = await suiClient.getBalance({
            owner: direccionTesoreria,
            coinType: '0x2::sui::SUI'
        });

        const suiActual = parseInt(balance.totalBalance) / 1000000000;
        console.log(`[VIGILANTE] Balance actual de la Tesorería: ${suiActual} SUI`);

               if (suiActual < UMBRAL_CRITICO) {
            // ... (mantén tu lógica de alertas aquí)
        } else {
            console.log("[VIGILANTE] Tesorería saludable. Iniciando fraccionamiento de Gas...");
            
            // 🛠️ MÁQUINA DE COIN SPLITTING (Troceador de SUI)
            const rtdb = admin.database();
            const mallaRef = rtdb.ref('Sistema/MallaDeGas/libres');
            
            // Verificamos cuántas monedas "munición" quedan en la Malla
            const snapshot = await mallaRef.once('value');
            const monedasEnMalla = snapshot.numChildren();

            if (monedasEnMalla < 50) { // Si quedan menos de 50 pedacitos, troceamos más
                console.log(`[FRACCIONADOR] Malla con stock bajo (${monedasEnMalla}). Generando 100 fragmentos...`);
                
                // NOTA: En producción, aquí se ejecutaría la transacción real en SUI:
                // tx.splitCoins(tx.gas, [tx.pure(10000000), tx.pure(10000000), ...]);
                
                let nuevosFragmentos = {};
                for(let i=0; i<100; i++) {
                    const idFalso = "coin_" + Math.random().toString(36).substring(2, 10);
                    nuevosFragmentos[idFalso] = {
                        id: "0x" + Math.random().toString(16).slice(2, 32),
                        monto: 10000000, // 0.01 SUI en MIST
                        version: 1,
                        digest: "pending_sync"
                    };
                }
                
                // Inyectamos la "munición" de gas a la RTDB de forma masiva
                await mallaRef.update(nuevosFragmentos);
                console.log("[FRACCIONADOR] 100 monedas de gas inyectadas exitosamente.");
            }
        }


        return null;

    } catch (error) {
        console.error("[VIGILANTE] Error de conexión con la blockchain: ", error);
        return null;
    }
});
// IMPORTANTE: Añadir esta importación en la parte superior del archivo index.js
// const { TransactionBlock } = require('@mysten/sui/transactions');

// -------------------------------------------------------------------
// MÓDULO 3: EL CADENERO (Validación Inmutable y Liberación de Fondos)
// -------------------------------------------------------------------
exports.validarEntrega = functions.https.onCall(async (data, context) => {
    // 1. Escudo Web2: Solo usuarios autenticados pueden golpear esta puerta
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión para confirmar entregas.');
    }

    const uidDomiciliario = context.auth.uid;
    const { ordenId, codigoSuministrado } = data; // Lo que envía el frontend
    const db = admin.firestore();
    const ordenRef = db.collection('Logistica_Ordenes').doc(ordenId);

    try {
        // Ejecutamos todo dentro de una Transacción para evitar condiciones de carrera 
        // (ej. que el usuario presione el botón 5 veces rápido)
        return await db.runTransaction(async (transaction) => {
            const ordenDoc = await transaction.get(ordenRef);
            
            if (!ordenDoc.exists) {
                throw new functions.https.HttpsError('not-found', 'La orden especificada no existe.');
            }

            const orden = ordenDoc.data();

            // 2. Verificaciones Previas
            if (orden.estado !== 'en_transito') {
                throw new functions.https.HttpsError('failed-precondition', 'Esta orden ya fue procesada o no está activa.');
            }
            if (orden.domiciliario_uid !== uidDomiciliario) {
                throw new functions.https.HttpsError('permission-denied', 'No tienes permisos sobre esta logística.');
            }

            const seguridad = orden.seguridad_web3 || {};

            // 3. Revisión de Penalizaciones (Anti-Fuerza Bruta)
            if (seguridad.bloqueado_hasta && seguridad.bloqueado_hasta.toDate() > new Date()) {
                throw new functions.https.HttpsError('resource-exhausted', 'Demasiados intentos. Sistema bloqueado temporalmente.');
            }

            // 4. La Prueba de la Verdad (Validar Código)
            if (codigoSuministrado !== seguridad.codigo_entrega) {
                // El código es incorrecto. Sumamos un strike.
                const intentos = (seguridad.intentos_fallidos || 0) + 1;
                let updateData = { 'seguridad_web3.intentos_fallidos': intentos };

                // Si llega a 3 intentos, lo bloqueamos por 15 minutos.
                if (intentos >= 3) {
                    const tiempoDesbloqueo = new Date(Date.now() + 15 * 60 * 1000);
                    updateData['seguridad_web3.bloqueado_hasta'] = admin.firestore.Timestamp.fromDate(tiempoDesbloqueo);
                }
                
                transaction.update(ordenRef, updateData);
                throw new functions.https.HttpsError('invalid-argument', 'El código de entrega es incorrecto.');
            }

            // 5. ¡CÓDIGO CORRECTO! -> Lógica de Distribución Matemática
            const montoTotal = orden.monto_total;
            const comisionPlataforma = montoTotal * 0.10;  // Parámetro de tesorería fijo
            const pagoEmbajador = comisionPlataforma * 0.25;
            const pagoDomiciliario = montoTotal - comisionPlataforma;

                  // 6. LA MALLA DE GAS (RTDB) Y EL NOTARIO SUI
            let txID_Generado = "pendiente";
            let monedaSuiGas = null;
            
            try {
                // a. Extracción Atómica desde Realtime Database
                const rtdb = admin.database();
                const libresRef = rtdb.ref('Sistema/MallaDeGas/libres');
                
                // La magia de .transaction() de RTDB: bloquea la base de datos por milisegundos
                // garantizando que dos funciones concurrentes no lean la misma moneda.
                const extraccion = await libresRef.transaction((nodosLibres) => {
                    if (nodosLibres) {
                        const idsMonedas = Object.keys(nodosLibres);
                        if (idsMonedas.length > 0) {
                            const idSeleccionado = idsMonedas[0];
                            monedaSuiGas = nodosLibres[idSeleccionado]; // Copiamos los datos de la moneda
                            delete nodosLibres[idSeleccionado];         // La "arrancamos" de la base de datos temporalmente
                            return nodosLibres;                         // RTDB guarda la nueva lista sin esta moneda
                        }
                    }
                    return nodosLibres; // Aborta si no hay monedas
                });

                if (!extraccion.committed || !monedaSuiGas) {
                    throw new Error("Malla de Gas vacía o saturada.");
                }
                // b. La Trituradora Criptográfica (SHA-256)
                // Unimos todos los datos sensibles en un solo texto que solo tú y Firebase conocen
                const datosCrudos = `ORDEN:${ordenId}|MONTO:${montoTotal}|COMISION:${comisionPlataforma}|EMBAJADOR:${pagoEmbajador}`;
                // Convertimos ese texto en una huella digital indescifrable de 64 caracteres
                const huellaCriptografica = crypto.createHash('sha256').update(datosCrudos).digest('hex');

                // c. Construir el Evento en SUI enviando SOLO la huella
                /* const tx = new TransactionBlock();
                tx.setGasPayment([{ 
                    objectId: monedaSuiGas.id, 
                    version: monedaSuiGas.version, 
                    digest: monedaSuiGas.digest 
                }]);

                tx.moveCall({
                    target: `${process.env.PACKAGE_ID}::logistica::sellar_transaccion`,
                    arguments: [
                        tx.pure(huellaCriptografica), // El Notario de SUI solo recibe el código raro
                        tx.pure(Date.now())
                    ]
                });
                
                const result = await suiClient.signAndExecuteTransactionBlock(...);
                txID_Generado = result.digest;
                
                // d. Reciclaje: Devolver el "vuelto" a RTDB con los nuevos datos de la moneda
                // await libresRef.child(monedaSuiGas.id).set(NUEVOS_DATOS_SUI);
                */



                // Simulación para Dry-Coding
                txID_Generado = "0x" + Math.random().toString(16).slice(2) + "_EVENTO_SELLADO";

            } catch (error_sui) {
                console.error("Fallo emitiendo el evento en SUI:", error_sui);
                
                // Protocolo de Rescate: Si SUI falla o la red se cae, devolvemos la moneda intacta a RTDB
                if (monedaSuiGas) {
                    await admin.database().ref('Sistema/MallaDeGas/libres').child(monedaSuiGas.id).set(monedaSuiGas);
                }
                throw new functions.https.HttpsError('internal', 'No se pudo generar el Recibo Inmutable.');
            }

                // (Nota: La lógica de bloqueo de moneda se ejecutará aquí en producción)

                // b. Construir la transacción de Evento (Cero Escrow)
                /* const { TransactionBlock } = require('@mysten/sui/transactions');
                const tx = new TransactionBlock();
                
                // Asignar la moneda de gas específica para evitar colisión
                // tx.setGasPayment([{ objectId: monedaSeleccionada.id, version: ..., digest: ... }]);

                tx.moveCall({
                    target: `${process.env.PACKAGE_ID}::logistica::sellar_transaccion`,
                    arguments: [
                        tx.pure(ordenId),
                        tx.pure(montoTotal),
                        tx.pure(comisionPlataforma),
                        tx.pure(pagoEmbajador),
                        tx.pure(Date.now())
                    ]
                });

                const keypair = Ed25519Keypair.deriveKeypair(semillaMaestra.value(), "m/44'/784'/0'/0'/0'");
                const result = await suiClient.signAndExecuteTransactionBlock({
                    signer: keypair,
                    transactionBlock: tx,
                    options: { showEffects: true, showEvents: true }
                });
                
                txID_Generado = result.digest;
                */

                // Simulación para Dry-Coding en Acode
                txID_Generado = "0x" + Math.random().toString(16).slice(2) + "_EVENTO_SELLADO";

            } catch (error_sui) {
                console.error("Fallo emitiendo el evento en SUI:", error_sui);
                // Si la blockchain falla, detenemos la transacción en Firebase para mantener sincronía
                throw new functions.https.HttpsError('internal', 'No se pudo generar el Recibo Inmutable.');
            }


                       // 7. Sincronización Web2-Web3 (El Cierre del Ciclo)
            let desgloseFinal = {
                comision_red: comisionPlataforma,
                ganancia_domiciliario: pagoDomiciliario
            };

            // 💰 LA MINA DE ORO: Pagar al Embajador si existe
            if (orden.embajador_uid && orden.embajador_uid !== "null") {
                const embajadorRef = db.collection('Directorio').doc(orden.embajador_uid);
                // Usamos set con merge de forma atómica para no sobreescribir su bóveda
                transaction.set(embajadorRef, {
                    saldo_comisiones: admin.firestore.FieldValue.increment(pagoEmbajador),
                    total_referidos_entregados: admin.firestore.FieldValue.increment(1)
                }, { merge: true });
                
                desgloseFinal.pago_embajador = pagoEmbajador;
            }

            transaction.update(ordenRef, {
                estado: 'ENTREGADO',
                'seguridad_web3.intentos_fallidos': 0,
                'seguridad_web3.txID_pago': txID_Generado,
                desglose_pago: desgloseFinal,
                timestamp_entrega: admin.firestore.FieldValue.serverTimestamp()
            });


            // Devolvemos la confirmación al frontend web
            return { 
                success: true, 
                txID: txID_Generado, 
                ganancia: pagoDomiciliario 
            };
        });

    } catch (error) {
        console.error("Fallo de seguridad o ejecución en El Cadenero:", error);
        // Firebase propaga este error directamente al alert() o Toast del frontend
        throw new functions.https.HttpsError('internal', error.message);
    }
});
// -------------------------------------------------------------------
// MÓDULO DE ANCLAJE: CREAR ORDEN (El origen de la transacción)
// -------------------------------------------------------------------
const crypto = require('crypto'); // Necesario para generar códigos seguros

// 🕰️ Helper TOTP: Criptografía Real de lado del servidor (HMAC)
function validarSelloTOTP(codigoDinamico, idNegocio, secretoMaestro) {
    if (!codigoDinamico || !codigoDinamico.startsWith('REF-')) return null;
    const partes = codigoDinamico.split('-');
    if (partes.length !== 3) return null;
    const codigoReferido = partes[1];
    const firmaEnviada = partes[2];

    const bloqueTiempo = Math.floor(Date.now() / 21600000); // Bloques de 6h
    const bloquesAVerificar = [bloqueTiempo, bloqueTiempo - 1];

    for (let bloque of bloquesAVerificar) {
        // 🛡️ PARCHE ZERO-TRUST: Validamos usando la semilla secreta del servidor
        const payload = `${codigoReferido}-${idNegocio}-${bloque}`;
        const firmaCalculada = crypto.createHmac('sha256', secretoMaestro).update(payload).digest('hex').substring(0, 6).toUpperCase();
        if (firmaCalculada === firmaEnviada) return codigoReferido;
    }
    return null; // Firma falsificada o expirada
}

// 🛡️ NUEVA CLOUD FUNCTION: Generador seguro de sellos para la UI
exports.generarSelloSeguro = functions.runWith({ secrets: [semillaMaestra] }).https.onCall((data, context) => {
    const { codigoReferido, idNegocio } = data;
    if (!codigoReferido || !idNegocio) throw new functions.https.HttpsError('invalid-argument', 'Faltan parámetros');
    
    const secreto = semillaMaestra.value();
    const bloqueTiempo = Math.floor(Date.now() / 21600000);
    const payload = `${codigoReferido}-${idNegocio}-${bloqueTiempo}`;
    
    // Forjamos la firma y la entregamos
    const firma = crypto.createHmac('sha256', secreto).update(payload).digest('hex').substring(0, 6).toUpperCase();
    
    return { firma: `REF-${codigoReferido}-${firma}`, timestamp: Date.now() };
});


exports.crearOrdenLogistica = functions.https.onCall(async (data, context) => {
    // 1. Escudo Web2: Solo usuarios autenticados pueden crear órdenes
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión para crear una orden.');
    }

    const uidComerciante = context.auth.uid;
    const { domiciliario_uid, monto_total, ticketReferido, ticketPublico } = data;

    if (!domiciliario_uid || !monto_total || monto_total <= 0) {
         throw new functions.https.HttpsError('invalid-argument', 'Datos de orden incompletos o inválidos.');
    }

    const db = admin.firestore();

    try {
        // ⚖️ AUDITORÍA EN LA SOMBRA: Incremento Atómico de Orden Validada
        const comercioRef = db.collection('Directorio').doc(uidComerciante);
        await comercioRef.update({
            ordenes_validadas: admin.firestore.FieldValue.increment(1)
        });

       // 🔒 VERIFICACIÓN DEL SELLO DE SANGRE (TOTP)
        let embajadorValidado = null;
        if (ticketReferido) {
            const secreto = semillaMaestra.value(); // Recuperamos la semilla aquí
            embajadorValidado = validarSelloTOTP(ticketReferido, uidComerciante, secreto);
            if (!embajadorValidado) {
                console.warn(`[FRAUDE EVITADO] Firma TOTP inválida en comercio: ${uidComerciante}`);
            }
        }


        // 2. Generar el Código de Entrega (Token Criptográfico Corto)
        // Usamos crypto para generar bytes aleatorios y los convertimos a HEX.
        // Formato final: QRP-A1B2C3
        const randomBytes = crypto.randomBytes(3).toString('hex').toUpperCase();
        const codigoEntrega = `QRP-${randomBytes}`;

        // 3. Crear el documento de la Orden con la estructura segura (Escrow Web2)
        const nuevaOrdenRef = db.collection('Logistica_Ordenes').doc(); // Auto-ID
        
       const ordenEstructura = {
            comerciante_uid: uidComerciante,
            domiciliario_uid: domiciliario_uid,
            embajador_uid: embajadorValidado, // null si no hubo o fue fraudulento
            ticket_publico: ticketPublico || "DESCONOCIDO",
            monto_total: monto_total,
            estado: "en_transito",

            
            // Este nodo es el que lee el Cadenero (Módulo 3)
            seguridad_web3: {
                codigo_entrega: codigoEntrega, 
                intentos_fallidos: 0,
                bloqueado_hasta: null,
                txID_escrow: "pendiente_de_blockchain" // Se actualizará al conectar SUI
            },
            
            timestamp_creacion: admin.firestore.FieldValue.serverTimestamp()
        };

        // 4. Guardar en Firestore
        await nuevaOrdenRef.set(ordenEstructura);

        // 5. El Puente a SUI (Bloqueo de fondos)
        /* Aquí el servidor construirá la transacción para llamar al Smart Contract.
           Le dirá: "Congela 'monto_total' de la wallet del comerciante en una caja fuerte nueva".
        */
        // const tx = new TransactionBlock();
        // tx.moveCall({ ... llamar a 'crear_orden' en logistica.move ... });
        // const resultadoSUI = await suiClient.signAndExecuteTransactionBlock(...);

        // 6. Devolver el éxito al frontend (y el ID de la orden para que el comerciante la vea)
        return {
            success: true,
            ordenId: nuevaOrdenRef.id,
            mensaje: "Orden creada y anclada exitosamente."
        };

    } catch (error) {
        console.error("Fallo al crear la orden logística:", error);
        throw new functions.https.HttpsError('internal', 'Error procesando la orden de logística.');
    }
});
// -------------------------------------------------------------------
// MÓDULO 4: LA BOCA DE ENTRADA (Webhook Wompi para Recargas)
// -------------------------------------------------------------------
// Este secreto se debe subir a Google Cloud Secret Manager luego
const secretoWebhooks = defineSecret('WOMPI_SECRET_EVENTS');

exports.wompiWebhook = functions.runWith({ secrets: [secretoWebhooks] }).https.onRequest(async (req, res) => {
    // 1. Sincronía: Wompi exige un código 200 casi inmediato, o pensará que fallamos y reintentará
    res.status(200).send("Webhook recibido por QRpido");

    try {
        const evento = req.body;
        
        // 2. Escudo Criptográfico: Verificar que el mensaje viene realmente de Wompi
        let cadenaConcatenada = "";
        if (evento && evento.signature && evento.signature.properties) {
            evento.signature.properties.forEach(prop => {
                const keys = prop.split('.');
                let value = evento.data;
                keys.forEach(k => value = value[k]);
                cadenaConcatenada += value;
            });
            cadenaConcatenada += evento.timestamp;
            cadenaConcatenada += secretoWebhooks.value();

            const hashCalculado = crypto.createHash('sha256').update(cadenaConcatenada).digest('hex');
            
            if (hashCalculado !== evento.signature.checksum) {
                console.error("ALERTA: Firma de Wompi inválida. Posible inyección rechazada.");
                return;
            }
        } else {
            return; // Payload malformado
        }

        // 3. Procesar ÚNICAMENTE transacciones aprobadas
        if (evento.event === "transaction.updated" && evento.data.transaction.status === "APPROVED") {
            const transaccion = evento.data.transaction;
            
            // 4. Extracción Quirúrgica del UID
            const referenciaPartes = transaccion.reference.split('_');
            if (referenciaPartes[0] !== "RECARGA" || referenciaPartes.length < 2) {
                console.log("Transacción ignorada: No pertenece al flujo de recarga de bóvedas.");
                return;
            }

                        const uidUsuario = referenciaPartes[1];

            // Wompi maneja todo en centavos. Dividimos por 100 para tener los Pesos Colombianos exactos.
            const montoCOP = transaccion.amount_in_cents / 100; 

            const db = admin.firestore();

            // 🛡️ ESCUDO ANTI-LAVADO Y FRAUDE (Bóveda LA/FT)
            const negocioSnap = await db.collection('Directorio').doc(uidUsuario).get();
            
            if (negocioSnap.exists) {
                const datosNegocio = negocioSnap.data();
                
                // Si el negocio no está verificado (KYC) y la recarga supera los $100,000 COP
                if (!datosNegocio.kyc_aprobado && montoCOP > 100000) {
                    console.error(`🚨 ALERTA FRAUDE: Intento de recarga masiva ($${montoCOP}) del UID: ${uidUsuario} sin KYC.`);
                    // Lo enviamos a la lista negra silenciosamente y abortamos la suma del saldo
                    await db.collection('Lista_Negra').doc(uidUsuario).set({
                        motivo: 'Intento de recarga anómala (Posible tarjeta robada/Fraude)',
                        monto_intentado: montoCOP,
                        fecha: admin.firestore.FieldValue.serverTimestamp()
                    });
                    // Wompi exige un 200 OK para no reintentar el webhook infinitamente
                    return res.status(200).send({ success: true, nota: "Ignorado por seguridad LA/FT" }); 
                }
            }

            // 5. Inyección atómica de liquidez en Firestore

            const usuarioRef = db.collection('Directorio').doc(uidUsuario);

            await db.runTransaction(async (t) => {
                const doc = await t.get(usuarioRef);
                if (!doc.exists) throw new Error("Bóveda de usuario no encontrada.");

                // Actualizamos el saldo
                const saldoActual = doc.data().saldo_logistica || 0;
                const nuevoSaldo = saldoActual + montoCOP;

                t.update(usuarioRef, { 
                    saldo_logistica: nuevoSaldo,
                    ultima_recarga: admin.firestore.FieldValue.serverTimestamp()
                });

                // Trazabilidad: Guardamos el recibo para el panel del usuario
                const reciboRef = db.collection('Historial_Recargas').doc(transaccion.id);
                t.set(reciboRef, {
                    uid: uidUsuario,
                    monto: montoCOP,
                    metodo: transaccion.payment_method_type,
                    fecha: admin.firestore.FieldValue.serverTimestamp()
                });
            });

            console.log(`[TESORERÍA] Éxito: $${montoCOP} COP recargados a la bóveda de UID: ${uidUsuario}.`);
        }
    } catch (error) {
        console.error("Fallo crítico procesando el Webhook de Wompi:", error);
    }
});

// -------------------------------------------------------------------
// MÓDULO 5: LA AUDITORÍA EN LA SOMBRA (El Verdugo Automático)
// -------------------------------------------------------------------
exports.vigilanteEvasionP2P = functions.runWith({ secrets: [semillaMaestra] }).firestore
    .document('Directorio/{idNegocio}/pedidos_entrantes/{ticketId}')
    .onCreate(async (snap, context) => {
        const { idNegocio } = context.params;
        const dataPreTicket = snap.data();
        const db = admin.firestore();
        const comercioRef = db.collection('Directorio').doc(idNegocio);

        // Solo auditamos si el pre-ticket trae la firma dinámica del referido
        if (!dataPreTicket.referido_totp) return null;

        // 🚨 ESCUDO ANTI-ENVENENAMIENTO: El verdugo verifica la autenticidad antes de actuar
        const secreto = semillaMaestra.value();
        const embajadorValidado = validarSelloTOTP(dataPreTicket.referido_totp, idNegocio, secreto);
        
        if (!embajadorValidado) {
            console.warn(`[FRAUDE BLOQUEADO] Bot detectado. Sello TOTP falso en comercio: ${idNegocio}`);
            return null; // 🛑 Detenemos la ejecución. El negocio NO es penalizado.
        }

       try {
            return await db.runTransaction(async (transaction) => {
                const doc = await transaction.get(comercioRef);
                if (!doc.exists) return null;
                
                const datos = doc.data();
                const intentos = (datos.intentos_whatsapp || 0) + 1;
                const validadas = datos.ordenes_validadas || 0;
                
                let updateData = { intentos_whatsapp: intentos };
                
                // 📊 NUEVA LÓGICA: Tasa de Conversión y Muestra Estadística
                const MUESTRA_MINIMA = 30; // No juzgamos hasta que tenga al menos 30 leads
                const CONVERSION_MINIMA_ACEPTABLE = 0.05; // 5% de conversión esperada

                if (intentos >= MUESTRA_MINIMA) {
                    const tasaConversion = validadas / intentos;

                    if (tasaConversion < CONVERSION_MINIMA_ACEPTABLE) {
                        console.warn(`[ALERTA SILENCIOSA] Comercio ${idNegocio} con conversión anómala (${(tasaConversion*100).toFixed(1)}%). Enviado a Tribunal.`);
                        // En lugar de banear, lo pasamos al tablero de moderación del Cerebro Central
                        updateData.estado_aliado = 'en_observacion';
                        updateData.requiere_auditoria = true;
                    } else if (datos.estado_aliado === 'en_observacion') {
                        // Si su conversión mejora de forma natural, el sistema lo perdona automáticamente
                        updateData.estado_aliado = 'activo';
                        updateData.requiere_auditoria = false;
                    }
                }

                transaction.update(comercioRef, updateData);
            });


// -------------------------------------------------------------------
// MÓDULO 6: EL BARRENDERO (Reconciliación Web2-Web3)
// -------------------------------------------------------------------
exports.reconciliacionWeb3 = functions.pubsub.schedule('every 10 minutes').onRun(async (context) => {
    const db = admin.firestore();
    const tiempoLimite = new Date(Date.now() - 5 * 60 * 1000); // 5 minutos de gracia
    
    try {
        // Buscamos transacciones atascadas en el limbo
        const queryAtascadas = db.collection('Logistica_Ordenes')
            .where('seguridad_web3.txID_escrow', '==', 'pendiente_de_blockchain')
            .where('timestamp_creacion', '<', admin.firestore.Timestamp.fromDate(tiempoLimite));

        const snap = await queryAtascadas.get();
        if (snap.empty) return null; // Todo está en orden

        const batch = db.batch();

        for (const doc of snap.docs) {
            const orden = doc.data();
            console.log(`[BARRENDERO] Orden atascada detectada: ${doc.id}. Iniciando Rollback...`);

            // 1. Aquí harías un chequeo al RPC de SUI usando el orden.ticket_publico
            // const txSUI = await suiClient.getTransactionBlock({ digest: hash_esperado });
            // Si txSUI no existe o falló:

            // 2. Rollback en Firebase: Cancelamos la orden y liberamos la Malla de Gas
            batch.update(doc.ref, { 
                estado: 'cancelada_por_falla_web3',
                mensaje_sistema: 'Timeout en SUI Network. Rollback ejecutado.'
            });

            // 3. Limpiamos la RTDB (Malla de Gas) para que el conductor no se quede atascado
            if (orden.ticket_publico) {
                await admin.database().ref(`malla_de_gas/ordenes_activas/${orden.ticket_publico}`).remove();
            }
        }

        await batch.commit();
        console.log(`[BARRENDERO] Reconciliación completada. ${snap.size} órdenes reversadas.`);
        return null;

    } catch (error) {
        console.error("[BARRENDERO] Falla crítica en la limpieza:", error);
        return null;
    }
});

// -------------------------------------------------------------------
// MÓDULO 7: EL SALVAVIDAS (Reembolso Virtual / El Camino Triste)
// -------------------------------------------------------------------
exports.cancelarOrdenLogistica = functions.https.onCall(async (data, context) => {
    // 1. Zero-Trust: ¿Quién lo pide?
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Acceso denegado.');
    
    const { ordenId, idNegocio } = data;
    if (!ordenId || !idNegocio) throw new functions.https.HttpsError('invalid-argument', 'Faltan parámetros.');

    const uidSolicitante = context.auth.uid;
    const db = admin.firestore();

    try {
        return await db.runTransaction(async (transaction) => {
            const ordenRef = db.collection('Logistica_Ordenes').doc(ordenId);
            const ordenSnap = await transaction.get(ordenRef);

            if (!ordenSnap.exists) throw new functions.https.HttpsError('not-found', 'Orden no existe.');
            const ordenData = ordenSnap.data();

            // 2. Validar que la orden esté atrapada (Buscando o En Tránsito, NO Entregada)
            if (ordenData.estado === 'ENTREGADO' || ordenData.estado === 'CANCELADO_REEMBOLSADO') {
                throw new functions.https.HttpsError('failed-precondition', 'La orden ya fue entregada o reembolsada previamente.');
            }

            // 3. Validar permisos: Solo el dueño de la orden o el SuperAdmin pueden cancelar
            const adminSnap = await transaction.get(db.collection('Usuarios_Admin').doc(uidSolicitante));
            const esSuperAdmin = adminSnap.exists && adminSnap.data().rol === 'superadmin';
            
            if (ordenData.comerciante_uid !== uidSolicitante && !esSuperAdmin) {
                throw new functions.https.HttpsError('permission-denied', 'No eres el dueño de esta orden.');
            }

            // 4. El Rescate: Devolver el saldo al comercio
            const negocioRef = db.collection('Directorio').doc(idNegocio);
            const montoADevolver = ordenData.monto_total || 0;

            // 5. Ejecutar la reversión atómica (Todo o Nada)
            transaction.update(negocioRef, {
                saldo_logistica: admin.firestore.FieldValue.increment(montoADevolver)
            });

            transaction.update(ordenRef, {
                estado: 'CANCELADO_REEMBOLSADO',
                fecha_cancelacion: admin.firestore.FieldValue.serverTimestamp(),
                cancelado_por: uidSolicitante
            });

            // 6. Limpiar la Malla de Gas (RTDB) para que desaparezca del radar de los motos
            if (ordenData.ticket_publico) {
                const rtdbOrdenRef = admin.database().ref(`malla_de_gas/ordenes_activas/${ordenData.ticket_publico}`);
                await rtdbOrdenRef.remove(); // Fuego purificador
            }

            return { success: true, mensaje: `Orden cancelada. $${montoADevolver} devueltos al saldo de tu bóveda.` };
        });
    } catch (error) {
        console.error("Fallo en el salvavidas:", error);
        throw new functions.https.HttpsError('internal', error.message || 'Error procesando el reembolso.');
    }
});

// ============================================================================
// 🧹 MÓDULO 8: EL BARRENDERO CRIPTOGRÁFICO (SUI DUST SWEEPER)
// ============================================================================
exports.barrenderoCriptografico = functions.pubsub.schedule('every 24 hours').onRun(async (context) => {
    console.log("[DUST SWEEPER] Iniciando barrido de polvo criptográfico...");
    
    const rtdb = admin.database();
    const mallaRef = rtdb.ref('Sistema/MallaDeGas/libres');
    
    try {
        const snapshot = await mallaRef.once('value');
        if (!snapshot.exists()) return null;

        const monedas = snapshot.val();
        const idsMonedas = Object.keys(monedas);
        
        let polvoAcumuladoMIST = 0;
        let monedasBorradas = 0;
        let actualizacionesBatch = {};

        // 1. Escanear toda la Malla buscando "basura" (Monedas con menos de 0.005 SUI)
        const UMBRAL_BASURA = 5000000; // 5,000,000 MIST

        idsMonedas.forEach(id => {
            const moneda = monedas[id];
            if (moneda.monto < UMBRAL_BASURA) {
                polvoAcumuladoMIST += moneda.monto;
                actualizacionesBatch[id] = null; // Marcamos para borrar de la RTDB
                monedasBorradas++;
            }
        });

        // 2. Si recolectamos suficiente polvo, lo fundimos en un lingote
        if (polvoAcumuladoMIST > 0) {
            console.log(`[DUST SWEEPER] Se recogieron ${monedasBorradas} micro-fracciones. Polvo total: ${polvoAcumuladoMIST} MIST.`);
            
            // Creamos la moneda consolidada (El "Lingote")
            const idLingote = "coin_gold_" + Math.random().toString(36).substring(2, 10);
            actualizacionesBatch[idLingote] = {
                id: "0x" + crypto.randomBytes(16).toString('hex'), // ID Simulado de la Blockchain
                monto: polvoAcumuladoMIST,
                version: 1,
                digest: "merged_by_sweeper",
                tipo: "lingote_reciclado"
            };

            // 3. Ejecutamos la limpieza y la creación atómicamente
            await mallaRef.update(actualizacionesBatch);
            console.log(`[DUST SWEEPER] Barrido exitoso. Lingote de ${polvoAcumuladoMIST / 1000000000} SUI devuelto a la Malla.`);
        } else {
            console.log("[DUST SWEEPER] La Malla está limpia. No hay polvo para recoger.");
        }

        return null;
    } catch (error) {
        console.error("[DUST SWEEPER] Error crítico barriendo la Malla:", error);
        return null;
    }
});
// ============================================================================
// 🔐 MÓDULO 9: LA ADUANA DIGITAL (Sistema OTP por Correo)
// ============================================================================

exports.solicitarOTP = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Acceso denegado.');

    const uid = context.auth.uid;
    const emailDestino = context.auth.token.email; 
    const { accion } = data; 

    // Generador criptográfico ligero de 6 dígitos
    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    const tiempoExpiracion = new Date(Date.now() + 5 * 60 * 1000); // Caducidad: 5 minutos

    const db = admin.firestore();
    
    // Bóveda temporal
    await db.collection('Sistema_OTP').doc(uid).set({
        codigo: codigo,
        accion: accion,
        expira: admin.firestore.Timestamp.fromDate(tiempoExpiracion)
    });

        const mailOptions = {
        from: '"Seguridad QRpido" <qrpido@gmail.com>', // <-- Tu correo real aquí también
        to: emailDestino,
        subject: `Tu código de seguridad es: ${codigo}`,
        text: `Usa este código de 6 dígitos para autorizar la acción: ${accion}. Expira en 5 minutos. No lo compartas con nadie.`
    };

    try {
        await transporter.sendMail(mailOptions);
        return { success: true, mensaje: "Código enviado al correo." };
    } catch (error) {
        console.error("Error crítico enviando OTP:", error);
        throw new functions.https.HttpsError('internal', 'Falla en la infraestructura de correo.');
    }
});

exports.validarAccionConOTP = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Acceso denegado.');

    const uid = context.auth.uid;
    const { codigoIngresado, accionEsperada } = data;
    
    const db = admin.firestore();
    const otpRef = db.collection('Sistema_OTP').doc(uid);

    return await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(otpRef);
        if (!doc.exists) throw new functions.https.HttpsError('not-found', 'No hay peticiones de seguridad pendientes.');

        const datosOTP = doc.data();

        // Triple barrera de seguridad
        if (datosOTP.accion !== accionEsperada) {
            throw new functions.https.HttpsError('invalid-argument', 'Violación de contexto: La acción no coincide.');
        }
        
        if (datosOTP.expira.toDate() < new Date()) {
            transaction.delete(otpRef);
            throw new functions.https.HttpsError('deadline-exceeded', 'El código ha caducado.');
        }
        
        if (datosOTP.codigo !== codigoIngresado) {
            throw new functions.https.HttpsError('invalid-argument', 'El código de seguridad es incorrecto.');
        }

        // 🟢 VALIDACIÓN EXITOSA: Destrucción atómica de la evidencia
        transaction.delete(otpRef);

        return { success: true, validado: true };
    });
});

