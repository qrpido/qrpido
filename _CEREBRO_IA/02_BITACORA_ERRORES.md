​🧠 Contexto General de QRpido (Súper App Autónoma)
​Proyecto: Plataforma B2C/B2B y "Súper App" de radar urbano. Enfoque en hiper-optimización de recursos, autonomía financiera y validación inmutable de logística P2P.
Estrategia Actual de Producto: Captura asincrónica de intención de compra (Carritos 24/7), Monetización Freemium en Taxis/Domiciliarios (Océano Azul), Motor Fintech de Tesorería Universal (Batching de retiros), Ecosistema Auto-regulado (Proof of Delivery) y Expansión Descentralizada mediante Embajadores.
Stack: Vanilla JS, CSS nativo, Firebase v10 (Hosting, Firestore, Auth, Cloud Functions), Leaflet, API Wompi (Pasarela Fiat), API OSRM (Rutas Opcionales), Node.js, SDK de SUI (@mysten/sui).
Entorno de Pruebas Base: Cliente: Android con 1.5GB/2GB de RAM (Gama de entrada). Presupuesto de memoria estricto: <30MB RAM para módulos premium. Servidor: Alpine Linux en terminal móvil (Acode) con Node.js 22.
​Estado de la Arquitectura
​Frontend (Mapa y UI): index.html hiper-optimizado (GPU, 60 FPS, consumo fijo de 9.5MB RAM). Interfaz paramétrica construida con la Proporción Áurea. Gestión de contraseñas nativa del SO. Renderizado quirúrgico de UI (Burbujas magnéticas y chat efímero) para proteger el árbol del DOM.
​Herramientas de Medición: "Burbuja Magnética" (Micro-Profiler) inyectada para medir FPS, RAM y DOM en tiempo real.
​Backend Web2 (Jerarquías y Motor Fintech): Autenticación estándar/Google SSO (Rechazo de Magic Links por phishing). Integración Wompi automatizada. Lógica de retención atómica del 12% por transacción y estrategia de "Batching" en retiros programados para absorber márgenes bancarios.
​Usuario: Navegación anónima/protegida y compra.
​Dueño/Comerciante: Bóveda financiera (admin.html) y contratación directa de red logística (Taxistas/Domiciliarios con ❤️).
​Conductor (Freemium): Acceso a mapa 6h ON/OFF (Gratis) o 24/7 (Premium). Ilusión de tiempo real GPS a 60s.
​Moderador Base: Aprobación y Soft-Delete de negocios por zona para mantener la pureza del mapa.
​Embajador (Moderador Premium): Dueño de cuadrante geográfico. Recibe el 25% del ingreso generado por su zona (parametrizado vía ID_Embajador en Firebase). Acceso a Dashboard de telemetría financiera.
​Superadmin: Control total, auditoría financiera global y Hard-Delete (qrpido.html).
​Backend Web3 (El Oráculo y Notario SUI)
​Arquitectura Custodial sin Fricción: Derivación de billeteras HD en la red SUI usando Contadores Atómicos en Firestore (Cero colisiones matemáticas).
​Proof of Delivery (Reputación Inmutable): Gatillo lógico de seguridad. El pago y la interfaz de calificación en frontend solo se desbloquean tras la validación de un código único (DEL-XXXX) entre cliente y repartidor.
​Tesorería Autónoma: Ejecución de Sponsored Transactions (Gas-less para el usuario). Smart Contracts condicionados a validaciones estrictas desde Firebase (Anti-Fuerza Bruta en los códigos). Frase semilla maestra inyectada y aislada en Google Cloud Secret Manager.
​⚠️ Reglas de IA Activas (Protocolo de Asistencia)
​NUNCA generar código completo.
​Usar formato de "Buscar y Reemplazar" quirúrgico (> BUSCA ESTE BLOQUE EXACTO... > PÍSALO CON ESTO...).
​Operar y diagnosticar basados EXCLUSIVAMENTE en datos reales del log del Micro-Profiler.
​Priorizar lógica matemática (Fibonacci/Áurea) en UI y delegación a GPU en animaciones.
​Mantener estrictamente el estándar del proyecto para variables de diseño: todo en español (ej. --texto-base, --color-primario).



Fecha: 22 de Abril de 2026
​[x] Ejecutar prueba de estrés y estabilizar motor gráfico:
​Solución: Motor estabilizado a 60 FPS y consumo fijado en <10MB de RAM mediante la delegación de animaciones a la GPU y uso continuo del Micro-Profiler.
​[x] Estandarizar Proporción Áurea en modales y limpiar sintaxis de Leaflet:
​Solución: DOM de Leaflet purgado de fugas de memoria. Interfaz paramétrica ajustada a la secuencia de Fibonacci (8px, 13px, 21px).
​[x] UX Panel Cristal (Persistencia de categoría):
​Solución: Refactorización de UI completada. Al cerrar la vista de detalle (X), el usuario se mantiene en su categoría actual sin resetear el mapa.
​[x] Entorno de Desarrollo (Móvil):
​Solución: Ecosistema Alpine Linux instalado sobre Acode con Node.js 22 y Firebase CLI operativo para deployments desde el teléfono.
​[x] Módulo Webhook Wompi:
​Solución: Endpoint creado en index.js con validación de hash criptográfico (Secreto de Eventos) para capturar recargas e inyectar liquidez atómicamente en Firestore.
​[x] Tesorería Autónoma y Vigilante de Gas:
​Solución: Cloud Function (pubsub.schedule) configurada para auditar el balance de la wallet SUI cada 12 horas y disparar alertas en Firestore si el gas cae a niveles críticos.
​[x] Malla de Gas (Anti-Colisión):
​Solución: Arquitectura de fragmentación atómica establecida en Firebase RTDB (/Sistema/MallaDeGas/libres) usando .transaction() para permitir miles de pagos concurrentes sin Coin Locking.
​[x] Smart Contract (El Notario):
​Solución: Código logistica.move rescrito desde cero. Se eliminó el Escrow pesado y se reemplazó por Sui Events (Recibos Inmutables) para certificar las transacciones a una fracción del costo y riesgo legal.

