# shellcheck shell=bash
# Failures are contained: NetPulse keeps working, logs each problem once and
# recovers when the cause goes away.

DATA_DIR="$XDG_DATA_HOME/netpulse"

# Start fresh: earlier scenarios stop the sampling timer to inject values.
gnome-extensions disable "$UUID"; sleep 0.3
gnome-extensions enable "$UUID"; sleep 0.5
log_count() { grep -c "$1" "$LOG"; }

# An invalid interface name in the settings is ignored.
wait_for true 'ext._interfaceMonitor.info.name !== null'
auto_iface="$(np_eval 'ext._interfaceMonitor.info.name')"
np_set manual-interface "'../../etc'"
sleep 0.5
expect_eq "invalid interface name falls back to detection" "$(np_eval 'ext._interfaceMonitor.info.name')" "$auto_iface"
expect_eq "invalid interface name is reported" "$(log_count 'Ignoring invalid interface name')" 1
np_reset manual-interface

# A sampling error does not stop monitoring.
np_eval '(c => { c._update = c.update; c.update = () => { throw new Error("simulated failure"); }; return true; })(ext._speedMonitor._calculator)' >/dev/null
sleep 2.5
expect_eq "the error is logged" "$(log_count 'Unexpected error while sampling network speed')" 1
expect_true "the sampling timer keeps running" test "$(np_eval 'ext._speedMonitor._timerId')" != 0
before="$(np_eval 'ext._speedMonitor.history.length')"
np_eval '(c => { c.update = c._update; return true; })(ext._speedMonitor._calculator)' >/dev/null
sleep 3.5
expect_true "sampling resumes once the error goes away" test "$(np_eval 'ext._speedMonitor.history.length')" -gt "$before"

# An unwritable data directory: warn once, keep running, recover later.
np_eval "(ext._usageTracker._dirty = true, ext._usageTracker.save(), true)" >/dev/null
expect_true "data directory exists" test -d "$DATA_DIR"
chmod 500 "$DATA_DIR"
np_eval "(ext._speedMonitor._publish({iface: ext._speedMonitor.iface, download: 0, upload: 0, rxDelta: 1000, txDelta: 0}), true)" >/dev/null
np_eval '(ext._usageTracker.save(), ext._usageTracker.save(), true)' >/dev/null
np_eval "(ext._speedMonitor._publish({iface: ext._speedMonitor.iface, download: 0, upload: 0, rxDelta: 1000, txDelta: 0}), true)" >/dev/null
np_eval '(ext._usageTracker.save(), true)' >/dev/null
sleep 0.5 # saves complete asynchronously
expect_eq "a failing save is reported once" "$(log_count 'Cannot save usage data')" 1
expect_eq "extension stays active" "$(ext_state)" ACTIVE
chmod 700 "$DATA_DIR"
np_eval '(ext._usageTracker.save(), true)' >/dev/null
sleep 0.5
expect_eq "recovery is reported" "$(log_count 'Usage data can be saved again')" 1
