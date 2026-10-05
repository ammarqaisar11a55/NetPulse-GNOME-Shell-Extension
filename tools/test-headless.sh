#!/usr/bin/env bash
# Runs NetPulse inside an isolated, headless GNOME Shell and executes test
# scenarios against it. Nothing touches the real user session: all XDG
# directories point to a throwaway temp dir and a private D-Bus session bus
# is used.
#
# Usage: tools/test-headless.sh [scenario.sh ...]
#   Scenarios live in tests/shell/scenarios/; the default runs all of them.
#   With NETPULSE_NETNS=1 the default is tests/shell/netns/ instead.
#   Screenshots go to $NETPULSE_TEST_OUTPUT (default: ./test-output).
set -euo pipefail

# NETPULSE_NETNS=1 runs everything inside a private user + network namespace
# (no root needed), where scenarios may create and remove interfaces.
if [[ "${NETPULSE_NETNS:-}" == 1 && -z "${NETPULSE_IN_NETNS:-}" ]]; then
    exec unshare --user --map-root-user --net --mount \
        env NETPULSE_IN_NETNS=1 bash -c 'mount -t sysfs sysfs /sys && ip link set lo up && exec "$0" "$@"' \
        "$0" "$@"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UUID="$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' "$ROOT/metadata.json")"
HELPER_UUID="netpulse-test-helper@netpulse.test"
OUTPUT="${NETPULSE_TEST_OUTPUT:-$ROOT/test-output}"

if [[ $# -gt 0 ]]; then
    SCENARIOS=("$@")
elif [[ -n "${NETPULSE_IN_NETNS:-}" ]]; then
    SCENARIOS=("$ROOT"/tests/shell/netns/*.sh)
else
    SCENARIOS=("$ROOT"/tests/shell/scenarios/*.sh)
fi
for i in "${!SCENARIOS[@]}"; do
    SCENARIOS[i]="$(realpath "${SCENARIOS[i]}")"
done

WORK="$(mktemp -d -t netpulse-test-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

# Never let anything started by the tests reach the user's real session: a
# private runtime directory makes the real Wayland/X11 sockets unreachable
# (libwayland falls back to $XDG_RUNTIME_DIR/wayland-0 when WAYLAND_DISPLAY
# is unset). session.sh points clients at the headless shell instead.
export XDG_RUNTIME_DIR="$WORK/runtime"
mkdir -m 0700 "$XDG_RUNTIME_DIR"
unset DISPLAY WAYLAND_DISPLAY GNOME_KEYRING_CONTROL SSH_AUTH_SOCK

export XDG_DATA_HOME="$WORK/data" XDG_CONFIG_HOME="$WORK/config" \
       XDG_CACHE_HOME="$WORK/cache" XDG_STATE_HOME="$WORK/state"
EXT_DIR="$XDG_DATA_HOME/gnome-shell/extensions/$UUID"
# Install exactly as users do, from the packed bundle.
dbus-run-session -- "$ROOT/install.sh" --quiet 2>"$WORK/install.log" || {
    cat "$WORK/install.log"
    exit 1
}
cp -r "$ROOT/tests/shell/helper" "$XDG_DATA_HOME/gnome-shell/extensions/$HELPER_UUID"

LOG="$WORK/shell.log"
export ROOT UUID HELPER_UUID EXT_DIR LOG OUTPUT XDG_DATA_HOME

status=0
dbus-run-session -- bash "$ROOT/tests/shell/session.sh" "${SCENARIOS[@]}" \
    2>"$WORK/session.log" || status=$?
mkdir -p "$OUTPUT"
cp "$LOG" "$OUTPUT/gnome-shell.log"
cp "$WORK/session.log" "$OUTPUT/session.log"

echo "--- NetPulse log lines ---"
grep -F "[NetPulse]" "$LOG" || true
echo "--- JS errors ---"
# Known messages from GNOME Shell itself, unrelated to NetPulse:
# - its power toggle (status/system.js) can receive a UPower update after
#   being disposed while the shell shuts down;
# - inside the namespace the shell runs as (mapped) root, which logind does
#   not know about.
NOISE='Gjs_status_system_PowerToggle .* has been already disposed'
[[ -n "${NETPULSE_IN_NETNS:-}" ]] && NOISE="$NOISE|Could not get a proxy for user 0"
if grep -E "JS ERROR|JS WARNING|-ERROR \*\*|-CRITICAL \*\*|Error.*$UUID|Extension $UUID" "$LOG" | grep -vE "$NOISE"; then
    exit 1
fi
# The preferences app logs through the session bus.
if grep -E "JS ERROR|JS WARNING|$UUID.*(Error|error)" "$WORK/session.log"; then
    exit 1
fi
echo "none"
if [[ $status -ne 0 ]]; then
    echo "FAILED: $status check(s)"
    exit 1
fi
echo "PASSED"
