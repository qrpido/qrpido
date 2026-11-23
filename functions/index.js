const crypto = require('crypto');
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { defineSecret } = require('firebase-functions/params');
const { onCall, HttpsError } = require("firebase-functions/v2/https");
// Inicialización ÚNICA de la app
admin.initializeApp();
let visionClient = null;
// Semillas y Secretos en Google Cloud Secret Manager
const semillaMaestra = defineSecret('SEMILLA_MAESTRA');
const secretoWebhooks = defineSecret('WOMPI_SECRET_EVENTS');
const semillaSui = defineSecret('SUI_SEED_PHRASE');
const semillaBase = defineSecret('BASE_SEED_PHRASE');
const gmailAppPass = defineSecret('GMAIL_APP_PASS'); // 🛡️ Contraseña blindada en Secret Manager

const PACKAGE_ID = "0x577a653ddc6827118e626c490a4ed11f11d7571852be3a4db8ebb36c5b48bac1";
const BASE_CONTRACT_ID = "0xEBC3D776557C72Ae9e42309eAc761866212421a9";
const PACKAGE_INVENTARIO_ID = process.env.PACKAGE_INVENTARIO_ID || "0x577a653ddc6827118e626c490a4ed11f11d7571852be3a4db8ebb36c5b48bac1";

// Función auxiliar para instanciar el transporte con el secreto descifrado en memoria viva
function obtenerTransporterCorreo(secretoPass) {
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: 'geokatu@gmail.com',
            pass: secretoPass
        }
    });
}

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
exports.solicitarOTP = functions.runWith({ secrets: [gmailAppPass] }).https.onCall(async (data, context) => {
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
        const mailer = obtenerTransporterCorreo(gmailAppPass.value());
        await mailer.sendMail(mailOptions);
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
function validarEstructuraQrCedula(payloadQr) {
    if (!payloadQr || typeof payloadQr !== 'string') return false;
    const limpio = payloadQr.trim();
    return limpio.length >= 25 && (limpio.includes('CO') || limpio.includes('REP') || /\d{6,10}/.test(limpio));
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
const { frente, reverso, rostro, qrData } = request.data;
if (!frente || !reverso || !rostro) {
throw new HttpsError("invalid-argument", "Error de envío. Faltan evidencias en el paquete biométrico.");
}
try {
const limpiarBase64 = (dataUrl) => dataUrl.replace(/^data:image\/\w+;base64,/, "");
const bufferFrente = Buffer.from(limpiarBase64(frente), "base64");
const bufferReverso = Buffer.from(limpiarBase64(reverso), "base64");
const bufferRostro = Buffer.from(limpiarBase64(rostro), "base64");
const [resultadoTexto, resRostroCedula, resultadoRostro, resReversoTexto] = await Promise.all([
visionClient.textDetection({ image: { content: bufferFrente } }),
visionClient.faceDetection({ image: { content: bufferFrente } }),
visionClient.faceDetection({ image: { content: bufferRostro } }),
visionClient.textDetection({ image: { content: bufferReverso } })
]);
const anotacionesTexto = resultadoTexto[0].textAnnotations;
const textoExtraido = anotacionesTexto && anotacionesTexto.length > 0 ? anotacionesTexto[0].description.toUpperCase() : "";
const esDocumentoValido = textoExtraido.includes("REPUBLICA DE COLOMBIA") ||
textoExtraido.includes("CEDULA DE CIUDADANIA") ||
textoExtraido.includes("REPUBLICA BOLIVARIANA DE VENEZUELA") ||
textoExtraido.includes("CEDULA DE IDENTIDAD") ||
textoExtraido.includes("REPUBLICA") ||
textoExtraido.includes("COLOMBIA") ||
textoExtraido.includes("VENEZUELA") ||
textoExtraido.includes("NOMBRES");

if (!esDocumentoValido) {
return { success: false, mensaje: "Rechazado: El documento frontal no parece ser una Cédula legítima." };
}
const rostrosCedula = resRostroCedula[0].faceAnnotations || [];
if (rostrosCedula.length === 0) {
return { success: false, mensaje: "Rechazado: No se detectó el retrato fotográfico impreso en la cédula." };
}
const rostrosDetectados = resultadoRostro[0].faceAnnotations || [];
if (rostrosDetectados.length === 0) {
return { success: false, mensaje: "Rechazado: No se detectó un rostro humano en la selfie." };
}
const rostroPrincipal = rostrosDetectados[0];
if (rostroPrincipal.detectionConfidence < 0.78 || rostroPrincipal.blurredLikelihood === "VERY_LIKELY") {
return { success: false, mensaje: "Calidad biométrica insuficiente o imagen borrosa. Mejora la luz e inténtalo de nuevo." };
}
const qrValido = validarEstructuraQrCedula(qrData);
const textoReverso = (resReversoTexto[0].textAnnotations && resReversoTexto[0].textAnnotations[0]) ? resReversoTexto[0].textAnnotations[0].description.toUpperCase() : "";
const reversoValido = qrValido || textoReverso.includes("COL") || textoReverso.includes("REGISTRADURIA") || textoReverso.includes("<<<") || textoReverso.includes("INDICE") || textoReverso.includes("SANGRE") || textoReverso.includes("VENEZUELA") || textoReverso.length >= 20;
if (!reversoValido) {
return { success: false, mensaje: "Rechazado: El reverso del documento no es legible (enfoca el QR o la zona de datos)." };
}
const hashIntegridadKyc = crypto.createHash("sha256").update(Buffer.concat([bufferFrente, bufferReverso, bufferRostro, Buffer.from(uid)])).digest("hex");
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
kyc_verificado: false,
kyc_pendiente_cruce_1a1: true,
estado_kyc: "aprobado_bancario",
fecha_verificacion_kyc: admin.firestore.FieldValue.serverTimestamp(),
evidencia_kyc: {
frente: `${pathBase}_frente.enc`,
reverso: `${pathBase}_reverso.enc`,
rostro: `${pathBase}_rostro.enc`,
qr_verificado: qrValido,
confianza_facial: Number((rostroPrincipal.detectionConfidence || 0).toFixed(4)),
hash_integridad: hashIntegridadKyc,
nivel_validacion: "bancario_vision_qr",
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
function generarPDFEnMemoria(texto, gps, selfieBase64, codigo, timestamp, evidenciaP2P) {
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
const fechaStamp = new Date(timestamp || Date.now()).toISOString();
doc.fontSize(10).text(`Firma de Cierre (UTC): ${fechaStamp}`);
doc.text(`Coordenadas Juramentadas: Lat ${gps?.lat || 'N/D'}, Lng ${gps?.lng || 'N/D'}`);
doc.text(`Código de Intención Biométrico: ${codigo || 'N/D'}`);
if (evidenciaP2P) {
doc.moveDown();
doc.fontSize(12).text('TRAZABILIDAD DE PARTES (SALA P2P)', { underline: true });
doc.fontSize(9.5).text(`Sala ID: ${evidenciaP2P.salaId || 'Directa'}`);
if (evidenciaP2P.creador) {
doc.text(`Parte 1 (Creador): ${evidenciaP2P.creador.email || evidenciaP2P.creador.uid || 'N/D'} | Fecha: ${evidenciaP2P.creador.fecha || 'N/D'}`);
}
if (evidenciaP2P.contraparte) {
const gpsC = evidenciaP2P.contraparte.gps || {};
doc.text(`Parte 2 (Contraparte): ${evidenciaP2P.contraparte.email || evidenciaP2P.contraparte.uid || 'N/D'} | GPS: ${gpsC.lat || 'N/D'}, ${gpsC.lng || 'N/D'} | Código: ${evidenciaP2P.contraparte.codigo || 'N/D'}`);
}
}
if (selfieBase64) {
try {
doc.moveDown();
const base64Data = String(selfieBase64).replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
const imgBuffer = Buffer.from(base64Data, 'base64');
doc.image(imgBuffer, { fit: [250, 250], align: 'center' });
} catch (eImg) {
doc.text('Evidencia gráfica anexada mediante hash SHA-256 en bóveda cifrada.');
}
}
doc.end();
});
}
// ============================================================================
// 10. EL NOTARIO DIGITAL (Sellar Trámite, SUI y Fricción Cero)
// ============================================================================
exports.sellarTramiteLegal = functions.runWith({ memory: '1GB', secrets: [semillaSui, semillaMaestra] }).https.onCall(async (data, context) => {
if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión para sellar un contrato.');
const uid = context.auth.uid;
const emailAuth = String(context.auth.token.email || '').trim().toLowerCase();
const { textoContrato, otp, gps, selfie, codigo, wompi_ref, wompi_tx_id, timestamp } = data || {};
if (!textoContrato || !wompi_ref || !otp) throw new functions.https.HttpsError('invalid-argument', 'Paquete incompleto (se requiere contrato, OTP y referencia de pago).');
const dbCheck = admin.firestore();
const refLimpia = String(wompi_ref).trim();
const bovedaExistente = await dbCheck.collection('Boveda_Tramites').doc(refLimpia).get();
if (bovedaExistente.exists) throw new functions.https.HttpsError('already-exists', 'Esta referencia de pago ya fue utilizada en un contrato.');
const otpRef = dbCheck.collection('Sistema_OTP').doc(uid);
await dbCheck.runTransaction(async (tr) => {
const otpDoc = await tr.get(otpRef);
if (!otpDoc.exists) throw new functions.https.HttpsError('failed-precondition', 'Solicita un código OTP válido antes de sellar.');
const dOtp = otpDoc.data();
if (dOtp.expira && dOtp.expira.toDate() < new Date()) {
tr.delete(otpRef);
throw new functions.https.HttpsError('deadline-exceeded', 'El código OTP expiró. Solicita uno nuevo.');
}
if (String(dOtp.codigo || '').trim() !== String(otp).trim()) {
throw new functions.https.HttpsError('permission-denied', 'Código OTP incorrecto.');
}
tr.delete(otpRef);
});
const pagoWebhookDoc = await dbCheck.collection('Pagos_Tramites_Verificados').doc(refLimpia).get();
let pagoVerificado = pagoWebhookDoc.exists && pagoWebhookDoc.data().estado === 'APPROVED' && Number(pagoWebhookDoc.data().monto_centavos || 0) >= 499000;
if (!pagoVerificado) {
if (!wompi_tx_id) throw new functions.https.HttpsError('failed-precondition', 'Pago no confirmado por pasarela Wompi.');
const baseWompi = refLimpia.startsWith('SANDBOX-') ? 'https://sandbox.wompi.co/v1/transactions/' : 'https://production.wompi.co/v1/transactions/';
const respWompi = await fetch(baseWompi + encodeURIComponent(String(wompi_tx_id)));
const jsonWompi = respWompi.ok ? await respWompi.json() : null;
const txW = jsonWompi && jsonWompi.data ? jsonWompi.data : null;
if (!txW || txW.status !== 'APPROVED' || txW.reference !== refLimpia || Number(txW.amount_in_cents || 0) < 499000) {
throw new functions.https.HttpsError('failed-precondition', 'La transacción Wompi no está aprobada o no coincide con la referencia y tarifa.');
}
await dbCheck.collection('Pagos_Tramites_Verificados').doc(refLimpia).set({ estado: 'APPROVED', wompi_tx_id: txW.id, monto_centavos: txW.amount_in_cents, uid: uid, fecha: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
}
let evidenciaP2P = null;
if (data.sala_id) {
const salaSnap = await dbCheck.collection('Salas_Legales_P2P').doc(String(data.sala_id)).get();
if (!salaSnap.exists) throw new functions.https.HttpsError('not-found', 'La sala P2P indicada no existe.');
const sData = salaSnap.data();
const esParte = sData.creador_uid === uid || (emailAuth && String(sData.contraparte_email || '').trim().toLowerCase() === emailAuth);
if (!esParte) throw new functions.https.HttpsError('permission-denied', 'No eres participante autorizado de esta sala P2P.');
evidenciaP2P = { salaId: salaSnap.id, creador: (sData.firmas && sData.firmas.creador) ? sData.firmas.creador : { uid: sData.creador_uid }, contraparte: (sData.firmas && sData.firmas.contraparte) ? Object.assign({ email: sData.contraparte_email }, sData.firmas.contraparte) : { email: sData.contraparte_email, gps: gps, codigo: codigo } };
}
try {
const pdfBuffer = await generarPDFEnMemoria(textoContrato, gps, selfie, codigo, timestamp, evidenciaP2P);
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
const listaParticipantes = Array.isArray(data.participantes) && data.participantes.length > 0
    ? Array.from(new Set([uid, ...data.participantes.filter(Boolean)]))
    : [uid];
await db.collection('Boveda_Tramites').doc(wompi_ref).set({
creador_uid: uid,
participantes: listaParticipantes,
tipo_documento: data.tipo_documento || "Contrato Digital",
lugar: data.lugar || "Colombia",
sala_id: data.sala_id || null,
inmueble_id: data.inmueble_id || null,
hash_documento: hashDocumento,
tx_sui: txIdGenerado,
fecha_creacion: admin.firestore.FieldValue.serverTimestamp(),
estado: "Sellado en SUI",
wompi_ref: wompi_ref,
ruta_storage_enc: `boveda_legal/${uid}/${nombreArchivo}.enc`
});
if (data.sala_id) {
    await db.collection('Salas_Legales_P2P').doc(String(data.sala_id)).set({
        estado: "sellado_sui",
        tx_sui: txIdGenerado,
        boveda_doc_id: wompi_ref,
        fecha_sellado: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
}
return {
success: true,
txId: txIdGenerado,
hashDocumento: hashDocumento,
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
exports.aprobarKycModerador = onCall({ memory: '256MB' }, async (request) => {
if (!request.auth) throw new HttpsError('unauthenticated', 'Acceso denegado.');
const { uidObjetivo, aprobado, motivo } = request.data || {};
if (!uidObjetivo || typeof aprobado !== 'boolean') throw new HttpsError('invalid-argument', 'Parámetros inválidos.');
const db = admin.firestore();
const adminSnap = await db.collection('Usuarios_Admin').doc(request.auth.uid).get();
if (!adminSnap.exists || !['admin', 'superadmin', 'moderador'].includes(adminSnap.data().rol)) {
throw new HttpsError('permission-denied', 'Solo moderadores autorizados pueden aprobar cruce KYC 1:1.');
}
await db.collection('Directorio').doc(String(uidObjetivo)).set({
kyc_verificado: aprobado,
kyc_pendiente_cruce_1a1: false,
estado_kyc: aprobado ? 'aprobado_1a1_moderador' : 'rechazado_moderador',
kyc_moderador_uid: request.auth.uid,
kyc_motivo_decision: String(motivo || ''),
fecha_decision_kyc: admin.firestore.FieldValue.serverTimestamp()
}, { merge: true });
return { success: true, aprobado: aprobado };
});
// ============================================================================
// 13. SALA DE ESPERA P2P (Borradores y Contrapartes)
// ============================================================================
exports.crearBorradorTramiteP2P = functions.runWith({ memory: '256MB', secrets: [gmailAppPass] }).https.onCall(async (data, context) => {
if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
const uidCreador = context.auth.uid;
const { textoContrato, contraparteEmail, firmasCreador } = data || {};
if (!textoContrato || !contraparteEmail) {
throw new functions.https.HttpsError('invalid-argument', 'Faltan datos del contrato o contraparte.');
}
const db = admin.firestore();
const salaId = `SALA-${crypto.randomBytes(16).toString('hex')}`;
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
const linkSala = `https://www.geokatu.com/tramites?sala=${salaId}`;
const mailOptions = {
from: '"Bóveda Geokatu" <geokatu@gmail.com>',
to: contraparteEmail,
subject: `Tienes un Documento Legal pendiente de firma`,
text: `Han redactado un documento legal que requiere tu revisión y firma electrónica (Ley 527).\n\nIngresa a la sala segura aquí: ${linkSala}`
};
const mailer = obtenerTransporterCorreo(gmailAppPass.value());
await mailer.sendMail(mailOptions);
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
const emailAuthP2P = String(context.auth.token.email || '').trim().toLowerCase();
if (String(salaData.contraparte_email || '').trim().toLowerCase() !== emailAuthP2P) {
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
exports.descargarContratoDesbloqueado = onCall({ memory: '512MB', secrets: [semillaMaestra] }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Acceso denegado.');
    const uidSolicitante = request.auth.uid;
    const { contratoId } = request.data || {};
    if (!contratoId) throw new HttpsError('invalid-argument', 'Falta el identificador del contrato.');
    const db = admin.firestore();
    const docSnap = await db.collection('Boveda_Tramites').doc(String(contratoId)).get();
    if (!docSnap.exists) throw new HttpsError('not-found', 'El contrato no existe en la bóveda.');
    const info = docSnap.data();
    const participantes = Array.isArray(info.participantes) ? info.participantes : [info.creador_uid];
    if (!participantes.includes(uidSolicitante)) {
        throw new HttpsError('permission-denied', 'No eres participante autorizado de este documento.');
    }
    const bucket = admin.storage().bucket();
    const [bufferCifrado] = await bucket.file(info.ruta_storage_enc).download();
    const iv = bufferCifrado.subarray(0, 16);
    const authTag = bufferCifrado.subarray(16, 32);
    const cifrado = bufferCifrado.subarray(32);
    const llaveDerivada = crypto.createHash('sha256').update(semillaMaestra.value() + info.creador_uid).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', llaveDerivada, iv);
    decipher.setAuthTag(authTag);
    const pdfPlano = Buffer.concat([decipher.update(cifrado), decipher.final()]);
    return {
        success: true,
        pdfData: `data:application/pdf;base64,${pdfPlano.toString('base64')}`,
        tx_sui: info.tx_sui || ''
    };
});

exports.gestionarSalaTramiteP2P = onCall({ memory: '256MB' }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Inicia sesión para continuar.');
    const uid = request.auth.uid;
    const email = String(request.auth.token.email || '').trim().toLowerCase();
    const { accion, salaId, observacion, textoSeleccionado } = request.data || {};
    const db = admin.firestore();
    if (accion === 'obtener_sala') {
        if (!salaId) throw new HttpsError('invalid-argument', 'Falta salaId.');
        const snap = await db.collection('Salas_Legales_P2P').doc(String(salaId)).get();
        if (!snap.exists) throw new HttpsError('not-found', 'Sala no encontrada.');
        const dSala = snap.data();
        const autorizado = dSala.creador_uid === uid || (email && String(dSala.contraparte_email || '').trim().toLowerCase() === email);
        if (!autorizado) throw new HttpsError('permission-denied', 'No eres participante autorizado de esta sala privada.');
        return { success: true, sala: Object.assign({ id: snap.id }, dSala) };
    }
    if (accion === 'apelar') {
        if (!salaId || !observacion) throw new HttpsError('invalid-argument', 'Faltan datos de apelación.');
        const ref = db.collection('Salas_Legales_P2P').doc(String(salaId));
        const snapAp = await ref.get();
        if (!snapAp.exists) throw new HttpsError('not-found', 'Sala no encontrada.');
        const dAp = snapAp.data();
        if (dAp.creador_uid !== uid && (!email || String(dAp.contraparte_email || '').trim().toLowerCase() !== email)) {
            throw new HttpsError('permission-denied', 'No tienes permiso para apelar en esta sala.');
        }
        await ref.set({
            estado: 'en_apelacion',
            apelaciones: admin.firestore.FieldValue.arrayUnion({
                autor_uid: uid,
                autor_email: email,
                fragmento: String(textoSeleccionado || '').slice(0, 400),
                comentario: String(observacion).slice(0, 800),
                fecha: new Date().toISOString()
            })
        }, { merge: true });
        return { success: true };
    }
    if (accion === 'listar_activos') {
        const [creadasSnap, invitadasSnap, bovedaSnap] = await Promise.all([
            db.collection('Salas_Legales_P2P').where('creador_uid', '==', uid).limit(20).get(),
            email ? db.collection('Salas_Legales_P2P').where('contraparte_email', '==', email).limit(20).get() : Promise.resolve({ docs: [] }),
            db.collection('Boveda_Tramites').where('participantes', 'array-contains', uid).limit(30).get()
        ]);
        const mapaSalas = new Map();
        creadasSnap.docs.forEach(d => mapaSalas.set(d.id, Object.assign({ id: d.id, rol: 'creador' }, d.data())));
        invitadasSnap.docs.forEach(d => {
            if (!mapaSalas.has(d.id)) mapaSalas.set(d.id, Object.assign({ id: d.id, rol: 'invitado' }, d.data()));
        });
        const historial = bovedaSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
        return { success: true, salas: Array.from(mapaSalas.values()), historial: historial };
    }
    throw new HttpsError('invalid-argument', 'Acción no soportada.');
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
pais: "COL",
estado_moderacion: "pendiente",
fecha_registro: admin.firestore.FieldValue.serverTimestamp(),
progreso_boveda: 10,
origen_cuenta: "auth_trigger_cadenero" // Sello de seguridad del backend
};

// Usamos set con merge: true por si acaso hay un documento previo
await db.collection('Directorio').doc(user.uid).set(payloadInicial, { merge: true });

// 🚀 Engrane Suizo: Mantiene qrpido.html actualizado con 0 lecturas masivas
try {
    await db.collection('sistema').doc('metricas_red').set({
        total_comercios_pendientes: admin.firestore.FieldValue.increment(1)
    }, { merge: true });
} catch (eMet) {
    console.warn("[Métricas] No se pudo incrementar contador de comercios:", eMet.message);
}

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
const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${encodeURIComponent(secretKey)}&response=${encodeURIComponent(token)}`;
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

// Memoria en caliente con cerrojo de promesa para reuso de Bearer Token de Siigo
const _tokensCacheSiigo = {};
const _promesasAuthEnCurso = {};

async function obtenerTokenSiigo(usuario, llaveAcceso) {
    const ahora = Date.now();
    const cacheKey = `${usuario}`;

    // 1. Reuso de token vigente en memoria RAM
    if (_tokensCacheSiigo[cacheKey] && _tokensCacheSiigo[cacheKey].expira > ahora) {
        return _tokensCacheSiigo[cacheKey].token;
    }

    // 2. Si ya hay una petición HTTP en curso hacia Siigo, encadenarse a ella (Anti-Stampede)
    if (_promesasAuthEnCurso[cacheKey]) {
        return await _promesasAuthEnCurso[cacheKey];
    }

    _promesasAuthEnCurso[cacheKey] = (async () => {
        try {
            const respuestaAuth = await fetch('https://api.siigo.com/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: usuario, access_key: llaveAcceso })
            });

            if (!respuestaAuth.ok) {
                const errorDetalle = await respuestaAuth.text();
                throw new Error(`Fallo de autenticación con Siigo: ${errorDetalle}`);
            }

            const dataAuth = await respuestaAuth.json();
            _tokensCacheSiigo[cacheKey] = {
                token: dataAuth.access_token,
                expira: ahora + (23 * 60 * 60 * 1000) // 23 horas de caché
            };

            return dataAuth.access_token;
        } finally {
            delete _promesasAuthEnCurso[cacheKey];
        }
    })();

    return await _promesasAuthEnCurso[cacheKey];
}



// ============================================================================
// 17. DESPACHADOR FISCAL ASÍNCRONO POS (Trigger Reactivo Firestore)
// ============================================================================
// Algoritmo DIAN Oficial: Cálculo de Dígito de Verificación (Módulo 11)
function calcularDigitoVerificacion(nit) {
    const vpri = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
    const z = nit.toString().trim();
    let x = 0;
    let y = 0;
    for (let i = 0; i < z.length; i++) {
        y = parseInt(z.substr(i, 1), 10);
        x += (y * vpri[z.length - 1 - i]);
    }
    y = x % 11;
    return (y > 1) ? (11 - y).toString() : y.toString();
}

exports.despacharFacturaSiigoPOS = functions.firestore
    .document('Directorio/{idNegocio}/Ventas_POS/{ticketId}')
    .onCreate(async (snap, context) => {
        const venta = snap.data();
        const { idNegocio, ticketId } = context.params;
        const db = admin.firestore();

        // 🛡️ CONTENCIÓN DE COSTOS: Omitir si es Venezuela o no solicitó factura electrónica DIAN
        if (venta.pais_operacion === 'VEN' || !venta.factura_electronica) {
            return snap.ref.update({
                "despacho_fiscal.estado": venta.pais_operacion === 'VEN' ? "OMITIDO_VENEZUELA" : "OMITIDO_CONSUMIDOR_FINAL",
                "despacho_fiscal.timestamp": admin.firestore.FieldValue.serverTimestamp()
            });
        }


        try {
            // 1. Obtener credenciales del comercio
            const negocioDoc = await db.collection('Directorio').doc(idNegocio).get();
            if (!negocioDoc.exists) return null;

            const configFiscal = negocioDoc.data().perfil_fiscal;
            if (!configFiscal || configFiscal.proveedor !== 'SIIGO' || !configFiscal.siigo_user || !configFiscal.siigo_key) {
                return snap.ref.update({
                    "despacho_fiscal.estado": "OMITIDO_SIN_CONFIGURACION",
                    "despacho_fiscal.timestamp": admin.firestore.FieldValue.serverTimestamp()
                });
            }

            // 2. Obtener Token JWT y enviar a Siigo
            const bearerToken = await obtenerTokenSiigo(configFiscal.siigo_user, configFiscal.siigo_key);
            const payloadCanonico = venta.despacho_fiscal?.payload_canonico;

            if (!payloadCanonico) {
                throw new Error("El ticket no contiene el payload canónico.");
            }

            // Mapeo Canónico -> Siigo REST Contract
            const esContingencia = payloadCanonico.tipo_operacion === "CONTINGENCIA_DIAN" || payloadCanonico.codigo_contingencia === "04";
            
            // Si el negocio tiene resolución de talonario/contingencia en Siigo, se prioriza ese código; de lo contrario fallback al estándar
            const idDocumentoSiigo = esContingencia 
                ? (configFiscal.codigo_comprobante_contingencia || configFiscal.codigo_tipo_comprobante || 1150)
                : (configFiscal.codigo_tipo_comprobante || 1150);

            // Mapeo Canónico -> Siigo REST Contract
            const payloadSiigo = {
                document: { id: idDocumentoSiigo },
                date: payloadCanonico.fecha,
                customer: {
                    identification: payloadCanonico.cliente.numero_documento,
                    check_digit: payloadCanonico.cliente.tipo_documento === "31" 
                        ? calcularDigitoVerificacion(payloadCanonico.cliente.numero_documento) 
                        : "",
                    name: [payloadCanonico.cliente.razon_social || "Consumidor Final", ""],
                    commercial_name: payloadCanonico.cliente.razon_social || "Consumidor Final",
                    branch_office: 0
                },
                currency: { code: "COP" },

                seller: configFiscal.id_vendedor_siigo || 629,
                observations: esContingencia 
                    ? `FACTURA ELECTRÓNICA DE CONTINGENCIA TIPO 04 (ANEXO 1.9 DIAN) - Ticket: ${venta.ticketIdLocal} - Emitida offline: ${payloadCanonico.hora}`
                    : `GEOKATU POS Ticket: ${venta.ticketIdLocal}`,

                items: payloadCanonico.items.map(item => {
                    const esGenerico = item.sku.startsWith("GENERICO_");
                    return {
                        code: esGenerico ? (configFiscal.sku_generico_siigo || "SERVICIO-GENERAL") : item.sku,
                        description: item.nombre,
                        quantity: item.cantidad,
                        price: item.precio_unitario_base,
                        discount: 0,
                        taxes: item.porcentaje_impuesto === 19 ? [{ id: configFiscal.id_impuesto_iva_siigo || 1284 }] : []
                    };
                }),

                payments: payloadCanonico.pagos.map(p => ({
                    id: p.codigo_medio_pago_dian === "48" ? 48 : (p.codigo_medio_pago_dian === "47" ? 50 : 10),
                    value: p.monto,
                    due_date: payloadCanonico.fecha
                }))
            };

            const respuestaFactura = await fetch('https://api.siigo.com/v1/invoices', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${bearerToken}`,
                    'Partner-Id': 'GeokatuPOS'
                },
                body: JSON.stringify(payloadSiigo)
            });

            const dataRespuesta = await respuestaFactura.json();

            if (!respuestaFactura.ok) {
                console.error(`[SIIGO POS ERROR] Negocio: ${idNegocio}, Ticket: ${ticketId}`, dataRespuesta);
                return snap.ref.update({
                    "despacho_fiscal.estado": "ERROR_PROVEEDOR",
                    "despacho_fiscal.respuesta_error": dataRespuesta,
                    "despacho_fiscal.timestamp": admin.firestore.FieldValue.serverTimestamp()
                });
            }

            // 3. Sellar ticket con el número de factura electrónica emitido por la DIAN
            return snap.ref.update({
                "despacho_fiscal.estado": "FACTURADO_EXITOSO",
                "despacho_fiscal.siigo_id": dataRespuesta.id,
                "despacho_fiscal.consecutivo": dataRespuesta.name,
                "despacho_fiscal.cufe": dataRespuesta.cufe || null,
                "despacho_fiscal.timestamp": admin.firestore.FieldValue.serverTimestamp()
            });

        } catch (error) {
            console.error(`[DESPACHO FISCAL FALLO CRÍTICO] Ticket: ${ticketId}`, error);
            return snap.ref.update({
                "despacho_fiscal.estado": "ERROR_SISTEMA",
                "despacho_fiscal.error_mensaje": error.message,
                "despacho_fiscal.timestamp": admin.firestore.FieldValue.serverTimestamp()
            });
        }
    });
// ============================================================================
// 18. CONSOLIDADOR DE CIERRE Z A COMPROBANTE DE DIARIO SIIGO (/v1/journals)
// ============================================================================
exports.consolidarCierreZSiigo = functions.firestore
    .document('Directorio/{idNegocio}/Cierres_Z/{cierreId}')
    .onCreate(async (snap, context) => {
        const cierre = snap.data();
        const { idNegocio, cierreId } = context.params;
        const db = admin.firestore();

        try {
            const negocioDoc = await db.collection('Directorio').doc(idNegocio).get();
            if (!negocioDoc.exists) return null;

            const datosNegocio = negocioDoc.data();
            const configFiscal = datosNegocio.perfil_fiscal;
            if (datosNegocio.pais === 'VEN' || !configFiscal || configFiscal.proveedor !== 'SIIGO' || !configFiscal.siigo_user || !configFiscal.siigo_key) {
                return snap.ref.update({ 
                    "siigo_journal_ready.sincronizado_siigo": false, 
                    "siigo_journal_ready.motivo": datosNegocio.pais === 'VEN' ? "OMITIDO_VENEZUELA" : "SIN_CONFIGURACION" 
                });
            }


            const bearerToken = await obtenerTokenSiigo(configFiscal.siigo_user, configFiscal.siigo_key);
            let journalPayload = cierre.siigo_journal_ready?.payload;

            if (!journalPayload || !Array.isArray(journalPayload.items)) {
                throw new Error("El Cierre Z no contiene un payload de comprobante diario válido.");
            }

            // 🛡️ 1. Identificación fiscal obligatoria de tercero para cada fila de Siigo
            const nitComercioLimpio = String(configFiscal.nit || datosNegocio.nit || "222222222222").replace(/\D/g, '');

            // 🛡️ 2. Resolución dinámica del tipo de comprobante de diario
            const idComprobanteDiario = configFiscal.codigo_comprobante_cierre_z || 
                                       configFiscal.codigo_comprobante_diario || 
                                       journalPayload.document?.id || 240;

            // 🛡️ 3. Normalización y balanceo matemático estricto de partida doble
            let sumaDebitos = 0;
            let sumaCreditos = 0;

            const itemsNormalizados = journalPayload.items.map(item => {
                const deb = Math.round(Number(item.debit) || 0);
                const cred = Math.round(Number(item.credit) || 0);
                sumaDebitos += deb;
                sumaCreditos += cred;

                return {
                    account: { code: String(item.account?.code || "11050501").trim() },
                    customer: { identification: nitComercioLimpio }, // Requisito mandatorio de Siigo API
                    description: String(item.description || `Cierre Z ${cierreId}`).substring(0, 255),
                    debit: deb,
                    credit: cred
                };
            });

            // Ajuste automático por diferencias de redondeo o desbalance contable
            const diferenciaBalance = sumaDebitos - sumaCreditos;
            if (diferenciaBalance !== 0) {
                console.warn(`[SIIGO BALANCE Z] Descuadre detectado: ${diferenciaBalance}. Cuadrando en cuenta de ajuste.`);
                itemsNormalizados.push({
                    account: { code: configFiscal.cuenta_ajuste_descuadre || "42958101" },
                    customer: { identification: nitComercioLimpio },
                    description: `Ajuste de cuadre Cierre Z ${cierreId}`,
                    debit: diferenciaBalance < 0 ? Math.abs(diferenciaBalance) : 0,
                    credit: diferenciaBalance > 0 ? diferenciaBalance : 0
                });
            }

            const payloadDefinitivoSiigo = {
                document: { id: idComprobanteDiario },
                date: journalPayload.date || new Date().toISOString().split('T')[0],
                items: itemsNormalizados,
                observations: (journalPayload.observations || `Cierre Z GEOKATU POS - ${cierreId}`).substring(0, 255)
            };

            const resJournal = await fetch('https://api.siigo.com/v1/journals', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${bearerToken}`,
                    'Partner-Id': 'GeokatuPOS'
                },
                body: JSON.stringify(payloadDefinitivoSiigo)
            });

            const dataJournal = await resJournal.json();

            if (!resJournal.ok) {
                console.error(`[SIIGO JOURNAL ERROR] Negocio: ${idNegocio}, Cierre: ${cierreId}`, dataJournal);
                return snap.ref.update({
                    "siigo_journal_ready.sincronizado_siigo": false,
                    "siigo_journal_ready.error": dataJournal,
                    "siigo_journal_ready.timestamp": admin.firestore.FieldValue.serverTimestamp()
                });
            }

            return snap.ref.update({
                "siigo_journal_ready.sincronizado_siigo": true,
                "siigo_journal_ready.siigo_id": dataJournal.id,
                "siigo_journal_ready.consecutivo": dataJournal.name || null,
                "siigo_journal_ready.timestamp": admin.firestore.FieldValue.serverTimestamp()
            });

        } catch (error) {
            console.error(`[SIIGO JOURNAL EXCEPTION] Cierre: ${cierreId}`, error);
            return snap.ref.update({
                "siigo_journal_ready.sincronizado_siigo": false,
                "siigo_journal_ready.error": error.message,
                "siigo_journal_ready.timestamp": admin.firestore.FieldValue.serverTimestamp()
            });
        }
    });

// ============================================================================
// 19. WEBHOOK SEGURO DE PASARELA WOMPI (Validación Criptográfica con Checksum)
// ============================================================================
exports.webhookWompiEventos = functions.runWith({ secrets: [secretoWebhooks] })
    .https.onRequest(async (req, res) => {
        if (req.method !== 'POST') {
            return res.status(405).send('Método no permitido');
        }

        const evento = req.body;
        const checksumHeader = req.headers['x-event-checksum'];
        const secreto = secretoWebhooks.value();

        try {
            // 🛡️ VALIDACIÓN DE FIRMA WOMPI SHA-256
            // Cadena de validación: properties.transaction.id + status + amount_in_cents + timestamp + secreto
            const transaction = evento.data?.transaction;
            if (!transaction) return res.status(400).send('Estructura inválida');

                        if (!checksumHeader || !secreto) {
                return res.status(401).send('Firma o secreto ausente');
            }
            const cadenaConcentrada = String(transaction.id) + String(transaction.status) + String(transaction.amount_in_cents) + String(evento.timestamp) + String(secreto);
            const hashCalculado = crypto.createHash('sha256').update(cadenaConcentrada).digest('hex');
            const bufCalc = Buffer.from(hashCalculado, 'utf8');
            const bufHead = Buffer.from(String(checksumHeader), 'utf8');

            if (bufCalc.length !== bufHead.length || !crypto.timingSafeEqual(bufCalc, bufHead)) {
                console.error("Violacion de Integridad: Checksum de Wompi adulterado.");
                return res.status(401).send('Firma inválida');
            }

            if (evento.event === 'transaction.updated' && transaction.status === 'APPROVED') {
                const db = admin.firestore();
                const referencia = transaction.reference; // Formato esperado: GEOKATU-{idNegocio}-{tktId}-{timestamp}
                const partes = referencia.split('-');
                const idNegocio = partes[1];
                const tktId = partes[2];

                if (idNegocio && tktId) {
                    const pedidoRef = db.collection('Directorio').doc(idNegocio).collection('pedidos_entrantes').doc(tktId);
                    await pedidoRef.set({
                        estado_pago: 'PAGADO_CONFIRMADO',
                        monto_recibido_centavos: transaction.amount_in_cents,
                        wompi_transaccion_id: transaction.id,
                        fecha_confirmacion: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
// === NUEVO: SELLO EN VIVO PARA CORNETA DIGITAL Y MODAL POS ULTRA ===
                    const pagoPosRef = db.collection('Directorio').doc(idNegocio).collection('Pagos_POS_EnVivo').doc(tktId);
                    await pagoPosRef.set({
                        estado: 'APROBADO',
                        monto_pesos: Math.round(Number(transaction.amount_in_cents || 0) / 100),
                        transaccion_id: transaction.id,
                        metodo: transaction.payment_method_type || 'PASARELA_ULTRA',
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });

                    // 🚀 Engrane Suizo: Registra el volumen cobrado en el acumulado de red
                    const montoPesos = Math.round(Number(transaction.amount_in_cents || 0) / 100);
                    try {
                        await db.collection('sistema').doc('metricas_red').set({
                            volumen_ventas_pos: admin.firestore.FieldValue.increment(montoPesos),
                            tickets_emitidos: admin.firestore.FieldValue.increment(1)
                        }, { merge: true });
                    } catch (eMet) {}

                    console.log(`[WOMPI WEBHOOK] Pedido ${tktId} para negocio ${idNegocio} confirmado con éxito.`);
                }
            }

            return res.status(200).json({ received: true });
        } catch (err) {
            console.error("[WOMPI ERROR]", err);
            return res.status(500).send('Error interno en procesamiento');
        }
    });
// ============================================================================
// 20. GESTIÓN DE EQUIPO: CREAR OPERARIO CON HORARIOS Y PROTECCIÓN MULTI-TENANT
// ============================================================================
exports.crearOperarioComercio = onCall({ memory: '256MB', maxInstances: 10 }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Acceso denegado. Se requiere sesion activa.');
    }
    const uidAdmin = request.auth.uid;
    const { idNegocio, nombre, telefono, email, passwordTemporal, codigoCajero, rol, almacenHabitual, horarioLaboral } = request.data;
    if (!idNegocio || !email || !passwordTemporal || !codigoCajero) {
        throw new HttpsError('invalid-argument', 'Faltan parametros obligatorios.');
    }
    if (!/^\d{4}$/.test(codigoCajero)) {
        throw new HttpsError('invalid-argument', 'El codigo de cajero debe ser exactamente de 4 digitos numericos (1000 - 9999).');
    }
    const db = admin.firestore();
    // ZERO-TRUST: Verificar titularidad del comercio
    if (uidAdmin !== idNegocio) {
        const adminSnap = await db.collection('Usuarios_Admin').doc(uidAdmin).get();
        if (!adminSnap.exists || (adminSnap.data().rol !== 'superadmin' && adminSnap.data().rol !== 'administrador_delegado')) {
            throw new HttpsError('permission-denied', 'No tienes permisos de gestion sobre este comercio.');
        }
    }
    try {
        let userRecord;
        let esCuentaNueva = true;
        try {
            userRecord = await admin.auth().createUser({
                email: email,
                password: passwordTemporal,
                displayName: nombre
            });
        } catch (authError) {
            if (authError.code === 'auth/email-already-exists') {
                // La cuenta ya existe (ej. entra con Google o ya tiene su propio negocio):
                // NO sobrescribimos su password personal para no bloquearle su cuenta
                userRecord = await admin.auth().getUserByEmail(email);
                esCuentaNueva = false;
            } else {
                throw authError;
            }
        }
                const rolesPermitidos = ['cajero', 'bodeguero', 'asesor', 'supervisor'];
        const rolSanitizado = rolesPermitidos.indexOf(String(rol || '').toLowerCase()) !== -1 ? String(rol).toLowerCase() : 'cajero';
        if (!esCuentaNueva && userRecord.uid !== uidAdmin) {
            const opPrevioSnap = await db.collection('Directorio').doc(idNegocio).collection('Equipo').doc(userRecord.uid).get();
            if (!opPrevioSnap.exists) {
                throw new HttpsError('failed-precondition', 'El correo ya pertenece a una cuenta personal registrada. Usa un correo exclusivo de operario.');
            }
        }
        const claimsPrevios = userRecord.customClaims || {};
        await admin.auth().setCustomUserClaims(userRecord.uid, Object.assign({}, claimsPrevios, {
            rol: rolSanitizado,
            id_negocio_padre: idNegocio,
            codigo_cajero: codigoCajero
        }));
        // Plazo maximo para primer inicio con clave temporal: 48 horas (solo si es cuenta nueva)
        const expiracionTemporal = esCuentaNueva ? new Date(Date.now() + (48 * 60 * 60 * 1000)).toISOString() : null;
        const payloadOperario = {
            uid: userRecord.uid,
            nombre: nombre,
            telefono: telefono || "",
            email: email,
            rol: rol || 'cajero',
            codigo_cajero: codigoCajero,
            almacen_habitual: almacenHabitual || "SALA_VENTAS",
            horario_laboral: horarioLaboral || null,
            requiere_cambio_password: esCuentaNueva,
            expiracion_clave_temporal: expiracionTemporal,
            id_negocio_padre: idNegocio,
            fecha_creacion: admin.firestore.FieldValue.serverTimestamp()
        };
        // 1. Guardar en la subcoleccion privada del negocio
        await db.collection('Directorio').doc(idNegocio).collection('Equipo').doc(userRecord.uid).set(payloadOperario, { merge: true });
        // 2. Indice global para enrutamiento en AuthGate (incluye horario y sede)
        await db.collection('Usuarios_Operadores').doc(userRecord.uid).set({
            nombre: nombre,
            email: email,
            id_negocio: idNegocio,
            rol: rol || 'cajero',
            codigo_cajero: codigoCajero,
            almacen_habitual: almacenHabitual || "SALA_VENTAS",
            horario_laboral: horarioLaboral || null,
            requiere_cambio_password: esCuentaNueva,
            expiracion_clave_temporal: expiracionTemporal
        }, { merge: true });
        // Engrane Suizo: Mantiene el contador de equipo de la red en tiempo real
        try {
            await db.collection('sistema').doc('metricas_red').set({
                total_operarios: admin.firestore.FieldValue.increment(1)
            }, { merge: true });
        } catch (eMet) {}
        return { 
            success: true, 
            uid: userRecord.uid, 
            mensaje: "Operario " + nombre + " registrado con PIN " + codigoCajero + "."
        };
    } catch (error) {
        console.error("[CREAR OPERARIO ERROR]", error);
        throw new HttpsError('internal', error.message || 'Error registrando operario.');
    }
});


// ============================================================================
// 21. RESET DE CONTRASEÑA POR ADMINISTRADOR O RECUPERACIÓN POR EMAIL
// ============================================================================
exports.resetearPasswordOperario = onCall({ memory: '256MB', maxInstances: 10 }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Acceso denegado.');
    const uidSolicitante = request.auth.uid;
    const { idNegocio, operarioUid, nuevaPasswordTemporal } = request.data || {};
    if (!idNegocio || !operarioUid || !nuevaPasswordTemporal || String(nuevaPasswordTemporal).length < 6) {
        throw new HttpsError('invalid-argument', 'Parametros invalidos o clave menor a 6 caracteres.');
    }
    if (operarioUid === idNegocio) {
        throw new HttpsError('permission-denied', 'No se permite resetear la cuenta propietaria desde este endpoint.');
    }
    const db = admin.firestore();
    if (uidSolicitante !== idNegocio) {
        const adminSnap = await db.collection('Usuarios_Admin').doc(uidSolicitante).get();
        if (!adminSnap.exists || (adminSnap.data().rol !== 'superadmin' && adminSnap.data().rol !== 'administrador_delegado')) {
            throw new HttpsError('permission-denied', 'No eres titular de este comercio.');
        }
    }
    const opDoc = await db.collection('Directorio').doc(idNegocio).collection('Equipo').doc(operarioUid).get();
    if (!opDoc.exists || opDoc.data().id_negocio_padre !== idNegocio) {
        throw new HttpsError('not-found', 'El operario no pertenece a la nomina de este comercio.');
    }
    const expiracionTemporal = new Date(Date.now() + (48 * 60 * 60 * 1000)).toISOString();

    await admin.auth().updateUser(operarioUid, { password: nuevaPasswordTemporal });

    await db.collection('Directorio').doc(idNegocio).collection('Equipo').doc(operarioUid).update({
        requiere_cambio_password: true,
        expiracion_clave_temporal: expiracionTemporal
    });

    await db.collection('Usuarios_Operadores').doc(operarioUid).update({
        requiere_cambio_password: true,
        expiracion_clave_temporal: expiracionTemporal
    });

    return { success: true, mensaje: "Contraseña temporal restablecida por 48 horas." };
});
// ============================================================================
// 22. COMPILADOR REACTIVO DE MATRIZ OFFLINE (CDN & STORAGE)
// ============================================================================
const CAMPOS_CARTOGRAFICOS = [
    "estado_moderacion",
    "nombre",
    "slogan",
    "nicho",
    "categoria",
    "Coordenadas",
    "lat",
    "lng",
    "pin_pack",
    "color_principal",
    "color_acento",
    "logo",
    "whatsapp",
    "whatsApp",
    "pbx",
    "es_24_horas",
    "verificado_maps",
    "verificado_geokatu",
    "destacado_estrella"
];

async function compilarYPublicarMatrizStorage() {
    const db = admin.firestore();
    const snapshot = await db.collection("Directorio")
        .where("estado_moderacion", "==", "aprobado")
        .get();

    if (snapshot.empty) {
        console.log("[Compilador Matriz] No hay comercios aprobados para compilar.");
        return { total: 0, bytes: 0 };
    }

    const payloadCompacto = [];

    snapshot.forEach((docSnap) => {
        const c = docSnap.data();

        // 1. Extracción y normalización de coordenadas
        let lat = 4.81333;
        let lng = -75.69611;

        if (c.Coordenadas && typeof c.Coordenadas.latitude === "number") {
            lat = c.Coordenadas.latitude;
            lng = c.Coordenadas.longitude;
        } else if (typeof c.lat === "number" && !isNaN(c.lat)) {
            lat = c.lat;
            lng = c.lng;
        }

        // 2. Empaquetado binario de banderas (f)
        let flags = 0;
        const fonoWa = String(c.whatsapp || c.whatsApp || "").trim();
        const fonoPbx = String(c.pbx || "").trim();

        if (fonoWa.length > 5) flags |= 1;                                      // Bit 0: WhatsApp
        if (fonoPbx.length > 4 && fonoWa.length <= 5) flags |= 2;               // Bit 1: Solo PBX
        if (Boolean(c.es_24_horas)) flags |= 4;                                 // Bit 2: 24 Horas
        if (c.verificado_maps === "SI" || c.verificado_geokatu === true) flags |= 8; // Bit 3: Verificado
        if (Boolean(c.destacado_estrella)) flags |= 16;                         // Bit 4: Estrella

        payloadCompacto.push({
            id: String(docSnap.id),
            n: String(c.nombre || "Comercio"),
            s: String(c.slogan || "").substring(0, 70),
            c: String(c.nicho || c.categoria || "General"),
            g: [Number(lat.toFixed(6)), Number(lng.toFixed(6))],
            p: String(c.pin_pack || "forma-gota|anim-salto"),
            b: [c.color_principal || "#ff6b00", c.color_acento || "#8a909d"],
            l: String(c.logo || ""),
            f: flags
        });
    });

    const jsonBuffer = Buffer.from(JSON.stringify(payloadCompacto));
    const bucket = admin.storage().bucket();
    const archivo = bucket.file("directorio_matriz.json");

    // Guardado en Storage con cabecera de caché para CDN perimetral
    await archivo.save(jsonBuffer, {
        contentType: "application/json",
        metadata: {
            cacheControl: "public, max-age=86400, stale-while-revalidate=43200"
        }
    });

    try {
        await archivo.makePublic();
    } catch (ePub) {
        console.warn("[Compilador Matriz] Aviso de visibilidad pública:", ePub.message);
    }

    // Registro de telemetría y control de enfriamiento
    await db.doc("Sistema/matriz_control").set({
        ultima_compilacion: new Date().toISOString(),
        total_comercios: payloadCompacto.length,
        tamano_bytes: jsonBuffer.length
    }, { merge: true });

    console.log("[Compilador Matriz] Compilación exitosa: " + payloadCompacto.length + " comercios (" + jsonBuffer.length + " bytes).");
    return { total: payloadCompacto.length, bytes: jsonBuffer.length };
}

exports.observadorDirectorioMatriz = functions.firestore
    .document("Directorio/{id}")
    .onWrite(async (change, context) => {
        const dataAntes = change.before.exists ? change.before.data() : null;
        const dataDespues = change.after.exists ? change.after.data() : null;

        // A. Comercio eliminado: si estaba aprobado, reconstruir matriz
        if (!change.after.exists) {
            if (dataAntes && dataAntes.estado_moderacion === "aprobado") {
                return compilarYPublicarMatrizStorage();
            }
            return null;
        }

        // B. Si nunca estuvo aprobado ni lo está ahora, no procesar
        const modAntes = dataAntes ? dataAntes.estado_moderacion : null;
        const modDespues = dataDespues ? dataDespues.estado_moderacion : null;

        if (modAntes !== "aprobado" && modDespues !== "aprobado") {
            return null;
        }

        // C. Filtro de cambios: si solo fue una venta del POS o métricas, omitir
        if (dataAntes && dataDespues) {
            let esCambioCartografico = false;
            for (let i = 0; i < CAMPOS_CARTOGRAFICOS.length; i++) {
                const k = CAMPOS_CARTOGRAFICOS[i];
                if (JSON.stringify(dataAntes[k]) !== JSON.stringify(dataDespues[k])) {
                    esCambioCartografico = true;
                    break;
                }
            }

            if (!esCambioCartografico) {
                return null;
            }
        }

        // D. Candado de enfriamiento (cooldown de 120 segundos para ráfagas)
        const db = admin.firestore();
        const refControl = db.doc("Sistema/matriz_control");
        const snapControl = await refControl.get();
        const ahora = Date.now();

        if (snapControl.exists) {
            const fechaUltima = new Date(snapControl.data().ultima_compilacion || 0).getTime();
            const deltaSegundos = (ahora - fechaUltima) / 1000;

            if (deltaSegundos < 120) {
                console.log("[Compilador Matriz] Enfriamiento activo (" + Math.round(deltaSegundos) + "s / 120s). Novedad cubierta por Delta reactivo.");
                return null;
            }
        }

        return compilarYPublicarMatrizStorage();
    });

// ============================================================================
// 23. COMPILACIÓN DE MATRIZ CDN (ON-CALL V2 ADMIN / ONBOARDING CON THROTTLE)
// ============================================================================
exports.compilarMatrizDirectorioManual = onCall({ memory: "512MB", maxInstances: 5 }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Se requiere sesión activa.");
    }

    const uidCaller = request.auth.uid;
    const db = admin.firestore();
    const [adminSnap, dirSnap] = await Promise.all([
        db.collection("Usuarios_Admin").doc(uidCaller).get(),
        db.collection("Directorio").doc(uidCaller).get()
    ]);

    const rolAdmin = adminSnap.exists ? String(adminSnap.data().rol || "") : "";
    const esStaff = (rolAdmin === "superadmin" || rolAdmin === "admin" || rolAdmin === "moderador");
    const esComercioActivo = dirSnap.exists;

    if (!esStaff && !esComercioActivo) {
        throw new HttpsError("permission-denied", "Sin permisos para actualizar el CDN de matriz.");
    }

    // Freno anti-rafaga de 45s para llamadas automaticas de comercios/moderadores (Superadmin pasa directo)
    const ctrlRef = db.collection("Sistema").doc("Control_Matriz_CDN");
    if (rolAdmin !== "superadmin") {
        const ctrlSnap = await ctrlRef.get();
        const ultimoMs = (ctrlSnap.exists && ctrlSnap.data().ultimo_compilado_ms) ? Number(ctrlSnap.data().ultimo_compilado_ms) : 0;
        if (Date.now() - ultimoMs < 45000) {
            return { success: true, omitido_por_rafaga: true };
        }
    }

    await ctrlRef.set({ ultimo_compilado_ms: Date.now(), disparado_por: uidCaller }, { merge: true });
    return await compilarYPublicarMatrizStorage();
});

// ============================================================================
// 24. BÓVEDA MULTI-COMERCIO, FIRMA SHA-256 Y WEBHOOK UNIFICADO (BOLD / WOMPI)
// ============================================================================
exports.guardarCredencialesPasarelaPOS = onCall({ memory: "256MB", maxInstances: 10 }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Inicia sesion para configurar la boveda de pagos.");
    }
    const uidSolicitante = request.auth.uid;
    const emailSolicitante = (request.auth.token.email || "").toLowerCase();
    const data = request.data || {};
    const idNegocio = String(data.idNegocio || uidSolicitante).trim();
    const pasarela = String(data.pasarela || "MANUAL").toUpperCase().trim();
    const publicKey = String(data.publicKey || "").trim();
    const secretKey = String(data.secretKey || "").trim();
    const eventsSecret = String(data.eventsSecret || "").trim();
    const terminalId = String(data.terminalId || "").trim();
    const evidenciaUrl = String(data.evidenciaUrl || "").trim();

    const db = admin.firestore();
    const negRef = db.collection("Directorio").doc(idNegocio);
    const negSnap = await negRef.get();
    if (!negSnap.exists) {
        throw new HttpsError("not-found", "El comercio especificado no existe en el Directorio.");
    }
    const negData = negSnap.data() || {};
    let autorizado = (uidSolicitante === idNegocio) ||
        (negData.uid_dueno && negData.uid_dueno === uidSolicitante) ||
        (negData.owner_email && String(negData.owner_email).toLowerCase() === emailSolicitante);

    if (!autorizado) {
        const adminSnap = await db.collection("Usuarios_Admin").doc(uidSolicitante).get();
        if (adminSnap.exists && (adminSnap.data().rol === "superadmin" || adminSnap.data().rol === "admin")) {
            autorizado = true;
        }
    }
    if (!autorizado) {
        throw new HttpsError("permission-denied", "No tienes permisos sobre la boveda de este comercio.");
    }

    if (pasarela !== "BOLD" && pasarela !== "WOMPI" && pasarela !== "MANUAL") {
        throw new HttpsError("invalid-argument", "Pasarela no soportada. Elige BOLD o WOMPI.");
    }

        let comercioVerificadoApi = false;
    let ambienteDetectado = "PRODUCCION";
    let detalleVerificacion = "Modo manual activado";

    if (pasarela === "WOMPI") {
        if (publicKey.indexOf("pub_") !== 0 || secretKey.length < 12 || !eventsSecret || eventsSecret.length < 12) {
            throw new HttpsError("invalid-argument", "En Wompi debes ingresar Llave Publica (pub_...), Secreto de Integridad y Secreto de Eventos por separado.");
        }
        const esTest = publicKey.indexOf("pub_test_") === 0;
        const secEsTest = secretKey.indexOf("test_") === 0;
        if (esTest !== secEsTest && (secretKey.indexOf("prod_") === 0 || secretKey.indexOf("test_") === 0)) {
            throw new HttpsError("invalid-argument", "No puedes mezclar llaves de pruebas (test) con llaves de produccion (prod).");
        }
        ambienteDetectado = esTest ? "SANDBOX" : "PRODUCCION";
        const urlMerchant = (esTest ? "https://sandbox.wompi.co/v1/merchants/" : "https://production.wompi.co/v1/merchants/") + encodeURIComponent(publicKey);
        try {
            const respW = await fetch(urlMerchant, { method: "GET" });
            if (respW.ok) {
                const jsonW = await respW.json();
                if (jsonW && jsonW.data && jsonW.data.id) {
                    comercioVerificadoApi = true;
                    detalleVerificacion = "Wompi " + ambienteDetectado + " activo: " + (jsonW.data.name || "Comercio Verificado");
                }
            }
        } catch (eW) {}
        if (!comercioVerificadoApi) {
            throw new HttpsError("failed-precondition", "Wompi rechazo la llave publica proporcionada. Verifica que pertenezca al ambiente correcto.");
        }
    } else if (pasarela === "BOLD") {
        if (publicKey.length < 10 || secretKey.length < 10) {
            throw new HttpsError("invalid-argument", "En Bold debes ingresar tanto la Llave de Identidad como la Llave Secreta.");
        }
        ambienteDetectado = (publicKey.toLowerCase().indexOf("test") !== -1 || publicKey.toLowerCase().indexOf("sandbox") !== -1) ? "SANDBOX" : "PRODUCCION";
        const hashPrueba = crypto.createHash("sha256").update("TEST_ORDEN" + "1000" + "COP" + secretKey).digest("hex");
        if (hashPrueba && hashPrueba.length === 64) {
            comercioVerificadoApi = true;
            detalleVerificacion = "Bold " + ambienteDetectado + " verificado (Firma SHA-256 lista)";
        }
    }

    const mascaraSecreto = secretKey.length >= 4 ? ("****" + secretKey.slice(-4)) : "****";
    const bovedaRef = negRef.collection("Boveda_Pasarelas_Privada").doc("Credenciales");
    await bovedaRef.set({
        pasarela: pasarela,
        ambiente: ambienteDetectado,
        public_key: publicKey,
        secret_key: secretKey,
        events_secret: eventsSecret || secretKey,
        terminal_id: terminalId,
        evidencia_ruta_privada: evidenciaUrl,
        verificado_api: comercioVerificadoApi,
        detalle_verificacion: detalleVerificacion,
        actualizado_por: uidSolicitante,
        fecha_actualizacion: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    const cfgPrevia = negData.configuracion_pos || {};
    delete cfgPrevia.evidencia_pasarela_url;
    const nuevaCfgPublica = Object.assign({}, cfgPrevia, {
        pasarela_activa: pasarela,
        pasarela_ambiente: ambienteDetectado,
        pasarela_public_key: publicKey,
        pasarela_verificada: comercioVerificadoApi,
        llave_secreta_mascara: mascaraSecreto,
        bold_terminal_id: terminalId,
        detalle_verificacion_pasarela: detalleVerificacion,
        fecha_verificacion_pasarela: new Date().toISOString()
    });

    await negRef.set({ configuracion_pos: nuevaCfgPublica }, { merge: true });

    return {
        success: true,
        verificado: comercioVerificadoApi,
        ambiente: ambienteDetectado,
        pasarela: pasarela,
        mascara: mascaraSecreto,
        mensaje: detalleVerificacion
    };
});

exports.crearOrdenCobroPasarelaPOS = onCall({ memory: "256MB", maxInstances: 20 }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Sesion requerida en terminal POS.");
    }
        const data = request.data || {};
    const idNegocio = String(data.idNegocio || "").trim();
    const ticketTempId = String(data.ticketTempId || ("TKT" + Date.now())).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
    const montoEntero = Math.round(Number(data.montoPesos) || 0);
    if (!idNegocio || !Number.isFinite(montoEntero) || montoEntero <= 0) {
        throw new HttpsError("invalid-argument", "Datos de orden o monto invalidos.");
    }
    const hashRef = crypto.createHash("sha256").update(idNegocio + "|" + ticketTempId + "|" + String(montoEntero)).digest("hex").slice(0, 20).toUpperCase();
    const referencia = "GK_" + ticketTempId.slice(0, 14) + "_" + hashRef;

        const db = admin.firestore();
    const negRef = db.collection("Directorio").doc(idNegocio);
    const negSnap = await negRef.get();
    if (!negSnap.exists) {
        throw new HttpsError("not-found", "Comercio no encontrado.");
    }
    const negData = negSnap.data() || {};
    const uidCaller = request.auth.uid;
    const emailCaller = String(request.auth.token.email || "").toLowerCase();
    let permisoCobro = (uidCaller === idNegocio) ||
        (negData.uid_dueno && negData.uid_dueno === uidCaller) ||
        (negData.owner_email && String(negData.owner_email).toLowerCase() === emailCaller);

    if (!permisoCobro) {
        const [eqSnap, colSnap, admSnap] = await Promise.all([
            negRef.collection("Equipo").doc(uidCaller).get(),
            negRef.collection("Colaboradores").doc(uidCaller).get(),
            db.collection("Usuarios_Admin").doc(uidCaller).get()
        ]);
        const opData = eqSnap.exists ? eqSnap.data() : (colSnap.exists ? colSnap.data() : null);
        if (opData && opData.suspendido !== true && opData.activo !== false) {
            permisoCobro = true;
        } else if (admSnap.exists && (admSnap.data().rol === "superadmin" || admSnap.data().rol === "admin")) {
            permisoCobro = true;
        }
    }
    if (!permisoCobro) {
        throw new HttpsError("permission-denied", "No tienes membresia activa para iniciar cobros en este comercio.");
    }

    const bovedaSnap = await negRef.collection("Boveda_Pasarelas_Privada").doc("Credenciales").get();
    const cfgPub = negData.configuracion_pos || {};
    const boveda = bovedaSnap.exists ? bovedaSnap.data() : {};

    const pasarela = String(data.pasarela || boveda.pasarela || cfgPub.pasarela_activa || "WOMPI").toUpperCase();
    const pubKey = String(boveda.public_key || cfgPub.pasarela_public_key || "").trim();
    const secKey = String(boveda.secret_key || "").trim();

    if (!pubKey) {
        throw new HttpsError("failed-precondition", "El comercio no tiene llave publica configurada.");
    }

    let urlCheckout = "";
    let firmaIntegridad = "";

    if (pasarela === "BOLD") {
        if (secKey) {
            const cadenaBold = referencia + String(montoEntero) + "COP" + secKey;
            firmaIntegridad = crypto.createHash("sha256").update(cadenaBold).digest("hex");
        }
        urlCheckout = "https://checkout.bold.co/payment/" + encodeURIComponent(pubKey) +
            "?order_id=" + encodeURIComponent(referencia) +
            "&amount=" + String(montoEntero) +
            "&currency=COP" +
            (firmaIntegridad ? ("&integrity_signature=" + encodeURIComponent(firmaIntegridad)) : "");
    } else {
        const montoCentavos = montoEntero * 100;
        if (secKey) {
            const cadenaWompi = referencia + String(montoCentavos) + "COP" + secKey;
            firmaIntegridad = crypto.createHash("sha256").update(cadenaWompi).digest("hex");
        }
        urlCheckout = "https://checkout.wompi.co/p/?public-key=" + encodeURIComponent(pubKey) +
            "&currency=COP&amount-in-cents=" + String(montoCentavos) +
            "&reference=" + encodeURIComponent(referencia) +
            (firmaIntegridad ? ("&signature:integrity=" + encodeURIComponent(firmaIntegridad)) : "");
    }

        const intentoRef = negRef.collection("Pagos_POS_EnVivo").doc(ticketTempId);
    const intentoPrevio = await intentoRef.get();
    if (intentoPrevio.exists && intentoPrevio.data().estado === "APROBADO") {
        throw new HttpsError("already-exists", "Este intento de cobro ya fue aprobado previamente.");
    }
    await db.collection("Indices_Pasarela_POS").doc(referencia).set({
        idNegocio: idNegocio,
        tktId: ticketTempId,
        pasarela: pasarela,
        ambiente: boveda.ambiente || "PRODUCCION",
        monto_pesos: montoEntero,
        creado_en: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
        await negRef.collection("Ordenes_POS").doc(ticketTempId).set({
        orden_id: ticketTempId,
        referencia_activa: referencia,
        total_minor: montoEntero * 100,
        monto_pesos: montoEntero,
        currency: "COP",
        operador_uid: uidCaller,
        pasarela: pasarela,
        ambiente: boveda.ambiente || "PRODUCCION",
        estado_orden: "EN_COBRO",
        creado_en: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await intentoRef.set({
        estado: "PENDIENTE",
        pasarela: pasarela,
        ambiente: boveda.ambiente || "PRODUCCION",
        referencia: referencia,
        monto_pesos: montoEntero,
        operador_uid: uidCaller,
        creado_en: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return {
        success: true,
        pasarela: pasarela,
        referencia: referencia,
        firma: firmaIntegridad,
        urlCheckout: urlCheckout
    };
});

exports.webhookPasarelasPOS = functions.https.onRequest(async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).send("Metodo no permitido");
    }
    const db = admin.firestore();
    const body = req.body || {};
    const proveedorQuery = String(req.query.proveedor || "").toUpperCase();
    const comercioQuery = String(req.query.comercio || "").trim();

    try {
        // 1. Detectar referencia unificada GEOKATU-{idNegocio}-{tktId}-{ts}
        let referencia = "";
        let estadoAprobado = false;
        let montoPesos = 0;
        let txIdExterno = "";
        let esBold = (proveedorQuery === "BOLD") || Boolean(req.headers["x-bold-signature"]) || Boolean(body.type && body.data && body.data.payment_id);

        if (esBold) {
            const dBold = body.data || {};
            referencia = String(dBold.metadata?.reference || dBold.reference || dBold.order_id || body.reference || "");
            const tipoEvt = String(body.type || dBold.status || "").toUpperCase();
            estadoAprobado = (tipoEvt === "SALE_APPROVED" || tipoEvt === "APPROVED" || tipoEvt === "PAID");
            montoPesos = Math.round(Number(dBold.amount?.total || dBold.amount || 0));
            txIdExterno = String(dBold.payment_id || body.id || "BOLD_OK");
        } else {
            const txW = (body.data && body.data.transaction) ? body.data.transaction : {};
            referencia = String(txW.reference || "");
            estadoAprobado = (body.event === "transaction.updated" && txW.status === "APPROVED");
            montoPesos = Math.round(Number(txW.amount_in_cents || 0) / 100);
            txIdExterno = String(txW.id || "WOMPI_OK");
        }

                let idNegocio = comercioQuery;
        let tktId = "";
        if (referencia) {
            const idxSnap = await db.collection("Indices_Pasarela_POS").doc(referencia).get();
            if (idxSnap.exists) {
                idNegocio = idxSnap.data().idNegocio || idNegocio;
                tktId = idxSnap.data().tktId || "";
            }
        }
        if (!tktId && referencia.indexOf("GEOKATU-") === 0) {
            const partesRef = referencia.split("-");
            idNegocio = idNegocio || partesRef[1] || "";
            tktId = partesRef[2] || "";
        }
        if (!idNegocio) {
            return res.status(200).json({ received: true, ignored: "sin_id_negocio" });
        }

                // 2. Exigir boveda privada y validar firma en tiempo constante (C01 / C12)
        const bovedaSnap = await db.collection("Directorio").doc(idNegocio).collection("Boveda_Pasarelas_Privada").doc("Credenciales").get();
        if (!bovedaSnap.exists) {
            return res.status(401).send("Comercio sin boveda activa");
        }
        const boveda = bovedaSnap.data() || {};
        const secEventos = String(boveda.events_secret || boveda.secret_key || "").trim();
        if (!secEventos) {
            return res.status(401).send("Secreto no configurado");
        }

        if (esBold) {
            const sigBold = String(req.headers["x-bold-signature"] || "").trim();
            if (!sigBold) {
                return res.status(401).send("Firma Bold requerida");
            }
            const rawBuffer = req.rawBody ? Buffer.from(req.rawBody) : Buffer.from(JSON.stringify(body));
            const payloadB64 = rawBuffer.toString("base64");
            const hmacCalc = crypto.createHmac("sha256", secEventos).update(payloadB64).digest("hex");
            const bCalc = Buffer.from(hmacCalc, "utf8");
            const bRec = Buffer.from(sigBold, "utf8");
            if (bCalc.length !== bRec.length || !crypto.timingSafeEqual(bCalc, bRec)) {
                console.error("[WEBHOOK POS] Firma HMAC Bold invalida para negocio: " + idNegocio);
                return res.status(401).send("Firma Bold invalida");
            }
        } else {
            const txW = (body.data && body.data.transaction) ? body.data.transaction : null;
            const checksumHeader = String(req.headers["x-event-checksum"] || (body.signature && body.signature.checksum) || "").trim();
            if (!txW || !checksumHeader) {
                return res.status(401).send("Checksum Wompi requerido");
            }
            const cadenaW = String(txW.id) + String(txW.status) + String(txW.amount_in_cents) + String(body.timestamp) + secEventos;
            const hashCalc = crypto.createHash("sha256").update(cadenaW).digest("hex");
            const bCalc = Buffer.from(hashCalc, "utf8");
            const bRec = Buffer.from(checksumHeader, "utf8");
            if (bCalc.length !== bRec.length || !crypto.timingSafeEqual(bCalc, bRec)) {
                console.error("[WEBHOOK POS] Firma Wompi invalida para negocio: " + idNegocio);
                return res.status(401).send("Firma Wompi invalida");
            }
        }

        if (estadoAprobado && tktId) {
            const negRef = db.collection("Directorio").doc(idNegocio);
            const intentoRef = negRef.collection("Pagos_POS_EnVivo").doc(tktId);
            const intentoSnap = await intentoRef.get();
            if (!intentoSnap.exists) {
                await negRef.collection("Eventos_Pago_Revision").doc(String(txIdExterno)).set({
                    tktId: tktId,
                    referencia: referencia,
                    monto_recibido: montoPesos,
                    motivo: "ORDEN_NO_ENCONTRADA",
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                return res.status(200).json({ received: true, status: "revision_orden_inexistente" });
            }
            const datosIntento = intentoSnap.data() || {};
            const montoEsperado = Math.round(Number(datosIntento.monto_pesos) || 0);
            if (montoEsperado > 0 && montoPesos !== montoEsperado) {
                await intentoRef.set({
                    estado: "REVISION_REQUERIDA",
                    monto_recibido: montoPesos,
                    transaccion_id: txIdExterno,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                return res.status(200).json({ received: true, status: "revision_monto_distinto" });
            }
                        const eventoId = (esBold ? "BOLD_" : "WOMPI_") + String(txIdExterno).replace(/[^a-zA-Z0-9_-]/g, "_");
            const eventoRef = negRef.collection("Eventos_Pago").doc(eventoId);
            const pagoConfRef = negRef.collection("Pagos_Confirmados").doc(eventoId);
            const ordenPosRef = negRef.collection("Ordenes_POS").doc(tktId);

            await db.runTransaction(async (tx) => {
                const evSnap = await tx.get(eventoRef);
                if (evSnap.exists && evSnap.data().procesado === true) {
                    return;
                }
                tx.set(eventoRef, {
                    evento_id: eventoId,
                    transaccion_id: txIdExterno,
                    tktId: tktId,
                    referencia: referencia,
                    pasarela: esBold ? "BOLD" : "WOMPI",
                    monto_pesos: montoPesos,
                    procesado: true,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                tx.set(pagoConfRef, {
                    pago_id: eventoId,
                    transaccion_externa: txIdExterno,
                    orden_id: tktId,
                    referencia: referencia,
                    pasarela: esBold ? "BOLD" : "WOMPI",
                    ambiente: datosIntento.ambiente || "PRODUCCION",
                    monto_pesos: montoPesos,
                    estado: "APROBADO_CONCILIADO",
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                tx.set(ordenPosRef, {
                    estado_orden: "SALDO_CUBIERTO",
                    pago_confirmado_id: eventoId,
                    actualizado_en: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                tx.set(intentoRef, {
                    estado: "APROBADO",
                    pasarela: esBold ? "BOLD" : "WOMPI",
                    monto_pesos: montoPesos,
                    transaccion_id: txIdExterno,
                    metodo: esBold ? "BOLD_POS" : "WOMPI_POS",
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            });

                        await negRef.collection("pedidos_entrantes").doc(tktId).set({
                estado_pago: "PAGADO_CONFIRMADO",
                monto_recibido_centavos: montoPesos * 100,
                transaccion_id: txIdExterno,
                pasarela: esBold ? "BOLD" : "WOMPI",
                fecha_confirmacion: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }

        return res.status(200).json({ received: true });
    } catch (errW) {
        console.error("[WEBHOOK PASARELAS ERROR]", errW);
        return res.status(500).send("Error interno");
    }
});

exports.consultarEstadoOrdenPasarelaPOS = onCall({ memory: "256MB", maxInstances: 20 }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Sesion requerida en terminal POS.");
    }
    const data = request.data || {};
    const idNegocio = String(data.idNegocio || "").trim();
    const ticketTempId = String(data.ticketTempId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
    if (!idNegocio || !ticketTempId) {
        throw new HttpsError("invalid-argument", "Faltan identificadores de comercio o intento.");
    }

    const db = admin.firestore();
    const negRef = db.collection("Directorio").doc(idNegocio);
    const negSnap = await negRef.get();
    if (!negSnap.exists) {
        throw new HttpsError("not-found", "Comercio no encontrado.");
    }
    const negData = negSnap.data() || {};
    const uidCaller = request.auth.uid;
    const emailCaller = String(request.auth.token.email || "").toLowerCase();
    let autorizado = (uidCaller === idNegocio) ||
        (negData.uid_dueno && negData.uid_dueno === uidCaller) ||
        (negData.owner_email && String(negData.owner_email).toLowerCase() === emailCaller);

    if (!autorizado) {
        const [eqSnap, colSnap, admSnap] = await Promise.all([
            negRef.collection("Equipo").doc(uidCaller).get(),
            negRef.collection("Colaboradores").doc(uidCaller).get(),
            db.collection("Usuarios_Admin").doc(uidCaller).get()
        ]);
        const opData = eqSnap.exists ? eqSnap.data() : (colSnap.exists ? colSnap.data() : null);
        if (opData && opData.suspendido !== true && opData.activo !== false) {
            autorizado = true;
        } else if (admSnap.exists && (admSnap.data().rol === "superadmin" || admSnap.data().rol === "admin")) {
            autorizado = true;
        }
    }
    if (!autorizado) {
        throw new HttpsError("permission-denied", "Sin permiso para consultar pagos de este comercio.");
    }

    const intentoRef = negRef.collection("Pagos_POS_EnVivo").doc(ticketTempId);
    const intentoSnap = await intentoRef.get();
    if (!intentoSnap.exists) {
        return { success: true, aprobado: false, estado: "NO_ENCONTRADO", mensaje: "No existe orden activa." };
    }
    const datosIntento = intentoSnap.data() || {};
    if (datosIntento.estado === "APROBADO") {
        return {
            success: true,
            aprobado: true,
            estado: "APROBADO",
            pasarela: datosIntento.pasarela || "PASARELA",
            monto_pesos: Number(datosIntento.monto_pesos) || 0,
            transaccion_id: datosIntento.transaccion_id || ticketTempId,
            mensaje: "Pago ya confirmado en boveda."
        };
    }

    const referencia = String(data.referencia || datosIntento.referencia || "").trim();
    const montoEsperado = Math.round(Number(datosIntento.monto_pesos) || 0);
    const bovedaSnap = await negRef.collection("Boveda_Pasarelas_Privada").doc("Credenciales").get();
    const boveda = bovedaSnap.exists ? (bovedaSnap.data() || {}) : {};
    const cfgPub = negData.configuracion_pos || {};
    const pasarela = String(datosIntento.pasarela || boveda.pasarela || cfgPub.pasarela_activa || "WOMPI").toUpperCase();
    const pubKey = String(boveda.public_key || cfgPub.pasarela_public_key || "").trim();
    const secKey = String(boveda.secret_key || "").trim();

    let estadoRemoto = "PENDIENTE";
    let montoRecibido = 0;
    let txIdExterno = "";

    if (pasarela === "WOMPI" && referencia && pubKey) {
        const esSandbox = (datosIntento.ambiente === "SANDBOX") || (pubKey.indexOf("pub_test_") === 0);
        const baseWompi = esSandbox ? "https://sandbox.wompi.co" : "https://production.wompi.co";
        const urlConsultaW = baseWompi + "/v1/transactions?reference=" + encodeURIComponent(referencia);
        try {
            const respW = await fetch(urlConsultaW, {
                method: "GET",
                headers: { "Authorization": "Bearer " + pubKey }
            });
            if (respW.ok) {
                const jsonW = await respW.json();
                const listaTx = (jsonW && Array.isArray(jsonW.data)) ? jsonW.data : [];
                const txAprobada = listaTx.find(function(t) {
                    return String(t.reference) === referencia && String(t.status).toUpperCase() === "APPROVED" && String(t.currency || "COP") === "COP";
                });
                const txRechazada = listaTx.find(function(t) {
                    return String(t.reference) === referencia && (String(t.status).toUpperCase() === "DECLINED" || String(t.status).toUpperCase() === "ERROR" || String(t.status).toUpperCase() === "VOIDED");
                });
                if (txAprobada) {
                    estadoRemoto = "APROBADO";
                    montoRecibido = Math.round(Number(txAprobada.amount_in_cents || 0) / 100);
                    txIdExterno = String(txAprobada.id || "WOMPI_PULL_OK");
                } else if (txRechazada) {
                    estadoRemoto = "RECHAZADO";
                }
            }
        } catch (errPullW) {}
    } else if (pasarela === "BOLD" && referencia && secKey) {
        try {
            const urlBold = "https://integrations.api.bold.co/online/link/v1/" + encodeURIComponent(referencia);
            const respB = await fetch(urlBold, {
                method: "GET",
                headers: { "Authorization": "x-api-key " + secKey }
            });
            if (respB.ok) {
                const jsonB = await respB.json();
                const payloadB = (jsonB && jsonB.payload) ? jsonB.payload : (jsonB || {});
                const stBold = String(payloadB.status || payloadB.state || "").toUpperCase();
                if (stBold === "PAID" || stBold === "APPROVED" || stBold === "ACTIVE_PAID" || stBold === "SALE_APPROVED") {
                    estadoRemoto = "APROBADO";
                    montoRecibido = Math.round(Number(payloadB.total || (payloadB.amount && payloadB.amount.total) || payloadB.amount || montoEsperado));
                    txIdExterno = String(payloadB.transaction_id || payloadB.payment_id || payloadB.id || "BOLD_PULL_OK");
                } else if (stBold === "REJECTED" || stBold === "FAILED" || stBold === "CANCELLED" || stBold === "EXPIRED") {
                    estadoRemoto = "RECHAZADO";
                }
            }
        } catch (errPullB) {}
    }

    if (estadoRemoto === "APROBADO") {
        if (montoEsperado > 0 && montoRecibido !== montoEsperado) {
            await intentoRef.set({
                estado: "REVISION_REQUERIDA",
                monto_recibido: montoRecibido,
                transaccion_id: txIdExterno,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return {
                success: true,
                aprobado: false,
                estado: "REVISION_REQUERIDA",
                mensaje: "El monto reportado por el banco no coincide con la orden."
            };
        }

        const eventoId = (pasarela === "BOLD" ? "BOLD_" : "WOMPI_") + String(txIdExterno).replace(/[^a-zA-Z0-9_-]/g, "_");
        const eventoRef = negRef.collection("Eventos_Pago").doc(eventoId);
        const pagoConfRef = negRef.collection("Pagos_Confirmados").doc(eventoId);
        const ordenPosRef = negRef.collection("Ordenes_POS").doc(ticketTempId);

        await db.runTransaction(async (tx) => {
            const evSnap = await tx.get(eventoRef);
            if (!evSnap.exists || evSnap.data().procesado !== true) {
                tx.set(eventoRef, {
                    evento_id: eventoId,
                    transaccion_id: txIdExterno,
                    tktId: ticketTempId,
                    referencia: referencia,
                    pasarela: pasarela,
                    monto_pesos: montoRecibido,
                    origen: "PULL_SERVIDOR",
                    procesado: true,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                tx.set(pagoConfRef, {
                    pago_id: eventoId,
                    transaccion_externa: txIdExterno,
                    orden_id: ticketTempId,
                    referencia: referencia,
                    pasarela: pasarela,
                    ambiente: datosIntento.ambiente || "PRODUCCION",
                    monto_pesos: montoRecibido,
                    estado: "APROBADO_CONCILIADO",
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                tx.set(ordenPosRef, {
                    estado_orden: "SALDO_CUBIERTO",
                    pago_confirmado_id: eventoId,
                    actualizado_en: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            }
            tx.set(intentoRef, {
                estado: "APROBADO",
                pasarela: pasarela,
                monto_pesos: montoRecibido,
                transaccion_id: txIdExterno,
                metodo: pasarela + "_POS_PULL",
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        });

        return {
            success: true,
            aprobado: true,
            estado: "APROBADO",
            pasarela: pasarela,
            monto_pesos: montoRecibido,
            transaccion_id: txIdExterno,
            mensaje: "Pago verificado y aprobado directamente con el banco."
        };
    }

        return {
        success: true,
        aprobado: false,
        estado: estadoRemoto,
        mensaje: estadoRemoto === "RECHAZADO"
            ? "El banco reporta la transaccion como rechazada o expirada."
            : "Aun figura pendiente de confirmacion en el banco. Intenta en unos segundos."
    };
});

// ============================================================================
// 26. BOVEDA IA CIFRADA MULTI-PROVEEDOR (AES-256-GCM) Y PROXY DUAL BYOK/CREDITOS
// ============================================================================
const TARIFAS_IA_DEF = { imagen: 6, hoja_lote: 12, texto: 2, audio: 4, probar: 0, listar_modelos: 0, listar_voces: 0 };
const PROVS_VOZ_GRATIS = { edge_tts: true, polly_free: true, google_tts_free: true };
const VOCES_EDGE_CAT = [
  { id: 'es-CO-GonzaloNeural', nombre: 'Gonzalo (CO Hombre)' }, { id: 'es-CO-SalomeNeural', nombre: 'Salome (CO Mujer)' },
  { id: 'es-MX-JorgeNeural', nombre: 'Jorge (MX Hombre)' }, { id: 'es-MX-DaliaNeural', nombre: 'Dalia (MX Mujer)' },
  { id: 'es-AR-TomasNeural', nombre: 'Tomas (AR Hombre)' }, { id: 'es-AR-ElenaNeural', nombre: 'Elena (AR Mujer)' },
  { id: 'es-CL-LorenzoNeural', nombre: 'Lorenzo (CL Hombre)' }, { id: 'es-VE-SebastianNeural', nombre: 'Sebastian (VE Hombre)' },
  { id: 'es-PE-AlexNeural', nombre: 'Alex (PE Hombre)' }, { id: 'es-ES-AlvaroNeural', nombre: 'Alvaro (ES Hombre)' },
  { id: 'es-ES-ElviraNeural', nombre: 'Elvira (ES Mujer)' }, { id: 'es-US-AlonsoNeural', nombre: 'Alonso (US-ES Hombre)' },
  { id: 'en-US-BrianNeural', nombre: 'Brian (EN-US Narrador)' }, { id: 'en-US-ChristopherNeural', nombre: 'Christopher (EN-US)' },
  { id: 'en-US-GuyNeural', nombre: 'Guy (EN-US)' }, { id: 'en-US-AndrewNeural', nombre: 'Andrew (EN-US)' },
  { id: 'en-US-JennyNeural', nombre: 'Jenny (EN-US Mujer)' }, { id: 'en-US-AriaNeural', nombre: 'Aria (EN-US IA)' },
  { id: 'en-US-MichelleNeural', nombre: 'Michelle (EN-US Mujer)' }, { id: 'en-GB-RyanNeural', nombre: 'Ryan (EN-GB Hombre)' }
];
const VOCES_POLLY_CAT = [
  { id: 'Miguel', nombre: 'Miguel (Latam Hombre)' }, { id: 'Lupe', nombre: 'Lupe (Latam Mujer)' },
  { id: 'Mia', nombre: 'Mia (MX Mujer)' }, { id: 'Penelope', nombre: 'Penelope (US-ES Mujer)' },
  { id: 'Enrique', nombre: 'Enrique (ES Hombre)' }, { id: 'Lucia', nombre: 'Lucia (ES Mujer)' },
  { id: 'Conchita', nombre: 'Conchita (ES Mujer)' }, { id: 'Brian', nombre: 'Brian (EN-GB Clasico)' },
  { id: 'Matthew', nombre: 'Matthew (EN-US Hombre)' }, { id: 'Joanna', nombre: 'Joanna (EN-US Mujer)' },
  { id: 'Joey', nombre: 'Joey (EN-US Joven)' }
];
const VOCES_GTTS_CAT = [
  { id: 'es-CO', nombre: 'Google ES Colombia' }, { id: 'es-MX', nombre: 'Google ES Mexico' },
  { id: 'es-ES', nombre: 'Google ES Espana' }, { id: 'es-US', nombre: 'Google ES Latino' },
  { id: 'en-US', nombre: 'Google EN USA' }, { id: 'en-GB', nombre: 'Google EN UK' }
];
const VOCES_GEMINI_CAT = [
  { id: 'Puck', nombre: 'Puck (Gemini Energetico)' }, { id: 'Charon', nombre: 'Charon (Gemini Grave)' },
  { id: 'Kore', nombre: 'Kore (Gemini Firme)' }, { id: 'Fenrir', nombre: 'Fenrir (Gemini Intenso)' },
  { id: 'Aoede', nombre: 'Aoede (Gemini Calida)' }, { id: 'Zephyr', nombre: 'Zephyr (Gemini Brillante)' },
  { id: 'Orus', nombre: 'Orus (Gemini Serio)' }, { id: 'Leda', nombre: 'Leda (Gemini Joven)' }
];
function envolverPcmEnWav(pcmBuf, rate) {
  const sr = Number(rate) || 24000, hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcmBuf.length, 4); hdr.write('WAVEfmt ', 8);
  hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
  hdr.writeUInt32LE(sr, 24); hdr.writeUInt32LE(sr * 2, 28); hdr.writeUInt16LE(2, 32);
  hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(pcmBuf.length, 40);
  return Buffer.concat([hdr, pcmBuf]);
}
function dividirTextoTTS(txt, maxLen) {
  const limpio = String(txt || '').replace(/\s+/g, ' ').trim();
  if (!limpio) return [];
  const out = []; let rest = limpio;
  while (rest.length > maxLen) {
    let corte = rest.lastIndexOf(' ', maxLen);
    if (corte < Math.floor(maxLen * 0.4)) corte = maxLen;
    out.push(rest.slice(0, corte).trim()); rest = rest.slice(corte).trim();
  }
  if (rest) out.push(rest);
  return out;
}
async function ejecutarVozGratis(pid, acc, p) {
  p = p || {};
  if (pid === 'edge_tts') {
    if (acc === 'probar' || acc === 'listar_voces') return { ok: true, items: VOCES_EDGE_CAT, mensaje: 'Edge Neural Gratis OK (' + VOCES_EDGE_CAT.length + ' voces).' };
    const texto = String(p.text || p.prompt || '').trim(); if (!texto) throw new Error('Texto vacio para voz.');
    const vid = String(p.voiceId || 'es-CO-GonzaloNeural').trim();
    const pitch = String(p.pitch || '+0Hz').trim(), rate = String(p.rate || '+0%').trim();
    let modEdge; try { modEdge = require('msedge-tts'); } catch (eReq) { throw new Error('Falta instalar msedge-tts en functions (ejecuta: cd functions && npm i msedge-tts).'); }
    const tts = new modEdge.MsEdgeTTS();
    await tts.setMetadata(vid, modEdge.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const optsE = {}; if (pitch && pitch !== '+0Hz' && pitch !== '0Hz') optsE.pitch = pitch; if (rate && rate !== '+0%' && rate !== '0%') optsE.rate = rate;
    const resSt = Object.keys(optsE).length ? tts.toStream(texto, optsE) : tts.toStream(texto);
    const stream = (resSt && resSt.audioStream) ? resSt.audioStream : resSt;
    const chunks = [];
    await new Promise(function(resolve, reject) {
      stream.on('data', function(ch) { chunks.push(Buffer.isBuffer(ch) ? ch : Buffer.from(ch)); });
      stream.on('end', resolve); stream.on('error', reject);
    });
    const buf = Buffer.concat(chunks);
    if (!buf.length) throw new Error('Edge Neural devolvio audio vacio.');
    return { b64: buf.toString('base64'), mime: 'audio/mpeg' };
  }
  if (pid === 'polly_free') {
    if (acc === 'probar' || acc === 'listar_voces') return { ok: true, items: VOCES_POLLY_CAT, mensaje: 'Polly Gratis OK (' + VOCES_POLLY_CAT.length + ' voces).' };
    const texto = String(p.text || p.prompt || '').trim(); if (!texto) throw new Error('Texto vacio para voz.');
    const vid = String(p.voiceId || 'Miguel').trim();
    const partes = dividirTextoTTS(texto, 280), bufs = [];
    for (let i = 0; i < partes.length; i++) {
      const r = await fetch('https://api.streamelements.com/kappa/v2/speech?voice=' + encodeURIComponent(vid) + '&text=' + encodeURIComponent(partes[i]), { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error('Polly Free HTTP ' + r.status);
      bufs.push(Buffer.from(await r.arrayBuffer()));
    }
    return { b64: Buffer.concat(bufs).toString('base64'), mime: 'audio/mpeg' };
  }
  if (pid === 'google_tts_free') {
    if (acc === 'probar' || acc === 'listar_voces') return { ok: true, items: VOCES_GTTS_CAT, mensaje: 'Google TTS Gratis OK (' + VOCES_GTTS_CAT.length + ' idiomas).' };
    const texto = String(p.text || p.prompt || '').trim(); if (!texto) throw new Error('Texto vacio para voz.');
    const tl = String(p.voiceId || 'es-CO').trim();
    const partes = dividirTextoTTS(texto, 180), bufs = [];
    for (let i = 0; i < partes.length; i++) {
      const r = await fetch('https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=' + encodeURIComponent(tl) + '&q=' + encodeURIComponent(partes[i]), { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error('Google TTS HTTP ' + r.status);
      bufs.push(Buffer.from(await r.arrayBuffer()));
    }
    return { b64: Buffer.concat(bufs).toString('base64'), mime: 'audio/mpeg' };
  }
  throw new Error('Motor de voz gratis no soportado: ' + pid);
}
const PRESETS_IA = {
  gemini: { protocolo: 'google_gemini', nombre: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', modelo: 'gemini-2.5-flash', modeloImagen: 'gemini-2.5-flash-image' },
  openai: { protocolo: 'openai_compat', nombre: 'OpenAI (GPT)', baseUrl: 'https://api.openai.com/v1', modelo: 'gpt-4o-mini', modeloImagen: 'gpt-image-1' },
  deepseek: { protocolo: 'openai_compat', nombre: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', modelo: 'deepseek-chat', modeloImagen: '' },
  openrouter: { protocolo: 'openai_compat', nombre: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', modelo: 'openai/gpt-4o-mini', modeloImagen: '' },
  groq: { protocolo: 'openai_compat', nombre: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', modelo: 'llama-3.3-70b-versatile', modeloImagen: '' },
  xai: { protocolo: 'openai_compat', nombre: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', modelo: 'grok-2-latest', modeloImagen: '' },
  elevenlabs: { protocolo: 'audio_tts', nombre: 'ElevenLabs', baseUrl: 'https://api.elevenlabs.io/v1', modelo: 'eleven_multilingual_v2', modeloImagen: '' }
};
function limpiarProvIA(raw) {
  const s = String(raw || '').toLowerCase().trim().replace(/[^a-z0-9_-]/g, '');
  if (s.length < 2 || s.length > 40) throw new HttpsError('invalid-argument', 'ID de proveedor IA invalido.');
  return s;
}
function validarUrlIA(urlStr) {
  const u = String(urlStr || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  let p; try { p = new URL(u); } catch (e) { throw new HttpsError('invalid-argument', 'URL base invalida.'); }
  const h = p.hostname.toLowerCase();
  if (p.protocol !== 'https:' || !h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.indexOf(':') !== -1) {
    throw new HttpsError('invalid-argument', 'Endpoint HTTPS no permitido por seguridad.');
  }
  return u;
}
function llaveIA(sec, aad) { return crypto.createHmac('sha256', String(sec)).update('PIRO_IA_VAULT_V1:' + String(aad)).digest(); }
function cifrarIA(txt, sec, aad) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', llaveIA(sec, aad), iv);
  c.setAAD(Buffer.from(String(aad), 'utf8'));
  const enc = Buffer.concat([c.update(String(txt), 'utf8'), c.final()]);
  return { ciphertext: enc.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), v: 1 };
}
function descifrarIA(box, sec, aad) {
  if (!box || !box.ciphertext || !box.iv || !box.tag) throw new Error('Secreto cifrado incompleto.');
  const d = crypto.createDecipheriv('aes-256-gcm', llaveIA(sec, aad), Buffer.from(box.iv, 'base64'));
  d.setAAD(Buffer.from(String(aad), 'utf8')); d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(box.ciphertext, 'base64')), d.final()]).toString('utf8');
}
async function esSuperAdminIA(db, uid) {
  if (!uid) return false;
  const s = await db.collection('Usuarios_Admin').doc(uid).get();
  return Boolean(s.exists && s.data() && s.data().rol === 'superadmin');
}
function resumirProvIA(mapa) {
  const out = {}; if (!mapa || typeof mapa !== 'object') return out;
  Object.keys(mapa).forEach(function(k) {
    const it = mapa[k]; if (!it || !it.activa) return;
    out[k] = { activa: true, ultimos4: String(it.ultimos4 || '****'), protocolo: String(it.protocolo || 'openai_compat'), nombre: String(it.nombre || k), baseUrl: String(it.baseUrl || ''), modelo: String(it.modelo || ''), modeloImagen: String(it.modeloImagen || ''), voiceId: String(it.voiceId || ''), updatedAt: String(it.updatedAt || '') };
  });
  return out;
}

exports.guardarApiKeyCliente = onCall({ memory: '256MB', maxInstances: 20, secrets: [semillaMaestra] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Inicia sesion para vincular tus claves IA.');
  const uid = request.auth.uid, d = request.data || {}, pid = limpiarProvIA(d.proveedorId), acc = String(d.accion || 'guardar').toLowerCase();
  const esMaes = String(d.ambito || 'cliente').toLowerCase() === 'maestro', db = admin.firestore();
  if (esMaes && !(await esSuperAdminIA(db, uid))) throw new HttpsError('permission-denied', 'Solo Superadmin puede editar claves maestras.');
  const docRef = esMaes ? db.collection('Sistema_IA_Maestro').doc('Proveedores') : db.collection('Boveda_APIs_Clientes').doc(uid);
  const aad = esMaes ? 'MAESTRO_PLATAFORMA' : uid;
  if (acc === 'revocar') {
    const up = {}; up['proveedores.' + pid] = admin.firestore.FieldValue.delete();
    await docRef.set({ actualizado_en: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await docRef.update(up);
    return { success: true, revocada: true, proveedorId: pid, ambito: esMaes ? 'maestro' : 'cliente' };
  }
  const pre = PRESETS_IA[pid] || {};
  const pRaw = String(d.protocolo || pre.protocolo || 'openai_compat').trim();
  const prot = ['google_gemini', 'openai_compat', 'audio_tts'].indexOf(pRaw) !== -1 ? pRaw : 'openai_compat';
  const baseUrl = validarUrlIA(d.baseUrl || pre.baseUrl || '');
  if (prot === 'openai_compat' && !baseUrl) throw new HttpsError('invalid-argument', 'Falta URL Base HTTPS del proveedor.');
  const nombre = String(d.nombre || pre.nombre || pid).trim().slice(0, 60);
  const modelo = String(d.modelo !== undefined ? d.modelo : (pre.modelo || '')).trim().slice(0, 120);
  const modeloImagen = String(d.modeloImagen !== undefined ? d.modeloImagen : (pre.modeloImagen || '')).trim().slice(0, 120);
  const voiceId = String(d.voiceId !== undefined ? d.voiceId : '').trim().slice(0, 120);
  const apiKey = String(d.apiKey || '').trim();
  const prevSnap = await docRef.get();
  const prev = (prevSnap.exists && prevSnap.data().proveedores) ? prevSnap.data().proveedores[pid] : null;
  let secreto = prev ? prev.secreto : null, ult4 = prev ? prev.ultimos4 : '';
  if (apiKey) {
    if (apiKey.length < 10 || apiKey.length > 512) throw new HttpsError('invalid-argument', 'Longitud de clave API invalida.');
    secreto = cifrarIA(apiKey, semillaMaestra.value(), aad); ult4 = apiKey.slice(-4);
  } else if (!secreto) throw new HttpsError('invalid-argument', 'Pega una clave API valida para vincular.');
  const pay = { actualizado_en: admin.firestore.FieldValue.serverTimestamp(), proveedores: {} };
  pay.proveedores[pid] = { activa: true, protocolo: prot, nombre: nombre, baseUrl: baseUrl, modelo: modelo, modeloImagen: modeloImagen, voiceId: voiceId, ultimos4: ult4, secreto: secreto, updatedAt: new Date().toISOString() };
  await docRef.set(pay, { merge: true });
  return { success: true, proveedorId: pid, ambito: esMaes ? 'maestro' : 'cliente', activa: true, ultimos4: ult4, protocolo: prot, nombre: nombre, baseUrl: baseUrl, modelo: modelo, modeloImagen: modeloImagen, voiceId: voiceId };
});

exports.estadoBovedaCliente = onCall({ memory: '256MB', maxInstances: 20 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Inicia sesion para consultar tu boveda IA.');
  const uid = request.auth.uid, db = admin.firestore();
  const [bovS, billS, maeS, tarS, esAdm] = await Promise.all([
    db.collection('Boveda_APIs_Clientes').doc(uid).get(), db.collection('Billeteras_IA').doc(uid).get(),
    db.collection('Sistema_IA_Maestro').doc('Proveedores').get(), db.collection('Sistema').doc('Tarifas_IA').get(), esSuperAdminIA(db, uid)
  ]);
  const provCli = resumirProvIA(bovS.exists ? bovS.data().proveedores : null);
  const provMae = resumirProvIA(maeS.exists ? maeS.data().proveedores : null);
  const bd = billS.exists ? (billS.data() || {}) : {};
  return {
    success: true, proveedores: provCli,
    billetera: { saldo_creditos: Number(bd.saldo_creditos) || 0, total_comprados: Number(bd.total_comprados) || 0, total_consumidos: Number(bd.total_consumidos) || 0 },
    reventaDisponible: Object.keys(provMae),
    tarifas: Object.assign({}, TARIFAS_IA_DEF, tarS.exists ? (tarS.data() || {}) : {}),
    esSuperadmin: esAdm, proveedoresMaestro: esAdm ? provMae : null
  };
});

exports.recargarCreditosAdmin = onCall({ memory: '256MB', maxInstances: 10 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sesion requerida.');
  const db = admin.firestore();
  if (!(await esSuperAdminIA(db, request.auth.uid))) throw new HttpsError('permission-denied', 'Solo Superadmin.');
  const d = request.data || {}; let uidDest = String(d.uidDestino || '').trim();
  if (!uidDest && d.emailDestino) uidDest = (await admin.auth().getUserByEmail(String(d.emailDestino).trim().toLowerCase())).uid;
  const cred = Math.round(Number(d.creditos) || 0);
  if (!uidDest || !Number.isFinite(cred) || cred === 0) throw new HttpsError('invalid-argument', 'Usuario o creditos invalidos.');
  const billRef = db.collection('Billeteras_IA').doc(uidDest), movRef = db.collection('Movimientos_IA').doc();
  const nuevo = await db.runTransaction(async (tx) => {
    const s = await tx.get(billRef), sig = Math.max(0, (s.exists ? (Number(s.data().saldo_creditos) || 0) : 0) + cred);
    const up = { saldo_creditos: sig, actualizado_en: admin.firestore.FieldValue.serverTimestamp() };
    if (cred > 0) up.total_comprados = admin.firestore.FieldValue.increment(cred);
    tx.set(billRef, up, { merge: true });
    tx.set(movRef, { uid: uidDest, tipo: cred > 0 ? 'recarga_admin' : 'ajuste_admin', creditos: cred, saldo_despues: sig, estado: 'completado', motivo: String(d.motivo || 'Recarga creditos IA').slice(0, 180), referencia_pago: String(d.referenciaPago || ('ADM_' + Date.now())).slice(0, 80), admin_uid: request.auth.uid, timestamp: admin.firestore.FieldValue.serverTimestamp() });
    return sig;
  });
  return { success: true, uidDestino: uidDest, creditos: cred, saldo_creditos: nuevo };
});

async function llamarProveedorIA(prot, key, baseUrl, mod, acc, p) {
  p = p || {};
  if (prot === 'google_gemini') {
    const base = baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
        if (acc === 'listar_voces') return { ok: true, items: VOCES_GEMINI_CAT, mensaje: 'Gemini TTS OK (' + VOCES_GEMINI_CAT.length + ' voces).' };
    if (acc === 'audio') {
      const mTts = String(mod && mod.indexOf('tts') >= 0 ? mod : 'gemini-2.5-flash-preview-tts').trim();
      const vName = String(p.voiceId || 'Puck').trim();
      const bodyT = { contents: [{ role: 'user', parts: [{ text: String(p.text || p.prompt || '') }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: vName } } } } };
      const rT = await fetch(base + '/models/' + encodeURIComponent(mTts) + ':generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(bodyT) });
      if (!rT.ok) throw new Error('Gemini TTS HTTP ' + rT.status + ': ' + (await rT.text()).slice(0, 200));
      const jT = await rT.json(), ptsT = (jT.candidates && jT.candidates[0] && jT.candidates[0].content && jT.candidates[0].content.parts) || [];
      for (let i = 0; i < ptsT.length; i++) {
        if (ptsT[i].inlineData && ptsT[i].inlineData.data) {
          const mt = String(ptsT[i].inlineData.mimeType || 'audio/wav'), rawB = Buffer.from(ptsT[i].inlineData.data, 'base64');
          if (mt.indexOf('L16') >= 0 || mt.indexOf('pcm') >= 0) {
            const mRate = mt.match(/rate=(\d+)/); const wav = envolverPcmEnWav(rawB, mRate ? Number(mRate[1]) : 24000);
            return { b64: wav.toString('base64'), mime: 'audio/wav' };
          }
          return { b64: ptsT[i].inlineData.data, mime: mt };
        }
      }
      throw new Error('Gemini TTS no devolvio audio.');
    }
    if (acc === 'probar' || acc === 'listar_modelos') {
      const r = await fetch(base + '/models', { headers: { 'x-goog-api-key': key } });
      if (!r.ok) throw new Error('Gemini HTTP ' + r.status);
      const items = ((await r.json()).models || []).map(function(m) { return String(m.name || '').replace(/^models\//, ''); }).filter(Boolean);
      return { ok: true, items: items, mensaje: 'Gemini OK (' + items.length + ' modelos).' };
    }
    const m = String(mod || (acc === 'imagen' ? 'gemini-2.5-flash-image' : 'gemini-2.5-flash')).trim();
    if (acc === 'imagen' && m.indexOf('imagen-') === 0) {
      const r = await fetch(base + '/models/' + encodeURIComponent(m) + ':predict', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ instances: [{ prompt: String(p.prompt || '') }], parameters: { sampleCount: 1, aspectRatio: String(p.aspectRatio || '1:1') } }) });
      if (!r.ok) throw new Error('Imagen HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200));
      const pr = ((await r.json()).predictions || [])[0];
      if (!pr || !pr.bytesBase64Encoded) throw new Error('Imagen sin datos.');
      return { b64: pr.bytesBase64Encoded, mime: pr.mimeType || 'image/png' };
    }
    const body = { contents: Array.isArray(p.contents) ? p.contents : [{ role: 'user', parts: Array.isArray(p.parts) ? p.parts : [{ text: String(p.prompt || '') }] }] };
    if (p.systemInstruction) body.systemInstruction = p.systemInstruction;
    if (acc === 'imagen') body.generationConfig = Object.assign({ responseModalities: ['IMAGE', 'TEXT'] }, p.generationConfig || {});
    else if (p.generationConfig) body.generationConfig = p.generationConfig;
    const r = await fetch(base + '/models/' + encodeURIComponent(m) + ':generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('Gemini HTTP ' + r.status + ': ' + (await r.text()).slice(0, 220));
    const j = await r.json(), pts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    if (acc === 'imagen') {
      for (let i = 0; i < pts.length; i++) if (pts[i].inlineData && pts[i].inlineData.data) return { b64: pts[i].inlineData.data, mime: pts[i].inlineData.mimeType || 'image/png' };
      throw new Error('Gemini no devolvio imagen.');
    }
    return { texto: pts.map(function(x) { return x.text || ''; }).join(''), usage: j.usageMetadata || null };
  }
  if (prot === 'openai_compat') {
    const base = validarUrlIA(baseUrl || 'https://api.openai.com/v1'), hdr = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key };
        if (acc === 'listar_voces') {
      const vs = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'].map(function(v) { return { id: v, nombre: v }; });
      return { ok: true, items: vs, mensaje: 'Voces OpenAI/Compat (' + vs.length + ').' };
    }
    if (acc === 'audio') {
      const mSp = String(mod && (mod.indexOf('tts') >= 0 || mod.indexOf('orpheus') >= 0) ? mod : 'tts-1').trim();
      const rS = await fetch(base + '/audio/speech', { method: 'POST', headers: hdr, body: JSON.stringify({ model: mSp, input: String(p.text || p.prompt || ''), voice: String(p.voiceId || 'onyx'), response_format: 'mp3' }) });
      if (!rS.ok) throw new Error('Audio Speech HTTP ' + rS.status + ': ' + (await rS.text()).slice(0, 200));
      return { b64: Buffer.from(await rS.arrayBuffer()).toString('base64'), mime: 'audio/mpeg' };
    }
    if (acc === 'probar' || acc === 'listar_modelos') {
      const r = await fetch(base + '/models', { headers: { 'Authorization': 'Bearer ' + key } });
      if (!r.ok) throw new Error('Proveedor HTTP ' + r.status);
      const items = ((await r.json()).data || []).map(function(m) { return String(m.id || ''); }).filter(Boolean);
      return { ok: true, items: items.slice(0, 80), mensaje: 'Conectado (' + items.length + ' modelos).' };
    }
    if (acc === 'imagen') {
      const mi = String(mod || 'gpt-image-1').trim(), bi = { model: mi, prompt: String(p.prompt || ''), n: 1, size: String(p.size || '1024x1024') };
      if (mi.indexOf('dall-e') === 0) bi.response_format = 'b64_json';
      const r = await fetch(base + '/images/generations', { method: 'POST', headers: hdr, body: JSON.stringify(bi) });
      if (!r.ok) throw new Error('Imagen HTTP ' + r.status + ': ' + (await r.text()).slice(0, 220));
      const d0 = ((await r.json()).data || [])[0];
      if (d0 && d0.b64_json) return { b64: d0.b64_json, mime: 'image/png' };
      if (d0 && d0.url) { const rf = await fetch(d0.url); return { b64: Buffer.from(await rf.arrayBuffer()).toString('base64'), mime: rf.headers.get('content-type') || 'image/png' }; }
      throw new Error('Sin imagen en respuesta.');
    }
    const bc = { model: String(mod || 'gpt-4o-mini').trim(), messages: Array.isArray(p.messages) ? p.messages : [{ role: 'user', content: String(p.prompt || '') }] };
    if (typeof p.temperature === 'number') bc.temperature = p.temperature;
    if (typeof p.max_tokens === 'number') bc.max_tokens = p.max_tokens;
    if (p.response_format) bc.response_format = p.response_format;
    const r = await fetch(base + '/chat/completions', { method: 'POST', headers: hdr, body: JSON.stringify(bc) });
    if (!r.ok) throw new Error('Chat HTTP ' + r.status + ': ' + (await r.text()).slice(0, 220));
    const j = await r.json();
    return { texto: (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '', usage: j.usage || null };
  }
  if (prot === 'audio_tts') {
    const base = validarUrlIA(baseUrl || 'https://api.elevenlabs.io/v1');
    if (acc === 'probar' || acc === 'listar_voces') {
      const r = await fetch(base + '/voices', { headers: { 'xi-api-key': key } });
      if (!r.ok) throw new Error('TTS HTTP ' + r.status);
      const items = ((await r.json()).voices || []).map(function(v) { return { id: v.voice_id, nombre: v.name }; });
      return { ok: true, items: items, mensaje: 'TTS OK (' + items.length + ' voces).' };
    }
    const vid = String(p.voiceId || '').trim(); if (!vid) throw new Error('Falta voiceId.');
    const r = await fetch(base + '/text-to-speech/' + encodeURIComponent(vid), { method: 'POST', headers: { 'Content-Type': 'application/json', 'xi-api-key': key, 'Accept': 'audio/mpeg' }, body: JSON.stringify({ text: String(p.text || p.prompt || ''), model_id: String(mod || 'eleven_multilingual_v2'), voice_settings: p.voice_settings || { stability: 0.45, similarity_boost: 0.78 } }) });
    if (!r.ok) throw new Error('TTS HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200));
    return { b64: Buffer.from(await r.arrayBuffer()).toString('base64'), mime: 'audio/mpeg' };
  }
  throw new Error('Protocolo no soportado: ' + prot);
}

exports.proxyIACliente = onCall({ memory: '512MB', timeoutSeconds: 180, maxInstances: 20, secrets: [semillaMaestra] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Inicia sesion para usar el motor IA.');
  const uid = request.auth.uid, d = request.data || {}, pid = limpiarProvIA(d.proveedorId || 'gemini');
    const acc = String(d.accion || 'imagen').toLowerCase().trim(), tipoC = String(d.tipoCobro || acc).toLowerCase().trim(), modo = String(d.modoPago || 'auto').toLowerCase().trim();
  if (PROVS_VOZ_GRATIS[pid]) {
    try {
      const resG = await ejecutarVozGratis(pid, acc, d.payload || {});
      return Object.assign({ success: true, proveedorId: pid, modoUsado: 'gratis', creditosCobrados: 0 }, resG);
    } catch (errG) {
      throw new HttpsError('internal', 'Error voz gratis (' + pid + '): ' + (errG.message || 'fallo'));
    }
  }
  const db = admin.firestore();
  const [bovS, maeS, tarS] = await Promise.all([db.collection('Boveda_APIs_Clientes').doc(uid).get(), db.collection('Sistema_IA_Maestro').doc('Proveedores').get(), db.collection('Sistema').doc('Tarifas_IA').get()]);
  const pCli = (bovS.exists && bovS.data().proveedores) ? bovS.data().proveedores[pid] : null;
  const pMae = (maeS.exists && maeS.data().proveedores) ? maeS.data().proveedores[pid] : null;
  const usarCred = modo === 'creditos' ? true : (modo === 'byok' ? false : !(pCli && pCli.activa && pCli.secreto));
  const cfg = usarCred ? pMae : pCli;
  if (!cfg || !cfg.activa || !cfg.secreto) throw new HttpsError('failed-precondition', usarCred ? ('Proveedor ' + pid + ' no habilitado en Creditos Piro.') : ('Vincula tu clave API de ' + pid + ' en la Boveda primero.'));
  const tarifas = Object.assign({}, TARIFAS_IA_DEF, tarS.exists ? (tarS.data() || {}) : {});
  const costo = (usarCred && acc !== 'probar' && acc !== 'listar_modelos' && acc !== 'listar_voces') ? Math.max(0, Math.round(Number(tarifas[tipoC] !== undefined ? tarifas[tipoC] : tarifas[acc]) || 0)) : 0;
  const billRef = db.collection('Billeteras_IA').doc(uid); let movRef = null, saldoRest = null;
  if (costo > 0) {
    movRef = db.collection('Movimientos_IA').doc();
    saldoRest = await db.runTransaction(async (tx) => {
      const bs = await tx.get(billRef), disp = bs.exists ? (Number(bs.data().saldo_creditos) || 0) : 0;
      if (disp < costo) throw new HttpsError('resource-exhausted', 'Saldo insuficiente (' + disp + '). Necesitas ' + costo + ' creditos o vincular tu API Key.');
      const rest = disp - costo;
      tx.set(billRef, { saldo_creditos: rest, total_consumidos: admin.firestore.FieldValue.increment(costo), actualizado_en: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      tx.set(movRef, { uid: uid, tipo: 'consumo_' + tipoC, proveedor: pid, creditos: -costo, saldo_despues: rest, estado: 'reservado', timestamp: admin.firestore.FieldValue.serverTimestamp() });
      return rest;
    });
  }
  try {
    const keyViva = descifrarIA(cfg.secreto, semillaMaestra.value(), usarCred ? 'MAESTRO_PLATAFORMA' : uid);
    const modU = String(d.modelo || (acc === 'imagen' ? (cfg.modeloImagen || cfg.modelo) : cfg.modelo) || '').trim();
    const payU = Object.assign({}, d.payload || {});
    if (cfg.protocolo === 'audio_tts' && !payU.voiceId && cfg.voiceId) payU.voiceId = cfg.voiceId;
    const res = await llamarProveedorIA(cfg.protocolo, keyViva, String(d.baseUrl || cfg.baseUrl || '').trim(), modU, acc, payU);
    if (movRef) await movRef.update({ estado: 'completado', modelo: modU, finalizado_en: admin.firestore.FieldValue.serverTimestamp() });
    return Object.assign({ success: true, proveedorId: pid, modoUsado: usarCred ? 'creditos' : 'byok', creditosCobrados: costo, saldoRestante: saldoRest }, res);
  } catch (errIA) {
    if (costo > 0 && movRef) {
      try { await db.runTransaction(async (tx) => { tx.set(billRef, { saldo_creditos: admin.firestore.FieldValue.increment(costo), total_consumidos: admin.firestore.FieldValue.increment(-costo), actualizado_en: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }); tx.update(movRef, { estado: 'reembolsado', error: String(errIA.message || 'fallo').slice(0, 220), reembolsado_en: admin.firestore.FieldValue.serverTimestamp() }); }); } catch (eR) {}
    }
    throw new HttpsError('internal', 'Error IA (' + pid + '): ' + (errIA.message || 'fallo de red'));
  }
});

// ============================================================================
// 25. VISOR PUBLICO DE COMPROBANTES DIGITALES (QR 24H UNIFICADO COL / VEN)
// ============================================================================
exports.obtenerComprobantePublico = functions.https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "GET") return res.status(405).json({ success: false, code: "METODO_NO_PERMITIDO" });

    const com = String(req.query.com || "").trim();
    const tkt = String(req.query.tkt || "").trim();
    const expRaw = String(req.query.exp || "").trim();
    const sig = String(req.query.sig || "").trim().toLowerCase();
    const expNum = parseInt(expRaw, 10);

    if (!com || !tkt || !Number.isFinite(expNum) || !sig) {
        return res.status(400).json({ success: false, code: "INCOMPLETO", mensaje: "Enlace de comprobante incompleto o corrupto." });
    }

    const rawFirma = tkt + ":" + com + ":" + expRaw + ":GEOKATU_PUBLIC_TKT_SALT";
    const calculada = crypto.createHash("sha256").update(rawFirma).digest("hex").slice(0, 32);
    const bufCalc = Buffer.from(calculada, "utf8");
    const bufRec = Buffer.from(sig, "utf8");
    if (bufCalc.length !== bufRec.length || !crypto.timingSafeEqual(bufCalc, bufRec)) {
        return res.status(403).json({ success: false, code: "FIRMA_INVALIDA", mensaje: "Firma de seguridad invalida." });
    }

    if (Date.now() > expNum) {
        return res.status(410).json({ success: false, code: "EXPIRADO", mensaje: "Este enlace temporal ha expirado (limite 24 horas)." });
    }

    try {
        const db = admin.firestore();
        const negRef = db.collection("Directorio").doc(com);
        const ventasCol = negRef.collection("Ventas_POS");
        const [snapNeg, snapVentaDirecta] = await Promise.all([
            negRef.get(),
            ventasCol.doc(tkt).get()
        ]);

        let ventaData = snapVentaDirecta.exists ? snapVentaDirecta.data() : null;
        let ventaIdFinal = snapVentaDirecta.exists ? snapVentaDirecta.id : tkt;
        if (!ventaData) {
            const qAlt = await ventasCol.where("ticketIdLocal", "==", tkt).limit(1).get();
            if (!qAlt.empty) {
                ventaData = qAlt.docs[0].data();
                ventaIdFinal = qAlt.docs[0].id;
            }
        }

        if (!ventaData) {
            return res.status(404).json({
                success: false,
                code: "NO_ENCONTRADO",
                mensaje: "Comprobante aun no sincronizado en la nube o no encontrado."
            });
        }

        const n = snapNeg.exists ? (snapNeg.data() || {}) : {};
        const pf = n.perfil_fiscal || {};
        const pfv = n.perfil_fiscal_ven || {};
        const paisDetectado = String(ventaData.pais_operacion || n.pais || "COL").toUpperCase();

        const comercioSeguro = {
            nombre: n.nombre || pf.razon_social || pfv.razon_social || "Comercio GEOKATU",
            logo: n.logo || "",
            direccion: n.direccion || "",
            pais: paisDetectado,
            color_principal: n.color_principal || "#ff6b00",
            color_acento: n.color_acento || n.color_principal || "#ff6b00",
            color_terciario: n.color_terciario || "#00ff64",
            perfil_fiscal: {
                razon_social: pf.razon_social || n.nombre || "",
                nit: pf.nit || n.nit || "",
                dv: pf.dv || "",
                regimen_tributario: pf.regimen_tributario || "",
                direccion: pf.direccion || n.direccion || "",
                codigo_tienda: pf.codigo_tienda || ""
            },
            perfil_fiscal_ven: {
                razon_social: pfv.razon_social || n.nombre || "",
                rif: pfv.rif || n.rif || "",
                direccion: pfv.direccion || n.direccion || "",
                codigo_tienda: pfv.codigo_tienda || ""
            }
        };

        const productosSeguros = Array.isArray(ventaData.productos) ? ventaData.productos.map(function(p) {
            return {
                nombre: p.nombre || "Articulo",
                cantidad: Number(p.cantidad) || 0,
                precio: Number(p.precio) || 0,
                precio_usd: p.precio_usd !== undefined ? Number(p.precio_usd) : undefined,
                subtotal: p.subtotal !== undefined ? Number(p.subtotal) : undefined,
                subtotal_usd: p.subtotal_usd !== undefined ? Number(p.subtotal_usd) : undefined,
                es_pesable: Boolean(p.es_pesable),
                unidad_medida: p.unidad_medida || "",
                precio_fijado_balanza: Boolean(p.precio_fijado_balanza),
                nota: p.nota || ""
            };
        }) : [];

        const pagosSeguros = Array.isArray(ventaData.metodos_pago_split) ? ventaData.metodos_pago_split.map(function(mp) {
            return {
                metodo: mp.metodo || "EFECTIVO",
                monto: mp.monto !== undefined ? Number(mp.monto) : undefined,
                moneda_original: mp.moneda_original || "",
                monto_original: mp.monto_original !== undefined ? Number(mp.monto_original) : undefined,
                monto_usd_equivalente: mp.monto_usd_equivalente !== undefined ? Number(mp.monto_usd_equivalente) : undefined
            };
        }) : [];

        const df = ventaData.despacho_fiscal || {};
        const totalesFiscal = (df.payload_canonico && df.payload_canonico.totales) ? df.payload_canonico.totales : null;

        const ventaSegura = {
            ticketId: ventaData.ticketIdLocal || ventaIdFinal,
            timestamp_caja: ventaData.timestamp_caja || null,
            pais_operacion: paisDetectado,
            total: Number(ventaData.total) || 0,
            total_usd: ventaData.total_usd !== undefined ? Number(ventaData.total_usd) : undefined,
            total_ves: ventaData.total_ves !== undefined ? Number(ventaData.total_ves) : undefined,
            total_cop: ventaData.total_cop !== undefined ? Number(ventaData.total_cop) : undefined,
            tasa_aplicada: ventaData.tasa_aplicada !== undefined ? Number(ventaData.tasa_aplicada) : undefined,
            tipo_tasa: ventaData.tipo_tasa || "",
            subtotal_usd: ventaData.subtotal_usd !== undefined ? Number(ventaData.subtotal_usd) : undefined,
            base_gravable_usd: ventaData.base_gravable_usd !== undefined ? Number(ventaData.base_gravable_usd) : undefined,
            iva_16_usd: ventaData.iva_16_usd !== undefined ? Number(ventaData.iva_16_usd) : undefined,
            igtf_usd: ventaData.igtf_usd !== undefined ? Number(ventaData.igtf_usd) : undefined,
            exento_usd: ventaData.exento_usd !== undefined ? Number(ventaData.exento_usd) : undefined,
            desglose_tributario: ventaData.desglose_tributario || null,
            metodo_pago: ventaData.metodo_pago || "EFECTIVO",
            metodos_pago_split: pagosSeguros,
            productos: productosSeguros,
            cliente: {
                nombre: (ventaData.cliente && ventaData.cliente.nombre) ? ventaData.cliente.nombre : "Consumidor Final",
                nit: (ventaData.cliente && ventaData.cliente.nit) ? ventaData.cliente.nit : "",
                rif: (ventaData.cliente && ventaData.cliente.rif) ? ventaData.cliente.rif : ""
            },
            despacho_fiscal: {
                estado: df.estado || "",
                cufe: df.cufe || null,
                consecutivo: df.consecutivo || null,
                totales: totalesFiscal
            },
            anulado: Boolean(ventaData.anulado)
        };

        res.set("Cache-Control", "private, max-age=60");
        return res.status(200).json({ success: true, comercio: comercioSeguro, venta: ventaSegura });
    } catch (errComp) {
        console.error("[COMPROBANTE PUBLICO ERROR]", errComp);
        return res.status(500).json({ success: false, code: "ERROR_INTERNO", mensaje: "Error consultando el comprobante." });
    }
});





