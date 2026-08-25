const crypto = require('crypto');
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { defineSecret } = require('firebase-functions/params');
const { onCall, HttpsError } = require("firebase-functions/v2/https");

// Inicialización ÚNICA de la app
admin.initializeApp();

let visionClient = null; 

// Semillas y Secretos
const semillaMaestra = defineSecret('SEMILLA_MAESTRA');
const secretoWebhooks = defineSecret('WOMPI_SECRET_EVENTS');
const semillaSui = defineSecret('SUI_SEED_PHRASE'); 
const semillaBase = defineSecret('BASE_SEED_PHRASE');

const PACKAGE_ID = "0x577a653ddc6827118e626c490a4ed11f11d7571852be3a4db8ebb36c5b48bac1";
const BASE_CONTRACT_ID = "0xEBC3D776557C72Ae9e42309eAc761866212421a9"; 
const PACKAGE_INVENTARIO_ID = "0xTU_NUEVO_CONTRATO_SUI_INVENTARIO";

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'geokatu@gmail.com', pass: 'khxvkeufgicxcrsh' } // Cambiar a tu correo actual si es necesario
});

// ============================================================================
// 1. LA FORJA DE BILLETERAS FÍSICAS (Wallets por Ubicación/Almacén)
// ============================================================================
exports.forjarWalletUbicacion = functions.runWith({ secrets: [semillaMaestra] })
    .firestore.document('Almacenes/{almacenId}') 
    .onCreate(async (snap, context) => {
        const MNEMONIC_MAESTRA = semillaMaestra.value();
        const almacenId = context.params.almacenId; 
        const db = admin.firestore();
        const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');

        const NUM_ESQUIRLAS = 10;
        const shardId = Math.floor(Math.random() * NUM_ESQUIRLAS);
        const shardRef = db.collection('Sistema').doc('ContadorBilleteras_Ubicaciones').collection('Esquirlas').doc(shardId.toString());
        const almacenRef = db.collection('Almacenes').doc(almacenId);

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

            await almacenRef.set({
                wallet_sui: suiAddress,
                indice_derivacion: indiceSeguro,
                estado_billetera: "forjada_activa",
                fecha_creacion_wallet: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            console.log(`Éxito: Billetera de Almacén ${suiAddress} (Índice: ${indiceSeguro}) forjada para la ubicación: ${almacenId}`);
            return null;

        } catch (error) {
            console.error(`Error crítico forjando la billetera HD para ubicación ${almacenId}: `, error);
            return null;
        }
});

// ============================================================================
// 2. EL CADENERO LOGÍSTICO (Movimientos Inmutables de Inventario)
// ============================================================================
exports.registrarMovimientoInventario = onCall({ secrets: [semillaSui] }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Acceso denegado. Solo personal de bodega.');

    const uidBodeguero = request.auth.uid;
    const { productoId, ubicacionOrigen, ubicacionDestino, tipoMovimiento } = request.data; 
    
    const db = admin.firestore();
    const rtdb = admin.database();

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

    if (!monedaSuiGas) throw new HttpsError('resource-exhausted', 'Malla de Gas vacía. Tesorería debe recargar.');

    try {
        return await db.runTransaction(async (transaction) => {
            const inventarioRef = db.collection('Inventario').doc(productoId);
            const productoDoc = await transaction.get(inventarioRef);
            
            if (!productoDoc.exists && tipoMovimiento !== 'RECEPCION') {
                throw new HttpsError('not-found', 'El producto no existe en el inventario.');
            }

            let txID_Generado;
            
            const { SuiJsonRpcClient } = await import('@mysten/sui/jsonRpc');
            const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
            const { Transaction } = await import('@mysten/sui/transactions');
            const suiClient = new SuiJsonRpcClient({ url: 'https://fullnode.mainnet.sui.io:443' });

            try {
                const datosCrudos = `PROD:${productoId}|ORIGEN:${ubicacionOrigen}|DESTINO:${ubicacionDestino}|OP:${tipoMovimiento}|USER:${uidBodeguero}`;
                const huellaMovimiento = crypto.createHash('sha256').update(datosCrudos).digest('hex');

                const tx = new Transaction();
                tx.setGasPayment([{ objectId: monedaSuiGas.id, version: monedaSuiGas.version, digest: monedaSuiGas.digest }]);
                
                tx.moveCall({
                    target: `${PACKAGE_INVENTARIO_ID}::logistica_almacen::sellar_movimiento`,
                    arguments: [tx.pure.string(huellaMovimiento), tx.pure.u64(Date.now())]
                });

                const keypair = Ed25519Keypair.deriveKeypair(semillaSui.value(), "m/44'/784'/0'/0'/0'");
                const result = await suiClient.signAndExecuteTransaction({ transaction: tx, signer: keypair });
                txID_Generado = result.digest;

            } catch (error_web3) {
                console.error("Fallo SUI en traslado:", error_web3);
                throw new HttpsError('internal', 'Error sellando el traslado en Blockchain: ' + error_web3.message);
            }

            const historialRef = db.collection('Historial_Movimientos').doc();
            const logData = {
                productoId,
                origen: ubicacionOrigen,
                destino: ubicacionDestino,
                tipo_operacion: tipoMovimiento,
                operador_uid: uidBodeguero,
                txID_sui: txID_Generado, 
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            };

            transaction.set(historialRef, logData);
            
            transaction.set(inventarioRef, {
                ubicacion_actual: ubicacionDestino,
                ultima_actualizacion: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            return { success: true, txID: txID_Generado, mensaje: "Movimiento blindado y registrado." };
        });
    } catch (e) {
        if (monedaSuiGas && idNodoGas) {
            await rtdb.ref(`Sistema/MallaDeGas/libres/${idNodoGas}`).set(monedaSuiGas);
            console.log(`[ROLLBACK DE GAS] Moneda devuelta a la malla tras fallo en traslado del producto: ${productoId}`);
        }
        throw new HttpsError('internal', e.message);
    }
});

// ============================================================================
// 3. LA TESORERÍA AUTÓNOMA (Vigilante de Gas para Almacenes)
// ============================================================================
exports.vigilanteTesoreriaInventario = functions.pubsub.schedule('every 12 hours').onRun(async (context) => {
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
        console.log(`[TESORERÍA ALMACENES] Balance actual de la reserva: ${suiActual} SUI`);

        if (suiActual < UMBRAL_CRITICO) {
            console.warn("[ALERTA] Tesorería baja. Recargar fondos para garantizar trazabilidad.");
        } else {
            console.log("[TESORERÍA ALMACENES] Reserva saludable. Verificando disponibilidad de fragmentos para escáneres...");
            
            const rtdb = admin.database();
            const mallaRef = rtdb.ref('Sistema/MallaDeGas/libres');
            
            const snapshot = await mallaRef.once('value');
            const monedasEnMalla = snapshot.numChildren();

           if (monedasEnMalla < 50) {
                console.log(`[FRACCIONADOR] Malla baja (${monedasEnMalla}). Extrayendo gas para próximos escaneos...`);
                
                const { data: monedasReales } = await suiClient.getCoins({
                    owner: direccionTesoreria,
                    coinType: '0x2::sui::SUI',
                    limit: 50
                });

                if (monedasReales.length === 0) {
                    console.error("[ALERTA CRÍTICA] La Tesorería no tiene objetos de moneda fraccionados.");
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
                console.log(`[FRACCIONADOR] ${monedasReales.length} monedas de gas inyectadas a los escáneres de bodega.`);
            }
        }
        return null;

    } catch (error) {
        console.error("[TESORERÍA ALMACENES] Error de conexión con la blockchain: ", error);
        return null;
    }
});

// ============================================================================
// 4. LA AUDITORÍA EN LA SOMBRA (Vigilante de Mermas)
// ============================================================================
exports.vigilanteMermasInventario = functions.firestore
    .document('Historial_Movimientos/{movimientoId}')
    .onCreate(async (snap, context) => {
        const movimientoActual = snap.data();
        const db = admin.firestore();

        const { productoId, origen, tipo_operacion, operador_uid } = movimientoActual;

        if (tipo_operacion === 'RECEPCION' && origen === 'PROVEEDOR') return null;

        try {
            const querySnap = await db.collection('Historial_Movimientos')
                .where('productoId', '==', productoId)
                .orderBy('timestamp', 'desc')
                .limit(2) 
                .get();

            if (querySnap.size < 2) return null; 

            const docs = querySnap.docs;
            const movimientoAnterior = docs[1].data();

            if (movimientoAnterior.destino !== origen) {
                console.warn(`[ALERTA DE MERMA] Salto físico detectado en producto: ${productoId}`);
                
                const alertaRef = db.collection('Alertas_Seguridad').doc();
                await alertaRef.set({
                    tipo_alerta: 'DESCUADRE_UBICACION',
                    productoId: productoId,
                    ubicacion_esperada: movimientoAnterior.destino,
                    ubicacion_reportada: origen,
                    operador_implicado: operador_uid,
                    timestamp_alerta: admin.firestore.FieldValue.serverTimestamp(),
                    estado: 'requiere_auditoria_urgente',
                    movimiento_sospechoso_id: snap.id
                });

                await db.collection('Inventario').doc(productoId).set({
                    alerta_merma: true,
                    auditoria_pendiente: true
                }, { merge: true });
            }

            return null;
        } catch (error) {
            console.error("[VIGILANTE DE MERMAS] Falla en la auditoría silenciosa: ", error);
            return null;
        }
});

// ============================================================================
// 5. EL BARRENDERO CRIPTOGRÁFICO (Mantenimiento de Gas para Almacenes)
// ============================================================================
exports.barrenderoCriptograficoInventario = functions.runWith({ secrets: [semillaSui] }).pubsub.schedule('every 24 hours').onRun(async (context) => {
    console.log("[DUST SWEEPER ALMACENES] Iniciando barrido de polvo criptográfico en SUI...");
    
    const rtdb = admin.database();
    const mallaRef = rtdb.ref('Sistema/MallaDeGas/libres');
    
    try {
        const snapshot = await mallaRef.once('value');
        if (!snapshot.exists()) return null;

        const monedas = snapshot.val();
        const idsMonedas = Object.keys(monedas);
        
        const UMBRAL_BASURA = 5000000; 
        let monedasPolvo = [];

        idsMonedas.forEach(id => {
            const moneda = monedas[id];
            if (moneda.monto < UMBRAL_BASURA) {
                monedasPolvo.push({ rtdbId: id, ...moneda });
            }
        });

        if (monedasPolvo.length < 2) {
            console.log("[DUST SWEEPER ALMACENES] La Malla está limpia o no hay suficiente polvo para fusionar.");
            return null;
        }

        const lote = monedasPolvo.slice(0, 50);
        const monedaDestino = lote[0]; 
        const monedasOrigen = lote.slice(1); 

        console.log(`[DUST SWEEPER ALMACENES] Empaquetando ${monedasOrigen.length} fracciones. Destino: ${monedaDestino.id}`);

        const { SuiJsonRpcClient } = await import('@mysten/sui/jsonRpc');
        const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
        const { Transaction } = await import('@mysten/sui/transactions');

        const suiClient = new SuiJsonRpcClient({ url: 'https://fullnode.mainnet.sui.io:443' });
        const keypair = Ed25519Keypair.deriveKeypair(semillaSui.value(), "m/44'/784'/0'/0'/0'");

        const tx = new Transaction();
        const sources = monedasOrigen.map(m => tx.object(m.id));

        tx.mergeCoins(tx.object(monedaDestino.id), sources);

        const result = await suiClient.signAndExecuteTransaction({ 
            transaction: tx, 
            signer: keypair 
        });

        console.log(`[DUST SWEEPER ALMACENES] Fusión exitosa en blockchain. TxID: ${result.digest}`);

        await new Promise(resolve => setTimeout(resolve, 2000));

        const lingoteSui = await suiClient.getObject({
            id: monedaDestino.id,
            options: { showContent: true }
        });

        if (lingoteSui.error) throw new Error("No se pudo verificar el lingote en la red.");

        const balanceReal = parseInt(lingoteSui.data.content.fields.balance);
        const versionReal = lingoteSui.data.version;
        const digestReal = lingoteSui.data.digest;

        let actualizacionesBatch = {};

        monedasOrigen.forEach(m => {
            actualizacionesBatch[m.rtdbId] = null; 
        });

        actualizacionesBatch[monedaDestino.rtdbId] = {
            id: monedaDestino.id,
            monto: balanceReal,
            version: versionReal,
            digest: digestReal,
            tipo: "lingote_fusionado"
        };

        await mallaRef.update(actualizacionesBatch);
        console.log(`[DUST SWEEPER ALMACENES] Barrido completado. Lingote de ${balanceReal / 1000000000} SUI anclado a la Malla.`);

        return null;

    } catch (error) {
        console.error("[DUST SWEEPER ALMACENES] Error crítico conectando con SUI:", error);
        return null;
    }
});

// ============================================================================
// 6. LECTURA FRICCIÓN CERO (Auditoría Inmutable de Inventario)
// ============================================================================
exports.auditarTrazabilidadProducto = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Acceso denegado. Permisos de administrador requeridos.');
    }

    const { productoId } = request.data;
    if (!productoId) {
        throw new HttpsError('invalid-argument', 'Se requiere el ID del código de barras o producto.');
    }

    const db = admin.firestore();

    try {
        const historialSnap = await db.collection('Historial_Movimientos')
                                      .where('productoId', '==', productoId)
                                      .orderBy('timestamp', 'desc')
                                      .limit(10)
                                      .get();

        if (historialSnap.empty) {
            return { success: true, movimientos: [], mensaje: 'Sin movimientos registrados para este producto.' };
        }

        const movimientos = [];
        historialSnap.forEach(doc => movimientos.push({ id: doc.id, ...doc.data() }));

        const ultimoMovimiento = movimientos[0];
        let verificacionWeb3 = null;

        if (ultimoMovimiento.txID_sui) {
            const { SuiJsonRpcClient } = await import('@mysten/sui/jsonRpc');
            const suiClient = new SuiJsonRpcClient({ url: 'https://fullnode.mainnet.sui.io:443' });

            try {
                const txBlockchain = await suiClient.getTransactionBlock({
                    digest: ultimoMovimiento.txID_sui,
                    options: { showEffects: true }
                });
                
                verificacionWeb3 = {
                    estado_red: txBlockchain.effects.status.status, 
                    confirmado_onchain: true,
                    tx_digest: txBlockchain.digest
                };
            } catch (err) {
                console.warn("Retraso en validación SUI o error de red:", err);
                verificacionWeb3 = { estado_red: 'pendiente_verificacion', confirmado_onchain: false };
            }
        }

        return {
            success: true,
            productoId: productoId,
            ubicacion_oficial: ultimoMovimiento.destino, 
            ultimo_operador_uid: ultimoMovimiento.operador_uid, 
            historial_reciente: movimientos,
            sello_auditoria_web3: verificacionWeb3
        };

    } catch (error) {
        console.error("Falla crítica en Auditoría de Trazabilidad:", error);
        throw new HttpsError('internal', error.message);
    }
});

// ============================================================================
// 7. EL SALVAVIDAS (Reembolso Virtual / El Camino Triste)
// ============================================================================
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

            if (orden.comerciante_uid !== uidSolicitante) {
                throw new functions.https.HttpsError('permission-denied', 'No tienes permiso para cancelar esta orden.');
            }

            if (orden.estado === 'ENTREGADO' || orden.estado === 'cancelada') {
                throw new functions.https.HttpsError('failed-precondition', 'La orden ya fue entregada o cancelada previamente.');
            }

            const comercioRef = db.collection('Directorio').doc(orden.comerciante_uid);
            
            transaction.update(comercioRef, {
                saldo_logistica: admin.firestore.FieldValue.increment(orden.monto_total)
            });

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
// 8. LA ADUANA DIGITAL (Sistema OTP por Correo)
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
        from: '"Seguridad Geokatu" <geokatu@gmail.com>', 
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
// 9. KYC BIOMÉTRICO (Google Vision + Cifrado AES-256-GCM)
// ============================================================================
function encriptarBuffer(buffer, secreto, uid) {
    const llaveDerivada = crypto.createHash('sha256').update(secreto + uid).digest();
    const iv = crypto.randomBytes(16); 
    const cipher = crypto.createCipheriv('aes-256-gcm', llaveDerivada, iv);
    
    const cifrado = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag(); 
    
    return Buffer.concat([iv, authTag, cifrado]);
}

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

    const secretoMaestro = semillaMaestra.value();
    const encFrente = encriptarBuffer(bufferFrente, secretoMaestro, uid);
    const encReverso = encriptarBuffer(bufferReverso, secretoMaestro, uid);
    const encRostro = encriptarBuffer(bufferRostro, secretoMaestro, uid);

    const bucket = admin.storage().bucket();
    const timestamp = Date.now();
    const pathBase = `kyc_blindado/${uid}_${timestamp}`;

    const opcionesArchivo = { metadata: { contentType: "application/octet-stream" }, private: true };

    await Promise.all([
      bucket.file(`${pathBase}_frente.enc`).save(encFrente, opcionesArchivo),
      bucket.file(`${pathBase}_reverso.enc`).save(encReverso, opcionesArchivo),
      bucket.file(`${pathBase}_rostro.enc`).save(encRostro, opcionesArchivo)
    ]);

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
// 10. EL NOTARIO DIGITAL (Sellar Trámite, SUI y Fricción Cero)
// ============================================================================
exports.sellarTramiteLegal = functions.runWith({ memory: '1GB', secrets: [semillaSui, semillaMaestra] }).https.onCall(async (data, context) => {
    const uid = context.auth ? context.auth.uid : 'INVITADO';
    const { textoContrato, otp, gps, selfie, codigo, wompi_ref, timestamp } = data;

    if (!textoContrato || !wompi_ref) throw new functions.https.HttpsError('invalid-argument', 'Paquete incompleto.');

    try {
        const pdfBuffer = await generarPDFEnMemoria(textoContrato, gps, selfie, codigo, timestamp);
        const hashDocumento = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

        const { SuiJsonRpcClient } = await import('@mysten/sui/jsonRpc');
        const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
        const { Transaction } = await import('@mysten/sui/transactions');
        
        const suiClient = new SuiJsonRpcClient({ url: 'https://fullnode.mainnet.sui.io:443' });
        const keypair = Ed25519Keypair.deriveKeypair(semillaSui.value(), "m/44'/784'/0'/0'/0'");
        const tx = new Transaction();
        
        tx.moveCall({
            target: `${PACKAGE_ID}::legal::sellar_hash_documento`, 
            arguments: [tx.pure.string(hashDocumento), tx.pure.u64(timestamp)]
        });

        const resultSui = await suiClient.signAndExecuteTransaction({ transaction: tx, signer: keypair });
        const txIdGenerado = resultSui.digest;

        const secretoMaestro = semillaMaestra.value();
        const pdfCifrado = encriptarBuffer(pdfBuffer, secretoMaestro, uid);

        const bucket = admin.storage().bucket();
        const nombreArchivo = wompi_ref.replace(/[^a-zA-Z0-9_-]/g, '');
        
        const fileEnc = bucket.file(`boveda_legal/${uid}/${nombreArchivo}.enc`);
        await fileEnc.save(pdfCifrado, { metadata: { contentType: 'application/octet-stream' }, private: true });

        const filePlano = bucket.file(`temporales_pdf/${uid}/${nombreArchivo}.pdf`);
        await filePlano.save(pdfBuffer, { metadata: { contentType: 'application/pdf' }, private: true });

        const urlFriccionCero = await filePlano.getSignedUrl({
            action: 'read',
            expires: Date.now() + 15 * 60 * 1000 
        });

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
            urlDescargaLibre: urlFriccionCero[0] 
        };

    } catch (error) {
        console.error("[NOTARIO] Falla:", error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

// ============================================================================
// 11. ORÁCULO DE TELEMETRÍA Y ACCIÓN DIRIGIDA P2P
// ============================================================================
exports.propagarAlertaConductor = functions.database.ref('malla_de_gas/alertas_conductores/{placaId}')
    .onCreate(async (snapshot, context) => {
        const placaId = context.params.placaId;
        const alertaData = snapshot.val();
        
        console.log(`[ALERTA P2P] Disparo de recogida detectado en tiempo real para unidad: ${placaId}. Coordinando origen sin barrido geográfico.`);
        
        return snapshot.ref.child('auditoria_sello').set({
            servidor_timestamp: admin.database.ServerValue.TIMESTAMP,
            oráculo_verificado: true
        });
    });

// ============================================================================
// 12. BÓVEDA EN VIVO (Desencriptación On-The-Fly para Moderadores)
// ============================================================================
exports.obtenerEvidenciaKyc = onCall({ memory: '512MB', secrets: [semillaMaestra] }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Acceso denegado.");
    }

    const uidSolicitante = request.auth.uid;
    const { uidObjetivo, tipoEvidencia } = request.data; 

    if (!uidObjetivo || !tipoEvidencia) {
        throw new HttpsError("invalid-argument", "Faltan parámetros de búsqueda.");
    }

    const db = admin.firestore();

    try {
        const adminSnap = await db.collection('Usuarios_Admin').doc(uidSolicitante).get();
        if (!adminSnap.exists || (adminSnap.data().rol !== 'admin' && adminSnap.data().rol !== 'superadmin' && adminSnap.data().rol !== 'moderador')) {
            throw new HttpsError("permission-denied", "No tienes credenciales de alta seguridad para abrir la bóveda.");
        }

        const userSnap = await db.collection('Directorio').doc(uidObjetivo).get();
        if (!userSnap.exists) throw new HttpsError("not-found", "Usuario no encontrado.");
        
        const evidencia = userSnap.data().evidencia_kyc;
        if (!evidencia || !evidencia[tipoEvidencia]) {
            throw new HttpsError("not-found", "No existe este documento biométrico para el usuario.");
        }

        const rutaArchivoEnc = evidencia[tipoEvidencia]; 

        const bucket = admin.storage().bucket();
        const archivo = bucket.file(rutaArchivoEnc);
        const [bufferCifrado] = await archivo.download();

        const iv = bufferCifrado.subarray(0, 16);
        const authTag = bufferCifrado.subarray(16, 32);
        const cifrado = bufferCifrado.subarray(32);

        const secretoMaestro = semillaMaestra.value();
        const llaveDerivada = crypto.createHash('sha256').update(secretoMaestro + uidObjetivo).digest();

        const decipher = crypto.createDecipheriv('aes-256-gcm', llaveDerivada, iv);
        decipher.setAuthTag(authTag); 

        let bufferDesencriptado;
        try {
            bufferDesencriptado = Buffer.concat([decipher.update(cifrado), decipher.final()]);
        } catch (err) {
            throw new HttpsError("data-loss", "El sello de autenticidad está roto o la llave es incorrecta. Archivo corrupto.");
        }

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
// 13. SALA DE ESPERA P2P (Borradores y Contrapartes)
// ============================================================================
exports.crearBorradorTramiteP2P = functions.runWith({ memory: '256MB' }).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');

    const uidCreador = context.auth.uid;
    const { textoContrato, contraparteEmail, wompi_ref, firmasCreador } = data;

    if (!textoContrato || !contraparteEmail || !wompi_ref) {
        throw new functions.https.HttpsError('invalid-argument', 'Faltan datos del contrato o contraparte.');
    }

    const db = admin.firestore();
    const salaId = wompi_ref; 

    try {
        await db.collection('Salas_Legales_P2P').doc(salaId).set({
            creador_uid: uidCreador,
            contraparte_email: contraparteEmail.toLowerCase(),
            texto_contrato: textoContrato,
            estado: 'esperando_contraparte', 
            fecha_creacion: admin.firestore.FieldValue.serverTimestamp(),
            firmas: {
                creador: firmasCreador 
            }
        });

        const linkSala = `https://www.geokatu.com/tramites.html?sala=${salaId}`;
        const mailOptions = {
            from: '"Bóveda Geokatu" <geokatu@gmail.com>',
            to: contraparteEmail,
            subject: `Tienes un Documento Legal pendiente de firma`,
            text: `Han redactado un documento legal que requiere tu revisión y firma electrónica (Ley 527).\n\nIngresa a la sala segura aquí: ${linkSala}`
        };
        await transporter.sendMail(mailOptions);

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
            
            if (salaData.contraparte_email !== context.auth.token.email) {
                throw new functions.https.HttpsError('permission-denied', 'No eres el invitado a esta sala.');
            }

            transaction.update(salaRef, {
                'firmas.contraparte': {
                    uid: uidContraparte,
                    ...firmasContraparte
                },
                estado: 'listo_para_sellar',
                fecha_firma_contraparte: admin.firestore.FieldValue.serverTimestamp()
            });

            return { success: true, mensaje: "Firma anexada. El creador ya puede sellar el contrato final." };
        });
    } catch (error) {
        throw new functions.https.HttpsError('internal', error.message);
    }
});
// ============================================================================
// 14. EL GUARDIÁN DE LA PUERTA (Creación Incorruptible de Bóvedas)
// ============================================================================
exports.crearBovedaInicial = functions.auth.user().onCreate(async (user) => {
    const db = admin.firestore();
    
    console.log(`[GUARDIÁN] Nuevo usuario detectado en Auth: ${user.uid}. Construyendo bóveda...`);

    try {
        // Payload inicial incorruptible. El usuario no puede alterar esto al registrarse.
        const payloadInicial = {
            nombre: "Mi Nueva Tienda",
            email: user.email || "",
            premium: false,
            estado_moderacion: "pendiente",
            fecha_registro: admin.firestore.FieldValue.serverTimestamp(),
            progreso_boveda: 10,
            origen_cuenta: "auth_trigger_cadenero" // Sello de seguridad del backend
        };
        
        // Usamos set con merge: true por si acaso hay un documento previo
        await db.collection('Directorio').doc(user.uid).set(payloadInicial, { merge: true });
        
        console.log(`[GUARDIÁN] Bóveda inicial sellada con éxito para: ${user.uid}`);
        return null;
        
    } catch (error) {
        console.error(`[GUARDIÁN - ERROR CRÍTICO] Falló la creación de bóveda para ${user.uid}:`, error);
        return null;
    }
});

// ============================================================================
// 15. CADENERO DE FRONTERA (Bloqueo de Bots y Correos Basura)
// ============================================================================
exports.bloquearBotsAntesDeCrear = functions.auth.user().beforeCreate((user, context) => {
    console.log(`[FRONTERA] Analizando intento de registro: ${user.email}`);

    // Lista negra de dominios de correos temporales (Burner emails)
    const dominiosBloqueados = [
        'yopmail.com', 'tempmail.com', '10minutemail.com', 
        'mailinator.com', 'guerrillamail.com', 'sharklasers.com'
    ];

    if (user.email) {
        const dominio = user.email.split('@')[1].toLowerCase();
        
        if (dominiosBloqueados.includes(dominio)) {
            console.error(`[FRONTERA] 🚨 Ataque bloqueado: Intento de registro con correo temporal (${dominio}).`);
            throw new functions.auth.HttpsError(
                'invalid-argument', 
                'Por seguridad, no permitimos el registro con correos temporales.'
            );
        }
    }

    // Si pasa todas las pruebas, le damos luz verde para entrar
    console.log(`[FRONTERA] Usuario ${user.email} limpio. Permitiendo registro.`);
    return {};
});
// ============================================================================
// 16. VALIDACIÓN INMUTABLE DE RECAPTCHA (Búnker de Formularios)
// ============================================================================
const secretoRecaptchaV2 = defineSecret('RECAPTCHA_V2_SECRET'); // Tu clave privada actual

exports.validarFirmaHumana = onCall({ secrets: [secretoRecaptchaV2] }, async (request) => {
    const token = request.data.token; // El token que envía el frontend

    if (!token) {
        throw new HttpsError('invalid-argument', 'Token de seguridad no proporcionado.');
    }

    try {
        const secretKey = secretoRecaptchaV2.value();
        // Google requiere los parámetros en la URL para este endpoint
        const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${token}`;
        
        // fetch es nativo en Node 18+ (versión por defecto de Firebase Functions)
        const respuestaGoogle = await fetch(verifyUrl, { method: 'POST' });
        const dataGoogle = await respuestaGoogle.json();

        if (!dataGoogle.success) {
            console.error("[RECAPTCHA] Intento bloqueado por Google:", dataGoogle['error-codes']);
            throw new HttpsError('permission-denied', 'Firma humana rechazada por los servidores centrales.');
        }

        return { success: true, mensaje: "Firma validada exitosamente." };

    } catch (error) {
        console.error("[RECAPTCHA ERROR]", error);
        throw new HttpsError('internal', 'Falla de comunicación con los servidores de validación.');
    }
});
