# 🗺️ Hoja de Ruta QRpido

## Fase Actual: Telemetría, Retención y Modales
- [x] Ejecutar prueba de estrés y estabilizar motor gráfico (Logrado: 60 FPS, 9.5MB RAM estables).
- [x] Estandarizar Proporción Áurea en modales y limpiar sintaxis de Leaflet para evitar colapsos.
- [ ] **Desbloqueo de Catálogo:** Permitir siempre el acceso a `negocio.html` desde el mapa (Maximizar retención).
- [ ] **UX Inmuebles:** Agregar botón (X) y lógica de "Swipe Down" ligero para descartar las tarjetas.
- [ ] **UX Autenticación (Gestión de Credenciales):** Añadir botón para ver/ocultar contraseña en `index.html` y `admin.html`. Configurar etiquetas nativas para forzar el autocompletado, sugerencia de contraseñas seguras y el modal de "Guardar contraseña" de Chrome/Google.
- [ ] **Easter Egg V1 & V2:** Contador de taps (50 toques = Toast) y (100 toques = Sonata de Beethoven con mecánica de dispersión en GPU).

## Fase Siguiente: Catálogos y Carrito
- [ ] Inyectar "Burbuja Magnética" de telemetría (Micro-Profiler) en `negocio.html` e `inmueble.html`.
- [ ] **Lógica de Horarios en Catálogo:** Texto "CERRADO. ABRE A LAS [X] horas" debajo de la categoría.
- [ ] **Carrito 24/7 (Beneficio Oculto B2B):** Permitir agregar al carrito en cualquier momento (persistencia en `localStorage`).
- [ ] **Bloqueo de Checkout:** Deshabilitar ÚNICAMENTE el botón de "Pedir por WhatsApp" fuera de horario.

## Fase Arquitectura de Jerarquías: Cerebro Central y Moderación
- [ ] **Reglas de Seguridad (Firestore):** Programar acceso jerárquico. Moderadores limitados por cuadrante geográfico; permisos de borrado (`delete`) exclusivos para el Superadmin.
- [ ] **Módulo Moderador (`moderacion.html`):** Habilitar función de *Soft-Delete* (Cambiar estado para deshabilitar/ocultar tiendas del mapa público, sin borrarlas).
- [ ] **Cerebro Central (`qrpido.html`):** Activar panel de gestión global para visualizar todos los negocios de la plataforma.
- [ ] **Auditoría Interna:** Implementar registro de actividad (Logs) en el Cerebro Central para auditar qué negocios aprueban, editan o deshabilitan los moderadores en tiempo real.
- [ ] **Hard-Delete:** Habilitar botón de borrado definitivo de la base de datos (Exclusivo Superadmin).

## Fase Futura: Modularización y Backend
- [ ] Extraer el CSS del `index.html` hacia `ui-estilos.css`.
- [ ] Extraer la lógica de sesión hacia `auth-mando.js`.
- [ ] Extraer el motor del mapa hacia `motor-mapa.js`.
- [ ] Desarrollar módulo de domiciliarios (`domiciliarios.html`).

## Fase 4: Monetización Paralela (Proyecto Academia)
*Nota: Fase bloqueada hasta validar QRpido con métricas reales.*
- [ ] **Estructura de la Academia:** Crear `academia.html`. Incrustar pestaña en el carrusel.
- [ ] **Producto Core:** Curso en video sobre PWAs con Firebase (Screen recording).
- [ ] **Modelo de Negocio:** 15 cupos x 1.000.000 COP. Mentoría y garantía de resultados.
