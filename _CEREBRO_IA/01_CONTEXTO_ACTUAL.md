# 🧠 Contexto General de QRpido
**Proyecto:** Plataforma B2C/B2B de radar urbano con enfoque en hiper-optimización de recursos.
**Estrategia Actual de Producto:** Captura asincrónica de intención de compra (Carritos 24/7) y establecimiento de Jerarquías de Administración (Moderadores Regionales vs. Superadmin Central).
**Stack:** Vanilla JS, CSS nativo, Firebase v10 (Hosting + Firestore), Leaflet.
**Entorno de Pruebas Base:** Android con 1.5GB/2GB de RAM (Gama de entrada). Presupuesto de memoria: <60MB RAM.

## Estado de la Arquitectura
- **Frontend (Mapa):** `index.html` hiper-optimizado (GPU, 60 FPS, consumo fijo de 9.5MB RAM). Interfaz con Proporción Áurea. Gestión de contraseñas nativa del SO.
- **Herramientas de Medición:** "Burbuja Magnética" (Micro-Profiler) inyectada para medir FPS, RAM y DOM.
- **Backend y Roles:** Firebase Firestore configurado con reglas estrictas de jerarquía.
  - *Usuario:* Navegación y compra.
  - *Dueño:* Gestión de su propia bóveda (`admin.html`).
  - *Moderador:* Aprobación y *Soft-Delete* de negocios por zona (`moderacion.html`).
  - *Superadmin:* Control total, auditoría de moderadores y *Hard-Delete* (`qrpido.html`).

## Reglas de IA Activas
- NUNCA generar código completo.
- Usar formato de "Buscar y Reemplazar" quirúrgico (`> BUSCA ESTE BLOQUE EXACTO... > PÍSALO CON ESTO...`).
- Operar y diagnosticar basados EXCLUSIVAMENTE en datos reales del log del Micro-Profiler.
- Priorizar lógica matemática (Fibonacci/Áurea) en UI y delegación a GPU en animaciones.
