// Notifies when the connection is lost, restored or switched, and when a VPN
// turns on or off.
//
// Changes are announced only after the network has been stable for a moment,
// so a flapping link or a quick Wi-Fi to Ethernet handover produces a single
// notification. The state found at startup is never announced, and each
// notification replaces the previous one.

import GLib from 'gi://GLib';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {typeLabel, networkIcon} from '../ui/Labels.js';
import {isOnline, ConnectionState} from '../network/InterfaceTypes.js';

const SETTLE_DELAY_MS = 2000;

/**
 * Lists what changed between two network states that is worth announcing.
 * Pure.
 *
 * @param {import('../network/InterfaceTypes.js').NetworkInfo} before - previous state
 * @param {import('../network/InterfaceTypes.js').NetworkInfo} after - new state
 * @returns {{title: string, body: string}[]} messages, most important first
 */
export function describeChange(before, after) {
    const messages = [];
    const name = info => info.connection ? `${typeLabel(info.type)} “${info.connection}”` : typeLabel(info.type);

    if (isOnline(before) && !isOnline(after)) {
        messages.push({title: _('Disconnected'), body: _('The network connection was lost.')});
    } else if (!isOnline(before) && isOnline(after)) {
        messages.push({title: _('Connected'), body: _('Connected to %s (%s).').format(name(after), after.name)});
    } else if (isOnline(after) && before.name !== after.name) {
        messages.push({title: _('Network changed'), body: _('Now using %s (%s).').format(name(after), after.name)});
    }

    if (isOnline(after) && before.state !== ConnectionState.LIMITED && after.state === ConnectionState.LIMITED) {
        messages.push({
            title: _('Limited connectivity'),
            body: _('Connected to %s, but the internet is not reachable.').format(name(after)),
        });
    }

    if (!before.vpn && after.vpn)
        messages.push({title: _('VPN connected'), body: after.vpn.name});
    else if (before.vpn && !after.vpn)
        messages.push({title: _('VPN disconnected'), body: before.vpn.name});

    return messages;
}

export class ConnectionNotifier {
    /**
     * @param {object} deps - dependencies
     * @param {import('../network/InterfaceMonitor.js').InterfaceMonitor} deps.interfaceMonitor - network
     * @param {import('../settings/SettingsManager.js').SettingsManager} deps.settings - settings
     * @param {import('./Notifier.js').Notifier} deps.notifier - notification sink
     */
    constructor({interfaceMonitor, settings, notifier}) {
        this._interfaceMonitor = interfaceMonitor;
        this._settings = settings;
        this._notifier = notifier;
        this._baseline = null;
        this._settleId = 0;
        this._notification = null;

        this._changedId = interfaceMonitor.connect('changed', () => this._queue());
        // When turned on, only changes from then on are announced.
        this._settingsId = settings.gsettings.connect('changed::connection-notifications',
            () => (this._baseline = this._interfaceMonitor.info));
        this._queue();
    }

    _queue() {
        if (this._settleId)
            GLib.source_remove(this._settleId);
        this._settleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_DELAY_MS, () => {
            this._settleId = 0;
            this._announce();
            return GLib.SOURCE_REMOVE;
        });
    }

    _announce() {
        const info = this._interfaceMonitor.info;
        const baseline = this._baseline;
        this._baseline = info;
        if (!baseline || !this._settings.connectionNotifications)
            return;

        const messages = describeChange(baseline, info);
        if (messages.length === 0)
            return;

        // Changes that settled together share one notification.
        const [first, ...rest] = messages;
        const body = [first.body, ...rest.map(m => `${m.title}: ${m.body}`)].join('\n');

        this._notification?.destroy();
        this._notification = this._notifier.notify({
            title: first.title,
            body,
            iconName: networkIcon(info),
            isTransient: true,
        });
        this._notification.connect('destroy', n => {
            if (this._notification === n)
                this._notification = null;
        });
    }

    destroy() {
        if (this._settleId)
            GLib.source_remove(this._settleId);
        this._settleId = 0;
        this._interfaceMonitor.disconnect(this._changedId);
        this._settings.gsettings.disconnect(this._settingsId);
        this._notification = null;
    }
}
