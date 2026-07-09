from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageOps
import sys

# Ajustes KitLab6 HQ WebP thumbnails
MAX_SIZE = 720          # maximo ancho/alto. Suficiente para retina sin cargar PNG enormes.
QUALITY = 95           # alta calidad para costuras/detalles finos.
METHOD = 6             # mejor compresion/calidad WebP, mas lento al generar pero solo se hace una vez.
SOURCE_NAMES = {
    "thumbnail.png", "thumbnail.PNG",
    "thumbnails.png", "thumbnails.PNG",
}


def human_size(n: int) -> str:
    units = ["B", "KB", "MB", "GB"]
    value = float(n)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} {unit}"
        value /= 1024
    return f"{n} B"


def main() -> int:
    script_path = Path(__file__).resolve()
    root = script_path.parents[1]
    templates_dir = root / "assets" / "templates"
    thumbs_dir = root / "assets" / "thumbs" / "templates"

    if not templates_dir.exists():
        print(f"ERROR: no existe {templates_dir}")
        print("Ejecuta este script desde la raiz del proyecto web de KitLab6.")
        return 1

    sources = [p for p in templates_dir.rglob("*") if p.is_file() and p.name in SOURCE_NAMES]
    if not sources:
        print("No se encontraron thumbnail.png / thumbnails.png dentro de assets/templates.")
        return 1

    converted = 0
    failed = 0
    total_src = 0
    total_dst = 0

    print(f"Root: {root}")
    print(f"Encontradas {len(sources)} miniaturas originales.")
    print(f"Destino: {thumbs_dir}")
    print(f"MAX_SIZE={MAX_SIZE}, QUALITY={QUALITY}")
    print()

    for src in sources:
        rel = src.relative_to(templates_dir)
        dst = (thumbs_dir / rel).with_suffix(".webp")
        dst.parent.mkdir(parents=True, exist_ok=True)
        try:
            with Image.open(src) as im:
                im = ImageOps.exif_transpose(im)
                # Mantener alpha/transparencia. Poner RGBA evita fondos raros.
                if im.mode not in ("RGBA", "RGB"):
                    im = im.convert("RGBA")
                elif im.mode == "RGB":
                    im = im.convert("RGBA")

                w, h = im.size
                scale = min(1.0, MAX_SIZE / max(w, h)) if max(w, h) else 1.0
                if scale < 1.0:
                    new_size = (max(1, round(w * scale)), max(1, round(h * scale)))
                    im = im.resize(new_size, Image.Resampling.LANCZOS)

                save_kwargs = dict(format="WEBP", quality=QUALITY, method=METHOD, lossless=False)
                # Pillow moderno soporta alpha_quality/exact; si no, caemos sin romper.
                try:
                    im.save(dst, **save_kwargs, alpha_quality=100, exact=True)
                except TypeError:
                    im.save(dst, **save_kwargs)

            converted += 1
            total_src += src.stat().st_size
            total_dst += dst.stat().st_size
            print(f"OK  {rel.as_posix()}  ->  {dst.relative_to(root).as_posix()}")
        except Exception as exc:
            failed += 1
            print(f"FAIL {rel.as_posix()}: {exc}")

    print()
    print("===============================================")
    print("Resumen")
    print("===============================================")
    print(f"Convertidas: {converted}")
    print(f"Errores:     {failed}")
    print(f"Origen PNG:  {human_size(total_src)}")
    print(f"Destino WebP:{human_size(total_dst)}")
    if total_src:
        print(f"Ratio:       {total_dst / total_src:.2%} del peso original")
    print()
    print("Siguiente paso:")
    print("1) Prueba la web con ?v=template-gallery-hq-webp-245")
    print("2) En GitHub Desktop sube app.js, index.html y assets/thumbs/templates modificados")
    print("3) No subas assets/templates originales si no han cambiado")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
