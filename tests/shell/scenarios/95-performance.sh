# shellcheck shell=bash
# Resource use: everything is released on disable, traffic does not cause
# disk writes, CPU overhead is negligible and memory stays flat across
# disable/enable cycles (as on every screen lock).

TICKS=$(getconf CLK_TCK)
cpu_ms() { awk -v t="$TICKS" '{print int(($14 + $15) * 1000 / t)}' "/proc/$SHELL_PID/stat"; }
rss() { awk '/^VmRSS/ {print $2}' "/proc/$SHELL_PID/status"; }
gc() { for _ in 1 2 3; do shell_eval '(imports.system.gc(), true)' >/dev/null; sleep 1; done; }

# Everything stops on disable.
np_eval '(globalThis._np = {sm: ext._speedMonitor, im: ext._interfaceMonitor, ut: ext._usageTracker,
    settings: ext._settings, nm: ext._interfaceMonitor._nm}, true)' >/dev/null
gnome-extensions disable "$UUID"; sleep 0.3
expect_eq "speed timer removed" "$(shell_eval '_np.sm._timerId')" 0
expect_eq "autosave timer removed" "$(shell_eval '_np.ut._saveTimerId')" 0
expect_eq "NetworkManager signals released" "$(shell_eval '_np.nm._watched.length + (_np.nm._clientHandlers?.length ?? 0)')" 0
expect_eq "no handlers left on internal objects" \
    "$(shell_eval '_np.sm.handlerCount + _np.im.handlerCount + _np.ut.handlerCount + _np.settings.handlerCount')" 0
shell_eval '(delete globalThis._np, true)' >/dev/null
gnome-extensions enable "$UUID"; sleep 0.5

# Traffic is written to disk at most once a minute, not per sample.
np_eval '(s => { globalThis._npSaves = 0; const f = s.save.bind(s); s.save = (...a) => (globalThis._npSaves++, f(...a)); return true; })(ext._usageTracker._storage)' >/dev/null
for _ in $(seq 10); do
    np_eval "(ext._speedMonitor._publish({iface: ext._speedMonitor.iface, download: 1e6, upload: 1e5, rxDelta: 1e6, txDelta: 1e5}), true)" >/dev/null
done
expect_eq "no disk writes during traffic" "$(shell_eval 'globalThis._npSaves')" 0

# CPU: NetPulse running with the popup closed vs. disabled.
gnome-extensions disable "$UUID"; sleep 2
c0=$(cpu_ms); sleep 20; idle=$(($(cpu_ms) - c0))
gnome-extensions enable "$UUID"; sleep 2
c0=$(cpu_ms); sleep 20; busy=$(($(cpu_ms) - c0))
overhead=$((busy - idle))
expect_true "CPU overhead with the popup closed is under 1% (${overhead} ms per 20 s)" test "$overhead" -lt 200

# Memory across disable/enable cycles without opening the popup.
cycles() { for _ in $(seq "$1"); do gnome-extensions disable "$UUID"; sleep 0.15; gnome-extensions enable "$UUID"; sleep 0.25; done; }
cycles 30; gc; m0=$(rss)
cycles 30; gc; growth=$(($(rss) - m0))
expect_true "memory is stable across 30 disable/enable cycles (${growth} kB)" test "$growth" -lt 3000
