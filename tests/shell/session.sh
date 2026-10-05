#!/usr/bin/env bash
# Runs inside a private D-Bus session (see tools/test-headless.sh): starts a
# headless GNOME Shell, runs each scenario against it and exits with the
# number of failed checks.
set -u

gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "['$HELPER_UUID', '$UUID']"
gsettings set org.gnome.shell welcome-dialog-last-shown-version "999"

gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800 \
    --wayland-display "wayland-netpulse-$$" >"$LOG" 2>&1 &
SHELL_PID=$!

if ! gdbus wait --session --timeout 30 org.gnome.Shell; then
    echo "shell did not start"
    exit 1
fi
sleep 2

# shellcheck source=tests/shell/lib.sh
source "$ROOT/tests/shell/lib.sh"

# Startup shows the overview; tests want the plain desktop.
shell_eval 'Main.overview.hide()' >/dev/null

for scenario in "$@"; do
    echo "--- scenario: $(basename "$scenario" .sh)"
    # shellcheck disable=SC1090
    source "$scenario"
done

kill "$SHELL_PID"
wait "$SHELL_PID" 2>/dev/null
exit "$FAILURES"
