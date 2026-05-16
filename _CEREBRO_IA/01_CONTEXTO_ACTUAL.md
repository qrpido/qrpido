​🧠 Contexto General de QRpido (Versión SaaS Autónoma) Actualizado
​Proyecto: Plataforma B2C/B2B de radar urbano con enfoque en hiper-optimización de recursos, descentralización financiera y validación inmutable de logística P2P.
Estrategia Actual de Producto: Modelo SaaS de dos niveles (Freemium y Premium). Captura asincrónica de intención de compra (Carritos 24/7). El paquete Premium incluye la inyección de la pasarela Wompi del propio comercio para pagos directos (blindaje legal y fiscal para QRpido). Motor logístico Trustless basado en blockchain (Recibos Inmutables) completamente invisible para el usuario.
Stack: Vanilla JS, CSS nativo modularizado, Firebase v10 (Hosting, Firestore, RTDB, Auth, Cloud Functions), Leaflet, Node.js 20, SDK de SUI (@mysten/sui), API Wompi.
Entorno de Pruebas Base: * Cliente: Android con 1.5GB/2GB de RAM (Gama de entrada). Presupuesto de memoria estricto: <60MB RAM (apuntando a <30MB en módulos de mapa).
​Servidor: Alpine Linux en terminal móvil (Acode). [HITO] Despliegue exitoso de backend en GCP superando bloqueos de IAM y Artifact Registry directamente desde un smartphone.
​🏗️ Estado de la Arquitectura
​Frontend (Mapa y UI): * index.html hiper-optimizado (GPU, 60 FPS, consumo fijo de 9.5MB RAM). Interfaz con Proporción Áurea.
​Implementación del "Golden Design System" fundado en archivo independiente (ui-estilos.css) con variables en español (--naranja, --bg-oscuro, --texto-base) para la modularización progresiva de estilos.
​[HITO] Cerebro Central (qrpido.html): Dashboard SuperAdmin hiper-ligero. Monitoreo logístico vía onValue controlado y lectura Web3 Híbrida (SUI y Base L2) mediante fetch directo a nodos RPC públicos (Cero SDKs, cero impacto en RAM).
​DOM Garbage Collector: Limpieza automática de nodos (logs de SUI) inyectada en Vanilla JS para prevenir fugas de memoria en sesiones largas.
​Estéticas matemáticas: Grillas (grid) en qrpido.html construidas bajo la Proporción Áurea estricta (1 : 1.618 : 1).
​Gestión de contraseñas nativa del SO.
​Seguridad UI y Legal: * Implementación de "Trampa Honeypot" (0 bytes) contra bots y escudo legal (Contrato de Mandato) en el registro en lugar de reCAPTCHA.
​Búnker jurídico operativo (terminos.html) con escudos corporativos (Anti-DIAN, Anti-SIC, MinTrabajo, Cesión de M&A) y Habeas Data adaptado a Web3 con limitación técnica por inmutabilidad (SUI).
​[HITO] Kill Switch: Botón de emergencia en el Cerebro Central conectado directamente a Firestore para cortar la generación de códigos TOTP a nivel global ante ataques.
​Herramientas de Medición: * "Burbuja Magnética" (Micro-Profiler) inyectada para medir FPS, RAM y DOM.
​Backend (Roles, Tesorería y Seguridad Web2): * Autenticación mediante Google SSO y contraseñas estándar (Rechazo absoluto de Magic Links por vectores de phishing).
​Tesorería Central: Webhook de Wompi en index.js para recargas de saldo (gasolina logística) con validación de firmas criptográficas. Comisión matemática fijada al 10% inquebrantable desde el backend.
​Firebase Firestore configurado con reglas estrictas de jerarquía Zero-Trust.
​Roles:
​Usuario: Navegación y compra gratuita.
​Dueño: Gestión de bóveda (admin.html). Nivel Freemium (básico) o Premium (Wompi propio inyectado).
​Moderador/Embajador: Aprobación por zona y dueños de cuadrante (reciben 25% de la comisión de QRpido).
​Superadmin: Control total (Cerebro Central), Hard-Delete e indultos de tribunal de evasión.
​Backend (El Oráculo Web3 y Malla de Gas): * Arquitectura Custodial sin fricción. Derivación de billeteras HD en la red SUI usando Contadores Atómicos en Firestore (index.js).
​Notario SUI: Reemplazo absoluto de los Smart Contracts de Escrow (bloqueo de tokens) por Sui Events (Recibos Inmutables). Menor costo, cero fricción de Coin Locking y máxima trazabilidad legal.
​Anticipador de Flujo (Malla de Gas): Fragmentación en Firebase Realtime Database (RTDB) usando transacciones atómicas para soportar miles de validaciones de entrega concurrentes. [HITO] Dust Sweeper programado para reciclar micro-fracciones de gas huérfanas cada 24h.
​Smart Contracts condicionados a validaciones estrictas desde Firebase (Proof of Delivery: DEL-XXXX) con penalizaciones anti-fuerza bruta. Semilla maestra protegida en Google Cloud Secret Manager.
​⚠️ Reglas de IA Activas (Protocolo de Asistencia)
​NUNCA generar código completo.
​Usar formato de "Buscar y Reemplazar" quirúrgico (> BUSCA ESTE BLOQUE EXACTO... > PÍSALO CON ESTO...).
​Operar y diagnosticar basados EXCLUSIVAMENTE en datos reales del log del Micro-Profiler o terminal.
​Priorizar lógica matemática (Fibonacci/Áurea) en UI y delegación a GPU en animaciones.
​Mantener estrictamente el estándar del proyecto para variables de diseño: todo en español (ej. --texto-base, --color-primario).
​⚠️ PROTOCOLO DE CIRUGÍA ESTRICTA (HARD RULE):
​Tienes estrictamente PROHIBIDO generar reescrituras completas de archivos. Tu objetivo principal es el ahorro extremo de tokens y cómputo.
Si la modificación requiere alterar código existente, estás OBLIGADO a usar EXCLUSIVAMENTE el formato:
> BUSCA ESTE BLOQUE EXACTO...
> PÍSALO CON ESTO...
Límite de generación: Nunca me entregues un bloque de código mayor a 40 líneas a menos que sea un archivo nuevo creado desde cero. Si rompes esta regla y me das código de más, consideraré que fallaste la instrucción base. Eres un cirujano con bisturí, no un bulldozer.