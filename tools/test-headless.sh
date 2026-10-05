#!/usr/bin/env bash
# Runs NetPulse inside an isolated, headless GNOME Shell and executes test
# scenarios against it. Nothing touches the real user session: all XDG
# directories point to a throwaway temp dir and a private D-Bus session bus
# is used.
#
# Usage: tools/test-headless.sh [scenario.sh ...]
#   Scenarios live in tests/shell/scenarios/; the default runs all of them.
#   Screenshots go to $NETPULSE_TEST_OUTPUT (default: ./test-output).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UUID="$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' "$ROOT/metadata.json")"
HELPER_UUID="netpulse-test-helper@netpulse.test"
OUTPUT="${NETPULSE_TEST_OUTPUT:-$ROOT/test-output}"

if [[ $# -gt 0 ]]; then
    SCENARIOS=("$@")
else
    SCENARIOS=("$ROOT"/tests/shell/scenarios/*.sh)
fi
for i in "${!SCENARIOS[@]}"; do
    SCENARIOS[i]="$(realpath "${SCENARIOS[i]}")"
done

WORK="$(mktemp -d -t netpulse-test-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

export XDG_DATA_HOME="$WORK/data" XDG_CONFIG_HOME="$WORK/config" \
       XDG_CACHE_HOME="$WORK/cache" XDG_STATE_HOME="$WORK/state"
EXT_DIR="$XDG_DATA_HOME/gnome-shell/extensions/$UUID"
mkdir -p "$EXT_DIR"
cp -r "$ROOT"/{metadata.json,extension.js,schemas,src} "$EXT_DIR"/
for f in prefs.js stylesheet.css stylesheet-dark.css stylesheet-light.css; do
    if [[ -f "$ROOT/$f" ]]; then cp "$ROOT/$f" "$EXT_DIR/"; fi
done
glib-compile-schemas "$EXT_DIR/schemas"
cp -r "$ROOT/tests/shell/helper" "$XDG_DATA_HOME/gnome-shell/extensions/$HELPER_UUID"

LOG="$WORK/shell.log"
export ROOT UUID HELPER_UUID EXT_DIR LOG OUTPUT

status=0
dbus-run-session -- bash "$ROOT/tests/shell/session.sh" "${SCENARIOS[@]}" \
    2>"$WORK/session.log" || status=$?

echo "--- NetPulse log lines ---"
grep -F "[NetPulse]" "$LOG" || true
echo "--- JS errors ---"
if grep -E "JS ERROR|JS WARNING|Error.*$UUID|Extension $UUID" "$LOG"; then
    exit 1
fi
echo "none"
if [[ $status -ne 0 ]]; then
    echo "FAILED: $status check(s)"
    exit 1
fi
echo "PASSED"
