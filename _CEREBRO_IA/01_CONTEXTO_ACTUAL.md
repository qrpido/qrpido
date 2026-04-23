​🧠 Contexto General de QRpido (Versión SaaS Autónoma)
​Proyecto: Plataforma B2C/B2B de radar urbano con enfoque en hiper-optimización de recursos, descentralización financiera y validación inmutable de logística P2P.
Estrategia Actual de Producto: Modelo SaaS de dos niveles (Freemium y Premium). Captura asincrónica de intención de compra (Carritos 24/7). El paquete Premium incluye la inyección de la pasarela Wompi del propio comercio para pagos directos (blindaje legal y fiscal para QRpido). Motor logístico Trustless basado en blockchain (Recibos Inmutables) completamente invisible para el usuario.
Stack: Vanilla JS, CSS nativo, Firebase v10 (Hosting, Firestore, RTDB, Auth, Cloud Functions), Leaflet, Node.js, SDK de SUI (@mysten/sui), API Wompi.
Entorno de Pruebas Base: Cliente: Android con 1.5GB/2GB de RAM (Gama de entrada). Presupuesto de memoria estricto: <60MB RAM (apuntando a <30MB en módulos de mapa). Servidor: Alpine Linux en terminal móvil (Acode) con Node.js 22.
​Estado de la Arquitectura
​Frontend (Mapa y UI): * index.html hiper-optimizado (GPU, 60 FPS, consumo fijo de 9.5MB RAM). Interfaz con Proporción Áurea.
​Gestión de contraseñas nativa del SO.
​Seguridad UI: Implementación de "Trampa Honeypot" (0 bytes) contra bots y escudo legal (Contrato de Mandato) en el registro en lugar de reCAPTCHA.
​Herramientas de Medición: "Burbuja Magnética" (Micro-Profiler) inyectada para medir FPS, RAM y DOM.
​Backend (Roles, Tesorería y Seguridad Web2): * Autenticación mediante Google SSO y contraseñas estándar (Rechazo absoluto de Magic Links por vectores de phishing).
​Tesorería Central: Webhook de Wompi en index.js para recargas de saldo (gasolina logística) con validación de firmas criptográficas. Comisión matemática fijada al 10%.
​Firebase Firestore configurado con reglas estrictas de jerarquía Zero-Trust.
​Usuario: Navegación y compra gratuita.
​Dueño: Gestión de bóveda (admin.html). Nivel Freemium (básico) o Premium (Wompi propio inyectado).
​Moderador/Embajador: Aprobación por zona y dueños de cuadrante (reciben 25% del margen de QRpido).
​Superadmin: Control total y Hard-Delete.
​Backend (El Oráculo Web3 y Malla de Gas): * Arquitectura Custodial sin fricción. Derivación de billeteras HD en la red SUI usando Contadores Atómicos en Firestore.
​Notario SUI: Reemplazo absoluto de los Smart Contracts de Escrow (bloqueo de tokens) por Sui Events (Recibos Inmutables). Menor costo, cero fricción de Coin Locking y máxima trazabilidad legal.
​Anticipador de Flujo: Implementación de una "Malla de Gas" fragmentada en Firebase Realtime Database (RTDB) usando transacciones atómicas para soportar miles de validaciones de entrega concurrentes.
​Smart Contracts condicionados a validaciones estrictas desde Firebase (Proof of Delivery: DEL-XXXX) con penalizaciones anti-fuerza bruta. Semilla maestra protegida en Google Cloud Secret Manager.
​⚠️ Reglas de IA Activas (Protocolo de Asistencia)
​NUNCA generar código completo.
​Usar formato de "Buscar y Reemplazar" quirúrgico (> BUSCA ESTE BLOQUE EXACTO... > PÍSALO CON ESTO...).
​Operar y diagnosticar basados EXCLUSIVAMENTE en datos reales del log del Micro-Profiler.
​Priorizar lógica matemática (Fibonacci/Áurea) en UI y delegación a GPU en animaciones.
​Mantener estrictamente el estándar del proyecto para variables de diseño: todo en español (ej. --texto-base, --color-primario).