#!/usr/bin/env bash
# Measures a known amount of high-rate traffic, without root: two private
# network namespaces joined by a veth pair; a fixed number of bytes is sent
# across while the speed probe watches one end.
#
# Usage: tests/live/netns-traffic.sh [megabytes]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export ROOT MEGABYTES="${1:-500}"

exec unshare --user --map-root-user --net --mount bash -euo pipefail -c '
    mount -t sysfs sysfs /sys
    ip link set lo up

    # Peer namespace, kept alive by a sleeping process.
    unshare --net sleep 60 &
    PEER=$!
    sleep 0.2
    ip link add np-va type veth peer name np-vb
    ip link set np-vb netns $PEER
    ip addr add 10.77.0.1/24 dev np-va; ip link set np-va up
    nsenter -t $PEER -n sh -c "ip link set lo up; ip addr add 10.77.0.2/24 dev np-vb; ip link set np-vb up"

    nsenter -t $PEER -n python3 -c "
import socket
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind((\"10.77.0.2\", 9000)); s.listen(1)
c, _ = s.accept()
while c.recv(1 << 20): pass
" &
    sleep 0.5

    gjs -m "$ROOT/tests/live/probe-speed.js" 6 --iface=np-va &
    PROBE=$!
    sleep 1.5

    python3 -c "
import socket, time
s = socket.create_connection((\"10.77.0.2\", 9000))
chunk = b\"x\" * (1 << 20)
start = time.monotonic()
for _ in range($MEGABYTES): s.sendall(chunk)
s.close()
print(f\">>> sent {$MEGABYTES * (1 << 20)} payload bytes in {time.monotonic() - start:.2f}s\")
"
    wait $PROBE
    kill $PEER 2>/dev/null || true
'
