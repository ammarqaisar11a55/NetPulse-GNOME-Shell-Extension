#!/usr/bin/env bash
# Tests install.sh and uninstall.sh in a throwaway home directory with a
# private D-Bus session; the real user installation is never touched.
#
# Usage: tests/install/test-install.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UUID="$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' "$ROOT/metadata.json")"
WORK="$(mktemp -d -t netpulse-install-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

export HOME="$WORK/home" XDG_DATA_HOME="$WORK/home/.local/share" XDG_CONFIG_HOME="$WORK/home/.config"
export XDG_RUNTIME_DIR="$WORK/runtime"
mkdir -p "$HOME" && mkdir -m 0700 "$XDG_RUNTIME_DIR"
unset DISPLAY WAYLAND_DISPLAY
export ROOT UUID WORK

exec dbus-run-session -- bash -uo pipefail -c '
DEST="$XDG_DATA_HOME/gnome-shell/extensions/$UUID"
FAILURES=0
pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1"; FAILURES=$((FAILURES + 1)); }
check() { local d="$1"; shift; if "$@"; then pass "$d"; else fail "$d"; fi; }
prefs() { gsettings --schemadir "$DEST/schemas" "$@" org.gnome.shell.extensions.netpulse; }

# A fake gnome-shell reporting an old version.
mkdir -p "$WORK/old-shell"
printf "#!/bin/sh\necho GNOME Shell 42.9\n" >"$WORK/old-shell/gnome-shell"
chmod +x "$WORK/old-shell/gnome-shell"

out="$(PATH="$WORK/old-shell:$PATH" "$ROOT/install.sh" 2>&1)"; rc=$?
check "refuses an unsupported GNOME Shell version" test $rc -ne 0
check "explains why" grep -q "GNOME Shell 42.9 is not supported" <<<"$out"
check "nothing was installed" test ! -e "$DEST"

out="$(PATH="$WORK/old-shell:$PATH" "$ROOT/install.sh" --force 2>&1)"; rc=$?
check "--force installs anyway" test $rc -eq 0 -a -f "$DEST/metadata.json"
rm -rf "$DEST"

# A missing dependency.
mkdir -p "$WORK/no-schemas"
for f in /usr/bin/*; do
    [[ "$(basename "$f")" == glib-compile-schemas ]] || ln -s "$f" "$WORK/no-schemas/"
done
out="$(PATH="$WORK/no-schemas" "$ROOT/install.sh" 2>&1)"; rc=$?
check "reports a missing dependency" test $rc -ne 0
check "names it" grep -q "glib-compile-schemas not found" <<<"$out"

# A normal installation.
out="$("$ROOT/install.sh" 2>&1)"; rc=$?
check "installs" test $rc -eq 0
check "extension files are in place" test -f "$DEST/extension.js" -a -f "$DEST/prefs.js" -a -f "$DEST/stylesheet.css" -a -f "$DEST/src/network/SpeedMonitor.js"
check "settings schema is compiled" test -f "$DEST/schemas/gschemas.compiled"
check "settings are readable" test "$(prefs get panel-style 2>/dev/null || gsettings --schemadir "$DEST/schemas" get org.gnome.shell.extensions.netpulse panel-style)" = "'"'"'detailed'"'"'"
check "development files are not installed" test ! -e "$DEST/tests" -a ! -e "$DEST/tools" -a ! -e "$DEST/install.sh"
check "prints how to enable it" grep -q "gnome-extensions enable $UUID" <<<"$out"
check "reinstalling works" "$ROOT/install.sh" --quiet

# Uninstalling keeps statistics unless purged.
mkdir -p "$XDG_DATA_HOME/netpulse" && echo "{}" >"$XDG_DATA_HOME/netpulse/usage.json"
gsettings --schemadir "$DEST/schemas" set org.gnome.shell.extensions.netpulse panel-style compact
out="$("$ROOT/uninstall.sh" 2>&1)"; rc=$?
check "uninstalls" test $rc -eq 0 -a ! -e "$DEST"
check "keeps usage statistics by default" test -f "$XDG_DATA_HOME/netpulse/usage.json"

"$ROOT/install.sh" --quiet
out="$("$ROOT/uninstall.sh" --purge </dev/null 2>&1)"; rc=$?
check "--purge needs confirmation" test $rc -ne 0 -a -e "$DEST"
out="$("$ROOT/uninstall.sh" --purge --yes 2>&1)"; rc=$?
check "--purge --yes removes everything" test $rc -eq 0 -a ! -e "$DEST" -a ! -e "$XDG_DATA_HOME/netpulse"
"$ROOT/install.sh" --quiet
check "--purge reset the settings" test "$(gsettings --schemadir "$DEST/schemas" get org.gnome.shell.extensions.netpulse panel-style)" = "'"'"'detailed'"'"'"

echo
[[ $FAILURES == 0 ]] && echo PASSED || echo "FAILED: $FAILURES check(s)"
exit $FAILURES
'
