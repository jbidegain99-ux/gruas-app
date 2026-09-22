# Budi — Baseline de protección de datos (Decreto 144)

> Entregable **B-07** del backlog (`docs/backlog-aseguradoras.html`).
> Cubre los cuatro criterios del ítem: **DPO designado**, **texto de consentimiento
> visible al usuario**, **política de retención escrita** y **checklist RLS iniciado**.
>
> Creado: 2026-08-26

> [!IMPORTANT]
> Este documento lo redactó el equipo técnico a partir de fuentes públicas sobre la
> ley. **No es asesoría legal.** Antes de publicarlo debe revisarlo un abogado
> salvadoreño, en particular los plazos de retención y el texto del aviso de
> privacidad. Lo que sí es verificable aquí y ya está hecho es la parte técnica
> (el checklist RLS de la sección 7).

---

## 1. Marco legal aplicable

La **Ley para la Protección de Datos Personales** (Decreto Legislativo **N.º 144**,
del 12 de noviembre de 2024) está **vigente desde el 24 de noviembre de 2024**.
Aplica a toda persona natural o jurídica, pública o privada, que trate datos
personales — Budi entra de lleno.

Obligaciones que nos alcanzan directamente:

| Obligación | Qué exige |
|---|---|
| **Delegado de Protección de Datos (DPO)** | Designarlo. Supervisa el cumplimiento, atiende solicitudes de titulares y es el enlace con la **Agencia de Ciberseguridad del Estado (ACE)**. |
| **Base de licitud** | Todo tratamiento necesita una: consentimiento informado, ejecución de contrato, obligación legal, interés vital, interés público o interés legítimo. |
| **Consentimiento** | Libre, informado y específico. **Por escrito** para datos sensibles. |
| **Derechos ARCO-POL** | Acceso, Rectificación, Cancelación, Oposición + **P**ortabilidad, **O**lvido digital y **L**imitación temporal del uso. |
| **Plazo de respuesta** | Perentorio, en general **20 días hábiles**, gratuito y por vía accesible. |
| **Brechas de seguridad** | Notificar en un **máximo de 72 horas** desde la detección a la ACE, a la Fiscalía General y a los titulares afectados. |
| **Aviso de privacidad** | Detallado y accesible. |
| **Seguridad** | Medidas técnicas y organizativas adecuadas. |
| **Sanciones** | Infracciones leves / graves / muy graves; multas del orden de **1 a 40 salarios mínimos**, más eventual responsabilidad penal. |

---

## 2. Responsable del tratamiento y DPO

| Campo | Valor |
|---|---|
| Responsable | _(razón social y NIT — **pendiente**)_ |
| Domicilio | _(**pendiente**)_ |
| **Delegado de Protección de Datos** | **_(pendiente de designar — ver §9)_** |
| Correo de contacto para datos | `privacidad@` _(dominio pendiente)_ |
| Canal alterno | Teléfono de soporte _(hoy es un placeholder en la app)_ |

> El DPO es **obligatorio** y es el único campo de este documento que no puede
> quedar en blanco al publicarlo: es la persona a la que la ACE y los titulares
> le escriben.

---

## 3. Inventario de datos personales

Levantado de la base real (no del diseño), a 2026-08-26.

### 3.1 Datos identificativos y de contacto

| Tabla | Campos | Titular |
|---|---|---|
| `profiles` | `full_name`, `phone`, `email` | Usuarios y operadores |
| `vehicles` | `plate`, `make`, `model`, `color` | Usuarios |
| `device_tokens` | `expo_push_token`, `device_type` | Ambos |

### 3.2 Documentos de identidad — sensibilidad alta

| Tabla / almacén | Contenido |
|---|---|
| `operator_documents` + buckets privados `id-documents`, `vehicle-documents` | **DUI (frente y reverso), licencia de conducir, tarjeta de circulación**; opcionales: foto de la grúa, seguro |
| `profile_sensitive` | Número de DUI y ruta del documento. Tabla aparte desde la migración 00042: RLS la limita al titular y al admin (§7.3) |

### 3.3 Geolocalización — sensibilidad alta

| Tabla | Contenido |
|---|---|
| `operator_locations` | Posición **en vivo** del operador (lat, lng, rumbo, velocidad) |
| `service_location_trail` | **Recorrido histórico** completo de cada servicio |
| `service_requests` | Direcciones y coordenadas de recogida y destino |

La geolocalización continua de una persona identificable es de los tratamientos
más invasivos que hace la plataforma y merece el escrutinio más alto. Es donde
apareció el hallazgo de la §7.

### 3.4 Otros

| Tabla | Contenido |
|---|---|
| `request_messages` | Contenido del chat usuario ↔ operador |
| `ratings` | Calificación y **comentario libre** sobre un operador identificado |
| `request_events` | Auditoría de cambios de estado |

---

## 4. Base de licitud por finalidad

| Finalidad | Datos | Base legal |
|---|---|---|
| Prestar el servicio de asistencia solicitado | Identidad, contacto, vehículo, ubicación de recogida/destino | **Ejecución de contrato** |
| Asignar y guiar al operador; seguimiento en vivo | Geolocalización de operador y usuario | **Ejecución de contrato** |
| Verificar que el operador puede ejercer | DUI, licencia, tarjeta de circulación | **Obligación legal** + interés legítimo (seguridad del usuario) |
| Seguridad y resolución de disputas | Recorrido del servicio, chat, eventos | **Interés legítimo** |
| Notificaciones operativas (push) | Token de dispositivo | **Ejecución de contrato** |
| Calificaciones y calidad | Estrellas y comentario | **Interés legítimo** |
| Comunicaciones comerciales | Contacto | **Consentimiento** — opt-in separado, revocable |

Nota: la ubicación y el DUI se tratan por contrato y obligación legal, **no** por
consentimiento. Pedir consentimiento para algo que igual es indispensable
confunde al titular y debilita la base legal. El consentimiento se reserva para
lo que de verdad es opcional (marketing).

---

## 5. Texto de consentimiento y aviso de privacidad

### 5.1 Texto corto — pantalla de registro

> Al crear tu cuenta aceptas los **Términos del servicio** y el **Aviso de
> privacidad** de Budi.
>
> Para prestarte asistencia vial tratamos tu nombre, teléfono, correo, datos de
> tu vehículo y **tu ubicación durante el servicio**. Compartimos tu nombre,
> teléfono y ubicación de recogida **únicamente con el operador que te atiende**.
>
> Podés acceder, rectificar, cancelar u oponerte al uso de tus datos, además de
> portarlos, limitarlos o pedir su olvido, escribiendo a `privacidad@…`.

Con dos enlaces tocables (Términos, Aviso) y una casilla **no premarcada**:

> ☐ He leído y acepto el Aviso de privacidad.

Y, **separado** y también no premarcado:

> ☐ Quiero recibir promociones y novedades de Budi. _(opcional)_

### 5.2 Texto para el operador

Añade, antes de subir documentos:

> Para verificar tu cuenta necesitamos tu **DUI, licencia de conducir y tarjeta
> de circulación**. Se guardan cifrados y solo los ve el equipo de verificación
> de Budi. No se comparten con los usuarios ni con terceros.
>
> Mientras estés **en línea**, Budi registra tu ubicación —incluso con la app en
> segundo plano— para asignarte servicios cercanos y para que el cliente vea tu
> llegada. Podés desactivarlo poniéndote fuera de línea.

Ese segundo párrafo es exigible: hoy el tracking en segundo plano (B-04) ya está
implementado y el operador debe saberlo explícitamente.

### 5.3 Aviso de privacidad completo

Debe existir como página pública (p. ej. `/privacidad` en la web) y contener:
identidad del responsable, datos del DPO, categorías de datos, finalidades y base
legal de cada una, destinatarios (operadores, aseguradoras cuando llegue la Fase 1,
proveedores de infraestructura), plazos de conservación de la §6, procedimiento
ARCO-POL de la §8, y derecho a reclamar ante la ACE.

---

## 6. Política de retención

> Plazos **propuestos**. Los marcados con ⚠️ tienen consecuencia fiscal o
> laboral y necesitan confirmación legal antes de fijarse.

| Dato | Plazo propuesto | Razón |
|---|---|---|
| Cuenta y perfil | Mientras la cuenta esté activa + **12 meses** desde la baja | Disputas y reactivación |
| Servicios y facturación ⚠️ | **5 años** | Plazo mercantil/fiscal habitual — **confirmar** |
| `service_location_trail` (recorridos) | **90 días** | Solo se necesita para disputas recientes; es el dato más invasivo |
| `operator_locations` (posición en vivo) | Se sobrescribe; **sin histórico** | Ya funciona así |
| Documentos de identidad del operador | Mientras esté activo + **12 meses** | Acreditación de que podía operar |
| `request_messages` (chat) | **12 meses** | Evidencia en disputas |
| `ratings` | Indefinido, **disociado** del usuario que califica a los 24 meses | El histórico de calidad sirve; la autoría no |
| `device_tokens` | Borrar al cerrar sesión o a los **6 meses** inactivos | Ya no sirven |
| `request_events` (auditoría) | **5 años** ⚠️ | Trazabilidad; será la base del SLA de Fase 2 |

**Estado: escrita, no automatizada.** B-07 pide la política redactada; la ejecución
automática (jobs de borrado y disociación) es **B-25**. Hoy no hay ningún borrado
programado — conviene no afirmar en el aviso de privacidad que se borra algo que
en la práctica se conserva.

---

## 7. Checklist RLS

Auditoría ejecutada contra la base local el 2026-08-26.

### 7.1 Estado general

- **16 de 16** tablas de `public` tienen **RLS habilitado**. ✅
- **Ninguna** política usa `USING (true)` o `WITH CHECK (true)`. ✅
- Las 4 políticas sin `USING` son `INSERT` (que solo admite `WITH CHECK`) y todas
  validan `auth.uid()` contra el dueño de la fila. ✅
- `notification_queue` está cerrada a todo rol (`ALL … false`), accesible solo por
  `service_role`. ✅
- Los buckets `id-documents` y `vehicle-documents` son privados con RLS desde la
  migración 00010; el admin los lee con URLs firmadas de 5 minutos. ✅

### 7.2 Hallazgo 1 — ubicación de operadores expuesta · **CORREGIDO**

La política `"Users can view operator locations"` (migración 00024) concedía
lectura con:

```sql
EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('USER','ADMIN','MOP'))
OR EXISTS (SELECT 1 FROM service_requests sr WHERE sr.operator_id = ... AND sr.user_id = auth.uid() ...)
```

El primer `EXISTS` bastaba con **tener rol `USER`**. Al estar en un `OR`, absorbía
al segundo y lo volvía decorativo: **cualquier persona que se registrara en la app
podía leer `operator_locations` completa y seguir a todos los operadores en tiempo
real**, sin tener ningún servicio con ellos.

Comprobado en la base local antes del fix: `usuario1`, sin ningún servicio en
curso, contaba **1** fila (todos los operadores existentes).

**Corregido en `supabase/migrations/00040_restrict_operator_location_visibility.sql`**,
que separa por rol: ADMIN/MOP ven la flota; el USER solo al operador asignado a su
servicio en curso. Verificado con RLS real:

| Escenario | Antes | Después |
|---|---|---|
| USER sin servicio activo | 1 | **0** ✅ |
| USER con servicio activo | 1 | **1** ✅ |
| ADMIN | 1 | **1** ✅ |

Sin impacto en la app: el móvil siempre consulta con `.eq('operator_id', …)` y el
único consumidor que lista la flota completa es el panel admin.

### 7.3 Hallazgo 2 — el DUI viaja de más · **CORREGIDO**

RLS en Postgres filtra **filas, no columnas**. Como `profiles` incluía
`dui_number` e `id_doc_path`, todo rol que pudiera ver una fila veía también esas
columnas:

- **Operador** → el perfil completo de sus clientes asignados, DUI incluido.
- **MOP** → `is_mop()` le daba **todos** los perfiles, con el DUI de todos los
  usuarios y operadores. El MOP es un tercero externo.

La UI nunca mostró esos campos, pero RLS no protege la UI: con el token de sesión
se podía pedir `select=dui_number` a PostgREST directamente.

**Corregido en `supabase/migrations/00042_split_sensitive_profile_data.sql`.**
Se descartó la vía de los grants por columna —revocar el `SELECT` de tabla y
reconcederlo columna a columna— porque deja una trampa permanente: cada columna
nueva de `profiles` quedaría invisible hasta que alguien recuerde concederla, y
cualquier `select('*')` posterior fallaría con un error poco obvio. En su lugar
las dos columnas se movieron a `profile_sensitive`, con RLS normal fila a fila:
**solo el titular y el admin**. El MOP queda excluido a propósito.

Verificado con RLS real (el dato se copia antes de borrar la columna):

| Lector | Antes | Después |
|---|---|---|
| Operador (cliente asignado) | lee `01234567-8` | **0 filas** ✅ |
| MOP | 1 perfil con DUI | **0 filas** ✅ |
| Titular | — | 1 ✅ |
| Admin | — | 1 ✅ |

Auditoría previa: **nadie** leía esas columnas en el código y **ninguna** consulta
usaba `select('*')` sobre `profiles`, así que el cambio no tocó ninguna pantalla.
En local estaban vacías (0 de 3 filas) — la verificación real vive en
`operator_documents` desde la 00038, o sea que llevaban muertas desde la 00002.
Aun así la migración copia los valores antes de borrar la columna, porque desde
aquí no se puede saber si producción tiene datos.

### 7.4 Hallazgo 3 — el MOP veía de más · **CORREGIDO**

El MOP es un tercero **externo** y tenía `SELECT` sobre seis tablas. Contrastado
con lo que su interfaz consulta de verdad (`MopDashboardPage`, `MopRequestsPage`):

| Tabla | ¿La usa? | Resultado |
|---|---|---|
| `service_requests` | Sí, es su pantalla | Se mantiene |
| `providers` | Sí (embed, nombre) | Se mantiene |
| `profiles` | Sí (embed: `full_name`, `email`) | **Acotada** |
| `operator_locations` | **No** | Retirada |
| `pricing_rules` | **No** | Retirada |
| `request_events` | **No** | Retirada |

**Corregido en `supabase/migrations/00043_minimize_mop_access.sql`.** Se retiran
las tres que no usa y `profiles` se limita a las personas que participan en alguna
solicitud: antes podía leer nombre, teléfono y correo de **cualquier cuenta
registrada**, incluida gente que nunca pidió un servicio.

Verificado con RLS real:

| Lectura del MOP | Antes | Después |
|---|---|---|
| Perfiles visibles | 5 (incluye a quien nunca pidió) | **3**, ninguno ajeno ✅ |
| Flota en vivo | 1 | **0** ✅ |
| Eventos de auditoría | 72 | **0** ✅ |
| Reglas de precio | 3 | **1** — solo la activa ✳ |
| Su pantalla (solicitudes + embeds) | 12 | **12** ✅ |

✳ No baja a 0 porque existe `"Everyone can view active pricing rules"`
(`is_active = true`), que la app móvil necesita para estimar precios. El MOP
pierde el histórico de tarifas y conserva la vigente como cualquier usuario.

De paso se revirtió una concesión de más de la propia 00040, que había dado la
flota en vivo a `is_admin() OR is_mop()`.

### 7.5 Desenlace — el rol MOP se eliminó · migración 00045

Los hallazgos 1 y 3 giraban alrededor del MOP. Poco después se decidió que **el
MOP no forma parte del producto**, así que el rol se retiró del esquema por
completo en `supabase/migrations/00045_remove_mop_role.sql`: se eliminó de los
enums `user_role` y `event_type`, junto con `is_mop()`, todas sus políticas, su
portal web y la Edge Function de WhatsApp.

Al hacerlo apareció algo que esta auditoría había pasado por alto. La §7.4 buscó
`is_mop()` y encontró tres políticas; existían **cinco más** que comparaban
`profiles.role = 'MOP'` directamente, sobre `ratings`, `services`,
`provider_services`, `providers` (por una segunda vía) y `service_location_trail`.
Es decir, el recorte de la 00043 fue real pero **incompleto**: el MOP siguió
viendo esas tablas hasta la 00045.

> **Lección para la próxima auditoría RLS**: buscar el *literal* del rol
> (`'MOP'`, `'ADMIN'`…), no solo el helper. Y mirar todos los esquemas —dos de
> las políticas afectadas vivían en `storage.objects`, no en `public`.

### 7.6 Observación menor

Quedan dos políticas equivalentes sobre `operator_locations`
(`"Admins can view all locations"` de 00004 y `"Admins can view all operator
locations"`). Ambas son `SELECT` permisivas, así que el efecto es idéntico;
limpiar la vieja es cosmético.

---

## 8. Procedimiento de derechos ARCO-POL

1. El titular escribe a `privacidad@…` acreditando identidad.
2. El **DPO** registra la solicitud con fecha (empieza a correr el plazo).
3. Se resuelve en **≤ 20 días hábiles**, gratis.
4. Casos especiales:
   - **Cancelación / olvido**: no aplica sobre datos con retención obligatoria por
     ley (facturación, acreditación del operador). Se responde explicando la
     excepción en vez de borrar en silencio.
   - **Portabilidad**: entregar en formato estructurado (JSON o CSV).
5. Se informa al titular de su derecho a reclamar ante la **ACE**.

**Falta construir**: hoy no existe ni la casilla de correo ni un flujo en el admin
para atender estas solicitudes. Con 20 días hábiles de plazo legal, el correo es
lo mínimo viable.

---

## 9. Procedimiento de brechas de seguridad

Plazo máximo: **72 horas desde la detección**.

1. Contener y registrar hora de detección.
2. Evaluar alcance: qué datos, cuántos titulares.
3. Notificar dentro de las 72 h a la **ACE**, la **Fiscalía General** y los
   **titulares afectados**.
4. Documentar causa raíz y medidas correctivas.

**Falta**: no hay canal de detección. Sentry está pendiente (**B-26**) y sin
observabilidad una brecha se detecta tarde — y el reloj de 72 horas corre desde la
detección, no desde el incidente.

---

## 10. Qué queda pendiente de B-07

| # | Pendiente | De quién |
|---|---|---|
| 1 | **Designar al DPO** (nombre y contacto) | Walter |
| 2 | Razón social, NIT, domicilio y dominio de `privacidad@` | Walter |
| 3 | Confirmar con abogado los plazos ⚠️ de la §6 | Walter / legal |
| 4 | Implementar el consentimiento en registro (móvil y web) | Código |
| 5 | Publicar `/privacidad` y `/terminos` en la web | Código |
| 6 | Crear la casilla `privacidad@` y el registro de solicitudes | Walter |
| 7 | ~~Hallazgo 2 (§7.3): columnas DUI~~ — **hecho** (migr. 00042) | — |
| 8 | ~~Hallazgo 3 (§7.4): acceso del MOP~~ — **hecho** (migr. 00043), y el rol se eliminó entero en la 00045 (§7.5) | — |

Relacionado: `docs/backlog-aseguradoras.html` (B-07, B-25, B-26),
`docs/BACKGROUND_TRACKING.md`.

## Fuentes

- [Decreto N.º 144 — texto oficial (Asamblea Legislativa)](https://www.asamblea.gob.sv/sites/default/files/documents/decretos/7A4FBD85-7E1B-46BE-9408-6FC549E53E00.pdf)
- [La Nueva Ley Salvadoreña de Protección de Datos Personales — ALTA](https://altalegal.com/comunicacion/la-nueva-ley-salvadorena-de-proteccion-de-datos-personales/)
- [Nueva Ley de Protección de Datos Personales: claves para su cumplimiento — Central Law](https://central-law.com/el-salvador-nueva-ley-de-proteccion-de-datos-personales-claves-para-su-cumplimiento-y-aplicacion/)
- [Ley de protección de datos en El Salvador — Ecija](https://www.ecija.com/actualidad-insights/ley-de-proteccion-de-datos-en-el-salvador/)
