module qrpido::logistica {
    use sui::event;
    use std::string::String;

    // ---------------------------------------------------
    // 1. EL RECIBO INMUTABLE (La Huella Digital)
    // ---------------------------------------------------
    // Solo guardamos el hash SHA-256. Cero datos financieros expuestos.
    struct SelloCriptografico has copy, drop {
        huella_sha256: String,
        timestamp_sui: u64
    }

    // ---------------------------------------------------
    // 2. LA EMISIÓN (El Megáfono Ciego)
    // ---------------------------------------------------
    public entry fun sellar_transaccion(
        hash_transaccion: String,
        tiempo_actual: u64
    ) {
        event::emit(SelloCriptografico {
            huella_sha256: hash_transaccion,
            timestamp_sui: tiempo_actual
        });
    }
}
