# Facturación electrónica (DTE) — Budi

> Backlog **LAN-09**. Hecho: la **base** (migr. `00140_dte_settings.sql`,
> `apps/web/src/features/billing/`). Falta: firma y transmisión al Ministerio de
> Hacienda, que necesitan el certificado y las credenciales del MH.
>
> Creado: 2026-09-29

## Qué hay hoy

- **Datos fiscales** en *Admin → Facturación*: emisor (Budi), establecimiento y
  punto de venta, ambiente (00 pruebas / 01 producción), si los precios ya traen
  IVA, y por cliente el documento que se le emite (01 Factura / 03 Crédito
  fiscal) y sus datos de receptor. Solo el admin los ve y cambia.
- **Borrador del DTE** en el detalle de un estado de cuenta **aprobado o pagado**:
  arma el JSON con la estructura del MH (Factura versión 1, Crédito fiscal
  versión 3), avisa qué dato fiscal falta y permite descargarlo o copiarlo.
- **Qué se factura** sale del libro de movimientos:
  - **MOPT**: solo la **tarifa de plataforma** (el servicio el MOPT se lo paga
    directo al socio operador).
  - **Aseguradora**: lo que **cubre la póliza** en cada caso, con los ajustes
    aceptados en las observaciones.
- **Cuadre al centavo**: con precios que traen IVA, la base total sale del
  total con IVA y el redondeo se absorbe en la última línea. El documento suma
  exactamente lo que el cliente aprobó (probado: EC-202609-0022, $667.12).

Lecciones del facturador de Republicode aplicadas: redondeo a 2 decimales por
línea, dirección del receptor normalizada (códigos de 2 dígitos, complemento en
una línea), `parseMhDate` para las fechas que devuelve el MH, y el token de la
API **sin** el prefijo `Bearer` (para la transmisión).

## Qué falta

| Paso | Qué hace | Necesita |
|---|---|---|
| Autenticación | Obtener el token de la API del MH | Usuario y contraseña de la API (MH) |
| Firma | Firmar el JSON (JWS) con el certificado | Certificado del emisor y el firmador del MH |
| Transmisión | Enviar el DTE firmado y guardar el sello de recepción | Token + endpoint de recepción del ambiente |
| Correlativo | Asignar el número de control definitivo al transmitir (hoy va en 0) | Una secuencia por tipo de DTE, establecimiento y punto de venta |
| Envío al cliente | Mandar al receptor el JSON y la representación gráfica (PDF) | Proveedor de correo (el mismo del reporte MOPT) |
| Invalidación | Anular un DTE emitido por error | Evento de invalidación del MH |
| Contingencia | Emitir cuando el MH no responde y transmitir después | Flujo de contingencia del MH |

## A confirmar con el contador

1. Qué documento se le emite a cada cliente (el MOPT es entidad pública).
2. Si los precios de la plataforma ya incluyen IVA (hoy: sí, configurable).
3. Retención del 1 % de IVA cuando el cliente es gran contribuyente
   (`ivaRete1`, hoy en 0).
4. Códigos de actividad económica del emisor y de cada cliente.
5. Si al MOPT se le factura solo la tarifa de plataforma (lo que dice el libro)
   o el servicio completo.
6. Tipo de ítem y unidad de medida (hoy: servicio, unidad 99 «otra»).
