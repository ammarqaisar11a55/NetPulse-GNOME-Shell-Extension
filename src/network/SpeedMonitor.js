// Samples an interface's kernel byte counters and derives transfer rates:
//
//   download = (rx_bytes_now - rx_bytes_before) / elapsed
//   upload   = (tx_bytes_now - tx_bytes_before) / elapsed
//
// Each tick costs two reads of in-memory sysfs files. The timer only runs
// while there is an interface to measure.

import GLib from 'gi://GLib';

import {EventEmitter} from '../utils/Signals.js';
import {readText} from '../utils/Files.js';
import * as Logger from '../utils/Logger.js';

export const MIN_INTERVAL_MS = 500;
export const MAX_INTERVAL_MS = 10000;
const HISTORY_LENGTH = 120;

// Anything faster than this is a counter glitch, not traffic (400 Gbit/s).
const MAX_PLAUSIBLE_RATE = 50e9;

/**
 * @typedef {object} SpeedSample
 * @property {string|null} iface - interface measured
 * @property {number} download - bytes per second received
 * @property {number} upload - bytes per second sent
 * @property {number} rxDelta - bytes received since the previous sample
 * @property {number} txDelta - bytes sent since the previous sample
 * @property {{rx: number, tx: number}} [counters] - raw kernel counters
 */

/**
 * @param {string} iface - interface name
 * @param {string} [sysRoot] - sysfs network class directory
 * @returns {{rx: number, tx: number}|null} total bytes received and sent
 *   since the interface appeared, or null if unavailable
 */
export function readCounters(iface, sysRoot = '/sys/class/net') {
    const dir = `${sysRoot}/${iface}/statistics`;
    const rx = Number.parseInt(readText(`${dir}/rx_bytes`), 10);
    const tx = Number.parseInt(readText(`${dir}/tx_bytes`), 10);
    return Number.isFinite(rx) && Number.isFinite(tx) ? {rx, tx} : null;
}

/**
 * Turns successive counter readings into rates. Pure and timer-free.
 */
export class SpeedCalculator {
    constructor() {
        this.reset();
    }

    reset() {
        this._previous = null;
    }

    /**
     * @param {number} rx - current rx_bytes
     * @param {number} tx - current tx_bytes
     * @param {number} nowUs - monotonic time in microseconds
     * @returns {{download: number, upload: number, rxDelta: number,
     *            txDelta: number}|null} null for a baseline reading
     */
    update(rx, tx, nowUs) {
        const previous = this._previous;
        this._previous = {rx, tx, time: nowUs};
        if (!previous)
            return null;

        const seconds = (nowUs - previous.time) / 1e6;
        const rxDelta = rx - previous.rx;
        const txDelta = tx - previous.tx;

        // Counters went backwards (driver reset, interface recreated with the
        // same name) or time did not advance: start over from this reading.
        if (seconds <= 0 || rxDelta < 0 || txDelta < 0)
            return null;

        const download = rxDelta / seconds;
        const upload = txDelta / seconds;
        if (download > MAX_PLAUSIBLE_RATE || upload > MAX_PLAUSIBLE_RATE)
            return null;

        return {download, upload, rxDelta, txDelta};
    }
}

/**
 * @param {number} ms - requested interval
 * @returns {number} interval clamped to the supported range
 */
export function clampInterval(ms) {
    if (!Number.isFinite(ms))
        return 1000;
    return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(ms)));
}

export class SpeedMonitor extends EventEmitter {
    /**
     * @param {object} [options] - options
     * @param {number} [options.intervalMs] - sampling interval
     * @param {string} [options.sysRoot] - sysfs network class directory
     */
    constructor({intervalMs = 1000, sysRoot = '/sys/class/net'} = {}) {
        super();
        this._sysRoot = sysRoot;
        this._intervalMs = clampInterval(intervalMs);
        this._iface = null;
        this._calculator = new SpeedCalculator();
        this._timerId = 0;
        this._readFailures = 0;
        this._history = [];
        this._current = this._zeroSample();
    }

    /** @returns {SpeedSample} the most recent sample */
    get current() {
        return this._current;
    }

    /** @returns {{download: number, upload: number}[]} recent rates, oldest first */
    get history() {
        return this._history;
    }

    /** @returns {string|null} interface being measured */
    get iface() {
        return this._iface;
    }

    /** @returns {number} sampling interval in milliseconds */
    get intervalMs() {
        return this._intervalMs;
    }

    _zeroSample() {
        return {iface: this._iface, download: 0, upload: 0, rxDelta: 0, txDelta: 0};
    }

    /**
     * Switches to another interface. Counters of different interfaces are
     * unrelated, so the baseline is reset rather than producing a spike.
     *
     * @param {string|null} iface - interface to measure, or null to idle
     */
    setInterface(iface) {
        if (iface === this._iface)
            return;
        Logger.debug(`Speed monitor: ${this._iface} → ${iface}`);
        this._iface = iface;
        this._calculator.reset();
        this._readFailures = 0;
        this._publish(this._zeroSample());
        this._syncTimer();
        if (iface)
            this._sample();
    }

    /** @param {number} ms - new sampling interval */
    setIntervalMs(ms) {
        ms = clampInterval(ms);
        if (ms === this._intervalMs)
            return;
        this._intervalMs = ms;
        this._stopTimer();
        this._syncTimer();
    }

    _syncTimer() {
        if (!this._iface) {
            this._stopTimer();
            return;
        }
        if (this._timerId)
            return;

        const tick = () => {
            this._sample();
            return GLib.SOURCE_CONTINUE;
        };
        // Whole-second intervals use the seconds API, which lets GLib batch
        // our wakeups with other timers and saves power.
        this._timerId = this._intervalMs % 1000 === 0
            ? GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._intervalMs / 1000, tick)
            : GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._intervalMs, tick);
    }

    _stopTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
    }

    _sample() {
        const counters = readCounters(this._iface, this._sysRoot);
        if (!counters) {
            // The interface may be going away; detection will catch up.
            if (this._readFailures++ === 0)
                Logger.warn(`Cannot read traffic counters of ${this._iface}`);
            this._calculator.reset();
            this._publish(this._zeroSample());
            return;
        }
        if (this._readFailures > 0) {
            Logger.info(`Traffic counters of ${this._iface} readable again`);
            this._readFailures = 0;
        }

        const rates = this._calculator.update(counters.rx, counters.tx, GLib.get_monotonic_time());
        if (rates)
            this._publish({iface: this._iface, ...rates, counters});
    }

    _publish(sample) {
        this._current = sample;
        this._history.push({download: sample.download, upload: sample.upload});
        if (this._history.length > HISTORY_LENGTH)
            this._history.shift();
        this.emit('sample', sample);
    }

    destroy() {
        this._stopTimer();
        this.disconnectAll();
    }
}
