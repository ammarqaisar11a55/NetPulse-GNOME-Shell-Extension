#!/usr/bin/env python3
"""Drives a GTK application through its accessibility tree (AT-SPI).

Used by the headless shell scenarios to operate the NetPulse preferences
window by widget names instead of screen coordinates.

Usage:
  a11y.py dump <app>                      print the widget tree
  a11y.py activate <app> <name> [role]    run the default action of the first
                                          widget with that name (and role)
  a11y.py center <app> <name> [role]      print the widget's center, relative
                                          to its window, as "x y"
  a11y.py wait <app> <name> [role]        wait until such a widget exists
"""

import sys
import time

import gi

gi.require_version('Atspi', '2.0')
from gi.repository import Atspi  # noqa: E402


def find_app(name):
    desktop = Atspi.get_desktop(0)
    for i in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(i)
        if app and app.get_name() == name:
            return app
    return None


def walk(node, depth=0):
    yield node, depth
    for i in range(node.get_child_count()):
        child = node.get_child_at_index(i)
        if child is not None:
            yield from walk(child, depth + 1)


def has_actions(node):
    action = node.get_action_iface()
    return action is not None and action.get_n_actions() > 0


def find(app, name, role=None, actionable=False):
    # Rows often share their name with the control inside them; only the
    # control has actions.
    for node, _ in walk(app):
        if node.get_name() == name and (role is None or node.get_role_name() == role) \
                and (not actionable or has_actions(node)):
            return node
    return None


def wait_for(app_name, name, role=None, actionable=False, timeout=float(__import__("os").environ.get("A11Y_TIMEOUT", "10"))):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        app = find_app(app_name)
        node = app and find(app, name, role, actionable)
        if node:
            return node
        time.sleep(0.25)
    return None


def main(argv):
    command, app_name = argv[1], argv[2]
    if command == 'dump':
        app = find_app(app_name)
        if not app:
            sys.exit(f'no application {app_name!r}')
        for node, depth in walk(app):
            print(f"{'  ' * depth}{node.get_role_name()}: {node.get_name()!r}")
        return

    name, role = argv[3], argv[4] if len(argv) > 4 else None
    node = wait_for(app_name, name, role, actionable=command != 'wait')
    if node is None:
        sys.exit(f'no widget {name!r} ({role}) in {app_name!r}')
    if command == 'activate':
        node.get_action_iface().do_action(0)
        time.sleep(0.3)
    elif command == 'center':
        e = node.get_component_iface().get_extents(Atspi.CoordType.WINDOW)
        print(e.x + e.width // 2, e.y + e.height // 2)


if __name__ == '__main__':
    main(sys.argv)
