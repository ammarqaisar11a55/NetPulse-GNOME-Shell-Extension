// A small Cairo chart: stacked bars (usage per hour/day) or an area chart
// (live speed). Colors come from the stylesheet, which maps them to the
// theme's accent and foreground colors.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

export const ChartMode = Object.freeze({BARS: 'bars', AREA: 'area'});

/**
 * @param {import('cairo').Context} cr - cairo context
 * @param {{red: number, green: number, blue: number, alpha: number}} color - theme color
 * @param {number} [alpha] - extra opacity factor
 */
function setColor(cr, color, alpha = 1) {
    cr.setSourceRGBA(color.red / 255, color.green / 255, color.blue / 255,
        (color.alpha / 255) * alpha);
}

export const HistoryGraph = GObject.registerClass({
    Signals: {'hover-changed': {param_types: [GObject.TYPE_INT]}},
}, class HistoryGraph extends St.DrawingArea {
    constructor() {
        super({style_class: 'netpulse-chart', reactive: true, x_expand: true});
        this._values = [];
        this._mode = ChartMode.BARS;
        this._max = 0;
        this._hover = -1;
    }

    /**
     * @param {{a: number, b: number}[]} values - per slot: `a` is drawn at the
     *   bottom (download), `b` stacked on top (upload)
     * @param {string} mode - one of ChartMode
     */
    setData(values, mode) {
        this._values = values;
        this._mode = mode;
        this._max = Math.max(0, ...values.map(v => mode === ChartMode.AREA
            ? Math.max(v.a, v.b) : v.a + v.b));
        this.queue_repaint();
    }

    /** @returns {number} largest value on the vertical scale */
    get max() {
        return this._max;
    }

    /** @returns {number} hovered slot, or -1 */
    get hover() {
        return this._hover;
    }

    _setHover(index) {
        if (index === this._hover)
            return;
        this._hover = index;
        this.queue_repaint();
        this.emit('hover-changed', index);
    }

    vfunc_motion_event(event) {
        const [x, y] = event.get_coords();
        const [ok, localX] = this.transform_stage_point(x, y);
        const n = this._values.length;
        if (!ok || n === 0 || this.width <= 0)
            return Clutter.EVENT_PROPAGATE;
        // Bars occupy slots; area chart points sit on the slot boundaries.
        const index = this._mode === ChartMode.AREA && n > 1
            ? Math.round(localX / (this.width / (n - 1)))
            : Math.floor(localX / (this.width / n));
        this._setHover(Math.min(n - 1, Math.max(0, index)));
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_leave_event(event) {
        this._setHover(-1);
        return super.vfunc_leave_event(event);
    }

    vfunc_repaint() {
        const cr = this.get_context();
        try {
            this._draw(cr);
        } finally {
            cr.$dispose();
        }
    }

    _draw(cr) {
        const [width, height] = this.get_surface_size();
        const node = this.get_theme_node();
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const fg = node.get_foreground_color();
        const [, down] = node.lookup_color('-netpulse-download-color', false);
        const [, up] = node.lookup_color('-netpulse-upload-color', false);

        // Baseline.
        setColor(cr, fg, 0.25);
        cr.rectangle(0, height - scale, width, scale);
        cr.fill();

        const n = this._values.length;
        if (n === 0 || this._max <= 0)
            return;

        const top = 2 * scale;
        const usable = height - scale - top;
        const y = v => height - scale - (v / this._max) * usable;

        if (this._mode === ChartMode.AREA)
            this._drawArea(cr, width, y, down, up, scale);
        else
            this._drawBars(cr, width, usable, height, down, up, scale);
    }

    _drawBars(cr, width, usable, height, down, up, scale) {
        const n = this._values.length;
        const slot = width / n;
        const gap = Math.max(scale, Math.round(slot * 0.25));
        const barWidth = Math.max(scale, slot - gap);
        const bottom = height - scale;

        this._values.forEach((v, i) => {
            if (v.a + v.b <= 0)
                return;
            const x = i * slot + (slot - barWidth) / 2;
            // Keep tiny but non-zero usage visible.
            const total = Math.max(scale, ((v.a + v.b) / this._max) * usable);
            const hA = total * (v.a / (v.a + v.b));
            const emphasis = this._hover === -1 || this._hover === i ? 1 : 0.55;

            setColor(cr, down, emphasis);
            cr.rectangle(x, bottom - hA, barWidth, hA);
            cr.fill();
            setColor(cr, up, emphasis);
            cr.rectangle(x, bottom - total, barWidth, total - hA);
            cr.fill();
        });
    }

    _drawArea(cr, width, y, down, up, scale) {
        const n = this._values.length;
        const step = n > 1 ? width / (n - 1) : width;
        const trace = key => {
            this._values.forEach((v, i) => {
                const px = i * step;
                if (i === 0)
                    cr.moveTo(px, y(v[key]));
                else
                    cr.lineTo(px, y(v[key]));
            });
        };
        const baseline = y(0);

        // Download: filled area with a solid edge.
        trace('a');
        cr.lineTo((n - 1) * step, baseline);
        cr.lineTo(0, baseline);
        cr.closePath();
        setColor(cr, down, 0.3);
        cr.fill();
        trace('a');
        setColor(cr, down);
        cr.setLineWidth(1.5 * scale);
        cr.stroke();

        // Upload: line only.
        trace('b');
        setColor(cr, up);
        cr.setLineWidth(1.5 * scale);
        cr.stroke();

        if (this._hover >= 0) {
            setColor(cr, down, 0.6);
            cr.rectangle(this._hover * step - scale / 2, 0, scale, baseline);
            cr.fill();
        }
    }
});
