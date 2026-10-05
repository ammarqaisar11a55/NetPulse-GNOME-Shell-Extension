#!/usr/bin/env bash
# Installs NetPulse for the current user into
# ~/.local/share/gnome-shell/extensions/. No root needed; no system files
# are touched.
#
# Usage: ./install.sh [--enable] [--force] [--quiet]
#   --enable  also enable the extension (takes effect once GNOME Shell has
#             loaded it; on Wayland that means after logging in again)
#   --force   install even if this GNOME Shell version is not supported
#   --quiet   only print errors
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
UUID="$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' "$ROOT/metadata.json")"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
DEST="$DATA_HOME/gnome-shell/extensions/$UUID"

ENABLE=0 FORCE=0 QUIET=0
for arg in "$@"; do
    case "$arg" in
    --enable) ENABLE=1 ;;
    --force) FORCE=1 ;;
    --quiet) QUIET=1 ;;
    -h | --help) sed -n '2,11s/^# \{0,1\}//p' "$0"; exit 0 ;;
    *) echo "error: unknown option $arg (see --help)" >&2; exit 2 ;;
    esac
done

say() { [[ $QUIET == 1 ]] || echo "$@"; }
die() { echo "error: $*" >&2; exit 1; }

# 1. Dependencies.
for cmd in gnome-shell gnome-extensions glib-compile-schemas; do
    command -v "$cmd" >/dev/null ||
        die "$cmd not found. Install GNOME Shell and libglib2.0-bin (e.g. 'sudo apt install gnome-shell libglib2.0-bin')."
done

# 2. GNOME Shell version.
VERSION="$(gnome-shell --version | grep -o '[0-9][0-9.]*' | head -n 1)"
MAJOR="${VERSION%%.*}"
SUPPORTED="$(grep -o '"shell-version": *\[[^]]*\]' "$ROOT/metadata.json" | grep -o '[0-9]\+' | tr '\n' ' ')"
if [[ " $SUPPORTED" != *" $MAJOR "* ]]; then
    if [[ $FORCE == 1 ]]; then
        say "warning: GNOME Shell $VERSION is not supported (supported: $SUPPORTED); installing anyway"
    else
        die "GNOME Shell $VERSION is not supported (supported: ${SUPPORTED% }). Use --force to install anyway."
    fi
fi
say "GNOME Shell $VERSION detected"

# 3. Build and install the bundle (replaces any previous version).
BUILD_DIR="$(mktemp -d -t netpulse-build-XXXXXX)"
trap 'rm -rf "$BUILD_DIR"' EXIT
BUNDLE="$("$ROOT/tools/build.sh" "$BUILD_DIR" | tail -n 1)"
gnome-extensions install --force "$BUNDLE"
[[ -f "$DEST/metadata.json" ]] || die "installation failed: $DEST/metadata.json is missing"

# 4. Settings schema.
glib-compile-schemas "$DEST/schemas"
say "Installed NetPulse to $DEST"

# 5. Enabling.
if [[ $ENABLE == 1 ]]; then
    if gnome-extensions enable "$UUID" 2>/dev/null; then
        say "Enabled $UUID"
    else
        say "Could not enable it yet; GNOME Shell has not loaded it."
    fi
fi

if [[ $QUIET == 0 ]]; then
    echo
    if [[ "${XDG_SESSION_TYPE:-}" == x11 ]]; then
        echo "Restart GNOME Shell (Alt+F2, type r, press Enter), then enable NetPulse:"
    else
        echo "Log out and back in so GNOME Shell loads the new version, then enable NetPulse:"
    fi
    echo "    gnome-extensions enable $UUID"
    echo "or use the Extensions app. Settings: gnome-extensions prefs $UUID"
fi
