# NetPulse

> Real-time internet speed and usage monitoring for GNOME.

NetPulse is a GNOME Shell extension that shows your current download and
upload speed in the top panel and keeps track of how much data you use.

> **Status:** early development. The extension skeleton is in place; speed
> monitoring, usage tracking and the popup dashboard are being added module
> by module.

## Requirements

- GNOME Shell 50 (developed and tested on Ubuntu 26.04 LTS)
- `glib-compile-schemas` (part of `libglib2.0-bin`)

## Installation (from source)

```bash
git clone git@github.com:ammarqaisar11a55/NetPulse-GNOME-Shell-Extension.git
cd NetPulse-GNOME-Shell-Extension

UUID=netpulse@ammarqaisar11a55.github.io
DEST=~/.local/share/gnome-shell/extensions/$UUID
mkdir -p "$DEST"
cp -r metadata.json extension.js schemas src "$DEST"/
glib-compile-schemas "$DEST/schemas"
```

GNOME Shell only discovers new extensions at login on Wayland, so log out
and back in, then enable it:

```bash
gnome-extensions enable netpulse@ammarqaisar11a55.github.io
```

## Development

Run the extension in an isolated, headless GNOME Shell (your real session
and settings are untouched) and exercise the enable/disable lifecycle:

```bash
tools/test-headless.sh
```

To watch the logs of your real session:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Verbose logging can be switched on with:

```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/netpulse@ammarqaisar11a55.github.io/schemas \
    set org.gnome.shell.extensions.netpulse debug-logging true
```

## Privacy

NetPulse works entirely locally. It makes no network requests, collects no
personal information and contains no analytics or telemetry.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
