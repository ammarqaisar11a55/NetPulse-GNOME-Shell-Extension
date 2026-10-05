#!/usr/bin/env bash
# Runs inside a private D-Bus session (see tools/test-headless.sh): starts a
# headless GNOME Shell, runs each scenario against it and exits with the
# number of failed checks.
set -u

gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "['$HELPER_UUID', '$UUID']"
gsettings set org.gnome.shell welcome-dialog-last-shown-version "999"

# shellcheck source=tests/shell/lib.sh
source "$ROOT/tests/shell/lib.sh"

HEADLESS_DISPLAY="wayland-netpulse-$$"

# Apps started by scenarios, directly or through D-Bus activation (such as
# the extension preferences), open their windows in the headless shell. Set
# before anything can be activated.
dbus-update-activation-environment WAYLAND_DISPLAY="$HEADLESS_DISPLAY" GDK_BACKEND=wayland

start_shell() {
    env -u WAYLAND_DISPLAY gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800 \
        --wayland-display "$HEADLESS_DISPLAY" >>"$LOG" 2>&1 &
    SHELL_PID=$!
    if ! gdbus wait --session --timeout 30 org.gnome.Shell; then
        echo "shell did not start"
        exit 1
    fi
    # Wait for the extensions to load, then leave the startup overview.
    for _ in $(seq 40); do
        [[ "$(ext_state)" == ACTIVE ]] && break
        sleep 0.25
    done
    sleep 0.5
    shell_eval 'Main.overview.hide()' >/dev/null
}

# Stops the shell with the given signal (TERM: clean exit, KILL: crash) and
# starts a new one with the same data directories.
restart_shell() {
    kill "-${1:-TERM}" "$SHELL_PID"
    wait "$SHELL_PID" 2>/dev/null
    start_shell
}

start_shell

export WAYLAND_DISPLAY="$HEADLESS_DISPLAY" GDK_BACKEND=wayland

for scenario in "$@"; do
    echo "--- scenario: $(basename "$scenario" .sh)"
    # shellcheck disable=SC1090
    source "$scenario"
    if ! kill -0 "$SHELL_PID" 2>/dev/null; then
        fail "gnome-shell exited during $(basename "$scenario")"
        exit "$FAILURES"
    fi
done

kill "$SHELL_PID"
wait "$SHELL_PID" 2>/dev/null
exit "$FAILURES"
