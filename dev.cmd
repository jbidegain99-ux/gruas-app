@echo off
REM Lanzador de dev.ps1 sin importar la ExecutionPolicy.
REM Doble clic aqui, o ejecuta:  dev  (desde la terminal en la raiz del repo)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1"
