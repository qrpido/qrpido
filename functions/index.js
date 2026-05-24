const crypto = require('crypto');
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { defineSecret } = require('firebase-functions/params');

admin.initializeApp();

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
                console.log(`[FRACCIONADOR] Malla con stock bajo (${monedasEnMalla}). Generating 100 fragmentos...`);
                
                let nuevosFragmentos = {};
                for(let i=0; i<100; i++) {
                    const idFalso = "coin_" + Math.random().toString(36).substring(2, 10);
                    nuevosFragmentos[idFalso] = {
                        id: "0x" + Math.random().toString(16).slice(2, 32),
                        monto: 10000000,
                        version: 1,
                        digest: "pending_sync"
                    };
                }
                
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

// -------------------------------------------------------------------
// MÓDULO 3: EL CADENERO (Validación Inmutable y Liberación de Fondos)
// -------------------------------------------------------------------
exports.validarEntrega = functions.runWith({ secrets: [semillaSui, semillaBase] }).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Acceso denegado.');

    const uidDomiciliario = context.auth.uid;
    const { ordenId, codigoSuministrado } = data;
    const db = admin.firestore();
    const ordenRef = db.collection('Logistica_Ordenes').doc(ordenId);

    try {
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
                const rtdb = admin.database();
                let monedaSuiGas;

                await rtdb.ref('Sistema/MallaDeGas/libres').transaction((nodos) => {
                    if (nodos) {
                        const id = Object.keys(nodos)[0];
                        if (id) { monedaSuiGas = nodos[id]; delete nodos[id]; return nodos; }
                    }
                    return nodos;
                });

                if (!monedaSuiGas) throw new Error("Malla de Gas vacía.");

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

exports.crearOrdenLogistica = functions.https.onCall(async (data, context) => {
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
        const comercioRef = db.collection('Directorio').doc(uidComerciante);
        await comercioRef.update({
            ordenes_validadas: admin.firestore.FieldValue.increment(1)
        });

        let embajadorValidado = null;
        if (ticketReferido) {
            const secreto = semillaMaestra.value();
            embajadorValidado = validarSelloTOTP(ticketReferido, uidComerciante, secreto);
            if (!embajadorValidado) {
                console.warn(`[FRAUDE EVITADO] Firma TOTP inválida en comercio: ${uidComerciante}`);
            }
        }

        const randomBytes = crypto.randomBytes(3).toString('hex').toUpperCase();
        const codigoEntrega = `QRP-${randomBytes}`;

        const nuevaOrdenRef = db.collection('Logistica_Ordenes').doc(); 
        
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

        await nuevaOrdenRef.set(ordenEstructura);

        return { success: true, ordenId: nuevaOrdenRef.id, mensaje: "Orden creada y anclada exitosamente." };

    } catch (error) {
        console.error("Fallo al crear la orden logística:", error);
        throw new functions.https.HttpsError('internal', 'Error procesando la orden de logística.');
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

            if (ordenData.estado === 'ENTREGADO' || ordenData.estado === 'CANCELADO_REEMBOLSADO') {
                throw new functions.https.HttpsError('failed-precondition', 'La orden ya fue entregada o reembolsada previamente.');
            }

            const adminSnap = await transaction.get(db.collection('Usuarios_Admin').doc(uidSolicitante));
            const esSuperAdmin = adminSnap.exists && adminSnap.data().rol === 'superadmin';
            
            if (ordenData.comerciante_uid !== uidSolicitante && !esSuperAdmin) {
                throw new functions.https.HttpsError('permission-denied', 'No eres el dueño de esta orden.');
            }

            const negocioRef = db.collection('Directorio').doc(idNegocio);
            const montoADevolver = ordenData.monto_total || 0;

            transaction.update(negocioRef, {
                saldo_logistica: admin.firestore.FieldValue.increment(montoADevolver)
            });

            transaction.update(ordenRef, {
                estado: 'CANCELADO_REEMBOLSADO',
                fecha_cancelacion: admin.firestore.FieldValue.serverTimestamp(),
                cancelado_por: uidSolicitante
            });

            if (ordenData.ticket_publico) {
                const rtdbOrdenRef = admin.database().ref(`malla_de_gas/ordenes_activas/${ordenData.ticket_publico}`);
                await rtdbOrdenRef.remove(); 
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

        const UMBRAL_BASURA = 5000000; 

        idsMonedas.forEach(id => {
            const moneda = monedas[id];
            if (moneda.monto < UMBRAL_BASURA) {
                polvoAcumuladoMIST += moneda.monto;
                actualizacionesBatch[id] = null; 
                monedasBorradas++;
            }
        });

        if (polvoAcumuladoMIST > 0) {
            console.log(`[DUST SWEEPER] Se recogieron ${monedasBorradas} micro-fracciones. Polvo total: ${polvoAcumuladoMIST} MIST.`);
            
            const idLingote = "coin_gold_" + Math.random().toString(36).substring(2, 10);
            actualizacionesBatch[idLingote] = {
                id: "0x" + crypto.randomBytes(16).toString('hex'), 
                monto: polvoAcumuladoMIST,
                version: 1,
                digest: "merged_by_sweeper",
                tipo: "lingote_reciclado"
            };

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

// ============================================================================
// 🤖 MÓDULO: KYC BIOMÉTRICO (Google Vision - V2)
// ============================================================================
const { onCall, HttpsError } = require("firebase-functions/v2/https");
let visionClient = null; 

exports.procesarKycBiometrico = onCall({ memory: '512MB', maxInstances: 10 }, async (request) => {
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

    const bucket = admin.storage().bucket();
    const timestamp = Date.now();
    const pathBase = `kyc/${uid}_${timestamp}`;

    const opcionesArchivo = { metadata: { contentType: "image/webp" }, private: true };

    await Promise.all([
      bucket.file(`${pathBase}_frente.webp`).save(bufferFrente, opcionesArchivo),
      bucket.file(`${pathBase}_reverso.webp`).save(bufferReverso, opcionesArchivo),
      bucket.file(`${pathBase}_rostro.webp`).save(bufferRostro, opcionesArchivo)
    ]);

    const urlFrente = `gs://${bucket.name}/${pathBase}_frente.webp`;
    const urlReverso = `gs://${bucket.name}/${pathBase}_reverso.webp`;
    const urlRostro = `gs://${bucket.name}/${pathBase}_rostro.webp`;

    await admin.firestore().collection("Directorio").doc(uid).set({
      estado_moderacion: "en_revision_kyc", 
      evidencia_kyc: {
        frente: urlFrente,
        reverso: urlReverso,
        rostro: urlRostro,
        fecha_envio: new Date().toISOString()
      }
    }, { merge: true });

    return { success: true, mensaje: "Búnker sellado. Biometría enviada exitosamente." };

  } catch (error) {
    console.error("Falla en la Cocina KYC:", error);
    throw new HttpsError("internal", "Error interno en el procesamiento: " + error.message);
  }
});

// ============================================================================
// ⚖️ MÓDULO 10: EL NOTARIO CIEGO (SUI + RECAUDO + PDF - ASÍNCRONO TRUSTLESS)
// ============================================================================
exports.sellarTramiteLegal = functions.runWith({ secrets: [semillaSui], memory: '512MB' }).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Acceso denegado.');

    const uidUsuario = context.auth.uid;
    const { textoContrato, otp, gps, selfie, codigo, timestamp } = data; 

    if (!textoContrato || !selfie) {
        throw new functions.https.HttpsError('invalid-argument', 'El paquete probatorio está incompleto.');
    }

    try {
        const pdfBuffer = await generarPDFEnMemoria(textoContrato, gps, selfie, codigo, timestamp);
        const hashOriginal = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

        // 🔥 LA TÁCTICA GANADORA: Carga asíncrona dinámica idéntica al Módulo 3
        const { SuiJsonRpcClient } = await import('@mysten/sui/jsonRpc');
        const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
        const { Transaction } = await import('@mysten/sui/transactions');
        const suiClient = new SuiJsonRpcClient({ url: 'https://fullnode.mainnet.sui.io:443' });

        const rtdb = admin.database();
        let monedaSuiGas;
        await rtdb.ref('Sistema/MallaDeGas/libres').transaction((nodos) => {
            if (nodos) {
                const id = Object.keys(nodos)[0];
                if (id) { monedaSuiGas = nodos[id]; delete nodos[id]; return nodos; }
            }
            return nodos;
        });

        if (!monedaSuiGas) throw new Error("Malla de Gas sin liquidez temporal.");

        const tx = new Transaction();
        tx.setGasPayment([{ objectId: monedaSuiGas.id, version: monedaSuiGas.version, digest: monedaSuiGas.digest }]);
        
        tx.moveCall({
            target: `${PACKAGE_ID}::notario::sellar_documento`,
            arguments: [tx.pure.string(hashOriginal), tx.pure.u64(timestamp)]
        });

        const keypair = Ed25519Keypair.deriveKeypair(semillaSui.value(), "m/44'/784'/0'/0'/0'");
        const result = await suiClient.signAndExecuteTransaction({ transaction: tx, signer: keypair });
        const txId = result.digest;

        const llaveDerivada = crypto.createHash('sha256').update(txId + otp).digest();
        const iv = crypto.randomBytes(16); 
        const cipher = crypto.createCipheriv('aes-256-gcm', llaveDerivada, iv);
        
        const pdfCifrado = Buffer.concat([cipher.update(pdfBuffer), cipher.final()]);
        const authTag = cipher.getAuthTag(); 

        const paqueteFinal = Buffer.concat([iv, authTag, pdfCifrado]);

                // 5. Carga blindada a Storage privado con Metadato de Descarga Amigable
        const bucket = admin.storage().bucket();
        const archivoDestino = bucket.file(`boveda_legal/${uidUsuario}/${txId}.enc`);
        
        // El parámetro 'otp' de la función recibe tu código de 9 dígitos escrito a mano
        const nombreDescargaAmigable = `${otp}.pdf`;

        await archivoDestino.save(paqueteFinal, {
            metadata: { 
                contentType: 'application/octet-stream',
                contentDisposition: `attachment; filename="${nombreDescargaAmigable}"` // <-- Fuerza el nombre exacto al descargar
            },
            private: true
        });

        return { success: true, txId: txId, hashPdf: hashOriginal };


    } catch (error) {
        console.error("[NOTARIO CIEGO CRÍTICO]:", error);
        throw new functions.https.HttpsError('internal', error.message);
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