# shellcheck shell=bash
# The history chart shows live speed and today/7/30-day usage.

np_eval 'ext._speedMonitor._stopTimer()' >/dev/null
gsettings set org.gnome.desktop.interface clock-format '24h'

# Seed 30 days of 1 GB down / 200 MB up; today's traffic is all at midnight.
np_eval "(t => {
    const GLib = imports.gi.GLib;
    const now = GLib.DateTime.new_now_local();
    t._data.days = {};
    for (let i = 0; i < 30; i++) {
        const day = {rx: 1e9, tx: 2e8, hrx: new Array(24).fill(0), htx: new Array(24).fill(0)};
        day.hrx[0] = 1e9;
        day.htx[0] = 2e8;
        t._data.days[now.add_days(-i).format('%Y-%m-%d')] = day;
    }
    return true;
})(ext._usageTracker)" >/dev/null

hv='ext._dashboard._historyView'
select_range() {
    np_eval "($hv._tabs.$1.emit('clicked', 1), true)" >/dev/null
    sleep 0.2
}
axis() { np_eval "$hv.axisLabels.join(' | ')"; }
summary() { np_eval "$hv.summary"; }
hover() { np_eval "($hv._graph._setHover($1), $hv.summary)"; }

np_eval 'ext._indicator.menu.open(false)' >/dev/null
sleep 0.3

select_range today
expect_eq "range is remembered" "$(gsettings --schemadir "$EXT_DIR/schemas" get org.gnome.shell.extensions.netpulse history-range)" "'today'"
expect_eq "today tab is checked" "$(np_eval "$hv._tabs.today.checked && !$hv._tabs.week.checked")" true
expect_eq "today axis" "$(axis)" '"00:00 | 06:00 | 12:00 | 18:00"'
expect_eq "today summary" "$(summary)" '"↓ 1.00 GB   ↑ 200 MB   Total 1.20 GB"'
expect_eq "today has 24 bars" "$(np_eval "$hv._graph._values.length")" 24
expect_eq "hovering a bar shows its hour" "$(hover 0)" '"00:00 – 01:00   ↓ 1.00 GB   ↑ 200 MB"'
expect_eq "leaving the chart restores the total" "$(hover -1)" '"↓ 1.00 GB   ↑ 200 MB   Total 1.20 GB"'
screenshot_actor history-today 'ext._indicator.menu.actor'

gsettings set org.gnome.desktop.interface clock-format '12h'
select_range week
select_range today
expect_eq "12-hour clock axis" "$(axis)" '"12 AM | 6 AM | 12 PM | 6 PM"'
gsettings set org.gnome.desktop.interface clock-format '24h'

select_range week
expect_eq "week summary" "$(summary)" '"↓ 7.00 GB   ↑ 1.40 GB   Total 8.40 GB"'
labels="$(axis)"; labels="${labels//\"/}"
expect_true "week axis has 7 days ending today ($labels)" \
    test "$(grep -o '|' <<<"$labels" | wc -l)" -eq 6 -a "${labels##*| }" = "$(date +%a)"
screenshot_actor history-week 'ext._indicator.menu.actor'

select_range month
expect_eq "month summary" "$(summary)" '"↓ 30.0 GB   ↑ 6.00 GB   Total 36.0 GB"'
expect_eq "month has 30 bars" "$(np_eval "$hv._graph._values.length")" 30
expect_eq "month axis has 6 labels" "$(np_eval "$hv.axisLabels.length")" 6
screenshot_actor history-month 'ext._indicator.menu.actor'

# Live: feed a ramp of speeds.
for i in $(seq 1 40); do
    np_eval "(ext._speedMonitor._publish({iface: 'x', download: $((i * 50000)), upload: $((i * 10000)), rxDelta: 0, txDelta: 0}), true)" >/dev/null
done
select_range live
expect_eq "live axis" "$(axis)" '"2 min ago | Now"'
expect_eq "live summary shows the peak" "$(summary)" '"Peak   ↓ 2.00 MB/s   ↑ 400 KB/s"'
expect_eq "live hover shows the latest sample" "$(hover 119)" '"Now   ↓ 2.00 MB/s   ↑ 400 KB/s"'
np_eval "$hv._graph._setHover(-1)" >/dev/null
screenshot_actor history-live 'ext._indicator.menu.actor'

expect_eq "network details start collapsed" \
    "$(np_eval "ext._indicator.menu._getMenuItems().find(i => i.menu?.isOpen !== undefined && i.label?.text === 'Network Details').menu.isOpen")" false

np_eval 'ext._indicator.menu.close(false)' >/dev/null
np_reset history-range
