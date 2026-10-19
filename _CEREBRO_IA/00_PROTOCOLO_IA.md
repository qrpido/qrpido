# ⚙️ PROTOCOLO OPERATIVO DEL ECOSISTEMA (GEOKATU OS / IA ENGINE)
Este documento rige la interacción estricta entre la Inteligencia Artificial y el código fuente de **GEOKATU**, utilizando el sistema de archivos local (`_CEREBRO_IA/`) como memoria persistente, ancla contextual y única fuente de la verdad técnica.

---

## FASE 1: ARQUITECTURA DEL CONTEXTO (FILESYSTEM COMO PROMPT)
1. **La Carpeta es el Prompt:**
   - La ubicación desde donde se gestionan los módulos define el marco mental de trabajo.
   - Queda prohibido mezclar lógicas de infraestructura o persistencia (`firestore.rules`, `core-db.js`, `IndexedDB`) con capas de presentación (`pines.css`, `ui-estilos.css`, `admin-boveda.css`) en la misma solicitud salvo interdependencia crítica documentada.
2. **Andamiaje Estándar (`_CEREBRO_IA/`):**
   Toda intervención técnica se sustenta en la estructura visible en el gestor de archivos:
   - `00_PROTOCOLO_IA.md`: Este manifiesto de reglas y disciplina operativa.
   - `01_CONTEXTO_ACTUAL.md`: Estado vigente de la arquitectura, esquema Firestore, almacenamiento local y módulos activos.
   - `02_BITACORA_ERRORES.md`: Registro forense de fallos críticos resueltos, causas raíz y decisiones inmutables.
   - `03_ROADMAP.md`: Ruta secuencial de sprints, requerimientos funcionales y fases de despliegue territorial.
   - `04_BOVEDA_PROMPTS.md`: Búnker de prompts maestros reutilizables de alta precisión.
   - `INDICE_ARQUITECTURA.txt`: Mapa relacional de dependencias entre HTML, motores JS y hojas de estilo.
3. **Mandato de Independencia Total (Cero Dependencias Externas):**
   - Todo cálculo geométrico, criptográfico, óptico o geoespacial (Geohash Base32, proyección oblicua 3D Cabinet, generación de códigos de barras Code-128B, cuantización cromática y edición de imágenes en Canvas 2D) debe ejecutarse con algoritmos matemáticos nativos en Vanilla JS.
   - Queda estrictamente prohibido importar librerías de CDNs de terceros (`jsdelivr`, `unpkg`, `cdnjs`) que comprometan la operatividad en modo avión.

---

## FASE 2: DISCIPLINA DE SESIÓN (BUCLE QUIRÚRGICO DE TRABAJO)
1. **Apertura de Sesión (Context Injection):**
   - Abrir una sesión limpia para cada CUJ, sprint o requerimiento aislado.
   - Inyectar el bloque pertinente de `01_CONTEXTO_ACTUAL.md` y delimitar un único objetivo operativo.
2. **Regla de Oro: Cero Regeneraciones de Archivos Completos de Código:**
   - La IA tiene estrictamente prohibido reescribir documentos enteros de código (`.html`, `.js`, `.css`), salvo creación de un módulo nuevo desde cero.
   - Toda alteración debe entregarse bajo el protocolo quirúrgico estricto compatible con Google Docs y Acode:
     ```text
     BUSCAR ESTE BLOQUE EXACTO:
     [código literal existente]
     BORRAR Y REEMPLAZAR POR:
     [código sustituto probado y validado sin sintaxis ${} compleja que corrompa Docs]
     ```
3. **Compatibilidad con Flujo Google Docs -> Acode:**
   - Evitar enlaces Markdown automáticos dentro de cadenas de `import` (ej. usar `'./core-db.js'` plano) y preferir concatenación clásica de strings cuando se edite en documentos intermedios.
   - Usar siempre rutas limpias (`cleanUrls: true`) sin extensión `.html` en redirecciones y enlaces internos (`/pos`, `/oficina`, `/stock`, `/inventario`, `/mapatienda`, `/negocio`).
4. **Cierre de Sesión y Transferencia (Wrap-Up):**
   - Antes de cerrar o reiniciar una ventana de trabajo, exigir un resumen de cambios (errores prevenidos, variables añadidas y mutaciones de esquema).
   - Volcar este reporte inmediatamente en `02_BITACORA_ERRORES.md`.

---

## FASE 3: AUDITORÍA DE MODELO, REVENUE Y CONSISTENCIA TRANSVERSAL
1. **Inspección de Cuotas Fiscales (`BillingGuard`):**
   - Toda intervención sobre `core-db.js`, `pos.js` u `oficina.js` debe respetar el modelo freemium de **1.300 facturas de bienvenida**.
   - Ninguna función de venta puede omitir la verificación preventiva (`BillingGuard`) ni el incremento atómico en `facturacion_control.facturas_emitidas_mes`.
2. **Estandarización de Seguridad con `AuthGate` (`auth-gate.js`):**
   - Todos los módulos operativos (`oficina`, `pos`, `stock`, `inventario`, `mapatienda`) se rigen bajo el búnker unificado `AuthGate`:
     - Bloqueo automático a los **10 minutos de inactividad** con teclado PIN numérico en pantalla.
     - **Relevo en caliente por PIN (4 dígitos)** entre operarios sin perder el estado de la pantalla ni cerrar la sesión maestra.
     - Validación de **horarios laborales** y **captura obligatoria de coordenadas GPS** al abrir turno (asentando alerta en `Alertas_Seguridad` si ingresa fuera de turno).
     - Resolución **Multi-Tenant** para usuarios que son dueños de su propio negocio y a la vez operarios en otro comercio.
3. **Aislamiento Multi-Sede y WMS Espacial:**
   - Todo identificador espacial debe estructurarse bajo la nomenclatura canónica:
     - Mueble: `GEO-M-{idNegocio}-{idSede}-{idMueble}`
     - Compartimiento (Bin): `GEO-P-{idNegocio}-{idSede}-{idMueble}-{cara}-{nivel}-{bin}`
4. **Privacidad por Defecto (Privacy by Default):**
   - Los consumidores navegan y compran de forma 100% anónima.
   - El correo electrónico de registro del comerciante se almacena en `correo_interno` y permanece **oculto al público por defecto** tanto en `Directorio` como en `Directorio_Contacto`, exponiéndose únicamente si el titular activa explícitamente `mostrar_correo_publico: true`.

---

## FASE 4: PERÍMETRO DE SEGURIDAD Y CERO LECTURAS INNECESARIAS (ZERO-READS)
1. **Filosofía 0-ms Offline-First:**
   - Toda vista debe hidratarse en `0 ms` desde `IndexedDB` / `localStorage` (`directorio_matriz.json`, `catalogo_matriz.json`, cachés de catálogo y planos).
   - Queda prohibido descargar colecciones completas de Firestore si existe caché local; las actualizaciones deben operar estrictamente por **Deltas de Timestamp** (`fecha_actualizacion > ultimoSync`) o validación de versión (`catalogo_version`).
2. **Sanitización de Salidas y Aborto Inmediato:**
   - Si un bloque "BUSCAR" propuesto por la IA difiere respecto al archivo fuente, **la modificación se aborta de inmediato** hasta verificar el archivo real.


