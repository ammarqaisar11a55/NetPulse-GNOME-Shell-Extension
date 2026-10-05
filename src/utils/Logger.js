// Small wrapper around the GJS console so every message carries the
// extension prefix and debug output can be switched on at runtime.

const PREFIX = '[NetPulse]';

let debugEnabled = false;
const activeWarnings = new Set();

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

/**
 * Warns about an ongoing problem once, instead of on every retry.
 *
 * @param {string} key - identifies the problem
 * @param {...any} args - message parts
 */
export function warnOnce(key, ...args) {
    if (activeWarnings.has(key))
        return;
    activeWarnings.add(key);
    warn(...args);
}

/**
 * Marks a problem reported with warnOnce() as solved, logging the recovery.
 *
 * @param {string} key - identifies the problem
 * @param {...any} args - recovery message parts
 */
export function resolved(key, ...args) {
    if (activeWarnings.delete(key) && args.length > 0)
        info(...args);
}

/**
 * Runs a callback, logging instead of propagating exceptions; for async
 * callbacks, rejections are logged too. Used for timer callbacks: GJS
 * removes a source whose callback throws, which would silently stop
 * monitoring for the rest of the session.
 *
 * @param {string} context - what the callback does, for the log
 * @param {Function} callback - callback to run
 * @param {any} [fallback] - value returned when the callback throws
 * @returns {any} the callback's result, or the fallback
 */
export function guard(context, callback, fallback) {
    const report = e => warnOnce(`exception:${context}`, `Unexpected error while ${context}:`, e);
    try {
        const result = callback();
        if (typeof result?.catch === 'function')
            result.catch(report);
        return result;
    } catch (e) {
        report(e);
        return fallback;
    }
}
