# 🔐 Bóveda de Prompts Atemporales

## 🛠️ Prompts de Diagnóstico y Auditoría
**Objetivo:** Analizar telemetría y encontrar cuellos de botella.
**Prompt:**
"Actúa como un Ingeniero Senior de Rendimiento..." [Pega el prompt aquí]

## 🔪 Prompts de Refactorización (Modularización)
**Objetivo:** Extraer código de un monolito hacia un archivo limpio usando buscar y reemplazar.
**Prompt:**
"Actúa como un Ingeniero de Software Senior... Nuestro objetivo de hoy es iniciar la Fase de Modularización..." [Pega el prompt aquí]

## 🏗️ Prompts Fundacionales (Legacy)
**Objetivo:** [Aquí puedes ir pegando esos 32 prompts antiguos con los que construiste la base de datos y la seguridad Zero Trust de QRpido].




///////////////
## 🛠️ Prompts de Diagnóstico y Auditoría

//////////////

|||||||||||||||||||||||||||||
**Objetivo:** Analizar telemetría y encontrar cuellos de botella.
**Prompt:**
Actúa como un Ingeniero Senior de Rendimiento (Performance Engineer) experto en optimización extrema de PWAs con Vanilla JS, renderizado del DOM y gestión de memoria en dispositivos de gama de entrada.
​Estamos auditando QRpido, un radar urbano. Nuestro dispositivo objetivo (Línea Base) es un Android con 1.5GB a 2GB de RAM, usando conexiones 3G/4G inestables.
​A continuación, te proporcionaré el archivo de log puro (telemetría) generado por nuestro Micro-Profiler interno. Este log contiene el costo en milisegundos de nuestras funciones clave (Descarga de Firebase y Dibujo del Radar), fluctuaciones de FPS, consumo de RAM y el crecimiento de los Nodos DOM.
​🚨 TUS REGLAS ESTRICTAS DE OPERACIÓN:
​CERO ALUCINACIONES: Basarás tu diagnóstico ÚNICAMENTE en los números crudos del log que te adjunto.
​CERO CÓDIGO COMPLETO: Si detectas que debemos modificar una función para bajar su peso, usarás EXCLUSIVAMENTE el formato quirúrgico de "BUSCA ESTE BLOQUE EXACTO" y "PÍSALO CON ESTO".
​TU TAREA (EL VEREDICTO):
Analiza los datos y entrégame un reporte técnico estructurado con:
​Punto de Quiebre (Cuello de Botella): Identifica exactamente qué evento dispara la caída de FPS o el pico de memoria/DOM.
​El "Performance Budget" Matemático: Define la barrera técnica estricta que no debemos cruzar. (Ej: "Límite máximo de nodos DOM: X", "Costo máximo de renderizado por frame: Y ms").
​El Bisturí: Si hay un error claro en la lógica que esté duplicando nodos o colapsando el hilo principal, dame el bloque de código exacto a reemplazar para mitigarlo.
​AQUÍ ESTÁ EL REPORTE DE TELEMETRÍA:
[Pega aquí todo el contenido de tu archivo .txt generado por el Gadget]
∆∆∆∆∆∆∆∆∆∆∆∆∆∆∆∆∆∆∆∆




## 🔪 Prompts de Refactorización (Modularización)
**Objetivo:** Extraer código de un monolito hacia un archivo limpio usando buscar y reemplazar.
**Prompt:**
"Actúa como un Ingeniero de Software Senior... Nuestro objetivo de hoy es iniciar la Fase de Modularización..." [Pega el prompt aquí]

