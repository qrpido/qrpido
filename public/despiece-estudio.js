/**
 * GEOKATU B2B - Motor de Despiece Web & Estudio Canvas 2D en Cliente
 * Archivo: despiece-estudio.js
 * Cumplimiento: Vanilla JS puro, WebP 0.82 < 120 KB, cero dependencias pesadas, cero sintaxis Docs-incompatible (${})
 */

import { 
    AppState, 
    mostrarToast, 
    emitirTono, 
    renderizarListaSkusDrawer, 
    registrarCategoriaGlobalCatalogo, 
    subirFotoAStorageEnSegundoPlano,
    subirFotoIdentidadStorage,
    actualizarPreviewsIdentidadUI,
    actualizarPinDrawerLive
} from './onboarding-core.js';

let coleccionImagenesDespiece = [];
let textoSeleccionadoDespiece = '';
let precioSeleccionadoDespiece = 0;
let descSeleccionadaDespiece = '';
let rolSeleccionadoEstudio = 'producto';

let indiceActualEstudio = -1;
let historialEstudio = [];
let bufferBaseSinNitidez = null;
let filtroNitidezValor = 0;
let modoHerramientaEstudio = 'varita';
let arrastrandoCropEstudio = false;
let cropStartX = 0, cropStartY = 0, cropEndX = 0, cropEndY = 0;

let filtroBrillo = 100;
let filtroContraste = 100;
let filtroSaturacion = 100;

let modalEstudio = null;
let canvasEstudio = null;
let ctxEstudio = null;
let viewportCanvas = null;
let overlayCropEstudio = null;
let zonaPegadoDespiece = null;

function inicializarEstudioDOM() {
    modalEstudio = document.getElementById('modal-estudio-canvas-geokatu');
    canvasEstudio = document.getElementById('estudio-canvas-render');
    if (canvasEstudio) {
        ctxEstudio = canvasEstudio.getContext('2d', { willReadFrequently: true });
    }
    viewportCanvas = document.getElementById('viewport-canvas-wrap');
    overlayCropEstudio = document.getElementById('estudio-crop-overlay');
    zonaPegadoDespiece = document.getElementById('zona-pegado-despiece');

    inicializarEventosPegado();
    inicializarEventosCanvas();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarEstudioDOM);
} else {
    inicializarEstudioDOM();
}


// =========================================================================
// FILTROS CROMÁTICOS EN CLIENTE
// =========================================================================
export function actualizarFiltrosColorLive() {
    const sB = document.getElementById('estudio-slider-brillo');
    const sC = document.getElementById('estudio-slider-contraste');
    const sS = document.getElementById('estudio-slider-saturacion');

    filtroBrillo = parseInt(sB ? sB.value : '100', 10);
    filtroContraste = parseInt(sC ? sC.value : '100', 10);
    filtroSaturacion = parseInt(sS ? sS.value : '100', 10);

    const valB = document.getElementById('valor-brillo-txt');
    const valC = document.getElementById('valor-contraste-txt');
    const valS = document.getElementById('valor-saturacion-txt');

    if (valB) valB.innerText = filtroBrillo + '%';
    if (valC) valC.innerText = filtroContraste + '%';
    if (valS) valS.innerText = filtroSaturacion + '%';

    if (canvasEstudio) {
        canvasEstudio.style.filter = 'brightness(' + filtroBrillo + '%) contrast(' + filtroContraste + '%) saturate(' + filtroSaturacion + '%)';
    }
}
window.actualizarFiltrosColorLive = actualizarFiltrosColorLive;

export function restablecerFiltrosColorEstudio() {
    filtroBrillo = 100;
    filtroContraste = 100;
    filtroSaturacion = 100;

    const sB = document.getElementById('estudio-slider-brillo');
    const sC = document.getElementById('estudio-slider-contraste');
    const sS = document.getElementById('estudio-slider-saturacion');

    if (sB) sB.value = 100;
    if (sC) sC.value = 100;
    if (sS) sS.value = 100;

    actualizarFiltrosColorLive();
}
window.restablecerFiltrosColorEstudio = restablecerFiltrosColorEstudio;

export function hornearFiltrosEnPixels() {
    if (filtroBrillo === 100 && filtroContraste === 100 && filtroSaturacion === 100) return;
    if (!canvasEstudio || !ctxEstudio) return;

    const temp = document.createElement('canvas');
    temp.width = canvasEstudio.width;
    temp.height = canvasEstudio.height;
    const tCtx = temp.getContext('2d');

    tCtx.filter = 'brightness(' + filtroBrillo + '%) contrast(' + filtroContraste + '%) saturate(' + filtroSaturacion + '%)';
    tCtx.drawImage(canvasEstudio, 0, 0);

    ctxEstudio.clearRect(0, 0, canvasEstudio.width, canvasEstudio.height);
    ctxEstudio.drawImage(temp, 0, 0);

    canvasEstudio.style.filter = 'none';
    restablecerFiltrosColorEstudio();
    guardarSnapshotEstudio();
}

// =========================================================================
// MOTOR DE INGESTIÓN DEL PORTAPAPELES
// =========================================================================
function inicializarEventosPegado() {
    window.addEventListener('paste', function(e) {
        const drawer = document.getElementById('drawer-catalogo-comercio');
        if (drawer && drawer.classList.contains('activo')) {
            const tagActivo = document.activeElement ? document.activeElement.tagName : '';
            if (tagActivo !== 'INPUT' && tagActivo !== 'TEXTAREA') {
                procesarEventoPaste(e);
            }
        }
    });

    if (zonaPegadoDespiece) {
        zonaPegadoDespiece.addEventListener('paste', function(e) {
            e.preventDefault();
            procesarEventoPaste(e);
        });

        zonaPegadoDespiece.addEventListener('input', function() {
            const contenido = this.innerHTML || '';
            const texto = (this.innerText || '').replace(/Manten presionado aqui para pegar copia total/gi, '').trim();
            this.innerHTML = '<div class="texto-pegado-instruccion" style="pointer-events:none;"><span>Manten presionado aqui para pegar copia total</span></div>';
            if (texto || (contenido && contenido.indexOf('<img') !== -1)) {
                procesarContenidoDespiece(contenido, texto);
            }
        });

    }
}

function procesarEventoPaste(e) {
    if (!AppState.comercioActivo) {
        mostrarToast("Abre primero el catalogo de un comercio en el Drawer.", "error");
        return;
    }

    const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items || [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf('image') === 0) {
            const blob = item.getAsFile();
            const localUrl = URL.createObjectURL(blob);
            incorporarMiniaturasDespiece([localUrl]);
            emitirTono('EXITO');
            mostrarToast("Imagen capturada del portapapeles.", "exito");
            return;
        }
    }

    const html = e.clipboardData.getData('text/html');
    const textoPlano = e.clipboardData.getData('text/plain');

    if (!html && !textoPlano) {
        mostrarToast("No se detecto contenido valido.", "error");
        return;
    }

    procesarContenidoDespiece(html, textoPlano);
}

window.pegarDesdePortapapelesDirecto = async function() {
    if (!AppState.comercioActivo) {
        mostrarToast("Abre primero el catalogo de un comercio en el Drawer.", "error");
        return;
    }

    const progresoBox = document.getElementById('progreso-extraccion-web');
    const barraProgreso = document.getElementById('barra-progreso-extraccion');
    const txtProgreso = document.getElementById('txt-progreso-extraccion');
    const pctProgreso = document.getElementById('porcentaje-extraccion');

    if (progresoBox) progresoBox.style.display = 'block';
    if (barraProgreso) barraProgreso.style.width = '20%';
    if (txtProgreso) txtProgreso.innerText = "Leyendo portapapeles...";
    if (pctProgreso) pctProgreso.innerText = "20%";

    try {
        if (navigator.clipboard && navigator.clipboard.read) {
            const items = await navigator.clipboard.read();
            let imagenCapturada = false;
            let htmlTexto = '';
            let planoTexto = '';

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                for (let j = 0; j < item.types.length; j++) {
                    const type = item.types[j];
                    if (type.indexOf('image/') === 0) {
                        const blob = await item.getType(type);
                        const localUrl = URL.createObjectURL(blob);
                        incorporarMiniaturasDespiece([localUrl]);
                        imagenCapturada = true;
                    } else if (type === 'text/html') {
                        const blob = await item.getType(type);
                        htmlTexto = await blob.text();
                    } else if (type === 'text/plain') {
                        const blob = await item.getType(type);
                        planoTexto = await blob.text();
                    }
                }
            }

            if (imagenCapturada && !htmlTexto && !planoTexto) {
                if (progresoBox) progresoBox.style.display = 'none';
                emitirTono('EXITO');
                mostrarToast("Imagen capturada del portapapeles.", "exito");
                return;
            }

            if (htmlTexto || planoTexto) {
                procesarContenidoDespiece(htmlTexto, planoTexto);
                return;
            }
        }

        if (navigator.clipboard && navigator.clipboard.readText) {
            const texto = await navigator.clipboard.readText();
            if (texto && texto.trim()) {
                procesarContenidoDespiece('', texto);
                return;
            }
        }

        mostrarToast("El portapapeles esta vacio.", "info");
        if (progresoBox) progresoBox.style.display = 'none';
    } catch (err) {
        if (progresoBox) progresoBox.style.display = 'none';
        mostrarToast("Manten presionado dentro del recuadro para pegar.", "info", 3500);
        if (zonaPegadoDespiece) zonaPegadoDespiece.focus();
    }
};

function procesarContenidoDespiece(html, textoPlano) {
    const progresoBox = document.getElementById('progreso-extraccion-web');
    const barraProgreso = document.getElementById('barra-progreso-extraccion');
    const txtProgreso = document.getElementById('txt-progreso-extraccion');
    const pctProgreso = document.getElementById('porcentaje-extraccion');

    if (progresoBox) progresoBox.style.display = 'block';
    if (barraProgreso) barraProgreso.style.width = '40%';
    if (txtProgreso) txtProgreso.innerText = "Parseando DOM y rastreando fuentes...";
    if (pctProgreso) pctProgreso.innerText = "40%";

    const parser = new DOMParser();
    const docParsed = parser.parseFromString(html || textoPlano, 'text/html');

    const urlsExtraidas = extraerUrlsPolimorficas(docParsed, html);
    const textosClasificados = clasificarTextosYPrecios(docParsed, textoPlano);

    if (barraProgreso) barraProgreso.style.width = '80%';
    if (txtProgreso) txtProgreso.innerText = "Renderizando chips...";
    if (pctProgreso) pctProgreso.innerText = "80%";

    renderizarChipsDespiece(textosClasificados);
    incorporarMiniaturasDespiece(urlsExtraidas);

    if (progresoBox) {
        barraProgreso.style.width = '100%';
        pctProgreso.innerText = '100%';
        setTimeout(function() { progresoBox.style.display = 'none'; }, 400);
    }

    emitirTono('EXITO');
    const totalTxt = textosClasificados.precios.length + textosClasificados.titulos.length;
    mostrarToast('Despiece: ' + urlsExtraidas.length + ' imagenes y ' + totalTxt + ' textos.', 'exito');
}

function extraerUrlsPolimorficas(doc, rawHtml) {
    const urlsEncontradas = new Set();

    const normalizar = function(url) {
        if (!url || typeof url !== 'string') return null;
        let limpia = url.trim();
        if (limpia.indexOf('//') === 0) limpia = 'https:' + limpia;
        if (limpia.indexOf('spacer.gif') !== -1 || limpia.indexOf('1x1') !== -1 || limpia.indexOf('data:image/svg+xml') !== -1) return null;
        if (limpia.indexOf('data:image') === 0) return limpia.length > 300 ? limpia : null;
        if (limpia.indexOf('http://') === 0 || limpia.indexOf('https://') === 0) return limpia;
        return null;
    };

    const parsearSrcset = function(srcsetStr) {
        if (!srcsetStr) return;
        srcsetStr.split(',').forEach(function(fragmento) {
            const partes = fragmento.trim().split(/\s+/);
            if (partes[0]) {
                const u = normalizar(partes[0]);
                if (u) urlsEncontradas.add(u);
            }
        });
    };

    const elementos = doc.querySelectorAll('*');
    elementos.forEach(function(el) {
        ['src', 'data-src', 'data-original', 'data-lazy', 'data-lazy-src', 'data-zoom-image', 'data-zoom', 'data-old-hires', 'poster'].forEach(function(attr) {
            if (el.hasAttribute(attr)) {
                const val = normalizar(el.getAttribute(attr));
                if (val) urlsEncontradas.add(val);
            }
        });

        ['srcset', 'data-srcset'].forEach(function(attr) {
            if (el.hasAttribute(attr)) parsearSrcset(el.getAttribute(attr));
        });

        ['data-a-dynamic-image', 'data-images'].forEach(function(attr) {
            if (el.hasAttribute(attr)) {
                try {
                    const parsed = JSON.parse(el.getAttribute(attr));
                    if (Array.isArray(parsed)) {
                        parsed.forEach(function(u) { const v = normalizar(u); if (v) urlsEncontradas.add(v); });
                    } else if (typeof parsed === 'object') {
                        Object.keys(parsed).forEach(function(u) { const v = normalizar(u); if (v) urlsEncontradas.add(v); });
                    }
                } catch (e) {}
            }
        });

        const style = el.getAttribute('style') || '';
        if (style.indexOf('url(') !== -1) {
            const match = style.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
            if (match && match[1]) {
                const val = normalizar(match[1]);
                if (val) urlsEncontradas.add(val);
            }
        }
    });

    if (rawHtml) {
        const regexHttp = /(?:https?:)?\/\/[^\s"'<>]+\.(?:webp|png|jpe?g|avif)(?:\?[^\s"'<>]*)?/gi;
        let match;
        while ((match = regexHttp.exec(rawHtml)) !== null) {
            const val = normalizar(match[0]);
            if (val) urlsEncontradas.add(val);
        }
    }

    return Array.from(urlsEncontradas);
}

function clasificarTextosYPrecios(doc, textoPlano) {
    const precios = new Set();
    const titulos = new Set();
    const descripciones = new Set();
    const regexPrecio = /(?:\$|COP|USD|COL\$|€)\s*([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]{3,7})/i;
    const limpiar = function(txt) { return txt.replace(/[\n\r\t]+/g, ' ').trim(); };

    const nodos = doc.querySelectorAll('p, span, div, li, td, h1, h2, h3, h4, h5, b, strong');
    nodos.forEach(function(n) {
        const c = limpiar(n.textContent || '');
        const matchP = c.match(regexPrecio);
        if (matchP) precios.add(matchP[0]);
    });

    const nodosTitulos = doc.querySelectorAll('h1, h2, h3, h4, h5, strong, b, [class*="title"], [class*="name"]');
    nodosTitulos.forEach(function(n) {
        const t = limpiar(n.textContent || '').replace(regexPrecio, '').trim();
        if (t.length >= 3 && t.length <= 80 && !/^(comprar|carrito|iniciar|buscar|menu|ver|contacto|pedir)/i.test(t)) {
            titulos.add(t);
        }
    });

    const nodosDesc = doc.querySelectorAll('p, li, [class*="desc"], [class*="detail"], [class*="ingredient"]');
    nodosDesc.forEach(function(n) {
        const d = limpiar(n.textContent || '').replace(regexPrecio, '').trim();
        if (d.length >= 25 && d.length <= 400 && !/^(comprar|carrito|iniciar|buscar|menu|ver|contacto)/i.test(d)) {
            descripciones.add(d);
        }
    });

    if (textoPlano && titulos.size === 0) {
        textoPlano.split(/\r?\n/).forEach(function(linea) {
            const l = limpiar(linea);
            const matchP = l.match(regexPrecio);
            if (matchP) precios.add(matchP[0]);
            const t = l.replace(regexPrecio, '').replace(/^\d+[\.\)\-]\s*/, '').trim();
            if (t.length >= 3 && t.length <= 80) titulos.add(t);
            else if (t.length > 80 && t.length <= 400) descripciones.add(t);
        });
    }

    return {
        precios: Array.from(precios),
        titulos: Array.from(titulos),
        descripciones: Array.from(descripciones)
    };
}

function renderizarChipsDespiece(datos) {
    const contenedorChips = document.getElementById('contenedor-chips-clasificados');
    const grillaPrecios = document.getElementById('grilla-chips-precios');
    const grillaTitulos = document.getElementById('grilla-chips-titulos');
    const grillaDesc = document.getElementById('grilla-chips-descripciones');
    const badgePrecios = document.getElementById('conteo-precios-extraidos');
    const badgeTitulos = document.getElementById('conteo-titulos-extraidos');
    const badgeDesc = document.getElementById('conteo-descripciones-extraidas');

    if (!contenedorChips || !grillaPrecios || !grillaTitulos) return;

    grillaPrecios.innerHTML = '';
    grillaTitulos.innerHTML = '';
    if (grillaDesc) grillaDesc.innerHTML = '';

    const totalDesc = (datos.descripciones && datos.descripciones.length) ? datos.descripciones.length : 0;
    const total = datos.precios.length + datos.titulos.length + totalDesc;
    if (total === 0) {
        contenedorChips.style.display = 'none';
        return;
    }

    contenedorChips.style.display = 'flex';
    if (badgePrecios) badgePrecios.innerText = datos.precios.length;
    if (badgeTitulos) badgeTitulos.innerText = datos.titulos.length;
    if (badgeDesc) badgeDesc.innerText = totalDesc;

    datos.precios.forEach(function(precioStr) {
        const chip = document.createElement('div');
        chip.className = 'chip-despiece chip-precio';
        chip.innerText = precioStr;
        chip.onclick = async function() {
            const strSinCentavos = precioStr.replace(/[.,]00\b/, '');
            const numLimpio = parseFloat(strSinCentavos.replace(/[^\d]/g, '')) || 0;
            precioSeleccionadoDespiece = numLimpio;

            await navigator.clipboard.writeText(numLimpio.toString());
            document.querySelectorAll('.chip-despiece.chip-precio').forEach(function(c) { c.classList.remove('copiado'); });
            chip.classList.add('copiado');
            mostrarToast('Precio ' + precioStr + ' seleccionado.', 'info', 1500);
        };
        grillaPrecios.appendChild(chip);
    });

    datos.titulos.forEach(function(tituloStr) {
        const chip = document.createElement('div');
        chip.className = 'chip-despiece';
        chip.innerText = tituloStr;
        chip.onclick = async function() {
            textoSeleccionadoDespiece = tituloStr;
            const inputNombre = document.getElementById('estudio-prod-nombre');
            if (inputNombre) inputNombre.value = tituloStr;
            await navigator.clipboard.writeText(tituloStr);
            document.querySelectorAll('#grilla-chips-titulos .chip-despiece').forEach(function(c) { c.classList.remove('copiado'); });
            chip.classList.add('copiado');
            mostrarToast('Titulo: "' + tituloStr + '"', 'info', 1500);
        };
        grillaTitulos.appendChild(chip);
    });

    if (grillaDesc && datos.descripciones) {
        datos.descripciones.forEach(function(descStr) {
            const chip = document.createElement('div');
            chip.className = 'chip-despiece chip-desc';
            chip.innerText = descStr.length > 70 ? (descStr.substring(0, 67) + '...') : descStr;
            chip.title = descStr;
            chip.onclick = async function() {
                descSeleccionadaDespiece = descStr;
                const inputDesc = document.getElementById('estudio-prod-desc');
                if (inputDesc) inputDesc.value = descStr;
                await navigator.clipboard.writeText(descStr);
                document.querySelectorAll('#grilla-chips-descripciones .chip-despiece').forEach(function(c) { c.classList.remove('copiado'); });
                chip.classList.add('copiado');
                mostrarToast('Descripcion seleccionada.', 'info', 1500);
            };
            grillaDesc.appendChild(chip);
        });
    }
}

function incorporarMiniaturasDespiece(urls) {
    const contBox = document.getElementById('contenedor-miniaturas-despiece');
    const grilla = document.getElementById('grilla-miniaturas-despiece');
    const badge = document.getElementById('conteo-miniaturas-cola');

    if (!contBox || !grilla) return;

    urls.forEach(function(url) {
        if (coleccionImagenesDespiece.some(function(item) { return item.url === url; })) return;
        const id = coleccionImagenesDespiece.length;
        const item = { id: id, url: url, dataUrlOriginal: url, dataUrlActual: url };
        coleccionImagenesDespiece.push(item);

        const card = document.createElement('div');
        card.className = 'card-miniatura-extraida';
        card.id = 'miniatura-extraida-' + id;
        card.innerHTML = 
            '<span class="badge-img-idx">#' + (id + 1) + '</span>' +
            '<div class="caja-img-recorte">' +
                '<img id="thumb-extraida-' + id + '" src="' + url + '" loading="lazy" onerror="manejarFalloMiniaturaDespiece(this, \'' + encodeURIComponent(url).replace(/'/g, "%27") + '\')">' +
            '</div>' +

            '<div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:3px;">' +
                '<button type="button" class="btn-submit" style="padding:4px 2px; font-size:9.5px; justify-content:center; background:var(--azul-link); color:#052e16; font-weight:800;" onclick="abrirEstudioCanvas(' + id + ')">' +
                    'Editar' +
                '</button>' +
                '<button type="button" class="btn-submit" style="padding:4px 2px; font-size:9.5px; justify-content:center; background:rgba(41,182,246,0.15); color:var(--azul-link);" onclick="descargarMiniaturaDirecta(' + id + ')">' +
                    'Bajar' +
                '</button>' +
                '<button type="button" class="btn-submit" style="padding:4px 2px; font-size:9.5px; justify-content:center; background:rgba(255,255,255,0.06); color:#ccc;" onclick="descartarMiniaturaDespiece(' + id + ')">' +
                    'Quitar' +
                '</button>' +
            '</div>';
        grilla.appendChild(card);
    });

    if (badge) badge.innerText = coleccionImagenesDespiece.length;
    contBox.style.display = coleccionImagenesDespiece.length > 0 ? 'block' : 'none';
}

window.descargarMiniaturaDirecta = async function(id) {
    const item = coleccionImagenesDespiece.find(function(i) { return i.id === id; });
    if (!item) return;
    try {
        const blob = await descargarImagenComoBlobSeguro(item.dataUrlActual);
        if (!blob) throw new Error("CORS");
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'miniatura_' + (id + 1) + '.webp';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
        emitirTono('EXITO');
        mostrarToast("Descarga completada.", "exito");
    } catch(e) {
        window.open(item.url, '_blank');
    }
};

window.descartarMiniaturaDespiece = function(id) {
    const card = document.getElementById('miniatura-extraida-' + id);
    if (card) card.remove();
    coleccionImagenesDespiece = coleccionImagenesDespiece.filter(function(item) { return item.id !== id; });
    const badge = document.getElementById('conteo-miniaturas-cola');
    if (badge) badge.innerText = coleccionImagenesDespiece.length;
    const contBox = document.getElementById('contenedor-miniaturas-despiece');
    if (contBox && coleccionImagenesDespiece.length === 0) contBox.style.display = 'none';
};

window.manejarFalloMiniaturaDespiece = function(imgEl, urlOriginal) {
    let urlLimpia = urlOriginal;
    try { urlLimpia = decodeURIComponent(urlOriginal); } catch (e) {}
    if (!imgEl.dataset.reintentado) {
        imgEl.dataset.reintentado = "true";
        imgEl.src = 'https://images.weserv.nl/?url=' + encodeURIComponent(urlLimpia);
    } else {
        if (imgEl.parentElement) imgEl.parentElement.style.opacity = '0.35';
    }
};


window.limpiarDespieceWeb = function() {
    coleccionImagenesDespiece = [];
    textoSeleccionadoDespiece = '';
    precioSeleccionadoDespiece = 0;
    descSeleccionadaDespiece = '';
    const contMini = document.getElementById('contenedor-miniaturas-despiece');
    const contChips = document.getElementById('contenedor-chips-clasificados');
    const grillaMini = document.getElementById('grilla-miniaturas-despiece');
    if (contMini) contMini.style.display = 'none';
    if (contChips) contChips.style.display = 'none';
    if (grillaMini) grillaMini.innerHTML = '';
    mostrarToast("Bandejas vaciadas.", "info");
};

// =========================================================================
// ESTUDIO CANVAS 2D EN CLIENTE (VANILLA JS PURO)
// =========================================================================
window.cambiarRolDestinoEstudio = function(rol) {
    rolSeleccionadoEstudio = rol;
    const camposProd = document.getElementById('estudio-campos-producto');
    if (camposProd) {
        camposProd.style.display = (rol === 'producto') ? 'flex' : 'none';
    }
};

window.abrirEstudioCanvas = function(id) {
    const item = coleccionImagenesDespiece.find(function(i) { return i.id === id; });
    if (!item) return;

    indiceActualEstudio = id;
    historialEstudio = [];
    bufferBaseSinNitidez = null;

    const sliderNitidez = document.getElementById('estudio-slider-nitidez');
    const valNitidez = document.getElementById('valor-nitidez-txt');
    if (sliderNitidez) sliderNitidez.value = 0;
    if (valNitidez) valNitidez.innerText = '0%';

    const inputNombre = document.getElementById('estudio-prod-nombre');
    const inputPrecio = document.getElementById('estudio-prod-precio');
    const inputDesc = document.getElementById('estudio-prod-desc');
    const inputCat = document.getElementById('estudio-prod-categoria');
    const selectRol = document.getElementById('estudio-destino-rol');

    if (inputNombre) inputNombre.value = textoSeleccionadoDespiece || '';
    if (inputPrecio) inputPrecio.value = (precioSeleccionadoDespiece > 0) ? precioSeleccionadoDespiece : '';
    if (inputDesc) inputDesc.value = descSeleccionadaDespiece || '';
    if (inputCat) {
        inputCat.value = (AppState.comercioActivo && (AppState.comercioActivo.nicho || AppState.comercioActivo.categoria)) 
            ? (AppState.comercioActivo.nicho || AppState.comercioActivo.categoria) 
            : 'General';
    }
    if (selectRol) selectRol.value = 'producto';
    cambiarRolDestinoEstudio('producto');

    activarModoEstudio('varita');
    cargarImagenEnLienzoEstudio(item.dataUrlActual);

    if (modalEstudio) modalEstudio.style.display = 'flex';
};

window.cerrarEstudioCanvas = function() {
    if (modalEstudio) modalEstudio.style.display = 'none';
    indiceActualEstudio = -1;
    desactivarModoCropEstudio();
};

window.estudioNavegarImagen = function(delta) {
    if (indiceActualEstudio === -1 || coleccionImagenesDespiece.length <= 1) return;
    let nuevoIdx = indiceActualEstudio + delta;
    if (nuevoIdx < 0) nuevoIdx = coleccionImagenesDespiece.length - 1;
    if (nuevoIdx >= coleccionImagenesDespiece.length) nuevoIdx = 0;
    abrirEstudioCanvas(nuevoIdx);
};

async function descargarImagenComoBlobSeguro(urlFuente) {
    if (!urlFuente || typeof urlFuente !== 'string') return null;

    if (urlFuente.indexOf('blob:') === 0 || urlFuente.indexOf('data:') === 0) {
        try {
            const res = await fetch(urlFuente);
            return await res.blob();
        } catch (e) {
            return null;
        }
    }

    // Limpieza de protocolo para túneles proxy
    const urlLimpia = urlFuente.trim();
    const encodedUrl = encodeURIComponent(urlLimpia);

    // Cascada de túneles proxy con inyección forzada de CORS
    const listaProxies = [
        'https://images.weserv.nl/?url=' + encodedUrl + '&default=' + encodedUrl,
        'https://corsproxy.io/?' + encodedUrl,
        'https://api.allorigins.win/raw?url=' + encodedUrl
    ];

    // Intento 1: Descarga directa si el servidor original lo permite
    try {
        const resDirecta = await fetch(urlLimpia, { mode: 'cors' });
        if (resDirecta.ok) {
            const b = await resDirecta.blob();
            if (b && b.size > 200) return b;
        }
    } catch (eDirecto) {}

    // Intento 2: Recorrido de cascada de proxies
    for (let i = 0; i < listaProxies.length; i++) {
        try {
            const resProxy = await fetch(listaProxies[i]);
            if (resProxy.ok) {
                const bProxy = await resProxy.blob();
                if (bProxy && bProxy.size > 200) {
                    return bProxy;
                }
            }
        } catch (eProxy) {}
    }

    return null;
}

async function cargarImagenEnLienzoEstudio(fuenteUrl) {
    const badgeDim = document.getElementById('estudio-resolucion-badge');
    if (badgeDim) badgeDim.innerText = "Cargando...";

    let urlFinal = fuenteUrl;
    let esBlobLocal = false;

    // Conversión forzosa a Blob en RAM para blindar el Canvas contra contaminación CORS
    if (fuenteUrl.indexOf('data:') !== 0 && fuenteUrl.indexOf('blob:') !== 0) {
        const blobSeguro = await descargarImagenComoBlobSeguro(fuenteUrl);
        if (blobSeguro) {
            urlFinal = URL.createObjectURL(blobSeguro);
            esBlobLocal = true;
        }
    } else {
        esBlobLocal = true;
    }

    const img = new Image();
    
    // Solo requerir crossOrigin si no pudimos convertir a blob local
    if (!esBlobLocal) {
        img.crossOrigin = "anonymous";
    }

    img.onload = function() {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;

        const MAX_LADO = 1600;
        if (w > MAX_LADO || h > MAX_LADO) {
            if (w > h) {
                h = Math.round((h * MAX_LADO) / w);
                w = MAX_LADO;
            } else {
                w = Math.round((w * MAX_LADO) / h);
                h = MAX_LADO;
            }
        }

        canvasEstudio.width = w;
        canvasEstudio.height = h;

        ctxEstudio.clearRect(0, 0, w, h);
        ctxEstudio.drawImage(img, 0, 0, w, h);

        if (badgeDim) badgeDim.innerText = w + ' x ' + h + ' px';
        guardarSnapshotEstudio();
    };

        img.onerror = function() {
        if (badgeDim) badgeDim.innerText = "Error CORS";
        mostrarToast("No fue posible importar la imagen protegida por CORS.", "error");
    };

    img.src = urlFinal;
}

function guardarSnapshotEstudio() {
    if (!ctxEstudio || !canvasEstudio) return;
    if (historialEstudio.length >= 6) historialEstudio.shift();
    historialEstudio.push(ctxEstudio.getImageData(0, 0, canvasEstudio.width, canvasEstudio.height));
    bufferBaseSinNitidez = null;
    const sliderNitidez = document.getElementById('estudio-slider-nitidez');
    const valNitidez = document.getElementById('valor-nitidez-txt');
    if (sliderNitidez) sliderNitidez.value = 0;
    if (valNitidez) valNitidez.innerText = '0%';
}

window.deshacerPasoEstudio = function() {
    if (historialEstudio.length > 1) {
        historialEstudio.pop();
        const snapshotAnterior = historialEstudio[historialEstudio.length - 1];
        canvasEstudio.width = snapshotAnterior.width;
        canvasEstudio.height = snapshotAnterior.height;
        ctxEstudio.putImageData(snapshotAnterior, 0, 0);
        bufferBaseSinNitidez = null;
        const badgeDim = document.getElementById('estudio-resolucion-badge');
        if (badgeDim) badgeDim.innerText = canvasEstudio.width + ' x ' + canvasEstudio.height + ' px';
        emitirTono('EXITO');
    } else {
        mostrarToast("No hay mas cambios por deshacer.", "info");
    }
};

window.restablecerImagenOriginalEstudio = function() {
    if (indiceActualEstudio === -1) return;
    const item = coleccionImagenesDespiece.find(function(i) { return i.id === indiceActualEstudio; });
    if (item) {
        cargarImagenEnLienzoEstudio(item.dataUrlOriginal);
        mostrarToast("Lienzo restablecido.", "info");
    }
};

window.activarModoEstudio = function(modo) {
    modoHerramientaEstudio = modo;
    const btnVarita = document.getElementById('btn-herramienta-varita');
    const btnCrop = document.getElementById('btn-herramienta-crop');
    const btnConfirmCrop = document.getElementById('btn-confirmar-crop-estudio');

    if (btnVarita) btnVarita.classList.toggle('activo', modo === 'varita');
    if (btnCrop) btnCrop.classList.toggle('activo', modo === 'crop');
    if (btnConfirmCrop) btnConfirmCrop.style.display = 'none';
    if (overlayCropEstudio) overlayCropEstudio.style.display = 'none';

    if (canvasEstudio) {
        canvasEstudio.style.cursor = (modo === 'varita') ? 'crosshair' : 'cell';
    }
};

function desactivarModoCropEstudio() {
    activarModoEstudio('varita');
    if (overlayCropEstudio) overlayCropEstudio.style.display = 'none';
    arrastrandoCropEstudio = false;
}

function inicializarEventosCanvas() {
    if (!canvasEstudio) return;

    canvasEstudio.addEventListener('click', function(e) {
        if (modoHerramientaEstudio !== 'varita' || !ctxEstudio) return;

        hornearFiltrosEnPixels();

        const rect = canvasEstudio.getBoundingClientRect();
        const escalaX = canvasEstudio.width / rect.width;
        const escalaY = canvasEstudio.height / rect.height;

        const W = canvasEstudio.width;
        const H = canvasEstudio.height;

        const startX = Math.max(0, Math.min(W - 1, Math.floor((e.clientX - rect.left) * escalaX)));
        const startY = Math.max(0, Math.min(H - 1, Math.floor((e.clientY - rect.top) * escalaY)));

        const imgData = ctxEstudio.getImageData(0, 0, W, H);
        const data = imgData.data;

        const targetIdx = (startY * W + startX) * 4;
        const targetR = data[targetIdx];
        const targetG = data[targetIdx + 1];
        const targetB = data[targetIdx + 2];
        const targetA = data[targetIdx + 3];

        if (targetA === 0) return;

        const inputTol = document.getElementById('estudio-slider-tolerancia');
        const tol = parseInt((inputTol ? inputTol.value : '35'), 10);
        const tolDistanciaSq = Math.pow((tol / 100) * 441.67, 2);

        const esSimilar = function(r, g, b) {
            const dR = r - targetR;
            const dG = g - targetG;
            const dB = b - targetB;
            return (dR * dR + dG * dG + dB * dB) <= tolDistanciaSq;
        };

        const checkGlobal = document.getElementById('estudio-varita-global');
        const esGlobal = checkGlobal ? checkGlobal.checked : false;

        if (esGlobal) {
            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] > 0 && esSimilar(data[i], data[i + 1], data[i + 2])) {
                    data[i + 3] = 0;
                }
            }
        } else {
            const visitados = new Uint8Array(W * H);
            const cola = [startX + startY * W];
            visitados[startX + startY * W] = 1;

            while (cola.length > 0) {
                const idxPixel = cola.pop();
                const cX = idxPixel % W;
                const cY = Math.floor(idxPixel / W);
                const pIdx = idxPixel * 4;

                data[pIdx + 3] = 0;

                const vecinos = [
                    cX > 0 ? (cX - 1) + cY * W : -1,
                    cX < W - 1 ? (cX + 1) + cY * W : -1,
                    cY > 0 ? cX + (cY - 1) * W : -1,
                    cY < H - 1 ? cX + (cY + 1) * W : -1
                ];

                for (let v = 0; v < vecinos.length; v++) {
                    const n = vecinos[v];
                    if (n !== -1 && visitados[n] === 0) {
                        visitados[n] = 1;
                        const nIdx = n * 4;
                        if (data[nIdx + 3] > 0 && esSimilar(data[nIdx], data[nIdx + 1], data[nIdx + 2])) {
                            cola.push(n);
                        }
                    }
                }
            }
        }

        ctxEstudio.putImageData(imgData, 0, 0);
        guardarSnapshotEstudio();
        emitirTono('EXITO');
    });

    if (viewportCanvas) {
        viewportCanvas.addEventListener('mousedown', function(e) {
            if (modoHerramientaEstudio !== 'crop') return;
            arrastrandoCropEstudio = true;
            const pt = coordsEnCanvasEstudio(e.clientX, e.clientY);
            cropStartX = pt.x; cropStartY = pt.y;
            cropEndX = pt.x; cropEndY = pt.y;
        });

        window.addEventListener('mousemove', function(e) {
            if (!arrastrandoCropEstudio || modoHerramientaEstudio !== 'crop') return;
            const pt = coordsEnCanvasEstudio(e.clientX, e.clientY);
            cropEndX = pt.x; cropEndY = pt.y;
            actualizarOverlayRecorteEstudio(e.clientX, e.clientY);
        });

        window.addEventListener('mouseup', function() {
            if (!arrastrandoCropEstudio || modoHerramientaEstudio !== 'crop') return;
            arrastrandoCropEstudio = false;
            const w = Math.abs(cropEndX - cropStartX);
            const h = Math.abs(cropEndY - cropStartY);
            const btnConfirm = document.getElementById('btn-confirmar-crop-estudio');
            if (btnConfirm) btnConfirm.style.display = (w > 8 && h > 8) ? 'inline-block' : 'none';
        });

        viewportCanvas.addEventListener('touchstart', function(e) {
            if (modoHerramientaEstudio !== 'crop' || e.touches.length === 0) return;
            arrastrandoCropEstudio = true;
            const t = e.touches[0];
            const pt = coordsEnCanvasEstudio(t.clientX, t.clientY);
            cropStartX = pt.x; cropStartY = pt.y;
            cropEndX = pt.x; cropEndY = pt.y;
        }, { passive: true });

        window.addEventListener('touchmove', function(e) {
            if (!arrastrandoCropEstudio || modoHerramientaEstudio !== 'crop' || e.touches.length === 0) return;
            const t = e.touches[0];
            const pt = coordsEnCanvasEstudio(t.clientX, t.clientY);
            cropEndX = pt.x; cropEndY = pt.y;
            actualizarOverlayRecorteEstudio(t.clientX, t.clientY);
        }, { passive: true });

        window.addEventListener('touchend', function() {
            if (!arrastrandoCropEstudio || modoHerramientaEstudio !== 'crop') return;
            arrastrandoCropEstudio = false;
            const w = Math.abs(cropEndX - cropStartX);
            const h = Math.abs(cropEndY - cropStartY);
            const btnConfirm = document.getElementById('btn-confirmar-crop-estudio');
            if (btnConfirm) btnConfirm.style.display = (w > 8 && h > 8) ? 'inline-block' : 'none';
        });
    }
}

window.ejecutarSuavizadoMorfologico = function(nivel) {
    if (!ctxEstudio || !canvasEstudio) return;

    const W = canvasEstudio.width;
    const H = canvasEstudio.height;
    const imgData = ctxEstudio.getImageData(0, 0, W, H);
    const data = imgData.data;
    const len = W * H;

    const radio = nivel;
    const diametro = radio * 2 + 1;

    const alpha = new Float32Array(len);
    for (let i = 0; i < len; i++) alpha[i] = data[i * 4 + 3];

    const tempAlpha = new Float32Array(len);
    for (let y = 0; y < H; y++) {
        const fila = y * W;
        let suma = 0;
        for (let x = -radio; x <= radio; x++) {
            const px = Math.min(Math.max(x, 0), W - 1);
            suma += alpha[fila + px];
        }
        for (let x = 0; x < W; x++) {
            tempAlpha[fila + x] = suma / diametro;
            const sale = Math.max(x - radio, 0);
            const entra = Math.min(x + radio + 1, W - 1);
            suma += alpha[fila + entra] - alpha[fila + sale];
        }
    }

    const blurAlpha = new Float32Array(len);
    for (let x = 0; x < W; x++) {
        let suma = 0;
        for (let y = -radio; y <= radio; y++) {
            const py = Math.min(Math.max(y, 0), H - 1);
            suma += tempAlpha[py * W + x];
        }
        for (let y = 0; y < H; y++) {
            blurAlpha[y * W + x] = suma / diametro;
            const sale = Math.max(y - radio, 0);
            const entra = Math.min(y + radio + 1, H - 1);
            suma += tempAlpha[entra * W + x] - tempAlpha[sale * W + x];
        }
    }

    const umbral = 126 + (nivel * 5);
    const rampa = 26 + (nivel * 4);

    for (let i = 0; i < len; i++) {
        const aOrig = data[i * 4 + 3];
        if (aOrig === 0 && blurAlpha[i] === 0) continue;

        const aSuave = blurAlpha[i];
        let nuevoAlfa = 0;

        if (aSuave <= (umbral - rampa)) {
            nuevoAlfa = 0;
        } else if (aSuave >= (umbral + rampa)) {
            nuevoAlfa = 255;
        } else {
            nuevoAlfa = Math.round(((aSuave - (umbral - rampa)) / (rampa * 2)) * 255);
        }

        if (nuevoAlfa > 0 && nuevoAlfa < 255) {
            const r = data[i * 4];
            const g = data[i * 4 + 1];
            const b = data[i * 4 + 2];
            if (r > 200 && g > 200 && b > 200) {
                const factorBlanco = (Math.min(r, g, b) - 200) / 55;
                nuevoAlfa = Math.round(nuevoAlfa * (1 - factorBlanco * 0.75));
            }
        }
        data[i * 4 + 3] = nuevoAlfa;
    }

    ctxEstudio.putImageData(imgData, 0, 0);
    guardarSnapshotEstudio();
    emitirTono('EXITO');
    mostrarToast('Suavizado nivel ' + nivel + ' aplicado.', 'info', 1500);
};

window.aplicarNitidezLaplacianaLive = function(valor) {
    filtroNitidezValor = parseInt(valor, 10);
    const valTxt = document.getElementById('valor-nitidez-txt');
    if (valTxt) valTxt.innerText = filtroNitidezValor + '%';

    if (!bufferBaseSinNitidez) {
        bufferBaseSinNitidez = ctxEstudio.getImageData(0, 0, canvasEstudio.width, canvasEstudio.height);
    }

    if (filtroNitidezValor === 0) {
        ctxEstudio.putImageData(bufferBaseSinNitidez, 0, 0);
        return;
    }

    const W = canvasEstudio.width;
    const H = canvasEstudio.height;
    const src = bufferBaseSinNitidez.data;
    const imgData = ctxEstudio.createImageData(W, H);
    const dst = imgData.data;
    const fuerza = (filtroNitidezValor / 100) * 0.65;

    for (let y = 0; y < H; y++) {
        const fila = y * W;
        const filaArriba = (y > 0 ? y - 1 : y) * W;
        const filaAbajo = (y < H - 1 ? y + 1 : y) * W;

        for (let x = 0; x < W; x++) {
            const idx = (fila + x) * 4;
            const a = src[idx + 3];

            if (a === 0) {
                dst[idx + 3] = 0;
                continue;
            }

            const xIzq = x > 0 ? x - 1 : x;
            const xDer = x < W - 1 ? x + 1 : x;

            const idxArriba = (filaArriba + x) * 4;
            const idxAbajo = (filaAbajo + x) * 4;
            const idxIzq = (fila + xIzq) * 4;
            const idxDer = (fila + xDer) * 4;

            for (let c = 0; c < 3; c++) {
                const val = src[idx + c];
                const up = src[idxArriba + 3] > 0 ? src[idxArriba + c] : val;
                const down = src[idxAbajo + 3] > 0 ? src[idxAbajo + c] : val;
                const left = src[idxIzq + 3] > 0 ? src[idxIzq + c] : val;
                const right = src[idxDer + 3] > 0 ? src[idxDer + c] : val;

                const laplaciano = (val * 4) - up - down - left - right;
                const res = val + (laplaciano * fuerza);
                dst[idx + c] = res < 0 ? 0 : (res > 255 ? 255 : res);
            }
            dst[idx + 3] = a;
        }
    }
    ctxEstudio.putImageData(imgData, 0, 0);
};

window.ejecutarAutoRecorteTransparente = function() {
    if (!ctxEstudio || !canvasEstudio) return;

    const W = canvasEstudio.width;
    const H = canvasEstudio.height;
    const data = ctxEstudio.getImageData(0, 0, W, H).data;

    let minX = W, minY = H, maxX = 0, maxY = 0;
    let pixelesDetectados = false;

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const alpha = data[(y * W + x) * 4 + 3];
            if (alpha > 10) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                pixelesDetectados = true;
            }
        }
    }

    if (!pixelesDetectados) {
        mostrarToast("La imagen esta completamente transparente.", "error");
        return;
    }

    minX = Math.max(0, minX - 2);
    minY = Math.max(0, minY - 2);
    maxX = Math.min(W - 1, maxX + 2);
    maxY = Math.min(H - 1, maxY + 2);

    const cW = (maxX - minX) + 1;
    const cH = (maxY - minY) + 1;

    const recortado = ctxEstudio.getImageData(minX, minY, cW, cH);
    canvasEstudio.width = cW;
    canvasEstudio.height = cH;
    ctxEstudio.putImageData(recortado, 0, 0);

    const badgeDim = document.getElementById('estudio-resolucion-badge');
    if (badgeDim) badgeDim.innerText = cW + ' x ' + cH + ' px';

    guardarSnapshotEstudio();
    emitirTono('EXITO');
    mostrarToast("Margenes recortados.", "info", 1500);
};

function coordsEnCanvasEstudio(clientX, clientY) {
    const rect = canvasEstudio.getBoundingClientRect();
    const escalaX = canvasEstudio.width / rect.width;
    const escalaY = canvasEstudio.height / rect.height;
    return {
        x: Math.max(0, Math.min(canvasEstudio.width, Math.floor((clientX - rect.left) * escalaX))),
        y: Math.max(0, Math.min(canvasEstudio.height, Math.floor((clientY - rect.top) * escalaY)))
    };
}

function actualizarOverlayRecorteEstudio(clientX, clientY) {
    if (!overlayCropEstudio || !viewportCanvas) return;
    const wrapRect = viewportCanvas.getBoundingClientRect();
    const canvasRect = canvasEstudio.getBoundingClientRect();

    const c1x = (cropStartX / canvasEstudio.width) * canvasRect.width + canvasRect.left;
    const c1y = (cropStartY / canvasEstudio.height) * canvasRect.height + canvasRect.top;
    const c2x = (cropEndX / canvasEstudio.width) * canvasRect.width + canvasRect.left;
    const c2y = (cropEndY / canvasEstudio.height) * canvasRect.height + canvasRect.top;

    const minX = Math.min(c1x, c2x) - wrapRect.left + viewportCanvas.scrollLeft;
    const minY = Math.min(c1y, c2y) - wrapRect.top + viewportCanvas.scrollTop;
    const w = Math.abs(c1x - c2x);
    const h = Math.abs(c1y - c2y);

    overlayCropEstudio.style.left = minX + 'px';
    overlayCropEstudio.style.top = minY + 'px';
    overlayCropEstudio.style.width = w + 'px';
    overlayCropEstudio.style.height = h + 'px';
    overlayCropEstudio.style.display = (w > 5 && h > 5) ? 'block' : 'none';
}

window.rotarCanvasEstudio = function(grados) {
    hornearFiltrosEnPixels();

    const temp = document.createElement('canvas');
    temp.width = canvasEstudio.width;
    temp.height = canvasEstudio.height;
    temp.getContext('2d').drawImage(canvasEstudio, 0, 0);

    canvasEstudio.width = temp.height;
    canvasEstudio.height = temp.width;

    ctxEstudio.save();
    ctxEstudio.translate(canvasEstudio.width / 2, canvasEstudio.height / 2);
    ctxEstudio.rotate((grados * Math.PI) / 180);
    ctxEstudio.drawImage(temp, -temp.width / 2, -temp.height / 2);
    ctxEstudio.restore();

    const badgeDim = document.getElementById('estudio-resolucion-badge');
    if (badgeDim) badgeDim.innerText = String(canvasEstudio.width) + ' x ' + String(canvasEstudio.height) + ' px';

    guardarSnapshotEstudio();
    emitirTono('EXITO');
};

window.ejecutarRecorteManualEstudio = function() {
    hornearFiltrosEnPixels();

    const x = Math.min(cropStartX, cropEndX);
    const y = Math.min(cropStartY, cropEndY);
    const w = Math.abs(cropEndX - cropStartX);
    const h = Math.abs(cropEndY - cropStartY);

    if (w < 8 || h < 8) return;

    const recortado = ctxEstudio.getImageData(x, y, w, h);
    canvasEstudio.width = w;
    canvasEstudio.height = h;
    ctxEstudio.putImageData(recortado, 0, 0);

    const badgeDim = document.getElementById('estudio-resolucion-badge');
    if (badgeDim) badgeDim.innerText = String(w) + ' x ' + String(h) + ' px';

    desactivarModoCropEstudio();
    guardarSnapshotEstudio();
    emitirTono('EXITO');
};

export function exportarCanvasAWebPBlob(calidad) {
    const cal = (typeof calidad === 'number') ? calidad : 0.82;
    return new Promise(function(resolve) {
        if (!canvasEstudio) return resolve(null);
        canvasEstudio.toBlob(function(blob) {
            resolve(blob);
        }, 'image/webp', cal);
    });
}
window.exportarCanvasAWebPBlob = exportarCanvasAWebPBlob;

window.descargarWebPDesdeEstudio = async function() {
    hornearFiltrosEnPixels();
    const blob = await exportarCanvasAWebPBlob(0.82);
    if (!blob) {
        mostrarToast("No fue posible generar el archivo WebP.", "error");
        return;
    }
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(blob);
    enlace.download = 'geokatu_canvas_' + Date.now() + '.webp';
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    URL.revokeObjectURL(enlace.href);
    emitirTono('EXITO');
    mostrarToast("Imagen WebP descargada (< 120 KB).", "exito");
};

window.acoplarImagenEditadaAProducto = async function() {
    if (!AppState.comercioActivo) {
        mostrarToast("No hay comercio seleccionado en el Drawer.", "error");
        return;
    }

    hornearFiltrosEnPixels();

    const blobWebp = await exportarCanvasAWebPBlob(0.82);
    if (!blobWebp) {
        mostrarToast("Error codificando imagen en WebP.", "error");
        return;
    }

    const previewUrl = URL.createObjectURL(blobWebp);

    if (rolSeleccionadoEstudio === 'producto') {
        const inputNombre = document.getElementById('estudio-prod-nombre');
        const inputPrecio = document.getElementById('estudio-prod-precio');
        const inputCat = document.getElementById('estudio-prod-categoria');
        const inputDesc = document.getElementById('estudio-prod-desc');

        const nombreFinal = (inputNombre && inputNombre.value.trim()) 
            ? inputNombre.value.trim() 
            : (textoSeleccionadoDespiece || "Producto Catalogo");

        const precioFinal = (inputPrecio && inputPrecio.value) 
            ? (parseFloat(inputPrecio.value) || 0) 
            : (precioSeleccionadoDespiece || 0);

        const categoriaFinal = (inputCat && inputCat.value.trim()) 
            ? inputCat.value.trim() 
            : (AppState.comercioActivo.nicho || AppState.comercioActivo.categoria || "General");

        const descFinal = (inputDesc && inputDesc.value.trim()) 
            ? inputDesc.value.trim() 
            : (descSeleccionadaDespiece || "");

        registrarCategoriaGlobalCatalogo(categoriaFinal);

        const nuevoSKU = {
            codigo_barras: 'WEB_' + Date.now().toString().slice(-6),
            nombre: nombreFinal,
            categoria: categoriaFinal,
            precio: precioFinal,
            stock_actual: 10,
            imagen: previewUrl,
            archivoBlob: blobWebp,
            cuerpo_texto: descFinal,
            cuerpo_articulo: descFinal,
            en_piso_venta: true,
            subido_storage: false,
            fecha_creacion: new Date().toISOString()
        };

        if (!AppState.comercioActivo.catalogo) AppState.comercioActivo.catalogo = [];
        AppState.comercioActivo.catalogo.unshift(nuevoSKU);
        AppState.guardarColaLocal();
        renderizarListaSkusDrawer();
        subirFotoAStorageEnSegundoPlano(nuevoSKU, AppState.comercioActivo.id);

        mostrarToast('Producto "' + nombreFinal + '" acoplado al catalogo.', 'exito');
    } else {
        const campo = rolSeleccionadoEstudio;
        AppState.comercioActivo[campo] = previewUrl;
        actualizarPreviewsIdentidadUI();
       if (campo === 'link_pin' || campo === 'logo') {
            actualizarPinDrawerLive();
        }
        subirFotoIdentidadStorage(blobWebp, campo, AppState.comercioActivo.id).then(function(urlSubida) {
            if (urlSubida && AppState.comercioActivo) {
                AppState.comercioActivo[campo] = urlSubida;
                AppState.guardarColaLocal();
            }
        });
        AppState.guardarColaLocal();
        mostrarToast('Identidad "' + campo + '" actualizada con éxito.', 'exito');

    }

    if (indiceActualEstudio !== -1 && coleccionImagenesDespiece[indiceActualEstudio]) {
        coleccionImagenesDespiece[indiceActualEstudio].dataUrlActual = previewUrl;
        const thumb = document.getElementById('thumb-extraida-' + indiceActualEstudio);
        if (thumb) thumb.src = previewUrl;
    }

    emitirTono('EXITO');
    cerrarEstudioCanvas();
};




