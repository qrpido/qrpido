# 📖 Bitácora de Sesiones y Errores

## [2026-04-17] Sincronización Matemática de Geofire y Zoom Semántico
- **Problema Geofire:** El radar estaba ciego. La librería usa METROS directos, no kilómetros. Se corrigió en `core-db.js`.
- **Decisión Arquitectónica UI:** Se implementó "Efecto Dron" con escala dinámica áurea en CSS (`will-change: transform`). En zoom lejano los pines miden lo mismo que el punto GPS para no saturar la pantalla.

## [2026-04-18] Telemetría y Límites de Hardware
- **Aprendizaje sobre Hosting:** La PWA monolítica con Vanilla JS pesa apenas ~146 KB en Firebase. Eficiencia extrema lograda al evitar frameworks.
- **Decisión Arquitectónica (Medición):** Antes de modularizar el código, se inyectó un Micro-Profiler para auditar FPS, RAM y Nodos DOM en tiempo real.
- **Concepto (Efecto Observador):** Medir consume recursos, pero el gadget usa `requestAnimationFrame` para tener un impacto casi nulo. Buscamos detectar "infartos" del sistema (caídas drásticas), no micro-segundos.
