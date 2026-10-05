// Watches usage against the configured data limits and notifies once per
// threshold and period (see UsageAlerts.js).

import GLib from 'gi://GLib';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Urgency} from './Notifier.js';
import {evaluateAlerts, AlertLevel} from '../usage/UsageAlerts.js';
import {dayKey, monthKey} from '../usage/UsageStatistics.js';
import {formatBytes} from '../utils/Formatters.js';
import * as Logger from '../utils/Logger.js';

export class UsageAlertNotifier {
    /**
     * @param {object} deps - dependencies
     * @param {import('../usage/UsageTracker.js').UsageTracker} deps.usageTracker - usage
     * @param {import('../settings/SettingsManager.js').SettingsManager} deps.settings - settings
     * @param {import('./Notifier.js').Notifier} deps.notifier - notification sink
     */
    constructor({usageTracker, settings, notifier}) {
        this._usageTracker = usageTracker;
        this._settings = settings;
        this._notifier = notifier;
        this._handlers = [
            [usageTracker, usageTracker.connect('changed', () => this.check())],
            [settings, settings.connect('alerts', () => this.check())],
        ];
        this.check();
    }

    check() {
        const config = this._settings.alerts;
        if (!config.enabled || !this._usageTracker.enabled || (!config.daily && !config.monthly))
            return;

        const now = GLib.DateTime.new_now_local();
        const {alerts, state} = evaluateAlerts({
            totals: this._usageTracker.totals,
            limits: {daily: config.daily, monthly: config.monthly},
            percent: config.percent,
            periods: {daily: dayKey(now), monthly: monthKey(now)},
            state: this._usageTracker.alertState,
        });
        this._usageTracker.setAlertState(state);

        for (const alert of alerts) {
            Logger.info(`Data limit alert: ${alert.period} ${alert.level}`);
            this._notifier.notify({...this._message(alert), iconName: 'network-transmit-receive-symbolic'});
        }
    }

    /**
     * @param {import('../usage/UsageAlerts.js').Alert} alert - alert
     * @returns {{title: string, body: string, urgency: number}}
     */
    _message(alert) {
        const {binary} = this._settings.display;
        const used = formatBytes(alert.used, {binary});
        const limit = formatBytes(alert.limit, {binary});
        const daily = alert.period === 'daily';

        if (alert.level === AlertLevel.LIMIT) {
            return {
                title: daily ? _('Daily data limit reached') : _('Monthly data limit reached'),
                body: (daily
                    ? _('You’ve used %s today, reaching your daily limit of %s.')
                    : _('You’ve used %s this month, reaching your monthly limit of %s.')).format(used, limit),
                urgency: Urgency.HIGH,
            };
        }

        const percent = Math.floor((alert.used / alert.limit) * 100);
        return {
            title: daily ? _('Daily data limit almost reached') : _('Monthly data limit almost reached'),
            body: (daily
                ? _('You’ve used %d%% of your daily internet limit (%s of %s).')
                : _('You’ve used %d%% of your monthly internet limit (%s of %s).')).format(percent, used, limit),
            urgency: Urgency.NORMAL,
        };
    }

    destroy() {
        for (const [source, id] of this._handlers)
            source.disconnect(id);
        this._handlers = [];
    }
}
