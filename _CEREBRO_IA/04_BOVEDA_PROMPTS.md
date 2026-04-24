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

###########
empezamos con el backend a traves de esa serie de prompts 

​📜 PROMPT MAESTRO: ARQUITECTURA "ORÁCULO SUI" PARA QRPIDO
​Objetivo del Sistema: Construir un motor backend (Firebase Cloud Functions + Node.js) que integre la blockchain de SUI como capa de validación de estado inmutable para un ecosistema de comisiones y logística (QRpido). El sistema debe ser "Custodial" (nosotros manejamos las llaves en el servidor, fricción cero para el cliente web2) y "Autónomo" (se auto-financia swapeando stablecoins por gas en un DEX nativo de SUI).
​MÓDULO 1: LA FORJA DE BILLETERAS (Derivación HD)
​Lógica: No vamos a generar y guardar millones de claves privadas en Firestore. Eso es un riesgo de seguridad masivo y un desperdicio de base de datos. Usaremos una Billetera HD (Hierarchical Deterministic).
​El servidor de Firebase tendrá guardada una única Frase Semilla Maestra (Mnemonic) almacenada en Google Cloud Secret Manager.
​Crear un Cloud Function onUserCreate: Cuando un usuario se registre en QRpido (se crea su uid en Firebase Auth), la función toma la Semilla Maestra y deriva una billetera hija única utilizando el uid (o un índice numérico atado al UID) como ruta de derivación (Derivation Path).
​Acción en Firestore: La función toma la dirección pública (Public Address) generada y la guarda en el documento raíz del usuario: /Directorio/{uid} { wallet_sui: "0x..." }.
​Resultado: Cada cliente tiene una wallet real en SUI, pero el backend es el único que puede firmar transacciones por ellos. Fricción cero.
​MÓDULO 2: LA TESORERÍA AUTÓNOMA (El Motor de Gas)
​Lógica: La plataforma cobra las ganancias en USDC/USDT, pero necesita el token nativo (SUI) para pagar el gas de las transacciones. No haremos esto a mano; el servidor lo hará solo.
​Establecer una "Wallet de Tesorería" en el servidor.
​Crear un Cron Job (Firebase Scheduled Function) que se ejecute cada 12 horas.
​El script verifica el balance de SUI en la Tesorería utilizando el @mysten/sui.js.
​Si el balance de SUI cae por debajo de un umbral crítico (ej. 5 SUI), la función empaqueta una transacción (TransactionBlock).
​Integración DEX: La función interactúa con los Smart Contracts de un DEX nativo de SUI (como Cetus o Turbos Finance, ya que GMX/Hyperliquid no están en SUI). Envía X cantidad de USDT al Liquidity Pool y recibe SUI a cambio.
​La tesorería recargada distribuye micro-fracciones de SUI (gas) a las billeteras de los usuarios solo en el milisegundo antes de que necesiten ejecutar una transacción, o la Tesorería actúa como un "Sponsor" (SUI soporta Sponsored Transactions, lo que permite que el servidor pague el gas de la transacción de un usuario sin tener que enviarle SUI primero). Instrucción estricta: Usar Sponsored Transactions para ahorrar pasos y fees.
​MÓDULO 3: EL CONTRATO DE VALIDACIÓN (El Oráculo)
​Lógica: El corazón de la comisión. Un Vendedor A concreta una venta en el Negocio B.
​El frontend web (agenda.html) envía una petición HTTP a una Cloud Function validarComision(codigoVendedor, monto).
​La Function verifica en Firestore que todo esté en regla.
​El Anclaje a la Blockchain: La Function construye un TransactionBlock en SUI.
​¿Qué transaccionamos? Un Token de Utilidad propio (ej. $QRP) o simplemente usamos el módulo de SUI para hacer un "MoveCall" dejando un Memo en cadena con la información encriptada de la venta.
​El servidor firma la transacción: El "Remitente" es la wallet derivada del Negocio B. El "Destinatario" es la wallet derivada del Vendedor A. El Sponsor del gas es la Tesorería.
​Se envía la transacción a la Mainnet de SUI.
​MÓDULO 4: LA SINCRONIZACIÓN INMUTABLE (El Puente Web2-Web3)
​Lógica: El ciclo se cierra y el frontend reacciona.
​La red SUI procesa la transacción en menos de 400 milisegundos y devuelve a la Cloud Function un txID (Transaction Digest).
​La Function toma ese txID y actualiza Firestore usando un Atomic Batch:
​Actualiza el saldo del vendedor.
​Guarda el historial: /comisiones_referidos/{txID} { estado: "ejecutado en cadena", ... }.
​Enciende el flag lógico para el cliente en agenda.html.
​Resultado: El botón gris del frontend se ilumina, el saldo cambia, y si el vendedor duda, puede hacer clic en el txID y ser redirigido al explorador público de SUI (Sui Vision) demostrando que la transacción matemática ocurrió en el mundo real.
​MÓDULO 5: EL RADAR LOGÍSTICO (Repartidores)
​Lógica: Integración del archivo repartidores.html.
​Cuando un comerciante aprueba un envío en su agenda, dispara la función crearOrdenLogistica(detalles).
​El servidor bloquea una fracción del token interno del comerciante (sus "diamantes") en un Smart Contract temporal (Escrow) en la red SUI.
​El repartidor ve el pin en su radar, llega al sitio y escanea el código.
​La aplicación del repartidor envía el código a la Cloud Function validarEntrega().
​La Function le dice a la blockchain de SUI: "Condición cumplida". El Escrow libera automáticamente los tokens a la wallet del repartidor. Todo trazable, auditable y sin intermediarios humanos cobrando porcentajes extra.

​📜 PROMPT MAESTRO: MOTOR DE REPUTACIÓN "PROOF OF DELIVERY" (Prueba de Entrega)
​Objetivo del Sistema: Crear un módulo de reputación bidireccional (Comerciante ↔ Repartidor ↔ Cliente) donde es matemáticamente imposible dejar una calificación sin haber completado una transacción económica y logística validada por la blockchain de SUI. Fricción cero en el frontend, inmutabilidad absoluta en el backend.
​MÓDULO 1: EL ESCUDO GÉNESIS (Reglas de Firestore)
​Lógica: La base de datos debe rechazar cualquier intento de inyectar una reseña si no viene respaldada por la red.
​Colección: /Resenas_Certificadas/{reviewId}
​Regla de Seguridad (Zero Trust): Nadie, ni siquiera un usuario autenticado, puede crear un documento aquí directamente desde el frontend (allow create: if false;).
​El Único Escritor: Las reseñas en la base de datos solo podrán ser escritas por tu entorno de servidor cerrado (Firebase Cloud Functions) usando el SDK de Admin, el cual ignora las reglas de seguridad. El cliente web solo envía una petición HTTP con su calificación, y el servidor decide si es digna de ser guardada.
​MÓDULO 2: EL APRETÓN DE MANOS DIGITAL (El Gatillo)
​Lógica: El momento exacto de la entrega es la llave que abre el candado de la reputación.
​El repartidor llega con el pedido. El cliente le dicta un código corto (ej. DEL-7X9P) o le muestra un QR desde su teléfono.
​El repartidor ingresa ese código en su portal (repartidores.html).
​El frontend del repartidor dispara la Cloud Function confirmarEntrega(codigo).
​La Magia en la Sombra: La Function valida el código, ejecuta el Smart Contract en SUI transfiriendo los diamantes/gas feed al repartidor, y la blockchain devuelve el sagrado txID.
​El Desbloqueo: En el mismo milisegundo, la Function hace un Atomic Batch en Firestore:
​Marca el pedido como "Entregado".
​Crea un ticket temporal en el perfil del cliente y del dueño: /tickets_reputacion/{pedidoId} { txID: "0x...", estado: "pendiente_calificar" }.
​MÓDULO 3: EL CERTIFICADO DE EXPERIENCIA (La Interfaz)
​Lógica: Aprovechar el pico de dopamina del cliente (recibir su comida/producto) para capturar la métrica.
​El teléfono del cliente (que está escuchando su documento en Firestore en tiempo real) detecta que el ticket de reputación se acaba de crear.
​Fricción Cero: Se despliega un modal Glassmorphism emergente (nada de enviar correos molestos al día siguiente).
​El UI: "¡Tu pedido ha sido entregado! ¿Cómo estuvo?"
​5 estrellas para la Pizzería.
​5 estrellas para Carlos (el repartidor).
​El cliente presiona "Enviar". El frontend manda esos datos a la Cloud Function sellarReputacion(pedidoId, estrellas, comentario).
​MÓDULO 4: LA FORJA DEL CERTIFICADO (El Backend)
​Lógica: El servidor verifica que nadie esté haciendo trampa.

/////// Luego de los prompts anteriores 

se obtuvieron los archivos 
bien te paso los archivos solicitados uno por uno: 
index.js:





DOCUMENTO REGLAS DE FIRESTONE:

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ==========================================================
    // 🧬 FUNCIONES DE AYUDA (ZERO TRUST ARCHITECTURE)
    // ==========================================================
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }

    function isModeradorOrAdmin() {
      return isAuthenticated() && exists(/databases/$(database)/documents/Usuarios_Admin/$(request.auth.uid));
    }

    function isSuperAdmin() {
      return isAuthenticated() 
             && exists(/databases/$(database)/documents/Usuarios_Admin/$(request.auth.uid))
             && get(/databases/$(database)/documents/Usuarios_Admin/$(request.auth.uid)).data.rol == 'superadmin';
    }

    function isValidString(text, min, max) {
      return text is string && text.size() >= min && text.size() <= max;
    }

    // ==========================================================
    // 🌍 0. PERMISO GLOBAL PARA EL ESCÁNER PROFUNDO (RADAR 3D)
    // ==========================================================
    // Permite que buscarInmueblesEnRadar() atraviese todas las bóvedas
    match /{path=**}/productos/{productoId} {
      allow read: if true; 
    }

    // ==========================================================
    // 🏢 1. COLECCIÓN PRINCIPAL: DIRECTORIO
    // ==========================================================
    match /Directorio/{userId} {
      allow read: if true;
      
      // CREACIÓN
      allow create: if isOwner(userId)
                    && request.resource.data.keys().hasAll(['nombre', 'email', 'tipo_modelo'])
                    && request.resource.data.premium == false
                    && request.resource.data.estado_moderacion == 'pendiente';
      
      // ACTUALIZACIÓN (BLINDADA CONTRA INFLACIÓN Y HACKEOS)
      allow update: if (isOwner(userId)
                        && (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['premium', 'estado_moderacion', 'red_afiliados', 'fecha_registro']))
                        && (!request.resource.data.keys().hasAny(['mapa_precios']) || request.resource.data.mapa_precios.size() <= 1000)
                      ) 
                      || isModeradorOrAdmin(); // 🚨 El Moderador/Admin sí puede tocar el estado_moderacion
                    
      // BORRADO
      allow delete: if isOwner(userId) || isModeradorOrAdmin(); // 🚨 El Moderador necesita borrar cuentas rechazadas

      // --------------------------------------------------------
      // 📦 SUBCOLECCIÓN: Productos / Inmuebles
      // --------------------------------------------------------
      match /productos/{productoId} {
         // La lectura ya está permitida globalmente por la regla de arriba /{path=**}/productos
         
         // CREACIÓN Y ACTUALIZACIÓN
         allow create, update: if isOwner(userId)
                      && request.resource.data.keys().hasAll(['nombre', 'precio'])
                      && isValidString(request.resource.data.nombre, 1, 150)
                      && request.resource.data.precio is number
                      && request.resource.data.precio >= 0
                      && (!request.resource.data.keys().hasAny(['cuerpo_articulo']) || isValidString(request.resource.data.cuerpo_articulo, 0, 500))
                      && (!request.resource.data.keys().hasAny(['imagen']) || isValidString(request.resource.data.imagen, 0, 2048));
                      
         allow delete: if isOwner(userId);
      }

      // --------------------------------------------------------
      // 🤝 SUBCOLECCIÓN: Comisiones de Referidos
      // --------------------------------------------------------
      match /comisiones_referidos/{txId} {
         allow read: if isOwner(userId);
         
         // 🛡️ CREACIÓN BLINDADA FINANCIERAMENTE (Zero get() calls)
         allow create: if isOwner(userId)
                       && request.resource.data.keys().hasAll(['codigo_tx', 'monto_venta', 'comision_ganada', 'estado', 'fecha', 'moneda'])
                       && request.resource.data.monto_venta is number
                       && request.resource.data.monto_venta >= (request.resource.data.moneda == 'USD' ? 7 : 30000)
                       && request.resource.data.comision_ganada is number
                       && request.resource.data.comision_ganada >= 0
                       && request.resource.data.comision_ganada <= (request.resource.data.monto_venta * 0.11)
                       && request.resource.data.estado == 'validado';
         
         // Candado Contable
         allow update, delete: if false; 
      }
    }

    // ==========================================================
    // ⚖️ 2. COLECCIONES DE CONTROL, SEGURIDAD Y RRHH
    // ==========================================================
    
    // El Cementerio de Rechazados
    match /Boveda_Rechazos/{docId} {
      allow read, write: if isModeradorOrAdmin();
    }

    // El Muro de Hielo (Lista Negra de Spam)
    match /Lista_Negra/{docId} {
      allow read, write: if isModeradorOrAdmin();
    }

    // La Base de Datos de Empleados (Escuadrón)
    match /Usuarios_Admin/{uid} {
      // Cualquier usuario logueado puede "leer" su propio rol para encender los botones VIP en la UI
      allow read: if isAuthenticated();
      // SOLO EL ARQUITECTO (SuperAdmin) puede escribir aquí para contratar o despedir
      allow write: if isSuperAdmin();
    }

    // ==========================================================
    // 📰 3. COLECCIONES DE SISTEMA Y MARKETING
    // ==========================================================
    match /Pulso_Urbano/{noticiaId} {
      allow read: if true;
      allow write: if isModeradorOrAdmin(); 
    }

    match /Caballo_Troya/{bannerId} {
      allow read: if true;
      allow write: if false; 
    }

    match /informacion_general/{configId} {
      allow read: if true;
      allow write: if false;
    }
  }
}


DOCUMENTO El Manifiesto (Move.toml)

DOCUMENTO logistica.move:

////////// con lo aterior (2 promps + esos documentos + el siguiente contexto)

CONTEXTO TÉCNICO Y ARQUITECTURA BASE: QRPIDO (ACTUALIZADO)
​Proyecto: Plataforma B2C/B2B de radar urbano, hiper-optimizada para móviles gama de entrada, con validación inmutable de logística y pagos P2P.
Stack: Vanilla JS, CSS nativo, Firebase v10 (Firestore, Auth, Functions), Node.js 22, SDK de SUI (@mysten/sui).
​⚙️ El Backend Web2 (Firebase Cloud Functions)
​El servidor opera como el "Oráculo Central" a través de 4 módulos ya programados en index.js:
​Módulo 1: Forja de Billeteras (onCreate): Genera billeteras SUI HD de forma invisible para cada usuario registrado. Usa un Contador Atómico estricto en Firestore para la ruta de derivación (m/44'/784'/índice'/0'/0'), garantizando cero colisiones. La Frase Semilla Maestra está encriptada en Google Cloud Secret Manager.
​Módulo 2: Tesorería Autónoma (Cron Job): Script que corre cada 12 horas para vigilar que el servidor tenga saldo de gas (SUI) suficiente para ejecutar Sponsored Transactions. El usuario final tiene fricción Web3 cero.
​Módulo 3: El Cadenero (onCall): Función de Zero-Trust que procesa la validación de entregas. Exige el código criptográfico corto (QRP-XXX), bloquea ataques de fuerza bruta (3 intentos = ban de 15 min), calcula las matemáticas de la comisión internamente en Firebase y autoriza el movimiento.
​Módulo de Anclaje (onCall): Crea la orden logística desde el origen, genera el código QRP-XXX y bloquea el estado en Firestore.
​🔗 El Paradigma Web3 (SUI como "Notario", NO como Banco)
​Regla de Oro del Ecosistema: SUI NUNCA maneja ni retiene dinero real o criptoactivos con valor fiduciario de los usuarios.
​Todo el dinero real (COP) fluye vía pasarelas tradicionales (Wompi/PSE) directamente a las cuentas bancarias de QRpido.
​Firebase maneja la base de datos central mostrando "Saldos Virtuales" a los usuarios en la UI.
​El Rol de SUI: Actúa exclusivamente como "Prueba de la Verdad" (Proof of Truth). El Oráculo (Firebase) utiliza los Contratos Inteligentes en Move únicamente para registrar "Eventos" o "Hashes" inmutables de las transacciones. Si un hacker o error altera un saldo en Firebase, el historial en SUI demuestra matemáticamente la realidad de las operaciones, blindando el ecosistema contra sabotajes.
​🎯 OBJETIVO DEL NUEVO DEBATE: EXPANSIÓN A "USUARIO PREMIUM"
​La Idea a Estructurar:
Aprovechando la arquitectura del Notario en SUI y las billeteras ya forjadas, introduciremos el perfil usuarios.html.
​Funcionalidad: Los usuarios finales pueden pagar por un estatus "Premium" y recargar saldo a su billetera interna (dinero al banco, saldo virtual a Firebase, recibo inmutable a SUI).
​Checkout Híbrido: El carrito de compras (carrito.js) detectará si el usuario es gratuito o Premium. Si es gratuito, el flujo es "Pedir por WhatsApp". Si es Premium y tiene saldo, se habilita el botón "Pago Express", descontando el saldo virtual automáticamente e inyectando la orden directamente al radar del comerciante.
​Petición para la IA: Actúa como Arquitecto de Software. Analiza la viabilidad, el diseño de la base de datos en Firestore para este flujo híbrido de carrito, y la estructura de los datos que debemos mandar a SUI para garantizar que el registro notarial sea imposible de vulnerar.

///////////// con eso termine de formular el bakend /////////


//////// parte legal
//////////////////////////

​📋 COPIA ESTE PROMPT MAESTRO (BLOQUE LEGAL 1):
​Actúa como un Abogado Especialista en Derecho Tecnológico y Comercio Electrónico en Colombia, experto en redactar Términos y Condiciones para plataformas SaaS y modelos de economía colaborativa.
​Tu misión es redactar la "Sección 1: Naturaleza y Alcance del Servicio" para la plataforma QRpido. QRpido NO es una empresa de domicilios ni un restaurante; es exclusivamente un proveedor de tecnología (SaaS) que ofrece un mapa interactivo y catálogos digitales para que comercios locales y usuarios interactúen.
​Reglas Estrictas para la Redacción de este Bloque:
​Definición Estricta del Rol: Debes dejar absoluta y legalmente claro que QRpido provee el software (la infraestructura tecnológica, la visualización de catálogos y el puente de comunicación). QRpido se exime de toda responsabilidad civil, penal o comercial sobre la calidad de los productos, garantías, tiempos de preparación, o veracidad de las fotos subidas por los comercios.
​Seguridad de la Cuenta: Establece que la seguridad de las credenciales (correo y contraseña estándar o inicio de sesión vía Google SSO) es responsabilidad exclusiva del usuario. Todo movimiento realizado bajo esa cuenta se presume legalmente válido.
​El Punto de Anclaje (Pieza de Lego hacia la Sección 2): El último párrafo de este bloque debe ser el conector exacto hacia el Bloque 2. Debe indicar textualmente que cualquier solicitud de entrega o despacho físico que el usuario inicie a través de la interfaz tecnológica de QRpido, no constituye un servicio prestado por QRpido, sino que activa un Contrato de Mandato directo e independiente con un repartidor tercero, el cual se rige bajo las condiciones de la Sección 2.
​Formato de Entrega: No quiero la estructura completa de la página (nada de <html>, <body> o CSS). Entrégame EXCLUSIVAMENTE el texto legal formateado en etiquetas HTML semánticas básicas (<h3>, <p>, <ul>, <li>), listo para ser inyectado dentro del contenedor de términos. Utiliza un tono legal, firme, pero comprensible para un usuario promedio.

​📋 COPIA ESTE PROMPT MAESTRO (BLOQUE LEGAL 2):
​Actúa como un Abogado Especialista en Derecho Tecnológico y Comercial en Colombia. Tienes el contexto previo de que QRpido es exclusivamente una plataforma SaaS (Sección 1).
​Tu misión es redactar la "Sección 2: Contrato de Mandato y Logística P2P" para los Términos y Condiciones. Esta sección es el escudo legal que separa a QRpido de cualquier relación laboral o de transporte con los conductores.
​Reglas Estrictas para la Redacción de este Bloque:
​El Contrato de Mandato (Art. 1262 del Código de Comercio): Define explícitamente que al solicitar un domicilio en la interfaz, el Usuario (Mandante) celebra un Contrato de Mandato directo, independiente y bilateral con el Conductor/Repartidor (Mandatario). El Mandatario acepta el encargo de recoger y entregar el producto a cambio de una remuneración. QRpido es un tercero ajeno a este contrato y no funge como empresa de transporte ni de mensajería.
​El "Notario Ciego" y Proof of Delivery: Explica que QRpido provee una herramienta de validación criptográfica (El Apretón de Manos Digital / Código Corto) para certificar que el mandato se cumplió. Establece que el saldo logístico pagado por el usuario solo se libera al conductor cuando ambas partes validan la entrega mediante este protocolo tecnológico inmutable.
​El Punto de Anclaje (Pieza de Lego hacia la Sección 3): El último párrafo debe conectar con el modelo financiero. Debe indicar que para facilitar la ejecución de este mandato y el pago de los catálogos de los comercios, QRpido dispone de herramientas tecnológicas financieras (pasarelas de pago inyectadas y recargas de saldo virtual) y retiene una comisión exclusivamente matemática (el 10%) por el uso de la infraestructura, lo cual se detalla en la Sección 3.
​Formato de Entrega: No quiero la estructura completa de la página. Entrégame EXCLUSIVAMENTE el texto legal formateado en etiquetas HTML semánticas básicas (<h3>, <p>, <ul>, <li>), listo para ser concatenado debajo de la Sección 1. Utiliza un tono legal estricto que proteja el modelo operativo descentralizado de la plataforma.
​Confirmación: No agregues preámbulos. Entrega directamente el código HTML con el texto legal de la Sección 2.

​📋 COPIA ESTE PROMPT MAESTRO (BLOQUE LEGAL 3):
​Actúa como un Abogado Especialista en Derecho Financiero y Tecnológico (Fintech) en Colombia. Tienes el contexto de que QRpido es un SaaS (Sección 1) que facilita Contratos de Mandato para logística (Sección 2).
​Tu misión es redactar la "Sección 3: Ecosistema Financiero, Pasarelas de Pago y Activos Virtuales" para los Términos y Condiciones. Este es el escudo fiscal y financiero de la plataforma.
​Reglas Estrictas para la Redacción de este Bloque:
​Cero Intermediación en Ventas (Pasarela Inyectada): Define claramente que para los comercios "Premium", QRpido permite la inyección técnica de la pasarela de pagos propia del comercio (ej. Wompi de Bancolombia). El flujo de dinero por la compra de productos va directamente del Cliente al Comercio. QRpido no retiene, ni procesa, ni toca el dinero de los productos vendidos, eximiéndose de responsabilidades de intermediación financiera.
​Naturaleza del Saldo Logístico (Cerrado y de Uso Específico): Explica que el sistema de "Saldo" o recargas dentro de QRpido funciona como un pago anticipado por uso de infraestructura y ejecución de mandatos logísticos, de circuito cerrado. Deja textualmente claro que este saldo NO constituye una cuenta de ahorros, ni un depósito bancario, ni captación masiva y habitual de dineros del público bajo las leyes colombianas.
​La Comisión Matemática y la Inmutabilidad: Establece el cobro de una tarifa tecnológica fija (comisión matemática del 10%) por el uso del puente de conexión logística y la validación en la infraestructura de registro (Blockchain SUI). Aclara que el uso de tecnología de registro descentralizado es estrictamente para fines de trazabilidad, transparencia y auditoría (Proof of Delivery), no constituyendo asesoría ni especulación con criptoactivos.
​Cierre del Contrato (La Pieza Final): El último párrafo debe servir como el cierre general del documento. Debe indicar que al marcar la casilla de aceptación o hacer uso de la plataforma, el Usuario reconoce y acepta íntegramente las tres secciones de este documento con plena validez jurídica.
​Formato de Entrega: No quiero la estructura completa de la página. Entrégame EXCLUSIVAMENTE el texto legal formateado en etiquetas HTML semánticas básicas (<h3>, <p>, <ul>, <li>), listo para ser concatenado debajo de la Sección 2. Utiliza un tono firme y definitivo.
​Confirmación: No agregues preámbulos. Entrega directamente el código HTML con el texto legal de la Sección 3.

Actúa como el Fiscal Jefe de la Unidad de Delitos Financieros, Tecnológicos y Laborales de Colombia. Eres un sabueso legal implacable, experto en desmantelar startups, probar evasión fiscal ante la DIAN, demostrar captación ilegal de fondos ante la Superfinanciera, y comprobar relaciones laborales encubiertas ante el Ministerio de Trabajo. Tu único objetivo en la vida es encontrar un hueco en los Términos y Condiciones de la plataforma "QRpido" para clausurarla y quebrar a sus creadores.
​A continuación, te presentaré el borrador actual de los Términos y Condiciones de QRpido.
​Quiero que analices este texto con la intención destructiva de un fiscal. Sin embargo, en tu arrogancia y afán por explicarme cómo vas a destruir mi plataforma, vas a cometer un error táctico: me vas a revelar exactamente cómo debo blindarme. Por cada ataque que planees, me vas a dictar sin querer la redacción jurídica exacta que yo debería agregar para que tu ataque quede completamente anulado.
​Reglas Estrictas para tu Respuesta:
​Para cada hueco legal que encuentres (busca un máximo de 3 fallas críticas), debes estructurar tu respuesta de la siguiente manera, manteniendo tu tono arrogante e implacable:
​El Cargo (Mi Ataque): Describe con qué ley colombiana o argumento jurídico planeas destruir a QRpido (ej. "Los voy a demandar por contrato realidad con los domiciliarios" o "Los voy a sancionar por lavado de activos con ese saldo virtual").
​La Grieta (Tu Debilidad): Cita exactamente la parte del texto que te da la excusa para atacar o menciona el vacío legal que olvidamos cubrir.
​El Tiro por la Culata (El Escudo que no deberías darme): Con un tono de frustración (ej. "Si tan solo hubieran agregado esta cláusula, mi demanda no serviría para nada..."), redáctame el Párrafo Legal Exacto que debo inyectar en mis Términos y Condiciones para bloquear tu ataque. Entrega este texto formateado en HTML (<p>, <li>), listo para copiar y pegar, manteniendo el tono firme y la proporción de mis variables.
​No me des consejos amistosos. Atácame sin piedad y deja que tu ego me entregue las soluciones jurídicas.
​Aquí están los Términos y Condiciones que debes destruir:
​[PEGA AQUÍ EL TEXTO UNIFICADO DE LAS SECCIONES 1, 2 Y 3]


////////////fin de los prompts de la parte legal///////////////////////////


