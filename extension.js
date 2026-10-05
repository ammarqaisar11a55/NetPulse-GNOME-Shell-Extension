import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Logger from './src/utils/Logger.js';
import {InterfaceMonitor} from './src/network/InterfaceMonitor.js';
import {isOnline} from './src/network/InterfaceTypes.js';
import {SpeedMonitor, readCounters} from './src/network/SpeedMonitor.js';
import {SettingsManager} from './src/settings/SettingsManager.js';
import {UsageTracker, readBootId} from './src/usage/UsageTracker.js';
import {UsageStorage} from './src/usage/UsageStorage.js';
import {PanelIndicator} from './src/ui/PanelIndicator.js';
import {PopupDashboard} from './src/ui/PopupDashboard.js';

// Index within the chosen panel box; -1 appends.
const PANEL_SLOTS = {left: -1, center: -1, right: 0};

export default class NetPulseExtension extends Extension {
    enable() {
        this._settings = new SettingsManager(this.getSettings());
        Logger.setDebug(this._settings.debugLogging);
        this._settings.connect('debug', () => Logger.setDebug(this._settings.debugLogging));

        this._speedMonitor = new SpeedMonitor({intervalMs: this._settings.refreshIntervalMs});
        this._settings.connect('interval',
            () => this._speedMonitor?.setIntervalMs(this._settings.refreshIntervalMs));

        this._interfaceMonitor = new InterfaceMonitor();
        this._usageTracker = this._createUsageTracker();

        this._createIndicator();
        this._settings.connect('display', () => this._indicator.setOptions(this._settings.display));
        this._settings.connect('position', () => this._createIndicator());

        this._speedMonitor.connect('sample', sample => {
            this._indicator.setSample(sample);
            this._usageTracker.add(sample.rxDelta, sample.txDelta,
                sample.counters && {iface: sample.iface, ...sample.counters});
        });
        this._interfaceMonitor.connect('changed', info => this._onNetworkChanged(info));
        this._interfaceMonitor.start().catch(e =>
            Logger.error('Failed to start network detection:', e));

        // The shell does not disable extensions when the session ends: save
        // usage and stop monitoring before teardown, so no data is lost and
        // no callbacks fire during finalization.
        global.connectObject('shutdown', () => {
            this._usageTracker.save();
            this._stopMonitoring();
        }, this);

        Logger.info('Enabled');
    }

    disable() {
        global.disconnectObject(this);
        this._stopMonitoring();
        this._destroyIndicator();
        this._usageTracker?.destroy();
        this._usageTracker = null;
        this._settings?.destroy();
        this._settings = null;

        Logger.info('Disabled');
    }

    _createUsageTracker() {
        const bootId = readBootId();
        const tracker = new UsageTracker({
            storage: new UsageStorage(),
            bootId,
            // Survives screen locking (which disables extensions) but not a
            // new login.
            sessionId: `${bootId}:${new Gio.Credentials().get_unix_pid()}`,
            weekStart: Shell.util_get_week_start(),
        });
        // Load and catch up before monitoring starts, so no traffic is
        // counted twice.
        tracker.load();
        tracker.catchUp(iface => readCounters(iface));
        tracker.startAutosave();
        return tracker;
    }

    _stopMonitoring() {
        this._interfaceMonitor?.destroy();
        this._interfaceMonitor = null;
        this._speedMonitor?.destroy();
        this._speedMonitor = null;
    }

    _destroyIndicator() {
        this._dashboard?.destroy();
        this._dashboard = null;
        this._indicator?.destroy();
        this._indicator = null;
    }

    _createIndicator() {
        this._destroyIndicator();
        this._indicator = new PanelIndicator();
        this._indicator.setOptions(this._settings.display);
        if (this._speedMonitor)
            this._indicator.setSample(this._speedMonitor.current);
        if (this._interfaceMonitor)
            this._indicator.setOnline(isOnline(this._interfaceMonitor.info));

        if (this._speedMonitor && this._interfaceMonitor) {
            this._dashboard = new PopupDashboard(this._indicator.menu, {
                speedMonitor: this._speedMonitor,
                interfaceMonitor: this._interfaceMonitor,
                usageTracker: this._usageTracker,
                settings: this._settings,
            });
        }

        const position = this._settings.panelPosition;
        Main.panel.addToStatusArea(this.uuid, this._indicator, PANEL_SLOTS[position], position);
    }

    _onNetworkChanged(info) {
        const online = isOnline(info);
        this._speedMonitor.setInterface(online ? info.name : null);
        this._indicator.setOnline(online);
    }
}
