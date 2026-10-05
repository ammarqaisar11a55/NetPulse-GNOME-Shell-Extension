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
./install.sh
```

The script checks your GNOME Shell version and dependencies, installs the
extension for your user into `~/.local/share/gnome-shell/extensions/` and
compiles its settings schema. Log out and back in (on Wayland), then:

```bash
gnome-extensions enable netpulse@ammarqaisar11a55.github.io
```

To remove it, run `./uninstall.sh` (add `--purge` to also delete your usage
statistics and settings).

## Development

Run the unit tests (plain `gjs`, no dependencies):

```bash
gjs -m tests/run.js
```

Run the integration scenarios in `tests/shell/scenarios/` against an
isolated, headless GNOME Shell (your real session and settings are
untouched; screenshots land in `test-output/`):

```bash
tools/test-headless.sh
```

Watch what NetPulse detects and measures on your machine, and test network
switching and high-rate traffic inside private network namespaces (no root
needed):

```bash
gjs -m tests/live/probe-network.js 60
gjs -m tests/live/probe-speed.js 30
tests/live/netns-switching.sh
tests/live/netns-traffic.sh 500
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

Usage statistics are stored only on your computer, readable by you alone,
in `~/.local/share/netpulse/usage.json` (with a daily backup next to it).

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
