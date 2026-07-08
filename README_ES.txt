KitLab6 v1.0.28 — Template Settings Folders
Puerto: 8787

Ejecuta EJECUTAR_KITLAB6.bat y abre:
http://127.0.0.1:8787/?v=1.0.28

Base: rama visual v1.0.27, con v1.0.20 estable sin tocar como referencia.

Nuevo sistema de guardado de configuración de templates:
- Save Template Settings guarda ahora un JSON persistente fuera de la carpeta de la build.
- Ruta en Windows: Documentos\KitLab6\UserData\templates\<marca>\<template>\template_settings.json
- Cada template tiene su propia carpeta de configuración.
- Las nuevas versiones pueden leer esos ajustes aunque cambie el puerto o la carpeta de la build.
- Si el servidor nuevo no está disponible, mantiene fallback en localStorage.

Se guarda configuración completa del template:
- Colores de piezas base: Shirt, Short, Sleeve short, Sleeve long, Socks, Ankle.
- Textura/arrugas: capas duplicadas, orden, visibilidad, blend/fusion y opacity.
- Capas de template: color, visibilidad, orden, blend/fusion, opacity e inversión I de seams.
- Collar seleccionado y sus capas/seams.
- Armband seleccionado.
- Logos/Brand/Team/Sponsor: capas, duplicados, posición, tamaño, bordes y recolor.
- Estado visual básico: UV/Guide, opacidades, módulos abiertos, carpetas/filas.

No se han cambiado intencionadamente:
- Costuras IV/FJ.
- Collar seams.
- Fabric/Pattern.
- Render/export 2048.
- Armband gallery.
