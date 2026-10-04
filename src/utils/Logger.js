// Small wrapper around the GJS console so every message carries the
// extension prefix and debug output can be switched on at runtime.

const PREFIX = '[NetPulse]';

let debugEnabled = false;

/**
 * @param {boolean} enabled - whether debug messages should be emitted
 */
export function setDebug(enabled) {
    debugEnabled = Boolean(enabled);
}

/** @param {...any} args - message parts */
export function debug(...args) {
    if (debugEnabled)
        console.log(PREFIX, ...args);
}

/** @param {...any} args - message parts */
export function info(...args) {
    console.log(PREFIX, ...args);
}

/** @param {...any} args - message parts */
export function warn(...args) {
    console.warn(PREFIX, ...args);
}

/** @param {...any} args - message parts */
export function error(...args) {
    console.error(PREFIX, ...args);
}
