# Runbook de operación 24/7 — Budi

> Backlog **LAN-04** (antes B-29). Versión 1 · 2026-09-28.
> **Criterio de aceptación:** este runbook está probado en un simulacro con el equipo (ver §8).
> Todo lo marcado **`[POR DEFINIR]`** hay que completarlo antes del simulacro. Lo marcado **PENDIENTE** no existe todavía en el producto: no lo prometas al Usuario ni al cliente.

---

## Índice

1. [Propósito y a quién va dirigido](#1-propósito-y-a-quién-va-dirigido)
2. [Turnos, roles y contactos](#2-turnos-roles-y-contactos)
3. [Herramientas: qué pantalla usar para qué](#3-herramientas-qué-pantalla-usar-para-qué)
4. [Cómo sabes que algo va mal (alertas y señales)](#4-cómo-sabes-que-algo-va-mal-alertas-y-señales)
5. [Procedimientos paso a paso](#5-procedimientos-paso-a-paso)
   - [P1. No hay socio disponible / solicitud sin asignar > 10 min](#p1-no-hay-socio-disponible--solicitud-sin-asignar--10-min)
   - [P2. El Usuario no responde o no aparece](#p2-el-usuario-no-responde-o-no-aparece)
   - [P3. El PIN de confirmación falla o queda bloqueado](#p3-el-pin-de-confirmación-falla-o-queda-bloqueado)
   - [P4. El socio no llega, se le cae la app o pierde señal](#p4-el-socio-no-llega-se-le-cae-la-app-o-pierde-señal)
   - [P5. Incidente en ruta (accidente, agresión, daño al vehículo)](#p5-incidente-en-ruta-accidente-agresión-daño-al-vehículo)
   - [P6. Disputa de cobro o de cobertura (aseguradora / MOPT)](#p6-disputa-de-cobro-o-de-cobertura-aseguradora--mopt)
   - [P7. Documento de socio vencido o socio suspendido](#p7-documento-de-socio-vencido-o-socio-suspendido)
   - [P8. Caída de la plataforma (Supabase, Edge Functions, push)](#p8-caída-de-la-plataforma-supabase-edge-functions-push)
   - [P9. Solicitud de eliminación de datos (Decreto 144)](#p9-solicitud-de-eliminación-de-datos-decreto-144)
6. [Tabla de escalamiento y tiempos objetivo](#6-tabla-de-escalamiento-y-tiempos-objetivo)
7. [Qué registrar en cada caso](#7-qué-registrar-en-cada-caso)
8. [Guion de simulacro](#8-guion-de-simulacro)
9. [Pendientes del producto que afectan la operación](#9-pendientes-del-producto-que-afectan-la-operación)

---

## 1. Propósito y a quién va dirigido

Este documento dice **qué hacer, en qué orden y con qué pantalla** cuando un servicio de asistencia vial se complica. Describe la operación **tal como funciona hoy** en el producto; donde algo falta, lo dice.

Va dirigido a:

| Quién | Rol en el sistema | Para qué lo usa |
|---|---|---|
| Agente de soporte / despacho | `SUPPORT` en el panel web | Despachar, reasignar, cancelar, revisar documentos de socios, atender llamadas. |
| Responsable de guardia | `ADMIN` en el panel web | Todo lo anterior + dinero, configuración, bitácora, decisiones de excepción. |
| Guardia técnica | Acceso a Supabase (dashboard/SQL) y al VPS | Caídas de plataforma (P8), consultas técnicas. |

**Reglas de lenguaje** (en llamadas, WhatsApp y notas): la persona que pide ayuda es el **Usuario**; quien presta el servicio es el **Socio operador** (o "socio"); el código de 4 dígitos es el **PIN de confirmación**; el cliente institucional es el **MOPT**. Trata a todos de **tú**. Nunca le menciones al Usuario la comisión de Budi.

**Datos personales (Decreto 144):** lo que veas en el panel (teléfonos, direcciones, DUI) no sale del panel. No lo copies a chats personales ni lo pegues en grupos. En el simulacro usa solo datos ficticios.

---

## 2. Turnos, roles y contactos

### 2.1 Turnos

| Turno | Horario (hora de El Salvador) | Agente de soporte | Responsable de guardia (ADMIN) | Guardia técnica |
|---|---|---|---|---|
| Mañana | `[POR DEFINIR]` | `[POR DEFINIR]` | `[POR DEFINIR]` | `[POR DEFINIR]` |
| Tarde | `[POR DEFINIR]` | `[POR DEFINIR]` | `[POR DEFINIR]` | `[POR DEFINIR]` |
| Noche / madrugada | `[POR DEFINIR]` | `[POR DEFINIR]` | `[POR DEFINIR]` | `[POR DEFINIR]` |

Entrega de turno (5 min, obligatoria):

1. Abre `/admin/requests` con el filtro **Pendientes** y luego **Asignadas**, **En Camino** y **Activas**.
2. Nombra en voz alta (o en el canal del equipo) cada servicio abierto con su folio `BUDI-xxxxxx` y lo que está pendiente.
3. Revisa `/admin/verifications` → pestaña **Suspendidos** por si hubo suspensiones automáticas (el job corre a las 06:00).
4. Anota en el registro de turno `[POR DEFINIR: dónde vive — hoja compartida, canal, etc.]` quién entrega, quién recibe y los folios abiertos.

### 2.2 Contactos

| Qué | Dato | Estado |
|---|---|---|
| Línea de soporte (voz) para Usuarios y socios | `[POR DEFINIR]` | La app la ofrece en **Perfil → Ayuda y Soporte** solo si está configurada `EXPO_PUBLIC_SUPPORT_PHONE`. Sin ella, la app dice "La línea de soporte todavía no está disponible. Si es una emergencia, llama al 911." |
| WhatsApp de soporte | `[POR DEFINIR]` | Igual, con `EXPO_PUBLIC_SUPPORT_WHATSAPP` (abre `wa.me` con "Hola, necesito ayuda con Budi."). |
| Canal interno del equipo de operación | `[POR DEFINIR]` | |
| Responsable de guardia (celular) | `[POR DEFINIR]` | |
| Guardia técnica (celular) | `[POR DEFINIR]` | |
| Responsable de datos / DPO (Decreto 144) | `[POR DEFINIR]` | Ver `docs/PROTECCION_DATOS.md` §8. |
| Correo de privacidad (`privacidad@…`) | `[POR DEFINIR]` | La casilla aún no existe (PROTECCION_DATOS.md). |
| Enlace operativo con cada aseguradora | `[POR DEFINIR]` por aseguradora | |
| Enlace operativo del MOPT | `[POR DEFINIR]` | |
| Emergencias (policía, ambulancia, bomberos) | **911** | Número nacional real. La app lo tiene fijo en `apps/mobile/config/support.ts`. |
| Estado de Supabase | https://status.supabase.com | Público. |
| Estado de Expo Push | https://status.expo.dev | Público. |

> **No inventes números.** Hasta que la línea esté definida y cargada en los secretos de EAS, el Usuario no tiene cómo llamarte desde la app: tú eres quien lo llama (el teléfono del Usuario y del socio está en el detalle de la solicitud).

---

## 3. Herramientas: qué pantalla usar para qué

### 3.1 Panel web (`/admin`) — ADMIN y SUPPORT

El acceso por rol está definido en `apps/web/src/shared/lib/admin-routes.ts` y, de verdad, en la base (migración `00104_support_access.sql`).

| Pantalla | Quién | Para qué la usas en operación |
|---|---|---|
| `/admin` **Dashboard** | ADMIN, SUPPORT | Conteos por estado, "Tiempos de operación" (últimos 30 días), actividad reciente. |
| `/admin/requests` **Solicitudes** | ADMIN, SUPPORT | **Tu pantalla principal.** Se actualiza en tiempo real. Filtros: Todas · Pendientes · Asignadas · En Camino · Activas · Completadas · Canceladas. Buscador por Usuario, teléfono o dirección. Las pendientes sin socio de más de 10 min se marcan **Urgente**. Al abrir una fila ves el panel **Detalle de Solicitud**. |
| Detalle de Solicitud | ADMIN, SUPPORT | Folio `BUDI-xxxxxx`, Usuario y socio con teléfono (clic para llamar), servicio, incidente, mapa de recogida/destino, estado, cobertura, reparto de la cobertura, motivo de cancelación, **Socios operadores cercanos** (asignar), **Asignar / Reasignar manualmente**, **Motivo de la cancelación** + **Cancelar Solicitud**, **Cumplimiento de SLA** y **línea de tiempo** del caso con **Exportar JSON**. |
| `/admin/fleet` **Flota** | ADMIN, SUPPORT | Mapa de socios: **En servicio**, **Disponible**, **Sin señal** (sin ubicación hace más de 5 min), con "hace N min". |
| `/admin/users` **Usuarios** | ADMIN, SUPPORT | Buscar a una persona, ver su rol. (Cambiar rol/comisión: solo ADMIN.) |
| `/admin/verifications` **Verificaciones** | ADMIN, SUPPORT | Documentos de socios: aprobar/rechazar cada uno, fecha de vencimiento, pestañas Por revisar · **Suspendidos** · Por corregir · Aprobados. |
| `/admin/socios` **Socios interesados** | ADMIN, SUPPORT | Pre-registros de `/socios` (captación). No es de operación en vivo. |
| `/admin/ratings` **Calificaciones** | ADMIN, SUPPORT | Quejas y calificaciones bajas después del servicio. |
| `/admin/providers` **Proveedores** | ADMIN, SUPPORT | Empresas de grúas y qué servicios prestan. |
| `/admin/finance`, `/admin/cuentas` (ficha 360), `/admin/negocio` | Solo ADMIN | Dinero: liquidaciones, libro de movimientos, estados de cuenta. Se usan en disputas (P6). |
| `/admin/insurers`, `/admin/policies`, `/admin/mopt` | Solo ADMIN | Aseguradoras, pólizas/padrón, programas MOPT, objetivos de SLA por aseguradora. |
| `/admin/audit` **Bitácora** | Solo ADMIN | Quién cambió qué en configuración, roles y equipo (migr. `00094`). Útil para investigar después de un incidente. |

### 3.2 Portales de clientes institucionales

| Portal | Quién | Qué ve | Nota operativa |
|---|---|---|---|
| `/portal` (y `/portal/[folio]`) | Aseguradora (rol INSURER) | Solo **sus** casos: lista con SLA, detalle con línea de tiempo y exportación. | Owner y admin de la organización necesitan **2FA (TOTP)**: sin sesión verificada no ven nada (migr. `00113`). Se configura en `/seguridad`. |
| `/mopt` (servicios, cumplimiento, km, mapa, pagos, operadores, equipo) | MOPT | Servicios del programa, cumplimiento, km, flota propia. | Mismo 2FA que las aseguradoras. |

Si una aseguradora o el MOPT te llama por un caso, **pídele el folio** `BUDI-xxxxxx`: es el mismo que ven ellos.

### 3.3 App móvil (lo que ven los demás)

- **Usuario:** su PIN de confirmación está en la pantalla de inicio y en el historial ("PIN de confirmación para el socio"). Puede **Chat**, **Llamar** al socio y **Cancelar Solicitud**. Soporte: **Perfil → Ayuda y Soporte**. Eliminar cuenta: **Perfil → Eliminar mi cuenta**.
- **Socio operador:** **En línea / Fuera de línea**; en el servicio activo: **Navegar al usuario**, **Voy en Camino**, **Ya Llegué (Verificar PIN)**, **Completar Servicio**, **Llamar**, **Cancelar Servicio** (que en realidad **libera** la solicitud al pool, ver P4).

### 3.4 Funciones de la base que están detrás (referencia)

| Acción | RPC / job | Migración vigente | Quién |
|---|---|---|---|
| Sugerir los 3 más cercanos | `suggest_nearest_operators` | `00104` (base `00067`, `00074`, `00098`) | ADMIN, SUPPORT |
| Asignar / reasignar | `admin_assign_request` | `00112` | ADMIN, SUPPORT |
| Forzar cancelación | `admin_cancel_request(id, motivo)` | `00104` | ADMIN, SUPPORT |
| Cancelar (Usuario) / liberar al pool (socio) | `cancel_service_request` | `00109` (lógica de `00035`) | Usuario, socio |
| Verificar PIN y activar | `verify_request_pin` | `00054` | Socio asignado (ADMIN también pasa) |
| Alerta de pool estancado | `alert_stale_pool_requests` · cron `alert-stale-pool-requests` cada minuto | `00109` (base `00036`) | Sistema |
| Enviar push | `drain_notification_queue` · cron `drain-notification-queue` cada minuto → Edge `process-notification-queue` | `00033` | Sistema |
| Vencimiento de documentos | `check_operator_document_expiry` · cron diario 06:00 SV | `00114` | Sistema |
| Retención de datos | `purge_expired_personal_data` · cron diario 03:15 SV | `00111` | Sistema |
| Eliminar cuenta | Edge `delete-account` → `anonymize_account` | `00101`, `00114` | El titular |
| Línea de tiempo / SLA del caso | `get_case_timeline`, `get_case_sla` | `00065`, `00066` | ADMIN, SUPPORT, aseguradora (sus casos) |

---

## 4. Cómo sabes que algo va mal (alertas y señales)

| Señal | Dónde la ves | Qué tan confiable es hoy |
|---|---|---|
| Etiqueta **Urgente** en una solicitud **Pendiente** sin socio ≥ 10 min | `/admin/requests` (tiempo real) | **Es tu alerta principal.** Solo la ves si tienes el panel abierto. Se calcula desde la creación de la solicitud. |
| **Aviso fijo arriba del panel** (rojo: solicitudes > 10 min sin socio, servicios asignados hace > 45 min sin llegada, tareas programadas fallidas; amarillo: push que no salen, socios esperando revisión) | Cualquier pantalla de `/admin`; la pestaña muestra "(n)" con los urgentes | Se actualiza cada minuto (migr. `00117`). Solo si tienes el panel abierto, aunque sea en segundo plano. |
| Mensaje en el canal del equipo "BUDI-xxxxxx lleva más de 10 min sin socio operador" | Slack / Google Chat / Discord | Solo si la guardia técnica configuró el webhook (`ops_alert_webhook_url` en Vault). Lleva folio y tipo de servicio, sin datos personales. |
| Push "Seguimos buscando un socio operador" al Usuario (> 10 min sin actividad) | Teléfono del Usuario | Sale sola; ofrece "cancelar sin costo". Espera que el Usuario te llame o cancele después de verla. |
| Socio en **Sin señal** | `/admin/fleet` | Sin ubicación hace más de 5 min. |
| Cumplimiento de SLA en rojo | Detalle → **Cumplimiento de SLA** | Asignación: creación → asignación. Llegada: asignación → **PIN verificado**. Objetivo por defecto **10 / 45 min**; cada aseguradora puede tener el suyo. |
| Cobertura **Cobertura sin verificar** (rojo) | Tabla y detalle de solicitudes | El servicio se atendió sin poder confirmar la póliza: requiere decisión humana (P6). |
| Errores de la web / app | Sentry | Listo en código (con limpieza de tokens de la URL); falta el DSN y las reglas de alerta en sentry.io. |

**Regla:** mientras el webhook del equipo no esté configurado, **en cada turno debe haber alguien con el panel abierto en todo momento** (el aviso fijo y el "(n)" de la pestaña solo existen ahí). Si tienes que salir, avisa y entrega la pantalla.

---

## 5. Procedimientos paso a paso

Formato de cada procedimiento: **disparador → pasos → cierre**. En todos, lo primero es anotar el folio (§7).

### P1. No hay socio disponible / solicitud sin asignar > 10 min

**Disparador:** solicitud en **Pendientes** marcada **Urgente**; o el Usuario llama diciendo que nadie acepta.

1. Abre la solicitud en `/admin/requests` y anota el folio, tipo de servicio, zona y si tiene cobertura (aseguradora / MOPT / particular).
2. Mira el bloque **Socios operadores cercanos**. Lista hasta 3 socios que cumplen todo esto: en línea con ubicación de los últimos 5 min, **aprobados**, sin otro servicio en curso, que prestan ese tipo de servicio y, si es del MOPT, que son de la flota del programa. La distancia es **en línea recta**, no por carretera.
3. Si hay candidatos: **antes de asignar, llama al socio** (su teléfono está en `/admin/users` o en la flota) y confirma que puede ir y en cuánto llega. Luego pulsa **Asignar** junto a su nombre. El socio recibe el servicio en la app.
4. Si el bloque dice "No hay socios operadores en línea disponibles cerca":
   1. Abre `/admin/fleet` y busca socios **Disponible** o **Sin señal** cerca de la zona.
   2. Llama a los socios de la zona que estén fuera de línea y pregunta si pueden atender. Si aceptan, pídeles que se pongan **En línea**.
   3. Asigna con **Asignar manualmente** (lista desplegable). Esta lista muestra **a todos los socios**, incluso fuera de línea, y **no filtra suspendidos ni no aprobados**: antes de elegir, confirma en `/admin/verifications` que el socio está **Aprobado**. Si la lista dice "— no presta este servicio", el sistema te pedirá confirmar ("Asignar de todos modos"): hazlo solo si hablaste con el socio y tiene el equipo adecuado.
   4. Para servicios del MOPT el sistema **no deja** asignar un socio fuera del programa ("Ese socio operador no pertenece al programa de este servicio"). Escala al enlace del MOPT.
5. Llama al Usuario: dile quién va y un tiempo estimado realista. Si no hay a nadie, díselo con claridad y ofrécele esperar (con un nuevo contacto en N minutos) o cancelar sin costo.
6. Si a los **20 min** desde la creación sigue sin socio: escala al responsable de guardia (§6). Si el Usuario está en un lugar peligroso (carretera, de noche, solo), trátalo como P5 y recomiéndale llamar al 911.
7. Si el Usuario decide no esperar: escribe el **Motivo de la cancelación** (p. ej. "Sin socios disponibles en la zona, el Usuario desiste") y pulsa **Cancelar Solicitud**.

**Cierre:** folio, socios contactados (quién, hora, respuesta), a quién asignaste y a qué hora, o motivo de cancelación.

### P2. El Usuario no responde o no aparece

**Disparador:** el socio llegó (o está llegando) y no encuentra al Usuario, o el Usuario no contesta.

1. Pide al socio que llame al Usuario desde la app (**Llamar**) y le escriba por el **Chat** de la app. Que espere en el punto.
2. Llama tú al Usuario al teléfono del detalle de la solicitud. Intenta **3 veces en 10 minutos**.
3. Verifica con el socio que está en el punto correcto: compara con el mapa del detalle (recogida). Si la dirección es ambigua, confirma con el socio lo que ve.
4. Si el Usuario contesta: coordina el punto de encuentro y sigue.
5. Si **a los 15 min** de la llegada del socio no hay contacto:
   1. Pide al socio una descripción de lo que ve (¿está el vehículo?, ¿hay señales de accidente?). Si hay señales de emergencia, pasa a **P5**.
   2. Si no hay nada que atender: escribe el motivo ("Usuario no localizado tras 3 llamadas y 15 min de espera en el punto") y pulsa **Cancelar Solicitud**. No le pidas al socio que "cancele" él: eso **libera** la solicitud al pool y otro socio iría al mismo punto vacío.
6. El cobro por desplazamiento: la app le advierte al Usuario que cancelar después del despacho "puede generar un cargo", pero **no hay cargo automático implementado (PENDIENTE)**. Si el socio reclama el desplazamiento, pásalo al responsable de guardia (P6).

**Cierre:** folio, horas de las llamadas, tiempo de espera, lo que reportó el socio, quién canceló y por qué.

### P3. El PIN de confirmación falla o queda bloqueado

**Cómo funciona hoy** (`verify_request_pin`, versión vigente en `00054_lock_down_client_writes.sql`):

- El Usuario ve su PIN de 4 dígitos en la app; el socio lo escribe al llegar (**Ya Llegué (Verificar PIN)**). Si es correcto, el servicio pasa a **Activo** en la misma operación.
- Tras **5 intentos fallidos en 15 minutos** el PIN queda **bloqueado**. El socio ve "Bloqueado temporalmente… Intenta de nuevo en N minutos". Cada intento durante el bloqueo **lo alarga**. El bloqueo se levanta solo cuando pasan 15 min desde el último intento fallido.
- Nadie en el panel puede ver el PIN (solo existe su hash) y **no hay botón para activar sin PIN**.
- En el detalle de la solicitud, el recuadro **PIN de confirmación** muestra los intentos fallidos, si está bloqueado y hasta qué hora, y cuántas veces el Usuario generó un PIN nuevo (migr. `00120`).
- El personal puede **desbloquear** el PIN con una nota de qué confirmó (queda en la línea de tiempo como "Budi desbloqueó el PIN de confirmación"; la nota no la ve la aseguradora).
- El Usuario que perdió el PIN puede **generar uno nuevo** desde su app (hasta 3 por servicio). Al socio le llega el aviso de que cambió.

**Pasos:**

1. Pide al socio que **deje de intentar**. Cada intento de más alarga el bloqueo.
2. Llama al Usuario y pídele que abra la app: el PIN está en la pantalla de inicio ("PIN de confirmación para el socio") o en el historial. Pídele que **se lo dicte en persona al socio**, no a ti. Tú nunca debes conocer el PIN.
3. Errores típicos a revisar: el Usuario está leyendo el PIN de **otra** solicitud (del historial); el socio abrió otro servicio; el socio y el Usuario no están en el mismo servicio (compara el folio o el nombre del Usuario en ambas apps).
4. Si está bloqueado: se libera solo en **15 minutos sin intentos**. Si ya confirmaste por teléfono con el Usuario que está junto al socio y tiene el PIN correcto, **desbloquéalo** desde el recuadro **PIN de confirmación** escribiendo qué confirmaste. Si no lo confirmaste, no desbloquees. Mientras tanto el socio **no debe mover el vehículo**.
5. Si el Usuario **no tiene el PIN** (cambió de teléfono, reinstaló la app, lo borró): pídele que abra la app en la pantalla de inicio. Donde estaba el PIN verá **"¿Perdiste el PIN de confirmación?"** con el botón **Generar PIN nuevo**. El anterior deja de servir y al socio le llega el aviso. Si ya generó 3, o no puede entrar a la app, escala al responsable de guardia, que puede cancelar con el motivo "PIN no disponible — se crea una nueva" y reasignar la nueva solicitud al mismo socio.
   - **No fuerces el estado del servicio por SQL.** Rompe la trazabilidad del PIN, el SLA de llegada y lo que ve la aseguradora.
6. Si sospechas fraude (alguien que no es el Usuario intenta llevarse el vehículo, o el socio insiste en intentar sin el Usuario presente): no autorices nada, cancela con motivo y escala al responsable de guardia.

**Cierre:** folio, hora del bloqueo, causa (error de lectura, PIN perdido, sospecha), cómo se resolvió. El SLA de llegada seguirá corriendo mientras el PIN no se verifique: anótalo para explicarlo si la aseguradora pregunta.

### P4. El socio no llega, se le cae la app o pierde señal

**Disparador:** el SLA de llegada se acerca a 45 min; el Usuario llama porque el socio no aparece; o el socio figura **Sin señal** en `/admin/fleet`.

1. Abre el detalle y mira el **Cumplimiento de SLA** y la línea de tiempo (¿marcó "en camino"?, ¿a qué hora se asignó?).
2. Revisa `/admin/fleet`: ¿el socio aparece **En servicio** con ubicación reciente, o **Sin señal** (más de 5 min sin ubicación)?
3. Llama al socio.
   - **Contesta y va en camino:** pide un tiempo estimado real y pásaselo al Usuario. Si su app se cayó, que la vuelva a abrir; el servicio sigue asignado a él. Si no puede reabrirla, puede atender y, al llegar, verificar el PIN apenas recupere la app.
   - **Contesta y no puede ir:** pídele que pulse **Cancelar Servicio** con el motivo. Eso **libera** la solicitud: vuelve a **Pendientes**, el Usuario recibe "Buscando otro socio operador" y ese socio ya no la vuelve a ver. Luego sigue **P1**. Si el socio no puede operar la app, **reasigna tú** directamente (paso 4).
   - **No contesta:** dos intentos en 5 minutos.
4. Si no contesta o el retraso ya no es aceptable: con la solicitud en **Asignada** o **En Camino**, usa **Socios operadores cercanos** o **Reasignar manualmente** (sigue las precauciones de P1). La reasignación es posible mientras el servicio no esté **Activo**.
5. Si el servicio ya está **Activo** (PIN verificado, el vehículo está con el socio) y pierdes contacto con el socio: **no se puede reasignar**. Llama al Usuario, confirma dónde está su vehículo y escala **de inmediato** al responsable de guardia. Si hay indicios de robo o de que el vehículo desapareció, pasa a **P5**.
6. Avisa al Usuario de cada cambio (nuevo socio, nuevo tiempo).

**Cierre:** folio, hora de detección, intentos de contacto, si se liberó o reasignó (a quién y a qué hora), impacto en el SLA.

### P5. Incidente en ruta (accidente, agresión, daño al vehículo)

**Disparador:** cualquier reporte de accidente, lesión, amenaza, agresión, robo o daño al vehículo del Usuario, del socio o de terceros.

**Primero la vida, después la plataforma.**

1. Pregunta: **¿hay alguien herido o en peligro ahora?** Si sí, indica a la persona que **llame al 911 de inmediato** (o llama tú si ella no puede, dando la ubicación del detalle de la solicitud). No sigas con el trámite hasta que la ayuda esté en camino.
2. Pide a la persona que se ponga a salvo (fuera de la vía, luces de emergencia, lejos del agresor). No le pidas al socio que enfrente a nadie.
3. Avisa al **responsable de guardia** por teléfono en los primeros 10 minutos.
4. Si el servicio no ha empezado y ya no se puede prestar: cancela con motivo ("Incidente en ruta: …"). Si el socio tuvo el accidente yendo al punto, reasigna otro socio para el Usuario (P1/P4) si la situación del Usuario lo permite.
5. **No borres ni canceles nada que sirva de evidencia** antes de exportarla: en el detalle, pulsa **Exportar JSON** de la línea de tiempo y guárdalo en la carpeta de incidentes `[POR DEFINIR]`. El recorrido GPS se borra solo a los **90 días** (migr. `00111`) y el chat a los **12 meses**: si hay denuncia o reclamo, pide a la guardia técnica que respalde el recorrido y el chat de ese servicio antes de ese plazo.
6. Registra (en el registro de turno y en el caso):
   - Folio, hora de la llamada, quién reporta y su rol (Usuario / socio / tercero).
   - Ubicación (la del detalle o la que te dan), qué pasó, heridos, si se llamó al 911 y a qué hora, número de denuncia o de parte policial si lo hay.
   - Daños: al vehículo del Usuario (antes o durante el remolque), a la grúa, a terceros. Pide fotos al socio y al Usuario por WhatsApp de soporte `[POR DEFINIR]`.
   - Si el servicio es de aseguradora o del MOPT: avisa a su enlace en las primeras 2 horas con el folio.
7. Si el socio es el agresor o causó daño por negligencia: el responsable de guardia puede **suspenderlo** (ver P7, suspensión manual) mientras se investiga.
8. **PENDIENTE:** botón SOS en la app (se retiró) y un formulario de incidente en el panel. Hoy el registro es manual.

**Cierre:** reporte de incidente completo, evidencia exportada, a quién se escaló, acciones sobre el socio.

### P6. Disputa de cobro o de cobertura (aseguradora / MOPT)

**Disparador:** el Usuario reclama un cobro, el socio reclama una liquidación, una aseguradora o el MOPT cuestionan un caso, o un caso quedó con **Cobertura sin verificar**.

1. Pide el **folio** y abre el caso en `/admin/requests` (búscalo por el nombre o teléfono del Usuario).
2. Reúne los datos del caso:
   - Cobertura: **Con cobertura / Particular / Cobertura vencida / Cobertura sin verificar**.
   - **Reparto de la cobertura** (solo en servicios completados): cuánto paga la aseguradora, cuánto el afiliado (copago), km por encima de los incluidos, tope por evento, eventos usados del año.
   - Línea de tiempo y SLA (¿se cumplió el objetivo pactado?).
3. **Soporte (SUPPORT) no ve dinero.** Si el reclamo es de montos, liquidaciones o estados de cuenta, pásalo al responsable de guardia (ADMIN): `/admin/finance`, `/admin/cuentas` (ficha 360) y, para aseguradoras, `/admin/insurers` y `/admin/policies`.
4. **Cobertura sin verificar:** el servicio se atendió "en falla abierta" (no se pudo consultar la póliza). El ADMIN revisa al afiliado en el padrón de la aseguradora y decide quién paga. Documenta la decisión.
5. **Aseguradora cuestiona el SLA:** exporta la línea de tiempo (**Exportar JSON**) y compárala con sus objetivos (en `/admin/insurers`, por defecto 10 min asignación / 45 min llegada). Recuerda: la "llegada" termina cuando se verifica el PIN, así que un PIN bloqueado (P3) alarga la llegada medida.
6. **MOPT:** los servicios del programa son cortesía para el Usuario. Si el Usuario dice que le cobraron un servicio del MOPT, escala al ADMIN y al enlace del MOPT. El MOPT ve lo mismo en `/mopt/servicios` y `/mopt/cumplimiento`.
7. No corrijas montos "a mano" en la base. Cualquier ajuste lo decide el ADMIN; el mecanismo formal de notas de crédito/ajustes **no está construido (PENDIENTE)**.
8. Responde al reclamante en el plazo pactado `[POR DEFINIR]`, con el folio y la explicación.

**Cierre:** folio, reclamo, datos revisados, decisión, quién decidió, respuesta enviada.

### P7. Documento de socio vencido o socio suspendido

**Cómo funciona hoy** (`check_operator_document_expiry`, migr. `00114`, corre todos los días a las **06:00**):

- **15 días antes** de que venza la licencia, la tarjeta de circulación o el seguro, el socio recibe "Un documento está por vencer".
- **El día del vencimiento** el socio aprobado pasa a **Suspendido**, se le pone **fuera de línea** y recibe "Cuenta en pausa: se venció tu …". No vuelve a recibir solicitudes.
- **Se reactiva solo** cuando el personal aprueba el documento renovado y todos los obligatorios están aprobados y vigentes ("Cuenta reactivada").

**Pasos (revisión diaria, turno de la mañana):**

1. Abre `/admin/verifications` → **Suspendidos**. Anota a los suspendidos del día.
2. Si el socio tiene un servicio en curso al suspenderse: el servicio **sigue asignado** (la suspensión no lo cancela). Confirma con el socio que lo termine; si no puede, libera o reasigna (P4).
3. Contacta al socio (teléfono) y pídele que suba el documento renovado desde la app (su registro).
4. Cuando lo suba: ábrelo en **Verificaciones**, compara el documento, **corrige la fecha de vencimiento** si la leída no coincide, y pulsa aprobar. Si está mal, recházalo con una nota concreta de qué corregir (es obligatoria).
5. Si al aprobar el sistema dice que faltan documentos, el socio no se reactiva hasta que todos los obligatorios (DUI frente y reverso, licencia, NIT, tarjeta de circulación, foto de la unidad, seguro) estén aprobados y vigentes.

**Suspensión manual** (por incidente, queja grave o sospecha de fraude): en `/admin/verifications` → **Aprobados**, abre al socio, escribe el motivo y pulsa **Pausar cuenta**. El socio recibe el motivo, deja de recibir solicitudes y no se le puede asignar ninguna (la base lo rechaza). Si tiene un servicio en curso, ese sigue: revísalo en Solicitudes. Para reactivarlo, **Activar cuenta** (exige todos los documentos aprobados y vigentes). Decide con el responsable de guardia antes de pausar.

**Cierre:** socio, documento, fecha de vencimiento, fecha de reactivación o motivo de la suspensión.

### P8. Caída de la plataforma (Supabase, Edge Functions, push)

**Disparador:** el panel no carga o da errores; varios Usuarios o socios reportan que la app no funciona; los socios no reciben solicitudes; las push no llegan.

**1. Confirma el alcance (agente de soporte, 5 min):**

1. ¿El panel `/admin` carga? ¿Carga `/admin/requests` con datos?
2. ¿Afecta a todos o a una persona? Pide a un segundo usuario de prueba `[POR DEFINIR: cuenta de prueba en producción]` que entre a la app.
3. Mira https://status.supabase.com y https://status.expo.dev.
4. Avisa a la guardia técnica con: hora de inicio, síntoma, a quién afecta.

**2. Diagnóstico (guardia técnica):**

| Síntoma | Qué revisar | Cómo |
|---|---|---|
| El panel web no carga | Contenedor web y Caddy en el VPS | `docker compose -f docker-compose.prod.yml logs -f web` y `… logs -f caddy`; reiniciar: `… restart web` (ver `docs/DEPLOY_VPS.md` §7). |
| Nada funciona en web ni app | Supabase (base, Auth, API) | Dashboard de Supabase → estado del proyecto; status.supabase.com. |
| Distancia/precio/ETA fallan | Edge Functions `calculate-distance`, `get-eta` | Dashboard de Supabase → Edge Functions → Logs. Redeploy: `supabase functions deploy <nombre> --project-ref <ref>`. |
| Las push no llegan | Cola y cron | SQL abajo. |
| Nadie ve alertas de pool | Cron `alert-stale-pool-requests` | SQL abajo. |

Consultas (SQL editor de Supabase, solo guardia técnica):

```sql
-- ¿Corren los jobs? (último resultado de cada uno)
select j.jobname, d.status, d.start_time, d.return_message
  from cron.job j
  left join lateral (
    select * from cron.job_run_details r where r.jobid = j.jobid
    order by start_time desc limit 1) d on true
 order by j.jobname;

-- ¿Se atascó la cola de push? (pendientes y la más vieja)
select count(*) as pendientes, min(created_at) as mas_vieja
  from notification_queue where sent = false;

-- Últimas llamadas a process-notification-queue (se espera 200)
select status_code, content, created from net._http_response order by created desc limit 5;

-- Errores al enviar
select created_at, title, error from notification_queue
 where error is not null order by created_at desc limit 20;
```

Interpretación (detalle en `docs/NOTIFICACIONES.md`):

- Pendientes creciendo y **sin** filas nuevas en `net._http_response`: faltan los secretos de Vault (`edge_functions_url`, `service_role_key`) o el cron no corre.
- `sent = true` **no** significa entregada: si la persona no tiene token de push activo, se marca como procesada sin enviarse.
- Respuestas 401/500: revisar la Edge Function `process-notification-queue` y la llave.

**3. Operar en modo degradado mientras se arregla:**

1. Si el panel funciona pero la push no: los socios no se enteran de solicitudes nuevas. **Llama** a los socios disponibles de la zona por cada solicitud pendiente y asigna manualmente (P1).
2. Si el panel no funciona: atiende por teléfono/WhatsApp `[POR DEFINIR]`, anota cada solicitud en el registro de turno (nombre, teléfono, ubicación, tipo de servicio, hora) y despacha llamando a los socios. Cuando vuelva la plataforma, **no** crees servicios retroactivos sin decisión del responsable de guardia.
3. Si una aseguradora o el MOPT tienen casos en curso afectados, avísales en la primera hora.

**4. Escalamiento:** agente → guardia técnica (inmediato) → responsable de guardia (si pasa de 15 min) → soporte de Supabase `[POR DEFINIR: plan y canal de soporte contratado]`.

**5. Si sospechas una brecha de seguridad** (datos expuestos, accesos raros en la bitácora): sigue `docs/PROTECCION_DATOS.md` §9. Plazo legal para notificar: **72 horas** desde la detección.

**Cierre:** hora de inicio y fin, causa, servicios afectados (folios), acciones, qué se hará para que no se repita.

### P9. Solicitud de eliminación de datos (Decreto 144)

**Disparador:** un Usuario o socio pide borrar su cuenta o sus datos (por teléfono, WhatsApp, correo o en redes).

1. **La vía normal es autoservicio.** Indícale:
   - En la app: **Perfil → Eliminar mi cuenta**.
   - En la web: `/eliminar-cuenta` (inicia sesión y confirma).
2. Explica qué pasa (lo dice la página): se borran nombre, teléfono, correo, DUI, vehículos, fotos y documentos; no podrá volver a entrar con esa cuenta. Los registros de servicios prestados y cobrados se conservan **anonimizados** por obligación contable.
3. Si tiene un **servicio en curso**, el sistema no lo deja ("Tienes un servicio en curso. Termínalo o cancélalo antes de eliminar tu cuenta."). Ayúdalo a cerrar o cancelar ese servicio primero.
4. Si **no puede** hacerlo él mismo (perdió acceso, no tiene la app): no hay en el panel una opción para eliminar la cuenta de otra persona **(PENDIENTE)**. Registra la solicitud y pásala al responsable de datos `[POR DEFINIR]`, que la atiende según `docs/PROTECCION_DATOS.md` §8: acreditar identidad, registrar fecha, resolver en **≤ 20 días hábiles**, gratis, e informar del derecho a reclamar ante la ACE.
5. Cuentas de aseguradora, MOPT, soporte o admin **no se eliminan desde la app** ("Esta cuenta la administra Budi"): las da de baja el ADMIN (y, en portales, el owner de la organización).
6. Otras solicitudes ARCO-POL (acceso, rectificación, portabilidad, oposición): regístralas y pásalas al responsable de datos. No entregues datos por teléfono.
7. Retención automática ya activa (migr. `00111`): el recorrido GPS se borra a los **90 días** del cierre y el chat a los **12 meses**.

**Cierre:** fecha de la solicitud, canal, quién la pidió (sin copiar su DUI), vía usada (autoservicio / responsable de datos), fecha de resolución.

---

## 6. Tabla de escalamiento y tiempos objetivo

Los objetivos de servicio salen del sistema: **10 min para asignar** y **45 min para llegar** (por defecto de la plataforma, migr. `00066`; cada aseguradora puede tener los suyos en `/admin/insurers`).

| Situación | Tiempo objetivo de respuesta de soporte | Escala a responsable de guardia si… | Escala a guardia técnica si… | Avisa al cliente institucional si… |
|---|---|---|---|---|
| P1 Sin socio | Actuar al ver **Urgente** (min 10) | A los **20 min** sin asignar, o el Usuario está en riesgo | — | El caso es de aseguradora/MOPT y se incumplirá el SLA de asignación |
| P2 Usuario no aparece | Llamar en **≤ 5 min** del aviso del socio | Cancelación con reclamo de desplazamiento | — | Caso de aseguradora/MOPT cancelado |
| P3 PIN bloqueado / perdido | **≤ 5 min** | PIN perdido o sospecha de fraude | — | La llegada medida se pasará del objetivo |
| P4 Socio no llega / sin señal | **≤ 5 min** desde la alerta | Servicio **Activo** sin contacto con el socio (inmediato); o a **40 min** de la asignación sin llegar | — | Se incumplirá el SLA de llegada (45 min) |
| P5 Incidente | **Inmediato** (911 primero) | **Siempre**, en ≤ 10 min | Hay que respaldar evidencia (recorrido/chat) | **Siempre**, en ≤ 2 h |
| P6 Disputa | Acuse en `[POR DEFINIR]` | Siempre que haya montos | — | Si el reclamo viene de ellos o les afecta |
| P7 Documento vencido | Revisión diaria, turno mañana | Suspensión manual o socio con servicio en curso | — | Socio de la flota del MOPT |
| P8 Caída | **≤ 5 min** para confirmar alcance | A los **15 min** sin resolver | **Inmediato** | En la primera hora si hay casos en curso |
| P9 Eliminación de datos | Acuse en ≤ 1 día hábil | Cuando no pueda hacerlo por autoservicio | — | — |

Cadena: **Agente de soporte → Responsable de guardia (ADMIN) → Guardia técnica / Dirección `[POR DEFINIR]`**.

---

## 7. Qué registrar en cada caso

**Siempre con el folio** `BUDI-xxxxxx` (aparece en el detalle de la solicitud y es el mismo que ven la aseguradora y el MOPT). Si una solicitud muy vieja no tiene folio, usa los primeros 8 caracteres del id que muestra el panel.

Qué deja el sistema solo (no hace falta anotarlo):

- Creación, asignación, en camino, PIN verificado, precio, cancelación (con quién y motivo), calificación → **línea de tiempo del caso**.
- Cambios de configuración, roles y equipo → **Bitácora** (`/admin/audit`).

Qué anotas **en el sistema**: en el detalle de la solicitud, **Notas internas** (migr. `00120`): llamadas, acuerdos, incidentes. Solo las ve el equipo de Budi, quedan con tu nombre y la hora, y no se pueden editar ni borrar. Escribe hechos, sin datos personales que no hagan falta. Ahí mismo tienes el **Chat del servicio** y el **Recorrido del socio** en un mapa.

Qué **no** queda en el sistema y tienes que anotar tú:

- Llamadas (a quién, hora, resultado), mensajes de WhatsApp, acuerdos verbales.
- Socios contactados que no aceptaron.
- Decisiones de excepción y quién las autorizó.
- Incidentes (P5) y datos de denuncias.

**No hay campo de notas en el caso (PENDIENTE).** Hasta que exista, usa:

1. El **Motivo de la cancelación** cuando canceles (sí queda en la línea de tiempo): sé específico.
2. El registro de turno `[POR DEFINIR]` con esta plantilla:

```
Folio: BUDI-______   Procedimiento: P_   Turno: ______   Agente: ______
Hora de detección: __:__   Hora de cierre: __:__
Qué pasó:
Acciones (hora — acción — resultado):
  __:__ —
Escalado a (quién, hora):
Decisión de excepción (quién autorizó):
Evidencia (JSON exportado, fotos, n.º de denuncia):
Pendiente para el siguiente turno:
```

No anotes el PIN, el DUI completo ni datos de salud en el registro de turno.

---

## 8. Guion de simulacro

**Objetivo:** probar este runbook con el equipo antes del lanzamiento (criterio de aceptación de LAN-04). **Duración:** 90 min. **Entorno:** staging o local, **nunca producción**, con datos ficticios (ver `docs/test-users.md`).

### 8.1 Preparación (el día antes)

1. Asigna los papeles: **director del simulacro** (inyecta los eventos y mide), **agente de soporte** (cuenta SUPPORT), **responsable de guardia** (cuenta ADMIN), **Usuario** (teléfono o emulador con la app, cuenta USER), **2 socios** (teléfonos/emuladores, cuentas OPERATOR aprobadas), **guardia técnica** (acceso al SQL de staging).
2. Completa los `[POR DEFINIR]` de §2 o pon valores de prueba y márcalos como tales.
3. Verifica que los crons corran en staging (consulta de §P8) y que haya una aseguradora de prueba con objetivos de SLA.
4. Ten un cronómetro y la tabla de §8.3 impresa o compartida.

### 8.2 Escenarios

**E1 — Nadie acepta (P1).** 20 min.

1. El Usuario pide una grúa. Ambos socios están **Fuera de línea**.
2. El director espera. Observa: ¿cuánto tarda el agente en ver **Urgente**? ¿Lo vio porque tenía el panel abierto?
3. El agente sigue P1: bloque de cercanos vacío → flota → llama al socio 1 → le pide ponerse en línea → asigna.
4. Variante: el agente intenta asignar al socio 2, que el director dejó **suspendido** en staging. Observa si el agente revisa Verificaciones antes (la lista manual no lo filtra).
5. **Qué observar:** tiempo hasta la asignación, si llamó al socio antes de asignar, si informó al Usuario, si anotó con el folio.

**E2 — PIN bloqueado y socio que no llega (P3 + P4).** 25 min.

1. Solicitud asignada al socio 1. El socio marca **Voy en Camino** y luego apaga el teléfono (pierde señal).
2. El director avisa "el Usuario llama: nadie llega". El agente sigue P4: flota (**Sin señal** tras 5 min), llamadas, **reasigna** al socio 2 con **Socios operadores cercanos**.
3. El socio 2 llega y escribe el PIN mal 5 veces (a propósito).
4. El agente sigue P3: detiene los intentos, pide al Usuario que dicte el PIN en persona, explica los 15 min de espera.
5. Variante: el Usuario "perdió" el PIN. Observa si el responsable de guardia aplica la salida de P3 paso 5 sin forzar el estado.
6. **Qué observar:** que la reasignación se hiciera antes de 45 min, que nadie en soporte pidiera el PIN, el efecto en **Cumplimiento de SLA**.

**E3 — Incidente en ruta (P5).** 20 min.

1. Servicio **Activo** (PIN verificado). El socio 2 llama: "me chocaron en la carretera, el vehículo del Usuario va en la plataforma, hay un herido leve".
2. El agente sigue P5: 911 primero, responsable de guardia en ≤ 10 min, **Exportar JSON**, registro del incidente, aviso a la aseguradora de prueba.
3. **Qué observar:** si la primera pregunta fue por heridos, tiempo hasta avisar al responsable, si exportó la evidencia antes de cancelar nada, calidad del registro.

**E4 — Caída de push (P8).** 20 min.

1. La guardia técnica "rompe" el envío en staging (p. ej. renombra el secreto `edge_functions_url` en Vault) sin avisar al agente.
2. El Usuario pide un servicio. Los socios en línea no reciben push.
3. El director avisa "los socios dicen que no les llega nada". El agente sigue P8: confirma alcance, avisa a la guardia técnica, pasa a modo degradado (llama y asigna).
4. La guardia técnica diagnostica con las consultas de P8 (pendientes creciendo, sin respuestas HTTP), restaura el secreto y confirma que la cola se vacía.
5. **Qué observar:** tiempo de detección, si el agente siguió despachando por teléfono, si las consultas bastaron para diagnosticar.

### 8.3 Tabla de resultados

| Escenario | Tiempo objetivo | Tiempo real | ¿Se siguió el procedimiento? (Sí / Parcial / No) | Qué falló o faltó | Cambio al runbook / al producto | Responsable |
|---|---|---|---|---|---|---|
| E1 Nadie acepta | Asignar ≤ 10 min tras **Urgente** | | | | | |
| E1 variante (socio suspendido) | No asignarlo | | | | | |
| E2 Socio sin señal | Reasignar antes de 45 min desde la asignación | | | | | |
| E2 PIN bloqueado | Resolver sin conocer el PIN | | | | | |
| E2 variante (PIN perdido) | Nuevo servicio autorizado, sin forzar estado | | | | | |
| E3 Incidente | 911 inmediato · responsable ≤ 10 min · evidencia exportada | | | | | |
| E4 Caída de push | Detección ≤ 10 min · diagnóstico ≤ 15 min | | | | | |

### 8.4 Cierre del simulacro (15 min)

1. Repasa la tabla. Cada "No" o "Parcial" genera un cambio al runbook o un ítem del backlog.
2. Actualiza este documento (versión y fecha arriba) y anota aquí:

| Fecha del simulacro | Participantes | Resultado | Cambios aplicados |
|---|---|---|---|
| `[POR DEFINIR]` | | | |

3. LAN-04 queda cumplido cuando hay una fila en esta tabla con resultado aceptable y los cambios aplicados.

---

## 9. Pendientes del producto que afectan la operación

Hallados al escribir este runbook. No los prometas mientras sigan abiertos.

| # | Pendiente | Impacto en la operación | Dónde |
|---|---|---|---|
| 1 | ~~La alerta de pool estancado no le llegaba a nadie.~~ **Resuelto (00117):** aviso fijo en el panel para ADMIN y SUPPORT + webhook opcional. Falta configurar el webhook. | Sin webhook, hay que tener el panel abierto. | `staff_ops_alerts`, `notify_ops` |
| 2 | Línea de soporte y WhatsApp sin configurar (`EXPO_PUBLIC_SUPPORT_PHONE`, `EXPO_PUBLIC_SUPPORT_WHATSAPP`). | El Usuario no puede contactar a soporte desde la app. | LAN-04; `apps/mobile/config/support.ts` |
| 3 | ~~Se podía asignar a un socio suspendido o no aprobado.~~ **Resuelto (00117):** la base lo rechaza y la lista solo muestra aprobados. | — | `admin_assign_request` |
| 4 | ~~Sin forma de recuperar el PIN.~~ **Resuelto (00120):** el Usuario genera uno nuevo (máx. 3) y el personal desbloquea con nota. No hay activación sin PIN, a propósito. | — | `regenerate_my_request_pin`, `staff_reset_pin_lockout` |
| 5 | ~~Sin notas en el caso.~~ **Resuelto (00120):** Notas internas en el detalle. Sigue sin haber un formulario de incidente estructurado. | Los incidentes se anotan como texto libre. | `staff_add_request_note` |
| 6 | ~~Sin botón para suspender.~~ **Resuelto:** **Pausar cuenta** en Verificaciones. | — | `AdminVerificationsPage.tsx` |
| 7 | Sin botón SOS en la app (se retiró `SosButton`). | En una emergencia el Usuario debe marcar el 911 por su cuenta. | App móvil |
| 8 | Sin cargo por cancelación tardía aunque la app lo advierte. | Reclamos de desplazamiento sin regla. | `apps/mobile/lib/cancellation.ts` |
| 9 | Sin flujo en el panel para eliminar la cuenta de un tercero ni casilla `privacidad@`. | Las solicitudes ARCO-POL dependen del responsable de datos. | `docs/PROTECCION_DATOS.md` §8 |
| 10 | ~~Sin forma de restablecer el 2FA.~~ **Resuelto (00120):** solo ADMIN, en el equipo del portal (aseguradora o MOPT) → **Restablecer 2FA** con el motivo de cómo verificó a la persona; cierra sus sesiones y queda en la Bitácora. | — | `admin_reset_mfa` |
| 11 | Sentry listo en código; falta DSN y reglas de alerta. | Errores invisibles hasta configurarlo. | LAN-03; `docs/DEPLOY_VPS.md` |
| 12 | ~~El personal no veía chat ni recorrido.~~ **Resuelto (00120):** ADMIN y SUPPORT los ven en el detalle. | — | `RequestOpsPanels.tsx` |
