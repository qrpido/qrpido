# 🧠 Contexto General de QRpido
**Proyecto:** Plataforma B2C/B2B de radar urbano.
**Objetivo Actual:** Finalizar el frontend al 100%, establecer límites de hardware y estandarizar la UI antes de iniciar el backend de domiciliarios.
**Stack:** Vanilla JS, CSS nativo, Firebase v10, Leaflet.
**Entorno de Pruebas Base:** Android con 1.5GB/2GB de RAM (Gama de entrada).

## Estado de la Arquitectura
- **Frontend:** Archivo monolítico (`index.html`). Contiene todas las mecánicas visuales (modales, radar, zoom semántico).
- **Herramientas de Medición:** Micro-Profiler (Gadget) inyectado para medir FPS, RAM, Nodos DOM y costo en milisegundos de las funciones pesadas.
- **Backend:** Firebase Hosting con autolimpiado activado (límite de 2 versiones).

## Reglas de IA Activas
- NUNCA generar código completo.
- Usar formato de "Buscar y Reemplazar" quirúrgico.
- Operar basados en datos reales del Micro-Profiler.
