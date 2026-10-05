#!/usr/bin/env bash
# Removes NetPulse for the current user.
#
# Usage: ./uninstall.sh [--purge] [--yes]
#   --purge  also delete the usage statistics and reset all settings
#   --yes    do not ask for confirmation before purging
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
UUID="$(sed -n 's/.*"uuid": *"\([^"]*\)".*/\1/p' "$ROOT/metadata.json")"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
DEST="$DATA_HOME/gnome-shell/extensions/$UUID"
USAGE_DIR="$DATA_HOME/netpulse"
SCHEMA=org.gnome.shell.extensions.netpulse

PURGE=0 YES=0
for arg in "$@"; do
    case "$arg" in
    --purge) PURGE=1 ;;
    --yes | -y) YES=1 ;;
    -h | --help) sed -n '2,7s/^# \{0,1\}//p' "$0"; exit 0 ;;
    *) echo "error: unknown option $arg (see --help)" >&2; exit 2 ;;
    esac
done

if [[ $PURGE == 1 && $YES == 0 ]]; then
    if [[ ! -t 0 ]]; then
        echo "error: --purge erases your usage statistics; add --yes to confirm" >&2
        exit 1
    fi
    read -r -p "Permanently delete NetPulse usage statistics and settings? [y/N] " answer
    [[ "$answer" == [yY]* ]] || { echo "Cancelled."; exit 1; }
fi

if command -v gnome-extensions >/dev/null; then
    gnome-extensions disable "$UUID" 2>/dev/null || true
fi

if [[ $PURGE == 1 ]]; then
    # Reset settings while the schema is still installed.
    if [[ -d "$DEST/schemas" ]] && command -v gsettings >/dev/null; then
        gsettings --schemadir "$DEST/schemas" reset-recursively "$SCHEMA" 2>/dev/null || true
    fi
    rm -rf "$USAGE_DIR"
    echo "Deleted usage statistics and reset settings"
fi

if [[ -d "$DEST" ]]; then
    rm -rf "$DEST"
    echo "Removed $DEST"
else
    echo "NetPulse is not installed in $DEST"
fi
[[ $PURGE == 1 ]] || echo "Usage statistics were kept in $USAGE_DIR (use --purge to delete them)."
echo "Log out and back in to unload it from a running GNOME Shell."
