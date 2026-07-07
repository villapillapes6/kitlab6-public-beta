from pathlib import Path
import json
import re
import sys
import traceback

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
APP = ROOT / "app.js"
MANIFEST = ROOT / "kitlab-public-asset-manifest.json"
REPORT = ROOT / "KITLAB6_CLEAN_WEB_MANIFEST_REPORT.txt"
ERROR = ROOT / "KITLAB6_CLEAN_WEB_MANIFEST_ERROR.txt"

IMAGE_EXTS = {".png", ".webp", ".jpg", ".jpeg", ".gif", ".svg"}
IGNORE_DIR_NAMES = {".git", "__pycache__", "node_modules", "tools", "_kitlab_removed_original_collar_assets"}
IGNORE_FILE_NAMES = {".ds_store", "thumbs.db"}

PATCH_MARK = "KITLAB_PUBLIC_ASSET_MANIFEST_PATCH_V1"

MANIFEST_JS = r'''
  // KITLAB_PUBLIC_ASSET_MANIFEST_PATCH_V1
  // Web public mode: Cloudflare Pages cannot list folders like kitlab6_server.py.
  // This manifest gives KitLab the same folder/file lists without adding index.html files inside assets.
  const KITLAB_PUBLIC_ASSET_MANIFEST_URL = "kitlab-public-asset-manifest.json";
  let kitlabPublicAssetManifestPromise = null;

  async function loadKitlabPublicAssetManifest() {
    if (kitlabPublicAssetManifestPromise) return kitlabPublicAssetManifestPromise;
    kitlabPublicAssetManifestPromise = (async () => {
      try {
        const response = await fetch(kitlabNoCacheUrl(KITLAB_PUBLIC_ASSET_MANIFEST_URL), { cache: "no-store" });
        if (!response.ok) return null;
        const payload = await response.json();
        return payload && typeof payload === "object" ? payload : null;
      } catch (_) {
        return null;
      }
    })();
    return kitlabPublicAssetManifestPromise;
  }

  async function kitlabPublicManifestDirectory(key = "", byName = null) {
    const manifest = await loadKitlabPublicAssetManifest();
    if (!manifest || !manifest.dirs) return null;
    const cleanKey = String(key || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const entry = manifest.dirs[cleanKey];
    if (!entry) return null;
    const sorter = typeof byName === "function" ? byName : ((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: "base" }));
    const folders = Array.isArray(entry.folders) ? entry.folders.filter(Boolean) : [];
    const files = Array.isArray(entry.files) ? entry.files.filter((f) => /\.(png|webp|jpg|jpeg|gif|svg)$/i.test(String(f || ""))) : [];
    return {
      folders: [...new Set(folders)].sort(sorter),
      files: [...new Set(files)].sort(sorter),
    };
  }
'''


def should_skip_dir(path: Path) -> bool:
    return any(part in IGNORE_DIR_NAMES or part.startswith("_kitlab6_webfix") or part.startswith("_kitlab6_") for part in path.parts)


def remove_generated_asset_indexes():
    removed = []
    if not ASSETS.exists():
        return removed
    for p in ASSETS.rglob("*"):
        if not p.is_file():
            continue
        if p.name.lower() in {"index.html", "index.htm"}:
            try:
                p.unlink()
                removed.append(p.relative_to(ROOT).as_posix())
            except Exception as e:
                removed.append(f"FAILED_REMOVE: {p.relative_to(ROOT).as_posix()} :: {e}")
    return removed


def build_manifest():
    dirs = {}
    if not ASSETS.exists():
        return {"version": 1, "dirs": {}}

    all_dirs = [ASSETS] + [p for p in ASSETS.rglob("*") if p.is_dir()]
    for d in all_dirs:
        if should_skip_dir(d.relative_to(ROOT)):
            continue
        rel_key = d.relative_to(ROOT).as_posix()
        folders = []
        files = []
        try:
            for child in d.iterdir():
                if child.name.startswith("."):
                    continue
                if child.is_dir():
                    if child.name in IGNORE_DIR_NAMES or child.name.startswith("_kitlab6_"):
                        continue
                    folders.append(child.name)
                elif child.is_file():
                    if child.name.lower() in IGNORE_FILE_NAMES:
                        continue
                    if child.name.lower() in {"index.html", "index.htm"}:
                        continue
                    if child.suffix.lower() in IMAGE_EXTS:
                        files.append(child.name)
        except Exception:
            pass
        dirs[rel_key] = {
            "folders": sorted(set(folders), key=lambda s: s.lower()),
            "files": sorted(set(files), key=lambda s: s.lower()),
        }
    return {"version": 1, "dirs": dirs}


def patch_app_js():
    if not APP.exists():
        raise FileNotFoundError("No existe app.js en esta carpeta. Ejecuta esto desde la raiz del repo publico.")
    text = APP.read_text(encoding="utf-8", errors="ignore")
    changes = []

    if PATCH_MARK not in text:
        target = "  const kitlabAssetListCache = new Map();\n"
        if target not in text:
            raise RuntimeError("No encuentro 'const kitlabAssetListCache = new Map();' en app.js. No aplico parche para no romper nada.")
        text = text.replace(target, target + MANIFEST_JS + "\n", 1)
        changes.append("Inserted public asset manifest loader in app.js")
    else:
        changes.append("Manifest loader already present in app.js")

    # Add manifest fallback to listKitlabAssetDirectory before parsing directory HTML.
    old = """      } catch (_) {}\n      try {\n        const url = encodePathParts(parts) + \"/\";"""
    new = """      } catch (_) {}\n      try {\n        const manifestResult = await kitlabPublicManifestDirectory(key, byName);\n        if (manifestResult) return manifestResult;\n      } catch (_) {}\n      try {\n        const url = encodePathParts(parts) + \"/\";"""
    if old in text and "const manifestResult = await kitlabPublicManifestDirectory(key, byName);" not in text:
        text = text.replace(old, new, 1)
        changes.append("Patched listKitlabAssetDirectory to use manifest before directory fallback")
    else:
        changes.append("listKitlabAssetDirectory manifest fallback already present or pattern not found")

    # Pattern gallery later function: insert before plain http.server fallback.
    pattern_marker = """\n    // Fallback for plain http.server or older builds.\n    try {\n      const url = patternAssetUrl(parts) + \"/\";"""
    pattern_insert = """\n    try {\n      const manifestResult = await listKitlabAssetDirectory([\"assets\", \"pattern\", ...parts]);\n      if (manifestResult && ((manifestResult.folders || []).length || (manifestResult.files || []).length)) return manifestResult;\n    } catch (_) {}\n\n    // Fallback for plain http.server or older builds.\n    try {\n      const url = patternAssetUrl(parts) + \"/\";"""
    if pattern_marker in text and "await listKitlabAssetDirectory([\"assets\", \"pattern\", ...parts]);" not in text:
        text = text.replace(pattern_marker, pattern_insert, 1)
        changes.append("Patched pattern gallery to use manifest")
    else:
        changes.append("Pattern gallery manifest fallback already present or pattern not found")

    # Base Design gallery function: insert after API catch before html fallback.
    base_marker = """    try {\n      const url = baseDesignAssetUrl(parts) + \"/\";"""
    base_insert = """    try {\n      const manifestResult = await listKitlabAssetDirectory([\"assets\", \"base_design\", ...parts]);\n      if (manifestResult && ((manifestResult.folders || []).length || (manifestResult.files || []).length)) return manifestResult;\n    } catch (_) {}\n\n    try {\n      const url = baseDesignAssetUrl(parts) + \"/\";"""
    if base_marker in text and "await listKitlabAssetDirectory([\"assets\", \"base_design\", ...parts]);" not in text:
        text = text.replace(base_marker, base_insert, 1)
        changes.append("Patched base design gallery to use manifest")
    else:
        changes.append("Base design manifest fallback already present or pattern not found")

    # Overlay gallery: use manifest before fetching directory HTML.
    overlay_marker = """    try {\n      const response = await fetch(kitlabNoCacheUrl(`${OVERLAY_ASSET_ROOT}/`), { cache: \"no-store\" });"""
    overlay_insert = """    try {\n      const manifestResult = await listKitlabAssetDirectory([\"assets\", \"overlay\"]);\n      const files = normalizeList(manifestResult?.files || []);\n      if (files.length) return files;\n    } catch (_) {}\n\n    try {\n      const response = await fetch(kitlabNoCacheUrl(`${OVERLAY_ASSET_ROOT}/`), { cache: \"no-store\" });"""
    if overlay_marker in text and "await listKitlabAssetDirectory([\"assets\", \"overlay\"]);" not in text:
        text = text.replace(overlay_marker, overlay_insert, 1)
        changes.append("Patched overlay gallery to use manifest")
    else:
        changes.append("Overlay manifest fallback already present or pattern not found")

    APP.write_text(text, encoding="utf-8")
    return changes


def main():
    log = []
    log.append("KITLAB6 CLEAN WEB MANIFEST FIX")
    log.append("=" * 80)
    log.append(f"Root: {ROOT}")

    removed = remove_generated_asset_indexes()
    log.append(f"Removed generated assets/**/index.html files: {len(removed)}")
    for item in removed[:50]:
        log.append(f"  removed: {item}")
    if len(removed) > 50:
        log.append(f"  ... {len(removed) - 50} more removed")

    manifest = build_manifest()
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.append(f"Created manifest: {MANIFEST.name}")
    log.append(f"Manifest directories: {len(manifest.get('dirs', {}))}")

    changes = patch_app_js()
    log.extend(changes)

    log.append("")
    log.append("NEXT:")
    log.append("1. Test local with python -m http.server 8000")
    log.append("2. Open http://localhost:8000 and Ctrl+F5")
    log.append("3. Check Template, Pattern, Team flags, Basic logo, Collar, Export PNG")
    log.append("4. Commit ONLY app.js, kitlab-public-asset-manifest.json, .gitignore/kitlab-data if already expected")
    log.append("5. Do NOT commit .py/.cmd/backup/report/kitlab6_restore_payload")

    REPORT.write_text("\n".join(log), encoding="utf-8")
    print("OK - fix applied")
    print(f"Report: {REPORT}")

if __name__ == "__main__":
    try:
        main()
    except Exception:
        ERROR.write_text(traceback.format_exc(), encoding="utf-8")
        print("ERROR - see", ERROR)
        sys.exit(1)
