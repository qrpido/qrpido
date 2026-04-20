const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');

// Inicializar el SDK de administrador de Firebase
admin.initializeApp();

// En producción, esto vendrá del Secret Manager de Google Cloud.
const MNEMONIC_MAESTRA = process.env.SEMILLA_MAESTRA || "tu frase semilla de doce palabras va aqui para pruebas locales";

exports.forjarBilletera = functions.auth.user().onCreate(async (user) => {
    const uid = user.uid;
    const db = admin.firestore();
    
    // Referencias a la base de datos
    const contadorRef = db.collection('Sistema').doc('ContadorBilleteras');
    const userRef = db.collection('Directorio').doc(uid);

    try {
        // 1. Transacción Atómica: Genera un índice secuencial inquebrantable
        const indiceSeguro = await db.runTransaction(async (transaction) => {
            const contadorDoc = await transaction.get(contadorRef);
            let actual = 0;
            
            if (contadorDoc.exists) {
                actual = contadorDoc.data().ultimo_indice || 0;
            }
            
            const nuevoIndice = actual + 1;
            
            // Bloquea y actualiza el contador global
            transaction.set(contadorRef, { ultimo_indice: nuevoIndice }, { merge: true });
            
            return nuevoIndice;
        });

        // 2. Definir la ruta de derivación HD usando el índice atómico
        // Estándar SUI: m/44'/784'/cuenta'/cambio'/indice'
        const derivationPath = `m/44'/784'/${indiceSeguro}'/0'/0'`;

        // 3. Derivar la llave pública y privada usando el SDK nativo de SUI
        const keypair = Ed25519Keypair.deriveKeypair(MNEMONIC_MAESTRA, derivationPath);
        
        // Extraemos solo la dirección pública (0x...)
        const suiAddress = keypair.getPublicKey().toSuiAddress();

        // 4. Inyectar silenciosamente en el Directorio del usuario
        // Guardamos también el índice para facilitar auditorías internas si es necesario
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
