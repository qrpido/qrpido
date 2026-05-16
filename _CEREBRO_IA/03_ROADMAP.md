**🗺️ Hoja de Ruta QRpido: El Reloj Suizo Autónomo (Frontend & Operaciones) v2.5**
**Fase 1: Telemetría, Retención y Modales (Cimientos)**

[ ] Easter Egg V1 & V2: Contador de taps para activar herramientas de diagnóstico ocultas.
[x] La Aduana Digital (OTP por Correo): Módulo nodemailer inyectado en index.js para generar validaciones de 6 dígitos con caducidad de 5 minutos, ahorrando costos de SMS y esquivando la fricción biométrica.
**Fase 2: El Orquestador Fintech y Motor Web2**

[ ] Bucle de Retención ("Cashback Logístico"): Lógica en el webhook de Wompi para devolver el costo de las comisiones bancarias inyectando puntos_ecosistema en la bóveda, usables exclusivamente dentro de la plataforma.
[ ] Tubería Financiera Segura (Anti LA/FT): Batching de retiros programados (ej. martes y viernes) agrupando pagos en lote solo si la bóveda supera los $50,000 COP, capturando el excedente y evitando bloqueos por "pitufeo".
[ ] El Fraccionador de Gas (Coin Splitter SUI): Script de mantenimiento local que tome 1 SUI de la Tesorería, lo divida en MIST y pueble /Sistema/MallaDeGas/libres en RTDB.
[ ] Preparación Facturación Electrónica (Futuro): Punto de inyección en Webhook para API de facturación (Alegra/Siigo).

**Fase 3: El Notario Inmutable (Capa Blockchain Web3)**

[ ] Anexos Multimedia Inmutables (Fase Futura): Integración de evidencias (fotos/videos cortos) cifradas en Firebase Storage (Bóveda Ciega) y vinculadas al contrato mediante su Hash SHA-256 estampado en la blockchain.
**Fase 4: Océano Azul (SaaS Freemium / Premium / Inmobiliario)**

[ ] Monetización Inmobiliaria ("Trust-as-a-Service"):
- *Peaje de Claridad:* Muro de pago ($5k) para abrir un canal de chat asistido por IA/Humano sobre dudas legales del contrato.
- *Mesa de Negociación:* Tarifa plana técnica que permite a inquilinos y propietarios alterar las cláusulas del documento base bidireccionalmente.
- *Sello de Inquilino Certificado:* Fast-track premium ($15k) para validación de antecedentes exprés e insignia dorada.
[ ] Módulo Premium Conductores ($49k inscrip. / $18.9k mes): Acceso 24/7 al mapa y solicitudes de despacho.
[ ] Delegación de Reversiones (Estatuto del Consumidor): Panel de "PQRs y Contracargos" directo a Wompi.
**Fase 5: Logística P2P y Contratos (Proof of Delivery / Proof of Location)**
[x] Geocerca Inquebrantable (Backend): Cálculo de distancia exacta mediante fórmula de Haversine en validarEntrega. Aborto automático si la distancia entre las partes es > 5km.
[ ] Trampas Anti-Fraude (Frontend): Inyección de exactitud < 2 (Fake GPS) y "Ceguera Temporal" (ocultar OTP display: none si distancia > 50 metros).
[x] El Cadenero (Validación Backend): Cloud Function blindada con Anti-Fuerza Bruta que valida la intersección de coordenadas en metros y el código OTP, repartiendo matemáticamente el saldo (respetando el 10% fijo de comisión).
[x] Sello Criptográfico Inmutable: Trituradora SHA-256 en backend para registro ciego del txID.
[x] Muro Anti-Spam y Pre-Ticket (Zero-Trust): Cooldown local y registro asíncrono silencioso en Firestore.
[ ] Ilusión de Fluidez (60s): Sincronización GPS del conductor cada minuto con interpolación visual en el mapa para no colapsar los 2GB de RAM.
[ ] Burbuja Magnética de Chat: Chat efímero 1 a 1 (Limpia mapa + traza ruta OSRM + Kill Switch GPS).
[ ] El "Camino Triste" (Lógica de Reembolso Virtual): Cloud Function cancelarOrdenLogistica.
**Fase 6: Expansión Descentralizada (Embajadores y Moderadores)**
[ ] Control de Acceso Basado en Roles (RBAC) Georeferenciado: Lógica de subcolección sucursales en Firestore. Permite a dueños delegar moderadores_uids a administradores locales, forzando a la Geocerca a usar la lat/lng de la sucursal y no la del dueño principal.
[x] Flujo KYC Manual (Vibecoding): Interfaz para subir foto de cédula a Storage y botón en moderacion.html (Aduana KYC).
[ ] Mina de Oro (Split del 25%): Reparto automático en Firestore del 25% (sobre el diezmo base de la plataforma) hacia el Embajador de la zona.
[ ] Dashboard Embajador: Panel en moderadores.html con telemetría en tiempo real.
[ ] Módulo Editorial (Pulso Urbano): Redacción de noticias y monetización mediante IDs de patrocinadores (sponsor_id).
**Fase 7: Refactorización y Blindaje Final**
[x] Golden Design System: Variables globales inyectadas en ui-estilos.css estandarizadas con nomenclatura en español (ej. --texto-base).
[ ] Zero-Trust Firestore: Reglas de seguridad finales bloqueando accesos globales no autorizados.
[ ] Contador Distribuido (Sharding) en Firestore: Modificar el ContadorBilleteras para soportar escrituras masivas concurrentes.
​[ ] Escudo Criptográfico de Cliente (Firebase App Check): > Por qué: Aún si tu backend es seguro, alguien puede tomar la URL de tu base de datos y hacerle un millón de peticiones desde una terminal (Postman o un bot), disparando tu factura de Google a las nubes.
​La Solución: Activar App Check (Play Integrity en Android / reCAPTCHA v3 invisible en Web). Esto asegura que Google solo responda a peticiones que vengan exclusivamente de tu código index.html real, rechazando cualquier tráfico de bots antes de que te cobren un centavo.
​[ ] Modo de Supervivencia Logística (Service Worker Offline-First):
​Por qué: En LATAM, los domiciliarios entran a sótanos, ascensores o zonas sin cobertura. Si el conductor pierde señal justo al abrir el radar o ver el código OTP, la pantalla blanca (Punto #7 de la lista) arruina la entrega.
La Solución: Implementar un service-worker.js nativo que almacene en caché la estructura visual de la app (ui-estilos.css, el esqueleto HTML) para que la app cargue en 0.5 segundos incluso sin internet, mostrando un mensaje elegante de "Esperando conexión...".
​[ ] Protocolo Lázaro (PITR y Alertas de Facturación):
​Por qué: El Punto #19 y #21 de nuestra lista forense. Un error humano o un pico de tráfico no detectado.
La Solución: Activar Point-in-Time Recovery (PITR) en Firestore para poder "viajar en el tiempo" y recuperar datos borrados hasta el minuto exacto. Configurar alertas de presupuesto al 50% y 90% en GCP enviadas directo a tu correo.
**Fase 8: Proyecto Academia**
[ ] academia.html: Lanzamiento de 15 cupos para enseñar arquitectura de Súper Apps móviles con Firebase usando Acode (Low-end hardware dev).
**Fase 9: Tokenización y Gobernanza Web3 (El Hito del Unicornio)**
[ ] Emisión de Activo Virtual (Token QRpido): Contrato en red SUI representando el patrimonio.
[ ] Distribución de Dividendos en Cadena: Liquidación trimestral automática de márgenes operativos hacia billeteras SUI de accionistas.
