# 🧠 Contexto General de GEOKATU B2B (Versión SaaS Autónoma)

**Proyecto:** Plataforma SaaS B2B/B2C de radar urbano, WMS retail georreferenciado y punto de venta POS con facturación electrónica y control fiscal preventivo.  
**Estrategia Actual de Producto:** Modelo SaaS de dos niveles (Freemium de 1.300 facturas de bienvenida y Planes Prepago de recarga mediante pasarela Wompi integrada). WMS espacial basado en planos de tiendas multi-sede y góndolas físicas de hasta 4 caras de exhibición (`GEO-{idNegocio}-{idSede}-{idMueble}-{cara}-{nivel}-{bin}`).

**Stack Tecnológico:** 
- **Frontend:** Vanilla JS, CSS nativo modularizado (`ui-estilos.css`, `admin-boveda.css`, `mapatienda.css`), MapLibre GL JS, PMTiles, HTML5-Qrcode.
- **Backend & Base de Datos:** Firebase v10 (Hosting, Firestore, RTDB, Auth, Cloud Functions), SDKs de geolocalización y pasarela Wompi Widget.
- **Entorno de Pruebas Base:** Cliente móvil Android de recursos acotados (<60MB RAM); terminal Alpine Linux con Acode para construcción y despliegue directo en GCP.

---

## 🏗️ Estado de la Arquitectura y Módulos Activos

1. **Frontend (Radar y Mapa Principal - `index.html`):**
   - Motor MapLibre optimizado con control de zoom semántico, marcadores SVG vectoriales con formas personalizadas (gotas, esferas, árboles, etc.) e inyección de portadas institucionales en formato WebP.
   - Píldora de semáforo operativo al pie del popup y separación geométrica de falange (~22px de margen flotante sobre el pin).
   - Sistema de filtros en cascada de cristal ("Explorar") para alternar entre Comercios, Inmuebles, Servicios y Flota Activa con renderizado híbrido de tarjetas.

2. **Bóveda Comercial y Catálogo (`boveda-comercio.html` & `negocio.html`):**
   - Onboarding guiado en fases para diseño de pines, paleta de marca y geolocalización interactiva.
   - Grilla de productos con 4 variantes editoriales (Grid, Hero 2 filas, Split de galería y Artículo/Editorial) con soporte de arrastrar y soltar (Drag & Drop) y persistencia secuencial del feed.
   - Edición in situ de perfiles y productos sin diálogos bloqueantes (`window.prompt`), sincronización con compresión automática a WebP en el cliente y soporte multi-sede (`SALA_VENTAS`, `BODEGA_CENTRAL`, etc.).

3. **Motor Espacial 2D y Editor de Góndolas (`mapatienda.html`):**
   - Viewport con paneo fluido y gestos multitáctil dual (pinch-to-zoom) con restricciones estrictas de escala mínima (`scaleMin`) y máxima (`scaleMax`).
   - Contra-rotación reactiva (`transform: rotate(-θdeg)`) en etiquetas, badges y controles de los estantes para mantener la legibilidad horizontal sin importar el ángulo cardinal de la góndola.
   - Arquitectura comercial basada en Caras de Exhibición (1 a 4 caras: Frontal A, Posterior B, Cabeceras C y D) con generación de códigos canónicos de bins (`GEO-P-{idMueble}-{cara}-{nivel}-{bin}`).

4. **Terminal POS y Control Fiscal (Billing Guard):**
   - Caja registradora nativa con soporte de pistola de códigos de barras, pesaje de báscula en vivo y Split Payments (Efectivo, Tarjeta, Nequi).
   - **Billing Guard (Modelo de Negocio):** Control preventivo de la cuota freemium (1.300 facturas mensuales). Muestra alertas sutiles en Zona Verde, proactivas en Zona Ámbar (1.000+ facturas) y bloqueantes en Zona Roja (1.300+ facturas sin saldo prepagado), conectando de inmediato con el modal de recarga vía Wompi.
   - Emisión de comprobantes y tirillas térmicas con soporte para Facturación Electrónica DIAN / CUFE o Contingencia Tipo 04.

5. **Seguridad y Reglas (`firestore.rules` & `core-db.js`):**
   - Arquitectura Zero-Trust con roles diferenciados para dueños (`isOwner`) y operarios/cajeros (`isEmployeeOf`).
   - Permisos de escritura atómicos en subcolecciones de inventario (`stock_ubicaciones`), ventas (`Ventas_POS`) y kardex de almacén.
   - Inyección de `tenantReal` para garantizar que las sucursales y terminales remotas impacten el inventario del comercio matriz correcto.

---

## ⚠️ Reglas de IA Activas (Protocolo de Asistencia Quirúrgica)

- **Cero Código Completo:** Prohibido reescribir archivos enteros.
- **Formato Estricto:** Toda intervención se realiza exclusivamente mediante:
  > BUSCA ESTE BLOQUE EXACTO...  
  > PÍSALO CON ESTO...  
- **Límite de Generación:** Nunca entregar bloques de código mayores a 500 líneas a menos que se trate de un archivo nuevo creado desde cero.
- **Estándar de Diseño:** Mantener variables en español (`--naranja`, --bg-oscuro, `--texto-base`) y optimización estricta para consumo de memoria en dispositivos móviles.
