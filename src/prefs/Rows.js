// Preference rows bound to GSettings keys.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

/**
 * @param {Gio.Settings} settings - extension settings
 * @param {string} key - boolean key
 * @param {string} title - row title
 * @param {string} [subtitle] - row subtitle
 * @returns {Adw.SwitchRow}
 */
export function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

/**
 * @param {Gio.Settings} settings - extension settings
 * @param {string} key - numeric key
 * @param {string} title - row title
 * @param {string} subtitle - row subtitle
 * @param {object} range - spin button range
 * @param {number} range.lower - minimum
 * @param {number} range.upper - maximum
 * @param {number} range.step - increment
 * @param {number} [range.digits] - decimals shown
 * @returns {Adw.SpinRow}
 */
export function spinRow(settings, key, title, subtitle, {lower, upper, step, digits = 0}) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        digits,
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 10}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

/**
 * A combo row for an enum key.
 *
 * @param {Gio.Settings} settings - extension settings
 * @param {string} key - enum key
 * @param {string} title - row title
 * @param {string} subtitle - row subtitle
 * @param {[string, string][]} choices - [nick, label] pairs
 * @returns {Adw.ComboRow}
 */
export function comboRow(settings, key, title, subtitle, choices) {
    const row = new Adw.ComboRow({
        title,
        subtitle,
        model: Gtk.StringList.new(choices.map(([, text]) => text)),
    });
    const sync = () => {
        const index = choices.findIndex(([nick]) => nick === settings.get_string(key));
        if (index >= 0 && row.selected !== index)
            row.selected = index;
    };
    sync();
    const id = settings.connect(`changed::${key}`, sync);
    row.connect('notify::selected', () => {
        const nick = choices[row.selected]?.[0];
        if (nick && nick !== settings.get_string(key))
            settings.set_string(key, nick);
    });
    row.connect('destroy', () => settings.disconnect(id));
    return row;
}

/**
 * @param {string} title - group title
 * @param {Gtk.Widget[]} rows - rows to add
 * @param {string} [description] - group description
 * @returns {Adw.PreferencesGroup}
 */
export function group(title, rows, description = '') {
    const g = new Adw.PreferencesGroup({title, description});
    rows.forEach(row => g.add(row));
    return g;
}
