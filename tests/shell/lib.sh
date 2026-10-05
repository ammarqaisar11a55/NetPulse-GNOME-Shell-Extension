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

# Changes a NetPulse setting: np_set <key> <gvariant-value>
np_set() {
    gsettings --schemadir "$EXT_DIR/schemas" set org.gnome.shell.extensions.netpulse "$1" "$2"
}

np_reset() {
    gsettings --schemadir "$EXT_DIR/schemas" reset org.gnome.shell.extensions.netpulse "$1"
}
