#!/usr/bin/env python3
"""Brings web/ up to date with the hosted NIPOS pages.

    python3 scripts/update-from-nipos.py [path to the hosted NIPOS folder; default ../NIPOS]

Copies every page, script, stylesheet and image from the hosted NIPOS folder into web/, then makes the
same few changes every time so the copy runs on this server with no internet:
  - the Google Fonts link becomes the bundled web/vendor/fonts/fonts.css
  - the Supabase library and Chart.js load from web/vendor/ instead of CDNs, and config.js
    (written by scripts/start.sh) loads straight after the Supabase library
  - db.js talks to this server's own API instead of the cloud project
  - push notifications use this server's own send-push function and VAPID key
Stops with an error, changing nothing, if any of those no longer matches, so a change upstream can't
quietly leave a page pointing at the cloud. Database changes are separate: add a migration under
supabase/migrations/ (see README).
"""
import pathlib, re, shutil, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
# Default: the hosted NIPOS folder next to this one (both live in the KeystoneGD.github.io repository).
SRC = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT.parent / "NIPOS").resolve()

COPY_SUFFIXES = {".html", ".js", ".css", ".json", ".png", ".jpg", ".wav", ".ico", ".svg", ".webmanifest"}
SKIP_DIRS = {"supabase", "vendor"}

FONTS = (re.compile(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com/css2\?[^"]*">'),
         '<link rel="stylesheet" href="vendor/fonts/fonts.css">')
SUPABASE_JS = (re.compile(r'<script src="https://cdn\.jsdelivr\.net/npm/@supabase/supabase-js@2/dist/umd/supabase\.js"></script>'),
               '<script src="vendor/supabase.js"></script>\n<script src="config.js"></script>')
CHART_JS = (re.compile(r'<script src="https://cdnjs\.cloudflare\.com/ajax/libs/Chart\.js/[^"]+/chart\.umd\.min\.js"></script>'),
            '<script src="vendor/chart.umd.min.js"></script>')
PUSH_URL = (re.compile(r'const SEND_PUSH_URL = "https://[a-z0-9]+\.supabase\.co/functions/v1/send-push";'),
            'const SEND_PUSH_URL = SUPABASE_URL + "/functions/v1/send-push";')
VAPID = (re.compile(r'const VAPID_PUBLIC_KEY = "[A-Za-z0-9_-]+";'),
         'const VAPID_PUBLIC_KEY = NIPOS_CONFIG.vapidPublicKey;')
DB_CONFIG = (re.compile(r'const SUPABASE_URL = "https://[a-z0-9]+\.supabase\.co";\nconst SUPABASE_ANON_KEY = "[^"]+";'),
             '''// The local Supabase API runs on the same server that serves these pages (the Chromebook), so it's
// reached through whatever hostname/IP the till used to open the page - "localhost" on the Chromebook
// itself, its LAN IP from every other device. config.js is written by scripts/start.sh.
const NIPOS_CONFIG = window.NIPOS_CONFIG || {};
const SUPABASE_URL = location.protocol + "//" + location.hostname + ":" + (NIPOS_CONFIG.apiPort || 54321);
const SUPABASE_ANON_KEY = NIPOS_CONFIG.anonKey;''')

# The system guide sits one folder down, so its fonts come from ../vendor/.
GUIDE_FONTS = (FONTS[0], '<link rel="stylesheet" href="../vendor/fonts/fonts.css">')

# Which rewrites each file must contain (exactly once). Pages not listed are copied unchanged.
RULES = {
    "index.html": [FONTS, SUPABASE_JS, PUSH_URL, VAPID],
    "orders.html": [FONTS, SUPABASE_JS, PUSH_URL, VAPID],
    "backend.html": [FONTS, SUPABASE_JS, CHART_JS],
    "display.html": [FONTS, SUPABASE_JS],
    "db.js": [DB_CONFIG],
    "system-guide/index.html": [GUIDE_FONTS],
}
# Nothing that reaches the internet may survive in a copied file.
FORBIDDEN = re.compile(r"supabase\.co\b|fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr|cdnjs\.cloudflare|unpkg\.com")


def main():
    if not (SRC / "index.html").exists() or not (SRC / "db.js").exists():
        sys.exit(f"Can't find the NIPOS pages in {SRC}")
    files = [p for p in SRC.rglob("*") if p.is_file() and p.suffix in COPY_SUFFIXES
             and not (set(p.relative_to(SRC).parts[:-1]) & SKIP_DIRS)]
    out = {}
    for p in files:
        rel = p.relative_to(SRC).as_posix()
        if p.suffix in {".html", ".js", ".css", ".json", ".webmanifest", ".svg"}:
            text = p.read_text(encoding="utf-8")
            for pattern, replacement in RULES.get(rel, []):
                text, n = pattern.subn(lambda _m: replacement, text)
                if n != 1:
                    sys.exit(f"{rel}: expected exactly one match for {pattern.pattern!r}, found {n}. Nothing was changed.")
            if FORBIDDEN.search(text):
                sys.exit(f"{rel} still points at the internet ({FORBIDDEN.search(text).group(0)}). Nothing was changed.")
            out[rel] = text
        else:
            out[rel] = p.read_bytes()
    for rel, content in sorted(out.items()):
        dest = WEB / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, str): dest.write_text(content, encoding="utf-8")
        else: dest.write_bytes(content)
    print(f"Updated {len(out)} files in web/ from {SRC}")


if __name__ == "__main__":
    main()
