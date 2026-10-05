// Typed access to NetPulse's GSettings, with change notifications grouped by
// what they affect so consumers do not track individual keys.

import {EventEmitter} from '../utils/Signals.js';

// Each group is emitted as a signal when any of its keys change.
const GROUPS = {
    display: ['panel-content', 'panel-style', 'show-units', 'use-bits', 'binary-units'],
    position: ['panel-position'],
    interval: ['refresh-interval'],
    debug: ['debug-logging'],
};

const GROUP_OF_KEY = new Map(
    Object.entries(GROUPS).flatMap(([group, keys]) => keys.map(k => [k, group])));

/**
 * @typedef {object} DisplayOptions
 * @property {string} content - "both", "download", "upload" or "combined"
 * @property {string} style - "detailed", "compact" or "stacked"
 * @property {boolean} showUnits - show units next to panel values
 * @property {boolean} bits - show rates in bits per second
 * @property {boolean} binary - use 1024-based units
 */

export class SettingsManager extends EventEmitter {
    /**
     * @param {import('gi://Gio').default.Settings} settings - extension settings
     */
    constructor(settings) {
        super();
        this._settings = settings;
        this._changedId = settings.connect('changed', (_s, key) => {
            const group = GROUP_OF_KEY.get(key);
            if (group)
                this.emit(group);
        });
    }

    /** @returns {import('gi://Gio').default.Settings} underlying settings */
    get gsettings() {
        return this._settings;
    }

    /** @returns {DisplayOptions} */
    get display() {
        const s = this._settings;
        return {
            content: s.get_string('panel-content'),
            style: s.get_string('panel-style'),
            showUnits: s.get_boolean('show-units'),
            bits: s.get_boolean('use-bits'),
            binary: s.get_boolean('binary-units'),
        };
    }

    /** @returns {string} "left", "center" or "right" */
    get panelPosition() {
        return this._settings.get_string('panel-position');
    }

    /** @returns {number} sampling interval in milliseconds */
    get refreshIntervalMs() {
        return this._settings.get_double('refresh-interval') * 1000;
    }

    /** @returns {boolean} */
    get debugLogging() {
        return this._settings.get_boolean('debug-logging');
    }

    destroy() {
        this._settings.disconnect(this._changedId);
        this.disconnectAll();
    }
}
