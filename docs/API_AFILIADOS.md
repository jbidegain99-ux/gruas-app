# API de carga de afiliados — Budi

> Entregable **B-10** (Fase 1). Implementación:
> `supabase/functions/import-members/` y `supabase/migrations/00046_member_bulk_import.sql`.
>
> Creado: 2026-08-26

Permite a una aseguradora mantener su padrón de afiliados en Budi sin pasar por
el panel de administración: una llamada `POST` con las altas y bajas del día.

Para cargas puntuales existe también la **importación por CSV** desde el panel
(*Aseguradoras → póliza → Importar CSV*), que usa exactamente la misma lógica de
validación.

---

## Autenticación

Cada aseguradora tiene una o varias **claves de API**. Las crea, rota y revoca
el dueño o un administrador de su portal (con 2FA) en *Portal → Integraciones*.
Un administrador de Budi también puede emitirlas desde
*Aseguradoras → (aseguradora) → Claves de API*.

```
Authorization: Bearer budi_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Sobre las claves:

- Budi guarda únicamente el **SHA-256**. El valor en claro se muestra **una sola
  vez**, al crearla. Si se pierde, hay que revocarla y emitir otra.
- Conviene **una clave por integración**, para poder revocar una sin dejar sin
  servicio a las demás.
- Una clave solo alcanza las pólizas de **su propia aseguradora**. Esa frontera
  la impone la base de datos, no la aplicación.
- La revocación es inmediata.
- **Rotar** (desde el portal) emite una clave nueva con el mismo nombre y deja
  la anterior viva **24 horas**, para cambiarla sin cortar la integración.
  Si la clave se filtró, no rotes: **revócala** y crea otra.

---

## Endpoint

```
POST https://<proyecto>.supabase.co/functions/v1/import-members
Content-Type: application/json
Authorization: Bearer <clave>
```

### Cuerpo

```json
{
  "policy_number": "POL-2026-0001",
  "members": [
    {
      "document_number": "01234567-8",
      "full_name": "Juan Pérez",
      "phone": "+503 7000-0001",
      "relationship": "holder",
      "starts_on": "2026-01-01",
      "ends_on": null
    }
  ]
}
```

| Campo | Obligatorio | Notas |
|---|---|---|
| `policy_number` | Sí | Debe pertenecer a la aseguradora de la clave |
| `members` | Sí | Entre 1 y **1000** elementos por petición |
| `document_number` | Sí | DUI. Identifica al afiliado **dentro de la póliza**. Se compara solo por sus dígitos: el formato es indiferente |
| `full_name` | Sí | |
| `phone` | No | |
| `relationship` | No | `holder` o `beneficiary`. Por defecto `beneficiary` |
| `starts_on` | No | `AAAA-MM-DD`. Por defecto, hoy |
| `ends_on` | No | `AAAA-MM-DD`. `null` = sin fecha de baja |

### Comportamiento

La operación es **idempotente por `(policy_number, document_number)`**: si el
afiliado ya existe se actualiza, si no se crea. Reenviar el mismo padrón no
duplica a nadie, así que una integración puede mandar el archivo completo cada
noche sin llevar control de qué envió antes.

**El formato del DUI no importa.** Para decidir si dos filas son la misma
persona se comparan solo los dígitos, así que `01234567-8`, `012345678` y
`0.123.456-7 8` son el mismo afiliado. No hace falta que la integración
normalice nada ni que mantenga el mismo formato entre envíos: cambiar de formato
a mitad de camino **no** crea un afiliado nuevo, y una baja enviada con un
formato distinto al del alta sí surte efecto. Se guarda el documento tal como
llegó en el último envío.

Si el afiliado ya tiene una cuenta en la app, se vincula automáticamente por su
documento —también comparando solo los dígitos, así que la cuenta y el padrón
pueden tenerlo escrito distinto—. Una vinculación existente **nunca se deshace**
desde la importación.

---

## Respuestas

### 200 — procesado

```json
{
  "policy_number": "POL-2026-0001",
  "inserted": 120,
  "updated": 35,
  "failed": 2,
  "errors": [
    { "row": 14, "document_number": "", "message": "Falta el numero de documento" },
    { "row": 88, "document_number": "05555555-5", "message": "La fecha de baja es anterior a la de alta" }
  ]
}
```

**Un 200 no significa que todo entró.** Las filas se procesan una por una: una
mala no tumba el lote, se anota en `errors` con su número de fila (1 = primer
elemento de `members`) y el resto continúa. Toda integración debe revisar
`failed` y registrar `errors`, no solo el código HTTP.

### Errores

| Código | Cuándo |
|---|---|
| `400` | JSON inválido, falta `policy_number`, `members` no es arreglo o está vacío |
| `401` | Falta la cabecera `Authorization`, o la clave es inválida o está revocada |
| `404` | La póliza no existe **o no pertenece** a la aseguradora de la clave |
| `405` | Método distinto de `POST` |
| `413` | Más de 1000 afiliados en una petición |
| `500` | Error interno |

```json
{ "error": "Credencial invalida o revocada" }
```

Una clave inexistente, una revocada y una de aseguradora desactivada devuelven
**el mismo** 401: distinguirlas le diría a quien prueba claves cuáles existen.

---

## Ejemplo

```bash
curl -X POST "https://<proyecto>.supabase.co/functions/v1/import-members" \
  -H "Authorization: Bearer $BUDI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "policy_number": "POL-2026-0001",
    "members": [
      {"document_number": "01234567-8", "full_name": "Juan Pérez", "relationship": "holder"},
      {"document_number": "02345678-9", "full_name": "María Pérez"}
    ]
  }'
```

---

## Recomendaciones de integración

- **Enviar por páginas** de 500–1000 afiliados. Un padrón de 10 000 son diez
  peticiones, no una.
- **Registrar `errors`** en cada corrida. Es el único lugar donde se ve qué filas
  quedaron fuera.
- **No reintentar a ciegas** ante un `500`: la operación es idempotente, así que
  reintentar es seguro, pero conviene espaciar los intentos.
- Las bajas se comunican poniendo `ends_on`, no borrando la fila: así se conserva
  el historial de consumo del afiliado.

---

## Importación por CSV (panel)

Misma lógica, sin integración. En *Aseguradoras → póliza → Importar CSV*:

- Cabeceras aceptadas en **español o inglés** y en cualquier orden. Obligatorias:
  `documento`/`dui` y `nombre`. Opcionales: `telefono`, `relacion`, `alta`, `baja`.
- Separador `,` o `;` (Excel en locales con coma decimal usa `;`).
- Fechas en `dd/mm/aaaa` o `AAAA-MM-DD`. **`dd/mm/aaaa` se interpreta como día
  primero**, que es lo que escribe Excel en español; si se leyera al revés, un
  padrón con altas del 03/04 quedaría desplazado tres meses sin que nadie lo note.
- El panel muestra una **vista previa** con lo que entendió antes de escribir
  nada, y al terminar el mismo informe de `inserted` / `updated` / `errors`.

Hay una plantilla descargable en el mismo diálogo.

---

## Webhooks: eventos de tus casos

> Entregable **ASE-04**. Implementación: `supabase/migrations/00129_insurer_webhooks.sql`.

Budi avisa a tu servidor cada vez que cambia un caso de tus afiliados. Se
configura en *Portal → Integraciones → Webhooks* (hasta 5 URLs).

Solo llegan los casos que **tu plan cubre** y que consumió un afiliado tuyo:
el mismo alcance que ves en el portal.

### Eventos

| Evento | Cuándo |
|---|---|
| `case.created` | El afiliado pidió el servicio y quedó cubierto por tu póliza. |
| `case.assigned` | Un socio operador aceptó el servicio. |
| `case.unassigned` | El socio soltó el servicio; vuelve a buscarse grúa. |
| `case.arrived` | La grúa llegó y el afiliado confirmó con su PIN. |
| `case.completed` | Servicio terminado. |
| `case.cancelled` | Servicio cancelado. |
| `ping` | Evento de prueba, desde el botón «Enviar prueba» (`data.test = true`). |

### Petición

`POST` a tu URL con `Content-Type: application/json` y estas cabeceras:

| Cabecera | Valor |
|---|---|
| `X-Budi-Event` | El tipo de evento, p. ej. `case.assigned`. |
| `X-Budi-Delivery` | Id único de la entrega (igual a `id` en el cuerpo). Úsalo para **deduplicar**: un reintento trae el mismo id. |
| `X-Budi-Signature` | `t=<unix>,v1=<hex>` — ver *Verificar la firma*. |

```json
{
  "id": "cbae4c31-16ca-4085-b674-0f46c888cbfd",
  "type": "case.assigned",
  "created_at": "2026-09-29T21:31:11.52Z",
  "data": {
    "folio": "BUDI-000267",
    "status": "assigned",
    "service_type": "tow",
    "zone": "San Salvador",
    "requested_at": "2026-09-29T21:31:11Z",
    "assigned_at": "2026-09-29T21:31:11Z",
    "arrived_at": null,
    "completed_at": null,
    "cancelled_at": null,
    "policy_number": "POL-0001",
    "member_document": "012345678",
    "coverage": { "status": "covered", "covered": 60, "copay": 0 },
    "total_price": 60
  }
}
```

El cuerpo no lleva datos del socio operador, ubicación exacta ni datos de
contacto del afiliado. Con el `folio` se consulta el detalle en el portal.

### Verificar la firma

`v1` es el HMAC-SHA256, en hexadecimal, de `"<t>.<cuerpo crudo>"` con el
**secreto de firma** del webhook (`whsec_...`, se muestra una vez al crearlo o
rotarlo). Verifica **sobre el cuerpo crudo**, antes de parsear el JSON, y
rechaza firmas con más de 5 minutos para evitar que alguien repita una entrega.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verificar(cuerpoCrudo, cabecera, secreto) {
  const { t, v1 } = Object.fromEntries(cabecera.split(',').map((p) => p.split('=', 2)));
  if (!t || !v1 || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const esperado = createHmac('sha256', secreto).update(`${t}.${cuerpoCrudo}`).digest();
  const recibido = Buffer.from(v1, 'hex');
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
}
```

Hay un receptor de referencia en `scripts/webhook-receiver.mjs`.

### Respuesta y reintentos

- Responde **2xx en menos de 10 s**. Si tienes trabajo pesado, encólalo y
  responde enseguida.
- Cualquier otra respuesta (o ninguna) se reintenta a los **1 min, 5 min,
  30 min, 2 h y 6 h**. Después del 6.º intento la entrega queda como fallida.
- El orden de llegada no está garantizado entre reintentos: usa `data.status`
  y las fechas del cuerpo, no el orden de llegada.
- En *Integraciones → Entregas* ves cada entrega de los últimos 30 días, su
  cuerpo y el resultado, y puedes **reenviar** una a mano.

### Requisitos de la URL

`https://` y pública. No se aceptan `localhost`, IPs privadas ni nombres
internos. (En la base local de desarrollo se puede permitir `http://` con
`ALTER DATABASE postgres SET app.webhooks_allow_local = 'on'`.)

---

## Límites conocidos

- La aseguradora **no puede consultar** su padrón por API todavía; solo cargarlo.
  La lectura llega con el portal B2B (**B-17**).
- No hay borrado por API. Para dar de baja se usa `ends_on`.
- El tope de peticiones es por aseguradora (30/min) y por IP (60/min). Si una
  integración se descontrola, la vía es revocar su clave.

Relacionado: [`ERD_COBERTURA.md`](./ERD_COBERTURA.md) ·
[`backlog-aseguradoras.html`](./backlog-aseguradoras.html)
