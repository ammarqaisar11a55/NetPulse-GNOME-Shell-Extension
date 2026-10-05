# shellcheck shell=bash
# The extension survives repeated disable/enable cycles.

expect_eq "extension is active" "$(ext_state)" ACTIVE

# The shell's own teardown destroys the panel (and our indicator) before
# extensions hear about the shutdown; monitoring must stop at once.
np_eval "(Main.panel.statusArea[ext.uuid].destroy(), true)" >/dev/null
sleep 2.5
expect_eq "monitoring stops when the indicator is destroyed externally" \
    "$(np_eval 'ext._speedMonitor === null && ext._interfaceMonitor === null')" true
expect_true "usage was saved" test -s "$XDG_DATA_HOME/netpulse/usage.json"

for cycle in 1 2 3; do
    gnome-extensions disable "$UUID"; sleep 0.5
    expect_eq "inactive after disable #$cycle" "$(ext_state)" INACTIVE
    gnome-extensions enable "$UUID"; sleep 0.5
    expect_eq "active after enable #$cycle" "$(ext_state)" ACTIVE
done
