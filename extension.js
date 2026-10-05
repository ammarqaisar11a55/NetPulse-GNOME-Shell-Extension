import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Logger from './src/utils/Logger.js';
import {InterfaceMonitor} from './src/network/InterfaceMonitor.js';
import {isOnline} from './src/network/InterfaceTypes.js';
import {SpeedMonitor} from './src/network/SpeedMonitor.js';

export default class NetPulseExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        Logger.setDebug(this._settings.get_boolean('debug-logging'));
        this._settings.connectObject(
            'changed::debug-logging',
            () => Logger.setDebug(this._settings.get_boolean('debug-logging')),
            'changed::refresh-interval',
            () => this._speedMonitor.setIntervalMs(this._refreshIntervalMs()),
            this);

        this._speedMonitor = new SpeedMonitor({intervalMs: this._refreshIntervalMs()});

        this._interfaceMonitor = new InterfaceMonitor();
        this._interfaceMonitor.connect('changed', info =>
            this._speedMonitor.setInterface(isOnline(info) ? info.name : null));
        this._interfaceMonitor.start().catch(e =>
            Logger.error('Failed to start network detection:', e));

        Logger.info('Enabled');
    }

    disable() {
        this._interfaceMonitor?.destroy();
        this._interfaceMonitor = null;
        this._speedMonitor?.destroy();
        this._speedMonitor = null;

        this._settings?.disconnectObject(this);
        this._settings = null;

        Logger.info('Disabled');
    }

    _refreshIntervalMs() {
        return this._settings.get_double('refresh-interval') * 1000;
    }
}
