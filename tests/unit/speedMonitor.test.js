import {test, assert, assertEqual, makeTempDir, writeFile, sleep} from '../harness.js';
import {SpeedCalculator, SpeedMonitor, clampInterval} from '../../src/network/SpeedMonitor.js';

const SEC = 1e6;

test('SpeedCalculator needs a baseline reading', () => {
    const calc = new SpeedCalculator();
    assertEqual(calc.update(1000, 500, 0), null);
    assertEqual(calc.update(3000, 1500, SEC),
        {download: 2000, upload: 1000, rxDelta: 2000, txDelta: 1000});
});

test('SpeedCalculator divides by real elapsed time', () => {
    const calc = new SpeedCalculator();
    calc.update(0, 0, 0);
    assertEqual(calc.update(5000, 0, 2.5 * SEC).download, 2000);
});

test('SpeedCalculator reports zero traffic as zero', () => {
    const calc = new SpeedCalculator();
    calc.update(42, 42, 0);
    assertEqual(calc.update(42, 42, SEC), {download: 0, upload: 0, rxDelta: 0, txDelta: 0});
});

test('SpeedCalculator ignores counter resets instead of going negative', () => {
    const calc = new SpeedCalculator();
    calc.update(10_000_000, 5_000, 0);
    assertEqual(calc.update(100, 50, SEC), null);
    // The reset reading becomes the new baseline.
    assertEqual(calc.update(1100, 50, 2 * SEC).download, 1000);
});

test('SpeedCalculator rejects implausible jumps and stalled clocks', () => {
    const calc = new SpeedCalculator();
    calc.update(0, 0, 0);
    assertEqual(calc.update(1e12, 0, SEC), null);
    assertEqual(calc.update(1e12 + 10, 0, SEC), null);
});

test('clampInterval keeps the interval in range', () => {
    assertEqual(clampInterval(1000), 1000);
    assertEqual(clampInterval(10), 500);
    assertEqual(clampInterval(1e9), 10000);
    assertEqual(clampInterval(NaN), 1000);
});

/**
 * @param {string} sysRoot - fake sysfs root
 * @param {string} iface - interface name
 * @param {number} rx - rx_bytes
 * @param {number} tx - tx_bytes
 */
function setCounters(sysRoot, iface, rx, tx) {
    writeFile(`${sysRoot}/${iface}/statistics/rx_bytes`, `${rx}\n`);
    writeFile(`${sysRoot}/${iface}/statistics/tx_bytes`, `${tx}\n`);
}

test('SpeedMonitor samples counters and survives interface switches', async () => {
    const sysRoot = makeTempDir();
    setCounters(sysRoot, 'wlp2s0', 1_000_000, 1_000_000);
    // A second interface with much larger counters: switching must not
    // produce a huge spike.
    setCounters(sysRoot, 'enp3s0', 9_000_000_000, 9_000_000_000);

    const monitor = new SpeedMonitor({intervalMs: 500, sysRoot});
    const samples = [];
    monitor.connect('sample', s => samples.push(s));

    monitor.setInterface('wlp2s0');
    setCounters(sysRoot, 'wlp2s0', 1_500_000, 1_100_000);
    await sleep(650);

    const wifi = samples.filter(s => s.iface === 'wlp2s0' && s.rxDelta > 0);
    assertEqual(wifi.length, 1, 'one Wi-Fi sample');
    assertEqual(wifi[0].rxDelta, 500_000);
    assertEqual(wifi[0].txDelta, 100_000);
    assert(wifi[0].download > 500_000 && wifi[0].download < 1_100_000,
        `download ${wifi[0].download} should be ~1 MB/s over ~0.5 s`);

    monitor.setInterface('enp3s0');
    await sleep(600);
    const wired = samples.filter(s => s.iface === 'enp3s0');
    assert(wired.length >= 1, 'samples after switching');
    assert(wired.every(s => s.download === 0 && s.rxDelta === 0), 'no spike after switch');

    monitor.setInterface(null);
    assertEqual(monitor.current.download, 0);
    assertEqual(monitor._timerId, 0, 'timer stops without an interface');
    monitor.destroy();
});

test('SpeedMonitor reports zero while counters are unreadable', async () => {
    const sysRoot = makeTempDir();
    const monitor = new SpeedMonitor({intervalMs: 500, sysRoot});
    monitor.setInterface('gone0');
    await sleep(600);
    assertEqual(monitor.current, {iface: 'gone0', download: 0, upload: 0, rxDelta: 0, txDelta: 0});
    monitor.destroy();
});

test('SpeedMonitor keeps a bounded history', () => {
    const monitor = new SpeedMonitor();
    for (let i = 0; i < 500; i++)
        monitor._publish({iface: 'x', download: i, upload: 0, rxDelta: 0, txDelta: 0});
    assertEqual(monitor.history.length, 120);
    assertEqual(monitor.history.at(-1).download, 499);
    monitor.destroy();
});
