#!/usr/bin/env bash
# Builds the installable extension bundle (the same format as
# extensions.gnome.org uses) into dist/ and prints its path.
#
# Uses `gnome-extensions pack` when available; otherwise (e.g. on a build
# server without GNOME Shell) creates the same layout with zip.
#
# Usage: tools/build.sh [output-dir]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$ROOT/dist}"
UUID="$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' "$ROOT/metadata.json")"
SCHEMA=schemas/org.gnome.shell.extensions.netpulse.gschema.xml

mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
BUNDLE="$OUT_DIR/$UUID.shell-extension.zip"

if command -v gnome-extensions >/dev/null; then
    gnome-extensions pack --force --out-dir="$OUT_DIR" \
        --extra-source="$ROOT/src" --schema="$ROOT/$SCHEMA" "$ROOT"
elif command -v zip >/dev/null; then
    rm -f "$BUNDLE"
    (cd "$ROOT" && zip -q -r -X "$BUNDLE" metadata.json extension.js prefs.js stylesheet.css "$SCHEMA" src)
else
    echo "error: neither gnome-extensions nor zip is available" >&2
    exit 1
fi

echo "$BUNDLE"
