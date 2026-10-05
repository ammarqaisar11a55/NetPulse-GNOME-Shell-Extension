import GLib from 'gi://GLib';

const decoder = new TextDecoder();

/**
 * Reads a small text file synchronously. Intended for procfs/sysfs entries,
 * which are generated in memory by the kernel and never block.
 *
 * @param {string} path - absolute path
 * @returns {string|null} file contents, or null if it cannot be read
 */
export function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? decoder.decode(bytes) : null;
    } catch {
        return null;
    }
}

/**
 * @param {string} path - absolute path of a symbolic link
 * @returns {string|null} link target, or null if it is not a readable link
 */
export function readLink(path) {
    try {
        return GLib.file_read_link(path);
    } catch {
        return null;
    }
}

/**
 * @param {string} path - absolute path
 * @returns {boolean} whether the path exists
 */
export function exists(path) {
    return GLib.file_test(path, GLib.FileTest.EXISTS);
}
