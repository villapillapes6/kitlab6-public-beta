@echo off
title KitLab6 - Generar miniaturas WebP de templates
setlocal

set "ROOT=%~dp0"
for %%I in ("%ROOT%.") do set "ROOT=%%~fI"

echo.
echo KitLab6 - Generando miniaturas WebP de templates...
echo Root: %ROOT%
echo.

if not exist "%ROOT%\index.html" (
  echo ERROR: No encuentro index.html en:
  echo %ROOT%
  echo.
  echo Coloca este BAT en la raiz de KitLab, junto a index.html y assets.
  pause
  exit /b 1
)

if not exist "%ROOT%\assets\templates" (
  echo ERROR: No encuentro assets\templates en:
  echo %ROOT%
  echo.
  echo Comprueba que exista:
  echo %ROOT%\assets\templates
  pause
  exit /b 1
)

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%ROOT%\tools\generar_template_thumbs_webp.py" "%ROOT%"
  pause
  exit /b %errorlevel%
)

where python >nul 2>nul
if %errorlevel%==0 (
  python "%ROOT%\tools\generar_template_thumbs_webp.py" "%ROOT%"
  pause
  exit /b %errorlevel%
)

echo ERROR: No encuentro Python.
echo.
pause
exit /b 1
