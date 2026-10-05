# shellcheck shell=bash
# Data limit alerts fire once per threshold; connection notifications are
# opt-in, debounced and quiet about startup.

np_eval 'ext._speedMonitor._stopTimer()' >/dev/null
np_eval '(ext._usageTracker.resetAll(), true)' >/dev/null
add_usage() {
    np_eval "(ext._speedMonitor._publish({iface: ext._speedMonitor.iface, download: 0, upload: 0, rxDelta: $1, txDelta: 0}), true)" >/dev/null
}
notifications() {
    shell_eval "Main.messageTray.getSources().filter(s => s.title === 'NetPulse')
        .flatMap(s => s.notifications).map(n => n.title + ' | ' + n.body).join(' || ')"
}
count() { shell_eval "Main.messageTray.getSources().filter(s => s.title === 'NetPulse').flatMap(s => s.notifications).length"; }
dismiss() { shell_eval "(Main.messageTray.getSources().filter(s => s.title === 'NetPulse').forEach(s => s.destroy()), true)" >/dev/null; }

dismiss
np_set daily-limit 1.0
add_usage 500000000
expect_eq "no alert below the threshold" "$(count)" 0
add_usage 350000000
expect_eq "warning at 80 %" "$(notifications)" \
    '"Daily data limit almost reached | You’ve used 85% of your daily internet limit (850 MB of 1.00 GB)."'
sleep 0.5
screenshot notification-banner
add_usage 50000000
expect_eq "no repeated warning" "$(count)" 1
add_usage 200000000
expect_eq "alert when the limit is reached" "$(count)" 2
expect_true "limit alert text" grep -q "Daily data limit reached | You’ve used 1.10 GB today, reaching your daily limit of 1.00 GB." <<<"$(notifications)"

dismiss
gnome-extensions disable "$UUID"; sleep 0.3
gnome-extensions enable "$UUID"; sleep 0.5
np_eval 'ext._speedMonitor._stopTimer()' >/dev/null
expect_eq "alerts are not repeated after a restart" "$(count)" 0

np_set monthly-limit 1
# (Re-enabling recovered some real background traffic, so the exact amount varies.)
expect_true "crossing both monthly thresholds shows one alert" grep -qE \
    '^"Monthly data limit reached \| You’ve used 1\.[0-9]{2} GB this month, reaching your monthly limit of 1\.00 GB\."$' <<<"$(notifications)"

dismiss
np_set usage-notifications false
np_set daily-limit 1.2
add_usage 100000000
expect_eq "no alerts when turned off" "$(count)" 0
np_reset daily-limit
np_reset monthly-limit
np_reset usage-notifications
dismiss

# Connection notifications are off by default.
inject() {
    np_eval "(m => { m._info = Object.assign({}, m._info, $1); m.emit('changed', m._info); return true; })(ext._interfaceMonitor)" >/dev/null
}
restore() { np_eval '(ext._interfaceMonitor._update(), true)' >/dev/null; }
inject '{name: null, state: "disconnected"}'
sleep 2.5
expect_eq "no connection notifications by default" "$(count)" 0
restore
sleep 2.5

np_set connection-notifications true
inject '{name: null, state: "disconnected"}'
sleep 2.5
expect_eq "disconnect is announced" "$(notifications)" '"Disconnected | The network connection was lost."'
restore
sleep 2.5
expect_true "reconnect replaces it" grep -q '^"Connected | Connected to ' <<<"$(notifications)"
expect_eq "only the latest connection notification is kept" "$(count)" 1

dismiss
inject '{name: null, state: "disconnected"}'
sleep 0.5
restore
sleep 2.5
expect_eq "a brief flap is not announced" "$(count)" 0

inject '{vpn: {name: "Office VPN", iface: "wg0"}}'
sleep 2.5
expect_eq "VPN is announced" "$(notifications)" '"VPN connected | Office VPN"'
restore
dismiss
np_reset connection-notifications
