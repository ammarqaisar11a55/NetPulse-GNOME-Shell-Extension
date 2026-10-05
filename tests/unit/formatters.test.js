import {test, assertEqual} from '../harness.js';
import {formatSpeed, formatBytes, speedParts} from '../../src/utils/Formatters.js';

test('formatSpeed matches the documented examples', () => {
    assertEqual(formatSpeed(512), '512 B/s');
    assertEqual(formatSpeed(12_400), '12.4 KB/s');
    assertEqual(formatSpeed(4_820_000), '4.82 MB/s');
    assertEqual(formatSpeed(1_210_000_000), '1.21 GB/s');
});

test('formatSpeed handles zero and invalid input', () => {
    assertEqual(formatSpeed(0), '0 B/s');
    assertEqual(formatSpeed(-5), '0 B/s');
    assertEqual(formatSpeed(NaN), '0 B/s');
    assertEqual(formatSpeed(0.4), '0 B/s');
});

test('formatSpeed never shows four integer digits', () => {
    assertEqual(formatSpeed(999), '999 B/s');
    assertEqual(formatSpeed(1000), '1.00 KB/s');
    assertEqual(formatSpeed(999_700), '1.00 MB/s');
    assertEqual(formatSpeed(9_996), '10.0 KB/s');
    assertEqual(formatSpeed(99_960), '100 KB/s');
});

test('formatSpeed supports bits and binary units', () => {
    assertEqual(formatSpeed(1_250_000, {bits: true}), '10.0 Mbps');
    assertEqual(formatSpeed(100, {bits: true}), '800 bps');
    assertEqual(formatSpeed(1024, {binary: true}), '1.00 KiB/s');
    assertEqual(formatSpeed(5 * 1024 * 1024, {binary: true}), '5.00 MiB/s');
});

test('speedParts exposes compact suffixes', () => {
    assertEqual(speedParts(4_820_000), {value: '4.82', unit: 'MB/s', short: 'M'});
    assertEqual(speedParts(0), {value: '0', unit: 'B/s', short: 'B'});
});

test('formatBytes formats usage totals', () => {
    assertEqual(formatBytes(0), '0 B');
    assertEqual(formatBytes(386_000_000), '386 MB');
    assertEqual(formatBytes(2_430_000_000), '2.43 GB');
    assertEqual(formatBytes(5e15), '5000 TB');
    assertEqual(formatBytes(1536, {binary: true}), '1.50 KiB');
});
