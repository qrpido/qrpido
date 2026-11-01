// Infraestructura compartida POS/WMS. No contiene credenciales ni accede a la red.
export function nuevoIdOperacion(prefijo) {
    return prefijo + '-' + crypto.randomUUID();
}

export function quitarConfirmados(storage, clave, ids, campo) {
    // Releer: pueden haberse agregado operaciones mientras se esperaba a Firebase.
    const confirmados = new Set(ids);
    const actual = JSON.parse(storage.getItem(clave) || '[]');
    storage.setItem(clave, JSON.stringify(actual.filter(item => !confirmados.has(item[campo]))));
}

export function crearLoteIdempotente(db, reciboRef, runTransaction) {
    const escrituras = [];
    return {
        set: (...args) => escrituras.push(['set', args]),
        update: (...args) => escrituras.push(['update', args]),
        commit: () => runTransaction(db, async tx => {
            const recibo = await tx.get(reciboRef);
            if (recibo.exists()) return { duplicado: true };
            // El recibo y todos los efectos se confirman en la misma transacción.
            for (const [metodo, args] of escrituras) tx[metodo](...args);
            return { duplicado: false };
        })
    };
}
