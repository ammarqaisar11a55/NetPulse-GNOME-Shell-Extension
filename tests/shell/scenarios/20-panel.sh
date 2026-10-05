# shellcheck shell=bash
# The panel indicator renders every display mode without jumping around.

indicator='Main.panel.statusArea[ext.uuid]'
expect_eq "indicator is in the panel" "$(np_eval "$indicator === ext._indicator")" true
expect_eq "indicator sits in the right box" \
    "$(np_eval "Main.panel._rightBox.contains(ext._indicator.container)")" true

# Freeze live sampling so injected values are not overwritten.
np_eval 'ext._speedMonitor._stopTimer()' >/dev/null
show() { np_eval "(ext._indicator.setSample({download: $1, upload: $2}), ext._indicator.text)"; }
width() { np_eval 'ext._indicator.width'; }

expect_eq "zero traffic" "$(show 0 0)" '"↓ 0 B/s  ↑ 0 B/s"'
expect_eq "documented example" "$(show 4820000 1210000)" '"↓ 4.82 MB/s  ↑ 1.21 MB/s"'
screenshot_area panel-detailed

# Width must not change whatever the values are.
widths=()
for v in 0 7 512 999 1000 12400 99960 999700 4820000 88800000 1210000000; do
    show "$v" "$((v / 3))" >/dev/null
    widths+=("$(width)")
done
unique="$(printf '%s\n' "${widths[@]}" | sort -u | wc -l)"
expect_eq "detailed width is stable across values (${widths[0]}px)" "$unique" 1

np_set panel-style "'compact'"
expect_eq "compact text" "$(show 4820000 1210)" '"↓ 4.82 M  ↑ 1.21 K"'
screenshot_area panel-compact
w1="$(width)"; show 512 999700 >/dev/null; w2="$(width)"
expect_eq "compact width is stable" "$w1" "$w2"

np_set panel-style "'stacked'"
show 4820000 1210000 >/dev/null
expect_eq "stacked is vertical" "$(np_eval 'ext._indicator._box.orientation')" 1
expect_true "stacked fits in the panel" \
    test "$(np_eval 'ext._indicator._box.height <= Main.panel.height')" = true
screenshot_area panel-stacked
np_reset panel-style

np_set panel-content "'download'"
expect_eq "download only" "$(show 4820000 1210000)" '"↓ 4.82 MB/s"'
np_set panel-content "'upload'"
expect_eq "upload only" "$(show 4820000 1210000)" '"↑ 1.21 MB/s"'
np_set panel-content "'combined'"
expect_eq "combined" "$(show 4820000 1210000)" '"⇅ 6.03 MB/s"'
np_reset panel-content

np_set show-units false
expect_eq "units hidden" "$(show 4820000 1210000)" '"↓ 4.82  ↑ 1.21"'
np_reset show-units
np_set use-bits true
expect_eq "bits" "$(show 4820000 1210000)" '"↓ 38.6 Mbps  ↑ 9.68 Mbps"'
np_reset use-bits

np_eval 'ext._indicator.setOnline(false)' >/dev/null
expect_true "offline is dimmed" wait_for 128 'ext._indicator._box.opacity'
expect_eq "offline accessible name" "$(np_eval 'ext._indicator.accessible_name')" '"Offline"'
np_eval 'ext._indicator.setOnline(true)' >/dev/null

np_set panel-position "'left'"
sleep 0.3
expect_eq "moves to the left box" \
    "$(np_eval "Main.panel._leftBox.contains(ext._indicator.container)")" true
expect_eq "only one indicator exists" \
    "$(np_eval "Main.panel._rightBox.get_children().filter(c => c.get_first_child()?.has_style_class_name?.('netpulse-indicator')).length")" 0
np_reset panel-position
sleep 0.3
expect_eq "returns to the right box" \
    "$(np_eval "Main.panel._rightBox.contains(ext._indicator.container)")" true
