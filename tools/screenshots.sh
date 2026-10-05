#!/usr/bin/env bash
# Regenerates the documentation screenshots in docs/screenshots/ using a
# headless GNOME Shell and neutral demo data.
#
# Usage: tools/screenshots.sh [output-dir]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export NETPULSE_TEST_OUTPUT="${1:-$ROOT/docs/screenshots}"
mkdir -p "$NETPULSE_TEST_OUTPUT"
"$ROOT/tools/test-headless.sh" "$ROOT/tests/shell/showcase/showcase.sh"
# The harness also leaves its logs there; keep only images.
rm -f "$NETPULSE_TEST_OUTPUT"/*.log
# Popup cards get the theme's rounded corners (20 px) on transparency.
python3 "$ROOT/tools/round-corners.py" 20 "$NETPULSE_TEST_OUTPUT"/card-*.png
