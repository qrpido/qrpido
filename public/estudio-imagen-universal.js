/**
 * GEOKATU - ESTUDIO UNIVERSAL DE IMAGEN 2D OFFLINE (AUTO-INYECTABLE)
 * Archivo: estudio-imagen-universal.js
 * Soporta: Varita Mágica (Flood-Fill & Global), Suavizado Morfológico de Bordes,
 * Nitidez Laplaciana, Auto-Margen Transparente, Recorte Manual, Giro y Filtros de Color.
 * Cumplimiento: 100% Local/Offline, Cero Dependencias, Exportación WebP con Canal Alfa.
 */

(function(window) {
    'use strict';

    var canvas = null;
    var ctx = null;
    var viewport = null;
    var overlayCrop = null;
    var modalRoot = null;

    var historial = [];
    var bufferSinNitidez = null;
    var imgOriginalDataUrl = '';
    var modoActivo = 'varita';

    var filtroBrillo = 100;
    var filtroContraste = 100;
    var filtroSaturacion = 100;
    var filtroNitidez = 0;

    var arrastrandoCrop = false;
    var cropStartX = 0, cropStartY = 0, cropEndX = 0, cropEndY = 0;

    var resolverPromesaActiva = null;
    var configActual = { maxAncho: 1000, maxAlto: 1000, calidad: 0.86, titulo: 'Estudio Fotográfico 2D' };

    // Sintetizador acústico ligero
    var audioCtx = null;
    function emitirBeep() {
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            var osc = audioCtx.createOscillator();
            var gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            var t = audioCtx.currentTime;
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1750, t);
            gain.gain.setValueAtTime(0.12, t);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.06);
            osc.start(t);
            osc.stop(t + 0.06);
        } catch (e) {}
    }

    function inyectarEstilosYDOM() {
        if (document.getElementById('gk-estudio-universal-root')) return;

        var style = document.createElement('style');
        style.id = 'gk-estudio-universal-css';
        style.textContent =
            '.gk-est-overlay { position:fixed; inset:0; background:rgba(8,8,12,0.96); backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px); z-index:1000100; display:none; flex-direction:column; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:#fff; user-select:none; }' +
            '.gk-est-topbar { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:rgba(18,18,24,0.95); border-bottom:1px solid rgba(255,255,255,0.08); flex-shrink:0; }' +
            '.gk-est-titulo { font-size:13px; font-weight:900; text-transform:uppercase; color:#ff6b00; letter-spacing:0.6px; }' +
            '.gk-est-badge { font-size:10px; font-family:monospace; color:#94a3b8; background:rgba(255,255,255,0.06); padding:2px 6px; border-radius:4px; margin-left:6px; }' +
            '.gk-est-viewport { flex:1; position:relative; overflow:auto; display:flex; align-items:center; justify-content:center; padding:16px; background-color:#0a0a0e; background-image:linear-gradient(45deg, #16161d 25%, transparent 25%), linear-gradient(-45deg, #16161d 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #16161d 75%), linear-gradient(-45deg, transparent 75%, #16161d 75%); background-size:16px 16px; background-position:0 0, 0 8px, 8px -8px, -8px 0; }' +
            '#gk-est-canvas { max-width:100%; max-height:100%; object-fit:contain; box-shadow:0 12px 35px rgba(0,0,0,0.85); border:1px solid rgba(255,255,255,0.12); touch-action:none; }' +
            '#gk-est-crop-box { position:absolute; border:2px dashed #00ff64; background:rgba(0,255,100,0.15); pointer-events:none; display:none; z-index:20; }' +
            '.gk-est-ribbon { display:flex; gap:6px; overflow-x:auto; padding:10px 12px; background:rgba(18,18,24,0.98); border-top:1px solid rgba(255,255,255,0.08); flex-shrink:0; scrollbar-width:none; }' +
            '.gk-est-ribbon::-webkit-scrollbar { display:none; }' +
            '.gk-est-btn-tool { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:#ddd; padding:8px 12px; border-radius:10px; font-size:11px; font-weight:800; white-space:nowrap; cursor:pointer; transition:all 0.15s; }' +
            '.gk-est-btn-tool.activo { background:rgba(255,107,0,0.2); border-color:#ff6b00; color:#fff; box-shadow:0 0 12px rgba(255,107,0,0.3); }' +
            '.gk-est-btn-tool:active { transform:scale(0.95); }' +
            '.gk-est-bandeja { background:rgba(14,14,18,0.98); border-top:1px solid rgba(255,107,0,0.3); padding:12px 16px; display:none; flex-direction:column; gap:10px; flex-shrink:0; }' +
            '.gk-est-slider-row { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:11px; color:#ccc; }' +
            '.gk-est-slider { flex:1; accent-color:#ff6b00; cursor:pointer; }' +
            '.gk-est-niveles { display:grid; grid-template-columns:repeat(5, 1fr); gap:8px; }' +
            '.gk-est-btn-nivel { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15); color:#fff; padding:8px; border-radius:8px; font-weight:900; font-size:12px; cursor:pointer; }' +
            '.gk-est-btn-nivel:active { background:#ff6b00; border-color:#ff6b00; }' +
            '.gk-est-btn-ok { background:linear-gradient(135deg, #00e676 0%, #00c853 100%); color:#042f1a; border:none; padding:7px 14px; border-radius:10px; font-size:11.5px; font-weight:900; text-transform:uppercase; cursor:pointer; box-shadow:0 4px 12px rgba(0,230,118,0.35); }' +
            '.gk-est-btn-cancel { background:rgba(255,68,68,0.18); border:1px solid rgba(255,68,68,0.4); color:#ff6b6b; padding:7px 10px; border-radius:10px; font-size:11.5px; font-weight:800; cursor:pointer; }';
        document.head.appendChild(style);

        modalRoot = document.createElement('div');
        modalRoot.id = 'gk-estudio-universal-root';
        modalRoot.className = 'gk-est-overlay';
        modalRoot.innerHTML =
            '<div class="gk-est-topbar">' +
                '<div style="display:flex; align-items:center; min-width:0;">' +
                    '<span class="gk-est-titulo" id="gk-est-lbl-titulo">Estudio 2D</span>' +
                    '<span class="gk-est-badge" id="gk-est-lbl-dim">0x0 px</span>' +
                '</div>' +
                '<div style="display:flex; gap:8px; align-items:center;">' +
                    '<button type="button" class="gk-est-btn-ok" id="gk-est-btn-confirmar">✓ Usar Imagen</button>' +
                    '<button type="button" class="gk-est-btn-cancel" id="gk-est-btn-cerrar">✕</button>' +
                '</div>' +
            '</div>' +
            '<div class="gk-est-viewport" id="gk-est-viewport">' +
                '<div id="gk-est-crop-box"></div>' +
                '<canvas id="gk-est-canvas"></canvas>' +
            '</div>' +
            '<div class="gk-est-ribbon">' +
                '<button type="button" class="gk-est-btn-tool activo" data-panel="varita" onclick="window.GeokatuEstudio.abrirPanel(\'varita\')">✨ Borrar Fondo (Varita)</button>' +
                '<button type="button" class="gk-est-btn-tool" data-panel="suavizado" onclick="window.GeokatuEstudio.abrirPanel(\'suavizado\')">💧 Suavizar Bordes</button>' +
                '<button type="button" class="gk-est-btn-tool" onclick="window.GeokatuEstudio.autoRecorteTransparente()">✂️ Auto-Margen</button>' +
                '<button type="button" class="gk-est-btn-tool" data-panel="color" onclick="window.GeokatuEstudio.abrirPanel(\'color\')">🎨 Color y Brillo</button>' +
                '<button type="button" class="gk-est-btn-tool" data-panel="nitidez" onclick="window.GeokatuEstudio.abrirPanel(\'nitidez\')">🔍 Nitidez</button>' +
                '<button type="button" class="gk-est-btn-tool" data-panel="crop" onclick="window.GeokatuEstudio.abrirPanel(\'crop\')">📐 Recortar</button>' +
                '<button type="button" class="gk-est-btn-tool" onclick="window.GeokatuEstudio.rotar(90)">↻ Girar 90°</button>' +
                '<button type="button" class="gk-est-btn-tool" onclick="window.GeokatuEstudio.deshacer()">↩ Deshacer</button>' +
                '<button type="button" class="gk-est-btn-tool" onclick="window.GeokatuEstudio.restaurarOriginal()">🔄 Original</button>' +
            '</div>' +
            '<div class="gk-est-bandeja" id="gk-est-bandeja" style="display:flex;">' +
                '<!-- PANEL VARITA -->' +
                '<div id="gk-subpanel-varita" style="display:flex; flex-direction:column; gap:8px;">' +
                    '<div style="font-size:11px; color:#ffaa00; font-weight:700;">Toca cualquier color del fondo en la imagen de arriba para volverlo transparente:</div>' +
                    '<div class="gk-est-slider-row">' +
                        '<span>Tolerancia: <b id="gk-val-tol" style="color:#ff6b00;">35%</b></span>' +
                        '<input type="range" id="gk-slider-tol" class="gk-est-slider" min="1" max="100" value="35" oninput="document.getElementById(\'gk-val-tol\').innerText=this.value+\'%\'">' +
                    '</div>' +
                    '<label style="display:flex; align-items:center; gap:8px; font-size:11px; color:#cbd5e1; cursor:pointer;">' +
                        '<input type="checkbox" id="gk-chk-varita-global" style="accent-color:#ff6b00; width:16px; height:16px;">' +
                        '<span>Borrar ese color en toda la imagen (incluye huecos internos de letras)</span>' +
                    '</label>' +
                '</div>' +
                '<!-- PANEL SUAVIZADO -->' +
                '<div id="gk-subpanel-suavizado" style="display:none; flex-direction:column; gap:8px;">' +
                    '<span style="font-size:11px; color:#94a3b8;">Elimina bordes blancos o dentados tras borrar el fondo:</span>' +
                    '<div class="gk-est-niveles">' +
                        '<button type="button" class="gk-est-btn-nivel" onclick="window.GeokatuEstudio.suavizarBordes(1)">Nivel 1</button>' +
                        '<button type="button" class="gk-est-btn-nivel" onclick="window.GeokatuEstudio.suavizarBordes(2)">Nivel 2</button>' +
                        '<button type="button" class="gk-est-btn-nivel" onclick="window.GeokatuEstudio.suavizarBordes(3)">Nivel 3</button>' +
                        '<button type="button" class="gk-est-btn-nivel" onclick="window.GeokatuEstudio.suavizarBordes(4)">Nivel 4</button>' +
                        '<button type="button" class="gk-est-btn-nivel" onclick="window.GeokatuEstudio.suavizarBordes(5)">Nivel 5</button>' +
                    '</div>' +
                '</div>' +
                '<!-- PANEL COLOR -->' +
                '<div id="gk-subpanel-color" style="display:none; flex-direction:column; gap:8px;">' +
                    '<div class="gk-est-slider-row">' +
                        '<span style="width:95px;">Brillo: <b id="gk-val-brillo">100%</b></span>' +
                        '<input type="range" id="gk-slider-brillo" class="gk-est-slider" min="30" max="180" value="100" oninput="window.GeokatuEstudio.actualizarColorLive()">' +
                    '</div>' +
                    '<div class="gk-est-slider-row">' +
                        '<span style="width:95px;">Contraste: <b id="gk-val-contraste">100%</b></span>' +
                        '<input type="range" id="gk-slider-contraste" class="gk-est-slider" min="30" max="180" value="100" oninput="window.GeokatuEstudio.actualizarColorLive()">' +
                    '</div>' +
                    '<div class="gk-est-slider-row">' +
                        '<span style="width:95px;">Saturación: <b id="gk-val-sat">100%</b></span>' +
                        '<input type="range" id="gk-slider-sat" class="gk-est-slider" min="0" max="200" value="100" oninput="window.GeokatuEstudio.actualizarColorLive()">' +
                    '</div>' +
                '</div>' +
                '<!-- PANEL NITIDEZ -->' +
                '<div id="gk-subpanel-nitidez" style="display:none; flex-direction:column; gap:8px;">' +
                    '<div class="gk-est-slider-row">' +
                        '<span>Realce Laplaciano: <b id="gk-val-nitidez" style="color:#00e5ff;">0%</b></span>' +
                        '<input type="range" id="gk-slider-nitidez" class="gk-est-slider" min="0" max="100" value="0" oninput="window.GeokatuEstudio.aplicarNitidez(this.value)">' +
                    '</div>' +
                '</div>' +
                '<!-- PANEL CROP -->' +
                '<div id="gk-subpanel-crop" style="display:none; justify-content:space-between; align-items:center;">' +
                    '<span style="font-size:11px; color:#94a3b8;">Dibuja un recuadro con el dedo sobre la imagen para encuadrar.</span>' +
                    '<button type="button" class="gk-est-btn-ok" id="gk-btn-aplicar-crop" style="display:none;" onclick="window.GeokatuEstudio.confirmarRecorteManual()">Recortar Área</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(modalRoot);

        canvas = document.getElementById('gk-est-canvas');
        ctx = canvas.getContext('2d', { willReadFrequently: true });
        viewport = document.getElementById('gk-est-viewport');
        overlayCrop = document.getElementById('gk-est-crop-box');

        document.getElementById('gk-est-btn-confirmar').onclick = finalizarYExportar;
        document.getElementById('gk-est-btn-cerrar').onclick = cancelarEdicion;

        vincularEventosLienzo();
    }

    function guardarSnapshot() {
        if (!ctx || !canvas) return;
        if (historial.length >= 6) historial.shift();
        historial.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
        bufferSinNitidez = null;
        var sNit = document.getElementById('gk-slider-nitidez');
        var vNit = document.getElementById('gk-val-nitidez');
        if (sNit) sNit.value = 0;
        if (vNit) vNit.innerText = '0%';
        var lblDim = document.getElementById('gk-est-lbl-dim');
        if (lblDim) lblDim.innerText = canvas.width + 'x' + canvas.height + ' px';
    }

    function hornearFiltrosColor() {
        if (filtroBrillo === 100 && filtroContraste === 100 && filtroSaturacion === 100) return;
        var temp = document.createElement('canvas');
        temp.width = canvas.width;
        temp.height = canvas.height;
        var tCtx = temp.getContext('2d');
        tCtx.filter = 'brightness(' + filtroBrillo + '%) contrast(' + filtroContraste + '%) saturate(' + filtroSaturacion + '%)';
        tCtx.drawImage(canvas, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(temp, 0, 0);
        canvas.style.filter = 'none';
        filtroBrillo = 100; filtroContraste = 100; filtroSaturacion = 100;
        document.getElementById('gk-slider-brillo').value = 100;
        document.getElementById('gk-slider-contraste').value = 100;
        document.getElementById('gk-slider-sat').value = 100;
        document.getElementById('gk-val-brillo').innerText = '100%';
        document.getElementById('gk-val-contraste').innerText = '100%';
        document.getElementById('gk-val-sat').innerText = '100%';
        guardarSnapshot();
    }

    function vincularEventosLienzo() {
        canvas.addEventListener('click', function(e) {
            if (modoActivo !== 'varita' || !ctx) return;
            hornearFiltrosColor();

            var rect = canvas.getBoundingClientRect();
            var escalaX = canvas.width / rect.width;
            var escalaY = canvas.height / rect.height;
            var W = canvas.width;
            var H = canvas.height;

            var startX = Math.max(0, Math.min(W - 1, Math.floor((e.clientX - rect.left) * escalaX)));
            var startY = Math.max(0, Math.min(H - 1, Math.floor((e.clientY - rect.top) * escalaY)));

            var imgData = ctx.getImageData(0, 0, W, H);
            var data = imgData.data;
            var targetIdx = (startY * W + startX) * 4;
            var tR = data[targetIdx], tG = data[targetIdx + 1], tB = data[targetIdx + 2], tA = data[targetIdx + 3];
            if (tA === 0) return;

            var tol = parseInt(document.getElementById('gk-slider-tol').value || '35', 10);
            var tolSq = Math.pow((tol / 100) * 441.67, 2);

            var esSimilar = function(r, g, b) {
                var dR = r - tR, dG = g - tG, dB = b - tB;
                return (dR * dR + dG * dG + dB * dB) <= tolSq;
            };

            var esGlobal = document.getElementById('gk-chk-varita-global').checked;
            if (esGlobal) {
                for (var i = 0; i < data.length; i += 4) {
                    if (data[i + 3] > 0 && esSimilar(data[i], data[i + 1], data[i + 2])) {
                        data[i + 3] = 0;
                    }
                }
            } else {
                var visitados = new Uint8Array(W * H);
                var cola = [startX + startY * W];
                visitados[startX + startY * W] = 1;
                while (cola.length > 0) {
                    var idxP = cola.pop();
                    var cX = idxP % W;
                    var cY = Math.floor(idxP / W);
                    data[idxP * 4 + 3] = 0;
                    var vecinos = [
                        cX > 0 ? (cX - 1) + cY * W : -1,
                        cX < W - 1 ? (cX + 1) + cY * W : -1,
                        cY > 0 ? cX + (cY - 1) * W : -1,
                        cY < H - 1 ? cX + (cY + 1) * W : -1
                    ];
                    for (var v = 0; v < 4; v++) {
                        var n = vecinos[v];
                        if (n !== -1 && visitados[n] === 0) {
                            visitados[n] = 1;
                            var nIdx = n * 4;
                            if (data[nIdx + 3] > 0 && esSimilar(data[nIdx], data[nIdx + 1], data[nIdx + 2])) {
                                cola.push(n);
                            }
                        }
                    }
                }
            }
            ctx.putImageData(imgData, 0, 0);
            guardarSnapshot();
            emitirBeep();
        });

        var obtenerPt = function(cX, cY) {
            var r = canvas.getBoundingClientRect();
            return {
                x: Math.max(0, Math.min(canvas.width, Math.floor((cX - r.left) * (canvas.width / r.width)))),
                y: Math.max(0, Math.min(canvas.height, Math.floor((cY - r.top) * (canvas.height / r.height))))
            };
        };

        var pintarCajaCrop = function() {
            var wrapRect = viewport.getBoundingClientRect();
            var cRect = canvas.getBoundingClientRect();
            var c1x = (cropStartX / canvas.width) * cRect.width + cRect.left;
            var c1y = (cropStartY / canvas.height) * cRect.height + cRect.top;
            var c2x = (cropEndX / canvas.width) * cRect.width + cRect.left;
            var c2y = (cropEndY / canvas.height) * cRect.height + cRect.top;
            var minX = Math.min(c1x, c2x) - wrapRect.left + viewport.scrollLeft;
            var minY = Math.min(c1y, c2y) - wrapRect.top + viewport.scrollTop;
            var w = Math.abs(c1x - c2x);
            var h = Math.abs(c1y - c2y);
            overlayCrop.style.left = minX + 'px';
            overlayCrop.style.top = minY + 'px';
            overlayCrop.style.width = w + 'px';
            overlayCrop.style.height = h + 'px';
            overlayCrop.style.display = (w > 6 && h > 6) ? 'block' : 'none';
        };

        viewport.addEventListener('pointerdown', function(e) {
            if (modoActivo !== 'crop') return;
            arrastrandoCrop = true;
            var pt = obtenerPt(e.clientX, e.clientY);
            cropStartX = pt.x; cropStartY = pt.y;
            cropEndX = pt.x; cropEndY = pt.y;
        });

        window.addEventListener('pointermove', function(e) {
            if (!arrastrandoCrop || modoActivo !== 'crop') return;
            var pt = obtenerPt(e.clientX, e.clientY);
            cropEndX = pt.x; cropEndY = pt.y;
            pintarCajaCrop();
        });

        window.addEventListener('pointerup', function() {
            if (!arrastrandoCrop || modoActivo !== 'crop') return;
            arrastrandoCrop = false;
            var w = Math.abs(cropEndX - cropStartX);
            var h = Math.abs(cropEndY - cropStartY);
            var btn = document.getElementById('gk-btn-aplicar-crop');
            if (btn) btn.style.display = (w > 10 && h > 10) ? 'inline-block' : 'none';
        });
    }

    function cargarDataUrlEnCanvas(dataUrl) {
        var img = new Image();
        img.onload = function() {
            var w = img.naturalWidth || img.width;
            var h = img.naturalHeight || img.height;
            var maxLado = Math.max(configActual.maxAncho || 1400, configActual.maxAlto || 1400);
            if (w > maxLado || h > maxLado) {
                var ratio = Math.min(maxLado / w, maxLado / h);
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
            }
            canvas.width = w;
            canvas.height = h;
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            historial = [];
            guardarSnapshot();

            // Si viene desde un slot de Identidad (Portada, Logo, Pin o Nombre_PNG), activar Recorte y mostrar guía visual
            if (configActual.rolSugerido) {
                window.GeokatuEstudio.abrirPanel('crop');
                setTimeout(function() {
                    if (configActual.rolSugerido === 'portada') {
                        cropStartX = Math.round(w * 0.03);
                        cropStartY = Math.round(h * 0.06);
                        cropEndX = Math.round(w * 0.97);
                        cropEndY = Math.round(h * 0.52);
                    } else if (configActual.rolSugerido === 'logo' || configActual.rolSugerido === 'link_pin') {
                        cropStartX = Math.round(w * 0.04);
                        cropStartY = Math.round(h * 0.56);
                        cropEndX = Math.round(w * 0.42);
                        cropEndY = Math.round(h * 0.95);
                    } else if (configActual.rolSugerido === 'logo_nombre') {
                        cropStartX = Math.round(w * 0.45);
                        cropStartY = Math.round(h * 0.56);
                        cropEndX = Math.round(w * 0.96);
                        cropEndY = Math.round(h * 0.95);
                    }
                    var wrapRect = viewport.getBoundingClientRect();
                    var cRect = canvas.getBoundingClientRect();
                    if (cRect.width > 0 && cRect.height > 0) {
                        var c1x = (cropStartX / canvas.width) * cRect.width + cRect.left;
                        var c1y = (cropStartY / canvas.height) * cRect.height + cRect.top;
                        var c2x = (cropEndX / canvas.width) * cRect.width + cRect.left;
                        var c2y = (cropEndY / canvas.height) * cRect.height + cRect.top;
                        overlayCrop.style.left = (Math.min(c1x, c2x) - wrapRect.left + viewport.scrollLeft) + 'px';
                        overlayCrop.style.top = (Math.min(c1y, c2y) - wrapRect.top + viewport.scrollTop) + 'px';
                        overlayCrop.style.width = Math.abs(c1x - c2x) + 'px';
                        overlayCrop.style.height = Math.abs(c1y - c2y) + 'px';
                        overlayCrop.style.display = 'block';
                        var btnCrop = document.getElementById('gk-btn-aplicar-crop');
                        if (btnCrop) btnCrop.style.display = 'inline-block';
                    }
                }, 80);
            }
        };
        img.src = dataUrl;
    }

    async function finalizarYExportar() {
        hornearFiltrosColor();
        var w = canvas.width;
        var h = canvas.height;
        var maxW = configActual.maxAncho || 1000;
        var maxH = configActual.maxAlto || 1000;

        var outCanvas = canvas;
        if (w > maxW || h > maxH) {
            var r = Math.min(maxW / w, maxH / h);
            var nW = Math.round(w * r);
            var nH = Math.round(h * r);
            outCanvas = document.createElement('canvas');
            outCanvas.width = nW;
            outCanvas.height = nH;
            outCanvas.getContext('2d').drawImage(canvas, 0, 0, nW, nH);
        }

        var dataUrlFinal = outCanvas.toDataURL('image/webp', configActual.calidad || 0.86);
        outCanvas.toBlob(function(blob) {
            modalRoot.style.display = 'none';
            emitirBeep();
            if (resolverPromesaActiva) {
                var cb = resolverPromesaActiva;
                resolverPromesaActiva = null;
                cb({ blob: blob, dataUrl: dataUrlFinal, width: outCanvas.width, height: outCanvas.height });
            }
        }, 'image/webp', configActual.calidad || 0.86);
    }

    function cancelarEdicion() {
        modalRoot.style.display = 'none';
        if (resolverPromesaActiva) {
            var cb = resolverPromesaActiva;
            resolverPromesaActiva = null;
            cb(null);
        }
    }

    window.GeokatuEstudio = {
        editarImagen: function(fileOrDataUrl, opciones) {
            inyectarEstilosYDOM();
            configActual = Object.assign({ maxAncho: 1000, maxAlto: 1000, calidad: 0.86, titulo: 'Estudio Fotográfico 2D' }, opciones || {});
            document.getElementById('gk-est-lbl-titulo').innerText = configActual.titulo;
            this.abrirPanel('varita');

            return new Promise(function(resolve) {
                resolverPromesaActiva = resolve;
                modalRoot.style.display = 'flex';

                if (typeof fileOrDataUrl === 'string') {
                    imgOriginalDataUrl = fileOrDataUrl;
                    cargarDataUrlEnCanvas(fileOrDataUrl);
                } else if (fileOrDataUrl instanceof Blob || fileOrDataUrl instanceof File) {
                    var reader = new FileReader();
                    reader.onload = function(e) {
                        imgOriginalDataUrl = e.target.result;
                        cargarDataUrlEnCanvas(imgOriginalDataUrl);
                    };
                    reader.readAsDataURL(fileOrDataUrl);
                } else {
                    modalRoot.style.display = 'none';
                    resolve(null);
                }
            });
        },

        abrirPanel: function(panelId) {
            var paneles = ['varita', 'suavizado', 'color', 'nitidez', 'crop'];
            paneles.forEach(function(p) {
                var el = document.getElementById('gk-subpanel-' + p);
                if (el) el.style.display = (p === panelId) ? 'flex' : 'none';
            });
            document.querySelectorAll('.gk-est-btn-tool[data-panel]').forEach(function(btn) {
                btn.classList.toggle('activo', btn.getAttribute('data-panel') === panelId);
            });
            modoActivo = (panelId === 'crop') ? 'crop' : 'varita';
            if (overlayCrop) overlayCrop.style.display = 'none';
            var btnCrop = document.getElementById('gk-btn-aplicar-crop');
            if (btnCrop) btnCrop.style.display = 'none';
        },

        suavizarBordes: function(nivel) {
            if (!ctx || !canvas) return;
            hornearFiltrosColor();
            var W = canvas.width, H = canvas.height;
            var imgData = ctx.getImageData(0, 0, W, H);
            var data = imgData.data;
            var len = W * H;
            var radio = nivel;
            var diametro = radio * 2 + 1;
            var alpha = new Float32Array(len);
            for (var i = 0; i < len; i++) alpha[i] = data[i * 4 + 3];
            var tempAlpha = new Float32Array(len);

            for (var y = 0; y < H; y++) {
                var fila = y * W;
                var suma = 0;
                for (var x = -radio; x <= radio; x++) {
                    suma += alpha[fila + Math.min(Math.max(x, 0), W - 1)];
                }
                for (var x2 = 0; x2 < W; x2++) {
                    tempAlpha[fila + x2] = suma / diametro;
                    var sale = Math.max(x2 - radio, 0);
                    var entra = Math.min(x2 + radio + 1, W - 1);
                    suma += alpha[fila + entra] - alpha[fila + sale];
                }
            }

            var blurAlpha = new Float32Array(len);
            for (var cx = 0; cx < W; cx++) {
                var sumaY = 0;
                for (var cy = -radio; cy <= radio; cy++) {
                    sumaY += tempAlpha[Math.min(Math.max(cy, 0), H - 1) * W + cx];
                }
                for (var cy2 = 0; cy2 < H; cy2++) {
                    blurAlpha[cy2 * W + cx] = sumaY / diametro;
                    var saleY = Math.max(cy2 - radio, 0);
                    var entraY = Math.min(cy2 + radio + 1, H - 1);
                    sumaY += tempAlpha[entraY * W + cx] - tempAlpha[saleY * W + cx];
                }
            }

            var umbral = 126 + (nivel * 5);
            var rampa = 26 + (nivel * 4);
            for (var j = 0; j < len; j++) {
                if (data[j * 4 + 3] === 0 && blurAlpha[j] === 0) continue;
                var aSuave = blurAlpha[j];
                var nAlfa = 0;
                if (aSuave <= (umbral - rampa)) nAlfa = 0;
                else if (aSuave >= (umbral + rampa)) nAlfa = 255;
                else nAlfa = Math.round(((aSuave - (umbral - rampa)) / (rampa * 2)) * 255);

                if (nAlfa > 0 && nAlfa < 255) {
                    var r = data[j * 4], g = data[j * 4 + 1], b = data[j * 4 + 2];
                    if (r > 200 && g > 200 && b > 200) {
                        var factorBlanco = (Math.min(r, g, b) - 200) / 55;
                        nAlfa = Math.round(nAlfa * (1 - factorBlanco * 0.75));
                    }
                }
                data[j * 4 + 3] = nAlfa;
            }
            ctx.putImageData(imgData, 0, 0);
            guardarSnapshot();
            emitirBeep();
        },

        autoRecorteTransparente: function() {
            if (!ctx || !canvas) return;
            hornearFiltrosColor();
            var W = canvas.width, H = canvas.height;
            var data = ctx.getImageData(0, 0, W, H).data;
            var minX = W, minY = H, maxX = 0, maxY = 0;
            var hayPixeles = false;
            for (var y = 0; y < H; y++) {
                for (var x = 0; x < W; x++) {
                    if (data[(y * W + x) * 4 + 3] > 10) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                        hayPixeles = true;
                    }
                }
            }
            if (!hayPixeles) return;
            minX = Math.max(0, minX - 2);
            minY = Math.max(0, minY - 2);
            maxX = Math.min(W - 1, maxX + 2);
            maxY = Math.min(H - 1, maxY + 2);
            var cW = (maxX - minX) + 1;
            var cH = (maxY - minY) + 1;
            var rec = ctx.getImageData(minX, minY, cW, cH);
            canvas.width = cW;
            canvas.height = cH;
            ctx.putImageData(rec, 0, 0);
            guardarSnapshot();
            emitirBeep();
        },

        actualizarColorLive: function() {
            filtroBrillo = parseInt(document.getElementById('gk-slider-brillo').value || '100', 10);
            filtroContraste = parseInt(document.getElementById('gk-slider-contraste').value || '100', 10);
            filtroSaturacion = parseInt(document.getElementById('gk-slider-sat').value || '100', 10);
            document.getElementById('gk-val-brillo').innerText = filtroBrillo + '%';
            document.getElementById('gk-val-contraste').innerText = filtroContraste + '%';
            document.getElementById('gk-val-sat').innerText = filtroSaturacion + '%';
            canvas.style.filter = 'brightness(' + filtroBrillo + '%) contrast(' + filtroContraste + '%) saturate(' + filtroSaturacion + '%)';
        },

        aplicarNitidez: function(val) {
            filtroNitidez = parseInt(val, 10);
            document.getElementById('gk-val-nitidez').innerText = filtroNitidez + '%';
            if (!bufferSinNitidez) {
                bufferSinNitidez = ctx.getImageData(0, 0, canvas.width, canvas.height);
            }
            if (filtroNitidez === 0) {
                ctx.putImageData(bufferSinNitidez, 0, 0);
                return;
            }
            var W = canvas.width, H = canvas.height;
            var src = bufferSinNitidez.data;
            var imgData = ctx.createImageData(W, H);
            var dst = imgData.data;
            var fuerza = (filtroNitidez / 100) * 0.65;
            for (var y = 0; y < H; y++) {
                var fila = y * W;
                var fArr = (y > 0 ? y - 1 : y) * W;
                var fAbj = (y < H - 1 ? y + 1 : y) * W;
                for (var x = 0; x < W; x++) {
                    var idx = (fila + x) * 4;
                    var a = src[idx + 3];
                    if (a === 0) { dst[idx + 3] = 0; continue; }
                    var xIzq = x > 0 ? x - 1 : x;
                    var xDer = x < W - 1 ? x + 1 : x;
                    var iArr = (fArr + x) * 4, iAbj = (fAbj + x) * 4, iIzq = (fila + xIzq) * 4, iDer = (fila + xDer) * 4;
                    for (var c = 0; c < 3; c++) {
                        var v = src[idx + c];
                        var up = src[iArr + 3] > 0 ? src[iArr + c] : v;
                        var dn = src[iAbj + 3] > 0 ? src[iAbj + c] : v;
                        var lf = src[iIzq + 3] > 0 ? src[iIzq + c] : v;
                        var rg = src[iDer + 3] > 0 ? src[iDer + c] : v;
                        var lap = (v * 4) - up - dn - lf - rg;
                        var res = v + (lap * fuerza);
                        dst[idx + c] = res < 0 ? 0 : (res > 255 ? 255 : res);
                    }
                    dst[idx + 3] = a;
                }
            }
            ctx.putImageData(imgData, 0, 0);
        },

        confirmarRecorteManual: function() {
            hornearFiltrosColor();
            var x = Math.min(cropStartX, cropEndX);
            var y = Math.min(cropStartY, cropEndY);
            var w = Math.abs(cropEndX - cropStartX);
            var h = Math.abs(cropEndY - cropStartY);
            if (w < 10 || h < 10) return;
            var rec = ctx.getImageData(x, y, w, h);
            canvas.width = w;
            canvas.height = h;
            ctx.putImageData(rec, 0, 0);
            this.abrirPanel('varita');
            guardarSnapshot();
            emitirBeep();
        },

        rotar: function(grados) {
            hornearFiltrosColor();
            var temp = document.createElement('canvas');
            temp.width = canvas.width;
            temp.height = canvas.height;
            temp.getContext('2d').drawImage(canvas, 0, 0);
            canvas.width = temp.height;
            canvas.height = temp.width;
            ctx.save();
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate((grados * Math.PI) / 180);
            ctx.drawImage(temp, -temp.width / 2, -temp.height / 2);
            ctx.restore();
            guardarSnapshot();
            emitirBeep();
        },

        deshacer: function() {
            if (historial.length > 1) {
                historial.pop();
                var snap = historial[historial.length - 1];
                canvas.width = snap.width;
                canvas.height = snap.height;
                ctx.putImageData(snap, 0, 0);
                bufferSinNitidez = null;
                document.getElementById('gk-est-lbl-dim').innerText = canvas.width + 'x' + canvas.height + ' px';
                emitirBeep();
            }
        },

        restaurarOriginal: function() {
            if (imgOriginalDataUrl) cargarDataUrlEnCanvas(imgOriginalDataUrl);
        }
    };

})(window);

