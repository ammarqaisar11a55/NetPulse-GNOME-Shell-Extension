// Accounts transferred bytes to the session, hour, day and month, and
// persists them.
//
// Data is saved at most once a minute (and only when it changed), plus on
// request when the extension stops. Along with the totals, the kernel
// counters of the last counted sample are stored. On the next start within
// the same boot, the difference to the current counters is added: this
// recovers traffic that happened while the extension was disabled (GNOME
// disables extensions while the screen is locked) or after a crash.

import GLib from 'gi://GLib';

import {EventEmitter} from '../utils/Signals.js';
import * as Logger from '../utils/Logger.js';
import {readText} from '../utils/Files.js';
import {emptyData} from './UsageStorage.js';
import {dayKey, monthKey, periodTotals, dailySeries, hourlySeries} from './UsageStatistics.js';

export const SAVE_INTERVAL_SECONDS = 60;
export const DEFAULT_RETENTION_DAYS = 365;
// Hourly detail is only needed for recent days.
const HOURLY_RETENTION_DAYS = 7;

/**
 * @returns {Promise<string>} identifier of the current boot
 */
export async function readBootId() {
    return (await readText('/proc/sys/kernel/random/boot_id'))?.trim() || 'unknown';
}

export class UsageTracker extends EventEmitter {
    /**
     * @param {object} options - options
     * @param {import('./UsageStorage.js').UsageStorage|null} options.storage -
     *   persistence; null keeps data in memory only
     * @param {string} [options.bootId] - identifier of the current boot (or
     *   pass it to load())
     * @param {string} [options.sessionId] - identifier of the login session
     *   (or pass it to load())
     * @param {number} [options.weekStart] - first day of the week (0 = Sunday)
     * @param {number} [options.retentionDays] - days of history to keep
     * @param {() => import('gi://GLib').default.DateTime} [options.clock] - time source
     */
    constructor({storage, bootId, sessionId, weekStart = 1,
        retentionDays = DEFAULT_RETENTION_DAYS, clock = () => GLib.DateTime.new_now_local()}) {
        super();
        this._storage = storage;
        this._bootId = bootId;
        this._sessionId = sessionId;
        this._weekStart = weekStart;
        this._retentionDays = retentionDays;
        this._clock = clock;
        this._data = emptyData();
        this._dirty = false;
        this._saveTimerId = 0;
        this._enabled = true;
    }

    /** @returns {boolean} whether new traffic is recorded */
    get enabled() {
        return this._enabled;
    }

    /**
     * While disabled, traffic is not recorded but the counters baseline keeps
     * moving, so re-enabling does not count the paused period.
     *
     * @param {boolean} enabled - whether to record traffic
     */
    setEnabled(enabled) {
        if (enabled === this._enabled)
            return;
        this._enabled = enabled;
        Logger.info(enabled ? 'Usage tracking resumed' : 'Usage tracking paused');
        this.emit('changed');
    }

    /** @returns {import('./UsageStorage.js').UsageData} raw data (read only) */
    get data() {
        return this._data;
    }

    /**
     * Loads persisted data; traffic is only recorded once this is done.
     *
     * @param {object} [ids] - identity of this boot and login session
     * @param {string} [ids.bootId] - identifier of the current boot
     * @param {string} [ids.sessionId] - identifier of the login session
     */
    async load({bootId, sessionId} = {}) {
        this._bootId = bootId ?? this._bootId;
        this._sessionId = sessionId ?? this._sessionId;
        this._data = (await this._storage?.load()) ?? emptyData();
        if (this._data.session?.id !== this._sessionId) {
            this._data.session = {id: this._sessionId, rx: 0, tx: 0};
            this._dirty = true;
        }
        this._prune();
        this._loaded = true;
        // The corrupt file was moved aside; write the recovered data now.
        if (this._storage?.recovered) {
            this._dirty = true;
            await this.save();
        }
        this.emit('changed');
    }

    /**
     * Adds traffic that happened while we were not running, using the
     * counters stored with the last save.
     *
     * @param {(iface: string) => Promise<{rx: number, tx: number}|null>} readCounters -
     *   reads the current kernel counters of an interface
     * @returns {Promise<{rx: number, tx: number}|null>} bytes recovered
     */
    async catchUp(readCounters) {
        const stored = this._data.counters;
        if (!this._enabled || !stored || stored.bootId !== this._bootId)
            return null;

        const now = await readCounters(stored.iface);
        if (!now || now.rx < stored.rx || now.tx < stored.tx)
            return null;

        const recovered = {rx: now.rx - stored.rx, tx: now.tx - stored.tx};
        this.add(recovered.rx, recovered.tx, {iface: stored.iface, rx: now.rx, tx: now.tx});
        if (recovered.rx + recovered.tx > 0)
            Logger.info(`Recovered ${recovered.rx + recovered.tx} bytes of traffic on ${stored.iface}`);
        return recovered;
    }

    /**
     * @param {number} rx - bytes received
     * @param {number} tx - bytes sent
     * @param {{iface: string, rx: number, tx: number}} [counters] - kernel
     *   counters after this traffic
     */
    add(rx, tx, counters) {
        if (!this._loaded)
            return;
        if (counters) {
            const previous = this._data.counters;
            this._data.counters = {bootId: this._bootId, ...counters};
            // An idle interface does not change its counters; only a switch
            // to another interface needs saving.
            if (previous?.iface !== counters.iface)
                this._dirty = true;
        }
        if (!this._enabled || (!(rx > 0) && !(tx > 0)))
            return;

        const now = this._clock();
        const key = dayKey(now);
        const day = this._data.days[key] ??= {rx: 0, tx: 0};
        day.hrx ??= new Array(24).fill(0);
        day.htx ??= new Array(24).fill(0);
        day.rx += rx;
        day.tx += tx;
        day.hrx[now.get_hour()] += rx;
        day.htx[now.get_hour()] += tx;

        const month = this._data.months[monthKey(now)] ??= {rx: 0, tx: 0};
        month.rx += rx;
        month.tx += tx;

        this._data.session.rx += rx;
        this._data.session.tx += tx;

        // Drop expired history once per day.
        if (this._lastDay !== key) {
            if (this._lastDay)
                this._prune();
            this._lastDay = key;
        }

        this._dirty = true;
        this.emit('changed');
    }

    /** @returns {{rx: number, tx: number}} bytes since the session started */
    get session() {
        const {rx, tx} = this._data.session ?? {rx: 0, tx: 0};
        return {rx, tx};
    }

    /** @returns {{today, yesterday, week, month}} totals, each {rx, tx} */
    get totals() {
        return periodTotals(this._data, this._clock(), this._weekStart);
    }

    /**
     * @param {number} count - number of days, ending today
     * @returns {{date: import('gi://GLib').default.DateTime, rx: number, tx: number}[]}
     */
    dailySeries(count) {
        return dailySeries(this._data, this._clock(), count);
    }

    /** @returns {{hour: number, rx: number, tx: number}[]} today, per hour */
    hourlySeries() {
        return hourlySeries(this._data, this._clock());
    }

    /** @returns {object} bookkeeping of announced data limit alerts */
    get alertState() {
        return this._data.alerts;
    }

    /**
     * Stores alert bookkeeping and saves at once when it changed, so an
     * alert is never repeated, even after a crash.
     *
     * @param {object} state - new bookkeeping
     */
    setAlertState(state) {
        if (JSON.stringify(state) === JSON.stringify(this._data.alerts))
            return;
        this._data.alerts = state;
        this._dirty = true;
        Logger.guard('saving usage data', () => this.save());
    }

    /** @param {number} weekStart - first day of the week (0 = Sunday) */
    setWeekStart(weekStart) {
        this._weekStart = weekStart;
    }

    /** @param {number} days - days of history to keep */
    setRetentionDays(days) {
        this._retentionDays = days;
        this._prune();
    }

    resetSession() {
        this._data.session = {id: this._sessionId, rx: 0, tx: 0};
        this._dirty = true;
        this.emit('changed');
    }

    /**
     * Applies a reset requested from the preferences, unless it was applied
     * already. Requests made while the extension was off are applied on the
     * next start.
     *
     * @param {number} requestedAt - time of the request (seconds)
     */
    applyResetRequest(requestedAt) {
        if (requestedAt > this._data.resetAt)
            this.resetAll(requestedAt);
    }

    /**
     * Forgets all history; the counters baseline is kept.
     *
     * @param {number} [requestedAt] - time of the reset request being applied
     */
    resetAll(requestedAt = this._data.resetAt) {
        const {counters} = this._data;
        this._data = emptyData();
        this._data.counters = counters;
        this._data.resetAt = requestedAt;
        this._data.session = {id: this._sessionId, rx: 0, tx: 0};
        this._dirty = true;
        Logger.guard('saving usage data', () => this.save());
        this.emit('changed');
        Logger.info('Usage statistics reset');
    }

    _prune() {
        const now = this._clock();
        const oldest = dayKey(now.add_days(-(this._retentionDays - 1)));
        const oldestHourly = dayKey(now.add_days(-(HOURLY_RETENTION_DAYS - 1)));
        // Months are kept as long as any of their days are.
        const oldestMonth = oldest.slice(0, 7);
        for (const key of Object.keys(this._data.days)) {
            if (key < oldest) {
                delete this._data.days[key];
                this._dirty = true;
            } else if (key < oldestHourly && this._data.days[key].hrx) {
                delete this._data.days[key].hrx;
                delete this._data.days[key].htx;
                this._dirty = true;
            }
        }
        for (const key of Object.keys(this._data.months)) {
            if (key < oldestMonth) {
                delete this._data.months[key];
                this._dirty = true;
            }
        }
    }

    /**
     * Writes pending changes (asynchronously).
     *
     * @returns {Promise<boolean>} whether everything is saved
     */
    async save() {
        if (!this._dirty || !this._storage)
            return true;
        // Changes made while the write is in flight mark the data dirty again.
        this._dirty = false;
        const ok = await this._storage.save(this._data, dayKey(this._clock()));
        if (!ok)
            this._dirty = true;
        return ok;
    }

    /** Writes pending changes synchronously; for when the session ends. */
    saveSync() {
        if (!this._dirty || !this._storage)
            return;
        if (this._storage.saveSync(this._data, dayKey(this._clock())))
            this._dirty = false;
    }

    startAutosave() {
        if (this._saveTimerId)
            return;
        this._saveTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, SAVE_INTERVAL_SECONDS, () => {
            Logger.guard('saving usage data', () => this.save());
            return GLib.SOURCE_CONTINUE;
        });
    }

    /**
     * Saves pending changes and stops.
     *
     * @returns {Promise<boolean>} resolves once the final save is done
     */
    destroy() {
        if (this._saveTimerId) {
            GLib.source_remove(this._saveTimerId);
            this._saveTimerId = 0;
        }
        this.disconnectAll();
        return Logger.guard('saving usage data', () => this.save(), Promise.resolve(false));
    }
}
