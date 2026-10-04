import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Logger from './src/utils/Logger.js';

export default class NetPulseExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        Logger.setDebug(this._settings.get_boolean('debug-logging'));
        this._settings.connectObject('changed::debug-logging',
            () => Logger.setDebug(this._settings.get_boolean('debug-logging')),
            this);

        Logger.info('Enabled');
    }

    disable() {
        this._settings?.disconnectObject(this);
        this._settings = null;

        Logger.info('Disabled');
    }
}
