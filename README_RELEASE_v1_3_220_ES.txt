KITLAB6 PUBLIC BETA STATIC RELEASE v1.3.220

Esto NO es un parche de carga. Es la base técnica para Cloudflare:
- app.js lee galerías dinámicas desde kitlab-data/asset_manifest.json.
- asset_manifest.json indexa assets completos: pattern, flags, team, armband, brand, sponsor, etc.
- GENERAR_ASSET_MANIFEST.bat sirve para regenerar el índice cuando cambies assets.
- VALIDAR_WEB_STATIC.bat comprueba que la base tiene lo mínimo para web estática.

Aplicación sobre la carpeta buena actual:
1. Copia app.js a la raíz.
2. Copia kitlab-data/asset_manifest.json dentro de kitlab-data.
3. Copia GENERAR_ASSET_MANIFEST.bat, VALIDAR_WEB_STATIC.bat y la carpeta tools/ a la raíz.
4. Ejecuta VALIDAR_WEB_STATIC.bat.
5. Prueba local.
6. Luego clear + fresh upload en main.
