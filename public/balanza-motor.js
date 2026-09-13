// =========================================================================
// GEOKATU POS - MOTOR UNIVERSAL DE BALANZAS / BÁSCULAS (OFFLINE)
// Soporta: Web Serial API (USB/RS232) y Web Bluetooth API (BLE)
// Protocolos: Torrey, Systel, Dibal, Toledo, CAS, NCI/TEC y Captura RAW
// =========================================================================

export class MotorBalanza {
    constructor({ onPesoVivo, onEstadoConexion, onTramaDesconocida }) {
        this.onPesoVivo = onPesoVivo || (() => {});
        this.onEstadoConexion = onEstadoConexion || (() => {});
        this.onTramaDesconocida = onTramaDesconocida || (() => {});

        this.tipoConexion = null; // 'SERIAL' | 'BLUETOOTH' | null
        this.puertoSerial = null;
        this.lectorSerial = null;
        this.dispositivoBLE = null;
        this.caracteristicaBLE = null;

       this.ultimoPesoBruto = 0.000;
        this.ultimoPeso = 0.000;
        this.taraSoftware = 0.000;
        this.historialTramas = [];

        // 🛡️ CONTROL DE ESTRANGULAMIENTO (THROTTLING) ANTI-CONGELAMIENTO
        this._ultimoTimestampUI = 0;
        this._intervaloMinimoMs = 100; // Máximo 10 actualizaciones de DOM por segundo
        this._umbralCambioBruto = 0.005; // 5 gramos de delta para forzar despacho inmediato
    }



    // -------------------------------------------------------------
    // 1. CONEXIÓN POR CABLE (USB / CONVERSOR RS-232 A SERIAL)
    // -------------------------------------------------------------
    async conectarUSB(baudRate = 9600) {
        if (!('serial' in navigator)) {
            throw new Error("Este navegador no soporta Web Serial API. Usa Google Chrome o Edge en PC.");
        }

        try {
            this.puertoSerial = await navigator.serial.requestPort();
            await this.puertoSerial.open({
                baudRate: Number(baudRate),
                dataBits: 8,
                stopBits: 1,
                parity: "none"
            });

           this.tipoConexion = 'SERIAL';
            this.onEstadoConexion({ conectado: true, tipo: 'USB/Serial' });

            // 🛡️ DETECCIÓN DE DESCONEXIÓN FÍSICA INMEDIATA (Tirón de cable)
            if ('serial' in navigator) {
                const listenerDesconexion = (event) => {
                    if (event.target === this.puertoSerial) {
                        console.warn("[Balanza] Puerto serial desconectado físicamente.");
                        this.desconectar();
                        navigator.serial.removeEventListener('disconnect', listenerDesconexion);
                    }
                };
                navigator.serial.addEventListener('disconnect', listenerDesconexion);
            }

            this._iniciarBucleLecturaSerial().catch(err => {
                console.warn("[Balanza] Bucle serial cerrado:", err);
            });

            return true;

        } catch (err) {
            this.desconectar();
            throw err;
        }
    }

   // balanza-motor.js
async _iniciarBucleLecturaSerial() {
    this._abortControllerSerial = new AbortController();
    const decodificador = new TextDecoderStream();
    
    // Conectar el pipe permitiendo aborto externo
    const pipePromise = this.puertoSerial.readable.pipeTo(decodificador.writable, {
        signal: this._abortControllerSerial.signal
    }).catch(err => {
        if (err.name !== 'AbortError') console.warn("[Balanza] Pipe cerrado:", err);
    });

    this.lectorSerial = decodificador.readable.getReader();
    let acumulador = "";

    try {
        while (true) {
            const { value, done } = await this.lectorSerial.read();
            if (done) break;
            if (value) {
                acumulador += value;
                if (acumulador.includes('\n') || acumulador.includes('\r')) {
                    const lineas = acumulador.split(/[\r\n]+/);
                    acumulador = lineas.pop() || "";
                    for (const linea of lineas) {
                        if (linea.trim()) this._procesarTrama(linea.trim());
                    }
                }
            }
        }
    } catch (err) {
        if (err.name !== 'AbortError') console.warn("[Balanza USB] Error de lectura:", err);
    } finally {
        try { this.lectorSerial.releaseLock(); } catch (_) {}
        await pipePromise;
    }
}

async desconectar() {
    if (this._abortControllerSerial) {
        this._abortControllerSerial.abort();
        this._abortControllerSerial = null;
    }
    if (this.lectorSerial) {
        try { await this.lectorSerial.cancel(); } catch (_) {}
        try { this.lectorSerial.releaseLock(); } catch (_) {}
        this.lectorSerial = null;
    }
    if (this.puertoSerial) {
        try { await this.puertoSerial.close(); } catch (_) {}
        this.puertoSerial = null;
    }
    if (this.dispositivoBLE?.gatt?.connected) {
        try { this.dispositivoBLE.gatt.disconnect(); } catch (_) {}
        this.dispositivoBLE = null;
        this.caracteristicaBLE = null;
    }
    this.tipoConexion = null;
    this.ultimoPeso = 0.000;
    this.ultimoPesoBruto = 0.000;
    this.onEstadoConexion({ conectado: false, tipo: null });
}


    // -------------------------------------------------------------
    // 2. CONEXIÓN INALÁMBRICA BLUETOOTH (BLE / SPP Emulado)
    // -------------------------------------------------------------
    async conectarBluetooth() {
        if (!('bluetooth' in navigator)) {
            throw new Error("Este navegador o dispositivo no soporta Web Bluetooth API.");
        }

        try {
            // Se solicita el dispositivo aceptando todos o los servicios estándar de pesaje
            this.dispositivoBLE = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [
                    '0000181d-0000-1000-8000-00805f9b34fb', // GATT Weight Scale Service estándar
                    '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 / Módulos seriales chinos comunes
                    '49535343-fe7d-4ae5-8fa9-9fafd205e455'  // Microchip transparent serial
                ]
            });

            this.dispositivoBLE.addEventListener('gattserverdisconnected', () => {
                this.desconectar();
            });

            const servidor = await this.dispositivoBLE.gatt.connect();
            const servicios = await servidor.getPrimaryServices();

            // Buscar la característica que emita notificaciones
            for (const servicio of servicios) {
                const caracteristicas = await servicio.getCharacteristics();
                for (const char of caracteristicas) {
                    if (char.properties.notify || char.properties.indicate) {
                        this.caracteristicaBLE = char;
                        break;
                    }
                }
                if (this.caracteristicaBLE) break;
            }

            if (!this.caracteristicaBLE) {
                throw new Error("No se encontró canal de datos notify/stream en la balanza Bluetooth.");
            }

            await this.caracteristicaBLE.startNotifications();
            this.caracteristicaBLE.addEventListener('characteristicvaluechanged', (e) => {
                const buffer = e.target.value;
                const texto = new TextDecoder().decode(buffer);
                this._procesarTrama(texto.trim());
            });

            this.tipoConexion = 'BLUETOOTH';
            this.onEstadoConexion({ conectado: true, tipo: `Bluetooth (${this.dispositivoBLE.name || 'Balanza'})` });
            return true;
        } catch (err) {
            this.desconectar();
            throw err;
        }
    }

    // -------------------------------------------------------------
    // 3. PARSER INTELIGENTE MULTIMARCA Y DEPURADOR
    // -------------------------------------------------------------
    _procesarTrama(tramaRaw) {
        // Guardar las últimas 10 tramas para el reporte de diagnóstico / soporte
        if (this.historialTramas.length > 10) this.historialTramas.shift();
        this.historialTramas.push(tramaRaw);

        let pesoDetectado = null;

        // Patrón 1: Estándar continuo con unidad (ej: "ST,GS, 1.450kg", "WN01.450kg", "W: 1.450 kg")
        const matchConUnidad = tramaRaw.match(/([0-9]{1,4}\.[0-9]{2,3})\s*(?:kg|g|lb)?/i);
        if (matchConUnidad) {
            pesoDetectado = parseFloat(matchConUnidad[1]);
        }

        // Patrón 2: Protocolo Torrey / Toledo / Systel (ej: "01.450", "+001.450", "001450" con punto decimal implícito)
        if (pesoDetectado === null) {
            const matchDecimal = tramaRaw.match(/[+]?([0-9]+\.[0-9]{2,3})/);
            if (matchDecimal) {
                pesoDetectado = parseFloat(matchDecimal[1]);
            }
        }

   // Si se extrajo un peso válido:
        if (pesoDetectado !== null && !isNaN(pesoDetectado)) {
            this.ultimoPesoBruto = pesoDetectado;
            // Cálculo Neto aplicando tara
            const pesoNeto = Math.max(0, parseFloat((pesoDetectado - this.taraSoftware).toFixed(3)));

            // 🛡️ FILTRO DE THROTTLING: Despachar a la UI solo si transcurrió el intervalo o si hubo cambio relevante
            const ahora = performance.now();
            const tiempoTranscurrido = ahora - this._ultimoTimestampUI;
            const deltaPeso = Math.abs(pesoNeto - this.ultimoPeso);

            if (tiempoTranscurrido >= this._intervaloMinimoMs || deltaPeso >= this._umbralCambioBruto) {
                this._ultimoTimestampUI = ahora;
                this.ultimoPeso = pesoNeto;
                this.onPesoVivo(pesoNeto, tramaRaw);
            }
        } else {
            // Trama desconocida: enviarla al callback para posibilitar generación de reporte
            this.onTramaDesconocida(tramaRaw, this.historialTramas);
        }

    }

    // Generador de ticket de diagnóstico para soporte técnico
    generarReporteDiagnostico() {
        return {
            fecha: new Date().toISOString(),
            tipoConexion: this.tipoConexion,
            navegador: navigator.userAgent,
            plataforma: navigator.platform,
            ultimasTramas: [...this.historialTramas]
        };
    }
// Aplicar Tara (Puesta a cero del recipiente)
    async aplicarTara() {
        // 1. Tara por Software inmediata
        if (this.taraSoftware > 0 && this.ultimoPesoBruto <= this.taraSoftware) {
            // Si ya estaba tarado y se vuelve a presionar vacío, se limpia la tara
            this.taraSoftware = 0.000;
        } else {
            this.taraSoftware = this.ultimoPesoBruto;
        }

        // 2. Intentar enviar comando físico por Serial si está disponible (Torrey / Systel / Toledo)
        if (this.puertoSerial && this.puertoSerial.writable) {
            try {
                const escritor = this.puertoSerial.writable.getWriter();
                const comando = new TextEncoder().encode("T\r\n");
                await escritor.write(comando);
                escritor.releaseLock();
            } catch (err) {
                console.warn("[Balanza] No se pudo enviar comando hardware TARA:", err);
            }
        }

        const pesoNeto = Math.max(0, parseFloat((this.ultimoPesoBruto - this.taraSoftware).toFixed(3)));
        this.ultimoPeso = pesoNeto;
        this.onPesoVivo(pesoNeto, "TARA_MANUAL");
        return this.taraSoftware;
    }

    limpiarTara() {
        this.taraSoftware = 0.000;
        const pesoNeto = this.ultimoPesoBruto;
        this.ultimoPeso = pesoNeto;
        this.onPesoVivo(pesoNeto, "TARA_RESET");
    }

    async desconectar() {
        if (this.lectorSerial) {
            try {
                // Forzar la cancelación del reader para desenclavar el stream subyacente
                await this.lectorSerial.cancel();
            } catch (e) {
                console.warn("[Balanza] Reader ya cancelado o inexistente:", e.message);
            } finally {
                try {
                    this.lectorSerial.releaseLock();
                } catch (e) {}
                this.lectorSerial = null;
            }
        }

        if (this.puertoSerial) {
            try {
                await this.puertoSerial.close();
            } catch (e) {
                console.warn("[Balanza] Puerto ya cerrado:", e.message);
            } finally {
                this.puertoSerial = null;
            }
        }

        if (this.dispositivoBLE && this.dispositivoBLE.gatt.connected) {
            try {
                this.dispositivoBLE.gatt.disconnect();
            } catch (e) {}
            this.dispositivoBLE = null;
            this.caracteristicaBLE = null;
        }

        this.tipoConexion = null;
        this.ultimoPeso = 0.000;
        this.ultimoPesoBruto = 0.000;
        this.onEstadoConexion({ conectado: false, tipo: null });
    }


}

