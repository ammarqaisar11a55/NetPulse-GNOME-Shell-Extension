// History section of the popup: range tabs, a chart and a summary line that
// shows the hovered bar's values.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {HistoryGraph, ChartMode} from './HistoryGraph.js';
import {label, DIM_OPACITY} from './Widgets.js';
import {ARROWS} from './PanelText.js';
import {formatBytes, formatSpeed} from '../utils/Formatters.js';

export const RANGES = ['live', 'today', 'week', 'month'];
const LIVE_SLOTS = 120;

export const HistoryView = GObject.registerClass(
class HistoryView extends St.BoxLayout {
    /**
     * @param {object} sources - data sources
     * @param {import('../usage/UsageTracker.js').UsageTracker} sources.usageTracker - usage
     * @param {import('../network/SpeedMonitor.js').SpeedMonitor} sources.speedMonitor - speeds
     * @param {import('../settings/SettingsManager.js').SettingsManager} sources.settings - settings
     */
    constructor({usageTracker, speedMonitor, settings}) {
        super({
            style_class: 'netpulse-history',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._usageTracker = usageTracker;
        this._speedMonitor = speedMonitor;
        this._settings = settings;
        this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._model = null;

        this._buildTabs();

        this._scaleLabel = label('netpulse-chart-scale', {opacity: DIM_OPACITY});
        this.add_child(this._scaleLabel);

        this._graph = new HistoryGraph();
        this._graph.connect('hover-changed', () => this._updateSummary());
        this.add_child(this._graph);

        this._axis = new St.BoxLayout({style_class: 'netpulse-chart-axis', x_expand: true});
        this._axis.layout_manager.homogeneous = true;
        this.add_child(this._axis);

        this._summary = label('netpulse-chart-summary', {x_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._summary);
    }

    _buildTabs() {
        const titles = {live: _('Live'), today: _('Today'), week: _('7 Days'), month: _('30 Days')};
        const box = new St.BoxLayout({style_class: 'netpulse-tabs', x_expand: true});
        box.layout_manager.homogeneous = true;
        this._tabs = {};
        for (const range of RANGES) {
            const tab = new St.Button({
                style_class: 'button netpulse-tab',
                label: titles[range],
                toggle_mode: true,
                can_focus: true,
                x_expand: true,
            });
            tab.connect('clicked', () => {
                this._settings.gsettings.set_string('history-range', range);
            });
            this._tabs[range] = tab;
            box.add_child(tab);
        }
        this.add_child(box);
    }

    /** @returns {string} the selected range */
    get range() {
        const range = this._settings.gsettings.get_string('history-range');
        return RANGES.includes(range) ? range : 'today';
    }

    /** Rebuilds the chart from current data. */
    refresh() {
        const range = this.range;
        for (const [name, tab] of Object.entries(this._tabs))
            tab.checked = name === range;

        this._model = range === 'live' ? this._liveModel() : this._usageModel(range);
        this._graph.setData(this._model.values, this._model.mode);
        this._scaleLabel.text = this._model.format(this._graph.max);
        this._setAxis(this._model.axis, this._model.axisAlign);
        this._updateSummary();
    }

    get _unitOptions() {
        const {bits, binary} = this._settings.display;
        return {bits, binary};
    }

    _hourLabel(hour) {
        if (this._interfaceSettings.get_string('clock-format') === '24h')
            return `${String(hour).padStart(2, '0')}:00`;
        return GLib.DateTime.new_local(2000, 1, 1, hour, 0, 0).format('%l %p').trim();
    }

    _usageModel(range) {
        const options = {binary: this._unitOptions.binary};
        const format = n => formatBytes(n, options);
        let series, axis, axisAlign, slotLabel;

        if (range === 'today') {
            series = this._usageTracker.hourlySeries();
            axis = [0, 6, 12, 18].map(h => this._hourLabel(h));
            axisAlign = Clutter.ActorAlign.START;
            slotLabel = i => `${this._hourLabel(i)} – ${this._hourLabel((i + 1) % 24)}`;
        } else if (range === 'week') {
            series = this._usageTracker.dailySeries(7);
            axis = series.map(d => d.date.format('%a'));
            axisAlign = Clutter.ActorAlign.CENTER;
            slotLabel = i => series[i].date.format('%A, %e %B').replace(/\s+/g, ' ');
        } else {
            series = this._usageTracker.dailySeries(30);
            axis = series.filter((_d, i) => i % 5 === 0).map(d => d.date.format('%e %b').trim());
            axisAlign = Clutter.ActorAlign.START;
            slotLabel = i => series[i].date.format('%a, %e %b').replace(/\s+/g, ' ');
        }

        const values = series.map(s => ({a: s.rx, b: s.tx}));
        const rx = values.reduce((sum, v) => sum + v.a, 0);
        const tx = values.reduce((sum, v) => sum + v.b, 0);
        return {
            mode: ChartMode.BARS,
            values,
            axis,
            axisAlign,
            format,
            summary: `${ARROWS.download} ${format(rx)}   ${ARROWS.upload} ${format(tx)}   ${_('Total')} ${format(rx + tx)}`,
            hoverSummary: i => `${slotLabel(i)}   ${ARROWS.download} ${format(values[i].a)}   ${ARROWS.upload} ${format(values[i].b)}`,
        };
    }

    _liveModel() {
        const options = this._unitOptions;
        const format = n => formatSpeed(n, options);
        const history = this._speedMonitor.history;
        // Pad on the left so the chart fills from the right as samples arrive.
        const values = [
            ...new Array(Math.max(0, LIVE_SLOTS - history.length)).fill({a: 0, b: 0}),
            ...history.slice(-LIVE_SLOTS).map(s => ({a: s.download, b: s.upload})),
        ];
        const seconds = this._speedMonitor.intervalMs / 1000;
        const minutes = Math.round((LIVE_SLOTS * seconds) / 60);
        const peakDown = Math.max(0, ...values.map(v => v.a));
        const peakUp = Math.max(0, ...values.map(v => v.b));
        return {
            mode: ChartMode.AREA,
            values,
            axis: [_('%d min ago').format(minutes), _('Now')],
            axisAlign: null,
            format,
            summary: `${_('Peak')}   ${ARROWS.download} ${format(peakDown)}   ${ARROWS.upload} ${format(peakUp)}`,
            hoverSummary: i => {
                const ago = Math.round((LIVE_SLOTS - 1 - i) * seconds);
                const when = ago === 0 ? _('Now') : _('%d s ago').format(ago);
                return `${when}   ${ARROWS.download} ${format(values[i].a)}   ${ARROWS.upload} ${format(values[i].b)}`;
            },
        };
    }

    _setAxis(texts, align) {
        this._axis.destroy_all_children();
        texts.forEach((text, i) => {
            // Without an explicit alignment, labels mark the two edges.
            let xAlign = align;
            if (xAlign === null)
                xAlign = i === 0 ? Clutter.ActorAlign.START : Clutter.ActorAlign.END;
            this._axis.add_child(label('netpulse-chart-axis-label', {
                text,
                opacity: DIM_OPACITY,
                x_expand: true,
                x_align: xAlign,
            }));
        });
    }

    _updateSummary() {
        if (!this._model)
            return;
        const hover = this._graph.hover;
        this._summary.text = hover >= 0 && hover < this._model.values.length
            ? this._model.hoverSummary(hover)
            : this._model.summary;
    }

    /** @returns {string[]} axis labels, for tests */
    get axisLabels() {
        return this._axis.get_children().map(c => c.text);
    }

    /** @returns {string} summary text, for tests */
    get summary() {
        return this._summary.text;
    }
});
