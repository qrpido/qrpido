module qrpido::logistica {
    use sui::event;
    use std::string::String;

    // ---------------------------------------------------
    // 1. EL RECIBO INMUTABLE (La Caja Negra)
    // ---------------------------------------------------
    // Esta estructura define los datos que se grabarán en piedra en la blockchain.
    struct ReciboQRpido has copy, drop {
        orden_id_firebase: String,
        monto_total_cop: u64,
        comision_plataforma: u64,  // Fijado firmemente al 10%
        pago_embajador: u64,       // El 25% de la comisión
        timestamp_sui: u64
    }

    // ---------------------------------------------------
    // 2. LA EMISIÓN (El Megáfono)
    // ---------------------------------------------------
    // Cloud Functions llamará a esta función para sellar la transacción.
    public entry fun sellar_transaccion(
        orden_id: String,
        monto_total: u64,
        comision: u64,
        embajador: u64,
        tiempo_actual: u64
    ) {
        // Emitimos el evento. Queda registrado en la red para siempre.
        event::emit(ReciboQRpido {
            orden_id_firebase: orden_id,
            monto_total_cop: monto_total,
            comision_plataforma: comision,
            pago_embajador: embajador,
            timestamp_sui: tiempo_actual
        });
    }
}
