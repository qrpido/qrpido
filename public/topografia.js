// =======================================================
// GEOKATU CAD - MOTOR TOPOGRÁFICO MATEMÁTICO (topografia.js)
// Navegación Georreferenciada Interactiva en MapLibre GL
// 1. Undo/Deshacer - 2. Datalist Memoria - 3. Lotes & Snap - 4. CAD Text
// =======================================================

import GeokatuDB from './core-db.js';
window.GeokatuDB = GeokatuDB;

// =========================================================================
// 0. MOTOR GEODÉSICO DE PROYECCIÓN (GeoCRS)
// =========================================================================
const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257222101;
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F;

function proyectarTransversaMercator(latDeg, lngDeg, lat0Deg, lng0Deg, k0, falsoEste, falsoNorte) {
    const lat = latDeg * Math.PI / 180;
    const lng = lngDeg * Math.PI / 180;
    const lat0 = lat0Deg * Math.PI / 180;
    const lng0 = lng0Deg * Math.PI / 180;

    const e2 = WGS84_E2;
    const ep2 = e2 / (1 - e2);

    const N = WGS84_A / Math.sqrt(1 - e2 * Math.sin(lat) * Math.sin(lat));
    const T = Math.tan(lat) * Math.tan(lat);
    const C = ep2 * Math.cos(lat) * Math.cos(lat);
    const A = (lng - lng0) * Math.cos(lat);

    function arcoMeridiano(phi) {
        return WGS84_A * (
            (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * phi
            - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * phi)
            + (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * phi)
            - (35 * e2 * e2 / 3072) * Math.sin(6 * phi)
        );
    }

    const M = arcoMeridiano(lat);
    const M0 = arcoMeridiano(lat0);

    const x = k0 * N * (
        A + (1 - T + C) * Math.pow(A, 3) / 6
        + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5) / 120
    );

    const y = k0 * (
        M - M0 + N * Math.tan(lat) * (
            A * A / 2
            + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24
            + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6) / 720
        )
    );

    return {
        este: Number((falsoEste + x).toFixed(3)),
        norte: Number((falsoNorte + y).toFixed(3))
    };
}

window.GeoCRS = {
    toCTM12: function(lat, lng) {
        const p = proyectarTransversaMercator(lat, lng, 4.0, -73.0, 0.9992, 5000000.0, 2000000.0);
        return { ...p, label: "ORIGEN NACIONAL CTM12 (EPSG: 9377)" };
    },
    toREGVEN: function(lat, lng) {
        let huso = 19;
        let centralMeridian = -69.0;
        let label = "SIRGAS-REGVEN UTM HUSO 19N (EPSG: 2202)";

        if (lng < -72.0) {
            huso = 18;
            centralMeridian = -75.0;
            label = "SIRGAS-REGVEN UTM HUSO 18N (EPSG: 2201)";
        } else if (lng > -66.0) {
            huso = 20;
            centralMeridian = -63.0;
            label = "SIRGAS-REGVEN UTM HUSO 20N (EPSG: 2203)";
        }

        const p = proyectarTransversaMercator(lat, lng, 0.0, centralMeridian, 0.9996, 500000.0, 0.0);
        return { ...p, huso, label };
    },
    toLocal: function() {
        return { este: 500000.000, norte: 1000000.000, label: "PLANO TOPOGRÁFICO LOCAL" };
    }
};

function resolverCoordenadasOrigenCRS(lat, lng, tipoCRS) {
    if (tipoCRS === 'CTM12') return window.GeoCRS.toCTM12(lat, lng);
    if (tipoCRS === 'REGVEN') return window.GeoCRS.toREGVEN(lat, lng);
    return window.GeoCRS.toLocal();
}
// =========================================================================
// FACTOR DE ESCALA COMBINADO (k_comb = k_proy * k_h)
// Corrige la deformación por altura y proyección en predios grandes (> 10 ha)
// =========================================================================
function calcularFactorEscalaCombinado(latDeg, lngDeg, elevacionMetros = 1400, crsTipo = 'CTM12') {
    // 1. Factor de elevación (Reducción al elipsoide): kh = R / (R + h)
    const R = 6378137.0;
    const kh = R / (R + Math.max(0, elevacionMetros));

    // 2. Factor de escala cartográfico según meridiano central
    let k0 = 0.9992; // CTM12 por defecto
    let centralMeridian = -73.0;

    if (crsTipo === 'REGVEN') {
        k0 = 0.9996;
        centralMeridian = lngDeg < -72.0 ? -75.0 : (lngDeg > -66.0 ? -63.0 : -69.0);
    } else if (crsTipo === 'LOCAL') {
        return 1.0; // Plano plano local sin factor de deformación
    }

    const dLngRad = (lngDeg - centralMeridian) * Math.PI / 180;
    const cosLat = Math.cos(latDeg * Math.PI / 180);
    // Aproximación de segundo orden de escala transversal: k_proy ≈ k0 * (1 + (Δλ * cos(φ))^2 / 2)
    const k_proy = k0 * (1 + Math.pow(dLngRad * cosLat, 2) / 2);

    return Number((k_proy * kh).toFixed(7));
}

function desplazarCoordenadaMetros(latBase, lngBase, deltaE, deltaN) {
    const dLat = deltaN / WGS84_A;
    const dLng = deltaE / (WGS84_A * Math.cos(latBase * Math.PI / 180));
    return {
        lat: latBase + (dLat * 180 / Math.PI),
        lng: lngBase + (dLng * 180 / Math.PI)
    };
}

function calcularRumboCatastral(deltaE, deltaN) {
    const angRad = Math.atan2(deltaE, deltaN);
    let deg = angRad * (180 / Math.PI);
    if (deg < 0) deg += 360;

    if (deg >= 0 && deg <= 90) return `N ${formatoDMS(deg)} E`;
    if (deg > 90 && deg <= 180) return `S ${formatoDMS(180 - deg)} E`;
    if (deg > 180 && deg <= 270) return `S ${formatoDMS(deg - 180)} W`;
    return `N ${formatoDMS(360 - deg)} W`;
}

function formatoDMS(deg) {
    const d = Math.floor(deg);
    const m = Math.floor((deg - d) * 60);
    const s = Math.round(((deg - d) * 60 - m) * 60);
    return `${d}° ${String(m).padStart(2, '0')}' ${String(s).padStart(2, '0')}"`;
}

// ==========================================
// 1. ESTADO GENERAL Y VARIABLES
// ==========================================
let idNegocio = localStorage.getItem('geokatu_active_uid') || null;
let idPlanoActivo = "PREDIO_PRINCIPAL";
let nombrePredioActivo = "Lote Principal";
let propietarioActivo = "Particular";
let municipioActivo = "Pereira, Risaralda";
let crsSeleccionado = "CTM12";

let vertices = []; 
let cuadrosTexto = [];
let lotesInternos = []; 
let trazoLoteActivo = []; 

let gpsActual = null;
let poligonoCerrado = false;
let modoTextoActivo = false;
let primerPuntoTexto = null; 
let textoEnEdicionId = null;

let modoLotesActivo = false;
let puntoImantado = null; 

let mapaBase = null;
let cupoPlanosCache = { descargas: 0, maximo: 10 };
// Control continuo de contraste y visibilidad del mapa
const sliderContraste = document.getElementById('slider-contraste-mapa');
if (sliderContraste) {
    sliderContraste.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value) / 100;
        const mapaEl = document.getElementById('mapa-fondo-pmtiles');
       if (mapaEl) {
            mapaEl.style.opacity = val;
            mapaEl.style.filter = val > 0 
                ? 'grayscale(' + ((1 - val) * 50) + '%) brightness(' + (0.75 + val * 0.25) + ')'
                : 'none';
        }
    });
}


const canvas = document.getElementById('canvas-plano');
const ctx = canvas.getContext('2d');
const contenedorTextos = document.getElementById('contenedor-textos-libres');

const btnCapturar = document.getElementById('btn-capturar-mojon');
const btnCerrar = document.getElementById('btn-cerrar-poligono');
const btnDeshacer = document.getElementById('btn-deshacer-mojon');
const btnModoLotes = document.getElementById('btn-modo-lotes');
const btnTerminarLote = document.getElementById('btn-terminar-lote');
const modalCinta = document.getElementById('modal-cinta');
const inputDistCinta = document.getElementById('input-dist-cinta');
const inputColindante = document.getElementById('input-colindante');

// ==========================================
// 2. OBSERVADOR DE SESIÓN Y BORRADOR
// ==========================================
GeokatuDB.SecurityService.observarEstadoSesion(async (user) => {
    const btnPortal = document.getElementById('btn-portal-mando');
    const btnLoginSub = document.getElementById('btn-login-submenu');
    const btnMisPlanos = document.getElementById('btn-mis-planos');
    const btnSalir = document.getElementById('btn-salir-topo');
    const formLogin = document.getElementById('form-login-activo');
    const panelActivo = document.getElementById('panel-usuario-activo');
    const nombreUsuario = document.getElementById('nombre-usuario-activo');

    if (user) {
        idNegocio = user.uid;
        if (btnPortal) btnPortal.style.background = 'var(--naranja)';
        if (btnLoginSub) btnLoginSub.style.display = 'none';
        if (btnMisPlanos) btnMisPlanos.style.display = 'block';
        if (btnSalir) btnSalir.style.display = 'block';
        if (formLogin) formLogin.style.display = 'none';
        if (panelActivo) panelActivo.style.display = 'block';
        if (nombreUsuario) nombreUsuario.innerText = user.email;
    } else {
        idNegocio = null;
        if (btnPortal) btnPortal.style.background = 'var(--glass-bg)';
        if (btnLoginSub) btnLoginSub.style.display = 'block';
        if (btnMisPlanos) btnMisPlanos.style.display = 'none';
        if (btnSalir) btnSalir.style.display = 'none';
        if (formLogin) formLogin.style.display = 'block';
        if (panelActivo) panelActivo.style.display = 'none';
    }
    await actualizarBadgeCupoDOM();
});

function guardarBorradorEnDispositivo() {
    const borrador = {
        vertices,
        cuadrosTexto,
        lotesInternos,
        poligonoCerrado,
        idPlano: idPlanoActivo,
        nombrePredio: nombrePredioActivo,
        propietario: propietarioActivo,
        municipio: municipioActivo,
        crsSeleccionado,
        timestamp: Date.now()
    };
    localStorage.setItem(`geokatu_topografia_borrador_${idNegocio || 'LOCAL'}`, JSON.stringify(borrador));
}

function restaurarBorradorLocal() {
    const data = localStorage.getItem(`geokatu_topografia_borrador_${idNegocio || 'LOCAL'}`);
    if (!data) return false;
    try {
        const b = JSON.parse(data);
        if (b && Array.isArray(b.vertices) && b.vertices.length > 0) {
            vertices = b.vertices;
            cuadrosTexto = b.cuadrosTexto || [];
            lotesInternos = b.lotesInternos || [];
            poligonoCerrado = Boolean(b.poligonoCerrado);
            idPlanoActivo = b.idPlano || idPlanoActivo;
            nombrePredioActivo = b.nombrePredio || nombrePredioActivo;
            propietarioActivo = b.propietario || propietarioActivo;
            municipioActivo = b.municipio || municipioActivo;
            crsSeleccionado = b.crsSeleccionado || "CTM12";

            const selectCRS = document.getElementById('select-crs-oficial');
            if (selectCRS) selectCRS.value = crsSeleccionado;

            actualizarEstadoBotonesAccion();

            if (contenedorTextos) contenedorTextos.innerHTML = '';
            cuadrosTexto.forEach(ct => inyectarElementoTextoDOM(ct));

            actualizarRotulosPlanoDOM();
            return true;
        }
    } catch (e) {
        console.warn("Borrador corrupto:", e);
    }
    return false;
}

function actualizarEstadoBotonesAccion() {
    if (poligonoCerrado) {
        btnCapturar.style.display = 'none';
        btnCerrar.style.display = 'none';
        btnDeshacer.style.display = 'flex';
        btnModoLotes.disabled = false;
        btnModoLotes.style.opacity = '1';
    } else {
        btnCapturar.style.display = 'flex';
        btnModoLotes.disabled = true;
        btnModoLotes.style.opacity = '0.5';

        if (vertices.length === 0) {
            btnCapturar.innerText = "📍 Fijar Mojón (P1)";
            btnCerrar.style.display = 'none';
            btnDeshacer.style.display = 'none';
        } else {
            btnCapturar.innerText = '📍 Marcar Mojón (P' + (vertices.length + 1) + ')';
            btnDeshacer.style.display = 'flex';
            btnCerrar.style.display = vertices.length >= 3 ? 'flex' : 'none';
        }
    }
}

function redimensionarLienzo() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    if (mapaBase) dibujarPlano();
}
window.addEventListener('resize', redimensionarLienzo);

// =========================================================================
// 3. TELEMETRÍA GPS Y SEGUIMIENTO EN VIVO
// =========================================================================
if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition(
        (pos) => {
            const acc = pos.coords.accuracy;
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            gpsActual = { lat, lng, precision: acc };

            const iconoSat = document.getElementById('icono-sat');
            const badgePct = document.getElementById('badge-pct-gps');

            if (badgePct) {
                let pct = Math.round(Math.max(10, Math.min(100, 100 - ((acc - 2.5) / 22.5) * 90)));
                badgePct.innerText = pct + '% (±' + acc.toFixed(1) + 'm)';
                badgePct.classList.remove('precision-optima', 'precision-media', 'precision-baja');

                if (acc <= 4.0) {
                    badgePct.classList.add('precision-optima');
                    if (iconoSat) iconoSat.classList.add('fijando');
                } else if (acc <= 9.0) {
                    badgePct.classList.add('precision-media');
                    if (iconoSat) iconoSat.classList.remove('fijando');
                } else {
                    badgePct.classList.add('precision-baja');
                    if (iconoSat) iconoSat.classList.remove('fijando');
                }
            }
            dibujarPlano();
        },
        () => {
            const badgePct = document.getElementById('badge-pct-gps');
            if (badgePct) {
                badgePct.innerText = '0% (Sin Señal)';
                badgePct.className = 'badge-precision-gps precision-baja';
            }
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 6000 }
    );
}

// =========================================================================
// 4. MEJORA 1: DESHACER (UNDO) DE MOJONES Y TRAZOS
// =========================================================================
btnDeshacer.addEventListener('click', () => {
    if (modoLotesActivo) {
        if (trazoLoteActivo.length > 0) {
            trazoLoteActivo.pop();
            dibujarPlano();
            return;
        }
    }

    if (vertices.length === 0) return;

    if (poligonoCerrado) {
        // Reabrir poligonal
        vertices.pop(); // Quitar P1 de cierre
        poligonoCerrado = false;
        actualizarEstadoBotonesAccion();
        actualizarTablaCoordenadasDOM();
        actualizarRotulosPlanoDOM();
        dibujarPlano();
        guardarBorradorEnDispositivo();
        return;
    }

    // Quitar último mojón normal
    vertices.pop();
    actualizarEstadoBotonesAccion();
    actualizarTablaCoordenadasDOM();
    dibujarPlano();
    guardarBorradorEnDispositivo();
});

// =========================================================================
// 5. MEJORA 2: DATALIST INTELIGENTE Y PRECARGA DE COLINDANTES
// =========================================================================
function actualizarDatalistColindantes() {
    const datalist = document.getElementById('lista-colindantes-sugeridos');
    if (!datalist) return;
    datalist.innerHTML = '';

    const colindantesSet = new Set();
    vertices.forEach(v => {
        if (v.colindante && 
            v.colindante !== "Punto de Partida" && 
            v.colindante !== "Cierre de Poligonal" && 
            v.colindante !== "Sin especificar") {
            colindantesSet.add(v.colindante.trim());
        }
    });

    colindantesSet.forEach(nombre => {
        const opt = document.createElement('option');
        opt.value = nombre;
        datalist.appendChild(opt);
    });
}

btnCapturar.addEventListener('click', () => {
    if (poligonoCerrado) return alert("El predio se encuentra cerrado.");

    if (vertices.length === 0) {
        const origenGps = gpsActual || { lat: 4.8133, lng: -75.6961, precision: 5.0 };
        const baseProyectada = resolverCoordenadasOrigenCRS(origenGps.lat, origenGps.lng, crsSeleccionado);

        vertices.push({
            id: 1,
            lat: origenGps.lat,
            lng: origenGps.lng,
            e: baseProyectada.este,
            n: baseProyectada.norte,
            deltaE_acum: 0,
            deltaN_acum: 0,
            distCinta: 0,
            rumboStr: "---",
            colindante: "Punto de Partida",
            crsLabel: baseProyectada.label
        });

        if (mapaBase) {
            mapaBase.flyTo({ center: [origenGps.lng, origenGps.lat], zoom: 18.5, duration: 1200 });
        }

        actualizarEstadoBotonesAccion();
        guardarBorradorEnDispositivo();
        dibujarPlano();
    } else {
        const sig = vertices.length + 1;
       document.getElementById('txt-titulo-tramo').innerText = 'Medición Tramo P' + (sig - 1) + ' ➔ P' + sig; 
        inputDistCinta.value = '';

        // Precargar el colindante del tramo anterior por defecto
        const vUltimo = vertices[vertices.length - 1];
        if (vUltimo && vUltimo.colindante && vUltimo.colindante !== "Punto de Partida") {
            inputColindante.value = vUltimo.colindante;
        } else {
            inputColindante.value = '';
        }

        actualizarDatalistColindantes();
        modalCinta.style.display = 'flex';
        setTimeout(() => inputDistCinta.focus(), 100);
    }
});

document.getElementById('btn-asentar-cinta').addEventListener('click', () => {
    const dist = parseFloat(inputDistCinta.value);
    const colindante = inputColindante.value.trim() || "Sin especificar";
    const modoGiro = document.getElementById('select-giro-modo').value;

    if (isNaN(dist) || dist <= 0.1) return alert("Digita una distancia válida en metros.");

    const vAnt = vertices[vertices.length - 1];
    const vBase = vertices[0];
    let azimut = 0;

    if (modoGiro === 'GIRO_90_DER' && vAnt.azimut !== undefined) {
        azimut = vAnt.azimut + (Math.PI / 2);
    } else if (modoGiro === 'GIRO_90_IZQ' && vAnt.azimut !== undefined) {
        azimut = vAnt.azimut - (Math.PI / 2);
    } else {
        if (gpsActual) {
            const dLat = (gpsActual.lat - vAnt.lat) * (Math.PI / 180) * WGS84_A;
            const dLng = (gpsActual.lng - vAnt.lng) * (Math.PI / 180) * WGS84_A * Math.cos(vAnt.lat * Math.PI / 180);
            azimut = Math.atan2(dLng, dLat);
        } else {
            azimut = vAnt.azimut !== undefined ? vAnt.azimut : 0;
        }
    }

    azimut = (azimut + 2 * Math.PI) % (2 * Math.PI);

    const dE = dist * Math.sin(azimut);
    const dN = dist * Math.cos(azimut);
    const nuevoDeltaE = vAnt.deltaE_acum + dE;
    const nuevoDeltaN = vAnt.deltaN_acum + dN;

    const nuevoPuntoGeo = desplazarCoordenadaMetros(vBase.lat, vBase.lng, nuevoDeltaE, nuevoDeltaN);
    const nuevaProy = resolverCoordenadasOrigenCRS(nuevoPuntoGeo.lat, nuevoPuntoGeo.lng, crsSeleccionado);
    const rumbo = calcularRumboCatastral(dE, dN);

    vertices.push({
        id: vertices.length + 1,
        lat: nuevoPuntoGeo.lat,
        lng: nuevoPuntoGeo.lng,
        e: nuevaProy.este,
        n: nuevaProy.norte,
        deltaE_acum: Number(nuevoDeltaE.toFixed(3)),
        deltaN_acum: Number(nuevoDeltaN.toFixed(3)),
        distCinta: dist,
        azimut,
        rumboStr: rumbo,
        colindante
    });

    modalCinta.style.display = 'none';
    actualizarEstadoBotonesAccion();
    guardarBorradorEnDispositivo();
    dibujarPlano();
});

document.getElementById('btn-cancelar-cinta').addEventListener('click', () => {
    modalCinta.style.display = 'none';
});

// =========================================================================
// 6. MEJORA 3: LÁPIZ DE LOTES INTERNOS CON MAGNETISMO (SNAP) Y ÁREA AUTOMÁTICA
// =========================================================================
btnModoLotes.addEventListener('click', () => {
    if (!poligonoCerrado) return alert("Debes cerrar la poligonal principal antes de trazar lotes internos.");
    modoLotesActivo = !modoLotesActivo;

    btnModoLotes.classList.toggle('lotes-activo', modoLotesActivo);
    btnTerminarLote.style.display = modoLotesActivo ? 'flex' : 'none';

    if (modoLotesActivo) {
        trazoLoteActivo = [];
        alert("✏️ Modo Lápiz Activado:\nToca las esquinas deseadas. El trazo se imanta automáticamente a los mojones.");
    } else {
        trazoLoteActivo = [];
    }
    dibujarPlano();
});

// Algoritmo de detección de Snap (Magnetismo)
function detectarSnapPunto(pixelX, pixelY, umbralPx = 20) {
    if (!mapaBase) return null;

    // 1. Revisar todos los mojones principales
    for (let i = 0; i < vertices.length; i++) {
        const pt = mapaBase.project([vertices[i].lng, vertices[i].lat]);
        if (Math.hypot(pt.x - pixelX, pt.y - pixelY) <= umbralPx) {
            return { lat: vertices[i].lat, lng: vertices[i].lng, idRef: 'P' + vertices[i].id };
        }
    }

    // 2. Revisar vértices de otros lotes internos ya trazados
    for (const lote of lotesInternos) {
        for (let j = 0; j < lote.vertices.length; j++) {
            const pt = mapaBase.project([lote.vertices[j].lng, lote.vertices[j].lat]);
            if (Math.hypot(pt.x - pixelX, pt.y - pixelY) <= umbralPx) {
                return { lat: lote.vertices[j].lat, lng: lote.vertices[j].lng, idRef: 'Vértice Lote' };
            }
        }
    }

    // 3. Revisar punto de inicio del lote activo para autocierre
    if (trazoLoteActivo.length > 2) {
        const ptIni = mapaBase.project([trazoLoteActivo[0].lng, trazoLoteActivo[0].lat]);
        if (Math.hypot(ptIni.x - pixelX, ptIni.y - pixelY) <= umbralPx) {
            return { lat: trazoLoteActivo[0].lat, lng: trazoLoteActivo[0].lng, idRef: 'Cierre de Lote' };
        }
    }

    return null;
}

btnTerminarLote.addEventListener('click', () => {
    if (trazoLoteActivo.length < 3) {
        return alert("Un lote requiere mínimo 3 puntos.");
    }

    // Calcular área del lote interno por Shoelace
    const vBase = vertices[0];
    let sumaArea = 0;
    const n = trazoLoteActivo.length;

    // Convertir a metros locales respecto a P1
    const ptsMetros = trazoLoteActivo.map(p => {
        const dLat = (p.lat - vBase.lat) * (Math.PI / 180) * WGS84_A;
        const dLng = (p.lng - vBase.lng) * (Math.PI / 180) * WGS84_A * Math.cos(vBase.lat * Math.PI / 180);
        return { x: dLng, y: dLat };
    });

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        sumaArea += (ptsMetros[i].x * ptsMetros[j].y) - (ptsMetros[j].x * ptsMetros[i].y);
    }
    const areaLote = Math.abs(sumaArea) / 2;

    // Centroide aproximado
    let cLat = 0, cLng = 0;
    trazoLoteActivo.forEach(p => { cLat += p.lat; cLng += p.lng; });
    cLat /= n; cLng /= n;

    const numLote = lotesInternos.length + 1;
    lotesInternos.push({
        id: Date.now(),
        numero: numLote,
        vertices: [...trazoLoteActivo],
        area_m2: Number(areaLote.toFixed(2)),
        centroide: { lat: cLat, lng: cLng }
    });

    trazoLoteActivo = [];
    guardarBorradorEnDispositivo();
    dibujarPlano();
    alert(`🎉 Lote ${numLote} creado con éxito:\nSuperficie: ${areaLote.toFixed(2)} m²`);
});

// =========================================================================
// 7. TEXTO CAD EN VIVO EN PANTALLA (ESTILO AUTOCAD MTEXT - SIN MODALES)
// =========================================================================
let editorCadActivoEl = null;

document.getElementById('btn-modo-texto').addEventListener('click', () => {
    modoTextoActivo = !modoTextoActivo;
    document.getElementById('btn-modo-texto').classList.toggle('activo', modoTextoActivo);
});

// Abre un campo de texto interactivo directamente en las coordenadas tocadas
function abrirEditorTextoEnVivo(lat, lng, textoInicial = "", idExistente = null) {
    cerrarEditorTextoEnVivo(); // Si había otro abierto, consolidarlo

    const pt = mapaBase.project([lng, lat]);
    const textarea = document.createElement('textarea');
    textarea.className = 'editor-cad-en-vivo';
    textarea.value = textoInicial;
    textarea.placeholder = "Escribe texto...";
    textarea.style.left = pt.x + 'px';
    textarea.style.top = pt.y + 'px';

    // Ajustar altura automáticamente al escribir
    textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    });

    // Consolidar al hacer clic fuera o presionar Shift+Enter
    const finalizar = () => {
        const valor = textarea.value.trim();
        if (valor) {
            if (idExistente) {
                const item = cuadrosTexto.find(t => t.id === idExistente);
                if (item) item.texto = valor;
            } else {
                const nuevoItem = { id: Date.now(), lat, lng, texto: valor };
                cuadrosTexto.push(nuevoItem);
                inyectarElementoTextoDOM(nuevoItem);
            }
            guardarBorradorEnDispositivo();
            actualizarPosicionTextosLibres();
        } else if (idExistente) {
            // Si lo dejó vacío, se borra
            cuadrosTexto = cuadrosTexto.filter(t => t.id !== idExistente);
            const dom = document.getElementById(`texto-cad-${idExistente}`);
            if (dom) dom.remove();
            guardarBorradorEnDispositivo();
        }
        cerrarEditorTextoEnVivo();
        dibujarPlano();
    };

    textarea.addEventListener('blur', finalizar);
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            textarea.value = textoInicial;
            finalizar();
        }
    });

    document.body.appendChild(textarea);
    editorCadActivoEl = { el: textarea, lat, lng };

    setTimeout(() => {
        textarea.focus();
        textarea.select();
    }, 50);
}

function cerrarEditorTextoEnVivo() {
    if (editorCadActivoEl && editorCadActivoEl.el) {
        editorCadActivoEl.el.remove();
        editorCadActivoEl = null;
    }
}

function inyectarElementoTextoDOM(item) {
    let el = document.getElementById('texto-cad-' + item.id);
    if (!el) {
        el = document.createElement('div');
        el.id = 'texto-cad-' + item.id;

        el.className = 'cuadro-texto-cad';
        el.innerText = item.texto;

        // Al tocar cualquier texto en pantalla, se abre el editor en vivo sobre él
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            abrirEditorTextoEnVivo(item.lat, item.lng, item.texto, item.id);
        });

        contenedorTextos.appendChild(el);
    } else {
        el.innerText = item.texto;
    }
}




// =========================================================================
// 8. RENDERIZADO CANVAS EN TIEMPO REAL (60 FPS)
// =========================================================================
function dibujarPlano() {
    if (!mapaBase) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    // 1. Estado "Listo para P1"
    if (vertices.length === 0) {
        const centroCoord = gpsActual ? [gpsActual.lng, gpsActual.lat] : mapaBase.getCenter().toArray();
        const pt = mapaBase.project(centroCoord);

        ctx.strokeStyle = 'rgba(255, 107, 0, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(pt.x - 14, pt.y); ctx.lineTo(pt.x + 14, pt.y);
        ctx.moveTo(pt.x, pt.y - 14); ctx.lineTo(pt.x, pt.y + 14);
        ctx.stroke();

        dibujarAvatarPulsante(ctx, pt.x, pt.y);

        ctx.fillStyle = '#00ff64';
        ctx.font = 'bold 11px monospace';
        ctx.fillText("LISTO PARA P1", pt.x + 12, pt.y + 4);

        ctx.restore();
        return;
    }

    // 2. Poligonal Principal Exterior
    ctx.beginPath();
    ctx.strokeStyle = poligonoCerrado ? '#00ff64' : '#ff6b00';
    ctx.lineWidth = 3;

    vertices.forEach((v, idx) => {
        const pt = mapaBase.project([v.lng, v.lat]);
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
    });

    if (poligonoCerrado) {
        ctx.fillStyle = 'rgba(0, 255, 100, 0.08)';
        ctx.fill();
    }
    ctx.stroke();

    // 3. Dibujar Lotes Internos Subdivididos
    lotesInternos.forEach(lote => {
        ctx.beginPath();
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);

        lote.vertices.forEach((lv, lIdx) => {
            const lPt = mapaBase.project([lv.lng, lv.lat]);
            if (lIdx === 0) ctx.moveTo(lPt.x, lPt.y);
            else ctx.lineTo(lPt.x, lPt.y);
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(0, 240, 255, 0.08)';
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        // Área en el centroide
        const cPt = mapaBase.project([lote.centroide.lng, lote.centroide.lat]);
        ctx.fillStyle = '#00f0ff';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('LOTE ' + lote.numero, cPt.x, cPt.y - 4);
        ctx.fillText(lote.area_m2 + ' m²', cPt.x, cPt.y + 8);
        ctx.textAlign = 'start';
    });

    // 4. Trazo Activo de Lote en Proceso
    if (trazoLoteActivo.length > 0) {
        ctx.beginPath();
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        trazoLoteActivo.forEach((tv, tIdx) => {
            const tPt = mapaBase.project([tv.lng, tv.lat]);
            if (tIdx === 0) ctx.moveTo(tPt.x, tPt.y);
            else ctx.lineTo(tPt.x, tPt.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // 5. Línea Elástica (Rubber-band)
    if (!poligonoCerrado && vertices.length > 0 && gpsActual) {
        const ultimoMojon = vertices[vertices.length - 1];
        const ptUltimo = mapaBase.project([ultimoMojon.lng, ultimoMojon.lat]);
        const ptGps = mapaBase.project([gpsActual.lng, gpsActual.lat]);

        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = '#00ff64';
        ctx.lineWidth = 2;
        ctx.moveTo(ptUltimo.x, ptUltimo.y);
        ctx.lineTo(ptGps.x, ptGps.y);
        ctx.stroke();
        ctx.restore();

        dibujarAvatarPulsante(ctx, ptGps.x, ptGps.y);

        const distAprox = Math.hypot(
            (gpsActual.lng - ultimoMojon.lng) * WGS84_A * Math.cos(ultimoMojon.lat * Math.PI / 180) * (Math.PI / 180),
            (gpsActual.lat - ultimoMojon.lat) * WGS84_A * (Math.PI / 180)
        );

        ctx.fillStyle = '#00ff64';
        ctx.font = 'bold 11px monospace';
        ctx.fillText('~' + distAprox.toFixed(1) + 'm (GPS)', ptGps.x + 10, ptGps.y + 4);
    }

    // 6. Mojones y Cotas Métricas
    vertices.forEach((v, idx) => {
        const pt = mapaBase.project([v.lng, v.lat]);

        ctx.fillStyle = idx === 0 ? '#00ff64' : '#ff6b00';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.8;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px monospace';
        ctx.fillText('P' + v.id, pt.x + 8, pt.y - 8);

        if (idx > 0 && v.distCinta > 0) {
            const vAnt = vertices[idx - 1];
            const ptAnt = mapaBase.project([vAnt.lng, vAnt.lat]);
            const midX = (ptAnt.x + pt.x) / 2;
            const midY = (ptAnt.y + pt.y) / 2;

            ctx.fillStyle = '#ffaa00';
            ctx.font = '10px monospace';
            ctx.fillText(v.distCinta.toFixed(2) + 'm [' + v.colindante + ']', midX, midY - 5);
        }
    });

    // 7. Indicador Visual de Magnetismo (Snap CAD)
    if (puntoImantado) {
        const sPt = mapaBase.project([puntoImantado.lng, puntoImantado.lat]);
        ctx.strokeStyle = '#00ff64';
        ctx.lineWidth = 2;
        ctx.strokeRect(sPt.x - 7, sPt.y - 7, 14, 14);
        ctx.fillStyle = '#00ff64';
        ctx.font = 'bold 9px monospace';
        ctx.fillText('SNAP: ' + puntoImantado.idRef, sPt.x + 10, sPt.y - 4);
    }

    actualizarPosicionTextosLibres();
    ctx.restore();
}

function dibujarAvatarPulsante(context, x, y) {
    const pulso = 7 + 4 * Math.sin(performance.now() / 250);
    context.save();
    context.beginPath();
    context.arc(x, y, pulso, 0, Math.PI * 2);
    context.fillStyle = 'rgba(0, 255, 100, 0.25)';
    context.fill();

    context.beginPath();
    context.arc(x, y, 4.5, 0, Math.PI * 2);
    context.fillStyle = '#00ff64';
    context.fill();
    context.strokeStyle = '#ffffff';
    context.lineWidth = 1.5;
    context.stroke();
    context.restore();
}

function actualizarPosicionTextosLibres() {
    cuadrosTexto.forEach(item => {
        const el = document.getElementById('texto-cad-' + item.id);
        if (el && mapaBase) {
            const pt = mapaBase.project([item.lng, item.lat]);
            el.style.left = pt.x + 'px';
            el.style.top = pt.y + 'px';
        }
    });

    if (editorCadActivoEl && editorCadActivoEl.el && mapaBase) {
        const ptEditor = mapaBase.project([editorCadActivoEl.lng, editorCadActivoEl.lat]);
        editorCadActivoEl.el.style.left = ptEditor.x + 'px';
        editorCadActivoEl.el.style.top = ptEditor.y + 'px';
    }
}



// =========================================================================
// 9. EVENTOS DEL MAPA (CLICS, TOUCH Y SNAP)
// =========================================================================
function vincularInteraccionMapLibre() {
    // Detección continua de Snap
    mapaBase.on('mousemove', (e) => {
        if (modoLotesActivo) {
            puntoImantado = detectarSnapPunto(e.point.x, e.point.y);
            dibujarPlano();
        }
    });

    mapaBase.on('click', (e) => {
        // Clic en modo Lápiz de Lotes
        if (modoLotesActivo) {
            const snap = detectarSnapPunto(e.point.x, e.point.y);
            const ptElegido = snap ? { lat: snap.lat, lng: snap.lng } : { lat: e.lngLat.lat, lng: e.lngLat.lng };
            trazoLoteActivo.push(ptElegido);
            dibujarPlano();
            return;
        }

       // Tocar el mapa en modo texto abre el editor directamente en pantalla
        if (modoTextoActivo) {
            abrirEditorTextoEnVivo(e.lngLat.lat, e.lngLat.lng, "");
            modoTextoActivo = false;
            document.getElementById('btn-modo-texto').classList.remove('activo');
            return;
        }

    });
}

// ==========================================
// 10. CIERRE DE POLIGONAL, MEMORIA Y PDF
// ==========================================
btnCerrar.addEventListener('click', () => {
    document.getElementById('input-dist-cierre').value = '';
    document.getElementById('input-nombre-predio').value = nombrePredioActivo;
    document.getElementById('input-propietario-predio').value = propietarioActivo;
    document.getElementById('input-municipio-predio').value = municipioActivo;
    document.getElementById('select-crs-oficial').value = crsSeleccionado;
    document.getElementById('modal-cierre-predio').style.display = 'flex';
});

document.getElementById('btn-cancelar-cierre').addEventListener('click', () => {
    document.getElementById('modal-cierre-predio').style.display = 'none';
});

document.getElementById('btn-confirmar-cierre').addEventListener('click', () => {
    const distFinal = parseFloat(document.getElementById('input-dist-cierre').value);
    if (isNaN(distFinal) || distFinal <= 0.1) return alert("Digita la distancia de retorno a P1.");

    const nuevoCRS = document.getElementById('select-crs-oficial').value;
    if (nuevoCRS !== crsSeleccionado) aplicarCambioCRS(nuevoCRS);

    nombrePredioActivo = document.getElementById('input-nombre-predio').value.trim() || "Predio Sin Nombre";
    propietarioActivo = document.getElementById('input-propietario-predio').value.trim() || "Particular";
    municipioActivo = document.getElementById('input-municipio-predio').value.trim() || "Pereira, Risaralda";
   idPlanoActivo = 'PLANO_' + nombrePredioActivo.replace(/[^a-zA-Z0-9_-]/g, '_').toUpperCase();

    const ultimo = vertices[vertices.length - 1];
    const primero = vertices[0];
    const deltaE_cierre = primero.e - ultimo.e;
    const deltaN_cierre = primero.n - ultimo.n;
    const rumboFinal = calcularRumboCatastral(deltaE_cierre, deltaN_cierre);

    vertices.push({
        id: 1,
        lat: primero.lat,
        lng: primero.lng,
        e: primero.e,
        n: primero.n,
        deltaE_acum: 0,
        deltaN_acum: 0,
        distCinta: distFinal,
        rumboStr: rumboFinal,
        colindante: "Cierre de Poligonal"
    });

    poligonoCerrado = true;
    document.getElementById('modal-cierre-predio').style.display = 'none';
    actualizarEstadoBotonesAccion();

    actualizarRotulosPlanoDOM();
    actualizarTablaCoordenadasDOM();
    dibujarPlano();
    guardarBorradorEnDispositivo();

    // Sincronización Oneshot
    (async () => {
        const areaTexto = document.getElementById('rot-area')?.innerText || "0.00 m²";
        const perimetroTexto = document.getElementById('rot-perimetro')?.innerText || "0.00 m";
        const memoriaNotarial = generarMemoriaLinderosNotarial();
        const crsLabelActivo = vertices[0]?.crsLabel || crsSeleccionado;

        const paqueteOneshot = {
            id_predio: idPlanoActivo,
            nombre_predio: nombrePredioActivo,
            propietario: propietarioActivo,
            municipio: municipioActivo,
            sistema_coordenadas: crsLabelActivo,
            codigo_crs: crsSeleccionado,
            total_vertices: vertices.length - 1,
            area_m2: areaTexto,
            perimetro_m: perimetroTexto,
            coordenada_origen_gps: { lat: vertices[0].lat, lng: vertices[0].lng },
            vertices_matriz: vertices,
            cuadros_texto_libres: cuadrosTexto,
            lotes_internos: lotesInternos,
            memoria_linderos_notarial: memoriaNotarial,
            fecha_levantamiento: new Date().toISOString()
        };

        if (navigator.onLine && idNegocio && GeokatuDB?.TopografiaService) {
            const resCloud = await GeokatuDB.TopografiaService.guardarPlanoCatastralOneshot(idNegocio, idPlanoActivo, paqueteOneshot);
            if (resCloud && resCloud.success) {
                alert(`✅ Poligonal cerrada y sincronizada en la nube.\nPredio: ${nombrePredioActivo}\nSuperficie: ${areaTexto}\nSistema: ${crsLabelActivo}`);
                return;
            }
        }
        alert(`✅ Poligonal cerrada exitosamente.\nGuardada en memoria local.\nSuperficie: ${areaTexto}`);
    })();
});

function aplicarCambioCRS(nuevoCRS) {
    if (vertices.length === 0) return;
    crsSeleccionado = nuevoCRS;

    vertices.forEach((v) => {
        const p = resolverCoordenadasOrigenCRS(v.lat, v.lng, crsSeleccionado);
        v.e = p.este;
        v.n = p.norte;
        v.crsLabel = p.label;
    });

    actualizarRotulosPlanoDOM();
    actualizarTablaCoordenadasDOM();
    guardarBorradorEnDispositivo();
}

document.getElementById('select-crs-oficial')?.addEventListener('change', (e) => {
    aplicarCambioCRS(e.target.value);
});

function actualizarRotulosPlanoDOM() {
    const crsLabelActivo = vertices[0]?.crsLabel || 
        (crsSeleccionado === 'CTM12' ? "ORIGEN NACIONAL CTM12 (EPSG: 9377)" : 
        (crsSeleccionado === 'REGVEN' ? "SIRGAS-REGVEN UTM" : "PLANO TOPOGRÁFICO LOCAL"));

    const rNombre = document.getElementById('rot-nombre-plano');
    const rProp = document.getElementById('rot-propietario');
    const rMun = document.getElementById('rot-municipio');
    const rCRS = document.getElementById('rot-crs');
    const rTablaCRS = document.getElementById('rot-tabla-crs');
    const subModalCRS = document.getElementById('modal-subtitulo-crs');

    if (rNombre) rNombre.innerText = 'PLANO TOPOGRÁFICO: ' + nombrePredioActivo.toUpperCase();
    if (rProp) rProp.innerText = propietarioActivo.toUpperCase();
    if (rMun) rMun.innerText = municipioActivo.toUpperCase();
    if (rCRS) rCRS.innerText = crsLabelActivo;
    if (rTablaCRS) rTablaCRS.innerText = crsLabelActivo;
    if (subModalCRS) subModalCRS.innerText = 'PROYECCIÓN: ' + crsLabelActivo;
}

function generarMemoriaLinderosNotarial() {
    if (vertices.length < 2) return "Sin linderos asentados.";
    const grupos = [];
    let grupoActual = null;

    for (let i = 1; i < vertices.length; i++) {
        const vAnt = vertices[i - 1];
        const vAct = vertices[i];
        const colNombre = (vAct.colindante || "Sin especificar").trim();

        if (!grupoActual || grupoActual.colindante.toLowerCase() !== colNombre.toLowerCase()) {
            if (grupoActual) grupos.push(grupoActual);
            grupoActual = {
                pInicio: vAnt.id,
                pFin: vAct.id,
                colindante: colNombre,
                distanciaTotal: vAct.distCinta,
                tramos: 1
            };
        } else {
            grupoActual.pFin = vAct.id;
            grupoActual.distanciaTotal += vAct.distCinta;
            grupoActual.tramos++;
        }
    }
    if (grupoActual) grupos.push(grupoActual);

    return grupos.map(g => {
        const formaLinea = g.tramos > 1 ? "en líneas quebradas" : "en línea recta";
        return 'Del punto P' + g.pInicio + ' al punto P' + g.pFin + ', en una distancia acumulada de ' + g.distanciaTotal.toFixed(2) + ' metros ' + formaLinea + ', colindando con ' + g.colindante.toUpperCase() + ';';
    }).join(" ");
}

function actualizarTablaCoordenadasDOM() {
    const tbodyModal = document.getElementById('tabla-coords-body');
    const tbodyPrint = document.querySelector('#tabla-print-inyeccion tbody');
    if (!tbodyModal || !tbodyPrint) return;

    tbodyModal.innerHTML = '';
    tbodyPrint.innerHTML = '';

    let perimetro = 0;

    for (let i = 1; i < vertices.length; i++) {
        const v = vertices[i];
        const vAnt = vertices[i - 1];
        perimetro += v.distCinta;

        const filaHTML = '<tr>' +
            '<td>P' + vAnt.id + ' - P' + v.id + '</td>' +
            '<td>' + v.distCinta.toFixed(2) + '</td>' +
            '<td>' + v.rumboStr + '</td>' +
            '<td>' + v.e.toFixed(3) + '</td>' +
            '<td>' + v.n.toFixed(3) + '</td>' +
            '<td>' + v.colindante + '</td>' +
            '</tr>';

        tbodyModal.innerHTML += filaHTML;
        tbodyPrint.innerHTML += filaHTML;
    }

    let area = 0;
    const n = vertices.length - 1;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += (vertices[i].e * vertices[j].n) - (vertices[j].e * vertices[i].n);
    }
    const areaFinal = Math.abs(area) / 2;

    const lblPerimetro = document.getElementById('lbl-perimetro-total');
    const lblArea = document.getElementById('lbl-area-total');
    const rotArea = document.getElementById('rot-area');
    const rotPerimetro = document.getElementById('rot-perimetro');

    if (lblPerimetro) lblPerimetro.innerText = perimetro.toFixed(2) + ' m';
    if (lblArea) lblArea.innerText = areaFinal.toFixed(2) + ' m² (' + (areaFinal / 10000).toFixed(4) + ' ha)';
    if (rotArea) rotArea.innerText = areaFinal.toFixed(2) + ' m²';
    if (rotPerimetro) rotPerimetro.innerText = perimetro.toFixed(2) + ' m';


    const elMemoria = document.getElementById('rot-memoria-linderos');
    if (elMemoria) elMemoria.innerText = generarMemoriaLinderosNotarial();
}

document.getElementById('btn-tabla-coords').addEventListener('click', () => {
    actualizarTablaCoordenadasDOM();
    actualizarRotulosPlanoDOM();
    document.getElementById('modal-cuadro-construccion').style.display = 'flex';
});

document.getElementById('btn-cerrar-modal-coords').addEventListener('click', () => {
    document.getElementById('modal-cuadro-construccion').style.display = 'none';
});

// ==========================================
// 11. MONETIZACIÓN Y EXPORTACIÓN A PDF
// ==========================================
async function actualizarBadgeCupoDOM() {
    const badge = document.getElementById('badge-cupo-pdf');
    if (!badge) return;

    if (!idNegocio || !navigator.onLine) {
        const descargasLocales = parseInt(localStorage.getItem('geokatu_topo_descargas_local') || '0', 10);
        badge.innerText = '(' + descargasLocales + '/10)';
        cupoPlanosCache = { descargas: descargasLocales, maximo: 10 };
        return;
    }

    try {
        if (GeokatuDB?.TopografiaService?.obtenerEstadoCupoPlanos) {
            const res = await GeokatuDB.TopografiaService.obtenerEstadoCupoPlanos(idNegocio);
            if (res.success) {
                badge.innerText = '(' + res.descargas + '/' + res.cupoMaximo + ')';
                cupoPlanosCache = { descargas: res.descargas, maximo: res.cupoMaximo };
            }
        }
    } catch (e) {
        console.warn("Fallo consultando cupos:", e);
    }
}

document.getElementById('btn-exportar-pdf').addEventListener('click', async () => {
    if (!poligonoCerrado) return alert("Debes cerrar el polígono en P1 antes de generar el plano oficial.");

    if (!idNegocio) {
        alert("🔒 Inicia sesión o regístrate para descargar tu plano oficial y acceder a tus 10 planos gratuitos.");
        window.abrirModalTopografia('modal-login');
        return;
    }

    if (cupoPlanosCache.descargas >= cupoPlanosCache.maximo) {
        document.getElementById('modal-comprar-planos').style.display = 'flex';
        return;
    }

    const confirmar = confirm('Esta acción generará el plano oficial y consumirá 1 plano (' + cupoPlanosCache.descargas + '/' + cupoPlanosCache.maximo + ').\n¿Deseas continuar?'); 
    if (!confirmar) return;

    try {
        if (GeokatuDB?.TopografiaService?.registrarConsumoDescargaPdf) {
            const resConsumo = await GeokatuDB.TopografiaService.registrarConsumoDescargaPdf(idNegocio, idPlanoActivo);
            if (!resConsumo.success && resConsumo.agotado) {
                document.getElementById('modal-comprar-planos').style.display = 'flex';
                return;
            }
        }
    } catch (err) {
        const cLocal = (parseInt(localStorage.getItem('geokatu_topo_descargas_local') || '0', 10)) + 1;
        localStorage.setItem('geokatu_topo_descargas_local', String(cLocal));
    }

    await actualizarBadgeCupoDOM();
    actualizarTablaCoordenadasDOM();
    actualizarRotulosPlanoDOM();

    const canvasPrint = document.getElementById('canvas-print-export');
    const ctxPrint = canvasPrint.getContext('2d');
    canvasPrint.width = 1200;
    canvasPrint.height = 700;
    ctxPrint.clearRect(0, 0, 1200, 700);

    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
    vertices.forEach(v => {
        if (v.e < minE) minE = v.e;
        if (v.e > maxE) maxE = v.e;
        if (v.n < minN) minN = v.n;
        if (v.n > maxN) maxN = v.n;
    });

    const anchoM = Math.max(maxE - minE, 10);
    const altoM = Math.max(maxN - minN, 10);
    const centroE = (minE + maxE) / 2;
    const centroN = (minN + maxN) / 2;
    const factorAuto = Math.min((1200 - 240) / anchoM, (700 - 180) / altoM, 30.0);

    ctxPrint.save();
    ctxPrint.translate(600, 350);

    // 1. Poligonal exterior en impresión
    ctxPrint.beginPath();
    ctxPrint.strokeStyle = '#000000';
    ctxPrint.lineWidth = 2.5;

    vertices.forEach((v, idx) => {
        const x = (v.e - centroE) * factorAuto;
        const y = -(v.n - centroN) * factorAuto;
        if (idx === 0) ctxPrint.moveTo(x, y);
        else ctxPrint.lineTo(x, y);
    });
    ctxPrint.closePath();
    ctxPrint.fillStyle = 'rgba(0,0,0,0.04)';
    ctxPrint.fill();
    ctxPrint.stroke();

    // 2. Lotes internos en impresión
    lotesInternos.forEach(lote => {
        ctxPrint.beginPath();
        ctxPrint.strokeStyle = '#555555';
        ctxPrint.lineWidth = 1.5;
        lote.vertices.forEach((lv, lIdx) => {
            const vM = resolverCoordenadasOrigenCRS(lv.lat, lv.lng, crsSeleccionado);
            const x = (vM.este - centroE) * factorAuto;
            const y = -(vM.norte - centroN) * factorAuto;
            if (lIdx === 0) ctxPrint.moveTo(x, y);
            else ctxPrint.lineTo(x, y);
        });
        ctxPrint.closePath();
        ctxPrint.stroke();

        const vCent = resolverCoordenadasOrigenCRS(lote.centroide.lat, lote.centroide.lng, crsSeleccionado);
        const cx = (vCent.este - centroE) * factorAuto;
        const cy = -(vCent.norte - centroN) * factorAuto;
        ctxPrint.fillStyle = '#000000';
        ctxPrint.font = 'bold 10px monospace';
        ctxPrint.textAlign = 'center';
        ctxPrint.fillText('LOTE ' + lote.numero, cx, cy - 3);
ctxPrint.fillText(lote.area_m2 + ' m²', cx, cy + 9);
        ctxPrint.fillText(`${lote.area_m2} m²`, cx, cy + 9);
        ctxPrint.textAlign = 'start';
    });

    // 3. Vértices principales
    vertices.forEach((v) => {
        const x = (v.e - centroE) * factorAuto;
        const y = -(v.n - centroN) * factorAuto;
        ctxPrint.fillStyle = '#000';
        ctxPrint.beginPath();
        ctxPrint.arc(x, y, 4, 0, Math.PI * 2);
        ctxPrint.fill();
        ctxPrint.font = 'bold 12px monospace';
        ctxPrint.fillText('P' + v.id, x + 6, y - 6);
    });

    ctxPrint.restore();
    setTimeout(() => window.print(), 250);
});

window.iniciarPagoWompiPlanos = function() {
    if (!idNegocio) return alert("Inicia sesión para asociar la recarga.");
    const refTransaccion = 'TOPOGK-' + Date.now();

    if (typeof WidgetCheckout !== 'undefined') {
        const checkout = new WidgetCheckout({
            currency: 'COP',
            amountInCents: 4000000,
            reference: refTransaccion,
            publicKey: 'pub_prod_TU_LLAVE_AQUI',
            redirectUrl: window.location.href
        });

        checkout.open(async function(result) {
            if (result.transaction?.status === 'APPROVED') {
                if (GeokatuDB?.TopografiaService?.recargarCupoPlanos) {
                    await GeokatuDB.TopografiaService.recargarCupoPlanos(idNegocio, 10, result.transaction.id);
                }
                document.getElementById('modal-comprar-planos').style.display = 'none';
                await actualizarBadgeCupoDOM();
                alert("🎉 ¡Pago aprobado! Se han añadido 10 planos adicionales.");
            }
        });
    } else {
        if (confirm("¿Simular aprobación de recarga de 10 planos por $9.99 USD?")) {
            if (GeokatuDB?.TopografiaService?.recargarCupoPlanos) {
                GeokatuDB.TopografiaService.recargarCupoPlanos(idNegocio, 10, refTransaccion).then(async () => {
                    document.getElementById('modal-comprar-planos').style.display = 'none';
                    await actualizarBadgeCupoDOM();
                    alert("✅ Se han añadido 10 planos a tu saldo.");
                });
            } else {
                cupoPlanosCache.maximo += 10;
                document.getElementById('modal-comprar-planos').style.display = 'none';
                document.getElementById('badge-cupo-pdf').innerText = `(${cupoPlanosCache.descargas}/${cupoPlanosCache.maximo})`; 
                alert("✅ Se han añadido 10 planos a tu saldo local.");
            }
        }
    }
};

// ==========================================
// 12. MENÚS, MODALES Y TOURS
// ==========================================
window.toggleSubmenuLlaveTopografia = function() {
    document.getElementById('submenu-llave')?.classList.toggle('activo');
};

window.abrirModalTopografia = function(id) {
    document.getElementById(id)?.classList.add('activo');
};

window.cerrarModalFueraTopografia = function(e, id) {
    if (e.target.id === id) document.getElementById(id).classList.remove('activo');
};

window.abrirRegistroDesdeLogin = function() {
    document.getElementById('form-login-activo').style.display = 'none';
    document.getElementById('panel-registro-directo').style.display = 'block';
};

window.ejecutarRegistroTopografia = async function() {
    const email = document.getElementById('reg-email').value.trim();
    const pass = document.getElementById('reg-pass').value;
    if (document.getElementById('miel_bot')?.value) return;

    if (!email || !pass) return alert("Completa correo y contraseña.");

    const btn = document.getElementById('btn-registrar');
    btn.innerText = "Registrando..."; btn.disabled = true;

    try {
        const res = await GeokatuDB.SecurityService.registrarUsuario(email, pass, 'topografo');
        if (res.success) {
            document.getElementById('modal-login').classList.remove('activo');
            alert("🎉 Cuenta creada exitosamente. Tienes 10 planos de bienvenida.");
        } else {
            alert("Error al registrar: " + res.error);
        }
    } catch (err) {
        alert("Fallo de conexión: " + err.message);
    } finally {
        btn.innerText = "Registrarme e Iniciar"; btn.disabled = false;
    }
};

window.cerrarSesionTopografia = async function() {
    await GeokatuDB.SecurityService.cerrarSesion();
    GeokatuDB.SecurityService.destruirSesionTerminalLocal();
    localStorage.removeItem('qrpido_session_validated');
    window.location.reload();
};

window.abrirModalMisPlanos = async function() {
    const modal = document.getElementById('modal-mis-planos');
    const contenedor = document.getElementById('lista-planos-guardados');
    modal.style.display = 'flex';
    contenedor.innerHTML = '<p style="color: #aaa; font-size: 12px; text-align:center;">Cargando bóveda de planos...</p>';

    if (!idNegocio || !navigator.onLine) {
        contenedor.innerHTML = `
            <div style="background: rgba(255,107,0,0.1); border: 1px solid var(--naranja); padding: 12px; border-radius: 10px;">
                <p style="margin: 0 0 6px 0; font-weight: bold; color: var(--naranja); font-size: 13px;">Plano Activo en Memoria:</p>
                <p style="margin: 0; font-size: 12px;"><b>${nombrePredioActivo}</b> (${vertices.length} vértices)</p> 
                <small style="color: #888;">Inicia sesión con red para consultar el catálogo de todos tus lotes.</small>
            </div>`;
        return;
    }

    try {
        const res = await GeokatuDB.TopografiaService.listarPlanosCatastrales(idNegocio);
        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
            contenedor.innerHTML = res.data.map(p => {
                const esActivo = p.id_predio === idPlanoActivo;
                const bordeColor = esActivo ? 'var(--verde-cierre)' : 'var(--glass-border)';
                const tituloColor = esActivo ? 'var(--verde-cierre)' : '#fff';
                const tagActivo = esActivo ? ' 📍 (Activo)' : '';
                const btnClase = esActivo ? 'activo' : 'verde';
                const btnTexto = esActivo ? 'Recargar' : 'Cargar';

                return '<div style="background: rgba(15,18,25,0.85); border: 1px solid ' + bordeColor + '; padding: 12px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; gap: 10px;">' +
                    '<div>' +
                    '<strong style="color: ' + tituloColor + '; font-size: 13px;">' + (p.nombre_predio || p.id_predio) + tagActivo + '</strong>' +
                    '<p style="margin: 3px 0 0 0; font-size: 11px; color: #aaa;">Área: ' + p.area_m2 + ' | Vértices: ' + p.total_vertices + '</p>' +
                    '<small style="color: #ffaa00; font-family: monospace; font-size: 9.5px;">' + (p.sistema_coordenadas || 'CTM12') + '</small>' +
                    '</div>' +
                    '<button class="btn-hud-cad ' + btnClase + '" onclick="window.cargarPlanoDesdeBoveda(\'' + p.id_predio + '\')">' + btnTexto + '</button>' +
                    '</div>';
            }).join('');

        } else {
            contenedor.innerHTML = `<p style="color: #888; font-size: 12px; text-align:center;">No tienes planos guardados en la nube aún.</p>`;
        }
    } catch (e) {
        contenedor.innerHTML = `<p style="color: #ff4444; font-size: 12px; text-align:center;">Error: ${e.message}</p>`;
    }
};

window.cargarPlanoDesdeBoveda = async function(idPredioCargar) {
    if (!idNegocio) return;
    try {
        const res = await GeokatuDB.TopografiaService.obtenerPlanoCatastral(idNegocio, idPredioCargar);
        if (res.success && res.data) {
            const p = res.data;
            vertices = p.vertices_matriz || [];
            cuadrosTexto = p.cuadros_texto_libres || [];
            lotesInternos = p.lotes_internos || [];
            idPlanoActivo = p.id_predio || idPredioCargar;
            nombrePredioActivo = p.nombre_predio || "Predio";
            propietarioActivo = p.propietario || "Particular";
            municipioActivo = p.municipio || "Pereira, Risaralda";
            crsSeleccionado = p.codigo_crs || "CTM12";
            poligonoCerrado = true;

            const selectCRS = document.getElementById('select-crs-oficial');
            if (selectCRS) selectCRS.value = crsSeleccionado;

            actualizarEstadoBotonesAccion();
            actualizarRotulosPlanoDOM();
            actualizarTablaCoordenadasDOM();

            if (contenedorTextos) contenedorTextos.innerHTML = '';
            cuadrosTexto.forEach(ct => inyectarElementoTextoDOM(ct));

            guardarBorradorEnDispositivo();
            document.getElementById('modal-mis-planos').style.display = 'none';

            if (mapaBase && vertices.length > 0) {
                mapaBase.flyTo({ center: [vertices[0].lng, vertices[0].lat], zoom: 18, duration: 1200 });
            }
            dibujarPlano();
            alert(`✅ Plano "${nombrePredioActivo}" cargado en pantalla con éxito.`);
        }
    } catch (e) {
        alert("Error al cargar el plano: " + e.message);
    }
};


window.limpiarYNuevoPlano = function() {
    if (confirm("⚠️ ¿Estás seguro de reiniciar el plano?")) {
        localStorage.removeItem(`geokatu_topografia_borrador_${idNegocio || 'LOCAL'}`);
        vertices = [];
        cuadrosTexto = [];
        lotesInternos = [];
        trazoLoteActivo = [];
        poligonoCerrado = false;
        modoLotesActivo = false;
        nombrePredioActivo = "Lote Principal";
        propietarioActivo = "Particular";

        actualizarEstadoBotonesAccion();
        btnTerminarLote.style.display = 'none';
        btnModoLotes.classList.remove('lotes-activo');
        contenedorTextos.innerHTML = '';

        redimensionarLienzo();
        actualizarRotulosPlanoDOM();
        dibujarPlano();
        alert("🧹 Nuevo plano listo.");
    }
};

window.iniciarTourTopografia = function() {
    document.body.classList.add('tour-active');
    window.avanzarTourTopografia(1);
};

window.avanzarTourTopografia = function(paso) {
    document.querySelectorAll('.tour-tooltip').forEach(t => t.classList.remove('activo'));
    document.querySelectorAll('.tour-highlight-z').forEach(el => el.classList.remove('tour-highlight-z'));

    if (paso === 1) {
        document.getElementById('hud-satelite-box')?.classList.add('tour-highlight-z');
        document.getElementById('tour-topo-step-1')?.classList.add('activo');
    } else if (paso === 2) {
        document.getElementById('btn-capturar-mojon')?.classList.add('tour-highlight-z');
        document.getElementById('tour-topo-step-2')?.classList.add('activo');
    } else if (paso === 3) {
        document.getElementById('tour-topo-step-3')?.classList.add('activo');
    } else if (paso === 4) {
        document.getElementById('grupo-botones-cad')?.classList.add('tour-highlight-z');
        document.getElementById('tour-topo-step-4')?.classList.add('activo');
    } else if (paso === 5) {
        document.getElementById('btn-portal-mando-contenedor')?.classList.add('tour-highlight-z');
        document.getElementById('tour-topo-step-5')?.classList.add('activo');
    }
};

window.finalizarTourTopografia = function() {
    document.body.classList.remove('tour-active');
    document.querySelectorAll('.tour-tooltip').forEach(t => t.classList.remove('activo'));
    document.querySelectorAll('.tour-highlight-z').forEach(el => el.classList.remove('tour-highlight-z'));
    localStorage.setItem('geokatu_topografia_tour_visto', 'true');
};

document.addEventListener('click', (e) => {
    const contenedorLlave = document.getElementById('btn-portal-mando-contenedor');
    if (contenedorLlave && !contenedorLlave.contains(e.target)) {
        document.getElementById('submenu-llave')?.classList.remove('activo');
    }
});

// ==========================================
// 13. INICIALIZACIÓN MAPLIBRE GL JS
// ==========================================
redimensionarLienzo();
restaurarBorradorLocal();
actualizarBadgeCupoDOM();

window.addEventListener('DOMContentLoaded', () => {
    if (!localStorage.getItem('geokatu_topografia_tour_visto')) {
        setTimeout(() => window.iniciarTourTopografia(), 600);
    }
});

try {
    if (typeof pmtiles !== 'undefined' && typeof maplibregl !== 'undefined') {
        const protocol = new pmtiles.Protocol();
        maplibregl.addProtocol("pmtiles", protocol.tile);

        const urlParams = new URLSearchParams(window.location.search);
        const initLat = parseFloat(urlParams.get('lat')) || 4.8133;
        const initLng = parseFloat(urlParams.get('lng')) || -75.6961;

        mapaBase = new maplibregl.Map({
            container: 'mapa-fondo-pmtiles',
            style: './estilo-fresco.json',
            center: [initLng, initLat],
            zoom: 17.5,
            interactive: true,
            attributionControl: false
        });

        mapaBase.on('render', dibujarPlano);
        mapaBase.on('move', dibujarPlano);
        mapaBase.on('zoom', dibujarPlano);
        mapaBase.on('resize', redimensionarLienzo);

        vincularInteraccionMapLibre();

        const controlGeoloc = new maplibregl.GeolocateControl({
            positionOptions: { enableHighAccuracy: true },
            trackUserLocation: true,
            showUserHeading: true
        });

        mapaBase.addControl(controlGeoloc);
        mapaBase.once('load', () => {
            controlGeoloc.trigger();
            dibujarPlano();
        });
    }
} catch (e) {
    console.warn("Fallo cargando MapLibre:", e.message);
}
// =========================================================================
// 14. EXPORTADORES VECTORIALES DE INTERCAMBIO (DXF / GEOJSON / KML)
// =========================================================================
function descargarArchivoTexto(contenido, nombreArchivo, mimeTipo) {
    const blob = new Blob([contenido], { type: mimeTipo });
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(blob);
    enlace.download = nombreArchivo;
    enlace.click();
    URL.revokeObjectURL(enlace.href);
}

// 1. Exportación GeoJSON (Estándar WGS84 para QGIS / ArcGIS)
window.exportarGeoJSON = function() {
    if (vertices.length < 3) return alert("Debes tener una poligonal de al menos 3 vértices.");

    const coordenadasPoligono = vertices.map(v => [v.lng, v.lat]);
    // Asegurar cierre del anillo en GeoJSON
    if (coordenadasPoligono.length > 0) {
        const prim = coordenadasPoligono[0];
        const ult = coordenadasPoligono[coordenadasPoligono.length - 1];
        if (prim[0] !== ult[0] || prim[1] !== ult[1]) {
            coordenadasPoligono.push([prim[0], prim[1]]);
        }
    }

    const featurePoligono = {
        type: "Feature",
        properties: {
            nombre: nombrePredioActivo,
            propietario: propietarioActivo,
            municipio: municipioActivo,
            sistema_proyeccion: crsSeleccionado,
            area_m2: document.getElementById('rot-area')?.innerText || "0 m²",
            perimetro_m: document.getElementById('rot-perimetro')?.innerText || "0 m"
        },
        geometry: {
            type: "Polygon",
            coordinates: [coordenadasPoligono]
        }
    };

    const featuresVertices = vertices.map(v => ({
        type: "Feature",
        properties: {
            mojon: 'P' + v.id,
            este: v.e,
            norte: v.n,
            colindante: v.colindante || ""
        },
        geometry: {
            type: "Point",
            coordinates: [v.lng, v.lat]
        }
    }));

    const coleccionGeoJSON = {
        type: "FeatureCollection",
        crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
        features: [featurePoligono, ...featuresVertices]
    };

    descargarArchivoTexto(JSON.stringify(coleccionGeoJSON, null, 2), idPlanoActivo + '.geojson', 'application/geo+json');
};

// 2. Exportación KML (Google Earth)
window.exportarKML = function() {
    if (vertices.length < 3) return alert("Debes tener una poligonal de al menos 3 vértices.");

   let kmlCoords = vertices.map(v => v.lng + ',' + v.lat + ',0').join(' ');
    kmlCoords += ' ' + vertices[0].lng + ',' + vertices[0].lat + ',0';

    let placemarksVertices = vertices.map(v => {
        return '<Placemark>' +
            '<name>P' + v.id + '</name>' +
            '<description>Este: ' + v.e + ' | Norte: ' + v.n + ' | Colindante: ' + (v.colindante || '') + '</description>' +
            '<Point><coordinates>' + v.lng + ',' + v.lat + ',0</coordinates></Point>' +
            '</Placemark>';
    }).join('');

    const kmlDoc = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<kml xmlns="http://www.opengis.net/kml/2.2">\n' +
        '  <Document>\n' +
        '    <name>' + nombrePredioActivo + '</name>\n' +
        '    <description>Levantamiento Catastral Geokatu CAD - ' + crsSeleccionado + '</description>\n' +
        '    <Style id="estiloPoligono">\n' +
        '      <LineStyle><color>ff00ff00</color><width>2.5</width></LineStyle>\n' +
        '      <PolyStyle><color>4d00ff00</color></PolyStyle>\n' +
        '    </Style>\n' +
        '    <Placemark>\n' +
        '      <name>' + nombrePredioActivo + ' (Polígono)</name>\n' +
        '      <styleUrl>#estiloPoligono</styleUrl>\n' +
        '      <Polygon>\n' +
        '        <outerBoundaryIs>\n' +
        '          <LinearRing><coordinates>' + kmlCoords + '</coordinates></LinearRing>\n' +
        '        </outerBoundaryIs>\n' +
        '      </Polygon>\n' +
        '    </Placemark>\n' +
        '    ' + placemarksVertices + '\n' +
        '  </Document>\n' +
        '</kml>';

    descargarArchivoTexto(kmlDoc, idPlanoActivo + '.kml', 'application/vnd.google-earth.kml+xml');

};

// 3. Exportación DXF ASCII Estándar (AutoCAD R12/2000 con coordenadas proyectadas E, N)
window.exportarDXF = function() {
    if (vertices.length < 3) return alert("Debes tener una poligonal de al menos 3 vértices.");

    let dxf = "0\nSECTION\n2\nENTITIES\n";

    // Polilínea de linderos
    dxf += "0\nPOLYLINE\n8\nLINDEROS_EXTERIORES\n66\n1\n70\n1\n";
    vertices.forEach(v => {
        dxf += '0\nVERTEX\n8\nLINDEROS_EXTERIORES\n10\n' + v.e + '\n20\n' + v.n + '\n30\n0.0\n';
    });
    dxf += "0\nSEQEND\n";

    // Textos de vértices (P1, P2...)
    vertices.forEach(v => {
        dxf += '0\nTEXT\n8\nMOJONES\n10\n' + (v.e + 1.2) + '\n20\n' + (v.n + 1.2) + '\n30\n0.0\n40\n1.8\n1\nP' + v.id + '\n';
    });

    // Lotes internos si existen
    lotesInternos.forEach(l => {
        dxf += "0\nPOLYLINE\n8\nLOTES_INTERNOS\n66\n1\n70\n1\n";
        l.vertices.forEach(lv => {
            const proy = resolverCoordenadasOrigenCRS(lv.lat, lv.lng, crsSeleccionado);
            dxf += '0\nVERTEX\n8\nLOTES_INTERNOS\n10\n' + proy.este + '\n20\n' + proy.norte + '\n30\n0.0\n';
        });
        dxf += "0\nSEQEND\n";
    });

    dxf += "0\nENDSEC\n0\nEOF\n";

    descargarArchivoTexto(dxf, idPlanoActivo + '.dxf', 'application/dxf');
};

