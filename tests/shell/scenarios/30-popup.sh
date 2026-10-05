# shellcheck shell=bash
# The popup dashboard shows live data while open and nothing costs while closed.

np_eval 'ext._speedMonitor._stopTimer()' >/dev/null
publish() {
    np_eval "(ext._speedMonitor._publish({iface: ext._speedMonitor.iface, download: $1, upload: $2, rxDelta: $3, txDelta: $4}), true)" >/dev/null
}
dash='ext._dashboard'
tile() { np_eval "$dash._speedDisplay.$1.text"; }
row() { np_eval "$dash._$1Rows.$2.value"; }
usage() { np_eval "$dash._usageDisplay.row('$1').join(' / ')"; }

np_eval '(ext._usageTracker.resetSession(), true)' >/dev/null
expect_eq "popup content is not built before first use" "$(np_eval 'ext._dashboard ?? null')" null
np_eval 'ext._indicator.menu.open(false)' >/dev/null
sleep 0.3
expect_eq "popup opens" "$(np_eval 'ext._indicator.menu.isOpen')" true

iface="$(np_eval 'ext._interfaceMonitor.info.name')"
expect_eq "interface row" "$(row network iface)" "$iface"
expect_eq "status" "$(np_eval "$dash._status.text")" '"Connected"'
expect_true "connection title is shown" test "$(np_eval "$dash._networkTitle.text")" != '""'

publish 4820000 1210000 2430000000 386000000
expect_eq "download tile" "$(tile download)" '"4.82 MB/s"'
expect_eq "upload tile" "$(tile upload)" '"1.21 MB/s"'
expect_eq "session usage" "$(usage session)" '"2.43 GB / 386 MB / 2.82 GB"'
screenshot_actor popup-connected 'ext._indicator.menu.actor'

np_set use-bits true
expect_eq "units follow settings" "$(tile download)" '"38.6 Mbps"'
np_reset use-bits

np_eval "($dash._resetButton.emit('clicked', 1), true)" >/dev/null
expect_eq "reset session" "$(usage session)" '"0 B / 0 B / 0 B"'

# Disconnected and VPN states, injected through the interface monitor.
inject() {
    np_eval "(m => { m._info = Object.assign({}, m._info, $1); m.emit('changed', m._info); return true; })(ext._interfaceMonitor)" >/dev/null
}
inject '{vpn: {name: "Office VPN", iface: "wg0"}}'
expect_eq "VPN row" "$(row network vpn)" '"Office VPN"'
inject '{name: null, state: "disconnected", ipv4: null, ipv6: null, vpn: null}'
expect_eq "offline title" "$(np_eval "$dash._networkTitle.text")" '"No Network Connection"'
expect_eq "offline status" "$(np_eval "$dash._status.text")" '"Disconnected"'
expect_eq "offline panel" "$(np_eval 'ext._indicator.text')" '"↓ 0 B/s  ↑ 0 B/s"'
screenshot_actor popup-offline 'ext._indicator.menu.actor'
np_eval '(ext._interfaceMonitor._update(), true)' >/dev/null
np_eval 'ext._speedMonitor._stopTimer()' >/dev/null

np_eval 'ext._indicator.menu.close(false)' >/dev/null
sleep 0.3
publish 999 999 0 0
expect_eq "closed popup is not updated" "$(tile download)" '"0 B/s"'
np_eval 'ext._indicator.menu.open(false)' >/dev/null
sleep 0.2
expect_eq "reopening refreshes" "$(tile download)" '"999 B/s"'
np_eval 'ext._indicator.menu.close(false)' >/dev/null
