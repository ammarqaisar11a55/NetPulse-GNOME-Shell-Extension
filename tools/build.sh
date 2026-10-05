#!/usr/bin/env bash
# Builds the installable extension bundle (the same format as
# extensions.gnome.org uses) into dist/.
#
# Usage: tools/build.sh [output-dir]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$ROOT/dist}"

if ! command -v gnome-extensions >/dev/null; then
    echo "error: gnome-extensions not found (it is part of the gnome-shell package)" >&2
    exit 1
fi

mkdir -p "$OUT_DIR"
gnome-extensions pack --force --out-dir="$OUT_DIR" \
    --extra-source="$ROOT/src" \
    --schema="$ROOT/schemas/org.gnome.shell.extensions.netpulse.gschema.xml" \
    "$ROOT"

UUID="$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' "$ROOT/metadata.json")"
echo "$OUT_DIR/$UUID.shell-extension.zip"
