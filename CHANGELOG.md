# Changelog

All notable changes to NetPulse are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and versions follow
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-05

First release, for GNOME Shell 50.

### Features

- Real-time download and upload speed in the top bar: detailed, compact or
  stacked, download/upload/combined, bytes or bits, decimal or binary units,
  left/center/right placement; stable width as numbers change.
- Popup dashboard with the current network (name or Wi-Fi network, type,
  interface, status), speeds, history charts (live, today, 7 days, 30 days,
  with values on hover), usage table and network details.
- Usage tracking per session, day, week and month that survives restarts,
  crashes and reboots, with atomic writes, a daily backup, recovery of
  traffic while the screen was locked, configurable history retention and a
  reset option.
- Automatic detection of the active interface through NetworkManager, with a
  kernel fallback; Ethernet, Wi-Fi, USB tethering, mobile broadband,
  Bluetooth and VPNs; spike-free switching; optional fixed interface.
- Daily and monthly data limit alerts, and optional connection change
  notifications, without repeats.
- Light and dark styles following GNOME and the accent color, with an option
  to force the popup into either style.
- Preferences window for every option.
- `install.sh` and `uninstall.sh` for installation without root.

### Privacy

- No network requests, telemetry or analytics; statistics stay on the
  computer.
