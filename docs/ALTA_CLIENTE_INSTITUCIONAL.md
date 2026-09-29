# Alta de un cliente institucional — Budi

> Entregable **VEN-03**. Implementación: `supabase/migrations/00130_institutional_onboarding.sql`
> y `/admin/altas` en la web. Meta: un cliente listo para operar en **menos de un día**, sin SQL.

Aplica a **aseguradoras** y **programas MOPT**. Todo se hace desde el admin
(solo rol ADMIN), en *Altas de clientes*. El checklist dice qué paso falta y
lleva a la pantalla donde se completa.

## Pasos

| # | Paso | Dónde | Listo cuando |
|---|---|---|---|
| 1 | **Crear el cliente** | *Altas de clientes → Nuevo cliente* | La organización existe y está activa. |
| 2 | **Contrato** (y en MOPT, **tarifa de Budi**) | En el mismo checklist (*Editar contrato*); la tarifa MOPT en *Programas MOPT* | Hay contrato vigente hoy. MOPT: además, tarifa por servicio fijada. El SLA (10/45 min por defecto) se revisa en la ficha. |
| 3 | **Dueño del portal** | En el checklist: correo + *Invitar* | La persona aceptó la invitación. Si no tenía cuenta, el enlace del correo se la crea. Al entrar se le pide 2FA. |
| 4a | **Aseguradora: planes, póliza y afiliados** | Ficha de la aseguradora (*Abrir*) | Plan activo con reglas, póliza vigente y afiliados activos (CSV desde la póliza, o la API — `docs/API_AFILIADOS.md`). |
| 4b | **MOPT: zonas** | *Programas MOPT* | Al menos una zona activa. |
| 5 | **Caso de prueba** | En el checklist | Aseguradora: un DUI real del padrón sale *Cubierto*. MOPT: un punto dentro de la zona sale *Cortesía MOPT*. No crea servicios ni gasta cobertura. |

Con los 5 pasos en verde se habilita **Marcar alta completa**, que registra la
fecha y el tiempo total del alta (visible en la lista).

## Qué pedirle al cliente antes de empezar

- Razón social, NIT y un contacto.
- Número de contrato y fecha de inicio.
- Correo de quien será **dueño** del portal (debe tener una app autenticadora para el 2FA).
- Aseguradora: los planes (qué servicios cubre cada uno, cuántos por año, montos
  máximos), las pólizas y el padrón en CSV (plantilla en el diálogo de importación).
- MOPT: las zonas (polígonos), horarios y el tope mensual si lo hay.

## Después del alta

- El dueño invita a su equipo desde *Equipo* en su portal.
- La aseguradora puede conectar sus sistemas desde *Integraciones* (claves de
  API y webhooks).
