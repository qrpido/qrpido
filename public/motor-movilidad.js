/**
 * ============================================================================
 * 🚁 GEOKATU - MOTOR DE MOVILIDAD P2P Y EMERGENCIAS (REAL-TIME)
 * ============================================================================
 * Este módulo se encarga de escuchar los cambios en tiempo real de cualquier
 * unidad móvil (domiciliarios, transporte, ambulancias, policías) y renderizarlos
 * en el mapa público de forma fluida usando interpolación y aceleración GPU.
 */

import GeokatuDB from './core-db.js';

class MotorMovilidad {
    constructor() {
        this.mapa = null;
        this.marcadoresFlota = {}; // Diccionario para rastrear los pines activos en el mapa
        this.listenersActivos = {}; // Para poder apagar la escucha si el usuario oculta una capa
        
        // Diccionario base: Mapea el tipo de unidad con su clase CSS (del archivo pines.css)
        this.diccionarioVisual = {
            'domiciliario': 'pin-g', // Engranajes o ruedas
            'transporte': 'pin-h',   // Estela de velocidad (Buses/Taxis)
            'ambulancia': 'pin-i',   // Sirenas Roja/Azul
            'policia': 'pin-i',      // Sirenas Roja/Azul (Podemos inyectar variables de color distintas luego)
            'defecto': 'pin-1'       // Pin básico por si hay un tipo desconocido
        };
    }

    /**
     * Inicializa el motor vinculándolo a la instancia del mapa de MapLibre
     * @param {Object} mapaInstancia - El mapa global (ej. window.mapaQrpido)
     */
    inicializar(mapaInstancia) {
        if (!mapaInstancia) {
            console.error("🛑 Motor Movilidad: Mapa no encontrado.");
            return;
        }
        this.mapa = mapaInstancia;
        console.log("🚁 Motor Movilidad P2P: Inicializado y anclado al mapa.");

        // 1. Iniciar la escucha de estilos dinámicos (Para crear nuevos pines en el futuro sin actualizar app)
        this.escucharEstilosDinamicos();

        // 2. Encender los radares por defecto (Ej: domiciliarios siempre visibles)
        // Las emergencias se pueden activar condicionalmente
        this.encenderRadar('domiciliarios');
        this.encenderRadar('emergencias'); 
    }

    /**
     * Escucha la base de datos para inyectar CSS nuevo creado por el Súper Usuario
     */
    escucharEstilosDinamicos() {
        // Asumiendo que GeokatuDB tiene un método para escuchar Firebase Realtime Database
        GeokatuDB.RealtimeService.escucharRuta('sistema/configuracion/pines_dinamicos', (cssDinamico) => {
            if (!cssDinamico) return;
            let styleTag = document.getElementById('estilos-pines-dinamicos');
            if (!styleTag) {
                styleTag = document.createElement('style');
                styleTag.id = 'estilos-pines-dinamicos';
                document.head.appendChild(styleTag);
            }
            styleTag.innerHTML = window.sanitizarTexto(cssDinamico);
            console.log("🎨 Motor Movilidad: Estilos dinámicos inyectados.");
        });
    }

    /**
     * Enciende el radar para una categoría específica de vehículos
     * @param {String} categoria - 'domiciliarios', 'emergencias', 'transporte'
     */
    encenderRadar(categoria) {
        if (this.listenersActivos[categoria]) return; // Ya está encendido

        console.log(`📡 Encendiendo radar para: ${categoria}`);
        
        // Se conecta a la rama de Firebase correspondiente (ej. /flota_activa/emergencias)
        this.listenersActivos[categoria] = GeokatuDB.RealtimeService.escucharRama(`flota_activa/${categoria}`, (snapshot) => {
            const unidades = snapshot.val() || {};
            
            // 1. Actualizar o crear unidades que llegaron
            Object.keys(unidades).forEach(idUnidad => {
                this.procesarUnidad(idUnidad, unidades[idUnidad]);
            });

            // 2. Limpiar unidades que se desconectaron (ya no están en el snapshot)
            Object.keys(this.marcadoresFlota).forEach(idActivo => {
                if (this.marcadoresFlota[idActivo].categoria === categoria && !unidades[idActivo]) {
                    this.eliminarUnidad(idActivo);
                }
            });
        });
    }

    /**
     * Apaga un radar específico para ahorrar batería/datos
     */
    apagarRadar(categoria) {
        if (this.listenersActivos[categoria]) {
            GeokatuDB.RealtimeService.detenerEscucha(`flota_activa/${categoria}`);
            delete this.listenersActivos[categoria];
            
            // Borrar los pines de esa categoría del mapa
            Object.keys(this.marcadoresFlota).forEach(idActivo => {
                if (this.marcadoresFlota[idActivo].categoria === categoria) {
                    this.eliminarUnidad(idActivo);
                }
            });
            console.log(`🔇 Radar apagado para: ${categoria}`);
        }
    }

    /**
     * Procesa la información de una unidad, valida reglas legales y la dibuja/mueve
     */
    procesarUnidad(idUnidad, datos) {
        // =========================================================
        // 🛡️ REGLAS DE CUMPLIMIENTO Y VALIDACIÓN (NORMATIVAS)
        // =========================================================
        // Si no está activo, o su verificación caducó, ignoramos silenciosamente.
        if (datos.estado !== 'activo') return this.eliminarUnidad(idUnidad);
        if (datos.emergencia && !datos.verificado_ong) return this.eliminarUnidad(idUnidad); // Filtro anti-falsas alarmas
        
        const lat = parseFloat(datos.lat);
        const lng = parseFloat(datos.lng);
        if (isNaN(lat) || isNaN(lng)) return;

        // ¿Ya existe el marcador en el mapa?
        if (this.marcadoresFlota[idUnidad]) {
            // Mover fluidamente
            this.moverUnidad(idUnidad, lng, lat, datos.rumbo);
        } else {
            // Crear nuevo marcador
            this.crearUnidad(idUnidad, datos, lng, lat);
        }
    }

    /**
     * Crea el elemento HTML del pin y lo inyecta en MapLibre
     */
    crearUnidad(idUnidad, datos, lng, lat) {
        // Determinar la clase CSS visual
        const claseVisual = this.diccionarioVisual[datos.tipo_vehiculo] || this.diccionarioVisual['defecto'];
        const esEmergencia = (datos.tipo_vehiculo === 'ambulancia' || datos.tipo_vehiculo === 'policia');

        // Construir el HTML
        const el = document.createElement('div');
        el.className = `pin-wrapper ${claseVisual}`;
        // Transición CSS crucial para que el pin se deslice por la calle y no teletransporte
        el.style.transition = "transform 1.2s linear"; 
        
        // Si tiene imagen/logo del conductor o entidad, la ponemos
        if (datos.imagen_url) {
            el.innerHTML = `<img src="${window.sanitizarURL(datos.imagen_url)}" class="pin-img" onerror="window.imagenRotaToGlass(this, 'USR')">`;
        }

        // Si es emergencia crítica, forzamos un z-index altísimo para que se vea sobre todo
        if (esEmergencia) {
            el.style.zIndex = 9999;
            el.style.transform = "scale(1.2)"; // Hacerlo más notorio
        }

        // Crear el marcador de MapLibre
        const marcador = new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([lng, lat])
            .addTo(this.mapa);

        // Interactividad: Si tocan la unidad, mostramos el bottom-sheet con su info
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof window.abrirInfoUnidad === 'function') {
                window.abrirInfoUnidad(datos); // Función global definida en index.html
            }
        });

        // Guardar en el estado interno
        this.marcadoresFlota[idUnidad] = {
            marcador: marcador,
            elementoDOM: el,
            categoria: datos.categoria_escucha // ej: 'emergencias'
        };
    }

    /**
     * Actualiza la posición de una unidad existente
     */
    moverUnidad(idUnidad, lng, lat, rumbo) {
        const unidad = this.marcadoresFlota[idUnidad];
        if (!unidad) return;

        // Actualizar coordenadas en MapLibre
        unidad.marcador.setLngLat([lng, lat]);

        // Si el vehículo reporta "rumbo" (dirección en grados), rotamos el icono interno
        if (rumbo !== undefined && rumbo !== null) {
            const img = unidad.elementoDOM.querySelector('.pin-img');
            if (img) {
                img.style.transform = `rotate(${rumbo}deg)`;
                img.style.transition = "transform 0.5s ease";
            }
        }
    }

    /**
     * Elimina el marcador del mapa si el vehículo se desconecta
     */
    eliminarUnidad(idUnidad) {
        if (this.marcadoresFlota[idUnidad]) {
            this.marcadoresFlota[idUnidad].marcador.remove();
            delete this.marcadoresFlota[idUnidad];
        }
    }
}

// Exportar como Singleton para que toda la app use el mismo motor
const motorMovilidadInstancia = new MotorMovilidad();
export default motorMovilidadInstancia;

// Exponer globalmente la inicialización para el Bootloader de index.html
window.arrancarMotorMovilidad = function(mapaInstancia) {
    motorMovilidadInstancia.inicializar(mapaInstancia);
};
