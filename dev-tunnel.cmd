@echo off
REM Lanzador de dev-tunnel.ps1 (Metro en modo tunel) sin importar la ExecutionPolicy.
REM Doble clic aqui, o ejecuta:  dev-tunnel  (desde la terminal en la raiz del repo)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-tunnel.ps1"
