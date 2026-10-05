# shellcheck shell=bash
# Runs inside a private network namespace (NETPULSE_NETNS=1): interfaces
# come and go, the default route moves and a VPN toggles while NetPulse
# runs, with real traffic on each link.
#
# np-eth  "Ethernet": veth pair to a peer namespace, default metric 100
# np-wifi "Wi-Fi":    dummy interface, default metric 600
# wg0     "VPN":      WireGuard interface

MB=1000000
iface() { np_eval 'ext._interfaceMonitor.info.name'; }
today() { np_eval "ext._usageTracker.totals.today.$1"; }
# Usage: in_range <value> <min> <max>
in_range() { [[ "$1" =~ ^[0-9]+$ ]] && (($1 >= $2 && $1 <= $3)); }
# Sends <megabytes> of UDP payload to <address> from the given namespace.
send_udp() {
    local target="$1" megabytes="$2" ns=("${@:3}")
    "${ns[@]}" python3 -c "
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
chunk = b'x' * 1000
for _ in range($megabytes * 1000):
    try: s.sendto(chunk, ('$target', 9))
    except OSError: pass
"
}
# Tracks the highest rate reported from now on.
start_peak() {
    np_eval "(globalThis._npPeak = 0, globalThis._npPeakId ??= ext._speedMonitor.connect('sample',
        s => (globalThis._npPeak = Math.max(globalThis._npPeak, s.download, s.upload))), true)" >/dev/null
}
peak() { np_eval 'Math.round(globalThis._npPeak)'; }

expect_eq "starts offline" "$(iface)" null
expect_eq "panel is dimmed while offline" "$(np_eval 'ext._indicator._box.opacity')" 128

# Ethernet comes up.
unshare --net sleep 600 &
PEER=$!
sleep 0.3
in_peer=(nsenter -t "$PEER" -n)
ip link add np-eth type veth peer name np-peer
ip link set np-peer netns "$PEER"
"${in_peer[@]}" sh -c 'ip link set lo up; ip addr add 10.10.0.1/24 dev np-peer; ip link set np-peer up'
ip addr add 10.10.0.2/24 dev np-eth
ip link set np-eth up
ip route add default via 10.10.0.1 dev np-eth metric 100
expect_true "Ethernet is detected" wait_for '"np-eth"' 'ext._interfaceMonitor.info.name'
expect_eq "panel is bright when online" "$(np_eval 'ext._indicator._box.opacity')" 255
expect_eq "speed is measured on Ethernet" "$(np_eval 'ext._speedMonitor.iface')" '"np-eth"'

rx0="$(today rx)"
send_udp 10.10.0.2 30 "${in_peer[@]}"
sleep 2.5
expect_true "30 MB received on Ethernet are counted" in_range $(($(today rx) - rx0)) $((30 * MB)) $((33 * MB))

# Wi-Fi appears with a worse metric and lots of its own traffic.
ip link add np-wifi type dummy
ip addr add 10.20.0.2/24 dev np-wifi
ip link set np-wifi up
ip route add default via 10.20.0.1 dev np-wifi metric 600
tx0="$(today tx)"
send_udp 10.20.0.9 200
sleep 3.5
expect_eq "Ethernet stays preferred" "$(iface)" '"np-eth"'
expect_true "traffic on the unused Wi-Fi is not counted" in_range $(($(today tx) - tx0)) 0 $((2 * MB))

# Cable unplugged: fail over to Wi-Fi without a spike from its 200 MB.
start_peak
ip link set np-eth down
expect_true "fails over to Wi-Fi" wait_for '"np-wifi"' 'ext._interfaceMonitor.info.name'
sleep 2.5
expect_true "no speed spike after switching ($(peak) B/s)" in_range "$(peak)" 0 $((1 * MB))
expect_true "switch is logged" grep -q "Network interface changed: np-eth → np-wifi" "$LOG"

tx0="$(today tx)"
send_udp 10.20.0.9 20
sleep 2.5
expect_true "20 MB sent on Wi-Fi are counted" in_range $(($(today tx) - tx0)) $((20 * MB)) $((22 * MB))

# VPN on and off: still measuring the physical uplink.
ip link add wg0 type wireguard
ip addr add 10.99.0.2/24 dev wg0
ip link set wg0 up
expect_true "VPN is detected" wait_for '"wg0"' 'ext._interfaceMonitor.info.vpn?.name'
expect_eq "VPN does not change the measured interface" "$(np_eval 'ext._speedMonitor.iface')" '"np-wifi"'
ip link del wg0
expect_true "VPN off is detected" wait_for null 'ext._interfaceMonitor.info.vpn'
expect_eq "still measuring Wi-Fi" "$(np_eval 'ext._speedMonitor.iface')" '"np-wifi"'

# Cable plugged back in: back to Ethernet, again without a spike.
# Taking a link down flushes its routes; DHCP/NetworkManager would add the
# default route again on reconnect.
start_peak
ip link set np-eth up
ip route add default via 10.10.0.1 dev np-eth metric 100
expect_true "returns to Ethernet" wait_for '"np-eth"' 'ext._interfaceMonitor.info.name'
sleep 2.5
expect_true "no speed spike switching back ($(peak) B/s)" in_range "$(peak)" 0 $((1 * MB))

# Everything gone.
ip link del np-eth
ip link del np-wifi
expect_true "goes offline" wait_for null 'ext._interfaceMonitor.info.name'
expect_eq "speed monitor idles" "$(np_eval 'ext._speedMonitor.iface')" null
expect_eq "panel shows zero" "$(np_eval 'ext._indicator.text')" '"↓ 0 B/s  ↑ 0 B/s"'
np_eval 'ext._indicator.menu.open(false)' >/dev/null
sleep 0.3
expect_eq "popup says not connected" "$(np_eval 'ext._dashboard._networkTitle.text')" '"No Network Connection"'
np_eval 'ext._indicator.menu.close(false)' >/dev/null

kill "$PEER" 2>/dev/null
