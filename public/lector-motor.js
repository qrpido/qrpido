// lector-motor.js - GEOKATU Hybrid Hardware Scanner Engine
// Soporta: Pistola USB-C / Bluetooth (HID), BarcodeDetector nativo (GPU) y Fallback local (html5-qrcode)

export class MotorLector {
    /**
     * @param {Object} config
     * @param {string} config.contenedorId - ID del contenedor div donde se renderizará el video/visor
     * @param {Function} config.onLectura - Callback: (codigo, origenHardware) => void
     * @param {Function} [config.onError] - Callback para capturar fallos o advertencias
     */
    constructor({ contenedorId = 'lector-camara', onLectura, onError }) {
        this.contenedorId = contenedorId;
        this.onLectura = onLectura;
        this.onError = onError || console.warn;

        // --- Estado Escáner Físico (USB-C / Bluetooth) ---
        this.bufferUSB = '';
        this.ultimoTiempoTecla = 0;
       this.tiempoLimiteHardware = 80; // 🛡️ Tolerancia ampliada (80ms) para pistolas Bluetooth/USB en picos de CPU

        // --- Estado Cámara Híbrida ---
        this.camaraEncendida = false;
        this.bloqueoLectura = false; // Cooldown para evitar lecturas duplicadas
        this.modoActivo = null; // 'NATIVO' | 'FALLBACK'

        // Recursos Modo Nativo
        this.detectorNativo = null;
        this.videoNativo = null;
        this.streamNativo = null;
        this.animacionFrameId = null;

        // Recursos Modo Fallback (html5-qrcode local)
        this.instanciaHtml5QrCode = null;

        this._iniciarLectorFisico();
    }

    // =========================================================================
    // 1. MOTOR HARDWARE FÍSICO (Pistola USB-C / Bluetooth - Keyboard Wedge)
    // =========================================================================
    _iniciarLectorFisico() {
        window.addEventListener('keydown', (e) => {
            const target = e.target;
            // Si el comerciante está escribiendo deliberadamente en un campo de texto, no interferir
            if (['INPUT', 'TEXTAREA'].includes(target.tagName) && !target.classList.contains('ignorar-foco')) {
                return;
            }

            const ahora = performance.now();
            const delta = ahora - this.ultimoTiempoTecla;
            this.ultimoTiempoTecla = ahora;

            // Si el intervalo supera el umbral, es escritura humana lenta: reiniciar buffer
            if (delta > this.tiempoLimiteHardware) {
                this.bufferUSB = '';
            }

            if (e.key === 'Enter') {
                if (this.bufferUSB.length >= 3) {
                    e.preventDefault();
                    const codigoDetectado = this.bufferUSB.trim();
                    this.bufferUSB = '';
                    this._emitirLectura(codigoDetectado, 'FISICO_USBC');
                }
                return;
            }

            // Capturar teclas de un solo carácter
            if (e.key.length === 1) {
                this.bufferUSB += e.key;
            }
        }, true);
    }

    // =========================================================================
    // 2. ORQUESTADOR HÍBRIDO DE CÁMARA (Feature Detection)
    // =========================================================================
    async toggleCamara(btnElement = null) {
        if (this.camaraEncendida) {
            await this.apagarCamara();
            if (btnElement) {
                btnElement.innerHTML = "📷 ACTIVAR CÁMARA";
                btnElement.style.background = "linear-gradient(135deg, #ff8c00, var(--naranja))";
            }
            return false;
        }

        const contenedor = document.getElementById(this.contenedorId);
        if (!contenedor) {
            alert(`Error: No existe el contenedor con id="${this.contenedorId}" en el HTML.`);
            return false;
        }

        // Feature Detection: ¿Soporta BarcodeDetector nativo?
        const soportaNativo = 'BarcodeDetector' in window;

        if (soportaNativo) {
            try {
                await this._iniciarCamaraNativa(contenedor);
                this.modoActivo = 'NATIVO';
            } catch (err) {
                this.onError('[GEOKATU] Falló nativo o denegó permisos. Intentando fallback local:', err);
                try {
                    await this._iniciarCamaraFallback(contenedor);
                    this.modoActivo = 'FALLBACK';
                } catch (errFallback) {
                    this.onError(errFallback);
                    contenedor.style.display = "none";
                    alert("⚠️ Acceso denegado: Debes permitir el uso de la cámara tocando el candado de la URL o en Ajustes > Aplicaciones > Permisos.");
                    return false;
                }
            }
        } else {
            // Navegadores sin soporte nativo (ej. Safari en iPhone)
            try {
                await this._iniciarCamaraFallback(contenedor);
                this.modoActivo = 'FALLBACK';
            } catch (errFallback) {
                this.onError(errFallback);
                contenedor.style.display = "none";
                alert("⚠️ Acceso denegado: Debes permitir el uso de la cámara tocando el candado de la URL o en Ajustes > Aplicaciones > Permisos.");
                return false;
            }
        }

        this.camaraEncendida = true;
        if (btnElement) {
            btnElement.innerHTML = "🛑 APAGAR CÁMARA";
            btnElement.style.background = "#ff4444";
        }
        return true;
    }


   // =========================================================================
    // 3. CAMINO A: MOTOR 100% NATIVO (GPU / BarcodeDetector API)
    // =========================================================================
    async _iniciarCamaraNativa(contenedor) {
        this.detectorNativo = new BarcodeDetector({
            formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e']
        });

        // Asegurar que exista una etiqueta <video> dentro del contenedor
        let video = contenedor.querySelector('video');
        if (!video) {
            contenedor.innerHTML = '';
            video = document.createElement('video');
            video.setAttribute('playsinline', 'true');
            video.setAttribute('autoplay', 'true');
            video.setAttribute('muted', 'true');
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.objectFit = 'cover';
            video.style.borderRadius = '18px';
            contenedor.appendChild(video);
        }

        this.videoNativo = video;
        contenedor.style.display = 'block';

        try {
            this.streamNativo = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            });

            this.videoNativo.srcObject = this.streamNativo;
            await this.videoNativo.play();
            this._bucleEscaneoNativo();
        } catch (err) {
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                alert("⚠️ Permiso de cámara denegado. Toca el candado junto a la URL del navegador o ve a Ajustes > Aplicaciones y permite el acceso a la Cámara.");
            }
            throw err;
        }
    }

// =========================================================================
    // 3.1 BUCLE NATIVO POR GPU (BarcodeDetector + requestAnimationFrame)
    // =========================================================================
    async _bucleEscaneoNativo() {
        if (!this.camaraEncendida || !this.videoNativo || !this.detectorNativo) {
            return;
        }

        try {
            // Validar que el elemento de video tenga datos de imagen cargados
            if (this.videoNativo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                const codigos = await this.detectorNativo.detect(this.videoNativo);
                if (codigos && codigos.length > 0) {
                    const primerCodigo = codigos[0];
                    if (primerCodigo.rawValue) {
                        this._gestionarLecturaConFiltro(primerCodigo.rawValue.trim(), 'CAMARA_NATIVA_GPU');
                    }
                }
            }
        } catch (err) {
            // Evitar saturar consola si ocurre un error transitorio de renderizado de frame
            this.onError('[Lector Nativo GPU] Error analizando frame:', err);
        }

        // Programar el siguiente frame mientras la cámara siga activa
        if (this.camaraEncendida) {
            this.animacionFrameId = requestAnimationFrame(() => this._bucleEscaneoNativo());
        }
    }

    // =========================================================================
    // 4. CAMINO B: MOTOR FALLBACK LOCAL (html5-qrcode.min.js)
    // =========================================================================
    async _iniciarCamaraFallback(contenedor) {
        if (typeof Html5Qrcode === 'undefined') {
            throw new Error("html5-qrcode.min.js no se encuentra cargado en el documento.");
        }

        contenedor.innerHTML = ''; // Limpiar por si había un video previo
        contenedor.style.display = 'block';

        if (!this.instanciaHtml5QrCode) {
            this.instanciaHtml5QrCode = new Html5Qrcode(this.contenedorId);
        }

        await this.instanciaHtml5QrCode.start(
            { facingMode: 'environment' },
            {
                fps: 15,
                qrbox: (w, h) => {
                    const min = Math.min(w, h);
                    return { width: Math.floor(min * 0.75), height: Math.floor(min * 0.75) };
                },
                aspectRatio: 1.0
            },
            (codigoTexto) => {
                this._gestionarLecturaConFiltro(codigoTexto, 'CAMARA_FALLBACK');
            },
            () => {} // Ignorar cuadros vacíos silenciosamente
        );
    }

    // =========================================================================
    // 5. APAGADO Y LIMPIEZA DE RECURSOS
    // =========================================================================
   async apagarCamara() {
        this.camaraEncendida = false;

        // 1. Cancelar bucle de animación GPU inmediatamente
        if (this.animacionFrameId) {
            cancelAnimationFrame(this.animacionFrameId);
            this.animacionFrameId = null;
        }

        // 2. Apagar físicamente el hardware de la cámara
        if (this.streamNativo) {
            this.streamNativo.getTracks().forEach(t => {
                try { t.stop(); } catch (e) {}
            });
            this.streamNativo = null;
        }

        if (this.videoNativo) {
            this.videoNativo.pause();
            this.videoNativo.srcObject = null;
            this.videoNativo.remove(); // 🛡️ Limpieza del elemento del DOM para evitar fugas de texturas GPU
            this.videoNativo = null;
        }

        // 3. Detener motor Fallback si estaba en uso
        if (this.instanciaHtml5QrCode && this.modoActivo === 'FALLBACK') {
            try {
                await this.instanciaHtml5QrCode.stop();
                await this.instanciaHtml5QrCode.clear();
            } catch (err) {
                // Instancia ya liberada
            }
            this.instanciaHtml5QrCode = null;
        }

        // 4. Ocultar contenedor y reiniciar referencias
        const contenedor = document.getElementById(this.contenedorId);
        if (contenedor) {
            contenedor.innerHTML = '';
            contenedor.style.display = 'none';
        }

        this.detectorNativo = null;
        this.modoActivo = null;
    }


    // =========================================================================
    // 6. DESPACHO UNIFICADO Y ANTI-DUPLICADOS
    // =========================================================================
    _gestionarLecturaConFiltro(codigo, origen) {
        if (this.bloqueoLectura) return;
        this.bloqueoLectura = true;

        this._emitirLectura(codigo, origen);

        // Cooldown de 1.5 segundos para no volver a registrar el mismo código de inmediato
        setTimeout(() => {
            this.bloqueoLectura = false;
        }, 1500);
    }

    _emitirLectura(codigo, origen) {
        if (navigator.vibrate) {
            navigator.vibrate(80);
        }
        if (typeof this.onLectura === 'function') {
            this.onLectura(codigo, origen);
        }
    }
}


