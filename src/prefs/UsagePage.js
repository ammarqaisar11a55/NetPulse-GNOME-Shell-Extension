import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {switchRow, spinRow, group} from './Rows.js';

export const UsagePage = GObject.registerClass(
class UsagePage extends Adw.PreferencesPage {
    constructor(settings) {
        super({title: _('Usage'), icon_name: 'document-open-recent-symbolic', name: 'usage'});
        this._settings = settings;

        this.add(group(_('Tracking'), [
            switchRow(settings, 'usage-tracking', _('Track Data Usage'),
                _('Count downloaded and uploaded data per session, day, week and month')),
            spinRow(settings, 'usage-retention-days', _('Keep History'),
                _('Days of daily usage history to keep'), {lower: 31, upper: 3650, step: 1}),
        ]));

        const path = GLib.build_filenamev([GLib.get_user_data_dir(), 'netpulse', 'usage.json'])
            .replace(GLib.get_home_dir(), '~');
        const location = new Adw.ActionRow({title: _('Stored In'), subtitle: path, subtitle_selectable: true});

        const reset = new Adw.ButtonRow({title: _('Reset Statistics…')});
        reset.add_css_class('destructive-action');
        reset.connect('activated', () => this._confirmReset());

        this.add(group(_('Data'), [location, reset],
            _('Usage statistics never leave this computer.')));
    }

    _confirmReset() {
        const dialog = new Adw.AlertDialog({
            heading: _('Reset Usage Statistics?'),
            body: _('All recorded usage history will be permanently erased.'),
            close_response: 'cancel',
            default_response: 'cancel',
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('reset', _('Reset'));
        dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.connect('response', (_dialog, response) => {
            // The extension erases the data when it sees a newer request.
            if (response === 'reset')
                this._settings.set_int64('usage-reset-request', Math.floor(Date.now() / 1000));
        });
        dialog.present(this);
    }
});
