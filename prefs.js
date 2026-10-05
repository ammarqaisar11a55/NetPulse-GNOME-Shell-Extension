import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {DisplayPage} from './src/prefs/DisplayPage.js';
import {UsagePage} from './src/prefs/UsagePage.js';
import {NetworkPage} from './src/prefs/NetworkPage.js';

export default class NetPulsePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.add(new DisplayPage(settings));
        window.add(new UsagePage(settings));
        window.add(new NetworkPage(settings));
        window.set_default_size(640, 720);
        window.search_enabled = true;
    }
}
