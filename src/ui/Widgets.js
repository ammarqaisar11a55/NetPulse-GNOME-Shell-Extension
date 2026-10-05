// Small building blocks for the popup dashboard.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

// Secondary text is dimmed with opacity rather than a fixed color so it
// works on light and dark popups alike.
export const DIM_OPACITY = 178;

/**
 * @param {string} styleClass - CSS class
 * @param {object} [props] - extra St.Label properties
 * @returns {St.Label}
 */
export function label(styleClass, props = {}) {
    return new St.Label({style_class: styleClass, y_align: Clutter.ActorAlign.CENTER, ...props});
}

/**
 * @param {string} text - section heading
 * @returns {St.Label}
 */
export function sectionTitle(text) {
    return label('netpulse-section-title', {text, opacity: DIM_OPACITY});
}

/** A "Title ........ value" row. */
export const StatRow = GObject.registerClass(
class StatRow extends St.BoxLayout {
    /**
     * @param {string} title - row title
     */
    constructor(title) {
        super({style_class: 'netpulse-stat-row', x_expand: true});
        this._title = label('netpulse-stat-title', {text: title, x_expand: true, opacity: DIM_OPACITY});
        this._value = label('netpulse-stat-value', {x_align: Clutter.ActorAlign.END});
        this.add_child(this._title);
        this.add_child(this._value);
    }

    /** @param {string} text - value to show */
    set value(text) {
        if (this._value.text !== text)
            this._value.text = text;
    }

    /** @returns {string} the shown value */
    get value() {
        return this._value.text;
    }
});

/**
 * A vertical group of widgets with a heading.
 *
 * @param {string} title - heading text
 * @param {St.Widget[]} children - content
 * @returns {St.BoxLayout}
 */
export function section(title, children) {
    const box = new St.BoxLayout({
        style_class: 'netpulse-section',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    if (title)
        box.add_child(sectionTitle(title));
    for (const child of children)
        box.add_child(child);
    return box;
}
