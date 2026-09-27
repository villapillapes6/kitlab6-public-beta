@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\validate_web_static.ps1"
if errorlevel 1 (
  echo.
  echo La web NO esta lista para publicar.
  pause
  exit /b 1
)
echo.
pause
