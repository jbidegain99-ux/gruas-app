# Demo de Budi para el MOPT — guion

Una demo de 20 a 25 minutos del **Programa de Asistencia Vial del MOPT** sobre Budi: el
Usuario pide ayuda en la carretera sin pagar nada, un socio de la flota del MOPT lo
atiende, y el MOPT controla todo desde su portal (flota en vivo, cumplimiento, dinero y
reportes).

Todo corre en tu laptop, en un **entorno de demo aparte** (una base local limpia con
tres meses de operación creíble). No toca la base de desarrollo ni producción.

---

## 1. El día antes (una vez)

1. Abre **Docker Desktop**.
2. Arma la demo desde cero (unos 3 minutos):
   ```bash
   pnpm demo:fresh
   ```
   Al final imprime las cuentas. Si algo falla, repítelo: siempre arranca limpio.
3. Carga el **2FA del dueño del portal** en tu teléfono (para no depender de la terminal):
   ```bash
   pnpm demo:code
   ```
   Te da el código de ahora y el **secreto**: en Google Authenticator → *Agregar código* →
   *Ingresar una clave* → pega el secreto. Desde ahí, el código lo tienes en el teléfono.
4. **Teléfono (opcional, recomendado):** instala **Expo Go**. El teléfono y la laptop en la
   misma Wi-Fi. La primera vez, abre en PowerShell **como administrador**:
   ```powershell
   New-NetFirewallRule -DisplayName "Budi Demo 58321" -Direction Inbound -Protocol TCP -LocalPort 58321 -Action Allow -Profile Any
   New-NetFirewallRule -DisplayName "Budi Metro 8081" -Direction Inbound -Protocol TCP -LocalPort 8081 -Action Allow -Profile Any
   ```

## 2. Quince minutos antes

1. Rearma la demo para que las fechas queden de hoy:
   ```bash
   pnpm demo:fresh
   ```
   Esto es importante: la historia (servicios de hoy, socios conectados, el servicio en
   curso) se arma relativa al momento en que corres el comando.
2. Levanta todo:
   ```powershell
   .\dev.ps1 -Demo
   ```
   Abre 4 terminales: Edge Functions, Web, Móvil y **Flota de la demo** (mantiene a los
   socios "en línea" cada 2 minutos; no la cierres durante la demo).
3. Abre en el navegador, cada uno en su pestaña (o ventana de incógnito para no mezclar
   sesiones):
   - `http://localhost:3000` → **portal MOPT** como `mopt.dueno@demo.budi.sv`
   - `http://localhost:3000` → **admin de Budi** como `admin@budi.sv` (en incógnito)
4. En el teléfono, abre Expo Go → `exp://<IP de la laptop>:8081` (la terminal de dev.ps1
   la muestra) y entra como **Fernando**.

## 3. Cuentas

Contraseña de todas: **`Demo1234!`**

| Quién | Cuenta | Para qué |
|---|---|---|
| Dueño del portal MOPT | `mopt.dueno@demo.budi.sv` | Todo el portal. Pide 2FA (`pnpm demo:code` o tu autenticador). Aprueba estados de cuenta y paga a los socios. |
| Analista del MOPT | `mopt.analista@demo.budi.sv` | Ve todo el portal **sin 2FA**. Puede observar casos; no aprueba ni paga. Útil si no quieres lidiar con el código. |
| Admin de Budi | `admin@budi.sv` | El lado de Budi: programas, contratos, estados de cuenta, flota. |
| Usuarios (app) | `fernando` · `patricia` · `luis` · `daniela` · `gabriela` `@demo.budi.sv` | Piden asistencia. **Fernando** está libre para pedir en vivo. |
| Socios MOPT (app) | `josue` · `kevin` · `oscar` · `ricardo` · `marvin` `@demo.budi.sv` | La flota del programa. **Óscar** y **Ricardo** están libres. |

Lo que hay sembrado: el programa **MOPT — Programa de Asistencia Vial** con 2 zonas
(Carretera al Puerto de La Libertad y Carretera del Litoral), contrato MOPT-AV-2026-014
con tope de $6,000/mes, 5 socios con su grúa y placa, ~25 servicios en tres meses con
SLA y recorrido GPS, un servicio en sitio (Josué) y otro en camino (Kevin), el estado de
cuenta del mes antepasado **pagado** y el del mes pasado **emitido, esperando
aprobación**, y los reportes oficiales de esos dos meses.

---

## 4. El guion

### Acto 1 — El Usuario varado no paga nada (3 min) · *teléfono, Fernando*

1. **Solicitar → Remolque de vehículo**.
   - **Recogida:** toca *Punto de recogida* y **busca "Zaragoza"** → elige *Zaragoza, La
     Libertad Este* → *Confirmar ubicación*. ⚠️ **No uses "Usar mi ubicación actual"**: el
     teléfono da dónde estás tú (fuera de la zona del programa) y el servicio saldría
     como particular.
   - **Destino:** busca **"Santa Tecla"** → *Confirmar ubicación*.
   - *Siguiente* → Liviana → Vehículo varado → *Siguiente*. El vehículo guardado de
     Fernando (Mitsubishi L200 · P245977) ya viene puesto.
2. Avanza hasta el **Resumen**. Señala la caja verde:
   > **Sin costo para ti — Este servicio lo cubre MOPT — Programa de Asistencia Vial.**
   > Costo $60 · Absorbido por Fondo Vial MOPT · **Pagas $0.00**
3. **Confirmar**. Muestra el **PIN** de 4 dígitos: "el socio no puede iniciar el servicio
   sin este PIN; así sabemos que llegó de verdad".

> Qué decir: la persona no elige ni llena formularios del MOPT. Budi sabe que la
> recogida cae en una zona del programa y le dice antes de confirmar que no paga.

### Acto 2 — El socio de la flota lo atiende (3 min)

**Con un segundo dispositivo** (otro teléfono, el emulador o `http://localhost:8081` en el
navegador) entra como **Óscar** o **Ricardo**:

1. Prende el interruptor **En línea** (en un dispositivo nuevo el socio arranca fuera de
   línea, como en la operación real).
2. La solicitud aparece con **"Cortesía MOPT · No le cobres al Usuario"**.
3. *Aceptar* → *Voy en camino* → *Ya llegué* → ingresa el PIN que te dio Fernando →
   *Completar servicio*.

> Ojo: si el socio está en un teléfono real, su punto en el mapa del portal es **donde
> estás tú** (manda el GPS del teléfono). Para que el mapa cuente la historia de la
> zona, usa `pnpm demo:drive --mopt`.

**Con un solo dispositivo**, simula el socio desde la terminal (se ve moverse en el
mapa del portal mientras corre):
```bash
pnpm demo:drive --mopt
```

> Qué decir: la flota es **cerrada**: solo los socios del MOPT ven y toman estos
> servicios; un socio independiente nunca los ve.

### Acto 3 — El portal del MOPT: la operación en vivo (6 min) · *dueño o analista*

1. **Resumen**: el contrato, el **consumo del Fondo Vial contra el tope** del mes, lo
   pendiente con los socios y con Budi.
2. **Mapa**: la flota en vivo, cada socio con su **placa** y su **calificación**; los
   servicios en curso; las dos zonas del programa. Marvin aparece **sin señal** (gris):
   > "Si un socio con un servicio en curso deja de mandar GPS, el portal te avisa arriba
   > con su teléfono para llamarlo."
3. **Servicios** → abre un caso: persona atendida, **vehículo y placa**, socio, el
   **recorrido GPS en el mapa**, el **SLA** contra el contrato y la **línea de tiempo**
   (exportable).
4. **Cumplimiento**: cambia *Desde* al primer día del **mes pasado** → % de asignación y
   llegada a tiempo, por tipo de servicio y por zona. Hay casos fuera de SLA a propósito:
   > "No te vamos a mostrar un 100 %: te mostramos la verdad, caso por caso."
5. **Km por grúa**: los kilómetros por unidad, medidos con GPS (no los que declara el
   socio).

### Acto 4 — El dinero, sin sorpresas (6 min) · *dueño (2FA)*

1. **Estados de cuenta** → el del **mes pasado** (Emitido):
   - Cada servicio con su monto y la tarifa de Budi.
   - Lee la línea de arriba: *"A Budi le pagas solo la tarifa de plataforma; los
     servicios se los pagas a tus socios."*
   - Muestra **Observar** en un caso ("el socio llegó tarde"): el caso sale del total
     hasta que Budi responde. *(Si lo observas, el admin lo responde en el Acto 6.)*
   - **Aprobar**.
2. **Estados de cuenta** → el del **mes antepasado** (Pagado): la historia cerrada.
3. **Socios operadores**: cuánto se le debe a cada socio, pagado y pendiente.
   *Registrar pago* a uno (si tiene casos observados, el portal avisa que podrías
   pagarle de más).
4. **Pagos**: el historial de pagos a los socios.

### Acto 5 — Reportes para la jefatura (2 min)

**Reportes** → el **mes pasado**: resumen ejecutivo, por tipo, por zona, costo contra el
tope y el anexo de servicios **sin datos personales** (Decreto 144).
**Imprimir o guardar PDF**.
> "El día 1 de cada mes se genera solo y se envía al dueño y administradores del portal.
> Si Budi ajusta un caso al aprobar el estado de cuenta, el reporte se corrige y se
> reenvía marcado como versión corregida."

### Acto 6 — El lado de Budi (opcional, 3 min) · *admin*

1. **Dashboard**: la operación del día.
2. **Programas MOPT**: zonas (se dibujan en el mapa), SLA, tarifa de Budi, contrato y
   tope, equipo del portal.
3. **Estados de cuenta**: si observaste un caso en el Acto 4, respóndelo aquí
   (*Confirmar monto* o *Ajustar*).
4. **Flota**: el mapa de todos los socios (MOPT e independientes).

---

## 5. Si algo sale mal

| Pasa esto | Haz esto |
|---|---|
| El mapa dice que los socios están "sin señal" | La terminal *Budi Demo Flota* se cerró. Corre `pnpm demo:ping` (o vuelve a abrirla). |
| El 2FA no pasa | `pnpm demo:code` da el código de este momento (vale 30 s). O entra como `mopt.analista` (sin 2FA). |
| `demo:drive` dice que no hay clientes o socios libres | Todos tienen un servicio en curso: `pnpm demo:fresh` y vuelve a empezar. |
| La app del teléfono no conecta | Misma Wi-Fi; reglas de firewall del paso 1.4; la IP que muestra `dev.ps1`. Plan B: `http://localhost:8081` en el navegador de la laptop. |
| La app muestra algo viejo | Cierra la terminal *Budi Mobile* y vuelve a correr `.\dev.ps1 -Demo` (arranca Metro con caché limpia). |
| Quieres empezar de cero | `pnpm demo:fresh` (3 min). Las cuentas se recrean: **cierra sesión y vuelve a entrar** en el navegador y en la app. |

Al terminar: `pnpm demo:down` apaga la base de demo (tus datos de desarrollo siguen
intactos).

## 6. Lo que esta demo **no** muestra (y qué decir si preguntan)

- **Corre en tu laptop, no en internet.** La versión en la nube se publica cuando se
  decida salir a producción.
- **El correo del reporte mensual** no sale en la demo (no hay cuenta de correo
  configurada en local). En el admin, el reporte dice "sin enviar"; en el portal del MOPT
  no se nota.
- **La app** se muestra con Expo Go (la versión de prueba de la app), no desde las
  tiendas. La publicación en Play Store y App Store está en curso.
- **Los datos son de demostración**: personas, placas, NIT y montos inventados.
