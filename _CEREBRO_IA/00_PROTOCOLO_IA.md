# ⚙️ PROTOCOLO OPERATIVO DEL ECOSISTEMA (GEOKATU OS / IA ENGINE)

Este documento rige la interacción estricta entre la Inteligencia Artificial y el código fuente de **GEOKATU**, utilizando el sistema de archivos local (`_CEREBRO_IA/`) como memoria persistente, ancla contextual y única fuente de la verdad técnica.

---

## FASE 1: ARQUITECTURA DEL CONTEXTO (FILESYSTEM COMO PROMPT)

1. **La Carpeta es el Prompt:**
   - La ubicación desde donde se gestionan los módulos define el marco mental de trabajo. 
   - Queda prohibido mezclar lógicas de infraestructura o reglas (`firestore.rules`, `core-db.js`) con capas de presentación (`pines.css`, `ui-estilos.css`) en la misma solicitud salvo interdependencia crítica.

2. **Andamiaje Estándar (`_CEREBRO_IA/`):**
   Toda intervención técnica se sustenta en la estructura visible en el gestor de archivos:
   - `00_PROTOCOLO_IA.md`: Este manifiesto de reglas y disciplina operativa.
   - `01_CONTEXTO_ACTUAL.md`: Estado vigente de la arquitectura, esquema Firestore y módulos activos.
   - `02_BITACORA_ERRORES.md`: Registro forense de fallos críticos resueltos, causas raíz y decisiones inmutables.
   - `03_ROADMAP.md`: Ruta secuencial de sprints, requerimientos funcionales y pasos lógicos.
   - `04_BOVEDA_PROMPTS.md`: Búnker de prompts maestros reutilizables de alta precisión.
   - `INDICE_ARQUITECTURA.txt`: Mapa relacional de dependencias entre HTML, motores JS y hojas de estilo.

3. **Data Propietaria Inmutable:**
   - El valor estratégico de GEOKATU reside en estos archivos Markdown, no en la memoria volátil o temporal de una sesión de chat.

---

## FASE 2: DISCIPLINA DE SESIÓN (BUCLE QUIRÚRGICO DE TRABAJO)

1. **Apertura de Sesión (Context Injection):**
   - Abrir una sesión limpia para cada CUJ, sprint o requerimiento aislado.
   - Inyectar el bloque pertinente de `01_CONTEXTO_ACTUAL.md` y delimitar un único objetivo operativo.

2. **Regla de Oro: Cero Regeneraciones de Archivos Completos:**
   - La IA tiene estrictamente prohibido reescribir documentos enteros (`.html`, `.js`, `.css`).
   - Toda alteración debe entregarse bajo el protocolo quirúrgico estricto:
     ```text
     BUSCAR ESTE BLOQUE EXACTO:
     [código literal existente en Acode]

     REEMPLAZARLO POR:
     [código sustituto probado y validado]
     ```

3. **Cierre de Sesión y Transferencia (Wrap-Up):**
   - Antes de cerrar o reiniciar una ventana de trabajo, exigir un resumen de cambios (errores prevenidos, variables añadidas y mutaciones de esquema).
   - Volcar este reporte inmediatamente en `02_BITACORA_ERRORES.md`.

---

## FASE 3: AUDITORÍA DE MODELO Y REVENUE (BILLING GUARD)

1. **Inspección de Cuotas Fiscales:**
   - Toda intervención sobre `core-db.js`, `pos.js` o `boveda-comercio.html` debe respetar el modelo freemium de **1.300 facturas de bienvenida**.
   - Ninguna función de venta puede omitir la verificación preventiva (`BillingGuard`) ni el incremento atómico en `facturacion_control.facturas_emitidas_mes`.

2. **Aislamiento Multi-Sede y WMS:**
   - Todo identificador espacial debe estructurarse bajo la nomenclatura canónica:
     `GEO-{idNegocio}-{idSede}-{idMueble}-{cara}-{nivel}-{bin}`.
   - Queda prohibido hardcodear sedes estáticas en llamadas a `Planos_Almacenes`.

---

## FASE 4: PERÍMETRO DE SEGURIDAD (ZERO TRUST & REGLAS)

1. **Aislamiento de Sesión:**
   - La IA simula contexto pero carece de memoria global; opera como un contenedor aislado.
   - Toda llamada en terminales físicas debe desacoplar el UID del dueño respecto al UID del operario autenticado (`isEmployeeOf`).

2. **Sanitización de Salidas y Aborto Inmediato:**
   - Si un bloque "BUSCAR" propuesto por la IA difiere en una sola coma, salto de línea o indentación respecto al editor local en Termux/Acode, **la modificación se aborta de inmediato**.
   - No se aplican suposiciones en caliente sobre el código de producción.
