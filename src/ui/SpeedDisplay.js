// Large side-by-side download and upload readouts for the popup.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {label, setText, DIM_OPACITY} from './Widgets.js';
import {ARROWS} from './PanelText.js';
import {speedParts} from '../utils/Formatters.js';

const SpeedTile = GObject.registerClass(
class SpeedTile extends St.BoxLayout {
    constructor(kind, caption) {
        super({
            style_class: `netpulse-speed-tile netpulse-speed-tile-${kind}`,
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this.add_child(label('netpulse-speed-caption', {
            text: `${ARROWS[kind]}  ${caption}`,
            opacity: DIM_OPACITY,
        }));

        const row = new St.BoxLayout({style_class: 'netpulse-speed-readout'});
        this._value = label('netpulse-speed-value');
        this._unit = label('netpulse-speed-unit', {
            opacity: DIM_OPACITY,
            y_align: Clutter.ActorAlign.END,
        });
        row.add_child(this._value);
        row.add_child(this._unit);
        this.add_child(row);
    }

    /**
     * @param {number} rate - bytes per second
     * @param {import('../utils/Formatters.js').UnitOptions} options - units
     */
    update(rate, options) {
        const {value, unit} = speedParts(rate, options);
        setText(this._value, value);
        setText(this._unit, unit);
    }

    /** @returns {string} the shown text, for tests */
    get text() {
        return `${this._value.text} ${this._unit.text}`;
    }
});

export const SpeedDisplay = GObject.registerClass(
class SpeedDisplay extends St.BoxLayout {
    constructor() {
        super({style_class: 'netpulse-speed-display', x_expand: true});
        // Equal columns, so the upload tile does not shift as digits change.
        this.layout_manager.homogeneous = true;
        this.download = new SpeedTile('download', _('Download'));
        this.upload = new SpeedTile('upload', _('Upload'));
        this.add_child(this.download);
        this.add_child(this.upload);
    }

    /**
     * @param {{download: number, upload: number}} sample - current rates
     * @param {import('../utils/Formatters.js').UnitOptions} options - units
     */
    update(sample, options) {
        this.download.update(sample.download, options);
        this.upload.update(sample.upload, options);
    }
});
