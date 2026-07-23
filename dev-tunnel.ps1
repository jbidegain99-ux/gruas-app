# dev-tunnel.ps1 - Igual que dev.ps1 pero Metro corre en modo TUNEL (--tunnel).
# Usalo cuando el telefono se queda cargando y NO baja el bundle por LAN
# (router con aislamiento de clientes, red "Public", subred distinta, etc.).
# El tunel enruta Metro por los servidores de Expo, evitando la LAN.
#
# OJO: el tunel arregla Metro (cargar la app) pero Supabase sigue por LAN
# (192.168.1.x:54321). Si el login falla, el router tambien aisla y hay que
# resolver Supabase aparte. Primero confirmamos que la app carga.
#
# Uso:  .\dev-tunnel.ps1   (o doble clic en dev-tunnel.cmd)

$ErrorActionPreference = "Stop"
$repo = $PSScriptRoot

Write-Host "=== Budi :: entorno de desarrollo (MODO TUNEL) ===" -ForegroundColor Cyan

# --- 0. Supabase local -----------------------------------------------------
Write-Host "`n[0] Verificando Supabase local (54321)..." -ForegroundColor Yellow
$supaUp = (Test-NetConnection 127.0.0.1 -Port 54321 -WarningAction SilentlyContinue).TcpTestSucceeded
if ($supaUp) {
    Write-Host "    Supabase ya esta corriendo." -ForegroundColor Green
} else {
    Write-Host "    No responde. Arrancando (npx supabase start)... asegurate que Docker Desktop este abierto." -ForegroundColor Yellow
    Push-Location $repo
    npx supabase start
    Pop-Location
}

$lan = (Get-NetIPAddress -InterfaceAlias "Wi-Fi" -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Select-Object -First 1).IPAddress
if ($lan) {
    Write-Host "`n    IP LAN (Wi-Fi): $lan  (Supabase sigue por LAN aunque Metro use tunel)" -ForegroundColor Cyan
}

function Open-DevTerminal($title, $workdir, $command) {
    $inner = "`$host.UI.RawUI.WindowTitle='$title'; Set-Location '$workdir'; Write-Host '>>> $title' -ForegroundColor Cyan; $command"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $inner
    Write-Host "    Terminal abierta: $title" -ForegroundColor Green
}

# --- 1. Edge Functions -----------------------------------------------------
Write-Host "`n[1] Edge Functions..." -ForegroundColor Yellow
Open-DevTerminal "Budi Edge Functions" $repo "npx supabase functions serve"

# --- 2. Web (Next.js) ------------------------------------------------------
Write-Host "[2] Web (http://localhost:3000)..." -ForegroundColor Yellow
Open-DevTerminal "Budi Web" $repo "pnpm dev:web"

# --- 3. Movil (Expo / Metro) en modo TUNEL ---------------------------------
Write-Host "[3] Movil (Expo/Metro --tunnel)..." -ForegroundColor Yellow
Write-Host "    Si pregunta por instalar @expo/ngrok, aceptar (Y)." -ForegroundColor DarkGray
Open-DevTerminal "Budi Mobile (tunnel)" (Join-Path $repo "apps\mobile") "pnpm exec expo start --tunnel --clear"

Write-Host "`n=== Listo. 3 terminales abiertas (Metro en tunel). ===" -ForegroundColor Cyan
Write-Host "Movil: en la ventana 'Budi Mobile (tunnel)' aparece un QR y una URL exp://...exp.direct" -ForegroundColor White
Write-Host "       Escanea el QR con Expo Go o pega esa URL exp:// (NO la IP LAN)." -ForegroundColor White
Write-Host "Web:   http://localhost:3000   (admin@gruas.sv / Admin123!)" -ForegroundColor White
Write-Host "Usuarios movil: usuario1@gruas.sv / User123!  |  operador1@gruas.sv / Op123!" -ForegroundColor White
