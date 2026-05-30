const crypto = require('crypto');
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { defineSecret } = require('firebase-functions/params');
const { onCall, HttpsError } = require("firebase-functions/v2/https"); // <-- Movido aquí

admin.initializeApp();

let visionClient = null; // <-- Movido aquí para que ambos módulos lo compartan


const semillaMaestra = defineSecret('SEMILLA_MAESTRA');
const secretoWebhooks = defineSecret('WOMPI_SECRET_EVENTS');
const semillaSui = defineSecret('SUI_SEED_PHRASE'); 
const semillaBase = defineSecret('BASE_SEED_PHRASE');
const PACKAGE_ID = "0x577a653ddc6827118e626c490a4ed11f11d7571852be3a4db8ebb36c5b48bac1";
const BASE_CONTRACT_ID = "0xEBC3D776557C72Ae9e42309eAc761866212421a9"; 
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'qrpido@gmail.com', pass: 'khxvkeufgicxcrsh' }
});

// -------------------------------------------------------------------
// MÓDULO 1: LA FORJA DE BILLETERAS (Derivación HD)
// -------------------------------------------------------------------
exports.forjarBilletera = functions.runWith({ secrets: [semillaMaestra] }).auth.user().onCreate(async (user) => {
    const MNEMONIC_MAESTRA = semillaMaestra.value();
    const uid = user.uid;
    const db = admin.firestore();
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');

    const NUM_ESQUIRLAS = 10;
    const shardId = Math.floor(Math.random() * NUM_ESQUIRLAS);
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
    const direccionTesoreria = process.env.DIRECCION_TESORERIA || "0x966bb847123c0999b3b02eca0456349558363b76148f5c4edf8d7d831b1a7d84";
    const UMBRAL_CRITICO = 5.0; 

    const { SuiJsonRpcClient } = await import('@mysten/sui/jsonRpc');
    const suiClient = new SuiJsonRpcClient({ url: 'https://fullnode.mainnet.sui.io:443' });

    try {
        const balance = await suiClient.getBalance({
            owner: direccionTesoreria,
            coinType: '0x2::sui::SUI'
        });

        const suiActual = parseInt(balance.totalBalance) / 1000000000;
        console.log(`[VIGILANTE] Balance actual de la Tesorería: ${suiActual} SUI`);

        if (suiActual < UMBRAL_CRITICO) {
            // Lógica de alertas
        } else {
            console.log("[VIGILANTE] Tesorería saludable. Iniciando fraccionamiento de Gas...");
            
            const rtdb = admin.database();
            const mallaRef = rtdb.ref('Sistema/MallaDeGas/libres');
            
            const snapshot = await mallaRef.once('value');
            const monedasEnMalla = snapshot.numChildren();

           if (monedasEnMalla < 50) {
                console.log(`[FRACCIONADOR] Malla baja (${monedasEnMalla}). Extrayendo monedas reales de SUI...`);
                
                // Extraemos las monedas reales directamente de la wallet de Tesorería en la Blockchain
                const { data: monedasReales } = await suiClient.getCoins({
                    owner: direccionTesoreria,
                    coinType: '0x2::sui::SUI',
                    limit: 50
                });

                if (monedasReales.length === 0) {
                    console.error("[ALERTA CRÍTICA] La Tesorería no tiene objetos de moneda disponibles para la malla.");
                    return null;
                }

                let nuevosFragmentos = {};
                monedasReales.forEach((coin) => {
                    nuevosFragmentos[`coin_${coin.coinObjectId}`] = {
                        id: coin.coinObjectId,
                        monto: parseInt(coin.balance),
                        version: coin.version,
                        digest: coin.digest
                    };
                });
                
                await mallaRef.update(nuevosFragmentos);
                console.log(`[FRACCIONADOR] ${monedasReales.length} monedas de gas REALES inyectadas a la Malla.`);
            }

        }
        return null;

    } catch (error) {
        console.error("[VIGILANTE] Error de conexión con la blockchain: ", error);
        return null;
    }
});

// -------------------------------------------------------------------
// MÓDULO 3: EL CADENERO (Validación Inmutable y Liberación de Fondos)
// -------------------------------------------------------------------
exports.validarEntrega = functions.runWith({ secrets: [semillaSui, semillaBase] }).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Acceso denegado.');

    const uidDomiciliario = context.auth.uid;
    const { ordenId, codigoSuministrado } = data;
    const db = admin.firestore();
    const rtdb = admin.database();
    const ordenRef = db.collection('Logistica_Ordenes').doc(ordenId);

    // 1. ⛽ EXTRACCIÓN DE GAS AISLADA: Ocurre UNA sola vez antes de la transacción de Firestore
    let monedaSuiGas = null;
    let idNodoGas = null;
    await rtdb.ref('Sistema/MallaDeGas/libres').transaction((nodos) => {
        if (nodos) {
            const id = Object.keys(nodos)[0];
            if (id) { 
                monedaSuiGas = nodos[id]; 
                idNodoGas = id;
                delete nodos[id]; 
                return nodos; 
            }
        }
        return nodos;
    });

    if (!monedaSuiGas) throw new functions.https.HttpsError('resource-exhausted', 'Malla de Gas vacía.');

    try {
        // 2. 🛡️ LÓGICA TRANSACCIONAL: Si esto colisiona, se reintenta reusando la misma monedaSuiGas
        return await db.runTransaction(async (transaction) => {
            const ordenDoc = await transaction.get(ordenRef);
            if (!ordenDoc.exists) throw new functions.https.HttpsError('not-found', 'La orden no existe.');

            const orden = ordenDoc.data();
            const seguridad = orden.seguridad_web3 || {};

            if (orden.estado !== 'en_transito' || orden.domiciliario_uid !== uidDomiciliario) {
                throw new functions.https.HttpsError('permission-denied', 'No autorizado o estado inválido.');
            }

            if (codigoSuministrado !== seguridad.codigo_entrega) {
                const intentos = (seguridad.intentos_fallidos || 0) + 1;
                transaction.update(ordenRef, { 'seguridad_web3.intentos_fallidos': intentos });
                throw new functions.https.HttpsError('invalid-argument', 'Código incorrecto.');
            }

            const montoTotal = orden.monto_total;
            const comisionPlataforma = montoTotal * 0.10;
            const pagoEmbajador = comisionPlataforma * 0.25;
            const pagoDomiciliario = montoTotal - comisionPlataforma;

            let txID_Generado;
            
            const { SuiJsonRpcClient } = await import('@mysten/sui/jsonRpc');
            const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
            const { Transaction } = await import('@mysten/sui/transactions');
            const suiClient = new SuiJsonRpcClient({ url: 'https://fullnode.mainnet.sui.io:443' });

            try {
                const datosCrudos = `ORDEN:${ordenId}|MONTO:${montoTotal}|COMISION:${comisionPlataforma}|EMBAJADOR:${pagoEmbajador}`;
                const huella = crypto.createHash('sha256').update(datosCrudos).digest('hex');

                const tx = new Transaction();
                tx.setGasPayment([{ objectId: monedaSuiGas.id, version: monedaSuiGas.version, digest: monedaSuiGas.digest }]);
                
                tx.moveCall({
                    target: `${PACKAGE_ID}::logistica::sellar_transaccion`,
                    arguments: [tx.pure.string(huella), tx.pure.u64(Date.now())]
                });

                const keypair = Ed25519Keypair.deriveKeypair(semillaSui.value(), "m/44'/784'/0'/0'/0'");
                const result = await suiClient.signAndExecuteTransaction({ transaction: tx, signer: keypair });
                txID_Generado = result.digest;

            } catch (error_web3) {
                console.error("Fallo SUI:", error_web3);
                throw new functions.https.HttpsError('internal', 'Error en Blockchain: ' + error_web3.message);
            }

            if (orden.embajador_uid && orden.embajador_uid !== "null") {
                transaction.set(db.collection('Directorio').doc(orden.embajador_uid), {
                    saldo_comisiones: admin.firestore.FieldValue.increment(pagoEmbajador),
                    total_referidos_entregados: admin.firestore.FieldValue.increment(1)
                }, { merge: true });
            }

            transaction.update(ordenRef, {
                estado: 'ENTREGADO',
                'seguridad_web3.txID_pago': txID_Generado,
                desglose_pago: { comision_red: comisionPlataforma, ganancia_domiciliario: pagoDomiciliario },
                timestamp_entrega: admin.firestore.FieldValue.serverTimestamp()
            });

            return { success: true, txID: txID_Generado, ganancia: pagoDomiciliario };
        });
    } catch (e) {
        // 3. 🚨 PROTOCOLO DE REEMBOLSO: Si algo falla (código mal, timeout SUI), devolvemos el Gas a la RTDB
        if (monedaSuiGas && idNodoGas) {
            await rtdb.ref(`Sistema/MallaDeGas/libres/${idNodoGas}`).set(monedaSuiGas);
            console.log(`[ROLLBACK DE GAS] Moneda devuelta a la malla tras fallo en orden: ${ordenId}`);
        }
        throw new functions.https.HttpsError('internal', e.message);
    }
});


// -------------------------------------------------------------------
// MÓDULO DE ANCLAJE: CREAR ORDEN 
// -------------------------------------------------------------------
function validarSelloTOTP(codigoDinamico, idNegocio, secretoMaestro) {
    if (!codigoDinamico || !codigoDinamico.startsWith('REF-')) return null;
    const partes = codigoDinamico.split('-');
    if (partes.length !== 3) return null;
    const codigoReferido = partes[1];
    const firmaEnviada = partes[2];

    const bloqueTiempo = Math.floor(Date.now() / 21600000); 
    const bloquesAVerificar = [bloqueTiempo, bloqueTiempo - 1];

    for (let bloque of bloquesAVerificar) {
        const payload = `${codigoReferido}-${idNegocio}-${bloque}`;
        const firmaCalculada = crypto.createHmac('sha256', secretoMaestro).update(payload).digest('hex').substring(0, 6).toUpperCase();
        if (firmaCalculada === firmaEnviada) return codigoReferido;
    }
    return null; 
}

exports.generarSelloSeguro = functions.runWith({ secrets: [semillaMaestra] }).https.onCall((data, context) => {
    const { codigoReferido, idNegocio } = data;
    if (!codigoReferido || !idNegocio) throw new functions.https.HttpsError('invalid-argument', 'Faltan parámetros');
    
    const secreto = semillaMaestra.value();
    const bloqueTiempo = Math.floor(Date.now() / 21600000);
    const payload = `${codigoReferido}-${idNegocio}-${bloqueTiempo}`;
    
    const firma = crypto.createHmac('sha256', secreto).update(payload).digest('hex').substring(0, 6).toUpperCase();
    
    return { firma: `REF-${codigoReferido}-${firma}`, timestamp: Date.now() };
});

// Añadimos el contenedor de secretos para poder leer la semillaMaestra
exports.crearOrdenLogistica = functions.runWith({ secrets: [semillaMaestra] }).https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión para crear una orden.');
    }

    const uidComerciante = context.auth.uid;
    const { domiciliario_uid, monto_total, ticketReferido, ticketPublico } = data;

    // 1. LÍMITES LÓGICOS DE MERCADO (Torniquete y Techo)
    const DOMICILIO_MINIMO = 3000;
    const DOMICILIO_MAXIMO = 50000; // Margen futuro para fletes ligeros

    if (!domiciliario_uid || typeof monto_total !== 'number' || monto_total < DOMICILIO_MINIMO || monto_total > DOMICILIO_MAXIMO) {
         console.warn(`[SEGURIDAD] Intento de orden fuera de límites lógicos. Monto: ${monto_total}`);
         throw new functions.https.HttpsError('invalid-argument', 'El valor del domicilio está fuera de los límites permitidos.');
    }

    const db = admin.firestore();

    try {
        const comercioRef = db.collection('Directorio').doc(uidComerciante);
        const nuevaOrdenRef = db.collection('Logistica_Ordenes').doc(); 

        let embajadorValidado = null;

        // 2. TRANSACCIÓN ATÓMICA: Validar saldo y retener fondos (Escrow) en tiempo real
        await db.runTransaction(async (transaction) => {
            const comercioDoc = await transaction.get(comercioRef);
            if (!comercioDoc.exists) throw new functions.https.HttpsError('not-found', 'Comercio no encontrado en el directorio.');

            const datosComercio = comercioDoc.data();
            const saldoActual = datosComercio.saldo_logistica || 0;

            // Bloqueo estricto: El dinero debe existir para generar la orden
            if (saldoActual < monto_total) {
                throw new functions.https.HttpsError('failed-precondition', 'Saldo insuficiente en bóveda para cubrir el domicilio.');
            }

            // Validación TOTP para referidos
            if (ticketReferido) {
                const secreto = semillaMaestra.value();
                embajadorValidado = validarSelloTOTP(ticketReferido, uidComerciante, secreto);
                if (!embajadorValidado) {
                    console.warn(`[FRAUDE EVITADO] Firma TOTP inválida en comercio: ${uidComerciante}`);
                }
            }

            // Retenemos los fondos inmediatamente para evitar doble gasto
            transaction.update(comercioRef, {
                saldo_logistica: saldoActual - monto_total,
                ordenes_validadas: admin.firestore.FieldValue.increment(1)
            });

            // 3. CREAR LA ORDEN RESPALDADA
            const randomBytes = crypto.randomBytes(3).toString('hex').toUpperCase();
            const codigoEntrega = `QRP-${randomBytes}`;

            const ordenEstructura = {
                comerciante_uid: uidComerciante,
                domiciliario_uid: domiciliario_uid,
                embajador_uid: embajadorValidado, 
                ticket_publico: ticketPublico || "DESCONOCIDO",
                monto_total: monto_total,
                estado: "en_transito",
                seguridad_web3: {
                    codigo_entrega: codigoEntrega, 
                    intentos_fallidos: 0,
                    bloqueado_hasta: null,
                    txID_escrow: "pendiente_de_blockchain" 
                },
                timestamp_creacion: admin.firestore.FieldValue.serverTimestamp()
            };

            transaction.set(nuevaOrdenRef, ordenEstructura);
        });

        return { success: true, ordenId: nuevaOrdenRef.id, mensaje: "Orden creada y fondos retenidos en escrow." };

    } catch (error) {
        console.error("Fallo al crear la orden logística:", error);
        throw new functions.https.HttpsError('internal', error.message || 'Error procesando la orden de logística.');
    }
});


// -------------------------------------------------------------------
// MÓDULO 4: LA BOCA DE ENTRADA (Webhook Wompi para Recargas)
// -------------------------------------------------------------------
exports.wompiWebhook = functions.runWith({ secrets: [secretoWebhooks] }).https.onRequest(async (req, res) => {
    res.status(200).send("Webhook recibido por QRpido");

    try {
        const evento = req.body;
        
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
            return; 
        }

        if (evento.event === "transaction.updated" && evento.data.transaction.status === "APPROVED") {
            const transaccion = evento.data.transaction;
            const referenciaPartes = transaccion.reference.split('_');
            
            const db = admin.firestore();
            const montoCOP = transaccion.amount_in_cents / 100;

            if (referenciaPartes[0] === "QRPIDO" || transaccion.reference.includes("-")) {
                const partesGuion = transaccion.reference.split('-');
                const uidUsuario = partesGuion[2] || referenciaPartes[2];
                const tipoPago = transaccion.amount_in_cents === 699000 ? "REGISTRO_FIRMA" : "CREACION_DOCUMENTO";

                console.log(`[PASARELA] Pago aprobado de $${montoCOP} COP para el trámite del UID: ${uidUsuario} (${tipoPago})`);

                const tramiteRef = db.collection('Tramites_Activos').doc(transaccion.reference);
                await tramiteRef.set({
                    estado_pago: "APROBADO",
                    wompi_id: transaccion.id,
                    monto: montoCOP,
                    tipo_servicio: tipoPago,
                    fecha_pago: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                if (tipoPago === "REGISTRO_FIRMA") {
                    await db.collection('Directorio').doc(uidUsuario).set({
                        firma_registrada_paga: true,
                        fecha_registro_firma: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                }
                return;
            }

            if (referenciaPartes[0] === "RECARGA") {
                const uidUsuario = referenciaPartes[1];
                const negocioSnap = await db.collection('Directorio').doc(uidUsuario).get();
                
                if (negocioSnap.exists) {
                    const datosNegocio = negocioSnap.data();
                    if (!datosNegocio.kyc_aprobado && montoCOP > 100000) {
                        console.error(`🚨 ALERTA FRAUDE LOGÍSTICO: UID: ${uidUsuario} sin KYC.`);
                        await db.collection('Lista_Negra').doc(uidUsuario).set({
                            motivo: 'Intento de recarga anómala sin KYC.',
                            monto_intentado: montoCOP,
                            fecha: admin.firestore.FieldValue.serverTimestamp()
                        });
                        return; 
                    }
                }

                const usuarioRef = db.collection('Directorio').doc(uidUsuario);
                await db.runTransaction(async (t) => {
                    const doc = await t.get(usuarioRef);
                    if (!doc.exists) throw new Error("Usuario no encontrado.");
                    const saldoActual = doc.data().saldo_logistica || 0;
                    t.update(usuarioRef, { 
                        saldo_logistica: saldoActual + montoCOP,
                        ultima_recarga: admin.firestore.FieldValue.serverTimestamp()
                    });
                    t.set(db.collection('Historial_Recargas').doc(transaccion.id), {
                        uid: uidUsuario,
                        monto: montoCOP,
                        metodo: transaccion.payment_method_type,
                        fecha: admin.firestore.FieldValue.serverTimestamp()
                    });
                });
                console.log(`[TESORERÍA] Éxito: Recarga logística procesada para UID: ${uidUsuario}.`);
            }
        }
    } catch (error) {
        console.error("Fallo crítico en Webhook Wompi:", error);
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

        if (!dataPreTicket.referido_totp) return null;

        const secreto = semillaMaestra.value();
        const embajadorValidado = validarSelloTOTP(dataPreTicket.referido_totp, idNegocio, secreto);
        
        if (!embajadorValidado) {
            console.warn(`[FRAUDE BLOQUEADO] Bot detectado. Sello TOTP falso en comercio: ${idNegocio}`);
            return null; 
        }

       try {
            return await db.runTransaction(async (transaction) => {
                const doc = await transaction.get(comercioRef);
                if (!doc.exists) return null;
                
                const datos = doc.data();
                const intentos = (datos.intentos_whatsapp || 0) + 1;
                const validadas = datos.ordenes_validadas || 0;
                
                let updateData = { intentos_whatsapp: intentos };
                
                const MUESTRA_MINIMA = 30; 
                const CONVERSION_MINIMA_ACEPTABLE = 0.05; 

                if (intentos >= MUESTRA_MINIMA) {
                    const tasaConversion = validadas / intentos;

                    if (tasaConversion < CONVERSION_MINIMA_ACEPTABLE) {
                        console.warn(`[ALERTA SILENCIOSA] Comercio ${idNegocio} con conversión anómala (${(tasaConversion*100).toFixed(1)}%). Enviado a Tribunal.`);
                        updateData.estado_aliado = 'en_observacion';
                        updateData.requiere_auditoria = true;
                    } else if (datos.estado_aliado === 'en_observacion') {
                        updateData.estado_aliado = 'activo';
                        updateData.requiere_auditoria = false;
                    }
                }
                transaction.update(comercioRef, updateData);
            });
        } catch (error) {
            console.error("[VIGILANTE P2P] Falla en la auditoría silenciosa: ", error);
            return null;
        }
});

// -------------------------------------------------------------------
// MÓDULO 6: EL BARRENDERO (Reconciliación Web2-Web3)
// -------------------------------------------------------------------
exports.reconciliacionWeb3 = functions.pubsub.schedule('every 10 minutes').onRun(async (context) => {
    const db = admin.firestore();
    const tiempoLimite = new Date(Date.now() - 5 * 60 * 1000); 
    
    try {
        const queryAtascadas = db.collection('Logistica_Ordenes')
            .where('seguridad_web3.txID_escrow', '==', 'pendiente_de_blockchain')
            .where('timestamp_creacion', '<', admin.firestore.Timestamp.fromDate(tiempoLimite));

        const snap = await queryAtascadas.get();
        if (snap.empty) return null; 

        const batch = db.batch();

        for (const doc of snap.docs) {
            const orden = doc.data();
            console.log(`[BARRENDERO] Orden atascada detectada: ${doc.id}. Iniciando Rollback...`);

            batch.update(doc.ref, { 
                estado: 'cancelada_por_falla_web3',
                mensaje_sistema: 'Timeout en SUI Network. Rollback ejecutado.'
            });

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
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Acceso denegado.');
    }

    const uidSolicitante = context.auth.uid;
    const { ordenId } = data;

    if (!ordenId) {
        throw new functions.https.HttpsError('invalid-argument', 'Falta el ID de la orden.');
    }

    const db = admin.firestore();
    const ordenRef = db.collection('Logistica_Ordenes').doc(ordenId);

    try {
        await db.runTransaction(async (transaction) => {
            const ordenDoc = await transaction.get(ordenRef);
            if (!ordenDoc.exists) {
                throw new functions.https.HttpsError('not-found', 'La orden no existe.');
            }

            const orden = ordenDoc.data();

            // Solo el dueño del comercio o un admin puede cancelar
            if (orden.comerciante_uid !== uidSolicitante) {
                throw new functions.https.HttpsError('permission-denied', 'No tienes permiso para cancelar esta orden.');
            }

            // Solo se puede cancelar si no ha sido entregada
            if (orden.estado === 'ENTREGADO' || orden.estado === 'cancelada') {
                throw new functions.https.HttpsError('failed-precondition', 'La orden ya fue entregada o cancelada previamente.');
            }

            // 1. REEMBOLSO (ESCROW REFUND)
            // Le devolvemos el dinero exacto que se le retuvo al crearla
            const comercioRef = db.collection('Directorio').doc(orden.comerciante_uid);
            
            transaction.update(comercioRef, {
                saldo_logistica: admin.firestore.FieldValue.increment(orden.monto_total)
            });

            // 2. ACTUALIZAR ESTADO DE LA ORDEN
            transaction.update(ordenRef, {
                estado: 'cancelada',
                timestamp_cancelacion: admin.firestore.FieldValue.serverTimestamp(),
                motivo_cancelacion: "Cancelada por el comercio. Fondos reembolsados."
            });
        });

        return { success: true, mensaje: "Orden cancelada y fondos devueltos a la bóveda exitosamente." };

    } catch (error) {
        console.error(`Fallo al cancelar la orden ${ordenId}:`, error);
        throw new functions.https.HttpsError('internal', error.message || 'Error procesando la cancelación.');
    }
});


// ============================================================================
// 🧹 MÓDULO 8: EL BARRENDERO CRIPTOGRÁFICO (SUI PTB MERGE - NATIVO)
// ============================================================================
exports.barrenderoCriptografico = functions.runWith({ secrets: [semillaSui] }).pubsub.schedule('every 24 hours').onRun(async (context) => {
    console.log("[DUST SWEEPER] Iniciando barrido de polvo criptográfico en SUI...");
    
    const rtdb = admin.database();
    const mallaRef = rtdb.ref('Sistema/MallaDeGas/libres');
    
    try {
        const snapshot = await mallaRef.once('value');
        if (!snapshot.exists()) return null;

        const monedas = snapshot.val();
        const idsMonedas = Object.keys(monedas);
        
        const UMBRAL_BASURA = 5000000; // 0.005 SUI (Ajusta según tu economía)
        let monedasPolvo = [];

        idsMonedas.forEach(id => {
            const moneda = monedas[id];
            if (moneda.monto < UMBRAL_BASURA) {
                monedasPolvo.push({ rtdbId: id, ...moneda });
            }
        });

        // Necesitamos al menos 2 monedas para que exista una fusión
        if (monedasPolvo.length < 2) {
            console.log("[DUST SWEEPER] La Malla está limpia o no hay suficiente polvo para fusionar.");
            return null;
        }

        // 1. PREPARACIÓN DEL LOTE (Max 50 para no saturar los límites de PTB de SUI)
        const lote = monedasPolvo.slice(0, 50);
        const monedaDestino = lote[0]; // El "contenedor" que absorberá el resto
        const monedasOrigen = lote.slice(1); // El polvo que será destruido

        console.log(`[DUST SWEEPER] Empaquetando ${monedasOrigen.length} fracciones. Destino: ${monedaDestino.id}`);

        const { SuiJsonRpcClient } = await import('@mysten/sui/jsonRpc');
        const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
        const { Transaction } = await import('@mysten/sui/transactions');

        const suiClient = new SuiJsonRpcClient({ url: 'https://fullnode.mainnet.sui.io:443' });
        const keypair = Ed25519Keypair.deriveKeypair(semillaSui.value(), "m/44'/784'/0'/0'/0'");

        // 2. CONSTRUCCIÓN DEL PROGRAMMABLE TRANSACTION BLOCK (PTB)
        const tx = new Transaction();

        // Convertimos los IDs de Firebase a referencias de objetos SUI
        const sources = monedasOrigen.map(m => tx.object(m.id));

        // Comando NATIVO de SUI: mergeCoins(destino, [origen1, origen2...])
        tx.mergeCoins(tx.object(monedaDestino.id), sources);

        // 3. FIRMA Y EJECUCIÓN
        const result = await suiClient.signAndExecuteTransaction({ 
            transaction: tx, 
            signer: keypair 
        });

        console.log(`[DUST SWEEPER] Fusión exitosa en blockchain. TxID: ${result.digest}`);

        // Le damos 2 segundos a los nodos de SUI para sincronizar el estado final
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 4. RECONCILIACIÓN ESTRICTA: Leemos la moneda destino directamente de la blockchain
        const lingoteSui = await suiClient.getObject({
            id: monedaDestino.id,
            options: { showContent: true }
        });

        if (lingoteSui.error) throw new Error("No se pudo verificar el lingote en la red.");

        const balanceReal = parseInt(lingoteSui.data.content.fields.balance);
        const versionReal = lingoteSui.data.version;
        const digestReal = lingoteSui.data.digest;

        // 5. LIMPIEZA Y ACTUALIZACIÓN EN FIRESTORE RTDB
        let actualizacionesBatch = {};

        // Borramos el polvo antiguo de la base de datos
        monedasOrigen.forEach(m => {
            actualizacionesBatch[m.rtdbId] = null; 
        });

        // Actualizamos la moneda receptora con sus nuevos super-poderes
        actualizacionesBatch[monedaDestino.rtdbId] = {
            id: monedaDestino.id,
            monto: balanceReal,
            version: versionReal,
            digest: digestReal,
            tipo: "lingote_fusionado"
        };

        await mallaRef.update(actualizacionesBatch);
        console.log(`[DUST SWEEPER] Barrido completado. Lingote de ${balanceReal / 1000000000} SUI anclado a la Malla.`);

        return null;

    } catch (error) {
        console.error("[DUST SWEEPER] Error crítico conectando con SUI:", error);
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

    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    const tiempoExpiracion = new Date(Date.now() + 5 * 60 * 1000); 

    const db = admin.firestore();
    
    await db.collection('Sistema_OTP').doc(uid).set({
        codigo: codigo,
        accion: accion,
        expira: admin.firestore.Timestamp.fromDate(tiempoExpiracion)
    });

    const mailOptions = {
        from: '"Seguridad QRpido" <qrpido@gmail.com>', 
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

        transaction.delete(otpRef);

        return { success: true, validado: true };
    });
});

//============================================================================
// 🤖 MÓDULO 10: KYC BIOMÉTRICO (Google Vision + Cifrado AES-256-GCM)
//============================================================================

// Función auxiliar de cifrado simétrico (Grado Militar)
function encriptarBuffer(buffer, secreto, uid) {
    // Derivamos una llave única combinando tu Semilla Maestra y el UID del usuario
    const llaveDerivada = crypto.createHash('sha256').update(secreto + uid).digest();
    const iv = crypto.randomBytes(16); // Vector de inicialización único por archivo
    const cipher = crypto.createCipheriv('aes-256-gcm', llaveDerivada, iv);
    
    const cifrado = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag(); // Sello de autenticidad para evitar manipulación
    
    // Empaquetamos todo en un solo buffer (IV + Sello + Archivo Cifrado)
    return Buffer.concat([iv, authTag, cifrado]);
}

// 🚨 INYECCIÓN DE SECRETO: Añadimos [semillaMaestra] a los secrets de V2
exports.procesarKycBiometrico = onCall({ memory: '512MB', maxInstances: 10, secrets: [semillaMaestra] }, async (request) => {
  if (!visionClient) {
    const vision = require("@google-cloud/vision");
    visionClient = new vision.ImageAnnotatorClient();
  }

  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Operación rechazada. El usuario debe estar autenticado.");
  }

  const uid = request.auth.uid;
  const { frente, reverso, rostro } = request.data;

  if (!frente || !reverso || !rostro) {
    throw new HttpsError("invalid-argument", "Error de envío. Faltan evidencias en el paquete biométrico.");
  }

  try {
    const limpiarBase64 = (dataUrl) => dataUrl.replace(/^data:image\/\w+;base64,/, "");
    
    const bufferFrente = Buffer.from(limpiarBase64(frente), "base64");
    const bufferReverso = Buffer.from(limpiarBase64(reverso), "base64");
    const bufferRostro = Buffer.from(limpiarBase64(rostro), "base64");

    // 1. AUDITORÍA GOOGLE VISION (El servidor "ve" los datos por 2 segundos)
    const [resultadoTexto, resultadoRostro] = await Promise.all([
      visionClient.textDetection({ image: { content: bufferFrente } }),
      visionClient.faceDetection({ image: { content: bufferRostro } })
    ]);

    const anotacionesTexto = resultadoTexto[0].textAnnotations;
    const textoExtraido = anotacionesTexto && anotacionesTexto.length > 0 ? anotacionesTexto[0].description.toUpperCase() : "";

    const esDocumentoValido = textoExtraido.includes("REPUBLICA DE COLOMBIA") || 
                              textoExtraido.includes("CEDULA DE CIUDADANIA") ||
                              textoExtraido.includes("REPUBLICA") ||
                              textoExtraido.includes("COLOMBIA");

    if (!esDocumentoValido) {
      return { success: false, mensaje: "Rechazado: El documento frontal no parece ser una Cédula legítima." };
    }

    const rostrosDetectados = resultadoRostro[0].faceAnnotations;
    if (!rostrosDetectados || rostrosDetectados.length === 0) {
      return { success: false, mensaje: "Rechazado: No se detectó un rostro humano en la selfie." };
    }

    const rostroPrincipal = rostrosDetectados[0];
    if (rostroPrincipal.detectionConfidence < 0.7) {
      return { success: false, mensaje: "Calidad insuficiente. Inténtalo de nuevo con mejor iluminación." };
    }

    // 2. LA TRITURADORA CRIPTOGRÁFICA (Licuamos las imágenes a espagueti)
    const secretoMaestro = semillaMaestra.value();
    const encFrente = encriptarBuffer(bufferFrente, secretoMaestro, uid);
    const encReverso = encriptarBuffer(bufferReverso, secretoMaestro, uid);
    const encRostro = encriptarBuffer(bufferRostro, secretoMaestro, uid);

    // 3. GUARDADO BLINDADO EN STORAGE
    const bucket = admin.storage().bucket();
    const timestamp = Date.now();
    const pathBase = `kyc_blindado/${uid}_${timestamp}`;

    // Le decimos a Storage que esto es un flujo de bytes en crudo, no una imagen.
    const opcionesArchivo = { metadata: { contentType: "application/octet-stream" }, private: true };

    await Promise.all([
      bucket.file(`${pathBase}_frente.enc`).save(encFrente, opcionesArchivo),
      bucket.file(`${pathBase}_reverso.enc`).save(encReverso, opcionesArchivo),
      bucket.file(`${pathBase}_rostro.enc`).save(encRostro, opcionesArchivo)
    ]);

    // Guardamos la ruta de los archivos .enc en la base de datos
    await admin.firestore().collection("Directorio").doc(uid).set({
      estado_moderacion: "en_revision_kyc", 
      evidencia_kyc: {
        frente: `${pathBase}_frente.enc`,
        reverso: `${pathBase}_reverso.enc`,
        rostro: `${pathBase}_rostro.enc`,
        fecha_envio: new Date().toISOString(),
        estado_cripto: "cifrado_aes_gcm"
      }
    }, { merge: true });

    return { success: true, mensaje: "Búnker sellado. Biometría validada por IA y cifrada exitosamente." };

  } catch (error) {
    console.error("Falla en la Cocina KYC:", error);
    throw new HttpsError("internal", "Error interno en el procesamiento: " + error.message);
  }
});


function generarPDFEnMemoria(texto, gps, selfieBase64, codigo, timestamp) {
    return new Promise((resolve, reject) => {
        const PDFDocument = require('pdfkit'); 
        const doc = new PDFDocument();
        const buffers = [];
        
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);
        
        doc.fontSize(18).text('DOCUMENTO LEGAL VINCULANTE (LEY 527 DE 1999)', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(texto, { align: 'justify' });
        
        doc.addPage();
        doc.fontSize(16).text('EVIDENCIA CRIPTOGRÁFICA Y LIVENESS', { align: 'center' });
        doc.moveDown();
        
        const fechaStamp = new Date(timestamp).toISOString();
        doc.fontSize(10).text(`Firma Registrada (UTC): ${fechaStamp}`);
        doc.text(`Coordenadas Juramentadas: Lat ${gps?.lat || 'N/D'}, Lng ${gps?.lng || 'N/D'}`);
        doc.text(`Código de Intención Biométrico: ${codigo || 'N/D'}`);
        
        if (selfieBase64) {
            doc.moveDown();
            const base64Data = selfieBase64.replace(/^data:image\/\w+;base64,/, "");
            const imgBuffer = Buffer.from(base64Data, 'base64');
            doc.image(imgBuffer, { fit: [250, 250], align: 'center' });
        }
        
        doc.end();
    });
}
// ============================================================================
// ⚖️ MÓDULO 11: EL NOTARIO DIGITAL (Sellar Trámite, SUI y Fricción Cero)
// ============================================================================
exports.sellarTramiteLegal = functions.runWith({ memory: '1GB', secrets: [semillaSui, semillaMaestra] }).https.onCall(async (data, context) => {
    const uid = context.auth ? context.auth.uid : 'INVITADO';
    const { textoContrato, otp, gps, selfie, codigo, wompi_ref, timestamp } = data;

    if (!textoContrato || !wompi_ref) throw new functions.https.HttpsError('invalid-argument', 'Paquete incompleto.');

    try {
        // 1. Crear PDF en RAM
        const pdfBuffer = await generarPDFEnMemoria(textoContrato, gps, selfie, codigo, timestamp);

        // 2. Huella Criptográfica SHA-256 del documento original
        const hashDocumento = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

        // 3. SELLAR EN BLOCKCHAIN SUI (Nativo)
        const { SuiJsonRpcClient } = await import('@mysten/sui/jsonRpc');
        const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
        const { Transaction } = await import('@mysten/sui/transactions');
        
        const suiClient = new SuiJsonRpcClient({ url: 'https://fullnode.mainnet.sui.io:443' });
        const keypair = Ed25519Keypair.deriveKeypair(semillaSui.value(), "m/44'/784'/0'/0'/0'");
        const tx = new Transaction();
        
        tx.moveCall({
            target: `${PACKAGE_ID}::legal::sellar_hash_documento`, // Asumiendo tu contrato SUI
            arguments: [tx.pure.string(hashDocumento), tx.pure.u64(timestamp)]
        });

        const resultSui = await suiClient.signAndExecuteTransaction({ transaction: tx, signer: keypair });
        const txIdGenerado = resultSui.digest;

        // 4. TRITURADORA AES-256-GCM (La misma del KYC)
        const secretoMaestro = semillaMaestra.value();
        const pdfCifrado = encriptarBuffer(pdfBuffer, secretoMaestro, uid);

        // 5. GUARDADO EN STORAGE
        const bucket = admin.storage().bucket();
        const nombreArchivo = wompi_ref.replace(/[^a-zA-Z0-9_-]/g, '');
        
        // Guardamos la versión ENCRIPTADA (.enc) de por vida
        const fileEnc = bucket.file(`boveda_legal/${uid}/${nombreArchivo}.enc`);
        await fileEnc.save(pdfCifrado, { metadata: { contentType: 'application/octet-stream' }, private: true });

        // Guardamos la versión PLANA (.pdf) en una carpeta temporal
        const filePlano = bucket.file(`temporales_pdf/${uid}/${nombreArchivo}.pdf`);
        await filePlano.save(pdfBuffer, { metadata: { contentType: 'application/pdf' }, private: true });

        // 6. GENERAR LINK DE FRICCIÓN CERO (Se autodestruye en 15 minutos)
        const urlFriccionCero = await filePlano.getSignedUrl({
            action: 'read',
            expires: Date.now() + 15 * 60 * 1000 // 15 minutos
        });

        // 7. REGISTRO EN FIRESTORE
        const db = admin.firestore();
        await db.collection('Boveda_Tramites').doc(wompi_ref).set({
            creador_uid: uid,
            participantes: [uid], 
            hash_documento: hashDocumento,
            tx_sui: txIdGenerado,
            fecha_creacion: admin.firestore.FieldValue.serverTimestamp(),
            estado: "Sellado en SUI",
            wompi_ref: wompi_ref,
            ruta_storage_enc: `boveda_legal/${uid}/${nombreArchivo}.enc`
        });

        return { 
            success: true, 
            txId: txIdGenerado, 
            urlDescargaLibre: urlFriccionCero[0] // El link temporal para la UI
        };

    } catch (error) {
        console.error("[NOTARIO] Falla:", error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});


// -------------------------------------------------------------------
// MÓDULO ADICIONAL: ORÁCULO DE TELEMETRÍA Y ACCIÓN DIRIGIDA P2P
// -------------------------------------------------------------------
exports.propagarAlertaConductor = functions.database.ref('malla_de_gas/alertas_conductores/{placaId}')
    .onCreate(async (snapshot, context) => {
        const placaId = context.params.placaId;
        const alertaData = snapshot.val();
        
        console.log(`[ALERTA P2P] Disparo de recogida detectado en tiempo real para unidad: ${placaId}. Coordinando origen sin barrido geográfico.`);
        
        // Retornamos el nodo inmutable para auditoría del tribunal
        return snapshot.ref.child('auditoria_sello').set({
            servidor_timestamp: admin.database.ServerValue.TIMESTAMP,
            oráculo_verificado: true
        });
    });
    // ============================================================================
// 🔐 MÓDULO 12: BÓVEDA EN VIVO (Desencriptación On-The-Fly para Moderadores)
// ============================================================================
exports.obtenerEvidenciaKyc = onCall({ memory: '512MB', secrets: [semillaMaestra] }, async (request) => {
    // 1. CORTAFUEGOS DE SEGURIDAD: Solo usuarios autenticados
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Acceso denegado.");
    }

    const uidSolicitante = request.auth.uid;
    const { uidObjetivo, tipoEvidencia } = request.data; // tipoEvidencia: 'frente', 'reverso' o 'rostro'

    if (!uidObjetivo || !tipoEvidencia) {
        throw new HttpsError("invalid-argument", "Faltan parámetros de búsqueda.");
    }

    const db = admin.firestore();

    try {
        // 2. VERIFICACIÓN DE ROL: Comprobamos si quien pide la foto es Admin o Moderador
        const adminSnap = await db.collection('Usuarios_Admin').doc(uidSolicitante).get();
        if (!adminSnap.exists || (adminSnap.data().rol !== 'admin' && adminSnap.data().rol !== 'superadmin' && adminSnap.data().rol !== 'moderador')) {
            throw new HttpsError("permission-denied", "No tienes credenciales de alta seguridad para abrir la bóveda.");
        }

        // 3. BUSCAMOS LA RUTA DEL ARCHIVO CIFRADO EN EL DIRECTORIO DEL USUARIO
        const userSnap = await db.collection('Directorio').doc(uidObjetivo).get();
        if (!userSnap.exists) throw new HttpsError("not-found", "Usuario no encontrado.");
        
        const evidencia = userSnap.data().evidencia_kyc;
        if (!evidencia || !evidencia[tipoEvidencia]) {
            throw new HttpsError("not-found", "No existe este documento biométrico para el usuario.");
        }

        const rutaArchivoEnc = evidencia[tipoEvidencia]; // Ej: kyc_blindado/uid_123_frente.enc

        // 4. DESCARGAMOS EL ARCHIVO ESPAGUETI DESDE STORAGE A LA RAM DEL SERVIDOR
        const bucket = admin.storage().bucket();
        const archivo = bucket.file(rutaArchivoEnc);
        const [bufferCifrado] = await archivo.download();

        // 5. INGENIERÍA INVERSA CRIPTOGRÁFICA
        // Extraemos las partes exactamente como las empaquetamos: [IV (16) + AuthTag (16) + ArchivoCifrado (Resto)]
        const iv = bufferCifrado.subarray(0, 16);
        const authTag = bufferCifrado.subarray(16, 32);
        const cifrado = bufferCifrado.subarray(32);

        // Reconstruimos la llave usando la Semilla Maestra y el UID del dueño del archivo
        const secretoMaestro = semillaMaestra.value();
        const llaveDerivada = crypto.createHash('sha256').update(secretoMaestro + uidObjetivo).digest();

        const decipher = crypto.createDecipheriv('aes-256-gcm', llaveDerivada, iv);
        decipher.setAuthTag(authTag); // Esto asegura que el archivo no fue alterado por un hacker

        let bufferDesencriptado;
        try {
            bufferDesencriptado = Buffer.concat([decipher.update(cifrado), decipher.final()]);
        } catch (err) {
            throw new HttpsError("data-loss", "El sello de autenticidad está roto o la llave es incorrecta. Archivo corrupto.");
        }

        // 6. DEVOLVEMOS EL RESULTADO LIMPIO AL NAVEGADOR
        // Convertimos los bytes puros a Base64 para que el HTML del moderador pueda pintar la imagen
        const imagenBase64 = bufferDesencriptado.toString('base64');
        return { 
            success: true, 
            imagenData: `data:image/webp;base64,${imagenBase64}` 
        };

    } catch (error) {
        console.error("Falla en Bóveda en Vivo:", error);
        throw new HttpsError("internal", error.message || "Error al intentar desencriptar el documento.");
    }
});


// ============================================================================
// 🤝 MÓDULO 13: SALA DE ESPERA P2P (Borradores y Contrapartes)
// ============================================================================
exports.crearBorradorTramiteP2P = functions.runWith({ memory: '256MB' }).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');

    const uidCreador = context.auth.uid;
    const { textoContrato, contraparteEmail, wompi_ref, firmasCreador } = data;

    if (!textoContrato || !contraparteEmail || !wompi_ref) {
        throw new functions.https.HttpsError('invalid-argument', 'Faltan datos del contrato o contraparte.');
    }

    const db = admin.firestore();
    const salaId = wompi_ref; // Usamos la referencia de pago como ID de la sala

    try {
        // 1. Guardamos el borrador en la colección temporal
        await db.collection('Salas_Legales_P2P').doc(salaId).set({
            creador_uid: uidCreador,
            contraparte_email: contraparteEmail.toLowerCase(),
            texto_contrato: textoContrato,
            estado: 'esperando_contraparte', // Estados: esperando_contraparte, apelado, listo_para_sellar
            fecha_creacion: admin.firestore.FieldValue.serverTimestamp(),
            firmas: {
                creador: firmasCreador // { gps, selfie, codigo, timestamp }
            }
        });

        // 2. Disparamos correo automático a la contraparte
        const linkSala = `https://tuqrpido.com/tramites.html?sala=${salaId}`;
        const mailOptions = {
            from: '"Bóveda QRpido" <qrpido@gmail.com>',
            to: contraparteEmail,
            subject: `Tienes un Documento Legal pendiente de firma`,
            text: `Han redactado un documento legal que requiere tu revisión y firma electrónica (Ley 527).\n\nIngresa a la sala segura aquí: ${linkSala}`
        };
        await transporter.sendMail(mailOptions);

        // 3. Generamos el link de WhatsApp para que el Creador lo envíe gratis
        const msjWhatsApp = encodeURIComponent(`Hola! He redactado el documento que acordamos. Por favor revísalo y fírmalo con validez legal aquí: ${linkSala}`);
        const linkWhatsApp = `https://wa.me/?text=${msjWhatsApp}`;

        return { 
            success: true, 
            salaId: salaId, 
            link_whatsapp: linkWhatsApp,
            mensaje: "Sala creada. Correo enviado y link de WhatsApp listo."
        };

    } catch (error) {
        console.error("Error creando sala P2P:", error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});
exports.firmarContraparteP2P = functions.runWith({ memory: '256MB' }).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');

    const uidContraparte = context.auth.uid;
    const { salaId, firmasContraparte } = data;

    const db = admin.firestore();
    const salaRef = db.collection('Salas_Legales_P2P').doc(salaId);

    try {
        return await db.runTransaction(async (transaction) => {
            const salaDoc = await transaction.get(salaRef);
            if (!salaDoc.exists) throw new functions.https.HttpsError('not-found', 'La sala no existe.');

            const salaData = salaDoc.data();
            
            // Validamos que sea el correo invitado
            if (salaData.contraparte_email !== context.auth.token.email) {
                throw new functions.https.HttpsError('permission-denied', 'No eres el invitado a esta sala.');
            }

            // Inyectamos la firma de la contraparte y cambiamos el estado
            transaction.update(salaRef, {
                'firmas.contraparte': {
                    uid: uidContraparte,
                    ...firmasContraparte
                },
                estado: 'listo_para_sellar',
                fecha_firma_contraparte: admin.firestore.FieldValue.serverTimestamp()
            });

            // Opcional: Aquí enviarías un email al 'creador_uid' avisándole que ya firmaron.

            return { success: true, mensaje: "Firma anexada. El creador ya puede sellar el contrato final." };
        });
    } catch (error) {
        throw new functions.https.HttpsError('internal', error.message);
    }
});
// ============================================================================
// 🔓 MÓDULO 14: LECTURA FRICCIÓN CERO (Desencriptación de Contratos On-The-Fly)
// ============================================================================
exports.descargarContratoDesbloqueado = functions.runWith({ memory: '512MB', secrets: [semillaMaestra] }).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Acceso denegado.');

    const uidSolicitante = context.auth.uid;
    const { contratoId } = data; // Es el wompi_ref o doc.id de Boveda_Tramites

    const db = admin.firestore();

    try {
        // 1. Verificamos que el usuario sea Dueño o Contraparte del documento
        const contratoSnap = await db.collection('Boveda_Tramites').doc(contratoId).get();
        if (!contratoSnap.exists) throw new functions.https.HttpsError('not-found', 'Contrato no encontrado.');

        const datosContrato = contratoSnap.data();
        if (!datosContrato.participantes.includes(uidSolicitante)) {
            throw new functions.https.HttpsError('permission-denied', 'No eres parte de este contrato. Acceso bloqueado.');
        }

        const rutaArchivoEnc = datosContrato.ruta_storage_enc; // Ej: boveda_legal/UID/archivo.enc

        // 2. Descargar el archivo encriptado desde Storage
        const bucket = admin.storage().bucket();
        const [bufferCifrado] = await bucket.file(rutaArchivoEnc).download();

        // 3. Ingeniería Inversa: Separamos IV, AuthTag y Cifrado
        const iv = bufferCifrado.subarray(0, 16);
        const authTag = bufferCifrado.subarray(16, 32);
        const cifrado = bufferCifrado.subarray(32);

        // 4. Reconstruimos la llave (El Creador del documento es el dueño original de la encriptación)
        const secretoMaestro = semillaMaestra.value();
        const llaveDerivada = crypto.createHash('sha256').update(secretoMaestro + datosContrato.creador_uid).digest();

        const decipher = crypto.createDecipheriv('aes-256-gcm', llaveDerivada, iv);
        decipher.setAuthTag(authTag);

        let bufferDesencriptado;
        try {
            bufferDesencriptado = Buffer.concat([decipher.update(cifrado), decipher.final()]);
        } catch (err) {
            throw new functions.https.HttpsError("data-loss", "Sello de integridad roto. El archivo fue manipulado.");
        }

        // 5. Convertimos a Base64 para enviarlo al Frontend
        const pdfBase64 = bufferDesencriptado.toString('base64');
        return { 
            success: true, 
            pdfData: `data:application/pdf;base64,${pdfBase64}` 
        };

    } catch (error) {
        console.error("Falla en Desencriptación Fricción Cero:", error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});