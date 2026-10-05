# Helpers available to headless shell test scenarios (sourced by session.sh).
# shellcheck shell=bash

FAILURES=0

# Prints the extension state (ACTIVE, INACTIVE, ERROR, ...).
ext_state() {
    gnome-extensions info "$UUID" | sed -n 's/^ *State: //p'
}

# Evaluates JavaScript inside the shell and prints the JSON result.
# `Main` and `global` are in scope. Fails if evaluation throws.
shell_eval() {
    local out ok
    out="$(gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "$1")"
    ok="${out%%,*}"
    # Strip the GVariant tuple wrapping: (true, 'result')
    out="${out#*, \'}"
    out="${out%\')}"
    echo "$out"
    [[ "$ok" == "(true" ]]
}

# Evaluates an expression with `ext` bound to the NetPulse extension object.
np_eval() {
    shell_eval "(() => { const ext = Main.extensionManager.lookup('$UUID').stateObj; return $1; })()"
}

# Runs an expression repeatedly until it returns the expected value.
# Usage: wait_for <expected> <np_eval expression> [timeout-seconds]
wait_for() {
    local expected="$1" expr="$2" timeout="${3:-10}" value
    for ((i = 0; i < timeout * 4; i++)); do
        value="$(np_eval "$expr" 2>/dev/null || true)"
        [[ "$value" == "$expected" ]] && return 0
        sleep 0.25
    done
    return 1
}

pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1"; FAILURES=$((FAILURES + 1)); }

# Usage: expect_eq <description> <actual> <expected>
expect_eq() {
    if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1: expected '$3', got '$2'"; fi
}

# Usage: expect_true <description> <command...>
expect_true() {
    local desc="$1"; shift
    if "$@"; then pass "$desc"; else fail "$desc"; fi
}

# Saves a screenshot of the whole stage to $OUTPUT/<name>.png
screenshot() {
    mkdir -p "$OUTPUT"
    gdbus call --session --dest org.gnome.Shell.Screenshot \
        --object-path /org/gnome/Shell/Screenshot \
        --method org.gnome.Shell.Screenshot.Screenshot false false "$OUTPUT/$1.png" >/dev/null &&
        echo "  saved $OUTPUT/$1.png"
}

# Saves a screenshot of a region (default: the top bar) to $OUTPUT/<name>.png
# Usage: screenshot_area <name> [x y width height]
screenshot_area() {
    mkdir -p "$OUTPUT"
    local x="${2:-0}" y="${3:-0}" w="${4:-1280}" h="${5:-$(shell_eval 'Main.panel.height')}"
    gdbus call --session --dest org.gnome.Shell.Screenshot \
        --object-path /org/gnome/Shell/Screenshot \
        --method org.gnome.Shell.Screenshot.ScreenshotArea \
        "$x" "$y" "$w" "$h" false "$OUTPUT/$1.png" >/dev/null &&
        echo "  saved $OUTPUT/$1.png"
}

# Screenshots the on-screen area of an actor, with a margin.
# Usage: screenshot_actor <name> <np_eval expression yielding a Clutter.Actor>
screenshot_actor() {
    local box
    box="$(np_eval "(a => { const [x, y] = a.get_transformed_position(); const [w, h] = a.get_transformed_size(); \
        return [x, y, w, h].map(Math.round).join(' '); })($2)")"
    # shellcheck disable=SC2086
    set -- "$1" ${box//\"/}
    screenshot_area "$1" "$(( $2 > 8 ? $2 - 8 : 0 ))" "$(( $3 > 8 ? $3 - 8 : 0 ))" "$(( $4 + 16 ))" "$(( $5 + 16 ))"
}

# Clicks at stage coordinates with a virtual pointer. The pointer moves
# first: a freshly created virtual device drops events sent immediately.
click() {
    local device="(() => {
        const Clutter = imports.gi.Clutter;
        globalThis._netpulseTestPointer ??= Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        return globalThis._netpulseTestPointer;
    })()"
    shell_eval "$device.notify_absolute_motion(imports.gi.GLib.get_monotonic_time(), $1, $2)" >/dev/null
    sleep 0.3
    shell_eval "(d => { const C = imports.gi.Clutter, t = imports.gi.GLib.get_monotonic_time();
        d.notify_button(t, C.BUTTON_PRIMARY, C.ButtonState.PRESSED);
        d.notify_button(t + 1000, C.BUTTON_PRIMARY, C.ButtonState.RELEASED); })($device)" >/dev/null
    sleep 0.4
}

# Prints "x y width height" of the first window whose title matches.
window_rect() {
    local r
    r="$(shell_eval "(w => w ? (r => [r.x, r.y, r.width, r.height].join(' '))(w.get_frame_rect()) : '')(
        global.display.list_all_windows().find(w => w.title === '$1'))")"
    echo "${r//\"/}"
}

# Changes a NetPulse setting: np_set <key> <gvariant-value>
np_set() {
    gsettings --schemadir "$EXT_DIR/schemas" set org.gnome.shell.extensions.netpulse "$1" "$2"
}

np_reset() {
    gsettings --schemadir "$EXT_DIR/schemas" reset org.gnome.shell.extensions.netpulse "$1"
}
