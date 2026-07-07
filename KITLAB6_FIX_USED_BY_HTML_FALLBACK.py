from pathlib import Path
import json
import re
import sys
import traceback

ROOT = Path(__file__).resolve().parent
APP = ROOT / 'app.js'
ASSETS = ROOT / 'assets'
REPORT = ROOT / 'KITLAB6_FIX_USED_BY_HTML_FALLBACK_REPORT.txt'
ERROR = ROOT / 'KITLAB6_FIX_USED_BY_HTML_FALLBACK_ERROR.txt'

MARK = 'KITLAB_USED_BY_HTML_FALLBACK_FIX_V1'


def norm_path(p: Path) -> str:
    return p.relative_to(ROOT).as_posix()


def collect_used_by_paths():
    out = []
    if ASSETS.exists():
        for p in ASSETS.rglob('used_by.txt'):
            if p.is_file():
                out.append(norm_path(p))
    return sorted(set(out), key=lambda s: s.lower())


def remove_asset_index_html():
    removed = []
    if not ASSETS.exists():
        return removed
    for p in ASSETS.rglob('*'):
        if p.is_file() and p.name.lower() in {'index.html','index.htm'}:
            try:
                p.unlink()
                removed.append(norm_path(p))
            except Exception as e:
                removed.append(f'FAILED {norm_path(p)} :: {e}')
    return removed


def patch_app():
    if not APP.exists():
        raise FileNotFoundError('No existe app.js. Ejecuta desde la raíz del repo público.')
    text = APP.read_text(encoding='utf-8', errors='ignore')
    used_by = collect_used_by_paths()
    used_by_json = json.dumps(used_by, ensure_ascii=False, separators=(',', ':'))

    helper = f'''
  // {MARK}
  // Cloudflare Pages can return the app HTML for missing used_by.txt paths.
  // Never show that HTML inside template thumbnails/popovers.
  const KITLAB_PUBLIC_USED_BY_TXT_PATHS = new Set({used_by_json});

  function kitlabNormalizePublicTxtPath(value) {{
    try {{
      let clean = String(value || '').split('#')[0].split('?')[0].replace(/\\\\/g, '/').replace(/^\\/+/, '');
      clean = decodeURIComponent(clean);
      return clean.replace(/\\/+$/g, '').replace(/\\/g, '/');
    }} catch (_) {{
      return String(value || '').split('#')[0].split('?')[0].replace(/\\\\/g, '/').replace(/^\\/+/, '').replace(/\\/+$/g, '');
    }}
  }}

  function kitlabPublicUsedByTxtExists(src) {{
    if (!KITLAB_PUBLIC_USED_BY_TXT_PATHS || !KITLAB_PUBLIC_USED_BY_TXT_PATHS.size) return false;
    const clean = kitlabNormalizePublicTxtPath(src);
    if (KITLAB_PUBLIC_USED_BY_TXT_PATHS.has(clean)) return true;
    const lower = clean.toLowerCase();
    for (const item of KITLAB_PUBLIC_USED_BY_TXT_PATHS) {{
      if (String(item).toLowerCase() === lower) return true;
    }}
    return false;
  }}

  function kitlabTextLooksLikeHtmlFallback(text) {{
    const value = String(text || '').trim().slice(0, 2000).toLowerCase();
    if (!value) return false;
    return value.includes('<!doctype') || value.includes('<html') || value.includes('<head') || value.includes('<body') || value.includes('<script') || value.includes('<canvas') || value.includes('id="kitcanvas"') || value.includes('app-shell') || value.includes('kitlab pe');
  }}
'''

    # Remove previous copy if present, then reinsert with current used_by path list.
    if MARK in text:
        pattern = re.compile(r"\n\s*// KITLAB_USED_BY_HTML_FALLBACK_FIX_V1[\s\S]*?\n\s*function hydrateTemplateUsedByPopover\(card\) \{")
        text, n = pattern.subn('\n  function hydrateTemplateUsedByPopover(card) {', text, count=1)
        if n == 0:
            # leave it and continue to avoid destructive edits
            pass

    target = '  async function hydrateTemplateUsedByPopover(card) {'
    if target not in text:
        raise RuntimeError('No encuentro hydrateTemplateUsedByPopover(card) en app.js')
    if MARK not in text:
        text = text.replace(target, helper + '\n' + target, 1)

    old = '''    try {
      if (src) {
        const url = `${src}${src.includes("?") ? "&" : "?"}_kitlab_txt=${Date.now()}`;
        const response = await fetch(url, { cache: "no-store" });
        if (response.ok && renderText(await response.text())) return;
      }
      clear();
    } catch (err) {
      clear();
    }'''
    new = '''    try {
      if (src) {
        // Public web safety: only fetch physical used_by.txt files that exist in the public asset tree.
        // Otherwise Cloudflare may return index.html and KitLab would display HTML text on thumbnails.
        if (!kitlabPublicUsedByTxtExists(src)) {
          clear();
          return;
        }
        const url = `${src}${src.includes("?") ? "&" : "?"}_kitlab_txt=${Date.now()}`;
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) { clear(); return; }
        const contentType = String(response.headers.get("content-type") || "").toLowerCase();
        const text = await response.text();
        if (contentType.includes("text/html") || kitlabTextLooksLikeHtmlFallback(text)) {
          clear();
          return;
        }
        if (renderText(text)) return;
      }
      clear();
    } catch (err) {
      clear();
    }'''
    if old in text:
        text = text.replace(old, new, 1)
    elif 'kitlabPublicUsedByTxtExists(src)' not in text:
        raise RuntimeError('No encuentro el bloque fetch used_by esperado para parchearlo.')

    APP.write_text(text, encoding='utf-8')
    return used_by


def main():
    log = []
    log.append('KITLAB6 FIX USED_BY HTML FALLBACK')
    log.append('=' * 80)
    log.append(f'Root: {ROOT}')
    removed = remove_asset_index_html()
    log.append(f'Removed assets/**/index.html: {len(removed)}')
    used_by = patch_app()
    log.append(f'Physical used_by.txt files detected: {len(used_by)}')
    for item in used_by[:80]:
        log.append(f'  used_by: {item}')
    if len(used_by) > 80:
        log.append(f'  ... {len(used_by) - 80} more')
    log.append('')
    log.append('NEXT')
    log.append('1. Commit this on branch web-test only.')
    log.append('2. Push web-test / Publish branch.')
    log.append('3. Test the new Cloudflare preview with Ctrl+F5.')
    log.append('4. Do not push main until preview is clean.')
    REPORT.write_text('\n'.join(log), encoding='utf-8')
    print('OK - used_by HTML fallback fix applied')
    print(f'Report: {REPORT.name}')
    print(f'Used_by txt files: {len(used_by)}')
    print(f'Removed asset index.html files: {len(removed)}')

if __name__ == '__main__':
    try:
        main()
    except Exception:
        ERROR.write_text(traceback.format_exc(), encoding='utf-8')
        print('ERROR - see', ERROR.name)
        sys.exit(1)
