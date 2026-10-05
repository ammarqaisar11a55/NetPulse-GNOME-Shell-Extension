// Decides what the panel indicator shows. Kept free of Shell imports so it
// can be unit tested.

import {speedParts} from '../utils/Formatters.js';

export const ARROWS = Object.freeze({download: '↓', upload: '↑', total: '⇅'});

/**
 * @typedef {object} PanelSegment
 * @property {string} kind - "download", "upload" or "total"
 * @property {string} arrow - arrow glyph
 * @property {string} value - formatted number
 * @property {string} unit - unit text, empty when units are hidden
 */

/**
 * @param {{download: number, upload: number}} sample - current rates
 * @param {import('../settings/SettingsManager.js').DisplayOptions} options - display options
 * @returns {PanelSegment[]}
 */
export function panelSegments(sample, options) {
    let kinds;
    switch (options.content) {
    case 'download': kinds = ['download']; break;
    case 'upload': kinds = ['upload']; break;
    case 'combined': kinds = ['total']; break;
    default: kinds = ['download', 'upload'];
    }

    const unitOptions = {bits: options.bits, binary: options.binary};
    return kinds.map(kind => {
        const rate = kind === 'total' ? sample.download + sample.upload : sample[kind];
        const parts = speedParts(rate, unitOptions);
        let unit = '';
        if (options.showUnits)
            unit = options.style === 'compact' ? parts.short : parts.unit;
        return {kind, arrow: ARROWS[kind], value: parts.value, unit};
    });
}

/**
 * @param {PanelSegment[]} segments - segments
 * @returns {string} plain-text rendering, used for accessibility and tests
 */
export function segmentsToText(segments) {
    return segments.map(s => `${s.arrow} ${s.value}${s.unit ? ` ${s.unit}` : ''}`).join('  ');
}
