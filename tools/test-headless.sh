#!/usr/bin/env bash
# Runs NetPulse inside an isolated, headless GNOME Shell and exercises the
# enable/disable lifecycle. Nothing touches the real user session: all XDG
# directories point to a throwaway temp dir and a private D-Bus session bus
# is used.
#
# Usage: tools/test-headless.sh [seconds-to-run]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UUID="$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' "$ROOT/metadata.json")"
RUN_SECONDS="${1:-5}"

WORK="$(mktemp -d -t netpulse-test-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

export XDG_DATA_HOME="$WORK/data" XDG_CONFIG_HOME="$WORK/config" \
       XDG_CACHE_HOME="$WORK/cache" XDG_STATE_HOME="$WORK/state"
EXT_DIR="$XDG_DATA_HOME/gnome-shell/extensions/$UUID"
mkdir -p "$EXT_DIR"
cp -r "$ROOT"/{metadata.json,extension.js,schemas,src} "$EXT_DIR"/
for f in prefs.js stylesheet.css; do
    [[ -f "$ROOT/$f" ]] && cp "$ROOT/$f" "$EXT_DIR/"
done
glib-compile-schemas "$EXT_DIR/schemas"

LOG="$WORK/shell.log"
export UUID RUN_SECONDS LOG

dbus-run-session -- bash -c '
    set -u
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell enabled-extensions "[\"$UUID\"]"
    gsettings set org.gnome.shell welcome-dialog-last-shown-version "999"

    gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800 \
        --wayland-display "wayland-netpulse-$$" >"$LOG" 2>&1 &
    SHELL_PID=$!

    gdbus wait --session --timeout 30 org.gnome.Shell || { echo "shell did not start"; exit 1; }
    sleep 2

    state() { gnome-extensions info "$UUID" | sed -n "s/^ *State: //p"; }
    echo "initial state:   $(state)"
    sleep "$RUN_SECONDS"
    gnome-extensions disable "$UUID"; sleep 1
    echo "after disable:   $(state)"
    gnome-extensions enable "$UUID"; sleep 1
    echo "after re-enable: $(state)"

    kill "$SHELL_PID"; wait "$SHELL_PID" 2>/dev/null
    true
' 2>"$WORK/session.log"

echo "--- NetPulse log lines ---"
grep -F "[NetPulse]" "$LOG" || true
echo "--- JS errors ---"
if grep -E "JS ERROR|JS WARNING|Error.*$UUID|Extension $UUID" "$LOG"; then
    exit 1
fi
echo "none"
