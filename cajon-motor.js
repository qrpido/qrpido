// =========================================================================
// GEOKATU POS - MOTOR DE APERTURA DE CAJÓN MONEDERO (PULSO RJ11 ESC/POS)
// Soporta: WebUSB API y Web Serial API para impresoras térmicas de 58/80mm
// Secuencia estándar ESC/POS: ESC p m t1 t2 (27, 112, 0, 25, 250)
// =========================================================================

export class MotorCajonMonedero {
    constructor() {
        this.puertoSerial = null;
        this.dispositivoUSB = null;
        this.endpointOutUSB = null; // 🛡️ Almacena el número de endpoint descubierto dinámicamente
        this.conectadoDirecto = false;
        this._ocupado = false; // 🛡️ Mutex para evitar colisión de writers
    }

    // -------------------------------------------------------------
    // SECUENCIA BINARIA ESTÁNDAR ESC/POS PARA PULSO DE GAVETA
    // -------------------------------------------------------------
    // cajon-motor.js
obtenerBytesKickout(pin = 0) {
    // ESC p m t1 t2: Genera pulso de 50ms al pin RJ11 seleccionado
    return new Uint8Array([0x1B, 0x70, pin === 0 ? 0x00 : 0x01, 0x19, 0xFA]);
}

obtenerBytesCorte() {
    // GS V 66 0: Corte parcial con avance de papel
    return new Uint8Array([0x1D, 0x56, 0x42, 0x00]);
}

obtenerBytesKickoutYCorte(pin = 0) {
    const pulso = this.obtenerBytesKickout(pin);
    const corte = this.obtenerBytesCorte();
    const combinado = new Uint8Array(pulso.length + corte.length);
    combinado.set(pulso, 0);
    combinado.set(corte, pulso.length);
    return combinado;
}



    // Conectar impresora térmica directa por USB (WebUSB API)
    async conectarImpresoraUSB() {
        if (!('usb' in navigator)) {
            throw new Error("WebUSB no soportado en este navegador.");
        }
        try {
            this.dispositivoUSB = await navigator.usb.requestDevice({ filters: [] });
            await this.dispositivoUSB.open();
            
            // Si la impresora no tiene configuración activa, seleccionar la primera
            if (this.dispositivoUSB.configuration === null) {
                await this.dispositivoUSB.selectConfiguration(1);
            }

            // Descubrir la primera interfaz con endpoint de salida Bulk OUT
            let interfazEncontrada = null;
            let endpointNumero = null;

            for (const iface of this.dispositivoUSB.configuration.interfaces) {
                for (const alt of iface.alternates) {
                    for (const ep of alt.endpoints) {
                        if (ep.direction === 'out' && (ep.type === 'bulk' || ep.type === 'interrupt')) {
                            interfazEncontrada = iface.interfaceNumber;
                            endpointNumero = ep.endpointNumber;
                            break;
                        }
                    }
                    if (endpointNumero !== null) break;
                }
                if (endpointNumero !== null) break;
            }

            const interfaceReclamar = interfazEncontrada !== null ? interfazEncontrada : 0;
            await this.dispositivoUSB.claimInterface(interfaceReclamar);

            this.endpointOutUSB = endpointNumero !== null ? endpointNumero : 1;
            this.conectadoDirecto = true;
            return true;
        } catch (err) {
            console.warn("[Cajón USB] No se pudo conectar por WebUSB:", err);
            return false;
        }
    }


    // Conectar impresora térmica por puerto COM / Serial
    async conectarImpresoraSerial(baudRate = 9600) {
        if (!('serial' in navigator)) {
            throw new Error("Web Serial no soportado en este navegador.");
        }
        try {
            this.puertoSerial = await navigator.serial.requestPort();
            await this.puertoSerial.open({ baudRate: Number(baudRate) });
            this.conectadoDirecto = true;
            return true;
        } catch (err) {
            console.warn("[Cajón Serial] No se pudo conectar por Web Serial:", err);
            return false;
        }
    }

   // Disparar apertura directa por hardware con cerrojo de concurrencia
    async dispararAperturaDirecta(pin = 0, conCorte = false) {


        if (this._ocupado) {
            console.warn("[Cajón] Comando en cola: esperando ciclo de solenoide previo.");
            return { success: false, ocupado: true };
        }

        this._ocupado = true;
        const comando = conCorte ? this.obtenerBytesKickoutYCorte(pin) : this.obtenerBytesKickout(pin);


        try {
            // 1. Si está conectada por Web Serial directo
            if (this.puertoSerial && this.puertoSerial.writable) {
                try {
                    const writer = this.puertoSerial.writable.getWriter();
                    await writer.write(comando);
                    writer.releaseLock();
                    return { success: true, metodo: "SERIAL_DIRECTO" };
                } catch (e) {
                    console.warn("[Cajón] Falló envío serial:", e.message);
                }
            }

            // 2. Si está conectada por WebUSB directo con endpoint autodescubierto y canal vivo
            if (this.dispositivoUSB && this.dispositivoUSB.opened) {
                try {
                    const targetEp = this.endpointOutUSB || 1;
                    await this.dispositivoUSB.transferOut(targetEp, comando);
                    return { success: true, metodo: "USB_DIRECTO" };
                } catch (e) {
                    console.warn("[Cajón] Pipe USB congelado o perdido por reposo:", e.message);
                    // 🛡️ AUTORECUPERACIÓN: Si el bus se cayó por suspensión, limpiar estado para no encallar el hilo
                    try {
                        await this.dispositivoUSB.close();
                    } catch (errClose) {}
                    this.dispositivoUSB = null;
                    this.endpointOutUSB = null;
                    this.conectadoDirecto = false;
                }
            }


            // 3. Fallback: Método Universal por Driver Térmico del SO
            return { success: true, metodo: "DRIVER_IMPRESION" };

        } finally {
            // Cooldown de 250ms para permitir que el electroimán de la gaveta complete el ciclo
            setTimeout(() => {
                this._ocupado = false;
            }, 250);
        }
    }

}

