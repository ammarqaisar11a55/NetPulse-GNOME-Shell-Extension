// Usage table for the popup: one row per period, with download, upload and
// total columns.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {label, DIM_OPACITY} from './Widgets.js';
import {ARROWS} from './PanelText.js';
import {formatBytes} from '../utils/Formatters.js';

export const PERIODS = ['session', 'today', 'yesterday', 'week', 'month'];

export const UsageDisplay = GObject.registerClass(
class UsageDisplay extends St.Widget {
    constructor() {
        super({
            style_class: 'netpulse-usage-table',
            layout_manager: new Clutter.GridLayout(),
            x_expand: true,
        });
        const grid = this.layout_manager;

        const headers = ['', `${ARROWS.download} ${_('Down')}`, `${ARROWS.upload} ${_('Up')}`, _('Total')];
        headers.forEach((text, col) => {
            grid.attach(label(`netpulse-usage-header ${col ? 'netpulse-usage-number' : ''}`, {
                text,
                opacity: DIM_OPACITY,
                x_expand: col === 0,
                x_align: col ? Clutter.ActorAlign.END : Clutter.ActorAlign.START,
            }), col, 0, 1, 1);
        });

        const titles = {
            session: _('Session'),
            today: _('Today'),
            yesterday: _('Yesterday'),
            week: _('This Week'),
            month: _('This Month'),
        };
        this._cells = {};
        PERIODS.forEach((period, i) => {
            const row = i + 1;
            grid.attach(label('netpulse-usage-period', {text: titles[period], x_expand: true}), 0, row, 1, 1);
            this._cells[period] = ['rx', 'tx', 'total'].map((_key, j) => {
                const cell = label(`netpulse-usage-number ${j === 2 ? 'netpulse-usage-total' : ''}`, {
                    x_align: Clutter.ActorAlign.END,
                });
                grid.attach(cell, j + 1, row, 1, 1);
                return cell;
            });
        });
    }

    /**
     * @param {Object<string, {rx: number, tx: number}>} totals - per period
     * @param {{binary: boolean}} options - unit options
     */
    update(totals, options) {
        for (const period of PERIODS) {
            const {rx, tx} = totals[period];
            const texts = [rx, tx, rx + tx].map(n => formatBytes(n, options));
            this._cells[period].forEach((cell, i) => {
                if (cell.text !== texts[i])
                    cell.text = texts[i];
            });
        }
    }

    /**
     * @param {string} period - one of PERIODS
     * @returns {string[]} shown download, upload and total, for tests
     */
    row(period) {
        return this._cells[period].map(c => c.text);
    }
});
