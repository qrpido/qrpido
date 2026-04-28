🗺️ Hoja de Ruta QRpido: El Reloj Suizo Autónomo (Frontend & Operaciones)

Fase 1: Telemetría, Retención y Modales (Cimientos)
[x] UX Autenticación: Implementar email/password estándar y Google SSO (Cero Magic Links). Ver/ocultar contraseña (👁️) y forzar autocompletado nativo para fricción cero.
[x] Escudo Legal UI: Casilla obligatoria en el registro con Honeypot anti-bots integrado. El texto de la UI dice explícitamente: "Declaro ser mayor de 18 años y acepto los Términos, Condiciones y el Contrato de Mandato".
[x] Manifiesto Legal: Crear página o modal terminos.html con el texto de exención de responsabilidad y contrato de mandato para P2P.
[ ] Easter Egg V1 & V2: Contador de taps para activar herramientas de diagnóstico ocultas.

Fase 2: El Orquestador Fintech y Motor Web2
[x] El Botón ▶️ Universal: Implementar el saldo global interactivo en UI (Integrar la función abrirPasarelaRecarga() con la llave pub_test... y la referencia RECARGA_uid_timestamp).
[x] Interfaz de Bóveda Premium (admin.html): Construir la UI donde el cliente/comercio ve su saldo_logistica y tiene el botón integrado para recargar vía Wompi.
[x] Bifurcación Dinámica Inmobiliaria y SaaS: Lógica frontend para ocultar el carrito flotante si el modelo es 'inmueble' y habilitar la pasarela Wompi si el comercio es 'Premium'.
[ ] El Fraccionador de Gas (Coin Splitter SUI): Crear un script de mantenimiento local que tome 1 SUI de la Tesorería, lo divida en MIST y pueble la ruta /Sistema/MallaDeGas/libres en RTDB.
[ ] Batching de Retiros: Lógica de retiros programados (ej. viernes) para agrupar pagos en un lote, capturando el excedente bancario.
[ ] Preparación Facturación Electrónica (Futuro): Dejar documentado el punto de inyección en el Webhook de Wompi para futura conexión con API de facturación (Alegra/Siigo) ante la DIAN.
[x] Interruptor "Dejen de Fregar" (Ley 2300): Agregar un toggle en la configuración del perfil (admin.html) para que el usuario pueda desactivar las notificaciones de marketing (Opt-out).
[ ] Bóveda LA/FT (Límites Transaccionales): Inyectar una regla matemática en la Cloud Function del Webhook de Wompi que rechace automáticamente cualquier recarga individual superior a X monto y bloquee cuentas que superen un tope mensual.

Fase 3: El Notario Inmutable (SUI Blockchain)
[x] (Fase backend completada. Infraestructura base operativa y documentada en bitácora).

Fase 4: Océano Azul (SaaS Freemium / Premium)
[x] Catálogo Freemium: Acceso gratuito a publicación en el mapa, gestión autónoma por WhatsApp y logística por cuenta propia.
[x] Motor Premium Comercial ($39k/mes): Activa gestión de domicilios integrados y administración avanzada.
[x] Pasarela Propia (El Atributo Estrella Premium): Inyección dinámica de la Llave Pública Wompi del comercio en negocio.html.
[ ] Módulo Premium Conductores ($49k inscrip. / $18.9k mes): Acceso 24/7 al mapa y a solicitudes de despacho (Gratuitos limitados a 6h ON/OFF).
[ ] Delegación de Reversiones (Estatuto del Consumidor): Inyectar un panel de "PQRs y Contracargos" en la bóveda de los comercios Premium que actúe como un puente directo hacia su propio dashboard de Wompi.

Fase 5: Logística P2P (Proof of Delivery)
[x] El Cadenero (Validación Backend): Cloud Function blindada con sistema Anti-Fuerza Bruta que valida el código y reparte matemáticamente el saldo.
[x] Sello SUI Inmutable: Trituradora SHA-256 en backend para registro ciego automático del txID en la blockchain al confirmar la entrega.
[x] El Apretón de Manos Digital: UI Frontend (domicilios.html) con Teclado Táctil Fantasma para que el domiciliario ingrese el código corto criptográfico y libere entrega.
​[x] Muro Anti-Spam y Pre-Ticket (Zero-Trust): Implementación de cooldown local y registro asíncrono silencioso del pedido en Firestore (registrarIntencionCompra) antes de lanzar WhatsApp o la pasarela.
[ ] Ilusión de Fluidez (60s): Sincronización GPS del conductor cada minuto con interpolación visual en el mapa (<12MB RAM).
[ ] Burbuja Magnética de Chat: Chat efímero 1 a 1 (Limpia mapa + traza ruta OSRM + Kill Switch GPS).
[ ] El "Camino Triste" (Lógica de Reembolso Virtual): Cloud Function cancelarOrdenLogistica para devolver automáticamente el dinero virtual (monto_total) al saldo_logistica.

Fase 6: Expansión Descentralizada (Embajadores y Moderadores)
[x] Flujo KYC Manual (Vibecoding): Interfaz para subir foto de cédula a Storage y botón de aprobación/rechazo en moderacion.html (Aduana KYC).
[ ] Arquitectura de Roles: Diferenciación estricta entre Moderador Base (Soft-Delete) y Embajador.
[ ] Mina de Oro (Split del 25%): Reparto automático en Firestore del 25% (sobre la comisión fija del 10% de la plataforma) hacia el Embajador de la zona.
[ ] Dashboard Embajador: Panel en moderadores.html con telemetría en tiempo real de ingresos acumulados.
[ ] El "Kill Switch" Administrativo (Derecho de Admisión): Implementar en el Cerebro Central la función de Hard-Delete por zonas o fraude.
[ ] Módulo Editorial (Pulso Urbano): Interfaz para la redacción de noticias y monetización mediante IDs de patrocinadores (sponsor_id), con integración directa a Firestore (publicarArticulo). (Toda la base de esto la acabamos de asegurar en tu core-db.js y admin.html).

Fase 7: Refactorización y Blindaje Final
[x] Extracción de Módulos (Fase 1 y Final): Fundación del "Golden Design System" en ui-estilos.css con variables globales en español, diseño del Manifiesto Legal y extirpación de lógica pesada de los HTML monolíticos.
[ ] Zero-Trust Firestore: Reglas de seguridad finales bloqueando accesos globales no autorizados.
[ ] Contador Distribuido (Sharding) en Firestore: Modificar el ContadorBilleteras para soportar registros masivos concurrentes (>1 escritura/seg).

Fase 8: Proyecto Academia
[ ] academia.html: Lanzamiento de 15 cupos para enseñar arquitectura de Súper Apps móviles con Firebase usando Acode.

Fase 9: Tokenización y Gobernanza Web3 (El Hito del Unicornio)
[ ] Emisión de Activo Virtual (Token QRpido): Despliegue de contrato inteligente en la red SUI para representar el patrimonio de la empresa.
[ ] Distribución de Dividendos en Cadena: Arquitectura de tesorería para liquidar trimestralmente y de forma automática el margen operativo (10% logística + suscripciones Premium + AdSense) hacia las billeteras SUI de los accionistas.
