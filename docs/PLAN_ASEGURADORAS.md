# Budi — De app de grúas a plataforma de asistencia para aseguradoras

> Plan por fases para convertir el MVP operativo actual en un producto que una
> aseguradora pueda contratar: con pólizas, cobertura, SLA y facturación B2B.
>
> Versión visual (artifact): https://claude.ai/code/artifact/f1d42f46-4a0b-4fd9-9334-25e6e7357d29
> Fuente HTML: [`docs/plan-aseguradoras.html`](./plan-aseguradoras.html)
>
> Creado: 2026-07-17

---

## Punto de partida — hoy

**✓ Ya funciona**
- Solicitar servicio (6 tipos) con mapa y precio estimado.
- Despacho: aceptar / asignar operador, PIN de activación.
- Seguimiento en vivo, chat, historial, calificaciones.
- Panel admin: solicitudes, proveedores, usuarios, precios.

**✕ Falta para el modelo seguros**
- Capa de pólizas / afiliados y verificación de cobertura.
- Medición de SLA y folio por caso.
- Facturación a la aseguradora y liquidación a la red.
- Métricas de dueño en vivo y mapa de flota.

---

## Fase 0 — Cimientos operativos · Esfuerzo: M

**Objetivo:** dejar la operación diaria sólida y medible antes de sumar la capa
de seguros. Ninguna aseguradora contrata a quien no puede demostrar operación y
tiempos.

**Entregables** _(estado al 2026-07-24)_
- ✅ **Hecho** — Panel de dueño con métricas reales: servicios de **hoy / semana**, ingresos y **tiempo de respuesta promedio**. _(B-01, S1 27–31 jul)_
- ✅ **Hecho** — **Mapa de flota**: todos los operadores en vivo en un solo mapa.
- ✅ **Hecho** — Tracking del operador en **segundo plano** (no depender de la app abierta).
- ✅ **Hecho** — Ganancias del operador (hoy / semana) en su app.
- ⏳ **Pendiente** — Notificaciones push confiables + distribución a testers (EAS). _(requiere `eas init` + build EAS)_
- 🔄 **En curso** — Baseline Decreto 144: consentimiento, retención y checklist RLS **hechos**; falta designar DPO y revisión legal. Ver [`docs/PROTECCION_DATOS.md`](./PROTECCION_DATOS.md). _(B-07)_

**Datos:** reutiliza `operator_locations` · `request_events`.

**Por qué:** es la base creíble. Un dueño necesita ver el pulso del negocio, y una
aseguradora te va a pedir tiempos desde el día uno.

---

## Fase 1 — Pólizas y afiliados · Esfuerzo: L

**Objetivo:** que cada servicio nazca de una **cobertura válida**. Es el corazón
que convierte "grúas" en "asistencia de seguro".

**Entregables**
- Alta de **aseguradoras**, **pólizas** y **afiliados / beneficiarios**.
- Verificación de **afiliado activo** al momento de solicitar.
- Reglas de cobertura: nº de servicios al año, **km de arrastre cubiertos**, tipos incluidos.
- Cálculo automático de **copago** cuando el servicio excede la cobertura.
- Carga de afiliados por la aseguradora (importación masiva / API).

**Tablas nuevas:** `insurers` · `policies` · `members` · `coverage_plans` · `coverage_usage`.

**Por qué:** sin esta capa sigues siendo una app de grúas. Con ella, vendes un
beneficio de póliza.

---

## Fase 2 — Casos, SLA y despacho · Esfuerzo: L

**Objetivo:** operar como una central de asistencia, con trazabilidad y
cumplimiento de tiempos que una aseguradora pueda auditar.

**Entregables**
- **Folio / caso** por servicio (número de referencia exportable).
- Medición de **SLA**: solicitud → asignación → llegada → cierre.
- Despacho al **operador más cercano** (sugerencia sobre el mapa de flota).
- Trazabilidad completa del caso (línea de tiempo de eventos).
- **Portal B2B** para la aseguradora: sus casos, SLA y estado en vivo.

**Datos (nuevas / extiende):** `cases` (folio, sla_asignacion, sla_llegada) · `request_events`.

**Por qué:** el SLA es el idioma de las aseguradoras. Sin reporte de tiempos, no
firman un contrato.

---

## Fase 3 — Facturación y liquidación · Esfuerzo: L

**Objetivo:** cerrar el ciclo del dinero — cobrar a la aseguradora y pagar a la
red de proveedores/operadores.

**Entregables**
- Facturación a la aseguradora: por caso y **consolidado mensual**.
- **Copagos del usuario** en la app (tarjeta / efectivo).
- **Liquidación** a proveedores y operadores (payouts).
- Reportes financieros y de SLA **exportables por aseguradora**.

**Tablas nuevas:** `invoices` · `payments` · `settlements` · `payouts`.

**Por qué:** es tu modelo de ingresos y, a la vez, lo que la aseguradora audita
cada mes.

---

## Fase 4 — Escala, confianza y multi-aseguradora · Esfuerzo: XL

**Objetivo:** producción seria y crecer a varias aseguradoras sin rehacer el
sistema.

**Entregables**
- Infraestructura propia: OSRM y tiles **auto-hospedados** o proveedor pago (decidir Google).
- Seguridad y compliance: auditoría, retención de datos, RLS revisado, roles finos.
- **Multi-aseguradora / white-label** (marca y reglas por cliente).
- Integraciones: API / webhooks con las aseguradoras y su call center.
- Observabilidad completa (Sentry + alertas de SLA) y soporte 24/7.

**Enfoque:** infra · seguridad · integraciones · continuo.

**Por qué:** aquí pasas de "un contrato" a una plataforma con varias aseguradoras
encima.

---

## Notas

- **Leyenda de esfuerzo:** M ≈ unas semanas · L = esfuerzo mayor, capa nueva · XL = continuo / infraestructura. Son tamaños **relativos** para priorizar, no fechas.
- Las fases son secuenciales, pero la **Fase 0** puede solaparse con la **1**.
- Base técnica ya lista para la capa de seguros: `request_events` (auditoría) ya existe y sirve de cimiento para trazabilidad y SLA.
