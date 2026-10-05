# shellcheck shell=bash
# The preferences window opens, and changes made in it reach the running
# extension. Positions are relative to the window (760x720 default size).

prefs_get() { gsettings --schemadir "$EXT_DIR/schemas" get org.gnome.shell.extensions.netpulse "$1"; }
at() { click $((wx + $1)) $((wy + $2)); }

np_eval 'ext._speedMonitor._stopTimer()' >/dev/null
np_eval "(ext._speedMonitor._publish({iface: ext._speedMonitor.iface, download: 4820000, upload: 1210000, rxDelta: 7000000000, txDelta: 0}), true)" >/dev/null

gnome-extensions prefs "$UUID"
r=""
for _ in $(seq 30); do
    sleep 0.5
    r="$(window_rect NetPulse)"
    [[ -n "$r" ]] && break
done
expect_true "preferences window opens" test -n "$r"
read -r wx wy _ _ <<<"$r"
sleep 1
at 100 23   # focus the window; the first click only activates it
screenshot prefs-display

# Display page: Show Units.
at 609 302
expect_eq "Show Units switch updates the setting" "$(prefs_get show-units)" false
expect_eq "panel follows the switch" "$(np_eval 'ext._indicator.text')" '"↓ 4.82  ↑ 1.21"'
at 609 302
expect_eq "switching back restores units" "$(prefs_get show-units)" true

# Network page: turning off automatic detection picks an interface.
at 450 23
screenshot prefs-notifications
at 588 23
screenshot prefs-network
at 608 137
expect_true "turning off auto-detection selects an interface" test "$(prefs_get manual-interface)" != "''"
expect_eq "extension monitors the chosen interface" "$(np_eval 'ext._interfaceMonitor.info.source')" '"manual"'
at 608 137
expect_eq "turning auto-detection back on clears the choice" "$(prefs_get manual-interface)" "''"

# Usage page: reset statistics, with confirmation.
at 312 23
screenshot prefs-usage
request_before="$(prefs_get usage-reset-request)"
at 379 377
sleep 0.5
screenshot prefs-reset-dialog
at 295 411  # Cancel
expect_eq "cancelling sends no reset request" "$(prefs_get usage-reset-request)" "$request_before"
expect_true "statistics are still there" test "$(np_eval 'ext._usageTracker.totals.today.rx')" -ge 7000000000
at 379 377
sleep 0.5
at 463 411  # Reset
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
for _ in $(seq 30); do [[ -n "$(window_rect NetPulse)" ]] && break; sleep 0.5; done
expect_true "popup settings button opens the preferences" test -n "$(window_rect NetPulse)"
close_prefs
