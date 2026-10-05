// Tiny dependency-free test harness for running unit tests under plain gjs.

import GLib from 'gi://GLib';

const tests = [];

/**
 * @param {string} name - test name
 * @param {Function} fn - test body; may be async
 */
export function test(name, fn) {
    tests.push({name, fn});
}

export class AssertionError extends Error {}

/**
 * @param {boolean} condition - must be truthy
 * @param {string} [message] - failure message
 */
export function assert(condition, message = 'assertion failed') {
    if (!condition)
        throw new AssertionError(message);
}

/**
 * @param {any} actual - value under test
 * @param {any} expected - expected value (compared structurally)
 * @param {string} [message] - context for failures
 */
export function assertEqual(actual, expected, message = '') {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new AssertionError(`${message ? `${message}: ` : ''}expected ${e}, got ${a}`);
}

/**
 * @param {Function} fn - function expected to throw
 * @param {string} [message] - failure message
 */
export function assertThrows(fn, message = 'expected an exception') {
    try {
        fn();
    } catch {
        return;
    }
    throw new AssertionError(message);
}

/**
 * Creates a scratch directory removed by cleanupTempDirs().
 *
 * @returns {string} path
 */
export function makeTempDir() {
    const dir = GLib.dir_make_tmp('netpulse-test-XXXXXX');
    tempDirs.push(dir);
    return dir;
}
const tempDirs = [];

/**
 * @param {string} path - file to create, including missing parents
 * @param {string} contents - file contents
 */
export function writeFile(path, contents) {
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
    GLib.file_set_contents(path, contents);
}

function cleanupTempDirs() {
    for (const dir of tempDirs)
        GLib.spawn_command_line_sync(`rm -rf ${GLib.shell_quote(dir)}`);
}

/**
 * @param {number} ms - milliseconds to wait while the main loop runs
 * @returns {Promise<void>}
 */
export function sleep(ms) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

/**
 * Runs all registered tests and exits with a status code.
 *
 * @param {string} [filter] - only run tests whose name contains this
 */
export async function run(filter) {
    let failed = 0;
    let passed = 0;
    for (const {name, fn} of tests) {
        if (filter && !name.includes(filter))
            continue;
        try {
            // eslint-disable-next-line no-await-in-loop
            await fn();
            passed++;
            print(`  ok    ${name}`);
        } catch (e) {
            failed++;
            print(`  FAIL  ${name}\n        ${e.message}`);
            if (!(e instanceof AssertionError))
                print(e.stack.split('\n').map(l => `        ${l}`).join('\n'));
        }
    }
    cleanupTempDirs();
    print(`\n${passed} passed, ${failed} failed`);
    return failed === 0;
}
