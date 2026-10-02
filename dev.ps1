# dev.ps1 - Levanta el entorno de desarrollo de Budi en local.
# Abre 3 terminales: Edge Functions, Web (Next.js) y Movil (Expo/Metro).
# Supabase local (Docker) se verifica/arranca aparte porque persiste solo.
#
# Uso:  .\dev.ps1          base de desarrollo (54321)
#       .\dev.ps1 -Demo    entorno de DEMO (58321, ver scripts/demo-env.mjs):
#                          las mismas apps apuntadas a la base de demo, mas una
#                          terminal que mantiene la flota de la demo en linea.
# Si PowerShell bloquea el script:  powershell -ExecutionPolicy Bypass -File .\dev.ps1

param([switch]$Demo)

$ErrorActionPreference = "Stop"
$repo = $PSScriptRoot
$port = if ($Demo) { 58321 } else { 54321 }

Write-Host ("=== Budi :: " + $(if ($Demo) { "entorno de DEMO" } else { "entorno de desarrollo" }) + " ===") -ForegroundColor Cyan

# --- 0. Docker + Supabase local -------------------------------------------
Write-Host "`n[0] Verificando Supabase local ($port)..." -ForegroundColor Yellow
$supaUp = (Test-NetConnection 127.0.0.1 -Port $port -WarningAction SilentlyContinue).TcpTestSucceeded
if ($supaUp) {
    Write-Host "    Supabase ya esta corriendo." -ForegroundColor Green
} else {
    Write-Host "    No responde. Arrancando... asegurate que Docker Desktop este abierto." -ForegroundColor Yellow
    Push-Location $repo
    if ($Demo) { node scripts/demo-env.mjs up } else { npx supabase start }
    Pop-Location
}

# --- IP LAN (para el telefono) --------------------------------------------
$lan = (Get-NetIPAddress -InterfaceAlias "Wi-Fi" -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Select-Object -First 1).IPAddress
if ($lan) {
    Write-Host "`n    IP LAN (Wi-Fi): $lan  ->  telefono: exp://$lan`:8081" -ForegroundColor Cyan
    if ($Demo) {
        Write-Host "    (Para el telefono, el firewall tiene que dejar entrar el puerto 58321; ver docs/ventas/DEMO_MOPT.md)" -ForegroundColor DarkGray
    } else {
        Write-Host "    (Si no coincide con EXPO_PUBLIC_SUPABASE_URL en apps/mobile/.env, actualizala)" -ForegroundColor DarkGray
    }
}

# En la demo, las apps se apuntan a la base de demo pisando la URL (las claves
# locales son las mismas). La web va por loopback; el telefono, por la IP LAN.
$webEnv = ""
$mobileEnv = ""
$functionsArgs = ""
if ($Demo) {
    $mobileHost = if ($lan) { $lan } else { "127.0.0.1" }
    $webEnv = "`$env:NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:58321'; "
    $mobileEnv = "`$env:EXPO_PUBLIC_SUPABASE_URL='http://$mobileHost`:58321'; "
    $functionsArgs = " --workdir .demo"
}

# --- Helper: abre una terminal nueva con un comando -----------------------
function Open-DevTerminal($title, $workdir, $command) {
    $inner = "`$host.UI.RawUI.WindowTitle='$title'; Set-Location '$workdir'; Write-Host '>>> $title' -ForegroundColor Cyan; $command"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $inner
    Write-Host "    Terminal abierta: $title" -ForegroundColor Green
}

# --- 1. Edge Functions -----------------------------------------------------
Write-Host "`n[1] Edge Functions..." -ForegroundColor Yellow
Open-DevTerminal "Budi Edge Functions" $repo "npx supabase functions serve$functionsArgs"

# --- 2. Web (Next.js) ------------------------------------------------------
Write-Host "[2] Web (http://localhost:3000)..." -ForegroundColor Yellow
Open-DevTerminal "Budi Web" $repo "$webEnv pnpm dev:web"

# --- 3. Movil (Expo / Metro) ----------------------------------------------
Write-Host "[3] Movil (Expo/Metro 8081)..." -ForegroundColor Yellow
Open-DevTerminal "Budi Mobile" (Join-Path $repo "apps\mobile") "$mobileEnv pnpm exec expo start --lan --clear"

if ($Demo) {
    # --- 4. Flota de la demo en linea -------------------------------------
    # El despacho y el mapa solo cuentan ubicaciones de los ultimos 5 min:
    # sin esto, a los 5 minutos la flota de la demo se ve apagada.
    Write-Host "[4] Flota de la demo en linea (cada 2 min)..." -ForegroundColor Yellow
    Open-DevTerminal "Budi Demo Flota" $repo "while (`$true) { node scripts/demo.mjs ping; Start-Sleep -Seconds 120 }"

    Write-Host "`n=== Demo lista. 4 terminales abiertas. ===" -ForegroundColor Cyan
    Write-Host "Web:      http://localhost:3000   (contrasena de todas: Demo1234!)" -ForegroundColor White
    Write-Host "          admin@budi.sv  |  mopt.dueno@demo.budi.sv (2FA: pnpm demo:code)  |  mopt.analista@demo.budi.sv" -ForegroundColor White
    if ($lan) { Write-Host "Movil:    exp://$lan`:8081        (daniela@demo.budi.sv  |  josue@demo.budi.sv)" -ForegroundColor White }
    Write-Host "Servicio en vivo:  pnpm demo:drive --mopt     Guion: docs/ventas/DEMO_MOPT.md" -ForegroundColor White
} else {
    Write-Host "`n=== Listo. 3 terminales abiertas. ===" -ForegroundColor Cyan
    Write-Host "Web:      http://localhost:3000   (admin@gruas.sv / Admin123!)" -ForegroundColor White
    if ($lan) { Write-Host "Movil:    exp://$lan`:8081        (usuario1@gruas.sv / User123!  |  operador1@gruas.sv / Op123!)" -ForegroundColor White }
}
Write-Host "Cerra las terminales para detener cada servicio. Supabase (Docker) sigue corriendo aparte." -ForegroundColor DarkGray
