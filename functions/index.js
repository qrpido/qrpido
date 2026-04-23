const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { getFullnodeUrl, SuiClient } = require('@mysten/sui/client');
const { defineSecret } = require('firebase-functions/params');

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
    
    const contadorRef = db.collection('Sistema').doc('ContadorBilleteras');
    const userRef = db.collection('Directorio').doc(uid);

    try {
        const indiceSeguro = await db.runTransaction(async (transaction) => {
            const contadorDoc = await transaction.get(contadorRef);
            let actual = 0;
            if (contadorDoc.exists) {
                actual = contadorDoc.data().ultimo_indice || 0;
            }
            const nuevoIndice = actual + 1;
            transaction.set(contadorRef, { ultimo_indice: nuevoIndice }, { merge: true });
            return nuevoIndice;
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
            console.warn(`[ALERTA CRÍTICA] Gas bajo (${suiActual} SUI). Iniciando protocolo de recarga...`);
            
            const db = admin.firestore();
            await db.collection('Sistema').doc('Alertas').set({
                tipo: "gas_bajo",
                balance_actual: suiActual,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
        } else {
            console.log("[VIGILANTE] Tesorería saludable. Gas suficiente para operar.");
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

                // b. Construir el Evento en SUI con la moneda asegurada
                /* const tx = new TransactionBlock();
                // Inyectamos la moneda específica extraída de RTDB para pagar el gas de esta transacción
                tx.setGasPayment([{ 
                    objectId: monedaSuiGas.id, 
                    version: monedaSuiGas.version, 
                    digest: monedaSuiGas.digest 
                }]);

                tx.moveCall({ ... logistica::sellar_transaccion ... });
                const result = await suiClient.signAndExecuteTransactionBlock(...);
                txID_Generado = result.digest;
                
                // c. Reciclaje: Devolver el "vuelto" a RTDB con los nuevos datos de la moneda
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
            transaction.update(ordenRef, {
                estado: 'entregado',
                'seguridad_web3.intentos_fallidos': 0, // Reseteamos strikes
                'seguridad_web3.txID_pago': txID_Generado,
                desglose_pago: {
                    comision_red: comisionPlataforma,
                    ganancia_domiciliario: pagoDomiciliario
                },
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

exports.crearOrdenLogistica = functions.https.onCall(async (data, context) => {
    // 1. Escudo Web2: Solo usuarios autenticados pueden crear órdenes
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión para crear una orden.');
    }

    const uidComerciante = context.auth.uid;
    const { domiciliario_uid, monto_total } = data; // Datos enviados desde agenda.html

    // Validación básica de datos de entrada
    if (!domiciliario_uid || !monto_total || monto_total <= 0) {
         throw new functions.https.HttpsError('invalid-argument', 'Datos de orden incompletos o inválidos.');
    }

    const db = admin.firestore();

    try {
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

            // 5. Inyección atómica de liquidez en Firestore
            const db = admin.firestore();
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
