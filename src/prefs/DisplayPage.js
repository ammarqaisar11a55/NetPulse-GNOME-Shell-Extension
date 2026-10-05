import Adw from 'gi://Adw';
import GObject from 'gi://GObject';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {switchRow, spinRow, comboRow, group} from './Rows.js';

export const DisplayPage = GObject.registerClass(
class DisplayPage extends Adw.PreferencesPage {
    constructor(settings) {
        super({title: _('Display'), icon_name: 'video-display-symbolic', name: 'display'});

        this.add(group(_('Top Bar'), [
            comboRow(settings, 'panel-content', _('Show'), _('Which speeds appear in the top bar'), [
                ['both', _('Download and Upload')],
                ['download', _('Download Only')],
                ['upload', _('Upload Only')],
                ['combined', _('Combined Speed')],
            ]),
            comboRow(settings, 'panel-style', _('Style'), _('Compact uses one-letter units; stacked shows two lines'), [
                ['detailed', _('Detailed')],
                ['compact', _('Compact')],
                ['stacked', _('Stacked')],
            ]),
            comboRow(settings, 'panel-position', _('Position'), '', [
                ['left', _('Left')],
                ['center', _('Center')],
                ['right', _('Right')],
            ]),
            switchRow(settings, 'show-units', _('Show Units')),
        ]));

        this.add(group(_('Units'), [
            switchRow(settings, 'use-bits', _('Speeds in Bits'),
                _('Show speeds in bits per second (Mbps), as internet plans are advertised')),
            switchRow(settings, 'binary-units', _('Binary Units'),
                _('Use 1024-based units (KiB, MiB, GiB) instead of 1000-based units')),
        ]));

        this.add(group(_('Appearance'), [
            comboRow(settings, 'popup-theme', _('Popup Style'), _('The top bar always follows the system style'), [
                ['system', _('Follow System')],
                ['light', _('Light')],
                ['dark', _('Dark')],
            ]),
        ]));

        this.add(group(_('Updates'), [
            spinRow(settings, 'refresh-interval', _('Refresh Interval'),
                _('Seconds between speed measurements'), {lower: 0.5, upper: 10, step: 0.5, digits: 1}),
        ]));
    }
});
