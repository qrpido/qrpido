# 🧠 Contexto General de QRpido
**Proyecto:** Plataforma B2C/B2B de radar urbano con enfoque en hiper-optimización de recursos y "Easter Eggs" como firma de autor.
**Estrategia Actual de Producto:** Captura asincrónica de intención de compra (Permitir armado de carritos 24/7 como beneficio exclusivo para negocios, bloqueando únicamente la pasarela de WhatsApp fuera de horario).
**Stack:** Vanilla JS, CSS nativo, Firebase v10, Leaflet.
**Entorno de Pruebas Base:** Android con 1.5GB/2GB de RAM (Gama de entrada). Presupuesto de memoria estricto: <60MB RAM.

## Estado de la Arquitectura
- **Frontend (Mapa):** `index.html` optimizado (Renderizado GPU, 60 FPS, consumo fijo de 9.5MB de RAM, DOM capado a ~250 nodos). Interfaz matemática basada en Proporción Áurea.
- **Herramientas de Medición:** "Burbuja Magnética" interactiva (Micro-Profiler) inyectada para medir FPS, RAM y Nodos DOM en tiempo real sin bloquear el hilo principal. Debe estar en todas las vistas.
- **Backend:** Firebase Hosting (SPA routing activado) y Firebase Firestore. Autolimpiado de versiones activo.

## Reglas de IA Activas
- NUNCA generar código completo.
- Usar formato de "Buscar y Reemplazar" quirúrgico (`> BUSCA ESTE BLOQUE EXACTO... > PÍSALO CON ESTO...`).
- Operar y diagnosticar basados EXCLUSIVAMENTE en datos reales del log del Micro-Profiler.
- Priorizar lógica matemática (Fibonacci/Áurea) en UI y delegación a GPU en animaciones.
