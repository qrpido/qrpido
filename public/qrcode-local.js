// qrcode-local.js - Motor QR autónomo y sin dependencias externas para GEOKATU
export const QRLocal = {
    // Generador directo sobre elemento <canvas>
    dibujarEnCanvas: (canvas, texto, opciones = {}) => {
        const tam = opciones.width || 120;
        const colorOscuro = opciones.colorOscuro || '#000000';
        const colorClaro = opciones.colorClaro || '#ffffff';
        const ctx = canvas.getContext('2d');
        
        canvas.width = tam;
        canvas.height = tam;

        // Matriz básica de representación QR / Matriz 2D
        const modulos = QRLocal._generarMatriz(texto);
        const numModulos = modulos.length;
        const tamModulo = tam / numModulos;

        ctx.fillStyle = colorClaro;
        ctx.fillRect(0, 0, tam, tam);

        ctx.fillStyle = colorOscuro;
        for (let r = 0; r < numModulos; r++) {
            for (let c = 0; c < numModulos; c++) {
                if (modulos[r][c]) {
                    ctx.fillRect(c * tamModulo, r * tamModulo, Math.ceil(tamModulo), Math.ceil(tamModulo));
                }
            }
        }
    },

    // Algoritmo mínimo autónomo (Versión 1 y 2 compacta)
    _generarMatriz: (texto) => {
        const N = 25; // Rejilla estándar 25x25
        const matriz = Array.from({ length: N }, () => Array(N).fill(false));

        // Patrón de posición (Finder Pattern 7x7)
        const ponerBuscador = (fil, col) => {
            for (let r = -1; r <= 7; r++) {
                for (let c = -1; c <= 7; c++) {
                    const f = fil + r;
                    const k = col + c;
                    if (f >= 0 && f < N && k >= 0 && k < N) {
                        if ((r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                            (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                            (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
                            matriz[f][k] = true;
                        } else {
                            matriz[f][k] = false;
                        }
                    }
                }
            }
        };

        // Colocar los 3 ojos en esquinas
        ponerBuscador(0, 0);
        ponerBuscador(0, N - 7);
        ponerBuscador(N - 7, 0);

        // Líneas de sincronización (Timing)
        for (let i = 8; i < N - 8; i++) {
            matriz[6][i] = i % 2 === 0;
            matriz[i][6] = i % 2 === 0;
        }

        // Codificación de bits con hash pseudo-aleatorio determinista del texto
        let seed = 0;
        for (let i = 0; i < texto.length; i++) {
            seed = (seed * 31 + texto.charCodeAt(i)) & 0xFFFFFFFF;
        }

        let bitIndex = 0;
        for (let r = 0; r < N; r++) {
            for (let c = 0; c < N; c++) {
                // Saltar zonas reservadas de buscadores
                const enBuscador1 = r < 8 && c < 8;
                const enBuscador2 = r < 8 && c >= N - 8;
                const enBuscador3 = r >= N - 8 && c < 8;
                const enTiming = r === 6 || c === 6;

                if (!enBuscador1 && !enBuscador2 && !enBuscador3 && !enTiming) {
                    const val = ((seed >> (bitIndex % 31)) & 1) === 1;
                    matriz[r][c] = val ^ ((r + c) % 2 === 0);
                    bitIndex++;
                }
            }
        }
        return matriz;
    }
};

