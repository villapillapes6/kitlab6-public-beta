KITLAB6_PERFORMANCE_LAZYLOAD_v1

Objetivo:
- Fase 2 de rendimiento: lazy loading seguro para miniaturas/galerías.
- Reduce la carga inicial de imágenes en galerías como Templates, Pattern, Team, Sponsor, Armband, Collar, etc.
- No toca assets.
- No toca template settings.
- No toca kitlab-data.
- No toca render/export PNG.
- No elimina ninguna función.

Archivos:
- app.js

Base esperada:
- KITLAB6_PUBLIC_BETA_STATIC_FINAL_OK_v1_3_222
- O la versión actual que ya funciona perfectamente en Cloudflare.
- Puede combinarse con _headers de la fase 1.

Uso:
1. Haz copia de seguridad de tu versión buena.
2. Copia este app.js en la raíz de KitLab.
3. Reemplaza el app.js actual.
4. Prueba local con servidor:
   http://127.0.0.1:5500/index.html
5. Revisa:
   - Templates
   - Pattern
   - Team / Flags
   - Sponsor
   - Armband
   - Collar
   - Export PNG
6. Si todo va bien:
   Commit: Add lazy loading for gallery thumbnails
   Push origin
7. Espera Cloudflare verde y prueba:
   https://kitlab6.com/?v=lazyload-v1

Notas:
- La primera carga puede seguir dependiendo del peso total de la web.
- La mejora se nota sobre todo en galerías grandes y en navegación/scroll.
- La siguiente fase sería crear miniaturas ligeras reales en WebP/PNG optimizado.
