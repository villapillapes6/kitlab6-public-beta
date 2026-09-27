@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\generate_asset_manifest.ps1"
if errorlevel 1 (
  echo.
  echo ERROR: No se pudo generar el manifiesto.
  pause
  exit /b 1
)
echo.
pause
