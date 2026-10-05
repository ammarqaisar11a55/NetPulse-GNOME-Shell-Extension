import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Logger from './src/utils/Logger.js';
import {InterfaceMonitor} from './src/network/InterfaceMonitor.js';

export default class NetPulseExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        Logger.setDebug(this._settings.get_boolean('debug-logging'));
        this._settings.connectObject('changed::debug-logging',
            () => Logger.setDebug(this._settings.get_boolean('debug-logging')),
            this);

        this._interfaceMonitor = new InterfaceMonitor();
        this._interfaceMonitor.start().catch(e =>
            Logger.error('Failed to start network detection:', e));

        Logger.info('Enabled');
    }

    disable() {
        this._interfaceMonitor?.destroy();
        this._interfaceMonitor = null;

        this._settings?.disconnectObject(this);
        this._settings = null;

        Logger.info('Disabled');
    }
}
