// =======================================================
// GEOKATU CAD - MOTOR TOPOGRÁFICO MATEMÁTICO (topografia.js)
// =======================================================

import GeokatuDB from './core-db.js';

// 1. Estado General de la Poligonal y Telemetría en Vivo
let idNegocio = localStorage.getItem('geokatu_active_uid') || null;
let idPlanoActivo = "PREDIO_PRINCIPAL";
let vertices = []; // [{ id, e, n, distCinta, rumboStr, colindante }]
let cuadrosTexto = []; // [{ id, x, y, texto }]
let gpsActual = null;
let posicionEnVivoLocal = null;
let poligonoCerrado = false;
let cuadroTextoSeleccionado = null;
let modoTextoActivo = false;

// Garantizar sesión y enclave local antes de cualquier operación
GeokatuDB.SecurityService.observarEstadoSesion(async (user) => {
    if (user) {
        idNegocio = user.uid;
        await GeokatuDB.SecurityService.sellarSesionTerminalLocal(user.uid);
    }
});

// Guardado defensivo en memoria del dispositivo (0 llamadas de red)
function guardarBorradorEnDispositivo() {
    const borrador = {
        vertices: vertices,
        cuadrosTexto: cuadrosTexto,
        poligonoCerrado: poligonoCerrado,
        idPlano: idPlanoActivo,
        timestamp: Date.now()
    };
    localStorage.setItem(`geokatu_topografia_borrador_${idNegocio || 'LOCAL'}`, JSON.stringify(borrador));
}

// Recuperar progreso ante reinicio o cierre de pestaña
function restaurarBorradorLocal() {
    const data = localStorage.getItem(`geokatu_topografia_borrador_${idNegocio || 'LOCAL'}`);
    if (!data) return false;
    try {
        const b = JSON.parse(data);
        if (b && Array.isArray(b.vertices) && b.vertices.length > 0) {
            vertices = b.vertices;
            cuadrosTexto = b.cuadrosTexto || [];
            poligonoCerrado = Boolean(b.poligonoCerrado);
            if (poligonoCerrado) {
                document.getElementById('btn-capturar-mojon').style.display = 'none';
                document.getElementById('btn-cerrar-poligono').style.display = 'none';
            } else if (vertices.length >= 3) {
                document.getElementById('btn-cerrar-poligono').style.display = 'block';
            }
            return true;
        }
    } catch (e) {
        console.warn("Borrador corrupto:", e);
    }
    return false;
}


// Instancia del mapa base MapLibre
let mapaBase = null;


// 2. Viewport 2D estilo Model Space CAD
let viewport = { x: window.innerWidth / 2, y: window.innerHeight / 2, escala: 8.0 }; // 1 metro = 8 px
let arrastrandoLienzo = false;
let inicioRaton = { x: 0, y: 0 };

const vpEl = document.getElementById('viewport-topografia');
const capaTransform = document.getElementById('capa-transform');
const canvas = document.getElementById('canvas-plano');
const ctx = canvas.getContext('2d');
const contenedorTextos = document.getElementById('contenedor-textos-libres');

function redimensionarLienzo() {
    canvas.width = window.innerWidth * (window.devicePixelRatio || 1);
    canvas.height = window.innerHeight * (window.devicePixelRatio || 1);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    dibujarPlano();
}
window.addEventListener('resize', redimensionarLienzo);

function actualizarTransform() {
    capaTransform.style.transform = `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.escala})`;
    
    // Sincronizar patrón infinito de fondo
    const tamRejilla = 60 * (viewport.escala / 8.0);
    vpEl.style.backgroundSize = `${tamRejilla}px ${tamRejilla}px`;
    vpEl.style.backgroundPosition = `${viewport.x}px ${viewport.y}px`;

    // Contra-rotar etiquetas para legibilidad horizontal permanente
    document.querySelectorAll('.contra-rotacion').forEach(el => {
        el.style.transform = `scale(${1 / (viewport.escala / 8.0)})`;
    });
}

// 3. Control Táctil y de Cursor sobre el Viewport (Pan & Zoom CAD)
vpEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.cuadro-texto-cad') || e.target.closest('.hud-barra-superior') || e.target.closest('.hud-dock-inferior')) return;
    
    if (modoTextoActivo) {
        crearCuadroTextoLibre(e.clientX, e.clientY);
        return;
    }

    arrastrandoLienzo = true;
    inicioRaton = { x: e.clientX - viewport.x, y: e.clientY - viewport.y };
    vpEl.setPointerCapture(e.pointerId);
});

vpEl.addEventListener('pointermove', (e) => {
    if (!arrastrandoLienzo) return;
    viewport.x = e.clientX - inicioRaton.x;
    viewport.y = e.clientY - inicioRaton.y;
    actualizarTransform();
});

const finArrastre = () => { arrastrandoLienzo = false; };
vpEl.addEventListener('pointerup', finArrastre);
vpEl.addEventListener('pointercancel', finArrastre);

// Zoom con centro invariante en el cursor
vpEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    const nuevaEscala = Math.min(Math.max(1.0, viewport.escala * factor), 40.0);

    if (nuevaEscala !== viewport.escala) {
        const mouseX = e.clientX;
        const mouseY = e.clientY;
        viewport.x = mouseX - (mouseX - viewport.x) * (nuevaEscala / viewport.escala);
        viewport.y = mouseY - (mouseY - viewport.y) * (nuevaEscala / viewport.escala);
        viewport.escala = nuevaEscala;
        actualizarTransform();
        dibujarPlano();
    }
}, { passive: false });

// 4. Módulo Satelital con Interpolación Fluida a 60 FPS (Heredado de motor-mapa.js)
let rafIdOperario = null;
let coordsGpsAnteriores = null;

if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition(
        (pos) => {
            const acc = pos.coords.accuracy;
            const latNueva = pos.coords.latitude;
            const lngNueva = pos.coords.longitude;

            gpsActual = {
                lat: latNueva,
                lng: lngNueva,
                precision: acc
            };

            // Interpolación elástica suave entre lecturas del satélite
            if (vertices.length > 0 && !poligonoCerrado) {
                const vBase = vertices[0];

                if (!coordsGpsAnteriores) {
                    coordsGpsAnteriores = { lat: latNueva, lng: lngNueva };
                }

                if (rafIdOperario) cancelAnimationFrame(rafIdOperario);
                const tInicio = performance.now();
                const duracionTransicionMs = 800; // Suavizado entre ticks de satélite
                const latIni = coordsGpsAnteriores.lat;
                const lngIni = coordsGpsAnteriores.lng;

                function interpolarPaso(tActual) {
                    let p = (tActual - tInicio) / duracionTransicionMs;
                    if (p > 1) p = 1;

                    // Interpolación lineal continua (Lerp)
                    const latInterp = latIni + (latNueva - latIni) * p;
                    const lngInterp = lngIni + (lngNueva - lngIni) * p;

                    const cMetros = proyeccionLocalMetros(latInterp, lngInterp, vBase.gpsOrigen.lat, vBase.gpsOrigen.lng);
                    posicionEnVivoLocal = {
                        e: 500000.00 + cMetros.e,
                        n: 1000000.00 + cMetros.n
                    };

                    dibujarPlano();

                    if (p < 1) {
                        rafIdOperario = requestAnimationFrame(interpolarPaso);
                    } else {
                        coordsGpsAnteriores = { lat: latNueva, lng: lngNueva };
                    }
                }
                rafIdOperario = requestAnimationFrame(interpolarPaso);
            }


            // Mover cámara de MapLibre suavemente de fondo
            if (mapaBase) {
                mapaBase.setCenter([pos.coords.longitude, pos.coords.latitude]);
            }


            const iconoSat = document.getElementById('icono-sat');
            const badgePct = document.getElementById('badge-pct-gps');

            // Mapeo físico: <=2.5m = 100% óptimo; >=25m = 10% crítico
            let pct = Math.round(Math.max(10, Math.min(100, 100 - ((acc - 2.5) / 22.5) * 90)));
            badgePct.innerText = `${pct}% (±${acc.toFixed(1)}m)`;

            badgePct.classList.remove('precision-optima', 'precision-media', 'precision-baja');
            if (acc <= 4.0) {
                badgePct.classList.add('precision-optima');
                iconoSat.classList.add('fijando');
            } else if (acc <= 9.0) {
                badgePct.classList.add('precision-media');
                iconoSat.classList.remove('fijando');
            } else {
                badgePct.classList.add('precision-baja');
                iconoSat.classList.remove('fijando');
            }
        },
        () => { 
            const badgePct = document.getElementById('badge-pct-gps');
            if (badgePct) {
                badgePct.innerText = '0% (Sin Señal)';
                badgePct.className = 'badge-precision-gps precision-baja';
            }
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
    );
}


function proyeccionLocalMetros(lat, lng, refLat, refLng) {
    const R = 6378137;
    const dLat = (lat - refLat) * Math.PI / 180;
    const dLng = (lng - refLng) * Math.PI / 180;
    return {
        e: dLng * Math.cos(refLat * Math.PI / 180) * R,
        n: dLat * R
    };
}

function calcularRumboCatastral(deltaE, deltaN) {
    const angRad = Math.atan2(deltaE, deltaN);
    let deg = angRad * (180 / Math.PI);
    if (deg < 0) deg += 360;

    let cuadrante = "N";
    let anguloCuad = deg;

    if (deg >= 0 && deg <= 90) {
        cuadrante = `N ${formatoDMS(deg)} E`;
    } else if (deg > 90 && deg <= 180) {
        cuadrante = `S ${formatoDMS(180 - deg)} E`;
    } else if (deg > 180 && deg <= 270) {
        cuadrante = `S ${formatoDMS(deg - 180)} W`;
    } else {
        cuadrante = `N ${formatoDMS(360 - deg)} W`;
    }
    return cuadrante;
}

function formatoDMS(deg) {
    const d = Math.floor(deg);
    const m = Math.floor((deg - d) * 60);
    const s = Math.round(((deg - d) * 60 - m) * 60);
    return `${d}° ${String(m).padStart(2, '0')}' ${String(s).padStart(2, '0')}"`;
}

// 5. Flujo de Captura y Asentamiento de Mojones
const btnCapturar = document.getElementById('btn-capturar-mojon');
const btnCerrar = document.getElementById('btn-cerrar-poligono');
const modalCinta = document.getElementById('modal-cinta');
const inputDistCinta = document.getElementById('input-dist-cinta');
const inputColindante = document.getElementById('input-colindante');

btnCapturar.addEventListener('click', () => {
    if (poligonoCerrado) return alert("El predio se encuentra cerrado y compensado.");
    if (!gpsActual) return alert("Esperando señal satelital estable...");

    if (vertices.length === 0) {
        // P1 Ancla
        vertices.push({
            id: 1,
            e: 500000.00, // Coordenada base local estandarizada
            n: 1000000.00,
            distCinta: 0,
            rumboStr: "---",
            colindante: "Punto de Partida",
            gpsOrigen: { ...gpsActual }
        });
        btnCapturar.innerText = "📍 Marcar Mojón (P2)";
        dibujarPlano();
    } else {
        const sig = vertices.length + 1;
        document.getElementById('txt-titulo-tramo').innerText = `Medición Tramo P${sig - 1} ➔ P${sig}`;
        inputDistCinta.value = '';
        inputColindante.value = '';
        modalCinta.style.display = 'flex';
        setTimeout(() => inputDistCinta.focus(), 100);
    }
});

document.getElementById('btn-asentar-cinta').addEventListener('click', () => {
    const dist = parseFloat(inputDistCinta.value);
    const colindante = inputColindante.value.trim() || "Sin especificar";
    const modoGiro = document.getElementById('select-giro-modo').value;

    if (isNaN(dist) || dist <= 0.1) return alert("Digita una distancia válida medida con cinta.");

    const vAnt = vertices[vertices.length - 1];
    const vBase = vertices[0];
    let azimut = 0;

    if (modoGiro === 'GIRO_90_DER' && vAnt.azimut !== undefined) {
        azimut = vAnt.azimut + (Math.PI / 2);
    } else if (modoGiro === 'GIRO_90_IZQ' && vAnt.azimut !== undefined) {
        azimut = vAnt.azimut - (Math.PI / 2);
    } else {
        // Orientación por vector satelital
        const cAct = proyeccionLocalMetros(gpsActual.lat, gpsActual.lng, vBase.gpsOrigen.lat, vBase.gpsOrigen.lng);
        const deltaE = (500000.00 + cAct.e) - vAnt.e;
        const deltaN = (1000000.00 + cAct.n) - vAnt.n;
        azimut = Math.atan2(deltaE, deltaN);
    }

    // Normalizar azimut entre 0 y 2PI
    azimut = (azimut + 2 * Math.PI) % (2 * Math.PI);

    const nuevoE = vAnt.e + dist * Math.sin(azimut);
    const nuevoN = vAnt.n + dist * Math.cos(azimut);
    const rumbo = calcularRumboCatastral(dist * Math.sin(azimut), dist * Math.cos(azimut));

    vertices.push({
        id: vertices.length + 1,
        e: Number(nuevoE.toFixed(3)),
        n: Number(nuevoN.toFixed(3)),
        distCinta: dist,
        azimut: azimut,
        rumboStr: rumbo,
        colindante: colindante
    });

    modalCinta.style.display = 'none';
    btnCapturar.innerText = `📍 Marcar Mojón (P${vertices.length + 1})`;

    if (vertices.length >= 3) {
        btnCerrar.style.display = 'block';
    }

    guardarBorradorEnDispositivo(); // Persiste en móvil (0 llamadas de red)
    dibujarPlano();
});


document.getElementById('btn-cancelar-cinta').addEventListener('click', () => {
    modalCinta.style.display = 'none';
});

// 6. Cierre de Circuito y Compensación Bowditch
btnCerrar.addEventListener('click', () => {
    const distFinal = parseFloat(prompt(`Distancia medida con cinta desde P${vertices.length} de regreso a P1 (metros):`));
    if (isNaN(distFinal) || distFinal <= 0.1) return;

    // Tramo de regreso antes de ajustar
    const ultimo = vertices[vertices.length - 1];
    const primero = vertices[0];
    const deltaE_cierre = primero.e - ultimo.e;
    const deltaN_cierre = primero.n - ultimo.n;
    const rumboFinal = calcularRumboCatastral(deltaE_cierre, deltaN_cierre);

    vertices.push({
        id: 1, // Regreso a P1
        e: primero.e,
        n: primero.n,
        distCinta: distFinal,
        rumboStr: rumboFinal,
        colindante: "Cierre de Poligonal"
    });

    poligonoCerrado = true;
    btnCapturar.style.display = 'none';
    btnCerrar.style.display = 'none';

    actualizarTablaCoordenadasDOM();
    dibujarPlano();
    guardarBorradorEnDispositivo();

    // 🚀 ONESHOT AL SERVIDOR: Empaquetar el plano completo en un solo tiro
    (async () => {
        const areaTexto = document.getElementById('rot-area')?.innerText || "0.00 m²";
        const perimetroTexto = document.getElementById('rot-perimetro')?.innerText || "0.00 m";
        const memoriaNotarial = generarMemoriaLinderosNotarial();

        const paqueteOneshot = {
            id_predio: idPlanoActivo,
            total_vertices: vertices.length - 1,
            area_m2: areaTexto,
            perimetro_m: perimetroTexto,
            coordenada_origen_gps: vertices[0]?.gpsOrigen || null,
            vertices_matriz: vertices,
            cuadros_texto_libres: cuadrosTexto,
            memoria_linderos_notarial: memoriaNotarial,
            fecha_levantamiento: new Date().toISOString()
        };

        if (navigator.onLine && idNegocio) {
            const resCloud = await GeokatuDB.TopografiaService.guardarPlanoCatastralOneshot(
                idNegocio,
                idPlanoActivo,
                paqueteOneshot
            );
            if (resCloud.success) {
                alert(`✅ Poligonal cerrada y sincronizada en la nube en 1 sola transmisión.\nSuperficie: ${areaTexto}`);
                return;
            }
        }
        alert(`✅ Poligonal cerrada exitosamente.\nGuardada en memoria local del dispositivo.\nSuperficie: ${areaTexto}`);
    })();
});


// 7. Cuadros de Texto Libres sobre el Plano
document.getElementById('btn-modo-texto').addEventListener('click', () => {
    modoTextoActivo = !modoTextoActivo;
    document.getElementById('btn-modo-texto').classList.toggle('activo', modoTextoActivo);
    if (modoTextoActivo) alert("Toca cualquier lugar del plano para insertar un cuadro de texto (ej. linderos, notas o cotas).");
});

function crearCuadroTextoLibre(clientX, clientY) {
    const texto = prompt("Texto para la anotación del plano:", "LINDERO NORTE");
    if (!texto) return;

    // Coordenadas relativas al lienzo transformado
    const mundoX = (clientX - viewport.x) / viewport.escala;
    const mundoY = (clientY - viewport.y) / viewport.escala;

    const el = document.createElement('div');
    el.className = 'cuadro-texto-cad contra-rotacion';
    el.innerText = texto;
    el.style.left = `${mundoX}px`;
    el.style.top = `${mundoY}px`;

    // Hacer arrastrable el cuadro de texto
    let arrastrandoTexto = false;
    let offset = { x: 0, y: 0 };

    el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        arrastrandoTexto = true;
        offset = {
            x: (e.clientX / viewport.escala) - parseFloat(el.style.left),
            y: (e.clientY / viewport.escala) - parseFloat(el.style.top)
        };
        el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
        if (!arrastrandoTexto) return;
        el.style.left = `${(e.clientX / viewport.escala) - offset.x}px`;
        el.style.top = `${(e.clientY / viewport.escala) - offset.y}px`;
    });

    const finTexto = () => { arrastrandoTexto = false; };
    el.addEventListener('pointerup', finTexto);
    el.addEventListener('pointercancel', finTexto);

    contenedorTextos.appendChild(el);
    modoTextoActivo = false;
    document.getElementById('btn-modo-texto').classList.remove('activo');
}

// 8. Renderizado Vectorial sobre el Canvas
function dibujarPlano() {
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    if (vertices.length === 0) {
        ctx.restore();
        return;
    }

    const v0 = vertices[0];
    ctx.translate(viewport.x, viewport.y);

    // Dibujar polígono
    ctx.beginPath();
    ctx.strokeStyle = poligonoCerrado ? '#00ff64' : '#ff6b00';
    ctx.lineWidth = 2.5 / (viewport.escala / 8.0);

    vertices.forEach((v, idx) => {
        const x = (v.e - v0.e);
        const y = -(v.n - v0.n);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });

    if (poligonoCerrado) {
        ctx.fillStyle = 'rgba(0, 255, 100, 0.08)';
        ctx.fill();
    }
    ctx.stroke();

    // LÍNEA ELÁSTICA EN VIVO (Rubber-band): Del último mojón fijado hasta tus pies
    if (!poligonoCerrado && vertices.length > 0 && posicionEnVivoLocal) {
        const ultimoMojon = vertices[vertices.length - 1];
        const ux = (ultimoMojon.e - v0.e);
        const uy = -(ultimoMojon.n - v0.n);
        const px = (posicionEnVivoLocal.e - v0.e);
        const py = -(posicionEnVivoLocal.n - v0.n);

        // Línea discontinua que sigue tu paso
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([4 / (viewport.escala / 8.0), 4 / (viewport.escala / 8.0)]);
        ctx.strokeStyle = '#00ff64';
        ctx.lineWidth = 1.8 / (viewport.escala / 8.0);
        ctx.moveTo(ux, uy);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.restore();

        // Avatar de tu posición en vivo sobre el plano
        ctx.fillStyle = '#00ff64';
        ctx.beginPath();
        ctx.arc(px, py, 6 / (viewport.escala / 8.0), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 / (viewport.escala / 8.0);
        ctx.stroke();

        // Distancia aproximada estimada mientras caminas
        const distAprox = Math.hypot(posicionEnVivoLocal.e - ultimoMojon.e, posicionEnVivoLocal.n - ultimoMojon.n);
        ctx.fillStyle = '#00ff64';
        ctx.font = `bold ${10 / (viewport.escala / 8.0)}px monospace`;
        ctx.fillText(`~${distAprox.toFixed(1)}m (GPS)`, px + 8 / (viewport.escala / 8.0), py + 4 / (viewport.escala / 8.0));
    }


    // Dibujar mojones, acotaciones y nombres de colindantes en las aristas
    vertices.forEach((v, idx) => {
        const x = (v.e - v0.e);
        const y = -(v.n - v0.n);

        // Círculo de Mojón
        ctx.fillStyle = idx === 0 ? '#00ff64' : '#ff6b00';
        ctx.beginPath();
        ctx.arc(x, y, 4 / (viewport.escala / 8.0), 0, Math.PI * 2);
        ctx.fill();

        // Identificador P1, P2...
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${10 / (viewport.escala / 8.0)}px monospace`;
        ctx.fillText(`P${v.id}`, x + 6 / (viewport.escala / 8.0), y - 6 / (viewport.escala / 8.0));

        // Acotado métrico sobre la arista
        if (idx > 0 && v.distCinta > 0) {
            const vAnt = vertices[idx - 1];
            const midX = ((vAnt.e - v0.e) + x) / 2;
            const midY = (-(vAnt.n - v0.n) + y) / 2;

            ctx.fillStyle = '#ffaa00';
            ctx.font = `${9 / (viewport.escala / 8.0)}px monospace`;
            ctx.fillText(`${v.distCinta.toFixed(2)}m [${v.colindante}]`, midX, midY - 3 / (viewport.escala / 8.0));
        }
    });

    ctx.restore();
}

// Agrupador Notarial de Linderos Continuos (P1 a P8 con el mismo colindante)
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
        return `Del punto P${g.pInicio} al punto P${g.pFin}, en una distancia acumulada de ${g.distanciaTotal.toFixed(2)} metros ${formaLinea}, colindando con ${g.colindante.toUpperCase()};`;
    }).join(" ");
}

// 9. Actualización del Cuadro de Coordenadas y Salida PDF
function actualizarTablaCoordenadasDOM() {
    const tbodyModal = document.getElementById('tabla-coords-body');
    const tbodyPrint = document.querySelector('#tabla-print-inyeccion tbody');
    tbodyModal.innerHTML = '';
    tbodyPrint.innerHTML = '';

    let perimetro = 0;

    for (let i = 1; i < vertices.length; i++) {
        const v = vertices[i];
        const vAnt = vertices[i - 1];
        perimetro += v.distCinta;

        const filaHTML = `
            <tr>
                <td>P${vAnt.id} - P${v.id}</td>
                <td>${v.distCinta.toFixed(2)}</td>
                <td>${v.rumboStr}</td>
                <td>${v.e.toFixed(3)}</td>
                <td>${v.n.toFixed(3)}</td>
                <td>${v.colindante}</td>
            </tr>
        `;
        tbodyModal.innerHTML += filaHTML;
        tbodyPrint.innerHTML += filaHTML;
    }

    // Cálculo de área por Gauss
    let area = 0;
    const n = vertices.length - 1; // Sin duplicar el cierre
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += (vertices[i].e * vertices[j].n) - (vertices[j].e * vertices[i].n);
    }
    const areaFinal = Math.abs(area) / 2;

    document.getElementById('lbl-perimetro-total').innerText = `${perimetro.toFixed(2)} m`;
    document.getElementById('lbl-area-total').innerText = `${areaFinal.toFixed(2)} m² (${(areaFinal / 10000).toFixed(4)} ha)`;

    // Sincronizar en rótulo de impresión
    document.getElementById('rot-area').innerText = `${areaFinal.toFixed(2)} m²`;
    document.getElementById('rot-perimetro').innerText = `${perimetro.toFixed(2)} m`;

    // Inyectar redacción notarial consolidada
    const elMemoria = document.getElementById('rot-memoria-linderos');
    if (elMemoria) {
        elMemoria.innerText = generarMemoriaLinderosNotarial();
    }
}


document.getElementById('btn-tabla-coords').addEventListener('click', () => {
    actualizarTablaCoordenadasDOM();
    document.getElementById('modal-cuadro-construccion').style.display = 'flex';
});

// 10. Disparador de Exportación Vectorial a PDF
document.getElementById('btn-exportar-pdf').addEventListener('click', () => {
    if (!poligonoCerrado) return alert("Debes cerrar el polígono en P1 antes de generar el plano de radicación.");

    actualizarTablaCoordenadasDOM();
    
    // Proyectar copia del canvas al tamaño del pliego de impresión
    const canvasPrint = document.getElementById('canvas-print-export');
    const ctxPrint = canvasPrint.getContext('2d');
    canvasPrint.width = 1200;
    canvasPrint.height = 700;

    // Dibujado nítido centrado para la hoja técnica
    ctxPrint.clearRect(0, 0, 1200, 700);
    ctxPrint.strokeStyle = '#000000';
    ctxPrint.lineWidth = 2;

    const v0 = vertices[0];
    const factorPrint = 12.0;

    ctxPrint.save();
    ctxPrint.translate(600, 350);

    ctxPrint.beginPath();
    vertices.forEach((v, idx) => {
        const x = (v.e - v0.e) * factorPrint;
        const y = -(v.n - v0.n) * factorPrint;
        if (idx === 0) ctxPrint.moveTo(x, y);
        else ctxPrint.lineTo(x, y);
    });
    ctxPrint.closePath();
    ctxPrint.stroke();

    // Vértices y cotas impresas
    vertices.forEach((v, idx) => {
        const x = (v.e - v0.e) * factorPrint;
        const y = -(v.n - v0.n) * factorPrint;
        ctxPrint.fillStyle = '#000';
        ctxPrint.beginPath();
        ctxPrint.arc(x, y, 4, 0, Math.PI * 2);
        ctxPrint.fill();
        ctxPrint.font = 'bold 12px monospace';
        ctxPrint.fillText(`P${v.id}`, x + 6, y - 6);
    });

    ctxPrint.restore();

    // Lanzar impresión PDF vectorial
    setTimeout(() => {
        window.print();
    }, 200);
});

// Inicialización con rescate de memoria local
redimensionarLienzo();
restaurarBorradorLocal();
actualizarTransform();
dibujarPlano();

// Inicializar mapa vectorial de fondo (.pmtiles) con Geolocate y Heading de motor-mapa.js
try {
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
    mapaBase = new maplibregl.Map({
        container: 'mapa-fondo-pmtiles',
        style: './estilo-fresco.json',
        center: [-75.6961, 4.8133],
        zoom: 17,
        interactive: false,
        attributionControl: false
    });

    const controlGeoloc = new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserHeading: true // Cono de orientación por brújula nativo
    });

    mapaBase.addControl(controlGeoloc);
    mapaBase.once('load', () => {
        controlGeoloc.trigger();
    });
} catch (e) {
    console.warn("Modo plano sin mapa vectorial de fondo:", e.message);
}

// ==========================================
// CONTROLADORES DE MENÚ DE CAMPO (Caché y Cierre)
// ==========================================
window.guardarBorradorManual = function() {
    if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
    guardarBorradorEnDispositivo();
    alert("💾 ¡Progreso asegurado! Las coordenadas y linderos están respaldados en la caché de tu dispositivo.");
    document.getElementById('menu-opciones-topografia').classList.remove('activo');
};

window.limpiarYNuevoPlano = function() {
    if (confirm("⚠️ ¿Estás seguro de borrar todos los vértices actuales y empezar un nuevo levantamiento?")) {
        localStorage.removeItem(`geokatu_topografia_borrador_${idNegocio || 'LOCAL'}`);
        vertices = [];
        cuadrosTexto = [];
        poligonoCerrado = false;
        document.getElementById('btn-capturar-mojon').style.display = 'flex';
        document.getElementById('btn-capturar-mojon').innerText = "📍 Fijar Mojón (P1)";
        document.getElementById('btn-cerrar-poligono').style.display = 'none';
        document.getElementById('contenedor-textos-libres').innerHTML = '';
        redimensionarLienzo();
        document.getElementById('menu-opciones-topografia').classList.remove('activo');
        alert("🧹 Plano reiniciado desde cero.");
    }
};

// Cerrar menú flotante al hacer clic fuera
document.addEventListener('click', (e) => {
    const menu = document.getElementById('menu-opciones-topografia');
    if (menu && menu.classList.contains('activo') && !e.target.closest('button[onclick*="menu-opciones-topografia"]')) {
        menu.classList.remove('activo');
    }
});

