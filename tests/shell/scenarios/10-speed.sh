# shellcheck shell=bash
# Speed sampling runs inside the shell on the detected interface.

expect_true "an interface is detected" wait_for true 'ext._interfaceMonitor.info.name !== null'
iface="$(np_eval 'ext._interfaceMonitor.info.name')"
expect_eq "speed monitor follows the detected interface" "$(np_eval 'ext._speedMonitor.iface')" "$iface"

# Whole-second timers are batched by GLib, so ticks may drift by up to a
# second; measure over a window long enough to absorb that.
samples_before="$(np_eval 'ext._speedMonitor.history.length')"
sleep 5
samples=$(($(np_eval 'ext._speedMonitor.history.length') - samples_before))
expect_true "samples arrive about once per second ($samples in 5 s)" test "$samples" -ge 4 -a "$samples" -le 6

np_set refresh-interval 0.5
sleep 0.2
expect_eq "refresh interval setting is applied" "$(np_eval 'ext._speedMonitor.intervalMs')" 500
np_set refresh-interval 50.0 2>/dev/null || true
expect_eq "out-of-range interval is rejected by the schema" "$(np_eval 'ext._speedMonitor.intervalMs')" 500
np_reset refresh-interval
sleep 0.2
expect_eq "interval returns to default" "$(np_eval 'ext._speedMonitor.intervalMs')" 1000
