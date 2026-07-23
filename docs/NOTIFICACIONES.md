# Notificaciones push — cómo funciona y qué hay que configurar

## El circuito

```
cambio de estado en service_requests
   └─ trigger notify_service_status_change   (migración 00018)
        └─ INSERT en notification_queue
             └─ pg_cron cada minuto            (migración 00033)
                  └─ drain_notification_queue()
                       └─ pg_net HTTP POST → Edge Function process-notification-queue
                            └─ device_tokens → API de Expo Push
```

Antes de la migración 00033 el circuito **se cortaba en `notification_queue`**: el
trigger encolaba y nada consumía la cola, así que ningún push salía nunca.

`drain_notification_queue()` sólo hace la petición HTTP si hay filas con
`sent = false`, así que un minuto sin actividad no genera tráfico.

## Secretos (obligatorio, una vez por entorno)

La función lee la URL y la llave de **Vault**, no del código. Sin ellos no falla
ni pierde nada: registra un `WARNING` y la cola espera.

```sql
-- Local (la DB llega al gateway por el nombre del contenedor de Kong)
select vault.create_secret(
  'http://supabase_kong_<nombre-del-proyecto>:8000/functions/v1',
  'edge_functions_url'
);
select vault.create_secret('<SUPABASE_SERVICE_ROLE_KEY>', 'service_role_key');

-- Producción (Supabase managed)
select vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1',
  'edge_functions_url'
);
select vault.create_secret('<service_role_key del dashboard>', 'service_role_key');
```

Para rotar una llave: `select vault.update_secret(id, '<nuevo valor>')`.

> La petición manda la llave en **`apikey` y en `Authorization: Bearer`**. Sólo con
> el Bearer, el gateway responde `401 Missing authorization header`.

## Verificar que funciona

```sql
-- 1. encolar algo a mano
insert into notification_queue (user_id, title, body)
select id, 'Prueba', 'Verificando la cola' from profiles where role = 'USER' limit 1;

-- 2. esperar al minuto siguiente y mirar el resultado
select status_code, content from net._http_response order by created desc limit 1;
select sent, sent_at, error from notification_queue order by created_at desc limit 1;
```

Se espera `200` con `{"success":true,"processed":N,"sent":N,"errors":0}`.

Ojo: `sent = true` significa **procesada**, no necesariamente entregada. Si el
usuario no tiene ningún `device_tokens` activo, la función la marca como enviada
sin llamar a Expo.

## Lo que todavía falta para que llegue un push real al teléfono

1. **`projectId` de EAS** — `apps/mobile/app.json` tiene el placeholder
   `"projectId": "your-project-id"`. Con eso, `usePushNotifications` aborta el
   registro y `device_tokens` queda vacío.
2. **`eas.json`** — no existe; hacen falta los perfiles de build.
3. **Dev build** — Expo Go no recibe push desde SDK 53; se necesita una build de
   desarrollo o de `preview`.

Mientras 1–3 no estén, la cola se drena correctamente pero no hay tokens a los
que enviar.
