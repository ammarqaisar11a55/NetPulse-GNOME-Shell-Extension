// Persists usage data as JSON in the user's data directory.
//
// Writes go to a temporary file that is renamed over the old one, so a
// crash or power loss leaves either the previous or the new file, never a
// truncated one. Once per day a backup copy is kept as well; it is used if
// the main file is ever unreadable.

import GLib from 'gi://GLib';

import * as Logger from '../utils/Logger.js';
import {readText} from '../utils/Files.js';

export const DATA_VERSION = 1;

/**
 * @typedef {object} DayUsage
 * @property {number} rx - bytes received
 * @property {number} tx - bytes sent
 * @property {number[]} [hrx] - bytes received per hour (24 entries)
 * @property {number[]} [htx] - bytes sent per hour (24 entries)
 */

/**
 * @typedef {object} UsageData
 * @property {number} version - format version
 * @property {Object<string, DayUsage>} days - keyed by "YYYY-MM-DD"
 * @property {Object<string, {rx: number, tx: number}>} months - keyed by "YYYY-MM"
 * @property {{id: string, rx: number, tx: number}|null} session - current login session
 * @property {{bootId: string, iface: string, rx: number, tx: number}|null} counters -
 *   kernel counters as of the last counted sample, for catching up
 * @property {object} alerts - notification bookkeeping
 * @property {number} resetAt - time of the last applied reset request (seconds)
 */

/** @returns {UsageData} */
export function emptyData() {
    return {version: DATA_VERSION, days: {}, months: {}, session: null, counters: null, alerts: {}, resetAt: 0};
}

const isBytes = n => Number.isFinite(n) && n >= 0;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY = /^\d{4}-\d{2}$/;

/**
 * Validates parsed JSON and drops anything malformed, so a partly damaged
 * file still yields its intact entries.
 *
 * @param {any} raw - parsed JSON
 * @returns {UsageData}
 * @throws {Error} if the input is not usage data at all
 */
export function sanitize(raw) {
    if (typeof raw !== 'object' || raw === null || typeof raw.days !== 'object' || raw.days === null)
        throw new Error('not a usage data object');
    if (raw.version > DATA_VERSION)
        throw new Error(`unsupported data version ${raw.version}`);

    const data = emptyData();
    for (const [key, day] of Object.entries(raw.days)) {
        if (!DAY_KEY.test(key) || !isBytes(day?.rx) || !isBytes(day?.tx))
            continue;
        const clean = {rx: day.rx, tx: day.tx};
        if (Array.isArray(day.hrx) && Array.isArray(day.htx) &&
            day.hrx.length === 24 && day.htx.length === 24 &&
            day.hrx.every(isBytes) && day.htx.every(isBytes)) {
            clean.hrx = [...day.hrx];
            clean.htx = [...day.htx];
        }
        data.days[key] = clean;
    }
    for (const [key, month] of Object.entries(raw.months ?? {})) {
        if (MONTH_KEY.test(key) && isBytes(month?.rx) && isBytes(month?.tx))
            data.months[key] = {rx: month.rx, tx: month.tx};
    }

    const s = raw.session;
    if (typeof s?.id === 'string' && isBytes(s.rx) && isBytes(s.tx))
        data.session = {id: s.id, rx: s.rx, tx: s.tx};

    const c = raw.counters;
    if (typeof c?.bootId === 'string' && typeof c.iface === 'string' && isBytes(c.rx) && isBytes(c.tx))
        data.counters = {bootId: c.bootId, iface: c.iface, rx: c.rx, tx: c.tx};

    if (typeof raw.alerts === 'object' && raw.alerts !== null && !Array.isArray(raw.alerts))
        data.alerts = {...raw.alerts};
    if (isBytes(raw.resetAt))
        data.resetAt = raw.resetAt;
    return data;
}

/** @returns {string} default location of the usage file */
export function defaultPath() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'netpulse', 'usage.json']);
}

export class UsageStorage {
    /**
     * @param {string} [path] - usage file location
     */
    constructor(path = defaultPath()) {
        this._path = path;
        this._backupPath = `${path}.bak`;
        this._lastBackupDay = null;
        this._recovered = false;
    }

    /**
     * @returns {boolean} whether the last load() had to recover from a corrupt
     *   file; the recovered data should then be written back promptly
     */
    get recovered() {
        return this._recovered;
    }

    /** @returns {string} usage file location */
    get path() {
        return this._path;
    }

    /**
     * @param {string} path - file to parse
     * @returns {UsageData|null} data, or null if the file does not exist
     * @throws {Error} if the file exists but is corrupt
     */
    _read(path) {
        const text = readText(path);
        if (text === null)
            return null;
        return sanitize(JSON.parse(text));
    }

    /**
     * Loads usage data, recovering from the backup if the main file is
     * corrupt. Never throws.
     *
     * @returns {UsageData}
     */
    load() {
        this._recovered = false;
        try {
            const data = this._read(this._path);
            if (data) {
                Logger.info('Usage data loaded');
                return data;
            }
            Logger.info('No usage data yet, starting fresh');
            return emptyData();
        } catch (e) {
            Logger.warn(`Usage data is corrupt (${e.message}); setting it aside`);
            this._quarantine();
            this._recovered = true;
        }

        try {
            const backup = this._read(this._backupPath);
            if (backup) {
                Logger.info('Usage data restored from backup');
                return backup;
            }
        } catch (e) {
            Logger.warn(`Usage backup is corrupt too (${e.message})`);
        }
        return emptyData();
    }

    // Keep the damaged file for inspection instead of overwriting it.
    _quarantine() {
        const stamp = GLib.DateTime.new_now_local().format('%Y%m%d-%H%M%S');
        GLib.rename(this._path, `${this._path}.corrupt-${stamp}`);
    }

    /**
     * @param {UsageData} data - data to persist
     * @param {string} today - current "YYYY-MM-DD", to rotate the backup daily
     * @returns {boolean} whether the data was written
     */
    save(data, today) {
        const json = JSON.stringify(data);
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(this._path), 0o700);
            if (this._lastBackupDay !== today) {
                this._write(this._backupPath, json);
                this._lastBackupDay = today;
            }
            this._write(this._path, json);
            return true;
        } catch (e) {
            Logger.warn(`Cannot save usage data to ${this._path}: ${e.message}`);
            return false;
        }
    }

    _write(path, text) {
        GLib.file_set_contents_full(path, new TextEncoder().encode(text),
            GLib.FileSetContentsFlags.CONSISTENT, 0o600);
    }
}
