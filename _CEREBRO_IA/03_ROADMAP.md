Hoja de Ruta QRpido: El Reloj Suizo Autónomo (Frontend & Operaciones)
Fase 1: Telemetría, Retención y Modales (Cimientos)

[ ] UX Autenticación: Implementar email/password estándar y Google SSO (Cero Magic Links). Ver/ocultar contraseña (👁️) y forzar autocompletado nativo para fricción cero.

[ ] Escudo Legal UI: Casilla de "Términos y Condiciones / Contrato de Mandato" obligatoria en el registro con Honeypot anti-bots integrado (Inyectar el <input type="checkbox"> y el display: none en index.html).

[ ] Manifiesto Legal: Crear página o modal terminos.html con el texto de exención de responsabilidad y contrato de mandato para P2P.

[ ] Easter Egg V1 & V2: Contador de taps para activar herramientas de diagnóstico ocultas.

Fase 2: El Orquestador Fintech y Motor Web2

[ ] El Botón ▶️ Universal: Implementar el saldo global interactivo en UI (Integrar la función abrirPasarelaRecarga() con la llave pub_test... y la referencia RECARGA_uid_timestamp).

[ ] Interfaz de Bóveda Premium (usuarios.html): Construir la UI donde el cliente/comercio ve su saldo_logistica y tiene el botón integrado para recargar vía Wompi.

[ ] Bifurcación Dinámica de Checkout (carrito.js): Lógica frontend para detectar si el usuario tiene saldo_logistica suficiente para mostrar el botón "Pago Express ⚡" o si debe mostrar solo "Pedir por WhatsApp" (flujo gratuito).

[ ] El Fraccionador de Gas (Coin Splitter SUI): Crear un script de mantenimiento local que tome 1 SUI de la Tesorería, lo divida en MIST y pueble la ruta /Sistema/MallaDeGas/libres en RTDB.

[ ] Batching de Retiros: Lógica de retiros programados (ej. viernes) para agrupar pagos en un lote, capturando el excedente bancario.

[ ] Preparación Facturación Electrónica (Futuro): Dejar documentado el punto de inyección en el Webhook de Wompi para futura conexión con API de facturación (Alegra/Siigo) ante la DIAN.

Fase 3: El Notario Inmutable (SUI Blockchain)

(Fase backend completada. Infraestructura base operativa y documentada en bitácora).

Fase 4: Océano Azul (SaaS Freemium / Premium)

[ ] Catálogo Freemium: Acceso gratuito a publicación en el mapa, gestión autónoma por WhatsApp y logística por cuenta propia.

[ ] Motor Premium Comercial ($39k/mes): Activa gestión de domicilios integrados (pagando con saldo virtual) y administración avanzada.

[ ] Pasarela Propia (El Atributo Estrella Premium): Inyección dinámica de la Llave Pública Wompi del comercio en negocio.html. Lógica frontend para leer la DB y renderizar el botón de pago directo a Bancolombia si el comercio es PRO.

[ ] Módulo Premium Conductores ($49k inscrip. / $18.9k mes): Acceso 24/7 al mapa y a solicitudes de despacho (Gratuitos limitados a 6h ON/OFF).

Fase 5: Logística P2P (Proof of Delivery)

[ ] El Apretón de Manos Digital: UI Frontend para que el cliente dicte y el domiciliario ingrese el código corto criptográfico (DEL-XXXX) para liberar entrega.

[ ] Ilusión de Fluidez (60s): Sincronización GPS del conductor cada minuto con interpolación visual en el mapa (<12MB RAM).

[ ] Burbuja Magnética de Chat: Chat efímero 1 a 1 (Limpia mapa + traza ruta OSRM + Kill Switch GPS).

[ ] El "Camino Triste" (Lógica de Reembolso Virtual): Cloud Function cancelarOrdenLogistica para devolver automáticamente el dinero virtual (monto_total) al saldo_logistica del comerciante en Firebase si la orden caduca o se cancela.

Fase 6: Expansión Descentralizada (Embajadores y Moderadores)

[ ] Flujo KYC Manual (Vibecoding): Interfaz en admin.html para subir foto de cédula a Storage y botón de aprobación para Moderadores (evitando APIs biométricas).

[ ] Arquitectura de Roles: Diferenciación estricta entre Moderador Base (Soft-Delete) y Embajador.

[ ] Mina de Oro (Split del 25%): Reparto automático en Firestore del 25% (sobre el 10% de la plataforma) hacia el Embajador de la zona.

[ ] Dashboard Embajador: Panel en moderadores.html con telemetría en tiempo real de ingresos acumulados.

Fase 7: Refactorización y Blindaje Final

[ ] Zero-Trust Firestore: Reglas de seguridad finales bloqueando accesos globales no autorizados.

[ ] Extracción de Módulos: Separación de ui-estilos.css, motor-mapa.js y auth-mando.js.

[ ] Contador Distribuido (Sharding) en Firestore: Modificar el ContadorBilleteras del Módulo 1 para soportar registros masivos concurrentes (>1 escritura/seg).

Fase 8: Proyecto Academia

[ ] academia.html: Lanzamiento de 15 cupos para enseñar arquitectura de Súper Apps móviles con Firebase.

