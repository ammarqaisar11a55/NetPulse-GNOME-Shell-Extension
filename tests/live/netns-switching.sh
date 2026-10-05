#!/usr/bin/env bash
# Exercises interface detection through real network changes, without root:
# runs the detector inside a private user+network namespace and adds/removes
# interfaces, default routes and a TUN "VPN" while it watches.
#
# Usage: tests/live/netns-switching.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export ROOT

exec unshare --user --map-root-user --net --mount bash -euo pipefail -c '
    mount -t sysfs sysfs /sys
    ip link set lo up

    gjs -m "$ROOT/tests/live/probe-network.js" 30 &
    PROBE=$!
    step() { sleep 4; echo ">>> $*"; }

    step "add uplink np-a (metric 200)"
    ip link add np-a type dummy; ip link set np-a up
    ip addr add 10.10.0.2/24 dev np-a
    ip route add default via 10.10.0.1 dev np-a metric 200

    step "add preferred uplink np-b (metric 100)"
    ip link add np-b type dummy; ip link set np-b up
    ip addr add 10.20.0.2/24 dev np-b
    ip route add default via 10.20.0.1 dev np-b metric 100

    # A TUN device only gets carrier while a VPN client holds it open, so
    # WireGuard (in-kernel, up without a userspace process) stands in here.
    step "activate VPN wg0"
    ip link add wg0 type wireguard; ip link set wg0 up
    ip addr add 10.99.0.2/24 dev wg0

    step "deactivate VPN"
    ip link del wg0

    step "remove np-b"
    ip link del np-b

    step "remove np-a"
    ip link del np-a

    wait $PROBE
'
