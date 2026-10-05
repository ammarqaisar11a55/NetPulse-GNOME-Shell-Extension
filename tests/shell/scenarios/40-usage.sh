# shellcheck shell=bash
# Usage is shown per period and survives disable/enable, shell restarts,
# crashes and file corruption.

DATA_FILE="$XDG_DATA_HOME/netpulse/usage.json"
GB=1000000000
# Real background traffic on the host also gets counted; allow for it.
SLACK=50000000

add_usage() {
    np_eval "(ext._speedMonitor._publish({iface: ext._speedMonitor.iface, download: 0, upload: 0, rxDelta: $1, txDelta: $2}), true)" >/dev/null
}
today_rx() { np_eval 'ext._usageTracker.totals.today.rx'; }
session_rx() { np_eval 'ext._usageTracker.session.rx'; }
# Usage: in_range <value> <min> [max]
in_range() { [[ "$1" =~ ^[0-9]+$ ]] && (($1 >= $2 && $1 <= ${3:-$(($2 + SLACK))})); }

np_eval '(ext._usageTracker.resetAll(), true)' >/dev/null
add_usage $((2 * GB)) $((1 * GB))
expect_true "today counts injected traffic" in_range "$(today_rx)" $((2 * GB))

np_eval 'ext._indicator.menu.open(false)' >/dev/null
sleep 0.3
row() { np_eval "ext._dashboard._usageDisplay.row('$1').join(' / ')"; }
expect_true "popup shows today" test "$(row today)" = '"2.00 GB / 1.00 GB / 3.00 GB"'
expect_true "popup shows the month" test "$(row month)" = '"2.00 GB / 1.00 GB / 3.00 GB"'
expect_eq "popup shows nothing for yesterday" "$(row yesterday)" '"0 B / 0 B / 0 B"'
screenshot_actor popup-usage 'ext._indicator.menu.actor'
np_eval 'ext._indicator.menu.close(false)' >/dev/null

# Disabling (as on screen lock) saves; enabling restores totals and session.
gnome-extensions disable "$UUID"; sleep 0.5
expect_true "data file is written on disable" test -s "$DATA_FILE"
expect_eq "data file is private" "$(stat -c %a "$DATA_FILE")" 600
gnome-extensions enable "$UUID"; sleep 0.5
expect_true "today survives disable/enable" in_range "$(today_rx)" $((2 * GB))
expect_true "session survives disable/enable" in_range "$(session_rx)" $((2 * GB))

# A clean shell restart (new login session).
restart_shell TERM
expect_true "today survives a shell restart" in_range "$(today_rx)" $((2 * GB))
expect_true "a new shell starts a new session" in_range "$(session_rx)" 0

# A crash right after new traffic: the last save is intact and loads.
add_usage $((5 * GB)) 0
restart_shell KILL
expect_true "data file is valid JSON after a crash" python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$DATA_FILE"
expect_true "unsaved fake traffic is lost, saved data is kept" in_range "$(today_rx)" $((2 * GB))
expect_eq "extension is active after a crash" "$(ext_state)" ACTIVE

# Corruption: the damaged file is set aside and the backup restores data.
gnome-extensions disable "$UUID"; sleep 0.5
printf '{"version": 1, "days": {"2026-' >"$DATA_FILE"
gnome-extensions enable "$UUID"; sleep 0.5
expect_eq "extension survives a corrupt data file" "$(ext_state)" ACTIVE
expect_true "corrupt file is kept aside" compgen -G "$DATA_FILE.corrupt-*"
expect_true "backup restores today's usage" in_range "$(today_rx)" $((2 * GB))
expect_true "recovered data is written back at once" test -s "$DATA_FILE"

# Traffic while disabled (e.g. screen locked) is recovered from the kernel
# counters: pretend the last save happened 3 MB / 1 MB ago.
wait_for true 'ext._speedMonitor.iface !== null'
iface="$(np_eval 'ext._speedMonitor.iface')"; iface="${iface//\"/}"
gnome-extensions disable "$UUID"; sleep 0.5
before="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['days'][sys.argv[2]]['rx'])" "$DATA_FILE" "$(date +%F)")"
python3 - "$DATA_FILE" "$iface" <<'PY'
import json, sys
path, iface = sys.argv[1], sys.argv[2]
data = json.load(open(path))
rx = int(open(f'/sys/class/net/{iface}/statistics/rx_bytes').read())
tx = int(open(f'/sys/class/net/{iface}/statistics/tx_bytes').read())
boot = open('/proc/sys/kernel/random/boot_id').read().strip()
data['counters'] = {'bootId': boot, 'iface': iface, 'rx': rx - 3000000, 'tx': tx - 1000000}
json.dump(data, open(path, 'w'))
PY
gnome-extensions enable "$UUID"; sleep 0.5
expect_true "traffic while disabled is recovered" in_range "$(today_rx)" $((before + 3000000))
expect_true "recovery is logged" grep -q "Recovered .* bytes of traffic on $iface" "$LOG"
