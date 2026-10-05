import {test, assertEqual} from '../harness.js';
import {panelSegments, segmentsToText} from '../../src/ui/PanelText.js';

const DEFAULTS = {content: 'both', style: 'detailed', showUnits: true, bits: false, binary: false};
const SAMPLE = {download: 4_820_000, upload: 1_210_000};
const text = (sample, options) => segmentsToText(panelSegments(sample, {...DEFAULTS, ...options}));

test('panel shows download and upload by default', () => {
    assertEqual(text(SAMPLE), '↓ 4.82 MB/s  ↑ 1.21 MB/s');
});

test('panel shows zero traffic plainly', () => {
    assertEqual(text({download: 0, upload: 0}), '↓ 0 B/s  ↑ 0 B/s');
});

test('panel content modes', () => {
    assertEqual(text(SAMPLE, {content: 'download'}), '↓ 4.82 MB/s');
    assertEqual(text(SAMPLE, {content: 'upload'}), '↑ 1.21 MB/s');
    assertEqual(text(SAMPLE, {content: 'combined'}), '⇅ 6.03 MB/s');
});

test('compact style uses one-letter units', () => {
    const segments = panelSegments({download: 4_820_000, upload: 1_210}, {...DEFAULTS, style: 'compact'});
    assertEqual(segments.map(s => s.value + s.unit), ['4.82M', '1.21K']);
});

test('units can be hidden or shown in bits', () => {
    assertEqual(text(SAMPLE, {showUnits: false}), '↓ 4.82  ↑ 1.21');
    assertEqual(text(SAMPLE, {bits: true}), '↓ 38.6 Mbps  ↑ 9.68 Mbps');
});
