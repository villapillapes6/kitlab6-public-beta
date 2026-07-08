from pathlib import Path
import sys
import os
import shutil

def main() -> int:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd().resolve()
    templates = root / "assets" / "templates"
    thumbs_root = root / "assets" / "thumbs" / "templates"
    report = root / "TEMPLATE_THUMBS_WEBP_REPORT.txt"

    lines = []
    lines.append(f"ROOT: {root}")
    lines.append(f"TEMPLATES: {templates}")
    lines.append("")

    if not templates.exists():
        print(f"ERROR: No encuentro assets/templates en: {root}")
        return 1

    try:
        from PIL import Image
    except Exception:
        print("ERROR: Python no tiene Pillow instalado.")
        print("Solucion: abre CMD y ejecuta:")
        print("py -3 -m pip install pillow")
        print("Luego vuelve a ejecutar GENERAR_TEMPLATE_THUMBS_WEBP.bat")
        return 1

    candidates = []
    names = {
        "thumbnail.png", "thumbnails.png", "thumb.png",
        "thumbnail.jpg", "thumbnail.jpeg", "thumbnail.webp",
        "preview.png", "preview.jpg", "preview.webp",
    }

    for p in templates.rglob("*"):
        if p.is_file() and p.name.lower() in names:
            candidates.append(p)

    made = 0
    skipped = 0
    failed = 0

    for src in candidates:
        rel = src.relative_to(templates)
        dst = thumbs_root / rel.with_suffix(".webp")
        dst.parent.mkdir(parents=True, exist_ok=True)

        try:
            with Image.open(src) as im:
                im = im.convert("RGBA")

                # Keep aspect, cap display thumbnail dimensions.
                max_w, max_h = 360, 720
                im.thumbnail((max_w, max_h), Image.LANCZOS)

                # WebP with alpha support.
                im.save(dst, "WEBP", quality=78, method=6)
            made += 1
            try:
                src_kb = src.stat().st_size / 1024
                dst_kb = dst.stat().st_size / 1024
                lines.append(f"OK {rel.as_posix()} | {src_kb:.1f} KB -> {dst.relative_to(root).as_posix()} | {dst_kb:.1f} KB")
            except Exception:
                lines.append(f"OK {rel.as_posix()} -> {dst.relative_to(root).as_posix()}")
        except Exception as e:
            failed += 1
            lines.append(f"FAIL {rel.as_posix()} | {e}")

    lines.insert(2, f"FOUND: {len(candidates)} thumbnail files")
    lines.insert(3, f"MADE: {made}")
    lines.insert(4, f"FAILED: {failed}")
    lines.insert(5, "")

    report.write_text("\n".join(lines), encoding="utf-8")

    print("")
    print(f"Encontradas: {len(candidates)}")
    print(f"Creadas: {made}")
    print(f"Fallidas: {failed}")
    print("")
    print(f"Reporte: {report}")
    print(f"Salida: {thumbs_root}")

    if failed:
        return 2
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
