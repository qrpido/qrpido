/**
 * GEOKATU ONBOARDING & GUIDED TOUR ENGINE
 * Archivo: geokatu-tour.js
 * Cero dependencias externas. Auto-inyectable en cualquier módulo (POS, Oficina, WMS, Radar, SIG).
 */

(function (window) {
    'use strict';

    // 1. Inyección Dinámica de Estilos UI (Glassmorphic, Resaltador y Tooltips)
    function inyectarEstilosTour() {
        if (document.getElementById('gk-tour-estilos')) return;
        const style = document.createElement('style');
        style.id = 'gk-tour-estilos';
        style.textContent = `
            .gk-tour-backdrop {
                position: fixed;
                inset: 0;
                background: rgba(10, 10, 14, 0.78);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                z-index: 999990;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.25s ease-in-out;
            }
            .gk-tour-backdrop.activo {
                opacity: 1;
                pointer-events: auto;
            }
            .gk-tour-target-highlight {
                position: relative !important;
                z-index: 999995 !important;
                box-shadow: 0 0 0 4px #ff6b00, 0 0 25px rgba(255, 107, 0, 0.6) !important;
                border-radius: 12px;
                transition: box-shadow 0.25s ease;
                pointer-events: auto !important;
            }
            .gk-tour-card {
                position: fixed;
                z-index: 1000000;
                background: rgba(20, 20, 26, 0.98);
                border: 1.5px solid var(--naranja, #ff6b00);
                border-radius: 16px;
                padding: 16px;
                width: calc(100vw - 36px);
                max-width: 330px;
                box-shadow: 0 16px 40px rgba(0, 0, 0, 0.9), 0 0 20px rgba(255, 107, 0, 0.2);
                color: #ffffff;
                box-sizing: border-box;
                opacity: 0;
                transform: translateY(8px);
                transition: opacity 0.2s ease, transform 0.2s ease;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            .gk-tour-card.activo {
                opacity: 1;
                transform: translateY(0);
            }
            .gk-tour-paso-badge {
                font-size: 9.5px;
                font-weight: 900;
                color: var(--naranja, #ff6b00);
                text-transform: uppercase;
                letter-spacing: 0.8px;
                margin-bottom: 4px;
                display: block;
            }
            .gk-tour-titulo {
                margin: 0 0 6px 0;
                font-size: 13.5px;
                font-weight: 800;
                color: #ffffff;
            }
            .gk-tour-cuerpo {
                margin: 0 0 14px 0;
                font-size: 11.5px;
                color: #b5b5be;
                line-height: 1.4;
            }
            .gk-tour-acciones {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
            }
            .gk-tour-btn-omitir {
                background: transparent;
                border: none;
                color: #888892;
                font-size: 11px;
                font-weight: 700;
                cursor: pointer;
                padding: 6px;
            }
            .gk-tour-btn-sig {
                background: linear-gradient(135deg, #ff8c00 0%, #ff6b00 100%);
                border: none;
                color: #ffffff;
                font-size: 11px;
                font-weight: 900;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                padding: 8px 16px;
                border-radius: 10px;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(255, 107, 0, 0.35);
            }
        `;
        document.head.appendChild(style);
    }

        // 2. Diccionarios de Pasos Especializados por Cada Módulo
    const GUIAS_MODULOS = {
        'index': [
            {
                target: '#buscador-radar, input[type="search"], .buscador-flotante',
                titulo: 'Radar de Comercios',
                cuerpo: 'Busca tiendas, productos o servicios cercanos en el mapa de la ciudad en tiempo real.'
            },
            {
                target: '#btn-portal-mando, .btn-login',
                titulo: 'Llave Maestra',
                cuerpo: 'Desde aquí inicias sesión y accedes a tu Oficina Comercial, Caja y Tienda (POS/WMS) o Notaría.'
            },
            {
                target: '#map, .maplibregl-canvas',
                titulo: 'Explora los Pines',
                cuerpo: 'Toca cualquier pin del mapa para ver catálogo, horarios, WhatsApp directo o guardar en favoritos.'
            }
        ],
        'pos': [
            {
                target: '#btn-iniciar-camara',
                titulo: 'Escaneo Rápido de Cámara',
                cuerpo: 'Activa la cámara del dispositivo para leer códigos de barras de artículos al instante sin accesorios.'
            },
            {
                target: '#t-cajero-cod',
                titulo: 'Relevo de Operario',
                cuerpo: 'Toca aquí para pausar la terminal o cambiar de cajero con tu PIN personal de 4 dígitos en 0 ms.'
            },
            {
                target: '#btn-cobrar-accion',
                titulo: 'Cobro y Liquidación',
                cuerpo: 'Procesa pagos en efectivo con cálculo de cambio, transferencias Nequi/Daviplata o facturación DIAN.'
            }
        ],
        'oficina': [
            {
                target: '.oficina-kpi-grid',
                titulo: 'Tacómetros Táctiles',
                cuerpo: 'Toca cualquiera de los 4 cuadros para ver el desglose de ventas, comprobantes timbrados e incidencias en vivo.'
            },
            {
                target: '#tab-btn-equipo',
                titulo: 'Nómina y Horarios',
                cuerpo: 'Registra tus empleados, asígnales PIN de caja y define ventanas horarias con geolocalización GPS.'
            },
            {
                target: 'button[onclick*="inventario"]',
                titulo: 'Catálogo Áureo',
                cuerpo: 'Crea artículos con fotografía posterior, clasificaciones de merma y medidas por peso o volumen.'
            }
        ],
        'stock': [
            {
                target: '#selector-operacion',
                titulo: 'Modalidad Logística',
                cuerpo: 'Alterna entre Entrada de proveedores, Salidas por venta, Reubicación de estantes o Consulta rápida.'
            },
            {
                target: '#toggle-rafaga-wrapper',
                titulo: 'Modo Ráfaga Industrial',
                cuerpo: 'Habilita escaneo continuo para recepcionar cajas o paquetes en banda transportadora sin tocar la pantalla.'
            },
            {
                target: '#btn-abrir-selector-ubicacion',
                titulo: 'Fijación de Estantería',
                cuerpo: 'Escanea el QR del mueble o búscalo en la lista para que la mercancía quede ubicada en el plano SIG.'
            }
        ],
                'inventario': [
            {
                target: 'input[type="search"], #buscador-sku, .cad-buscador',
                titulo: 'Buscador Instantáneo WMS',
                cuerpo: 'Escribe un SKU, nombre o código de mueble (ej. PVT001) para iluminar su ubicación exacta en el plano.'
            },
            {
                target: '.cinta-capas, .cad-capas, [data-capa]',
                titulo: 'Capas y Heatmaps',
                cuerpo: 'Alterna entre Todos los muebles, Heatmap de stock o Estado de auditoría con un toque.'
            },
            {
                target: '#plano-contenedor, #lienzo-mapa, canvas',
                titulo: 'Toca Cualquier Góndola',
                cuerpo: 'Presiona un mueble para ver su ficha, abrir el alzado 2.5D o saltar directo a Stock.'
            }
        ],
        'mapatienda': [
            {
                target: '#btn-toggle-modo-edicion',
                titulo: 'Interruptor de Edición',
                cuerpo: 'Cambia a modo Edición para arrastrar góndolas con guías magnéticas inteligentes o ajustar perímetros.'
            },
            {
                target: '#btn-burbuja-mueble',
                titulo: 'Diseñador de Góndolas',
                cuerpo: 'Crea estantes configurando niveles, divisiones internas y caras independientes (frontal, posterior o cabeceras).'
            },
            {
                target: '#btn-burbuja-qrs',
                titulo: 'Generador de Señalética',
                cuerpo: 'Imprime las etiquetas QR para pegar físicamente en los compartimientos de tu negocio.'
            }
        ]
    };

    // 3. Clase Orquestadora
    class GeokatuTourEngine {
        constructor() {
            this.pasoActual = 0;
            this.pasos = [];
            this.claveStorage = '';
            this.moduloId = '';
            this.overlay = null;
            this.card = null;
        }

        iniciar(moduloId, forzar = false) {
            this.moduloId = moduloId;
                        this.claveStorage = 'geokatu_tour_' + moduloId + '_v2';

            if (!forzar && localStorage.getItem(this.claveStorage)) {
                return; // Ya completó el tour previamente
            }

            this.pasos = GUIAS_MODULOS[moduloId] || [];
            if (this.pasos.length === 0) return;

            inyectarEstilosTour();
            this._construirElementos();
            this.pasoActual = 0;
            this._renderizarPaso();
        }

        _construirElementos() {
            if (document.getElementById('gk-tour-backdrop-node')) {
                this.overlay = document.getElementById('gk-tour-backdrop-node');
                this.card = document.getElementById('gk-tour-card-node');
                return;
            }

            this.overlay = document.createElement('div');
            this.overlay.id = 'gk-tour-backdrop-node';
            this.overlay.className = 'gk-tour-backdrop';

            this.card = document.createElement('div');
            this.card.id = 'gk-tour-card-node';
            this.card.className = 'gk-tour-card';

            document.body.appendChild(this.overlay);
            document.body.appendChild(this.card);
        }

        _renderizarPaso() {
            this._limpiarResaltados();

            if (this.pasoActual >= this.pasos.length) {
                this.finalizar();
                return;
            }

                        const paso = this.pasos[this.pasoActual];
            const targetEl = paso.target ? document.querySelector(paso.target) : null;
            const esVisible = Boolean(targetEl && targetEl.offsetParent !== null);

            this.overlay.classList.add('activo');
            let leftCard = Math.max(16, (window.innerWidth - Math.min(330, window.innerWidth - 32)) / 2);
            let topCard = Math.max(80, Math.round((window.innerHeight - 190) / 2));

            if (esVisible) {
                targetEl.classList.add('gk-tour-target-highlight');
                const rect = targetEl.getBoundingClientRect();
                const margen = 12;
                topCard = rect.bottom + margen;
                if (topCard + 185 > window.innerHeight) {
                    topCard = Math.max(16, rect.top - 185 - margen);
                }
            }

            this.card.style.top = Math.round(topCard) + 'px';
            this.card.style.left = Math.round(leftCard) + 'px';

            const esUltimo = this.pasoActual === this.pasos.length - 1;
            this.card.innerHTML = `
                <span class="gk-tour-paso-badge">Paso ${this.pasoActual + 1} de ${this.pasos.length}</span>
                <h4 class="gk-tour-titulo">${paso.titulo}</h4>
                <p class="gk-tour-cuerpo">${paso.cuerpo}</p>
                <div class="gk-tour-acciones">
                    <button type="button" class="gk-tour-btn-omitir" onclick="window.GeokatuTour.finalizar()">Omitir</button>
                    <button type="button" class="gk-tour-btn-sig" onclick="window.GeokatuTour.siguiente()">
                        ${esUltimo ? 'Entendido' : 'Siguiente'}
                    </button>
                </div>
            `;

            this.card.classList.add('activo');
            if (navigator.vibrate) navigator.vibrate(20);
        }

        siguiente() {
            this.pasoActual++;
            this._renderizarPaso();
        }

        _limpiarResaltados() {
            document.querySelectorAll('.gk-tour-target-highlight').forEach(el => {
                el.classList.remove('gk-tour-target-highlight');
            });
            if (this.card) this.card.classList.remove('activo');
        }

        finalizar() {
            this._limpiarResaltados();
            if (this.overlay) this.overlay.classList.remove('activo');
            localStorage.setItem(this.claveStorage, 'true');
        }
    }

        window.GeokatuTour = new GeokatuTourEngine();

    // Auto-detección de módulo por ruta si la vista no lo invocó manualmente
    function detectarModuloActual() {
        const p = String(window.location.pathname || '').toLowerCase();
        if (p === '/' || p.endsWith('/index.html')) return 'index';
        if (p.includes('oficina')) return 'oficina';
        if (p.includes('mapatienda')) return 'mapatienda';
        if (p.includes('inventario')) return 'inventario';
        if (p.includes('stock')) return 'stock';
        if (p.includes('pos')) return 'pos';
        return '';
    }

    window.addEventListener('DOMContentLoaded', function () {
        const mod = detectarModuloActual();
        if (!mod) return;
        setTimeout(function () {
            if (!document.getElementById('gk-tour-backdrop-node') || !document.getElementById('gk-tour-backdrop-node').classList.contains('activo')) {
                window.GeokatuTour.iniciar(mod, false);
            }
        }, 900);
    });

})(window);

