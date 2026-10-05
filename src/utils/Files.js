import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const decoder = new TextDecoder();

/**
 * Reads a small text file asynchronously, so a slow disk can never stall
 * GNOME Shell.
 *
 * @param {string} path - absolute path
 * @returns {Promise<string|null>} file contents, or null if it cannot be read
 */
export function readText(path) {
    return new Promise(resolve => {
        Gio.File.new_for_path(path).load_contents_async(null, (file, result) => {
            try {
                const [, bytes] = file.load_contents_finish(result);
                resolve(decoder.decode(bytes));
            } catch {
                resolve(null);
            }
        });
    });
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
