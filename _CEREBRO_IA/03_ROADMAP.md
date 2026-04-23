​🗺️ Hoja de Ruta QRpido: El Reloj Suizo Autónomo (Limpia)
​Fase 1: Telemetría, Retención y Modales (Cimientos)
​[ ] UX Autenticación: Implementar email/password estándar y Google SSO (Cero Magic Links). Ver/ocultar contraseña (👁️) y forzar autocompletado nativo para fricción cero.
​[ ] Escudo Legal UI: Casilla de "Términos y Condiciones / Contrato de Mandato" obligatoria en el registro con Honeypot anti-bots integrado.
​Lo que harás en el frontend: Inyectar el <input type="checkbox"> y el display: none en tu modal de autenticación (index.html).
​[ ] Easter Egg V1 & V2: Contador de taps para activar herramientas de diagnóstico ocultas.
​Fase 2: El Orquestador Fintech y Motor Web2
[ ] El Botón ▶️ Universal: Implementar el saldo global interactivo en UI... (Aquí es donde integraremos la función abrirPasarelaRecarga() que construimos hoy con tu llave pub_test... y la referencia RECARGA_uid_timestamp).

​[ ] Batching de Retiros: Lógica de retiros programados (ej. viernes) para agrupar pagos en un lote, capturando el excedente de comisiones bancarias para la tesorería.
[ ] El Fraccionador de Gas (Coin Splitter SUI): Crear un script/función de mantenimiento que tome 1 moneda SUI grande de la Tesorería y la divida en miles de micro-monedas (MIST) para inyectarlas y mantener "llena" la ruta Sistema/MallaDeGas/libres en RTDB. (Actualmente el Cadenero extrae monedas de ahí, pero nada las repone).
​[ ] Interfaz de Bóveda Premium (usuarios.html): Construir la UI donde el cliente final ve su saldo_logistica y tiene el botón integrado para recargar vía Wompi (disparando el flujo que ya atiende tu webhook).
​[ ] Bifurcación Dinámica de Checkout (carrito.js): Lógica frontend para detectar si el usuario tiene saldo_logistica suficiente para mostrar el botón "Pago Express ⚡" (flujo interno) o si debe mostrar solo "Pedir por WhatsApp" (flujo gratuito).
​Fase 3: El Notario Inmutable (SUI Blockchain)
​(Fase backend completada. Infraestructura base operativa y documentada en bitácora).
​Fase 4: Océano Azul (SaaS Freemium / Premium)
​[ ] Catálogo Freemium: Acceso gratuito a publicación en el mapa, gestión autónoma por WhatsApp y logística por cuenta propia.
​[ ] Motor Premium Comercial ($39k/mes): Activa gestión de domicilios integrados (pagando con saldo) y administración avanzada.
​[ ] Pasarela Propia (El Atributo Estrella Premium): Inyección dinámica de la Llave Pública Wompi del comercio en negocio.html...
​Lo que harás en el frontend: Leer la base de datos y si el negocio tiene la llave pública guardada, renderizar el botón para que sus clientes le paguen directo a su Bancolombia.
​[ ] Módulo Premium Conductores ($49k inscrip. / $18.9k mes): Acceso 24/7 al mapa y a solicitudes de despacho (Gratuitos limitados a 6h ON/OFF).
​Fase 5: Logística P2P (Proof of Delivery)
​[ ] El Apretón de Manos Digital: Código corto criptográfico (DEL-XXXX) dictado por el cliente para validar entrega.
​[ ] El Cadenero (Validación Backend): Cloud Function blindada con sistema Anti-Fuerza Bruta (strikes de 15 min) que valida el código y reparte matemáticamente el saldo.
​[ ] Sello SUI Inmutable: Registro automático del txID en la blockchain al confirmar la entrega, sin intervención humana.
​[ ] Ilusión de Fluidez (60s): Sincronización GPS del conductor cada minuto con interpolación visual en el mapa (<30MB RAM).
​[ ] Burbuja Magnética de Chat: Chat efímero 1 a 1 (Limpia mapa + traza ruta OSRM + Kill Switch GPS).
[ ] El "Camino Triste" (Lógica de Reembolso Virtual): Cloud Function cancelarOrdenLogistica. Si un domiciliario cancela o una orden caduca, el servidor debe devolver automáticamente el dinero virtual (monto_total) al saldo_logistica del comerciante en Firebase, ya que los fondos reales nunca salieron de la cuenta bancaria.
​Fase 6: Expansión Descentralizada (Embajadores y Moderadores)
​[ ] Arquitectura de Roles: Diferenciación estricta entre Moderador Base (Soft-Delete) y Embajador.
​[ ] Mina de Oro (Split del 25%): Reparto automático en Firestore del 25% (sobre el 10% de la plataforma) hacia el Embajador de la zona.
​[ ] Dashboard Embajador: Panel en moderadores.html con telemetría en tiempo real de ingresos acumulados.
​Fase 7: Refactorización y Blindaje Final
​[ ] Zero-Trust Firestore: Reglas de seguridad finales bloqueando accesos globales no autorizados.
​[ ] Extracción de Módulos: Separación de ui-estilos.css, motor-mapa.js y auth-mando.js.
​[ ] Contador Distribuido (Sharding) en Firestore: Modificar el ContadorBilleteras del Módulo 1. (Firestore solo soporta 1 escritura por segundo en un mismo documento. Si 50 usuarios se registran al mismo segundo en una campaña masiva, Firebase bloqueará a 49. Hay que dividir ese contador en múltiples fragmentos).
​Fase 8: Proyecto Academia
​[ ] academia.html: Lanzamiento de 15 cupos para enseñar arquitectura de Súper Apps móviles con Firebase.