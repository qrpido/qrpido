​⚙️ Protocolo Operativo del Ecosistema (Sistema Operativo IA)
​Este documento rige cómo la Inteligencia Artificial interactúa con el código fuente del proyecto QRpido, utilizando el sistema de archivos (Filesystem) como fuente de la verdad y memoria a largo plazo.
​FASE 1: Arquitectura del Contexto (El Filesystem)
​Ref: Joyitas 1, 2, 3 y 8 (El entorno instruye, el andamiaje estandariza y la data es la ventaja).
​La carpeta es el Prompt: La ubicación desde donde se envían los datos define el marco mental de la IA. No mezclar archivos de configuración (Firebase) con archivos de interfaz (CSS) en la misma solicitud a menos que sea estrictamente necesario.
​Andamiaje Estándar (Scaffold): Todo proyecto o módulo complejo debe tener su estructura de soporte en la carpeta _CEREBRO_IA/:
​00_PROTOCOLO_IA.md (Este documento).
​01_CONTEXTO_ACTUAL.md (Estado general de la arquitectura y módulos activos).
​02_BITACORA_APRENDIZAJES.md (Registro de bugs críticos resueltos y decisiones técnicas).
​03_ROADMAP.md (Lista de tareas y próximos pasos lógicos).
​Data Propietaria: El valor de QRpido reside en estos archivos de contexto, no en la memoria volátil del chat de IA. Estos archivos deben actualizarse constantemente.
​FASE 2: Disciplina de Sesión (El Bucle de Trabajo)
​Ref: Joyitas 4 y 5 (Automatizar disciplina y convertir sesiones en memoria).
​Cada vez que se requiera asistencia de la IA, se debe seguir este ciclo estricto para evitar alucinaciones y dilución de atención:
​Apertura de Sesión (Context Injection): * Iniciar un chat nuevo para cada tarea o módulo distinto.
​Pegar el contenido de 01_CONTEXTO_ACTUAL.md y definir claramente el objetivo del día.
​Regla de Modificación (Cero Código Completo):
​La IA tiene prohibido reescribir archivos enteros.
​Toda modificación se hará mediante el formato quirúrgico: BUSCA ESTE BLOQUE EXACTO -> PÍSALO CON ESTO.
​Cierre de Sesión (Wrap-Up):
​Antes de abandonar el chat, solicitar a la IA un resumen estructurado de la sesión.
​El resumen debe incluir: decisiones tomadas, errores corregidos y código modificado.
​Transferir este resumen manualmente a 02_BITACORA_APRENDIZAJES.md.
​FASE 3: Síntesis Estratégica (Dream Cycle)
​Ref: Joyita 6 (Conectar ideas en frío).
​Procesamiento Nocturno/Matutino: * Al menos una vez por semana (o cada mañana), abrir un chat de análisis.
​Alimentar a la IA con los últimos Wrap-ups de la bitácora y notas sueltas.
​Solicitar un "Dream Cycle": que la IA cruce la información, detecte posibles cuellos de botella en la arquitectura y sugiera el plan de acción para el 03_ROADMAP.md.
​FASE 4: Perímetro de Seguridad (Zero Trust)
​Ref: Joyita 7 (Seguridad son límites).
​Aislamiento por defecto: La IA no tiene contexto global real, solo simula tenerlo. Se le debe tratar como un contenedor aislado en cada chat.
​Desconfianza Sistemática: Todo código generado por la IA (especialmente reglas de bases de datos, lógicas de pago o autenticación) se considera sospechoso hasta que se verifique manualmente su impacto en el resto de la aplicación.
​Sanitización de Salidas: Nunca aplicar un cambio propuesto por la IA si la instrucción de "Buscar" no coincide de manera exacta y literal con el código en el editor local (Acode). Si no coincide, se aborta la instrucción y se exige corrección.