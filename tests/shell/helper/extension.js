// Test-only helper, installed exclusively into the throwaway headless shell
// started by tools/test-headless.sh. Unsafe mode lets the test scenarios
// inspect the shell through org.gnome.Shell.Eval and take screenshots.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class TestHelperExtension extends Extension {
    enable() {
        global.context.unsafe_mode = true;
        // Drop the "unsafe mode" banner so it does not cover screenshots.
        Main.messageTray.getSources().forEach(source => source.destroy());
    }

    disable() {
        global.context.unsafe_mode = false;
    }
}
