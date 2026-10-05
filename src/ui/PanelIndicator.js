// The top panel button showing the current speeds. Clicking it opens the
// popup dashboard (see PopupDashboard.js).

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {panelSegments} from './PanelText.js';
import {speedUnitCandidates, VALUE_WIDTH_TEMPLATES} from '../utils/Formatters.js';

const OFFLINE_OPACITY = 128;
const FADE_DURATION_MS = 250;

/**
 * Reserves the width of the widest text a label can show, so changing
 * numbers never make the panel jump. Measured with the real theme font.
 *
 * @param {St.Label} label - label to size
 * @param {string[]} candidates - every text the label may display
 */
function reserveWidth(label, candidates) {
    const current = label.text;
    label.min_width_set = false;
    label.natural_width_set = false;
    let width = 0;
    for (const text of candidates) {
        label.text = text;
        width = Math.max(width, label.get_preferred_width(-1)[1]);
    }
    label.text = current;
    // Minimum and natural width must be set together: a natural width below
    // the minimum is a fatal layout error in Clutter.
    label.min_width = label.natural_width = Math.ceil(width);
}

const SpeedItem = GObject.registerClass(
class SpeedItem extends St.BoxLayout {
    constructor() {
        super({style_class: 'netpulse-speed', y_align: Clutter.ActorAlign.CENTER});
        this._arrow = new St.Label({style_class: 'netpulse-arrow', y_align: Clutter.ActorAlign.CENTER});
        this._value = new St.Label({style_class: 'netpulse-value', y_align: Clutter.ActorAlign.CENTER});
        this._unit = new St.Label({style_class: 'netpulse-unit', y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._arrow);
        this.add_child(this._value);
        this.add_child(this._unit);
    }

    /** @param {import('./PanelText.js').PanelSegment} segment - what to show */
    update(segment) {
        this._arrow.text = segment.arrow;
        this._value.text = segment.value;
        this._unit.text = segment.unit;
        this._unit.visible = segment.unit !== '';
    }

    /**
     * @param {string[]} units - every unit text this item may show
     */
    reserveWidths(units) {
        reserveWidth(this._value, VALUE_WIDTH_TEMPLATES);
        if (units.length > 0)
            reserveWidth(this._unit, units);
    }
});

export const PanelIndicator = GObject.registerClass(
class PanelIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, _('NetPulse'));
        this.add_style_class_name('netpulse-indicator');

        this._box = new St.BoxLayout({
            style_class: 'netpulse-panel-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._box);
        this._items = [];

        this._options = null;
        this._sample = {download: 0, upload: 0};
        this._online = true;

        // Widths depend on the font, which is only known once styled, and
        // change with text scaling.
        this._box.connect('style-changed', () => this._reserveWidths());
    }

    /**
     * @param {import('../settings/SettingsManager.js').DisplayOptions} options - display options
     */
    setOptions(options) {
        this._options = options;

        const count = options.content === 'both' ? 2 : 1;
        while (this._items.length > count)
            this._items.pop().destroy();
        while (this._items.length < count) {
            const item = new SpeedItem();
            this._items.push(item);
            this._box.add_child(item);
        }

        this._box.orientation = options.style === 'stacked'
            ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL;
        for (const style of ['detailed', 'compact', 'stacked'])
            this._box.remove_style_class_name(`netpulse-style-${style}`);
        this._box.add_style_class_name(`netpulse-style-${options.style}`);

        this._render();
        this._reserveWidths();
    }

    /** @param {{download: number, upload: number}} sample - current rates */
    setSample(sample) {
        this._sample = sample;
        this._render();
    }

    /** @param {boolean} online - whether a network connection is available */
    setOnline(online) {
        if (online === this._online)
            return;
        this._online = online;
        this._box.ease({
            opacity: online ? 255 : OFFLINE_OPACITY,
            duration: FADE_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._render();
    }

    _render() {
        if (!this._options)
            return;
        const segments = panelSegments(this._sample, this._options);
        segments.forEach((segment, i) => this._items[i].update(segment));

        const parts = segments.map(s => `${s.kind === 'upload' ? _('Upload') : s.kind === 'download'
            ? _('Download') : _('Total')} ${s.value} ${s.unit}`.trim());
        const name = this._online ? parts.join(', ') : _('Offline');
        if (this.accessible_name !== name)
            this.accessible_name = name;
    }

    _reserveWidths() {
        if (!this._options || !this._box.get_stage())
            return;
        const {units, shorts} = speedUnitCandidates(this._options);
        let candidates = [];
        if (this._options.showUnits)
            candidates = this._options.style === 'compact' ? shorts : units;
        for (const item of this._items)
            item.reserveWidths(candidates);
    }

    /** @returns {string} the text currently shown, for tests */
    get text() {
        return this._items.map(item =>
            [item._arrow.text, item._value.text, item._unit.visible ? item._unit.text : '']
                .filter(Boolean).join(' ')).join('  ');
    }
});
