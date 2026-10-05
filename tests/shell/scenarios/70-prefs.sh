# shellcheck shell=bash
# The preferences window opens, and changes made in it reach the running
# extension. Widgets are operated through the accessibility tree.

prefs_get() { gsettings --schemadir "$EXT_DIR/schemas" get org.gnome.shell.extensions.netpulse "$1"; }
ui() {
    python3 "$ROOT/tests/shell/a11y.py" activate org.gnome.Shell.Extensions "$@" ||
        fail "could not operate the '$1' widget"
}
# Button rows only react to real clicks, not to the accessibility action, so
# click them where GTK says they are.
press() {
    local center rect
    center="$(python3 "$ROOT/tests/shell/a11y.py" center org.gnome.Shell.Extensions "$@")" ||
        { fail "could not find the '$1' widget"; return; }
    read -r cx cy <<<"$center"
    read -r wx wy _ _ <<<"$(wait_window NetPulse)"
    click $((wx + cx)) $((wy + cy))
}

np_eval 'ext._speedMonitor._stopTimer()' >/dev/null
np_eval "(ext._speedMonitor._publish({iface: ext._speedMonitor.iface, download: 4820000, upload: 1210000, rxDelta: 7000000000, txDelta: 0}), true)" >/dev/null

gnome-extensions prefs "$UUID"
r="$(wait_window NetPulse)"
expect_true "preferences window opens" test -n "$r"
# The first click on a new window only focuses it; use empty header space.
read -r wx wy _ _ <<<"$r"
click $((wx + 70)) $((wy + 23))
screenshot prefs-display

# Display page: Show Units.
ui "Show Units" switch
expect_eq "Show Units switch updates the setting" "$(prefs_get show-units)" false
expect_eq "panel follows the switch" "$(np_eval 'ext._indicator.text')" '"↓ 4.82  ↑ 1.21"'
ui "Show Units" switch
expect_eq "switching back restores units" "$(prefs_get show-units)" true

# Network page: turning off automatic detection picks an interface.
ui Notifications "page tab"
screenshot prefs-notifications
ui Network "page tab"
screenshot prefs-network
ui "Detect Automatically" switch
expect_true "turning off auto-detection selects an interface" test "$(prefs_get manual-interface)" != "''"
expect_eq "extension monitors the chosen interface" "$(np_eval 'ext._interfaceMonitor.info.source')" '"manual"'
ui "Detect Automatically" switch
expect_eq "turning auto-detection back on clears the choice" "$(prefs_get manual-interface)" "''"

# Usage page: reset statistics, with confirmation.
ui Usage "page tab"
screenshot prefs-usage
request_before="$(prefs_get usage-reset-request)"
press "Reset Statistics…"
screenshot prefs-reset-dialog
ui Cancel button
expect_eq "cancelling sends no reset request" "$(prefs_get usage-reset-request)" "$request_before"
expect_true "statistics are still there" test "$(np_eval 'ext._usageTracker.totals.today.rx')" -ge 7000000000
press "Reset Statistics…"
ui Reset button
expect_true "confirming sends a reset request" test "$(prefs_get usage-reset-request)" != "$request_before"
expect_true "the extension erases statistics" test "$(np_eval 'ext._usageTracker.totals.today.rx')" -lt 7000000000

# The popup's settings button opens the same window.
close_prefs() {
    shell_eval "global.display.list_all_windows().filter(w => w.title === 'NetPulse')
        .forEach(w => w.delete(global.get_current_time()))" >/dev/null
    for _ in $(seq 20); do [[ -z "$(window_rect NetPulse)" ]] && return; sleep 0.25; done
}
close_prefs
expect_eq "preferences window closes" "$(window_rect NetPulse)" ""
np_eval "(ext._dashboard._settingsButton.emit('clicked', 1), true)" >/dev/null
expect_true "popup settings button opens the preferences" wait_window NetPulse
close_prefs
