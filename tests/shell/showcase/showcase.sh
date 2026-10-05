# shellcheck shell=bash
# Takes the documentation screenshots with neutral demo data (no real
# network names or addresses). Run through tools/screenshots.sh.

# Grayscale antialiasing avoids colored fringes in screenshots.
gsettings set org.gnome.desktop.interface font-antialiasing grayscale

# The test helper's unsafe-mode icon does not belong in screenshots.
shell_eval '(i => { i.visible = false; i.connect("notify::visible", () => i.visible && i.hide()); return true; })(Main.panel.statusArea.quickSettings._unsafeMode)' >/dev/null

# Freeze live updates and show a demo network.
np_eval '(ext._speedMonitor._stopTimer(), ext._interfaceMonitor._update = () => {}, true)' >/dev/null
np_eval '(m => { m._info = {name: "wlp2s0", type: "wifi", connection: "Home Wi-Fi", state: "connected",
    ipv4: "192.168.1.42", ipv6: null, vpn: null, source: "networkmanager"}; m.emit("changed", m._info); return true; })(ext._interfaceMonitor)' >/dev/null
np_eval '(ext._speedMonitor._stopTimer(), true)' >/dev/null

# A month of plausible usage: heavier evenings and weekends, today's
# traffic following the time of day.
np_eval "(t => {
    const GLib = imports.gi.GLib;
    const now = GLib.DateTime.new_now_local();
    const wave = h => 0.15 + Math.max(0, Math.sin((h - 7) / 24 * 2 * Math.PI)) * 0.85;
    t._data.days = {};
    let month = {rx: 0, tx: 0};
    for (let i = 0; i < 30; i++) {
        const d = now.add_days(-i);
        const weekend = d.get_day_of_week() >= 6 ? 1.6 : 1;
        const hours = i === 0 ? now.get_hour() + 1 : 24;
        const hrx = new Array(24).fill(0), htx = new Array(24).fill(0);
        for (let h = 0; h < hours; h++) {
            const jitter = 0.75 + ((i * 7 + h * 13) % 10) / 20;
            hrx[h] = Math.round(wave(h) * 260e6 * weekend * jitter);
            htx[h] = Math.round(hrx[h] * 0.12);
        }
        const day = {rx: hrx.reduce((a, b) => a + b, 0), tx: htx.reduce((a, b) => a + b, 0), hrx, htx};
        t._data.days[d.format('%Y-%m-%d')] = day;
        if (d.get_month() === now.get_month()) {
            month.rx += day.rx;
            month.tx += day.tx;
        }
    }
    t._data.months = {[now.format('%Y-%m')]: month};
    t._data.session = {id: t._sessionId, rx: 1.84e9, tx: 312e6};
    return true;
})(ext._usageTracker)" >/dev/null

# Two minutes of live speed history ending at the current reading.
np_eval "(m => {
    for (let i = 0; i < 120; i++) {
        const down = 6e6 + 18e6 * Math.max(0, Math.sin(i / 9)) * (0.6 + 0.4 * Math.sin(i / 4)) + (i > 100 ? (i - 100) * 0.6e6 : 0);
        const up = 0.4e6 + 2.4e6 * Math.max(0, Math.sin(i / 7 + 1));
        m._publish({iface: 'wlp2s0', download: down, upload: up, rxDelta: 0, txDelta: 0});
    }
    m._publish({iface: 'wlp2s0', download: 24.6e6, upload: 3.12e6, rxDelta: 0, txDelta: 0});
    return true;
})(ext._speedMonitor)" >/dev/null

set_scheme() { gsettings set org.gnome.desktop.interface color-scheme "$1"; sleep 3; }
open_popup() { np_eval 'ext._indicator.menu.open(false)' >/dev/null; sleep 0.5; }
close_popup() { np_eval 'ext._indicator.menu.close(false)' >/dev/null; sleep 0.3; }
panel_area() { screenshot_area "$1" 720 0 560 "$(shell_eval 'Main.panel.height')"; }

for variant in light dark; do
    set_scheme "prefer-$variant"
    panel_area "panel-$variant"

    np_set history-range "'today'"
    open_popup
    screenshot_actor "popup-$variant" 'ext._indicator.menu.actor'
    screenshot_actor "card-$variant" 'ext._indicator.menu.box' 0
    screenshot "desktop-$variant"
    np_set history-range "'live'"
    sleep 0.3
    screenshot_actor "popup-live-$variant" 'ext._indicator.menu.actor'
    np_set history-range "'month'"
    sleep 0.3
    screenshot_actor "popup-month-$variant" 'ext._indicator.menu.actor'
    close_popup
done

# Panel styles (dark top bar).
for style in compact stacked; do
    np_set panel-style "'$style'"
    sleep 0.3
    panel_area "panel-$style"
done
np_reset panel-style
np_set use-bits true; sleep 0.3; panel_area panel-bits; np_reset use-bits

# A data limit alert.
np_set daily-limit 2.2
np_eval '(ext._usageAlerts.check(), true)' >/dev/null
sleep 0.6
screenshot_area notification 340 0 600 170
np_reset daily-limit

# Preferences.
set_scheme prefer-light
gnome-extensions prefs "$UUID"
r="$(wait_window NetPulse)"
read -r wx wy ww wh <<<"$r"
click $((wx + 70)) $((wy + 23))
screenshot_area prefs-display "$wx" "$wy" "$ww" "$wh"
for page in Usage Notifications Network; do
    python3 "$ROOT/tests/shell/a11y.py" activate org.gnome.Shell.Extensions "$page" "page tab"
    sleep 0.4
    screenshot_area "prefs-${page,,}" "$wx" "$wy" "$ww" "$wh"
done
np_reset history-range
gsettings reset org.gnome.desktop.interface color-scheme
sleep 3
