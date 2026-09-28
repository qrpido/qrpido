// qrcode-local.js - Motor QR autónomo conforme a ISO/IEC 18004 para GEOKATU
// Modo: Byte UTF-8 | Corrección de error: Nivel M (15%) | Cero dependencias

// 1. Tablas y Aritmética de Campos de Galois GF(2^8)
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
let x = 1;
for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    EXP[i + 255] = x;
    LOG[x] = i;
    x = (x << 1) ^ (x >= 128 ? 0x11D : 0);
}

function gfMul(a, b) {
    return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];
}

function obtenerPolinomioGenerador(numEc) {
    let gen = [1];
    for (let i = 0; i < numEc; i++) {
        const next = new Uint8Array(gen.length + 1);
        for (let j = 0; j < gen.length; j++) {
            next[j] ^= gen[j];
            next[j + 1] ^= gfMul(gen[j], EXP[i]);
        }
        gen = next;
    }
    return gen;
}

function calcularReedSolomon(datos, numEc) {
    const gen = obtenerPolinomioGenerador(numEc);
    const rem = new Uint8Array(numEc);
    for (let i = 0; i < datos.length; i++) {
        const factor = datos[i] ^ rem[0];
        for (let j = 0; j < numEc - 1; j++) {
            rem[j] = rem[j + 1] ^ gfMul(gen[j + 1], factor);
        }
        rem[numEc - 1] = gfMul(gen[numEc], factor);
    }
    return rem;
}

// 2. Parámetros ISO/IEC 18004 (Nivel M, Versiones 1 a 10)
// [versión, totalPalabras, ecPorBloque, blkG1, dataG1, blkG2, dataG2]
const TABLA_VERSIONES = [
    null,
    [1,  26, 10, 1, 16, 0,  0],
    [2,  44, 16, 1, 28, 0,  0],
    [3,  70, 26, 1, 44, 0,  0],
    [4, 100, 18, 2, 32, 0,  0],
    [5, 134, 24, 2, 43, 0,  0],
    [6, 172, 16, 4, 27, 0,  0],
    [7, 196, 18, 4, 31, 0,  0],
    [8, 242, 22, 2, 38, 2, 39],
    [9, 292, 22, 3, 36, 2, 37],
    [10, 346, 26, 4, 43, 1, 44]
];

const COORD_ALINEACION = [
    [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
];

const RESTO_BITS = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0];

// 3. Fórmulas de Enmascaramiento Estándar
const MASCARAS = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

function obtenerBitsFormato(nivelEc, patronMascara) {
    const data = (nivelEc << 3) | patronMascara;
    let rem = data << 10;
    for (let i = 14; i >= 10; i--) {
        if ((rem >> i) & 1) rem ^= (0x537 << (i - 10));
    }
    return ((data << 10) | rem) ^ 0x5412;
}

export const QRLocal = {
    /**
     * Dibuja el código QR en un elemento <canvas> existente.
     * @param {HTMLCanvasElement} canvas
     * @param {string} texto
     * @param {object} opciones { width: 200, margin: 4, colorOscuro: '#000000', colorClaro: '#ffffff' }
     */
    dibujarEnCanvas: (canvas, texto, opciones = {}) => {
        const tamDeseado = opciones.width || 200;
        const margen = opciones.margin !== undefined ? opciones.margin : 4;
        const colorOscuro = opciones.colorOscuro || '#000000';
        const colorClaro = opciones.colorClaro || '#ffffff';
        const ctx = canvas.getContext('2d');

        const matriz = QRLocal._generarMatriz(texto);
        const N = matriz.length;
        const totalModulos = N + (margen * 2);
        const tamModulo = Math.max(1, Math.floor(tamDeseado / totalModulos));
        const tamReal = tamModulo * totalModulos;

        canvas.width = tamReal;
        canvas.height = tamReal;

        ctx.fillStyle = colorClaro;
        ctx.fillRect(0, 0, tamReal, tamReal);

        ctx.fillStyle = colorOscuro;
        for (let r = 0; r < N; r++) {
            for (let c = 0; c < N; c++) {
                if (matriz[r][c]) {
                    ctx.fillRect(
                        (c + margen) * tamModulo,
                        (r + margen) * tamModulo,
                        tamModulo,
                        tamModulo
                    );
                }
            }
        }
    },

    _generarMatriz: (texto) => {
        const utf8 = new TextEncoder().encode(texto);
        const len = utf8.length;

        // Selección de versión automática
        let version = 1;
        while (version <= 10) {
            const cfg = TABLA_VERSIONES[version];
            const maxCapacidadDatos = (cfg[3] * cfg[4]) + (cfg[5] * cfg[6]);
            const headerBytes = version < 10 ? 2 : 3;
            if (len + headerBytes <= maxCapacidadDatos) break;
            version++;
        }

        if (version > 10) {
            throw new Error(`Texto demasiado largo (${len} bytes). Limite soportado: 213 bytes.`);
        }

        const cfg = TABLA_VERSIONES[version];
        const numModulos = 17 + (4 * version);
        const totalDatos = (cfg[3] * cfg[4]) + (cfg[5] * cfg[6]);

        // Construcción del flujo de bits (Modo Byte UTF-8)
        const bits = [];
        const pushBits = (val, count) => {
            for (let i = count - 1; i >= 0; i--) {
                bits.push((val >> i) & 1);
            }
        };

        pushBits(0b0100, 4); // Indicador Modo Byte
        pushBits(len, version < 10 ? 8 : 16); // Conteo de caracteres
        for (let i = 0; i < len; i++) {
            pushBits(utf8[i], 8);
        }

        // Terminador y relleno
        const bitsRequeridos = totalDatos * 8;
        const faltanTerm = Math.min(4, bitsRequeridos - bits.length);
        pushBits(0, faltanTerm);
        while (bits.length % 8 !== 0) bits.push(0);

        const bytesDatos = [];
        for (let i = 0; i < bits.length; i += 8) {
            let b = 0;
            for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
            bytesDatos.push(b);
        }

        const bytesRelleno = [0xEC, 0x11];
        let idxRelleno = 0;
        while (bytesDatos.length < totalDatos) {
            bytesDatos.push(bytesRelleno[idxRelleno % 2]);
            idxRelleno++;
        }

        // Segmentación en bloques y Reed-Solomon
        const ecPorBloque = cfg[2];
        const bloquesDatos = [];
        const bloquesEc = [];
        let ptr = 0;

        const procesarBloque = (cant) => {
            const sub = bytesDatos.slice(ptr, ptr + cant);
            ptr += cant;
            bloquesDatos.push(sub);
            bloquesEc.push(calcularReedSolomon(sub, ecPorBloque));
        };

        for (let i = 0; i < cfg[3]; i++) procesarBloque(cfg[4]);
        for (let i = 0; i < cfg[5]; i++) procesarBloque(cfg[6]);

        // Entrelazado (Interleaving)
        const flujoFinal = [];
        const maxDataLen = Math.max(...bloquesDatos.map(b => b.length));
        for (let i = 0; i < maxDataLen; i++) {
            for (let b = 0; b < bloquesDatos.length; b++) {
                if (i < bloquesDatos[b].length) flujoFinal.push(bloquesDatos[b][i]);
            }
        }
        for (let i = 0; i < ecPorBloque; i++) {
            for (let b = 0; b < bloquesEc.length; b++) {
                flujoFinal.push(bloquesEc[b][i]);
            }
        }

        const bitsMatriz = [];
        for (let b of flujoFinal) {
            for (let i = 7; i >= 0; i--) bitsMatriz.push((b >> i) & 1);
        }
        for (let i = 0; i < RESTO_BITS[version]; i++) bitsMatriz.push(0);

        // Inicializar matrices
        const matriz = Array.from({ length: numModulos }, () => Array(numModulos).fill(false));
        const reservado = Array.from({ length: numModulos }, () => Array(numModulos).fill(false));

        const marcar = (r, c, v) => {
            matriz[r][c] = v;
            reservado[r][c] = true;
        };

        // Patrones de búsqueda (Finder Patterns 7x7) + Separadores
        const ponerBuscador = (fil, col) => {
            for (let r = -1; r <= 7; r++) {
                for (let c = -1; c <= 7; c++) {
                    const f = fil + r;
                    const k = col + c;
                    if (f >= 0 && f < numModulos && k >= 0 && k < numModulos) {
                        const esBorde = (r === 0 || r === 6) && (c >= 0 && c <= 6);
                        const esLateral = (c === 0 || c === 6) && (r >= 0 && r <= 6);
                        const esCentro = (r >= 2 && r <= 4) && (c >= 2 && c <= 4);
                        marcar(f, k, esBorde || esLateral || esCentro);
                    }
                }
            }
        };

        ponerBuscador(0, 0);
        ponerBuscador(0, numModulos - 7);
        ponerBuscador(numModulos - 7, 0);

        // Líneas de sincronización (Timing)
        for (let i = 8; i < numModulos - 8; i++) {
            if (!reservado[6][i]) marcar(6, i, i % 2 === 0);
            if (!reservado[i][6]) marcar(i, 6, i % 2 === 0);
        }

        // Patrones de alineación
        const coords = COORD_ALINEACION[version];
        for (let r of coords) {
            for (let c of coords) {
                if (reservado[r][c]) continue;
                for (let dr = -2; dr <= 2; dr++) {
                    for (let dc = -2; dc <= 2; dc++) {
                        const esBorde = Math.abs(dr) === 2 || Math.abs(dc) === 2;
                        const esCentro = dr === 0 && dc === 0;
                        marcar(r + dr, c + dc, esBorde || esCentro);
                    }
                }
            }
        }

        // Módulo oscuro obligatorio
        marcar(numModulos - 8, 8, true);

        // Reservar áreas de información de formato
        for (let i = 0; i < 9; i++) {
            reservado[8][i] = true;
            reservado[i][8] = true;
            if (numModulos - 1 - i >= 0) {
                reservado[8][numModulos - 1 - i] = true;
                reservado[numModulos - 1 - i][8] = true;
            }
        }

        // Distribución zig-zag de datos
        let bitIdx = 0;
        let arriba = true;
        for (let right = numModulos - 1; right > 0; right -= 2) {
            if (right === 6) right--; // Evitar columna de sincronización
            for (let vert = 0; vert < numModulos; vert++) {
                const r = arriba ? (numModulos - 1 - vert) : vert;
                for (let c of [right, right - 1]) {
                    if (!reservado[r][c]) {
                        if (bitIdx < bitsMatriz.length) {
                            matriz[r][c] = bitsMatriz[bitIdx] === 1;
                            bitIdx++;
                        }
                    }
                }
            }
            arriba = !arriba;
        }

        // Evaluación de penalización y selección de la máscara óptima
        let mejorMascara = 0;
        let menorPenalizacion = Infinity;

        for (let m = 0; m < 8; m++) {
            const mascaraFn = MASCARAS[m];
            let penalizacion = 0;

            // Simulación temporal de máscara
            for (let r = 0; r < numModulos; r++) {
                let segR = 0, ultR = -1;
                let segC = 0, ultC = -1;
                for (let c = 0; c < numModulos; c++) {
                    const vR = reservado[r][c] ? matriz[r][c] : (matriz[r][c] ^ mascaraFn(r, c));
                    const vC = reservado[c][r] ? matriz[c][r] : (matriz[c][r] ^ mascaraFn(c, r));

                    if (vR === ultR) {
                        segR++;
                        if (segR === 5) penalizacion += 3;
                        else if (segR > 5) penalizacion += 1;
                    } else { ultR = vR; segR = 1; }

                    if (vC === ultC) {
                        segC++;
                        if (segC === 5) penalizacion += 3;
                        else if (segC > 5) penalizacion += 1;
                    } else { ultC = vC; segC = 1; }
                }
            }

            if (penalizacion < menorPenalizacion) {
                menorPenalizacion = penalizacion;
                mejorMascara = m;
            }
        }

        // Aplicar la mejor máscara sobre los módulos libres
        const fnMascaraFinal = MASCARAS[mejorMascara];
        for (let r = 0; r < numModulos; r++) {
            for (let c = 0; c < numModulos; c++) {
                if (!reservado[r][c]) {
                    if (fnMascaraFinal(r, c)) {
                        matriz[r][c] = !matriz[r][c];
                    }
                }
            }
        }

        // Escribir los 15 bits de información de formato (Nivel M = 0b00)
        const bitsFormato = obtenerBitsFormato(0b00, mejorMascara);

        const colocarBitFormato = (i, val) => {
            // Zona superior izquierda
            if (i <= 5) matriz[8][i] = val;
            else if (i === 6) matriz[8][7] = val;
            else if (i === 7) matriz[8][8] = val;
            else if (i === 8) matriz[7][8] = val;
            else matriz[14 - i][8] = val;

            // Copia dividida (esquina superior derecha e inferior izquierda)
            if (i < 8) {
                matriz[8][numModulos - 1 - i] = val;
            } else {
                matriz[numModulos - 15 + i][8] = val;
            }
        };

        for (let i = 0; i < 15; i++) {
            colocarBitFormato(i, ((bitsFormato >> i) & 1) === 1);
        }

        return matriz;
    }
};
