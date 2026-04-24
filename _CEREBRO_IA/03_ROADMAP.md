​🗺️ Hoja de Ruta QRpido: El Reloj Suizo Autónomo (Frontend & Operaciones)
​Fase 1: Telemetría, Retención y Modales (Cimientos)
[ ] UX Autenticación: Implementar email/password estándar y Google SSO (Cero Magic Links). Ver/ocultar contraseña (👁️) y forzar autocompletado nativo para fricción cero.
​[ ] Escudo Legal UI: Casilla obligatoria en el registro con Honeypot anti-bots integrado. El texto de la UI debe decir explícitamente: "Declaro ser mayor de 18 años y acepto los Términos, Condiciones y el Contrato de Mandato".
[x] Manifiesto Legal: Crear página o modal terminos.html con el texto de exención de responsabilidad y contrato de mandato para P2P.
[ ] Easter Egg V1 & V2: Contador de taps para activar herramientas de diagnóstico ocultas.
​Fase 2: El Orquestador Fintech y Motor Web2
[ ] El Botón ▶️ Universal: Implementar el saldo global interactivo en UI (Integrar la función abrirPasarelaRecarga() con la llave pub_test... y la referencia RECARGA_uid_timestamp).
[ ] Interfaz de Bóveda Premium (usuarios.html): Construir la UI donde el cliente/comercio ve su saldo_logistica y tiene el botón integrado para recargar vía Wompi.
[ ] Bifurcación Dinámica de Checkout (carrito.js): Lógica frontend para detectar si el usuario tiene saldo_logistica suficiente para mostrar el botón "Pago Express ⚡" o si debe mostrar solo "Pedir por WhatsApp" (flujo gratuito).
[ ] El Fraccionador de Gas (Coin Splitter SUI): Crear un script de mantenimiento local que tome 1 SUI de la Tesorería, lo divida en MIST y pueble la ruta /Sistema/MallaDeGas/libres en RTDB.
[ ] Batching de Retiros: Lógica de retiros programados (ej. viernes) para agrupar pagos en un lote, capturando el excedente bancario.
[ ] Preparación Facturación Electrónica (Futuro): Dejar documentado el punto de inyección en el Webhook de Wompi para futura conexión con API de facturación (Alegra/Siigo) ante la DIAN.
[ ] Interruptor "Dejen de Fregar" (Ley 2300): Agregar un toggle en la configuración del perfil (admin.html) para que el usuario pueda desactivar las notificaciones de marketing (Opt-out), asegurando el cumplimiento legal prometido en la Sección 3.
​[ ] Bóveda LA/FT (Límites Transaccionales): Inyectar una regla matemática en la Cloud Function del Webhook de Wompi que rechace automáticamente cualquier recarga individual de "Saldo Logístico" superior a X monto (ej. $500,000 COP) y bloquee cuentas que superen un tope acumulado mensual, disparando una alerta en el Cerebro Central.
​Fase 3: El Notario Inmutable (SUI Blockchain)
(Fase backend completada. Infraestructura base operativa y documentada en bitácora).
​Fase 4: Océano Azul (SaaS Freemium / Premium)
[ ] Catálogo Freemium: Acceso gratuito a publicación en el mapa, gestión autónoma por WhatsApp y logística por cuenta propia.
[ ] Motor Premium Comercial ($39k/mes): Activa gestión de domicilios integrados (pagando con saldo virtual) y administración avanzada.
[ ] Pasarela Propia (El Atributo Estrella Premium): Inyección dinámica de la Llave Pública Wompi del comercio en negocio.html. Lógica frontend para leer la DB y renderizar el botón de pago directo a Bancolombia si el comercio es PRO.
[ ] Módulo Premium Conductores ($49k inscrip. / $18.9k mes): Acceso 24/7 al mapa y a solicitudes de despacho (Gratuitos limitados a 6h ON/OFF).
[ ] Delegación de Reversiones (Estatuto del Consumidor): Inyectar un panel de "PQRs y Contracargos" en la bóveda de los comercios Premium que actúe como un puente directo hacia su propio dashboard de Wompi, delegando operativamente la responsabilidad de las devoluciones de dinero como dicta la Sección 1.
​Fase 5: Logística P2P (Proof of Delivery)
[x] El Cadenero (Validación Backend): Cloud Function blindada con sistema Anti-Fuerza Bruta que valida el código y reparte matemáticamente el saldo.
[x] Sello SUI Inmutable: Trituradora SHA-256 en backend para registro ciego automático del txID en la blockchain al confirmar la entrega.
[ ] El Apretón de Manos Digital: UI Frontend para que el cliente dicte y el domiciliario ingrese el código corto criptográfico (DEL-XXXX) para liberar entrega.
[ ] Ilusión de Fluidez (60s): Sincronización GPS del conductor cada minuto con interpolación visual en el mapa (<12MB RAM).
[ ] Burbuja Magnética de Chat: Chat efímero 1 a 1 (Limpia mapa + traza ruta OSRM + Kill Switch GPS).
[ ] El "Camino Triste" (Lógica de Reembolso Virtual): Cloud Function cancelarOrdenLogistica para devolver automáticamente el dinero virtual (monto_total) al saldo_logistica del comerciante en Firebase si la orden caduca o se cancela.
​Fase 6: Expansión Descentralizada (Embajadores y Moderadores)
[ ] Flujo KYC Manual (Vibecoding): Interfaz en admin.html para subir foto de cédula a Storage y botón de aprobación para Moderadores (evitando APIs biométricas).
[ ] Arquitectura de Roles: Diferenciación estricta entre Moderador Base (Soft-Delete) y Embajador.
[ ] Mina de Oro (Split del 25%): Reparto automático en Firestore del 25% (sobre el 10% de la plataforma) hacia el Embajador de la zona.
[ ] Dashboard Embajador: Panel en moderadores.html con telemetría en tiempo real de ingresos acumulados.
[ ] El "Kill Switch" Administrativo (Derecho de Admisión): Implementar en el Cerebro Central (qrpido.html) el botón de ejecución inmediata para suspender, bloquear o eliminar catálogos que infrinjan la política de "Bienes Ilícitos" o sospechas de fraude, inactivando su visualización en el mapa al instante.
​Fase 7: Refactorización y Blindaje Final
[x] Extracción de Módulos (Módulo 0 y 1): Fundación del "Golden Design System" en ui-estilos.css con variables globales en español y diseño del Manifiesto Legal.
[ ] Extracción de Módulos (Fase Final): Migración del motor visual del mapa, la UI Light/Dark y la lógica pesada (motor-mapa.js, auth-mando.js) fuera del index.html monolítico.
[ ] Zero-Trust Firestore: Reglas de seguridad finales bloqueando accesos globales no autorizados.
[ ] Extracción de Módulos: Separación de ui-estilos.css, motor-mapa.js y auth-mando.js.
[ ] Contador Distribuido (Sharding) en Firestore: Modificar el ContadorBilleteras del Módulo 1 para soportar registros masivos concurrentes (>1 escritura/seg).
​Fase 8: Proyecto Academia
[ ] academia.html: Lanzamiento de 15 cupos para enseñar arquitectura de Súper Apps móviles con Firebase.
Fase 9: Tokenización y Gobernanza Web3 (El Hito del Unicornio)
[ ] Emisión de Activo Virtual (Token QRpido): Despliegue de contrato inteligente en la red SUI (Post-tracción y validación de mercado) para representar el patrimonio de la empresa.
[ ] Distribución de Dividendos en Cadena: Arquitectura de tesorería para liquidar trimestralmente y de forma automática el margen operativo (10% logística + suscripciones Premium + AdSense) hacia las billeteras SUI de los accionistas registrados.