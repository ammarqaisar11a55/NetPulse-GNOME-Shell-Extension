// Human-readable formatting of byte counts and transfer rates.
//
// Values below 10 get two decimals, below 100 one, and larger values none,
// so a figure is always at most four significant characters ("4.82",
// "12.4", "512") and the panel width stays stable.

const DECIMAL_BYTES = ['B', 'KB', 'MB', 'GB', 'TB'];
const BINARY_BYTES = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
const BITS = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
const SHORT = ['B', 'K', 'M', 'G', 'T'];

/**
 * @typedef {object} UnitOptions
 * @property {boolean} [bits] - express rates in bits (always decimal)
 * @property {boolean} [binary] - use 1024-based units (KiB, MiB, ...)
 */

/**
 * @param {number} value - value in the chosen unit
 * @returns {number} decimals to show
 */
function decimalsFor(value) {
    if (value < 10)
        return 2;
    if (value < 100)
        return 1;
    return 0;
}

/**
 * Scales a raw amount to the largest unit keeping the value >= 1.
 *
 * @param {number} amount - raw amount (bytes or bits)
 * @param {number} base - 1000 or 1024
 * @param {number} maxIndex - index of the largest unit available
 * @returns {{text: string, index: number}} formatted number and unit index
 */
export function scale(amount, base, maxIndex) {
    if (!Number.isFinite(amount) || amount < 0)
        amount = 0;

    let index = 0;
    let value = amount;
    while (value >= base && index < maxIndex) {
        value /= base;
        index++;
    }

    if (index === 0)
        return {text: String(Math.round(value)), index};

    let text = value.toFixed(decimalsFor(value));
    // Rounding may carry into the next magnitude: 999.7 → "1000", 9.996 → "10.00".
    if (Number(text) >= base && index < maxIndex) {
        value = Number(text) / base;
        index++;
        text = value.toFixed(decimalsFor(value));
    } else if (decimalsFor(Number(text)) !== decimalsFor(value)) {
        text = Number(text).toFixed(decimalsFor(Number(text)));
    }
    return {text, index};
}

/**
 * @param {number} bytesPerSecond - transfer rate
 * @param {UnitOptions} [options] - unit options
 * @returns {{value: string, unit: string, short: string}} parts; `short` is
 *   a one-letter magnitude suffix ("K", "M") for compact layouts
 */
export function speedParts(bytesPerSecond, {bits = false, binary = false} = {}) {
    if (bits) {
        const {text, index} = scale(bytesPerSecond * 8, 1000, BITS.length - 1);
        return {value: text, unit: BITS[index], short: index === 0 ? 'b' : SHORT[index]};
    }
    const units = binary ? BINARY_BYTES : DECIMAL_BYTES;
    const {text, index} = scale(bytesPerSecond, binary ? 1024 : 1000, units.length - 1);
    return {value: text, unit: `${units[index]}/s`, short: SHORT[index]};
}

/**
 * @param {number} bytesPerSecond - transfer rate
 * @param {UnitOptions} [options] - unit options
 * @returns {string} e.g. "4.82 MB/s"
 */
export function formatSpeed(bytesPerSecond, options) {
    const {value, unit} = speedParts(bytesPerSecond, options);
    return `${value} ${unit}`;
}

/**
 * @param {number} bytes - amount of data
 * @param {UnitOptions} [options] - unit options (`bits` is ignored)
 * @returns {{value: string, unit: string}} parts
 */
export function bytesParts(bytes, {binary = false} = {}) {
    const units = binary ? BINARY_BYTES : DECIMAL_BYTES;
    const {text, index} = scale(bytes, binary ? 1024 : 1000, units.length - 1);
    return {value: text, unit: units[index]};
}

/**
 * @param {number} bytes - amount of data
 * @param {UnitOptions} [options] - unit options (`bits` is ignored)
 * @returns {string} e.g. "2.43 GB"
 */
export function formatBytes(bytes, options) {
    const {value, unit} = bytesParts(bytes, options);
    return `${value} ${unit}`;
}
