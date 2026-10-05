# shellcheck shell=bash
# The extension survives repeated disable/enable cycles.

expect_eq "extension is active" "$(ext_state)" ACTIVE

for cycle in 1 2 3; do
    gnome-extensions disable "$UUID"; sleep 0.5
    expect_eq "inactive after disable #$cycle" "$(ext_state)" INACTIVE
    gnome-extensions enable "$UUID"; sleep 0.5
    expect_eq "active after enable #$cycle" "$(ext_state)" ACTIVE
done
