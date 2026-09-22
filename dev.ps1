# dev.ps1 - Levanta el entorno de desarrollo de Budi en local.
# Abre 3 terminales: Edge Functions, Web (Next.js) y Movil (Expo/Metro).
# Supabase local (Docker) se verifica/arranca aparte porque persiste solo.
#
# Uso:  .\dev.ps1
# Si PowerShell bloquea el script:  powershell -ExecutionPolicy Bypass -File .\dev.ps1

$ErrorActionPreference = "Stop"
$repo = $PSScriptRoot

Write-Host "=== Budi :: entorno de desarrollo ===" -ForegroundColor Cyan

# --- 0. Docker + Supabase local -------------------------------------------
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

# --- IP LAN (para el telefono) --------------------------------------------
$lan = (Get-NetIPAddress -InterfaceAlias "Wi-Fi" -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Select-Object -First 1).IPAddress
if ($lan) {
    Write-Host "`n    IP LAN (Wi-Fi): $lan  ->  telefono: exp://$lan`:8081" -ForegroundColor Cyan
    Write-Host "    (Si no coincide con EXPO_PUBLIC_SUPABASE_URL en apps/mobile/.env, actualizala)" -ForegroundColor DarkGray
}

# --- Helper: abre una terminal nueva con un comando -----------------------
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

# --- 3. Movil (Expo / Metro) ----------------------------------------------
Write-Host "[3] Movil (Expo/Metro 8081)..." -ForegroundColor Yellow
Open-DevTerminal "Budi Mobile" (Join-Path $repo "apps\mobile") "pnpm exec expo start --lan --clear"

Write-Host "`n=== Listo. 3 terminales abiertas. ===" -ForegroundColor Cyan
Write-Host "Web:      http://localhost:3000   (admin@gruas.sv / Admin123!)" -ForegroundColor White
if ($lan) { Write-Host "Movil:    exp://$lan`:8081        (usuario1@gruas.sv / User123!  |  operador1@gruas.sv / Op123!)" -ForegroundColor White }
Write-Host "Cerra las terminales para detener cada servicio. Supabase (Docker) sigue corriendo aparte." -ForegroundColor DarkGray
