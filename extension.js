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
import {Notifier} from './src/notifications/Notifier.js';
import {UsageAlertNotifier} from './src/notifications/UsageAlertNotifier.js';
import {ConnectionNotifier} from './src/notifications/ConnectionNotifier.js';

// Index within the chosen panel box; -1 appends.
const PANEL_SLOTS = {left: -1, center: -1, right: 0};

export default class NetPulseExtension extends Extension {
    enable() {
        this._signals = [];
        this._settings = new SettingsManager(this.getSettings());
        Logger.setDebug(this._settings.debugLogging);

        this._speedMonitor = new SpeedMonitor({intervalMs: this._settings.refreshIntervalMs});
        this._interfaceMonitor = new InterfaceMonitor();
        this._interfaceMonitor.setManualInterface(this._settings.manualInterface);
        this._usageTracker = new UsageTracker({
            storage: new UsageStorage(),
            weekStart: Shell.util_get_week_start(),
            retentionDays: this._settings.retentionDays,
        });
        this._usageTracker.setEnabled(this._settings.usageTracking);

        this._notifier = new Notifier();
        this._usageAlerts = new UsageAlertNotifier({
            usageTracker: this._usageTracker,
            settings: this._settings,
            notifier: this._notifier,
        });
        this._connectionNotifier = new ConnectionNotifier({
            interfaceMonitor: this._interfaceMonitor,
            settings: this._settings,
            notifier: this._notifier,
        });

        this._createIndicator();
        this._connectSignals();

        // The shell does not disable extensions when the session ends: save
        // usage and stop monitoring before teardown, so no data is lost and
        // no callbacks fire during finalization.
        global.connectObject('shutdown', () => this._onShutdown(), this);

        this._start().catch(e => Logger.error('Failed to start monitoring:', e));
    }

    disable() {
        global.disconnectObject(this);
        for (const [source, id] of this._signals)
            source.disconnect(id);
        this._signals = [];

        this._stopMonitoring();
        this._usageAlerts?.destroy();
        this._usageAlerts = null;
        this._notifier?.destroy();
        this._notifier = null;
        this._destroyIndicator();
        this._usageTracker?.destroy();
        this._usageTracker = null;
        this._settings?.destroy();
        this._settings = null;
    }

    _connect(source, signal, callback) {
        this._signals.push([source, source.connect(signal, callback)]);
    }

    _connectSignals() {
        const settings = this._settings;
        this._connect(settings, 'debug', () => Logger.setDebug(settings.debugLogging));
        this._connect(settings, 'interval',
            () => this._speedMonitor?.setIntervalMs(settings.refreshIntervalMs));
        this._connect(settings, 'network',
            () => this._interfaceMonitor?.setManualInterface(settings.manualInterface));
        this._connect(settings, 'usage', () => {
            this._usageTracker.setEnabled(settings.usageTracking);
            this._usageTracker.setRetentionDays(settings.retentionDays);
        });
        this._connect(settings, 'reset',
            () => this._usageTracker.applyResetRequest(settings.resetRequest));
        this._connect(settings, 'display', () => this._indicator?.setOptions(settings.display));
        this._connect(settings, 'position', () => this._createIndicator());

        this._connect(this._speedMonitor, 'sample', sample => {
            this._indicator?.setSample(sample);
            this._usageTracker.add(sample.rxDelta, sample.txDelta,
                sample.counters && {iface: sample.iface, ...sample.counters});
        });
        this._connect(this._interfaceMonitor, 'changed', info => this._onNetworkChanged(info));
    }

    // Loads the usage data and catches up on traffic missed while disabled
    // before monitoring starts, so nothing is counted twice.
    async _start() {
        const tracker = this._usageTracker;
        const bootId = await readBootId();
        await tracker.load({
            bootId,
            // Survives screen locking (which disables extensions) but not a
            // new login.
            sessionId: `${bootId}:${new Gio.Credentials().get_unix_pid()}`,
        });
        if (tracker !== this._usageTracker)
            return; // disabled meanwhile
        tracker.applyResetRequest(this._settings.resetRequest);
        await tracker.catchUp(iface => readCounters(iface));
        if (tracker !== this._usageTracker || !this._interfaceMonitor)
            return;
        tracker.startAutosave();

        await this._interfaceMonitor.start();
    }

    _onShutdown() {
        this._usageTracker?.saveSync();
        this._stopMonitoring();
    }

    _stopMonitoring() {
        this._connectionNotifier?.destroy();
        this._connectionNotifier = null;
        this._interfaceMonitor?.destroy();
        this._interfaceMonitor = null;
        this._speedMonitor?.destroy();
        this._speedMonitor = null;
    }

    _destroyIndicator() {
        this._dashboard?.destroy();
        this._dashboard = null;
        const indicator = this._indicator;
        this._indicator = null;
        if (indicator) {
            indicator.disconnect(this._indicatorDestroyId);
            indicator.destroy();
        }
    }

    _createIndicator() {
        this._destroyIndicator();
        const indicator = this._indicator = new PanelIndicator();
        // Only the shell's own teardown destroys the indicator behind our
        // back. Its shutdown handler runs before ours, inside a main loop
        // that still dispatches our timers, so stop right away.
        this._indicatorDestroyId = indicator.connect('destroy', () => {
            this._indicator = null;
            this._dashboard?.destroy();
            this._dashboard = null;
            this._onShutdown();
        });
        indicator.setOptions(this._settings.display);
        if (this._speedMonitor)
            indicator.setSample(this._speedMonitor.current);
        if (this._interfaceMonitor)
            indicator.setOnline(isOnline(this._interfaceMonitor.info));

        indicator.setMenuBuilder(() => {
            if (!this._speedMonitor || !this._interfaceMonitor)
                return;
            this._dashboard = new PopupDashboard(indicator.menu, {
                speedMonitor: this._speedMonitor,
                interfaceMonitor: this._interfaceMonitor,
                usageTracker: this._usageTracker,
                settings: this._settings,
                openPreferences: () => this.openPreferences(),
            });
        });

        const position = this._settings.panelPosition;
        Main.panel.addToStatusArea(this.uuid, indicator, PANEL_SLOTS[position], position);
    }

    _onNetworkChanged(info) {
        const online = isOnline(info);
        this._speedMonitor?.setInterface(online ? info.name : null);
        this._indicator?.setOnline(online);
    }
}
