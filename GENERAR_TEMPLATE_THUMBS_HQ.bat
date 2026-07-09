@echo off
setlocal
cd /d "%~dp0"

echo.
echo ===============================================
echo  KitLab6 - Generar thumbnails HQ WebP templates
echo ===============================================
echo.

py -3 -c "import PIL" >nul 2>nul
if errorlevel 1 (
  echo Pillow no esta instalado. Intentando instalarlo...
  py -3 -m pip install pillow
  if errorlevel 1 (
    echo.
    echo ERROR: No se pudo instalar Pillow automaticamente.
    echo Ejecuta manualmente: py -3 -m pip install pillow
    pause
    exit /b 1
  )
)

py -3 "tools\GENERAR_TEMPLATE_THUMBS_HQ.py"
if errorlevel 1 (
  echo.
  echo ERROR generando thumbnails HQ.
  pause
  exit /b 1
)

echo.
echo Listo. Revisa GitHub Desktop: deberian aparecer cambios en assets\thumbs\templates.
echo No hace falta regenerar manifest para estas miniaturas si solo las usa la galeria.
echo.
pause
