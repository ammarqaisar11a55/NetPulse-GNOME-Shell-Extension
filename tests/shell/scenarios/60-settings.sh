# shellcheck shell=bash
# Usage and network preferences take effect in the running extension.

np_eval 'ext._speedMonitor._stopTimer()' >/dev/null
add_usage() {
    np_eval "(ext._speedMonitor._publish({iface: ext._speedMonitor.iface, download: 0, upload: 0, rxDelta: $1, txDelta: 0}), true)" >/dev/null
}
today_rx() { np_eval 'ext._usageTracker.totals.today.rx'; }

np_eval '(ext._usageTracker.resetAll(), true)' >/dev/null

# Pausing tracking.
np_set usage-tracking false
add_usage 1000
expect_eq "paused tracking records nothing" "$(today_rx)" 0
np_eval 'ext._indicator.menu.open(false)' >/dev/null
sleep 0.2
expect_eq "popup says tracking is off" "$(np_eval 'ext._dashboard._usagePaused.visible')" true
np_eval 'ext._indicator.menu.close(false)' >/dev/null
np_reset usage-tracking
add_usage 1000
expect_eq "resumed tracking records again" "$(today_rx)" 1000

np_set usage-retention-days 40
expect_eq "retention is applied" "$(np_eval 'ext._usageTracker._retentionDays')" 40
np_reset usage-retention-days

# Reset requests from the preferences, live and while disabled.
np_set usage-reset-request "$(date +%s)"
expect_eq "reset request erases statistics" "$(today_rx)" 0
add_usage 5000000000
gnome-extensions disable "$UUID"; sleep 0.3
np_set usage-reset-request "$(($(date +%s) + 1))"
gnome-extensions enable "$UUID"; sleep 0.5
np_eval 'ext._speedMonitor._stopTimer()' >/dev/null
# Real traffic while disabled may legitimately be recovered after the reset.
expect_true "reset requested while disabled is applied on enable" test "$(today_rx)" -lt 5000000000

# Manual interface selection.
wait_for true 'ext._interfaceMonitor.info.name !== null'
auto_iface="$(np_eval 'ext._interfaceMonitor.info.name')"
np_set manual-interface "${auto_iface//\"/}"
sleep 0.5
expect_eq "chosen interface is monitored" "$(np_eval 'ext._interfaceMonitor.info.name')" "$auto_iface"
expect_eq "source shows the manual choice" "$(np_eval 'ext._interfaceMonitor.info.source')" '"manual"'
np_set manual-interface "'np-missing0'"
sleep 0.5
expect_eq "missing chosen interface means offline" "$(np_eval 'ext._speedMonitor.iface')" null
expect_true "panel is dimmed" wait_for 128 'ext._indicator._box.opacity'
np_reset manual-interface
sleep 0.5
expect_eq "automatic detection resumes" "$(np_eval 'ext._interfaceMonitor.info.name')" "$auto_iface"
