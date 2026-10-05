# shellcheck shell=bash
# The panel and popup are readable in GNOME's light and dark styles, and the
# popup style setting overrides the shell's style.

np_eval 'ext._speedMonitor._stopTimer()' >/dev/null
np_eval "(ext._speedMonitor._publish({iface: ext._speedMonitor.iface, download: 4820000, upload: 1210000, rxDelta: 0, txDelta: 0}), true)" >/dev/null

# WCAG contrast ratio between an actor's text color (after its opacity) and
# the background behind it.
CONTRAST='(text, bgActor) => {
    const lum = c => [c.red, c.green, c.blue].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const bg = bgActor.get_theme_node().get_background_color();
    const fg = text.get_theme_node().get_foreground_color();
    let alpha = text.opacity / 255;
    for (let a = text.get_parent(); a && a !== bgActor; a = a.get_parent()) alpha *= a.opacity / 255;
    const mix = k => fg[k] * alpha + bg[k] * (1 - alpha);
    const [l1, l2] = [lum({red: mix("red"), green: mix("green"), blue: mix("blue")}), lum(bg)].sort((x, y) => y - x);
    return Math.round((l1 + 0.05) / (l2 + 0.05) * 10) / 10;
}'
popup_bg() { np_eval '(c => [c.red, c.green, c.blue].join(","))(ext._indicator.menu.box.get_theme_node().get_background_color())'; }
contrast() { np_eval "($CONTRAST)($1, $2)"; }
at_least() { [[ "$(awk -v a="$1" -v b="$2" 'BEGIN { print (a >= b) }')" == 1 ]]; }

check_readability() {
    local label="$1" value dim panel
    value="$(contrast 'ext._dashboard._usageDisplay._cells.today[2]' 'ext._indicator.menu.box')"
    dim="$(contrast 'ext._dashboard._networkSubtitle' 'ext._indicator.menu.box')"
    panel="$(contrast 'ext._indicator._items[0]._value' 'Main.panel')"
    expect_true "$label: popup values contrast $value:1 (≥ 7)" at_least "$value" 7
    expect_true "$label: dimmed text contrast $dim:1 (≥ 4.5)" at_least "$dim" 4.5
    expect_true "$label: top bar text contrast $panel:1 (≥ 7)" at_least "$panel" 7
}

set_scheme() {
    gsettings set org.gnome.desktop.interface color-scheme "$1"
    sleep 1
}
open_popup() {
    np_eval 'ext._indicator.menu.open(false)' >/dev/null
    sleep 0.4
}
close_popup() { np_eval 'ext._indicator.menu.close(false)' >/dev/null; }

for scheme in prefer-light prefer-dark; do
    set_scheme "$scheme"
    variant="$(shell_eval 'Main.getStyleVariant()')"; variant="${variant//\"/}"
    expect_eq "shell uses the $variant style for $scheme" "$variant" "${scheme#prefer-}"

    open_popup
    check_readability "$variant shell"
    screenshot_actor "theme-popup-$variant" 'ext._indicator.menu.actor'
    screenshot_area "theme-panel-$variant"
    close_popup

    for forced in light dark; do
        np_set popup-theme "'$forced'"
        open_popup
        expected="$([[ $forced == light ]] && echo '"250,250,251"' || echo '"54,54,58"')"
        expect_eq "$variant shell, $forced popup: background" "$(popup_bg)" "$expected"
        check_readability "$variant shell, $forced popup"
        [[ $forced != "$variant" ]] && screenshot_actor "theme-popup-$forced-on-$variant" 'ext._indicator.menu.actor'
        close_popup
    done
    np_reset popup-theme
done

gsettings reset org.gnome.desktop.interface color-scheme
# Switching the style also cross-fades the wallpaper variant; let the shell
# finish that before anything else (such as shutting down) happens.
sleep 3
