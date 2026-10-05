import Adw from 'gi://Adw';
import GObject from 'gi://GObject';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {switchRow, spinRow, group} from './Rows.js';

export const NotificationsPage = GObject.registerClass(
class NotificationsPage extends Adw.PreferencesPage {
    constructor(settings) {
        super({title: _('Notifications'), icon_name: 'preferences-system-notifications-symbolic', name: 'notifications'});

        const limits = [
            spinRow(settings, 'daily-limit', _('Daily Limit'),
                _('In GB; 0 turns daily alerts off'), {lower: 0, upper: 100000, step: 0.5, digits: 1}),
            spinRow(settings, 'monthly-limit', _('Monthly Limit'),
                _('In GB; 0 turns monthly alerts off'), {lower: 0, upper: 1000000, step: 1, digits: 0}),
            spinRow(settings, 'alert-percent', _('Warn At'),
                _('Percentage of a limit at which to warn before it is reached'), {lower: 1, upper: 99, step: 5}),
        ];
        const enabled = switchRow(settings, 'usage-notifications', _('Data Limit Alerts'),
            _('Notify once when a limit is nearly reached and once when it is reached'));
        const syncSensitivity = () => limits.forEach(row => (row.sensitive = enabled.active));
        enabled.connect('notify::active', syncSensitivity);
        syncSensitivity();

        this.add(group(_('Data Limits'), [enabled, ...limits],
            _('Useful with metered or capped internet plans. Usage counts download and upload together.')));

        this.add(group(_('Connection'), [
            switchRow(settings, 'connection-notifications', _('Connection Changes'),
                _('Notify when the connection is lost, restored or switched, and when a VPN turns on or off')),
        ]));
    }
});
